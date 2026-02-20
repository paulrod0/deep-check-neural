'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import styles from './page.module.css'
import { VerificationCameraHandle, VerificationFailureReason } from '@/components/VerificationCamera'
import { BiometricEvent } from '@/components/CodeEditor'

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

// ─── Session Report ───────────────────────────────────────────────────────────

function SessionReport({ assessment, onRestart }: { assessment: any; onRestart: () => void }) {
    const scoreColor = assessment.score > 85 ? 'var(--color-primary)' : assessment.score > 60 ? '#ffd700' : '#ff4d4d'
    const statusLabel = assessment.status === 'passed' ? 'PASSED' : assessment.status === 'review' ? 'UNDER REVIEW' : 'FLAGGED'

    return (
        <div style={{ padding: '60px', maxWidth: '860px', margin: '0 auto', background: 'var(--color-surface)', borderRadius: '24px', border: '1px solid var(--color-border)' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '48px' }}>
                <div>
                    <h1 className="text-gradient" style={{ fontSize: '2.5rem', marginBottom: '8px' }}>Trust Certificate</h1>
                    <p style={{ color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>ID: {assessment.id}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '3.5rem', fontWeight: 800, color: scoreColor, lineHeight: 1 }}>{assessment.score}%</div>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: '4px', color: scoreColor }}>
                        {statusLabel}
                    </div>
                </div>
            </div>

            {/* Score bar */}
            <div style={{ background: 'rgba(255,255,255,0.06)', height: '6px', borderRadius: '4px', marginBottom: '48px' }}>
                <div style={{ height: '100%', width: `${assessment.score}%`, background: scoreColor, borderRadius: '4px', transition: 'width 1s ease' }} />
            </div>

            {/* 2-col info grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '40px' }}>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '24px', borderRadius: '16px', border: '1px solid var(--color-border)' }}>
                    <h3 style={{ marginBottom: '16px', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-text-muted)' }}>Candidate Intelligence</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.9rem' }}>
                        <div><strong>Name:</strong> {assessment.candidateName}</div>
                        <div><strong>Role:</strong> {assessment.role}</div>
                        <div><strong>Session Date:</strong> {assessment.date}</div>
                        <div><strong>Session ID:</strong> <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{assessment.id}</span></div>
                    </div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '24px', borderRadius: '16px', border: '1px solid var(--color-border)' }}>
                    <h3 style={{ marginBottom: '16px', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-text-muted)' }}>Behavioral Forensics</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.9rem' }}>
                        <div>• Liveness Signature: <span style={{ color: 'var(--color-primary)' }}>VERIFIED</span></div>
                        <div>• Keystroke DNA: <span style={{ color: assessment.alerts.some((a: AlertEntry) => (a.message || a).toString().includes('Inconsistency') || (a.message || a).toString().includes('Rhythm')) ? '#ffd700' : 'var(--color-primary)' }}>
                            {assessment.alerts.some((a: AlertEntry) => (a.message || a).toString().includes('Inconsistency') || (a.message || a).toString().includes('Rhythm')) ? 'ANOMALIES DETECTED' : 'CONSISTENT'}
                        </span></div>
                        <div>• Clipboard Activity: <span style={{ color: assessment.alerts.some((a: AlertEntry) => (a.message || a).toString().includes('Paste')) ? '#ff4d4d' : 'var(--color-primary)' }}>
                            {assessment.alerts.some((a: AlertEntry) => (a.message || a).toString().includes('Paste')) ? 'FLAGGED' : 'CLEAN'}
                        </span></div>
                        <div>• AI-Assist Risk: <span style={{ color: assessment.alerts.some((a: AlertEntry) => (a.message || a).toString().includes('AI') || (a.message || a).toString().includes('Burst')) ? '#ff4d4d' : 'var(--color-primary)' }}>
                            {assessment.alerts.some((a: AlertEntry) => (a.message || a).toString().includes('AI') || (a.message || a).toString().includes('Burst')) ? 'ELEVATED' : 'LOW'}
                        </span></div>
                    </div>
                </div>
            </div>

            {/* Incident Timeline */}
            <div style={{ marginBottom: '40px' }}>
                <h3 style={{ marginBottom: '16px' }}>Incident Timeline ({assessment.alerts.length} events)</h3>
                {assessment.alerts.length === 0 ? (
                    <p style={{ color: 'var(--color-primary)', opacity: 0.7, fontSize: '0.9rem' }}>No security incidents recorded.</p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '220px', overflowY: 'auto' }}>
                        {assessment.alerts.map((alert: AlertEntry | string, idx: number) => {
                            const msg = typeof alert === 'string' ? alert : alert.message
                            const sev = typeof alert === 'object' ? alert.severity : 'medium'
                            const sevColor = sev === 'high' ? '#ff4d4d' : sev === 'medium' ? '#ffd700' : '#aaa'
                            return (
                                <div key={idx} style={{ padding: '10px 16px', background: 'rgba(255,77,77,0.07)', borderLeft: `3px solid ${sevColor}`, borderRadius: '4px', fontSize: '0.85rem', display: 'flex', gap: '12px' }}>
                                    <span style={{ color: sevColor, fontWeight: 700, textTransform: 'uppercase', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{sev}</span>
                                    <span>{msg}</span>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Evidence gallery */}
            {assessment.evidence?.length > 0 && (
                <div style={{ marginBottom: '40px' }}>
                    <h3 style={{ marginBottom: '16px' }}>Forensic Evidence ({assessment.evidence.length} captures)</h3>
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

            <div style={{ display: 'flex', gap: '16px' }}>
                <Link href="/dashboard" className="btn btn-primary">Go to Dashboard</Link>
                <button onClick={onRestart} className="btn btn-outline">Start New Session</button>
            </div>
        </div>
    )
}

// ─── Main Interview Page ──────────────────────────────────────────────────────

const PROMPT_ID = `#${Math.floor(1000 + Math.random() * 9000)}`

export default function InterviewPage() {
    const [isVerified, setIsVerified] = useState(false)
    const [livenessScore, setLivenessScore] = useState(0)
    const [trustScore, setTrustScore] = useState(100)
    const [alerts, setAlerts] = useState<AlertEntry[]>([])
    const [isSaving, setIsSaving] = useState(false)
    const [sessionEnded, setSessionEnded] = useState(false)
    const [lastAssessment, setLastAssessment] = useState<any>(null)
    const [evidence, setEvidence] = useState<EvidenceEntry[]>([])

    // Live biometric display state
    const [liveMetrics, setLiveMetrics] = useState({
        keystrokeCount: 0,
        aiRisk: 0,
        pasteCount: 0,
        anomalyCount: 0,
        typingActive: false,
    })

    const alertIdRef = useRef(0)
    const trustScoreRef = useRef(100)
    const cameraRef = useRef<VerificationCameraHandle>(null)

    // Keep ref in sync for use inside callbacks
    useEffect(() => { trustScoreRef.current = trustScore }, [trustScore])

    // ── Evidence capture ─────────────────────────────────────────────────────
    const captureEvidence = useCallback((reason: string) => {
        const snapshot = cameraRef.current?.takeSnapshot()
        if (snapshot) {
            setEvidence(prev => [...prev, {
                timestamp: new Date().toLocaleTimeString(),
                image: snapshot,
                reason
            }].slice(-8))
        }
    }, [])

    // ── Add alert helper ─────────────────────────────────────────────────────
    const addAlert = useCallback((message: string, severity: AlertEntry['severity'], penalty: number, captureReason?: string) => {
        const timestamp = new Date().toLocaleTimeString()
        const id = ++alertIdRef.current
        setAlerts(prev => [{ id, timestamp, message: `[${timestamp}] ${message}`, severity, penalty }, ...prev].slice(0, 20))
        setTrustScore(prev => Math.max(0, prev - penalty))
        if (captureReason) captureEvidence(captureReason)
    }, [captureEvidence])

    // ── Camera verification events ───────────────────────────────────────────
    const handleVerificationChange = useCallback((verified: boolean, type?: VerificationFailureReason) => {
        setIsVerified(verified)
        if (!verified && type) {
            if (type === 'Gaze Divergence') {
                addAlert('Gaze Divergence — candidate looked away from screen', 'medium', 5, 'Gaze Divergence')
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

    // ── Keyboard biometric events ────────────────────────────────────────────
    const handleBiometricEvent = useCallback((event: BiometricEvent) => {
        switch (event.type) {
            case 'keystroke':
                setLiveMetrics(prev => ({ ...prev, typingActive: true, keystrokeCount: prev.keystrokeCount + 1 }))
                break

            case 'paste':
                const penalty = event.length! > 200 ? 20 : event.length! > 50 ? 12 : 5
                const sev: AlertEntry['severity'] = event.length! > 200 ? 'high' : event.length! > 50 ? 'medium' : 'low'
                addAlert(`Clipboard paste detected — ${event.length} characters`, sev, penalty, event.length! > 50 ? 'Large Paste' : undefined)
                setLiveMetrics(prev => ({ ...prev, pasteCount: prev.pasteCount + 1 }))
                break

            case 'burst':
                addAlert('AI-assisted input detected — keystroke burst', 'high', 20, 'AI Burst')
                setLiveMetrics(prev => ({ ...prev, aiRisk: Math.min(100, prev.aiRisk + 20) }))
                break

            case 'inconsistency':
                addAlert(`Typing pattern anomaly — Z-score ${event.zScore?.toFixed(1)}σ (key: ${event.key})`, 'medium', 8)
                setLiveMetrics(prev => ({ ...prev, anomalyCount: prev.anomalyCount + 1 }))
                break

            case 'rhythm_shift':
                addAlert('Significant typing rhythm shift — possible user substitution', 'high', 12, 'Rhythm Shift')
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
        }
    }, [addAlert, liveMetrics.aiRisk])

    // ── Visibility / focus detection ─────────────────────────────────────────
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.hidden) {
                addAlert('Tab switched — candidate left the assessment window', 'high', 10, 'Tab Switch')
            }
        }
        const handleBlur = () => {
            addAlert('Window focus lost — candidate switched application', 'medium', 5, 'Focus Lost')
        }

        // Multi-monitor detection
        const isExtended = (window.screen as any).isExtended || (window.screen.availWidth > window.screen.width * 1.5)
        if (isExtended) {
            addAlert('Extended display setup detected — dual monitor environment', 'low', 0)
        }

        document.addEventListener('visibilitychange', handleVisibilityChange)
        window.addEventListener('blur', handleBlur)
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange)
            window.removeEventListener('blur', handleBlur)
        }
    }, [addAlert])

    // ── End session ──────────────────────────────────────────────────────────
    const handleEndSession = async () => {
        setIsSaving(true)
        const finalScore = trustScoreRef.current
        const assessment = {
            id: Math.random().toString(36).substr(2, 9),
            candidateName: 'Remote Candidate',
            role: 'Software Engineer',
            date: new Date().toISOString().split('T')[0],
            score: finalScore,
            status: finalScore > 85 ? 'passed' : finalScore > 60 ? 'review' : 'flagged',
            alerts,
            evidence,
            lastEvent: alerts[0]?.message || 'Session ended cleanly',
            livenessScore,
            aiRisk: liveMetrics.aiRisk,
            keystrokeCount: liveMetrics.keystrokeCount,
        }

        try {
            await fetch('/api/assessments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(assessment)
            })
            setLastAssessment(assessment)
            setSessionEnded(true)
        } catch (error) {
            console.error('Failed to save assessment:', error)
            // Show report anyway — don't block UX on network error
            setLastAssessment(assessment)
            setSessionEnded(true)
        } finally {
            setIsSaving(false)
        }
    }

    // ── Render: session ended ────────────────────────────────────────────────
    if (sessionEnded && lastAssessment) {
        return (
            <main className={styles.main} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
                <SessionReport assessment={lastAssessment} onRestart={() => window.location.reload()} />
            </main>
        )
    }

    // ── Render: live session ─────────────────────────────────────────────────
    const trustColor = trustScore > 80 ? 'var(--color-primary)' : trustScore > 60 ? '#ffd700' : '#ff4d4d'
    const aiRiskColor = liveMetrics.aiRisk > 60 ? '#ff4d4d' : liveMetrics.aiRisk > 30 ? '#ffd700' : 'var(--color-primary)'

    return (
        <main className={styles.main}>
            {/* Header */}
            <header className={styles.header}>
                <div className={styles.logo}>Deep-Check<span style={{ color: 'var(--color-primary)' }}>.</span></div>
                <div className={styles.sessionInfo}>
                    <span className={styles.sessionBadge}>LIVE SESSION {PROMPT_ID}</span>
                    <div className={styles.trustIndicator}>
                        <span className={styles.trustLabel}>Trust Score</span>
                        <span className={styles.trustValue} style={{ color: trustColor, transition: 'color 0.4s' }}>
                            {trustScore}%
                        </span>
                    </div>
                    <div className={styles.trustIndicator} style={{ marginLeft: '16px' }}>
                        <span className={styles.trustLabel}>AI Risk</span>
                        <span className={styles.trustValue} style={{ color: aiRiskColor, transition: 'color 0.4s' }}>
                            {liveMetrics.aiRisk}%
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
                {/* Editor area */}
                <div className={styles.editorArea}>
                    <CodeEditorDynamic onBiometricEvent={handleBiometricEvent} />
                </div>

                {/* Sidebar */}
                <aside className={styles.sidebar}>
                    {/* Camera */}
                    <section className={styles.section}>
                        <h3>Identity Verification</h3>
                        <VerificationCameraDynamic
                            ref={cameraRef}
                            onStatusChange={handleVerificationChange}
                            onLivenessScore={handleLivenessScore}
                        />
                        <p className={styles.hint}>Keep your face clearly visible. Continuous monitoring active.</p>
                    </section>

                    {/* Biometric panel */}
                    <section className={styles.section}>
                        <h3>Behavioral Biometrics</h3>
                        <div className={styles.biometricGrid}>
                            <div className={styles.biometricItem}>
                                <span>Liveness</span>
                                <span className={isVerified ? styles.active : styles.inactive}>
                                    {livenessScore}%
                                </span>
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
                                    {liveMetrics.pasteCount > 0 ? `${liveMetrics.pasteCount} detected` : 'Clean'}
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

                    {/* Trust score bar */}
                    <section className={styles.section}>
                        <h3>Session Integrity</h3>
                        <div style={{ background: 'rgba(255,255,255,0.06)', height: '8px', borderRadius: '4px', marginBottom: '8px' }}>
                            <div style={{
                                height: '100%', width: `${trustScore}%`,
                                background: trustColor, borderRadius: '4px',
                                transition: 'width 0.6s ease, background 0.4s ease'
                            }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                            <span>{alerts.length} incidents</span>
                            <span style={{ color: trustColor, fontWeight: 700 }}>{trustScore}% integrity</span>
                        </div>
                    </section>

                    {/* Live alerts */}
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
