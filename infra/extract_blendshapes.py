#!/usr/bin/env python3
"""
extract_blendshapes.py — Extrae secuencias de MediaPipe de vídeos reales
=========================================================================
Lee vídeos de caras reales y deepfakes, extrae las mismas 59 features
que usa train_deepfake_cnn.py (52 blendshapes + 4 iris + 3 depth),
las agrupa en ventanas de 90 frames y las guarda como .npy.

Esto reemplaza el dataset sintético que causó el 29.5% accuracy.

Requisitos:
  pip install mediapipe opencv-python tqdm

Uso:
  # Vídeos reales (ej. VoxCeleb2, DFDC "real", cualquier hablante real)
  python infra/extract_blendshapes.py \\
    --input-dir /data/videos/real --label real \\
    --output /data/blendshapes

  # Vídeos falsos (ej. DFDC "fake", Celeb-DF "synthesis")
  python infra/extract_blendshapes.py \\
    --input-dir /data/videos/fake --label deepfake \\
    --output /data/blendshapes

  # Video replay (foto en pantalla filmada)
  python infra/extract_blendshapes.py \\
    --input-dir /data/videos/photo_replay --label photo_replay \\
    --output /data/blendshapes

  # Después de extraer todo:
  python infra/train_deepfake_cnn.py \\
    --data-dir /data/blendshapes --epochs 100
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from tqdm import tqdm

SEQ_LEN    = 90    # frames por ventana (igual que en train_deepfake_cnn.py)
N_FEATURES = 59    # 52 blendshapes + 4 iris + 3 depth

LABELS = {'real': 0, 'deepfake': 1, 'photo_replay': 2}

VIDEO_EXTS = {'.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv'}


def init_mediapipe():
    """Inicializa FaceLandmarker en modo VIDEO con blendshapes."""
    try:
        import mediapipe as mp
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision as mp_vision
    except ImportError:
        print("ERROR: mediapipe no instalado. Ejecuta: pip install mediapipe")
        sys.exit(1)

    # Intentar cargar el modelo desde disco primero
    MODEL_PATHS = [
        './public/models/face_landmarker.task',
        './models/face_landmarker.task',
        '/tmp/face_landmarker.task',
    ]

    model_path = None
    for p in MODEL_PATHS:
        if Path(p).exists():
            model_path = p
            break

    if model_path is None:
        print("Descargando face_landmarker.task...")
        import urllib.request
        url = ('https://storage.googleapis.com/mediapipe-models/'
               'face_landmarker/face_landmarker/float16/latest/face_landmarker.task')
        model_path = '/tmp/face_landmarker.task'
        urllib.request.urlretrieve(url, model_path)
        print(f"  Guardado en {model_path}")

    base_opts = mp_python.BaseOptions(model_asset_path=model_path)
    opts = mp_vision.FaceLandmarkerOptions(
        base_options=base_opts,
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=False,
        running_mode=mp_vision.RunningMode.VIDEO,
        num_faces=1,
        min_face_detection_confidence=0.4,
        min_face_presence_confidence=0.4,
        min_tracking_confidence=0.4,
    )
    return mp_vision.FaceLandmarker.create_from_options(opts), mp_vision.RunningMode.VIDEO


def extract_features_from_frame(result, fallback_prev: np.ndarray | None = None) -> np.ndarray | None:
    """
    Convierte resultado de FaceLandmarker en vector de 59 features.
    Devuelve None si no hay cara detectada.
    """
    if not result.face_blendshapes or len(result.face_blendshapes) == 0:
        return fallback_prev  # reutilizar frame anterior si no hay cara

    blendshapes = result.face_blendshapes[0]
    if len(blendshapes) < 52:
        return fallback_prev

    # 52 blendshapes (índices 0-51 de MediaPipe FaceLandmarker)
    bs = np.array([c.score for c in blendshapes[:52]], dtype=np.float32)

    # 4 iris positions (landmarks 468-471 normalizados)
    landmarks = result.face_landmarks[0] if result.face_landmarks else None
    if landmarks and len(landmarks) >= 472:
        # MediaPipe FaceLandmarker: iris izquierdo ~468, derecho ~473
        li = landmarks[468]
        ri = landmarks[473] if len(landmarks) > 473 else landmarks[468]
        iris = np.array([li.x, li.y, ri.x, ri.y], dtype=np.float32)
        # Depth features: punta nariz + iris z
        nose_z = float(landmarks[1].z)
        li_z   = float(li.z)
        ri_z   = float(ri.z)
        depth  = np.array([nose_z, li_z, ri_z], dtype=np.float32)
    else:
        iris  = np.zeros(4, dtype=np.float32)
        depth = np.zeros(3, dtype=np.float32)

    return np.concatenate([bs, iris, depth])  # (59,)


def extract_sequences_from_video(video_path: str, landmarker, seq_len=90, step=1):
    """
    Extrae ventanas de SEQ_LEN frames de un vídeo.
    Devuelve lista de arrays shape (seq_len, 59).
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return []

    fps       = cap.get(cv2.CAP_PROP_FPS) or 25.0
    frames_ms = 1000.0 / fps  # ms por frame

    all_frames: list = []
    frame_idx = 0
    prev_feat = None

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        timestamp_ms = int(frame_idx * frames_ms)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        import mediapipe as mp
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result   = landmarker.detect_for_video(mp_image, timestamp_ms)
        feat     = extract_features_from_frame(result, prev_feat)

        if feat is not None:
            all_frames.append(feat)
            prev_feat = feat

        frame_idx += 1

    cap.release()

    if len(all_frames) < seq_len:
        return []  # vídeo demasiado corto

    # Dividir en ventanas de seq_len con solapamiento de 50%
    sequences = []
    hop = seq_len // 2
    for start in range(0, len(all_frames) - seq_len + 1, hop):
        window = np.stack(all_frames[start:start + seq_len])  # (90, 59)
        sequences.append(window)

    return sequences


def process_directory(input_dir: Path, label_int: int, output_dir: Path,
                      max_videos: int | None = None):
    """Procesa todos los vídeos de un directorio."""
    landmarker, _ = init_mediapipe()

    videos = [f for f in input_dir.rglob('*') if f.suffix.lower() in VIDEO_EXTS]
    if max_videos:
        videos = videos[:max_videos]

    print(f"\n📂 {input_dir.name} ({len(videos)} vídeos) → label={label_int}")

    label_names = {0: 'real', 1: 'deepfake', 2: 'photo_replay'}
    out_subdir  = output_dir / label_names[label_int]
    out_subdir.mkdir(parents=True, exist_ok=True)

    total_seqs = 0
    failed     = 0

    for i, video_path in enumerate(tqdm(videos)):
        try:
            seqs = extract_sequences_from_video(str(video_path), landmarker)
            if not seqs:
                failed += 1
                continue

            stem  = video_path.stem
            for j, seq in enumerate(seqs):
                out_path = out_subdir / f'{stem}_{j:04d}.npy'
                np.save(str(out_path), seq.astype(np.float32))
                total_seqs += 1

        except Exception as e:
            failed += 1
            if i < 5:  # solo primeros errores
                print(f"  ⚠️  {video_path.name}: {e}")

    landmarker.close()
    print(f"  ✅ {total_seqs:,} secuencias guardadas ({failed} vídeos fallidos)")
    return total_seqs


def main():
    parser = argparse.ArgumentParser(
        description='Extrae secuencias MediaPipe de vídeos para entrenar deepfake CNN'
    )
    parser.add_argument('--input-dir',  required=True, help='Directorio con vídeos')
    parser.add_argument('--label',      required=True, choices=list(LABELS.keys()),
                        help='Etiqueta: real | deepfake | photo_replay')
    parser.add_argument('--output',     default='/tmp/blendshapes', help='Directorio salida')
    parser.add_argument('--max-videos', type=int, default=None,
                        help='Límite de vídeos a procesar (para pruebas)')
    parser.add_argument('--verify',     action='store_true',
                        help='Solo verificar que los .npy tienen la forma correcta')
    args = parser.parse_args()

    input_dir  = Path(args.input_dir)
    output_dir = Path(args.output)
    label_int  = LABELS[args.label]

    if not input_dir.exists():
        print(f"ERROR: {input_dir} no existe")
        sys.exit(1)

    if args.verify:
        npys = list((output_dir / args.label).rglob('*.npy'))
        print(f"Verificando {len(npys)} archivos .npy...")
        ok = bad = 0
        for p in npys[:100]:
            arr = np.load(str(p))
            if arr.shape == (SEQ_LEN, N_FEATURES):
                ok += 1
            else:
                bad += 1
                print(f"  ⚠️  {p.name}: shape {arr.shape} (esperado {SEQ_LEN}×{N_FEATURES})")
        print(f"OK: {ok}, Bad: {bad}")
        return

    output_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()

    n = process_directory(input_dir, label_int, output_dir, args.max_videos)

    elapsed = time.time() - t0
    print(f"\nTotal: {n:,} secuencias en {elapsed:.0f}s")
    print(f"\nSiguiente paso:")
    print(f"  python infra/train_deepfake_cnn.py \\")
    print(f"    --data-dir {output_dir} \\")
    print(f"    --epochs 100 --device cuda")


if __name__ == '__main__':
    main()
