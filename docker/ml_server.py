"""
Deep-Check INTEL — Local ONNX Inference Server

FastAPI server that exposes the ONNX models for deepfake detection and
image forensics. Runs inside the ml-inference container (air-gap safe).

Endpoints:
  GET  /health           — liveness probe
  POST /infer/deepfake   — video-frame deepfake score
  POST /infer/document   — document ELA + noise analysis
"""

import os
import io
import json
import logging
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Header, File, UploadFile
from fastapi.responses import JSONResponse
import uvicorn
import numpy as np

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ml-inference")

app = FastAPI(title="Deep-Check ML Inference", version="1.0.0")

MODELS_DIR = Path(os.getenv("MODELS_DIR", "/app/models"))
INTERNAL_SECRET = os.getenv("LSTM_LAMBDA_SECRET", "")

# ── Optional ONNX runtime ────────────────────────────────────────────────────
try:
    import onnxruntime as ort
    ORT_AVAILABLE = True
    logger.info("ONNX Runtime available: %s", ort.__version__)
except ImportError:
    ORT_AVAILABLE = False
    logger.warning("onnxruntime not installed — running in stub mode")

# ── Model registry ────────────────────────────────────────────────────────────
_sessions: dict[str, Any] = {}

def load_model(name: str) -> Any | None:
    """Load and cache an ONNX InferenceSession by model name."""
    if name in _sessions:
        return _sessions[name]
    model_path = MODELS_DIR / f"{name}.onnx"
    if not model_path.exists():
        logger.warning("Model not found: %s", model_path)
        return None
    if not ORT_AVAILABLE:
        return None
    try:
        session = ort.InferenceSession(str(model_path))
        _sessions[name] = session
        logger.info("Loaded model: %s", name)
        return session
    except Exception as exc:
        logger.error("Failed to load model %s: %s", name, exc)
        return None


def check_auth(x_internal_secret: str | None) -> None:
    """Validate the internal shared secret if one is configured."""
    if INTERNAL_SECRET and x_internal_secret != INTERNAL_SECRET:
        raise HTTPException(status_code=403, detail="Invalid internal secret")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    models_present = [p.stem for p in MODELS_DIR.glob("*.onnx")] if MODELS_DIR.exists() else []
    return {
        "status": "ok",
        "ort_available": ORT_AVAILABLE,
        "models_loaded": list(_sessions.keys()),
        "models_on_disk": models_present,
    }


@app.post("/infer/deepfake")
async def infer_deepfake(
    file: UploadFile = File(...),
    x_internal_secret: str | None = Header(default=None),
):
    """
    Accept a JPEG/PNG frame, return a deepfake probability score (0.0–1.0).

    If the ONNX model is not available, returns a deterministic stub score
    based on file size (for integration testing without model files).
    """
    check_auth(x_internal_secret)

    data = await file.read()
    session = load_model("deepfake_detector")

    if session and ORT_AVAILABLE:
        try:
            from PIL import Image
            img = Image.open(io.BytesIO(data)).convert("RGB").resize((224, 224))
            arr = np.array(img, dtype=np.float32) / 255.0
            arr = np.transpose(arr, (2, 0, 1))[np.newaxis, ...]  # NCHW
            input_name = session.get_inputs()[0].name
            outputs = session.run(None, {input_name: arr})
            score = float(outputs[0].flatten()[0])
            score = max(0.0, min(1.0, score))
        except Exception as exc:
            logger.error("Inference error: %s", exc)
            score = 0.0
    else:
        # Stub: deterministic score based on file hash (no model needed)
        score = (sum(data[:64]) % 100) / 100.0

    return JSONResponse({
        "score": score,
        "label": "deepfake" if score > 0.5 else "authentic",
        "model": "deepfake_detector",
        "stub": session is None,
    })


@app.post("/infer/document")
async def infer_document(
    file: UploadFile = File(...),
    x_internal_secret: str | None = Header(default=None),
):
    """
    Accept an image/document file, return forensic risk scores.
    """
    check_auth(x_internal_secret)

    data = await file.read()
    session = load_model("document_forensics")

    if session and ORT_AVAILABLE:
        try:
            from PIL import Image
            img = Image.open(io.BytesIO(data)).convert("RGB").resize((512, 512))
            arr = np.array(img, dtype=np.float32) / 255.0
            arr = np.transpose(arr, (2, 0, 1))[np.newaxis, ...]
            input_name = session.get_inputs()[0].name
            outputs = session.run(None, {input_name: arr})
            flat = outputs[0].flatten()
            ela_score = float(flat[0]) if len(flat) > 0 else 0.0
            noise_score = float(flat[1]) if len(flat) > 1 else 0.0
        except Exception as exc:
            logger.error("Document inference error: %s", exc)
            ela_score = noise_score = 0.0
    else:
        ela_score = (sum(data[:32]) % 100) / 100.0
        noise_score = (sum(data[32:64]) % 100) / 100.0 if len(data) > 64 else 0.0

    risk_score = int((ela_score * 0.6 + noise_score * 0.4) * 100)
    return JSONResponse({
        "ela_score": ela_score,
        "noise_score": noise_score,
        "risk_score": risk_score,
        "risk_level": "high_risk" if risk_score > 70 else "suspicious" if risk_score > 40 else "clean",
        "model": "document_forensics",
        "stub": session is None,
    })


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
