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

        // Minimum 150 real keystrokes — below this the flightMean stdDev is
        // too small (< 15ms) and the Mahalanobis distance becomes meaningless.
        if (profile.sampleSize < 150) {
            return NextResponse.json(
                { success: false, error: `Se necesitan al menos 150 pulsaciones para un perfil fiable. Recibidas: ${profile.sampleSize}.` },
                { status: 422 }
            )
        }

        // Basic sanity checks — catch enrollment made under unusual conditions
        if (profile.flightMean < 30 || profile.flightMean > 1200) {
            return NextResponse.json(
                { success: false, error: 'El perfil tiene tiempos de vuelo fuera del rango humano. Inténtalo de nuevo escribiendo a un ritmo normal.' },
                { status: 422 }
            )
        }
        if (profile.flightStd < 5) {
            return NextResponse.json(
                { success: false, error: 'El ritmo de escritura es demasiado uniforme. Escribe de forma natural, no a un ritmo constante.' },
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
    } catch (e: any) {
        console.error('[/api/enrollment] Error:', e?.message ?? e)
        return NextResponse.json(
            { success: false, error: e?.message ?? 'Error interno del servidor' },
            { status: 500 }
        )
    }
}
