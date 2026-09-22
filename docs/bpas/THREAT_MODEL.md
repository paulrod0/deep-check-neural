# BPAS Threat Model

**STRIDE + DREAD · v1.0 · Abril 2026**

Complementa `SPEC.md §2`. Enumera amenazas de forma estructurada para peer-review de seguridad.

---

## 1. Metodología

- **STRIDE** (Microsoft) para taxonomía: Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege
- **DREAD** para priorización (0-10 por dimensión): Damage, Reproducibility, Exploitability, Affected users, Discoverability
- Score total = Σ(DREAD) / 5 → prioridad {Low, Medium, High, Critical}

---

## 2. Diagrama de flujo de datos (DFD)

```
[Operator] ──events──> [Endpoint Agent] ──HMAC+nonce──> [mTLS/QUIC] ──embeddings──> [Inference Worker]
                            │                                                             │
                            ├── TPM (key derivation)                                      │
                            │                                                             ▼
                            └── Ring buffer (RAM only)                             [Fusion + Conformal]
                                                                                          │
                                                                                          ▼
                                                                                  [Decision Service]
                                                                                          │
                                                                  ┌───────────────────────┼─────────────────────┐
                                                                  ▼                       ▼                     ▼
                                                            [Custody Chain]           [SIEM]             [Policy Engine]
                                                            (ISO 27037)          (Splunk/Elastic)       (Step-up auth)
```

### Puntos de confianza (trust boundaries)

1. **TB1**: Operador ↔ Endpoint (confianza física)
2. **TB2**: Endpoint ↔ Red (no confiable, puede haber MITM)
3. **TB3**: Red ↔ Inference Worker (mTLS)
4. **TB4**: Inference Worker ↔ Decision Service (mismo dominio administrativo, pero separación de privilegios)
5. **TB5**: Decision Service ↔ SIEM (segregado con cortafuegos interno)

---

## 3. Enumeración de amenazas

### 3.1 Spoofing

| ID | Amenaza | Activo | DREAD | Prioridad | Mitigación |
|----|---------|--------|-------|-----------|------------|
| S1 | Impostor suplantando operador con credenciales robadas | Sesión | 9,10,8,7,9 = **8.6** | Critical | BPAS core — keystroke + mouse + fusion |
| S2 | Bot/RPA suplantando humano | Sesión | 7,9,8,6,8 = **7.6** | High | Head B del Transformer + detector de regularidad en TCN mouse |
| S3 | Mimicry attack físico (aprendido) | Sesión | 8,6,5,5,6 = **6.0** | High | Adversarial training + conformal UNCERTAIN |
| S4 | Mimicry synthetic (GAN-driven replay) | Sesión | 9,5,4,5,4 = **5.4** | Medium | Mimicry GAN en training + nonce |
| S5 | Deepfake en videollamada de mando | Sesión + facial | 10,7,6,8,7 = **7.6** | High | FACS delta + SyncNet-lite |
| S6 | TPM spoofing (endpoint comprometido antes de enrolamiento) | TPM | 10,3,3,6,3 = **5.0** | Medium | Remote attestation + EDR complementario |

### 3.2 Tampering

| ID | Amenaza | Activo | DREAD | Prioridad | Mitigación |
|----|---------|--------|-------|-----------|------------|
| T1 | Modificación de eventos en tránsito | Evento | 8,4,5,7,5 = **5.8** | Medium | HMAC-SHA256 + TLS 1.3 |
| T2 | Tampering del binario del agente | Agente | 10,5,4,8,5 = **6.4** | High | Code signing + verificación de hash en boot + atestación remota |
| T3 | Modificación de modelos ML en disco | Modelo | 9,4,3,9,4 = **5.8** | Medium | Sigstore + verificación en carga + manifest firmado |
| T4 | Manipulación del reloj del sistema | Timestamp | 7,6,7,5,6 = **6.2** | High | CLOCK_MONOTONIC_RAW (no afectado por NTP) |
| T5 | Corrupción de logs en SIEM | Logs | 8,3,3,6,3 = **4.6** | Medium | WORM storage + HMAC per log line |
| T6 | Manipulación de pesos durante federated update | Modelo global | 8,4,4,9,5 = **6.0** | High | SecureAggregation + Byzantine-robust aggregation (Krum) |

### 3.3 Repudiation

| ID | Amenaza | Activo | DREAD | Prioridad | Mitigación |
|----|---------|--------|-------|-----------|------------|
| R1 | Operador niega haber realizado acciones | Sesión | 7,8,6,6,7 = **6.8** | High | Cadena de custodia ISO 27037 + TSA RFC 3161 |
| R2 | Admin niega haber desactivado alertas | Config | 8,5,5,7,6 = **6.2** | High | Audit log inmutable + doble firma |
| R3 | Modelo niega haber producido un veredicto | Decisión | 7,5,4,6,4 = **5.2** | Medium | Model version + hash + inferencia reproducible |

### 3.4 Information Disclosure

| ID | Amenaza | Activo | DREAD | Prioridad | Mitigación |
|----|---------|--------|-------|-----------|------------|
| I1 | Fuga de raw events por side-channel | Raw | 9,4,3,10,3 = **5.8** | Medium | Raw nunca sale del endpoint; RAM cifrada |
| I2 | Reconstrucción de texto desde embeddings | Embedding | 9,6,4,10,5 = **6.8** | High | Proyección baja + dithering + MI bound |
| I3 | Template inversion attack | Template | 10,5,4,10,5 = **6.8** | High | Cancelable biometrics + salt por operador |
| I4 | Tráfico análisis (metadata leakage) | Traffic | 5,7,6,8,7 = **6.6** | High | QUIC con padding + traffic shaping |
| I5 | Memoria del agente dumpeada | Raw | 8,4,3,8,3 = **5.2** | Medium | mlock + zeroing + secure erase on exit |
| I6 | Logs filtran user_id a operadores no autorizados | Logs | 6,7,6,9,7 = **7.0** | High | user_id_hash en logs; acceso granular al SIEM |

### 3.5 Denial of Service

| ID | Amenaza | Activo | DREAD | Prioridad | Mitigación |
|----|---------|--------|-------|-----------|------------|
| D1 | Flood de eventos al worker | Worker | 6,9,8,7,9 = **7.8** | High | Rate limiting + backpressure + per-session quotas |
| D2 | Adversarial inputs que maximizan latencia | Worker | 6,5,5,6,5 = **5.4** | Medium | Input sanitization + timeout hard + circuit breaker |
| D3 | Exhaustion de TPM (rate limit) | TPM | 5,7,7,5,7 = **6.2** | High | Key caching local + rotación programada |
| D4 | Model poisoning en federated | Modelo | 9,4,3,10,4 = **6.0** | High | Byzantine-robust (Krum) + validation canary |
| D5 | Agente se cuelga bloqueando usuario | Endpoint UX | 7,6,5,7,6 = **6.2** | High | Watchdog + fail-open graceful (degradación a solo MFA) |

### 3.6 Elevation of Privilege

| ID | Amenaza | Activo | DREAD | Prioridad | Mitigación |
|----|---------|--------|-------|-----------|------------|
| E1 | Vulnerabilidad en el hook de captura que eleva a kernel | Endpoint | 10,4,3,8,4 = **5.8** | Medium | Minimal privileges, sandbox (seccomp-bpf, AppArmor), fuzzing continuo |
| E2 | Deserialización insegura en el worker | Worker | 9,5,4,9,5 = **6.4** | High | Solo protobuf tipado con validación de esquema; no formatos ejecutables |
| E3 | Inyección en Decision Service via atributos de usuario | Decision | 8,5,4,8,5 = **6.0** | High | Parametrización estricta + validación de esquema |
| E4 | LoRA adapter malicioso subido por federated client | Modelo global | 9,4,3,10,4 = **6.0** | High | Norma acotada + SecAgg + canary |

---

## 4. Matriz de priorización

Críticos y altos (≥ 6.0):

```
S1 Impostor                   8.6  ──┐
S2 Bot                        7.6    ├─ Core BPAS detection
S5 Deepfake videollamada      7.6  ──┘
D1 Flood worker               7.8  ── Infraestructura
I2 Embed inversion            6.8  ──┐
I3 Template inversion         6.8    ├─ Privacy
I6 Fuga user_id               7.0  ──┘
R1 Operator repudiation       6.8  ── Forensics
T2 Binario tampering          6.4  ── Integridad endpoint
T4 Reloj                      6.2  ──┐
T6 Fed tampering              6.0    │
D3 TPM exhaustion             6.2    ├─ Operacional
D5 Agente cuelga              6.2    │
E2 Deserialización            6.4    │
E3 Inyección DS               6.0    │
E4 LoRA malicioso             6.0  ──┘
```

---

## 5. Controles por familia

### 5.1 Criptografía

- **HMAC-SHA256** en todo evento (clave derivada del TPM)
- **TLS 1.3** con cipher suites restringidos a AEAD (AES-256-GCM, CHACHA20-POLY1305)
- **mTLS** mandatorio en todas las comunicaciones internas
- **QUIC** preferido (offset de metadatos + padding)
- **Sigstore/cosign** para artefactos de modelo y binarios
- **RFC 3161 TSA** para sellado temporal (Uanataca on-prem o FreeTSA degradado)

### 5.2 Aislamiento

- **Seccomp-bpf** en el agente (Linux): solo syscalls necesarios
- **AppArmor/SELinux** perfiles para el agente
- **User namespaces** donde sea posible
- **Air-gapped** opcional para workers de inferencia
- **Segregación de red** (DMZ + zona de confianza + zona sensible)

### 5.3 Observabilidad y detección

- **OpenTelemetry** con exportación a colector propio (no a SaaS público)
- **SIEM** con reglas específicas BPAS:
  - `R1`: ≥ 5 verificaciones UNCERTAIN seguidas
  - `R2`: Drift score creciente sostenido ≥ 7 días
  - `R3`: Latencia p95 > 500 ms (posible D2)
  - `R4`: Nonce rechazado (posible replay)
  - `R5`: HMAC inválido (posible tampering)

### 5.4 Ciclo de vida seguro

- **SAST**: cargo audit + cargo-deny en CI
- **DAST**: fuzzing con cargo-fuzz sobre parsers
- **SBOM**: CycloneDX generado en cada build
- **Pen-testing externo**: anual, equipo certificado CREST
- **Responsible disclosure**: programa privado con bug bounty interno

---

## 6. Lista de abuse cases operacionales

1. **Operador comparte sesión con compañero "para ayudar"** → BPAS detecta cambio de patrón → step-up auth o lock
2. **Operador pide a compañero que "escriba rápido este reporte por él"** → detección de cambio de keystroke style → alerta soft
3. **Bot RPA conectado a terminal tras autenticación con smartcard** → detector de bot dispara inmediatamente
4. **Adversario instala software en endpoint previamente comprometido** → atestación TPM no valida → rechazo de conexión
5. **Deepfake en videollamada con mando** → FACS delta + SyncNet-lite detecta desalineación
6. **Operador bajo coacción escribe "todo normal"** → Head C detecta stress en tecleo → alerta silenciosa a CSO
7. **Ex-operador usa credencial no revocada** → falta de baseline reciente → forzar re-enrolamiento completo

---

## 7. No mitigados explícitamente

Los siguientes ataques están **fuera del scope** de BPAS y requieren controles complementarios:

- **Insider con privilegios administrativos**: BPAS ayuda a detectar, pero no previene por sí solo → requiere segregación de deberes + doble firma
- **Zero-day en el SO del endpoint**: requiere EDR + parcheo proactivo
- **Ataques a la cadena de suministro de hardware (TPM falso)**: requiere procurement controlado
- **Social engineering sin interacción digital**: fuera del alcance técnico

---

**Firmado digitalmente por el arquitecto de seguridad al finalizar revisión.**
