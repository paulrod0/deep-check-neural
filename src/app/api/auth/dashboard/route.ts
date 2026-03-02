/**
 * Deep-Check · Dashboard Authentication
 * ENS op.acc.5 — Mecanismo de autenticación
 *
 * POST /api/auth/dashboard — verify admin password, issue session cookie
 * DELETE /api/auth/dashboard — revoke session (logout)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// ADMIN_PASSWORD must be set as an env var — no hardcoded fallback.
// Set in Vercel dashboard or .env.local for dev.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null

function getClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } }
    )
}

function hashIP(ip: string): string {
    return crypto.createHash('sha256').update(ip + 'dc-salt-2026').digest('hex').slice(0, 16)
}

function getIP(req: NextRequest): string {
    return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

// ─── POST — login ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    const ip = getIP(req)
    const ipHash = hashIP(ip)

    if (!ADMIN_PASSWORD) {
        console.error('[auth/dashboard] ADMIN_PASSWORD env var not configured')
        return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
    }

    try {
        const { password } = await req.json()

        const isValid = typeof password === 'string' &&
            crypto.timingSafeEqual(
                Buffer.from(password.slice(0, 200)),
                Buffer.from(ADMIN_PASSWORD.slice(0, 200).padEnd(password.length, '\0'))
            ) && password === ADMIN_PASSWORD

        if (!isValid) {
            // Log failed attempt
            await writeAuditLog('auth_fail', '/api/auth/dashboard', 'POST', ipHash, 401)
            return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
        }

        // Generate session token
        const token = `dc_admin_${crypto.randomBytes(32).toString('hex')}`
        const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000) // 8 hours

        // Persist session
        const sb = getClient()
        await sb.from('dc_admin_sessions').insert({
            token,
            expires_at: expiresAt.toISOString(),
            ip_hash: ipHash,
        })

        // Log successful auth
        await writeAuditLog('auth_ok', '/api/auth/dashboard', 'POST', ipHash, 200)

        const res = NextResponse.json({ ok: true })
        res.cookies.set('dc_admin_session', token, {
            httpOnly:  true,
            secure:    process.env.NODE_ENV === 'production',
            sameSite:  'strict',
            expires:   expiresAt,
            path:      '/',
        })
        return res

    } catch (e) {
        console.error('[auth/dashboard]', e)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// ─── DELETE — logout ──────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
    const token = req.cookies.get('dc_admin_session')?.value
    const ip = getIP(req)

    if (token) {
        const sb = getClient()
        await sb.from('dc_admin_sessions').delete().eq('token', token)
        await writeAuditLog('auth_logout', '/api/auth/dashboard', 'DELETE', hashIP(ip), 200)
    }

    const res = NextResponse.json({ ok: true })
    res.cookies.delete('dc_admin_session')
    return res
}

// ─── Audit log helper ─────────────────────────────────────────────────────────

async function writeAuditLog(
    eventType: string, endpoint: string, method: string,
    ipHash: string, statusCode: number
) {
    try {
        const sb = getClient()
        await sb.from('dc_audit_logs').insert({
            event_type:  eventType,
            endpoint,
            method,
            ip_hash:     ipHash,
            status_code: statusCode,
        })
    } catch {
        // Audit log failure must not break the app — just log to console
        console.error('[audit_log] Failed to write audit entry')
    }
}
