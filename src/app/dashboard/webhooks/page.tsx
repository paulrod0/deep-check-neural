'use client'

import React, { useState, useEffect, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface WebhookDelivery {
  id: string
  eventType: string
  url: string
  status: 'delivered' | 'failed' | 'retrying'
  httpStatus: number | null
  attempts: number
  maxAttempts: number
  createdAt: string
  lastAttemptAt: string | null
  responseBody: string | null
  durationMs: number | null
}

interface ApiKey {
  key: string
  name: string
  webhookUrl?: string
  active: boolean
}

type EventType =
  | 'verification.completed'
  | 'verification.failed'
  | 'session.completed'
  | 'session.flagged'
  | 'document.analyzed'
  | 'certificate.generated'

const EVENT_TYPES: { type: EventType; label: string; desc: string }[] = [
  { type: 'verification.completed', label: 'Verification Completed', desc: 'Fired when a KYC verification finishes with a verdict' },
  { type: 'verification.failed', label: 'Verification Failed', desc: 'Fired when a verification encounters an error' },
  { type: 'session.completed', label: 'Session Completed', desc: 'Fired when a live interview session ends' },
  { type: 'session.flagged', label: 'Session Flagged', desc: 'Fired when a session is flagged for fraud' },
  { type: 'document.analyzed', label: 'Document Analyzed', desc: 'Fired when a document forensics analysis completes' },
  { type: 'certificate.generated', label: 'Certificate Generated', desc: 'Fired when a verification certificate is created' },
]

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  delivered: { bg: 'rgba(0,229,255,0.12)', fg: '#00E5FF' },
  failed:    { bg: 'rgba(255,77,77,0.12)', fg: '#FF4D4D' },
  retrying:  { bg: 'rgba(255,215,0,0.12)', fg: '#FFD700' },
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function WebhooksPage() {
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchDeliveries = useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (statusFilter) params.set('status', statusFilter)
      const res = await fetch(`/api/webhooks/deliveries?${params}`)
      if (res.ok) {
        const data = await res.json()
        setDeliveries(data.data || [])
      }
    } catch { /* non-fatal */ }
    setIsLoading(false)
  }, [statusFilter])

  const fetchApiKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/keys')
      if (res.ok) {
        const data = await res.json()
        setApiKeys((data.data || []).filter((k: ApiKey) => k.webhookUrl))
      }
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => {
    fetchDeliveries()
    fetchApiKeys()
  }, [fetchDeliveries, fetchApiKeys])

  const sendTestPing = async (webhookUrl: string) => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'test.ping',
          timestamp: new Date().toISOString(),
          data: {
            message: 'Deep-Check webhook test ping',
            source: 'dashboard',
          },
        }),
      })
      setTestResult({
        success: res.ok,
        message: res.ok ? `✓ ${res.status} — Webhook endpoint responded successfully` : `✗ ${res.status} — ${res.statusText}`,
      })
    } catch (err) {
      setTestResult({
        success: false,
        message: `✗ Failed to reach endpoint: ${(err as Error).message}`,
      })
    }
    setTesting(false)
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  // Stats
  const total = deliveries.length
  const delivered = deliveries.filter(d => d.status === 'delivered').length
  const failed = deliveries.filter(d => d.status === 'failed').length
  const retrying = deliveries.filter(d => d.status === 'retrying').length

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0 }}>Webhooks</h1>
        <p style={{ color: '#9AA0A6', margin: '4px 0 0', fontSize: '0.9rem' }}>
          Monitor webhook deliveries and test your endpoints
        </p>
      </div>

      {/* Configured endpoints */}
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 12,
        padding: '20px 24px',
        marginBottom: 20,
      }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 16 }}>Configured Endpoints</h3>
        {apiKeys.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {apiKeys.map(key => (
              <div key={key.key} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '12px 16px',
                background: 'rgba(255,255,255,0.02)',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.05)',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{key.name}</div>
                  <div style={{ fontSize: '0.78rem', color: '#00E5FF', fontFamily: 'monospace' }}>{key.webhookUrl}</div>
                </div>
                <span style={{
                  background: key.active ? 'rgba(34,197,94,0.12)' : 'rgba(255,77,77,0.12)',
                  color: key.active ? '#22C55E' : '#FF4D4D',
                  padding: '3px 10px',
                  borderRadius: 10,
                  fontSize: '0.7rem',
                  fontWeight: 700,
                }}>
                  {key.active ? 'Active' : 'Inactive'}
                </span>
                <button
                  onClick={() => sendTestPing(key.webhookUrl!)}
                  disabled={testing}
                  style={{
                    background: 'rgba(0,229,255,0.08)',
                    border: '1px solid rgba(0,229,255,0.25)',
                    color: '#00E5FF',
                    padding: '6px 16px',
                    borderRadius: 6,
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: testing ? 'wait' : 'pointer',
                  }}
                >
                  {testing ? 'Sending...' : 'Send Test Ping'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: '#9AA0A6', fontSize: '0.85rem' }}>
            No webhook URLs configured. Add a webhook URL when creating an API key in{' '}
            <a href="/dashboard/settings" style={{ color: '#00E5FF' }}>Settings</a>.
          </div>
        )}

        {testResult && (
          <div style={{
            marginTop: 12,
            padding: '10px 16px',
            borderRadius: 8,
            background: testResult.success ? 'rgba(34,197,94,0.08)' : 'rgba(255,77,77,0.08)',
            border: `1px solid ${testResult.success ? 'rgba(34,197,94,0.2)' : 'rgba(255,77,77,0.2)'}`,
            fontSize: '0.82rem',
            color: testResult.success ? '#22C55E' : '#FF4D4D',
          }}>
            {testResult.message}
          </div>
        )}
      </div>

      {/* Supported events */}
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 12,
        padding: '20px 24px',
        marginBottom: 20,
      }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 16 }}>Supported Event Types</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {EVENT_TYPES.map(et => (
            <div key={et.type} style={{
              padding: '12px 16px',
              background: 'rgba(255,255,255,0.02)',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.05)',
            }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, fontFamily: 'monospace', color: '#00E5FF', marginBottom: 4 }}>
                {et.type}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#9AA0A6' }}>{et.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Delivery stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        {[
          { label: 'Total Deliveries', value: total, color: '#E8EAED' },
          { label: 'Delivered', value: delivered, color: '#00E5FF' },
          { label: 'Failed', value: failed, color: '#FF4D4D' },
          { label: 'Retrying', value: retrying, color: '#FFD700' },
        ].map(card => (
          <div key={card.label} style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 12,
            padding: '16px 20px',
          }}>
            <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#9AA0A6', letterSpacing: '0.05em' }}>
              {card.label}
            </span>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: card.color, marginTop: 2 }}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Filter + delivery history */}
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 12,
        overflow: 'hidden',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 16 }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0 }}>Delivery History</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            {['', 'delivered', 'failed', 'retrying'].map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={{
                  background: statusFilter === s ? 'rgba(0,229,255,0.1)' : 'transparent',
                  border: `1px solid ${statusFilter === s ? 'rgba(0,229,255,0.3)' : 'rgba(255,255,255,0.08)'}`,
                  color: statusFilter === s ? '#00E5FF' : '#9AA0A6',
                  padding: '4px 12px',
                  borderRadius: 16,
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {s || 'All'}
              </button>
            ))}
          </div>
          <button
            onClick={fetchDeliveries}
            style={{
              marginLeft: 'auto',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#9AA0A6',
              padding: '4px 14px',
              borderRadius: 6,
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>

        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9AA0A6' }}>Loading deliveries...</div>
        ) : deliveries.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9AA0A6' }}>
            No webhook deliveries yet. Deliveries appear here when verification events are sent to your endpoints.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Event</th>
                <th style={thStyle}>URL</th>
                <th style={thStyle}>HTTP</th>
                <th style={thStyle}>Attempts</th>
                <th style={thStyle}>Time</th>
                <th style={thStyle}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map(d => {
                const ss = STATUS_STYLE[d.status] || STATUS_STYLE.failed
                const isExpanded = expandedId === d.id
                return (
                  <React.Fragment key={d.id}>
                    <tr
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.03)',
                        cursor: 'pointer',
                        background: isExpanded ? 'rgba(0,229,255,0.02)' : 'transparent',
                      }}
                      onClick={() => setExpandedId(isExpanded ? null : d.id)}
                    >
                      <td style={tdStyle}>
                        <span style={{ background: ss.bg, color: ss.fg, padding: '3px 10px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 700 }}>
                          {d.status}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.78rem', color: '#00E5FF' }}>
                        {d.eventType}
                      </td>
                      <td style={{ ...tdStyle, fontSize: '0.78rem', color: '#9AA0A6', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.url}
                      </td>
                      <td style={tdStyle}>
                        {d.httpStatus ? (
                          <span style={{ color: d.httpStatus < 300 ? '#22C55E' : '#FF4D4D', fontSize: '0.8rem', fontWeight: 600 }}>
                            {d.httpStatus}
                          </span>
                        ) : (
                          <span style={{ color: '#555', fontSize: '0.8rem' }}>—</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, fontSize: '0.8rem' }}>
                        {d.attempts}/{d.maxAttempts}
                      </td>
                      <td style={{ ...tdStyle, fontSize: '0.78rem', color: '#9AA0A6' }}>
                        {formatDate(d.createdAt)}
                      </td>
                      <td style={{ ...tdStyle, fontSize: '0.78rem' }}>
                        {d.durationMs ? `${d.durationMs}ms` : '—'}
                      </td>
                    </tr>
                    {isExpanded && d.responseBody && (
                      <tr>
                        <td colSpan={7} style={{ padding: '0 16px 12px', background: 'rgba(0,229,255,0.02)' }}>
                          <div style={{ fontSize: '0.7rem', color: '#9AA0A6', marginBottom: 4, fontWeight: 600 }}>Response Body:</div>
                          <pre style={{
                            background: 'rgba(0,0,0,0.3)',
                            padding: '10px 14px',
                            borderRadius: 6,
                            fontSize: '0.75rem',
                            color: '#CCC',
                            overflow: 'auto',
                            maxHeight: 150,
                            margin: 0,
                            fontFamily: 'monospace',
                          }}>
                            {d.responseBody}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: '0.68rem',
  textTransform: 'uppercase',
  color: '#9AA0A6',
  fontWeight: 600,
  letterSpacing: '0.05em',
}

const tdStyle: React.CSSProperties = {
  padding: '12px 16px',
}
