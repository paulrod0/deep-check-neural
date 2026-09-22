# BPAS — Documentación Técnica conforme al Reglamento (UE) 2024/1689 (AI Act)

**Anexo IV / Artículo 11 — Technical Documentation**
**Versión 1.0 · Abril 2026**

---

## 0. Clasificación del sistema

**Artículo 6 AI Act**: BPAS se clasifica como **sistema de IA de alto riesgo** conforme al **Anexo III, apartado 1, letra a**:

> "Sistemas de IA destinados a ser utilizados para la identificación biométrica remota de personas físicas […]"

y apartado 1, letra c:

> "Sistemas de IA destinados a ser utilizados para la categorización biométrica […]"

**Conclusión**: BPAS debe cumplir los requisitos del **Título III, Capítulo 2** del AI Act (Arts. 8-15) y las obligaciones del **Capítulo 3** para proveedores (Arts. 16-29).

---

## 1. Descripción general del sistema (Anexo IV §1)

### 1.1 Finalidad prevista

BPAS es un sistema de **autenticación biométrica continua multimodal** diseñado para entornos de alta seguridad (defensa, infraestructura crítica, administración pública sensible). Verifica de forma continua que el operador presente en una sesión digital es la misma persona que se autenticó inicialmente, detectando:

- Sustitución de operador (takeover)
- Automatización no autorizada (RPA / bot)
- Operación bajo coacción
- Patrones operacionales anómalos (insider threat)

### 1.2 Personas y entidades afectadas

- **Operadores autorizados**: personas físicas cuyo comportamiento es modelado; consentimiento informado obligatorio (RGPD Art. 9(2)(a))
- **Terceros transitorios**: visitantes que puedan usar el mismo terminal; notificados mediante cartelería visible
- **Administradores del sistema**: acceso a outputs agregados, nunca a raw features

### 1.3 Versión del sistema

- **Identificador**: BPAS-1.0.0
- **Hash del paquete**: publicado en el manifest firmado de cada release
- **Fecha de puesta en mercado**: por determinar (estimación: Q2 2027 tras F7)

### 1.4 Proveedor

- **Razón social**: Deep-Check (registro como proveedor UE pendiente)
- **Contacto AI Act**: compliance@[dominio]
- **Representante autorizado UE**: a designar

---

## 2. Propósito, usuarios previstos y contexto de uso (Anexo IV §1.a)

### 2.1 Finalidad prevista explícita

Verificar la identidad conductual continua del operador en terminales de:

1. **Puestos de mando operativo** en instalaciones militares nivel CONFIDENCIAL o superior
2. **Salas de control** de infraestructura crítica (energía, agua, transporte)
3. **Centros de operaciones de ciberseguridad** (SOC) con acceso privilegiado
4. **Terminales de administración de sistemas clasificados**

### 2.2 Usuarios previstos

- **Operadores directos**: personal con credencial activa y consentimiento firmado
- **Supervisores / CSO**: reciben alertas y pueden ejecutar acciones de respuesta
- **Auditores**: acceso read-only a logs agregados

### 2.3 Usos no previstos (explícitamente excluidos)

- **NO** se usa para evaluar rendimiento laboral de operadores
- **NO** se usa para control de horario o presentismo
- **NO** se usa para procesos de selección o despido
- **NO** se despliega en sectores no listados en §2.1 sin análisis de impacto específico

### 2.4 Limitaciones conocidas

- **Adversario T4 (synthetic)**: EER ≤ 8 % → sistemas con superficie de ataque sintético amplia deben complementar con controles adicionales
- **Operadores con patologías neurológicas fluctuantes** (p. ej. Parkinson en progresión): baseline inestable; requiere re-enrolamiento frecuente
- **Período de enrolamiento**: 14 días mínimo; durante ese tiempo el sistema opera en modo "soft"
- **Idiomas**: stylometry entrenada en ES/EN; otros idiomas requieren fine-tuning previo

---

## 3. Sistema de gestión de riesgos (Art. 9 AI Act)

### 3.1 Proceso continuo

Risk management activo durante todo el ciclo de vida:

| Fase | Frecuencia | Entregable |
|------|-----------|------------|
| Diseño | Una vez | Threat model (`THREAT_MODEL.md`) |
| Desarrollo | Por release | Risk assessment delta |
| Pre-mercado | Antes de cada release | Informe de validación |
| Post-mercado | Trimestral | Informe de monitoreo (Art. 72) |
| Incidente | Inmediato | Notificación a autoridad (Art. 73) |

### 3.2 Riesgos identificados y medidas

Ver `THREAT_MODEL.md §3`. Tabla resumen de riesgos específicos a IA:

| Riesgo específico IA | Severidad | Medida |
|---------------------|-----------|--------|
| Falsos negativos (impostor no detectado) | Alta | Conformal UNCERTAIN → step-up auth |
| Falsos positivos (legítimo rechazado) | Media | Umbral adaptativo por rol + dead-man switch manual |
| Sesgos demográficos | Alta | Validación por subgrupos (sexo, edad, mano dominante); reporte público de fairness metrics |
| Drift del modelo | Media | Head D + EWMA + re-calibración automática |
| Degradación por concept shift | Media | Monitoreo continuo + re-entrenamiento cada 6 meses |
| Uso fuera de finalidad prevista | Alta | Cláusulas contractuales + auditoría técnica |
| Adversarial poisoning en federated | Alta | Byzantine-robust aggregation (Krum) + DP |

### 3.3 Fairness y no-discriminación (Art. 10)

Evaluación por subgrupos publicada con cada release:

| Subgrupo | EER | ΔEER vs promedio |
|----------|-----|------------------|
| Sexo: hombre | X.XX % | — |
| Sexo: mujer | X.XX % | ≤ 0.5 pp |
| Edad: 18-29 | X.XX % | — |
| Edad: 30-49 | X.XX % | ≤ 0.5 pp |
| Edad: 50-65 | X.XX % | ≤ 0.5 pp |
| Mano dominante: diestra | X.XX % | — |
| Mano dominante: zurda | X.XX % | ≤ 0.5 pp |
| Discapacidad motora registrada | X.XX % | Evaluación específica + opt-out |

Si alguna diferencia supera 0.5 pp, se dispara mitigación (rebalanceo de dataset, ajuste de umbral por subgrupo, re-entrenamiento).

---

## 4. Datos y gobernanza de datos (Art. 10)

### 4.1 Datasets de entrenamiento

| Dataset | Fuente | Licencia | Tamaño | Uso |
|---------|--------|----------|--------|-----|
| Aalto Keystroke (136M eventos) | Aalto University | CC-BY | 168K usuarios | Keystroke base |
| CMU Keystroke | CMU | Public research | 51 usuarios | Keystroke validation |
| Buffalo Keystroke | University at Buffalo | Public research | 148 usuarios | Keystroke validation |
| Balabit Mouse Dynamics | Balabit Shell Control Box | CC-BY | 10 usuarios, 100h | Mouse base |
| TwoMouse-DS | Internal | Proprietary | 200 usuarios, 500h | Mouse validation |
| Synthetic Operational | Generated internal | N/A | 10K trayectorias | VAE training |
| Defense Pilot (F7) | Voluntarios + consentimiento | Contractual | 10-20 operadores | Fine-tuning final |

### 4.2 Calidad de datos

- **Completitud**: ≥ 95 % por usuario; users con menor cobertura se excluyen
- **Balanceo**: oversampling con SMOTE o downsampling por subgrupo demográfico
- **Consent**: todos los datasets con trazabilidad de consentimiento, disponible bajo auditoría
- **Anonimización**: raw events nunca salen del sitio original; solo embeddings

### 4.3 Sesgos identificados y mitigados

| Sesgo | Dataset afectado | Mitigación |
|-------|-----------------|------------|
| Sobre-representación de usuarios jóvenes tech-savvy | Aalto | Reweighting + muestreo estratificado |
| Sólo usuarios de escritorio (no móvil) | Todos | Scope limitado a desktop en v1.0 |
| Ausencia de usuarios con discapacidad motora | Todos | Opt-in voluntario + modelo específico |

---

## 5. Descripción técnica detallada (Anexo IV §2)

Ver `SPEC.md` secciones 3, 4, 5, 6 para detalles completos. Resumen:

### 5.1 Arquitectura

- Agente Rust endpoint (captura)
- Worker Python FastAPI + TorchServe (inferencia)
- Decision Service Node.js/TypeScript (policy + custody)
- Fusión Bayesiana en espacio logit con conformal prediction

### 5.2 Modelos

| Modalidad | Arquitectura | Params | Licencia base |
|-----------|-------------|--------|---------------|
| Keystroke | Transformer 4L×8H×256D + RoPE | 3.3M | Propietario |
| Mouse | Dilated TCN 6L | 0.15M | Propietario |
| Stylometry | XLM-RoBERTa-base + LoRA r=8 | 270M + 1.3M | Apache 2.0 base |
| Operational | β-VAE GRU bidireccional | 0.8M | Propietario |
| Facial delta | FACS AU histograma | — | Reusa Deep-Check |

### 5.3 Fusión

- Bayesian logit-space ensemble
- Weights learned via Brier minimization on simplex
- Conformal calibration per-user (α por rol)

---

## 6. Monitoreo y vigilancia humana (Art. 14)

### 6.1 Supervisión humana obligatoria

El sistema **no** toma decisiones irreversibles de forma autónoma. Ante alerta:

| Severidad | Acción automática | Supervisión humana requerida |
|-----------|-------------------|------------------------------|
| Info | Log en SIEM | Ninguna (ruido controlado) |
| Warning | Notificación a supervisor | Supervisor puede ignorar |
| Alerta | Step-up auth (PIN/smartcard) | Operador puede re-autenticar |
| Crítica | Session lock + alerta CSO | CSO decide acción (desbloquear, investigar) |

### 6.2 Capacidad de intervención

- Operador puede **siempre** solicitar re-autenticación manual
- Supervisor puede **siempre** desactivar sesión BPAS con justificación (logged)
- CSO puede **siempre** invocar modo "maintenance" que registra pero no decide
- Auditor puede **siempre** exportar logs y solicitar explicación de decisión

### 6.3 Transparencia al operador

Al inicio de cada sesión, el operador ve:

```
[BPAS Activo]
Este terminal monitoriza patrones de comportamiento para detectar
suplantación de identidad. Los datos brutos no abandonan este equipo.
Tu consentimiento firmado está registrado bajo: DC-BPAS-{uuid}.
Para revisar o retirar el consentimiento: <link interno>
```

---

## 7. Precisión, robustez y ciberseguridad (Art. 15)

### 7.1 Métricas publicadas

Ver `SPEC.md §9`. Métricas clave:

| Métrica | Target | Validación |
|---------|--------|-----------|
| EER cross-user | ≤ 1.0 % | LOO-CV con n≥100 |
| ECE | ≤ 0.02 | 15-bin reliability diagram |
| Robust AUC (PGD ε=0.05) | ≥ 0.92 | TRADES training |
| Latencia p95 | < 200 ms | Benchmark continuo |

### 7.2 Ciberseguridad

Ver `THREAT_MODEL.md`. Certificaciones objetivo:

- **ENS-Alta** (Esquema Nacional de Seguridad, España)
- **ISO/IEC 27001** (SGSI)
- **ISO/IEC 24745** (protección de información biométrica)
- **Common Criteria EAL4+** (opcional para contratos defensa)

### 7.3 Resistencia a ataques adversariales

- PGD training sobre todas las modalidades
- TRADES loss (Zhang et al. 2019)
- Mimicry GAN adversarial augmentation
- Side-channel mitigation (MINE bound + quantization)

---

## 8. Registro de eventos (Art. 12 - logging)

### 8.1 Eventos registrados automáticamente

Todos los siguientes eventos se registran sin posibilidad de desactivación:

- Inicio/fin de sesión BPAS
- Cada verificación (con outcome, NO con raw features)
- Cada alerta generada
- Cada intervención de supervisor humano
- Cada actualización del modelo (version, hash, timestamp TSA)
- Cada re-calibración
- Cada excepción o error del sistema

### 8.2 Integridad del log

- Cadena de custodia ISO 27037 (`src/lib/forensicChain.ts`)
- Append-only con triggers SQL que impiden UPDATE/DELETE
- HMAC-SHA256 por entrada
- Sellado RFC 3161 al cierre de sesión
- Retención: 5 años (ENS-Alta)

### 8.3 Acceso al log

- **Operador afectado**: derecho de acceso a sus propios logs (RGPD Art. 15)
- **Supervisor**: acceso a logs del equipo bajo su mando
- **Auditor**: acceso total read-only
- **CSO**: acceso total + capacidad de exportación firmada
- **Autoridad supervisora**: acceso bajo requerimiento formal (Art. 64)

---

## 9. Instrucciones de uso (Art. 13 - Transparency)

### 9.1 Destinatarios

Las instrucciones están dirigidas a **deployers** (desplegadores), no a usuarios finales.

### 9.2 Contenido obligatorio

Documento separado `DEPLOYMENT_GUIDE.md` (no incluido aquí) cubre:

- Identidad del proveedor
- Características, capacidades y limitaciones del sistema
- Circunstancias de uso previstas
- Nivel de precisión y métricas relevantes
- Riesgos previsibles
- Información sobre datos de entrenamiento (resumen, no datos sensibles)
- Período de validez del sistema
- Requisitos de mantenimiento y actualización
- Procedimiento de retirada de consentimiento

---

## 10. Sistema de gestión de la calidad (Art. 17)

### 10.1 Elementos implementados

| Elemento | Estado | Referencia |
|----------|--------|-----------|
| Estrategia de cumplimiento regulatorio | Draft | Este documento |
| Procedimientos de diseño, control y verificación | Draft | `SPEC.md`, pipelines en `ml/bpas/` |
| Procedimientos de desarrollo, QA y testing | Draft | CI/CD en `.github/workflows/` (pendiente) |
| Procedimientos de examen, pruebas y validación | Draft | `ml/bpas/common/metrics.py` |
| Procedimientos de gestión de datos | Draft | Sección 4 de este documento |
| Sistema de gestión de riesgos | Draft | `THREAT_MODEL.md` |
| Monitoreo post-mercado | Pendiente | Plan a definir en F8 |
| Notificación de incidentes graves | Pendiente | Plan a definir en F8 |
| Comunicación con autoridades | Pendiente | Plan a definir en F8 |
| Registro de documentación técnica | En curso | `docs/bpas/` |
| Gestión de recursos (incluidas relaciones con suministradores) | Pendiente | — |
| Esquema de rendición de cuentas | Pendiente | Definir responsables tras contratación compliance officer |

---

## 11. Evaluación de la conformidad (Art. 43)

### 11.1 Módulo aplicable

BPAS por estar en **Anexo III §1.a** (biometría) → evaluación **basada en sistema de gestión de calidad + examen de documentación técnica** (módulo Anexo VII).

Requiere **organismo notificado** (notified body) para:
- Examen del sistema de gestión de calidad
- Examen de la documentación técnica
- Vigilancia periódica

### 11.2 Marcado CE

Una vez completada la evaluación:
- Marcado CE visible en el software (splash screen, about)
- Declaración UE de conformidad (Art. 47)
- Registro en base de datos UE de sistemas de alto riesgo (Art. 49)

---

## 12. Obligaciones post-mercado (Arts. 72-73)

### 12.1 Monitoreo post-mercado

Plan de monitoreo documentado:

- Métricas operacionales en producción (ECE, FAR, FRR por rol)
- Análisis de incidentes
- Revisión trimestral de drift
- Informe anual al organismo notificado

### 12.2 Notificación de incidentes graves

Definición de incidente grave (Art. 3(44)):
- Funcionamiento defectuoso que cause o pueda causar perjuicio
- Vulneración grave de derechos fundamentales
- Incidente cibernético con impacto en el sistema

Procedimiento:
1. Detección → notificación interna en ≤ 4 h
2. Investigación preliminar en ≤ 24 h
3. Notificación a autoridad de vigilancia en ≤ 15 días (Art. 73(2))
4. Informe final en ≤ 30 días

---

## 13. Declaración

El proveedor declara bajo su responsabilidad que el sistema BPAS-1.0.0, una vez completado el roadmap de implementación (F0-F8), cumplirá con los requisitos aplicables del Reglamento (UE) 2024/1689.

La presente documentación técnica se mantendrá actualizada y disponible durante al menos **10 años** tras la puesta en mercado (Art. 18).

---

**Firmas requeridas al completar certificación:**

- Representante legal del proveedor
- Responsable de cumplimiento AI Act
- Responsable técnico del sistema
- Organismo notificado (tras auditoría)
