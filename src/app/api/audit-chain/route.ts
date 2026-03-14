/**
 * Deep-Check — Audit Chain API
 * ============================
 * POST /api/audit-chain  — Save blocks + verify chain integrity
 * GET  /api/audit-chain  — Retrieve blocks for an assessment
 *
 * The audit chain provides tamper-evident forensic evidence for
 * each verification session (Veritas Engine v2).
 *
 * All blocks are verified server-side before storage.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { AuditChain, AuditBlock } from '@/lib/auditChain'

function getDb() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) throw new Error('Missing Supabase env vars')
    return createClient(url, key, { auth: { persistSession: false } })
}

// ─── POST /api/audit-chain ────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
    let body: { assessmentId?: string; blocks?: AuditBlock[] }
    try {
        body = await req.json() as { assessmentId?: string; blocks?: AuditBlock[] }
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { assessmentId, blocks } = body
    if (!assessmentId || !Array.isArray(blocks) || blocks.length === 0) {
        return NextResponse.json({ error: 'assessmentId and blocks[] required' }, { status: 400 })
    }

    // Verify chain integrity before saving
    const chain = await AuditChain.fromBlocks(blocks)
    const verification = await chain.verify()

    if (!verification.valid) {
        return NextResponse.json({
            error: 'Chain integrity check failed',
            reason: verification.reason,
            tamperIndex: verification.tamperIndex,
        }, { status: 422 })
    }

    // Save to database
    try {
        const db = getDb()
        const rows = blocks.map(block => ({
            assessment_id: assessmentId,
            block_index:   block.index,
            block_hash:    block.hash,
            prev_hash:     block.prevHash,
            timestamp:     block.timestamp,
            layer:         block.layer,
            payload:       block.payload,
            chain_valid:   true,
        }))

        const { error } = await db
            .from('dc_deepfake_audit')
            .upsert(rows, { onConflict: 'assessment_id,block_index' })

        if (error) {
            // Table may not exist yet (before migration) — return soft success
            console.warn('[audit-chain] DB insert failed (table may not exist):', error.message)
            return NextResponse.json({
                saved: false,
                chainHash: verification.chainFingerprint,
                blockCount: blocks.length,
                warning: 'Could not persist to database: ' + error.message,
            })
        }

        return NextResponse.json({
            saved: true,
            chainHash: verification.chainFingerprint,
            blockCount: blocks.length,
        })
    } catch (err) {
        console.error('[audit-chain] POST error:', err)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

// ─── GET /api/audit-chain?assessmentId=xxx ────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
    const assessmentId = req.nextUrl.searchParams.get('assessmentId')
    if (!assessmentId) {
        return NextResponse.json({ error: 'assessmentId query param required' }, { status: 400 })
    }

    try {
        const db = getDb()
        const { data, error } = await db
            .from('dc_deepfake_audit')
            .select('*')
            .eq('assessment_id', assessmentId)
            .order('block_index', { ascending: true })

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        if (!data || data.length === 0) {
            return NextResponse.json({ blocks: [], chainHash: '', valid: null })
        }

        // Re-verify on retrieval
        const blocks: AuditBlock[] = data.map(row => ({
            index:     row.block_index,
            timestamp: row.timestamp,
            layer:     row.layer,
            payload:   row.payload,
            prevHash:  row.prev_hash,
            hash:      row.block_hash,
        }))

        const chain        = await AuditChain.fromBlocks(blocks)
        const verification = await chain.verify()

        return NextResponse.json({
            blocks,
            chainHash: verification.chainFingerprint,
            valid:     verification.valid,
            tamperIndex: verification.tamperIndex,
        })
    } catch (err) {
        console.error('[audit-chain] GET error:', err)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
