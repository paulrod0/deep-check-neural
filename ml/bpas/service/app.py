"""FastAPI application for the BPAS inference worker.

Endpoints:

    POST  /v1/ingest       Accept a binary batch from a bpas-agent.
    POST  /v1/decide       Force a fresh fused decision for a session.
    GET   /v1/health       Liveness + loaded-model summary.
    POST  /v1/models/reload  Swap in a new weights bundle (admin only).
    GET   /metrics         Prometheus scrape target.

All endpoints emit OpenTelemetry spans with non-sensitive attributes (user
hash, session id, outcome). Raw features never appear in traces.
"""

import os
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

from .decoder import DecodeError, decode_batch
from .runtime import BPASRuntime
from .schema import (
    DecisionResult,
    HealthResult,
    IngestResult,
    ModalityScore,
    ReloadRequest,
)


INGEST_TOTAL = Counter(
    "bpas_ingest_total", "Number of ingest batches", ["outcome"]
)
INGEST_EVENTS = Counter(
    "bpas_ingest_events_total", "Number of events accepted/rejected", ["outcome"]
)
DECIDE_TOTAL = Counter(
    "bpas_decide_total", "Number of decisions emitted", ["outcome", "role"]
)
INGEST_LATENCY = Histogram(
    "bpas_ingest_latency_seconds", "Latency of /v1/ingest", ["outcome"]
)
DECIDE_LATENCY = Histogram(
    "bpas_decide_latency_seconds", "Latency of /v1/decide", ["outcome"]
)


def create_app(runtime: Optional[BPASRuntime] = None) -> FastAPI:
    """Factory so we can instantiate the app with a pre-built runtime in tests."""
    rt = runtime or _runtime_from_env()
    api = FastAPI(title="BPAS Inference Worker", version="1.0.0")
    api.state.runtime = rt

    @api.post("/v1/ingest", response_model=IngestResult)
    async def ingest(
        request: Request,
        x_admin_token: Optional[str] = Header(default=None),  # noqa: ARG001
    ) -> IngestResult:
        """Consume a length-framed binary batch."""
        t0 = time.perf_counter()
        body = await request.body()
        try:
            session_id, events = decode_batch(body, rt.hmac_key)
        except DecodeError as e:
            INGEST_TOTAL.labels(outcome="rejected").inc()
            INGEST_LATENCY.labels(outcome="rejected").observe(time.perf_counter() - t0)
            raise HTTPException(status_code=400, detail=f"decode_error: {e}") from e

        accepted, rejected, dropped = rt.ingest_events(session_id, events)
        INGEST_TOTAL.labels(outcome="ok").inc()
        INGEST_EVENTS.labels(outcome="accepted").inc(accepted)
        INGEST_EVENTS.labels(outcome="rejected").inc(rejected)
        INGEST_LATENCY.labels(outcome="ok").observe(time.perf_counter() - t0)

        # Opportunistic scoring so the client's next /decide call is fast.
        rt.score_all(session_id)

        return IngestResult(
            session_id=session_id.hex(),
            events_accepted=accepted,
            events_rejected=rejected,
            dropped_nonces=dropped,
        )

    @api.post("/v1/decide", response_model=DecisionResult)
    async def decide(
        session_id: str,
        role: str = "general",
    ) -> DecisionResult:
        """Return the current fused decision for a session."""
        t0 = time.perf_counter()
        try:
            session_bytes = bytes.fromhex(session_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail="invalid session_id") from e

        fused, decision, raw_scores, threshold = rt.decide(session_bytes, role)
        latency_ms = (time.perf_counter() - t0) * 1000.0

        DECIDE_TOTAL.labels(outcome=decision, role=role).inc()
        DECIDE_LATENCY.labels(outcome=decision).observe(time.perf_counter() - t0)

        conf = rt.policy.roles.get(role) or rt.policy.roles.get("general")
        alpha = float(conf.alpha) if conf is not None else 1.0

        return DecisionResult(
            session_id=session_id,
            role=role,
            fused_prob=fused,
            decision=decision,  # type: ignore[arg-type]
            modalities=[
                ModalityScore(name=k, prob_legit=v) for k, v in sorted(raw_scores.items())
            ],
            conformal_alpha=alpha,
            conformal_threshold=threshold,
            latency_ms=latency_ms,
            model_versions=rt.loaded_versions(),
        )

    @api.get("/v1/health", response_model=HealthResult)
    async def health() -> HealthResult:
        """Return liveness and loaded-model summary."""
        status = "ok" if rt.models else "degraded"
        return HealthResult(
            status=status,  # type: ignore[arg-type]
            uptime_s=time.time() - rt.start_time,
            active_sessions=len(rt.sessions),
            loaded_models=rt.loaded_versions(),
        )

    @api.post("/v1/models/reload")
    async def reload_model(
        req: ReloadRequest,
        x_admin_token: str = Header(default=""),
    ) -> dict:
        """Swap in a new weights bundle."""
        admin = os.environ.get("BPAS_ADMIN_TOKEN")
        if not admin or x_admin_token != admin:
            raise HTTPException(status_code=403, detail="unauthorized")

        path = Path(req.weights_path)
        if req.modality == "keystroke":
            await rt.load_keystroke(path, req.expected_hash_sha256)
        elif req.modality == "mouse":
            await rt.load_mouse(path, req.expected_hash_sha256)
        elif req.modality == "operational":
            # The vocab file is expected to live next to the weights.
            vocab = path.parent / "app_vocab.json"
            if not vocab.exists():
                raise HTTPException(status_code=400, detail="missing app_vocab.json")
            await rt.load_operational(path, vocab, req.expected_hash_sha256)
        elif req.modality == "fusion":
            await rt.load_fusion(path, req.expected_hash_sha256)
        else:
            raise HTTPException(status_code=400, detail="unknown modality")

        return {"reloaded": req.modality, "versions": rt.loaded_versions()}

    @api.get("/metrics")
    async def metrics() -> Response:
        """Prometheus scrape endpoint."""
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    return api


def _runtime_from_env() -> BPASRuntime:
    """Build the runtime from environment variables on startup."""
    key_path = os.environ.get("BPAS_HMAC_KEY_PATH")
    if key_path and Path(key_path).exists():
        hmac_key = Path(key_path).read_bytes()[:32].ljust(32, b"\x00")
    else:
        hmac_key = b"\x00" * 32
    return BPASRuntime(
        device=os.environ.get("BPAS_DEVICE", "cpu"),
        hmac_key=hmac_key,
        default_role=os.environ.get("BPAS_DEFAULT_ROLE", "general"),
    )


app = create_app()
