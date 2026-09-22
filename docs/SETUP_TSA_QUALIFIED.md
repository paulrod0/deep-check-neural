# Setup · Activar Sellado de Tiempo Cualificado eIDAS

> **Tiempo estimado:** 5 minutos · **Coste:** 0 €

Esta guía te lleva, paso a paso, desde el TSA por defecto (`freetsa.org` —
válido pero **NO** cualificado eIDAS) a un TSA **Cualificado** del catálogo
oficial de la UE. El proceso es un único cambio de variable de entorno; el
código ya detecta automáticamente que el TSA es cualificado y lo refleja
en cada informe pericial generado.

---

## TL;DR

```bash
# 1. Apuntar Vercel al TSA cualificado de la Generalitat Valenciana (gratis, eIDAS-Q).
vercel env add TSA_URL production
# pega cuando lo pida:    http://tss.accv.es:8318/tsa

# 2. Redeploy (Vercel lo hace solo en el próximo push, o fuerza con):
vercel --prod --yes

# 3. Verifica:
curl https://deep-check-two.vercel.app/api/health/tsa
# Debe contener:  "qualified": true,  "reachable": true
```

Eso es todo. Las verificaciones que se generen a partir de ese momento
quedan registradas con sello de tiempo **cualificado eIDAS Art. 42**.

---

## Por qué importa

El sello de tiempo es la prueba de que un fichero existía con un contenido
exacto **antes** de un instante T. Hay dos niveles legales:

| Tipo | Base normativa | Valor probatorio |
|---|---|---|
| RFC 3161 estándar (ej. `freetsa.org`, `digicert.com`) | RFC 3161 (IETF) | Válido para verificar integridad. Carga de prueba normal. |
| **Cualificado eIDAS** (ej. `tss.accv.es`, FNMT) | Reglamento (UE) 910/2014 Art. 42 | **Presunción legal** de exactitud temporal. La carga de prueba se invierte: quien lo niegue debe demostrar lo contrario. |

Para el caso de uso de Deep-Check (informes periciales UNE 197010, soporte
ante impugnaciones de admisiones, fraude documental) **conviene siempre
usar TSA cualificado**.

---

## Opciones de TSA Cualificado en España

Mantenidos por entidades reconocidas en el listado oficial eIDAS (LOTL):

| TSP | URL TSA | Coste para uso ciudadano | Latencia típica |
|---|---|---|---|
| **ACCV** (Generalitat Valenciana) ⭐ recomendado | `http://tss.accv.es:8318/tsa` | **Gratis** | ~290 ms |
| **FNMT-RCM** | `https://www.sede.fnmt.gob.es/timestamp` (requiere certificado FNMT en algunos casos) | Gratis con cert FNMT | ~1-2 s |
| **Uanataca** | `https://tsa.uanataca.com` (con credenciales) | ~30-50 €/mes | ~150 ms |
| **Firmaprofesional** | `https://psc.firmaprofesional.com/timestamp` | Bajo contrato | — |
| **Izenpe** (Diputaciones Vascas) | `https://tsa.izenpe.com` | Gratis con cuenta | — |

> **Recomendación:** empezar con **ACCV**. Es un servicio público
> cualificado eIDAS, gratis para uso ciudadano (incluida actividad
> profesional individual o startup en fase pre-revenue), no requiere
> alta previa y la URL es fija y documentada.
>
> Migrar a **Uanataca** cuando superes ~10.000 sellos/mes y necesites
> SLA contractual con velocidad sub-200ms.

Todos los hostnames de la tabla están ya en la _allowlist_ del código
(`QUALIFIED_TSP_HOSTS` en `src/lib/forensicChain.ts`), así que cambiar
entre ellos solo requiere actualizar `TSA_URL`.

---

## Pasos detallados (ACCV)

### 1. (Opcional) Probar la conexión desde tu portátil antes de tocar producción

```bash
# Genera un hash de prueba y pídele al TSA un sello.
echo "deep-check tsa probe $(date +%s)" | openssl dgst -sha256 -binary > /tmp/h
openssl ts -query -data /tmp/h -no_nonce -sha256 -cert -out /tmp/req.tsq
curl -s -H "Content-Type: application/timestamp-query" \
     --data-binary @/tmp/req.tsq \
     -o /tmp/resp.tsr \
     http://tss.accv.es:8318/tsa
file /tmp/resp.tsr
# Esperado:  /tmp/resp.tsr: data    (binary, ~5 KB)
```

Si te devuelve `~5 KB` de datos binarios, ACCV te ha respondido y la
configuración funcionará en Vercel.

### 2. Cambiar la variable de entorno en Vercel

Vía CLI (recomendado, queda registrado en el log de despliegue):

```bash
vercel env add TSA_URL production
# Valor a pegar:   http://tss.accv.es:8318/tsa
```

O vía dashboard:

1. Entra en el proyecto Deep-Check en https://vercel.com/dashboard
2. Settings → Environment Variables
3. Añade `TSA_URL` = `http://tss.accv.es:8318/tsa` para `Production`
4. Si quieres, añade también para `Preview` y `Development`

### 3. Re-desplegar

Vercel usa la nueva variable a partir del **siguiente** despliegue, no
del actual. Fuerza un redeploy:

```bash
vercel --prod --yes
```

O hace un commit vacío y push:

```bash
git commit --allow-empty -m "chore: switch TSA to ACCV qualified"
git push
```

### 4. Verificar en producción

```bash
curl -s https://deep-check-two.vercel.app/api/health/tsa | jq
```

Salida esperada:

```json
{
  "status": "ok",
  "tsaUrl": "http://tss.accv.es:8318/tsa",
  "qualified": true,
  "reachable": true,
  "latencyMs": 312,
  "tokenBytes": 5453,
  "interpretation": "TSA is on the eIDAS Qualified Trust Service Providers allowlist. Timestamps carry qualified legal weight."
}
```

A partir de aquí:
- El endpoint `/api/v1/forensic/ingest` devuelve `tsaQualified: true` en la respuesta.
- Los informes periciales generados por `/api/v1/forensic/report` mencionarán
  ACCV como autoridad de sellado en el anexo I.

---

## (Opcional) Forzar fail-closed

Por defecto, si el TSA falla la cadena se registra **sin** token TSA y
sigue funcionando. Si prefieres que un fallo del TSA **rompa** el ingest
(útil en alto cumplimiento, p. ej. caso pericial real en juzgado):

```bash
vercel env add TSA_REQUIRED production
# Valor:   true
```

Con esto, `ingestEvidence()` lanza una excepción si el TSA no responde y
el cliente recibe `503 ingest_failed`. Decisión consciente — mejor un
fallo visible que una cadena con timestamps faltantes que nadie nota
hasta que llega el juicio.

---

## Migrar a otro TSP en el futuro

Si más adelante quieres pasar a Uanataca / FNMT / Firmaprofesional:

1. `vercel env rm TSA_URL production`
2. `vercel env add TSA_URL production` con la URL nueva
3. `vercel --prod --yes`
4. `curl /api/health/tsa` para confirmar `qualified: true`

Si es un TSP nuevo no listado: añade su hostname a `QUALIFIED_TSP_HOSTS`
en `src/lib/forensicChain.ts` y vuelve a desplegar.

---

## Auditoría

- Lista oficial UE de TSPs cualificados: https://eidas.ec.europa.eu/efda/tl-browser/
- Estándar técnico: ETSI EN 319 421 / RFC 3161 / RFC 5816
- Reglamento UE 910/2014 (eIDAS), Art. 42 — sellos de tiempo cualificados
- Implementación interna: `src/lib/forensicChain.ts`
- Endpoint de salud: `src/app/api/health/tsa/route.ts`
- Endpoint de uso: `src/app/api/v1/forensic/ingest/route.ts`

---

## Resumen ejecutivo (para enseñar a un cliente)

> _"Los sellos de tiempo de Deep-Check se obtienen de la Autoridad de
> Sellado de Tiempo de la **Generalitat Valenciana (ACCV)**, prestador
> cualificado de servicios de confianza inscrito en el listado oficial
> de la UE conforme al Reglamento eIDAS (UE 910/2014). Cada verificación
> incluye un token RFC 3161 firmado por ACCV, que goza de la presunción
> legal de exactitud temporal del Art. 42 eIDAS."_
