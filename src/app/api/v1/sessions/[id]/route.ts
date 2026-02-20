/**
 * Deep-Check Public API v1 — Single Session
 *
 * GET   /api/v1/sessions/:id   — Retrieve full session details
 * PATCH /api/v1/sessions/:id   — Update status / add review note
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAssessmentById, saveAssessment, validateApiKey } from '@/lib/db'

function unauthorized() {
    return NextResponse.json({ success: false, error: 'Invalid or missing API key' }, { status: 401 })
}
function cors(res: NextResponse) {
    res.headers.set('Access-Control-Allow-Origin', '*')
    res.headers.set('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS')
    res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    return res
}

export async function OPTIONS() {
    return cors(new NextResponse(null, { status: 204 }))
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const apiKey = req.headers.get('authorization')?.replace('Bearer ', '').trim()
    if (!apiKey) return unauthorized()

    const keyRecord = await validateApiKey(apiKey)
    if (!keyRecord || !keyRecord.permissions.includes('read')) return unauthorized()

    const { id } = await params
    const assessment = await getAssessmentById(id)
    if (!assessment) {
        return cors(NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 }))
    }

    // Optionally include evidence if explicitly requested
    const url = new URL(req.url)
    const includeEvidence = url.searchParams.get('include_evidence') === 'true'
    const data = includeEvidence ? assessment : (() => {
        const { evidence, ...rest } = assessment
        return { ...rest, evidenceCount: evidence?.length ?? 0 }
    })()

    return cors(NextResponse.json({ success: true, data }))
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const apiKey = req.headers.get('authorization')?.replace('Bearer ', '').trim()
    if (!apiKey) return unauthorized()

    const keyRecord = await validateApiKey(apiKey)
    if (!keyRecord || !keyRecord.permissions.includes('write')) return unauthorized()

    const { id } = await params
    const assessment = await getAssessmentById(id)
    if (!assessment) {
        return cors(NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 }))
    }

    const { status, reviewNote, externalRef } = await req.json()

    if (status && !['passed', 'review', 'flagged'].includes(status)) {
        return cors(NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 }))
    }

    if (status) assessment.status = status
    if (externalRef) assessment.externalRef = externalRef
    if (reviewNote) {
        const note = `[API Review ${new Date().toLocaleTimeString()}] ${reviewNote}`
        assessment.alerts = [note, ...(Array.isArray(assessment.alerts) ? assessment.alerts : [])]
    }

    await saveAssessment(assessment)
    return cors(NextResponse.json({ success: true, data: assessment }))
}
