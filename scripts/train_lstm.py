"""
Deep-Check · Biometric LSTM v1.0  (rama feat/neural-lstm)
==========================================================
Red neuronal recurrente sobre secuencias brutas de pulsaciones.

Ventaja sobre XGBoost:
  - No necesita features manuales: aprende patrones temporales directamente
  - Detecta micro-ritmos sub-100ms que las estadísticas agregadas pierden
  - Bidireccional: captura contexto anterior y posterior de cada tecla
  - Generaliza mejor a bots nuevos no vistos durante el entrenamiento

Arquitectura:
  Input  → [batch, SEQ_LEN, 4]    (flight, hold, delta_flight, delta_hold)
  BiLSTM → [batch, SEQ_LEN, 128]  (64 forward + 64 backward)
  BiLSTM → [batch, SEQ_LEN, 64]   (segunda capa)
  Pool   → [batch, 64]            (attention-weighted pooling)
  MLP    → [batch, 32] → [batch, 1]
  Sigmoid → probabilidad de bot

Ensemble final (api/ml-score-v2):
  0.50 × XGBoost  +  0.25 × IsoForest  +  0.25 × LSTM

Uso:
  python3 scripts/train_lstm.py
"""

import json, os, math, sys
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from sklearn.metrics import roc_auc_score, f1_score, classification_report
from sklearn.model_selection import train_test_split

np.random.seed(42)
torch.manual_seed(42)

# ─── Config ───────────────────────────────────────────────────────────────────

SEQ_LEN   = 120     # keystroke events por sesión (padding/truncado)
N_FEAT    = 4       # features por timestep: flight, hold, Δflight, Δhold
N_SESSIONS = 80_000  # sesiones sintéticas totales
BATCH_SIZE = 512
EPOCHS     = 40
LR         = 3e-4
DEVICE     = 'cpu'  # Vercel CPU inference — CPU es suficiente

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'models', 'lstm')
os.makedirs(OUT_DIR, exist_ok=True)

# ─── Generadores de secuencias brutas ─────────────────────────────────────────

def human_sequence(n_keys, rng, archetype='normal'):
    """Genera una secuencia de (flight_ms, hold_ms) con variabilidad humana."""
    if archetype == 'normal':
        base_flight = rng.normal(130, 55)
        base_hold   = rng.normal(100, 30)
        noise_f     = 55 + abs(rng.normal(0, 15))
        noise_h     = 30 + abs(rng.normal(0, 10))
        fatigue     = rng.uniform(0.0, 0.003)   # aceleración / fatiga leve
    elif archetype == 'fast':
        base_flight = rng.normal(70, 20)
        base_hold   = rng.normal(68, 18)
        noise_f, noise_h = 22, 18
        fatigue     = rng.uniform(-0.001, 0.002)
    elif archetype == 'nervous':
        base_flight = rng.normal(165, 75)
        base_hold   = rng.normal(115, 45)
        noise_f, noise_h = 80, 50
        fatigue     = rng.uniform(0.002, 0.008)
    else:  # mobile
        base_flight = rng.normal(280, 90)
        base_hold   = rng.normal(160, 50)
        noise_f, noise_h = 140, 55
        fatigue     = rng.uniform(0.001, 0.005)

    flights, holds = [], []
    for i in range(n_keys):
        drift = 1.0 + fatigue * i
        # skewness real: mezcla lognormal + uniforme
        f = abs(rng.lognormal(math.log(max(base_flight * drift, 10)), 0.35)) + rng.uniform(0, noise_f * 0.2)
        h = abs(rng.lognormal(math.log(max(base_hold, 10)), 0.25)) + rng.uniform(0, noise_h * 0.1)
        flights.append(np.clip(f, 8, 1200))
        holds.append(np.clip(h, 10, 500))

    return np.array(flights, dtype=np.float32), np.array(holds, dtype=np.float32)


def bot_sequence(n_keys, rng, archetype='simple'):
    """Genera secuencia de bot con el patrón característico de cada tipo."""
    if archetype == 'simple':
        # Autotype clásico: intervalo fijo ± ruido mínimo
        base_f = rng.uniform(30, 60)
        base_h = rng.uniform(25, 50)
        flights = np.clip(rng.normal(base_f, 1.5, n_keys), 5, 100).astype(np.float32)
        holds   = np.clip(rng.normal(base_h, 1.0, n_keys), 5, 80).astype(np.float32)

    elif archetype == 'llm_paste':
        # Largos silencios + burst de pulsaciones ultrarrápidas
        flights = []
        holds   = []
        i = 0
        while i < n_keys:
            if rng.random() < 0.12:   # evento paste
                burst = rng.integers(5, 25)
                for _ in range(min(burst, n_keys - i)):
                    flights.append(np.clip(rng.normal(8, 3), 2, 25))
                    holds.append(np.clip(rng.normal(20, 5), 5, 40))
                    i += 1
            else:
                flights.append(np.clip(rng.normal(750, 200), 100, 3000))
                holds.append(np.clip(rng.normal(110, 30), 40, 250))
                i += 1
        flights = np.array(flights[:n_keys], dtype=np.float32)
        holds   = np.array(holds[:n_keys],   dtype=np.float32)

    elif archetype == 'sophisticated':
        # Imita media humana pero con std artificialmente bajo
        base_f = rng.normal(115, 20)
        base_h = rng.normal(90, 15)
        flights = np.clip(rng.normal(base_f, 6, n_keys), 20, 300).astype(np.float32)
        holds   = np.clip(rng.normal(base_h, 3, n_keys), 20, 200).astype(np.float32)

    elif archetype == 'sinusoidal':
        # NUEVO: bot que añade ruido sinusoidal para simular fatiga
        t      = np.linspace(0, 2 * np.pi, n_keys)
        base_f = rng.uniform(80, 140)
        amp    = rng.uniform(5, 25)
        noise  = rng.normal(0, 3, n_keys)
        flights = np.clip(base_f + amp * np.sin(t) + noise, 10, 400).astype(np.float32)
        holds   = np.clip(rng.normal(80, 4, n_keys), 20, 150).astype(np.float32)

    else:  # slow
        base_f = rng.uniform(180, 300)
        flights = np.clip(rng.normal(base_f, 8, n_keys), 50, 600).astype(np.float32)
        holds   = np.clip(rng.normal(130, 5, n_keys), 40, 300).astype(np.float32)

    return flights, holds


def make_tensor(flights, holds):
    """
    Convierte (flights, holds) en tensor [SEQ_LEN, 4]:
      canal 0: flight (normalizado)
      canal 1: hold   (normalizado)
      canal 2: Δflight (primera diferencia — captura aceleración/fatiga)
      canal 3: Δhold
    """
    f = np.array(flights, dtype=np.float32)
    h = np.array(holds,   dtype=np.float32)

    df = np.diff(f, prepend=f[0])
    dh = np.diff(h, prepend=h[0])

    seq = np.stack([f, h, df, dh], axis=1)  # [n_keys, 4]

    # Pad o truncar a SEQ_LEN
    if len(seq) >= SEQ_LEN:
        seq = seq[:SEQ_LEN]
    else:
        pad = np.zeros((SEQ_LEN - len(seq), N_FEAT), dtype=np.float32)
        seq = np.vstack([seq, pad])

    return seq   # [SEQ_LEN, 4]


# ─── Dataset ──────────────────────────────────────────────────────────────────

print("=" * 60)
print("Deep-Check · LSTM Training v1.0")
print("=" * 60)
print(f"\nGenerating {N_SESSIONS:,} synthetic keystroke sequences...")

rng = np.random.default_rng(42)

human_archetypes = ['normal', 'fast', 'nervous', 'mobile']
bot_archetypes   = ['simple', 'llm_paste', 'sophisticated', 'sinusoidal', 'slow']

human_weights = [0.40, 0.20, 0.25, 0.15]
bot_weights   = [0.20, 0.22, 0.28, 0.15, 0.15]

n_human = int(N_SESSIONS * 0.55)
n_bot   = N_SESSIONS - n_human

print(f"  Humans: {n_human:,}  ({n_human/N_SESSIONS*100:.0f}%)")
print(f"  Bots:   {n_bot:,}  ({n_bot/N_SESSIONS*100:.0f}%)")

X_list, y_list = [], []

# Humanos
h_arch = rng.choice(human_archetypes, size=n_human, p=human_weights)
for arch in h_arch:
    n_keys = int(rng.integers(60, 200))
    f, h   = human_sequence(n_keys, rng, archetype=arch)
    X_list.append(make_tensor(f, h))
    y_list.append(0)

# Bots
b_arch = rng.choice(bot_archetypes, size=n_bot, p=bot_weights)
for arch in b_arch:
    n_keys = int(rng.integers(60, 200))
    f, h   = bot_sequence(n_keys, rng, archetype=arch)
    X_list.append(make_tensor(f, h))
    y_list.append(1)

X = np.stack(X_list)          # [N, SEQ_LEN, 4]
y = np.array(y_list, np.int64)

# Shuffle
idx = rng.permutation(len(X))
X, y = X[idx], y[idx]

# Normalización global por canal
mean = X.mean(axis=(0, 1), keepdims=True)   # [1, 1, 4]
std  = X.std(axis=(0, 1), keepdims=True) + 1e-8
X = ((X - mean) / std).astype(np.float32)

norm_params = {
    'mean': mean.squeeze().tolist(),
    'std':  std.squeeze().tolist(),
    'seq_len': SEQ_LEN,
    'n_features': N_FEAT,
}

print(f"  Tensor shape: {X.shape}")

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.15, random_state=42, stratify=y
)
X_train, X_val, y_train, y_val = train_test_split(
    X_train, y_train, test_size=0.176, random_state=42, stratify=y_train
)

print(f"  Train: {len(X_train):,}  Val: {len(X_val):,}  Test: {len(X_test):,}")


class KeystrokeDataset(Dataset):
    def __init__(self, X, y):
        self.X = torch.tensor(X)
        self.y = torch.tensor(y, dtype=torch.float32)
    def __len__(self):  return len(self.X)
    def __getitem__(self, i): return self.X[i], self.y[i]


train_dl = DataLoader(KeystrokeDataset(X_train, y_train), batch_size=BATCH_SIZE, shuffle=True,  num_workers=0)
val_dl   = DataLoader(KeystrokeDataset(X_val,   y_val),   batch_size=BATCH_SIZE, shuffle=False, num_workers=0)
test_dl  = DataLoader(KeystrokeDataset(X_test,  y_test),  batch_size=BATCH_SIZE, shuffle=False, num_workers=0)

# ─── Modelo ───────────────────────────────────────────────────────────────────

class AttentionPool(nn.Module):
    """Attention-weighted temporal pooling — da más peso a eventos discriminativos."""
    def __init__(self, hidden_dim):
        super().__init__()
        self.attn = nn.Linear(hidden_dim, 1)

    def forward(self, x):           # x: [B, T, H]
        w = torch.softmax(self.attn(x), dim=1)   # [B, T, 1]
        return (x * w).sum(dim=1)                # [B, H]


class BiLSTMClassifier(nn.Module):
    """
    Bidirectional LSTM para detección de bots en secuencias de pulsaciones.

    - Capa 1: BiLSTM(4→128)  — captura patrones locales (digrams, bursts)
    - Capa 2: BiLSTM(128→64) — captura ritmo global y evolución temporal
    - AttentionPool           — foco en los eventos más informativos
    - MLP(64→32→1) + Sigmoid  — clasificación final
    """
    def __init__(self, input_size=4, hidden1=64, hidden2=32, dropout=0.35):
        super().__init__()
        self.lstm1 = nn.LSTM(
            input_size, hidden1,
            num_layers=1, batch_first=True,
            bidirectional=True, dropout=0,
        )
        self.norm1 = nn.LayerNorm(hidden1 * 2)
        self.drop1 = nn.Dropout(dropout)

        self.lstm2 = nn.LSTM(
            hidden1 * 2, hidden2,
            num_layers=1, batch_first=True,
            bidirectional=True, dropout=0,
        )
        self.norm2 = nn.LayerNorm(hidden2 * 2)
        self.pool  = AttentionPool(hidden2 * 2)

        self.mlp = nn.Sequential(
            nn.Linear(hidden2 * 2, 32),
            nn.GELU(),
            nn.Dropout(dropout * 0.5),
            nn.Linear(32, 1),
        )

    def forward(self, x):           # x: [B, SEQ_LEN, 4]
        out, _ = self.lstm1(x)      # [B, T, 128]
        out     = self.drop1(self.norm1(out))
        out, _ = self.lstm2(out)    # [B, T, 64]
        out     = self.norm2(out)
        pooled  = self.pool(out)    # [B, 64]
        logit   = self.mlp(pooled)  # [B, 1]
        return torch.sigmoid(logit).squeeze(1)   # [B]


model = BiLSTMClassifier().to(DEVICE)
n_params = sum(p.numel() for p in model.parameters())
print(f"\nModel: BiLSTM + AttentionPool  ({n_params:,} parameters)")

# ─── Entrenamiento ─────────────────────────────────────────────────────────────

pos_weight = torch.tensor([n_human / n_bot], dtype=torch.float32)
criterion  = nn.BCELoss()
optimizer  = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=1e-4)
scheduler  = torch.optim.lr_scheduler.OneCycleLR(
    optimizer, max_lr=LR * 5,
    steps_per_epoch=len(train_dl), epochs=EPOCHS,
    pct_start=0.15,
)

best_val_auc = 0.0
best_state   = None
patience     = 8
no_improve   = 0

print(f"\nTraining {EPOCHS} epochs (batch={BATCH_SIZE}, lr={LR})...\n")
print(f"{'Epoch':>5}  {'Loss':>8}  {'Val AUC':>8}  {'Val F1':>8}")
print("─" * 40)

for epoch in range(1, EPOCHS + 1):
    model.train()
    total_loss = 0.0
    for xb, yb in train_dl:
        xb, yb = xb.to(DEVICE), yb.to(DEVICE)
        optimizer.zero_grad()
        pred = model(xb)
        loss = criterion(pred, yb)
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        scheduler.step()
        total_loss += loss.item() * len(xb)

    avg_loss = total_loss / len(X_train)

    # Validation
    model.eval()
    val_probs, val_labels = [], []
    with torch.no_grad():
        for xb, yb in val_dl:
            p = model(xb.to(DEVICE)).cpu().numpy()
            val_probs.extend(p)
            val_labels.extend(yb.numpy())

    val_probs  = np.array(val_probs)
    val_labels = np.array(val_labels)
    val_auc    = roc_auc_score(val_labels, val_probs)
    val_pred   = (val_probs > 0.5).astype(int)
    val_f1     = f1_score(val_labels, val_pred)

    print(f"{epoch:>5}  {avg_loss:>8.4f}  {val_auc:>8.4f}  {val_f1:>8.4f}")

    if val_auc > best_val_auc:
        best_val_auc = val_auc
        best_state   = {k: v.clone() for k, v in model.state_dict().items()}
        no_improve   = 0
    else:
        no_improve += 1
        if no_improve >= patience:
            print(f"\n  Early stopping at epoch {epoch} (best val AUC={best_val_auc:.4f})")
            break

# ─── Evaluación final ─────────────────────────────────────────────────────────

model.load_state_dict(best_state)
model.eval()

test_probs, test_labels = [], []
with torch.no_grad():
    for xb, yb in test_dl:
        p = model(xb.to(DEVICE)).cpu().numpy()
        test_probs.extend(p)
        test_labels.extend(yb.numpy())

test_probs  = np.array(test_probs)
test_labels = np.array(test_labels)
test_auc    = roc_auc_score(test_labels, test_probs)
test_pred   = (test_probs > 0.5).astype(int)
test_f1     = f1_score(test_labels, test_pred)

print(f"\n{'─'*40}")
print(f"  Test AUC-ROC:  {test_auc:.4f}")
print(f"  Test F1:       {test_f1:.4f}")
print(f"{'─'*40}")
print(classification_report(test_labels, test_pred, target_names=['human', 'bot']))

# ─── Export a ONNX ────────────────────────────────────────────────────────────

print("Exporting to ONNX...")

# ONNX necesita input fijo — usamos SEQ_LEN x N_FEAT
dummy = torch.randn(1, SEQ_LEN, N_FEAT, dtype=torch.float32)
onnx_path = os.path.join(OUT_DIR, 'lstm_model.onnx')

torch.onnx.export(
    model,
    dummy,
    onnx_path,
    input_names  = ['keystroke_sequence'],
    output_names = ['bot_probability'],
    dynamic_axes = {
        'keystroke_sequence': {0: 'batch_size'},
        'bot_probability':    {0: 'batch_size'},
    },
    opset_version = 17,
    do_constant_folding = True,
)

size_kb = os.path.getsize(onnx_path) / 1024
print(f"  Saved: {onnx_path} ({size_kb:.1f} KB)")

# Verificar con ONNX Runtime
try:
    import onnxruntime as ort
    sess     = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider'])
    inp_name = sess.get_inputs()[0].name
    out_name = sess.get_outputs()[0].name
    sample   = dummy.numpy()
    result   = sess.run([out_name], {inp_name: sample})[0]
    print(f"  ONNX verification: p(bot)={result[0]:.4f}  ✓")
except Exception as e:
    print(f"  ONNX verification skipped: {e}")

# ─── Guardar metadatos ────────────────────────────────────────────────────────

metadata = {
    'version':       '1.0.0',
    'model_type':    'BiLSTM+AttentionPool',
    'architecture': {
        'lstm1_hidden':  64,
        'lstm2_hidden':  32,
        'bidirectional': True,
        'pooling':       'attention',
        'n_params':      n_params,
    },
    'seq_len':       SEQ_LEN,
    'n_features':    N_FEAT,
    'feature_names': ['flight_ms', 'hold_ms', 'delta_flight', 'delta_hold'],
    'training_samples': len(X_train),
    'best_val_auc':  round(float(best_val_auc), 4),
    'test_auc':      round(float(test_auc), 4),
    'test_f1':       round(float(test_f1), 4),
    'threshold':     0.5,
    'normalization': norm_params,
    'ensemble_role': 'third_layer',
    'ensemble_weight': 0.25,
    'note': ('LSTM trained on raw keystroke sequences. No hand-crafted features. '
             'Detects temporal micro-patterns invisible to statistical aggregation.'),
}

with open(os.path.join(OUT_DIR, 'lstm_metadata.json'), 'w') as f:
    json.dump(metadata, f, indent=2)

with open(os.path.join(OUT_DIR, 'lstm_scaler.json'), 'w') as f:
    json.dump(norm_params, f, indent=2)

print(f"\n{'='*60}")
print(f"  ✓ models/lstm/lstm_model.onnx      ({size_kb:.1f} KB)")
print(f"  ✓ models/lstm/lstm_metadata.json")
print(f"  ✓ models/lstm/lstm_scaler.json")
print(f"  Best Val AUC:  {best_val_auc:.4f}")
print(f"  Test AUC:      {test_auc:.4f}")
print(f"  Test F1:       {test_f1:.4f}")
print(f"  Parameters:    {n_params:,}")
print(f"{'='*60}")
print()
print("Next step: Ensemble en /api/ml-score-v2")
print("  0.50 × XGBoost  +  0.25 × IsoForest  +  0.25 × LSTM")
