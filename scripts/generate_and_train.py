"""
Deep-Check · Biometric Fraud Detector v2.1
===========================================
Mejoras sobre v2.0:
  - Isolation Forest como segunda capa (detección de anomalías no supervisada)
    → Ensemble final: 0.70 × XGBoost + 0.30 × IsoForest
    → El atacante necesita engañar DOS modelos independientes simultáneamente
  - Artefactos privados en models/ (fuera de public/) — no descargables
  - Metadata pública sin feature importances ni arquetipos de entrenamiento
  - IsoForest entrenado SOLO con sesiones humanas → detecta cualquier desviación

Uso:
  python3 scripts/generate_and_train.py
"""

import json, os, sys
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split, StratifiedKFold
from sklearn.preprocessing import StandardScaler
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import IsolationForest
from sklearn.metrics import (roc_auc_score, f1_score, classification_report,
                              precision_recall_curve)
from xgboost import XGBClassifier

np.random.seed(42)
N = 150_000

FEATURES = [
    'flight_mean', 'flight_std', 'hold_mean', 'hold_std',
    'flight_skewness', 'flight_kurtosis', 'flight_entropy', 'hold_entropy',
    'periodicity_score', 'velocity_gradient', 'fatigue_rate', 'rhythm_consistency',
    'impossible_fast_ratio', 'digram_cv_mean',
    'backspace_latency_std', 'backspace_count_ratio',
    'burst_count_per_100k', 'session_wpm',
]

def clip(arr, lo, hi):
    return np.clip(arr, lo, hi)

def add_cross_noise(d, keys, scale=0.04):
    """Añade correlación realista: pequeño ruido compartido entre features relacionadas."""
    common = np.random.randn(len(next(iter(d.values())))) * scale
    for k in keys:
        d[k] = d[k] + common * np.abs(d[k])
    return d

# ─── HUMANOS ──────────────────────────────────────────────────────────────────

def generate_humans_normal(n, seed=1):
    """Mecanografía variada, ritmo orgánico, fatiga real."""
    rng = np.random.default_rng(seed)
    d = {}
    d['flight_mean']           = clip(rng.normal(130, 55, n), 40, 550)
    d['flight_std']            = clip(rng.normal(65, 28, n),  8, 220)
    d['hold_mean']             = clip(rng.normal(100, 32, n), 28, 380)
    d['hold_std']              = clip(rng.normal(25, 11, n),  4, 110)
    d['flight_skewness']       = clip(rng.normal(1.3, 0.8, n), -1, 5.5)
    d['flight_kurtosis']       = clip(rng.normal(2.0, 1.4, n), -1, 9)
    d['flight_entropy']        = clip(rng.normal(3.0, 0.5, n), 1.2, 4.8)
    d['hold_entropy']          = clip(rng.normal(2.5, 0.6, n), 0.7, 4.2)
    d['periodicity_score']     = clip(rng.normal(18, 13, n), 0, 62)
    d['velocity_gradient']     = clip(rng.normal(0.15, 0.12, n), -0.6, 0.9)
    d['fatigue_rate']          = clip(rng.normal(0.75, 0.55, n), -0.6, 3.5)
    d['rhythm_consistency']    = clip(rng.normal(38, 20, n), 5, 130)
    d['impossible_fast_ratio'] = clip(rng.normal(0.004, 0.007, n), 0, 0.06)
    d['digram_cv_mean']        = clip(rng.normal(0.40, 0.14, n), 0.06, 1.0)
    d['backspace_latency_std'] = clip(rng.normal(58, 28, n), 8, 220)
    d['backspace_count_ratio'] = clip(rng.normal(0.09, 0.05, n), 0, 0.40)
    d['burst_count_per_100k']  = clip(rng.normal(0.9, 1.0, n), 0, 7)
    d['session_wpm']           = clip(rng.normal(62, 24, n), 14, 190)
    d = add_cross_noise(d, ['flight_mean', 'hold_mean'], 0.05)
    d = add_cross_noise(d, ['flight_std', 'hold_std'], 0.04)
    d['label'] = np.zeros(n, dtype=int)
    return pd.DataFrame(d)

def generate_humans_fast(n, seed=11):
    """Mecanógrafos rápidos (>80 WPM): flight corto, alta entropía, fatiga tardía."""
    rng = np.random.default_rng(seed)
    d = {}
    d['flight_mean']           = clip(rng.normal(72, 22, n), 30, 180)
    d['flight_std']            = clip(rng.normal(42, 16, n), 8, 130)
    d['hold_mean']             = clip(rng.normal(72, 18, n), 25, 180)
    d['hold_std']              = clip(rng.normal(18, 8, n),  3, 70)
    d['flight_skewness']       = clip(rng.normal(0.9, 0.6, n), -0.5, 4)
    d['flight_kurtosis']       = clip(rng.normal(1.4, 1.0, n), -1, 7)
    d['flight_entropy']        = clip(rng.normal(3.3, 0.4, n), 2.0, 4.8)
    d['hold_entropy']          = clip(rng.normal(2.8, 0.5, n), 1.5, 4.2)
    d['periodicity_score']     = clip(rng.normal(14, 10, n), 0, 50)
    d['velocity_gradient']     = clip(rng.normal(0.08, 0.09, n), -0.3, 0.5)
    d['fatigue_rate']          = clip(rng.normal(0.4, 0.35, n), -0.2, 2.0)
    d['rhythm_consistency']    = clip(rng.normal(28, 14, n), 4, 90)
    d['impossible_fast_ratio'] = clip(rng.normal(0.008, 0.010, n), 0, 0.08)
    d['digram_cv_mean']        = clip(rng.normal(0.33, 0.10, n), 0.05, 0.75)
    d['backspace_latency_std'] = clip(rng.normal(44, 20, n), 8, 160)
    d['backspace_count_ratio'] = clip(rng.normal(0.06, 0.04, n), 0, 0.30)
    d['burst_count_per_100k']  = clip(rng.normal(0.5, 0.6, n), 0, 5)
    d['session_wpm']           = clip(rng.normal(98, 22, n), 55, 195)
    d = add_cross_noise(d, ['flight_mean', 'hold_mean'], 0.04)
    d['label'] = np.zeros(n, dtype=int)
    return pd.DataFrame(d)

def generate_humans_nervous(n, seed=5):
    """Bajo presión: ritmo alterado, muchos backspaces, alta fatiga."""
    rng = np.random.default_rng(seed)
    d = {}
    d['flight_mean']           = clip(rng.normal(165, 75, n), 45, 650)
    d['flight_std']            = clip(rng.normal(90, 38, n), 18, 320)
    d['hold_mean']             = clip(rng.normal(115, 45, n), 28, 450)
    d['hold_std']              = clip(rng.normal(32, 16, n), 5, 130)
    d['flight_skewness']       = clip(rng.normal(1.9, 1.0, n), 0.1, 6)
    d['flight_kurtosis']       = clip(rng.normal(2.8, 1.8, n), 0, 10)
    d['flight_entropy']        = clip(rng.normal(2.7, 0.7, n), 1.0, 4.5)
    d['hold_entropy']          = clip(rng.normal(2.3, 0.7, n), 0.7, 4.0)
    d['periodicity_score']     = clip(rng.normal(24, 15, n), 0, 68)
    d['velocity_gradient']     = clip(rng.normal(0.22, 0.20, n), -0.5, 1.0)
    d['fatigue_rate']          = clip(rng.normal(1.3, 0.75, n), 0, 4.5)
    d['rhythm_consistency']    = clip(rng.normal(60, 28, n), 8, 180)
    d['impossible_fast_ratio'] = clip(rng.normal(0.007, 0.009, n), 0, 0.07)
    d['digram_cv_mean']        = clip(rng.normal(0.45, 0.16, n), 0.08, 1.05)
    d['backspace_latency_std'] = clip(rng.normal(70, 32, n), 10, 270)
    d['backspace_count_ratio'] = clip(rng.normal(0.14, 0.07, n), 0.01, 0.50)
    d['burst_count_per_100k']  = clip(rng.normal(1.4, 1.2, n), 0, 9)
    d['session_wpm']           = clip(rng.normal(46, 20, n), 10, 130)
    d['label'] = np.zeros(n, dtype=int)
    return pd.DataFrame(d)

def generate_humans_mobile(n, seed=15):
    """Usuarios móvil/tablet: lento, hold largo, muchos errores."""
    rng = np.random.default_rng(seed)
    d = {}
    d['flight_mean']           = clip(rng.normal(280, 90, n), 80, 800)
    d['flight_std']            = clip(rng.normal(140, 55, n), 30, 500)
    d['hold_mean']             = clip(rng.normal(160, 50, n), 60, 500)
    d['hold_std']              = clip(rng.normal(50, 22, n), 10, 180)
    d['flight_skewness']       = clip(rng.normal(1.6, 0.9, n), 0.1, 5.5)
    d['flight_kurtosis']       = clip(rng.normal(2.2, 1.3, n), 0, 8)
    d['flight_entropy']        = clip(rng.normal(2.8, 0.6, n), 1.2, 4.5)
    d['hold_entropy']          = clip(rng.normal(2.4, 0.6, n), 0.9, 4.0)
    d['periodicity_score']     = clip(rng.normal(20, 14, n), 0, 60)
    d['velocity_gradient']     = clip(rng.normal(0.10, 0.14, n), -0.4, 0.7)
    d['fatigue_rate']          = clip(rng.normal(0.9, 0.6, n), 0, 3.5)
    d['rhythm_consistency']    = clip(rng.normal(70, 30, n), 10, 200)
    d['impossible_fast_ratio'] = clip(rng.normal(0.001, 0.002, n), 0, 0.015)
    d['digram_cv_mean']        = clip(rng.normal(0.55, 0.18, n), 0.10, 1.2)
    d['backspace_latency_std'] = clip(rng.normal(90, 40, n), 20, 350)
    d['backspace_count_ratio'] = clip(rng.normal(0.18, 0.08, n), 0.02, 0.60)
    d['burst_count_per_100k']  = clip(rng.normal(0.3, 0.5, n), 0, 4)
    d['session_wpm']           = clip(rng.normal(28, 10, n), 8, 70)
    d['label'] = np.zeros(n, dtype=int)
    return pd.DataFrame(d)

# ─── BOTS ─────────────────────────────────────────────────────────────────────

def generate_bots_simple(n, seed=2):
    """Autotype clásico: velocidad fija, entropía casi cero."""
    rng = np.random.default_rng(seed)
    d = {}
    d['flight_mean']           = clip(rng.normal(45, 5, n), 20, 90)
    d['flight_std']            = clip(rng.normal(2.0, 0.8, n), 0.3, 8)
    d['hold_mean']             = clip(rng.normal(38, 4, n), 18, 70)
    d['hold_std']              = clip(rng.normal(1.2, 0.4, n), 0.2, 5)
    d['flight_skewness']       = clip(rng.normal(0.01, 0.04, n), -0.25, 0.25)
    d['flight_kurtosis']       = clip(rng.normal(10.5, 2.8, n), 5, 22)
    d['flight_entropy']        = clip(rng.normal(0.6, 0.25, n), 0.08, 1.8)
    d['hold_entropy']          = clip(rng.normal(0.5, 0.18, n), 0.08, 1.3)
    d['periodicity_score']     = clip(rng.normal(82, 7, n), 60, 98)
    d['velocity_gradient']     = clip(rng.normal(0.0005, 0.001, n), -0.005, 0.005)
    d['fatigue_rate']          = clip(rng.normal(0.0, 0.008, n), -0.04, 0.04)
    d['rhythm_consistency']    = clip(rng.normal(2.5, 1.2, n), 0.3, 10)
    d['impossible_fast_ratio'] = clip(rng.normal(0.0, 0.001, n), 0, 0.007)
    d['digram_cv_mean']        = clip(rng.normal(0.025, 0.012, n), 0.003, 0.10)
    d['backspace_latency_std'] = clip(rng.normal(3.5, 1.5, n), 0.3, 12)
    d['backspace_count_ratio'] = clip(rng.normal(0.008, 0.004, n), 0, 0.035)
    d['burst_count_per_100k']  = clip(rng.normal(0.0, 0.04, n), 0, 0.25)
    d['session_wpm']           = clip(rng.normal(220, 28, n), 140, 360)
    d['label'] = np.ones(n, dtype=int)
    return pd.DataFrame(d)

def generate_bots_llm_paste(n, seed=3):
    """LLM/Copilot: silencios + paste bursts súbitos."""
    rng = np.random.default_rng(seed)
    d = {}
    d['flight_mean']           = clip(rng.normal(720, 160, n), 280, 1600)
    d['flight_std']            = clip(rng.normal(420, 130, n), 90, 1100)
    d['hold_mean']             = clip(rng.normal(115, 32, n), 45, 260)
    d['hold_std']              = clip(rng.normal(22, 9, n), 5, 65)
    d['flight_skewness']       = clip(rng.normal(3.7, 1.1, n), 1.5, 8)
    d['flight_kurtosis']       = clip(rng.normal(13, 4.5, n), 5, 35)
    d['flight_entropy']        = clip(rng.normal(1.9, 0.45, n), 0.7, 3.4)
    d['hold_entropy']          = clip(rng.normal(2.1, 0.55, n), 0.7, 3.7)
    d['periodicity_score']     = clip(rng.normal(26, 13, n), 6, 58)
    d['velocity_gradient']     = clip(rng.normal(-0.32, 0.17, n), -0.9, 0.05)
    d['fatigue_rate']          = clip(rng.normal(-0.55, 0.32, n), -2.2, 0.15)
    d['rhythm_consistency']    = clip(rng.normal(95, 28, n), 38, 220)
    d['impossible_fast_ratio'] = clip(rng.normal(0.002, 0.003, n), 0, 0.02)
    d['digram_cv_mean']        = clip(rng.normal(0.68, 0.22, n), 0.18, 1.35)
    d['backspace_latency_std'] = clip(rng.normal(85, 32, n), 18, 220)
    d['backspace_count_ratio'] = clip(rng.normal(0.012, 0.007, n), 0, 0.055)
    d['burst_count_per_100k']  = clip(rng.normal(14, 5, n), 4, 38)
    d['session_wpm']           = clip(rng.normal(36, 14, n), 8, 78)
    d['label'] = np.ones(n, dtype=int)
    return pd.DataFrame(d)

def generate_bots_sophisticated(n, seed=4):
    """Bots avanzados: imitan media/std humana pero sin fatiga ni skewness real."""
    rng = np.random.default_rng(seed)
    d = {}
    d['flight_mean']           = clip(rng.normal(118, 32, n), 48, 280)
    d['flight_std']            = clip(rng.normal(28, 7, n), 8, 65)  # std bajo para mean normal
    d['hold_mean']             = clip(rng.normal(92, 18, n), 38, 190)
    d['hold_std']              = clip(rng.normal(7.5, 2.8, n), 2, 22)
    d['flight_skewness']       = clip(rng.normal(0.08, 0.12, n), -0.5, 0.7)
    d['flight_kurtosis']       = clip(rng.normal(4.8, 1.6, n), 2, 11)
    d['flight_entropy']        = clip(rng.normal(1.9, 0.42, n), 0.8, 3.2)
    d['hold_entropy']          = clip(rng.normal(1.6, 0.42, n), 0.6, 3.0)
    d['periodicity_score']     = clip(rng.normal(48, 13, n), 22, 80)
    d['velocity_gradient']     = clip(rng.normal(0.004, 0.008, n), -0.02, 0.035)
    d['fatigue_rate']          = clip(rng.normal(0.018, 0.025, n), -0.08, 0.14)
    d['rhythm_consistency']    = clip(rng.normal(11, 5, n), 2.5, 28)
    d['impossible_fast_ratio'] = clip(rng.normal(0.0008, 0.0015, n), 0, 0.008)
    d['digram_cv_mean']        = clip(rng.normal(0.11, 0.045, n), 0.03, 0.28)
    d['backspace_latency_std'] = clip(rng.normal(11, 4.5, n), 1.5, 38)
    d['backspace_count_ratio'] = clip(rng.normal(0.028, 0.010, n), 0, 0.11)
    d['burst_count_per_100k']  = clip(rng.normal(0.25, 0.28, n), 0, 1.8)
    d['session_wpm']           = clip(rng.normal(98, 22, n), 48, 185)
    d['label'] = np.ones(n, dtype=int)
    return pd.DataFrame(d)

def generate_bots_fatigue_aware(n, seed=44):
    """NUEVO — Bots que simulan fatigue_rate y velocity_gradient para engañar el modelo.
    Su punto débil: digram_cv_mean muy bajo, backspace_latency_std casi cero."""
    rng = np.random.default_rng(seed)
    d = {}
    d['flight_mean']           = clip(rng.normal(125, 40, n), 45, 320)
    d['flight_std']            = clip(rng.normal(38, 12, n), 10, 95)
    d['hold_mean']             = clip(rng.normal(98, 22, n), 38, 220)
    d['hold_std']              = clip(rng.normal(10, 3.5, n), 2.5, 30)
    d['flight_skewness']       = clip(rng.normal(0.9, 0.5, n), -0.2, 3.5)
    d['flight_kurtosis']       = clip(rng.normal(3.5, 1.5, n), 1, 9)
    d['flight_entropy']        = clip(rng.normal(2.3, 0.5, n), 1.0, 3.8)
    d['hold_entropy']          = clip(rng.normal(1.9, 0.5, n), 0.8, 3.2)
    d['periodicity_score']     = clip(rng.normal(35, 14, n), 10, 72)
    # Simulan fatiga y gradiente (señal difícil)
    d['velocity_gradient']     = clip(rng.normal(0.12, 0.09, n), -0.15, 0.45)
    d['fatigue_rate']          = clip(rng.normal(0.55, 0.35, n), 0.05, 2.2)
    # Pero traicionan su naturaleza aquí:
    d['rhythm_consistency']    = clip(rng.normal(8, 3.5, n), 1.5, 22)   # muy bajo
    d['impossible_fast_ratio'] = clip(rng.normal(0.0005, 0.001, n), 0, 0.006)
    d['digram_cv_mean']        = clip(rng.normal(0.06, 0.025, n), 0.01, 0.18)  # muy bajo
    d['backspace_latency_std'] = clip(rng.normal(7, 3, n), 0.5, 22)    # casi uniforme
    d['backspace_count_ratio'] = clip(rng.normal(0.02, 0.008, n), 0, 0.08)
    d['burst_count_per_100k']  = clip(rng.normal(0.15, 0.18, n), 0, 1.2)
    d['session_wpm']           = clip(rng.normal(85, 18, n), 42, 160)
    d['label'] = np.ones(n, dtype=int)
    return pd.DataFrame(d)

def generate_bots_slow(n, seed=55):
    """NUEVO — Bots lentos que imitan WPM bajo. Fallan en entropía y correlaciones."""
    rng = np.random.default_rng(seed)
    d = {}
    d['flight_mean']           = clip(rng.normal(220, 55, n), 80, 600)
    d['flight_std']            = clip(rng.normal(12, 4.5, n), 2, 38)   # std muy bajo = no humano
    d['hold_mean']             = clip(rng.normal(160, 40, n), 60, 450)
    d['hold_std']              = clip(rng.normal(6, 2.5, n), 1, 20)
    d['flight_skewness']       = clip(rng.normal(0.03, 0.06, n), -0.3, 0.3)
    d['flight_kurtosis']       = clip(rng.normal(8.5, 2.5, n), 3.5, 18)
    d['flight_entropy']        = clip(rng.normal(0.9, 0.35, n), 0.2, 2.2)
    d['hold_entropy']          = clip(rng.normal(0.7, 0.28, n), 0.1, 1.6)
    d['periodicity_score']     = clip(rng.normal(70, 10, n), 45, 92)
    d['velocity_gradient']     = clip(rng.normal(0.001, 0.002, n), -0.008, 0.008)
    d['fatigue_rate']          = clip(rng.normal(0.002, 0.005, n), -0.02, 0.025)
    d['rhythm_consistency']    = clip(rng.normal(4, 2, n), 0.5, 14)
    d['impossible_fast_ratio'] = clip(rng.normal(0.0, 0.0008, n), 0, 0.005)
    d['digram_cv_mean']        = clip(rng.normal(0.02, 0.01, n), 0.002, 0.08)
    d['backspace_latency_std'] = clip(rng.normal(4.5, 2, n), 0.4, 16)
    d['backspace_count_ratio'] = clip(rng.normal(0.006, 0.003, n), 0, 0.025)
    d['burst_count_per_100k']  = clip(rng.normal(0.0, 0.03, n), 0, 0.18)
    d['session_wpm']           = clip(rng.normal(32, 8, n), 12, 68)
    d['label'] = np.ones(n, dtype=int)
    return pd.DataFrame(d)

# ─── Dataset ──────────────────────────────────────────────────────────────────

# Proporciones: 55% humanos / 45% bots (ligeramente desbalanceado, como en producción)
splits = {
    # Humanos (55% del total)
    'humans_normal':   int(N * 0.25),
    'humans_fast':     int(N * 0.10),
    'humans_nervous':  int(N * 0.12),
    'humans_mobile':   int(N * 0.08),
    # Bots (45% del total)
    'bots_simple':         int(N * 0.10),
    'bots_llm_paste':      int(N * 0.10),
    'bots_sophisticated':  int(N * 0.12),
    'bots_fatigue_aware':  int(N * 0.08),
    'bots_slow':           int(N * 0.05),
}

print("=" * 60)
print("Deep-Check · Biometric Model Training v2.0")
print("=" * 60)
print(f"\nGenerating {N:,} synthetic samples...")

df = pd.concat([
    generate_humans_normal(splits['humans_normal']),
    generate_humans_fast(splits['humans_fast']),
    generate_humans_nervous(splits['humans_nervous']),
    generate_humans_mobile(splits['humans_mobile']),
    generate_bots_simple(splits['bots_simple']),
    generate_bots_llm_paste(splits['bots_llm_paste']),
    generate_bots_sophisticated(splits['bots_sophisticated']),
    generate_bots_fatigue_aware(splits['bots_fatigue_aware']),
    generate_bots_slow(splits['bots_slow']),
], ignore_index=True).sample(frac=1, random_state=42).reset_index(drop=True)

counts = df['label'].value_counts()
print(f"  Humans: {counts.get(0, 0):,}  ({counts.get(0,0)/len(df)*100:.1f}%)")
print(f"  Bots:   {counts.get(1, 0):,}  ({counts.get(1,0)/len(df)*100:.1f}%)")
print(f"  Total:  {len(df):,}")

X = df[FEATURES].values.astype(np.float32)
y = df['label'].values

# ─── Split: 70% train / 15% val / 15% test ───────────────────────────────────

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.15, random_state=42, stratify=y
)
X_train, X_val, y_train, y_val = train_test_split(
    X_train, y_train, test_size=0.176, random_state=42, stratify=y_train
)  # 0.176 × 0.85 ≈ 0.15 del total

print(f"\nSplit → Train: {len(X_train):,}  Val: {len(X_val):,}  Test: {len(X_test):,}")

# ─── Normalización ────────────────────────────────────────────────────────────

scaler = StandardScaler()
X_train_s = scaler.fit_transform(X_train)
X_val_s   = scaler.transform(X_val)
X_test_s  = scaler.transform(X_test)

scaler_params = {
    'features': FEATURES,
    'mean': scaler.mean_.tolist(),
    'std':  scaler.scale_.tolist(),
}

# ─── Entrenamiento XGBoost ────────────────────────────────────────────────────

print("\nTraining XGBoost v2 (500 estimators, early stopping)...")

model = XGBClassifier(
    n_estimators=500,
    max_depth=6,
    learning_rate=0.05,
    subsample=0.85,
    colsample_bytree=0.80,
    colsample_bylevel=0.80,
    min_child_weight=5,
    reg_alpha=0.2,        # L1
    reg_lambda=1.5,       # L2
    gamma=0.1,            # min split gain
    scale_pos_weight=counts.get(0, 1) / counts.get(1, 1),  # class balance
    eval_metric='auc',
    early_stopping_rounds=30,
    random_state=42,
    n_jobs=-1,
    tree_method='hist',
    verbosity=0,
)

model.fit(
    X_train_s, y_train,
    eval_set=[(X_val_s, y_val)],
    verbose=100,
)

actual_trees = model.best_iteration + 1 if hasattr(model, 'best_iteration') else model.n_estimators
print(f"Best iteration: {actual_trees} trees (early stopping)")

# ─── Calibración de probabilidades ───────────────────────────────────────────

print("\nCalibrating probabilities (isotonic regression)...")
calibrated = CalibratedClassifierCV(model, method='isotonic', cv='prefit')
calibrated.fit(X_val_s, y_val)

# ─── Evaluación ───────────────────────────────────────────────────────────────

y_prob_test = calibrated.predict_proba(X_test_s)[:, 1]
auc = roc_auc_score(y_test, y_prob_test)

# Threshold óptimo por F1 sobre validation set
y_prob_val = calibrated.predict_proba(X_val_s)[:, 1]
precisions, recalls, thresholds = precision_recall_curve(y_val, y_prob_val)
f1s = 2 * precisions * recalls / (precisions + recalls + 1e-9)
best_idx = np.argmax(f1s[:-1])
best_threshold = float(thresholds[best_idx])
best_f1_val = float(f1s[best_idx])

y_pred_test = (y_prob_test > best_threshold).astype(int)
f1_test = f1_score(y_test, y_pred_test)

print(f"\n{'─'*40}")
print(f"  Test AUC-ROC:      {auc:.4f}")
print(f"  Optimal threshold: {best_threshold:.3f} (by F1 on val)")
print(f"  Val F1 @ threshold:{best_f1_val:.4f}")
print(f"  Test F1 @ threshold:{f1_test:.4f}")
print(f"{'─'*40}")
print(classification_report(y_test, y_pred_test, target_names=['human', 'bot']))

# ─── Cross-validation AUC honesto ─────────────────────────────────────────────

print("5-fold Stratified CV AUC (honest estimate)...")
skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
cv_aucs = []
for fold, (tr_idx, va_idx) in enumerate(skf.split(X_train_s, y_train)):
    cv_model = XGBClassifier(
        n_estimators=actual_trees,  # usar el nº de árboles encontrado por early stopping
        max_depth=6, learning_rate=0.05, subsample=0.85,
        colsample_bytree=0.80, min_child_weight=5,
        reg_alpha=0.2, reg_lambda=1.5, gamma=0.1,
        random_state=42, n_jobs=-1, tree_method='hist', verbosity=0,
    )
    cv_model.fit(X_train_s[tr_idx], y_train[tr_idx])
    cv_prob = cv_model.predict_proba(X_train_s[va_idx])[:, 1]
    fold_auc = roc_auc_score(y_train[va_idx], cv_prob)
    cv_aucs.append(fold_auc)
    print(f"  Fold {fold+1}: AUC={fold_auc:.4f}")

print(f"\n  CV AUC: {np.mean(cv_aucs):.4f} ± {np.std(cv_aucs):.4f}")

# ─── Feature importance ───────────────────────────────────────────────────────

fi = dict(zip(FEATURES, model.feature_importances_.tolist()))
fi_sorted = sorted(fi.items(), key=lambda x: x[1], reverse=True)
print("\nTop-10 feature importances:")
for feat, imp in fi_sorted[:10]:
    bar = '█' * int(imp * 200)
    print(f"  {feat:<28} {imp:.4f}  {bar}")

# ─── Isolation Forest (segunda capa — detección de anomalías) ─────────────────

print("\nTraining Isolation Forest on human sessions only...")

# Entrenado SOLO con humanos: aprende qué es "normal"
# Un bot, por muy bien calibrado que esté, es estadísticamente anómalo
X_humans = X_train_s[y_train == 0]
print(f"  Human training samples: {len(X_humans):,}")

isoforest = IsolationForest(
    n_estimators=300,
    max_samples=0.8,
    contamination=0.05,   # estimación de outliers en sesiones humanas
    max_features=0.85,
    random_state=42,
    n_jobs=-1,
)
isoforest.fit(X_humans)

# Convertir decision_function a probabilidad de anomalía (0–100)
# decision_function < 0 → anómalo; > 0 → normal
iso_scores_val  = -isoforest.decision_function(X_val_s)   # mayor = más anómalo
iso_scores_test = -isoforest.decision_function(X_test_s)

# Normalizar a [0, 1] usando los percentiles de entrenamiento para robustez
iso_p5  = float(np.percentile(-isoforest.decision_function(X_train_s), 2))
iso_p95 = float(np.percentile(-isoforest.decision_function(X_train_s), 98))

def iso_to_prob(raw, p5, p95):
    return np.clip((raw - p5) / (p95 - p5 + 1e-9), 0, 1)

iso_prob_val  = iso_to_prob(iso_scores_val, iso_p5, iso_p95)
iso_prob_test = iso_to_prob(iso_scores_test, iso_p5, iso_p95)

iso_auc = roc_auc_score(y_test, iso_prob_test)
print(f"  IsoForest AUC (standalone): {iso_auc:.4f}")

# ─── Ensemble: 0.70 × XGBoost + 0.30 × IsoForest ─────────────────────────────

ensemble_prob_val  = 0.70 * y_prob_val  + 0.30 * iso_prob_val
ensemble_prob_test = 0.70 * y_prob_test + 0.30 * iso_prob_test

ens_auc = roc_auc_score(y_test, ensemble_prob_test)

# Re-optimizar threshold para el ensemble
prec_ens, rec_ens, thr_ens = precision_recall_curve(y_val, ensemble_prob_val)
f1s_ens = 2 * prec_ens * rec_ens / (prec_ens + rec_ens + 1e-9)
best_ens_idx = np.argmax(f1s_ens[:-1])
ensemble_threshold = float(thr_ens[best_ens_idx])

y_pred_ens = (ensemble_prob_test > ensemble_threshold).astype(int)
f1_ens = f1_score(y_test, y_pred_ens)

print(f"\n{'─'*40}")
print(f"  XGBoost AUC:     {auc:.4f}")
print(f"  IsoForest AUC:   {iso_auc:.4f}")
print(f"  Ensemble AUC:    {ens_auc:.4f}  ← producción")
print(f"  Ensemble F1:     {f1_ens:.4f}")
print(f"  Threshold:       {ensemble_threshold:.3f}")
print(f"{'─'*40}")
print(classification_report(y_test, y_pred_ens, target_names=['human', 'bot']))

# ─── Exportar IsoForest a ONNX ─────────────────────────────────────────────────

print("\nExporting to ONNX...")
out_dir = os.path.join(os.path.dirname(__file__), '..', 'models')
os.makedirs(out_dir, exist_ok=True)

iso_onnx_path = os.path.join(out_dir, 'isoforest.onnx')
try:
    from skl2onnx.common.data_types import FloatTensorType
    from skl2onnx import to_onnx as sk2onnx
    iso_onnx = sk2onnx(isoforest, X_humans[:1].astype(np.float32))
    import onnx as onnx_lib2
    onnx_lib2.save(iso_onnx, iso_onnx_path)
    iso_size_kb = os.path.getsize(iso_onnx_path) / 1024
    print(f"  IsoForest ONNX: {iso_onnx_path} ({iso_size_kb:.1f} KB)")
except Exception as e:
    # Fallback: guardar parámetros clave como JSON para reconstrucción en TS
    print(f"  IsoForest ONNX export skipped ({e}), saving JSON params...")
    iso_params = {
        'norm_p5': iso_p5,
        'norm_p95': iso_p95,
        'xgb_weight': 0.70,
        'iso_weight': 0.30,
    }
    with open(os.path.join(out_dir, 'ensemble_params.json'), 'w') as f:
        json.dump(iso_params, f, indent=2)

# ─── Exportar XGBoost a ONNX ──────────────────────────────────────────────────

onnx_path = os.path.join(out_dir, 'biometric-fraud-detector.onnx')

onnx_model = None
try:
    from skl2onnx.common.data_types import FloatTensorType
    from skl2onnx import to_onnx
    initial_type = [('float_input', FloatTensorType([None, len(FEATURES)]))]
    onnx_model = to_onnx(model, X_train_s[:1].astype(np.float32),
                          initial_types=initial_type,
                          options={'zipmap': False})
    print("  Exported via skl2onnx")
except Exception as e1:
    try:
        from onnxmltools import convert_xgboost
        from onnxmltools.convert.common.data_types import FloatTensorType as OnnxFloat
        onnx_model = convert_xgboost(model, initial_types=[('input', OnnxFloat([None, len(FEATURES)]))])
        print("  Exported via onnxmltools")
    except Exception as e2:
        print(f"  ONNX export failed: {e1} | {e2}")
        sys.exit(1)

import onnx as onnx_lib
onnx_lib.save(onnx_model, onnx_path)
size_kb = os.path.getsize(onnx_path) / 1024
print(f"  Saved: {onnx_path} ({size_kb:.1f} KB)")

# ─── Verificación ONNX Runtime ────────────────────────────────────────────────

import onnxruntime as ort
sess = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider'])
input_name  = sess.get_inputs()[0].name
output_name = sess.get_outputs()[1].name

sample = X_test_s[:5].astype(np.float32)
raw_out = sess.run([output_name], {input_name: sample})[0]
print("\nONNX verification (5 samples):")
for i, (row, label) in enumerate(zip(raw_out, y_test[:5])):
    p_bot = float(row[1]) if hasattr(row, '__len__') and len(row) > 1 else float(row)
    verdict = 'bot' if p_bot > best_threshold else 'human'
    print(f"  [{i}] p(bot)={p_bot:.3f}  pred={verdict}  true={'bot' if label else 'human'}")

# ─── Guardar artefactos (privados — en models/, no en public/) ────────────────

scaler_path   = os.path.join(out_dir, 'feature_scaler.json')
metadata_path = os.path.join(out_dir, 'model_metadata.json')

with open(scaler_path, 'w') as f:
    json.dump(scaler_params, f, indent=2)

# Metadata privado: incluye feature importances (NO exponer en public/)
metadata = {
    'version': '2.1.0',
    'features': FEATURES,
    'n_features': len(FEATURES),
    'model_type': 'XGBoostClassifier+IsolationForest',
    'ensemble': {'xgb_weight': 0.70, 'iso_weight': 0.30},
    'n_estimators_xgb': actual_trees,
    'n_estimators_iso': 300,
    'onnx_xgb_kb': round(size_kb, 1),
    'test_auc_xgb': round(float(auc), 4),
    'test_auc_iso': round(float(iso_auc), 4),
    'test_auc_ensemble': round(float(ens_auc), 4),
    'cv_auc_mean': round(float(np.mean(cv_aucs)), 4),
    'cv_auc_std':  round(float(np.std(cv_aucs)), 4),
    'optimal_threshold': round(ensemble_threshold, 3),
    'test_f1_ensemble': round(float(f1_ens), 4),
    'threshold': ensemble_threshold,
    'iso_norm_p5': round(iso_p5, 6),
    'iso_norm_p95': round(iso_p95, 6),
    'classes': ['human', 'bot'],
    'training_samples': len(X_train),
    'calibration': 'isotonic',
    'feature_importances': fi,   # privado — no exponer en whitepaper
    'scaler': scaler_params,
}
with open(metadata_path, 'w') as f:
    json.dump(metadata, f, indent=2)

print(f"\n{'='*60}")
print(f"  ✓ models/biometric-fraud-detector.onnx  ({size_kb:.1f} KB)")
print(f"  ✓ models/isoforest.onnx  (si disponible)")
print(f"  ✓ models/feature_scaler.json  (PRIVADO)")
print(f"  ✓ models/model_metadata.json  (PRIVADO)")
print(f"  XGBoost AUC:  {auc:.4f}")
print(f"  IsoForest AUC:{iso_auc:.4f}")
print(f"  Ensemble AUC: {ens_auc:.4f}")
print(f"  CV AUC:       {np.mean(cv_aucs):.4f} ± {np.std(cv_aucs):.4f}")
print(f"  Threshold:    {ensemble_threshold:.3f}")
print(f"  Ensemble F1:  {f1_ens:.4f}")
print(f"{'='*60}")
