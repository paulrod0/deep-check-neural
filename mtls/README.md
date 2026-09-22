# BPAS Development mTLS

Self-signed certificates for end-to-end mTLS between the BPAS agent and the
inference worker. **Development only.** A production deployment must use
certificates issued by a real internal PKI with hardware-backed private
keys (HSM or TPM-resident keys).

## Generate

```bash
./gen_certs.sh
```

Environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `BPAS_SERVER_DNS` | `bpas-worker.local` | Server Common Name |
| `BPAS_SERVER_ALT` | `DNS:bpas-worker.local,DNS:localhost,IP:127.0.0.1` | X.509 SAN list |
| `BPAS_CLIENT_CN` | `bpas-agent-01` | Client Common Name |

Outputs land in `./out/` (excluded from git):

```
out/
├── ca.crt          Root CA — distribute to every agent + worker
├── ca.key          Root CA private key — keep offline
├── server.crt      Worker certificate
├── server.key      Worker private key
├── client.crt      Agent certificate
└── client.key      Agent private key
```

## Agent configuration

Point the Rust agent at these paths in `agent-rust/src/config.rs`:

```toml
[transport]
endpoint = "https://127.0.0.1:8443"
client_cert = "/path/to/mtls/out/client.crt"
client_key  = "/path/to/mtls/out/client.key"
server_ca   = "/path/to/mtls/out/ca.crt"
```

## Worker configuration

Run the Python worker with the corresponding server keys:

```bash
python -m ml.bpas.service.server \
  --server-cert mtls/out/server.crt \
  --server-key  mtls/out/server.key \
  --client-ca   mtls/out/ca.crt \
  --port 8443
```

## Sanity-check the handshake

```bash
openssl s_client \
  -connect 127.0.0.1:8443 \
  -CAfile mtls/out/ca.crt \
  -cert   mtls/out/client.crt \
  -key    mtls/out/client.key \
  -servername bpas-worker.local < /dev/null
```

A successful handshake prints `Verify return code: 0 (ok)` and the worker
logs receive a TLS handshake completion event.

## Rotating certificates

Rotation in dev is a re-run of `./gen_certs.sh`. For a production pilot:

1. Generate a new intermediate CA from the offline root.
2. Publish the new intermediate in the configuration manifest alongside a
   grace period during which both the old and new CA validate incoming
   client certificates.
3. Re-issue client certs per endpoint, binding the private key to the TPM
   (see `agent-rust/src/crypto.rs::derive_from_tpm`).
4. Revoke old certs via CRL or OCSP once all endpoints have moved over.
