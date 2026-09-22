# Deep-Check Load Dashboard — Grafana + InfluxDB live

## Setup (una vez)

```bash
cd load/dashboard
docker compose up -d
```

Espera ~20 s hasta que los dos contenedores estén ready.

- **Grafana**: http://localhost:3001 — user `admin` / pass `admin`
  (la datasource y el dashboard vienen provisioneados)
- **InfluxDB**: http://localhost:8086

## Lanzar el test con dashboard en vivo

```bash
# En una terminal, deja abierto Grafana: http://localhost:3001
# En otra terminal:
export DC_API_KEY=dc_live_xxxxxxxxxxxxxxxxxxxx

jmeter -n \
    -t load/deep-check-load.jmx \
    -l load/results/$(date +%Y%m%d_%H%M%S).jtl \
    -e -o load/report/$(date +%Y%m%d_%H%M%S) \
    -Jhost=deep-check-two.vercel.app \
    -Japi_key=$DC_API_KEY \
    -Jimage=load/fixtures/face.jpg \
    -Jpdf=load/fixtures/doc.pdf \
    -Jinflux_url=http://localhost:8086/write?db=jmeter
```

El flag ``-Jinflux_url`` activa el Backend Listener. Con cada sample,
JMeter manda métricas a InfluxDB y Grafana las dibuja en 1-2 segundos.

## Qué verás en el dashboard

- **Active users**: threads activos en cada momento
- **Req/s**: throughput sostenido
- **Error %**: % de samples con status != 200 o assertion fallida
- **p95 latency**: p95 global
- **Response times by transaction**: p50/p95/p99 de cada endpoint por separado
- **Throughput**: hits/s desglosado por transaction
- **Errors**: barras rojas con errores en el tiempo

Auto-refresh cada 5 s. Ventana por defecto: últimos 5 min.

## Parar

```bash
cd load/dashboard
docker compose down            # para los contenedores, conserva datos
docker compose down -v         # borra los datos también
```

## Datos persistentes

Mientras no ejecutes ``docker compose down -v``, los datos de InfluxDB
quedan guardados en el volume ``influx-data`` y puedes comparar runs
históricos modificando la ventana temporal de Grafana.
