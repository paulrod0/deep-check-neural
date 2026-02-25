"""
Deep-Check · Biometric Fraud Detector
======================================
Genera datos sintéticos, entrena XGBoost y exporta a ONNX.

Uso:
  pip install numpy pandas scikit-learn xgboost onnx onnxmltools skl2onnx
  python generate_and_train.py

Salida:
  biometric-fraud-detector.onnx   (~150 KB)
  feature_scaler.json             (mean/std para normalizar en JS)
  model_metadata.json             (feature names, thresholds, AUC)
"""

import json, os
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import roc_auc_score, classification_report
from xgboost import XGBClassifier

# ─── 1. Generación de datos sintéticos ────────────────────────────────────────

np.random.seed(42)
N = 60000

def clip(arr, lo, hi):
    return np.clip(arr, lo, hi)

def generate_humans(n):
    """Humanos normales — mecanografía variada, ritmo orgánico."""
    rng = np.random.default_rng(1)
    d = {}
    d['flight_mean']           = clip(rng.normal(130, 50, n), 40, 500)
    d['flight_std']            = clip(rng.normal(60, 25, n),  8, 200)
    d['hold_mean']             = clip(rng.normal(100, 30, n), 30, 350)
    d['hold_std']              = clip(rng.normal(24, 10, n),  4, 100)
    d['flight_skewness']       = clip(rng.normal(1.2, 0.7, n), -1, 5)
    d['flight_kurtosis']       = clip(rng.normal(1.8, 1.2, n), -1, 8)
    d['flight_entropy']        = clip(rng.normal(2.9, 0.5, n), 1.0, 4.5)
    d['hold_entropy']          = clip(rng.normal(2.4, 0.6, n), 0.5, 4.0)
    d['periodicity_score']     = clip(rng.normal(20, 12, n), 0, 70)
    d['velocity_gradient']     = clip(rng.normal(0.14, 0.10, n), -0.5, 0.8)
    d['fatigue_rate']          = clip(rng.normal(0.7, 0.5, n), -0.5, 3.0)
    d['rhythm_consistency']    = clip(rng.normal(35, 18, n), 5, 120)
    d['impossible_fast_ratio'] = clip(rng.normal(0.004, 0.006, n), 0, 0.05)
    d['digram_cv_mean']        = clip(rng.normal(0.38, 0.12, n), 0.05, 0.9)
    d['backspace_latency_std'] = clip(rng.normal(55, 25, n), 10, 200)
    d['backspace_count_ratio'] = clip(rng.normal(0.08, 0.04, n), 0, 0.35)
    d['burst_count_per_100k']  = clip(rng.normal(0.8, 0.9, n), 0, 6)
    d['session_wpm']           = clip(rng.normal(62, 22, n), 15, 180)
    d['label'] = np.zeros(n, dtype=int)
    return pd.DataFrame(d)

def generate_simple_bots(n):
    """Bots autotype: velocidad uniforme, entropia cero."""
    rng = np.random.default_rng(2)
    d = {}
    d['flight_mean']           = clip(rng.normal(45, 6, n), 20, 100)
    d['flight_std']            = clip(rng.normal(2.5, 1.0, n), 0.5, 10)
    d['hold_mean']             = clip(rng.normal(40, 5, n), 20, 80)
    d['hold_std']              = clip(rng.normal(1.5, 0.5, n), 0.3, 6)
    d['flight_skewness']       = clip(rng.normal(0.01, 0.05, n), -0.3, 0.3)
    d['flight_kurtosis']       = clip(rng.normal(9.5, 2.5, n), 4, 20)
    d['flight_entropy']        = clip(rng.normal(0.7, 0.3, n), 0.1, 2.0)
    d['hold_entropy']          = clip(rng.normal(0.6, 0.2, n), 0.1, 1.5)
    d['periodicity_score']     = clip(rng.normal(78, 8, n), 55, 98)
    d['velocity_gradient']     = clip(rng.normal(0.001, 0.002, n), -0.01, 0.01)
    d['fatigue_rate']          = clip(rng.normal(0.0, 0.01, n), -0.05, 0.05)
    d['rhythm_consistency']    = clip(rng.normal(3, 1.5, n), 0.5, 12)
    d['impossible_fast_ratio'] = clip(rng.normal(0.0, 0.002, n), 0, 0.01)
    d['digram_cv_mean']        = clip(rng.normal(0.03, 0.015, n), 0.005, 0.12)
    d['backspace_latency_std'] = clip(rng.normal(4, 2, n), 0.5, 15)
    d['backspace_count_ratio'] = clip(rng.normal(0.01, 0.005, n), 0, 0.05)
    d['burst_count_per_100k']  = clip(rng.normal(0.0, 0.05, n), 0, 0.3)
    d['session_wpm']           = clip(rng.normal(210, 30, n), 130, 350)
    d['label'] = np.ones(n, dtype=int)
    return pd.DataFrame(d)

def generate_llm_paste_bots(n):
    """ChatGPT/Copilot: largos silencios + paste bursts, casi sin backspaces."""
    rng = np.random.default_rng(3)
    d = {}
    d['flight_mean']           = clip(rng.normal(700, 150, n), 300, 1500)
    d['flight_std']            = clip(rng.normal(400, 120, n), 100, 1000)
    d['hold_mean']             = clip(rng.normal(110, 30, n), 50, 250)
    d['hold_std']              = clip(rng.normal(20, 8, n), 5, 60)
    d['flight_skewness']       = clip(rng.normal(3.5, 1.0, n), 1.5, 7)
    d['flight_kurtosis']       = clip(rng.normal(12, 4, n), 5, 30)
    d['flight_entropy']        = clip(rng.normal(1.8, 0.4, n), 0.8, 3.2)
    d['hold_entropy']          = clip(rng.normal(2.0, 0.5, n), 0.8, 3.5)
    d['periodicity_score']     = clip(rng.normal(28, 12, n), 8, 60)
    d['velocity_gradient']     = clip(rng.normal(-0.3, 0.15, n), -0.8, 0.1)
    d['fatigue_rate']          = clip(rng.normal(-0.5, 0.3, n), -2, 0.2)
    d['rhythm_consistency']    = clip(rng.normal(90, 25, n), 40, 200)
    d['impossible_fast_ratio'] = clip(rng.normal(0.002, 0.003, n), 0, 0.02)
    d['digram_cv_mean']        = clip(rng.normal(0.65, 0.20, n), 0.20, 1.2)
    d['backspace_latency_std'] = clip(rng.normal(80, 30, n), 20, 200)
    d['backspace_count_ratio'] = clip(rng.normal(0.015, 0.008, n), 0, 0.06)
    d['burst_count_per_100k']  = clip(rng.normal(12, 4, n), 4, 30)
    d['session_wpm']           = clip(rng.normal(38, 15, n), 10, 80)
    d['label'] = np.ones(n, dtype=int)
    return pd.DataFrame(d)

def generate_sophisticated_bots(n):
    """Bots avanzados que imitan distribución humana pero sin fatiga ni skewness real."""
    rng = np.random.default_rng(4)
    d = {}
    d['flight_mean']           = clip(rng.normal(120, 35, n), 50, 300)
    d['flight_std']            = clip(rng.normal(30, 8, n), 10, 70)   # std bajo pese a mean normal
    d['hold_mean']             = clip(rng.normal(95, 20, n), 40, 200)
    d['hold_std']              = clip(rng.normal(8, 3, n), 2, 25)
    d['flight_skewness']       = clip(rng.normal(0.1, 0.15, n), -0.5, 0.8)  # casi simetrico
    d['flight_kurtosis']       = clip(rng.normal(4.5, 1.5, n), 2, 10)
    d['flight_entropy']        = clip(rng.normal(1.8, 0.4, n), 0.8, 3.0)
    d['hold_entropy']          = clip(rng.normal(1.5, 0.4, n), 0.6, 2.8)
    d['periodicity_score']     = clip(rng.normal(45, 12, n), 20, 75)
    d['velocity_gradient']     = clip(rng.normal(0.005, 0.01, n), -0.02, 0.04)  # casi plano
    d['fatigue_rate']          = clip(rng.normal(0.02, 0.03, n), -0.1, 0.15)    # sin fatiga real
    d['rhythm_consistency']    = clip(rng.normal(12, 5, n), 3, 30)
    d['impossible_fast_ratio'] = clip(rng.normal(0.001, 0.002, n), 0, 0.01)
    d['digram_cv_mean']        = clip(rng.normal(0.12, 0.05, n), 0.04, 0.30)
    d['backspace_latency_std'] = clip(rng.normal(12, 5, n), 2, 40)
    d['backspace_count_ratio'] = clip(rng.normal(0.03, 0.01, n), 0, 0.12)
    d['burst_count_per_100k']  = clip(rng.normal(0.3, 0.3, n), 0, 2)
    d['session_wpm']           = clip(rng.normal(95, 20, n), 50, 180)
    d['label'] = np.ones(n, dtype=int)
    return pd.DataFrame(d)

def generate_nervous_humans(n):
    """Humanos bajo presión: ritmo alterado pero no bots."""
    rng = np.random.default_rng(5)
    d = {}
    d['flight_mean']           = clip(rng.normal(160, 70, n), 50, 600)
    d['flight_std']            = clip(rng.normal(85, 35, n), 20, 300)
    d['hold_mean']             = clip(rng.normal(110, 40, n), 30, 400)
    d['hold_std']              = clip(rng.normal(30, 15, n), 5, 120)
    d['flight_skewness']       = clip(rng.normal(1.8, 0.9, n), 0.2, 5)
    d['flight_kurtosis']       = clip(rng.normal(2.5, 1.5, n), 0, 8)
    d['flight_entropy']        = clip(rng.normal(2.6, 0.6, n), 1.2, 4.2)
    d['hold_entropy']          = clip(rng.normal(2.2, 0.6, n), 0.8, 3.8)
    d['periodicity_score']     = clip(rng.normal(22, 14, n), 2, 65)
    d['velocity_gradient']     = clip(rng.normal(0.20, 0.18, n), -0.4, 0.9)
    d['fatigue_rate']          = clip(rng.normal(1.2, 0.7, n), 0, 4)
    d['rhythm_consistency']    = clip(rng.normal(55, 25, n), 10, 160)
    d['impossible_fast_ratio'] = clip(rng.normal(0.006, 0.008, n), 0, 0.06)
    d['digram_cv_mean']        = clip(rng.normal(0.42, 0.15, n), 0.10, 0.95)
    d['backspace_latency_std'] = clip(rng.normal(65, 30, n), 10, 250)
    d['backspace_count_ratio'] = clip(rng.normal(0.12, 0.06, n), 0.01, 0.45)
    d['burst_count_per_100k']  = clip(rng.normal(1.2, 1.0, n), 0, 7)
    d['session_wpm']           = clip(rng.normal(48, 18, n), 12, 120)
    d['label'] = np.zeros(n, dtype=int)
    return pd.DataFrame(d)

# Proporciones realistas del dataset
splits = {
    'humans':             int(N * 0.40),
    'nervous_humans':     int(N * 0.15),
    'simple_bots':        int(N * 0.18),
    'llm_paste':          int(N * 0.15),
    'sophisticated_bots': int(N * 0.12),
}

print("Generating synthetic dataset...")
df = pd.concat([
    generate_humans(splits['humans']),
    generate_nervous_humans(splits['nervous_humans']),
    generate_simple_bots(splits['simple_bots']),
    generate_llm_paste_bots(splits['llm_paste']),
    generate_sophisticated_bots(splits['sophisticated_bots']),
], ignore_index=True).sample(frac=1, random_state=42).reset_index(drop=True)

print(f"Dataset shape: {df.shape}")
print(f"Class balance: {df['label'].value_counts().to_dict()}")

FEATURES = [
    'flight_mean', 'flight_std', 'hold_mean', 'hold_std',
    'flight_skewness', 'flight_kurtosis', 'flight_entropy', 'hold_entropy',
    'periodicity_score', 'velocity_gradient', 'fatigue_rate', 'rhythm_consistency',
    'impossible_fast_ratio', 'digram_cv_mean',
    'backspace_latency_std', 'backspace_count_ratio',
    'burst_count_per_100k', 'session_wpm',
]

X = df[FEATURES].values.astype(np.float32)
y = df['label'].values

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.15, random_state=42, stratify=y
)
X_train, X_val, y_train, y_val = train_test_split(
    X_train, y_train, test_size=0.12, random_state=42, stratify=y_train
)

print(f"Train: {len(X_train)}, Val: {len(X_val)}, Test: {len(X_test)}")

# ─── 2. Normalización ──────────────────────────────────────────────────────────

scaler = StandardScaler()
X_train_s = scaler.fit_transform(X_train)
X_val_s   = scaler.transform(X_val)
X_test_s  = scaler.transform(X_test)

# Guardar parámetros del scaler para normalización en JS/TS
scaler_params = {
    'features': FEATURES,
    'mean': scaler.mean_.tolist(),
    'std':  scaler.scale_.tolist(),
}
with open('feature_scaler.json', 'w') as f:
    json.dump(scaler_params, f, indent=2)
print("Saved feature_scaler.json")

# ─── 3. Entrenamiento XGBoost ──────────────────────────────────────────────────

print("\nTraining XGBoost model...")
model = XGBClassifier(
    n_estimators=300,
    max_depth=5,
    learning_rate=0.08,
    subsample=0.8,
    colsample_bytree=0.8,
    min_child_weight=3,
    reg_alpha=0.1,
    reg_lambda=1.0,
    scale_pos_weight=1,       # clases balanceadas
    eval_metric='auc',
    early_stopping_rounds=25,
    random_state=42,
    n_jobs=-1,
    tree_method='hist',
)

model.fit(
    X_train_s, y_train,
    eval_set=[(X_val_s, y_val)],
    verbose=50,
)

# Evaluación
y_prob_test = model.predict_proba(X_test_s)[:, 1]
y_pred_test = (y_prob_test > 0.5).astype(int)
auc = roc_auc_score(y_test, y_prob_test)

print(f"\nTest AUC-ROC: {auc:.4f}")
print(classification_report(y_test, y_pred_test, target_names=['human', 'bot']))

# Feature importance
fi = pd.DataFrame({'feature': FEATURES, 'importance': model.feature_importances_})
fi = fi.sort_values('importance', ascending=False)
print("\nTop-10 feature importances:")
print(fi.head(10).to_string(index=False))

# ─── 4. Exportar a ONNX ───────────────────────────────────────────────────────

print("\nExporting to ONNX...")
from skl2onnx.common.data_types import FloatTensorType

# XGBoost → ONNX via onnxmltools (path 1) or skl2onnx to_onnx (path 2)
onnx_model = None
try:
    from onnxmltools import convert_xgboost
    from onnxmltools.convert.common.data_types import FloatTensorType as OnnxFloat
    onnx_model = convert_xgboost(
        model,
        initial_types=[('input', OnnxFloat([None, len(FEATURES)]))],
    )
    print("Used onnxmltools path")
except Exception as e1:
    print(f"onnxmltools failed ({e1}), trying skl2onnx...")
    try:
        from skl2onnx import to_onnx
        initial_type = [('float_input', FloatTensorType([None, len(FEATURES)]))]
        onnx_model = to_onnx(model, X_train_s[:1].astype(np.float32),
                              initial_types=initial_type,
                              options={'zipmap': False})
        print("Used skl2onnx path")
    except Exception as e2:
        print(f"skl2onnx failed ({e2}), trying native XGBoost ONNX...")
        model.save_model('model_xgb.json')
        import subprocess, sys
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', 'onnxconverter-common'])
        from xgboost import XGBClassifier
        # Rebuild a tiny model for export if above fails
        raise RuntimeError(f"Could not export to ONNX. Errors: {e1} | {e2}")

import onnx
onnx_path = 'biometric-fraud-detector.onnx'
onnx.save(onnx_model, onnx_path)
size_kb = os.path.getsize(onnx_path) / 1024
print(f"Saved {onnx_path} ({size_kb:.1f} KB)")

# ─── 5. Verificación con ONNX Runtime ─────────────────────────────────────────

import onnxruntime as ort
sess = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider'])
input_name  = sess.get_inputs()[0].name
output_name = sess.get_outputs()[1].name   # probabilities

sample = X_test_s[:5].astype(np.float32)
probs  = sess.run([output_name], {input_name: sample})[0]
print("\nONNX verification (5 samples):")
for i, (prob, label) in enumerate(zip(probs, y_test[:5])):
    # prob puede ser array [[p_human, p_bot]] o dict
    if hasattr(prob, '__iter__') and not isinstance(prob, dict):
        p_bot = float(prob[1]) if len(prob) > 1 else float(prob[0])
    else:
        p_bot = float(prob.get(1, 0))
    print(f"  Sample {i}: bot_prob={p_bot:.3f}, true_label={label}")

# ─── 6. Metadata ──────────────────────────────────────────────────────────────

metadata = {
    'version': '1.0.0',
    'features': FEATURES,
    'n_features': len(FEATURES),
    'model_type': 'XGBoostClassifier',
    'n_estimators': model.n_estimators,
    'onnx_size_kb': round(size_kb, 1),
    'test_auc': round(auc, 4),
    'threshold': 0.5,
    'classes': ['human', 'bot'],
    'training_samples': len(X_train),
    'feature_importances': dict(zip(FEATURES, model.feature_importances_.tolist())),
    'scaler': scaler_params,
}
with open('model_metadata.json', 'w') as f:
    json.dump(metadata, f, indent=2)
print("\nSaved model_metadata.json")
print("\n✓ Training complete! Copy these files to public/models/ in the Next.js project:")
print(f"  - {onnx_path}")
print(f"  - model_metadata.json")
