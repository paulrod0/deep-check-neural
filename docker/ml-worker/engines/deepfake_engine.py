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
        # Load V9 DINOv3 (GPU preferred)
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
                self.model_version = ckpt.get("config", {}).get("version", "v9")
                logger.info(f"V9 DINOv3 loaded on {device}")
            except Exception as e:
                logger.warning(f"V9 load failed: {e}")

        # Always try to load V3 ONNX too (for ensemble)
        v3_path = MODEL_DIR / "deepfake" / "deepfake_pixel_v1.onnx"
        if v3_path.exists():
            try:
                import onnxruntime as ort
                self.v3_session = ort.InferenceSession(str(v3_path))
                logger.info("V3 ONNX loaded (CPU) — available for ensemble")
            except Exception as e:
                logger.warning(f"V3 load failed: {e}")

        # Set active model name
        if self.v9_model and self.v3_session:
            self.active_model = "ensemble-v9+v3"
        elif self.v9_model:
            self.active_model = "v9-dinov3"
        elif self.v3_session:
            self.active_model = "v3-efficientnet"
            self.model_version = "v3"

    def reload(self):
        self.v9_model = None; self.v3_session = None; self.active_model = None
        self._load_models()

    def detect(self, image_bytes, use_tta=True):
        if use_tta:
            return self._detect_tta(image_bytes)
        img = self._preprocess(image_bytes)
        if self.v9_model is not None: return self._detect_v9(img)
        elif self.v3_session is not None: return self._detect_v3(img)
        return {"error": "No model", "p_fake": 0.5, "verdict": "unknown"}

    def _detect_tta(self, image_bytes):
        """TTA: 5 augmented passes, average logits for lower EER."""
        pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        w, h = pil.size
        augments = [pil]
        augments.append(pil.transpose(Image.FLIP_LEFT_RIGHT))
        cw, ch = int(w*0.9), int(h*0.9)
        if cw > 32 and ch > 32:
            augments.append(pil.crop(((w-cw)//2, (h-ch)//2, (w+cw)//2, (h+ch)//2)))
        cw, ch = int(w*0.8), int(h*0.8)
        if cw > 32 and ch > 32:
            augments.append(pil.crop((0, 0, cw, ch)))
            augments.append(pil.crop((w-cw, h-ch, w, h)))
        # Collect logits from ALL available models x ALL augments
        v9_logits = []
        v3_logits = []
        for aug in augments:
            img = self._preprocess_pil(aug)
            if self.v9_model is not None:
                import torch
                with torch.no_grad():
                    t = torch.from_numpy(img).to(self.v9_device)
                    v9_logits.append(float(self.v9_model(t).cpu().item()))
            if self.v3_session is not None:
                out = self.v3_session.run(None, {self.v3_session.get_inputs()[0].name: img})
                l = out[0][0]
                v3_logits.append(float(l) if np.isscalar(l) else float(l[0]))

        if not v9_logits and not v3_logits:
            return {"error": "No model", "p_fake": 0.5, "verdict": "unknown"}

        # Ensemble: weighted average of model logits
        # V9 DINOv3 (semantic) weight 0.6, V3 EfficientNet (frequency) weight 0.4
        ensemble_logits = []
        if v9_logits:
            ensemble_logits.append(sum(v9_logits) / len(v9_logits) * 0.6)
        if v3_logits:
            ensemble_logits.append(sum(v3_logits) / len(v3_logits) * 0.4)

        # Normalize weights if only one model
        total_weight = (0.6 if v9_logits else 0) + (0.4 if v3_logits else 0)
        avg_logit = sum(ensemble_logits) / total_weight

        p = float(1 / (1 + np.exp(-avg_logit)))
        r = self._result(p, self.active_model, self.model_version)
        r["tta_passes"] = len(augments)
        r["ensemble"] = {"v9": len(v9_logits) > 0, "v3": len(v3_logits) > 0}
        return r

    def _preprocess(self, image_bytes):
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB").resize((IMG_SIZE, IMG_SIZE))
        arr = np.array(img, dtype=np.float32) / 255.0
        return ((arr - MEAN) / STD).transpose(2, 0, 1)[np.newaxis]

    def _preprocess_pil(self, pil_img):
        img = pil_img.resize((IMG_SIZE, IMG_SIZE))
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
