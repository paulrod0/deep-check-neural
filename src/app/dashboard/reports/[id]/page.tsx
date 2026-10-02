'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import styles from '../../../page.module.css'

type AssessmentStatus = 'passed' | 'review' | 'flagged'

export default function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = React.use(params)
    const [assessment, setAssessment] = useState<Record<string, unknown> | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [actionState, setActionState] = useState<'idle' | 'saving' | 'done'>('idle')
    const [actionLabel, setActionLabel] = useState('')
    const router = useRouter()

    useEffect(() => {
        const fetchReport = async () => {
            try {
                const res = await fetch(`/api/assessments/${id}`)
                if (!res.ok) throw new Error('Not found')
                const data = await res.json()
                setAssessment(data)
            } catch {
                router.push('/dashboard')
            } finally {
                setIsLoading(false)
            }
        }
        fetchReport()
    }, [id, router])

    // ── Status update action ─────────────────────────────────────────────────
    const updateStatus = useCallback(async (status: AssessmentStatus, note?: string) => {
        setActionState('saving')
        try {
            const res = await fetch(`/api/assessments/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status, reviewNote: note }),
            })
            if (!res.ok) throw new Error('Failed')
            const data = await res.json()
            setAssessment(data.assessment)
            setActionLabel(status === 'passed' ? '✓ Approved' : status === 'flagged' ? '⚑ Flagged' : '⚐ Marked for Review')
            setActionState('done')
        } catch {
            setActionState('idle')
            alert('Failed to update status. Please try again.')
        }
    }, [id])

    // ── Export audit trail ───────────────────────────────────────────────────
    const exportAuditTrail = () => {
        if (!assessment) return
        const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(assessment, null, 2))
        const a = document.createElement('a')
        a.setAttribute('href', dataStr)
        a.setAttribute('download', `audit_trail_${assessment.id as string}.json`)
        document.body.appendChild(a)
        a.click()
        a.remove()
    }

    if (isLoading) return (
        <div className={styles.content} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: 'var(--color-text-muted)' }}>
            Loading report…
        </div>
    )
    if (!assessment) return null

    const score = (assessment.score as number) ?? 0
    const scoreColor = score > 85 ? 'var(--color-primary)' : score > 60 ? '#ffd700' : '#ff4d4d'
    const focusLabel = score > 80 ? 'HIGH' : score > 60 ? 'MEDIUM' : 'LOW'
    const focusColor = score > 80 ? 'var(--color-primary)' : score > 60 ? '#ffd700' : '#ff4d4d'

    return (
        <div className={styles.content}>
            <header className={styles.header}>
                <div>
                    <Link href="/dashboard" style={{ color: 'var(--color-primary)', textDecoration: 'none', fontSize: '0.8rem', marginBottom: '8px', display: 'block' }}>
                        ← Back to Dashboard
                    </Link>
                    <h1>Session <span className="text-gradient">Report</span></h1>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: '4px', textTransform: 'uppercase' }}>Verification ID</div>
                    <div style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>{assessment.id as string}</div>
                </div>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '32px' }}>
                {/* Left column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                    {/* Main info card */}
                    <section className={styles.tableSection} style={{ padding: '32px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
                            <div>
                                <h2 style={{ fontSize: '1.8rem', marginBottom: '4px' }}>{assessment.candidateName as string}</h2>
                                <p style={{ color: 'var(--color-text-muted)' }}>{assessment.role as string} · {assessment.date as string}</p>
                            </div>
                            <span className={`${styles.statusBadge} ${styles[assessment.status as string]}`} style={{ fontSize: '1rem', padding: '8px 16px' }}>
                                {(assessment.status as string).toUpperCase()}
                            </span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '24px', borderTop: '1px solid var(--color-border)', paddingTop: '32px' }}>
                            <div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>Identity</div>
                                <div style={{ color: 'var(--color-primary)', fontWeight: 600 }}>PASSED</div>
                            </div>
                            <div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>Liveness</div>
                                <div style={{ color: (assessment.livenessScore as number) > 60 ? 'var(--color-primary)' : '#ffd700', fontWeight: 600 }}>
                                    {assessment.livenessScore != null ? `${assessment.livenessScore as number}%` : 'SECURE'}
                                </div>
                            </div>
                            <div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>Focus</div>
                                <div style={{ color: focusColor, fontWeight: 600 }}>{focusLabel}</div>
                            </div>
                            <div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>AI Risk</div>
                                <div style={{ color: ((assessment.aiRisk as number) ?? 0) > 50 ? '#ff4d4d' : 'var(--color-primary)', fontWeight: 600 }}>
                                    {assessment.aiRisk != null ? `${assessment.aiRisk as number}%` : 'LOW'}
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Incident timeline */}
                    <section className={styles.tableSection} style={{ padding: '32px' }}>
                        <h3 style={{ marginBottom: '24px' }}>Incident Timeline ({(assessment.alerts as unknown[])?.length ?? 0} events)</h3>
                        {!(assessment.alerts as unknown[])?.length ? (
                            <p style={{ opacity: 0.5, fontSize: '0.9rem' }}>No suspicious incidents recorded.</p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '320px', overflowY: 'auto' }}>
                                {(assessment.alerts as unknown[]).map((alert: unknown, i: number) => {
                                    const alertObj = typeof alert === 'object' && alert !== null ? alert as Record<string, unknown> : {}
                                    const msg = String(typeof alert === 'string' ? alert : (alertObj.message ?? JSON.stringify(alert)))
                                    const sev = String(typeof alert === 'object' ? (alertObj.severity ?? 'medium') : 'medium')
                                    const sevColor = sev === 'high' ? '#ff4d4d' : sev === 'medium' ? '#ffd700' : '#888'
                                    return (
                                        <div key={i} style={{ padding: '14px 16px', background: 'rgba(255,77,77,0.04)', borderLeft: `4px solid ${sevColor}`, borderRadius: '4px', fontSize: '0.875rem' }}>
                                            {msg}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </section>

                    {/* Forensic evidence gallery */}
                    {(assessment.evidence as unknown[])?.length > 0 && (
                        <section className={styles.tableSection} style={{ padding: '32px' }}>
                            <h3 style={{ marginBottom: '24px' }}>Forensic Evidence ({(assessment.evidence as unknown[]).length} captures)</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px' }}>
                                {(assessment.evidence as unknown[]).map((item: unknown, i: number) => {
                                    const ev = item as Record<string, unknown>; return (
                                    <div key={i} style={{ background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '10px', border: '1px solid var(--color-border)' }}>
                                        <div style={{ position: 'relative', width: '100%', aspectRatio: '4/3', overflow: 'hidden', borderRadius: '8px', marginBottom: '10px' }}>
                                            <img src={ev.image as string} alt={ev.reason as string} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                            <div style={{ position: 'absolute', top: '6px', right: '6px', background: 'rgba(0,0,0,0.7)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.65rem' }}>
                                                {ev.timestamp as string}
                                            </div>
                                        </div>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#ff4d4d' }}>{ev.reason as string}</div>
                                    </div>
                                )})}
                            </div>
                        </section>
                    )}
                </div>

                {/* Right column */}
                <aside style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    {/* Integrity score ring */}
                    <div className={styles.statCard} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 24px' }}>
                        <span className={styles.statLabel} style={{ marginBottom: '20px' }}>Integrity Score</span>
                        <div style={{ position: 'relative', width: '130px', height: '130px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                    fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2.5" />
                                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                    fill="none" stroke={scoreColor} strokeWidth="2.5"
                                    strokeDasharray={`${score}, 100`}
                                    strokeLinecap="round" />
                            </svg>
                            <div style={{ position: 'absolute', textAlign: 'center' }}>
                                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: scoreColor }}>{score}%</div>
                                <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                                    {assessment.status as string}
                                </div>
                            </div>
                        </div>

                        {assessment.keystrokeCount != null && (
                            <div style={{ marginTop: '20px', fontSize: '0.8rem', color: 'var(--color-text-muted)', textAlign: 'center' }}>
                                {assessment.keystrokeCount as number} keystrokes recorded
                            </div>
                        )}
                    </div>

                    {/* Security actions */}
                    <div className={styles.statCard}>
                        <h4 style={{ marginBottom: '16px', fontSize: '0.9rem' }}>Security Actions</h4>

                        {actionState === 'done' ? (
                            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--color-primary)', fontSize: '0.9rem', fontWeight: 600 }}>
                                {actionLabel}
                            </div>
                        ) : (
                            <>
                                <button
                                    className="btn btn-primary"
                                    style={{ width: '100%', marginBottom: '10px', opacity: actionState === 'saving' ? 0.6 : 1 }}
                                    disabled={actionState === 'saving' || (assessment.status as string) === 'passed'}
                                    onClick={() => updateStatus('passed', 'Manually approved by reviewer')}
                                >
                                    {(assessment.status as string) === 'passed' ? '✓ Already Approved' : actionState === 'saving' ? 'Saving…' : 'Approve Candidate'}
                                </button>
                                <button
                                    className="btn btn-outline"
                                    style={{ width: '100%', marginBottom: '10px' }}
                                    onClick={exportAuditTrail}
                                >
                                    Export Audit Trail (JSON)
                                </button>
                                <button
                                    className="btn btn-outline"
                                    style={{ width: '100%', border: '1px solid #ff4d4d', color: '#ff4d4d', opacity: actionState === 'saving' ? 0.6 : 1 }}
                                    disabled={actionState === 'saving' || (assessment.status as string) === 'flagged'}
                                    onClick={() => updateStatus('flagged', 'Manually flagged by reviewer')}
                                >
                                    {(assessment.status as string) === 'flagged' ? '⚑ Already Flagged' : 'Flag for Review'}
                                </button>
                            </>
                        )}
                    </div>

                    {/* Quick metadata */}
                    <div className={styles.statCard}>
                        <h4 style={{ marginBottom: '16px', fontSize: '0.9rem' }}>Session Metadata</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>Date</span><span style={{ color: 'white' }}>{assessment.date as string}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>Incidents</span>
                                <span style={{ color: (assessment.alerts as unknown[])?.length > 0 ? '#ff4d4d' : 'var(--color-primary)' }}>
                                    {(assessment.alerts as unknown[])?.length ?? 0}
                                </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>Evidence</span><span style={{ color: 'white' }}>{(assessment.evidence as unknown[])?.length ?? 0} captures</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>Last Event</span>
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#aaa', fontStyle: 'italic' }}>{(assessment.lastEvent as string) || '—'}</div>
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    )
}
