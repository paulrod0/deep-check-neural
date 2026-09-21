/**
 * GET /api/audit — Audit Trail Query & Verification
 * ===================================================
 *
 * Query Parameters:
 *   ?action=document.analyze    — Filter by action type
 *   ?resource=document          — Filter by resource type
 *   ?start=2026-01-01           — Start date
 *   ?end=2026-12-31             — End date
 *   ?limit=50                   — Page size
 *   ?offset=0                   — Pagination offset
 *   ?verify=true                — Verify chain integrity
 */

import { NextRequest, NextResponse } from 'next/server'
import { getOrgFromSession } from '@/lib/auth'
import {
  queryChainAuditLog,
  verifyAuditChainIntegrity,
} from '@/lib/auditLog'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const org = await getOrgFromSession(req)
  if (!org) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = req.nextUrl.searchParams

  // Chain integrity verification
  if (params.get('verify') === 'true') {
    const result = await verifyAuditChainIntegrity(org.id)
    return NextResponse.json({ success: true, verification: result })
  }

  // Query audit log
  const result = await queryChainAuditLog(org.id, {
    action: params.get('action') ?? undefined,
    resourceType: params.get('resource') ?? undefined,
    actorId: params.get('actor') ?? undefined,
    startDate: params.get('start') ?? undefined,
    endDate: params.get('end') ?? undefined,
    limit: Math.min(Math.max(1, parseInt(params.get('limit') ?? '50') || 50), 500),
    offset: Math.max(0, parseInt(params.get('offset') ?? '0') || 0),
  })

  return NextResponse.json({
    success: true,
    data: result.entries,
    pagination: {
      total: result.total,
      limit: params.has('limit') ? parseInt(params.get('limit')!) : 50,
      offset: params.has('offset') ? parseInt(params.get('offset')!) : 0,
    },
  })
}
