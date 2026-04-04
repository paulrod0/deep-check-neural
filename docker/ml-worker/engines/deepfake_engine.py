"""Deepfake detection engine: V3 ONNX (CPU) + V9 DINOv3 PyTorch (GPU)."""
import os, io, logging
from pathlib import Path
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)
MODEL_DIR = Path(os.getenv("MODEL_DIR", "/app/models"))
IMG_SIZE = 224
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


class DeepfakeEngine:
    def __init__(self):
        self.v9_model = None
        self.v3_session = None
        self.active_model = None
        self.model_version = None
        self.v9_device = "cpu"
        self._load_models()

    def _load_models(self):
        v9_path = MODEL_DIR / "deepfake" / "best_v9.pt"
        if v9_path.exists():
            try:
                import torch, timm, torch.nn as nn
                device = "cuda" if torch.cuda.is_available() else "cpu"
                ckpt = torch.load(v9_path, map_location=device, weights_only=False)
                bb = timm.create_model("vit_large_patch16_dinov3.lvd1689m", pretrained=False, num_classes=0, dynamic_img_size=True, img_size=224)
                fd = bb.num_features
                hd = nn.Sequential(nn.LayerNorm(fd), nn.Dropout(0.15), nn.Linear(fd, 1))

                class M(nn.Module):
                    def __init__(self, b, h): super().__init__(); self.backbone = b; self.head = h
                    def forward(self, x): return self.head(self.backbone(x)).squeeze(-1)

                model = M(bb, hd).to(device)
                state = ckpt.get("model_state", ckpt.get("model_state_dict", {}))
                model.load_state_dict(state, strict=False)
                model.eval()
                self.v9_model = model; self.v9_device = device
                self.active_model = "v9-dinov3"
                self.model_version = ckpt.get("config", {}).get("version", "v9")
                logger.info(f"V9 DINOv3 loaded on {device}")
            except Exception as e:
                logger.warning(f"V9 load failed: {e}")

        v3_path = MODEL_DIR / "deepfake" / "deepfake_pixel_v1.onnx"
        if v3_path.exists() and self.v9_model is None:
            try:
                import onnxruntime as ort
                self.v3_session = ort.InferenceSession(str(v3_path))
                self.active_model = "v3-efficientnet"
                self.model_version = "v3"
                logger.info("V3 ONNX loaded (CPU)")
            except Exception as e:
                logger.warning(f"V3 load failed: {e}")

    def reload(self):
        self.v9_model = None; self.v3_session = None; self.active_model = None
        self._load_models()

    def detect(self, image_bytes):
        img = self._preprocess(image_bytes)
        if self.v9_model is not None: return self._detect_v9(img)
        elif self.v3_session is not None: return self._detect_v3(img)
        return {"error": "No model", "p_fake": 0.5, "verdict": "unknown"}

    def _preprocess(self, image_bytes):
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB").resize((IMG_SIZE, IMG_SIZE))
        arr = np.array(img, dtype=np.float32) / 255.0
        return ((arr - MEAN) / STD).transpose(2, 0, 1)[np.newaxis]

    def _detect_v9(self, img_np):
        import torch
        with torch.no_grad():
            t = torch.from_numpy(img_np).to(self.v9_device)
            p = float(torch.sigmoid(self.v9_model(t)).cpu().item())
        return self._result(p, self.active_model, self.model_version)

    def _detect_v3(self, img_np):
        out = self.v3_session.run(None, {self.v3_session.get_inputs()[0].name: img_np})
        logit = out[0][0]
        p = float(1 / (1 + np.exp(-logit))) if np.isscalar(logit) else float(1 / (1 + np.exp(-logit[0])))
        return self._result(p, self.active_model, self.model_version)

    def _result(self, p, model, version):
        v = "real" if p < 0.2 else "suspicious" if p < 0.5 else "likely_fake" if p < 0.8 else "fake"
        c = "high" if abs(p - 0.5) > 0.3 else "medium" if abs(p - 0.5) > 0.15 else "low"
        return {"p_fake": round(p, 4), "authenticity_score": round((1 - p) * 100, 1), "verdict": v, "confidence": c, "model": model, "version": version}

    def status(self):
        return {"engine": "deepfake", "active_model": self.active_model or "none", "version": self.model_version, "gpu": self.v9_model is not None}
