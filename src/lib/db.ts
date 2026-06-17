/**
 * Deep-Check · Database layer
 * Backed by InsForge (migrated from Supabase)
 * All server-side — never import this from client components.
 */

import { createClient } from '@insforge/sdk'
import crypto from 'crypto'

// ─── InsForge client (server-side only) ──────────────────────────────────────

const INSFORGE_URL = process.env.NEXT_PUBLIC_INSFORGE_URL
    ?? process.env.NEXT_PUBLIC_SUPABASE_URL! // fallback for transition
const INSFORGE_KEY = process.env.INSFORGE_SERVICE_KEY
    ?? process.env.SUPABASE_SERVICE_ROLE_KEY
    ?? process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

let _client: ReturnType<typeof createClient> | null = null

function getClient() {
    if (_client) return _client
    if (!INSFORGE_URL) {
        throw new Error('Missing InsForge env vars: NEXT_PUBLIC_INSFORGE_URL')
    }
    _client = createClient({
        baseUrl: INSFORGE_URL,
        anonKey: INSFORGE_KEY,
        isServerMode: true,
    })
    return _client
}

/** Convenience: get the database query builder (replaces supabase.from()) */
export function db() {
    return getClient().database
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Assessment {
    id: string
    orgId?: string | null
    candidateName: string
    role: string
    date: string
    score: number
    status: 'passed' | 'review' | 'flagged'
    alerts: string[]
    evidence: { timestamp: string; image: string; reason: string }[]
    lastEvent: string
    // Extended biometric
    livenessScore?: number
    aiRisk?: number
    keystrokeCount?: number
    tabSwitchCount?: number
    gazeEventCount?: number
    autoFlagged?: boolean
    // Enrollment comparison
    enrollmentProfileId?: string
    identityMatchScore?: number
    // Certificate
    sessionHash?: string
    certificateIssued?: boolean
    // API integration
    externalRef?: string
    webhookDelivered?: boolean
}

export type EnrollmentContext = 'prose_es' | 'prose_en' | 'code_python' | 'code_js' | 'code_general'

export interface KeystrokeProfile {
    flightMean: number
    flightStd: number
    holdMean: number
    holdStd: number
    digrams: Record<string, { mean: number; std: number; count: number }>
    entropy: number
    wpmMin: number
    wpmMax: number
    sampleSize: number
}

export interface EnrollmentProfile {
    id: string
    orgId?: string | null
    candidateName: string
    candidateEmail: string
    context: EnrollmentContext
    createdAt: string
    expiresAt: string
    profile: KeystrokeProfile
    enrollmentHash: string
}

export interface ApiKey {
    key: string
    orgId: string | null
    name: string
    createdAt: string
    lastUsed?: string
    active: boolean
    permissions: ('read' | 'write' | 'webhook')[]
    webhookUrl?: string
}

// ─── Row ↔ Type mappers ───────────────────────────────────────────────────────

function rowToAssessment(row: Record<string, unknown>): Assessment {
    return {
        id:                   row.id as string,
        orgId:                row.org_id != null ? row.org_id as string : null,
        candidateName:        row.candidate_name as string,
        role:                 row.role as string,
        date:                 typeof row.date === 'string' ? row.date : new Date(row.date as string | number).toISOString().split('T')[0],
        score:                row.score as number,
        status:               row.status as Assessment['status'],
        alerts:               Array.isArray(row.alerts) ? row.alerts as string[] : [],
        evidence:             Array.isArray(row.evidence) ? row.evidence as Assessment['evidence'] : [],
        lastEvent:            (row.last_event as string | undefined) ?? '',
        livenessScore:        row.liveness_score != null ? row.liveness_score as number : undefined,
        aiRisk:               row.ai_risk != null ? row.ai_risk as number : undefined,
        keystrokeCount:       row.keystroke_count != null ? row.keystroke_count as number : undefined,
        tabSwitchCount:       row.tab_switch_count != null ? row.tab_switch_count as number : undefined,
        gazeEventCount:       row.gaze_event_count != null ? row.gaze_event_count as number : undefined,
        autoFlagged:          row.auto_flagged != null ? row.auto_flagged as boolean : undefined,
        enrollmentProfileId:  row.enrollment_profile_id != null ? row.enrollment_profile_id as string : undefined,
        identityMatchScore:   row.identity_match_score != null ? row.identity_match_score as number : undefined,
        sessionHash:          row.session_hash != null ? row.session_hash as string : undefined,
        certificateIssued:    row.certificate_issued != null ? row.certificate_issued as boolean : undefined,
        externalRef:          row.external_ref != null ? row.external_ref as string : undefined,
        webhookDelivered:     row.webhook_delivered != null ? row.webhook_delivered as boolean : undefined,
    }
}

function assessmentToRow(a: Assessment) {
    return {
        id:                     a.id,
        org_id:                 a.orgId ?? null,
        candidate_name:         a.candidateName,
        role:                   a.role,
        date:                   a.date,
        score:                  a.score,
        status:                 a.status,
        alerts:                 a.alerts,
        evidence:               a.evidence,
        last_event:             a.lastEvent,
        liveness_score:         a.livenessScore ?? null,
        ai_risk:                a.aiRisk ?? null,
        keystroke_count:        a.keystrokeCount ?? null,
        tab_switch_count:       a.tabSwitchCount ?? null,
        gaze_event_count:       a.gazeEventCount ?? null,
        auto_flagged:           a.autoFlagged ?? null,
        enrollment_profile_id:  a.enrollmentProfileId ?? null,
        identity_match_score:   a.identityMatchScore ?? null,
        session_hash:           a.sessionHash ?? null,
        certificate_issued:     a.certificateIssued ?? null,
        external_ref:           a.externalRef ?? null,
        webhook_delivered:      a.webhookDelivered ?? null,
    }
}

function rowToProfile(row: Record<string, unknown>): EnrollmentProfile {
    return {
        id:               row.id as string,
        orgId:            row.org_id != null ? row.org_id as string : null,
        candidateName:    row.candidate_name as string,
        candidateEmail:   row.candidate_email as string,
        context:          row.context as EnrollmentContext,
        createdAt:        row.created_at as string,
        expiresAt:        row.expires_at as string,
        profile:          row.profile as KeystrokeProfile,
        enrollmentHash:   row.enrollment_hash as string,
    }
}

function profileToRow(ep: EnrollmentProfile) {
    return {
        id:               ep.id,
        org_id:           ep.orgId ?? null,
        candidate_name:   ep.candidateName,
        candidate_email:  ep.candidateEmail,
        context:          ep.context,
        created_at:       ep.createdAt,
        expires_at:       ep.expiresAt,
        profile:          ep.profile,
        enrollment_hash:  ep.enrollmentHash,
    }
}

function rowToApiKey(row: Record<string, unknown>): ApiKey {
    return {
        key:         row.key as string,
        orgId:       row.org_id != null ? row.org_id as string : null,
        name:        row.name as string,
        createdAt:   row.created_at as string,
        lastUsed:    row.last_used != null ? row.last_used as string : undefined,
        active:      row.active as boolean,
        permissions: (row.permissions as ApiKey['permissions'] | undefined) ?? [],
        webhookUrl:  row.webhook_url != null ? row.webhook_url as string : undefined,
    }
}

// ─── Assessments ──────────────────────────────────────────────────────────────

export async function getAssessments(orgId?: string | null): Promise<Assessment[]> {
    // IDOR guard: a caller without an associated org has no tenant scope and
    // must never receive cross-tenant data.
    if (!orgId) return []
    const { data, error } = await db()
        .from('dc_assessments')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
    if (error) { console.error('[db] getAssessments:', error.message); return [] }
    return (data ?? []).map(rowToAssessment)
}

export async function getAssessmentById(id: string, orgId?: string | null): Promise<Assessment | null> {
    // IDOR guard: a caller without an associated org has no tenant scope.
    if (!orgId) return null
    const { data, error } = await db()
        .from('dc_assessments')
        .select('*')
        .eq('id', id)
        .eq('org_id', orgId)
        .single()
    if (error) return null
    return data ? rowToAssessment(data) : null
}

export async function saveAssessment(assessment: Assessment): Promise<void> {
    const row = assessmentToRow(assessment)
    const { error } = await db()
        .from('dc_assessments')
        .upsert(row, { onConflict: 'id' })
    if (error) throw new Error(`[db] saveAssessment: ${error.message}`)
}

// ─── Enrollment Profiles ──────────────────────────────────────────────────────

export async function saveEnrollmentProfile(ep: EnrollmentProfile): Promise<void> {
    const { error } = await db()
        .from('dc_enrollment_profiles')
        .upsert(profileToRow(ep), { onConflict: 'id' })
    if (error) throw new Error(`[db] saveEnrollmentProfile: ${error.message}`)
}

export async function getProfileById(id: string): Promise<EnrollmentProfile | null> {
    const { data, error } = await db()
        .from('dc_enrollment_profiles')
        .select('*')
        .eq('id', id)
        .single()
    if (error) return null
    return data ? rowToProfile(data) : null
}

export async function getProfileByEmail(email: string, orgId?: string | null): Promise<EnrollmentProfile | null> {
    // IDOR guard: a caller without an associated org has no tenant scope.
    if (!orgId) return null
    const { data, error } = await db()
        .from('dc_enrollment_profiles')
        .select('*')
        .eq('candidate_email', email)
        .eq('org_id', orgId)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
    if (error) return null
    return data && data.length > 0 ? rowToProfile(data[0]) : null
}

// ─── Intentionally UNSCOPED accessors ─────────────────────────────────────────
// These cross organization boundaries on purpose and must ONLY be used from
// trusted/public paths — never from a tenant API-key path:
//   • getAssessmentByIdUnscoped: public certificate verification by ID, and the
//     admin dashboard (validateAdminSession — a trusted operator sees all orgs).
//   • getProfileByEmailUnscoped: internal keystroke scoring (no org context).
// Naming them explicitly prevents accidental cross-tenant reads via a missing
// orgId argument.

export async function getAssessmentsUnscoped(): Promise<Assessment[]> {
    const { data, error } = await db()
        .from('dc_assessments')
        .select('*')
        .order('created_at', { ascending: false })
    if (error) { console.error('[db] getAssessmentsUnscoped:', error.message); return [] }
    return (data ?? []).map(rowToAssessment)
}

export async function getAssessmentByIdUnscoped(id: string): Promise<Assessment | null> {
    const { data, error } = await db()
        .from('dc_assessments')
        .select('*')
        .eq('id', id)
        .single()
    if (error) return null
    return data ? rowToAssessment(data) : null
}

export async function getProfileByEmailUnscoped(email: string): Promise<EnrollmentProfile | null> {
    const { data, error } = await db()
        .from('dc_enrollment_profiles')
        .select('*')
        .eq('candidate_email', email)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
    if (error) return null
    return data && data.length > 0 ? rowToProfile(data[0]) : null
}

// Default org (oldest = primary account owner). Used to assign newly created
// API keys to a tenant when the admin does not specify one (single-tenant).
export async function getDefaultOrgId(): Promise<string | null> {
    const { data, error } = await db()
        .from('dc_organizations')
        .select('id')
        .order('created_at', { ascending: true })
        .limit(1)
    if (error) return null
    return data && data.length > 0 ? (data[0].id as string) : null
}

// ─── Identity Match Score ─────────────────────────────────────────────────────

export function computeIdentityMatch(
    live: Partial<KeystrokeProfile>,
    baseline: KeystrokeProfile
): number {
    const scores: number[] = []

    if (live.flightMean !== undefined && baseline.flightMean > 0) {
        const delta = Math.abs(live.flightMean - baseline.flightMean) / baseline.flightMean
        scores.push(Math.max(0, 1 - delta / 0.30) * 100)
    }
    if (live.flightStd !== undefined && baseline.flightStd > 0) {
        const delta = Math.abs(live.flightStd - baseline.flightStd) / baseline.flightStd
        scores.push(Math.max(0, 1 - delta / 0.40) * 100)
    }
    if (live.holdMean !== undefined && baseline.holdMean > 0) {
        const delta = Math.abs(live.holdMean - baseline.holdMean) / baseline.holdMean
        scores.push(Math.max(0, 1 - delta / 0.35) * 100)
    }
    if (live.entropy !== undefined) {
        const delta = Math.abs(live.entropy - baseline.entropy)
        scores.push(Math.max(0, 1 - delta / 0.5) * 100)
    }
    if (live.digrams && baseline.digrams) {
        const commonKeys = Object.keys(baseline.digrams).filter(k => live.digrams![k])
        if (commonKeys.length > 0) {
            const digramScores = commonKeys.map(k => {
                const baseVal = baseline.digrams[k].mean
                const liveVal = live.digrams![k].mean
                if (baseVal === 0) return 50
                const delta = Math.abs(liveVal - baseVal) / baseVal
                return Math.max(0, 1 - delta / 0.35) * 100
            })
            scores.push(digramScores.reduce((a, b) => a + b, 0) / digramScores.length)
        }
    }

    if (scores.length === 0) return 50
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
}

// ─── Session Hash ─────────────────────────────────────────────────────────────

export function computeSessionHash(
    assessment: Omit<Assessment, 'sessionHash' | 'certificateIssued'>
): string {
    const payload = JSON.stringify({
        id:                 assessment.id,
        candidateName:      assessment.candidateName,
        role:               assessment.role,
        date:               assessment.date,
        score:              assessment.score,
        status:             assessment.status,
        alertCount:         assessment.alerts.length,
        keystrokeCount:     assessment.keystrokeCount,
        aiRisk:             assessment.aiRisk,
        tabSwitchCount:     assessment.tabSwitchCount,
        gazeEventCount:     assessment.gazeEventCount,
        livenessScore:      assessment.livenessScore,
        identityMatchScore: assessment.identityMatchScore,
    })
    return crypto.createHash('sha256').update(payload).digest('hex')
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

export async function validateApiKey(key: string): Promise<ApiKey | null> {
    const { data, error } = await db()
        .from('dc_api_keys')
        .select('*')
        .eq('key', key)
        .eq('active', true)
        .single()
    if (error || !data) return null

    // Update last_used (fire and forget)
    db().from('dc_api_keys').update({ last_used: new Date().toISOString() }).eq('key', key)

    return rowToApiKey(data)
}

export async function createApiKey(
    name: string,
    permissions: ApiKey['permissions'],
    webhookUrl?: string,
    orgId?: string | null
): Promise<ApiKey> {
    const newKey: ApiKey = {
        key:         `dc_live_${crypto.randomBytes(24).toString('hex')}`,
        orgId:       orgId ?? null,
        name,
        createdAt:   new Date().toISOString(),
        active:      true,
        permissions,
        webhookUrl,
    }
    const { error } = await db().from('dc_api_keys').insert({
        key:         newKey.key,
        org_id:      newKey.orgId,
        name:        newKey.name,
        created_at:  newKey.createdAt,
        active:      newKey.active,
        permissions: newKey.permissions,
        webhook_url: newKey.webhookUrl ?? null,
    })
    if (error) throw new Error(`[db] createApiKey: ${error.message}`)
    return newKey
}

export async function getApiKeysList(): Promise<ApiKey[]> {
    const { data, error } = await db()
        .from('dc_api_keys')
        .select('*')
        .order('created_at', { ascending: false })
    if (error) return []
    return (data ?? []).map(rowToApiKey)
}

// ─── initDb (no-op — schema managed via InsForge migrations) ─────────────────

export async function initDb(): Promise<void> {
    // Tables are managed by InsForge SQL Editor. Nothing to do here.
}
