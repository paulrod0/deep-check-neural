/**
 * GET /api/health/tsa
 *
 * Probes the configured Time Stamp Authority (TSA) and reports:
 *   - reachable: did it respond at all
 *   - qualified: is the TSA hostname on the eIDAS QTSP allowlist
 *     (see QUALIFIED_TSP_HOSTS in src/lib/forensicChain.ts)
 *   - latencyMs: round-trip time
 *   - tokenBytes: size of the returned RFC 3161 token (sanity check)
 *
 * Used to verify that switching TSA_URL to a Qualified TSP (e.g. ACCV,
 * FNMT) actually works in production before marking it as qualified in
 * customer-facing reports.
 *
 * Public endpoint, but does not expose secrets — only the configured
 * TSA URL (which is operational metadata, not a credential).
 *
 * NOTE: this issues a real network request to the TSA each time it is
 * called. If you put it behind a load balancer health check, set the
 * probe interval to >= 60s to avoid hammering the TSA.
 */

import { NextResponse } from 'next/server'
import { isQualifiedTSP, requestTimestampDetailed } from '@/lib/forensicChain'
import { createHash } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const tsaUrl = process.env.TSA_URL ?? 'https://freetsa.org/tsr'
  const qualified = isQualifiedTSP(tsaUrl)

  // Probe the TSA with a throwaway hash so we don't pollute any chain.
  const probeHash = createHash('sha256')
    .update('deep-check-tsa-health-' + Date.now().toString())
    .digest('hex')

  const t0 = Date.now()
  let result
  try {
    result = await requestTimestampDetailed(probeHash)
  } catch (e) {
    return NextResponse.json(
      {
        status: 'degraded',
        tsaUrl,
        qualified,
        reachable: false,
        error: e instanceof Error ? e.message : 'unknown',
        latencyMs: Date.now() - t0,
      },
      { status: 503 }
    )
  }
  const latencyMs = Date.now() - t0

  const reachable = result.token !== null
  // tokenBytes counts the base64-decoded length so it matches what callers
  // store in dc_forensic_chain.tsa_token (which is base64-encoded).
  const tokenBytes = result.token
    ? Math.floor((result.token.length * 3) / 4)
    : 0

  return NextResponse.json(
    {
      status: reachable ? 'ok' : 'degraded',
      tsaUrl: result.tsaUrl,
      qualified: result.qualified,
      reachable,
      latencyMs,
      tokenBytes,
      // Plain English explanation so non-engineers reading this in the
      // Vercel logs (or in the customer pilot report) can interpret it.
      interpretation: !reachable
        ? 'TSA did not return a timestamp token. Chain entries will record `tsaToken: null`. Set TSA_REQUIRED=true to fail-closed instead.'
        : result.qualified
          ? 'TSA is on the eIDAS Qualified Trust Service Providers allowlist. Timestamps carry qualified legal weight.'
          : 'TSA returned a valid RFC 3161 token but the hostname is NOT on the eIDAS QTSP allowlist. Timestamps are valid for integrity but not "qualified" under eIDAS Art. 42. To upgrade, set TSA_URL to a qualified TSP (e.g. http://tss.accv.es:8318/tsa).',
    },
    { status: reachable ? 200 : 503 }
  )
}
