"""Runtime state for the BPAS inference worker.

Holds:
  - A registry of loaded models (keystroke v2, mouse TCN, operational β-VAE,
    fusion ensemble).
  - Per-session sliding buffers for events that haven't yet accumulated a
    full window.
  - A nonce-replay filter per session.
  - A hot-reload primitive: models can be swapped atomically without
    dropping traffic. We swap a pointer under a lock; nothing holds a
    reference to the old model once the new one is published.

Thread-safety: the class is designed to be used by an asyncio event loop.
The only concurrent mutation is model swap, guarded by a lock.
"""

from __future__ import annotations

import asyncio
import hashlib
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import torch

from ..fusion.ensemble import BayesianLogitEnsemble, EnsembleState
from ..fusion.conformal import RolePolicy
from ..mouse_tcn.features import (
    MouseSample,
    build_window as build_mouse_window,
    WINDOW_SIZE as MOUSE_WINDOW_SIZE,
)
from ..mouse_tcn.model import MouseTCN, TCNConfig
from ..operational_vae.dataset import ACTION_VOCAB_SIZE, APP_PAD, AppVocab
from ..operational_vae.model import OperationalVAE, VaeConfig
from .decoder import (
    DecodedEvent,
    KeyEventPayload,
    MouseEventPayload,
    WindowEventPayload,
    decode_key,
    decode_mouse,
    decode_window,
)


KEYSTROKE_WINDOW = 256


@dataclass
class ModelBundle:
    """A loaded model together with its provenance."""

    modality: str
    module: torch.nn.Module
    version: str
    weights_hash: str


@dataclass
class SessionState:
    """Per-session sliding state held in RAM."""

    session_id: bytes
    last_seen_mono_ns: int = 0
    last_nonce: int = 0
    seen_nonces: deque[int] = field(default_factory=lambda: deque(maxlen=100_000))

    # Raw events awaiting windowing.
    keystroke_events: list[tuple[int, KeyEventPayload]] = field(default_factory=list)
    mouse_deltas: list[tuple[int, MouseEventPayload]] = field(default_factory=list)
    window_events: list[tuple[int, WindowEventPayload]] = field(default_factory=list)

    # Per-modality rolling probabilities (most recent N windows).
    scores: dict[str, deque[float]] = field(
        default_factory=lambda: {
            "keystroke": deque(maxlen=64),
            "mouse": deque(maxlen=64),
            "operational": deque(maxlen=64),
        }
    )

    dropped_nonces: int = 0


class BPASRuntime:
    """Stateful runtime used by the FastAPI handlers."""

    def __init__(
        self,
        device: str = "cpu",
        hmac_key: bytes | None = None,
        default_role: str = "general",
    ):
        self.device = device
        self.hmac_key = hmac_key or b"\x00" * 32
        self.models: dict[str, ModelBundle] = {}
        self.sessions: dict[bytes, SessionState] = {}
        self.app_vocab = AppVocab(max_size=2048)
        self.ensemble: BayesianLogitEnsemble | None = None
        self.policy = RolePolicy()
        self.default_role = default_role
        self._lock = asyncio.Lock()
        self.start_time = time.time()

    # --------------------------------------------------------------------- #
    # Model management
    # --------------------------------------------------------------------- #

    async def load_keystroke(self, path: Path, expected_hash: str | None = None) -> None:
        """Load the keystroke Transformer v2 from disk."""
        from ..keystroke_v2.model import KeystrokeV2, KsV2Config

        path, h = _resolve_and_hash(path, expected_hash)
        state = torch.load(path, map_location=self.device)
        model = KeystrokeV2(KsV2Config(max_seq_len=KEYSTROKE_WINDOW))
        model.load_state_dict(state)
        model.train(False)
        async with self._lock:
            self.models["keystroke"] = ModelBundle(
                modality="keystroke", module=model, version="2.0.0", weights_hash=h
            )

    async def load_mouse(self, path: Path, expected_hash: str | None = None) -> None:
        """Load the mouse TCN from disk."""
        path, h = _resolve_and_hash(path, expected_hash)
        state = torch.load(path, map_location=self.device)
        model = MouseTCN(TCNConfig())
        model.load_state_dict(state)
        model.train(False)
        async with self._lock:
            self.models["mouse"] = ModelBundle(
                modality="mouse", module=model, version="1.0.0", weights_hash=h
            )

    async def load_operational(
        self, path: Path, vocab_path: Path, expected_hash: str | None = None
    ) -> None:
        """Load the operational β-VAE and its app vocab."""
        path, h = _resolve_and_hash(path, expected_hash)
        self.app_vocab = AppVocab.from_json(vocab_path.read_text())
        state = torch.load(path, map_location=self.device)
        model = OperationalVAE(
            VaeConfig(app_vocab=self.app_vocab.size, action_vocab=ACTION_VOCAB_SIZE)
        )
        model.load_state_dict(state)
        model.train(False)
        async with self._lock:
            self.models["operational"] = ModelBundle(
                modality="operational", module=model, version="1.0.0", weights_hash=h
            )

    async def load_fusion(self, bundle_path: Path, expected_hash: str | None = None) -> None:
        """Load the Bayesian logit-space ensemble + conformal policy."""
        import json

        bundle_path, h = _resolve_and_hash(bundle_path, expected_hash)
        bundle = json.loads(bundle_path.read_text())
        ensemble = BayesianLogitEnsemble.from_state(EnsembleState(**bundle["ensemble"]))
        policy = RolePolicy()
        for role, conf in bundle["conformal"].items():
            policy.register(
                role,
                1.0 - np.array(conf["calibration_nonconformity"]),
                alpha=float(conf["alpha"]),
            )
        async with self._lock:
            self.ensemble = ensemble
            self.policy = policy
            self.models["fusion"] = ModelBundle(
                modality="fusion", module=None, version="1.0.0", weights_hash=h  # type: ignore[arg-type]
            )

    def loaded_versions(self) -> dict[str, str]:
        """Return a mapping of modality → ``version@hash[:8]``."""
        return {m: f"{b.version}@{b.weights_hash[:8]}" for m, b in self.models.items()}

    # --------------------------------------------------------------------- #
    # Ingestion
    # --------------------------------------------------------------------- #

    def _session(self, session_id: bytes) -> SessionState:
        s = self.sessions.get(session_id)
        if s is None:
            s = SessionState(session_id=session_id)
            self.sessions[session_id] = s
        return s

    def ingest_events(
        self, session_id: bytes, events: list[DecodedEvent]
    ) -> tuple[int, int, int]:
        """Accept decoded events into the session buffers.

        Returns ``(accepted, rejected, dropped_nonces)``. A nonce is rejected
        when it is not strictly greater than the last one we saw, mitigating
        replay.
        """
        s = self._session(session_id)
        accepted = 0
        rejected = 0
        for ev in events:
            if ev.nonce <= s.last_nonce:
                s.dropped_nonces += 1
                rejected += 1
                continue
            s.last_nonce = ev.nonce
            s.last_seen_mono_ns = max(s.last_seen_mono_ns, ev.ts_mono_ns)

            if ev.kind == 1:
                s.keystroke_events.append((ev.ts_mono_ns, decode_key(ev.payload)))
                accepted += 1
            elif ev.kind == 2:
                s.mouse_deltas.append((ev.ts_mono_ns, decode_mouse(ev.payload)))
                accepted += 1
            elif ev.kind == 3:
                s.window_events.append((ev.ts_mono_ns, decode_window(ev.payload)))
                accepted += 1
            else:
                rejected += 1

        # Cap memory per session (defence against D1 flood).
        if len(s.keystroke_events) > 4 * KEYSTROKE_WINDOW:
            s.keystroke_events = s.keystroke_events[-4 * KEYSTROKE_WINDOW :]
        if len(s.mouse_deltas) > 4 * MOUSE_WINDOW_SIZE:
            s.mouse_deltas = s.mouse_deltas[-4 * MOUSE_WINDOW_SIZE :]
        if len(s.window_events) > 500:
            s.window_events = s.window_events[-500:]

        return accepted, rejected, s.dropped_nonces

    # --------------------------------------------------------------------- #
    # Scoring
    # --------------------------------------------------------------------- #

    def _score_keystroke(self, s: SessionState) -> float | None:
        """Score the most recent keystroke window, if enough events."""
        bundle = self.models.get("keystroke")
        if bundle is None or len(s.keystroke_events) < KEYSTROKE_WINDOW // 4:
            return None
        from ..keystroke_v2.features import (
            KeyEvent as KsKeyEvent,
            build_scalar_features,
            digram_log_freq_from_events,
            pack_tokens,
        )

        # We receive down and up events separately from the agent. Rebuild
        # paired events by matching consecutive down/up samples per keycode.
        pending_downs: dict[int, int] = {}
        paired: list[KsKeyEvent] = []
        for ts_ns, ev in s.keystroke_events[-KEYSTROKE_WINDOW * 2 :]:
            ts_ms = ts_ns / 1_000_000
            if ev.pressed:
                pending_downs[ev.keycode] = ts_ms
            else:
                down = pending_downs.pop(ev.keycode, ts_ms - 50)
                paired.append(
                    KsKeyEvent(keycode=ev.keycode, down_ts_ms=down, up_ts_ms=ts_ms)
                )
        if len(paired) < KEYSTROKE_WINDOW // 4:
            return None
        paired = paired[-KEYSTROKE_WINDOW:]
        holds = np.array([e.up_ts_ms - e.down_ts_ms for e in paired])
        digrams = digram_log_freq_from_events(paired)
        scalars = build_scalar_features(
            paired,
            float(holds.mean()) if len(holds) else 0.0,
            float(holds.std()) if len(holds) else 1.0,
            digrams,
        )
        codes = np.array([e.keycode for e in paired], dtype=np.int64)
        kc, sc, mask = pack_tokens(codes, scalars, KEYSTROKE_WINDOW)

        with torch.no_grad():
            out = bundle.module(
                torch.from_numpy(kc).unsqueeze(0).to(self.device),
                torch.from_numpy(sc).unsqueeze(0).to(self.device),
                torch.from_numpy(mask).unsqueeze(0).to(self.device),
            )
        prob_bot = float(torch.sigmoid(out["bot_logit"]).item())
        prob_legit = 1.0 - prob_bot
        s.scores["keystroke"].append(prob_legit)
        return prob_legit

    def _score_mouse(self, s: SessionState) -> float | None:
        """Score the most recent mouse window, if enough samples."""
        bundle = self.models.get("mouse")
        if bundle is None or len(s.mouse_deltas) < MOUSE_WINDOW_SIZE:
            return None
        samples: list[MouseSample] = []
        for _ts, m in s.mouse_deltas[-MOUSE_WINDOW_SIZE * 2 :]:
            if m.subkind == 1:  # Move
                samples.append(MouseSample(dx=m.dx, dy=m.dy, dt_ms=max(m.dt_us / 1000.0, 1e-3)))
        if len(samples) < MOUSE_WINDOW_SIZE:
            return None
        window = build_mouse_window(samples[-MOUSE_WINDOW_SIZE:])
        with torch.no_grad():
            out = bundle.module(torch.from_numpy(window).unsqueeze(0).to(self.device))
        prob_bot = float(torch.sigmoid(out["bot_logit"]).item())
        prob_legit = 1.0 - prob_bot
        s.scores["mouse"].append(prob_legit)
        return prob_legit

    def _score_operational(self, s: SessionState) -> float | None:
        """Score the most recent operational window (novelty inversion)."""
        bundle = self.models.get("operational")
        if bundle is None or len(s.window_events) < 20:
            return None
        app_ids: list[int] = []
        action_ids: list[int] = []
        dt_ms_log: list[float] = []
        prev_ts_ns: int | None = None
        for ts, w in s.window_events[-100:]:
            dt_ms = 0.0 if prev_ts_ns is None else max(0.0, (ts - prev_ts_ns) / 1_000_000.0)
            prev_ts_ns = ts
            tok = w.app_hash[:8].hex()
            app_ids.append(self.app_vocab.encode(tok))
            action_ids.append(2 if w.action == 1 else 3)
            dt_ms_log.append(float(np.log1p(dt_ms)))

        target = 100
        if len(app_ids) < target:
            pad = target - len(app_ids)
            app_ids = [APP_PAD] * pad + app_ids
            action_ids = [1] * pad + action_ids
            dt_ms_log = [0.0] * pad + dt_ms_log
        else:
            app_ids = app_ids[-target:]
            action_ids = action_ids[-target:]
            dt_ms_log = dt_ms_log[-target:]

        app_t = torch.tensor(app_ids, dtype=torch.long).unsqueeze(0).to(self.device)
        act_t = torch.tensor(action_ids, dtype=torch.long).unsqueeze(0).to(self.device)
        dt_t = torch.tensor(dt_ms_log, dtype=torch.float32).unsqueeze(0).to(self.device)
        with torch.no_grad():
            novelty = float(bundle.module.novelty_score(app_t, act_t, dt_t).item())
        prob_legit = float(1.0 / (1.0 + np.exp(novelty - 5.0)))
        s.scores["operational"].append(prob_legit)
        return prob_legit

    def score_all(self, session_id: bytes) -> dict[str, float]:
        """Score every available modality for the session."""
        s = self._session(session_id)
        scores: dict[str, float] = {}
        for name, fn in (
            ("keystroke", self._score_keystroke),
            ("mouse", self._score_mouse),
            ("operational", self._score_operational),
        ):
            v = fn(s)
            if v is not None:
                scores[name] = v
        return scores

    def decide(
        self, session_id: bytes, role: str | None = None
    ) -> tuple[float, str, dict[str, float], float]:
        """Run the fusion ensemble + conformal decision.

        Returns ``(fused_prob, decision, modality_scores, conformal_threshold)``.
        """
        s = self._session(session_id)
        modality_probs: dict[str, np.ndarray] = {}
        raw_scores: dict[str, float] = {}
        for m in ("keystroke", "mouse", "operational"):
            latest = list(s.scores[m])
            if latest:
                val = float(np.mean(latest[-8:]))
                modality_probs[m] = np.array([val])
                raw_scores[m] = val

        if self.ensemble is None or not modality_probs:
            return 0.5, "uncertain", raw_scores, 0.5

        for m in self.ensemble.modalities:
            if m not in modality_probs:
                modality_probs[m] = np.array([0.5])

        fused = float(self.ensemble.predict_proba(modality_probs)[0])
        role_key = role or self.default_role
        decision = self.policy.decide(role_key, fused)
        conf = self.policy.roles.get(role_key) or self.policy.roles.get("general")
        threshold = float(conf.threshold) if conf is not None else 0.5
        return fused, decision, raw_scores, threshold


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _resolve_and_hash(path: Path, expected: str | None) -> tuple[Path, str]:
    """Return ``(resolved_path, sha256)``; raise if hash mismatch."""
    if not path.exists():
        raise FileNotFoundError(path)
    h = hashlib.sha256(path.read_bytes()).hexdigest()
    if expected is not None and expected != h:
        raise ValueError(f"hash mismatch for {path}: expected {expected}, got {h}")
    return path, h
