# Deep-Check — Guía de Despliegue On-Premise

> Esta guía cubre el despliegue completo de Deep-Check en infraestructura propia usando Docker Compose. Los datos nunca salen del servidor de la organización.

---

## Índice

1. [Prerrequisitos](#prerrequisitos)
2. [Arquitectura on-premise](#arquitectura-on-premise)
3. [Instalación paso a paso](#instalación-paso-a-paso)
4. [Configuración TLS / HTTPS](#configuración-tls--https)
5. [Referencia de variables de entorno](#referencia-de-variables-de-entorno)
6. [Verificación del despliegue](#verificación-del-despliegue)
7. [Operaciones de mantenimiento](#operaciones-de-mantenimiento)
8. [Backup y recuperación](#backup-y-recuperación)
9. [Actualización](#actualización)
10. [Resolución de problemas](#resolución-de-problemas)
11. [Despliegue en Kubernetes](#despliegue-en-kubernetes)

---

## Prerrequisitos

### Sistema operativo
- Ubuntu 22.04 LTS / 24.04 LTS (recomendado)
- Debian 12, Rocky Linux 9, o RHEL 9
- Windows Server 2022 con WSL2 (no recomendado para producción)

### Software requerido

```bash
# Docker Engine ≥ 24
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Docker Compose v2 (incluido con Docker Desktop y Docker Engine ≥ 23)
docker compose version  # debe mostrar v2.x.x

# Git
sudo apt install git -y

# openssl (para generar certificados y JWTs)
openssl version
```

### Recursos mínimos

| Componente | Mínimo | Recomendado para producción |
|------------|--------|-----------------------------|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 2 GB | 8 GB |
| Disco | 20 GB | 100 GB SSD |
| Red | 10 Mbps | 100 Mbps |

### Puertos necesarios

| Puerto | Servicio | Expuesto externamente |
|--------|----------|----------------------|
| 80 | nginx (HTTP → redirect HTTPS) | ✅ Sí |
| 443 | nginx (HTTPS) | ✅ Sí |
| 3000 | Next.js app | ❌ Solo interno |
| 3001 | PostgREST | ❌ Solo interno |
| 5432 | PostgreSQL | ❌ Solo localhost |

---

## Arquitectura on-premise

```
Internet
    │ :443 / :80
    ▼
┌─────────────────────────────────────────────┐
│              nginx (TLS terminator)          │
│  • HTTP → HTTPS redirect                     │
│  • TLS 1.2/1.3 con certificado propio       │
│  • Security headers (HSTS, CSP, etc.)       │
│  • Bloquea acceso directo a /rest/*         │
└──────────────────┬──────────────────────────┘
                   │ :3000 (interno)
┌──────────────────▼──────────────────────────┐
│         Next.js 16 (node server.js)          │
│  • Análisis documental (server-side)         │
│  • API routes /api/v1/*                      │
│  • Modelos ONNX cargados en memoria          │
│  • NEXT_PUBLIC_SUPABASE_URL=http://rest:3001 │
└──────────────────┬──────────────────────────┘
                   │ :3001 (interno)
┌──────────────────▼──────────────────────────┐
│         PostgREST v12 (REST sobre SQL)       │
│  • Interfaz Supabase-compatible              │
│  • Autenticación JWT (mismo formato)         │
│  • Row Level Security vía roles              │
└──────────────────┬──────────────────────────┘
                   │ :5432 (solo localhost)
┌──────────────────▼──────────────────────────┐
│          PostgreSQL 16 (Alpine)              │
│  • Extensiones: uuid-ossp, pgcrypto         │
│  • Schema: dc_assessments, dc_documents...  │
│  • Volumen persistente: db_data             │
└─────────────────────────────────────────────┘
```

---

## Instalación paso a paso

### Paso 1 — Clonar el repositorio

```bash
git clone https://github.com/paulrod0/deep-check.git
cd deep-check
```

### Paso 2 — Preparar el archivo de entorno

```bash
cp .env.onpremise.example .env
```

### Paso 3 — Generar credenciales JWT

El script genera automáticamente el secreto HMAC y los tokens JWT para PostgREST:

```bash
chmod +x docker/generate-jwt.sh
./docker/generate-jwt.sh
```

Salida esperada:
```
PGRST_JWT_SECRET=aBcDeFgH...64caracteres...

PGRST_JWT_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
PGRST_JWT_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Copiar los tres valores al archivo `.env`.

### Paso 4 — Completar el archivo `.env`

```bash
nano .env
```

Ejemplo de `.env` completo:

```env
# ── Base de datos ──────────────────────────────────────────
DB_USER=deepcheck
DB_PASSWORD=Mb9xK2pL7qRs4nVa                    # <- CAMBIAR
DB_NAME=deepcheck

# ── PostgREST JWT ──────────────────────────────────────────
PGRST_JWT_SECRET=aBcDeFgHiJkLmNoPqRsTuVwXyZ...  # <- del script
PGRST_JWT_ANON_KEY=eyJhbGci...                   # <- del script
PGRST_JWT_SERVICE_KEY=eyJhbGci...               # <- del script

# ── Admin Dashboard ────────────────────────────────────────
ADMIN_PASSWORD=Xz3mK8nQp1rTs6vW                 # <- CAMBIAR

# ── ML Lambda (opcional) ───────────────────────────────────
LSTM_LAMBDA_URL=
LSTM_LAMBDA_SECRET=

# ── Modo de despliegue ─────────────────────────────────────
DEPLOY_MODE=onpremise
```

> ⚠️ **Seguridad**: Añadir `.env` al `.gitignore`. Nunca subir credenciales al repositorio.

### Paso 5 — Configurar TLS

#### Opción A: Certificado de Let's Encrypt (recomendado para producción)

```bash
# Instalar certbot
sudo apt install certbot -y

# Obtener certificado (el dominio debe apuntar a este servidor)
sudo certbot certonly --standalone -d deepcheck.tuempresa.com

# Copiar certificados al directorio del proyecto
mkdir -p docker/certs
sudo cp /etc/letsencrypt/live/deepcheck.tuempresa.com/fullchain.pem docker/certs/cert.pem
sudo cp /etc/letsencrypt/live/deepcheck.tuempresa.com/privkey.pem docker/certs/key.pem
sudo chown $USER:$USER docker/certs/*.pem
```

Configurar renovación automática:

```bash
# Añadir al crontab
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && cp /etc/letsencrypt/live/deepcheck.tuempresa.com/fullchain.pem /ruta/deep-check/docker/certs/cert.pem && cp /etc/letsencrypt/live/deepcheck.tuempresa.com/privkey.pem /ruta/deep-check/docker/certs/key.pem && docker compose -f /ruta/deep-check/docker-compose.yml restart nginx") | crontab -
```

#### Opción B: Certificado corporativo (CA propia)

```bash
mkdir -p docker/certs
cp /ruta/al/certificado.pem docker/certs/cert.pem
cp /ruta/a/la/clave.pem docker/certs/key.pem
```

#### Opción C: Certificado autofirmado (sólo para pruebas)

```bash
mkdir -p docker/certs
openssl req -x509 -newkey rsa:4096 \
  -keyout docker/certs/key.pem \
  -out docker/certs/cert.pem \
  -days 365 -nodes \
  -subj "/C=ES/ST=Andalucia/L=Sevilla/O=MiEmpresa/CN=deepcheck.local"
```

### Paso 6 — Actualizar nginx.conf con el dominio

Editar `docker/nginx.conf` y reemplazar `deepcheck.yourdomain.com` con tu dominio real:

```bash
sed -i 's/deepcheck.yourdomain.com/deepcheck.tuempresa.com/g' docker/nginx.conf
```

### Paso 7 — Construir e iniciar

```bash
# Primera vez: construir la imagen de la app
docker compose build app

# Iniciar todos los servicios
docker compose up -d

# Ver logs en tiempo real
docker compose logs -f
```

Esperar ~60 segundos para que la base de datos inicialice y PostgREST se conecte.

### Paso 8 — Verificar el despliegue

```bash
# Health check del stack completo
curl -k https://localhost/api/health
# Respuesta esperada: {"status":"ok","deployMode":"onpremise","db":"ok","latencyMs":8}

# Estado de los contenedores
docker compose ps
# Todos deben mostrar "Up (healthy)" o "Up"
```

---

## Configuración TLS / HTTPS

### nginx.conf — opciones avanzadas

El archivo `docker/nginx.conf` incluido tiene una configuración segura por defecto. Para personalizarla:

```nginx
# Tiempo de expiración de sesiones TLS (mayor = mejor rendimiento, menor = más seguro)
ssl_session_timeout 1d;

# Protocolos permitidos (TLS 1.0 y 1.1 están deprecados)
ssl_protocols TLSv1.2 TLSv1.3;

# Cipher suites recomendados (OWASP A+)
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:...;

# HSTS: forzar HTTPS durante 1 año (incluye subdomains)
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
```

### Tamaño máximo de archivo

Por defecto, nginx permite hasta 25 MB por petición (para documentos a analizar). Para cambiar:

```nginx
# En docker/nginx.conf, dentro del bloque server{}
client_max_body_size 50M;
```

---

## Referencia de variables de entorno

### Requeridas en todos los modos

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL de PostgREST (on-premise) o Supabase (SaaS) | `http://rest:3001` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | JWT del rol anónimo | `eyJhbGci...` |
| `SUPABASE_SERVICE_ROLE_KEY` | JWT del rol service (permisos elevados, sólo servidor) | `eyJhbGci...` |
| `ADMIN_PASSWORD` | Contraseña del dashboard de administración | `Contraseña-Fuerte-1!` |
| `NEXT_PUBLIC_DEPLOY_MODE` | Modo de despliegue | `onpremise` ó `saas` |

### Requeridas sólo en modo on-premise

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DB_USER` | Usuario de PostgreSQL | `deepcheck` |
| `DB_PASSWORD` | Contraseña de PostgreSQL | `Mb9xK2pL7q...` |
| `DB_NAME` | Nombre de la base de datos | `deepcheck` |
| `PGRST_JWT_SECRET` | Secreto HMAC-SHA256 para firmar JWTs de PostgREST (≥32 chars) | `aBcDeFg...` |
| `PGRST_JWT_ANON_KEY` | JWT firmado para el rol `deepcheck_anon` | `eyJhbGci...` |
| `PGRST_JWT_SERVICE_KEY` | JWT firmado para el rol `service_role` | `eyJhbGci...` |

### Opcionales

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `LSTM_LAMBDA_URL` | URL de la función AWS Lambda con BiLSTM | vacío (usa ONNX local) |
| `LSTM_LAMBDA_SECRET` | Secreto compartido con la Lambda | vacío |
| `NODE_ENV` | Entorno Node.js | `production` |
| `PORT` | Puerto del servidor Next.js | `3000` |
| `HOSTNAME` | Dirección de escucha | `0.0.0.0` |

---

## Verificación del despliegue

### Checklist post-instalación

```bash
# 1. Health check del servidor
curl https://deepcheck.tuempresa.com/api/health

# 2. Verificar que PostgreSQL está corriendo
docker compose exec db pg_isready -U deepcheck

# 3. Verificar que las tablas existen
docker compose exec db psql -U deepcheck -d deepcheck -c "\dt"

# 4. Verificar que PostgREST responde
docker compose exec app curl -s http://rest:3001/ | head -c 100

# 5. Verificar la UI
curl -I https://deepcheck.tuempresa.com/
# → HTTP/2 200
```

### Monitorización básica

```bash
# Ver logs de todos los servicios
docker compose logs --tail=50

# Ver logs de un servicio específico
docker compose logs --tail=100 -f app

# Estado y uso de recursos
docker stats --no-stream
```

---

## Operaciones de mantenimiento

### Reiniciar un servicio

```bash
docker compose restart app      # reiniciar Next.js
docker compose restart nginx    # recargar nginx (tras cambios en nginx.conf)
docker compose restart db       # reiniciar PostgreSQL (⚠️ hay downtime)
```

### Acceder a la base de datos

```bash
# Consola psql interactiva
docker compose exec db psql -U deepcheck -d deepcheck

# Ejecutar una consulta directamente
docker compose exec db psql -U deepcheck -d deepcheck -c "SELECT count(*) FROM dc_assessments;"

# Exportar tabla a CSV
docker compose exec db psql -U deepcheck -d deepcheck \
  -c "\COPY dc_assessments TO '/tmp/assessments.csv' CSV HEADER"
docker compose cp db:/tmp/assessments.csv ./assessments.csv
```

### Limpiar sesiones de admin expiradas

```bash
docker compose exec db psql -U deepcheck -d deepcheck \
  -c "SELECT dc_cleanup_expired_sessions();"
```

### Añadir modelo ONNX de forensia

El modelo opcional `forgery-detector.onnx` para el análisis neural se monta desde el volumen `models_data`:

```bash
# Copiar el modelo al volumen
docker compose cp /ruta/local/forgery-detector.onnx app:/app/models/forgery-detector.onnx

# Verificar que Next.js lo puede leer
docker compose exec app ls -la /app/models/
```

También se puede colocar en `public/models/forgery-detector.onnx` para que ONNX Runtime Web lo cargue en el navegador.

---

## Backup y recuperación

### Backup de la base de datos

```bash
#!/bin/bash
# Script de backup diario — guardar como /usr/local/bin/deepcheck-backup.sh

BACKUP_DIR="/var/backups/deepcheck"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

# Dump de PostgreSQL
docker compose -f /ruta/deep-check/docker-compose.yml exec -T db \
  pg_dump -U deepcheck deepcheck | gzip > "${BACKUP_DIR}/db_${DATE}.sql.gz"

# Mantener sólo los últimos 30 backups
find "$BACKUP_DIR" -name "db_*.sql.gz" -mtime +30 -delete

echo "Backup completado: ${BACKUP_DIR}/db_${DATE}.sql.gz"
```

```bash
# Hacer ejecutable y añadir al cron
chmod +x /usr/local/bin/deepcheck-backup.sh
(crontab -l; echo "0 2 * * * /usr/local/bin/deepcheck-backup.sh >> /var/log/deepcheck-backup.log 2>&1") | crontab -
```

### Restaurar un backup

```bash
# Parar la aplicación (para evitar escrituras durante la restauración)
docker compose stop app

# Restaurar
gunzip -c /var/backups/deepcheck/db_20260315_020000.sql.gz | \
  docker compose exec -T db psql -U deepcheck deepcheck

# Reiniciar
docker compose start app
```

### Backup de la configuración

```bash
# Archivos críticos a respaldar (NO incluir en git)
tar czf deepcheck-config-$(date +%Y%m%d).tar.gz \
  .env \
  docker/certs/ \
  docker/nginx.conf
```

---

## Actualización

### Actualizar a una nueva versión

```bash
# 1. Hacer backup antes de actualizar
/usr/local/bin/deepcheck-backup.sh

# 2. Obtener los últimos cambios
git pull origin main

# 3. Reconstruir la imagen de la app
docker compose build app

# 4. Aplicar migraciones si las hay
#    (comprobar CHANGELOG o docs/MIGRATIONS.md)

# 5. Reiniciar con zero-downtime mínimo
docker compose up -d --no-deps app

# 6. Verificar
docker compose logs --tail=20 app
curl https://deepcheck.tuempresa.com/api/health
```

### Actualizar el certificado TLS

```bash
# Copiar los nuevos certificados
cp /ruta/nuevo/cert.pem docker/certs/cert.pem
cp /ruta/nueva/key.pem  docker/certs/key.pem

# Recargar nginx sin downtime
docker compose exec nginx nginx -s reload
```

---

## Resolución de problemas

### El contenedor `app` no arranca

```bash
docker compose logs app --tail=50
```

**Error típico**: `Missing Supabase env vars`
→ Verificar que `.env` contiene `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`

**Error típico**: `Cannot connect to PostgREST`
→ Verificar que `db` está sano: `docker compose ps db`

### PostgREST retorna 401

→ El JWT en `.env` no corresponde al `PGRST_JWT_SECRET`. Regenerar con `./docker/generate-jwt.sh` y actualizar `.env`.

```bash
# Verificar que el JWT es válido
docker compose exec rest wget -qO- http://localhost:3001/ 2>&1 | head -5
```

### La base de datos no inicializa el schema

```bash
# Verificar que el init.sql se ejecutó
docker compose exec db psql -U deepcheck -d deepcheck -c "\dt dc_*"

# Si no hay tablas, ejecutar manualmente
docker compose exec db psql -U deepcheck -d deepcheck \
  -f /docker-entrypoint-initdb.d/01-init.sql
```

### nginx retorna 502 Bad Gateway

→ El contenedor `app` aún está iniciando. Esperar ~30s y reintentar.

```bash
# Comprobar el health del contenedor app
docker inspect deepcheck-app | grep -A 5 '"Health"'
```

### Error de certificado TLS

```bash
# Verificar que los archivos existen y son legibles
ls -la docker/certs/
openssl x509 -noout -dates -in docker/certs/cert.pem

# Verificar que la clave privada corresponde al certificado
openssl rsa -noout -modulus -in docker/certs/key.pem | md5sum
openssl x509 -noout -modulus -in docker/certs/cert.pem | md5sum
# Los dos md5 deben coincidir
```

### Logs de acceso y auditoría

```bash
# Logs de nginx (accesos HTTP)
docker compose exec nginx tail -f /var/log/nginx/access.log

# Logs de errores nginx
docker compose exec nginx tail -f /var/log/nginx/error.log

# Logs de la aplicación Next.js
docker compose logs -f app
```

---

## Despliegue en Kubernetes

> Para entornos con alta disponibilidad o múltiples instancias.

### Estructura de Deployments

```yaml
# k8s/deployment-app.yaml (ejemplo simplificado)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: deepcheck-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: deepcheck-app
  template:
    spec:
      containers:
      - name: app
        image: ghcr.io/tuorg/deep-check:latest
        ports:
        - containerPort: 3000
        env:
        - name: NEXT_PUBLIC_SUPABASE_URL
          valueFrom:
            secretKeyRef:
              name: deepcheck-secrets
              key: supabase-url
        - name: SUPABASE_SERVICE_ROLE_KEY
          valueFrom:
            secretKeyRef:
              name: deepcheck-secrets
              key: service-role-key
        livenessProbe:
          httpGet:
            path: /api/health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /api/health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 10
```

### Secrets en Kubernetes

```bash
kubectl create secret generic deepcheck-secrets \
  --from-literal=supabase-url="http://postgrest-service:3001" \
  --from-literal=supabase-anon-key="eyJhbGci..." \
  --from-literal=service-role-key="eyJhbGci..." \
  --from-literal=admin-password="TuContraseñaSegura"
```

### Consideraciones para K8s

- PostgreSQL: usar un StatefulSet con PVC, o un servicio gestionado (AWS RDS, Azure Database, etc.)
- PostgREST: escalar horizontalmente (stateless)
- Next.js app: stateless — escalar sin restricciones
- Modelos ONNX: montar como PersistentVolume compartido (ReadOnlyMany) o incluir en la imagen

---

## Soporte

Si tienes problemas con el despliegue:

1. Revisar esta guía completa antes de abrir un issue
2. Incluir la salida de `docker compose logs` en el report
3. Abrir un issue en [GitHub](https://github.com/paulrod0/deep-check/issues) con la etiqueta `deployment`
