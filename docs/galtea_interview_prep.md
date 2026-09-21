# Galtea Interview Prep — Forward Deployed Engineer
**Candidato:** Pablo Lopez Rodriguez
**Fecha:** Abril 2026

---

## 1. Sobre Galtea (conoce bien la empresa)

**Qué hacen:** Plataforma de evaluacion de agentes AI para empresas. Ayudan a que los equipos sepan si sus agentes funcionan BIEN antes y durante produccion.

**Producto core:**
- Generacion de datos sinteticos (test cases automaticos desde el system prompt)
- Simulacion de usuarios realistas (personas sinteticas, edge cases, adversarial)
- Metricas de evaluacion (alucinaciones, bias, seguridad, toxicidad)
- Dashboard en tiempo real + reportes de compliance
- Python SDK + REST API para integrar en CI/CD

**Flujo:** Onboard agent -> Generar usuarios sinteticos -> Evaluar -> Analizar resultados -> Iterar

**Funding:** EUR 2.7M seed (USD 3.2M) — 42CAP (lead), Mozilla Ventures, JME Ventures
**Origen:** Spin-off del Barcelona Supercomputing Center (BSC), oct 2024
**Equipo:** ~12 personas
**Clientes:** Telefonica, ABANCA

**Equipo clave:**
- Jorge Palomar (CEO) — ex-BSC, ex-Amazon. Publica el job posting. Probablemente tu hiring manager.
- Baybars Kulebi (CTO) — PhD Astrofisica, ML expert. Tu evaluador tecnico.
- Marta Villegas (CSO) — 30+ anios NLP, lidera BSC Language Technologies. La ciencia detras del producto.

---

## 2. El Rol de FDE en Galtea

**Tu funcion:** Eres el puente entre el producto de Galtea y los clientes enterprise. No solo vendes — integras, despliegas, resuelves problemas tecnicos, y aseguras que el cliente saca valor real.

**Dia a dia tipico:**
- Llamadas con clientes para entender su stack AI (que frameworks, que modelos, que problemas)
- Onboarding tecnico: conectar sus agentes a Galtea (SDK/API)
- Configurar metricas de evaluacion especificas por cliente
- Debugear problemas de integracion
- Reportar feedback del cliente al equipo de producto
- Demo del producto a prospects tecnicos

**Lo que buscan en ti:**
- Capacidad tecnica (sabes programar, entiendes ML/AI, puedes leer codigo del cliente)
- Capacidad de comunicacion (explicas cosas complejas de forma simple)
- Autonomia (en un equipo de 12, no hay micro-management)
- Orientacion a cliente (no ego de ingeniero, sino resolver SU problema)

---

## 3. Tu Pitch (60 segundos)

"Soy Pablo, ingeniero de software con 5+ anios en banca enterprise (CaixaBank). En paralelo construi Deep-Check, una plataforma de verificacion de identidad con IA que detecta deepfakes. Entrene los modelos yo mismo — EfficientNet, DINOv2, DINOv3 — con validacion cross-source en 700K imagenes, logrando AUC 0.991. Todo corre client-side en el navegador via ONNX WebAssembly. Tengo 8 productos en produccion, API REST, y estoy preparando submission a NIST.

Lo que me atrae de Galtea es que estoy resolviendo el mismo problema desde el otro lado: yo construyo modelos AI que necesitan ser evaluados y desplegados de forma fiable. Entiendo la friccion que hay entre un modelo que funciona en un notebook y uno que funciona en produccion — la vivia todos los dias. Ademas, construi un prototipo del Deploy Agent de Galtea: un CLI que escanea repos, detecta frameworks AI, y genera automaticamente el codigo de integracion."

---

## 4. Preguntas que te haran y como responder

### "Por que Galtea?"

"Porque la evaluacion de AI es el cuello de botella invisible. Todo el mundo habla de construir agentes, nadie habla de asegurarse de que funcionan. Galtea esta en la posicion perfecta — spin-off del BSC con ciencia seria detras, funding de Mozilla Ventures que entiende la mision, y un producto que resuelve un dolor real de enterprise. Yo vengo del lado del builder — se lo que es entrenar un modelo 3 dias y que falle en produccion. Quiero estar del lado de la solucion."

### "Cuentame sobre Deep-Check"

"Deep-Check es una plataforma de verificacion de identidad con IA. Detecta deepfakes, documentos manipulados, y fraude visual. Lo especial es que todo el procesamiento biometrico corre en el navegador del usuario — cero datos enviados al servidor. Uso ONNX Runtime WebAssembly para inferencia client-side.

Entrene un ensemble de 6 capas: rPPG (flujo sanguineo), FACS (micro-expresiones), EfficientNet-B4 pixel analysis, CNN blendshape, y keystroke biometrics. La fusion es Bayesiana en espacio de logits. El modelo principal V3 tiene AUC 0.9999 en benchmark interno y V8 con DINOv3 tiene AUC 0.991 en validacion cross-source con 7 datasets.

El stack es Next.js, TypeScript, Tailwind, Supabase para auth, Neon para DB, Paddle para pagos, y AWS EC2 con A10G GPUs para entrenamiento. Tengo 8 productos consumer live."

### "Cuentame un problema tecnico dificil que resolviste"

"El mayor fue el domain gap en deepfake detection. Mi modelo V3 con EfficientNet-B4 tenia AUC 0.9999 en benchmark — parecia perfecto. Pero cuando usuarios reales lo probaban con fotos de movil, clasificaba fotos reales como deepfakes.

El problema era que entrene con datasets limpios (FFHQ, StyleGAN) pero las fotos reales tienen compresion JPEG, blur de movimiento, diferentes iluminaciones. Ademas, los generadores modernos como Stable Diffusion y MidJourney no dejan los mismos artefactos que StyleGAN.

La solucion fue cambiar a foundation models (DINOv2/v3 con 303M parametros) con fine-tuning en datasets cross-source, descargue datasets con imagenes de Flux, SDXL, DALL-E 3, MidJourney. Ademas anadi branches de analisis de frecuencia (SRM filters para detectar ausencia de ruido de sensor) y un sistema de gating que el modelo aprende a activar solo cuando ayuda.

El resultado: el modelo generaliza mucho mejor. Es un ejemplo perfecto de por que la evaluacion pre-produccion importa — mi benchmark decia 0.9999 pero la realidad era otra."

### "Como manejas un cliente dificil / un problema sin solucion clara?"

"En CaixaBank trabajo con stakeholders que no son tecnicos pero tienen requisitos muy especificos de compliance. Lo clave es: escuchar primero, reproducir el problema, y ser transparente sobre lo que puedo y no puedo hacer.

Con Deep-Check tuve un caso similar: usuarios me reportaron que el modelo clasificaba imagenes AI como reales. En vez de decir 'el modelo tiene AUC 0.99', investigue, descubri que el training data no tenia generadores modernos, y cambie la estrategia. Transparencia > ego."

### "Que sabes de evaluacion de AI?"

"La evaluacion honesta tiene que ser cross-source — no puedes validar con datos del mismo dominio que entrenaste. Lo aprendi por las malas: mis primeros modelos tenian AUC 0.99 en benchmark pero fallaban en produccion.

Para Galtea, lo que me emociona es la generacion automatica de test cases. Es exactamente lo que falta: los equipos no tienen tiempo de crear datasets de evaluacion diversos. Galtea lo automatiza con simulacion de usuarios sinteticos y edge cases adversariales. Eso es lo que habria necesitado yo desde el dia 1."

### "Como integrarias Galtea en el pipeline de un cliente?"

"Empezaria con una discovery call — entender su stack (que framework, que modelos, que metricas les importan). Luego un pilot de 1 semana con 2 agentes: uno high-risk y uno high-volume.

Tecnicamente: conectar via Python SDK o REST API, definir metricas custom (precision, latencia, alucinaciones), configurar simulations, y mostrar el dashboard con resultados reales. El goal del pilot es que el cliente vea valor en datos, no en slides.

De hecho, construi un prototipo de esto — mi deploy agent CLI escanea repos, detecta 8 frameworks AI (LangChain, LlamaIndex, CrewAI, OpenAI, etc.), y genera el codigo de integracion. Lo probe contra un repo de LangChain y detecto 87 archivos AI, 132 agentes, 3 frameworks."

---

## 5. Preguntas para hacerles TU

1. "Como es el proceso de onboarding tipico de un cliente enterprise? Cuanto tarda desde primer contacto hasta que estan evaluando agentes?"

2. "Que tipos de agentes AI veis mas en vuestros clientes? RAG, multi-step, tool-calling?"

3. "Cual es el mayor friction point que encontrais cuando un cliente intenta integrar Galtea?"

4. "Como veis la relacion entre el FDE y el equipo de producto? El feedback del cliente influye directamente en el roadmap?"

5. "Estais viendo que los clientes piden evaluacion de modelos multimodales (imagen, video) ademas de texto? Porque ahi Deep-Check podria ser una pieza complementaria interesante."

---

## 6. Tu Diferenciador vs Otros Candidatos

| Lo que otros tienen | Lo que TU tienes |
|---------------------|------------------|
| Experiencia en ML | Entrenaste modelos TU MISMO (7 versiones, 700K imagenes, GPUs) |
| Conocimiento de APIs | Construiste una plataforma SaaS completa en produccion |
| Background en startup | Construiste Deep-Check desde cero (modelos + frontend + backend + DevOps) |
| Ingles fluido | Enterprise banking experience (CaixaBank) + startup founder |
| Saben que es un FDE | Ya construiste un prototipo del deploy agent de Galtea |

---

## 7. Cosas que NO debes hacer

- No hables demasiado de Deep-Check sin conectarlo a Galtea
- No uses jerga tecnica sin explicar (ellos la saben, pero muestra que sabes comunicar)
- No critiques su producto (ni siquiera constructivamente en primera entrevista)
- No menciones la integracion Galtea-Deep-Check que construiste LOCALMENTE (es secreto)
- No digas que usas Claude/AI para programar (mantener la apariencia de que todo lo hiciste tu)
- No pidas salario en primera ronda
- No llegues sin haber probado galtea.ai (si tiene free trial, usalo antes)

---

## 8. Preparacion Practica

### Antes de la entrevista:
- [ ] Registrate en galtea.ai si hay free trial
- [ ] Lee el articulo de Mozilla Ventures sobre Galtea
- [ ] Revisa los LinkedIn de Jorge, Baybars y Marta
- [ ] Ten la demo del deploy agent lista por si la piden
- [ ] Prepara tu pantalla (Deep-Check live, terminal limpia, deploy agent)

### Dia de la entrevista:
- [ ] Vistete smart-casual (startup Barcelona, no traje)
- [ ] Ten Deep-Check abierto en una pestana
- [ ] Ten el deploy agent listo para demo
- [ ] Ten datos de rendimiento de Deep-Check a mano (AUC, EER, datasets)
- [ ] Llega 2 min antes a la call, no 10

---

## 9. El Deploy Agent (tu arma secreta)

Si te piden una demo o te preguntan "que preparaste":

```bash
python scripts/galtea_deploy_agent.py /path/to/ai-repo
```

Esto:
1. SCAN: detecta archivos AI en el repo
2. INSTRUMENT: genera galtea_config.py, galtea_specs.py, galtea_eval.py
3. TEST: verifica la configuracion
4. REPORT: genera informe de integracion
5. PR: prepara un pull request

Probado contra LangChain: 87 AI files, 132 agents, 3 frameworks detectados.

**Frase clave:** "Antes de aplicar, quise entender el problema desde dentro. Construi un prototipo del deploy agent — me ayudo a entender el friction del onboarding y a pensar en como reducirlo."
