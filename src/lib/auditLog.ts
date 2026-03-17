/**
 * Deep-Check · Audit Log Service
 * ================================
 *
 * ENS Controls:
 *   op.exp.7   — Registro de la actividad de los usuarios
 *   op.exp.8   — Registro de acceso
 *   op.exp.10  — Protección de los registros de actividad
 *   mp.info.6  — Trazabilidad
 *
 * Two layers:
 *   1. Original API audit entries (dc_audit_logs) — backwards compatible
 *   2. Hash-chain audit trail (dc_audit_log) — tamper-evident, enterprise-grade
 *
 * Failures are silently caught — audit logging must never break the main flow.
 */

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// ─── Layer 1: Original API Audit (backwards compatible) ─────────────────────

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
    ip?:           string
    apiKeyPrefix?: string
    statusCode?:   number
    durationMs?:   number
    details?:      Record<string, unknown>
}

function hashIP(ip: string): string {
    const salt = process.env.AUDIT_SALT ?? process.env.AUDIT_IP_SALT ?? ''
    if (!salt) console.warn('[auditLog] AUDIT_SALT not set — IP hashes are weak')
    return crypto
        .createHash('sha256')
        .update(ip + salt)
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

// ─── Layer 2: Hash-Chain Audit Trail (enterprise) ───────────────────────────

export type ChainAuditAction =
    | 'document.analyze'
    | 'document.verify'
    | 'session.create'
    | 'session.complete'
    | 'session.flag'
    | 'member.invite'
    | 'member.remove'
    | 'member.role_change'
    | 'api_key.create'
    | 'api_key.revoke'
    | 'api_key.use'
    | 'org.update'
    | 'org.plan_change'
    | 'auth.login'
    | 'auth.logout'
    | 'auth.failed'
    | 'ml.feedback'
    | 'ml.retrain_trigger'
    | 'ml.model_deploy'
    | 'certificate.generate'
    | 'certificate.verify'
    | 'gdpr.export_request'
    | 'gdpr.deletion_request'
    | 'webhook.deliver'
    | 'admin.settings_change'

export interface ChainAuditEntry {
    orgId: string
    actorId?: string
    actorEmail?: string
    action: ChainAuditAction
    resourceType?: string
    resourceId?: string
    details?: Record<string, unknown>
    ipAddress?: string
    userAgent?: string
}

function computeEntryHash(entry: {
    orgId: string
    action: string
    actorId?: string
    resourceId?: string
    details?: Record<string, unknown>
    prevHash?: string
    timestamp: string
}): string {
    const payload = JSON.stringify({
        org: entry.orgId,
        action: entry.action,
        actor: entry.actorId ?? '',
        resource: entry.resourceId ?? '',
        details: entry.details ?? {},
        prev: entry.prevHash ?? '',
        ts: entry.timestamp,
    })
    return crypto.createHash('sha256').update(payload).digest('hex')
}

// In-memory cache of last hash per org for performance
const lastHashCache: Record<string, string> = {}

/** Write a hash-chain audit entry (enterprise-grade tamper-evident log) */
export async function writeChainAuditLog(entry: ChainAuditEntry): Promise<void> {
    try {
        const sb = getClient()
        if (!sb) return

        // Get previous hash for chain integrity
        let prevHash = lastHashCache[entry.orgId]
        if (!prevHash) {
            const { data: lastEntry } = await sb
                .from('dc_audit_log')
                .select('entry_hash')
                .eq('org_id', entry.orgId)
                .order('id', { ascending: false })
                .limit(1)
                .single()

            prevHash = lastEntry?.entry_hash ?? 'genesis'
        }

        const timestamp = new Date().toISOString()

        const entryHash = computeEntryHash({
            orgId: entry.orgId,
            action: entry.action,
            actorId: entry.actorId,
            resourceId: entry.resourceId,
            details: entry.details,
            prevHash,
            timestamp,
        })

        const { error } = await sb.from('dc_audit_log').insert({
            org_id:        entry.orgId,
            actor_id:      entry.actorId,
            actor_email:   entry.actorEmail,
            action:        entry.action,
            resource_type: entry.resourceType,
            resource_id:   entry.resourceId,
            details:       entry.details ?? {},
            ip_address:    entry.ipAddress,
            user_agent:    entry.userAgent,
            prev_hash:     prevHash,
            entry_hash:    entryHash,
        })

        if (!error) {
            lastHashCache[entry.orgId] = entryHash
        } else {
            console.error('[audit-chain] Failed to write:', error.message)
        }
    } catch (err) {
        console.error('[audit-chain] Exception:', err)
    }
}

/** Verify the hash chain integrity for an organization */
export async function verifyAuditChainIntegrity(
    orgId: string,
    limit = 1000
): Promise<{
    valid: boolean
    entriesChecked: number
    brokenAt?: number
    message: string
}> {
    const sb = getClient()
    if (!sb) return { valid: false, entriesChecked: 0, message: 'No database connection' }

    const { data: entries, error } = await sb
        .from('dc_audit_log')
        .select('id, org_id, actor_id, action, resource_id, details, prev_hash, entry_hash, created_at')
        .eq('org_id', orgId)
        .order('id', { ascending: true })
        .limit(limit)

    if (error || !entries?.length) {
        return { valid: true, entriesChecked: 0, message: 'No audit entries found' }
    }

    let prevHash = 'genesis'

    for (let i = 0; i < entries.length; i++) {
        const e = entries[i]

        if (e.prev_hash !== prevHash) {
            return {
                valid: false,
                entriesChecked: i + 1,
                brokenAt: e.id,
                message: `Chain broken at entry ${e.id}: expected prev_hash=${prevHash}, got ${e.prev_hash}`,
            }
        }

        const expectedHash = computeEntryHash({
            orgId: e.org_id,
            action: e.action,
            actorId: e.actor_id,
            resourceId: e.resource_id,
            details: e.details,
            prevHash: e.prev_hash,
            timestamp: e.created_at,
        })

        if (e.entry_hash !== expectedHash) {
            return {
                valid: false,
                entriesChecked: i + 1,
                brokenAt: e.id,
                message: `Hash mismatch at entry ${e.id}: data has been tampered with`,
            }
        }

        prevHash = e.entry_hash
    }

    return {
        valid: true,
        entriesChecked: entries.length,
        message: `All ${entries.length} audit entries verified — chain integrity confirmed`,
    }
}

/** Query hash-chain audit log with filters */
export async function queryChainAuditLog(
    orgId: string,
    options: {
        action?: string
        resourceType?: string
        actorId?: string
        startDate?: string
        endDate?: string
        limit?: number
        offset?: number
    } = {}
): Promise<{
    entries: Array<{
        id: number
        action: string
        actorEmail: string | null
        resourceType: string | null
        resourceId: string | null
        details: Record<string, unknown>
        ipAddress: string | null
        createdAt: string
    }>
    total: number
}> {
    const sb = getClient()
    if (!sb) return { entries: [], total: 0 }

    let query = sb
        .from('dc_audit_log')
        .select('*', { count: 'exact' })
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })

    if (options.action) query = query.eq('action', options.action)
    if (options.resourceType) query = query.eq('resource_type', options.resourceType)
    if (options.actorId) query = query.eq('actor_id', options.actorId)
    if (options.startDate) query = query.gte('created_at', options.startDate)
    if (options.endDate) query = query.lte('created_at', options.endDate)

    const limit = options.limit ?? 50
    const offset = options.offset ?? 0
    query = query.range(offset, offset + limit - 1)

    const { data, count, error } = await query

    if (error) {
        console.error('[audit-chain] Query error:', error.message)
        return { entries: [], total: 0 }
    }

    return {
        entries: (data || []).map(e => ({
            id: e.id,
            action: e.action,
            actorEmail: e.actor_email,
            resourceType: e.resource_type,
            resourceId: e.resource_id,
            details: e.details ?? {},
            ipAddress: e.ip_address,
            createdAt: e.created_at,
        })),
        total: count ?? 0,
    }
}

/** Extract request context for audit entries */
export function extractRequestContext(req: Request): {
    ipAddress: string
    userAgent: string
} {
    const forwarded = req.headers.get('x-forwarded-for')
    const ip = forwarded?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown'
    return {
        ipAddress: ip.replace(/\.\d+$/, '.***'),
        userAgent: req.headers.get('user-agent')?.slice(0, 120) ?? '',
    }
}
