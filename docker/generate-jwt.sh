#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# generate-jwt.sh  —  Create PostgREST-compatible JWT tokens
#
# Usage:
#   chmod +x docker/generate-jwt.sh
#   ./docker/generate-jwt.sh
#
# Requires:  openssl  (standard on macOS/Linux)
# Produces:  PGRST_JWT_SECRET, PGRST_JWT_ANON_KEY, PGRST_JWT_SERVICE_KEY
#            ready to paste into .env.onpremise
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── 1. Generate a 64-byte (512-bit) random secret ────────────────────────────
SECRET=$(openssl rand -base64 64 | tr -d '\n')
echo ""
echo "PGRST_JWT_SECRET=${SECRET}"
echo ""

# ── 2. Helper: base64url-encode without padding ──────────────────────────────
b64url() {
  printf '%s' "$1" | base64 | tr '+/' '-_' | tr -d '='
}

# ── 3. Build JWT (header.payload.signature) ───────────────────────────────────
make_jwt() {
  local role="$1"
  local exp_offset="${2:-315360000}"   # default: 10 years in seconds

  local header
  header=$(b64url '{"alg":"HS256","typ":"JWT"}')

  local exp
  exp=$(( $(date +%s) + exp_offset ))

  local payload
  payload=$(b64url "{\"role\":\"${role}\",\"iss\":\"deep-check\",\"iat\":$(date +%s),\"exp\":${exp}}")

  local sig_input="${header}.${payload}"
  local sig
  sig=$(printf '%s' "${sig_input}" | \
    openssl dgst -sha256 -hmac "${SECRET}" -binary | \
    base64 | tr '+/' '-_' | tr -d '=')

  printf '%s' "${sig_input}.${sig}"
}

ANON_JWT=$(make_jwt "deepcheck_anon")
SERVICE_JWT=$(make_jwt "service_role")

echo "PGRST_JWT_ANON_KEY=${ANON_JWT}"
echo ""
echo "PGRST_JWT_SERVICE_KEY=${SERVICE_JWT}"
echo ""
echo "# ── Copy the three lines above into your .env.onpremise file ──────────"
