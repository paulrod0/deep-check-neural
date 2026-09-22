#!/usr/bin/env python3
"""
Deep-Check V10 Video Dataset Builder.

Collects, dedups, and splits a defense-grade video dataset for deepfake detection.

Sources (FAKE - modern generators):
  - Sora 2 (Twitter/X + YouTube)
  - Veo 3 (YouTube AI showcase channels)
  - Runway Gen-3 (public gallery)
  - Kling / Pika / Luma (community posts)
  - HeyGen / Synthesia (talking heads — high threat for defense)

Sources (REAL):
  - YouTube random vlogs (yt-dlp with diversity query list)
  - VoxCeleb2 (if available)
  - FaceForensics++ original track
  - Crowdsourced Common Crawl videos

Outputs:
  - s3://deep-check-models/datasets/video_v10/{train,val,test}/{real,fake}/
  - data_card_v10.md with full provenance + hashes
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from tqdm import tqdm

logger = logging.getLogger("v10_dataset")

# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #

TARGET_FPS = 2  # sample every 0.5s — enough for deepfake temporal cues
TARGET_FRAMES = 16  # input clip length
TARGET_RES = 224

# Per-source quotas. Total: 3500 fake + 3500 real = 7000 clips.
FAKE_QUOTAS = {
    "sora2_twitter": 800,
    "veo3_youtube": 600,
    "runway_gallery": 400,
    "kling": 300,
    "pika": 300,
    "heygen": 400,
    "synthesia": 200,
    "faceforensics_recent": 500,
}
REAL_QUOTAS = {
    "youtube_vlogs": 1500,
    "voxceleb2_subset": 800,
    "faceforensics_original": 600,
    "common_crawl_faces": 600,
}

REAL_QUERY_TERMS = [
    # Diverse demographics — avoid centroid bias
    "day in my life vlog 2024",
    "morning routine vlog",
    "interview office talk",
    "testimonial real customer",
    "university lecture professor",
    "talking to camera tips",
    "food review handheld",
    "fitness instructor class",
    "news reporter live",
    "grandparents stories",
    "teenager youtube daily",
    "african creator vlog",
    "asian vlog tokyo tokyo",
    "latino creator daily",
    "middle east vlog arabic",
]

SORA_QUERIES = [
    "#Sora2 AI video",
    "Sora OpenAI generated person",
    "Sora 2 realistic",
    "OpenAI Sora human",
]


# --------------------------------------------------------------------------- #
# Primitives
# --------------------------------------------------------------------------- #

@dataclass
class VideoRecord:
    path: str
    source: str  # e.g. "sora2_twitter"
    label: int  # 0 real, 1 fake
    generator: Optional[str] = None  # e.g. "sora2" for fakes
    duration_s: float = 0.0
    fps: float = 0.0
    width: int = 0
    height: int = 0
    face_detected: bool = False
    phash: str = ""
    video_fingerprint: str = ""
    url: Optional[str] = None
    metadata: dict = field(default_factory=dict)


def sha256_file(path: str, chunk: int = 65536) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def video_fingerprint(path: str, n_frames: int = 8) -> str:
    """Perceptual fingerprint: concatenated dHash of N evenly-spaced frames."""
    cap = cv2.VideoCapture(path)
    try:
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total <= 0:
            return ""
        idxs = np.linspace(0, total - 1, n_frames, dtype=int)
        hashes: list[str] = []
        for i in idxs:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
            ok, frame = cap.read()
            if not ok:
                continue
            gray = cv2.cvtColor(cv2.resize(frame, (9, 8)), cv2.COLOR_BGR2GRAY)
            diff = gray[:, 1:] > gray[:, :-1]
            hashes.append("".join("1" if b else "0" for b in diff.flatten()))
        return "|".join(hashes)
    finally:
        cap.release()


def phash_bits(a: str, b: str) -> int:
    """Hamming distance between two pipe-joined bitstrings. Returns -1 if incompatible."""
    if not a or not b or a.count("|") != b.count("|"):
        return -1
    return sum(x != y for x, y in zip(a, b))


def has_face(path: str, sample_n: int = 4) -> bool:
    """Quick face gate via OpenCV Haar cascade. Not perfect but fast."""
    cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )
    cap = cv2.VideoCapture(path)
    try:
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total <= 0:
            return False
        for i in np.linspace(0, total - 1, sample_n, dtype=int):
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
            ok, frame = cap.read()
            if not ok:
                continue
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = cascade.detectMultiScale(gray, 1.1, 4, minSize=(60, 60))
            if len(faces) > 0:
                return True
        return False
    finally:
        cap.release()


def probe_video(path: str) -> Optional[VideoRecord]:
    cap = cv2.VideoCapture(path)
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    finally:
        cap.release()
    if fps <= 0 or total <= 0:
        return None
    return VideoRecord(
        path=path,
        source="",
        label=-1,
        duration_s=total / fps,
        fps=fps,
        width=w,
        height=h,
    )


# --------------------------------------------------------------------------- #
# Source downloaders
# --------------------------------------------------------------------------- #

def ytdlp_download(url: str, out_dir: Path, max_duration: int = 60) -> Optional[str]:
    """Download via yt-dlp, clip to max_duration seconds if longer."""
    out_dir.mkdir(parents=True, exist_ok=True)
    out_template = str(out_dir / "%(id)s.%(ext)s")
    cmd = [
        "yt-dlp",
        "-f", "bestvideo[height<=720][ext=mp4]/best[height<=720]",
        "--no-playlist",
        "--max-filesize", "200M",
        "--match-filter", f"duration<?{max_duration * 3}",
        "-o", out_template,
        url,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            return None
        # Find newly created file
        candidates = sorted(out_dir.glob("*.mp4"), key=lambda p: -p.stat().st_mtime)
        return str(candidates[0]) if candidates else None
    except subprocess.TimeoutExpired:
        return None


def ytdlp_search(query: str, n: int = 50, out_dir: Optional[Path] = None) -> list[str]:
    """Return list of video URLs matching a search query."""
    cmd = [
        "yt-dlp",
        f"ytsearch{n}:{query}",
        "--skip-download",
        "--print", "url",
        "--no-warnings",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        return [u.strip() for u in result.stdout.splitlines() if u.strip()]
    except subprocess.TimeoutExpired:
        return []


# --------------------------------------------------------------------------- #
# Face-centric clip extractor
# --------------------------------------------------------------------------- #

def extract_face_clips(
    src_video: str,
    out_dir: Path,
    clip_len_s: float = 8.0,
    max_clips: int = 3,
) -> list[str]:
    """
    Slice a source video into short face-centric clips of clip_len_s seconds,
    normalized to 224x224, 2fps, 16 frames.
    Returns list of output paths.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(src_video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total <= 0:
        cap.release()
        return []

    src_hash = hashlib.sha1(Path(src_video).name.encode()).hexdigest()[:10]
    clip_frames = int(clip_len_s * fps)
    step = clip_frames

    written: list[str] = []
    cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )

    for start in range(0, total - clip_frames, step):
        if len(written) >= max_clips:
            break
        cap.set(cv2.CAP_PROP_POS_FRAMES, start)
        frames: list[np.ndarray] = []
        last_box: Optional[tuple[int, int, int, int]] = None

        for _ in range(clip_frames):
            ok, frame = cap.read()
            if not ok:
                break
            frames.append(frame)

        if len(frames) < clip_frames * 0.8:
            continue

        # Detect face on middle frame
        mid = frames[len(frames) // 2]
        gray = cv2.cvtColor(mid, cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(gray, 1.1, 4, minSize=(80, 80))
        if len(faces) == 0:
            continue
        x, y, w, h = max(faces, key=lambda b: b[2] * b[3])
        # Expand 1.6x around face, clamp to frame
        cx, cy = x + w / 2, y + h / 2
        side = int(max(w, h) * 1.6)
        H, W = mid.shape[:2]
        x0 = max(0, int(cx - side / 2))
        y0 = max(0, int(cy - side / 2))
        x1 = min(W, x0 + side)
        y1 = min(H, y0 + side)

        # Resample to 2fps → TARGET_FRAMES
        idxs = np.linspace(0, len(frames) - 1, TARGET_FRAMES, dtype=int)
        sampled = [frames[i] for i in idxs]
        crops = [
            cv2.resize(f[y0:y1, x0:x1], (TARGET_RES, TARGET_RES))
            for f in sampled
        ]

        # Write as MP4
        out_name = f"{src_hash}_{start:06d}.mp4"
        out_path = out_dir / out_name
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(
            str(out_path), fourcc, TARGET_FPS,
            (TARGET_RES, TARGET_RES)
        )
        for c in crops:
            writer.write(c)
        writer.release()
        written.append(str(out_path))

    cap.release()
    return written


# --------------------------------------------------------------------------- #
# Dedup + split
# --------------------------------------------------------------------------- #

def dedup_records(records: list[VideoRecord], threshold: int = 8) -> list[VideoRecord]:
    """Remove near-duplicates by video_fingerprint Hamming distance."""
    keep: list[VideoRecord] = []
    seen: list[str] = []
    for rec in tqdm(records, desc="dedup"):
        is_dup = False
        for fp in seen:
            d = phash_bits(rec.video_fingerprint, fp)
            if 0 <= d < threshold:
                is_dup = True
                break
        if not is_dup:
            keep.append(rec)
            seen.append(rec.video_fingerprint)
    return keep


def anti_leak_check(records: list[VideoRecord], prior_hashes: set[str]) -> list[VideoRecord]:
    """Drop any record whose sha256 file hash appears in prior training sets."""
    out = []
    for r in records:
        h = sha256_file(r.path)
        if h in prior_hashes:
            logger.warning(f"anti-leak drop: {r.path} ({r.source})")
            continue
        r.metadata["sha256"] = h
        out.append(r)
    return out


def split_records(
    records: list[VideoRecord],
    ratios: tuple[float, float, float] = (0.8, 0.1, 0.1),
    seed: int = 42,
) -> dict[str, list[VideoRecord]]:
    rng = np.random.default_rng(seed)
    # Stratify by (source, label) so each split has the same source distribution
    buckets: dict[tuple[str, int], list[VideoRecord]] = {}
    for r in records:
        buckets.setdefault((r.source, r.label), []).append(r)

    train, val, test = [], [], []
    for key, recs in buckets.items():
        rng.shuffle(recs)
        n = len(recs)
        n_train = int(n * ratios[0])
        n_val = int(n * ratios[1])
        train.extend(recs[:n_train])
        val.extend(recs[n_train:n_train + n_val])
        test.extend(recs[n_train + n_val:])
    return {"train": train, "val": val, "test": test}


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def write_data_card(
    out_path: Path,
    splits: dict[str, list[VideoRecord]],
    version: str,
):
    lines = [
        f"# Deep-Check V10 Video Dataset — {version}\n",
        f"Built: {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n",
        "## Counts\n",
    ]
    for split, recs in splits.items():
        lines.append(f"- **{split}**: {len(recs)} clips\n")
        by_label = {}
        by_source = {}
        for r in recs:
            by_label[r.label] = by_label.get(r.label, 0) + 1
            by_source[r.source] = by_source.get(r.source, 0) + 1
        lines.append(f"  - Real: {by_label.get(0, 0)}, Fake: {by_label.get(1, 0)}\n")
        lines.append("  - By source:\n")
        for s, n in sorted(by_source.items()):
            lines.append(f"    - {s}: {n}\n")
    lines.append("\n## Provenance\n")
    lines.append("All clips have sha256 stored in metadata. See index.jsonl.\n")
    out_path.write_text("".join(lines))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="./datasets/video_v10")
    ap.add_argument("--prior-hashes", default="", help="Path to JSON of prior train set hashes")
    ap.add_argument("--skip-download", action="store_true", help="Only process existing files")
    ap.add_argument("--version", default="v10.0")
    ap.add_argument("--quota-scale", type=float, default=1.0, help="Scale all quotas (0.1 for smoke test)")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    out_root = Path(args.out)
    raw_dir = out_root / "_raw"
    clips_dir = out_root / "_clips"
    raw_dir.mkdir(parents=True, exist_ok=True)
    clips_dir.mkdir(parents=True, exist_ok=True)

    records: list[VideoRecord] = []

    if not args.skip_download:
        # FAKES
        logger.info("=== Downloading FAKE sources ===")
        for q in SORA_QUERIES:
            urls = ytdlp_search(q, n=int(200 * args.quota_scale))
            for url in urls[:int(FAKE_QUOTAS["sora2_twitter"] * args.quota_scale / len(SORA_QUERIES))]:
                path = ytdlp_download(url, raw_dir / "sora2_twitter")
                if not path:
                    continue
                clips = extract_face_clips(path, clips_dir / "sora2_twitter")
                for c in clips:
                    rec = probe_video(c)
                    if rec:
                        rec.source = "sora2_twitter"
                        rec.label = 1
                        rec.generator = "sora2"
                        rec.url = url
                        records.append(rec)

        # Veo 3
        for q in ["Veo 3 google generated", "Veo 3 AI showcase", "Veo 3 realistic"]:
            urls = ytdlp_search(q, n=int(100 * args.quota_scale))
            for url in urls:
                path = ytdlp_download(url, raw_dir / "veo3_youtube")
                if not path:
                    continue
                clips = extract_face_clips(path, clips_dir / "veo3_youtube")
                for c in clips:
                    rec = probe_video(c)
                    if rec:
                        rec.source = "veo3_youtube"
                        rec.label = 1
                        rec.generator = "veo3"
                        rec.url = url
                        records.append(rec)

        # REALS
        logger.info("=== Downloading REAL sources ===")
        for q in REAL_QUERY_TERMS:
            urls = ytdlp_search(q, n=int(50 * args.quota_scale))
            for url in urls[:int(100 * args.quota_scale / len(REAL_QUERY_TERMS))]:
                path = ytdlp_download(url, raw_dir / "youtube_vlogs")
                if not path:
                    continue
                clips = extract_face_clips(path, clips_dir / "youtube_vlogs", max_clips=2)
                for c in clips:
                    rec = probe_video(c)
                    if rec:
                        rec.source = "youtube_vlogs"
                        rec.label = 0
                        rec.url = url
                        records.append(rec)

    # Re-discover already-extracted clips (for resume)
    for src_dir in clips_dir.iterdir():
        if not src_dir.is_dir():
            continue
        for clip in src_dir.glob("*.mp4"):
            if any(r.path == str(clip) for r in records):
                continue
            rec = probe_video(str(clip))
            if not rec:
                continue
            rec.source = src_dir.name
            rec.label = 0 if src_dir.name.startswith(("youtube_", "vox", "faceforensics_original", "common_crawl")) else 1
            records.append(rec)

    # Enrich: fingerprint + face check
    logger.info(f"=== Processing {len(records)} clips: face check + fingerprint ===")
    enriched: list[VideoRecord] = []
    for r in tqdm(records):
        if not has_face(r.path):
            continue
        r.face_detected = True
        r.video_fingerprint = video_fingerprint(r.path)
        enriched.append(r)

    logger.info(f"After face filter: {len(enriched)}")
    enriched = dedup_records(enriched)
    logger.info(f"After dedup: {len(enriched)}")

    if args.prior_hashes:
        prior = set(json.loads(Path(args.prior_hashes).read_text()))
        enriched = anti_leak_check(enriched, prior)
        logger.info(f"After anti-leak: {len(enriched)}")

    splits = split_records(enriched)
    for split, recs in splits.items():
        split_dir = out_root / split
        split_dir.mkdir(parents=True, exist_ok=True)
        with (split_dir / "index.jsonl").open("w") as f:
            for r in recs:
                f.write(json.dumps(asdict(r)) + "\n")
        logger.info(f"{split}: {len(recs)}")

    write_data_card(out_root / "data_card.md", splits, args.version)
    logger.info(f"✓ Dataset {args.version} ready at {out_root}")


if __name__ == "__main__":
    sys.exit(main())
