/**
 * Deep-Check · Document Forensics API
 * POST /api/documents   — save a completed analysis
 * GET  /api/documents   — list recent analyses
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { writeAuditLog, extractIP } from '@/lib/auditLog'
import { getOrgFromSession } from '@/lib/auth'
import { checkDocLimit, incrementDocUsage } from '@/lib/planLimits'

function getClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
        ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    return createClient(url, key, { auth: { persistSession: false } })
}

// ─── POST — save analysis ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    const t0 = Date.now()
    const ip = extractIP(req.headers)
    try {
        // ── Plan gating ──────────────────────────────────────────────────────
        const org = await getOrgFromSession(req)
        if (org) {
            const { allowed, used, limit } = await checkDocLimit(org.id)
            if (!allowed) {
                return NextResponse.json(
                    { error: 'Límite del plan alcanzado', used, limit, upgradeUrl: '/pricing' },
                    { status: 403 }
                )
            }
        }

        const body = await req.json()

        const {
            filename, fileSize, mimeType,
            riskScore, riskLevel,
            elaScore, exifScore, noiseScore,
            alerts, exifData, findings,
            thumbnailUrl, elaImageUrl,
            caseRef, submittedBy, notes,
        } = body

        if (!filename || riskScore === undefined || !riskLevel) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        const sb = getClient()
        const { data, error } = await sb
            .from('dc_document_analyses')
            .insert({
                filename,
                file_size:     fileSize ?? null,
                mime_type:     mimeType ?? null,
                risk_score:    riskScore,
                risk_level:    riskLevel,
                ela_score:     elaScore ?? 0,
                exif_score:    exifScore ?? 0,
                noise_score:   noiseScore ?? 0,
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

        if (org) void incrementDocUsage(org.id)

        void writeAuditLog({
            eventType: 'document_analyzed',
            endpoint: '/api/documents',
            method: 'POST',
            ip,
            statusCode: 201,
            durationMs: Date.now() - t0,
            details: { id: data.id, filename, riskScore, riskLevel, caseRef: caseRef ?? null },
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
        const { searchParams } = new URL(req.url)
        const limit    = Math.min(50, parseInt(searchParams.get('limit') ?? '20'))
        const caseRef  = searchParams.get('caseRef')
        const riskLevel = searchParams.get('riskLevel')

        const sb = getClient()
        let query = sb
            .from('dc_document_analyses')
            .select('id, created_at, filename, file_size, risk_score, risk_level, thumbnail_url, case_ref, ela_score, exif_score, noise_score')
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
