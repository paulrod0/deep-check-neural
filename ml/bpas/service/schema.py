"""Pydantic schemas for the BPAS worker API."""

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class IngestResult(BaseModel):
    """Response to an ingest call."""

    session_id: str
    events_accepted: int
    events_rejected: int
    dropped_nonces: int = 0
    keystroke_windows: int = 0
    mouse_windows: int = 0
    operational_windows: int = 0


class ModalityScore(BaseModel):
    """Per-modality calibrated probability of legitimacy."""

    name: str
    prob_legit: float = Field(..., ge=0.0, le=1.0)
    raw_logit: Optional[float] = None


class DecisionResult(BaseModel):
    """Response to a decision request."""

    session_id: str
    role: str
    fused_prob: float = Field(..., ge=0.0, le=1.0)
    decision: Literal["legitimate", "impostor", "uncertain"]
    modalities: List[ModalityScore]
    conformal_alpha: float
    conformal_threshold: float
    latency_ms: float
    model_versions: Dict[str, str]


class HealthResult(BaseModel):
    """Response to the health check."""

    status: Literal["ok", "degraded"]
    uptime_s: float
    active_sessions: int
    loaded_models: Dict[str, str]


class ReloadRequest(BaseModel):
    """Request body for the model-reload endpoint."""

    modality: Literal["keystroke", "mouse", "operational", "fusion"]
    weights_path: str
    expected_hash_sha256: Optional[str] = None
