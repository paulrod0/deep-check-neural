/**
 * Deep-Check OSINT · STIX 2.1 Export Endpoint
 *
 * GET  /api/osint/stix?analysisId=xxx   — single analysis as STIX bundle
 * GET  /api/osint/stix?since=2024-01-01 — all analyses since date as STIX bundle
 * POST /api/osint/stix                  — convert posted analysis JSON to STIX bundle
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { writeAuditLog, extractIP } from '@/lib/auditLog'
import { getOrgFromSession } from '@/lib/auth'

// ─── Supabase client ──────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key, { auth: { persistSession: false } })
}

// ─── STIX object types ────────────────────────────────────────────────────────

interface StixArtifact {
  type: 'artifact'
  id: string
  spec_version: '2.1'
  created: string
  modified: string
  mime_type: string
  hashes: Record<string, string>
  extensions: {
    'x-deepcheck-forensics': {
      ela_score: number
      ai_generated: boolean
      risk_level: string
      manipulation_probability: number
      alerts: string[]
      analysis_version: string
      filename?: string
    }
  }
}

interface StixObservedData {
  type: 'observed-data'
  id: string
  spec_version: '2.1'
  created: string
  modified: string
  first_observed: string
  last_observed: string
  number_observed: number
  object_refs: string[]
}

interface StixMalwareAnalysis {
  type: 'malware-analysis'
  id: string
  spec_version: '2.1'
  created: string
  modified: string
  product: string
  version: string
  result: 'malicious' | 'suspicious' | 'benign' | 'unknown'
  analysis_started: string
  analysis_ended: string
  submitted_url?: string
}

interface StixBundle {
  type: 'bundle'
  id: string
  spec_version: '2.1'
  objects: (StixArtifact | StixObservedData | StixMalwareAnalysis)[]
}

// ─── Analysis row type (from dc_document_analyses) ────────────────────────────

interface AnalysisRow {
  id: string
  created_at: string
  filename: string
  file_size: number | null
  mime_type: string | null
  risk_score: number
  risk_level: string
  ela_score: number
  exif_score: number
  noise_score: number
  alerts: string[]
  findings: Record<string, unknown>
  case_ref: string | null
}

// ─── STIX conversion helpers ──────────────────────────────────────────────────

function riskLevelToStixResult(level: string): 'malicious' | 'suspicious' | 'benign' | 'unknown' {
  switch (level?.toUpperCase()) {
    case 'CRITICAL':
    case 'HIGH':   return 'malicious'
    case 'MEDIUM': return 'suspicious'
    case 'LOW':    return 'benign'
    default:       return 'unknown'
  }
}

function analysisRowToStixObjects(
  row: AnalysisRow
): [StixArtifact, StixObservedData, StixMalwareAnalysis] {
  const now        = new Date().toISOString()
  const createdAt  = row.created_at ?? now

  const artifactId     = `artifact--${crypto.randomUUID()}`
  const observedDataId = `observed-data--${crypto.randomUUID()}`
  const malwareAnalId  = `malware-analysis--${crypto.randomUUID()}`

  // Derive a pseudo SHA-256 from the analysis ID (stable across exports)
  // Real implementation would use the actual file hash stored in findings
  const hashBase = row.findings?.sha256 as string
    ?? `deepcheck-${row.id}-${row.filename}`.padEnd(64, '0').slice(0, 64)

  const artifact: StixArtifact = {
    type: 'artifact',
    id: artifactId,
    spec_version: '2.1',
    created: createdAt,
    modified: now,
    mime_type: row.mime_type ?? 'image/jpeg',
    hashes: {
      'SHA-256': hashBase,
    },
    extensions: {
      'x-deepcheck-forensics': {
        ela_score:               row.ela_score ?? 0,
        ai_generated:            (row.risk_score ?? 0) > 0.65,
        risk_level:              row.risk_level ?? 'UNKNOWN',
        manipulation_probability: row.risk_score ?? 0,
        alerts:                  Array.isArray(row.alerts) ? row.alerts : [],
        analysis_version:        '2.0',
        filename:                row.filename,
      },
    },
  }

  const observedData: StixObservedData = {
    type: 'observed-data',
    id: observedDataId,
    spec_version: '2.1',
    created: createdAt,
    modified: now,
    first_observed: createdAt,
    last_observed:  now,
    number_observed: 1,
    object_refs: [artifactId],
  }

  const malwareAnalysis: StixMalwareAnalysis = {
    type: 'malware-analysis',
    id: malwareAnalId,
    spec_version: '2.1',
    created: createdAt,
    modified: now,
    product: 'Deep-Check',
    version: '2.0',
    result: riskLevelToStixResult(row.risk_level),
    analysis_started: createdAt,
    analysis_ended:   now,
  }

  return [artifact, observedData, malwareAnalysis]
}

function buildBundle(rows: AnalysisRow[]): StixBundle {
  const allObjects: StixBundle['objects'] = []

  for (const row of rows) {
    const [artifact, observedData, malwareAnalysis] = analysisRowToStixObjects(row)
    allObjects.push(artifact, observedData, malwareAnalysis)
  }

  return {
    type: 'bundle',
    id: `bundle--${crypto.randomUUID()}`,
    spec_version: '2.1',
    objects: allObjects,
  }
}

// Build a STIX bundle from a raw analysis result object (for POST endpoint)
function buildBundleFromRaw(analysis: Record<string, unknown>): StixBundle {
  const now = new Date().toISOString()

  const row: AnalysisRow = {
    id:          (analysis.id as string)       ?? crypto.randomUUID(),
    created_at:  (analysis.createdAt as string) ?? now,
    filename:    (analysis.filename as string)  ?? 'unknown',
    file_size:   (analysis.fileSize as number)  ?? null,
    mime_type:   (analysis.mimeType as string)  ?? 'image/jpeg',
    risk_score:  (analysis.riskScore as number) ?? 0,
    risk_level:  (analysis.riskLevel as string) ?? 'UNKNOWN',
    ela_score:   (analysis.elaScore as number)  ?? 0,
    exif_score:  (analysis.exifScore as number) ?? 0,
    noise_score: (analysis.noiseScore as number)?? 0,
    alerts:      (analysis.alerts as string[])  ?? [],
    findings:    (analysis.findings as Record<string, unknown>) ?? {},
    case_ref:    (analysis.caseRef as string)   ?? null,
  }

  return buildBundle([row])
}

// ─── GET handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const t0  = Date.now()
  const ip  = extractIP(req.headers)
  const { searchParams } = new URL(req.url)

  const analysisId = searchParams.get('analysisId')
  const since      = searchParams.get('since')

  try {
    const sb = getSupabase()
    let rows: AnalysisRow[] = []

    if (analysisId) {
      const { data, error } = await sb
        .from('dc_document_analyses')
        .select('id, created_at, filename, file_size, mime_type, risk_score, risk_level, ela_score, exif_score, noise_score, alerts, findings, case_ref')
        .eq('id', analysisId)
        .single()

      if (error || !data) {
        return NextResponse.json({ error: 'Analysis not found' }, { status: 404 })
      }
      rows = [data as AnalysisRow]
    } else if (since) {
      const sinceDate = new Date(since)
      if (isNaN(sinceDate.getTime())) {
        return NextResponse.json({ error: 'Invalid since date' }, { status: 400 })
      }

      const { data, error } = await sb
        .from('dc_document_analyses')
        .select('id, created_at, filename, file_size, mime_type, risk_score, risk_level, ela_score, exif_score, noise_score, alerts, findings, case_ref')
        .gte('created_at', sinceDate.toISOString())
        .order('created_at', { ascending: true })
        .limit(1000)

      if (error) {
        console.error('[api/osint/stix GET]', error.message)
        return NextResponse.json({ error: 'Database error' }, { status: 500 })
      }
      rows = (data ?? []) as AnalysisRow[]
    } else {
      return NextResponse.json(
        { error: 'Provide analysisId or since query parameter' },
        { status: 400 }
      )
    }

    const bundle = buildBundle(rows)

    void writeAuditLog({
      eventType: 'data_access',
      endpoint: '/api/osint/stix',
      method: 'GET',
      ip,
      statusCode: 200,
      durationMs: Date.now() - t0,
      details: { analysisId: analysisId ?? null, since: since ?? null, exportedCount: rows.length },
    })

    return NextResponse.json(bundle, {
      headers: {
        'Content-Type': 'application/stix+json; charset=utf-8',
        'Content-Disposition': `attachment; filename="deepcheck-stix-${Date.now()}.json"`,
      },
    })
  } catch (err) {
    console.error('[api/osint/stix GET] unexpected:', err)
    void writeAuditLog({
      eventType: 'error',
      endpoint: '/api/osint/stix',
      method: 'GET',
      ip,
      statusCode: 500,
      durationMs: Date.now() - t0,
    })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const t0 = Date.now()
  const ip = extractIP(req.headers)

  try {
    await getOrgFromSession(req) // Auth optional — no hard gate for STIX conversion

    const body = await req.json()

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request body must be a JSON analysis object' }, { status: 400 })
    }

    const bundle = buildBundleFromRaw(body as Record<string, unknown>)

    void writeAuditLog({
      eventType: 'data_access',
      endpoint: '/api/osint/stix',
      method: 'POST',
      ip,
      statusCode: 200,
      durationMs: Date.now() - t0,
      details: { bundleId: bundle.id, objectCount: bundle.objects.length },
    })

    return NextResponse.json(bundle, {
      headers: { 'Content-Type': 'application/stix+json; charset=utf-8' },
    })
  } catch (err) {
    console.error('[api/osint/stix POST] unexpected:', err)
    void writeAuditLog({
      eventType: 'error',
      endpoint: '/api/osint/stix',
      method: 'POST',
      ip,
      statusCode: 500,
      durationMs: Date.now() - t0,
    })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
