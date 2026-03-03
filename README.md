# Deep-Check — Forensia Documental & Proctoring Biométrico

> Plataforma de verificación de identidad y autenticidad documental para procesos de selección, admisión y compliance empresarial. Disponible como **SaaS en la nube** o **totalmente on-premise** sin dependencias externas.

[![Node 20](https://img.shields.io/badge/Node-20-brightgreen)](https://nodejs.org)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED)](https://docs.docker.com/compose/)
[![License](https://img.shields.io/badge/License-Proprietary-red)](LICENSE)

---

## ¿Qué es Deep-Check?

Deep-Check es una plataforma modular que combina **proctoring biométrico** (supervisión de exámenes en línea) con **forensia documental** (detección de documentos falsos o manipulados). Diseñada para:

- **Centros educativos y academia**: verificación de candidatos en exámenes online
- **Recursos Humanos**: validación de identidad y documentos en selección de personal
- **Compliance y legal**: peritaje forense de imágenes con cadena de custodia
- **Administración pública**: verificación de documentos DNI, facturas, certificados

### Modos de despliegue

| | SaaS (Vercel + Supabase) | On-Premise (Docker) |
|---|---|---|
| **Tiempo setup** | 5 minutos | 30 minutos |
| **Datos salen de la organización** | Sí (servidores Supabase EU) | **No** — todo local |
| **Mantenimiento DB** | Automático | A cargo del cliente |
| **Escalabilidad** | Automática | Horizontal (Docker Swarm / K8s) |
| **Coste infraestructura** | ~$25/mes (Supabase Pro) | Servidor propio |
| **Cumplimiento ENS/RGPD datos críticos** | Evaluación necesaria | ✅ Total control |

---

## Características principales

### 🔬 Forensia Documental
- **ELA (Error Level Analysis)**: detecta zonas de una imagen re-comprimidas o editadas con una precisión visual de bloque 8×8
- **Análisis EXIF**: detecta software de edición, inconsistencias de fecha/hora y datos GPS sospechosos
- **Análisis de Ruido (Laplacian)**: identifica regiones con firma de imagen sintética generada por IA
- **Detección de Clonado (Copy-Move)**: hash perceptual de bloques 16×16 y comparación coseno para detectar regiones duplicadas dentro de la imagen
- **Clasificador de documento**: distingue automáticamente DNI, factura, foto de persona, captura de pantalla y documento genérico
- **Informe PDF forense**: 7 secciones incluyendo cadena de custodia y explicabilidad XAI, generado 100% en cliente (jsPDF)

### 🧠 Análisis Neural IA (modo avanzado)
Activable como opción en la misma interfaz, sin coste extra de infraestructura:
- **ELA multi-escala**: ELA a 4 calidades JPEG (65/75/85/92) — la inconsistencia entre calidades delata doble compresión
- **Análisis DCT**: 8×8 bloques de DCT, histograma de coeficientes DC — huecos periódicos = imagen JPEG re-guardada con distintas tablas de cuantización
- **Consistencia regional**: varianza Laplaciana en malla 3×3 — zonas con ruido distinto = contenido de fuente diferente
- **Correlación cromática**: correlación de Pearson + kurtosis por canal — imágenes IA tienen correlación anormalmente alta
- **ONNX Runtime Web** (opcional): si el administrador incluye un modelo `forgery-detector.onnx` en `/public/models/`, se usa en ensemble automáticamente

### 👁️ Proctoring Biométrico
- **Análisis de movimiento ocular**: sacadas, seguimiento con face-api.js + ONNX, detección de evasión de mirada
- **Biometría de escritura (keystroke dynamics)**: 18 features (hold time, flight time, entropía, gradiente de velocidad, kurtosis, etc.)
- **Detección de anomalías ensemble**: XGBoost + Isolation Forest + BiLSTM (secuencias brutas 120×2)
- **Trust Score en tiempo real**: penalización por alertas, recuperación progresiva, grace period de 7s al inicio
- **Liveness detection**: detección de parpadeo (2-50/min), inclinación de cabeza, periodicidad de parpadeo
- **Certificado verificable**: hash SHA-256 de sesión, verificable públicamente vía `/api/verify?id=…`

### 🔌 API Pública REST (v1)
- Autenticación por API key (Bearer token)
- Endpoints para sesiones, enrollment biométrico y gestión de claves
- Compatible con webhooks

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                     CLIENTE (Navegador)                     │
│  face-api.js (ONNX)  │  Canvas API  │  ONNX Runtime Web    │
│  Keystroke capture   │  ELA engine  │  Neural forensics     │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTPS
┌────────────────────────────▼────────────────────────────────┐
│                  Next.js 16 (App Router)                    │
│                                                             │
│  /interview    /documents    /dashboard    /enroll          │
│                                                             │
│  API Routes:                                                │
│  /api/v1/*  (public REST)   /api/auth/*  (admin)           │
│  /api/ml-score[-v2]         /api/documents                  │
│  /api/assessments           /api/health                     │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
     ┌──────────▼──────────┐      ┌──────────▼──────────┐
     │  SaaS Mode          │      │  On-Premise Mode     │
     │  Supabase Cloud     │      │  PostgREST v12       │
     │  (PostgreSQL 16)    │      │  PostgreSQL 16       │
     │  EU data region     │      │  (docker volume)     │
     └─────────────────────┘      └─────────────────────┘
                                           │
                               ┌───────────▼───────────┐
                               │  nginx (TLS terminator) │
                               │  port 443 → app:3000   │
                               └────────────────────────┘
```

**Directorio de modelos ML (`/models/`):**
```
models/
├── biometric-fraud-detector.onnx  ← modelo ONNX de detección de fraude biométrico
├── ensemble_params.json           ← pesos XGBoost
├── feature_scaler.json            ← escalado de features (mean/std)
├── model_metadata.json            ← versión y métricas de entrenamiento
└── lstm/                          ← artefactos del modelo BiLSTM
    └── forgery-detector.onnx      ← (opcional) modelo neural de forensia
```

---

## Quick Start — SaaS

### Requisitos
- Cuenta en [Supabase](https://supabase.com) (plan Free o Pro)
- Cuenta en [Vercel](https://vercel.com) (plan Hobby o superior)
- Node.js ≥ 20

### 1. Clonar e instalar

```bash
git clone https://github.com/paulrod0/deep-check.git
cd deep-check
npm install
```

### 2. Configurar base de datos (Supabase)

Ejecutar el schema SQL en el SQL Editor de Supabase:

```bash
# El schema completo está en docker/init.sql
# Ejecutar en: Supabase Dashboard → SQL Editor → New query
cat docker/init.sql
```

O ejecutar la migración vía CLI:

```bash
npx supabase db push --db-url postgresql://[user]:[password]@[host]/postgres
```

### 3. Variables de entorno

```bash
cp .env.example .env.local
```

Editar `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...           # anon/public key
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...               # service_role key (solo servidor)
ADMIN_PASSWORD=tu-contraseña-segura-aqui
NEXT_PUBLIC_DEPLOY_MODE=saas

# Opcional — BiLSTM en AWS Lambda
LSTM_LAMBDA_URL=https://xxxxxxxx.lambda-url.eu-west-1.on.aws/
LSTM_LAMBDA_SECRET=tu-secreto-compartido
```

### 4. Desarrollo local

```bash
npm run dev
# → http://localhost:3000
```

### 5. Deploy en Vercel

```bash
npx vercel --prod
```

O conectar el repositorio GitHub en el [Dashboard de Vercel](https://vercel.com/new) y añadir las variables de entorno.

> ⚠️ **Importante**: `SUPABASE_SERVICE_ROLE_KEY` debe añadirse como variable de entorno en Vercel. Nunca la incluyas en el código fuente ni la expongas en el cliente.

---

## Quick Start — On-Premise (Docker)

> Guía completa: [`docs/DEPLOY.md`](docs/DEPLOY.md)

### Requisitos
- Docker ≥ 24 y Docker Compose v2
- 2 GB RAM mínimo, 4 GB recomendado
- Dominio con certificado TLS (o generarlo con `certbot`)

### 1. Preparar entorno

```bash
git clone https://github.com/paulrod0/deep-check.git
cd deep-check
cp .env.onpremise.example .env
```

### 2. Generar credenciales

```bash
# Genera PGRST_JWT_SECRET + PGRST_JWT_ANON_KEY + PGRST_JWT_SERVICE_KEY
chmod +x docker/generate-jwt.sh
./docker/generate-jwt.sh >> .env
```

Editar `.env` y completar:

```env
DB_PASSWORD=contraseña-fuerte-aqui
ADMIN_PASSWORD=otra-contraseña-fuerte
```

### 3. Certificados TLS

```bash
mkdir -p docker/certs
# Opción A: certificado propio
cp /ruta/a/fullchain.pem docker/certs/cert.pem
cp /ruta/a/privkey.pem   docker/certs/key.pem

# Opción B: certificado autofirmado para pruebas
openssl req -x509 -newkey rsa:4096 -keyout docker/certs/key.pem \
  -out docker/certs/cert.pem -days 365 -nodes -subj "/CN=deepcheck.local"
```

### 4. Arrancar

```bash
docker compose up -d
```

### 5. Verificar

```bash
curl https://tu-dominio.com/api/health
# → {"status":"ok","deployMode":"onpremise","db":"ok","latencyMs":12}
```

Acceder a:
- **Aplicación**: `https://tu-dominio.com`
- **Dashboard admin**: `https://tu-dominio.com/dashboard`

---

## API REST Pública (v1)

> Referencia completa: [`docs/API.md`](docs/API.md)

### Autenticación

Todas las llamadas a `/api/v1/*` requieren un API key en la cabecera:

```http
Authorization: Bearer dc_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Los API keys se crean desde el dashboard de administración (`/dashboard`).

### Endpoints principales

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/v1/enroll` | Registrar perfil biométrico de candidato |
| `GET`  | `/api/v1/enroll?email=…` | Recuperar perfil por email |
| `POST` | `/api/v1/sessions` | Crear nueva sesión de evaluación |
| `GET`  | `/api/v1/sessions` | Listar sesiones (paginado) |
| `GET`  | `/api/v1/sessions/{id}` | Detalle de sesión |
| `PATCH`| `/api/v1/sessions/{id}` | Actualizar estado / añadir nota |
| `GET`  | `/api/health` | Health check (sin autenticación) |
| `GET`  | `/api/verify?id={id}` | Verificar certificado de sesión |

### Ejemplo rápido

```bash
# 1. Obtener API key desde /dashboard → Gestión de claves

# 2. Crear una sesión de evaluación
curl -X POST https://tu-dominio.com/api/v1/sessions \
  -H "Authorization: Bearer dc_live_xxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "candidateName": "María García",
    "role": "Ingeniera de Software",
    "date": "2026-03-15"
  }'
# → { "success": true, "data": { "id": "uuid-de-la-sesion" } }

# 3. Consultar resultado
curl https://tu-dominio.com/api/v1/sessions/uuid-de-la-sesion \
  -H "Authorization: Bearer dc_live_xxxx"
```

---

## Seguridad

| Capa | Medida |
|------|--------|
| **Autenticación admin** | Password hashing SHA-256, timing-safe comparison, cookie httpOnly + SameSite=Strict |
| **Sesiones admin** | Token aleatorio 32 bytes, expiración 8 horas, revocación en logout |
| **API keys** | Prefijo `dc_live_`, revocables individualmente, permisos granulares (read/write) |
| **CSP** | `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'` |
| **Cabeceras HTTP** | HSTS 1 año, X-Frame-Options, X-Content-Type-Options, Referrer-Policy |
| **Docker** | Usuario non-root `nextjs:nodejs` (uid 1001), imagen alpine |
| **Red** | PostgreSQL y PostgREST sólo accesibles en `127.0.0.1` (no expuestos externamente) |
| **Datos biométricos** | Nunca se almacenan en texto plano; sólo features agregadas y hashes de sesión |

---

## Variables de entorno — Referencia completa

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | URL de Supabase o PostgREST local |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | JWT anon para PostgREST |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | JWT service role (solo servidor) |
| `ADMIN_PASSWORD` | ✅ | Contraseña del dashboard |
| `NEXT_PUBLIC_DEPLOY_MODE` | ✅ | `saas` ó `onpremise` |
| `DB_USER` | On-premise | Usuario PostgreSQL |
| `DB_PASSWORD` | On-premise | Contraseña PostgreSQL |
| `DB_NAME` | On-premise | Nombre de la base de datos |
| `PGRST_JWT_SECRET` | On-premise | Secreto HMAC para firmar JWTs de PostgREST |
| `PGRST_JWT_ANON_KEY` | On-premise | JWT del rol anónimo |
| `PGRST_JWT_SERVICE_KEY` | On-premise | JWT del rol service |
| `LSTM_LAMBDA_URL` | Opcional | URL de la función Lambda BiLSTM |
| `LSTM_LAMBDA_SECRET` | Opcional | Secreto compartido con Lambda |

---

## Estructura del proyecto

```
deep-check/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── v1/               ← API pública (enroll, sessions, keys)
│   │   │   ├── assessments/      ← CRUD sesiones (admin)
│   │   │   ├── documents/        ← CRUD análisis documentales
│   │   │   ├── auth/             ← Login/logout admin
│   │   │   ├── health/           ← Health check Docker
│   │   │   ├── ml-score/         ← Inferencia ML v1 (ONNX)
│   │   │   └── ml-score-v2/      ← Inferencia ML v2 (ensemble)
│   │   ├── documents/            ← UI forensia documental
│   │   ├── interview/            ← UI proctoring en tiempo real
│   │   ├── dashboard/            ← Panel de administración
│   │   └── enroll/               ← Flujo de enrollment biométrico
│   └── lib/
│       ├── db.ts                 ← Cliente Supabase (server-side)
│       ├── imageForensics.ts     ← ELA, EXIF, Noise (análisis estándar)
│       ├── documentClassifier.ts ← Clasificador tipo + clone detection
│       ├── neuralForensics.ts    ← Análisis neural multi-escala + DCT
│       ├── forensicReport.ts     ← Generador PDF forense (jsPDF)
│       └── auditLog.ts           ← Registro de auditoría
├── docker/
│   ├── init.sql                  ← Schema PostgreSQL completo
│   ├── nginx.conf                ← Reverse proxy con TLS
│   └── generate-jwt.sh           ← Generador de JWTs PostgREST
├── models/                       ← Modelos ONNX (no se suben a git)
├── Dockerfile                    ← Multi-stage build (deps→builder→runner)
├── docker-compose.yml            ← Stack completo on-premise
└── .env.onpremise.example        ← Plantilla de variables de entorno
```

---

## Cumplimiento normativo

| Marco | Estado |
|-------|--------|
| **RGPD / GDPR** | ✅ — Sin transferencia de datos en modo on-premise; datos biométricos procesados y descartados en cliente |
| **EU AI Act** | ✅ — Sistema de "alto riesgo" con logs de auditoría, XAI (explicabilidad), posibilidad de revisión humana |
| **ENS Básico** | ✅ — Cabeceras de seguridad, autenticación segura, logs de acceso, cifrado TLS |
| **ISO 27001** | Evaluación de controles en `COMPLIANCE.md` |

---

## Documentación adicional

- 📡 **[API Reference](docs/API.md)** — Referencia completa de todos los endpoints
- 🚀 **[Guía de despliegue on-premise](docs/DEPLOY.md)** — Docker, TLS, backups, actualización
- 🔒 **[Compliance](COMPLIANCE.md)** — RGPD, ENS, EU AI Act

---

## Soporte y contacto

Para integraciones enterprise, soporte técnico o preguntas comerciales:

- 📧 Email: [contacto disponible bajo NDA]
- 🐛 Issues: [GitHub Issues](https://github.com/paulrod0/deep-check/issues)
