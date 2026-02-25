/**
 * Deep-Check · Audit Log Helper
 * ENS op.exp.7 — Registro de la actividad de los usuarios
 * ENS op.exp.10 — Protección de los registros de actividad
 *
 * Writes structured audit entries to dc_audit_logs.
 * Failures are silently caught — audit logging must never break the main flow.
 */
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export type AuditEventType =
    | 'api_call'
    | 'auth_ok'
    | 'auth_fail'
    | 'auth_logout'
    | 'rate_limit'
    | 'data_access'
    | 'data_write'
    | 'data_delete'
    | 'enrollment_created'
    | 'assessment_saved'
    | 'document_analyzed'
    | 'ml_inference'
    | 'error'

export interface AuditEntry {
    eventType:     AuditEventType
    endpoint:      string
    method:        string
    ip?:           string   // will be hashed before storage
    apiKeyPrefix?: string
    statusCode?:   number
    durationMs?:   number
    details?:      Record<string, unknown>
}

function hashIP(ip: string): string {
    return crypto
        .createHash('sha256')
        .update(ip + (process.env.AUDIT_SALT ?? 'dc-audit-salt-2026'))
        .digest('hex')
        .slice(0, 16)
}

function getClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) return null
    return createClient(url, key, { auth: { persistSession: false } })
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
    try {
        const sb = getClient()
        if (!sb) return

        await sb.from('dc_audit_logs').insert({
            event_type:     entry.eventType,
            endpoint:       entry.endpoint,
            method:         entry.method,
            ip_hash:        entry.ip ? hashIP(entry.ip) : null,
            api_key_prefix: entry.apiKeyPrefix ?? null,
            status_code:    entry.statusCode ?? null,
            duration_ms:    entry.durationMs ?? null,
            details:        entry.details ?? {},
        })
    } catch {
        // Must never throw — audit log failure is logged to console only
        console.error('[auditLog] Failed to write audit entry:', entry.eventType, entry.endpoint)
    }
}

/** Extract IP from a Next.js request headers object */
export function extractIP(headers: Headers): string {
    return (
        headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        headers.get('x-real-ip') ??
        'unknown'
    )
}
