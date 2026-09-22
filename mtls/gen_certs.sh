#!/usr/bin/env bash
# Generate a self-signed CA plus server and client certificates for BPAS
# mTLS. Produces PEM files suitable for Rust (rustls) and Python (uvicorn).
#
# This script is for development and pilot deployments only. A production
# deployment should use certificates issued by a real Certificate Authority
# or an internal PKI with hardware-backed private keys.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${HERE}/out"
mkdir -p "${OUT}"

SERVER_DNS="${BPAS_SERVER_DNS:-bpas-worker.local}"
SERVER_ALT="${BPAS_SERVER_ALT:-DNS:bpas-worker.local,DNS:localhost,IP:127.0.0.1}"
CLIENT_CN="${BPAS_CLIENT_CN:-bpas-agent-01}"

# All keys are 4096-bit RSA so rustls and uvicorn both accept them without
# fuss. For production, switch to Ed25519 where supported.
KEYBITS=4096
DAYS=365

umask 077

echo "[mtls] generating root CA..."
openssl genrsa -out "${OUT}/ca.key" ${KEYBITS} 2>/dev/null
openssl req -x509 -new -key "${OUT}/ca.key" -sha256 -days ${DAYS} \
    -subj "/C=ES/O=Deep-Check/OU=BPAS/CN=BPAS Dev Root CA" \
    -out "${OUT}/ca.crt"

echo "[mtls] generating server key + CSR..."
openssl genrsa -out "${OUT}/server.key" ${KEYBITS} 2>/dev/null
openssl req -new -key "${OUT}/server.key" \
    -subj "/C=ES/O=Deep-Check/OU=BPAS/CN=${SERVER_DNS}" \
    -out "${OUT}/server.csr"

cat > "${OUT}/server.ext" <<EOF
basicConstraints=CA:FALSE
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=${SERVER_ALT}
EOF

echo "[mtls] signing server cert..."
openssl x509 -req -in "${OUT}/server.csr" \
    -CA "${OUT}/ca.crt" -CAkey "${OUT}/ca.key" \
    -CAcreateserial -days ${DAYS} -sha256 \
    -extfile "${OUT}/server.ext" \
    -out "${OUT}/server.crt" 2>/dev/null

echo "[mtls] generating client key + CSR..."
openssl genrsa -out "${OUT}/client.key" ${KEYBITS} 2>/dev/null
openssl req -new -key "${OUT}/client.key" \
    -subj "/C=ES/O=Deep-Check/OU=BPAS/CN=${CLIENT_CN}" \
    -out "${OUT}/client.csr"

cat > "${OUT}/client.ext" <<EOF
basicConstraints=CA:FALSE
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=clientAuth
EOF

echo "[mtls] signing client cert..."
openssl x509 -req -in "${OUT}/client.csr" \
    -CA "${OUT}/ca.crt" -CAkey "${OUT}/ca.key" \
    -CAcreateserial -days ${DAYS} -sha256 \
    -extfile "${OUT}/client.ext" \
    -out "${OUT}/client.crt" 2>/dev/null

# Clean up intermediate files.
rm -f "${OUT}/server.csr" "${OUT}/client.csr"
rm -f "${OUT}/server.ext" "${OUT}/client.ext"
rm -f "${OUT}/ca.srl"

echo
echo "[mtls] artefacts in ${OUT}:"
ls -la "${OUT}"

# Verify chain integrity end-to-end.
echo
echo "[mtls] verifying server cert against CA..."
openssl verify -CAfile "${OUT}/ca.crt" "${OUT}/server.crt"
echo "[mtls] verifying client cert against CA..."
openssl verify -CAfile "${OUT}/ca.crt" "${OUT}/client.crt"

echo
echo "[mtls] done — keep ${OUT}/*.key secret."
