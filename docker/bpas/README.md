# BPAS — Local end-to-end deployment

Stack:

- `bpas-worker` → FastAPI + Torch inference worker
- `bpas-agent` → Rust endpoint agent (captures events, ships over mTLS)

## One-time setup

```bash
# Certificates
./mtls/gen_certs.sh

# Pre-trained model artefacts (expected to live in ./models/)
#   models/keystroke_v2_best.pt + manifest.json
#   models/mouse_tcn_best.pt + manifest.json
#   models/op_vae_best.pt + app_vocab.json + manifest.json
#   models/bpas_ensemble.json
mkdir -p models
```

## Run

```bash
docker compose -f docker/bpas/docker-compose.yml up --build
```

The worker logs a TLS handshake event for each agent connection; the agent
logs a batch upload roughly every second.

## Load models at runtime

```bash
curl -k https://localhost:8443/v1/models/reload \
  --cacert mtls/out/ca.crt \
  --cert   mtls/out/client.crt \
  --key    mtls/out/client.key \
  -H "X-Admin-Token: dev-admin-token-change-me" \
  -H "Content-Type: application/json" \
  -d '{"modality":"mouse","weights_path":"/models/mouse_tcn_best.pt"}'
```

## Check health

```bash
curl -k https://localhost:8443/v1/health \
  --cacert mtls/out/ca.crt \
  --cert   mtls/out/client.crt \
  --key    mtls/out/client.key
```

## Metrics

Prometheus metrics are served at `/metrics` on the same port:

```bash
curl -k https://localhost:8443/metrics \
  --cacert mtls/out/ca.crt \
  --cert   mtls/out/client.crt \
  --key    mtls/out/client.key | head -40
```

Add this scrape config to your Prometheus instance (if any):

```yaml
scrape_configs:
  - job_name: bpas
    scheme: https
    tls_config:
      ca_file:   mtls/out/ca.crt
      cert_file: mtls/out/client.crt
      key_file:  mtls/out/client.key
    static_configs:
      - targets: ["bpas-worker:8443"]
```
