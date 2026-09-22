#!/usr/bin/env bash
# Run the Deep-Check JMeter load test plan with per-run output folders.
#
# Usage:
#   bash load/run.sh dev       # http://localhost:3000, no auth
#   bash load/run.sh prod      # https://deep-check-two.vercel.app, needs DC_API_KEY
#
# Produces:
#   load/results/<timestamp>.jtl     CSV of every sample
#   load/report/<timestamp>/         HTML dashboard with charts

set -euo pipefail

ENV_NAME="${1:-prod}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TS="$(date +%Y%m%d_%H%M%S)"

case "$ENV_NAME" in
    dev)
        HOST="localhost:3000"
        API_KEY="dev"
        ;;
    prod)
        HOST="deep-check-two.vercel.app"
        API_KEY="${DC_API_KEY:?Set DC_API_KEY=dc_live_... before running prod}"
        ;;
    *)
        echo "usage: $0 {dev|prod}" >&2
        exit 1
        ;;
esac

IMAGE="${HERE}/fixtures/face.jpg"
PDF="${HERE}/fixtures/doc.pdf"

for f in "$IMAGE" "$PDF"; do
    [ -f "$f" ] || { echo "fixture missing: $f — place a real file there" >&2; exit 1; }
done

mkdir -p "${HERE}/results" "${HERE}/report"
JTL="${HERE}/results/${ENV_NAME}_${TS}.jtl"
RPT="${HERE}/report/${ENV_NAME}_${TS}"

echo "[jmeter] host=${HOST} ts=${TS}"

# If the InfluxDB dashboard is up (http://localhost:8086 responds), stream
# metrics to it for the live Grafana dashboard at http://localhost:3001.
INFLUX_FLAG=""
if curl -fsS -m 2 http://localhost:8086/ping >/dev/null 2>&1; then
    INFLUX_FLAG="-Jinflux_url=http://localhost:8086/write?db=jmeter"
    echo "[jmeter] InfluxDB detected — streaming live to Grafana at http://localhost:3001"
else
    echo "[jmeter] no InfluxDB — running with static HTML report only"
    echo "         (to enable live dashboard: cd load/dashboard && docker compose up -d)"
fi

jmeter -n \
    -t "${HERE}/deep-check-load.jmx" \
    -l "${JTL}" \
    -e -o "${RPT}" \
    -Jhost="${HOST}" \
    -Japi_key="${API_KEY}" \
    -Jimage="${IMAGE}" \
    -Jpdf="${PDF}" \
    ${INFLUX_FLAG}

echo "[jmeter] done"
echo "  results: ${JTL}"
echo "  report:  ${RPT}/index.html"
