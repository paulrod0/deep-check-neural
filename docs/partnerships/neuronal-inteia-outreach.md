# Alianza LATAM — Deep-Check × Neuronal Vision (Newzenda) × Inteia

Material de outreach y tesis de complementariedad. Contexto técnico y de deploy en `CLAUDE.md` (sección *Partnerships*).

## Tesis en una frase
No son tres iguales sumando: es una **pila de valor**. **Inteia** = canal enterprise LATAM (trae las cuentas). **Neuronal / Face X** = producto biométrico de cara al cliente (reconocimiento 1:N + emoción). **Deep-Check** = la capa de integridad (anti-deepfake / PAD / liveness / forense) que va **dentro** de los productos de Neuronal, **delante** del match 1:N.

### Los 3 encajes
1. **Deep-Check va delante de Face-LogIn / Face-Access.** Su motor responde "es Pablo"; nosotros "Pablo es real, no un deepfake inyectado". Hoy su login no documenta esa capa → complemento exacto, sin competir en 1:N.
2. **El solape rPPG/FACS se invierte.** Su Face-Health (rPPG maduro) y Face-Sense (microexpresiones) coinciden con 2 capas nuestras (56% del peso del ensemble), pero el nuestro está desactivado. En vez de competir, **su señal rPPG alimenta nuestro liveness** → alianza pegajosa (sacarnos rompe su propio producto).
3. **Inteia es el canal que no tenemos.** Nosotros: producto + credenciales (paper Zenodo, NIST submission), cero footprint LATAM, founder solo. Inteia: Ecopetrol, ISA, ISAGEN, EPM, WOM, banca, sector público + Face-Proctor de Neuronal para universidades/certificaciones.

### Regla de oro de IP
Integrar sirviendo **solo el veredicto** (`P(fake)` + confianza) detrás de `X-API-Key`. Nunca las señales por capa ni los pesos. (El hardening del ml-worker ya lo permite.) Esto evita que internalicen el PAD y nos reemplacen.

### Honestidad de scope (no quemar credibilidad)
- ❌ NO decir "certificado NIST/iBeta" → están *submitted / sin empezar*.
- ✅ Sí: entrenamiento explícito con generadores modernos (Flux/SDXL/DALL·E 3), paper con DOI, arquitectura browser-side/privacy, **benchmark ciego** como prueba.
- Limitar el piloto a **deepfake sobre imagen** (donde V3/V9.4 rinden); no prometer forense documental ni morphs con el stack actual.

---

## Email — due-diligence inversa + benchmark ciego

**Asunto:** Capa anti-deepfake delante de Face-LogIn — propuesta de benchmark ciego

Hola [nombre],

Soy Pablo López Rodríguez, fundador de Deep-Check (deep-check-two.vercel.app). He revisado Face X y veo un encaje claro y **no competitivo**: vuestro Face-LogIn / Face-Access es reconocimiento facial 1:N (identidad), y nosotros **no hacemos matching 1:N**. Somos la capa anterior: detectar **deepfakes e inyección de cámara** en el frame **antes** de que llegue a vuestro motor.

El vector de riesgo en 2026 es ese: un rostro sintético (Flux/SDXL/DALL·E 3) o un stream pre-grabado inyectado, y un sistema sin PAD/anti-spoofing lo da por válido. Nuestro engine está entrenado específicamente contra generadores modernos.

Dos cosas antes de cualquier detalle técnico:

1. **Due-diligence mutua.** ¿Podéis compartir vuestra documentación de liveness/PAD actual de Face-LogIn — métricas APCER/BPCER, iBeta o NIST FATE-PAD si aplica? Así validamos si el gap es real y dónde aportamos.
2. **Benchmark ciego pagado.** En vez de slides: nos enviáis un set anonimizado de deepfakes + intentos de inyección y os devolvemos solo los **scores + AUC/EER**. Probáis el resultado sin que nadie exponga nada. Piloto 8-15K€, 2-3 semanas.

Si convence, hablamos de integración (API veredicto-only, vuestra marca).

¿Te viene bien una llamada de 30 min esta semana?

Un saludo,
Pablo

---

## One-pager técnico (enseñar sin revelar arquitectura)

**Deep-Check — Anti-Deepfake & Presentation Attack Detection**
*La capa de integridad que va delante de tu reconocimiento facial*

- **Problema (2026):** los ataques de inyección de deepfakes crecieron >1.000% interanual. El 1:N dice "es Pablo" — no "Pablo es real delante de la cámara".
- **Qué hacemos:** recibimos el frame/imagen, devolvemos **un único veredicto** — `P(fake) ∈ [0,1]` + confianza. Sin matching, sin almacenar biometría, sin tocar vuestra base de identidades.

| | Deep-Check |
|---|---|
| Generadores cubiertos | Flux, SDXL, DALL·E 3 + legacy (StyleGAN/FaceSwap) |
| Entrega | Veredicto server-side (API) o browser-side (ONNX/WASM) |
| Privacidad | Cero egress de biometría; GDPR by design |
| Integración | API REST · `X-API-Key` · `{ p_fake, confidence }` |
| Validación | Benchmark ciego con vuestros propios ataques |

**Lo que NO somos:** reconocimiento 1:N ni control de acceso (eso es Face X). Somos complementarios.
**Siguiente paso:** benchmark ciego pagado → integración co-branded.

---

## WhatsApp — abridores (copy-paste, un solo mensaje)

**A — corto**

> Hola [nombre] 👋 Vi el dossier de Face X, gracias por pasármelo.
> Veo un encaje muy claro y que *no os compite*: vuestro Face-LogIn hace reconocimiento (quién es), y nosotros somos la capa de antes — detectar si la cara es un deepfake o una inyección *antes* de que llegue a vuestro motor. Justo el agujero de hoy en biometría.
> ¿Una llamada de 20-30 min esta semana? Os propongo algo concreto, no slides.

**B — con gancho de piloto**

> Hola [nombre] 👋 Revisé Face X — buen producto. Encajamos sin pisarnos:
> Vosotros: reconocimiento facial 1:N. Nosotros (Deep-Check): la capa anti-deepfake/anti-inyección que va *delante* de ese login. No hacemos matching, somos el "¿es real?".
> Os propongo un *benchmark ciego*: nos mandáis deepfakes + inyecciones anonimizadas y os devolvemos solo los scores (AUC/EER). Probáis sin exponer nada. Piloto 2-3 semanas.
> ¿Lo hablamos 20 min? 🙌

---

## Otros encajes fuertes (del deep-research de empleo/partners)
- **Mitek Systems** — rol ML Deepfake/Injection/Liveness, Spain-remote (fit directísimo).
- **iProov** — Computer Vision Research Engineer (biometric platform, liveness anti-deepfake).
- **Signaturit / Camerfirma** — QES notarial España; les falta la capa anti-deepfake → API licensing.
