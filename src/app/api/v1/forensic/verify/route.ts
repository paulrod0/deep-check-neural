/**
 * GET /api/v1/forensic/verify?chainId=xxx
 *
 * Verifies the cryptographic integrity of a chain of custody.
 * Public endpoint (no auth) — enables any third party (court, opposing counsel,
 * auditor) to independently validate an informe pericial.
 *
 * Returns: { chainId, valid, breaks, entries, standard }
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyChain, exportChain } from '@/lib/forensicChain'

export async function GET(req: NextRequest) {
  const chainId = req.nextUrl.searchParams.get('chainId')
  if (!chainId) {
    return NextResponse.json({ error: 'missing_chainId' }, { status: 400 })
  }

  try {
    const verification = await verifyChain(chainId)
    const bundle = await exportChain(chainId)
    return NextResponse.json({
      ok: true,
      chainId,
      valid: verification.valid,
      breaks: verification.breaks,
      chainLength: bundle.entries.length,
      firstEntry: bundle.entries[0] ?? null,
      lastEntry: bundle.entries[bundle.entries.length - 1] ?? null,
      exportedAt: bundle.exportedAt,
      standard: bundle.standard,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'verify_failed', message: msg }, { status: 500 })
  }
}

export const runtime = 'nodejs'
