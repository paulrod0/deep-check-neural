/**
 * Internal enrollment endpoint — saves biometric profile from /enroll page
 */

import { NextRequest, NextResponse } from 'next/server'
import { saveEnrollmentProfile, EnrollmentProfile, KeystrokeProfile } from '@/lib/db'
import crypto from 'crypto'

export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const { candidateName, candidateEmail, context = 'prose_es', profile }: {
            candidateName: string
            candidateEmail: string
            context: EnrollmentProfile['context']
            profile: KeystrokeProfile
        } = body

        if (!candidateName || !candidateEmail || !profile) {
            return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 })
        }

        if (profile.sampleSize < 50) {
            return NextResponse.json(
                { success: false, error: `Need at least 50 keystrokes. Got ${profile.sampleSize}.` },
                { status: 422 }
            )
        }

        const now = new Date()
        const expires = new Date(now)
        expires.setDate(expires.getDate() + 90)

        const enrollmentHash = crypto.createHash('sha256').update(JSON.stringify(profile)).digest('hex')

        const ep: EnrollmentProfile = {
            id: `ep_${crypto.randomBytes(12).toString('hex')}`,
            candidateName,
            candidateEmail,
            context,
            createdAt: now.toISOString(),
            expiresAt: expires.toISOString(),
            profile,
            enrollmentHash,
        }

        await saveEnrollmentProfile(ep)

        return NextResponse.json({
            success: true,
            profileId: ep.id,
            expiresAt: ep.expiresAt,
            enrollmentHash,
        })
    } catch (e) {
        return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
    }
}
