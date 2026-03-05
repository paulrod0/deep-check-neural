'use client'

/**
 * Deep-Check INTEL · Military Intelligence Dashboard
 * /intel
 *
 * Feature-gated to plan === 'enterprise' or feature flag 'osint'.
 * Amber (#f59e0b) accent color instead of green for Intel brand.
 * Monospace fonts, grid layout, military-ops aesthetic.
 */

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

interface StatCard {
  label: string
  value: string | number
  unit?: string
  trend?: 'up' | 'down' | 'neutral'
}

interface OsintRequest {
  id: string
  type: 'BATCH' | 'MALTEGO' | 'ANALYZE'
  filename?: string
  url?: string
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  riskScore: number
  timestamp: string
  itemCount?: number
}

interface WebhookStatus {
  id: string
  url: string
  events: string[]
  failCount: number
  lastDeliveryAt?: string
}

interface AnalysisResult {
  id: string
  filename: string
  riskScore: number
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  elaScore: number
  aiScore: number
  exifScore: number
  noiseScore: number
  alerts: string[]
  analyzedAt: string
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const AMBER  = '#f59e0b'
const AMBER_DIM = 'rgba(245, 158, 11, 0.15)'
const AMBER_GLOW = 'rgba(245, 158, 11, 0.4)'
const BG     = '#0a0a12'
const SURFACE = '#111118'
const BORDER = '#1e1e2a'
const TEXT   = '#e2e8f0'
const MUTED  = '#64748b'
const GREEN  = '#00ff9d'
const RED    = '#ef4444'
const ORANGE = '#f97316'
const YELLOW = '#eab308'

function riskColor(level: string): string {
  switch (level) {
    case 'CRITICAL': return RED
    case 'HIGH':     return ORANGE
    case 'MEDIUM':   return YELLOW
    default:         return GREEN
  }
}

function riskBadge(level: string) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '3px',
      fontSize: '10px',
      fontFamily: 'monospace',
      fontWeight: 700,
      letterSpacing: '0.08em',
      background: `${riskColor(level)}22`,
      color: riskColor(level),
      border: `1px solid ${riskColor(level)}44`,
    }}>
      {level}
    </span>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCardComponent({ card }: { card: StatCard }) {
  return (
    <div style={{
      background: SURFACE,
      border: `1px solid ${BORDER}`,
      borderRadius: '6px',
      padding: '20px 24px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '2px',
        background: `linear-gradient(90deg, ${AMBER}, transparent)`,
      }} />
      <div style={{ fontSize: '11px', fontFamily: 'monospace', color: AMBER, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '8px' }}>
        {card.label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
        <span style={{ fontSize: '32px', fontFamily: 'monospace', fontWeight: 700, color: TEXT }}>
          {card.value}
        </span>
        {card.unit && (
          <span style={{ fontSize: '13px', color: MUTED, fontFamily: 'monospace' }}>
            {card.unit}
          </span>
        )}
      </div>
    </div>
  )
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <h2 style={{ fontSize: '13px', fontFamily: 'monospace', color: AMBER, letterSpacing: '0.12em', textTransform: 'uppercase', margin: 0 }}>
        {'// '}{title}
      </h2>
      {subtitle && <p style={{ fontSize: '12px', color: MUTED, marginTop: '4px', fontFamily: 'monospace' }}>{subtitle}</p>}
    </div>
  )
}

// ─── Main page component ──────────────────────────────────────────────────────

export default function IntelPage() {
  const [plan, setPlan]                 = useState<string | null>(null)
  const [planLoading, setPlanLoading]   = useState(true)
  const [hasAccess, setHasAccess]       = useState(false)

  const [stats, setStats]               = useState<StatCard[]>([])
  const [requests, setRequests]         = useState<OsintRequest[]>([])
  const [webhooks, setWebhooks]         = useState<WebhookStatus[]>([])

  const [analyzeUrl, setAnalyzeUrl]     = useState('')
  const [analyzeResult, setAnalyzeResult] = useState<AnalysisResult | null>(null)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [analyzeLoading, setAnalyzeLoading] = useState(false)

  const [stixLoading, setStixLoading]   = useState(false)

  // ── Plan / feature gate ────────────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/plan-usage')
      .then(r => r.json())
      .then(data => {
        const p = data?.plan ?? 'free'
        setPlan(p)
        setHasAccess(p === 'enterprise' || p === 'pro' || (data?.features ?? []).includes('osint'))
      })
      .catch(() => {
        // Allow access if plan check fails (e.g. offline mode)
        setHasAccess(true)
      })
      .finally(() => setPlanLoading(false))
  }, [])

  // ── Load dashboard data ────────────────────────────────────────────────────

  const loadDashboardData = useCallback(async () => {
    // Load webhooks
    try {
      const wRes = await fetch('/api/osint/webhook')
      if (wRes.ok) {
        const wData = await wRes.json()
        setWebhooks(wData.webhooks ?? [])
      }
    } catch { /* silent */ }

    // Load recent document analyses (reuse existing endpoint as OSINT proxy)
    try {
      const dRes = await fetch('/api/documents?limit=20')
      if (dRes.ok) {
        const dData = await dRes.json()
        const items = (dData.items ?? []) as Array<{
          id: string
          filename: string
          riskLevel: string
          riskScore: number
          createdAt: string
        }>

        const recentRequests: OsintRequest[] = items.map(item => ({
          id:        item.id,
          type:      'ANALYZE' as const,
          filename:  item.filename,
          riskLevel: item.riskLevel as OsintRequest['riskLevel'],
          riskScore: item.riskScore,
          timestamp: item.createdAt,
        }))

        setRequests(recentRequests)

        const highRisk   = items.filter(i => i.riskLevel === 'HIGH' || i.riskLevel === 'CRITICAL').length
        const total      = items.length

        setStats([
          { label: 'Total Analyses',         value: total,     unit: 'ops'  },
          { label: 'High Risk Items',        value: highRisk,  unit: 'items' },
          { label: 'Webhooks Active',        value: webhooks.length, unit: 'hooks' },
          { label: 'STIX Exports (Session)', value: 0,         unit: 'bundles' },
        ])
      }
    } catch { /* silent */ }
  }, [webhooks.length])

  useEffect(() => {
    if (hasAccess) {
      loadDashboardData()
    }
  }, [hasAccess, loadDashboardData])

  // ── Quick analysis ─────────────────────────────────────────────────────────

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault()
    if (!analyzeUrl.trim()) return

    setAnalyzeLoading(true)
    setAnalyzeResult(null)
    setAnalyzeError(null)

    try {
      const res = await fetch('/api/osint/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: analyzeUrl.trim() }),
      })
      const data = await res.json()

      if (!res.ok) {
        setAnalyzeError(data.error ?? `HTTP ${res.status}`)
      } else {
        setAnalyzeResult(data as AnalysisResult)
        // Append to recent requests
        setRequests(prev => [{
          id:        data.id,
          type:      'ANALYZE',
          filename:  data.filename,
          url:       analyzeUrl,
          riskLevel: data.riskLevel,
          riskScore: data.riskScore,
          timestamp: data.analyzedAt,
        }, ...prev.slice(0, 19)])
      }
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setAnalyzeLoading(false)
    }
  }

  // ── STIX export ────────────────────────────────────────────────────────────

  async function handleStixExport() {
    setStixLoading(true)
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const res   = await fetch(`/api/osint/stix?since=${since}`)
      if (!res.ok) {
        alert(`STIX export failed: HTTP ${res.status}`)
        return
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `deepcheck-stix-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert(`STIX export error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setStixLoading(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (planLoading) {
    return (
      <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: 'monospace', color: AMBER, fontSize: '14px', letterSpacing: '0.1em' }}>
          INITIALIZING INTEL MODULE...
        </span>
      </div>
    )
  }

  if (!hasAccess) {
    return (
      <div style={{ minHeight: '100vh', background: BG, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
        <div style={{ fontSize: '48px' }}>🔒</div>
        <h1 style={{ fontFamily: 'monospace', color: AMBER, fontSize: '18px', letterSpacing: '0.1em' }}>
          ACCESS DENIED — INTEL MODULE
        </h1>
        <p style={{ fontFamily: 'monospace', color: MUTED, fontSize: '13px', maxWidth: '400px', textAlign: 'center', lineHeight: '1.6' }}>
          The Intel OSINT module requires an Enterprise plan or the{' '}
          <code style={{ color: AMBER }}>osint</code> feature flag.{' '}
          Current plan: <strong style={{ color: TEXT }}>{plan?.toUpperCase() ?? 'FREE'}</strong>
        </p>
        <Link href="/pricing" style={{ padding: '10px 24px', background: AMBER, color: '#000', fontFamily: 'monospace', fontWeight: 700, borderRadius: '4px', fontSize: '13px', letterSpacing: '0.08em', textDecoration: 'none' }}>
          UPGRADE PLAN
        </Link>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, color: TEXT, fontFamily: 'var(--font-sans, system-ui)' }}>

      {/* ── Top nav bar ─────────────────────────────────────────────────────── */}
      <nav style={{
        borderBottom: `1px solid ${BORDER}`,
        padding: '0 32px',
        height: '56px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: `${SURFACE}cc`,
        backdropFilter: 'blur(8px)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: AMBER, fontSize: '14px', letterSpacing: '0.1em' }}>
            DEEP-CHECK <span style={{ color: TEXT }}>INTEL</span>
          </span>
          <div style={{ display: 'flex', gap: '4px' }}>
            {[
              { label: 'Analysis',  href: '/documents'  },
              { label: 'Video',     href: '/video'       },
              { label: 'Intel',     href: '/intel',  active: true },
              { label: 'Dashboard', href: '/dashboard'   },
            ].map(link => (
              <Link key={link.href} href={link.href} style={{
                padding: '6px 14px',
                borderRadius: '4px',
                fontSize: '12px',
                fontFamily: 'monospace',
                letterSpacing: '0.06em',
                color: link.active ? AMBER : MUTED,
                background: link.active ? AMBER_DIM : 'transparent',
                border: link.active ? `1px solid ${AMBER}44` : '1px solid transparent',
                textDecoration: 'none',
                transition: 'all 0.15s',
              }}>
                {link.label.toUpperCase()}
              </Link>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontFamily: 'monospace', fontSize: '11px', color: MUTED }}>
            {new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC
          </span>
          <span style={{ padding: '3px 8px', background: AMBER_DIM, border: `1px solid ${AMBER}44`, borderRadius: '3px', fontSize: '10px', fontFamily: 'monospace', color: AMBER, letterSpacing: '0.1em' }}>
            ENTERPRISE
          </span>
        </div>
      </nav>

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <header style={{ padding: '32px 32px 24px', borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontFamily: 'monospace', fontSize: '11px', color: AMBER, letterSpacing: '0.14em', marginBottom: '6px' }}>
                CLASSIFICATION: UNCLASSIFIED // DEEP-CHECK OSINT v2.0
              </div>
              <h1 style={{ fontSize: '28px', fontWeight: 700, color: TEXT, margin: 0, letterSpacing: '-0.02em' }}>
                Intel Operations Center
              </h1>
              <p style={{ color: MUTED, fontSize: '14px', marginTop: '6px', fontFamily: 'monospace' }}>
                Image forensics · Batch processing · STIX export · Maltego integration
              </p>
            </div>
            <button
              onClick={handleStixExport}
              disabled={stixLoading}
              style={{
                padding: '10px 20px',
                background: 'transparent',
                border: `1px solid ${AMBER}`,
                borderRadius: '4px',
                color: AMBER,
                fontFamily: 'monospace',
                fontSize: '12px',
                letterSpacing: '0.08em',
                cursor: stixLoading ? 'wait' : 'pointer',
                opacity: stixLoading ? 0.6 : 1,
              }}
            >
              {stixLoading ? 'EXPORTING...' : 'EXPORT STIX (24H)'}
            </button>
          </div>
        </div>
      </header>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <main style={{ maxWidth: '1400px', margin: '0 auto', padding: '32px' }}>

        {/* Stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '32px' }}>
          {(stats.length > 0 ? stats : [
            { label: 'Total Analyses',         value: '--' },
            { label: 'High Risk Items',        value: '--' },
            { label: 'Webhooks Active',        value: webhooks.length },
            { label: 'STIX Exports (Session)', value: '0' },
          ]).map((card, i) => <StatCardComponent key={i} card={card} />)}
        </div>

        {/* Two-column layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>

          {/* Quick Analysis Panel */}
          <div style={{
            background: SURFACE,
            border: `1px solid ${BORDER}`,
            borderRadius: '6px',
            padding: '24px',
          }}>
            <SectionHeader title="Quick Analysis" subtitle="Instant forensic result from URL" />
            <form onSubmit={handleAnalyze} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <input
                type="url"
                value={analyzeUrl}
                onChange={e => setAnalyzeUrl(e.target.value)}
                placeholder="https://example.com/image.jpg"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  background: BG,
                  border: `1px solid ${BORDER}`,
                  borderRadius: '4px',
                  color: TEXT,
                  fontFamily: 'monospace',
                  fontSize: '13px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="submit"
                disabled={analyzeLoading || !analyzeUrl.trim()}
                style={{
                  padding: '10px',
                  background: analyzeLoading ? `${AMBER}44` : AMBER,
                  border: 'none',
                  borderRadius: '4px',
                  color: '#000',
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  fontSize: '12px',
                  letterSpacing: '0.08em',
                  cursor: analyzeLoading ? 'wait' : 'pointer',
                  opacity: !analyzeUrl.trim() ? 0.5 : 1,
                }}
              >
                {analyzeLoading ? 'ANALYZING...' : 'RUN FORENSIC ANALYSIS'}
              </button>
            </form>

            {analyzeError && (
              <div style={{ marginTop: '12px', padding: '10px 14px', background: `${RED}11`, border: `1px solid ${RED}33`, borderRadius: '4px', fontFamily: 'monospace', fontSize: '12px', color: RED }}>
                ERROR: {analyzeError}
              </div>
            )}

            {analyzeResult && (
              <div style={{ marginTop: '16px', padding: '16px', background: BG, border: `1px solid ${BORDER}`, borderRadius: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: '12px', color: MUTED }}>
                    {analyzeResult.filename}
                  </span>
                  {riskBadge(analyzeResult.riskLevel)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {[
                    { label: 'Risk Score', value: `${(analyzeResult.riskScore * 100).toFixed(1)}%` },
                    { label: 'ELA Score',  value: `${(analyzeResult.elaScore  * 100).toFixed(1)}%` },
                    { label: 'AI Score',   value: `${(analyzeResult.aiScore   * 100).toFixed(1)}%` },
                    { label: 'Noise Score',value: `${(analyzeResult.noiseScore* 100).toFixed(1)}%` },
                  ].map(m => (
                    <div key={m.label} style={{ background: SURFACE, padding: '8px 12px', borderRadius: '3px' }}>
                      <div style={{ fontSize: '10px', fontFamily: 'monospace', color: MUTED, marginBottom: '2px' }}>{m.label}</div>
                      <div style={{ fontSize: '16px', fontFamily: 'monospace', fontWeight: 700, color: TEXT }}>{m.value}</div>
                    </div>
                  ))}
                </div>
                {analyzeResult.alerts.length > 0 && (
                  <div style={{ marginTop: '12px' }}>
                    <div style={{ fontSize: '10px', fontFamily: 'monospace', color: MUTED, marginBottom: '6px' }}>ALERTS</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {analyzeResult.alerts.map((a, i) => (
                        <div key={i} style={{ padding: '4px 8px', background: `${ORANGE}11`, border: `1px solid ${ORANGE}22`, borderRadius: '3px', fontFamily: 'monospace', fontSize: '11px', color: ORANGE }}>
                          {a}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Webhook Status Panel */}
          <div style={{
            background: SURFACE,
            border: `1px solid ${BORDER}`,
            borderRadius: '6px',
            padding: '24px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <SectionHeader title="Webhook Endpoints" subtitle={`${webhooks.length} registered`} />
            </div>

            {webhooks.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <div style={{ fontFamily: 'monospace', fontSize: '12px', color: MUTED }}>
                  NO WEBHOOKS REGISTERED
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: '11px', color: MUTED, marginTop: '8px' }}>
                  POST /api/osint/webhook/register to add one
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {webhooks.map(wh => (
                  <div key={wh.id} style={{
                    padding: '12px',
                    background: BG,
                    border: `1px solid ${BORDER}`,
                    borderRadius: '4px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '12px', color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
                        {wh.url}
                      </span>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '3px',
                        fontSize: '10px',
                        fontFamily: 'monospace',
                        fontWeight: 600,
                        background: wh.failCount === 0 ? `${GREEN}22` : `${RED}22`,
                        color: wh.failCount === 0 ? GREEN : RED,
                        border: `1px solid ${wh.failCount === 0 ? GREEN : RED}44`,
                      }}>
                        {wh.failCount === 0 ? 'HEALTHY' : `FAIL:${wh.failCount}`}
                      </span>
                    </div>
                    <div style={{ marginTop: '6px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {wh.events.map(ev => (
                        <span key={ev} style={{ padding: '2px 6px', background: AMBER_DIM, borderRadius: '2px', fontSize: '10px', fontFamily: 'monospace', color: AMBER }}>
                          {ev}
                        </span>
                      ))}
                    </div>
                    {wh.lastDeliveryAt && (
                      <div style={{ marginTop: '4px', fontSize: '10px', fontFamily: 'monospace', color: MUTED }}>
                        Last delivery: {new Date(wh.lastDeliveryAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent OSINT Requests Table */}
        <div style={{
          background: SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: '6px',
          padding: '24px',
          marginBottom: '24px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <SectionHeader title="Recent OSINT Operations" subtitle="Batch · Maltego · Direct analysis requests" />
            <button
              onClick={loadDashboardData}
              style={{ padding: '4px 12px', background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: '3px', color: MUTED, fontFamily: 'monospace', fontSize: '11px', cursor: 'pointer', letterSpacing: '0.06em' }}
            >
              REFRESH
            </button>
          </div>

          {requests.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', fontFamily: 'monospace', fontSize: '13px', color: MUTED }}>
              NO OPERATIONS RECORDED
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: '12px' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                    {['OPERATION ID', 'TYPE', 'FILENAME/URL', 'RISK', 'SCORE', 'TIMESTAMP'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: AMBER, fontWeight: 600, letterSpacing: '0.1em', fontSize: '10px', whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {requests.map((req, i) => (
                    <tr key={req.id} style={{ borderBottom: `1px solid ${BORDER}44`, background: i % 2 === 0 ? 'transparent' : `${BG}88` }}>
                      <td style={{ padding: '10px 12px', color: MUTED }}>
                        {req.id.slice(0, 8)}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ padding: '2px 8px', background: `${AMBER}22`, borderRadius: '2px', color: AMBER, fontSize: '10px', letterSpacing: '0.08em' }}>
                          {req.type}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', color: TEXT, maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {req.filename ?? req.url ?? '—'}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {riskBadge(req.riskLevel)}
                      </td>
                      <td style={{ padding: '10px 12px', color: riskColor(req.riskLevel) }}>
                        {(req.riskScore * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: '10px 12px', color: MUTED, whiteSpace: 'nowrap' }}>
                        {new Date(req.timestamp).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* API Reference footer */}
        <div style={{
          background: SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: '6px',
          padding: '20px 24px',
        }}>
          <SectionHeader title="OSINT API Endpoints" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            {[
              { method: 'POST', path: '/api/osint/analyze',           desc: 'Quick single-URL analysis' },
              { method: 'POST', path: '/api/osint/batch',             desc: 'Batch analysis (up to 50 items)' },
              { method: 'POST', path: '/api/osint/maltego',           desc: 'Maltego transform endpoint' },
              { method: 'GET',  path: '/api/osint/maltego',           desc: 'Download TRX seed file' },
              { method: 'GET',  path: '/api/osint/stix?since=DATE',   desc: 'STIX 2.1 bundle export' },
              { method: 'POST', path: '/api/osint/webhook/register',  desc: 'Register webhook endpoint' },
            ].map(ep => (
              <div key={ep.path + ep.method} style={{ padding: '10px 14px', background: BG, borderRadius: '4px', border: `1px solid ${BORDER}` }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{
                    padding: '2px 6px',
                    borderRadius: '2px',
                    fontSize: '10px',
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    background: ep.method === 'POST' ? `${AMBER}22` : `${GREEN}22`,
                    color: ep.method === 'POST' ? AMBER : GREEN,
                  }}>
                    {ep.method}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: '11px', color: TEXT }}>{ep.path}</span>
                </div>
                <p style={{ margin: 0, fontSize: '11px', color: MUTED, fontFamily: 'monospace' }}>{ep.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
