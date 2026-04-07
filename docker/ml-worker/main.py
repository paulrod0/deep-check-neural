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


def pdf_to_image_bytes(pdf_bytes: bytes) -> bytes:
    """Convert first page of PDF to JPEG bytes."""
    try:
        from pdf2image import convert_from_bytes
        images = convert_from_bytes(pdf_bytes, first_page=1, last_page=1, dpi=300)
        buf = io.BytesIO()
        images[0].save(buf, format="JPEG", quality=95)
        return buf.getvalue()
    except ImportError:
        # Fallback: try fitz (PyMuPDF)
        try:
            import fitz
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            page = doc[0]
            pix = page.get_pixmap(dpi=300)
            return pix.tobytes("jpeg")
        except ImportError:
            raise HTTPException(400, "PDF support requires pdf2image or PyMuPDF. Install: pip install pdf2image PyMuPDF")


def ensure_image_bytes(raw_bytes: bytes, filename: str = "") -> bytes:
    """Auto-detect PDF and convert to image bytes if needed."""
    if raw_bytes[:5] == b"%PDF-" or filename.lower().endswith(".pdf"):
        return pdf_to_image_bytes(raw_bytes)
    return raw_bytes
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List

from engines.deepfake_engine import DeepfakeEngine
from engines.doc_engine import DocForensicsEngine
from engines.doc_ocr_engine import DocOcrEngine
from engines.keystroke_engine import KeystrokeEngine
from engines.gemma_doc_engine import GemmaDocEngine
from model_loader import ensure_models_exist, check_and_download_models, get_model_status

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PORT = int(os.getenv("PORT", 8001))
GEMMA_ENABLED = os.getenv("GEMMA_ENABLED", "0") == "1"

# Download models on startup if missing
logger.info("Checking models...")
ensure_models_exist()

# Initialize engines
logger.info("Loading engines...")
deepfake = DeepfakeEngine()
doc_forensics = DocForensicsEngine()
doc_ocr = DocOcrEngine()
keystroke = KeystrokeEngine()

# Gemma 4: only load if explicitly enabled (pre-production)
gemma_doc = None
if GEMMA_ENABLED:
    logger.info("Gemma 4 ENABLED — loading...")
    gemma_doc = GemmaDocEngine()
else:
    logger.info("Gemma 4 DISABLED (set GEMMA_ENABLED=1 to activate)")
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
    else:
        engines["gemma_doc"] = {"engine": "gemma-doc", "available": False, "note": "Set GEMMA_ENABLED=1 to activate"}
    return {"status": "ok", "gemma_enabled": GEMMA_ENABLED, "engines": engines}


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

    result = doc_forensics.detect(image_bytes)
    result["processing_ms"] = round((time.time() - t0) * 1000, 1)
    return result


# -- Document AI Analysis (Gemma 4) --
@app.post("/analyze/document")
async def analyze_document(image: UploadFile = File(None), frameBase64: str = Form(None)):
    """Full document analysis pipeline.

    Always runs:
      1. PDF auto-conversion (if needed)
      2. DINOv2 + ELA forensic detection
      3. OCR (Tesseract) + MRZ parsing + coherence checks

    If GEMMA_ENABLED=1 (pre-production / Xeon):
      4. Gemma 4 explanation + deep semantic analysis
    """
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

    # Step 1: DINOv2 + ELA forensic detection (always)
    forensic_result = doc_forensics.detect(image_bytes)

    # Step 2: Base OCR + MRZ + coherence (always, no LLM)
    base_analysis = doc_ocr.analyze(image_bytes)

    # Step 3: Gemma 4 premium layer (only if enabled)
    gemma_result = None
    if gemma_doc is not None:
        try:
            gemma_result = gemma_doc.analyze_document(image_bytes, forensic_result)
        except Exception as e:
            logger.warning(f"Gemma 4 analysis failed: {e}")

    # Merge results: base always present, Gemma enriches
    analysis = {
        "ocr_text": base_analysis.get("ocr_text", ""),
        "fields": base_analysis.get("fields", {}),
        "mrz": base_analysis.get("mrz"),
        "doc_type": base_analysis.get("doc_type", "unknown"),
        "coherence_issues": base_analysis.get("coherence_issues", []),
        "explanation": "",
        "gemma_enabled": gemma_doc is not None,
    }

    # If Gemma 4 provided richer data, merge it
    if gemma_result:
        if gemma_result.get("ocr_text"):
            analysis["ocr_text"] = gemma_result["ocr_text"]
        if gemma_result.get("fields"):
            analysis["fields"].update(gemma_result["fields"])
        if gemma_result.get("explanation"):
            analysis["explanation"] = gemma_result["explanation"]
        if gemma_result.get("coherence_issues"):
            analysis["coherence_issues"] = gemma_result["coherence_issues"]

    return {
        "forensics": forensic_result,
        "analysis": analysis,
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
    if gemma_doc is not None:
        try:
            gemma_mrz = gemma_doc.extract_mrz(image_bytes)
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
        raise HTTPException(503, "Gemma 4 not enabled. Set GEMMA_ENABLED=1 to activate.")
    return gemma_doc.explain_detection(image_bytes, detection_type, score, details)


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
