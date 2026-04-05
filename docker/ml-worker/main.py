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
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List

from engines.deepfake_engine import DeepfakeEngine
from engines.doc_engine import DocForensicsEngine
from engines.keystroke_engine import KeystrokeEngine
from engines.gemma_doc_engine import GemmaDocEngine
from model_loader import ensure_models_exist, check_and_download_models, get_model_status

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PORT = int(os.getenv("PORT", 8001))

# Download models on startup if missing
logger.info("Checking models...")
ensure_models_exist()

# Initialize engines
logger.info("Loading engines...")
deepfake = DeepfakeEngine()
doc_forensics = DocForensicsEngine()
keystroke = KeystrokeEngine()
gemma_doc = GemmaDocEngine()
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
    return {
        "status": "ok",
        "engines": {
            "deepfake": deepfake.status(),
            "doc_forensics": doc_forensics.status(),
            "keystroke": keystroke.status(),
            "gemma_doc": gemma_doc.status(),
        },
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
    """Detect document manipulation. Accepts file upload or base64."""
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

    result = doc_forensics.detect(image_bytes)
    result["processing_ms"] = round((time.time() - t0) * 1000, 1)
    return result


# -- Document AI Analysis (Gemma 4) --
@app.post("/analyze/document")
async def analyze_document(image: UploadFile = File(None), frameBase64: str = Form(None)):
    """Full document AI analysis: OCR + MRZ + coherence + forensic explanation.
    Combines DINOv2 forensics with Gemma 4 language understanding."""
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

    # Step 1: DINOv2 forensic detection
    forensic_result = doc_forensics.detect(image_bytes)

    # Step 2: Gemma 4 analysis (OCR + coherence + explanation)
    gemma_result = gemma_doc.analyze_document(image_bytes, forensic_result)

    return {
        "forensics": forensic_result,
        "analysis": gemma_result,
        "processing_ms": round((time.time() - t0) * 1000, 1),
    }


@app.post("/analyze/mrz")
async def analyze_mrz(image: UploadFile = File(None), frameBase64: str = Form(None)):
    """Extract and parse MRZ from document image using Gemma 4."""
    if image is not None:
        image_bytes = await image.read()
    elif frameBase64:
        b64 = frameBase64.split(",", 1)[-1] if "," in frameBase64 else frameBase64
        image_bytes = base64.b64decode(b64)
    else:
        raise HTTPException(400, "Provide 'image' file or 'frameBase64'")

    return gemma_doc.extract_mrz(image_bytes)


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
