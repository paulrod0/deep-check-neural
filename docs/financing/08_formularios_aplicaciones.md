# Formularios de aplicación — aceleradoras y programas

**Contenido listo para copiar/pegar en los formularios online de Lanzadera,
INCIBE Emprende, Kfund y Wayra.** Todas las respuestas comparten una columna
vertebral coherente con el pitch deck (05) y el one-pager (07).

---

## 🟠 LANZADERA (Juan Roig / Valencia)

**URL**: https://lanzadera.es/apply/
**Programa**: Startup Program · ticket 200 k€ por 10 % (convertible)
**Fechas**: Ventana continua (evalúan cada 6-8 semanas)
**Por qué aplicar**: dinero + espacio físico en Marina de Empresas + acceso a
Juan Roig como advisor + mentores de Mercadona / Caixa Popular.

### Campo: Nombre del proyecto
```
Deep-Check
```

### Campo: Descripción (máx. 500 caracteres)
```
Plataforma de análisis forense con IA contra deepfakes, identidades falsas y
fraude documental. Verifica autenticidad en vídeo, imagen, documentos y
comportamiento, con informe criptográfico admisible como prueba legal.
Privacy-by-design: biometría procesada en el navegador del usuario. 213 000
líneas de código, 9 modelos propios. 3.200 € MRR, creciendo +50 % MoM. Cliente
anual firmado, pipeline IE University + corporativo Zeus + EUS Energía.
```

### Campo: Problema que resuelve (máx. 1000 caracteres)
```
La IA generativa (Sora 2, Flux, Midjourney, DALL-E) produce vídeos, caras y
documentos indistinguibles para el ojo humano. En 2024 Arup perdió 20 M £ en una
sola videollamada deepfake. El fraude sintético crece un 30 % interanual en
banca europea. Entre el 10 y 15 % de los siniestros de seguros incluyen
fotografías manipuladas. 1 de cada 5 perfiles de LinkedIn contiene credenciales
fabricadas.

Los métodos tradicionales (KYC, peritos forenses, equipos de compliance) fueron
diseñados antes de la IA generativa. No escalan. Y el AI Act europeo obliga a
partir de agosto de 2026 a detectar y etiquetar contenido sintético, con multas
de hasta el 3 % de la facturación global.

Deep-Check es la capa forense que cubre ese vacío: multimodal, con
trazabilidad criptográfica y alineada con GDPR + AI Act por defecto.
```

### Campo: Solución (máx. 1000 caracteres)
```
Una única plataforma que verifica autenticidad en cuatro vectores:

(1) Vídeo — deepfakes en videollamadas, entrevistas, onboardings bancarios.
    Modelo V10 VideoMAE-L (304 M parámetros), AUC 0,98 sobre FaceForensics++.
(2) Imagen — contenido generado por SDXL, Flux, Sora, Midjourney. Modelo
    DINOv3 propio (303 M parámetros), AUC 0,945 cross-source.
(3) Documentos — falsificación de DNIs, facturas, contratos. Modelo DINOv2 +
    ELA (304 M parámetros), AUC 0,958 sobre CASIA 2.0.
(4) Identidad conductual — huella de tecleo (keystroke dynamics) que distingue
    persona real de bot o impostor. Transformer propio, bot-AUC 0,949.

Cada verificación lleva informe forense firmado con sellado de tiempo eIDAS
(RFC 3161), admisible ante un juez. Biometría procesada íntegramente en el
navegador del usuario vía WebAssembly ONNX — cero datos biométricos
abandonan el dispositivo. Infraestructura 100 % europea (AWS eu-west-1 +
Vercel EU).
```

### Campo: Mercado
```
Mercado de detección de deepfakes: 1,5 B$ en 2025 → 15 B$ en 2030 (CAGR 42 %).
Mercado de identity verification: 11 B$ → 30 B$ en el mismo periodo. Segmentos
addressable en España Y1-Y2: aseguradoras, banca retail, business schools,
medios de comunicación, cybersec consultancies, peritos forenses. SOM total
España Y1: 50 M€. Target 0,1 % = 500 k€.

Tailwind regulatorio: EU AI Act Art. 50 obliga desde agosto de 2026 a detectar
y etiquetar contenido sintético, con multas del 3 % de la facturación global.
```

### Campo: Tracción actual
```
- Producto en producción desde marzo 2026 (https://deep-check-two.vercel.app)
- 3.200 € MRR (media 3 meses), crecimiento +50 % MoM
- Contrato anual firmado con cliente enterprise (sector confidencial)
- Pipeline en negociación: IE University (licencia institucional, ticket 100 k€),
  cliente corporativo Zeus (POC 8-40 k€), EUS Energía (proyecto app
  identidad, 10-30 k€)
- 213 000 líneas de código, 197 commits, 9 modelos de IA entrenados end-to-end
- 2 certificaciones en curso (ISO/IEC 27001 + ENS-Media)
```

### Campo: Competencia y ventaja diferencial
```
Microsoft Video Authenticator: solo imagen, sin vídeo ni documentos.
Sensity AI: solo face deepfakes, sin forensia documental.
Truepic: requiere su propia cámara (no analiza contenido existente).
Reality Defender: solo API cloud, sin on-prem ni EU-native.
FacePhi: solo biometría de identidad, sin multi-modal.

Ventaja Deep-Check:
1. Único multi-vector (vídeo + imagen + documento + conductual) en una
   plataforma.
2. Único con trazabilidad criptográfica nativa (informes judiciales).
3. Privacy-by-design: inferencia biométrica en navegador, GDPR + AI Act por
   defecto.
4. Infraestructura EU-native (sin transferencias transatlánticas).
5. Modelos propios entrenados desde cero, sin dependencia de APIs de
   terceros.
```

### Campo: Equipo
```
Pablo López Rodríguez — Founder & CEO
Data / ML Engineer, 6+ años de experiencia full-stack incluyendo pipelines de
ML en producción. Ha construido Deep-Check en solitario en 15 meses: 213 k
LOC, 9 modelos entrenados, infraestructura completa. Residente en Madrid,
dedicación 100 %.

Primera contratación prevista (mes 3 post-funding): ML engineer part-time
para acelerar iteración de modelos contra nuevos adversarios generativos.
```

### Campo: Uso de fondos (si captan 200 k€ × 10 %)
```
- Certificaciones ISO 27001 + ENS-Media: 25 k€ (unlock banca y sector público)
- Equipo (ML engineer part-time + 1 BDR sales): 80 k€
- Marketing B2B segmentado (insurance, banking, education): 40 k€
- Infraestructura AWS / Vercel 18 meses: 15 k€
- Legal (DPIA, contratos enterprise): 10 k€
- Salary founder (por debajo de mercado, 12 meses): 20 k€
- Buffer / operaciones: 10 k€

Objetivo a 18 meses: 15 clientes enterprise pagando, 60 k€+ MRR,
listo para Serie A de 1-2 M€.
```

### Campo: Por qué Lanzadera
```
Lanzadera es la única aceleradora en España con un ecosistema corporativo real
(Mercadona, Caixa Popular, ADM, Consum) al que Deep-Check puede vender
directamente — todos son empresas con flujos KYC, compliance y control de
fraude documental que hoy hacen manualmente. Además, el vínculo Valencia-
Madrid facilita presencia física durante los 6 primeros meses sin
descolocarme del ecosistema de clientes que ya tengo aquí.
```

---

## 🔵 INCIBE EMPRENDE (Aceleradora gratuita de ciberseguridad del Gobierno)

**URL**: https://www.incibe.es/incibe-emprende
**Programa**: Aceleración vertical ciberseguridad + mentoring + showcase ante
INCIBE y grandes corporates (BBVA, Telefónica, Iberdrola).
**Ticket**: sin equity — es una aceleradora gratuita con premio final 25 k€
**Ventaja**: logo INCIBE en el pitch deck + acceso a showcase con corporates
regulados.

### Campo: Descripción del proyecto
```
Deep-Check es una plataforma SaaS de verificación forense con inteligencia
artificial contra deepfakes, identidades sintéticas y fraude documental.
Permite a bancos, aseguradoras, medios e instituciones educativas detectar
contenido manipulado con IA generativa (SDXL, Flux, Sora) y emitir informes
firmados criptográficamente admisibles como evidencia legal.
```

### Campo: Relación con la ciberseguridad (CLAVE)
```
Deep-Check aborda tres amenazas de ciberseguridad emergentes que la industria
tradicional no cubre:

1. Suplantación por deepfake en videollamadas corporativas (CEO fraud 2.0).
   El caso Arup (20 M £ robados en Feb 2024 por videollamada deepfake) es el
   patrón. Deep-Check detecta deepfakes en tiempo real durante la
   videollamada.

2. Identidad sintética en procesos KYC. Los generadores actuales (Flux,
   SDXL) producen caras y DNIs sintéticos indistinguibles. Detectamos
   generadores modernos con AUC 0,945 cross-source.

3. Fraude documental en procesos digitales. Splicing, copy-move, inpainting
   y alteración de MRZ en DNIs, pasaportes, facturas y contratos. AUC 0,958
   sobre CASIA 2.0.

Además: trazabilidad criptográfica nativa (ISO/IEC 27037, RFC 3161 TSA)
conforme a los requisitos de cadena de custodia forense de la Guía CCN-STIC
de ciberseguridad.
```

### Campo: Alineación con las líneas estratégicas del INCIBE
```
Alineación directa con 4 líneas estratégicas de INCIBE:

- Ciberseguridad aplicada a IA (prioridad 2024-2027)
- Protección de identidad digital
- Ciberseguridad en servicios financieros y seguros
- Capacidades forenses digitales (CCN-STIC)

Deep-Check puede integrarse como capa de verificación en los pilotos de la
Red Nacional de SOC (CCN-CERT) y contribuir al Plan Nacional de
Ciberseguridad 2026-2030.
```

### Campo: Producto mínimo viable (MVP)
```
Producto en producción desde marzo 2026, con cliente pagando. URL:
https://deep-check-two.vercel.app

Stack técnico completo desplegado:
- Frontend Next.js 16 en Vercel EU
- Backend Node.js + PostgreSQL (Supabase)
- Pipelines ML en AWS eu-west-1 (g5.12xlarge, 4× A10G)
- ML Worker FastAPI con 9 modelos entrenados
- Inferencia biométrica en navegador vía WebAssembly ONNX
- Infraestructura IaC reproducible
```

### Campo: Por qué INCIBE Emprende
```
Necesito acceso a corporates regulados (banca, seguros, energía, sector
público) donde el fraude sintético crecerá exponencialmente con el AI Act.
INCIBE Emprende ofrece ese acceso de forma única mediante el showcase anual
y el sello INCIBE como proveedor validado. Además, quiero contribuir al
ecosistema público español de ciberseguridad como empresa europea con
tecnología propia, no como reseller de herramientas extranjeras.
```

---

## 🟣 KFUND (Pre-seed deep tech)

**URL**: https://kfund.vc/contact
**Email contacto**: hola@kfund.vc (o vía warm intro)
**Ticket típico**: 150 k€ – 500 k€ pre-seed
**Partner más afín**: **Iñaki Arrola** (ex-coches.com, deep tech + B2B SaaS)

### Campo: Resumen ejecutivo (máx. 300 palabras)
```
Deep-Check is Europe's forensic layer against AI-driven fraud — deepfakes,
synthetic identities, and tampered documents. A single SaaS platform that
verifies authenticity across video, image, documents and behavioral biometrics,
emitting cryptographically signed forensic reports compliant with ISO/IEC 27037
and eIDAS RFC 3161 timestamping.

Built in 15 months by one founder. 213 000 lines of code in production, 197
commits, 9 ML models trained end-to-end on AWS eu-west-1 (4× A10G). Live
product since March 2026. Monthly recurring revenue of €3,200 (growing +50%
MoM), signed annual enterprise contract, verified pipeline with IE University
(€100 k ticket potential), corporate client Zeus, and EUS Energía.

The market is being pushed simultaneously by two forces: (1) generative AI
commoditizing synthetic content indistinguishable from reality (Sora 2, Flux,
Midjourney), and (2) the EU AI Act Article 50 forcing detection from August
2026 with penalties up to 3% of global turnover. Existing solutions are
single-vector (Sensity — faces only, Truepic — capture-only, Reality Defender
— cloud-only, non-EU). Deep-Check is the only multi-vector, EU-native,
cryptographically-auditable platform.

Privacy-by-design: all biometric inference runs in-browser via WebAssembly
ONNX — biometric data never leaves the user's device. GDPR and AI Act
compliant by architecture.

Raising €120 k pre-seed for 12% equity (post-money €1.0M). 18 months runway.
Milestones: month 6 — 5+ enterprise clients paying, €15 k+ MRR; month 12 —
ISO/ENS certifications closed, €30 k+ MRR, AI Act enforcement live; month 18
— ready for Series A at €50 k+ MRR.

Looking specifically for Kfund's expertise in European deep tech SaaS and
the B2B enterprise sales network Iñaki Arrola has built across the peninsula.
```

### Campo: Why now
```
Three converging vectors create a strict 18-month window:

(1) Generative models crossed the perceptual threshold in Q4 2024. Flux, Sora 2
    and SDXL-Turbo produce output that even trained human reviewers cannot
    flag. Before this, forensic detection was a "nice to have". Now it's
    existential for any regulated digital process.

(2) EU AI Act Article 50 enforcement starts August 2026. Every bank, insurer,
    media outlet and public administration in the EU will be legally required
    to detect synthetic content. There is no in-house solution at scale. The
    market is forced to buy.

(3) The detection arms race is accelerating. V10 (ours, trained April 2026)
    already handles Sora 2 output. Waiting 12 months means competing against
    whoever shipped first. We have a head start and a defensible moat through
    multi-modal cryptographic traceability.
```

### Campo: Why us
```
Built alone in 15 months: 213 k LOC, 9 trained ML models from scratch, 2
certifications in progress, real paying clients, signed enterprise contract.
That execution density — without a team, without external capital — is the
strongest signal of founder-market fit.

Pablo (founder) combines (a) 6+ years of production ML engineering, (b)
regulatory literacy (GDPR, AI Act, eIDAS, ISO 27001), and (c) commercial
traction in Spanish enterprise (insurance + banking conversations active).
No other Spanish founder has simultaneously shipped 9 ML models, a
production SaaS, regulatory certifications and a paying client pipeline at
pre-seed stage.

The product itself is the proof. Demo is a 20-minute call away.
```

---

## 🟢 WAYRA (Telefónica Open Innovation)

**URL**: https://www.wayra.com/en
**Programa**: Wayra Scale (post-MVP con tracción) — ticket 50 k€ + acceso a
Telefónica como cliente
**Ventaja**: Telefónica es cliente potencial directo (fraude en Movistar Bank,
en Fusión, en identidades móviles).

### Campo: Tecnología y propiedad intelectual
```
Nueve modelos de IA entrenados desde cero sin dependencia de APIs externas:

- V10 VideoMAE-L (vídeo deepfake, 304 M params, AUC 0,98)
- V9.4 DINOv3 (imagen AI, 303 M params, AUC 0,945)
- Doc Forensics V2b DINOv2 + ELA (docs, 304 M params, AUC 0,958)
- Keystroke Transformer (conductual, 3,3 M params, bot-AUC 0,949)
- V3 EfficientNet-B4 (ONNX browser, 18,6 M params)
- Qwen 2.5 3B fine-tuned para análisis semántico de documentos
- 3 modelos auxiliares de preprocesado (face align, OCR, MRZ)

Stack completo: 213 000 líneas de código propio, 197 commits en 15 meses,
infraestructura IaC reproducible. Marca "Deep-Check" en registro OEPM +
EUIPO (clases 9 y 42). Cadena de custodia criptográfica con sellado eIDAS
alineada con ISO/IEC 27037 — diferenciador competitivo defendible.
```

### Campo: Encaje con Telefónica
```
Cinco puntos de integración natural con el grupo Telefónica:

1. Movistar Bank / Fusión — verificación KYC en onboarding digital, prevención
   de fraude de identidad sintética.
2. Movistar Prosegur Alarmas — verificación de vídeo en incidencias remotas.
3. Telefónica Tech Cyber & Cloud — integrar Deep-Check como capability en
   servicios gestionados.
4. Telefónica España — detectar deepfakes en grabaciones de call center
   contra fraude CEO.
5. Novum / Telefónica Seguros — verificación de siniestros fotográficos (10-15 %
   incluyen manipulación).

Propuesta de piloto: 90 días, 2 vectores (vídeo + documento), caso de uso
acotado (fraude CEO o siniestro), coste cerrado, métricas medibles.
```

---

## 📋 Checklist antes de enviar cada formulario

1. ☐ Releer el campo "why us / why now" — ajustar tono al programa
2. ☐ Adjuntar **pitch deck PDF** (05_pitch_deck.pdf) si el formulario permite
3. ☐ Adjuntar **one-pager PDF** (07_onepager_deepcheck.pdf) si pide summary
4. ☐ Verificar teléfono y email — aparece correctamente `pablo.lprdz@gmail.com`
   y `+34 690 906 834`
5. ☐ Verificar URL producto `https://deep-check-two.vercel.app` funciona en
   tiempo real
6. ☐ Si el formulario pide "pitch video", grabar loom de 3 min con demo del
   producto (NO obligatorio en primera ronda)

---

## ⏰ Timeline de envío sugerido

| Día | Programa | Tiempo estimado | Prioridad |
|-----|----------|----------------|-----------|
| D1 | **Kfund** (email warm a Iñaki Arrola) | 20 min | 🔴 Alta |
| D1 | **Lanzadera** (formulario online) | 90 min | 🟠 Media-alta |
| D2 | **INCIBE Emprende** (formulario + memoria) | 120 min | 🟡 Media |
| D3 | **Wayra** (formulario) | 60 min | 🟡 Media |
| D4-7 | Follow-ups + warm intros por LinkedIn | 2 h/día | 🔴 Alta |

**Regla de oro**: nunca mandar dos formularios el mismo día con textos
idénticos. Cada uno adaptado al vocabulario y prioridades del programa —
los evaluadores comparan entre aplicaciones y detectan copy-paste.

---

## 💡 Programas secundarios (aplicar si los primeros cierran sin oferta)

- **Demium** (Valencia/Madrid) — 150 k€ × 10 %, co-founder matching
- **Bolt** (valencia) — pre-seed vertical tech (B2B software)
- **Eatable** (Madrid) — focus AI + biotech, red de advisors corporativos
- **SeedRocket** (Barcelona) — programa veterano, 50 k€ + mentoring
- **ENISA Emprendedoras** (público) — préstamo participativo 25 k€ – 300 k€
  (sin equity, condiciones muy favorables)
- **CDTI NEOTEC** (público) — 325 k€ para spin-offs / deep tech (no exige
  equity, pero tarda 6-9 meses en resolver)

**Combo recomendado**: Kfund / Lanzadera (equity) + ENISA + NEOTEC (deuda
pública sin dilución) en paralelo. La dilución se queda en 12-20 % y la
caja puede escalar a 400-600 k€ totales en 12 meses sin cerrar una Serie A
demasiado pronto.
