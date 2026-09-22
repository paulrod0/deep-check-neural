# Email/Mensaje a Angel Galán — Workday

**Fecha:** 6 mayo 2026
**Contexto:** Angel Galán ocupa puesto tech senior en Workday. Pablo le presenta Deep-Check con 3 caminos posibles: (1) rol Workday para Pablo, (2) Workday como cliente piloto, (3) warm intro a su red.

---

## OPCIÓN 1 — Mensaje LinkedIn directo (corto, primer contacto)

> Hola Angel,
>
> Te leo a través de [contexto de cómo llegó a él — completar]. Soy founder de Deep-Check, plataforma de verificación continua de identidad con IA 100% client-side (GDPR-native, EU AI Act compliant antes del 2 ago).
>
> Te resumo en una línea: detecto deepfakes en navegador con AUC 0.9999, ya está en producción, paper en Zenodo, NIST submission en marcha.
>
> Tres razones por las que te escribo a ti específicamente:
> 1. Workday tiene un dolor real con **anti-fraude en interviews remotas + onboarding KYC** (FBI alertó: 25% candidatos remotos US con deepfake en 2024)
> 2. EU AI Act Art. 50 obliga a clientes europeos de Workday a tener detección de contenido sintético desde agosto
> 3. Estoy explorando **mi siguiente paso profesional** y Workday está en mi shortlist de empresas donde aportar valor en IA/identity
>
> ¿Te encajaría una llamada de 20-30 min esta semana o la próxima? Te paso deck + producto live antes para que llegues con contexto.
>
> Pablo
> deep-check-two.vercel.app

**Caracteres:** ~720 — apto para mensaje LinkedIn (3000 char límite) y email.

---

## OPCIÓN 2 — Email completo (cuando Angel pida más detalle)

**Asunto:** Deep-Check + Workday — 3 ángulos (anti-deepfake interviews / EU AI Act / mi background)

**Cuerpo:**

> Hola Angel,
>
> Te dejo el contexto completo que me pediste.
>
> **Quién soy.** Pablo López Rodríguez, ingeniero IA con 10 años Python y 4 en IA generativa. Founder de Deep-Check desde 2025: plataforma de verificación continua de identidad que corre 100% en el navegador del usuario.
>
> **Qué hace Deep-Check.**
> - Detecta deepfakes (cara, voz, documentos) con 6 capas de evidencia bayesiana fusionadas: rPPG (flujo sanguíneo facial), FACS (microexpresiones), pixel CNN (EfficientNet-B4 propio), CNN blendshape, biometría keystroke
> - 9 modelos propios entrenados (DINOv3 ViT-L/16, EfficientNet-B4, Transformer encoder)
> - Cero datos biométricos salen del dispositivo del usuario — privacidad nativa, GDPR sin esfuerzo
> - AUC 0.9999 / EER 0.31% en 7 datasets Kaggle (155K imágenes)
> - AUC 0.945 cross-source contra modernos generadores (Flux, SDXL, DALL-E 3, MidJourney)
> - Doc forensics V2b: AUC 0.998 / EER 1.87%
> - Keystroke bot detection: AUC 0.949
>
> **Estado:**
> - Producto live: https://deep-check-two.vercel.app (prueba "Am I Real?" con tu webcam)
> - Paper publicado en Zenodo con DOI (CC BY-NC-ND 4.0)
> - NIST FATE PAD + FRTE 1:1 SDKs en C++ listos para submission
> - Docker on-premise stack para deployment enterprise (DB + REST + ML Worker GPU + auto-updater + Nginx)
> - Chrome Extension FakeCheck disponible
> - MCP server con 9 tools para integración con agentes IA
> - Billing Paddle activo (Starter 29€ / Pro 79€ / Enterprise custom)
> - Repositorio público bajo BSL: https://github.com/paulrod0/deep-check
>
> **Por qué es relevante para Workday.**
>
> Identifico 5 ángulos donde Deep-Check puede aportar valor a Workday y/o a tus clientes:
>
> 1. **Anti-fraude en interviews remotas.** El FBI alertó en 2024 que ~25% de candidatos remotos para puestos tech en US presentan rasgos de deepfake o identidad fabricada. Workday Recruiting podría integrar Deep-Check como capa de validación previa a la entrevista — el candidato hace un check de 60s en navegador, sin software a instalar.
>
> 2. **Onboarding KYC para nuevos empleados.** Workday HCM cuando onboarda a un nuevo trabajador hoy hace doc upload básico. Deep-Check añade: doc forensics (AUC 0.998), face match con foto carnet, liveness check anti-replay. Todo client-side, sin envío de biometría.
>
> 3. **Continuous workforce verification.** Para sectores regulados (banca, defensa, salud, gobierno) usuarios remotos hacen tareas críticas vía Workday daily. Deep-Check ofrece "session liveness check" cada N horas — confirmas que es el empleado, no un atacante con sesión robada.
>
> 4. **EU AI Act compliance llave en mano.** Article 50 entra en vigor el 2 agosto 2026. Obliga a sistemas IA que generan o detectan contenido sintético a transparencia y registros. Multas hasta 15M€ o 3% facturación. Deep-Check es compliant nativo desde diseño. Si Workday tiene clientes europeos con audit pendiente, Deep-Check les resuelve el 80% del cumplimiento técnico.
>
> 5. **Privacy como diferenciador competitivo.** Workday compite con SAP SuccessFactors y Oracle HCM. Privacy-by-design (zero biometric data leaves the browser) es un mensaje marketing potente para mercados EU/UK/Suiza/Canadá donde la sensibilidad regulatoria es alta.
>
> **Lo que estoy buscando.**
>
> Tres caminos posibles, no excluyentes:
>
> **A) Rol senior IA/identity en Workday.** Estoy explorando posiciones tech senior donde aportar lo que llevo construido. Si Workday tiene equipo en Madrid o remoto EU haciendo trabajo en biometría, identity, anti-fraud, AI compliance — me encantaría conocer a la persona contratante. Estoy abierto a aparcar Deep-Check 12-18 meses por la posición correcta. Full-time o part-time (4 días).
>
> **B) Piloto técnico Deep-Check ↔ Workday.** Pre-revenue todavía, pero con producto listo. Podríamos hacer un piloto pequeño (4-6 semanas) en uno de los ángulos arriba — el que menos fricción tenga internamente para ti. Sin compromiso económico hasta validar valor.
>
> **C) Warm intro.** Si ninguno de los dos aplica directamente, quizá conoces a alguien dentro o fuera de Workday a quien debería estar hablando. Cualquier persona en AI/identity/regtech europeo me ayuda mucho.
>
> **Lo que necesito de ti hoy.**
>
> Una llamada de 20-30 min para tu lectura honesta del producto y del encaje. Si encaja, definimos siguientes pasos. Si no, también está perfecto y agradezco mucho tu tiempo.
>
> Te dejo materiales en orden de profundidad:
>
> 1. **One-pager (1 página, 90 segundos):** [adjuntar `07_onepager_deepcheck.pdf`]
> 2. **Producto live (5 minutos):** https://deep-check-two.vercel.app — pulsa "Am I Real?"
> 3. **Deck overview (10 slides, 5 minutos):** [adjuntar `deep_check_overview_deck.pdf`]
> 4. **Caso de uso defense/regulado (cuando aplique):** [adjuntar `09_uso_defensa_seguridad_infra_criticas.pdf`]
> 5. **Paper Zenodo + repo GitHub** (cuando quieras profundidad técnica)
>
> Te paso huecos disponibles esta semana y la próxima:
>
> - Martes 12 mayo, 10:00-10:30 CET
> - Miércoles 13 mayo, 16:30-17:00 CET
> - Jueves 14 mayo, 11:00-11:30 CET
> - Viernes 15 mayo, 9:30-10:00 CET
>
> Si prefieres otro slot, dímelo y lo cuadramos.
>
> Gracias Angel, espero tus comentarios.
>
> Un abrazo,
> Pablo López Rodríguez
> +34 690 906 834
> pablo.lprdz@gmail.com
> deep-check-two.vercel.app
> linkedin.com/in/[Pablo añade aquí slug]

**Caracteres aprox:** 4500 — para email, no para LinkedIn DM.

---

## 🎯 Talking points para la llamada (cuando ocurra)

### Pregunta-paraguas para abrir
> "¿Cuál es el problema más caro de identidad/fraude que ves en Workday hoy o que te ven los clientes?"

→ Esto deja que Angel hable y te orienta hacia qué ángulo de los 5 destacar.

### Si Angel pregunta "¿por qué browser y no API?"
> "Tres razones: privacidad (cero biometría sale del dispositivo, GDPR sin esfuerzo), latencia (procesamiento en navegador es <500ms vs 2-5s round-trip API), y compliance (EU AI Act Art. 50 valora especialmente que el procesamiento ocurra local). Para enterprise tenemos fallback Docker on-premise con FastAPI + GPU."

### Si Angel pregunta "¿competencia?"
> "FacePhi y Veridas (España) y Onfido/iProov (UK) — son grandes pero todos cloud-side, no browser. Su diferenciador es el ecosistema de socios; el nuestro es la privacidad nativa y el cumplimiento EU AI Act fuera de la caja. Y nosotros hacemos detección de deepfake **moderno** (Flux, SDXL, DALL-E 3) — los demás están todavía optimizados para deepfakes 2020-2022 (StyleGAN, FaceSwap)."

### Si Angel pregunta "¿revenue?"
> "Cero todavía. Pre-seed. IE University estuvo cerca pero no encajó timing. Conversaciones activas con K Fund, JME Ventures, Adara Ventures, y angels (Iñaki Berenguer, François Derbaix). Ronda objetivo 400K@2.8M post."

→ Honestidad total. Si Angel valora bullshit, no es el aliado que buscas.

### Si Angel pregunta "¿por qué quieres trabajar para alguien si tienes esto?"
> "Capital. Llevo 12 meses bootstrap, runway personal agotándose. Workday me da estabilidad para profundizar en aprendizaje enterprise mientras mantengo Deep-Check vivo en bajo coste (10€/mes Vercel). Cuando levante ronda y tenga runway, decido si retomo full-time o si Deep-Check encaja como producto Workday."

→ Esta respuesta es **clave**. Demuestra madurez, no desesperación.

### Si Angel ofrece referirte a equipo Workday hiring
> "Te lo agradezco enormemente. ¿A quién debería conocer y qué deberían saber de mí antes de la conversación? Si quieres yo te paso una intro corta que reenvías o lo redactas tú — lo que te resulte más cómodo."

### Si Angel ofrece piloto Workday
> "Genial. ¿Cuál sería el siguiente paso? Necesito entender tu proceso interno: ¿hay equipo de innovation/labs? ¿Procurement? ¿Quién decide pilots? Mientras tú lo investigas, ¿te mando un scope de piloto de 4-6 semanas con KPIs medibles que tu equipo evalúe?"

---

## 🚫 Cosas que NO debes decir/hacer

| ❌ NO | ✅ SÍ |
|---|---|
| "Estoy desesperado, necesito empleo ya" | "Estoy explorando siguiente paso, Workday está en mi shortlist" |
| "El producto es perfecto, ya está terminado" | "Tenemos AUC 0.9999 en deepfakes legacy y 0.945 en modernos — sigue iterándose contra modelos nuevos" |
| "Workday debería comprarnos" | "Hay un piloto que podría hacer tu equipo en 4-6 semanas" |
| "Tengo VCs interesados" (sin nombres) | "Conversaciones activas con K Fund, JME, Adara — sin compromiso aún" |
| Pedir inversión personal a Angel en primera llamada | Esperar 2ª-3ª conversación, dejar que Angel lo proponga si encaja |
| Mandarle el deck completo de 10 slides en primer mensaje | Mandar one-pager 1 página, dejar que pida más |

---

## 📋 Checklist antes de mandar el mensaje

- [ ] Confirmar nombre completo + apellido correcto: Angel Galán
- [ ] Verificar puesto actual en Workday vía LinkedIn (rol exacto, no asumir)
- [ ] Identificar contexto de cómo llegáis a él (LinkedIn cold, evento, intro mutuo)
- [ ] Adjuntar los 4 PDFs: `07_onepager_deepcheck.pdf`, `deep_check_overview_deck.pdf`, `09_uso_defensa_seguridad_infra_criticas.pdf` (este último solo si encaja vertical)
- [ ] CV actualizado a mano (no el genérico) destacando IA/identity/cyber + Deep-Check
- [ ] Calendly link o huecos de calendario reales (no inventes huecos que luego no tengas)
- [ ] Probar el producto live en otra ventana 5 minutos antes — confirma que funciona
- [ ] Si tiene Open Profile en LinkedIn, mensaje directo (sin nota); si no, conexión + nota personalizada (cuidado cupo: te queda 1 nota personalizada del mes)

---

## ⚙️ Plan de seguimiento si NO responde

| Tiempo | Acción |
|---|---|
| Día 0 | Mensaje inicial enviado |
| Día +5 | Sin respuesta → bump LinkedIn ("¿te llegó?, te pongo en cola para próxima semana si te encaja mejor") |
| Día +12 | Sin respuesta → cambio de canal (email directo si conocido, o intro warm vía contacto común) |
| Día +21 | Sin respuesta → asumir no, archivar contacto, retomar dentro de 6 meses con update concreto |

---

## 📊 Métricas esperadas

- Probabilidad respuesta primera ola: **40-60%** (es un contacto de alguien específico, no cold investor)
- Probabilidad llamada agendada si responde: **70%**
- Probabilidad de los 3 caminos (rol/piloto/intro): rol 25%, piloto 15%, intro 40% (suman > 100% porque pueden combinarse)

---

## 🎬 Próximos pasos inmediatos para Pablo

1. **Confirmar rol exacto Angel en Workday** (LinkedIn primero)
2. **Decidir canal:** LinkedIn DM (si Open Profile) o email (si tienes su email)
3. **Copiar Opción 1** (mensaje LinkedIn corto) si es primer contacto
4. **Adjuntar one-pager** PDF
5. **Esperar respuesta**, NO bombardear
6. **Cuando responda**: usar Opción 2 (email completo) con calendario concreto
