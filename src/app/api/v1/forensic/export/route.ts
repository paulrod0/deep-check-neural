/**
 * GET /api/v1/forensic/export?chainId=xxx
 *
 * Export a full chain of custody as a self-contained JSON bundle.
 * Used when handing evidence to lawyers, courts, or auditors.
 * Public endpoint — knowing the chainId is the access control.
 *
 * Returns: application/json bundle with all entries, hashes, TSA tokens,
 * and verification status.
 */
import { NextRequest, NextResponse } from 'next/server'
import { exportChain } from '@/lib/forensicChain'

export async function GET(req: NextRequest) {
  const chainId = req.nextUrl.searchParams.get('chainId')
  if (!chainId) {
    return NextResponse.json({ error: 'missing_chainId' }, { status: 400 })
  }
  try {
    const bundle = await exportChain(chainId)
    return NextResponse.json(bundle, {
      headers: {
        'Content-Disposition': `attachment; filename="forensic_chain_${chainId}.json"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'export_failed', message: msg }, { status: 500 })
  }
}

export const runtime = 'nodejs'
