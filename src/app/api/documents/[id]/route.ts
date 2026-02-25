/**
 * Deep-Check · Document Forensics API
 * GET    /api/documents/[id]  — fetch single analysis
 * DELETE /api/documents/[id]  — delete analysis
 * PATCH  /api/documents/[id]  — update notes/caseRef
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
        ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    return createClient(url, key, { auth: { persistSession: false } })
}

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
    const { id } = await params
    const sb = getClient()
    const { data, error } = await sb
        .from('dc_document_analyses')
        .select('*')
        .eq('id', id)
        .single()

    if (error || !data) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json(data)
}

export async function PATCH(req: NextRequest, { params }: Params) {
    const { id } = await params
    const body = await req.json()
    const updates: Record<string, unknown> = {}
    if (body.notes    !== undefined) updates.notes    = body.notes
    if (body.caseRef  !== undefined) updates.case_ref = body.caseRef
    if (body.submittedBy !== undefined) updates.submitted_by = body.submittedBy

    if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const sb = getClient()
    const { error } = await sb
        .from('dc_document_analyses')
        .update(updates)
        .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
    const { id } = await params
    const sb = getClient()
    const { error } = await sb
        .from('dc_document_analyses')
        .delete()
        .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
}
