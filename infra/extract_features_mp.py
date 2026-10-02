#!/usr/bin/env python3
"""
Deep-Check — MediaPipe Batch Feature Extractor
===============================================
Extracts MediaPipe FaceLandmarker blendshapes from video files for training.

Usage:
  python extract_features_mp.py \
    --real-dir   ./data/videos/real \
    --fake-dir   ./data/videos/fake \
    --photo-dir  ./data/videos/photo \
    --output-dir ./data/features \
    --workers 8

Input:  directories of .mp4 / .avi / .mov video files
Output: ./data/features/{real,fake,photo}/videoname.npz
  Each .npz contains:
    features  — (num_frames, 59): 52 blendshapes + 4 iris + 3 depth
    fps       — original video fps

Dataset layout expected:
  data/videos/real/    <- VoxCeleb2 test clips of real faces
  data/videos/fake/    <- FaceForensics++ c23 / DFDC / CelebDF-v2
  data/videos/photo/   <- static face photos played back on screen

Requirements:
  pip install mediapipe opencv-python-headless tqdm

Veritas Engine v2 — Deep-Check
"""

import os
import sys
import argparse
import numpy as np
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed

try:
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mp_tasks
    from mediapipe.tasks.python import vision as mp_vision
    from tqdm import tqdm
except ImportError as e:
    print(f"ERROR: {e}")
    print("Install: pip install mediapipe opencv-python-headless tqdm")
    sys.exit(1)

# ─── Config ───────────────────────────────────────────────────────────────────

N_BLENDSHAPES = 52
MP_MODEL_URL  = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
MP_MODEL_PATH = '/tmp/face_landmarker.task'

# Standard MediaPipe blendshape order
BLENDSHAPE_ORDER = [
    '_neutral', 'browDownLeft', 'browDownRight', 'browInnerUp',
    'browOuterUpLeft', 'browOuterUpRight', 'cheekPuff', 'cheekSquintLeft',
    'cheekSquintRight', 'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft',
    'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft',
    'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft',
    'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight', 'jawForward',
    'jawLeft', 'jawOpen', 'jawRight', 'mouthClose',
    'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight',
    'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight',
    'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight',
    'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
    'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight',
    'mouthUpperUpLeft', 'mouthUpperUpRight', 'noseSneerLeft', 'noseSneerRight',
]

# ─── Download model ────────────────────────────────────────────────────────────

def ensure_model():
    if not os.path.exists(MP_MODEL_PATH):
        print(f"[setup] Downloading MediaPipe face_landmarker.task...")
        import urllib.request
        urllib.request.urlretrieve(MP_MODEL_URL, MP_MODEL_PATH)
        print(f"[setup] Saved to {MP_MODEL_PATH}")
    return MP_MODEL_PATH


# ─── Feature extraction ────────────────────────────────────────────────────────

def extract_video(video_path: str, model_path: str) -> np.ndarray | None:
    """
    Extract (num_valid_frames, 59) feature array from a video file.
    Returns None if no face detected in >50% of frames.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return None

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    # Create FaceLandmarker (IMAGE mode for batch processing)
    base_opts = mp_tasks.BaseOptions(model_asset_path=model_path)
    opts = mp_vision.FaceLandmarkerOptions(
        base_options=base_opts,
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=False,
        running_mode=mp_vision.RunningMode.IMAGE,
        num_faces=1,
    )
    landmarker = mp_vision.FaceLandmarker.create_from_options(opts)

    features = []
    face_detected = 0
    total_frames  = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        total_frames += 1
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        result = landmarker.detect(mp_image)

        if not result.face_landmarks or not result.face_blendshapes:
            features.append(np.zeros(59, dtype=np.float32))
            continue

        face_detected += 1
        lm = result.face_landmarks[0]      # list of NormalizedLandmark
        bs = result.face_blendshapes[0]    # list of Classification

        # 52 blendshapes in standard order
        bs_map  = {c.category_name: c.score for c in bs}
        bs_arr  = np.array([bs_map.get(name, 0.0) for name in BLENDSHAPE_ORDER], dtype=np.float32)

        # 4 iris features
        l_iris = lm[468] if len(lm) > 468 else lm[33]
        r_iris = lm[473] if len(lm) > 473 else lm[263]
        iris   = np.array([l_iris.x, l_iris.y, r_iris.x, r_iris.y], dtype=np.float32)

        # 3 depth features
        nose    = lm[1]
        l_eye   = lm[468] if len(lm) > 468 else lm[33]
        r_eye   = lm[473] if len(lm) > 473 else lm[263]
        depth   = np.array([nose.z, l_eye.z, r_eye.z], dtype=np.float32)

        frame_feat = np.concatenate([bs_arr, iris, depth])  # (59,)
        features.append(frame_feat)

    cap.release()
    landmarker.close()

    if total_frames == 0 or face_detected / total_frames < 0.5:
        return None

    return np.stack(features, axis=0).astype(np.float32)


def process_file(args_tuple):
    """Worker function for parallel processing."""
    video_path, output_path, model_path = args_tuple

    if os.path.exists(output_path):
        return video_path, 'skipped', 0

    feats = extract_video(video_path, model_path)
    if feats is None:
        return video_path, 'no_face', 0

    fps = 30.0  # approximate
    np.savez_compressed(output_path, features=feats, fps=fps)
    return video_path, 'ok', len(feats)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--real-dir',   required=True, help='Directory of real face videos')
    parser.add_argument('--fake-dir',   required=True, help='Directory of deepfake videos')
    parser.add_argument('--photo-dir',  default=None,  help='Directory of photo-replay videos')
    parser.add_argument('--output-dir', default='./data/features')
    parser.add_argument('--workers',    type=int, default=4)
    parser.add_argument('--max-per-class', type=int, default=5000, help='Max videos per class')
    args = parser.parse_args()

    model_path = ensure_model()

    dir_label_pairs = [
        (args.real_dir,  'real'),
        (args.fake_dir,  'fake'),
    ]
    if args.photo_dir:
        dir_label_pairs.append((args.photo_dir, 'photo'))

    video_exts = {'.mp4', '.avi', '.mov', '.mkv', '.webm'}

    for src_dir, label in dir_label_pairs:
        src  = Path(src_dir)
        dst  = Path(args.output_dir) / label
        dst.mkdir(parents=True, exist_ok=True)

        videos = [f for f in src.rglob('*') if f.suffix.lower() in video_exts]
        videos = videos[:args.max_per_class]
        print(f"\n[{label}] Found {len(videos)} videos → {dst}")

        tasks = [
            (str(v), str(dst / (v.stem + '.npz')), model_path)
            for v in videos
        ]

        ok = skip = fail = 0
        with ProcessPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(process_file, t): t[0] for t in tasks}
            for fut in tqdm(as_completed(futures), total=len(futures), desc=label):
                _, status, n_frames = fut.result()
                if status == 'ok':      ok   += 1
                elif status == 'skipped': skip += 1
                else:                    fail += 1

        print(f"[{label}] done: {ok} extracted, {skip} skipped, {fail} failed")

    print("\n[done] Feature extraction complete.")
    print(f"Output: {args.output_dir}/{{real,fake,photo}}/*.npz")
    print("Next: python train_deepfake_v2.py --data-dir", args.output_dir)


if __name__ == '__main__':
    main()
