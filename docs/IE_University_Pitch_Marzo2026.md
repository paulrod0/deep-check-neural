# Deep-Check — Plataforma de Verificación con IA
## Documento Ejecutivo | IE University · Marzo 2026

---

## Resumen Ejecutivo

- **El problema es ahora:** Las identidades sintéticas generadas por IA (deepfakes, avatares, documentos falsificados) han convertido la verificación de identidad remota en un problema crítico para universidades y empresas. La tecnología existente no fue diseñada para esta amenaza.
- **Deep-Check resuelve los tres vectores de fraude en un único sistema:** verificación de integridad en sesiones de vídeo en vivo, autenticación de documentos de identidad (KYC) y despliegue soberano en las propias instalaciones del cliente.
- **Posición única en el mercado:** somos la única plataforma que combina detección de deepfakes en tiempo real con KYC documental, sin que ningún dato biométrico abandone el dispositivo del usuario.
- **Para IE University:** solución inmediata para exámenes remotos, matriculación de estudiantes internacionales y programas de educación ejecutiva, con plena conformidad GDPR y opción de despliegue on-premise.

---

## El Problema: La Nueva Amenaza de las Identidades Sintéticas

La proliferación de herramientas de IA generativa ha democratizado la creación de identidades falsas con una fidelidad sin precedentes. Los modelos de difusión actuales generan rostros fotorrealistas en segundos; las soluciones de face-swap en tiempo real permiten suplantar a cualquier persona durante una videollamada.

**Las implicaciones para la educación son directas:**

- Suplantación de identidad en exámenes y defensas remotas, invalidando el proceso de evaluación.
- Documentos de identidad manipulados digitalmente que engañan a los sistemas OCR tradicionales en procesos de admisión.
- Fraude en becas y acreditaciones con documentos KYC adulterados.
- Impersonación en sesiones de educación ejecutiva de alto valor, donde los participantes acreditan su identidad como parte del programa.

Los marcos regulatorios (AI Act europeo, GDPR) exigen ya controles técnicos explícitos sobre la autenticidad de los procesos digitales. El coste reputacional de una brecha de integridad académica es inconmensurable.

---

## Deep-Check: La Plataforma de Verificación del Siglo XXI

Deep-Check opera sobre **tres pilares integrados** en una única interfaz y API:

### 1. Integridad de Sesión en Vivo
Análisis continuo del stream de vídeo del candidato durante exámenes, entrevistas o sesiones remotas. Detecta deepfakes, avatares de IA y suplantación física en tiempo real, sin interrumpir la sesión.

### 2. KYC Documental
Autenticación de documentos oficiales (pasaporte, DNI, permiso de conducir) con verificación biométrica facial contra selfie en vivo. Extracción y validación de zonas de lectura mecánica (MRZ) bajo estándar ICAO 9303, análisis forense de imagen y comparación facial neuronal. Todo el procesamiento biométrico se ejecuta en el dispositivo del usuario: ningún dato biométrico llega a ningún servidor.

### 3. Despliegue On-Premise / Soberanía del Dato
Stack completo en contenedores Docker que se instala en los servidores de la institución en menos de cinco minutos. Todos los modelos de IA se ejecutan localmente. Compatible con entornos sin acceso a internet (air-gap). Cero dependencia de servicios cloud de terceros.

---

## Tecnología Propietaria — El Ensemble Veritas

El núcleo de Deep-Check es **Veritas**, un sistema de IA multicapa de desarrollo propio que combina cinco señales independientes en una única puntuación de probabilidad de fraude:

| Capa | Señal analizada | Por qué importa |
|---|---|---|
| **rPPG (Fotopletismografía Remota)** | Flujo sanguíneo detectado en cambios de color de piel | Los deepfakes y avatares no tienen señal cardiovascular |
| **Análisis Temporal FACS** | Micro-expresiones, tasas de parpadeo, movimiento ocular | Las caras sintéticas presentan patrones temporales anómalos |
| **Forense de Píxel EfficientNet-B4** | Artefactos espectrales a nivel de píxel | Detecta huellas de modelos GAN y de difusión invisibles al ojo humano |
| **Modelo CNN Blendshape** | Dinámica de puntos de referencia faciales en el tiempo | Identifica animaciones sintéticas de landmarks faciales |
| **Detección Activa de Vida** | Reto-respuesta en tiempo real (parpadeo, giro de cabeza) | Verificación de presencia física confirmada por IA |

Las cinco señales se fusionan mediante **inferencia bayesiana** (fusión logit), eliminando falsos positivos y produciendo una puntuación de fraude interpretable con umbrales configurables por el cliente.

El modelo de forense de píxel (EfficientNet-B4) fue entrenado internamente sobre un dataset de más de 12.000 imágenes, alcanzando **AUC 1.0 en el conjunto de test**. Los modelos se distribuyen en formato ONNX, sin requisito de GPU, y se ejecutan con latencia inferior a 100 ms por fotograma.

---

## Privacidad y Soberanía del Dato

La arquitectura de Deep-Check fue diseñada desde su origen bajo el principio de **privacidad por diseño** (GDPR, Artículo 25):

- **Procesamiento biométrico client-side:** la comparación facial entre documento y selfie se ejecuta íntegramente en el navegador del usuario. Ningún dato biométrico abandona el dispositivo en ningún momento.
- **On-premise total:** el stack completo —modelos de IA, base de datos, API— puede operar dentro del perímetro de red de la institución, sin conexión exterior.
- **Sin almacenamiento de biometría:** por diseño arquitectónico, el sistema no persiste imágenes faciales ni vectores biométricos.
- **Cumplimiento del AI Act europeo:** el sistema incluye mecanismos de explicabilidad y umbrales de decisión auditables, requisito explícito del nuevo marco regulatorio para sistemas de IA de alto riesgo.
- **Compatible con air-gap:** apto para entornos de máxima seguridad sin acceso a internet.

Para una universidad con estudiantes de más de 130 nacionalidades, la soberanía del dato y el cumplimiento regulatorio no son opcionales — son condición de operación.

---

## Propuesta de Valor para IE University

| Caso de uso | Solución Deep-Check | Impacto |
|---|---|---|
| Exámenes remotos y defensas TFM/TFG | Verificación de integridad de sesión en tiempo real | Elimina la suplantación de identidad y el uso de IA en exámenes |
| Matriculación de estudiantes internacionales | KYC documental con validación MRZ y face-match | Acelera el proceso y previene fraude documental |
| Programas de educación ejecutiva | Verificación de participantes en sesiones de alto valor | Garantiza la acreditación legítima de los participantes |
| Acceso a recursos restringidos (biblioteca, laboratorios) | Liveness + face-match ligero | Control de acceso sin tarjetas físicas |
| Investigación | Acceso a datasets anonimizados y metodología | Partnership para publicaciones en detección de fraude con IA |

---

## Planes y Opciones de Colaboración

- **API Integration:** integración directa con Canvas, Moodle o LMS propio de IE mediante API REST documentada. Time-to-integration estimado: 2 semanas.
- **Enterprise On-Premise:** despliegue completo en infraestructura de IE University. SLA, soporte dedicado, modelos actualizados trimestralmente.
- **Pilot Programa:** 90 días de acceso completo para un caso de uso específico (p.ej. exámenes del programa Executive MBA), con métricas de eficacia y reporte final.
- **Research Partnership:** acceso preferente a nuevas capas del Ensemble Veritas, co-autoría en publicaciones, y dataset compartido bajo acuerdo de confidencialidad para investigación en detección de fraude.
- **White-Label:** opción de marca blanca bajo el nombre de IE University para uso interno o comercialización a otras instituciones.

---

## Ventaja Competitiva

| | Deep-Check | Onfido | Jumio |
|---|---|---|---|
| Detección deepfake en tiempo real | Sí | No | No |
| KYC documental | Sí | Sí | Sí |
| On-premise / soberanía del dato | Sí | No | No |
| Biometría client-side (cero upload) | Sí | No | No |
| Tiempo de despliegue | < 5 minutos | Semanas | Semanas |
| Latencia de análisis | < 100 ms/fotograma | Segundos (cloud) | Segundos (cloud) |
| Coste base | Desde 49 €/mes | Enterprise pricing | Enterprise pricing |

Los incumbentes fueron construidos para el fraude documental de la era pre-IA. Deep-Check fue construido específicamente para la amenaza de las identidades sintéticas generadas por modelos de difusión y GAN.

---

## Próximos Pasos

1. **Pilot de 90 días** — seleccionar un programa (Executive MBA recomendado) para desplegar verificación de integridad en exámenes remotos. Métricas acordadas, reporte al finalizar.
2. **Integración API con LMS** — sesión técnica de 2 horas con el equipo IT de IE para mapear la integración con el sistema de gestión académica actual.
3. **Acuerdo Enterprise / Research Partnership** — definir alcance contractual: licencia on-premise, SLA, y condiciones de partnership de investigación con el IE Center for the Governance of Change o equivalente.

---

*Confidencial — Propiedad Intelectual de Deep-Check / HiumSolutions. Documento preparado para reunión con IE University, Marzo 2026.*
