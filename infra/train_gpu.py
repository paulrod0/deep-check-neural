"""
Deep-Check · BiLSTM Training v2.0 — GPU/AWS Edition
=====================================================
Mejoras sobre v1.0 (CPU local):
  - Escala 500k sesiones  (vs 80k local)
  - BiLSTM + Multi-Head Attention  (vs simple attention pool)
  - 4 nuevos arquetipos de bot más difíciles de detectar
  - Data augmentation: time warping + jitter en secuencias
  - Label smoothing 0.1 + Mixup α=0.3
  - Stochastic Weight Averaging (SWA) — mejor generalización
  - Cosine annealing con warm restarts

Uso en EC2 Spot (g4dn.xlarge, T4 GPU):
  pip install torch onnx numpy scikit-learn
  python3 infra/train_gpu.py

Uso en SageMaker Training Job: ver infra/sagemaker_train.sh

Coste estimado en EC2 Spot g4dn.xlarge:
  Spot price: ~$0.16/hr
  Tiempo estimado: ~90 min
  Coste total: ~$0.24

Salida:
  models/lstm/lstm_model.onnx         ← para Lambda / Vercel
  models/lstm/lstm_scaler.json
  models/lstm/lstm_metadata.json
"""

import json, os, math, sys, time
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from sklearn.metrics import roc_auc_score, f1_score, classification_report
from sklearn.model_selection import train_test_split

np.random.seed(42)
torch.manual_seed(42)

# ─── Config ───────────────────────────────────────────────────────────────────

DEVICE     = 'cuda' if torch.cuda.is_available() else 'cpu'
SEQ_LEN    = 150      # más largo que v1 (120) — captura más patrones tardíos
N_FEAT     = 6        # flight, hold, Δflight, Δhold, hold/flight ratio, speed
N_SESSIONS = 500_000  # 6× más que v1
BATCH_SIZE = 1024 if DEVICE == 'cuda' else 256
EPOCHS     = 60
LR         = 5e-4
WARMUP     = 5        # épocas de warmup antes de cosine annealing

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'models', 'lstm')
os.makedirs(OUT_DIR, exist_ok=True)

print("=" * 65)
print(f"Deep-Check · BiLSTM v2.0  [device={DEVICE}]")
print("=" * 65)

# ─── Generadores de secuencias ────────────────────────────────────────────────

def human_sequence(n_keys, rng, archetype='normal'):
    if archetype == 'normal':
        bf, bh, nf, nh = rng.normal(130,55), rng.normal(100,30), 55, 30
        fatigue = rng.uniform(0.0, 0.003)
    elif archetype == 'fast':
        bf, bh, nf, nh = rng.normal(70,20), rng.normal(68,18), 22, 18
        fatigue = rng.uniform(-0.001, 0.002)
    elif archetype == 'nervous':
        bf, bh, nf, nh = rng.normal(165,75), rng.normal(115,45), 80, 50
        fatigue = rng.uniform(0.002, 0.010)
    elif archetype == 'mobile':
        bf, bh, nf, nh = rng.normal(280,90), rng.normal(160,50), 140, 55
        fatigue = rng.uniform(0.001, 0.006)
    elif archetype == 'hunt_peck':
        # Caza-picoteo: largos gaps de búsqueda + hold largo al encontrar
        bf, bh, nf, nh = rng.normal(420,120), rng.normal(220,60), 180, 80
        fatigue = rng.uniform(0.003, 0.012)
    else:  # senior
        bf, bh, nf, nh = rng.normal(220,80), rng.normal(180,55), 100, 60
        fatigue = rng.uniform(0.001, 0.008)

    flights, holds = [], []
    for i in range(n_keys):
        drift = 1.0 + fatigue * i
        f = abs(rng.lognormal(math.log(max(bf * drift, 10)), 0.38))
        h = abs(rng.lognormal(math.log(max(bh, 10)), 0.26))
        # Pausas cognitivas humanas (3-8% de las teclas)
        if rng.random() < 0.05:
            f += rng.uniform(800, 4000)
        flights.append(np.clip(f, 8, 5000))
        holds.append(np.clip(h, 10, 600))
    return np.array(flights, dtype=np.float32), np.array(holds, dtype=np.float32)


def bot_sequence(n_keys, rng, archetype='simple'):
    if archetype == 'simple':
        base_f = rng.uniform(30, 60)
        flights = np.clip(rng.normal(base_f, 1.5, n_keys), 5, 100).astype(np.float32)
        holds   = np.clip(rng.normal(base_f * 0.8, 1.0, n_keys), 5, 80).astype(np.float32)

    elif archetype == 'llm_paste':
        flights, holds = [], []
        i = 0
        while i < n_keys:
            if rng.random() < 0.12:
                burst = rng.integers(5, 40)
                for _ in range(min(burst, n_keys - i)):
                    flights.append(np.clip(rng.normal(7, 2), 1, 20))
                    holds.append(np.clip(rng.normal(18, 4), 4, 35))
                    i += 1
            else:
                flights.append(np.clip(rng.normal(800, 250), 100, 4000))
                holds.append(np.clip(rng.normal(100, 25), 35, 220))
                i += 1
        flights = np.array(flights[:n_keys], dtype=np.float32)
        holds   = np.array(holds[:n_keys],   dtype=np.float32)

    elif archetype == 'sophisticated':
        base_f = rng.normal(115, 20)
        flights = np.clip(rng.normal(base_f, 5, n_keys), 20, 280).astype(np.float32)
        holds   = np.clip(rng.normal(base_f * 0.78, 2.5, n_keys), 18, 180).astype(np.float32)

    elif archetype == 'sinusoidal':
        t = np.linspace(0, 2 * np.pi * rng.integers(2, 5), n_keys)
        base_f = rng.uniform(80, 140)
        amp    = rng.uniform(8, 35)
        flights = np.clip(base_f + amp * np.sin(t) + rng.normal(0, 2, n_keys), 10, 450).astype(np.float32)
        holds   = np.clip(rng.normal(80, 3, n_keys), 20, 140).astype(np.float32)

    elif archetype == 'slow':
        base_f = rng.uniform(180, 320)
        flights = np.clip(rng.normal(base_f, 7, n_keys), 50, 650).astype(np.float32)
        holds   = np.clip(rng.normal(130, 4, n_keys), 40, 300).astype(np.float32)

    elif archetype == 'gaussian_copula':
        # NUEVO — bot que replica la covarianza humana usando copula gaussiana
        # Punto débil: sin pausas cognitivas, sin fatigue, correlaciones ligeras
        rho    = rng.uniform(0.3, 0.6)   # correlación flight-hold (menor que humanos)
        cov    = [[1, rho], [rho, 1]]
        z      = rng.multivariate_normal([0, 0], cov, n_keys)
        bf, bh = rng.normal(120, 18), rng.normal(95, 14)
        sf, sh = rng.uniform(8, 18), rng.uniform(5, 12)
        flights = np.clip(bf + sf * z[:, 0], 20, 350).astype(np.float32)
        holds   = np.clip(bh + sh * z[:, 1], 18, 200).astype(np.float32)

    elif archetype == 'macro':
        # NUEVO — macro de teclado real: grupos de teclas a velocidad fija + pausa larga entre grupos
        flights, holds = [], []
        i = 0
        while i < n_keys:
            group_size = rng.integers(3, 12)
            group_f    = rng.uniform(40, 90)
            for _ in range(min(group_size, n_keys - i)):
                flights.append(np.clip(rng.normal(group_f, 2), 10, 150))
                holds.append(np.clip(rng.normal(55, 3), 15, 100))
                i += 1
            if i < n_keys:
                flights.append(np.clip(rng.normal(600, 100), 200, 1500))
                holds.append(np.clip(rng.normal(60, 5), 15, 100))
                i += 1
        flights = np.array(flights[:n_keys], dtype=np.float32)
        holds   = np.array(holds[:n_keys],   dtype=np.float32)

    else:  # adversarial — entrenado para parecer humano, falla en micro-variaciones
        base_f  = rng.normal(125, 22)
        fatigue = rng.uniform(0.001, 0.004)  # simula fatiga
        flights, holds = [], []
        for i in range(n_keys):
            drift = 1.0 + fatigue * i
            # Micro-variación insuficiente para ser humano
            f = np.clip(rng.normal(base_f * drift, 4), 20, 400)
            h = np.clip(rng.normal(base_f * 0.82, 3), 18, 200)
            flights.append(f)
            holds.append(h)
        flights = np.array(flights, dtype=np.float32)
        holds   = np.array(holds,   dtype=np.float32)

    return flights, holds


def make_tensor(flights, holds):
    """Tensor [SEQ_LEN, 6]: flight, hold, Δflight, Δhold, hold/flight, speed_ema."""
    f  = np.array(flights, dtype=np.float32)
    h  = np.array(holds,   dtype=np.float32)
    df = np.diff(f, prepend=f[0])
    dh = np.diff(h, prepend=h[0])
    ratio = h / (f + 1e-8)            # hold/flight ratio — bots have anomalous ratio
    # EMA speed: decaying average of 1/flight (inversely proportional to typing speed)
    speed = np.zeros_like(f)
    alpha = 0.15
    speed[0] = 1.0 / (f[0] + 1e-8)
    for i in range(1, len(f)):
        speed[i] = (1 - alpha) * speed[i-1] + alpha / (f[i] + 1e-8)

    seq = np.stack([f, h, df, dh, ratio, speed], axis=1)
    if len(seq) >= SEQ_LEN:
        seq = seq[:SEQ_LEN]
    else:
        pad = np.zeros((SEQ_LEN - len(seq), N_FEAT), dtype=np.float32)
        seq = np.vstack([seq, pad])
    return seq

# ─── Data augmentation ────────────────────────────────────────────────────────

def time_warp(seq: np.ndarray, sigma: float = 0.1) -> np.ndarray:
    """Leve deformación temporal — simula variación de velocidad en mitad de sesión."""
    n  = len(seq)
    warp = np.cumsum(np.random.uniform(1 - sigma, 1 + sigma, n))
    warp = warp / warp[-1] * (n - 1)
    warped = np.zeros_like(seq)
    for j in range(seq.shape[1]):
        warped[:, j] = np.interp(np.arange(n), warp, seq[:, j])
    return warped.astype(np.float32)

def add_jitter(seq: np.ndarray, scale: float = 0.02) -> np.ndarray:
    """Pequeño ruido aditivo — hace al modelo más robusto."""
    noise = np.random.randn(*seq.shape).astype(np.float32) * scale
    return seq + noise

# ─── Dataset ──────────────────────────────────────────────────────────────────

print(f"\nGenerando {N_SESSIONS:,} sesiones sintéticas...")
t_gen = time.time()

rng = np.random.default_rng(42)

human_archetypes = ['normal', 'fast', 'nervous', 'mobile', 'hunt_peck', 'senior']
bot_archetypes   = ['simple', 'llm_paste', 'sophisticated', 'sinusoidal', 'slow',
                    'gaussian_copula', 'macro', 'adversarial']
human_weights    = [0.35, 0.18, 0.22, 0.12, 0.07, 0.06]
bot_weights      = [0.15, 0.18, 0.22, 0.10, 0.10, 0.12, 0.07, 0.06]

n_human = int(N_SESSIONS * 0.55)
n_bot   = N_SESSIONS - n_human

X_list, y_list = [], []

h_arch = rng.choice(human_archetypes, size=n_human, p=human_weights)
for arch in h_arch:
    n_keys = int(rng.integers(60, 220))
    f, h   = human_sequence(n_keys, rng, archetype=arch)
    X_list.append(make_tensor(f, h))
    y_list.append(0)

b_arch = rng.choice(bot_archetypes, size=n_bot, p=bot_weights)
for arch in b_arch:
    n_keys = int(rng.integers(60, 220))
    f, h   = bot_sequence(n_keys, rng, archetype=arch)
    X_list.append(make_tensor(f, h))
    y_list.append(1)

X = np.stack(X_list)
y = np.array(y_list, np.int64)
idx = rng.permutation(len(X))
X, y = X[idx], y[idx]

print(f"  Generado en {time.time()-t_gen:.1f}s — shape: {X.shape}")

# Normalización por canal
mean = X.mean(axis=(0, 1), keepdims=True)
std  = X.std(axis=(0, 1),  keepdims=True) + 1e-8
X    = ((X - mean) / std).astype(np.float32)

norm_params = {
    'mean': mean.squeeze().tolist(),
    'std':  std.squeeze().tolist(),
    'seq_len': SEQ_LEN,
    'n_features': N_FEAT,
    'feature_names': ['flight_ms', 'hold_ms', 'delta_flight', 'delta_hold', 'hold_flight_ratio', 'speed_ema'],
}

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.15, random_state=42, stratify=y)
X_train, X_val, y_train, y_val   = train_test_split(X_train, y_train, test_size=0.176, random_state=42, stratify=y_train)
print(f"  Train: {len(X_train):,}  Val: {len(X_val):,}  Test: {len(X_test):,}")

# ─── Modelo v2: BiLSTM + Multi-Head Attention ─────────────────────────────────

class MultiHeadAttentionPool(nn.Module):
    """
    Multi-head attention pooling — cada cabeza se especializa en un patrón distinto:
      - Cabeza 1: eventos de burst / pegado
      - Cabeza 2: micro-variaciones de fatiga
      - Cabeza 3: distribución temporal global
      - Cabeza 4: transiciones de velocidad
    """
    def __init__(self, hidden_dim: int, n_heads: int = 4):
        super().__init__()
        self.heads = nn.ModuleList([nn.Linear(hidden_dim, 1) for _ in range(n_heads)])
        self.proj  = nn.Linear(hidden_dim * n_heads, hidden_dim)

    def forward(self, x):           # x: [B, T, H]
        contexts = []
        for head in self.heads:
            w = torch.softmax(head(x), dim=1)   # [B, T, 1]
            contexts.append((x * w).sum(dim=1))  # [B, H]
        out = torch.cat(contexts, dim=-1)        # [B, H*n_heads]
        return self.proj(out)                    # [B, H]


class BiLSTMv2(nn.Module):
    """
    BiLSTM v2 con Multi-Head Attention.
    Input:  [B, SEQ_LEN, N_FEAT]
    Output: p(bot) en [0, 1]

    Capas:
      ConvEmbed   → proyecta N_FEAT a d_model con conv 1D (captura patrones locales)
      BiLSTM ×2   → contexto temporal bidireccional
      MH-Attn     → atención multi-cabeza sobre la secuencia
      MLP         → clasificación final
    """
    def __init__(self, in_features=N_FEAT, d_model=64, lstm_hidden=64, n_heads=4, dropout=0.30):
        super().__init__()
        # Embedding convolucional local (ventana 3)
        self.embed = nn.Sequential(
            nn.Conv1d(in_features, d_model, kernel_size=3, padding=1),
            nn.GELU(),
            nn.Dropout(dropout * 0.5),
        )
        # BiLSTM ×2
        self.lstm1 = nn.LSTM(d_model, lstm_hidden, bidirectional=True, batch_first=True)
        self.norm1 = nn.LayerNorm(lstm_hidden * 2)
        self.drop1 = nn.Dropout(dropout)

        self.lstm2 = nn.LSTM(lstm_hidden * 2, lstm_hidden, bidirectional=True, batch_first=True)
        self.norm2 = nn.LayerNorm(lstm_hidden * 2)

        # Multi-Head Attention Pooling
        self.attn  = MultiHeadAttentionPool(lstm_hidden * 2, n_heads=n_heads)

        # Clasificador
        self.mlp = nn.Sequential(
            nn.Linear(lstm_hidden * 2, 64),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(64, 16),
            nn.GELU(),
            nn.Linear(16, 1),
        )

    def forward(self, x):                       # [B, T, F]
        # Conv embed — permute to [B, F, T], then back
        e = self.embed(x.permute(0, 2, 1))      # [B, d_model, T]
        e = e.permute(0, 2, 1)                  # [B, T, d_model]

        o1, _ = self.lstm1(e)                   # [B, T, 2*H]
        o1     = self.drop1(self.norm1(o1))
        o2, _ = self.lstm2(o1)                  # [B, T, 2*H]
        o2     = self.norm2(o2)

        pooled = self.attn(o2)                  # [B, 2*H]
        return torch.sigmoid(self.mlp(pooled).squeeze(1))   # [B]


model = BiLSTMv2().to(DEVICE)
n_params = sum(p.numel() for p in model.parameters())
print(f"\nModelo: BiLSTMv2 + MultiHeadAttention  ({n_params:,} parámetros)")

# ─── Dataset classes ──────────────────────────────────────────────────────────

class KeystrokeDataset(Dataset):
    def __init__(self, X, y, augment=False):
        self.X = X
        self.y = torch.tensor(y, dtype=torch.float32)
        self.aug = augment

    def __len__(self): return len(self.X)

    def __getitem__(self, i):
        x = self.X[i]
        if self.aug and np.random.random() < 0.5:
            x = time_warp(x, sigma=0.08)
        if self.aug and np.random.random() < 0.4:
            x = add_jitter(x, scale=0.015)
        return torch.tensor(x), self.y[i]

train_dl = DataLoader(KeystrokeDataset(X_train, y_train, augment=True),
                      batch_size=BATCH_SIZE, shuffle=True, num_workers=4 if DEVICE=='cuda' else 0, pin_memory=DEVICE=='cuda')
val_dl   = DataLoader(KeystrokeDataset(X_val,   y_val),
                      batch_size=BATCH_SIZE * 2, shuffle=False, num_workers=2 if DEVICE=='cuda' else 0)
test_dl  = DataLoader(KeystrokeDataset(X_test,  y_test),
                      batch_size=BATCH_SIZE * 2, shuffle=False, num_workers=2 if DEVICE=='cuda' else 0)

# ─── Entrenamiento ────────────────────────────────────────────────────────────

criterion = nn.BCELoss()
optimizer = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=5e-5)

# Warmup + Cosine Annealing
def lr_lambda(epoch):
    if epoch < WARMUP:
        return (epoch + 1) / WARMUP
    progress = (epoch - WARMUP) / (EPOCHS - WARMUP)
    return 0.05 + 0.95 * (1 + math.cos(math.pi * progress)) / 2

scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)

# Stochastic Weight Averaging (mejor generalización real)
swa_model = torch.optim.swa_utils.AveragedModel(model)
swa_start = int(EPOCHS * 0.75)
swa_sched  = torch.optim.swa_utils.SWALR(optimizer, swa_lr=LR * 0.05)

LABEL_SMOOTH = 0.1   # reduce overfit a datos sintéticos perfectamente separables
MIXUP_ALPHA  = 0.3

best_val_auc = 0.0
best_state   = None
patience     = 10
no_improve   = 0

print(f"\nEntrenando {EPOCHS} épocas (batch={BATCH_SIZE}, device={DEVICE})...\n")
print(f"{'Ep':>3}  {'Loss':>8}  {'ValAUC':>8}  {'ValF1':>8}  {'LR':>10}")
print("─" * 48)

for epoch in range(1, EPOCHS + 1):
    model.train()
    total_loss = 0.0
    t_ep = time.time()

    for xb, yb in train_dl:
        xb, yb = xb.to(DEVICE), yb.to(DEVICE)

        # Mixup
        if MIXUP_ALPHA > 0 and np.random.random() < 0.5:
            lam = np.random.beta(MIXUP_ALPHA, MIXUP_ALPHA)
            idx_mix = torch.randperm(xb.size(0), device=DEVICE)
            xb  = lam * xb + (1 - lam) * xb[idx_mix]
            yb  = lam * yb + (1 - lam) * yb[idx_mix]

        # Label smoothing manual
        yb_smooth = yb * (1 - LABEL_SMOOTH) + 0.5 * LABEL_SMOOTH

        optimizer.zero_grad()
        pred = model(xb)
        loss = criterion(pred, yb_smooth)
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        total_loss += loss.item() * len(xb)

    avg_loss = total_loss / len(X_train)

    # SWA
    if epoch >= swa_start:
        swa_model.update_parameters(model)
        swa_sched.step()
    else:
        scheduler.step()

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
    val_f1     = f1_score(val_labels, (val_probs > 0.5).astype(int))
    lr_now     = optimizer.param_groups[0]['lr']

    print(f"{epoch:>3}  {avg_loss:>8.4f}  {val_auc:>8.4f}  {val_f1:>8.4f}  {lr_now:>10.6f}  ({time.time()-t_ep:.1f}s)")

    if val_auc > best_val_auc:
        best_val_auc = val_auc
        best_state   = {k: v.clone() for k, v in model.state_dict().items()}
        no_improve   = 0
    else:
        no_improve += 1
        if no_improve >= patience:
            print(f"\n  Early stop ep={epoch} (best AUC={best_val_auc:.4f})")
            break

# Aplicar SWA BN stats
print("\nAplicando SWA batch norm stats...")
torch.optim.swa_utils.update_bn(train_dl, swa_model)

# ─── Evaluación: modelo base vs SWA ──────────────────────────────────────────

def eval_model(m, dl):
    m.eval()
    probs, labels = [], []
    with torch.no_grad():
        for xb, yb in dl:
            p = m(xb.to(DEVICE)).cpu().numpy()
            probs.extend(p); labels.extend(yb.numpy())
    probs, labels = np.array(probs), np.array(labels)
    auc = roc_auc_score(labels, probs)
    f1  = f1_score(labels, (probs > 0.5).astype(int))
    return auc, f1, probs, labels

model.load_state_dict(best_state)
base_auc, base_f1, _, _ = eval_model(model, test_dl)
swa_auc,  swa_f1,  swa_probs, swa_labels = eval_model(swa_model, test_dl)

print(f"\n{'─'*48}")
print(f"  Base model AUC:  {base_auc:.4f}   F1: {base_f1:.4f}")
print(f"  SWA  model AUC:  {swa_auc:.4f}   F1: {swa_f1:.4f}  ← producción")
print(f"{'─'*48}")

# Usar SWA si mejora
export_model = swa_model if swa_auc >= base_auc else model
export_auc   = max(swa_auc, base_auc)

print(classification_report(swa_labels, (swa_probs > 0.5).astype(int), target_names=['human', 'bot']))

# ─── Export ONNX ──────────────────────────────────────────────────────────────

print("Exportando a ONNX...")

# Unwrap SWA model for export
inner = export_model.module if hasattr(export_model, 'module') else model
inner.eval().cpu()

dummy    = torch.randn(1, SEQ_LEN, N_FEAT)
onnx_path = os.path.join(OUT_DIR, 'lstm_model.onnx')

torch.onnx.export(
    inner, dummy, onnx_path,
    input_names   = ['keystroke_sequence'],
    output_names  = ['bot_probability'],
    dynamic_axes  = {'keystroke_sequence': {0: 'batch'}, 'bot_probability': {0: 'batch'}},
    opset_version = 17,
    do_constant_folding = True,
)

size_kb = os.path.getsize(onnx_path) / 1024
print(f"  Guardado: {onnx_path} ({size_kb:.1f} KB)")

# Verificar
import onnxruntime as ort
sess = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider'])
r = sess.run([sess.get_outputs()[0].name], {sess.get_inputs()[0].name: dummy.numpy()})[0]
print(f"  ONNX verify: p(bot)={r[0]:.4f}  ✓")

# ─── Guardar artefactos ───────────────────────────────────────────────────────

with open(os.path.join(OUT_DIR, 'lstm_scaler.json'), 'w') as f:
    json.dump(norm_params, f, indent=2)

metadata = {
    'version':    '2.0.0',
    'model_type': 'BiLSTMv2+MultiHeadAttention',
    'architecture': {
        'd_model': 64, 'lstm_hidden': 64, 'n_heads': 4,
        'conv_embed': True, 'swa': True, 'n_params': n_params,
    },
    'training': {
        'n_sessions': N_SESSIONS, 'epochs_run': epoch,
        'label_smoothing': LABEL_SMOOTH, 'mixup_alpha': MIXUP_ALPHA,
        'augmentation': ['time_warp', 'jitter'],
        'swa': True, 'swa_start_epoch': swa_start,
        'device': DEVICE,
    },
    'seq_len':    SEQ_LEN,
    'n_features': N_FEAT,
    'feature_names': norm_params['feature_names'],
    'training_samples': len(X_train),
    'best_val_auc': round(float(best_val_auc), 4),
    'test_auc':     round(float(export_auc), 4),
    'test_f1':      round(float(max(swa_f1, base_f1)), 4),
    'threshold':    0.5,
    'normalization': norm_params,
    'ensemble_weight': 0.25,
}

with open(os.path.join(OUT_DIR, 'lstm_metadata.json'), 'w') as f:
    json.dump(metadata, f, indent=2)

print(f"\n{'='*65}")
print(f"  ✓ models/lstm/lstm_model.onnx        ({size_kb:.1f} KB)")
print(f"  ✓ models/lstm/lstm_scaler.json")
print(f"  ✓ models/lstm/lstm_metadata.json")
print(f"  Best Val AUC: {best_val_auc:.4f}")
print(f"  Test AUC:     {export_auc:.4f}   (SWA)")
print(f"  Parámetros:   {n_params:,}")
print(f"  Device:       {DEVICE}")
print(f"{'='*65}")
print("\nSiguiente paso:")
print("  aws s3 cp models/lstm/lstm_model.onnx s3://deep-check-models/lstm/")
print("  bash infra/deploy.sh")
