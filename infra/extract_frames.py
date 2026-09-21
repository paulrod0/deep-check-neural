#!/usr/bin/env python3
"""
extract_frames.py — Video → Face Frames for CNN Training
=========================================================
Reads dataset_config.json, extracts frames from real/fake videos,
crops faces using MediaPipe or OpenCV Haar cascade, saves as JPEG.

Usage:
  python infra/extract_frames.py --config /tmp/deepcheck-datasets/dataset_config.json
  python infra/extract_frames.py --video-dir /path/to/videos --label real --output /path/out

Dependencies:
  pip install opencv-python mediapipe tqdm
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Literal

import cv2
import numpy as np
from tqdm import tqdm

# ── Face detector (MediaPipe preferred, Haar fallback) ────────────────────────

def get_face_detector():
    try:
        import mediapipe as mp
        mp_face = mp.solutions.face_detection
        detector = mp_face.FaceDetection(model_selection=1, min_detection_confidence=0.5)
        def detect(frame_rgb):
            result = detector.process(frame_rgb)
            if not result.detections:
                return []
            h, w = frame_rgb.shape[:2]
            boxes = []
            for det in result.detections:
                bbox = det.location_data.relative_bounding_box
                x1 = int(bbox.xmin * w)
                y1 = int(bbox.ymin * h)
                x2 = x1 + int(bbox.width * w)
                y2 = y1 + int(bbox.height * h)
                boxes.append((x1, y1, x2, y2))
            return boxes
        print("✅ Using MediaPipe face detector")
        return detect
    except ImportError:
        pass

    # Fallback: OpenCV Haar
    haar = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    def detect_haar(frame_rgb):
        gray = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2GRAY)
        faces = haar.detectMultiScale(gray, 1.1, 4, minSize=(60, 60))
        return [(x, y, x+w, y+h) for x, y, w, h in faces] if len(faces) else []
    print("⚠️  MediaPipe not found — using Haar cascade (less accurate)")
    return detect_haar


def crop_face(frame, box, margin=0.4):
    """Crop face with margin and return square patch."""
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = box
    bw, bh = x2 - x1, y2 - y1
    mx, my = int(bw * margin), int(bh * margin)
    x1 = max(0, x1 - mx)
    y1 = max(0, y1 - my)
    x2 = min(w, x2 + mx)
    y2 = min(h, y2 + my)
    crop = frame[y1:y2, x1:x2]
    # Make square
    side = max(crop.shape[:2])
    sq = np.zeros((side, side, 3), dtype=np.uint8)
    sy = (side - crop.shape[0]) // 2
    sx = (side - crop.shape[1]) // 2
    sq[sy:sy+crop.shape[0], sx:sx+crop.shape[1]] = crop
    return cv2.resize(sq, (224, 224), interpolation=cv2.INTER_LANCZOS4)


def extract_video(video_path: Path, output_dir: Path, label: str,
                  detect_fn, frames_per_video=30, max_frames=300):
    """Extract face crops from a single video file."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return 0

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    step  = max(1, total // frames_per_video)

    saved = 0
    frame_idx = 0
    while saved < frames_per_video and frame_idx < min(total, max_frames * step):
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret:
            break

        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        boxes = detect_fn(frame_rgb)

        if boxes:
            face_crop = crop_face(frame_rgb, boxes[0])
            stem = video_path.stem
            out_path = output_dir / f"{stem}_f{frame_idx:06d}.jpg"
            cv2.imwrite(str(out_path), cv2.cvtColor(face_crop, cv2.COLOR_RGB2BGR),
                        [cv2.IMWRITE_JPEG_QUALITY, 95])
            saved += 1

        frame_idx += step

    cap.release()
    return saved


def process_directory(video_dir: Path, output_dir: Path, label: str,
                      detect_fn, frames_per_video=30, max_frames=300):
    """Extract frames from all videos in a directory."""
    output_dir.mkdir(parents=True, exist_ok=True)

    exts = {'.mp4', '.avi', '.mov', '.mkv', '.webm'}
    videos = [f for f in video_dir.rglob('*') if f.suffix.lower() in exts]
    print(f"\n📂 {label}: {len(videos)} videos → {output_dir}")

    total_frames = 0
    for v in tqdm(videos, desc=f"Extracting {label}"):
        n = extract_video(v, output_dir, label, detect_fn,
                          frames_per_video, max_frames)
        total_frames += n

    print(f"   Saved {total_frames:,} face crops")
    return total_frames


def main():
    parser = argparse.ArgumentParser(description="Extract face frames for CNN training")
    parser.add_argument('--config',     type=str, help="Path to dataset_config.json")
    parser.add_argument('--video-dir',  type=str, help="Single video directory (use with --label)")
    parser.add_argument('--label',      type=str, choices=['real', 'fake'])
    parser.add_argument('--output',     type=str, default='/tmp/frames_out')
    parser.add_argument('--frames',     type=int, default=30, help="Frames per video")
    parser.add_argument('--max-frames', type=int, default=300)
    args = parser.parse_args()

    detect_fn = get_face_detector()

    if args.config:
        config = json.loads(Path(args.config).read_text())
        datasets = config.get('datasets', {})
        frame_cfg = config.get('frame_extraction', {})
        fps    = frame_cfg.get('frames_per_video', 30)
        maxf   = frame_cfg.get('max_frames', 300)

        for name, ds in datasets.items():
            if not ds.get('enabled', False):
                print(f"⏭  Skipping {name} (disabled in config)")
                continue
            if ds.get('format') == 'video':
                real_dir = Path(ds.get('real_dir', ''))
                fake_dir = Path(ds.get('fake_dir', ds.get('video_dir', '')))
                out_base = Path(args.output) / name
                if real_dir.exists():
                    process_directory(real_dir, out_base / 'real', 'real', detect_fn, fps, maxf)
                if fake_dir.exists():
                    process_directory(fake_dir, out_base / 'fake', 'fake', detect_fn, fps, maxf)
            elif ds.get('format') == 'image':
                print(f"📦 {name}: Image dataset — copy/symlink directly to training dir")

    elif args.video_dir and args.label:
        process_directory(
            Path(args.video_dir), Path(args.output) / args.label,
            args.label, detect_fn, args.frames, args.max_frames
        )
    else:
        parser.print_help()
        sys.exit(1)

    print("\n✅ Frame extraction complete.")
    print("Next: python infra/train_docforensics_v5.py --data-dir /your/frames/dir")


if __name__ == '__main__':
    main()
