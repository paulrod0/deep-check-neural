'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import styles from '../page.module.css'

interface GDPRRequest {
  id: string
  type: 'export' | 'deletion'
  status: 'pending' | 'processing' | 'completed' | 'failed'
  requesterEmail: string
  dataUrl: string | null
  createdAt: string
  completedAt: string | null
  expiresAt: string | null
}

interface WebhookDelivery {
  id: string
  eventType: string
  webhookUrl: string
  status: string
  attempts: number
  responseStatus: number | null
  createdAt: string
  deliveredAt: string | null
}

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  pending:    { bg: 'rgba(251,191,36,0.1)', color: '#fbbf24' },
  processing: { bg: 'rgba(96,165,250,0.1)', color: '#60a5fa' },
  completed:  { bg: 'rgba(0,212,127,0.1)', color: 'var(--color-primary)' },
  failed:     { bg: 'rgba(255,77,77,0.1)', color: '#ff4d4d' },
  delivered:  { bg: 'rgba(0,212,127,0.1)', color: 'var(--color-primary)' },
  retrying:   { bg: 'rgba(251,191,36,0.1)', color: '#fbbf24' },
}

export default function PrivacyPage() {
  const [gdprRequests, setGdprRequests] = useState<GDPRRequest[]>([])
  const [webhookDeliveries, setWebhookDeliveries] = useState<WebhookDelivery[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [gdprRes, webhookRes] = await Promise.all([
        fetch('/api/gdpr'),
        fetch('/api/webhooks/deliveries?limit=20'),
      ])
      const gdprJson = await gdprRes.json()
      const webhookJson = await webhookRes.json()
      if (gdprJson.success) setGdprRequests(gdprJson.data)
      if (webhookJson.success) setWebhookDeliveries(webhookJson.data)
    } catch {
      console.error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  async function handleGDPRRequest(type: 'export' | 'deletion') {
    const confirmMsg = type === 'deletion'
      ? 'This will permanently delete all your organization\'s data. This action cannot be undone. Continue?'
      : 'This will generate a complete export of all your organization\'s data. Continue?'

    if (!confirm(confirmMsg)) return

    setSubmitting(true)
    setMessage(null)
    try {
      const res = await fetch('/api/gdpr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      const json = await res.json()
      if (json.success) {
        setMessage({ type: 'success', text: json.message })
        loadData()
      } else {
        setMessage({ type: 'error', text: json.error })
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.content}>
      <header className={styles.header}>
        <h1>Privacy & <span className="text-gradient">Data Rights</span></h1>
        <Link href="/dashboard/settings" className="btn btn-outline" style={{ fontSize: '0.85rem', padding: '8px 16px' }}>
          Settings
        </Link>
      </header>

      {/* Message */}
      {message && (
        <div style={{
          padding: '12px 18px', borderRadius: '10px', marginBottom: '20px', fontSize: '0.85rem',
          background: message.type === 'success' ? 'rgba(0,212,127,0.08)' : 'rgba(255,77,77,0.08)',
          border: `1px solid ${message.type === 'success' ? 'rgba(0,212,127,0.25)' : 'rgba(255,77,77,0.25)'}`,
          color: message.type === 'success' ? 'var(--color-primary)' : '#ff4d4d',
        }}>
          {message.text}
        </div>
      )}

      {/* GDPR Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
        {/* Export */}
        <section className={styles.tableSection} style={{ padding: '28px' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '12px' }}>📦</div>
          <h3 style={{ marginBottom: '8px' }}>Data Export</h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: '20px', lineHeight: 1.6 }}>
            GDPR Article 15 — Right of Access. Download a complete copy of all your organization&apos;s data
            including assessments, document analyses, ML feedback, audit logs, and team information.
          </p>
          <button
            onClick={() => handleGDPRRequest('export')}
            disabled={submitting}
            className="btn btn-primary"
            style={{ fontSize: '0.85rem', padding: '10px 24px' }}
          >
            {submitting ? 'Processing...' : 'Request Data Export'}
          </button>
        </section>

        {/* Deletion */}
        <section className={styles.tableSection} style={{ padding: '28px' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '12px' }}>🗑️</div>
          <h3 style={{ marginBottom: '8px' }}>Data Deletion</h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: '20px', lineHeight: 1.6 }}>
            GDPR Article 17 — Right to Erasure. Request permanent deletion of all your organization&apos;s data.
            This action is irreversible and will be processed within 30 days.
          </p>
          <button
            onClick={() => handleGDPRRequest('deletion')}
            disabled={submitting}
            className="btn btn-outline"
            style={{ fontSize: '0.85rem', padding: '10px 24px', color: '#ff4d4d', borderColor: 'rgba(255,77,77,0.3)' }}
          >
            {submitting ? 'Processing...' : 'Request Data Deletion'}
          </button>
        </section>
      </div>

      {/* GDPR Request History */}
      <section className={styles.tableSection} style={{ padding: 0, marginBottom: '24px' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--color-border)' }}>
          <h3 style={{ margin: 0 }}>Data Request History</h3>
        </div>
        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading...</div>
        ) : gdprRequests.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            No data requests yet.
          </div>
        ) : (
          gdprRequests.map(req => (
            <div key={req.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 24px', borderBottom: '1px solid var(--color-border)',
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                    {req.type === 'export' ? '📦 Data Export' : '🗑️ Data Deletion'}
                  </span>
                  <span style={{
                    fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: '20px',
                    background: STATUS_STYLES[req.status]?.bg ?? 'rgba(255,255,255,0.05)',
                    color: STATUS_STYLES[req.status]?.color ?? 'var(--color-text-muted)',
                  }}>
                    {req.status.toUpperCase()}
                  </span>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                  Requested {new Date(req.createdAt).toLocaleString()}
                  {req.completedAt && ` — Completed ${new Date(req.completedAt).toLocaleString()}`}
                </div>
              </div>
              {req.status === 'completed' && req.type === 'export' && req.expiresAt && (
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  Expires {new Date(req.expiresAt).toLocaleDateString()}
                </div>
              )}
            </div>
          ))
        )}
      </section>

      {/* Webhook Deliveries */}
      <section className={styles.tableSection} style={{ padding: 0 }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Recent Webhook Deliveries</h3>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            Last 20 deliveries
          </span>
        </div>
        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading...</div>
        ) : webhookDeliveries.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            No webhook deliveries yet.
          </div>
        ) : (
          webhookDeliveries.map(d => (
            <div key={d.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 24px', borderBottom: '1px solid var(--color-border)',
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                  <code style={{ fontSize: '0.78rem', color: '#60a5fa' }}>{d.eventType}</code>
                  <span style={{
                    fontSize: '0.65rem', fontWeight: 600, padding: '1px 6px', borderRadius: '10px',
                    background: STATUS_STYLES[d.status]?.bg ?? 'rgba(255,255,255,0.05)',
                    color: STATUS_STYLES[d.status]?.color ?? 'var(--color-text-muted)',
                  }}>
                    {d.status}
                  </span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                  {d.webhookUrl.replace(/^https?:\/\//, '').slice(0, 40)}
                  {d.attempts > 1 && ` (${d.attempts} attempts)`}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                  {new Date(d.createdAt).toLocaleString()}
                </div>
                {d.responseStatus && (
                  <div style={{
                    fontSize: '0.68rem',
                    color: d.responseStatus >= 200 && d.responseStatus < 300 ? 'var(--color-primary)' : '#ff4d4d',
                  }}>
                    HTTP {d.responseStatus}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  )
}
