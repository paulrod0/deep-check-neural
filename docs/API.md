# Deep-Check — Referencia de API

> Versión de API: **v1**
> Base URL SaaS: `https://deep-check.vercel.app`
> Base URL On-Premise: `https://tu-dominio.com` (configurable)

---

## Índice

1. [Autenticación](#autenticación)
2. [Códigos de respuesta](#códigos-de-respuesta)
3. [Enrollment Biométrico](#enrollment-biométrico)
4. [Sesiones de Evaluación](#sesiones-de-evaluación)
5. [Gestión de API Keys](#gestión-de-api-keys)
6. [Verificación de Certificados](#verificación-de-certificados)
7. [Health Check](#health-check)
8. [Webhooks](#webhooks)
9. [Ejemplos de integración](#ejemplos-de-integración)

---

## Autenticación

Todos los endpoints bajo `/api/v1/` requieren autenticación mediante API key.

### Formato de la cabecera

```http
Authorization: Bearer dc_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Obtener un API key

Los API keys se generan desde el dashboard de administración:

1. Acceder a `https://tu-dominio.com/dashboard`
2. Autenticarse con el `ADMIN_PASSWORD`
3. Navegar a **Gestión de claves**
4. Hacer clic en **Nueva clave** y asignarle un nombre descriptivo
5. **Guardar la clave inmediatamente** — sólo se muestra una vez

### Permisos

Cada clave tiene permisos independientes:

| Permiso | Acceso |
|---------|--------|
| `read`  | GET en sesiones y enrollments |
| `write` | POST/PATCH en sesiones y enrollments |

```json
{
  "name": "Sistema RRHH Corp",
  "permissions": ["read", "write"]
}
```

---

## Códigos de respuesta

| Código | Significado |
|--------|-------------|
| `200` | Éxito |
| `201` | Recurso creado |
| `400` | Error de validación (ver campo `error` en respuesta) |
| `401` | API key ausente o inválida |
| `403` | Permisos insuficientes para la operación |
| `404` | Recurso no encontrado |
| `429` | Rate limit excedido |
| `500` | Error interno del servidor |

### Formato de error

```json
{
  "success": false,
  "error": "descripción del error en inglés",
  "code": "INVALID_API_KEY"
}
```

---

## Enrollment Biométrico

El enrollment captura el perfil de escritura (keystroke dynamics) de un candidato para su posterior comparación durante la evaluación.

### `POST /api/v1/enroll`

Crea o actualiza el perfil biométrico de un candidato.

**Permiso requerido**: `write`

**Request:**

```http
POST /api/v1/enroll
Authorization: Bearer dc_live_xxxx
Content-Type: application/json

{
  "candidateName": "Ana López García",
  "candidateEmail": "ana.lopez@empresa.com",
  "context": "proceso-seleccion-2026",
  "profile": {
    "flightMean": 142.3,
    "flightStd": 38.7,
    "holdMean": 89.2,
    "holdStd": 22.1,
    "entropy": 4.82,
    "skewness": 0.34,
    "kurtosis": 2.91,
    "periodicityScore": 0.12,
    "velocityGradient": -0.003,
    "fatigueRate": 0.021,
    "rhythmConsistency": 0.78,
    "impossibleFastRatio": 0.0,
    "digramCvMean": 0.41,
    "backspaceLatencyStd": 55.3,
    "backspaceCountRatio": 0.04,
    "burstCountPer100k": 2.1,
    "sessionWpm": 67,
    "sampleSize": 312
  }
}
```

**Respuesta exitosa (201):**

```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "expiresAt": "2026-12-31T00:00:00.000Z",
    "enrollmentHash": "sha256:abcdef1234567890...",
    "sampleSize": 312
  }
}
```

**Notas:**
- Se requieren mínimo **50 keystokes** vía API (150 vía la interfaz web)
- El `enrollmentHash` puede usarse para verificar la integridad del perfil
- Los perfiles expiran según la configuración (por defecto 1 año)
- Llamar al endpoint con el mismo email **actualiza** el perfil existente

---

### `GET /api/v1/enroll`

Recupera el perfil biométrico de un candidato por su email.

**Permiso requerido**: `read`

**Request:**

```http
GET /api/v1/enroll?email=ana.lopez@empresa.com
Authorization: Bearer dc_live_xxxx
```

**Respuesta exitosa (200):**

```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "candidateName": "Ana López García",
    "candidateEmail": "ana.lopez@empresa.com",
    "context": "proceso-seleccion-2026",
    "enrollmentHash": "sha256:abcdef...",
    "createdAt": "2026-01-15T10:30:00.000Z",
    "expiresAt": "2026-12-31T00:00:00.000Z",
    "sampleSize": 312
  }
}
```

> **Privacidad**: el campo `profile` con los datos biométricos brutos **no** se devuelve en esta respuesta por diseño.

---

## Sesiones de Evaluación

Las sesiones almacenan el resultado completo de una evaluación de proctoring.

### `POST /api/v1/sessions`

Crea una nueva sesión. Normalmente el frontend genera la sesión automáticamente al finalizar el examen; este endpoint permite crearla también desde sistemas externos.

**Permiso requerido**: `write`

**Request:**

```http
POST /api/v1/sessions
Authorization: Bearer dc_live_xxxx
Content-Type: application/json

{
  "candidateName": "Carlos Martínez",
  "role": "Técnico de Sistemas",
  "date": "2026-03-15"
}
```

**Respuesta exitosa (201):**

```json
{
  "success": true,
  "data": {
    "id": "f7e6d5c4-b3a2-1098-fedc-ba9876543210"
  }
}
```

---

### `GET /api/v1/sessions`

Lista sesiones con paginación y filtros.

**Permiso requerido**: `read`

**Parámetros de consulta:**

| Parámetro | Tipo | Descripción | Por defecto |
|-----------|------|-------------|-------------|
| `page` | integer | Página (base 1) | `1` |
| `limit` | integer | Resultados por página (máx. 100) | `20` |
| `status` | string | Filtrar por estado: `passed`, `review`, `flagged` | — |
| `external_ref` | string | Filtrar por referencia externa | — |

**Request:**

```http
GET /api/v1/sessions?page=1&limit=20&status=flagged
Authorization: Bearer dc_live_xxxx
```

**Respuesta exitosa (200):**

```json
{
  "success": true,
  "data": [
    {
      "id": "f7e6d5c4-b3a2-1098-fedc-ba9876543210",
      "createdAt": "2026-03-15T14:22:00.000Z",
      "candidateName": "Carlos Martínez",
      "role": "Técnico de Sistemas",
      "date": "2026-03-15",
      "score": 72,
      "status": "flagged",
      "livenessScore": 91.2,
      "aiRisk": 34.5,
      "identityMatchScore": 88.0,
      "keystrokeCount": 487,
      "tabSwitchCount": 2,
      "gazeEventCount": 1,
      "evidenceCount": 3,
      "certificateIssued": false,
      "alertCount": 4
    }
  ],
  "pagination": {
    "total": 47,
    "page": 1,
    "limit": 20,
    "pages": 3
  }
}
```

---

### `GET /api/v1/sessions/{id}`

Recupera el detalle completo de una sesión.

**Permiso requerido**: `read`

**Parámetros de consulta opcionales:**

| Parámetro | Descripción |
|-----------|-------------|
| `include_evidence=true` | Incluye las evidencias en base64 (imágenes, etc.) |

**Request:**

```http
GET /api/v1/sessions/f7e6d5c4-b3a2-1098-fedc-ba9876543210
Authorization: Bearer dc_live_xxxx
```

**Respuesta exitosa (200):**

```json
{
  "success": true,
  "data": {
    "id": "f7e6d5c4-b3a2-1098-fedc-ba9876543210",
    "createdAt": "2026-03-15T14:22:00.000Z",
    "candidateName": "Carlos Martínez",
    "role": "Técnico de Sistemas",
    "date": "2026-03-15",
    "score": 72,
    "status": "flagged",
    "alerts": [
      {
        "type": "tab_switch",
        "severity": "medium",
        "timestamp": "2026-03-15T14:28:15.000Z",
        "detail": "Candidate switched browser tabs"
      }
    ],
    "livenessScore": 91.2,
    "aiRisk": 34.5,
    "identityMatchScore": 88.0,
    "keystrokeCount": 487,
    "tabSwitchCount": 2,
    "gazeEventCount": 1,
    "sessionHash": "sha256:abc123...",
    "certificateIssued": false,
    "submittedBy": "Sistema RRHH",
    "reviewNote": null
  }
}
```

---

### `PATCH /api/v1/sessions/{id}`

Actualiza el estado de una sesión o añade una nota de revisión.

**Permiso requerido**: `write`

**Request:**

```http
PATCH /api/v1/sessions/f7e6d5c4-b3a2-1098-fedc-ba9876543210
Authorization: Bearer dc_live_xxxx
Content-Type: application/json

{
  "status": "passed",
  "reviewNote": "Revisado manualmente. Las alertas corresponden a falsos positivos por conexión inestable.",
  "externalRef": "EXP-2026-0147"
}
```

**Campos actualizables:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `status` | string | `passed` \| `review` \| `flagged` |
| `reviewNote` | string | Nota del revisor humano |
| `externalRef` | string | Referencia al sistema externo (ATS, RRHH, etc.) |

**Respuesta exitosa (200):**

```json
{
  "success": true,
  "data": {
    "id": "f7e6d5c4-b3a2-1098-fedc-ba9876543210",
    "status": "passed",
    "reviewNote": "Revisado manualmente...",
    "externalRef": "EXP-2026-0147"
  }
}
```

---

## Gestión de API Keys

> **Autenticación**: estos endpoints requieren **sesión de administrador** (cookie `dc_admin_session`), NO un API key. Sólo accesibles desde el dashboard web.

### `GET /api/v1/keys`

Lista todas las claves API activas (enmascaradas por seguridad).

**Respuesta:**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Sistema RRHH Corp",
      "keyMasked": "dc_live_xxxx...xxxx",
      "permissions": ["read", "write"],
      "active": true,
      "lastUsed": "2026-03-14T09:15:00.000Z",
      "createdAt": "2026-01-10T08:00:00.000Z"
    }
  ]
}
```

### `POST /api/v1/keys`

Crea un nuevo API key. **La clave completa sólo se devuelve en esta respuesta.**

**Request:**

```json
{
  "name": "Sistema CRM Externo",
  "permissions": ["read"],
  "webhookUrl": "https://mi-sistema.com/webhook/deepcheck"
}
```

**Respuesta (201):**

```json
{
  "success": true,
  "data": {
    "id": "uuid-nueva-clave",
    "key": "dc_live_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
    "name": "Sistema CRM Externo",
    "permissions": ["read"],
    "createdAt": "2026-03-15T12:00:00.000Z"
  },
  "warning": "Guarda esta clave de forma segura. No se mostrará de nuevo."
}
```

---

## Verificación de Certificados

Endpoint público (sin autenticación) para verificar la integridad de una sesión. Útil para que terceros comprueben de forma independiente un certificado emitido por Deep-Check.

### `GET /api/verify`

**Parámetros de consulta:**

| Parámetro | Requerido | Descripción |
|-----------|-----------|-------------|
| `id` | ✅ | ID de la sesión |
| `hash` | Opcional | Hash SHA-256 esperado para verificar integridad |

**Request:**

```http
GET /api/verify?id=f7e6d5c4-b3a2-1098-fedc-ba9876543210&hash=sha256:abc123...
```

**Respuesta (200):**

```json
{
  "valid": true,
  "verified": true,
  "hashMatch": true,
  "integrity": "ok",
  "session": {
    "id": "f7e6d5c4-b3a2-1098-fedc-ba9876543210",
    "candidateName": "Carlos Martínez",
    "date": "2026-03-15",
    "score": 72,
    "status": "passed",
    "certificateIssued": true,
    "sessionHash": "sha256:abc123..."
  },
  "verdict": "CERTIFICADO VÁLIDO — La integridad del registro ha sido verificada."
}
```

**Respuesta si el hash no coincide (200 con alerta):**

```json
{
  "valid": true,
  "verified": false,
  "hashMatch": false,
  "integrity": "tampered",
  "verdict": "ADVERTENCIA — El hash proporcionado no coincide con el registro almacenado."
}
```

---

## Health Check

### `GET /api/health`

Sin autenticación. Usado por Docker HEALTHCHECK y balanceadores de carga.

**Respuesta OK (200):**

```json
{
  "status": "ok",
  "version": "0.1.0",
  "deployMode": "onpremise",
  "uptime": 3847,
  "db": "ok",
  "latencyMs": 8
}
```

**Respuesta degradada (503):**

```json
{
  "status": "degraded",
  "deployMode": "onpremise",
  "db": "error",
  "latencyMs": 3002
}
```

El campo `db` sólo aparece en modo `onpremise`. En modo `saas` sólo verifica que el proceso Node esté vivo.

---

## Webhooks

Si se configura un `webhookUrl` al crear el API key, Deep-Check enviará notificaciones HTTP POST cuando una sesión cambie de estado.

### Formato del payload

```json
{
  "event": "session.flagged",
  "timestamp": "2026-03-15T14:28:00.000Z",
  "data": {
    "sessionId": "f7e6d5c4-b3a2-1098-fedc-ba9876543210",
    "candidateName": "Carlos Martínez",
    "score": 72,
    "status": "flagged",
    "alertCount": 4
  }
}
```

### Eventos disponibles

| Evento | Descripción |
|--------|-------------|
| `session.created` | Nueva sesión registrada |
| `session.flagged` | Sesión marcada como sospechosa |
| `session.passed` | Sesión aprobada (manual o automática) |

### Verificación de firma (HMAC)

Cada webhook incluye la cabecera `X-DeepCheck-Signature`:

```
X-DeepCheck-Signature: sha256=hexdigest
```

Para verificar en tu servidor:

```javascript
const crypto = require('crypto')

function verifyWebhook(payload, signature, secret) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  )
}
```

---

## Ejemplos de integración

### Node.js / TypeScript

```typescript
const DEEPCHECK_URL = process.env.DEEPCHECK_URL!
const DEEPCHECK_KEY = process.env.DEEPCHECK_API_KEY!

const headers = {
  'Authorization': `Bearer ${DEEPCHECK_KEY}`,
  'Content-Type': 'application/json',
}

// Enrolar candidato
async function enrollCandidate(candidate: {
  name: string
  email: string
  keystrokeProfile: Record<string, number>
}) {
  const res = await fetch(`${DEEPCHECK_URL}/api/v1/enroll`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      candidateName: candidate.name,
      candidateEmail: candidate.email,
      context: 'proceso-seleccion-2026',
      profile: candidate.keystrokeProfile,
    }),
  })
  return res.json()
}

// Obtener resultado de sesión
async function getSession(sessionId: string) {
  const res = await fetch(
    `${DEEPCHECK_URL}/api/v1/sessions/${sessionId}`,
    { headers }
  )
  return res.json()
}

// Marcar sesión como revisada
async function reviewSession(sessionId: string, passed: boolean, note: string) {
  const res = await fetch(
    `${DEEPCHECK_URL}/api/v1/sessions/${sessionId}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        status: passed ? 'passed' : 'flagged',
        reviewNote: note,
      }),
    }
  )
  return res.json()
}
```

### Python

```python
import requests
import os

DEEPCHECK_URL = os.environ["DEEPCHECK_URL"]
DEEPCHECK_KEY = os.environ["DEEPCHECK_API_KEY"]

headers = {
    "Authorization": f"Bearer {DEEPCHECK_KEY}",
    "Content-Type": "application/json",
}

def list_flagged_sessions(page: int = 1) -> dict:
    resp = requests.get(
        f"{DEEPCHECK_URL}/api/v1/sessions",
        headers=headers,
        params={"status": "flagged", "page": page, "limit": 50},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()

def get_session(session_id: str) -> dict:
    resp = requests.get(
        f"{DEEPCHECK_URL}/api/v1/sessions/{session_id}",
        headers=headers,
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()
```

### cURL

```bash
# Variables de entorno
export DEEPCHECK_URL="https://deep-check.vercel.app"
export DEEPCHECK_KEY="dc_live_xxxxxxxxxxxxxxxxxxxx"

# Listar sesiones marcadas
curl -s "${DEEPCHECK_URL}/api/v1/sessions?status=flagged&limit=5" \
  -H "Authorization: Bearer ${DEEPCHECK_KEY}" | jq .

# Verificar certificado
curl -s "${DEEPCHECK_URL}/api/verify?id=SESSION_ID" | jq .

# Health check
curl -s "${DEEPCHECK_URL}/api/health" | jq .
```

---

## Rate Limiting

| Endpoint | Límite |
|----------|--------|
| `/api/v1/*` | 300 req/min por API key |
| `/api/health` | Sin límite |
| `/api/verify` | 60 req/min por IP |
| `/api/auth/*` | 10 req/min por IP |

Las respuestas de rate limit devuelven `HTTP 429` con la cabecera:

```
Retry-After: 30
```

---

## Versiones

| Versión | Estado | Notas |
|---------|--------|-------|
| `v1` | ✅ Activa | Versión actual |

No se planea deprecar v1 en el corto plazo. Los cambios breaking se comunicarán con 90 días de antelación.
