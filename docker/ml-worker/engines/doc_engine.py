"""Document forensics engine: DINOv2 + ELA (GPU) with heuristic fallback."""
import os, io, logging, cv2
from pathlib import Path
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)
MODEL_DIR = Path(os.getenv("MODEL_DIR", "/app/models"))
IMG_SIZE = 224
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

def compute_ela(img_bgr, quality=90):
    _, buf = cv2.imencode(".jpg", img_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    resaved = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    return np.clip(cv2.absdiff(img_bgr, resaved).astype(np.float32) * 15, 0, 255).astype(np.uint8)

class DocForensicsEngine:
    def __init__(self):
        self.model = None; self.active_model = None; self.model_version = None; self.device = "cpu"
        self._load_model()

    def _load_model(self):
        for name in ["best_doc.pt", "best_doc_v2b.pt", "best_doc_restart.pt"]:
            path = MODEL_DIR / "doc_forensics" / name
            if not path.exists(): continue
            try:
                import torch, timm, torch.nn as nn
                device = "cuda" if torch.cuda.is_available() else "cpu"
                ckpt = torch.load(path, map_location=device, weights_only=False)
                bb = timm.create_model("vit_large_patch14_dinov2.lvd142m", pretrained=False, num_classes=0, dynamic_img_size=True, img_size=224)
                old_pe = bb.patch_embed.proj
                new_pe = nn.Conv2d(6, old_pe.out_channels, old_pe.kernel_size, stride=old_pe.stride, padding=old_pe.padding)
                bb.patch_embed.proj = new_pe
                fd = bb.num_features
                hd = nn.Sequential(nn.LayerNorm(fd), nn.Linear(fd, 512), nn.GELU(), nn.Dropout(0.2), nn.Linear(512, 1))
                class M(nn.Module):
                    def __init__(s, b, h): super().__init__(); s.backbone = b; s.head = h
                    def forward(s, x): return s.head(s.backbone(x)).squeeze(-1)
                model = M(bb, hd).to(device)
                state = ckpt.get("model_state_dict", ckpt.get("model_state", {}))
                model.load_state_dict(state, strict=False); model.eval()
                self.model = model; self.device = device; self.active_model = "doc-dinov2-ela"
                self.model_version = ckpt.get("config", {}).get("version", "v2b")
                logger.info(f"Doc Forensics loaded from {name} on {device}"); return
            except Exception as e:
                logger.warning(f"Doc load failed ({name}): {e}")
        logger.warning("No doc forensics model found")

    def reload(self):
        self.model = None; self.active_model = None; self._load_model()

    def detect(self, image_bytes):
        if self.model is not None: return self._detect_model(image_bytes)
        return self._detect_heuristic(image_bytes)

    def _detect_model(self, image_bytes):
        import torch
        arr = np.array(Image.open(io.BytesIO(image_bytes)).convert("RGB"))
        bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR); ela = compute_ela(bgr)
        ela_rgb = cv2.cvtColor(ela, cv2.COLOR_BGR2RGB)
        rgb = cv2.resize(arr, (IMG_SIZE, IMG_SIZE)).astype(np.float32) / 255.0
        ela_r = cv2.resize(ela_rgb, (IMG_SIZE, IMG_SIZE)).astype(np.float32) / 255.0
        combined = np.concatenate([(rgb - MEAN) / STD, (ela_r - MEAN) / STD], axis=2).transpose(2, 0, 1)[np.newaxis]
        with torch.no_grad():
            p = float(torch.sigmoid(self.model(torch.from_numpy(combined).float().to(self.device))).cpu().item())
        v = "authentic" if p < 0.3 else "suspicious" if p < 0.6 else "tampered"
        return {"p_tampered": round(p, 4), "verdict": v, "model": self.active_model, "version": self.model_version}

    def _detect_heuristic(self, image_bytes):
        arr = np.array(Image.open(io.BytesIO(image_bytes)).convert("RGB"))
        ela = compute_ela(cv2.cvtColor(arr, cv2.COLOR_RGB2BGR))
        score = float(ela.mean()) / 255.0
        v = "authentic" if score < 0.15 else "suspicious" if score < 0.3 else "tampered"
        return {"p_tampered": round(score, 4), "verdict": v, "model": "ela-heuristic", "version": "fallback"}

    def status(self):
        return {"engine": "doc_forensics", "active_model": self.active_model or "ela-heuristic", "version": self.model_version, "gpu": self.model is not None}
