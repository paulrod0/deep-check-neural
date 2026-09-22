# Memoria Técnica — NEOTEC 2026 (skeleton)
## Deep-Check: Plataforma europea de verificación de autenticidad digital mediante IA privacy-first

**Solicitante:** Pablo López Rodríguez (persona física → S.L. a constituir)
**Fecha objetivo de presentación:** convocatoria 2026 CDTI NEOTEC (verificar en https://www.cdti.es)
**Ayuda solicitada:** 250.000 € grant (no reembolsable) — máx NEOTEC es 325 K€
**Duración:** 24 meses
**Intensidad de ayuda:** hasta 70% del presupuesto total del proyecto

---

## 📋 Estructura oficial NEOTEC (adaptada)

### 1. Datos Básicos del Proyecto

**Título:** "Deep-Check: sistema europeo de verificación biométrica e integridad digital con inferencia distribuida en el navegador (privacy-by-design)"

**Acrónimo:** DEEPCHECK-EU

**Palabras clave:** verificación identidad, deepfake detection, biometría, privacy-by-design, GDPR, browser inference, ONNX, ensemble bayesiano

**Modalidad NEOTEC:** Nueva Empresa de Base Tecnológica (NEBT)

---

### 2. Resumen Ejecutivo (250 palabras)

> Deep-Check es la primera plataforma europea que realiza **verificación biométrica e integridad forense de contenido digital mediante inferencia 100% en el navegador del usuario** (WebAssembly + ONNX Runtime), garantizando cumplimiento nativo con GDPR (los datos biométricos nunca salen del dispositivo). Detecta deepfakes, imágenes generadas por IA, manipulaciones documentales y bots mediante un **ensemble bayesiano de 6 modelos** propietarios (rPPG, FACS, EfficientNet-B4, DINOv3, CNN blendshape y biometría de teclado).
>
> La tecnología ya está validada: AUC 0.9999 en detección deepfake sobre 155.000 imágenes; modelo documental AUC 0.998 sobre 171.000 imágenes CASIA; SDK PAD sometido a NIST FATE; paper publicado en Zenodo con DOI. El producto se encuentra en producción (deep-check-two.vercel.app) desde marzo 2026.
>
> El proyecto NEOTEC financiará **3 líneas I+D críticas**: (1) robustecimiento del modelo contra generadores de IA emergentes (Veo 3, Sora 2, Flux 2) mediante entrenamiento federado multicorpus de 1 M+ imágenes; (2) extensión multimodal a verificación de vídeo end-to-end (30 fps) con rPPG cuántico; (3) certificación formal ISO/IEC 27001, AI Act compliance y NIST FATE PAD categoría A.
>
> El mercado de identity verification alcanzará 27 B$ en 2028 (Grand View Research, CAGR 17%). Los competidores dominantes (Jumio, Onfido, Veriff) son anglosajones y cloud-first, dejando un vacío en Europa para soluciones GDPR-native. Deep-Check se posiciona como **la alternativa europea con soberanía digital**, con 2 LOIs firmadas y tracción comercial validada.

---

### 3. Descripción del Proyecto (I+D+i)

#### 3.1 Estado del arte

Los sistemas actuales de identity verification presentan tres limitaciones críticas:

1. **Arquitectura cloud-first (Jumio, Onfido, Veriff, ID.me):** requieren subir datos biométricos a servidores, creando riesgos GDPR, dependencia de proveedor y latencia.
2. **Modelos obsoletos frente a generadores modernos de IA:** detectores entrenados sobre FaceForensics++ (2019) degradan dramáticamente su precisión frente a Flux, SDXL, MidJourney, Sora (AUC cae de 0.99 a 0.60 en cross-source).
3. **Falta de explicabilidad y trazabilidad:** los proveedores emiten veredictos binarios sin justificación técnica, incompatibles con el futuro AI Act europeo que exigirá auditoría.

#### 3.2 Objetivos del proyecto (SMART)

**Objetivo General:**
Consolidar Deep-Check como la plataforma europea de referencia para verificación biométrica e integridad digital, con certificaciones formales (NIST, ISO, AI Act) y cobertura completa contra generadores IA hasta 2028.

**Objetivos Específicos (OE):**

| OE | Descripción | KPI | Plazo |
|----|-------------|-----|-------|
| **OE1** | Modelo V10 multimodal (imagen + vídeo + audio) con AUC ≥ 0.97 cross-source sobre generadores 2026-2028 | AUC, EER, APCER/BPCER ISO 30107-3 | Mes 18 |
| **OE2** | Entrenamiento federado multicorpus >1 M imágenes (FFHQ + SFHQ-T2I + OpenFake + FFGenAI + datos propios) | Dataset consolidado y anti-leak verificado | Mes 12 |
| **OE3** | Certificación NIST FATE PAD categoría A | Certificación publicada | Mes 24 |
| **OE4** | Certificación ISO/IEC 27001 + AI Act Art.15 | Sellos auditoría | Mes 20 |
| **OE5** | Validación con 3 clientes enterprise EU (banca, seguros, notarías) | Contratos firmados | Mes 24 |
| **OE6** | Publicación 2 papers peer-reviewed (IEEE/ACM) | DOI | Mes 24 |

#### 3.3 Plan de trabajo por paquetes

**PT1 — Gestión del proyecto** (M0-M24 · 5%)
- Coordinación técnica, seguimiento CDTI, justificación económica
- Gestión de hitos y entregables

**PT2 — Investigación fundamental en detección multimodal** (M0-M18 · 30%)
- T2.1 Estado del arte actualizado mensualmente
- T2.2 Entrenamiento federado multicorpus
- T2.3 Arquitectura V10 (foundation model multimodal)
- T2.4 Validación cross-source sobre generadores emergentes

**PT3 — Desarrollo de componentes ONNX/WASM optimizados** (M3-M20 · 25%)
- T3.1 Cuantización INT8 para inferencia en browser
- T3.2 Pipeline rPPG 30 fps en WebAssembly
- T3.3 SDK C++ (ya iniciado para NIST)
- T3.4 MCP server (protocolo agente IA)

**PT4 — Certificaciones y compliance** (M6-M24 · 20%)
- T4.1 NIST FATE PAD (iteración con feedback)
- T4.2 ISO/IEC 27001 (proceso certificación)
- T4.3 AI Act Art.15 (transparencia + auditoría)
- T4.4 Sellado forense ISO/IEC 27037 + RFC 3161

**PT5 — Validación en entornos reales (pilotos enterprise)** (M6-M24 · 15%)
- T5.1 Piloto banca (KYC onboarding)
- T5.2 Piloto seguros (validación fotografía siniestro)
- T5.3 Piloto notaría/firma digital

**PT6 — Diseminación y transferencia** (M0-M24 · 5%)
- T6.1 Publicación 2 papers peer-reviewed
- T6.2 Ponencias en congresos (IEEE ICCV, EUSIPCO, EuroS&P)
- T6.3 Mantenimiento open data (Zenodo)

---

### 4. Carácter Innovador

**Frente al estado del arte, Deep-Check aporta:**

1. **Inferencia browser-side:** primer sistema productivo a escala que ejecuta ensemble de 6 modelos biométricos íntegramente en ONNX Runtime Web. Reduce riesgo GDPR a cero.
2. **Ensemble bayesiano en logit-space:** en lugar de voting tradicional, fusión probabilística con pesos aprendidos (rPPG 0.30, FACS 0.26, EfficientNet 0.22, keystroke 0.12, CNN blend 0.10). Mejora AUC en +0.04 vs. single model.
3. **rPPG cuántico en tiempo real:** detección de flujo sanguíneo facial como prueba-de-vida nativa, imposible de spoofear con deepfake estático.
4. **Entrenamiento anti-leak verificado:** hash dedup + overlap validation = 0, evita el error común en papers de deepfake (train/test overlap).
5. **Arquitectura MCP:** primer proveedor de identity verification accesible por agentes IA vía Model Context Protocol.

---

### 5. Equipo y Capacidades

#### 5.1 Fundador / Investigador Principal

**Pablo López Rodríguez** — Madrid · Data Engineer IA + QA

- **Experiencia actual (2024-actual):** CaixaBank — Assurance HUB, Data Quality / Cosmos program
  - Supervisión QA en proyecto transformacional de verificación identidad bancaria
  - Benchmark ISO/IEC 30107-3 aplicado a modelos de producción
- **Experiencia previa (2020-2024):** Vanguard Peak, proveedor externo (ML + data)
- **Formación:** Data Engineering + QA (+10 años experiencia)
- **Producción científica:** paper publicado Zenodo (DOI) · SDK NIST sometido
- **Dedicación proyecto:** 100% durante los 24 meses (abandono CaixaBank al cierre de financiación)

#### 5.2 Contrataciones previstas con financiación NEOTEC

| Rol | Perfil | FTE | Mes inicio |
|-----|--------|-----|-----------|
| Senior ML Engineer | Computer Vision + ONNX + WASM, PhD/Master | 1.0 | Mes 3 |
| Cryptography Engineer | ISO 27037, sellado tiempo, firmas digitales | 0.5 | Mes 6 |
| Head of Sales B2B EU | Experiencia venta ID verification a banca EU | 1.0 | Mes 4 |
| QA / Certification Manager | ISO 27001, NIST FATE | 0.5 | Mes 9 |

#### 5.3 Colaboraciones externas

- Universidad con laboratorio de visión por computador (por concretar — Oxford contactado)
- Centro tecnológico acreditado NIST (USA)
- Entidad certificadora ISO 27001 (AENOR, BSI o equivalente)

---

### 6. Plan Económico

#### 6.1 Presupuesto total (aproximado)

| Concepto | € | % |
|----------|---|---|
| Personal (fundador + 3 FTE medio) | 280.000 | 60% |
| Subcontrataciones (certificaciones) | 50.000 | 11% |
| Materiales (GPU AWS training) | 40.000 | 9% |
| Publicaciones, viajes, congresos | 15.000 | 3% |
| Auditoría y gastos indirectos (15%) | 67.500 | 15% |
| Otros (equipamiento, software) | 12.500 | 2% |
| **TOTAL** | **465.000** | 100% |

#### 6.2 Solicitud NEOTEC

- **Ayuda solicitada:** 250.000 € (subvención no reembolsable · 54%)
- **Cofinanciación:** 215.000 € (46%) vía ronda pre-seed VC + angels + ENISA

---

### 7. Plan de Explotación Comercial

#### 7.1 Modelo de negocio (ya validado)

```
Consumer B2C (freemium, Paddle) → SMB B2B API (29-79 €/mes)
  → Enterprise SDK + on-prem (5-50K€/año) → Public tender (NIST + gov EU)
```

#### 7.2 Proyecciones 36 meses

| | Año 1 (M13-24) | Año 2 (M25-36) | Año 3 (M37-48) |
|---|---|---|---|
| Clientes Consumer | 10.000 | 50.000 | 150.000 |
| SMB B2B | 50 | 200 | 500 |
| Enterprise | 3 | 10 | 20 |
| **ARR (K€)** | **250** | **1.200** | **3.500** |

---

### 8. Impacto

- **Económico:** creación de 3-5 empleos cualificados en España (Madrid)
- **Tecnológico:** soberanía digital europea en identity verification
- **Social:** protección contra fraude deepfake, especialmente en colectivos vulnerables (personas mayores, menores)
- **Regulatorio:** pionero en cumplimiento nativo AI Act + eIDAS 2

---

### 9. Riesgos y mitigación

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Nuevos generadores IA saltan la detección | Alta | Alto | Pipeline de re-entrenamiento mensual con datasets recientes |
| Jumio/Onfido copian browser-side | Media | Alto | IP strategy (patente rPPG + secret sauce en cuantización) |
| AI Act retrasa obligatoriedad | Baja | Medio | Plan B: acelerar marcados voluntarios con ONG/academia |
| No certifica NIST | Baja | Alto | Iteración continua con feedback; 2 intentos en plazo |
| Founder burnout solo | Media | Alto | Contratación temprana CTO (mes 3) |

---

### 10. Entregables

| Mes | Entregable |
|-----|------------|
| M6 | Dataset consolidado 500K imgs + primera iteración V10 |
| M12 | V10 multimodal con AUC ≥ 0.95 cross-source |
| M12 | Piloto enterprise #1 en producción |
| M18 | V10 final con AUC ≥ 0.97 + SDK publicado |
| M20 | Certificación ISO 27001 |
| M22 | Submission NIST FATE PAD categoría A |
| M24 | Cierre proyecto · ARR 250K€ · 3 pilotos enterprise live |

---

## ⚠️ Gaps pendientes (qué necesito de Pablo para completar)

Para enviar esta memoria, me hace falta:

1. **Concretar las 2 LOIs** (nombres empresas, sectores, importes indicativos, fechas)
2. **CV completo** (formación académica reglada: ¿grado? ¿máster? ¿qué universidad?)
3. **Empresa constituida** — NEOTEC exige S.L. con <3 años antigüedad, necesitas constituirla ANTES de presentar
4. **Modelo financiero Excel** 36 meses (P&L + cash flow)
5. **Cuentas de pérdidas y ganancias** si ya hay facturación
6. **Acuerdo de colaboración con universidad** (opcional pero suma puntos)
7. **Plan de socios** si buscas incorporar alguien pre-presentación

## 🎯 Siguiente paso para aplicar a NEOTEC

1. Verificar convocatoria abierta en https://www.cdti.es (suele abrirse junio-julio)
2. Constituir S.L. (coste ~1.000-3.000 €, 2-3 semanas) — IMPRESCINDIBLE antes
3. Abrir modelo financiero Excel (te lo redacto en el siguiente turno si me das 3 datos)
4. Contactar con consultora especialista CDTI (opción): suelen cobrar 10-15% del grant obtenido

---

## 📎 Alternativa PARALELA: ENISA Jóvenes Emprendedores

**Más accesible que NEOTEC**, recomendada como primer paso:

- Importe: **75.000 € préstamo participativo**
- Sin aval personal
- No exige S.L. (persona física puede aplicar)
- Plazo 7 años (2 carencia)
- Interés variable según EURIBOR + diferencial
- Web: https://www.enisa.es

**Ventaja:** mientras trabajas NEOTEC (que lleva meses), ENISA entra en 2-3 meses. Los 75K€ financian parte del runway mientras cierras pre-seed.
