'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import styles from './page.module.css'
import { VerificationCameraHandle, VerificationFailureReason, GazeDirection, BlinkEvent, FaceMetrics, AntiCheatEvent } from '@/components/VerificationCamera'
import { BiometricEvent, CodeEditorHandle } from '@/components/CodeEditor'
import { extractFeatureVector } from '@/lib/biometricFeatures'
import { generateCertificatePDF } from '@/lib/generateCertificate'

// ─── Dynamic imports (client-only) ────────────────────────────────────────────

const VerificationCameraDynamic = dynamic(() => import('@/components/VerificationCamera'), {
    ssr: false,
    loading: () => (
        <div style={{ height: '240px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', borderRadius: '12px', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            Loading AI Models...
        </div>
    )
})

const CodeEditorDynamic = dynamic(() => import('@/components/CodeEditor'), {
    ssr: false,
    loading: () => (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
            Initializing Editor...
        </div>
    )
})

// ─── Types ────────────────────────────────────────────────────────────────────

interface AlertEntry {
    id: number
    timestamp: string
    message: string
    severity: 'low' | 'medium' | 'high'
    penalty: number
}

interface EvidenceEntry {
    timestamp: string
    image: string
    reason: string
}

interface Assessment {
    id: string
    candidateName: string
    role: string
    date: string
    score: number
    status: 'passed' | 'review' | 'flagged'
    alerts: AlertEntry[]
    evidence: EvidenceEntry[]
    lastEvent: string
    livenessScore: number
    aiRisk: number
    keystrokeCount: number
    tabSwitchCount: number
    gazeEventCount: number
    autoFlagged: boolean
    sessionHash: string
    certificateIssued: boolean
    identityMatchScore?: number
    blinkRate: number
    blinkCount: number
    avgBlinkDuration: number
    headSymmetryScore: number
    microMovementScore: number
    gazeStabilityScore: number
    faceBrightnessDelta: number
    lightingChallengesPassed: number
    lightingChallengesFailed: number
    saccadeScore: number
    blinkEdgeScore: number
    ocoloManualScore: number
    antiCheatFailures: number
    enrollmentProfileId?: string
    mlFlags?: unknown
}

// ─── Session Report ───────────────────────────────────────────────────────────

function SessionReport({ assessment, onRestart }: { assessment: Assessment; onRestart: () => void }) {
    const scoreColor = assessment.score > 85 ? 'var(--color-primary)' : assessment.score > 60 ? '#ffd700' : '#ff4d4d'
    const statusLabel = assessment.status === 'passed' ? 'PASSED' : assessment.status === 'review' ? 'UNDER REVIEW' : 'FLAGGED'
    const [exportingPDF, setExportingPDF] = React.useState(false)

    async function handleExportPDF() {
        setExportingPDF(true)
        try {
            await generateCertificatePDF({
                id: assessment.id,
                candidateName: assessment.candidateName,
                role: assessment.role,
                date: assessment.date,
                score: assessment.score,
                status: assessment.status,
                sessionHash: assessment.sessionHash ?? '—',
                livenessScore: assessment.livenessScore,
                aiRisk: assessment.aiRisk,
                keystrokeCount: assessment.keystrokeCount,
                tabSwitchCount: assessment.tabSwitchCount,
                gazeEventCount: assessment.gazeEventCount,
                identityMatchScore: assessment.identityMatchScore,
                alertCount: assessment.alerts?.length ?? 0,
                evidenceCount: assessment.evidence?.length ?? 0,
                enrollmentProfileId: assessment.enrollmentProfileId,
            })
        } finally {
            setExportingPDF(false)
        }
    }

    return (
        // ── Outer wrapper: full viewport, scrollable ──────────────────────────
        <div style={{
            minHeight: '100vh',
            width: '100%',
            overflowY: 'auto',
            padding: '40px 20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
        }}>
            {/* Card */}
            <div style={{
                width: '100%',
                maxWidth: '860px',
                background: 'var(--color-surface)',
                borderRadius: '24px',
                border: '1px solid var(--color-border)',
                padding: '52px 60px',
            }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
                    <div>
                        <h1 className="text-gradient" style={{ fontSize: '2.2rem', marginBottom: '6px' }}>Trust Certificate</h1>
                        <p style={{ color: 'var(--color-text-muted)', fontFamily: 'monospace', fontSize: '0.85rem' }}>ID: {assessment.id}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '3.2rem', fontWeight: 800, color: scoreColor, lineHeight: 1 }}>{assessment.score}%</div>
                        <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: '4px', color: scoreColor }}>
                            {statusLabel}
                        </div>
                    </div>
                </div>

                {/* Score bar */}
                <div style={{ background: 'rgba(255,255,255,0.06)', height: '6px', borderRadius: '4px', marginBottom: '40px' }}>
                    <div style={{ height: '100%', width: `${assessment.score}%`, background: scoreColor, borderRadius: '4px', transition: 'width 1s ease' }} />
                </div>

                {/* Tab-switch warning banner */}
                {assessment.tabSwitchCount >= 2 && (
                    <div style={{
                        background: 'rgba(255,77,77,0.12)', border: '1px solid rgba(255,77,77,0.4)',
                        borderRadius: '12px', padding: '16px 20px', marginBottom: '32px',
                        display: 'flex', alignItems: 'center', gap: '12px'
                    }}>
                        <span style={{ fontSize: '1.2rem' }}>⚑</span>
                        <div>
                            <div style={{ color: '#ff4d4d', fontWeight: 700, fontSize: '0.9rem' }}>AUTO-FLAGGED — Excessive Tab Switching</div>
                            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', marginTop: '2px' }}>
                                Candidate switched tabs {assessment.tabSwitchCount} times during the session. This assessment has been automatically flagged for review.
                            </div>
                        </div>
                    </div>
                )}

                {/* 2-col info grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '36px' }}>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '24px', borderRadius: '16px', border: '1px solid var(--color-border)' }}>
                        <h3 style={{ marginBottom: '14px', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-text-muted)' }}>Candidate Intelligence</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.9rem' }}>
                            <div><strong>Name:</strong> {assessment.candidateName}</div>
                            <div><strong>Role:</strong> {assessment.role}</div>
                            <div><strong>Session Date:</strong> {assessment.date}</div>
                            <div><strong>Session ID:</strong> <span style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{assessment.id}</span></div>
                            <div><strong>Tab Switches:</strong> <span style={{ color: assessment.tabSwitchCount >= 2 ? '#ff4d4d' : 'inherit' }}>{assessment.tabSwitchCount}</span></div>
                            <div><strong>Gaze Events:</strong> <span style={{ color: assessment.gazeEventCount > 3 ? '#ffd700' : 'inherit' }}>{assessment.gazeEventCount}</span></div>
                        </div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '24px', borderRadius: '16px', border: '1px solid var(--color-border)' }}>
                        <h3 style={{ marginBottom: '14px', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-text-muted)' }}>Behavioral Forensics</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.9rem' }}>
                            <div>• Liveness Signature: <span style={{ color: 'var(--color-primary)' }}>VERIFIED</span></div>
                            <div>• Eye Gaze: <span style={{ color: assessment.gazeEventCount > 5 ? '#ff4d4d' : assessment.gazeEventCount > 2 ? '#ffd700' : 'var(--color-primary)' }}>
                                {assessment.gazeEventCount > 5 ? 'HIGH DIVERSION' : assessment.gazeEventCount > 2 ? 'MODERATE' : 'CLEAN'}
                            </span></div>
                            <div>• Keystroke DNA: <span style={{ color: assessment.alerts.some((a: AlertEntry) => (a.message || a).toString().includes('Inconsistency') || (a.message || a).toString().includes('Rhythm')) ? '#ffd700' : 'var(--color-primary)' }}>
                                {assessment.alerts.some((a: AlertEntry) => (a.message || a).toString().includes('Inconsistency') || (a.message || a).toString().includes('Rhythm')) ? 'ANOMALIES DETECTED' : 'CONSISTENT'}
                            </span></div>
                            <div>• Clipboard: <span style={{ color: assessment.alerts.some((a: AlertEntry) => (a.message || a).toString().includes('Paste')) ? '#ff4d4d' : 'var(--color-primary)' }}>
                                {assessment.alerts.some((a: AlertEntry) => (a.message || a).toString().includes('Paste')) ? 'FLAGGED' : 'CLEAN'}
                            </span></div>
                            <div>• AI-Assist Risk: <span style={{ color: (assessment.aiRisk ?? 0) > 50 ? '#ff4d4d' : 'var(--color-primary)' }}>
                                {(assessment.aiRisk ?? 0) > 50 ? `ELEVATED (${assessment.aiRisk}%)` : 'LOW'}
                            </span></div>
                            {assessment.blinkRate > 0 && (
                                <div>• Blink Rate: <span style={{ color: (assessment.blinkRate < 5 || assessment.blinkRate > 40) ? '#ffd700' : 'var(--color-primary)' }}>
                                    {assessment.blinkRate}/min {assessment.blinkCount > 0 ? `(${assessment.blinkCount} blinks)` : ''}
                                </span></div>
                            )}
                            {assessment.gazeStabilityScore > 0 && (
                                <div>• Gaze Stability: <span style={{ color: assessment.gazeStabilityScore < 50 ? '#ffd700' : 'var(--color-primary)' }}>
                                    {assessment.gazeStabilityScore}%
                                </span></div>
                            )}
                            {assessment.alerts.some((a: AlertEntry) => (a.message || a).toString().includes('Cross-modal')) && (
                                <div>• Cross-modal: <span style={{ color: '#ffd700' }}>TYPING WHILE LOOKING AWAY</span></div>
                            )}
                            {(assessment.lightingChallengesPassed + assessment.lightingChallengesFailed) > 0 && (
                                <div>• Lighting Challenges: <span style={{ color: assessment.lightingChallengesFailed > 0 ? '#ff4d4d' : 'var(--color-primary)' }}>
                                    {assessment.lightingChallengesPassed}✓ / {assessment.lightingChallengesFailed}✗
                                    {assessment.lightingChallengesFailed > 0 ? ' — DEEPFAKE SIGNAL' : ' — HUMAN REFLEX'}
                                </span></div>
                            )}
                            {assessment.saccadeScore > 0 && (
                                <div>• Micro-saccades: <span style={{ color: assessment.saccadeScore < 20 ? '#ff4d4d' : assessment.saccadeScore < 50 ? '#ffd700' : 'var(--color-primary)' }}>
                                    {assessment.saccadeScore < 20 ? `${assessment.saccadeScore}/100 — UNNATURAL (AI renderer)` :
                                     assessment.saccadeScore < 50 ? `${assessment.saccadeScore}/100 — SUSPICIOUS` :
                                     `${assessment.saccadeScore}/100 — NATURAL`}
                                </span></div>
                            )}
                            {assessment.blinkEdgeScore > 0 && (
                                <div>• Blink Edge: <span style={{ color: assessment.blinkEdgeScore < 40 ? '#ff4d4d' : 'var(--color-primary)' }}>
                                    {assessment.blinkEdgeScore < 40 ? `${assessment.blinkEdgeScore}/100 — ARTIFACT` : `${assessment.blinkEdgeScore}/100 — CLEAN`}
                                </span></div>
                            )}
                            {assessment.antiCheatFailures > 0 && (
                                <div>• Anti-Cheat Fails: <span style={{ color: assessment.antiCheatFailures >= 2 ? '#ff4d4d' : '#ffd700' }}>
                                    {assessment.antiCheatFailures} challenge{assessment.antiCheatFailures > 1 ? 's' : ''} failed
                                </span></div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Incident Timeline — no maxHeight, fully expanded */}
                <div style={{ marginBottom: '36px' }}>
                    <h3 style={{ marginBottom: '14px' }}>Incident Timeline ({assessment.alerts.length} events)</h3>
                    {assessment.alerts.length === 0 ? (
                        <p style={{ color: 'var(--color-primary)', opacity: 0.7, fontSize: '0.9rem' }}>No security incidents recorded.</p>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {assessment.alerts.map((alert: AlertEntry | string, idx: number) => {
                                const msg = typeof alert === 'string' ? alert : alert.message
                                const sev = typeof alert === 'object' ? alert.severity : 'medium'
                                const sevColor = sev === 'high' ? '#ff4d4d' : sev === 'medium' ? '#ffd700' : '#aaa'
                                return (
                                    <div key={idx} style={{ padding: '10px 16px', background: 'rgba(255,77,77,0.05)', borderLeft: `3px solid ${sevColor}`, borderRadius: '4px', fontSize: '0.85rem', display: 'flex', gap: '12px' }}>
                                        <span style={{ color: sevColor, fontWeight: 700, textTransform: 'uppercase', fontSize: '0.7rem', whiteSpace: 'nowrap', minWidth: '52px' }}>{sev}</span>
                                        <span style={{ color: 'var(--color-text-muted)' }}>{msg}</span>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                {/* Evidence gallery */}
                {assessment.evidence?.length > 0 && (
                    <div style={{ marginBottom: '36px' }}>
                        <h3 style={{ marginBottom: '14px' }}>Forensic Evidence ({assessment.evidence.length} captures)</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px' }}>
                            {assessment.evidence.map((ev: EvidenceEntry, i: number) => (
                                <div key={i} style={{ background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '10px', border: '1px solid var(--color-border)' }}>
                                    <img src={ev.image} alt={ev.reason} style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: '6px', marginBottom: '8px' }} />
                                    <div style={{ fontSize: '0.75rem', color: '#ff4d4d', fontWeight: 600 }}>{ev.reason}</div>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{ev.timestamp}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Session hash — tamper-evident fingerprint */}
                {assessment.sessionHash && (
                    <div style={{
                        background: 'rgba(0,212,127,0.05)', border: '1px solid rgba(0,212,127,0.18)',
                        borderRadius: '12px', padding: '16px 20px', marginBottom: '28px',
                    }}>
                        <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-primary)', marginBottom: '8px' }}>
                            Session Integrity Hash (SHA-256)
                        </div>
                        <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', wordBreak: 'break-all', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                            {assessment.sessionHash}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '8px' }}>
                            Fingerprint criptográfico de esta sesión. Verifica que los datos no han sido alterados.
                        </div>
                    </div>
                )}

                <div style={{ display: 'flex', gap: '16px', paddingTop: '8px', flexWrap: 'wrap' }}>
                    <Link href="/dashboard" className="btn btn-primary">Go to Dashboard</Link>
                    <button onClick={handleExportPDF} className="btn btn-outline" disabled={exportingPDF}>
                        {exportingPDF ? 'Generando PDF...' : '↓ Exportar Certificado PDF'}
                    </button>
                    <button onClick={onRestart} className="btn btn-outline">Start New Session</button>
                </div>
            </div>
        </div>
    )
}

// ─── Main Interview Page ──────────────────────────────────────────────────────

const PROMPT_ID = `#${Math.floor(1000 + Math.random() * 9000)}`

export default function InterviewPage() {
    const [isVerified, setIsVerified]             = useState(false)
    const [livenessScore, setLivenessScore]       = useState(0)
    const [trustScore, setTrustScore]             = useState(100)
    const [alerts, setAlerts]                     = useState<AlertEntry[]>([])
    const [isSaving, setIsSaving]                 = useState(false)
    const [sessionEnded, setSessionEnded]         = useState(false)
    const [lastAssessment, setLastAssessment]     = useState<Assessment | null>(null)
    const [evidence, setEvidence]                 = useState<EvidenceEntry[]>([])
    // GDPR consent gate — session cannot start until candidate consents
    const [biometricConsent, setBiometricConsent] = useState(false)
    // Lighting Challenge state (controls the screen flash overlay and camera prop)
    const [lightingChallenge, setLightingChallenge] = useState(false)

    const [liveMetrics, setLiveMetrics] = useState({
        keystrokeCount: 0,
        aiRisk: 0,
        pasteCount: 0,
        anomalyCount: 0,
        typingActive: false,
    })

    const alertIdRef       = useRef(0)
    const trustScoreRef    = useRef(100)
    const tabSwitchCount   = useRef(0)   // ← persists across renders without re-render cost
    const gazeEventCount   = useRef(0)
    const cameraRef        = useRef<VerificationCameraHandle>(null)
    const codeEditorRef    = useRef<CodeEditorHandle>(null)

    // ── Event rate controls ───────────────────────────────────────────────────
    const cameraAlertLastRef = useRef<Record<string, number>>({})
    const sessionStartMsRef  = useRef<number>(Date.now())
    const lastBlurAlertRef   = useRef<number>(0)
    const _CAC = 8000
    const _SGP = 7000

    // ── Multi-modal correlation state ─────────────────────────────────────────
    const currentGazeRef          = useRef<GazeDirection>('center')
    const lastTypingTimeRef       = useRef<number>(0)
    const lastCrossModalAlertRef  = useRef<number>(0)
    const faceMetricsRef          = useRef<FaceMetrics | null>(null)
    const blinkAnomalyCountRef    = useRef<number>(0)

    const gazeShiftHistoryRef     = useRef<{ ts: number; direction: GazeDirection }[]>([])
    const gazeLeadSamplesRef      = useRef<number[]>([])
    const lastSpectatorAlertRef   = useRef<number>(0)
    const _SPT = 150
    const _SPM = 30
    const _SPW = 10
    // Oculo-manual synchrony — track cursor movement in editor
    const cursorActivityRef       = useRef<number>(0)  // last timestamp of cursor move
    const ocoloDesyncCountRef     = useRef<number>(0)
    const lastOculoAlertRef       = useRef<number>(0)
    // Anti-cheat challenge counters
    const lcPassedRef             = useRef<number>(0)
    const lcFailedRef             = useRef<number>(0)
    const acFailedTotalRef        = useRef<number>(0)

    useEffect(() => { trustScoreRef.current = trustScore }, [trustScore])

    // ── Evidence capture ──────────────────────────────────────────────────────
    const captureEvidence = useCallback((reason: string) => {
        const snapshot = cameraRef.current?.takeSnapshot()
        if (snapshot) {
            setEvidence(prev => [...prev, {
                timestamp: new Date().toLocaleTimeString(),
                image: snapshot,
                reason,
            }].slice(-8))
        }
    }, [])

    // ── Add alert helper ──────────────────────────────────────────────────────
    const addAlert = useCallback((message: string, severity: AlertEntry['severity'], penalty: number, captureReason?: string) => {
        const timestamp = new Date().toLocaleTimeString()
        const id = ++alertIdRef.current
        setAlerts(prev => [{ id, timestamp, message: `[${timestamp}] ${message}`, severity, penalty }, ...prev].slice(0, 30))
        setTrustScore(prev => Math.max(0, prev - penalty))
        if (captureReason) captureEvidence(captureReason)
    }, [captureEvidence])

    const recoverTrust = useCallback((points: number) => {
        setTrustScore(prev => Math.min(100, prev + points))
    }, [])

    // ── Camera: head pose / verification ─────────────────────────────────────
    const handleVerificationChange = useCallback((verified: boolean, type?: VerificationFailureReason) => {
        setIsVerified(verified)
        if (!verified && type) {
            const now = Date.now()

            // Grace period: no camera penalties for the first _SGP of the session
            const msSinceStart = now - sessionStartMsRef.current
            if (msSinceStart < _SGP) return

            const cooldown = type === 'Head Tilted' ? 30000 : _CAC
            const lastFired = cameraAlertLastRef.current[type] ?? 0
            if (now - lastFired < cooldown) return
            cameraAlertLastRef.current[type] = now

            if (type === 'Gaze Divergence') {
                addAlert('Head turned away from screen', 'medium', 5, 'Head Turn')
            } else if (type === 'Eye Gaze Detected') {
                // Eye gaze events are rate-limited inside handleGazeEvent
            } else if (type === 'Head Tilted') {
                addAlert('Head pose anomaly detected', 'low', 2)
            } else if (type === 'Multiple faces detected') {
                addAlert('Multiple faces in frame — possible proxy attempt', 'high', 15, 'Multiple Faces')
            } else if (type === 'No face detected') {
                addAlert('Candidate left camera view', 'medium', 5, 'Face Lost')
            }
        }
    }, [addAlert])

    const handleLivenessScore = useCallback((score: number) => {
        setLivenessScore(score)
    }, [])

    // ── Gaze events — rate-limited (max 1 alert per 4s per direction) ─────────
    const lastGazeAlertRef = useRef<Record<string, number>>({})

    const handleGazeEvent = useCallback((direction: GazeDirection) => {
        const now = Date.now()
        const prevDirection = currentGazeRef.current
        currentGazeRef.current = direction

        // Record every gaze direction change for temporal correlation analysis.
        // We track shifts between any two distinct directions (including center↔off).
        if (direction !== prevDirection) {
            gazeShiftHistoryRef.current.push({ ts: now, direction })
            if (gazeShiftHistoryRef.current.length > 20) gazeShiftHistoryRef.current.shift()
        }

        if (direction === 'center' || direction === 'unknown') return

        const lastTime = lastGazeAlertRef.current[direction] ?? 0
        if (now - lastTime < 4000) return

        lastGazeAlertRef.current[direction] = now
        gazeEventCount.current += 1

        const dirLabel = direction === 'left' ? 'left (possible second screen)' : direction === 'right' ? 'right (possible second screen)' : direction
        addAlert(`Eye gaze detected — looking ${dirLabel}`, 'medium', 4, `Eye Gaze ${direction}`)
    }, [addAlert])

    // ── Blink events ───────────────────────────────────────────────────────────
    const handleBlinkEvent = useCallback((event: BlinkEvent) => {
        if (event.type === 'blink_rate_anomaly') {
            blinkAnomalyCountRef.current += 1
            // Blink frequency varies widely between individuals and conditions.
            // Only alert after 3 consecutive anomalous minutes (sustained pattern),
            // or immediately for extreme values (< 1/min = very likely no live face).
            // Counter does NOT reset after alerting — it keeps growing so we don't
            // re-enter the "almost there" zone and fire again quickly.
            const isExtreme = event.blinkRate !== undefined && event.blinkRate < 1
            if (isExtreme || blinkAnomalyCountRef.current >= 3) {
                addAlert(
                    `Blink rate anomaly: ${event.blinkRate}/min — ${event.detail ?? 'unusual blink pattern'}`,
                    'medium', 4   // reduced from 8: glasses/angle can suppress EAR below threshold
                )
                // Reset only to 2 so the next minute doesn't immediately re-trigger,
                // but a continued anomaly (count reaches 3 again) will alert once more.
                blinkAnomalyCountRef.current = 2
            }
        } else if (event.type === 'prolonged_closure') {
            addAlert(`Eyes closed ${Math.round((event.blinkDurationMs ?? 0) / 1000 * 10) / 10}s — attention check`,
                'low', 3)
        }
    }, [addAlert])

    // ── Face metrics stream ────────────────────────────────────────────────────
    const handleFaceMetrics = useCallback((metrics: FaceMetrics) => {
        faceMetricsRef.current = metrics
    }, [])

    // ── Anti-cheat event handler ──────────────────────────────────────────────
    const handleAntiCheatEvent = useCallback((event: AntiCheatEvent) => {
        switch (event.type) {
            case 'lighting_challenge_fail':
                lcFailedRef.current++
                acFailedTotalRef.current++
                addAlert(
                    `Lighting challenge FAILED — no pupil/lid reflex detected (ΔEAR ${event.detail?.match(/[\d.]+/)?.[0] ?? '?'}) — possible deepfake`,
                    'high', 20, 'Lighting Fail'
                )
                break
            case 'lighting_challenge_pass':
                lcPassedRef.current++
                // Lighting pass = confirmed live pupil reflex. Recover up to 10pts from any
                // earlier suspicion (saccade_too_smooth, lighting_fail, etc.) — capped at 100.
                recoverTrust(10)
                break
            case 'saccade_detected':
                // Natural micro-saccades confirmed. If a saccade_too_smooth fired before this,
                // the penalty was premature — recover 8pts (partial, not full 15 recovery).
                // This is intentional: if BOTH smooth and natural frames occurred, the net
                // behavior is mildly suspicious, not completely clean.
                recoverTrust(8)
                break
            case 'saccade_too_smooth':
                acFailedTotalRef.current++
                // Severity downgraded: camera-based saccade detection has inherent
                // noise from lighting, glasses, and focus intensity. We now require
                // 3 consecutive detections before this fires, so when it does it
                // represents ~30s of sustained pathological smoothness — which is
                // still meaningful but not conclusive alone. Use medium severity
                // and a lower penalty; corroborate with other signals.
                addAlert(
                    `Gaze unnaturally smooth — sustained micro-saccade absence (3 readings).`,
                    'medium', 8
                )
                break
            case 'blink_edge_artifact':
                acFailedTotalRef.current++
                addAlert(
                    `Blink eyelid artifact — snap-close or unnatural symmetry. ${event.detail ?? ''}`,
                    'medium', 10
                )
                break
            case 'oculo_manual_desynced':
                acFailedTotalRef.current++
                ocoloDesyncCountRef.current++
                addAlert(
                    `Oculo-manual desync — cursor moving but gaze frozen. Possible virtual camera or screen-share cheat.`,
                    'high', 12
                )
                break
            case 'oculo_manual_synced':
                // Gaze-cursor correlation confirmed — small recovery for false oculo desync
                recoverTrust(4)
                break
        }
    }, [addAlert, recoverTrust])

    // ── Lighting Challenge scheduler ──────────────────────────────────────────
    // Fires a random bright flash every 45–90 seconds after session start.
    // The flash lasts 500ms. Camera component reads lightingChallengeActive prop.
    useEffect(() => {
        let timeoutId: ReturnType<typeof setTimeout>
        const scheduleNext = () => {
            const delay = 45000 + Math.random() * 45000  // 45–90s
            timeoutId = setTimeout(() => {
                // Trigger flash
                setLightingChallenge(true)
                setTimeout(() => {
                    setLightingChallenge(false)
                    scheduleNext()
                }, 500)  // Flash duration: 500ms
            }, delay)
        }
        // First challenge after 30s
        const first = setTimeout(() => {
            setLightingChallenge(true)
            setTimeout(() => { setLightingChallenge(false); scheduleNext() }, 500)
        }, 30000)

        return () => { clearTimeout(first); clearTimeout(timeoutId) }
    }, [])

    // ── Oculo-Manual Synchrony tracker ────────────────────────────────────────
    // Every 5 seconds, check if the editor cursor has been moving (user is typing)
    // but gaze has been frozen in center (ratio variance too low = looking at fixed point).
    // This catches: virtual camera showing a pre-recorded face while human looks at notes.
    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now()
            const typingRecently = now - lastTypingTimeRef.current < 5000
            const gazeOff = currentGazeRef.current !== 'center' && currentGazeRef.current !== 'unknown'
            const faceMetrics = faceMetricsRef.current

            if (!typingRecently || !faceMetrics) return

            // Saccade score too low while actively typing = gaze is frozen (pre-recorded video).
            // Threshold lowered from < 15 to < 10: score 10–15 can occur naturally when a
            // human is deeply focused on the screen and barely moves their eyes.
            // Cooldown raised from 15s to 45s: this is a strong but rare signal — firing
            // every 15s created excessive trust-score damage for legitimate users.
            if (faceMetrics.saccadeScore < 10 && now - lastOculoAlertRef.current > 45000) {
                lastOculoAlertRef.current = now
                handleAntiCheatEvent({
                    type: 'oculo_manual_desynced',
                    confidence: 1 - faceMetrics.saccadeScore / 10,
                    detail: `Saccade score ${faceMetrics.saccadeScore}/100 while typing — gaze frozen`,
                    timestamp: now
                })
            }
        }, 5000)
        return () => clearInterval(interval)
    }, [handleAntiCheatEvent])

    // ── Keyboard biometric events ─────────────────────────────────────────────
    const handleBiometricEvent = useCallback((event: BiometricEvent) => {
        switch (event.type) {
            case 'keystroke': {
                const now = Date.now()
                setLiveMetrics(prev => ({ ...prev, typingActive: true, keystrokeCount: prev.keystrokeCount + 1 }))
                lastTypingTimeRef.current = now

                // ── Cross-modal: typing while gaze is off-screen ───────────
                const gaze = currentGazeRef.current
                if (gaze !== 'center' && gaze !== 'unknown') {
                    if (now - lastCrossModalAlertRef.current > 8000) {
                        lastCrossModalAlertRef.current = now
                        addAlert(
                            `Cross-modal anomaly — typing while looking ${gaze} (possible external source)`,
                            'medium', 6
                        )
                    }
                }

                const history = gazeShiftHistoryRef.current
                if (history.length > 0) {
                    const lastShift = history[history.length - 1]
                    const delta = now - lastShift.ts
                    if (delta < 2000) {
                        gazeLeadSamplesRef.current.push(delta)
                        if (gazeLeadSamplesRef.current.length > 50) gazeLeadSamplesRef.current.shift()
                    }
                }
                const samples = gazeLeadSamplesRef.current
                if (samples.length >= _SPM) {
                    const recent = samples.slice(-_SPW)
                    const sorted = [...recent].sort((a, b) => a - b)
                    const median = sorted[Math.floor(sorted.length / 2)]
                    const allReactive = recent.every(d => d > _SPT)
                    if (allReactive && median > _SPT) {
                        if (now - lastSpectatorAlertRef.current > 30000) {
                            lastSpectatorAlertRef.current = now
                            addAlert(
                                `Sync-Check: gaze follows keystrokes reactively (${Math.round(median)}ms lag) — spectator pattern detected`,
                                'high', 15
                            )
                        }
                    }
                }
                break
            }
            case 'paste': {
                const penalty = event.length! > 200 ? 20 : event.length! > 50 ? 12 : 5
                const sev: AlertEntry['severity'] = event.length! > 200 ? 'high' : event.length! > 50 ? 'medium' : 'low'
                addAlert(`Clipboard paste — ${event.length} chars`, sev, penalty, event.length! > 50 ? 'Large Paste' : undefined)
                setLiveMetrics(prev => ({ ...prev, pasteCount: prev.pasteCount + 1 }))
                break
            }
            case 'burst':
                addAlert('AI-assisted input — inhuman keystroke burst', 'high', 20, 'AI Burst')
                setLiveMetrics(prev => ({ ...prev, aiRisk: Math.min(100, prev.aiRisk + 20) }))
                break
            case 'inconsistency':
                addAlert(`Typing anomaly — Z-score ${event.zScore?.toFixed(1)}σ (key: ${event.key})`, 'medium', 5)
                setLiveMetrics(prev => ({ ...prev, anomalyCount: prev.anomalyCount + 1 }))
                break
            case 'rhythm_shift':
                addAlert('Sustained typing rhythm shift — possible user substitution', 'medium', 8, 'Rhythm Shift')
                setLiveMetrics(prev => ({ ...prev, anomalyCount: prev.anomalyCount + 1 }))
                break
            case 'long_pause':
                addAlert(`Extended pause (${((event.flightTime || 0) / 1000).toFixed(1)}s) — attention drift`, 'low', 2)
                break
            case 'ai_score_update':
                setLiveMetrics(prev => ({ ...prev, aiRisk: event.aiScore ?? prev.aiRisk }))
                if ((event.aiScore ?? 0) > 70 && liveMetrics.aiRisk <= 70) {
                    addAlert(`AI probability elevated to ${event.aiScore}%`, 'high', 5)
                }
                break
            case 'content_injection': {
                const isDragDrop = event.detail?.toLowerCase().includes('drag')
                const label = isDragDrop
                    ? `Drag & drop detected — ${event.length ?? 0} chars inserted`
                    : `Programmatic content injection — ${event.detail ?? `+${event.length} chars without typing`}`
                const captureLabel = isDragDrop ? 'Drag & Drop' : 'Code Injection'
                addAlert(label, 'high', isDragDrop ? 20 : 25, captureLabel)
                setLiveMetrics(prev => ({ ...prev, pasteCount: prev.pasteCount + 1 }))
                break
            }
            case 'drag_drop':
                addAlert(
                    `Drag & drop detected — ${event.length ?? 0} chars inserted`,
                    'high', 20, 'Drag & Drop'
                )
                setLiveMetrics(prev => ({ ...prev, pasteCount: prev.pasteCount + 1 }))
                break
            case 'backspace_anomaly':
                addAlert(
                    `Backspace pattern anomaly — ${event.detail ?? 'inhuman correction uniformity'}`,
                    'medium', 8
                )
                break
            case 'fft_periodicity':
                addAlert(
                    `Periodic keystroke rhythm detected — ${event.periodicityScore}% spectral dominance (bot signature)`,
                    'high', 15
                )
                setLiveMetrics(prev => ({ ...prev, aiRisk: Math.min(100, prev.aiRisk + 15) }))
                break
            case 'fatigue_detected':
                // No fatigue over 80+ keystrokes = suspicious (bots don't tire)
                addAlert(
                    `No typing fatigue detected after ${event.detail?.match(/\d+/)?.[0] ?? '80'}+ keystrokes — bot-like consistency`,
                    'medium', 8
                )
                break
        }
    }, [addAlert, liveMetrics.aiRisk])

    // ── Visibility / focus + tab switch counter ───────────────────────────────
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.hidden) {
                tabSwitchCount.current += 1
                const count = tabSwitchCount.current
                const penalty = count >= 3 ? 15 : 10

                if (count === 2) {
                    // Trigger automatic flag
                    addAlert(
                        `Tab switch #${count} — session will be AUTO-FLAGGED (threshold reached)`,
                        'high', penalty, 'Tab Switch'
                    )
                } else if (count > 2) {
                    addAlert(`Tab switch #${count} — session FLAGGED`, 'high', penalty, 'Tab Switch')
                } else {
                    addAlert(`Tab switched — candidate left assessment window (${count}/2)`, 'high', penalty, 'Tab Switch')
                }
            }
        }
        const handleBlur = () => {
            // If tab is hidden, visibilitychange already handled it — avoid double penalty
            if (document.hidden) return
            const now = Date.now()
            // Same startup grace as camera alerts: no blur penalties for the first 7s
            if (now - sessionStartMsRef.current < _SGP) return
            // Rate-limit: max 1 blur alert per 10 seconds
            if (now - lastBlurAlertRef.current < 10000) return
            lastBlurAlertRef.current = now
            addAlert('Window focus lost — candidate switched application', 'medium', 3, 'Focus Lost')
        }

        const isExtended = (window.screen as Screen & { isExtended?: boolean }).isExtended || (window.screen.availWidth > window.screen.width * 1.5)
        if (isExtended) {
            addAlert('Extended display detected — dual monitor environment', 'low', 0)
        }

        document.addEventListener('visibilitychange', handleVisibilityChange)
        window.addEventListener('blur', handleBlur)
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange)
            window.removeEventListener('blur', handleBlur)
        }
    }, [addAlert])

    // ── End session ───────────────────────────────────────────────────────────
    const handleEndSession = async () => {
        setIsSaving(true)
        const tabSwitches   = tabSwitchCount.current
        const gazeEvents    = gazeEventCount.current

        const _aH = alerts.filter(a => a.severity === 'high'   && a.penalty > 0)
        const _aM = alerts.filter(a => a.severity === 'medium'  && a.penalty > 0)
        const _aL = alerts.filter(a => a.severity === 'low'     && a.penalty > 0)
        const _wp =
            _aH.reduce((s, a) => s + a.penalty, 0) +
            _aM.reduce((s, a) => s + Math.min(a.penalty, 6), 0) +
            _aL.reduce((s, a) => s + Math.min(a.penalty, 3), 0)
        const finalScore = Math.max(trustScoreRef.current, Math.max(0, 100 - _wp))

        const autoFlagged   = tabSwitches >= 2
        const status: 'passed' | 'review' | 'flagged' = autoFlagged ? 'flagged' : finalScore > 85 ? 'passed' : finalScore > 60 ? 'review' : 'flagged'

        const sessionId = Math.random().toString(36).substr(2, 9)
        const sessionDate = new Date().toISOString().split('T')[0]

        // Compute SHA-256 hash client-side using Web Crypto API
        const hashPayload = JSON.stringify({
            id: sessionId, candidateName: 'Remote Candidate', role: 'Software Engineer',
            date: sessionDate, score: finalScore, status,
            alertCount: alerts.length, keystrokeCount: liveMetrics.keystrokeCount,
            aiRisk: liveMetrics.aiRisk, tabSwitchCount: tabSwitches,
            gazeEventCount: gazeEvents, livenessScore,
        })
        let sessionHash = ''
        try {
            const msgBuffer = new TextEncoder().encode(hashPayload)
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
            sessionHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
        } catch { /* fallback: no hash */ }

        const fm = faceMetricsRef.current

        // ── ML scoring: get session data from editor and run ONNX inference ───
        let mlAiRisk = liveMetrics.aiRisk
        let mlIdentityMatchScore: number | undefined
        let mlFlags: string[] = []

        try {
            const rawSessionData = codeEditorRef.current?.getSessionData()
            if (rawSessionData && rawSessionData.flightTimes.length >= 20) {
                const { raw } = extractFeatureVector(rawSessionData)

                const mlRes = await fetch('/api/ml-score', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        features: {
                            flightMean:          raw.flight_mean,
                            flightStd:           raw.flight_std,
                            holdMean:            raw.hold_mean,
                            holdStd:             raw.hold_std,
                            entropy:             raw.flight_entropy,
                            skewness:            raw.flight_skewness,
                            kurtosis:            raw.flight_kurtosis,
                            periodicityScore:    raw.periodicity_score,
                            velocityGradient:    raw.velocity_gradient,
                            fatigueRate:         raw.fatigue_rate,
                            rhythmConsistency:   raw.rhythm_consistency,
                            impossibleFastRatio: raw.impossible_fast_ratio,
                            digramCvMean:        raw.digram_cv_mean,
                            backspaceLatencyStd: raw.backspace_latency_std,
                            backspaceCountRatio: raw.backspace_count_ratio,
                            burstCountPer100k:   raw.burst_count_per_100k,
                            sessionWpm:          raw.session_wpm,
                        },
                        totalKeystrokes: rawSessionData.totalKeystrokes,
                    }),
                })

                if (mlRes.ok) {
                    const mlJson = await mlRes.json()
                    if (mlJson.success) {
                        mlAiRisk = mlJson.mlAiRisk ?? mlAiRisk
                        mlIdentityMatchScore = mlJson.identityMatchScore ?? undefined
                        mlFlags = mlJson.flags ?? []
                        // Add ML flags as alerts if significant
                        if (mlJson.mlAiRisk > 70) {
                            const ts = new Date().toLocaleTimeString()
                            setAlerts(prev => [{
                                id: Date.now(),
                                timestamp: ts,
                                message: `[${ts}] 🤖 ML Bot Detection: ${mlJson.mlAiRisk}% risk (${mlJson.inferenceMethod})`,
                                severity: 'high' as const,
                                penalty: 0,
                            }, ...prev].slice(0, 10))
                        }
                    }
                }
            }
        } catch (mlErr) {
            console.warn('[interview] ML scoring failed (non-fatal):', mlErr)
        }

        const assessment = {
            id: sessionId,
            candidateName: 'Remote Candidate',
            role: 'Software Engineer',
            date: sessionDate,
            score: finalScore,
            status,
            alerts,
            evidence,
            lastEvent: alerts[0]?.message || 'Session ended cleanly',
            livenessScore,
            aiRisk: mlAiRisk,
            keystrokeCount: liveMetrics.keystrokeCount,
            tabSwitchCount: tabSwitches,
            gazeEventCount: gazeEvents,
            autoFlagged,
            sessionHash,
            certificateIssued: true,
            identityMatchScore: mlIdentityMatchScore,
            // Enhanced biometric fields
            blinkRate: fm?.blinkRate ?? 0,
            blinkCount: fm?.blinkCount ?? 0,
            avgBlinkDuration: fm?.avgBlinkDuration ?? 0,
            headSymmetryScore: fm?.headSymmetryScore ?? 0,
            microMovementScore: fm?.microMovementScore ?? 0,
            gazeStabilityScore: fm?.gazeStabilityScore ?? 0,
            faceBrightnessDelta: fm?.faceBrightnessDelta ?? 0,
            // Anti-cheat challenge results
            lightingChallengesPassed: lcPassedRef.current,
            lightingChallengesFailed: lcFailedRef.current,
            saccadeScore: fm?.saccadeScore ?? 0,
            blinkEdgeScore: fm?.blinkEdgeScore ?? 0,
            ocoloManualScore: fm?.ocoloManualScore ?? 0,
            antiCheatFailures: acFailedTotalRef.current,
            // ML flags
            mlFlags,
        }

        try {
            await fetch('/api/assessments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(assessment),
            })
        } catch (e) {
            console.error('Failed to save:', e)
        } finally {
            setLastAssessment(assessment)
            setSessionEnded(true)
            setIsSaving(false)
        }
    }

    // ── Render: session ended ─────────────────────────────────────────────────
    if (sessionEnded && lastAssessment) {
        return (
            <div style={{ minHeight: '100vh', background: 'var(--color-bg)', overflowY: 'auto' }}>
                <SessionReport assessment={lastAssessment} onRestart={() => window.location.reload()} />
            </div>
        )
    }

    // ── Render: GDPR consent gate ─────────────────────────────────────────────
    if (!biometricConsent) {
        return (
            <div style={{ minHeight: '100vh', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
                <div style={{ maxWidth: 540, background: '#0d0d1f', border: '1px solid #1e1e3a', borderRadius: 16, padding: '40px 36px', textAlign: 'center' }}>
                    <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
                    <h2 style={{ fontSize: '1.3rem', color: '#e0e0e0', marginBottom: 12, fontFamily: 'monospace' }}>
                        Consentimiento de datos biométricos
                    </h2>
                    <p style={{ fontSize: '0.88rem', color: '#666', lineHeight: 1.7, marginBottom: 24 }}>
                        Esta sesión analiza en tiempo real:
                        <br /><strong style={{ color: '#aaa' }}>patrones de escritura (dinámica de teclas)</strong> y{' '}
                        <strong style={{ color: '#aaa' }}>detección facial de vivacidad</strong>.
                        <br /><br />
                        Todo el procesamiento ocurre <strong style={{ color: '#00ff9d' }}>localmente en tu navegador</strong>.
                        Nunca se almacena vídeo, audio ni secuencias brutas de teclado.
                        Solo se envían vectores numéricos derivados para puntuación.
                    </p>
                    <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: '14px 16px', marginBottom: 24, textAlign: 'left' }}>
                        <p style={{ fontSize: '0.78rem', color: '#555', margin: 0, lineHeight: 1.6 }}>
                            Base legal: <strong style={{ color: '#888' }}>Consentimiento explícito</strong> (Art. 6(1)(a) + Art. 9(2)(a) RGPD).<br />
                            Puedes retirar el consentimiento en cualquier momento cerrando la sesión.<br />
                            <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: '#00cfff' }}>Ver Política de Privacidad completa →</a>
                        </p>
                    </div>
                    <button
                        className="btn btn-primary"
                        style={{ width: '100%', marginBottom: 12 }}
                        onClick={() => setBiometricConsent(true)}
                    >
                        ✓ Acepto — Iniciar sesión verificada
                    </button>
                    <Link href="/" style={{ fontSize: '0.8rem', color: '#444', textDecoration: 'none' }}>
                        Cancelar y volver
                    </Link>
                </div>
            </div>
        )
    }

    // ── Render: live session ──────────────────────────────────────────────────
    const trustColor   = trustScore > 80 ? 'var(--color-primary)' : trustScore > 60 ? '#ffd700' : '#ff4d4d'
    const aiRiskColor  = liveMetrics.aiRisk > 60 ? '#ff4d4d' : liveMetrics.aiRisk > 30 ? '#ffd700' : 'var(--color-primary)'

    return (
        <main className={styles.main}>
            {/* ── Lighting Challenge flash overlay ─────────────────────────────
                Covers the entire viewport with a bright white overlay for 500ms.
                The real pupillary light reflex (blepharospasm) appears within ~150–300ms.
                A deepfake face renderer cannot react to this unpredictable stimulus.
            */}
            {lightingChallenge && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 9999,
                    background: 'rgba(255,255,255,0.92)',
                    pointerEvents: 'none',
                    animation: 'none',
                }} />
            )}

            {/* Header */}
            <header className={styles.header}>
                <div className={styles.logo}>Deep-Check<span style={{ color: 'var(--color-primary)' }}>.</span></div>
                <div className={styles.sessionInfo}>
                    <span className={styles.sessionBadge}>LIVE SESSION {PROMPT_ID}</span>
                    <div className={styles.trustIndicator}>
                        <span className={styles.trustLabel}>Trust</span>
                        <span className={styles.trustValue} style={{ color: trustColor, transition: 'color 0.4s' }}>{trustScore}%</span>
                    </div>
                    <div className={styles.trustIndicator} style={{ marginLeft: '12px' }}>
                        <span className={styles.trustLabel}>AI Risk</span>
                        <span className={styles.trustValue} style={{ color: aiRiskColor, transition: 'color 0.4s' }}>{liveMetrics.aiRisk}%</span>
                    </div>
                    <div className={styles.trustIndicator} style={{ marginLeft: '12px' }}>
                        <span className={styles.trustLabel}>Tabs</span>
                        <span className={styles.trustValue} style={{ color: tabSwitchCount.current >= 2 ? '#ff4d4d' : tabSwitchCount.current > 0 ? '#ffd700' : 'var(--color-primary)', transition: 'color 0.4s' }}>
                            {/* This doesn't reactively update from the ref — we track via alerts */}
                            {alerts.filter(a => a.message.includes('Tab switch')).length}
                        </span>
                    </div>
                </div>
                <button
                    className="btn btn-primary"
                    style={{ padding: '8px 20px', fontSize: '0.875rem' }}
                    onClick={handleEndSession}
                    disabled={isSaving}
                >
                    {isSaving ? 'Saving...' : 'End Session'}
                </button>
            </header>

            <div className={styles.content}>
                {/* Editor */}
                <div className={styles.editorArea}>
                    <CodeEditorDynamic ref={codeEditorRef} onBiometricEvent={handleBiometricEvent} />
                </div>

                {/* Sidebar */}
                <aside className={styles.sidebar}>
                    <section className={styles.section}>
                        <h3>Identity Verification</h3>
                        <VerificationCameraDynamic
                            ref={cameraRef}
                            onStatusChange={handleVerificationChange}
                            onLivenessScore={handleLivenessScore}
                            onGazeEvent={handleGazeEvent}
                            onBlinkEvent={handleBlinkEvent}
                            onFaceMetrics={handleFaceMetrics}
                            onAntiCheatEvent={handleAntiCheatEvent}
                            lightingChallengeActive={lightingChallenge}
                        />
                        <p className={styles.hint}>Face + eye gaze monitored continuously.</p>
                    </section>

                    <section className={styles.section}>
                        <h3>Behavioral Biometrics</h3>
                        <div className={styles.biometricGrid}>
                            <div className={styles.biometricItem}>
                                <span>Liveness</span>
                                <span className={isVerified ? styles.active : styles.inactive}>{livenessScore}%</span>
                            </div>
                            <div className={styles.biometricItem}>
                                <span>Typing</span>
                                <span className={liveMetrics.typingActive ? styles.active : styles.pending}>
                                    {liveMetrics.keystrokeCount > 0 ? `${liveMetrics.keystrokeCount} keys` : 'Awaiting'}
                                </span>
                            </div>
                            <div className={styles.biometricItem}>
                                <span>Pastes</span>
                                <span className={liveMetrics.pasteCount > 0 ? styles.inactive : styles.active}>
                                    {liveMetrics.pasteCount > 0 ? `${liveMetrics.pasteCount}` : 'Clean'}
                                </span>
                            </div>
                            <div className={styles.biometricItem}>
                                <span>Anomalies</span>
                                <span className={liveMetrics.anomalyCount > 2 ? styles.inactive : liveMetrics.anomalyCount > 0 ? styles.pending : styles.active}>
                                    {liveMetrics.anomalyCount}
                                </span>
                            </div>
                        </div>
                    </section>

                    <section className={styles.section}>
                        <h3>Session Integrity</h3>
                        <div style={{ background: 'rgba(255,255,255,0.06)', height: '8px', borderRadius: '4px', marginBottom: '8px' }}>
                            <div style={{ height: '100%', width: `${trustScore}%`, background: trustColor, borderRadius: '4px', transition: 'width 0.6s ease, background 0.4s ease' }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                            <span>{alerts.length} incidents</span>
                            <span style={{ color: trustColor, fontWeight: 700 }}>{trustScore}% integrity</span>
                        </div>
                    </section>

                    <section className={styles.section} style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        <h3>Live Security Alerts</h3>
                        <div className={styles.alertsContainer}>
                            {alerts.length === 0 ? (
                                <div className={styles.noAlerts}>No suspicious activity detected.</div>
                            ) : (
                                alerts.map((alert) => {
                                    const borderColor = alert.severity === 'high' ? '#ff4d4d' : alert.severity === 'medium' ? '#ffd700' : '#555'
                                    return (
                                        <div key={alert.id} className={styles.alertItem} style={{ borderLeftColor: borderColor }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                                <span style={{ fontSize: '0.7rem', color: borderColor, fontWeight: 700, textTransform: 'uppercase' }}>{alert.severity}</span>
                                                {alert.penalty > 0 && <span style={{ fontSize: '0.7rem', color: '#ff4d4d' }}>−{alert.penalty}%</span>}
                                            </div>
                                            <div style={{ fontSize: '0.8rem' }}>{alert.message}</div>
                                        </div>
                                    )
                                })
                            )}
                        </div>
                    </section>
                </aside>
            </div>
        </main>
    )
}
