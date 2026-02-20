/**
 * Deep-Check — Public Certificate Verification API
 *
 * GET /api/verify?id=SESSION_ID&hash=SHA256_HASH
 *
 * Public endpoint — no API key required.
 * Verifies that a session certificate is authentic and unmodified.
 *
 * Returns:
 *   valid: true/false
 *   match: whether the provided hash matches the stored session hash
 *   session: sanitized session metadata (no evidence images)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAssessmentById, initDb } from '@/lib/db'
import crypto from 'crypto'

function cors(res: NextResponse) {
    res.headers.set('Access-Control-Allow-Origin', '*')
    res.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type')
    return res
}

export async function OPTIONS() {
    return cors(new NextResponse(null, { status: 204 }))
}

export async function GET(req: NextRequest) {
    await initDb()
    const { searchParams } = new URL(req.url)
    const id   = searchParams.get('id')
    const hash = searchParams.get('hash')

    if (!id) {
        return cors(NextResponse.json({
            valid: false,
            error: 'Missing session ID. Use ?id=SESSION_ID',
        }, { status: 400 }))
    }

    const assessment = await getAssessmentById(id)

    if (!assessment) {
        return cors(NextResponse.json({
            valid: false,
            verified: false,
            error: 'Session not found. The certificate ID may be incorrect or the session may have been deleted.',
        }, { status: 404 }))
    }

    // Recompute expected hash from stored data
    const expectedPayload = JSON.stringify({
        id: assessment.id,
        candidateName: assessment.candidateName,
        role: assessment.role,
        date: assessment.date,
        score: assessment.score,
        status: assessment.status,
        alertCount: assessment.alerts?.length ?? 0,
        keystrokeCount: assessment.keystrokeCount,
        aiRisk: assessment.aiRisk,
        tabSwitchCount: assessment.tabSwitchCount,
        gazeEventCount: assessment.gazeEventCount,
        livenessScore: assessment.livenessScore,
        identityMatchScore: assessment.identityMatchScore,
    })
    const expectedHash = crypto.createHash('sha256').update(expectedPayload).digest('hex')

    // Hash verification
    let hashMatch: boolean | null = null
    if (hash) {
        hashMatch = hash.toLowerCase() === expectedHash.toLowerCase()
    } else if (assessment.sessionHash) {
        // If no hash provided, compare stored hash against recomputed
        hashMatch = assessment.sessionHash.toLowerCase() === expectedHash.toLowerCase()
    }

    const isValid = assessment.status !== undefined
    const isPassed = assessment.status === 'passed'
    const isFlagged = assessment.status === 'flagged'

    // Return sanitized session data (no evidence images, no full alerts)
    return cors(NextResponse.json({
        valid: isValid,
        verified: hashMatch ?? null,
        hashMatch,
        integrity: {
            storedHash: assessment.sessionHash ?? null,
            expectedHash,
            tampered: hashMatch === false,
        },
        session: {
            id: assessment.id,
            candidateName: assessment.candidateName,
            role: assessment.role,
            date: assessment.date,
            score: assessment.score,
            status: assessment.status,
            livenessScore: assessment.livenessScore ?? null,
            aiRisk: assessment.aiRisk ?? null,
            keystrokeCount: assessment.keystrokeCount ?? null,
            tabSwitchCount: assessment.tabSwitchCount ?? null,
            gazeEventCount: assessment.gazeEventCount ?? null,
            identityMatchScore: assessment.identityMatchScore ?? null,
            alertCount: assessment.alerts?.length ?? 0,
            evidenceCount: assessment.evidence?.length ?? 0,
            certificateIssued: assessment.certificateIssued ?? false,
            autoFlagged: assessment.autoFlagged ?? false,
        },
        verdict: isFlagged
            ? 'FAILED — This session was flagged for suspicious activity.'
            : isPassed
                ? 'PASSED — This session meets integrity requirements.'
                : 'UNDER REVIEW — This session is pending manual review.',
    }))
}
