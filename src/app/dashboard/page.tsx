'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import styles from './page.module.css'

interface Candidate {
    id: string
    name: string
    role: string
    date: string
    score: number
    status: 'passed' | 'review' | 'flagged'
}

function exportCSV(candidates: Candidate[]) {
    const headers = ['ID', 'Name', 'Role', 'Date', 'Trust Score', 'Status']
    const rows = candidates.map(c => [c.id, c.name, c.role, c.date, `${c.score}%`, c.status.toUpperCase()])
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `deep-check-assessments-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
}

interface PlanUsage {
    plan: string
    planLabel: string
    sessionsUsed: number
    sessionsLimit: number
    docsUsed: number
    docsLimit: number
    periodReset: string
    upgradeNeeded: boolean
}

export default function DashboardPage() {
    const [allCandidates, setAllCandidates] = useState<Candidate[]>([])
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<'all' | 'passed' | 'review' | 'flagged'>('all')
    const [isLoading, setIsLoading] = useState(true)
    const [planUsage, setPlanUsage] = useState<PlanUsage | null>(null)

    useEffect(() => {
        const fetchAssessments = async () => {
            try {
                const res = await fetch('/api/assessments')
                const data = await res.json()
                setAllCandidates(data.map((a: Record<string, unknown>) => ({
                    id: a.id,
                    name: a.candidateName,
                    role: a.role,
                    date: a.date,
                    score: a.score,
                    status: a.status
                })).reverse()) // most recent first
            } catch (error) {
                console.error('Failed to fetch assessments:', error)
            } finally {
                setIsLoading(false)
            }
        }
        const fetchPlanUsage = async () => {
            try {
                const res = await fetch('/api/plan-usage')
                if (res.ok) setPlanUsage(await res.json())
            } catch { /* no plan info available */ }
        }
        fetchAssessments()
        fetchPlanUsage()
    }, [])

    const filtered = allCandidates.filter(c => {
        const q = search.toLowerCase()
        const matchesSearch = !q || c.name.toLowerCase().includes(q) || c.role.toLowerCase().includes(q) || c.id.includes(q)
        const matchesStatus = statusFilter === 'all' || c.status === statusFilter
        return matchesSearch && matchesStatus
    })

    const avgTrustScore = allCandidates.length
        ? Math.round(allCandidates.reduce((acc, c) => acc + c.score, 0) / allCandidates.length)
        : 0
    const flaggedCount = allCandidates.filter(c => c.status === 'flagged').length
    const passedCount = allCandidates.filter(c => c.status === 'passed').length

    return (
        <>
            <div className={styles.content}>
                <header className={styles.header}>
                    <h1>Security <span className="text-gradient">Intelligence</span></h1>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        {planUsage && (
                            <span style={{
                                fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.7rem',
                                borderRadius: '20px', textTransform: 'uppercase', letterSpacing: '0.1em',
                                background: planUsage.plan === 'free' ? 'rgba(161,161,170,0.15)' : 'rgba(0,255,157,0.15)',
                                color: planUsage.plan === 'free' ? 'var(--color-text-muted)' : 'var(--color-primary)',
                                border: `1px solid ${planUsage.plan === 'free' ? 'var(--color-border)' : 'rgba(0,255,157,0.3)'}`,
                            }}>
                                {planUsage.planLabel}
                            </span>
                        )}
                        <div className={styles.user}>Admin Portal · v2.7</div>
                    </div>
                </header>

                {/* ── Plan Usage Banner ── */}
                {planUsage && planUsage.upgradeNeeded && (
                    <div style={{
                        background: 'rgba(0,255,157,0.05)',
                        border: '1px solid rgba(0,255,157,0.2)',
                        borderRadius: '12px',
                        padding: '1rem 1.25rem',
                        marginBottom: '1.5rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '1rem',
                    }}>
                        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                            {/* Sessions usage bar */}
                            <div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.35rem' }}>
                                    Sesiones este mes
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                    <div style={{ width: '120px', height: '6px', background: 'var(--color-border)', borderRadius: '3px', overflow: 'hidden' }}>
                                        <div style={{
                                            height: '100%', borderRadius: '3px',
                                            width: `${Math.min(100, (planUsage.sessionsUsed / (planUsage.sessionsLimit || 10)) * 100)}%`,
                                            background: planUsage.sessionsUsed >= planUsage.sessionsLimit ? '#ff4d4d' : 'var(--color-primary)',
                                            transition: 'width 0.3s ease',
                                        }} />
                                    </div>
                                    <span style={{ fontSize: '0.8rem', color: '#fff' }}>
                                        {planUsage.sessionsUsed}/{planUsage.sessionsLimit}
                                    </span>
                                </div>
                            </div>
                            {/* Docs usage bar */}
                            <div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.35rem' }}>
                                    Análisis forenses
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                    <div style={{ width: '120px', height: '6px', background: 'var(--color-border)', borderRadius: '3px', overflow: 'hidden' }}>
                                        <div style={{
                                            height: '100%', borderRadius: '3px',
                                            width: `${Math.min(100, (planUsage.docsUsed / (planUsage.docsLimit || 5)) * 100)}%`,
                                            background: planUsage.docsUsed >= planUsage.docsLimit ? '#ff4d4d' : 'var(--color-primary)',
                                            transition: 'width 0.3s ease',
                                        }} />
                                    </div>
                                    <span style={{ fontSize: '0.8rem', color: '#fff' }}>
                                        {planUsage.docsUsed}/{planUsage.docsLimit}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <a href="/pricing" className="btn btn-primary" style={{ fontSize: '0.85rem', padding: '0.5rem 1.25rem' }}>
                            Actualizar a Pro →
                        </a>
                    </div>
                )}

                {/* Stats Grid */}
                <div className={styles.statsGrid}>
                    <div className={styles.statCard}>
                        <span className={styles.statLabel}>Total Assessed</span>
                        <span className={styles.statValue}>{isLoading ? '…' : allCandidates.length}</span>
                    </div>
                    <div className={styles.statCard}>
                        <span className={styles.statLabel}>Passed</span>
                        <span className={styles.statValue} style={{ color: 'var(--color-primary)' }}>{isLoading ? '…' : passedCount}</span>
                    </div>
                    <div className={styles.statCard}>
                        <span className={styles.statLabel}>Avg. Trust Score</span>
                        <span className={styles.statValue}>{isLoading ? '…' : `${avgTrustScore}%`}</span>
                    </div>
                    <div className={styles.statCard}>
                        <span className={`${styles.statLabel} ${styles.warning}`}>Flagged</span>
                        <span className={styles.statValue} style={{ color: flaggedCount > 0 ? '#ff4d4d' : 'inherit' }}>
                            {isLoading ? '…' : flaggedCount}
                        </span>
                    </div>
                </div>

                {/* Table */}
                <section className={styles.tableSection}>
                    <div className={styles.sectionHeader}>
                        <h2>Recent Assessments</h2>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            {/* Search */}
                            <input
                                type="text"
                                placeholder="Search by name, role, ID…"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                style={{
                                    background: 'var(--color-surface)',
                                    border: '1px solid var(--color-border)',
                                    padding: '8px 14px',
                                    borderRadius: 'var(--radius-md)',
                                    color: 'white',
                                    fontSize: '0.85rem',
                                    width: '220px',
                                    outline: 'none',
                                }}
                            />
                            {/* Status filter */}
                            <select
                                value={statusFilter}
                                onChange={e => setStatusFilter(e.target.value as 'all' | 'passed' | 'review' | 'flagged')}
                                style={{
                                    background: 'var(--color-surface)',
                                    border: '1px solid var(--color-border)',
                                    padding: '8px 12px',
                                    borderRadius: 'var(--radius-md)',
                                    color: 'white',
                                    fontSize: '0.85rem',
                                    cursor: 'pointer',
                                }}
                            >
                                <option value="all">All Statuses</option>
                                <option value="passed">Passed</option>
                                <option value="review">Under Review</option>
                                <option value="flagged">Flagged</option>
                            </select>
                            <button
                                className="btn btn-outline"
                                style={{ fontSize: '0.8rem', padding: '8px 16px' }}
                                onClick={() => exportCSV(filtered)}
                                disabled={filtered.length === 0}
                            >
                                Export CSV ({filtered.length})
                            </button>
                        </div>
                    </div>

                    <div className={styles.tableWrapper}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>Candidate</th>
                                    <th>Role</th>
                                    <th>Date</th>
                                    <th>Trust Score</th>
                                    <th>Status</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {isLoading ? (
                                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: '48px', color: 'var(--color-text-muted)' }}>Loading sessions…</td></tr>
                                ) : filtered.length === 0 ? (
                                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: '48px', color: 'var(--color-text-muted)' }}>No results matching your filters.</td></tr>
                                ) : (
                                    filtered.map(candidate => (
                                        <tr key={candidate.id}>
                                            <td>
                                                <div className={styles.candidateName}>{candidate.name}</div>
                                                <div className={styles.candidateId}>ID: {candidate.id}</div>
                                            </td>
                                            <td>{candidate.role}</td>
                                            <td>{candidate.date}</td>
                                            <td>
                                                <div className={styles.scoreWrapper}>
                                                    <div className={styles.scoreBar}>
                                                        <div
                                                            className={styles.scoreFill}
                                                            style={{
                                                                width: `${candidate.score}%`,
                                                                backgroundColor: candidate.score > 85 ? 'var(--color-primary)' : candidate.score > 70 ? '#ffd700' : '#ff4d4d'
                                                            }}
                                                        />
                                                    </div>
                                                    <span className={styles.scoreText}>{candidate.score}%</span>
                                                </div>
                                            </td>
                                            <td>
                                                <span className={`${styles.statusBadge} ${styles[candidate.status]}`}>
                                                    {candidate.status.toUpperCase()}
                                                </span>
                                            </td>
                                            <td>
                                                <Link href={`/dashboard/reports/${candidate.id}`} className={styles.linkBtn}>
                                                    View Report
                                                </Link>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {filtered.length > 0 && (
                        <div style={{ padding: '12px 24px', fontSize: '0.8rem', color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)' }}>
                            Showing {filtered.length} of {allCandidates.length} assessments
                        </div>
                    )}
                </section>
            </div>
        </>
    )
}
