/**
 * Deep-Check Public API v1 — Enrollment
 *
 * POST /api/v1/enroll   — Save a biometric profile from enrollment session
 * GET  /api/v1/enroll   — Get profile by email (query: ?email=)
 */

import { NextRequest, NextResponse } from 'next/server'
import {
    validateApiKey,
    saveEnrollmentProfile,
    getProfileByEmail,
    EnrollmentProfile,
    KeystrokeProfile,
} from '@/lib/db'
import crypto from 'crypto'

function cors(res: NextResponse) {
    res.headers.set('Access-Control-Allow-Origin', '*')
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    return res
}
function unauthorized() {
    return cors(NextResponse.json({ success: false, error: 'Invalid or missing API key' }, { status: 401 }))
}

export async function OPTIONS() {
    return cors(new NextResponse(null, { status: 204 }))
}

export async function GET(req: NextRequest) {
    const apiKey = req.headers.get('authorization')?.replace('Bearer ', '').trim()
    if (!apiKey) return unauthorized()
    const keyRecord = await validateApiKey(apiKey)
    if (!keyRecord || !keyRecord.permissions.includes('read')) return unauthorized()

    const email = new URL(req.url).searchParams.get('email')
    if (!email) {
        return cors(NextResponse.json({ success: false, error: 'email query param required' }, { status: 400 }))
    }

    const profile = await getProfileByEmail(email)
    if (!profile) {
        return cors(NextResponse.json({ success: false, error: 'No active enrollment profile found' }, { status: 404 }))
    }

    // Return profile without raw biometric data (just metadata)
    const { profile: rawProfile, ...meta } = profile
    return cors(NextResponse.json({
        success: true,
        data: {
            ...meta,
            sampleSize: rawProfile.sampleSize,
            context: profile.context,
            expiresAt: profile.expiresAt,
        }
    }))
}

export async function POST(req: NextRequest) {
    const apiKey = req.headers.get('authorization')?.replace('Bearer ', '').trim()
    if (!apiKey) return unauthorized()
    const keyRecord = await validateApiKey(apiKey)
    if (!keyRecord || !keyRecord.permissions.includes('write')) return unauthorized()

    try {
        const body = await req.json()
        const {
            candidateName,
            candidateEmail,
            context = 'prose_es',
            profile,
        }: {
            candidateName: string
            candidateEmail: string
            context: EnrollmentProfile['context']
            profile: KeystrokeProfile
        } = body

        if (!candidateName || !candidateEmail || !profile) {
            return cors(NextResponse.json(
                { success: false, error: 'candidateName, candidateEmail, and profile are required' },
                { status: 400 }
            ))
        }

        if (profile.sampleSize < 50) {
            return cors(NextResponse.json(
                { success: false, error: 'Enrollment requires at least 50 keystrokes' },
                { status: 422 }
            ))
        }

        const now = new Date()
        const expires = new Date(now)
        expires.setDate(expires.getDate() + 90)

        const enrollmentHash = crypto
            .createHash('sha256')
            .update(JSON.stringify(profile))
            .digest('hex')

        const enrollmentProfile: EnrollmentProfile = {
            id: `ep_${crypto.randomBytes(12).toString('hex')}`,
            candidateName,
            candidateEmail,
            context,
            createdAt: now.toISOString(),
            expiresAt: expires.toISOString(),
            profile,
            enrollmentHash,
        }

        await saveEnrollmentProfile(enrollmentProfile)

        return cors(NextResponse.json({
            success: true,
            data: {
                id: enrollmentProfile.id,
                expiresAt: enrollmentProfile.expiresAt,
                enrollmentHash,
                sampleSize: profile.sampleSize,
                context,
            }
        }, { status: 201 }))

    } catch {
        return cors(NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 }))
    }
}
