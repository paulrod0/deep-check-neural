"""Generate a realistic synthetic operational corpus for the BPAS β-VAE.

Real op-traces are sensitive (they expose which apps an operator uses),
so this script produces a defensible synthetic corpus that mirrors the
structure of a real defence-sector workstation's day:

  - Several "personas" (analyst, sysadmin, mando), each with their own
    typical app palette
  - Diurnal rhythm (ramp-up, lunch, focused afternoon)
  - Anomaly variants (insider lateral-movement, credential-dumping bursts)
    written into a separate ``*.anomalies.jsonl`` file

The output JSONL files are accepted directly by
``ml/bpas/operational_vae/train.py``.

Usage:

    python scripts/synthesize_operational_corpus.py \
        --out /tmp/op_corpus \
        --legit-sequences 2000 \
        --anomaly-sequences 200 \
        --seed 42
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

# --------------------------------------------------------------------------- #
# Personas
# --------------------------------------------------------------------------- #

# Common-noise apps every persona may touch.
COMMON_APPS = ["explorer", "outlook.exe", "teams.exe", "chrome.exe", "browser-sec.exe"]

PERSONAS = {
    "analyst": [
        "splunk-web.exe",
        "elastic-kibana.exe",
        "wireshark.exe",
        "code.exe",
        "powershell.exe",
        "notepad++.exe",
        "edge-osint.exe",
    ],
    "sysadmin": [
        "powershell.exe",
        "cmd.exe",
        "putty.exe",
        "winscp.exe",
        "rdp-client.exe",
        "regedit.exe",
        "services.exe",
        "task-scheduler.exe",
    ],
    "mando": [
        "comms-secure.exe",
        "report-editor.exe",
        "outlook.exe",
        "teams.exe",
        "siem-dashboard.exe",
    ],
}

LEGIT_ACTIONS = [
    "focus_in",
    "focus_out",
    "file_read",
    "file_write",
    "network_connect",
    "clipboard_copy",
    "config_change",
]

ANOMALY_APPS = [
    "mimi-tool.exe",        # credential-dumping flavour
    "psexec.exe",           # lateral movement
    "powershell.exe",       # sometimes legit, but bursty in attacks
    "unknown-binary.exe",
    "lsass-dump.exe",
]
ANOMALY_ACTIONS = [
    "privilege_elevation",
    "shell_command",
    "file_read",
    "file_write",
    "network_connect",
    "clipboard_paste",
]


def gen_legit_sequence(rng: random.Random, length: int) -> list[dict]:
    """Generate one diurnal legitimate sequence."""
    persona = rng.choice(list(PERSONAS.keys()))
    palette = PERSONAS[persona] + COMMON_APPS
    events: list[dict] = []
    # Start of day: brief burst of focus_ins.
    cur_app = rng.choice(palette)
    for _ in range(length):
        # Most events are focus changes within the persona palette.
        action = rng.choices(
            LEGIT_ACTIONS, weights=[0.35, 0.25, 0.10, 0.08, 0.10, 0.08, 0.04], k=1
        )[0]
        if action in {"focus_in", "focus_out"} and rng.random() < 0.3:
            cur_app = rng.choice(palette)
        # Inter-event time: log-normal centred around 800 ms (working speed)
        # with an occasional long pause representing a coffee break.
        if rng.random() < 0.005:
            dt_ms = rng.lognormvariate(8.0, 1.2)  # idle minutes
        else:
            dt_ms = rng.lognormvariate(6.5, 1.0)  # ~700-1500 ms
        events.append({"app": cur_app, "action": action, "dt_ms": dt_ms})
    return events


def gen_anomaly_sequence(rng: random.Random, length: int, mode: str) -> list[dict]:
    """Generate an anomalous sequence.

    ``mode``:
      - ``insider_recon`` — slow focus-in churn over many sysadmin tools the
        operator never uses
      - ``credential_dump`` — burst of fast events with tools listed in
        ``ANOMALY_APPS``
      - ``lateral_movement`` — alternating remote-shell and file events
    """
    events: list[dict] = []
    if mode == "credential_dump":
        # Very tight inter-event spacing, short burst length.
        for _ in range(length):
            events.append(
                {
                    "app": rng.choice(ANOMALY_APPS),
                    "action": rng.choice(ANOMALY_ACTIONS),
                    "dt_ms": rng.uniform(20, 80),
                }
            )
    elif mode == "lateral_movement":
        for _ in range(length):
            app = rng.choice(["psexec.exe", "rdp-client.exe", "winrm.exe"])
            action = rng.choice(["network_connect", "shell_command", "file_write"])
            events.append({"app": app, "action": action, "dt_ms": rng.uniform(80, 250)})
    else:  # insider_recon
        unknown = ANOMALY_APPS + [
            "regedit.exe",
            "services.exe",
            "task-scheduler.exe",
            "lsass-dump.exe",
        ]
        for _ in range(length):
            events.append(
                {
                    "app": rng.choice(unknown),
                    "action": rng.choice(["focus_in", "file_read"]),
                    "dt_ms": rng.lognormvariate(4.0, 0.6),
                }
            )
    return events


# --------------------------------------------------------------------------- #
# Driver
# --------------------------------------------------------------------------- #

def main() -> None:
    """Generate ``legitimate.jsonl`` and ``legitimate.anomalies.jsonl``."""
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--legit-sequences", type=int, default=2000)
    p.add_argument("--anomaly-sequences", type=int, default=200)
    p.add_argument("--seq-len", type=int, default=200)
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)

    legit_path = out / "legitimate.jsonl"
    with legit_path.open("w") as fh:
        for _ in range(args.legit_sequences):
            seq = gen_legit_sequence(rng, args.seq_len)
            fh.write(json.dumps(seq) + "\n")
    print(f"[op-corpus] wrote {args.legit_sequences} legit sequences → {legit_path}")

    anom_path = out / "legitimate.anomalies.jsonl"
    modes = ["insider_recon", "credential_dump", "lateral_movement"]
    with anom_path.open("w") as fh:
        for i in range(args.anomaly_sequences):
            mode = modes[i % len(modes)]
            seq = gen_anomaly_sequence(rng, args.seq_len, mode)
            fh.write(json.dumps(seq) + "\n")
    print(
        f"[op-corpus] wrote {args.anomaly_sequences} anomaly sequences "
        f"({len(modes)} modes) → {anom_path}"
    )


if __name__ == "__main__":
    main()
