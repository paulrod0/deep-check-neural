/**
 * GET /api/health
 *
 * Docker HEALTHCHECK endpoint.
 * Returns 200 + JSON payload when the Next.js server is up.
 * Optionally probes Supabase/PostgREST connectivity so the orchestrator
 * knows the whole stack is ready, not just the Node process.
 *
 * Note: Does NOT expose version, deploy mode, or uptime to avoid fingerprinting.
 */

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
    const start = Date.now()

    const result: {
        status: 'ok' | 'degraded'
        db?: 'ok' | 'error'
        latencyMs: number
    } = {
        status: 'ok',
        latencyMs: 0,
    }

    // Optional DB probe — only in on-premise mode to avoid hammering Supabase
    if (process.env.NEXT_PUBLIC_DEPLOY_MODE === 'onpremise') {
        try {
            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
            if (supabaseUrl) {
                const res = await fetch(`${supabaseUrl}/`, {
                    signal: AbortSignal.timeout(3000),
                })
                result.db = res.ok ? 'ok' : 'error'
                if (!res.ok) result.status = 'degraded'
            }
        } catch {
            result.db = 'error'
            result.status = 'degraded'
        }
    }

    result.latencyMs = Date.now() - start

    const httpStatus = result.status === 'ok' ? 200 : 503

    return NextResponse.json(result, { status: httpStatus })
}
