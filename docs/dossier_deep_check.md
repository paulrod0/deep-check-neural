# Deep-Check

**Dossier Informativo**
**Abril 2026**

---

## En una frase

**Deep-Check es una plataforma de análisis forense de autenticidad digital —
detecta manipulación en vídeos, imágenes y documentos mediante varias capas
independientes de inteligencia artificial, con arquitectura privacy-by-design
y trazabilidad criptográfica completa.**

---

## 1. Qué es Deep-Check

Deep-Check es un producto **desarrollado íntegramente en España** durante
2024-2026 sobre infraestructura cloud europea.

Combina **modelos propios de machine learning** entrenados con datasets
forenses académicos y material propio, arquitectura **privacy-by-design**
(el análisis biométrico se ejecuta en el navegador del usuario — los datos
biométricos nunca salen del dispositivo) e integración nativa con los
estándares técnicos y regulatorios europeos.

El producto está sometido a benchmarks industriales conforme **ISO/IEC 30107-3
(PAD — Presentation Attack Detection)**.

---

## 2. Qué puede analizar

### 2.1 Vídeo — Detección de deepfakes

Deep-Check detecta vídeos manipulados mediante las técnicas más extendidas
en 2026:

- **Face swap** — sustitución completa de una cara por otra
- **Face reenactment** — transferir expresiones de una persona a otra
- **Lip sync manipulation** — desalineación entre audio y labios
- **Neural textures** — manipulaciones sutiles generadas por redes neuronales
- **Full synthesis** — vídeos íntegramente generados por IA (Sora 2, Veo 3,
  Runway Gen-3, Kling, Pika)

El sistema trabaja a nivel de clip completo, extrayendo ventanas temporales
alrededor de la cara detectada y analizando la consistencia temporal, los
artefactos de compresión y los invariantes físicos (movimiento, iluminación).

**Robustez:** el modelo mantiene rendimiento bajo condiciones reales de
distribución de vídeo — compresión JPEG/H.264, reescalado, reencoding de
apps de mensajería, recortes y filtros de color. La inferencia ocurre en
**tiempo real** en hardware estándar, lo que permite integrarlo en
videollamadas en vivo.

### 2.2 Imagen — Detección de imágenes generadas por IA

Modelo fotográfico entrenado sobre múltiples datasets académicos que cubre
los generadores modernos en producción:

- StyleGAN2 y StyleGAN3
- Stable Diffusion XL y variantes
- Flux 1.1 Pro
- MidJourney v6 y v7
- DALL-E 3
- DeepFloyd IF
- Ideogram
- Playground AI

Además, un modelo complementario cubre los generadores más recientes
(2025): Sora 2, Veo 3, Kling, Runway Gen-3, Pika 2.

El análisis detecta tanto las imágenes completamente sintéticas como las
fotografías reales con regiones alteradas (edición parcial por IA).

### 2.3 Documentos — Forense documental

Deep-Check detecta manipulación en documentos escaneados y fotografías
de documentos:

- **Splicing** — pegado de una región procedente de otra imagen
- **Copy-move** — copiar y pegar dentro del mismo documento
- **Inpainting / generative fill** — rellenado por IA
- Manipulación del **MRZ** (Machine Readable Zone) de pasaportes y DNI
- Alteración de campos de texto (fechas, importes, firmas manuscritas)
- **Doble compresión JPEG** (indicio de re-guardado tras edición)
- Análisis **ELA** (Error Level Analysis)
- Análisis **EXIF** — metadatos, software editor, timestamps de cámara
- **Ghost detection** en JPEG
- Detección de **superposición digital** de texto sobre fondo original

**Formatos soportados:** PDF, JPEG, PNG, TIFF, WEBP, HEIC. OCR multilenguaje
integrado para extraer texto estructurado.

### 2.4 Biometría de comportamiento — Keystroke dynamics

Modelo de redes neuronales Transformer propio que analiza la dinámica
de tecleo (tiempos entre pulsaciones, presión relativa, patrones de
corrección).

Permite:

- Verificar si un contenido fue tecleado realmente por la persona que
  consta como autora
- Distinguir un usuario humano de un bot
- Detectar suplantación por sustitución de operador en tiempo real

---

## 3. Trazabilidad criptográfica completa

Todas las piezas de evidencia que pasan por Deep-Check quedan registradas
en una cadena de custodia append-only con las siguientes propiedades:

1. **Ingesta:** cada archivo recibe un hash SHA-256 al entrar. Se solicita
   sellado de tiempo cualificado RFC 3161 a una autoridad de sellado de
   tiempo (TSA) externa.

2. **Registro append-only:** todos los eventos (ingesta, análisis,
   exportación) se almacenan en una base de datos con triggers que
   **impiden UPDATE y DELETE** a nivel del sistema. Cada entrada está
   criptográficamente enlazada a la anterior mediante hashes concatenados.

3. **Sellado de cadena:** antes de emitir un informe final, se calcula un
   hash Merkle de toda la cadena. Ese hash se sella con la TSA y queda
   plasmado en el documento final.

4. **Verificación pública:** cualquier tercero puede validar la integridad
   criptográfica de toda la cadena sin autenticación, mediante un endpoint
   público de verificación.

**Estándares cubiertos:**

- **ISO/IEC 27037:2012** — identificación, recogida, adquisición y
  preservación de evidencia digital
- **ISO/IEC 27042:2015** — análisis e interpretación de evidencia digital
- **ISO/IEC 30107-3** — detección de ataques de presentación biométricos
- **eIDAS (UE 910/2014) Art. 42** — sellos de tiempo cualificados
- **UNE 71506:2013** — metodología de análisis forense informático
- **RGPD Art. 9** — tratamiento de datos biométricos (DPIA implementada)

---

## 4. Casos de uso reales

### 4.1 Banca y seguros

- **Onboarding KYC reforzado** — distinguir vídeo real del usuario vs
  deepfake en la fase de verificación de identidad
- **Fraude en siniestros** — autenticidad de fotos y vídeos aportados
  como prueba de daños
- **Verificación de contratos firmados a distancia** — detectar
  alteraciones en documentación escaneada

### 4.2 Medios y comunicación

- **Verificación de fuentes** — redacciones que reciben vídeos anónimos
  y necesitan confirmar autenticidad antes de publicar
- **Desinformación política** — detección de contenido generado por IA
  en campañas electorales
- **Fact-checking automático** — integración en flujos editoriales

### 4.3 Recursos humanos y selección

- **Autenticidad de entrevistas por vídeo** — verificar que el candidato
  entrevistado es el que aparece
- **CV y referencias fraudulentas** — detectar documentos manipulados
- **Detección de bots en pruebas técnicas** — keystroke biometrics
  identifica si la prueba la resolvió un humano o un automatismo

### 4.4 Defensa y ciberseguridad

- **Anti social-engineering** — protección contra deepfake en
  videollamadas de mando (el ataque a Arup de 2024 donde se sustrajeron
  £20M por un deepfake en videollamada)
- **OSINT y contrainteligencia** — análisis de contenido atribuido a
  actores adversarios
- **Acceso a instalaciones sensibles** — verificación biométrica
  reforzada

### 4.5 Redes sociales y plataformas

- **Moderación de contenido** — detección automática de deepfakes
  sexuales no consentidos y suplantación de identidad
- **Perfiles falsos** — detección de imagen de perfil generada por IA
- **Detección de catfish** en apps de citas

### 4.6 Sector corporativo general

- **Diligencia debida en M&A** — autenticidad de documentos corporativos
  aportados por la contraparte
- **Comunicaciones internas** — protección ante suplantación de
  ejecutivos en mensajes de vídeo
- **Auditoría interna** — trazabilidad de todas las evidencias
  digitales analizadas

---

## 5. Diferenciación técnica

| Producto | Enfoque | Limitación vs Deep-Check |
|----------|---------|--------------------------|
| Microsoft Video Authenticator | Imagen fija | No procesa vídeo ni trazabilidad criptográfica |
| Sensity AI | Solo deepfakes faciales | No analiza documentos ni biometría de comportamiento |
| Truepic | Autenticación en el momento de captura | No analiza contenido ya capturado |
| Reality Defender | Solo API en la nube | No tiene análisis on-premise ni browser-side |
| FacePhi | Biometría de identidad corporativa | No hace análisis forense ni detección de manipulación |

**Ventaja competitiva clave:** Deep-Check es el único producto que integra
**DETECCIÓN + TRAZABILIDAD CRIPTOGRÁFICA + INFORME AUTO-GENERADO** en un
único flujo de trabajo.

---

## 6. Stack tecnológico

| Componente | Tecnología | Notas |
|------------|-----------|-------|
| Frontend | Next.js 16, React 19, TypeScript | Renderizado server-side, PWA |
| Inferencia en navegador | ONNX Runtime WebAssembly | Biometría client-side |
| Modelos IA | PyTorch + HuggingFace Transformers | Arquitecturas state-of-the-art |
| Backend | PostgreSQL con triggers append-only | Custodia inmutable |
| Autenticación | OAuth 2.0 + JWT + SSO | Compatible estándares corporativos |
| Despliegue | Cloud o on-premise Docker | Air-gapped disponible |
| OCR | Motor multilenguaje integrado | Transparente para el usuario |
| Almacenamiento | Cifrado AES-256 | At-rest + in-transit |
| Timestamp | RFC 3161 | Swappable a TSA cualificada |

El **modo on-premise** permite despliegue en redes sin acceso a Internet
(defensa, infraestructura crítica, hospitales, administración), con
actualización de modelos mediante manifests firmados o carga manual por
soporte físico.

---

## 7. Arquitectura Veritas Ensemble

La decisión final de Deep-Check es el resultado de la **fusión Bayesiana
en espacio logit** de varias capas independientes de análisis:

- **FACS** — micro-expresiones faciales, consistencia biomecánica
- **Análisis pixel** — artefactos de generación en píxeles
- **CNN blendshape** — geometría facial 3D
- **Keystroke biometrics** — patrón de tecleo del operador
- **Multimodal fusion** — capa final con pesos aprendidos

Cada capa es independiente y puede activarse o desactivarse según el caso
de uso. La calibración final se realiza mediante **regresión isotónica**
sobre un conjunto de validación, de modo que el score reportado coincida
con la probabilidad real de manipulación (no es un simple porcentaje
arbitrario, es una probabilidad calibrada con significado estadístico).

---

## 8. Estado actual del producto

- Producto en producción desde marzo 2026
- Motor de vídeo desplegado
- Módulo de trazabilidad criptográfica ISO 27037 implementado (abril 2026)
- Generador automático de informes implementado (abril 2026)
- API REST pública con autenticación por API key
- SDK C++ preparado para certificación NIST FATE PAD
- Paper metodológico en preparación
- MCP Server con 9 herramientas para integración con asistentes IA
- ISO/IEC 27001 en evaluación
- iBeta PAD Level 1 en cola de certificación

---

## 9. Arquitectura de privacidad

- **Análisis biométrico client-side:** la cara del usuario nunca sale del
  navegador cuando se usa el modo on-browser. Los modelos se cargan vía
  WebAssembly y la inferencia ocurre en la GPU local.
- **Cifrado at-rest:** AES-256 en todos los almacenamientos.
- **Cifrado in-transit:** TLS 1.3 obligatorio.
- **Retention policy:** el usuario controla la retención; eliminación
  criptográfica garantizada.
- **Right to erasure (RGPD Art. 17):** endpoint dedicado para borrado
  completo de datos de un usuario.
- **Portabilidad (RGPD Art. 20):** exportación completa de datos en
  JSON firmado.
- **DPIA (RGPD Art. 35):** completada y publicada.

---

## 10. Iteración continua

Deep-Check incorpora un **pipeline de iteración automática**:

1. Cada versión del modelo se evalúa contra un conjunto de test fijo
2. Se identifican los casos difíciles (falsos positivos y falsos
   negativos con alta confianza errónea)
3. Se re-entrena el modelo sobre esos casos difíciles más muestras
   frescas de generadores modernos
4. Se compara la nueva versión con la anterior en múltiples métricas
5. Solo se promociona a producción si **todos** los criterios se cumplen,
   con rollback automático en caso contrario
6. Todo el histórico queda registrado en un audit trail público

Esto garantiza que el modelo **mejora de forma medible** sin introducir
regresiones ocultas.

---

## 11. Roadmap

- Iteración con casos difíciles de la versión anterior
- Endurecimiento adversarial (entrenamiento sobre ataques conocidos)
- Integración de audio-visual sync (detección de desfase labio-audio
  para deepfakes con clonación de voz)
- Fusión multimodal con calibración isotónica
- Exportación a formato ONNX para demo navegador
- Presentación NIST FATE PAD

Todos los hitos son técnicos y medibles, no de marketing.

---

## 12. Glosario

- **PAD** (Presentation Attack Detection) — detección de ataques
  dirigidos a sistemas biométricos.
- **ELA** (Error Level Analysis) — técnica forense que revela regiones
  editadas en JPEGs comparando niveles de compresión.
- **MRZ** (Machine Readable Zone) — franja de caracteres legibles por
  máquina en pasaportes y DNI.
- **EXIF** — metadatos estándar embebidos en archivos de imagen:
  software editor, cámara, timestamps, GPS.
- **Ghost detection** — identificación de zonas recomprimidas en JPEG
  que delatan manipulación previa.
- **FACS** (Facial Action Coding System) — sistema de codificación de
  expresiones faciales usado para detectar incoherencias biomecánicas
  en deepfakes.
- **ONNX** (Open Neural Network Exchange) — formato estándar para
  intercambio de modelos entre frameworks.
- **Veritas Ensemble** — arquitectura propietaria de fusión Bayesiana
  que combina las capas de análisis de Deep-Check.
