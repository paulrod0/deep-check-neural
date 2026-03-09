'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import styles from '../page.module.css'

interface Candidate {
    id: string;
    name: string;
    role: string;
    date: string;
    score: number;
    status: 'passed' | 'review' | 'flagged';
}

export default function AssessmentsPage() {
    const [candidates, setCandidates] = useState<Candidate[]>([])
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        const fetchAssessments = async () => {
            try {
                const res = await fetch('/api/assessments')
                const data = await res.json()
                setCandidates(data.map((a: Record<string, unknown>) => ({
                    id: a.id,
                    name: a.candidateName,
                    role: a.role,
                    date: a.date,
                    score: a.score,
                    status: a.status
                })))
            } catch (error) {
                console.error('Failed to fetch assessments:', error)
            } finally {
                setIsLoading(false)
            }
        }
        fetchAssessments()
    }, [])

    return (
        <div className={styles.content}>
            <header className={styles.header}>
                <h1>Recent <span className="text-gradient">Assessments</span></h1>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <input
                        type="text"
                        placeholder="Search candidates..."
                        style={{
                            background: 'var(--color-surface)',
                            border: '1px solid var(--color-border)',
                            padding: '8px 16px',
                            borderRadius: 'var(--radius-md)',
                            color: 'white'
                        }}
                    />
                    <button className="btn btn-outline" style={{ fontSize: '0.8rem' }}>Export CSV</button>
                </div>
            </header>

            <section className={styles.tableSection}>
                <div className={styles.tableWrapper}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>Candidate</th>
                                <th>Role</th>
                                <th>Date</th>
                                <th>Trust Score</th>
                                <th>Verification</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '40px' }}>Loading sessions...</td></tr>
                            ) : (
                                candidates.map(candidate => (
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
                                                    <div className={styles.scoreFill} style={{ width: `${candidate.score}%`, backgroundColor: candidate.score > 85 ? 'var(--color-primary)' : candidate.score > 70 ? '#ffd700' : '#ff4d4d' }}></div>
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
                                            <Link href={`/dashboard/reports/${candidate.id}`} className={styles.linkBtn}>View Report</Link>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    )
}
