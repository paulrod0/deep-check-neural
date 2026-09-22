"""Entrypoint for running the BPAS worker with uvicorn + mTLS."""

from __future__ import annotations

import argparse
import os
from pathlib import Path


def main() -> None:
    """Start uvicorn with optional mTLS parameters from env or CLI."""
    import uvicorn  # imported lazily so tests don't need it

    parser = argparse.ArgumentParser(description="Start the BPAS inference worker")
    parser.add_argument("--host", default=os.environ.get("BPAS_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("BPAS_PORT", "8443")))
    parser.add_argument("--server-cert", default=os.environ.get("BPAS_SERVER_CERT"))
    parser.add_argument("--server-key", default=os.environ.get("BPAS_SERVER_KEY"))
    parser.add_argument("--client-ca", default=os.environ.get("BPAS_CLIENT_CA"))
    parser.add_argument("--workers", type=int, default=int(os.environ.get("BPAS_WORKERS", "1")))
    parser.add_argument(
        "--log-level", default=os.environ.get("BPAS_LOG_LEVEL", "info")
    )
    args = parser.parse_args()

    ssl_kwargs: dict[str, object] = {}
    if args.server_cert and args.server_key:
        if not Path(args.server_cert).exists():
            raise SystemExit(f"server_cert not found: {args.server_cert}")
        if not Path(args.server_key).exists():
            raise SystemExit(f"server_key not found: {args.server_key}")
        ssl_kwargs["ssl_certfile"] = args.server_cert
        ssl_kwargs["ssl_keyfile"] = args.server_key
        if args.client_ca:
            import ssl as _ssl

            ssl_kwargs["ssl_ca_certs"] = args.client_ca
            # CERT_REQUIRED enables the mTLS handshake.
            ssl_kwargs["ssl_cert_reqs"] = _ssl.CERT_REQUIRED  # type: ignore[assignment]

    uvicorn.run(
        "ml.bpas.service.app:app",
        host=args.host,
        port=args.port,
        workers=args.workers,
        log_level=args.log_level,
        **ssl_kwargs,  # type: ignore[arg-type]
    )


if __name__ == "__main__":
    main()
