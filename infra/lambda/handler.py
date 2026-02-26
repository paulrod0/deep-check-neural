"""
Deep-Check · Lambda LSTM Inference Handler
==========================================
Expone un endpoint (Function URL) que recibe la secuencia raw de biometría
de teclado y devuelve la probabilidad de fraude del modelo BiLSTMv2.

Ruta de los artefactos en Lambda:
  /var/task/model/lstm_model.onnx      ← incluido en el ZIP del deployment
  /var/task/model/lstm_scaler.json     ← idem

Variables de entorno requeridas:
  DEEP_CHECK_LAMBDA_SECRET             ← token Bearer para autenticar la llamada
                                          (se genera en deploy.sh y se pasa
                                           también a Vercel como LSTM_LAMBDA_SECRET)
"""

from __future__ import annotations

import json
import math
import os
import time
from typing import Any

import numpy as np
import onnxruntime as ort

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------
SEQ_LEN    = 150       # debe coincidir con infra/train_gpu.py
N_FEAT     = 6        # flight, hold, Δflight, Δhold, hold/flight, speed_ema
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'model', 'lstm_model.onnx')
SCALER_PATH= os.path.join(os.path.dirname(__file__), 'model', 'lstm_scaler.json')

# ---------------------------------------------------------------------------
# Carga de artefactos (una vez por contenedor Lambda)
# ---------------------------------------------------------------------------
_session: ort.InferenceSession | None = None
_scaler:  dict | None = None
_input_name:  str = 'input'
_output_name: str = 'output'


def _load_model() -> None:
    global _session, _scaler, _input_name, _output_name
    opts = ort.SessionOptions()
    opts.inter_op_num_threads = 2
    opts.intra_op_num_threads = 2
    _session = ort.InferenceSession(MODEL_PATH, sess_options=opts,
                                    providers=['CPUExecutionProvider'])
    _input_name  = _session.get_inputs()[0].name
    _output_name = _session.get_outputs()[0].name

    if os.path.exists(SCALER_PATH):
        with open(SCALER_PATH, 'r') as f:
            _scaler = json.load(f)


# ---------------------------------------------------------------------------
# Preprocesado de secuencia
# ---------------------------------------------------------------------------
def _build_features(events: list[dict]) -> np.ndarray:
    """
    Construye tensor (SEQ_LEN, N_FEAT) a partir de la secuencia raw.

    Cada evento debe tener al menos:
        { "flightTime": float, "holdTime": float }   (ms)

    Features:
        0  flight_time   (ms normalizado)
        1  hold_time     (ms normalizado)
        2  Δflight       (diferencia entre keystroke consecutivos)
        3  Δhold
        4  hold/flight   (ratio)
        5  speed_ema     (EMA de 1/inter_key_interval)
    """
    flights = [float(e.get('flightTime', 0)) for e in events]
    holds   = [float(e.get('holdTime',   0)) for e in events]

    # Pad / truncate to SEQ_LEN
    if len(flights) < SEQ_LEN:
        pad = SEQ_LEN - len(flights)
        flights = [0.0] * pad + flights
        holds   = [0.0] * pad + holds
    else:
        flights = flights[-SEQ_LEN:]
        holds   = holds[-SEQ_LEN:]

    flights_arr = np.array(flights, dtype=np.float32)
    holds_arr   = np.array(holds,   dtype=np.float32)

    # Scaler normalization (mean / std por feature si disponible)
    if _scaler:
        mu_f  = float(_scaler.get('flight_mean', 120))
        std_f = float(_scaler.get('flight_std',   50)) or 1
        mu_h  = float(_scaler.get('hold_mean',    80))
        std_h = float(_scaler.get('hold_std',     30)) or 1
    else:
        mu_f, std_f = 120.0, 50.0
        mu_h, std_h =  80.0, 30.0

    f_norm = (flights_arr - mu_f) / std_f
    h_norm = (holds_arr   - mu_h) / std_h

    # Deltas (pad first element with 0)
    d_flight = np.diff(f_norm, prepend=f_norm[0])
    d_hold   = np.diff(h_norm, prepend=h_norm[0])

    # Ratio hold/flight (evita div/0)
    ratio = np.where(np.abs(flights_arr) > 1e-3,
                     holds_arr / (flights_arr + 1e-6), 0.0).astype(np.float32)

    # Speed EMA (1 / max(flight, 1))  — ventana 5
    inv_flight = 1.0 / np.maximum(flights_arr, 1.0)
    alpha      = 0.4
    ema        = np.zeros(SEQ_LEN, dtype=np.float32)
    ema[0]     = inv_flight[0]
    for i in range(1, SEQ_LEN):
        ema[i] = alpha * inv_flight[i] + (1 - alpha) * ema[i - 1]

    mat = np.stack([f_norm, h_norm, d_flight, d_hold, ratio, ema], axis=1)  # (SEQ_LEN, 6)
    return mat.astype(np.float32)


# ---------------------------------------------------------------------------
# Handler principal
# ---------------------------------------------------------------------------
def handler(event: dict, context: Any) -> dict:
    """AWS Lambda Function URL handler."""

    # 0. Autenticación Bearer
    secret = os.environ.get('DEEP_CHECK_LAMBDA_SECRET', '')
    if secret:
        auth = (event.get('headers') or {}).get('authorization', '')
        if auth.replace('Bearer ', '') != secret:
            return _resp(401, {'error': 'Unauthorized'})

    # 1. Parse body
    body_raw = event.get('body') or '{}'
    if event.get('isBase64Encoded'):
        import base64
        body_raw = base64.b64decode(body_raw).decode('utf-8')

    try:
        body: dict = json.loads(body_raw)
    except json.JSONDecodeError:
        return _resp(400, {'error': 'Invalid JSON'})

    raw_sequence: list[dict] = body.get('rawSequence', [])
    if not isinstance(raw_sequence, list) or len(raw_sequence) < 5:
        return _resp(422, {'error': 'rawSequence must have at least 5 events'})

    # 2. Cargar modelo la primera vez
    if _session is None:
        try:
            _load_model()
        except Exception as e:
            return _resp(500, {'error': f'Model load failed: {str(e)}'})

    # 3. Inferencia
    t0 = time.perf_counter()
    try:
        mat   = _build_features(raw_sequence)          # (SEQ_LEN, N_FEAT)
        inp   = mat[np.newaxis, :, :]                  # (1, SEQ_LEN, N_FEAT)
        raw   = _session.run([_output_name], {_input_name: inp})[0]
        prob  = float(raw.flatten()[0])
        # Sigmoid si la red no la aplica internamente
        if prob < 0 or prob > 1:
            prob = 1.0 / (1.0 + math.exp(-prob))
    except Exception as e:
        return _resp(500, {'error': f'Inference failed: {str(e)}'})

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)

    return _resp(200, {
        'lstmProb':   round(prob, 6),
        'aiRisk':     round(prob * 100, 2),
        'isBot':      prob > 0.5,
        'elapsedMs':  elapsed_ms,
        'seqLen':     len(raw_sequence),
        'model':      'BiLSTMv2',
    })


def _resp(status: int, body: dict) -> dict:
    return {
        'statusCode': status,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': os.environ.get('ALLOWED_ORIGIN', '*'),
        },
        'body': json.dumps(body),
    }
