/**
 * GET /api/verifications
 * ======================
 * List KYC identity verification records from dc_document_analyses.
 *
 * Query params:
 *   - limit     (default 50, max 200)
 *   - offset    (default 0)
 *   - verdict   (filter: authentic | suspicious | tampered)
 *   - search    (search by holder name, doc number, certificate ID)
 *   - from/to   (ISO date range filter)
 *   - sort      (field: created_at | risk_score | verdict)
 *   - order     (asc | desc, default desc)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { validateAdminSession } from '@/lib/adminAuth'

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!await validateAdminSession(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sp = req.nextUrl.searchParams

  const limit   = Math.min(Number(sp.get('limit'))  || 50, 200)
  const offset  = Number(sp.get('offset')) || 0
  const verdict = sp.get('verdict')  // authentic | suspicious | tampered
  const search  = sp.get('search')?.trim()
  const from    = sp.get('from')
  const to      = sp.get('to')
  const sort    = sp.get('sort')  || 'created_at'
  const order   = sp.get('order') || 'desc'

  try {
    const supabase = getClient()

    let query = supabase
      .from('dc_document_analyses')
      .select('id, created_at, filename, risk_score, risk_level, findings, alerts, case_ref', { count: 'exact' })
      .eq('case_ref', 'identity_verification')

    // Verdict filter (stored in findings.verdict)
    if (verdict && ['authentic', 'suspicious', 'tampered'].includes(verdict)) {
      query = query.filter('findings->>verdict', 'eq', verdict)
    }

    // Date range
    if (from) query = query.gte('created_at', from)
    if (to)   query = query.lte('created_at', to)

    // Search (certificate ID or ILIKE on findings)
    if (search) {
      // Search by ID prefix or holder name in findings
      query = query.or(`id.ilike.%${search}%,filename.ilike.%${search}%`)
    }

    // Sorting
    const validSortCols = ['created_at', 'risk_score'] as const
    const sortCol = validSortCols.includes(sort as typeof validSortCols[number])
      ? sort
      : 'created_at'
    query = query.order(sortCol, { ascending: order === 'asc' })

    // Pagination
    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query

    if (error) {
      console.error('[verifications] DB error:', error.message)
      return NextResponse.json({ error: 'Failed to fetch verifications' }, { status: 500 })
    }

    // Transform for frontend
    const verifications = (data ?? []).map(row => {
      const findings = (row.findings ?? {}) as Record<string, unknown>
      const mrzFields = (findings.mrzFields ?? {}) as Record<string, string>

      return {
        id:            row.id,
        createdAt:     row.created_at,
        verdict:       (findings.verdict as string) || 'unknown',
        documentType:  (findings.documentType as string) || 'unknown',
        holderName:    mrzFields.givenNames
          ? `${mrzFields.givenNames} ${mrzFields.surname || ''}`.trim()
          : null,
        nationality:   mrzFields.nationality || null,
        docNumber:     mrzFields.docNumber || null,
        dateOfBirth:   mrzFields.dob || null,
        expiryDate:    mrzFields.expiry || null,
        isExpired:     Boolean(mrzFields.isExpired),
        riskScore:     row.risk_score,
        riskLevel:     row.risk_level,
        mrzValid:      findings.mrzValid as boolean | null,
        faceQuality:   (findings.faceQualityScore as number) ?? null,
        ocrMode:       (findings.ocrMode as string) || null,
        onPremise:     Boolean(findings.onPremise),
        countryInfo:   findings.countryInfo || null,
        countryValidation: findings.countryValidation || null,
        alertCount:    Array.isArray(row.alerts) ? row.alerts.length : 0,
      }
    })

    // Summary stats
    const stats = {
      total:      count ?? 0,
      authentic:  verifications.filter(v => v.verdict === 'authentic').length,
      suspicious: verifications.filter(v => v.verdict === 'suspicious').length,
      tampered:   verifications.filter(v => v.verdict === 'tampered').length,
    }

    return NextResponse.json({
      verifications,
      stats,
      pagination: {
        total:  count ?? 0,
        limit,
        offset,
        hasMore: (count ?? 0) > offset + limit,
      },
    })
  } catch (err) {
    console.error('[verifications] Error:', (err as Error).message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
