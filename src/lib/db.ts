/**
 * Deep-Check · Database layer
 * Backed by Supabase (schema: deepcheck)
 * All server-side — never import this from client components.
 */

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// ─── Supabase client (server-side only) ───────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function getClient() {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        throw new Error('Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
    }
    return createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false },
    })
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Assessment {
    id: string
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
    name: string
    createdAt: string
    lastUsed?: string
    active: boolean
    permissions: ('read' | 'write' | 'webhook')[]
    webhookUrl?: string
}

// ─── Row ↔ Type mappers ───────────────────────────────────────────────────────

function rowToAssessment(row: any): Assessment {
    return {
        id:                   row.id,
        candidateName:        row.candidate_name,
        role:                 row.role,
        date:                 typeof row.date === 'string' ? row.date : new Date(row.date).toISOString().split('T')[0],
        score:                row.score,
        status:               row.status,
        alerts:               Array.isArray(row.alerts) ? row.alerts : (row.alerts ?? []),
        evidence:             Array.isArray(row.evidence) ? row.evidence : (row.evidence ?? []),
        lastEvent:            row.last_event,
        livenessScore:        row.liveness_score ?? undefined,
        aiRisk:               row.ai_risk ?? undefined,
        keystrokeCount:       row.keystroke_count ?? undefined,
        tabSwitchCount:       row.tab_switch_count ?? undefined,
        gazeEventCount:       row.gaze_event_count ?? undefined,
        autoFlagged:          row.auto_flagged ?? undefined,
        enrollmentProfileId:  row.enrollment_profile_id ?? undefined,
        identityMatchScore:   row.identity_match_score ?? undefined,
        sessionHash:          row.session_hash ?? undefined,
        certificateIssued:    row.certificate_issued ?? undefined,
        externalRef:          row.external_ref ?? undefined,
        webhookDelivered:     row.webhook_delivered ?? undefined,
    }
}

function assessmentToRow(a: Assessment) {
    return {
        id:                     a.id,
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

function rowToProfile(row: any): EnrollmentProfile {
    return {
        id:               row.id,
        candidateName:    row.candidate_name,
        candidateEmail:   row.candidate_email,
        context:          row.context as EnrollmentContext,
        createdAt:        row.created_at,
        expiresAt:        row.expires_at,
        profile:          row.profile as KeystrokeProfile,
        enrollmentHash:   row.enrollment_hash,
    }
}

function profileToRow(ep: EnrollmentProfile) {
    return {
        id:               ep.id,
        candidate_name:   ep.candidateName,
        candidate_email:  ep.candidateEmail,
        context:          ep.context,
        created_at:       ep.createdAt,
        expires_at:       ep.expiresAt,
        profile:          ep.profile,
        enrollment_hash:  ep.enrollmentHash,
    }
}

function rowToApiKey(row: any): ApiKey {
    return {
        key:         row.key,
        name:        row.name,
        createdAt:   row.created_at,
        lastUsed:    row.last_used ?? undefined,
        active:      row.active,
        permissions: row.permissions ?? [],
        webhookUrl:  row.webhook_url ?? undefined,
    }
}

// ─── Assessments ──────────────────────────────────────────────────────────────

export async function getAssessments(): Promise<Assessment[]> {
    const sb = getClient()
    const { data, error } = await sb
        .from('dc_assessments')
        .select('*')
        .order('created_at', { ascending: false })
    if (error) { console.error('[db] getAssessments:', error.message); return [] }
    return (data ?? []).map(rowToAssessment)
}

export async function getAssessmentById(id: string): Promise<Assessment | null> {
    const sb = getClient()
    const { data, error } = await sb
        .from('dc_assessments')
        .select('*')
        .eq('id', id)
        .single()
    if (error) return null
    return data ? rowToAssessment(data) : null
}

export async function saveAssessment(assessment: Assessment): Promise<void> {
    const sb = getClient()
    const row = assessmentToRow(assessment)
    const { error } = await sb
        .from('dc_assessments')
        .upsert(row, { onConflict: 'id' })
    if (error) throw new Error(`[db] saveAssessment: ${error.message}`)
}

// ─── Enrollment Profiles ──────────────────────────────────────────────────────

export async function saveEnrollmentProfile(ep: EnrollmentProfile): Promise<void> {
    const sb = getClient()
    const { error } = await sb
        .from('dc_enrollment_profiles')
        .upsert(profileToRow(ep), { onConflict: 'id' })
    if (error) throw new Error(`[db] saveEnrollmentProfile: ${error.message}`)
}

export async function getProfileById(id: string): Promise<EnrollmentProfile | null> {
    const sb = getClient()
    const { data, error } = await sb
        .from('dc_enrollment_profiles')
        .select('*')
        .eq('id', id)
        .single()
    if (error) return null
    return data ? rowToProfile(data) : null
}

export async function getProfileByEmail(email: string): Promise<EnrollmentProfile | null> {
    const sb = getClient()
    const { data, error } = await sb
        .from('dc_enrollment_profiles')
        .select('*')
        .eq('candidate_email', email)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
    if (error) return null
    return data && data.length > 0 ? rowToProfile(data[0]) : null
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
    const sb = getClient()
    const { data, error } = await sb
        .from('dc_api_keys')
        .select('*')
        .eq('key', key)
        .eq('active', true)
        .single()
    if (error || !data) return null

    // Update last_used (fire and forget)
    sb.from('dc_api_keys').update({ last_used: new Date().toISOString() }).eq('key', key)

    return rowToApiKey(data)
}

export async function createApiKey(
    name: string,
    permissions: ApiKey['permissions'],
    webhookUrl?: string
): Promise<ApiKey> {
    const sb = getClient()
    const newKey: ApiKey = {
        key:         `dc_live_${crypto.randomBytes(24).toString('hex')}`,
        name,
        createdAt:   new Date().toISOString(),
        active:      true,
        permissions,
        webhookUrl,
    }
    const { error } = await sb.from('dc_api_keys').insert({
        key:         newKey.key,
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
    const sb = getClient()
    const { data, error } = await sb
        .from('dc_api_keys')
        .select('*')
        .order('created_at', { ascending: false })
    if (error) return []
    return (data ?? []).map(rowToApiKey)
}

// ─── initDb (no-op — schema managed via migrations) ──────────────────────────

export async function initDb(): Promise<void> {
    // Tables are managed by Supabase migrations. Nothing to do here.
}
