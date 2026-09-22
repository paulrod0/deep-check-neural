#!/usr/bin/env bash
# Build a two-tier internal PKI (offline root CA + online intermediate CA),
# then issue server, client, and OCSP responder certificates.
#
# Run from the repo root:
#
#   bash mtls/gen_internal_pki.sh init
#   bash mtls/gen_internal_pki.sh server bpas-worker.internal
#   bash mtls/gen_internal_pki.sh client bpas-agent-001
#   bash mtls/gen_internal_pki.sh revoke bpas-agent-001
#   bash mtls/gen_internal_pki.sh crl
#
# All operations are idempotent and safe to re-run.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKI="${HERE}/pki"
CONF="${PKI}/openssl.cnf"

ROOT_PASS="${BPAS_ROOT_PASS:-bpas-dev-root-passphrase}"

ROOT="${PKI}/root"
INT="${PKI}/intermediate"

CMD="${1:-help}"

setup_dirs() {
    for D in "${ROOT}" "${INT}"; do
        mkdir -p "${D}/certs" "${D}/crl" "${D}/newcerts" "${D}/private" "${D}/csr"
        chmod 700 "${D}/private"
        [ -f "${D}/index.txt" ] || : > "${D}/index.txt"
        [ -f "${D}/index.txt.attr" ] || echo "unique_subject = no" > "${D}/index.txt.attr"
        [ -f "${D}/serial" ] || echo 1000 > "${D}/serial"
        [ -f "${D}/crlnumber" ] || echo 1000 > "${D}/crlnumber"
    done
}

cmd_init() {
    setup_dirs

    if [ ! -f "${ROOT}/private/ca.key" ]; then
        echo "[pki] generating offline root CA key (4096-bit RSA)..."
        openssl genrsa -aes256 -passout pass:"${ROOT_PASS}" \
            -out "${ROOT}/private/ca.key" 4096 2>/dev/null
        chmod 400 "${ROOT}/private/ca.key"

        echo "[pki] self-signing root CA cert (10-year validity)..."
        ( cd "${PKI}" && openssl req -config openssl.cnf \
            -key root/private/ca.key -passin pass:"${ROOT_PASS}" \
            -new -x509 -days 3650 -sha256 -extensions v3_ca \
            -subj "/C=ES/O=Deep-Check/OU=BPAS/CN=BPAS Internal Root CA" \
            -out root/certs/ca.crt 2>/dev/null )
        chmod 444 "${ROOT}/certs/ca.crt"
    else
        echo "[pki] root CA already exists; skipping"
    fi

    if [ ! -f "${INT}/private/intermediate.key" ]; then
        echo "[pki] generating intermediate CA key..."
        openssl genrsa -out "${INT}/private/intermediate.key" 4096 2>/dev/null
        chmod 400 "${INT}/private/intermediate.key"

        echo "[pki] creating intermediate CSR..."
        ( cd "${PKI}" && openssl req -config openssl.cnf \
            -key intermediate/private/intermediate.key -new -sha256 \
            -subj "/C=ES/O=Deep-Check/OU=BPAS/CN=BPAS Internal Intermediate CA" \
            -out intermediate/csr/intermediate.csr 2>/dev/null )

        echo "[pki] signing intermediate cert with root CA..."
        ( cd "${PKI}" && openssl ca -config openssl.cnf -name CA_default \
            -extensions v3_intermediate_ca -days 1825 -notext -batch -md sha256 \
            -passin pass:"${ROOT_PASS}" \
            -in intermediate/csr/intermediate.csr \
            -out intermediate/certs/intermediate.crt 2>/dev/null )
        chmod 444 "${INT}/certs/intermediate.crt"

        echo "[pki] building chain bundle..."
        cat "${INT}/certs/intermediate.crt" "${ROOT}/certs/ca.crt" > "${INT}/certs/chain.crt"
    else
        echo "[pki] intermediate CA already exists; skipping"
    fi

    echo
    echo "[pki] verification:"
    openssl verify -CAfile "${ROOT}/certs/ca.crt" "${INT}/certs/intermediate.crt"
}

issue_cert() {
    local kind="$1"
    local cn="$2"
    local ext_name="${kind}_cert"
    local key="intermediate/private/${cn}.key"
    local csr="intermediate/csr/${cn}.csr"
    local crt="intermediate/certs/${cn}.crt"

    if [ -f "${PKI}/${crt}" ]; then
        echo "[pki] ${cn} already issued; refusing to overwrite (revoke first)"
        return
    fi

    echo "[pki] generating ${kind} key for ${cn}..."
    ( cd "${PKI}" && openssl genrsa -out "${key}" 4096 2>/dev/null )
    chmod 400 "${PKI}/${key}"

    local subject="/C=ES/O=Deep-Check/OU=BPAS/CN=${cn}"
    ( cd "${PKI}" && openssl req -config openssl.cnf \
        -key "${key}" -new -sha256 -subj "${subject}" -out "${csr}" 2>/dev/null )

    ( cd "${PKI}" && openssl ca -config openssl.cnf -name CA_intermediate \
        -extensions "${ext_name}" -days 365 -notext -batch -md sha256 \
        -in "${csr}" -out "${crt}" 2>&1 ) | grep -E "(error|Error|certified|Data Base)" || true

    echo "[pki] verifying ${cn}..."
    openssl verify -CAfile "${INT}/certs/chain.crt" "${PKI}/${crt}"
    echo "[pki] ${cn} issued OK"
    echo "       key:  ${PKI}/${key}"
    echo "       cert: ${PKI}/${crt}"
}

cmd_server() { issue_cert server "${1:?usage: $0 server <CN>}"; }
cmd_client() { issue_cert client "${1:?usage: $0 client <CN>}"; }

cmd_revoke() {
    local cn="${1:?usage: $0 revoke <CN>}"
    local crt_path="intermediate/certs/${cn}.crt"
    if [ ! -f "${PKI}/${crt_path}" ]; then
        echo "[pki] no certificate for ${cn} at ${PKI}/${crt_path}"
        return 1
    fi
    ( cd "${PKI}" && openssl ca -config openssl.cnf -name CA_intermediate \
        -revoke "${crt_path}" 2>&1 ) | grep -E "(Revoking|Already|error)" || true
    echo "[pki] regenerating CRL after revocation..."
    cmd_crl
}

cmd_crl() {
    ( cd "${PKI}" && openssl ca -config openssl.cnf -name CA_intermediate -gencrl \
        -out intermediate/crl/intermediate.crl 2>/dev/null )
    local crl="${INT}/crl/intermediate.crl"
    echo "[pki] CRL regenerated at ${crl}"
    openssl crl -in "${crl}" -text -noout | grep -E "(Number|Update|Revoked|Serial)"
}

cmd_help() {
    cat <<EOF
Usage:
  $0 init                 # build root + intermediate CA (one-time)
  $0 server <CN>          # issue a server certificate
  $0 client <CN>          # issue a client certificate (one per agent)
  $0 revoke <CN>          # add to CRL by Common Name
  $0 crl                  # regenerate CRL (also done after revoke)
  $0 help

Layout produced (relative to mtls/pki/):
  root/certs/ca.crt              # root CA cert (long-lived; offline-only key)
  intermediate/certs/chain.crt   # intermediate || root, used by clients/servers
  intermediate/certs/<CN>.crt    # leaf certs
  intermediate/private/<CN>.key  # leaf private keys (chmod 400)
  intermediate/crl/intermediate.crl

Environment variables:
  BPAS_ROOT_PASS   passphrase for the root CA key (default: dev passphrase)
EOF
}

case "${CMD}" in
    init)    cmd_init ;;
    server)  shift; cmd_server "$@" ;;
    client)  shift; cmd_client "$@" ;;
    revoke)  shift; cmd_revoke "$@" ;;
    crl)     cmd_crl ;;
    help|*)  cmd_help ;;
esac
