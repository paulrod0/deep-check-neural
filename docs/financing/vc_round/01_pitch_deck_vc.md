# Deep-Check — VC Pitch Deck
**Target: Pre-seed / Seed · 300-500 K€ · Abril 2026**
**Autor: Pablo López Rodríguez · pablo.lprdz@gmail.com · Madrid**

---

## Slide 1 — Cover

**Deep-Check**
Verificación de identidad con IA — privacy-first, GDPR-native.

Pablo López Rodríguez · Fundador
deep-check-two.vercel.app · Abril 2026

---

## Slide 2 — The Problem

**Los deepfakes y la IA generativa han roto la confianza digital.**

- 1 de cada 3 vídeos virales en 2025 fue manipulado con IA
- FaceSwap + voice cloning bypasean 80% de los sistemas KYC actuales
- Regulación europea (AI Act, eIDAS 2, GDPR) exige verificación reforzada
- Los proveedores dominantes (Jumio, Onfido, Veriff) suben datos biométricos a la nube → riesgo GDPR + vendor lock-in

**Consecuencia:** bancos, seguros, marketplaces y RRHH están desprotegidos.

---

## Slide 3 — The Solution

**Deep-Check es la primera plataforma europea de verificación de identidad con inferencia 100% en el navegador.**

- **Cero datos biométricos al servidor** — GDPR native, privacy-by-design
- **6-layer Veritas Ensemble** — rPPG + FACS + EfficientNet + DINOv3 + keystroke + CNN blendshape (Bayesian fusion)
- **Certificación científica:** paper publicado, NIST FATE PAD en curso
- **Deploy en 5 líneas de código** — SDK browser + API REST

---

## Slide 4 — Tech Moat

**Tecnología propietaria con métricas verificables:**

| Modelo | AUC | EER | Dataset |
|--------|-----|-----|---------|
| Deepfake Pixel V3 (EfficientNet-B4) | **0.9999** | 0.31% | 155 K imgs, 7 Kaggle datasets |
| Doc Forensics V2b (DINOv2 + ELA) | 0.998 | 1.87% | 171 K imgs CASIA + forensics-rf |
| Keystroke Biometrics (Transformer) | 0.949 | 9.2% | Aalto 136 M + CMU + IKDD |
| Deepfake V9.4 (DINOv3 + modern fakes) | 0.945 | 13.0% | 900 K imgs, cross-source |

- **Robustez ISO 30107-3:** AUC 0.99+ bajo JPEG Q10, blur r=5, grayscale
- **Calibración:** ECE 0.005 (excelente)
- **Anti-leak:** splits verificados, hash dedup, overlap = 0

---

## Slide 5 — Why Now

1. **AI Act europeo (Ago 2026):** obligación de marcar contenido IA-generado — crea demanda legal
2. **eIDAS 2 wallet europeo (2027):** biometría descentralizada, privacy-by-default → nuestro mismo diseño
3. **Fatiga de cloud-first:** enterprise EU exige on-premise o browser-side — Jumio/Onfido no lo pueden ofrecer
4. **Coste de GPU 10× más barato vs 2022:** entrenamiento propietario viable para una startup

---

## Slide 6 — Product & Distribution

**Stack comercial multicapa:**

| Capa | Producto | Target | Pricing |
|------|----------|--------|---------|
| **Consumer B2C** | Am I Real?, DateSafe, ProofShot, FakeCheck (Chrome) | Usuarios individuales | 0-79 €/mes (Paddle) |
| **SMB B2B** | API REST verify/detect | SaaS, marketplaces | 29-79 €/mes |
| **Enterprise** | SDK + MCP server + on-prem Docker | Bancos, seguros, notarías | Custom (5-50 K€/año) |
| **Public/NIST** | PAD C++ SDK + FRTE 1:1 | Gobierno, defensa | Tender |

---

## Slide 7 — Traction

**Lo conseguido bootstrap, solo founder, 0 € captado:**

- ✅ Producto **en producción** desde marzo 2026 (Vercel + AWS eu-west-1)
- ✅ **6 modelos propios** entrenados (V3, V7, V8, V9, Doc Forensics V2b, Keystroke)
- ✅ Paper **publicado en Zenodo** con DOI, CC BY-NC-ND
- ✅ **NIST FATE PAD** — SDK sometido (C++ `deep_check_pad.cpp`)
- ✅ **2 LOIs firmadas** con empresas [pendiente de especificar]
- ✅ **8 productos verticales** live (Am I Real?, DateSafe, ProofShot, DocSafe, ListingCheck, ResumeGuard, TrustMyProfile, FakeCheck)
- ✅ **Chrome Extension** publicada
- ✅ Infraestructura GDPR-native (todo biométrico en browser)

---

## Slide 8 — Market

**TAM / SAM / SOM (fuentes: Gartner, Grand View Research, Statista 2025)**

| | Valor | Fuente |
|---|---|---|
| **TAM** | Identity Verification global 2028: 27 B$ (CAGR 17%) | Grand View Research |
| **SAM (Europa)** | 6.5 B$ | proporción PIB |
| **SOM 3 años** | 5 M€ ARR | 0.08% SAM |

**Comparables recientes (EU / US):**
- Veriff: Series C 100 M$ @ 1.5 B$ (2022)
- Onfido: adquirida por Entrust 650 M$ (2024)
- Jumio: Series D 150 M$ @ 1.2 B$ (2021)
- Regula: 100 M$ (2023)

---

## Slide 9 — Business Model

**Cascada de ingresos — ya implementada:**

```
Consumer freemium → SMB self-serve (Paddle) → Enterprise contract → NIST tender
```

- **CAC:** 0 € actual (SEO + Chrome extension viral)
- **LTV/CAC proyectado 18 meses:** >3
- **Gross margin:** 88% (infra-light, compute mínimo servidor)
- **Churn:** N/A (producto en early stage)

---

## Slide 10 — Roadmap 18 meses (uso de fondos)

| Trimestre | Hito | Inversión |
|-----------|------|-----------|
| **Q2 2026** | Cerrar 3 pilotos EU enterprise (bancos/seguros) + NIST feedback | 50 K€ |
| **Q3 2026** | Contratar Head of Sales + ML Engineer | 120 K€ |
| **Q4 2026** | ISO 27001 + certificación AI Act | 60 K€ |
| **Q1 2027** | ARR 500 K€ · Expansión DACH + UK | 80 K€ |
| **Q2 2027** | Series A (2-3 M€) con métricas repetibles | — |

**Total pre-seed target: 300-500 K€ · Runway 18 meses**

---

## Slide 11 — Team

**Solo founder (ventaja: full ownership + velocidad)**

**Pablo López Rodríguez** · Founder, CEO, CTO
- Data Engineer IA + QA, CaixaBank Assurance HUB (actual)
- Vanguard Peak (proyecto paralelo)
- 10+ años en data/ML, experto en computer vision + biometría
- Solo founder desde enero 2026

**Advisory pipeline (pendiente close):**
- Academic: contactado con Oxford Computer Science
- Commercial: red AEAT + Fundación Don Bosco

**Hires post-ronda (prioridad):**
1. Head of Sales B2B EU (perfil ID verification vendido a bancos)
2. Senior ML Engineer (visión por computador + ONNX/WASM)

---

## Slide 12 — Ask

**Levantamos 300-500 K€ pre-seed para:**

- Cerrar 3 pilotos enterprise EU
- Contratar 2 roles clave (sales + ML)
- Certificaciones (ISO 27001, AI Act, NIST formal)
- 18 meses de runway hasta Series A con 500 K€ ARR

**Valoración orientativa:** 2-3 M€ post-money *(negociable según deal)*

**Comparables ronda pre-seed EU deeptech/cybersec 2024-2025:**
- Mostly Human Labs (UK, deepfake detect): 2 M$ pre-seed @ 8 M$ post
- Truepic (US, provenance): 26 M$ Series B @ n/d
- Reality Defender (US, deepfake): 15 M$ Series A @ 50 M$ post

**Contacto:** pablo.lprdz@gmail.com · LinkedIn: Pablo López Rodríguez · https://deep-check-two.vercel.app

---

## Appendix (data room)

- A1: Benchmark ISO/IEC 30107-3 completo
- A2: Paper Zenodo + peer review
- A3: Arquitectura técnica (6-layer ensemble)
- A4: Roadmap modelo 24 meses (V10 multimodal)
- A5: LOIs firmadas (redacted)
- A6: Modelo financiero 36 meses (Excel)
- A7: Cap table
- A8: CV founder
