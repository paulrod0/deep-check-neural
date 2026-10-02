'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import styles from '../page.module.css'

interface AuditEntry {
  id: number
  action: string
  actorEmail: string | null
  resourceType: string | null
  resourceId: string | null
  details: Record<string, unknown>
  ipAddress: string | null
  createdAt: string
}

interface ChainVerification {
  valid: boolean
  entriesChecked: number
  brokenAt?: number
  message: string
}

const ACTION_COLORS: Record<string, string> = {
  'document': '#60a5fa',
  'session': 'var(--color-primary)',
  'member': '#fbbf24',
  'auth': '#f472b6',
  'ml': '#a78bfa',
  'api_key': '#34d399',
  'certificate': '#22d3ee',
  'gdpr': '#fb923c',
  'org': '#e879f9',
  'admin': '#ef4444',
  'webhook': '#94a3b8',
}

function getActionColor(action: string): string {
  const prefix = action.split('.')[0]
  return ACTION_COLORS[prefix] ?? 'var(--color-text-muted)'
}

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [actionFilter, setActionFilter] = useState('')
  const [verification, setVerification] = useState<ChainVerification | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [page, setPage] = useState(0)
  const limit = 25

  const loadEntries = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) })
      if (actionFilter) params.set('action', actionFilter)
      const res = await fetch(`/api/audit?${params}`)
      const json = await res.json()
      if (json.success) {
        setEntries(json.data)
        setTotal(json.pagination.total)
      }
    } catch {
      console.error('Failed to load audit log')
    } finally {
      setLoading(false)
    }
  }, [actionFilter, page])

  useEffect(() => { loadEntries() }, [loadEntries])

  async function handleVerify() {
    setVerifying(true)
    try {
      const res = await fetch('/api/audit?verify=true')
      const json = await res.json()
      if (json.success) setVerification(json.verification)
    } catch {
      setVerification({ valid: false, entriesChecked: 0, message: 'Verification failed' })
    } finally {
      setVerifying(false)
    }
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <div className={styles.content}>
      <header className={styles.header}>
        <h1>Audit <span className="text-gradient">Trail</span></h1>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={handleVerify}
            disabled={verifying}
            className="btn btn-outline"
            style={{ fontSize: '0.82rem', padding: '8px 16px' }}
          >
            {verifying ? 'Verifying...' : 'Verify Chain Integrity'}
          </button>
          <Link href="/dashboard" className="btn btn-outline" style={{ fontSize: '0.82rem', padding: '8px 16px' }}>
            Dashboard
          </Link>
        </div>
      </header>

      {/* Chain verification result */}
      {verification && (
        <div style={{
          padding: '14px 20px',
          borderRadius: '10px',
          marginBottom: '20px',
          background: verification.valid ? 'rgba(0,212,127,0.08)' : 'rgba(255,77,77,0.08)',
          border: `1px solid ${verification.valid ? 'rgba(0,212,127,0.25)' : 'rgba(255,77,77,0.25)'}`,
          display: 'flex', alignItems: 'center', gap: '12px',
        }}>
          <span style={{ fontSize: '1.2rem' }}>{verification.valid ? '\u2705' : '\u274C'}</span>
          <div>
            <div style={{ fontSize: '0.88rem', fontWeight: 600, color: verification.valid ? 'var(--color-primary)' : '#ff4d4d' }}>
              {verification.valid ? 'Chain Integrity Verified' : 'Chain Integrity BROKEN'}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
              {verification.message}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <select
          value={actionFilter}
          onChange={e => { setActionFilter(e.target.value); setPage(0) }}
          style={{
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            padding: '8px 14px', borderRadius: '8px', color: 'white', fontSize: '0.85rem',
          }}
        >
          <option value="">All Actions</option>
          <option value="document.analyze">Document Analyze</option>
          <option value="document.verify">Document Verify</option>
          <option value="session.create">Session Create</option>
          <option value="session.flag">Session Flag</option>
          <option value="auth.login">Auth Login</option>
          <option value="auth.logout">Auth Logout</option>
          <option value="member.invite">Member Invite</option>
          <option value="member.remove">Member Remove</option>
          <option value="api_key.create">API Key Create</option>
          <option value="ml.feedback">ML Feedback</option>
          <option value="ml.retrain_trigger">ML Retrain</option>
          <option value="gdpr.export_request">GDPR Export</option>
          <option value="gdpr.deletion_request">GDPR Deletion</option>
          <option value="certificate.generate">Certificate Generate</option>
        </select>
        <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center' }}>
          {total} entries total
        </div>
      </div>

      {/* Audit log entries */}
      <section className={styles.tableSection} style={{ padding: 0 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Activity Log</h3>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            Hash-chain secured with SHA-256
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading audit trail...</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-muted)' }}>No audit entries found.</div>
        ) : (
          entries.map(entry => (
            <div key={entry.id} style={{
              padding: '14px 24px',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '14px',
            }}>
              {/* Color indicator */}
              <div style={{
                width: '4px', minHeight: '40px', borderRadius: '2px',
                background: getActionColor(entry.action),
                flexShrink: 0, marginTop: '2px',
              }} />

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{
                    fontSize: '0.72rem', fontWeight: 600, padding: '2px 8px',
                    borderRadius: '4px', background: `${getActionColor(entry.action)}20`,
                    color: getActionColor(entry.action),
                  }}>
                    {entry.action}
                  </span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  {entry.actorEmail && (
                    <span>by {entry.actorEmail}</span>
                  )}
                  {entry.resourceType && (
                    <span>{entry.resourceType}{entry.resourceId ? `: ${entry.resourceId.slice(0, 16)}...` : ''}</span>
                  )}
                  {entry.ipAddress && (
                    <span>IP: {entry.ipAddress}</span>
                  )}
                </div>
                {Object.keys(entry.details).length > 0 && (
                  <details style={{ marginTop: '6px' }}>
                    <summary style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
                      Details
                    </summary>
                    <pre style={{
                      fontSize: '0.72rem', color: 'var(--color-text-muted)',
                      background: 'rgba(255,255,255,0.03)', padding: '8px 12px',
                      borderRadius: '6px', marginTop: '4px', overflow: 'auto',
                      maxHeight: '120px',
                    }}>
                      {JSON.stringify(entry.details, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          ))
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{
            padding: '14px 24px', display: 'flex', justifyContent: 'center', gap: '8px',
            borderTop: '1px solid var(--color-border)',
          }}>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid var(--color-border)',
                borderRadius: '6px', padding: '4px 12px', fontSize: '0.78rem', color: '#fff',
                cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.4 : 1,
              }}
            >
              Previous
            </button>
            <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', padding: '4px 8px' }}>
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid var(--color-border)',
                borderRadius: '6px', padding: '4px 12px', fontSize: '0.78rem', color: '#fff',
                cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer',
                opacity: page >= totalPages - 1 ? 0.4 : 1,
              }}
            >
              Next
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
