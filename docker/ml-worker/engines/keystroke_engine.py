"""Keystroke biometrics: user verification + bot detection."""
import os, json, logging
from pathlib import Path
import numpy as np

logger = logging.getLogger(__name__)
MODEL_DIR = Path(os.getenv("MODEL_DIR", "/app/models"))

class KeystrokeEngine:
    def __init__(self):
        self.model = None; self.active_model = None; self.device = "cpu"; self.user_profiles = {}
        self._load_model()

    def _load_model(self):
        path = MODEL_DIR / "keystroke" / "best_keystroke.pt"
        if not path.exists(): logger.warning("No keystroke model"); return
        try:
            import torch, torch.nn as nn, torch.nn.functional as F
            device = "cuda" if torch.cuda.is_available() else "cpu"
            ckpt = torch.load(path, map_location=device, weights_only=False)
            cfg = ckpt.get("config", {})
            class KST(nn.Module):
                def __init__(s, inp=3, hid=256, heads=8, layers=4, emb=128):
                    super().__init__(); s.proj = nn.Linear(inp, hid); s.pe = nn.Parameter(torch.randn(1, 200, hid) * 0.02)
                    el = nn.TransformerEncoderLayer(d_model=hid, nhead=heads, dim_feedforward=hid*4, dropout=0.1, activation="gelu", batch_first=True)
                    s.tf = nn.TransformerEncoder(el, num_layers=layers); s.emb_head = nn.Sequential(nn.LayerNorm(hid), nn.Linear(hid, emb))
                    s.stats_proj = nn.Linear(12, 32); s.bot_head = nn.Sequential(nn.Linear(emb + 32, 64), nn.GELU(), nn.Linear(64, 1))
                def forward(s, x):
                    B, S, _ = x.shape; h = s.proj(x) + s.pe[:, :S, :]; h = s.tf(h); p = h.mean(dim=1)
                    emb = F.normalize(s.emb_head(p), dim=1); st = s._stats(x); sf = s.stats_proj(st)
                    return emb, s.bot_head(torch.cat([emb, sf], dim=1)).squeeze(-1)
                def _stats(s, x):
                    h = x[:,:,0]; f = x[:,:,1]
                    return torch.cat([h.mean(1,keepdim=True), h.std(1,keepdim=True), f.mean(1,keepdim=True), f.std(1,keepdim=True),
                        h.min(1,keepdim=True).values, h.max(1,keepdim=True).values, f.min(1,keepdim=True).values, f.max(1,keepdim=True).values,
                        (h<0.024).float().mean(1,keepdim=True), (f<0.024).float().mean(1,keepdim=True),
                        h.std(1,keepdim=True)/(h.mean(1,keepdim=True)+1e-6), f.std(1,keepdim=True)/(f.mean(1,keepdim=True)+1e-6)], dim=1)
            model = KST(inp=cfg.get("input_dim",3), hid=cfg.get("hidden",256), heads=cfg.get("heads",8), layers=cfg.get("layers",4), emb=cfg.get("embed_dim",128)).to(device)
            model.load_state_dict(ckpt["model_state"], strict=False); model.eval()
            self.model = model; self.device = device; self.active_model = "keystroke-transformer"
            logger.info(f"Keystroke loaded on {device}")
        except Exception as e: logger.warning(f"Keystroke load failed: {e}")
        pp = MODEL_DIR / "keystroke" / "user_profiles.json"
        if pp.exists(): self.user_profiles = json.loads(pp.read_text()); logger.info(f"Loaded {len(self.user_profiles)} profiles")

    def reload(self): self.model = None; self.active_model = None; self._load_model()

    def verify(self, keystrokes, user_id=None):
        if self.model is None: return {"error": "No model", "is_bot": False, "bot_score": 0.0}
        import torch
        t = self._tensor(keystrokes)
        with torch.no_grad():
            emb, bot = self.model(t.to(self.device))
            embedding = emb.cpu().numpy()[0].tolist(); bot_score = float(torch.sigmoid(bot).cpu().item())
        result = {"embedding": embedding, "bot_score": round(bot_score, 4), "is_bot": bot_score > 0.5, "model": self.active_model}
        if user_id and user_id in self.user_profiles:
            stored = np.array(self.user_profiles[user_id]); current = np.array(embedding)
            sim = float(np.dot(stored, current) / (np.linalg.norm(stored) * np.linalg.norm(current) + 1e-8))
            result["similarity"] = round(sim, 4); result["verified"] = sim > 0.7
        return result

    def enroll(self, keystrokes, user_id):
        if self.model is None: return {"error": "No model"}
        import torch
        with torch.no_grad():
            emb, _ = self.model(self._tensor(keystrokes).to(self.device))
            embedding = emb.cpu().numpy()[0].tolist()
        self.user_profiles[user_id] = embedding
        pp = MODEL_DIR / "keystroke" / "user_profiles.json"; pp.parent.mkdir(parents=True, exist_ok=True)
        pp.write_text(json.dumps(self.user_profiles))
        return {"user_id": user_id, "enrolled": True, "embedding_dim": len(embedding)}

    def _tensor(self, keystrokes):
        import torch
        seq = []
        for ks in keystrokes[:50]:
            h = min(float(ks.get("hold_time", ks.get("hold", 0))) / 500.0, 2.0)
            f = min(float(ks.get("flight_time", ks.get("flight", 0))) / 500.0, 2.0)
            c = min(float(ks.get("key_category", ks.get("cat", 0))) / 5.0, 1.0)
            seq.append([h, f, c])
        while len(seq) < 50: seq.append([0.0, 0.0, 0.0])
        return torch.tensor([seq], dtype=torch.float32)

    def status(self):
        return {"engine": "keystroke", "active_model": self.active_model or "none", "enrolled_users": len(self.user_profiles), "gpu": self.model is not None}
