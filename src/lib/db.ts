import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

// ─── Paths ────────────────────────────────────────────────────────────────────
const DATA_DIR        = path.join(process.cwd(), 'data');
const DB_PATH         = path.join(DATA_DIR, 'assessments.json');
const PROFILES_PATH   = path.join(DATA_DIR, 'enrollment_profiles.json');
const APIKEYS_PATH    = path.join(DATA_DIR, 'api_keys.json');

// ─── Assessment ───────────────────────────────────────────────────────────────

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
    // Extended biometric fields
    livenessScore?: number
    aiRisk?: number
    keystrokeCount?: number
    tabSwitchCount?: number
    gazeEventCount?: number
    autoFlagged?: boolean
    // Enrollment comparison
    enrollmentProfileId?: string
    identityMatchScore?: number   // 0-100: how well session matches enrolled profile
    // Certificate
    sessionHash?: string          // SHA-256 of session data
    certificateIssued?: boolean
    // API integration
    externalRef?: string          // ID from external platform (LMS, ATS)
    webhookDelivered?: boolean
}

export async function getAssessments(): Promise<Assessment[]> {
    try {
        const data = await fs.readFile(DB_PATH, 'utf-8')
        return JSON.parse(data)
    } catch {
        return []
    }
}

export async function saveAssessment(assessment: Assessment): Promise<void> {
    const assessments = await getAssessments()
    const index = assessments.findIndex(a => a.id === assessment.id)
    if (index !== -1) {
        assessments[index] = assessment
    } else {
        assessments.push(assessment)
    }
    await fs.mkdir(DATA_DIR, { recursive: true })
    await fs.writeFile(DB_PATH, JSON.stringify(assessments, null, 2), 'utf-8')
}

export async function getAssessmentById(id: string): Promise<Assessment | null> {
    const assessments = await getAssessments()
    return assessments.find(a => a.id === id) ?? null
}

export async function initDb() {
    await fs.mkdir(DATA_DIR, { recursive: true })
    try { await fs.access(DB_PATH) } catch {
        const initialData: Assessment[] = [
            { id: '1', candidateName: 'Alex Rivera',   role: 'Senior React Dev',     date: '2026-02-18', score: 98, status: 'passed',  alerts: [], evidence: [], lastEvent: 'Session completed' },
            { id: '2', candidateName: 'Jordan Smith',  role: 'Fullstack Engineer',   date: '2026-02-18', score: 94, status: 'passed',  alerts: [], evidence: [], lastEvent: 'Session completed' },
            { id: '3', candidateName: 'Maria Garcia',  role: 'Backend Engineer',     date: '2026-02-17', score: 62, status: 'flagged', alerts: ['[14:30] Tab Switch Detected', '[14:35] Large Paste Detected'], evidence: [], lastEvent: 'Flagged for multiple violations' },
        ]
        await fs.writeFile(DB_PATH, JSON.stringify(initialData, null, 2), 'utf-8')
    }
}

// ─── Enrollment Profiles ──────────────────────────────────────────────────────

export type EnrollmentContext = 'prose_es' | 'prose_en' | 'code_python' | 'code_js' | 'code_general'

export interface KeystrokeProfile {
    // Global stats
    flightMean: number
    flightStd: number
    holdMean: number
    holdStd: number
    // Digram pairs (key-to-key latencies for frequent combos)
    digrams: Record<string, { mean: number; std: number; count: number }>
    // Entropy of flight-time histogram
    entropy: number
    // WPM range observed during enrollment
    wpmMin: number
    wpmMax: number
    // Keystroke count used for calibration
    sampleSize: number
}

export interface EnrollmentProfile {
    id: string
    candidateName: string
    candidateEmail: string
    context: EnrollmentContext
    createdAt: string
    expiresAt: string          // Profiles expire after 90 days
    profile: KeystrokeProfile
    enrollmentHash: string     // SHA-256 of the profile for tamper detection
}

async function getProfiles(): Promise<EnrollmentProfile[]> {
    try {
        const data = await fs.readFile(PROFILES_PATH, 'utf-8')
        return JSON.parse(data)
    } catch {
        return []
    }
}

async function saveProfiles(profiles: EnrollmentProfile[]): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true })
    await fs.writeFile(PROFILES_PATH, JSON.stringify(profiles, null, 2), 'utf-8')
}

export async function saveEnrollmentProfile(profile: EnrollmentProfile): Promise<void> {
    const profiles = await getProfiles()
    const idx = profiles.findIndex(p => p.id === profile.id)
    if (idx !== -1) profiles[idx] = profile
    else profiles.push(profile)
    await saveProfiles(profiles)
}

export async function getProfileById(id: string): Promise<EnrollmentProfile | null> {
    const profiles = await getProfiles()
    return profiles.find(p => p.id === id) ?? null
}

export async function getProfileByEmail(email: string): Promise<EnrollmentProfile | null> {
    const profiles = await getProfiles()
    // Return most recent non-expired profile for this email
    const now = new Date()
    return profiles
        .filter(p => p.candidateEmail === email && new Date(p.expiresAt) > now)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null
}

// ─── Identity Match Score ─────────────────────────────────────────────────────
// Compares a live session keystroke profile against an enrolled baseline.
// Returns 0-100 (100 = perfect match, <50 = likely different person)

export function computeIdentityMatch(
    live: Partial<KeystrokeProfile>,
    baseline: KeystrokeProfile
): number {
    const scores: number[] = []

    // Flight time mean similarity (within 30% = good)
    if (live.flightMean !== undefined && baseline.flightMean > 0) {
        const delta = Math.abs(live.flightMean - baseline.flightMean) / baseline.flightMean
        scores.push(Math.max(0, 1 - delta / 0.30) * 100)
    }

    // Flight std similarity (within 40%)
    if (live.flightStd !== undefined && baseline.flightStd > 0) {
        const delta = Math.abs(live.flightStd - baseline.flightStd) / baseline.flightStd
        scores.push(Math.max(0, 1 - delta / 0.40) * 100)
    }

    // Hold time mean similarity (within 35%)
    if (live.holdMean !== undefined && baseline.holdMean > 0) {
        const delta = Math.abs(live.holdMean - baseline.holdMean) / baseline.holdMean
        scores.push(Math.max(0, 1 - delta / 0.35) * 100)
    }

    // Entropy similarity (within 0.5 bits)
    if (live.entropy !== undefined) {
        const delta = Math.abs(live.entropy - baseline.entropy)
        scores.push(Math.max(0, 1 - delta / 0.5) * 100)
    }

    // Digram overlap score
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

// ─── Session Hash (SHA-256) ───────────────────────────────────────────────────
// Creates a tamper-evident fingerprint of the session data

export function computeSessionHash(assessment: Omit<Assessment, 'sessionHash' | 'certificateIssued'>): string {
    const payload = JSON.stringify({
        id: assessment.id,
        candidateName: assessment.candidateName,
        role: assessment.role,
        date: assessment.date,
        score: assessment.score,
        status: assessment.status,
        alertCount: assessment.alerts.length,
        keystrokeCount: assessment.keystrokeCount,
        aiRisk: assessment.aiRisk,
        tabSwitchCount: assessment.tabSwitchCount,
        gazeEventCount: assessment.gazeEventCount,
        livenessScore: assessment.livenessScore,
        identityMatchScore: assessment.identityMatchScore,
    })
    return crypto.createHash('sha256').update(payload).digest('hex')
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

export interface ApiKey {
    key: string          // dc_live_xxxxx
    name: string         // e.g. "Moodle LMS Integration"
    createdAt: string
    lastUsed?: string
    active: boolean
    permissions: ('read' | 'write' | 'webhook')[]
    webhookUrl?: string  // Optional webhook endpoint for this key
}

async function getApiKeys(): Promise<ApiKey[]> {
    try {
        const data = await fs.readFile(APIKEYS_PATH, 'utf-8')
        return JSON.parse(data)
    } catch {
        return []
    }
}

export async function validateApiKey(key: string): Promise<ApiKey | null> {
    const keys = await getApiKeys()
    const found = keys.find(k => k.key === key && k.active)
    if (found) {
        // Update lastUsed
        found.lastUsed = new Date().toISOString()
        await fs.writeFile(APIKEYS_PATH, JSON.stringify(keys, null, 2), 'utf-8')
    }
    return found ?? null
}

export async function createApiKey(name: string, permissions: ApiKey['permissions'], webhookUrl?: string): Promise<ApiKey> {
    const keys = await getApiKeys()
    const newKey: ApiKey = {
        key: `dc_live_${crypto.randomBytes(24).toString('hex')}`,
        name,
        createdAt: new Date().toISOString(),
        active: true,
        permissions,
        webhookUrl,
    }
    keys.push(newKey)
    await fs.mkdir(DATA_DIR, { recursive: true })
    await fs.writeFile(APIKEYS_PATH, JSON.stringify(keys, null, 2), 'utf-8')
    return newKey
}

export async function getApiKeysList(): Promise<ApiKey[]> {
    return getApiKeys()
}
