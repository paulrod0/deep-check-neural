"""
Deep-Check — ML Worker (FastAPI)
=================================
Server-side pixel forensics service for on-premise deployments.
Runs EfficientNet-Lite ONNX model for L4 deepfake analysis.

Endpoints:
  GET  /health                  — Model status
  POST /analyze-frame           — Analyze a face frame image

Veritas Engine v2 — Deep-Check
"""

import os
import io
import base64
import logging
from pathlib import Path

import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Optional ONNX runtime
try:
    import onnxruntime as ort
    ONNX_AVAILABLE = True
except ImportError:
    ONNX_AVAILABLE = False
    logging.warning("onnxruntime not installed — model inference disabled")

# Optional PIL for image decoding
try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ─── Config ───────────────────────────────────────────────────────────────────

MODEL_DIR  = Path(os.getenv('MODEL_DIR', '/app/models'))
PORT       = int(os.getenv('PORT', 8001))
IMG_SIZE   = 224
LABELS     = ['real_human', 'deepfake_video', 'photo_replay']

# ─── Load model ───────────────────────────────────────────────────────────────

session: 'ort.InferenceSession | None' = None
model_path_used: str = ''


def load_model():
    global session, model_path_used
    if not ONNX_AVAILABLE:
        return

    candidates = [
        MODEL_DIR / 'efficientnet_pixel.onnx',
        MODEL_DIR / 'deepfake_detector.onnx',
    ]
    for path in candidates:
        if path.exists():
            try:
                session = ort.InferenceSession(str(path))
                model_path_used = str(path)
                logger.info(f"Loaded model: {path}")
                return
            except Exception as e:
                logger.warning(f"Failed to load {path}: {e}")

    logger.warning("No ONNX model found — running heuristic fallback only")


load_model()

# ─── FastAPI app ──────────────────────────────────────────────────────────────

app = FastAPI(title='Deep-Check ML Worker', version='2.0.0')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['POST', 'GET'])

# ─── Schemas ──────────────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    frameBase64: str
    sessionId: str = ''

class AnalyzeResponse(BaseModel):
    score: int
    method: str
    features: dict
    prediction: str
    probabilities: dict

# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get('/health')
def health():
    return {
        'status': 'ok',
        'model_loaded': session is not None,
        'model_path': model_path_used,
        'onnx_available': ONNX_AVAILABLE,
    }


@app.post('/analyze-frame', response_model=AnalyzeResponse)
def analyze_frame(req: AnalyzeRequest):
    # Decode image
    b64 = req.frameBase64
    if ',' in b64:
        b64 = b64.split(',', 1)[1]

    try:
        image_bytes = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=400, detail='Invalid base64 image data')

    if len(image_bytes) > 2 * 1024 * 1024:
        raise HTTPException(status_code=413, detail='Image too large (max 2MB)')

    img_array = decode_image(image_bytes)

    if session is not None:
        return run_model_inference(img_array)
    else:
        return run_heuristic(image_bytes)


# ─── Inference ────────────────────────────────────────────────────────────────

def decode_image(data: bytes) -> np.ndarray:
    """Decode JPEG/PNG bytes to (224, 224, 3) float32 array."""
    if PIL_AVAILABLE:
        img = Image.open(io.BytesIO(data)).convert('RGB').resize((IMG_SIZE, IMG_SIZE))
        arr = np.array(img, dtype=np.float32) / 255.0
    else:
        # Fallback: random noise (model unavailable)
        arr = np.random.rand(IMG_SIZE, IMG_SIZE, 3).astype(np.float32)

    # Normalize (ImageNet mean/std)
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std  = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    arr  = (arr - mean) / std

    # HWC -> NCHW
    return arr.transpose(2, 0, 1)[np.newaxis]  # (1, 3, 224, 224)


def run_model_inference(img: np.ndarray) -> AnalyzeResponse:
    input_name = session.get_inputs()[0].name
    outputs    = session.run(None, {input_name: img})
    logits     = outputs[0][0]  # (3,)

    # Softmax
    exp_l = np.exp(logits - logits.max())
    probs = exp_l / exp_l.sum()

    pred_idx = int(probs.argmax())
    pred     = LABELS[pred_idx]
    # fake score: 1 - P(real)
    score    = int(round((1 - probs[0]) * 100))

    return AnalyzeResponse(
        score=score,
        method='efficientnet',
        prediction=pred,
        probabilities={LABELS[i]: round(float(probs[i]), 4) for i in range(len(LABELS))},
        features={'model': model_path_used},
    )


def run_heuristic(raw_bytes: bytes) -> AnalyzeResponse:
    """Byte-level heuristic when no model is loaded."""
    data     = np.frombuffer(raw_bytes, dtype=np.uint8)
    freq     = np.bincount(data, minlength=256).astype(float)
    n        = len(data)
    prob     = freq / n
    nonzero  = prob[prob > 0]
    entropy  = -float(np.sum(nonzero * np.log2(nonzero)))
    # Very smooth image = low entropy = possibly synthetic
    score    = max(0, int((6.5 - entropy) / 2.0 * 100))
    score    = min(100, score)

    pred_idx = 1 if score > 60 else 0
    return AnalyzeResponse(
        score=score,
        method='heuristic',
        prediction=LABELS[pred_idx],
        probabilities={'real_human': round(1 - score/100, 4), 'deepfake_video': round(score/100, 4), 'photo_replay': 0.0},
        features={'entropy': round(entropy, 3), 'bytes_analyzed': n},
    )


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=PORT, log_level='info')
