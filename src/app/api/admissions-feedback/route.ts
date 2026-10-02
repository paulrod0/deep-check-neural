/**
 * POST /api/admissions-feedback
 * =============================
 * Submit user feedback on a verification result.
 * This feeds the learning system — over time, accumulated feedback
 * allows threshold calibration and ML model training.
 */

import { NextRequest, NextResponse } from 'next/server'
import { submitFeedback, getLearningStats } from '@/lib/verificationLog'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      verificationId?: string
      correct?: boolean
      expectedVerdict?: string
    }

    if (!body.verificationId || body.correct === undefined) {
      return NextResponse.json(
        { error: 'Missing verificationId or correct boolean' },
        { status: 400 },
      )
    }

    const ok = await submitFeedback(
      body.verificationId,
      body.correct,
      body.expectedVerdict,
    )

    if (!ok) {
      return NextResponse.json({ error: 'Failed to store feedback' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}

// GET /api/admissions-feedback — returns learning statistics
export async function GET() {
  const stats = await getLearningStats()
  if (!stats) {
    return NextResponse.json({ error: 'No stats available' }, { status: 500 })
  }
  return NextResponse.json(stats)
}
