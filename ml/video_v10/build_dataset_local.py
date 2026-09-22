#!/usr/bin/env python3
"""
Deep-Check V10 Local Dataset Builder.

Builds the V10 dataset from locally-available sources (no YouTube scraping).
Designed for FaceForensics++ structure, with optional modern supplements.

Expected input layout (FF-c23):
  <root>/
    original_sequences/youtube/c23/videos/   # 1000 real videos
    manipulated_sequences/
      Deepfakes/c23/videos/
      Face2Face/c23/videos/
      FaceSwap/c23/videos/
      NeuralTextures/c23/videos/

Output:
  <out>/
    {train,val,test}/
      index.jsonl   # VideoRecord entries
    _clips/
      original/<id>_<frame>.mp4
      deepfakes/<id>_<frame>.mp4
      ...
    data_card.md

Usage:
  python build_dataset_local.py \
    --ff-root ~/v10-data \
    --extra-fakes ~/v10-data/modern/deepfake \
    --extra-reals ~/v10-data/modern/video \
    --out ~/v10-data/video_v10 \
    --clips-per-video 3
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger("v10_local")

TARGET_FPS = 2
TARGET_FRAMES = 16
TARGET_RES = 224


@dataclass
class VideoRecord:
    path: str
    source: str
    label: int
    generator: str = ""
    duration_s: float = 0.0
    fps: float = 0.0
    face_detected: bool = False
    phash: str = ""
    metadata: dict = field(default_factory=dict)


def sha256_file(p: str, chunk: int = 65536) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def video_phash(path: str, n: int = 8) -> str:
    cap = cv2.VideoCapture(path)
    try:
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total <= 0:
            return ""
        idxs = np.linspace(0, total - 1, n, dtype=int)
        bits: list[str] = []
        for i in idxs:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
            ok, frame = cap.read()
            if not ok:
                continue
            gray = cv2.cvtColor(cv2.resize(frame, (9, 8)), cv2.COLOR_BGR2GRAY)
            diff = gray[:, 1:] > gray[:, :-1]
            bits.append("".join("1" if b else "0" for b in diff.flatten()))
        return "|".join(bits)
    finally:
        cap.release()


def extract_face_clips(src: str, out_dir: Path, max_clips: int = 3, clip_len_s: float = 8.0) -> list[str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(src)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total <= 0:
        cap.release()
        return []

    src_hash = hashlib.sha1(Path(src).name.encode()).hexdigest()[:10]
    clip_frames = int(clip_len_s * fps)
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")

    written: list[str] = []
    for start in range(0, max(1, total - clip_frames), clip_frames):
        if len(written) >= max_clips:
            break
        cap.set(cv2.CAP_PROP_POS_FRAMES, start)
        frames = []
        for _ in range(clip_frames):
            ok, frame = cap.read()
            if not ok:
                break
            frames.append(frame)
        if len(frames) < clip_frames * 0.7:
            continue
        mid = frames[len(frames) // 2]
        gray = cv2.cvtColor(mid, cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(gray, 1.1, 4, minSize=(80, 80))
        if len(faces) == 0:
            continue
        x, y, w, h = max(faces, key=lambda b: b[2] * b[3])
        cx, cy = x + w / 2, y + h / 2
        side = int(max(w, h) * 1.6)
        H, W = mid.shape[:2]
        x0 = max(0, int(cx - side / 2)); y0 = max(0, int(cy - side / 2))
        x1 = min(W, x0 + side); y1 = min(H, y0 + side)

        idxs = np.linspace(0, len(frames) - 1, TARGET_FRAMES, dtype=int)
        sampled = [frames[i] for i in idxs]
        crops = [cv2.resize(f[y0:y1, x0:x1], (TARGET_RES, TARGET_RES)) for f in sampled]

        out_path = out_dir / f"{src_hash}_{start:06d}.mp4"
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(out_path), fourcc, TARGET_FPS, (TARGET_RES, TARGET_RES))
        for c in crops:
            writer.write(c)
        writer.release()
        written.append(str(out_path))

    cap.release()
    return written


def scan_ff_structure(ff_root: Path) -> dict[str, list[Path]]:
    """Scan FaceForensics++ layout returning {source: [paths]}.

    Supports both:
      - Standard FF: original_sequences/youtube/c23/videos/ + manipulated_sequences/X/c23/videos/
      - Kaggle flat:  FaceForensics++_C23/{original,Deepfakes,Face2Face,FaceSwap,NeuralTextures,DeepFakeDetection}/
    """
    out = {
        "original": [], "deepfakes": [], "face2face": [],
        "faceswap": [], "neuraltextures": [], "dfd": [],
    }
    kaggle_map = {
        "original": "original",
        "Deepfakes": "deepfakes",
        "Face2Face": "face2face",
        "FaceSwap": "faceswap",
        "NeuralTextures": "neuraltextures",
        "DeepFakeDetection": "dfd",
    }
    standard_map = {
        "Deepfakes": "deepfakes",
        "Face2Face": "face2face",
        "FaceSwap": "faceswap",
        "NeuralTextures": "neuraltextures",
    }

    # A) Try Kaggle flat layout (xdxd003/ff-c23)
    for root_candidate in [ff_root, ff_root / "FaceForensics++_C23",
                           ff_root / "ff-c23", ff_root / "FaceForensics"]:
        if not root_candidate.exists():
            continue
        hits = 0
        for subdir_name, key in kaggle_map.items():
            sd = root_candidate / subdir_name
            if sd.is_dir():
                out[key].extend(sorted(sd.glob("*.mp4")))
                hits += 1
        if hits >= 2:
            logger.info(f"Detected Kaggle FF layout at {root_candidate}")
            return out

    # B) Try standard FF layout
    orig = ff_root / "original_sequences" / "youtube" / "c23" / "videos"
    if orig.exists():
        out["original"].extend(sorted(orig.glob("*.mp4")))
    manip = ff_root / "manipulated_sequences"
    if manip.exists():
        for gen_dir in manip.iterdir():
            key = standard_map.get(gen_dir.name)
            if not key:
                continue
            videos_dir = gen_dir / "c23" / "videos"
            if videos_dir.exists():
                out[key].extend(sorted(videos_dir.glob("*.mp4")))
    if any(out.values()):
        logger.info("Detected standard FF layout")
        return out

    # C) Fallback: recursive search + heuristic assignment by parent dir name
    logger.warning(f"No FF layout detected at {ff_root}. Recursive fallback.")
    for mp4 in ff_root.rglob("*.mp4"):
        parent = mp4.parent.name.lower()
        if "original" in parent or "real" in parent or parent == "youtube":
            out["original"].append(mp4)
        elif "deepfake" in parent:
            out["deepfakes"].append(mp4)
        elif "face2face" in parent:
            out["face2face"].append(mp4)
        elif "faceswap" in parent:
            out["faceswap"].append(mp4)
        elif "neuraltexture" in parent:
            out["neuraltextures"].append(mp4)
        elif "dfd" in parent or "detection" in parent:
            out["dfd"].append(mp4)
    return out


def scan_extra_dir(directory: Path, label: str) -> list[Path]:
    if not directory or not directory.exists():
        return []
    return [p for p in directory.rglob("*.[mM][pPoO][4vV]") if p.is_file()]


def split_records(records: list[VideoRecord], seed: int = 42) -> dict[str, list[VideoRecord]]:
    rng = np.random.default_rng(seed)
    by_key: dict[tuple[str, int], list[VideoRecord]] = {}
    for r in records:
        by_key.setdefault((r.source, r.label), []).append(r)

    train, val, test = [], [], []
    for key, recs in by_key.items():
        rng.shuffle(recs)
        n = len(recs)
        nt = int(n * 0.8)
        nv = int(n * 0.1)
        train.extend(recs[:nt])
        val.extend(recs[nt:nt + nv])
        test.extend(recs[nt + nv:])
    return {"train": train, "val": val, "test": test}


def write_data_card(out_root: Path, splits: dict[str, list[VideoRecord]], version: str):
    lines = [f"# Deep-Check V10 Local Dataset — {version}\n",
             f"Built: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}\n\n",
             "## Counts by split\n"]
    for split, recs in splits.items():
        lines.append(f"\n**{split}**: {len(recs)} clips\n")
        by_label = {}
        by_source = {}
        for r in recs:
            by_label[r.label] = by_label.get(r.label, 0) + 1
            by_source[r.source] = by_source.get(r.source, 0) + 1
        lines.append(f"- Real: {by_label.get(0, 0)}, Fake: {by_label.get(1, 0)}\n")
        for s, n in sorted(by_source.items()):
            lines.append(f"  - {s}: {n}\n")
    (out_root / "data_card.md").write_text("".join(lines))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ff-root", required=True, help="FaceForensics++ root directory")
    ap.add_argument("--extra-fakes", default="", help="Additional fake video directory")
    ap.add_argument("--extra-reals", default="", help="Additional real video directory")
    ap.add_argument("--out", required=True, help="Output dataset root")
    ap.add_argument("--version", default="v10.0")
    ap.add_argument("--clips-per-video", type=int, default=3)
    ap.add_argument("--max-per-source", type=int, default=0,
                    help="Cap videos per source (0 = no cap)")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")

    out_root = Path(args.out)
    clips_dir = out_root / "_clips"
    out_root.mkdir(parents=True, exist_ok=True)

    ff_videos = scan_ff_structure(Path(args.ff_root))
    for k, v in ff_videos.items():
        logger.info(f"FF {k}: {len(v)} videos")

    sources = []
    # (source_name, videos_list, label, generator)
    for src_name, vids in ff_videos.items():
        if not vids:
            continue
        label = 0 if src_name == "original" else 1
        generator = "" if label == 0 else src_name
        if args.max_per_source:
            vids = vids[:args.max_per_source]
        sources.append((f"ff_{src_name}", vids, label, generator))

    if args.extra_fakes:
        extra = scan_extra_dir(Path(args.extra_fakes), "fake")
        if extra:
            sources.append(("extra_fakes", extra, 1, "modern"))
    if args.extra_reals:
        extra = scan_extra_dir(Path(args.extra_reals), "real")
        if extra:
            sources.append(("extra_reals", extra, 0, ""))

    all_records: list[VideoRecord] = []
    for src_name, vids, label, generator in sources:
        src_clips_dir = clips_dir / src_name
        logger.info(f"Processing {src_name}: {len(vids)} videos -> clips")
        for i, video in enumerate(vids):
            if i % 50 == 0:
                logger.info(f"  [{src_name}] {i}/{len(vids)}")
            clips = extract_face_clips(str(video), src_clips_dir, max_clips=args.clips_per_video)
            for c in clips:
                rec = VideoRecord(
                    path=c,
                    source=src_name,
                    label=label,
                    generator=generator,
                )
                rec.phash = video_phash(c)
                rec.face_detected = True
                rec.metadata["orig_video"] = str(video)
                all_records.append(rec)

    logger.info(f"Total clips extracted: {len(all_records)}")

    splits = split_records(all_records)
    for split, recs in splits.items():
        split_dir = out_root / split
        split_dir.mkdir(parents=True, exist_ok=True)
        with (split_dir / "index.jsonl").open("w") as f:
            for r in recs:
                f.write(json.dumps(asdict(r)) + "\n")
        logger.info(f"{split}: {len(recs)}")

    write_data_card(out_root, splits, args.version)
    logger.info(f"OK Dataset {args.version} ready at {out_root}")


if __name__ == "__main__":
    sys.exit(main())
