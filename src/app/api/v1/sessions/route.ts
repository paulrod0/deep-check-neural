/**
 * Deep-Check Public API v1 — Sessions
 *
 * GET  /api/v1/sessions          — List all sessions (paginated)
 * POST /api/v1/sessions          — Create a new session (from external platform)
 *
 * Authentication: Bearer token via Authorization header
 *   Authorization: Bearer dc_live_xxxx
 *
 * All responses follow: { success, data, error?, meta? }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAssessments, saveAssessment, validateApiKey, initDb } from '@/lib/db'

function unauthorized() {
    return NextResponse.json(
        { success: false, error: 'Invalid or missing API key. Pass Authorization: Bearer dc_live_...' },
        { status: 401 }
    )
}

function cors(res: NextResponse) {
    res.headers.set('Access-Control-Allow-Origin', '*')
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
    res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    return res
}

export async function OPTIONS() {
    return cors(new NextResponse(null, { status: 204 }))
}

export async function GET(req: NextRequest) {
    const apiKey = req.headers.get('authorization')?.replace('Bearer ', '').trim()
    if (!apiKey) return unauthorized()

    const keyRecord = await validateApiKey(apiKey)
    if (!keyRecord || !keyRecord.permissions.includes('read')) return unauthorized()

    await initDb()
    const all = await getAssessments()

    // Pagination
    const url = new URL(req.url)
    const page  = Math.max(1, parseInt(url.searchParams.get('page')  ?? '1'))
    const limit = Math.min(100, parseInt(url.searchParams.get('limit') ?? '20'))
    const status = url.searchParams.get('status')  // filter: passed|review|flagged
    const externalRef = url.searchParams.get('external_ref')

    let filtered = all
    if (status) filtered = filtered.filter(a => a.status === status)
    if (externalRef) filtered = filtered.filter(a => a.externalRef === externalRef)

    const total  = filtered.length
    const start  = (page - 1) * limit
    const paged  = filtered.slice(start, start + limit)

    // Strip base64 evidence images from API response (too large)
    const sanitized = paged.map(({ evidence, ...rest }) => ({
        ...rest,
        evidenceCount: evidence?.length ?? 0,
    }))

    return cors(NextResponse.json({
        success: true,
        data: sanitized,
        meta: { total, page, limit, pages: Math.ceil(total / limit) },
    }))
}

export async function POST(req: NextRequest) {
    const apiKey = req.headers.get('authorization')?.replace('Bearer ', '').trim()
    if (!apiKey) return unauthorized()

    const keyRecord = await validateApiKey(apiKey)
    if (!keyRecord || !keyRecord.permissions.includes('write')) return unauthorized()

    await initDb()

    try {
        const body = await req.json()
        const assessment = {
            ...body,
            id: body.id ?? Math.random().toString(36).substr(2, 9),
            date: body.date ?? new Date().toISOString().split('T')[0],
            alerts: body.alerts ?? [],
            evidence: body.evidence ?? [],
            lastEvent: body.lastEvent ?? 'Created via API',
        }
        await saveAssessment(assessment)
        return cors(NextResponse.json({ success: true, data: { id: assessment.id } }, { status: 201 }))
    } catch {
        return cors(NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 }))
    }
}
