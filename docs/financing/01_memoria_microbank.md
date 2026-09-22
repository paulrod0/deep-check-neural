# Memoria de Viabilidad Económica — Deep-Check

**Solicitud de financiación MicroBank — 15.500 €**
**Entidad colaboradora: Fundación Don Bosco (informe favorable firmado)**
**Abril 2026**

---

## 1. Identificación

| Concepto | Dato |
|----------|------|
| Promotor | Pablo López Rodríguez |
| Domicilio | Boadilla del Monte, Comunidad de Madrid |
| Actividad | Desarrollo y comercialización de software de análisis forense de autenticidad digital mediante inteligencia artificial |
| CNAE estimado | 6201 — Actividades de programación informática |
| Forma jurídica prevista | Alta de actividad económica persona física (posible constitución posterior de S.L.) |

---

## 2. Descripción del producto

**Deep-Check** es una plataforma europea de verificación de autenticidad
digital. Mediante modelos propios de inteligencia artificial:

- Detecta **deepfakes** (face swap, reenactment, síntesis completa) en
  imágenes y vídeos
- Detecta **imágenes generadas por IA** (SDXL, Flux, MidJourney, DALL-E,
  Sora, Veo)
- Detecta **manipulaciones en documentos** escaneados (splicing,
  copy-move, inpainting, alteración de campos)
- Emite **informes con trazabilidad criptográfica** conforme a
  ISO/IEC 27037 y sellado de tiempo RFC 3161

**Estado técnico actual** (verificable):

- Producto en producción desde marzo 2026 — https://deep-check-two.vercel.app
- Modelos entrenados sobre > 140.000 imágenes
- Métricas: AUC 0.9999 (EfficientNet-B4), AUC 0.98 (VideoMAE) sobre
  FaceForensics++ c23 según benchmark ISO/IEC 30107-3
- Registrado y en uso por terceros piloto
- Infraestructura desplegada en AWS eu-west-1 y Vercel UE

---

## 3. Mercado y clientes objetivo

**Segmentos primarios:**

1. **Escuelas de negocio y universidades** — licencia institucional para
   cursos de ciberseguridad, fraude digital y educación ejecutiva.
   _Negociación avanzada con IE University — 100.000 € ticket anual
   potencial._

2. **Consultoras de ciberseguridad y empresas de medios** — integración
   vía API para verificación de contenido.
   _Conversación técnica avanzada con cliente del sector Enterprise
   (denominación comercial Zeus) — 8.000-40.000 € anuales._

3. **Gabinetes periciales y despachos forenses** — licencia per-seat
   para informes judiciales conforme a UNE 197010:2015.

4. **Pymes con bonos del Kit Digital** — Deep-Check como agente
   digitalizador homologable en la categoría "Ciberseguridad".

**Validación de mercado:**

- Regulación europea AI Act 2024/1689 clasifica deepfakes en artículo
  50 con obligación de etiquetado → demanda regulatoria creciente
- Presupuestos públicos españoles de ciberseguridad crecen a doble
  dígito anual (ENISA, INCIBE)
- Caso Arup 2024 (£20M sustraídos por deepfake en videollamada)
  acelera la demanda corporativa

---

## 4. Modelo de ingresos

| Línea | Precio | Público |
|-------|--------|---------|
| SaaS Starter | 29 €/mes | Freelance, pymes |
| SaaS Pro | 79 €/mes | Consultoría, redacciones |
| Enterprise / API | 2.000-15.000 €/año | Corporativo |
| Licencia educativa | 20.000-100.000 €/año | Universidades, escuelas de negocio |
| Formación y ponencias | 500-2.000 €/sesión | Congresos, MBA, foros ciber |

---

## 5. Previsión de ingresos (primer año)

**Escenario base (comprometido):**

| Fuente | Y1 |
|--------|----:|
| Suscripciones SaaS Starter + Pro (captación progresiva) | 5.400 € |
| Clientes Enterprise firmados o en firma inminente (2 tickets) | 8.000 € |
| Ponencias y formación especializada | 1.000 € |
| **TOTAL INGRESOS (base)** | **14.400 €** |

**Pipeline comercial en negociación (no contabilizado hasta firma):**

| Fuente | Potencial |
|--------|----------:|
| Licencia institucional IE University | 100.000 € |
| Cliente Enterprise Zeus | 8.000-40.000 € |
| **TOTAL PIPELINE** | **108-140.000 €** |

De materializarse el pipeline, la facturación anual alcanzaría un
rango de 122.000-154.000 € con un resultado operativo superior a
100.000 €.

---

## 6. Estructura de costes (primer año)

### Gastos fijos de explotación — 6.500 €/año

| Concepto | Mensual | Anual |
|----------|--------:|------:|
| Cuota autónomos (tarifa reducida) | 80 € | 960 € |
| Infraestructura cloud AWS | 250 € | 3.000 € |
| Vercel Pro + Paddle + monitoring | 120 € | 1.440 € |
| Gestoría | 50 € | 600 € |
| Dominios, licencias, mantenimiento | 42 € | 500 € |

### Gastos variables — 3.200 €/año

| Concepto | Anual |
|----------|------:|
| Marketing y adquisición (ads + contenido) | 1.800 € |
| Entrenamientos GPU puntuales (EC2 bajo demanda) | 800 € |
| Comisiones Paddle (5 % sobre facturación SaaS) | 270 € |
| Dietas y viajes comerciales | 330 € |

### Amortización de la inversión — 3.000 €/año

Las inversiones inmateriales (certificaciones, marca, licencias) se
amortizan linealmente a 3 años; el material a 4 años.

---

## 7. Resultado operativo previsto

| Partida | Y1 base | Y1 con pipeline cerrado |
|---------|--------:|------------------------:|
| Ingresos | 14.400 € | 122.000 € |
| – Gastos fijos | −6.500 € | −9.500 € (ajustado) |
| – Gastos variables | −3.200 € | −8.000 € |
| – Amortización | −3.000 € | −3.000 € |
| **Resultado operativo** | **+1.700 €** | **+101.500 €** |

Break-even operativo estimado: **mes 9-10** en escenario base;
**mes 3-4** con pipeline cerrado.

---

## 8. Capacidad de devolución del préstamo

**Condiciones estimadas del préstamo**: 15.500 € a 5 años al 7 %
→ cuota mensual ≈ **307 €**.

**Fuentes de atención del servicio de deuda:**

1. Resultado operativo del negocio (a partir del mes 9 en escenario
   base; desde el mes 1 en escenario con pipeline cerrado)

2. Ingresos profesionales independientes del solicitante hasta
   alcanzar punto muerto — capacidad acreditada por perfil técnico
   especializado (ML / Data Engineer) con demanda de mercado alta

**Declaración expresa**: los fondos del préstamo se destinarán
íntegramente a la inversión empresarial descrita en los apartados 9
y 10 de esta memoria. **No se destina importe alguno a refinanciar o
cancelar deuda personal previa**, la cual se encuentra debidamente
declarada a la entidad financiera.

---

## 9. Detalle de la inversión — 15.500 €

### 9.1 Inmovilizado inmaterial — 8.200 €

| Concepto | Proveedor tipo | Importe |
|----------|----------------|--------:|
| Certificación ISO/IEC 27001 (auditoría + tasas) | AENOR / Bureau Veritas | 3.500 € |
| Certificación ENS-Media (Esquema Nacional de Seguridad) | Entidad acreditada CCN | 2.200 € |
| Registro de marca "Deep-Check" (OEPM + UE) | Clarke Modet / OEPM | 800 € |
| Licencias software (IDEs, diseño, monitoring anual) | JetBrains, Adobe, DataDog | 600 € |
| Servicios jurídicos (términos, privacidad, DPIA RGPD) | Gestoría especializada | 700 € |
| Dominios + correo corporativo + SSL (2 años) | Google Workspace, registradores | 400 € |

### 9.2 Inmovilizado material — 2.300 €

| Concepto | Proveedor tipo | Importe |
|----------|----------------|--------:|
| Estación de trabajo (portátil 32 GB / SSD 1 TB) | PCComponentes / Apple | 1.800 € |
| Disco externo cifrado para copias (2 TB) | Amazon Business | 150 € |
| Monitor auxiliar + periféricos | PCComponentes | 350 € |

### 9.3 Inversión circulante — 5.000 €

Cubre 6 meses de gastos fijos para llegar al break-even operativo
sin depender de ingresos aún no consolidados.

| Concepto | Mensual | 6 meses |
|----------|--------:|--------:|
| AWS + cloud | 250 € | 1.500 € |
| Vercel + Paddle + herramientas | 120 € | 720 € |
| Cuota autónomos | 80 € | 480 € |
| Gestoría | 50 € | 300 € |
| Marketing inicial | 250 € | 1.500 € |
| Buffer imprevistos | — | 500 € |

---

## 10. Factores de riesgo y mitigación

| Riesgo | Probabilidad | Mitigación |
|--------|:------------:|------------|
| Retraso en cierre de deals grandes (IE, Zeus) | Media | Escenario base no depende de ellos |
| Competencia de Microsoft Video Authenticator / Sensity | Alta | Diferenciación: trazabilidad + multi-modelo + privacy-by-design; nicho educativo |
| Cambio regulatorio AI Act | Media | Monitorización activa; producto ya conforme a borradores actuales |
| Degradación del modelo frente a nuevos generadores | Alta | Pipeline de reentrenamiento continuo ya implementado |
| Riesgo personal del solicitante | Medio | Ingresos profesionales independientes + reestructuración en curso |

---

## 11. Compromiso del promotor

Me comprometo a:

1. Dedicación íntegra al proyecto durante al menos los 12 próximos
   meses
2. Aportación de 3.000 € de capital propio al lanzamiento (desde
   ahorro personal)
3. Emitir justificantes de gasto de las partidas financiadas y
   ponerlos a disposición de la entidad
4. Comunicar cualquier cambio material de situación económica o del
   proyecto con antelación suficiente

---

**Fecha**: Abril 2026
**Firma del promotor**:

_Pablo López Rodríguez_
