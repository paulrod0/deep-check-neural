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

export default function DashboardPage() {
    const [allCandidates, setAllCandidates] = useState<Candidate[]>([])
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<'all' | 'passed' | 'review' | 'flagged'>('all')
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        const fetchAssessments = async () => {
            try {
                const res = await fetch('/api/assessments')
                const data = await res.json()
                setAllCandidates(data.map((a: any) => ({
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
        fetchAssessments()
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
                    <div className={styles.user}>Admin Portal · v2.7</div>
                </header>

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
                                onChange={e => setStatusFilter(e.target.value as any)}
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
