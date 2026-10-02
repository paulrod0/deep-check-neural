/**
 * /api/gdpr — GDPR Data Rights (Export & Deletion)
 * ==================================================
 *
 * GET:  List GDPR data requests for the organization
 * POST: Submit a new data export or deletion request
 *
 * GDPR Article 15 (Right of Access) — Data export
 * GDPR Article 17 (Right to Erasure) — Data deletion
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, getOrgFromSession } from '@/lib/auth'
import { writeChainAuditLog, extractRequestContext } from '@/lib/auditLog'

// ── GET: List GDPR requests ──────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const org = await getOrgFromSession(req)
  if (!org) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()

  const { data: requests, error } = await supabase.database
    .from('dc_gdpr_requests')
    .select('*')
    .eq('org_id', org.id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    data: (requests || []).map(r => ({
      id: r.id,
      type: r.request_type,
      status: r.status,
      requesterEmail: r.requester_email,
      dataUrl: r.data_url,
      createdAt: r.created_at,
      completedAt: r.completed_at,
      expiresAt: r.expires_at,
    })),
  })
}

// ── POST: Submit GDPR request ────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const org = await getOrgFromSession(req)
  if (!org) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { type: 'export' | 'deletion'; email?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.type || !['export', 'deletion'].includes(body.type)) {
    return NextResponse.json(
      { error: 'type must be "export" or "deletion"' },
      { status: 400 }
    )
  }

  const requesterEmail = body.email?.trim() || org.owner_email

  const supabase = createServerClient()

  // Check for pending request of same type
  const { data: existing } = await supabase.database
    .from('dc_gdpr_requests')
    .select('id')
    .eq('org_id', org.id)
    .eq('request_type', body.type)
    .in('status', ['pending', 'processing'])
    .single()

  if (existing) {
    return NextResponse.json(
      { error: `A ${body.type} request is already in progress` },
      { status: 409 }
    )
  }

  // Create request
  const { data: gdprReq, error: insertErr } = await supabase.database
    .from('dc_gdpr_requests')
    .insert({
      org_id: org.id,
      requester_email: requesterEmail,
      request_type: body.type,
      status: 'pending',
    })
    .select('id')
    .single()

  if (insertErr || !gdprReq) {
    return NextResponse.json({ error: insertErr?.message ?? 'Failed to create request' }, { status: 500 })
  }

  // Audit log
  const ctx = extractRequestContext(req)
  await writeChainAuditLog({
    orgId: org.id,
    actorEmail: requesterEmail,
    action: body.type === 'export' ? 'gdpr.export_request' : 'gdpr.deletion_request',
    resourceType: 'gdpr_request',
    resourceId: gdprReq.id,
    details: { requestType: body.type, email: requesterEmail },
    ...ctx,
  })

  // For export requests: process immediately (gather all org data)
  if (body.type === 'export') {
    // Start async export processing
    processExportRequest(org.id, gdprReq.id).catch(err => {
      console.error('[gdpr] Export processing error:', err)
    })
  }

  // For deletion requests: require manual confirmation (mark as pending)
  if (body.type === 'deletion') {
    // Deletion requires admin review for safety
    return NextResponse.json({
      success: true,
      message: 'Deletion request submitted. It will be processed within 30 days per GDPR requirements.',
      requestId: gdprReq.id,
      status: 'pending',
    })
  }

  return NextResponse.json({
    success: true,
    message: 'Data export request submitted. You will be notified when the download is ready.',
    requestId: gdprReq.id,
    status: 'processing',
  })
}

// ── Export Processing ────────────────────────────────────────────────────────

async function processExportRequest(orgId: string, requestId: string): Promise<void> {
  const supabase = createServerClient()

  // Mark as processing
  await supabase.database
    .from('dc_gdpr_requests')
    .update({ status: 'processing' })
    .eq('id', requestId)

  try {
    // Gather all org data
    const [assessments, documents, feedback, apiKeys, members, auditLogs] = await Promise.all([
      supabase.database.from('dc_assessments').select('*').eq('org_id', orgId),
      supabase.database.from('dc_document_analyses').select('*').eq('org_id', orgId),
      supabase.database.from('dc_ml_feedback').select('*').eq('org_id', orgId),
      supabase.database.from('dc_api_keys').select('id, name, permissions, created_at, last_used_at').eq('org_id', orgId),
      supabase.database.from('dc_org_members').select('*').eq('org_id', orgId),
      supabase.database.from('dc_audit_log').select('*').eq('org_id', orgId).limit(10000),
    ])

    const exportData = {
      exportDate: new Date().toISOString(),
      organization: orgId,
      assessments: assessments.data ?? [],
      documentAnalyses: documents.data ?? [],
      mlFeedback: feedback.data ?? [],
      apiKeys: apiKeys.data ?? [],
      members: members.data ?? [],
      auditLog: auditLogs.data ?? [],
    }

    // Store export as JSON (in a real production system, this would go to S3/R2)
    const exportJson = JSON.stringify(exportData, null, 2)
    const exportBlob = Buffer.from(exportJson)

    // Store full export as base64 data URL (in production, use S3 presigned URL)
    const dataUrl = `data:application/json;base64,${exportBlob.toString('base64')}`

    // Mark as completed
    await supabase.database
      .from('dc_gdpr_requests')
      .update({
        status: 'completed',
        data_url: dataUrl,
        completed_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      })
      .eq('id', requestId)

  } catch (err) {
    console.error('[gdpr] Export failed:', err)
    await supabase.database
      .from('dc_gdpr_requests')
      .update({ status: 'failed' })
      .eq('id', requestId)
  }
}
