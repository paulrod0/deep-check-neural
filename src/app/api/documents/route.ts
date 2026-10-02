/**
 * Deep-Check · Document Forensics API
 * POST /api/documents   — save a completed analysis
 * GET  /api/documents   — list recent analyses
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@insforge/sdk'
import { writeAuditLog, extractIP } from '@/lib/auditLog'
import { getOrgFromSession } from '@/lib/auth'
import { checkDocLimit, incrementDocUsage } from '@/lib/planLimits'
import { runDocForensics } from '@/lib/docForensics'

// Clamp a numeric value into [min, max]; returns fallback when not finite.
function clampNum(v: unknown, min: number, max: number, fallback = 0): number {
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n)) return fallback
    return Math.min(max, Math.max(min, n))
}

function getClient() {
    return createClient({
        baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
        anonKey: process.env.INSFORGE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        isServerMode: true,
    })
}

// ─── POST — save analysis ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    const t0 = Date.now()
    const ip = extractIP(req.headers)
    try {
        // ── Auth gate ─────────────────────────────────────────────────────────
        const org = await getOrgFromSession(req)
        if (!org) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        // ── Plan gating ──────────────────────────────────────────────────────
        const { allowed, used, limit } = await checkDocLimit(org.id)
        if (!allowed) {
            return NextResponse.json(
                { error: 'Límite del plan alcanzado', used, limit, upgradeUrl: '/pricing' },
                { status: 403 }
            )
        }

        const body = await req.json()

        const {
            filename, fileSize, mimeType,
            riskScore, riskLevel,
            elaScore, exifScore, noiseScore,
            dctScore, chromaScore, edgeScore,
            manipulationProb, confidenceLevel, signalsAboveThresh,
            alerts, exifData, findings,
            thumbnailUrl, elaImageUrl,
            caseRef, submittedBy, notes,
            documentBase64,
        } = body

        if (!filename || riskScore === undefined || !riskLevel) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        // ── Server-side forensic recompute ────────────────────────────────────
        // Never trust client self-reported scores. When the raw document is
        // provided, recompute p_tampered server-side; otherwise mark the stored
        // scores as client-origin so downstream consumers can weight them.
        let manipulationProbVal = clampNum(manipulationProb, 0, 1)
        let scoreSource: 'client' | 'server' = 'client'
        if (typeof documentBase64 === 'string' && documentBase64.length > 0) {
            const pTampered = await runDocForensics(documentBase64)
            if (pTampered !== null) {
                manipulationProbVal = clampNum(pTampered, 0, 1)
                scoreSource = 'server'
            }
        }

        const sb = getClient()
        const { data, error } = await sb.database
            .from('dc_document_analyses')
            .insert({
                org_id:        org.id,
                filename,
                file_size:     fileSize ?? null,
                mime_type:     mimeType ?? null,
                risk_score:    clampNum(riskScore, 0, 100),
                risk_level:    riskLevel,
                ela_score:     clampNum(elaScore, 0, 100),
                exif_score:    clampNum(exifScore, 0, 100),
                noise_score:   clampNum(noiseScore, 0, 100),
                dct_score:             clampNum(dctScore, 0, 100),
                chroma_score:          clampNum(chromaScore, 0, 100),
                edge_score:            clampNum(edgeScore, 0, 100),
                manipulation_prob:     manipulationProbVal,
                confidence_level:      clampNum(confidenceLevel, 0, 1),
                signals_above_thresh:  signalsAboveThresh   ?? 0,
                score_source:  scoreSource,
                alerts:        alerts ?? [],
                exif_data:     exifData ?? {},
                findings:      findings ?? {},
                thumbnail_url: thumbnailUrl ?? null,
                ela_image_url: elaImageUrl ?? null,
                case_ref:      caseRef ?? null,
                submitted_by:  submittedBy ?? null,
                notes:         notes ?? null,
            })
            .select('id, created_at')
            .single()

        if (error) {
            console.error('[api/documents POST]', error.message)
            return NextResponse.json({ error: 'Internal error' }, { status: 500 })
        }

        void incrementDocUsage(org.id)

        void writeAuditLog({
            eventType: 'document_analyzed',
            endpoint: '/api/documents',
            method: 'POST',
            ip,
            statusCode: 201,
            durationMs: Date.now() - t0,
            details: { id: data.id, filename, riskScore, riskLevel, caseRef: caseRef ?? null, scoreSource },
        })
        return NextResponse.json({ id: data.id, createdAt: data.created_at }, { status: 201 })
    } catch (e) {
        console.error('[api/documents POST] unexpected:', e)
        void writeAuditLog({ eventType: 'error', endpoint: '/api/documents', method: 'POST', ip, statusCode: 500, durationMs: Date.now() - t0 })
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// ─── GET — list analyses ─────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
    try {
        // ── Auth gate ─────────────────────────────────────────────────────────
        const org = await getOrgFromSession(req)
        if (!org) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const { searchParams } = new URL(req.url)
        const limit    = Math.min(50, parseInt(searchParams.get('limit') ?? '20'))
        const caseRef  = searchParams.get('caseRef')
        const riskLevel = searchParams.get('riskLevel')

        const sb = getClient()
        let query = sb.database
            .from('dc_document_analyses')
            .select('id, created_at, filename, file_size, risk_score, risk_level, thumbnail_url, case_ref, ela_score, exif_score, noise_score')
            .eq('org_id', org.id)
            .order('created_at', { ascending: false })
            .limit(limit)

        if (caseRef)   query = query.eq('case_ref', caseRef)
        if (riskLevel) query = query.eq('risk_level', riskLevel)

        const { data, error } = await query

        if (error) {
            console.error('[api/documents GET]', error.message)
            return NextResponse.json({ items: [] })
        }

        const items = (data ?? []).map(row => ({
            id:         row.id,
            filename:   row.filename,
            fileSize:   row.file_size,
            riskScore:  row.risk_score,
            riskLevel:  row.risk_level,
            createdAt:  row.created_at,
            thumbnail:  row.thumbnail_url,
            caseRef:    row.case_ref,
            elaScore:   row.ela_score,
            exifScore:  row.exif_score,
            noiseScore: row.noise_score,
        }))

        return NextResponse.json({ items, total: items.length })
    } catch (e) {
        console.error('[api/documents GET] unexpected:', e)
        return NextResponse.json({ items: [] })
    }
}
