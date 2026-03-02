/**
 * Deep-Check · Admin Session Validation
 *
 * Validates the dc_admin_session cookie against the Supabase sessions table.
 * Used by API routes that require admin authentication but are not covered
 * by the Next.js middleware (which only protects /dashboard/* page routes).
 */

import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } }
    )
}

/**
 * Returns true if the request carries a valid, non-expired admin session cookie.
 * Performs a DB lookup — call once per request and cache the result if needed.
 */
export async function validateAdminSession(req: NextRequest): Promise<boolean> {
    const token = req.cookies.get('dc_admin_session')?.value
    if (!token || !token.startsWith('dc_admin_') || token.length <= 20) return false

    try {
        const sb = getClient()
        const { data } = await sb
            .from('dc_admin_sessions')
            .select('expires_at')
            .eq('token', token)
            .single()

        if (!data) return false
        return new Date(data.expires_at) > new Date()
    } catch {
        return false
    }
}
