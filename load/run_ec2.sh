#!/usr/bin/env bash
# Run the Deep-Check load test against the EC2 ML Worker (no Vercel).
#
# Usage:
#   bash load/run_ec2.sh                          # defaults to 18.201.230.25:8445
#   HOST=1.2.3.4 PORT=9000 bash load/run_ec2.sh   # override

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TS="$(date +%Y%m%d_%H%M%S)"
HOST="${HOST:-18.201.230.25}"
PORT="${PORT:-8445}"
IMAGE="${IMAGE:-${HERE}/fixtures/face.jpg}"

[ -f "$IMAGE" ] || { echo "image fixture missing: $IMAGE" >&2; exit 1; }

mkdir -p "${HERE}/results" "${HERE}/report"
JTL="${HERE}/results/ec2_${TS}.jtl"
RPT="${HERE}/report/ec2_${TS}"

# Detect dashboard + add flag only when InfluxDB is up
INFLUX_FLAG=""
if curl -fsS -m 2 http://localhost:8086/ping >/dev/null 2>&1; then
    INFLUX_FLAG="-Jinflux_url=http://localhost:8086/write?db=jmeter"
    echo "[jmeter] InfluxDB detected — live dashboard at http://localhost:3001"
else
    echo "[jmeter] no InfluxDB — static HTML only"
fi

echo "[jmeter] target ${HOST}:${PORT}"
jmeter -n \
    -t "${HERE}/deep-check-load-ec2.jmx" \
    -l "${JTL}" \
    -e -o "${RPT}" \
    -Jhost="${HOST}" \
    -Jport="${PORT}" \
    -Jimage="${IMAGE}" \
    ${INFLUX_FLAG}

echo
echo "[jmeter] done"
echo "  jtl:    ${JTL}"
echo "  report: ${RPT}/index.html"
