# BPAS — Behavior Pattern Authentication System

**Technical Specification · v1.0**
**Deep-Check Defense Module**

---

## 0. Document metadata

| Campo | Valor |
|-------|-------|
| Código proyecto | DC-BPAS-2026 |
| Versión | 1.0 |
| Fecha | Abril 2026 |
| Estado | Draft for Technical Review |
| Clasificación sugerida | RESTRINGIDO (al desplegarse con datos reales) |
| Alcance | Autenticación biométrica continua multimodal para entornos de defensa, infraestructura crítica y alta seguridad |
| Cumplimiento declarado | ENS-Alta · ISO/IEC 24745:2022 · ISO/IEC 19795-1 · RGPD Art. 9 · EU AI Act Anexo III §1.a |

---

## 1. Objeto y alcance

### 1.1 Objeto

BPAS es un subsistema de Deep-Check que establece y verifica de forma continua la **identidad conductual** de un operador autenticado, sobre la base de múltiples modalidades biométricas de comportamiento. El sistema emite un **score de continuidad de identidad** en tiempo real y dispara alertas cuando detecta:

- Sustitución del operador en una sesión ya autenticada (takeover)
- Automatización o RPA controlando la sesión (bot)
- Operador real bajo coacción o estrés anómalo (duress)
- Patrones operacionales incompatibles con el rol del operador (insider threat)
- Mimicry attacks mediante síntesis adversaria

### 1.2 Fuera de alcance

- Autenticación **inicial** (delegada a factores existentes: smartcard, PKI, MFA)
- Detección de malware o análisis de red a nivel IDS/IPS
- Gestión de identidades y accesos (IAM) — BPAS es un consumidor de IAM, no sustituto

### 1.3 Integración con Deep-Check base

BPAS reutiliza:
- El **motor Veritas Ensemble** (fusión Bayesiana en espacio logit, calibración isotónica)
- La **cadena de custodia ISO/IEC 27037** (`src/lib/forensicChain.ts`)
- El pipeline de **keystroke biometrics** existente (Transformer 4L×8H×256D)
- Los componentes de calibración conforme (conformal prediction)

---

## 2. Modelo de amenazas (formal)

### 2.1 Activos protegidos

| Activo | Criticidad | Propiedad amenazada |
|--------|-----------|---------------------|
| Sesión autenticada de operador | Crítica | Integridad, autenticidad |
| Templates biométricos | Alta | Confidencialidad, no-revocabilidad |
| Logs de verificación | Alta | Integridad, no-repudio |
| Modelos ML (pesos) | Media | Integridad, confidencialidad |
| Telemetría agregada | Baja | Confidencialidad |

### 2.2 Adversarios

| Código | Adversario | Capacidades asumidas | KPI objetivo |
|--------|-----------|---------------------|--------------|
| **T1** | Impostor casual | Credenciales comprometidas, sin conocimiento del legítimo | EER ≤ 0.5 % |
| **T2** | Impostor informado | Credenciales + observación directa del legítimo ≥ 1 h | EER ≤ 2 % |
| **T3** | Mimicry physical | Observación prolongada + intención consciente de imitar | EER ≤ 5 %, BPCER@APCER=1 % ≤ 8 % |
| **T4** | Synthetic adversary | Modelos generativos entrenados sobre capturas del legítimo | EER ≤ 8 % (con adversarial training) |
| **T5** | Operador coaccionado | Es el legítimo bajo amenaza física o psicológica | Detección ≥ 70 % en ≤ 60 s |
| **T6** | Bot / RPA | Automatización con jitter estocástico añadido | FAR ≤ 0.1 %, TPR ≥ 99 % |
| **T7** | Insider malicioso | Credenciales legítimas, acceso a recursos fuera de patrón | TPR ≥ 85 % con FPR ≤ 3 %/semana |
| **T8** | Replay attack | Captura y reenvío de eventos firmados | Detección ≥ 99.9 % (nonce-based) |
| **T9** | Template inversion | Intento de reconstrucción del perfil biométrico desde embeddings | MI(embedding, raw) < 0.1 bits (MINE estimator) |

### 2.3 Suposiciones de confianza

- TPM 2.0 o equivalente disponible en el endpoint (atestación de clave hardware-bound)
- Canal TLS 1.3 con mutual authentication hasta el worker de inferencia
- Reloj monotónico (`CLOCK_MONOTONIC_RAW` o equivalente) no manipulable sin kernel privilege
- El adversario **no** tiene privilegios de kernel en el endpoint antes del primer evento capturado
- El backbone del modelo se distribuye firmado (RSA-4096 + Sigstore) y se verifica hash SHA-3-256

### 2.4 Controles defensivos mapeados

| Amenaza | Control técnico | Sección |
|---------|----------------|---------|
| T1-T2 | Keystroke + Mouse dynamics + Stylometry | §4.1, §4.2, §4.3 |
| T3 | Adversarial training con mimicry GAN | §6.1 |
| T4 | PGD + TRADES + detector sintético | §6.1-6.2 |
| T5 | Head C (duress) del Transformer keystroke | §4.1.3 |
| T6 | Análisis de regularidad + canal-lateral temporal | §4.2 |
| T7 | β-VAE operacional sobre secuencias | §4.4 |
| T8 | Nonce + HMAC con clave TPM-bound | §5.3 |
| T9 | Proyección con ruido + baja dimensionalidad + cancelable biometrics | §7.3 |

---

## 3. Arquitectura de sistema

### 3.1 Componentes

```
┌──────────────────────────────────────────────────────────────┐
│                         ENDPOINT                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ bpas-agent (Rust binary, ~4 MB RAM, <0.3% CPU)         │  │
│  │  ├─ capture::keystroke   (evdev / WH_KEYBOARD_LL)      │  │
│  │  ├─ capture::mouse       (evdev / WH_MOUSE_LL)         │  │
│  │  ├─ capture::window      (XCB / EnumWindows)           │  │
│  │  ├─ buffer (ring, HMAC-signed batches)                 │  │
│  │  ├─ crypto (TPM-bound HMAC + nonce)                    │  │
│  │  └─ transport (mTLS, QUIC preferred, TCP fallback)     │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                              │ mTLS + QUIC
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    INFERENCE WORKER                           │
│  (Python FastAPI + TorchServe, GPU preferred)                 │
│   ├─ Keystroke Transformer (existing, hardened)               │
│   ├─ Mouse TCN (new)                                          │
│   ├─ Stylometry projection head (on-device only, not here)    │
│   ├─ Operational β-VAE (new)                                  │
│   ├─ Facial baseline delta (reuses Deep-Check FACS)           │
│   └─ Fusion layer (Bayesian logit + isotonic + conformal)     │
└──────────────────────────────────────────────────────────────┘
                              │ mTLS
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                   DECISION SERVICE                            │
│  ├─ Policy engine (per-role thresholds, SIEM integration)     │
│  ├─ Alert dispatcher (Splunk / Elastic / Sentinel)            │
│  └─ Custody writer (ISO 27037 append-only)                    │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Zonas de confianza

| Zona | Confianza | Datos expuestos |
|------|-----------|-----------------|
| Endpoint | **Alta** (TPM-bound) | Raw events (efímeros, RAM) |
| Inference Worker | **Media** (aislado, sin Internet) | Embeddings proyectados |
| Decision Service | **Alta** (conectado a SIEM) | Scores + decisiones |

Los **raw events nunca abandonan el endpoint**. Solo embeddings de baja dimensionalidad pasan al worker de inferencia, cifrados en tránsito y adicionalmente cuantizados para reducir reconstruibilidad.

### 3.3 Modo air-gapped

Despliegue sin conectividad a Internet:

- Actualización de modelos por manifests firmados (RSA-4096 + Sigstore cosign) en soporte físico sellado
- Tiempo de sellado (TSA) mediante servidor RFC 3161 interno (Uanataca on-prem)
- SIEM interno sin egress

---

## 4. Modelos de ML (especificación detallada)

### 4.1 Keystroke (endurecimiento del modelo existente)

**Base**: Transformer encoder 4L × 8H × 256D (ya en producción Deep-Check).

**Cambios v2 para BPAS**:

#### 4.1.1 Tokenización enriquecida

Cada evento se codifica como vector de 72 dimensiones:

```
token_i = [
    keycode_embed_64,      # embedding aprendido por keycode
    flight_time_norm,      # (t_i - t_{i-1}) / 250 ms
    hold_time_norm,        # (up_i - down_i) / 250 ms
    is_modifier,           # {0,1} Shift/Ctrl/Alt/Meta
    is_correction,         # {0,1} Backspace/Delete
    dwell_zscore_user,     # z-score respecto al baseline del usuario
    digram_freq_log,       # log-frecuencia del digrama {c_{i-1}, c_i}
    session_position_norm  # i / session_length (contexto temporal)
]
```

#### 4.1.2 Posicional

Rotary Position Embedding (**RoPE**, Su et al. 2021) en cada capa de atención. Ventaja sobre sinusoidal: mejor extrapolación a secuencias más largas que las de entrenamiento y mejor generalización cross-context (prose/código/comandos).

#### 4.1.3 Cabezas múltiples

| Head | Salida | Pérdida | Propósito |
|------|--------|---------|-----------|
| A | Embedding 128-D | Triplet (margin 0.4) + InfoNCE (τ=0.1) | Identificación / verificación |
| B | Logit bot | BCE + label smoothing 0.05 | Detección de automatización |
| C | Logit duress | BCE con reweighting (pos_weight=3.5) | Detección de coacción |
| D | Logit drift | BCE | Concept drift auto-flag |

#### 4.1.4 Pérdida total

```
L_total = α·L_triplet + β·L_InfoNCE + γ·L_bot + δ·L_duress + ε·L_drift + λ·L_calibration
```

con `L_calibration = ECE(p, y)` computada sobre el batch (Guo et al. 2017). Hiperparámetros por búsqueda Bayesiana:

```
α=1.0, β=0.5, γ=0.3, δ=0.4, ε=0.1, λ=0.1
```

#### 4.1.5 Augmentations

- **MixUp** en espacio de features con λ∼Beta(0.2, 0.2)
- **TimeWarp** estocástico (±10 % en flight_time, simula variación natural)
- **Synthetic noise injection** (Gaussian σ=0.02 en features numéricos)
- **Adversarial PGD** ε=0.05 en flight_time, 10 pasos, α=ε/4 (ver §6.1)

### 4.2 Mouse dynamics (nuevo)

**Entrada**: eventos `(Δx, Δy, Δt, click_state)` a 125 Hz, decimados a 50 Hz por filtro anti-aliasing Butterworth orden 4 (cutoff 20 Hz).

**Features engineered** (calculados en ventana deslizante de 5 s, stride 1 s):

| Feature | Fórmula | Dim |
|---------|---------|-----|
| Velocidad | √(Δx² + Δy²) / Δt | 1 |
| Aceleración | d(v) / dt | 1 |
| Jerk | d(a) / dt | 1 |
| Curvatura | \|dθ/ds\| con θ=atan2(dy,dx) | 1 |
| Ángulo a destino | atan2(target_y - y, target_x - x) | 1 |
| Tiempo hasta destino | dist / v_media | 1 |
| Overshoot ratio | dist_real / dist_directa | 1 |
| Micro-correcciones | cuentas de cambio de signo en dv/dt | 1 |

Total 8 features por muestra → secuencia `(T=250, F=8)` por ventana.

**Arquitectura**: Temporal Convolutional Network (TCN), 6 capas:

```
Conv1D(8 → 32, k=3, d=1) + ReLU + Dropout(0.1)
Conv1D(32 → 64, k=3, d=2) + ReLU + Dropout(0.1)
Conv1D(64 → 128, k=3, d=4) + ReLU + Dropout(0.1)
Conv1D(128 → 128, k=3, d=8) + ReLU + Dropout(0.1)
Conv1D(128 → 64, k=3, d=16) + ReLU + Dropout(0.1)
Conv1D(64 → 32, k=3, d=32) + ReLU
GlobalAvgPool
Linear(32 → 64) → embedding
Linear(32 → 1) → logit bot
```

Receptive field ≈ 2^6 · 3 · 1/50 Hz ≈ 3.84 s. Más largo que cualquier trayectoria típica mouse→click.

**Latencia target**: p95 < 5 ms por ventana en CPU Intel Xeon Silver 4210 (sin GPU).

### 4.3 Stylometry (on-device)

**Por qué on-device**: el texto que escribe un operador puede contener información clasificada. Solo sale el embedding.

**Modelo**: XLM-RoBERTa-base (270M params) → proyección 768→128 con adapter LoRA r=8.

**Training objetivo**: contrastive SimCSE — pares positivos de textos del mismo autor, negativos de otros autores del mismo rol.

**Features complementarios** (interpretables, low-cost, calculados en CPU sin modelo):

- Burstiness léxica: `H(length_distribution)` con H=entropía Shannon
- Ratio tipo-token (vocabulary richness)
- Densidad de tecnicismos del rol (TF-IDF sobre diccionario curado)
- Patrón de mayúsculas: `P(uppercase | word_start)`
- Patrón de puntuación: histograma normalizado de `{,.;:!?}`
- Promedio y σ de longitud de frase
- Ratio de contracciones / abreviaciones

Total 12 features interpretables + 128 del embedding → concat 140.

### 4.4 Operational sequences (β-VAE)

**Entrada**: secuencia `(app_id, action_type, Δt_since_last)` donde:
- `app_id`: embedding 16-D aprendido sobre universo de apps (vocab ≤ 2048)
- `action_type`: {open, close, focus_in, focus_out, file_read, file_write, network_conn, launch, ...} — vocab 32
- `Δt_since_last`: log-normalizado

Ventanas de 100 eventos.

**Arquitectura β-VAE** (β=4, Higgins et al. 2017):

Encoder:
```
Embed concat → GRU bidireccional(2L, 128D)
→ Linear(256 → 64) → μ ∈ ℝ^32
                   → log σ ∈ ℝ^32
```

Decoder:
```
z ∈ ℝ^32 → Linear(32 → 256) → GRU(2L, 128D)
→ Linear(128 → vocab_app + vocab_action + 1)   per step
```

**Pérdida**:
```
L = E_q[log p(x|z)] - β · KL(q(z|x) || p(z))
  = CE_app(x_hat, x_app) + CE_action(x_hat, x_action) + MSE_Δt + 4·KL
```

**Anomalía** (score de novelty):
```
s = α · reconstruction_loss + (1 - α) · KL_term    con α=0.7
```

Entrenamiento **one-class**: solo secuencias normales del operador. Implementa **novelty detection** — no necesita ejemplos de ataque (raros/ausentes en defensa real).

### 4.5 Facial baseline delta

Extiende el pipeline FACS de Deep-Check (existente):

- Durante enrolamiento (14 días), se construye histograma 2D (AU_index × intensity_bucket) del operador
- Durante verificación, distancia Jensen-Shannon entre histograma de sesión actual y baseline
- **SyncNet-lite** sobre ventanas de 5 s de audio+vídeo → detecta desfase labio↔audio (útil contra deepfakes con clonación de voz)

---

## 5. Fusión, calibración y decisión

### 5.1 Fusión Bayesiana en espacio logit

Sea `ℓ_k(x_k)` el logit de la modalidad k. La probabilidad posterior combinada:

```
p(legítimo | x) = σ( Σ_k w_k · f_k(ℓ_k(x_k)) + b )
```

donde:
- `f_k` es una función monótona por modalidad (isotonic regression)
- `w_k` se aprende sobre conjunto de validación balanceado
- `b` es un bias global por rol operacional

### 5.2 Aprendizaje de pesos

Optimización de **Brier score** (no BCE), ya que Brier es proper scoring rule y castiga simultáneamente resolución y calibración:

```
min_{w,b} E[(p(x) - y)²]    s.t.  w_k ≥ 0,  Σ w_k = 1
```

Se resuelve con gradiente proyectado sobre el simplex.

### 5.3 Calibración conforme

Encima del ensemble se aplica **split conformal prediction** (Vovk et al. 2005):

- Se reserva conjunto de calibración de 1000 muestras legítimas por operador
- Score de no-conformidad `α_i = 1 - p(y_i = legítimo | x_i)`
- Cuantil `q_{1-α} = Quantile(α_1, ..., α_n; ⌈(n+1)(1-α)⌉ / n)`
- Decisión para x nuevo:
  ```
  legítimo        si p(x) ≥ 1 - q_{1-α}
  impostor        si p(x) ≤ q_{1-α}
  UNCERTAIN       en otro caso
  ```

**Garantía**: P(etiqueta correcta ∈ decisión) ≥ 1 - α por construcción, independiente de la distribución.

En defensa, la respuesta **UNCERTAIN** es crítica — prefiere pedir re-autenticación explícita antes que forzar un veredicto incorrecto.

### 5.4 Umbrales adaptativos por contexto

Diferentes roles, diferentes α:

| Rol | α target | Respuesta en UNCERTAIN |
|-----|----------|------------------------|
| Operador táctico general | 0.05 | Warning a supervisor |
| Mando operativo | 0.01 | Step-up auth (PIN + smartcard) |
| Acceso SCIF | 0.005 | Session lock + alerta CSO |
| Mantenimiento remoto | 0.02 | MFA challenge |

---

## 6. Robustez adversarial

### 6.1 Adversarial training

**PGD sobre features de keystroke**:
```
x_adv = argmax_{||δ||_∞ ≤ ε} L(f(x + δ), y)
con ε=0.05, α=ε/4, K=10 pasos
```

**TRADES loss** (Zhang et al. 2019):
```
L_TRADES = L_nat(f(x), y) + β · KL(f(x) || f(x_adv))    con β=6
```

Se entrena en paralelo sobre:
- Keystroke encoder
- Mouse TCN
- Fusion layer (con reconfiguración tras re-calibración)

### 6.2 Mimicry synthesis

Generador adversarial condicionado al operador X (GAN conditional sobre user_id):

- **G**: RNN autoregresivo que produce secuencias `(flight_time, hold_time)` del estilo del operador
- **D**: discriminador binario (real / sintético)
- Entrenamiento estándar Wasserstein-GP (Gulrajani et al. 2017)

Las secuencias generadas por G se etiquetan como **impostor** y se añaden al training set del clasificador principal. Resultado: el modelo final aprende a distinguir operador real vs síntesis de su propio estilo.

### 6.3 Replay protection

Cada evento capturado en el endpoint incluye:

```
event = {
    payload: { type, keycode, ts_mono_ns, ... },
    nonce: uint64,                    // contador monotónico por sesión
    session_id: uuid,
    hmac: HMAC_SHA256(key_tpm, serialize(event))
}
```

El worker de inferencia mantiene una ventana deslizante de los últimos N=100 000 nonces por sesión; cualquier nonce repetido o no monotónico se rechaza y genera alerta.

### 6.4 Side-channel protection

Los embeddings transmitidos al worker tienen:

- **Dimensionalidad baja** (128-D agregado)
- **Cuantización** a int8 con dithering (reduce entropía extraíble)
- **Ruido aditivo Gaussiano** calibrado para garantizar MI(embedding, raw) < 0.1 bits, estimado con MINE (Belghazi et al. 2018)
- **No contienen** identificadores directos (no timestamps absolutos, solo offsets relativos)

---

## 7. Privacidad y protección del template

### 7.1 Cancelable biometrics (ISO/IEC 24745)

Cada template biométrico almacenado es **revocable**:

```
template_stored = projection(embedding, salt_user)
```

con `projection` una transformación BioHashing extendida:
- Proyección aleatoria sobre subespacio determinado por `salt_user` (semilla RNG)
- Cuantización binaria
- `salt_user` generado por TRNG hardware, almacenado en HSM del operador

Si un template se compromete, se revoca el `salt_user`, se genera uno nuevo, y se re-enrola sin necesidad de sesión biométrica nueva (se puede re-derivar desde el embedding base protegido).

### 7.2 Federated learning

Multi-sede (p. ej. varias bases militares):

- **Modelo backbone compartido** + adaptadores LoRA locales por sede
- Agregación **FedAvg** cada N=100 rondas
- **SecureAggregation** (Bonawitz et al. 2017): el servidor central solo ve la suma de actualizaciones, nunca una individual
- **Differential Privacy** (Abadi et al. 2016): ruido Gaussiano σ = Δ_f · √(2 ln(1.25/δ)) / ε, con ε=1.0 por ronda, δ=1e-6 — verificable con RDP accountant

### 7.3 Retención y borrado

- Templates: vida del operador + 1 año post-baja
- Logs de verificación: 5 años (requisito ENS-Alta) en almacenamiento inmutable WORM
- Raw events: **nunca se persisten** (solo RAM cifrada)
- Derecho al borrado (RGPD Art. 17): aplicable a templates; los logs se conservan anonimizados por obligación legal

---

## 8. Observabilidad e instrumentación

### 8.1 OpenTelemetry

Todo el pipeline emite trazas OTLP:

```
trace: bpas.verification.session
  ├─ span: capture.ingest            (endpoint)
  ├─ span: inference.keystroke       (worker)
  ├─ span: inference.mouse           (worker)
  ├─ span: inference.operational     (worker)
  ├─ span: fusion.bayesian           (worker)
  ├─ span: conformal.decision        (worker)
  └─ span: custody.append            (decision)
```

Atributos exportados (nunca raw features):
- `user.id_hash` (SHA-256 de user_id)
- `session.id` (UUID)
- `modality.score_bucketed` (bucketizado a 10 niveles)
- `decision.outcome` {legítimo, impostor, uncertain}
- `latency.ms`

### 8.2 Métricas Prometheus

```
bpas_verification_total{user_hash,outcome,role}
bpas_latency_seconds{modality,quantile}
bpas_drift_score{user_hash}
bpas_model_version{modality}
bpas_calibration_ece{role}
bpas_alert_total{type, severity}
```

### 8.3 Dashboards operacionales

Grafana con 4 paneles:
1. **Salud del sistema** (latencia, disponibilidad, throughput)
2. **Salud del modelo** (drift por operador, ECE, distribución de scores)
3. **Alertas activas** (heatmap por rol × hora)
4. **Auditoría** (últimas 1000 verificaciones con outcome, sin datos biométricos)

### 8.4 Logs

JSON estructurados, firmados (HMAC-SHA256) con clave del worker, enviados por TLS mutuo a SIEM:

```json
{
  "ts": "2026-04-15T12:34:56.789Z",
  "session_id": "...",
  "user_hash": "...",
  "outcome": "legitimate",
  "confidence": 0.983,
  "modalities": {
    "keystroke": 0.97,
    "mouse": 0.98,
    "operational": 0.99
  },
  "alert": null,
  "hmac": "..."
}
```

Retención: 5 años en almacenamiento WORM (ENS-Alta).

---

## 9. Criterios de aceptación y KPIs

### 9.1 Rendimiento biométrico (ISO/IEC 19795-1)

| Métrica | Condición | Target |
|---------|-----------|--------|
| EER | cross-validation leave-one-user-out, n≥100 | ≤ 1.0 % |
| FAR @ FRR=0.1 % | idem | ≤ 0.5 % |
| FRR @ FAR=0.01 % | idem | ≤ 2 % |
| DET curve AUC | idem | ≥ 0.995 |
| ECE | 15 bins, cal-set = 20 % | ≤ 0.02 |

### 9.2 Robustez adversarial

| Ataque | Target |
|--------|--------|
| PGD ε=0.05 sobre keystroke | Δ AUC ≤ 5 % |
| Mimicry GAN (T3) | BPCER@APCER=1 % ≤ 8 % |
| Bot con jitter | FAR ≤ 0.1 % |
| Replay attack | Detección ≥ 99.9 % |
| Template inversion (MINE) | MI ≤ 0.1 bits |

### 9.3 Operacionales

| Métrica | Target |
|---------|--------|
| Latencia verificación (p95) | < 200 ms |
| Tiempo a detección post-takeover (mediana) | < 45 s |
| Falsas alertas | < 1 / operador / semana |
| Disponibilidad del agente | ≥ 99.5 % |
| Huella RAM del agente | ≤ 8 MB |
| Consumo CPU agente (p95) | ≤ 0.5 % |

---

## 10. Hoja de ruta de implementación

| Fase | Duración | Hito | Criterio de salida |
|------|----------|------|---------------------|
| **F0** · Diseño detallado | 3 sem | Spec formal + threat model peer-reviewed | Firma de arquitecto ML + CSO |
| **F1** · Keystroke v2 + Mouse TCN | 8 sem | Modelos entrenados sobre dataset interno | EER ≤ 2 % cross-user (lab) |
| **F2** · Stylometry + Operational VAE | 6 sem | Modelos on-device, β-VAE estable | AUC ≥ 0.95 sobre insider sintético |
| **F3** · Fusión + Conformal | 4 sem | Ensemble calibrado | ECE ≤ 0.02, FAR@0.1%FRR ≤ 0.5 % |
| **F4** · Adversarial hardening | 6 sem | PGD + TRADES + mimicry GAN integrados | TRADES-robust AUC ≥ 0.92 |
| **F5** · Federated + DP | 6 sem | Protocolo FedAvg + SecAgg + ε-DP | ε=1.0 por ronda, demostración matemática |
| **F6** · Agente Rust + Transport | 5 sem | Binario firmado, firma TPM, mTLS/QUIC | Huella ≤ 8 MB, latencia p95 < 200 ms |
| **F7** · Piloto operativo | 12 sem | Despliegue 10-20 operadores reales | MTBF alerta espuria ≥ 7 días |
| **F8** · Certificación ENS + AI Act | 6 meses | Declaración de conformidad Art. 47 | Auditoría pasada |

**Total hasta producción certificada**: ~18 meses con equipo 3 FTE (ML + backend + security).
**MVP defensable (F0-F4)**: ~6 meses.

---

## 11. Dependencias tecnológicas

| Componente | Versión mínima | Justificación |
|------------|----------------|---------------|
| Rust | 1.78+ | MSRV para crates async |
| Python | 3.11+ | typing, performance |
| PyTorch | 2.3+ | torch.compile, FlashAttention-2 |
| ONNX Runtime | 1.18+ | INT8 quantization estable |
| CUDA | 12.1+ | compatible con A10G, H100 |
| TPM | 2.0 | atestación de endpoint |
| OpenTelemetry | 1.35+ | spans estables |

---

## 12. Riesgos y mitigaciones

| Riesgo | Impacto | Probabilidad | Mitigación |
|--------|---------|--------------|------------|
| Dataset sintético insuficiente para T3-T4 | Alto | Media | Colaboración con BIT voluntarios (F7) |
| Adversario con acceso físico al endpoint | Alto | Baja | TPM + atestación remota + EDR complementario |
| Concept drift no detectado | Medio | Media | Head D + EWMA + alertas automáticas |
| Latencia inaceptable con CPU-only | Medio | Baja | Quantización INT8 + ONNX Runtime |
| Resistencia organizacional (privacidad) | Alto | Alta | DPIA + comité ético + opt-in individual |
| Regulación AI Act más restrictiva de lo previsto | Medio | Media | Seguimiento legal + cláusulas contractuales |

---

## 13. Anexos referenciados

- `THREAT_MODEL.md` — Modelo de amenazas STRIDE/DREAD detallado
- `AI_ACT_CONFORMITY.md` — Documentación técnica conforme a AI Act Art. 11
- `../legal_certification_roadmap.md` — Roadmap de homologación
- Código: `agent-rust/` — Agente endpoint en Rust
- Código: `ml/bpas/` — Pipelines de entrenamiento
- `src/lib/forensicChain.ts` — Cadena de custodia ISO 27037 (ya existente)

---

**Fin de la especificación técnica v1.0.**
