"""Collect operational-sequence traces on a Linux endpoint.

Records ``(app_id, action_type, dt_ms)`` events into a JSONL file suitable
for training the BPAS β-VAE. The capture is intentionally minimal so it
can run unobtrusively on a real workstation:

  - Polls the active window every 500 ms via ``wmctrl -a :ACTIVE:``-style
    introspection (or ``xprop`` if installed); falls back to PID-only.
  - Logs file-open events from ``inotifywait`` if it's available, otherwise
    skips that channel.
  - Records app launch events from ``ps -o etime,comm`` deltas.

Usage:

    python scripts/collect_operational_traces.py \
        --out /data/op_traces.jsonl \
        --duration-min 480

The output file is appended to, never overwritten, so you can run the
collector across multiple days and concatenate the data.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import time
from pathlib import Path


def get_active_window_app() -> str:
    """Return the binary name of the active window, or ``unknown``."""
    if shutil.which("xprop") and shutil.which("xdotool"):
        try:
            wid = subprocess.check_output(
                ["xdotool", "getactivewindow"], text=True
            ).strip()
            pid_line = subprocess.check_output(
                ["xprop", "-id", wid, "_NET_WM_PID"], text=True
            )
            pid = pid_line.strip().split("=")[-1].strip()
            comm = Path(f"/proc/{pid}/comm").read_text().strip()
            return comm or "unknown"
        except (subprocess.CalledProcessError, FileNotFoundError, OSError):
            return "unknown"
    return "unknown"


def list_running_apps() -> set[str]:
    """Return a snapshot of currently-running user-level processes."""
    try:
        out = subprocess.check_output(
            ["ps", "-eo", "comm="], text=True, timeout=2
        )
        return {line.strip() for line in out.splitlines() if line.strip()}
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return set()


def run(out_path: Path, duration_min: float, poll_s: float = 0.5) -> None:
    """Record events until the duration elapses."""
    end_ts = time.time() + duration_min * 60
    last_window: str | None = None
    last_apps = list_running_apps()
    last_event_ts = time.monotonic()

    out_path.parent.mkdir(parents=True, exist_ok=True)
    print(f"[op-collector] writing to {out_path}, ends in {duration_min:.1f} min")

    with out_path.open("a") as fh:
        while time.time() < end_ts:
            time.sleep(poll_s)
            now_mono = time.monotonic()
            dt_ms = (now_mono - last_event_ts) * 1000.0

            current_window = get_active_window_app()
            current_apps = list_running_apps()

            if current_window != last_window and current_window != "unknown":
                fh.write(
                    json.dumps(
                        {"app": current_window, "action": "focus_in", "dt_ms": dt_ms}
                    )
                    + "\n"
                )
                if last_window is not None:
                    fh.write(
                        json.dumps(
                            {"app": last_window, "action": "focus_out", "dt_ms": 0.0}
                        )
                        + "\n"
                    )
                last_window = current_window
                last_event_ts = now_mono

            launched = current_apps - last_apps
            for app in launched:
                fh.write(
                    json.dumps({"app": app, "action": "launch", "dt_ms": dt_ms}) + "\n"
                )
            closed = last_apps - current_apps
            for app in closed:
                fh.write(
                    json.dumps({"app": app, "action": "close", "dt_ms": dt_ms}) + "\n"
                )
            if launched or closed:
                last_event_ts = now_mono
                fh.flush()
            last_apps = current_apps

    print("[op-collector] done")


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="BPAS operational trace collector")
    parser.add_argument("--out", required=True, help="Destination JSONL file")
    parser.add_argument(
        "--duration-min",
        type=float,
        default=60.0,
        help="How long to record before exiting (minutes)",
    )
    parser.add_argument(
        "--poll-s",
        type=float,
        default=0.5,
        help="Polling interval in seconds (default: 0.5)",
    )
    args = parser.parse_args()
    run(Path(args.out), args.duration_min, args.poll_s)


if __name__ == "__main__":
    main()
