"""
Deep-Check ML Worker v3 -- All Verification Engines
=====================================================
Endpoints:
  GET  /health              -- Status of all engines
  POST /detect/deepfake     -- Deepfake detection (V9 DINOv3 / V3 ONNX)
  POST /detect/document     -- Document forensics (DINOv2 + ELA)
  POST /verify/keystroke    -- Keystroke verification + bot detection
  POST /enroll/keystroke    -- Enroll user typing pattern
  GET  /models/status       -- Model versions and metrics
  POST /models/reload       -- Hot-reload models from disk
"""
import os, io, base64, logging, time
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from PIL import Image


def pdf_to_images(pdf_bytes: bytes) -> list:
    """Convert PDF to list of PIL Images (one per page, 300dpi)."""
    try:
        import fitz
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        images = []
        for page in doc:
            pix = page.get_pixmap(dpi=300)
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            images.append(img)
        if not images:
            raise HTTPException(400, "PDF has no pages")
        logger.info(f"PDF: {len(images)} pages extracted")
        return images
    except ImportError:
        raise HTTPException(400, "PDF support requires PyMuPDF")


def images_to_bytes(images: list) -> bytes:
    """Combine multiple images into single vertical JPEG."""
    if len(images) == 1:
        buf = io.BytesIO()
        images[0].save(buf, format="JPEG", quality=95)
        return buf.getvalue()
    total_w = max(img.width for img in images)
    total_h = sum(img.height for img in images)
    combined = Image.new("RGB", (total_w, total_h), (255, 255, 255))
    y = 0
    for img in images:
        combined.paste(img, (0, y))
        y += img.height
    buf = io.BytesIO()
    combined.save(buf, format="JPEG", quality=95)
    logger.info(f"Combined: {len(images)} pages -> {total_w}x{total_h}px")
    return buf.getvalue()


def image_to_bytes(img: Image.Image) -> bytes:
    """Single PIL Image to JPEG bytes."""
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def parse_pdf(raw_bytes: bytes):
    """Parse PDF into page_1 (for forensics) and all_pages (for LLM OCR)."""
    pages = pdf_to_images(raw_bytes)
    page1_bytes = image_to_bytes(pages[0])
    all_bytes = images_to_bytes(pages) if len(pages) > 1 else page1_bytes
    return page1_bytes, all_bytes, len(pages)


def ensure_image_bytes(raw_bytes: bytes, filename: str = "") -> bytes:
    """Auto-detect PDF and convert to image bytes (page 1 only for forensics)."""
    if raw_bytes[:5] == b"%PDF-" or filename.lower().endswith(".pdf"):
        pages = pdf_to_images(raw_bytes)
        return image_to_bytes(pages[0])
    return raw_bytes
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List

from engines.deepfake_engine import DeepfakeEngine
from engines.doc_engine import DocForensicsEngine
from engines.doc_ocr_engine import DocOcrEngine
from engines.keystroke_engine import KeystrokeEngine
from engines.gemma_doc_engine import GemmaDocEngine
from engines.ollama_engine import OllamaDocEngine
from model_loader import ensure_models_exist, check_and_download_models, get_model_status

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PORT = int(os.getenv("PORT", 8001))
GEMMA_ENABLED = os.getenv("GEMMA_ENABLED", "0") == "1"
OLLAMA_ENABLED = os.getenv("OLLAMA_ENABLED", "0") == "1"

# Download models on startup if missing
logger.info("Checking models...")
ensure_models_exist()

# Initialize engines
logger.info("Loading engines...")
deepfake = DeepfakeEngine()
doc_forensics = DocForensicsEngine()
doc_ocr = DocOcrEngine()
keystroke = KeystrokeEngine()

# LLM layer: Gemma 4 (heavy, AWS) or Ollama (light, local)
gemma_doc = None
ollama_doc = None

if GEMMA_ENABLED:
    logger.info("Gemma 4 ENABLED — loading (heavy, GPU recommended)...")
    gemma_doc = GemmaDocEngine()
elif OLLAMA_ENABLED:
    logger.info("Ollama ENABLED — connecting to local Ollama...")
    ollama_doc = OllamaDocEngine()
else:
    logger.info("No LLM layer enabled (set GEMMA_ENABLED=1 or OLLAMA_ENABLED=1)")

# Unified LLM interface: prefer Gemma 4 > Ollama > None
llm_engine = gemma_doc or ollama_doc
logger.info(f"LLM engine: {llm_engine.__class__.__name__ if llm_engine else 'None'}")
logger.info("All engines initialized")

# FastAPI
app = FastAPI(title="Deep-Check ML Worker", version="3.0.0",
              description="Unified verification API: deepfake + document forensics + keystroke biometrics")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# -- Schemas --
class KeystrokeEntry(BaseModel):
    hold_time: float = 0
    flight_time: float = 0
    key_category: int = 0

class KeystrokeRequest(BaseModel):
    keystrokes: List[KeystrokeEntry]
    user_id: Optional[str] = None

class EnrollRequest(BaseModel):
    keystrokes: List[KeystrokeEntry]
    user_id: str


# -- Health --
@app.get("/health")
def health():
    engines = {
        "deepfake": deepfake.status(),
        "doc_forensics": doc_forensics.status(),
        "doc_ocr": doc_ocr.status(),
        "keystroke": keystroke.status(),
    }
    if gemma_doc is not None:
        engines["gemma_doc"] = gemma_doc.status()
    if ollama_doc is not None:
        engines["ollama_doc"] = ollama_doc.status()
    if llm_engine is None:
        engines["llm"] = {"available": False, "note": "Set GEMMA_ENABLED=1 or OLLAMA_ENABLED=1"}
    return {"status": "ok", "llm_engine": llm_engine.__class__.__name__ if llm_engine else "None", "engines": engines}


# -- Identity Verification (Front + Back) --
@app.post("/verify/identity")
async def verify_identity(front: UploadFile = File(...), back: UploadFile = File(...)):
    """Full identity document verification with front + back photos.

    Designed for on-premise camera capture flow:
    1. User takes photo of document FRONT (face side)
    2. User takes photo of document BACK (MRZ side)
    3. Both analyzed independently + cross-validated

    Returns combined verdict with cross-validation issues.
    """
    from engines.doc_ocr_engine import cross_validate_front_back, validate_dni_number
    t0 = time.time()

    front_bytes = await front.read()
    back_bytes = await back.read()

    # Analyze front (face side)
    front_forensics = doc_forensics.detect(front_bytes)
    front_analysis = doc_ocr.analyze(front_bytes)

    # Analyze back (MRZ side)
    back_forensics = doc_forensics.detect(back_bytes)
    back_analysis = doc_ocr.analyze(back_bytes)

    # Cross-validate front vs back
    cross_issues = cross_validate_front_back(
        front_analysis.get("fields", {}),
        back_analysis.get("fields", {})
    )

    # DNI check digit (from whichever side has the number)
    dni_issues = []
    for side_name, side_data in [("front", front_analysis), ("back", back_analysis)]:
        doc_num = side_data.get("fields", {}).get("document_number", "")
        if doc_num and len(doc_num) == 9:
            valid, expected = validate_dni_number(doc_num)
            if valid is False:
                dni_issues.append(f"CRITICAL: DNI number {doc_num} ({side_name}) has invalid check digit — expected '{expected}'")
            elif valid is True:
                dni_issues.append(f"DNI check digit valid: {doc_num} ({side_name})")

    # MRZ cross-validation (back side should have MRZ)
    mrz_data = back_analysis.get("mrz")

    # Combined forensic score (average of both sides)
    avg_p = (front_forensics["p_tampered"] + back_forensics["p_tampered"]) / 2

    # Severity of cross-validation issues
    critical_issues = [i for i in cross_issues + dni_issues if "CRITICAL" in i]
    all_issues = cross_issues + dni_issues + front_analysis.get("coherence_issues", []) + back_analysis.get("coherence_issues", [])

    # Final verdict
    if critical_issues:
        verdict = "tampered"
        confidence = 0.95
    elif avg_p > 0.5:
        verdict = "suspicious"
        confidence = 1 - avg_p
    elif all_issues:
        verdict = "review_needed"
        confidence = 0.6
    else:
        verdict = "authentic"
        confidence = 1 - avg_p

    return {
        "verdict": verdict,
        "confidence": round(confidence, 4),
        "front": {
            "forensics": front_forensics,
            "fields": front_analysis.get("fields", {}),
            "doc_type": front_analysis.get("doc_type", "unknown"),
        },
        "back": {
            "forensics": back_forensics,
            "fields": back_analysis.get("fields", {}),
            "mrz": mrz_data,
        },
        "cross_validation": {
            "issues": all_issues,
            "critical": critical_issues,
            "dni_check": dni_issues,
        },
        "processing_ms": round((time.time() - t0) * 1000, 1),
    }


# -- Deepfake Detection --
@app.post("/detect/deepfake")
async def detect_deepfake(image: UploadFile = File(None), frameBase64: str = Form(None)):
    """Detect deepfake in image. Accepts file upload or base64."""
    t0 = time.time()

    if image is not None:
        image_bytes = await image.read()
    elif frameBase64:
        b64 = frameBase64.split(",", 1)[-1] if "," in frameBase64 else frameBase64
        try:
            image_bytes = base64.b64decode(b64)
        except Exception:
            raise HTTPException(400, "Invalid base64")
    else:
        raise HTTPException(400, "Provide 'image' file or 'frameBase64'")

    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(413, "Image too large (max 10MB)")

    result = deepfake.detect(image_bytes)
    result["processing_ms"] = round((time.time() - t0) * 1000, 1)
    return result


# -- Document Forensics --
@app.post("/detect/document")
async def detect_document(image: UploadFile = File(None), frameBase64: str = Form(None)):
    """Detect document manipulation. Accepts file upload, base64, or PDF."""
    t0 = time.time()

    if image is not None:
        raw_bytes = await image.read()
        image_bytes = ensure_image_bytes(raw_bytes, image.filename or "")
    elif frameBase64:
        b64 = frameBase64.split(",", 1)[-1] if "," in frameBase64 else frameBase64
        try:
            raw_bytes = base64.b64decode(b64)
            image_bytes = ensure_image_bytes(raw_bytes)
        except Exception:
            raise HTTPException(400, "Invalid base64")
    else:
        raise HTTPException(400, "Provide 'image' file or 'frameBase64'")

    is_pdf = raw_bytes[:5] == b"%PDF-"
    result = doc_forensics.detect(image_bytes, raw_pdf_bytes=raw_bytes if is_pdf else None)
    result["processing_ms"] = round((time.time() - t0) * 1000, 1)
    return result


# -- Document AI Analysis (Gemma 4) --
@app.post("/analyze/document")
async def analyze_document(image: UploadFile = File(None), frameBase64: str = Form(None)):
    """Full document analysis pipeline.

    Pipeline:
      1. PDF: extract page 1 (forensics) + all pages (LLM OCR)
      2. DINOv2 + ELA forensic detection on page 1
      3. Base OCR + MRZ parsing + coherence checks
      4. LLM analysis (Gemma 4 / Ollama) on all pages
      5. Combined verdict: forensics + LLM semantic analysis
    """
    t0 = time.time()

    if image is not None:
        raw_bytes = await image.read()
    elif frameBase64:
        b64 = frameBase64.split(",", 1)[-1] if "," in frameBase64 else frameBase64
        try:
            raw_bytes = base64.b64decode(b64)
        except Exception:
            raise HTTPException(400, "Invalid base64")
    else:
        raise HTTPException(400, "Provide 'image' file or 'frameBase64'")

    # Separate page 1 (for forensics) from all pages (for LLM)
    is_pdf = raw_bytes[:5] == b"%PDF-" or (image and image.filename and image.filename.lower().endswith(".pdf"))
    if is_pdf:
        page1_bytes, all_pages_bytes, num_pages = parse_pdf(raw_bytes)
    else:
        page1_bytes = raw_bytes
        all_pages_bytes = raw_bytes
        num_pages = 1

    # Step 1: DINOv2 + ELA + PDF structural on PAGE 1
    forensic_result = doc_forensics.detect(page1_bytes, raw_pdf_bytes=raw_bytes if is_pdf else None)

    # Step 2: Base OCR + MRZ + coherence on page 1
    base_analysis = doc_ocr.analyze(page1_bytes)

    # Step 3: LLM analysis on ALL PAGES (richer OCR)
    llm_result = None
    if llm_engine is not None:
        try:
            llm_result = llm_engine.analyze_document(all_pages_bytes, forensic_result)
        except Exception as e:
            logger.warning(f"LLM analysis failed: {e}")

    # Build analysis result — start with PDF structural text if available (instant, perfect)
    pdf_text = forensic_result.get("text_extracted", "")
    pdf_fields = forensic_result.get("fields_from_pdf", {})
    base_text = pdf_text or base_analysis.get("ocr_text", "")
    base_fields = {**base_analysis.get("fields", {}), **pdf_fields}

    analysis = {
        "ocr_text": base_text,
        "fields": dict(base_fields),
        "mrz": base_analysis.get("mrz"),
        "doc_type": base_analysis.get("doc_type", "unknown"),
        "coherence_issues": list(base_analysis.get("coherence_issues", [])),
        "explanation": "",
        "llm_enabled": llm_engine is not None,
        "pages": num_pages,
    }

    # Merge LLM data
    if llm_result and isinstance(llm_result, dict):
        try:
            if llm_result.get("ocr_text") and isinstance(llm_result["ocr_text"], str):
                analysis["ocr_text"] = llm_result["ocr_text"]
            gf = llm_result.get("fields")
            if gf and isinstance(gf, dict):
                for k, v in gf.items():
                    if isinstance(k, str) and v is not None:
                        analysis["fields"][k] = str(v)
            if llm_result.get("explanation") and isinstance(llm_result["explanation"], str):
                analysis["explanation"] = llm_result["explanation"]
            gc = llm_result.get("coherence_issues")
            if gc and isinstance(gc, list):
                analysis["coherence_issues"] = [str(x) for x in gc]
            if llm_result.get("doc_type") and str(llm_result["doc_type"]) != "unknown":
                analysis["doc_type"] = str(llm_result["doc_type"])
        except Exception as e:
            logger.warning(f"LLM merge error: {e}")

    # Step 4: COMBINED VERDICT — forensics + LLM semantic
    p_forensic = forensic_result.get("p_tampered", 0.5)
    llm_confirms_authentic = False

    if llm_result and isinstance(llm_result, dict):
        llm_issues = llm_result.get("coherence_issues", [])
        has_fields = bool(analysis["fields"])
        no_critical_issues = not llm_issues or all("cannot" in str(x).lower() or "standard" in str(x).lower() for x in llm_issues)
        llm_confirms_authentic = has_fields and no_critical_issues

    # Combined score: weight forensics 60%, LLM semantic 40%
    llm_score = 0.1 if llm_confirms_authentic else 0.7
    combined_p = p_forensic * 0.6 + llm_score * 0.4

    if combined_p < 0.25:
        combined_verdict = "authentic"
    elif combined_p < 0.50:
        combined_verdict = "likely_authentic"
    elif combined_p < 0.70:
        combined_verdict = "suspicious"
    else:
        combined_verdict = "tampered"

    return {
        "verdict": combined_verdict,
        "confidence_score": round(1 - combined_p, 4),
        "forensics": {
            **forensic_result,
            "note": "DINOv2 + ELA analysis on page 1 only",
        },
        "analysis": analysis,
        "combined": {
            "p_tampered_forensic": round(p_forensic, 4),
            "llm_confirms_authentic": llm_confirms_authentic,
            "p_tampered_combined": round(combined_p, 4),
            "verdict": combined_verdict,
        },
        "processing_ms": round((time.time() - t0) * 1000, 1),
    }


@app.post("/analyze/mrz")
async def analyze_mrz(image: UploadFile = File(None), frameBase64: str = Form(None)):
    """Extract and parse MRZ. Uses base engine (always) + Gemma 4 (if enabled)."""
    if image is not None:
        raw_bytes = await image.read()
        image_bytes = ensure_image_bytes(raw_bytes, image.filename or "")
    elif frameBase64:
        b64 = frameBase64.split(",", 1)[-1] if "," in frameBase64 else frameBase64
        image_bytes = base64.b64decode(b64)
    else:
        raise HTTPException(400, "Provide 'image' file or 'frameBase64'")

    # Base MRZ (always works)
    base_mrz = doc_ocr.extract_mrz(image_bytes)

    # If Gemma 4 enabled, try richer extraction
    if llm_engine is not None:
        try:
            gemma_mrz = llm_engine.extract_mrz(image_bytes)
            if gemma_mrz and not gemma_mrz.get("error"):
                return gemma_mrz
        except Exception as e:
            logger.warning(f"Gemma MRZ failed, using base: {e}")

    return base_mrz


@app.post("/explain")
async def explain_detection(image: UploadFile = File(None), frameBase64: str = Form(None),
                            detection_type: str = Form("deepfake"),
                            score: int = Form(50), details: str = Form("")):
    """Generate human-readable explanation of any detection result using Gemma 4."""
    if image is not None:
        image_bytes = await image.read()
    elif frameBase64:
        b64 = frameBase64.split(",", 1)[-1] if "," in frameBase64 else frameBase64
        image_bytes = base64.b64decode(b64)
    else:
        raise HTTPException(400, "Provide 'image' file or 'frameBase64'")

    if gemma_doc is None:
        raise HTTPException(503, "No LLM engine enabled. Set GEMMA_ENABLED=1 or OLLAMA_ENABLED=1")
    return llm_engine.explain_detection(image_bytes, detection_type, score, details)


# -- Keystroke Verification --
@app.post("/verify/keystroke")
def verify_keystroke(req: KeystrokeRequest):
    """Verify keystroke pattern. Returns bot score and user similarity if user_id given."""
    keystrokes = [ks.dict() for ks in req.keystrokes]
    if len(keystrokes) < 10:
        raise HTTPException(400, "Need at least 10 keystrokes")
    return keystroke.verify(keystrokes, req.user_id)


# -- Keystroke Enrollment --
@app.post("/enroll/keystroke")
def enroll_keystroke(req: EnrollRequest):
    """Enroll a user's typing pattern for future verification."""
    keystrokes = [ks.dict() for ks in req.keystrokes]
    if len(keystrokes) < 20:
        raise HTTPException(400, "Need at least 20 keystrokes for enrollment")
    return keystroke.enroll(keystrokes, req.user_id)


# -- Model Management --
@app.get("/models/status")
def models_status():
    """Return versions and metrics for all loaded models."""
    return {
        "models": get_model_status(),
        "engines": {
            "deepfake": deepfake.status(),
            "doc_forensics": doc_forensics.status(),
            "keystroke": keystroke.status(),
        },
    }


@app.post("/models/reload")
def models_reload():
    """Hot-reload all models from disk (called by model-updater)."""
    logger.info("Reloading all models...")
    deepfake.reload()
    doc_forensics.reload()
    keystroke.reload()
    gemma_doc.reload()
    return {
        "status": "reloaded",
        "engines": {
            "deepfake": deepfake.status(),
            "doc_forensics": doc_forensics.status(),
            "keystroke": keystroke.status(),
            "gemma_doc": gemma_doc.status(),
        },
    }


@app.post("/models/update")
def models_update():
    """Check S3 for new models and download if available."""
    updated = check_and_download_models()
    if updated:
        deepfake.reload()
        doc_forensics.reload()
        keystroke.reload()
    return {"updated_engines": updated, "status": "ok"}


# -- Legacy endpoint (backward compatible) --
@app.post("/analyze-frame")
async def analyze_frame_legacy(frameBase64: str = Form(...), sessionId: str = Form("")):
    """Legacy endpoint for backward compatibility."""
    return await detect_deepfake(frameBase64=frameBase64)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
