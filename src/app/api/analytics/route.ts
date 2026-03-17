/**
 * GET /api/analytics
 * ==================
 * Returns KYC verification analytics including:
 *   - Daily verification volume (last 30 days)
 *   - Verdict breakdown
 *   - Risk distribution histogram
 *   - Country heatmap data
 *   - Document type breakdown
 *   - Documents expiring soon
 *   - Average processing metrics
 *
 * Used by the Analytics Dashboard.
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

  const days = Number(req.nextUrl.searchParams.get('days')) || 30

  try {
    const supabase = getClient()
    const since = new Date(Date.now() - days * 86400_000).toISOString()

    // Fetch all KYC verifications in the period
    const { data: analyses, error } = await supabase
      .from('dc_document_analyses')
      .select('id, created_at, risk_score, risk_level, findings, alerts')
      .eq('case_ref', 'identity_verification')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(2000)

    if (error) {
      console.error('[analytics] DB error:', error.message)
      return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 })
    }

    const rows = analyses ?? []

    // ── Daily volume ──────────────────────────────────────────────────────────
    const dailyVolume: Record<string, { total: number; authentic: number; suspicious: number; tampered: number }> = {}
    for (let d = 0; d < days; d++) {
      const date = new Date(Date.now() - d * 86400_000).toISOString().split('T')[0]
      dailyVolume[date] = { total: 0, authentic: 0, suspicious: 0, tampered: 0 }
    }

    // ── Aggregations ──────────────────────────────────────────────────────────
    let totalAuthentic = 0, totalSuspicious = 0, totalTampered = 0
    const riskBuckets = Array(10).fill(0) // 0-9, 10-19, ..., 90-100
    const countryMap: Record<string, { count: number; authentic: number; suspicious: number; tampered: number }> = {}
    const docTypeMap: Record<string, number> = {}
    const expiringSoon: Array<{ id: string; holderName: string; expiryDate: string; daysUntilExpiry: number; nationality: string }> = []
    let totalRisk = 0

    for (const row of rows) {
      const findings = (row.findings ?? {}) as Record<string, unknown>
      const verdict = findings.verdict as string
      const mrzFields = (findings.mrzFields ?? {}) as Record<string, string>
      const countryInfo = findings.countryInfo as { name: string; region: string } | null
      const docType = (findings.documentType as string) || 'unknown'
      const date = new Date(row.created_at).toISOString().split('T')[0]

      // Daily volume
      if (dailyVolume[date]) {
        dailyVolume[date].total++
        if (verdict === 'authentic') dailyVolume[date].authentic++
        else if (verdict === 'suspicious') dailyVolume[date].suspicious++
        else if (verdict === 'tampered') dailyVolume[date].tampered++
      }

      // Verdict totals
      if (verdict === 'authentic') totalAuthentic++
      else if (verdict === 'suspicious') totalSuspicious++
      else if (verdict === 'tampered') totalTampered++

      // Risk distribution
      const bucket = Math.min(9, Math.floor(row.risk_score / 10))
      riskBuckets[bucket]++
      totalRisk += row.risk_score

      // Country breakdown
      const countryName = countryInfo?.name || mrzFields.nationality || 'Unknown'
      if (!countryMap[countryName]) {
        countryMap[countryName] = { count: 0, authentic: 0, suspicious: 0, tampered: 0 }
      }
      countryMap[countryName].count++
      if (verdict === 'authentic') countryMap[countryName].authentic++
      else if (verdict === 'suspicious') countryMap[countryName].suspicious++
      else if (verdict === 'tampered') countryMap[countryName].tampered++

      // Document type
      docTypeMap[docType] = (docTypeMap[docType] || 0) + 1

      // Expiry check
      if (mrzFields.expiry) {
        const expiryStr = mrzFields.expiry
        // Parse YYMMDD format
        let expiryDate: Date | null = null
        if (/^\d{6}$/.test(expiryStr)) {
          const yy = parseInt(expiryStr.slice(0, 2))
          const mm = parseInt(expiryStr.slice(2, 4)) - 1
          const dd = parseInt(expiryStr.slice(4, 6))
          const year = yy > 50 ? 1900 + yy : 2000 + yy
          expiryDate = new Date(year, mm, dd)
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(expiryStr)) {
          expiryDate = new Date(expiryStr)
        }

        if (expiryDate) {
          const daysUntilExpiry = Math.floor((expiryDate.getTime() - Date.now()) / 86400_000)
          if (daysUntilExpiry >= 0 && daysUntilExpiry <= 90) {
            const holderName = mrzFields.givenNames
              ? `${mrzFields.givenNames} ${mrzFields.surname || ''}`.trim()
              : 'Unknown'
            expiringSoon.push({
              id: row.id,
              holderName,
              expiryDate: expiryDate.toISOString().split('T')[0],
              daysUntilExpiry,
              nationality: mrzFields.nationality || '',
            })
          }
        }
      }
    }

    // Sort expiring soon by days until expiry
    expiringSoon.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)

    // Build sorted daily volume array
    const dailyVolumeArr = Object.entries(dailyVolume)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => ({ date, ...vals }))

    // Country heatmap (sorted by count)
    const countryHeatmap = Object.entries(countryMap)
      .sort(([, a], [, b]) => b.count - a.count)
      .map(([country, data]) => ({ country, ...data }))

    // Document types (sorted by count)
    const documentTypes = Object.entries(docTypeMap)
      .sort(([, a], [, b]) => b - a)
      .map(([type, count]) => ({ type, count }))

    return NextResponse.json({
      period: { days, since, until: new Date().toISOString() },
      summary: {
        totalVerifications: rows.length,
        authentic: totalAuthentic,
        suspicious: totalSuspicious,
        tampered: totalTampered,
        authenticRate: rows.length > 0 ? Math.round((totalAuthentic / rows.length) * 100) : 0,
        avgRiskScore: rows.length > 0 ? Math.round(totalRisk / rows.length) : 0,
        uniqueCountries: Object.keys(countryMap).length,
      },
      dailyVolume: dailyVolumeArr,
      riskDistribution: riskBuckets.map((count, i) => ({
        range: `${i * 10}-${i * 10 + 9}`,
        count,
      })),
      countryHeatmap: countryHeatmap.slice(0, 30),
      documentTypes,
      expiringSoon: expiringSoon.slice(0, 20),
    })
  } catch (err) {
    console.error('[analytics] Error:', (err as Error).message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
