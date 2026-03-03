/**
 * GET /api/health
 *
 * Docker HEALTHCHECK endpoint.
 * Returns 200 + JSON payload when the Next.js server is up.
 * Optionally probes Supabase/PostgREST connectivity so the orchestrator
 * knows the whole stack is ready, not just the Node process.
 */

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
    const start = Date.now()

    const status: {
        status: 'ok' | 'degraded'
        version: string
        deployMode: string
        uptime: number
        db?: 'ok' | 'error'
        latencyMs: number
    } = {
        status: 'ok',
        version: process.env.npm_package_version ?? '0.0.0',
        deployMode: process.env.NEXT_PUBLIC_DEPLOY_MODE ?? 'saas',
        uptime: Math.floor(process.uptime()),
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
                status.db = res.ok ? 'ok' : 'error'
                if (!res.ok) status.status = 'degraded'
            }
        } catch {
            status.db = 'error'
            status.status = 'degraded'
        }
    }

    status.latencyMs = Date.now() - start

    const httpStatus = status.status === 'ok' ? 200 : 503

    return NextResponse.json(status, { status: httpStatus })
}
