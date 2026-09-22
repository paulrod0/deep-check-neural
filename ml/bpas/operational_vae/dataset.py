"""Dataset for operational-sequence β-VAE.

Each input window is a sequence of ``(app_id, action_type, Δt)`` triples,
representing a user's recent activity (which applications and actions, not
the content of those actions).

Training uses only legitimate sequences — the VAE is a one-class novelty
detector.  Attack patterns are rare in real deployments and collecting them
would risk capturing sensitive details; the reconstruction-loss score is
what we rely on for anomaly detection at inference time.
"""

from __future__ import annotations

import hashlib
import json
import random
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import Dataset


# Unknown / padding tokens for graceful degradation at inference.
APP_UNK = 0
APP_PAD = 1
ACTION_UNK = 0
ACTION_PAD = 1


# Action vocabulary is fixed so that the model can be deployed independently
# of the training corpus composition.
ACTION_VOCAB = [
    "__PAD__",
    "__UNK__",
    "focus_in",
    "focus_out",
    "launch",
    "close",
    "file_read",
    "file_write",
    "file_delete",
    "network_connect",
    "clipboard_copy",
    "clipboard_paste",
    "login",
    "logout",
    "idle_start",
    "idle_end",
    "lock",
    "unlock",
    "privilege_elevation",
    "config_change",
    "shell_command",
]
ACTION_VOCAB_SIZE = len(ACTION_VOCAB)


@dataclass
class OpEvent:
    """A single operational event."""

    app: str
    action: str
    dt_ms: float


class AppVocab:
    """Learnt app-name → integer vocabulary with graceful UNK."""

    def __init__(self, max_size: int = 2048):
        self.max_size = max_size
        self.token2id: dict[str, int] = {"__PAD__": APP_PAD, "__UNK__": APP_UNK}

    def fit(self, apps: list[str]) -> None:
        """Populate from observed apps, keeping the most frequent ``max_size``."""
        counts = Counter(apps)
        most = counts.most_common(self.max_size - len(self.token2id))
        for app, _ in most:
            if app not in self.token2id:
                self.token2id[app] = len(self.token2id)

    def encode(self, app: str) -> int:
        """Map an app to its integer id, falling back to UNK."""
        return self.token2id.get(app, APP_UNK)

    @property
    def size(self) -> int:
        """Current vocabulary size."""
        return len(self.token2id)

    def to_json(self) -> str:
        """Serialisable representation."""
        return json.dumps({"max_size": self.max_size, "token2id": self.token2id})

    @classmethod
    def from_json(cls, text: str) -> "AppVocab":
        """Deserialise from ``to_json`` output."""
        obj = json.loads(text)
        v = cls(max_size=obj["max_size"])
        v.token2id = obj["token2id"]
        return v


class OperationalWindowsDataset(Dataset):
    """Torch Dataset yielding tokenised operational windows."""

    def __init__(
        self,
        sequences: list[list[OpEvent]],
        vocab: AppVocab,
        action_vocab: list[str] = ACTION_VOCAB,
        window_size: int = 100,
    ):
        self.vocab = vocab
        self.action2id = {a: i for i, a in enumerate(action_vocab)}
        self.window_size = window_size
        # Pre-encode everything once so __getitem__ is allocation-free.
        self.app_ids: list[np.ndarray] = []
        self.action_ids: list[np.ndarray] = []
        self.dt_ms: list[np.ndarray] = []
        for seq in sequences:
            app_buf, act_buf, dt_buf = self._encode(seq)
            if len(app_buf) < window_size:
                # Pad short sequences.
                pad = window_size - len(app_buf)
                app_buf = np.concatenate([np.full(pad, APP_PAD, dtype=np.int64), app_buf])
                act_buf = np.concatenate([np.full(pad, ACTION_PAD, dtype=np.int64), act_buf])
                dt_buf = np.concatenate([np.zeros(pad, dtype=np.float32), dt_buf])
            # Sliding windows.
            for i in range(0, len(app_buf) - window_size + 1, window_size // 2):
                self.app_ids.append(app_buf[i : i + window_size])
                self.action_ids.append(act_buf[i : i + window_size])
                self.dt_ms.append(dt_buf[i : i + window_size])

    def _encode(self, events: list[OpEvent]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        app = np.array([self.vocab.encode(e.app) for e in events], dtype=np.int64)
        act = np.array(
            [self.action2id.get(e.action, ACTION_UNK) for e in events],
            dtype=np.int64,
        )
        dt = np.log1p(np.array([max(e.dt_ms, 0.0) for e in events], dtype=np.float32))
        return app, act, dt

    def __len__(self) -> int:
        return len(self.app_ids)

    def __getitem__(self, idx: int) -> dict[str, torch.Tensor]:
        return {
            "app": torch.from_numpy(self.app_ids[idx]),
            "action": torch.from_numpy(self.action_ids[idx]),
            "dt": torch.from_numpy(self.dt_ms[idx]),
        }

    def dataset_hash(self) -> str:
        """Deterministic hash over encoded windows."""
        h = hashlib.sha256()
        for a, b, c in zip(self.app_ids, self.action_ids, self.dt_ms):
            h.update(a.tobytes())
            h.update(b.tobytes())
            h.update(c.tobytes())
        return h.hexdigest()


def load_jsonl_sequences(path: Path) -> list[list[OpEvent]]:
    """Parse a JSONL file where each line is a list of op events.

    Each line has the shape:

        [{"app": "chrome.exe", "action": "focus_in", "dt_ms": 30}, ...]
    """
    sequences: list[list[OpEvent]] = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        raw = json.loads(line)
        events = [
            OpEvent(app=r["app"], action=r["action"], dt_ms=float(r["dt_ms"])) for r in raw
        ]
        sequences.append(events)
    return sequences


def synthesize_corpus(
    n_sequences: int = 1000,
    seq_len: int = 200,
    seed: int = 42,
    anomaly_rate: float = 0.0,
) -> list[list[OpEvent]]:
    """Generate a small synthetic corpus for offline tests.

    Only used when no real corpus is available — do not use for publication
    numbers.
    """
    rng = random.Random(seed)
    apps_normal = ["outlook.exe", "teams.exe", "chrome.exe", "code.exe", "powershell.exe"]
    apps_anomaly = ["unknown-tool.exe", "mimikatz.exe", "cmd.exe"]

    out: list[list[OpEvent]] = []
    for _ in range(n_sequences):
        is_anomalous = rng.random() < anomaly_rate
        apps = apps_anomaly if is_anomalous else apps_normal
        events: list[OpEvent] = []
        for _ in range(seq_len):
            events.append(
                OpEvent(
                    app=rng.choice(apps),
                    action=rng.choice(
                        [
                            "focus_in",
                            "focus_out",
                            "file_read",
                            "file_write",
                            "network_connect",
                        ]
                    ),
                    dt_ms=rng.lognormvariate(4.0, 1.5),
                )
            )
        out.append(events)
    return out
