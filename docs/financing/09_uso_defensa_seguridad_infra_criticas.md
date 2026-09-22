# Deep-Check en Defensa, Seguridad e Infraestructuras Críticas

**Verificación de autenticidad e identidad frente a la amenaza de la IA generativa**

---

## Resumen ejecutivo

Deep-Check es una plataforma española de **verificación forense digital** que detecta vídeos, imágenes y documentos manipulados o generados artificialmente, y certifica con validez legal que una persona, una imagen o un documento son auténticos. Está diseñada para entornos donde una decisión equivocada por suplantación de identidad o por contenido falso puede tener consecuencias graves: defensa, seguridad y operación de infraestructuras críticas.

Toda la infraestructura es europea (España e Irlanda), los datos biométricos no salen del dispositivo del usuario, y cada verificación se acompaña de un **informe pericial firmado criptográficamente**, admisible como prueba ante tribunales españoles.

---

## El problema que resuelve

En 2024-2026 los modelos de inteligencia artificial generativa (Sora 2, Flux, Stable Diffusion XL, DALL-E 3, Veo 3) producen vídeos, fotografías y documentos que el ojo humano **ya no distingue de la realidad**. Las consecuencias en sectores sensibles son tangibles:

- **Caso Arup (2024)**: una empresa de ingeniería transfirió £20 millones tras una videoconferencia en la que el "director financiero" era un deepfake en tiempo real.
- **Suplantación de mandos** en comunicaciones internas para autorizar transferencias, acceso a sistemas o filtración de información.
- **Documentos fraudulentos** en procesos de selección, contratación de proveedores, expedientes administrativos.
- **Desinformación dirigida** mediante vídeos atribuidos a líderes militares, políticos o ejecutivos.

A esto se suma una obligación legal inmediata: el **Reglamento Europeo de Inteligencia Artificial (AI Act)** obliga a partir del **2 de agosto de 2026** a detectar contenido sintético en operaciones formales (Artículo 50), con sanciones de hasta **15 millones de euros o el 3 % de la facturación global**, lo que sea mayor.

---

## Cómo funciona Deep-Check (en lenguaje accesible)

Deep-Check analiza una pieza de contenido (un vídeo, una foto, un documento) a través de **varias capas independientes** de inteligencia artificial. Cada capa busca un tipo de manipulación distinta. El sistema combina las opiniones de todas las capas en una decisión final.

### Las cuatro líneas de análisis

#### 1. Vídeo — detección de **deepfakes**
> Un *deepfake* es un vídeo en el que la cara o la voz de una persona ha sido sustituida o sintetizada por inteligencia artificial.

Deep-Check detecta los cinco tipos de manipulación más comunes en 2026:

- **Sustitución de cara** (face swap): poner la cara de A sobre el cuerpo de B.
- **Reanimación facial** (face reenactment): hacer que A diga o haga lo que A nunca dijo, copiando las expresiones de B.
- **Desincronización audio-labios**: la voz no coincide con el movimiento real de la boca.
- **Texturas neuronales**: alteraciones sutiles que no se ven, pero que delatan generación por IA.
- **Síntesis completa**: vídeos enteros generados desde cero por IA (Sora 2, Veo 3, Kling, Runway, Pika).

El sistema funciona sobre vídeos comprimidos como los que circulan por WhatsApp, Telegram, Signal o redes sociales — es decir, los que llegan en la práctica a las salas de operación.

#### 2. Imagen — detección de fotos generadas por IA

Modelo entrenado contra los generadores actuales: StyleGAN, Stable Diffusion XL, Flux, MidJourney, DALL-E 3, DeepFloyd, Ideogram, Playground AI. Resultado verificado: **AUC 0,945** sobre fakes recientes (donde 1,0 sería detección perfecta y 0,5 sería azar puro).

> **AUC** (*Area Under the Curve*): mide la capacidad de un sistema de distinguir lo auténtico de lo manipulado. Un valor de 0,90 o superior se considera de calidad operacional.

#### 3. Documentos — forensia documental

Deep-Check examina documentos escaneados o fotografiados (DNI, pasaportes, certificados, contratos, expedientes) y detecta:

- **Pegado de regiones** procedentes de otros documentos (*splicing*).
- **Copiar-pegar** dentro del mismo documento (firmas, sellos repetidos).
- **Rellenado por IA** de huecos o regiones (*inpainting*).
- **Manipulación del MRZ** (la franja de caracteres de pasaportes y DNIs leíble por máquina).
- **Re-guardado tras edición** (la "doble compresión JPEG", una huella técnica que delata ediciones).
- **Metadatos sospechosos** (software de edición declarado en EXIF, fechas inconsistentes).

Validado en **AUC 0,998** sobre datasets forenses académicos (CASIA, IDNet-2025).

#### 4. Biometría de comportamiento — patrón de tecleo

> La gente teclea de manera inconfundible: la velocidad entre teclas, el tiempo de pulsación, los patrones de corrección son una huella tan única como una firma manuscrita.

Permite verificar en tiempo real:

- Si quien escribe es realmente la persona que afirma serlo (incluso aunque haya entrado con la contraseña correcta).
- Si una respuesta a un examen, prueba técnica o formulario fue tecleada por un humano o por un bot/automatismo.
- Si en mitad de una sesión se produjo una **sustitución de operador** sin que medie nuevo login.

Detección de bots: **AUC 0,949**.

### Trazabilidad criptográfica completa

Toda pieza de evidencia que pasa por Deep-Check queda registrada en una **cadena de custodia digital** conforme a la norma internacional **ISO/IEC 27037:2012**. Esto significa:

- Cada archivo recibe una huella digital (SHA-256) en el momento de entrar.
- La fecha y hora se sellan con una **Autoridad de Sellado de Tiempo cualificada** según el Reglamento eIDAS, lo que la convierte en prueba legal en la Unión Europea.
- Cada operación posterior (análisis, exportación) se enlaza criptográficamente a la anterior. **Cualquier alteración rompe la cadena de forma detectable.**
- El sistema genera automáticamente un **informe pericial conforme a la norma UNE 197010:2015**, listo para ser ratificado por un perito informático colegiado y presentado en juzgado.

---

## Aplicación al sector defensa

### Briefings y videoconferencias de mando

Los oficiales y mandos intercambian información sensible en videoconferencias entre cuarteles y unidades distribuidas. Un deepfake en tiempo real de un superior puede:

- Autorizar movimientos de tropa, transferencias presupuestarias o acceso a sistemas.
- Filtrar información clasificada bajo apariencia de legítimo requerimiento.
- Manipular la cadena de mando en operaciones críticas.

Deep-Check se integra en la videoconferencia y emite una **alerta en directo** si detecta que el rostro o la voz no son coherentes con la persona enrolada.

### Inteligencia y contrainteligencia

Análisis forense de contenidos atribuidos a actores hostiles, líderes adversarios o personal propio. Cada análisis genera un informe trazable con cadena de custodia, válido para uso en investigaciones formales y, llegado el caso, en procedimientos judiciales.

### Verificación de personal en accesos remotos

Los contratistas civiles, asesores externos y personal en comisión de servicios acceden a instalaciones lógicas (sistemas de mando, redes clasificadas) desde ubicaciones diversas. Deep-Check verifica que la persona que entra es:

1. La titular del documento de identidad presentado.
2. Una persona real (no una foto o un vídeo pre-grabado).
3. La misma persona que se enroló inicialmente.

### Validación documental de contratistas

Contratos con proveedores, expedientes de homologación, certificados de seguridad. Detección de manipulación en escaneos digitales, con informe pericial automático.

---

## Aplicación al sector seguridad

### Anti-fraude por suplantación de identidad ("CEO fraud")

El fraude por suplantación de directivos en videoconferencias es la amenaza con mayor crecimiento en 2025-2026. Deep-Check protege:

- Llamadas de autorización de transferencias.
- Solicitudes urgentes de acceso a sistemas o información.
- Negociaciones de M&A donde la otra parte se conecta remotamente.

### Onboarding seguro de personal y contratistas

En procesos de incorporación remota:

- Verificación de identidad real (no un deepfake en la cámara del candidato).
- Validación documental de DNI, pasaporte, certificados académicos y profesionales.
- Pruebas técnicas con patrón de tecleo: confirma que los ejercicios los hace el candidato y no un tercero por él.

### Investigación forense post-incidente

Cuando se sospecha de evidencia digital manipulada (correos, capturas de pantalla, vídeos de cámaras, mensajes), Deep-Check emite un dictamen forense con cadena de custodia, idóneo para:

- Procedimientos disciplinarios internos.
- Denuncias judiciales.
- Reclamaciones a terceros.

### Verificación de proveedores en cadena de suministro

Contratos firmados a distancia, certificados de calidad, comunicaciones críticas con proveedores. Detección de documentos alterados antes de que el contrato esté firmado.

---

## Aplicación a infraestructuras críticas

> **Infraestructura crítica**: instalación cuya destrucción o paralización tiene un impacto grave en la seguridad, la economía o el bienestar de la nación. En España: energía, agua, transporte, salud, telecomunicaciones, financiero, alimentación, espacio, química, nuclear, instalaciones de investigación.

### Energía (eléctrica, gas, hidrocarburos)

- **Acceso remoto a sistemas SCADA**: verificación reforzada de los operadores que pueden modificar parámetros de plantas, subestaciones o redes.
- **Decisiones de corte/reposición de servicio**: cuando un mando autoriza por videoconferencia una operación crítica, se verifica que es realmente quien dice.
- **Cadena de mantenimiento**: técnicos y subcontratas que acceden a instalaciones sensibles, con validación documental y biométrica.

### Telecomunicaciones

- Verificación de técnicos en torres y centros de datos.
- Autorización remota de cambios de configuración en routers y switches de núcleo.
- Trazabilidad de accesos privilegiados.

### Sanidad

- **Receta electrónica y autorización facultativa remota**: verificación de que el médico que firma una autorización es realmente él (no un acceso suplantado a su credencial).
- **Acceso a historiales clínicos** con verificación reforzada en perfiles de alto riesgo (VIP, casos sensibles, pacientes notorios).
- **Telemedicina**: verificación tanto del facultativo como del paciente en consultas no presenciales.

### Banca, mercados y servicios financieros

- Autorizaciones de operaciones de alto importe entre filiales.
- Verificación de identidad en operaciones de banca privada de elevado valor.
- Procesos KYC reforzados para clientes corporativos y banca corresponsal.

### Transporte (aéreo, ferroviario, marítimo)

- Validación de identidad de operadores de control en torres de control y centros de gestión ferroviaria.
- Autenticidad de documentación entregada en aduanas y puertos.

### Administración pública

- Firma digital de funcionarios con verificación biométrica reforzada.
- Procesos administrativos sensibles (concesiones, licitaciones) con validación de los firmantes.

---

## Por qué importa ahora

### El AI Act entra en vigor el 2 de agosto de 2026

Su Artículo 50 obliga a:

- Quienes **desarrollan** sistemas de IA generativa: marcar el contenido para que sea detectable.
- Quienes **despliegan** deepfakes: revelar al público que el contenido ha sido generado o manipulado por IA.

Las sanciones por incumplimiento (Artículo 99) llegan a **15 millones de euros o al 3 % de la facturación global**, lo que sea mayor.

### El volumen de la amenaza

- El mercado mundial de detección de deepfakes pasa de **1.500 millones de dólares en 2025 a 15.000 millones en 2030** (CAGR 42 %), reflejo directo del crecimiento del problema.
- El fraude sintético en sectores empresariales crece a un ritmo del **30 % anual**.

### La oportunidad de soberanía digital

La mayoría de soluciones equivalentes son estadounidenses o israelíes. Deep-Check es una **propuesta soberana**: 

- Desarrollada en España.
- Infraestructura **íntegramente en territorio europeo** (AWS Irlanda + Vercel UE).
- Sin transferencia de datos biométricos a países terceros.
- Compatible con los marcos de cumplimiento exigentes del sector defensa y de las infraestructuras críticas: ENS (Esquema Nacional de Seguridad), eIDAS, RGPD, ISO/IEC 27001 (en proceso), ISO/IEC 27037 (implementada).

---

## Despliegue

| Modalidad | Descripción | Idóneo para |
|---|---|---|
| **SaaS en la nube europea** | Acceso vía API o panel web. Datos en AWS Irlanda. | Empresas, banca, sanidad, organismos públicos |
| **On-premise (Docker)** | Despliegue completo en infraestructura del cliente. Sin conexión obligatoria a Internet. | Defensa, instalaciones clasificadas, redes air-gapped |
| **SDK embebido** | Integración en aplicaciones propias (Windows, Linux, navegador). | Software corporativo a medida |

El modo on-premise permite operar en redes sin acceso a Internet, con actualización de modelos mediante manifiestos firmados o carga manual por soporte físico — el escenario habitual de instalaciones clasificadas y entornos críticos.

---

## Cumplimiento normativo y estándares cubiertos

- **ISO/IEC 27037:2012** — Identificación, recogida, adquisición y preservación de evidencia digital.
- **ISO/IEC 27042:2015** — Análisis e interpretación de evidencia digital.
- **ISO/IEC 30107-3** — Detección de ataques de presentación biométricos (PAD).
- **eIDAS (Reglamento UE 910/2014)** — Sellos de tiempo cualificados.
- **UNE 71506:2013** — Metodología de análisis forense informático.
- **UNE 197010:2015** — Criterios para informe pericial informático.
- **RGPD Art. 9** — Tratamiento de datos biométricos (DPIA implementada).
- **AI Act Art. 50** — Detección de contenido sintético.
- **ENS** (Esquema Nacional de Seguridad) — Hoja de ruta de adecuación a categoría ALTA en curso.
