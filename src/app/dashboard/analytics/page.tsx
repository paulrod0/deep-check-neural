'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DailyVolume {
  date: string
  total: number
  authentic: number
  suspicious: number
  tampered: number
}

interface RiskBucket {
  range: string
  count: number
}

interface CountryData {
  country: string
  count: number
  authentic: number
  suspicious: number
  tampered: number
}

interface DocTypeData {
  type: string
  count: number
}

interface ExpiringDoc {
  id: string
  holderName: string
  expiryDate: string
  daysUntilExpiry: number
  nationality: string
}

interface AnalyticsData {
  summary: {
    totalVerifications: number
    authentic: number
    suspicious: number
    tampered: number
    authenticRate: number
    avgRiskScore: number
    uniqueCountries: number
  }
  dailyVolume: DailyVolume[]
  riskDistribution: RiskBucket[]
  countryHeatmap: CountryData[]
  documentTypes: DocTypeData[]
  expiringSoon: ExpiringDoc[]
}

// ── Styles ──────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 12,
  padding: '20px 24px',
}

const sectionTitle: React.CSSProperties = {
  fontSize: '0.95rem',
  fontWeight: 700,
  marginBottom: 16,
  color: '#E8EAED',
}

// ── Sparkline Chart Component ───────────────────────────────────────────────

function BarChart({ data, maxHeight = 120 }: { data: DailyVolume[]; maxHeight?: number }) {
  const maxVal = Math.max(1, ...data.map(d => d.total))
  const barWidth = Math.max(4, Math.floor(700 / data.length) - 2)

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: maxHeight, overflow: 'hidden' }}>
      {data.map((d, i) => {
        const h = (d.total / maxVal) * maxHeight
        const authH = (d.authentic / maxVal) * maxHeight
        const suspH = (d.suspicious / maxVal) * maxHeight
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, width: barWidth }}>
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column-reverse' }}>
              {d.tampered > 0 && <div style={{ width: '100%', height: Math.max(1, (d.tampered / maxVal) * maxHeight), background: '#FF4D4D', borderRadius: '2px 2px 0 0' }} />}
              {d.suspicious > 0 && <div style={{ width: '100%', height: Math.max(1, suspH), background: '#FFD700' }} />}
              {d.authentic > 0 && <div style={{ width: '100%', height: Math.max(1, authH), background: '#00E5FF', borderRadius: h === authH ? '2px 2px 0 0' : 0 }} />}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Risk Heatmap ────────────────────────────────────────────────────────────

function RiskHeatmap({ data }: { data: RiskBucket[] }) {
  const maxCount = Math.max(1, ...data.map(d => d.count))

  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {data.map((bucket, i) => {
        const intensity = bucket.count / maxCount
        const color = i < 3
          ? `rgba(0,229,255,${0.1 + intensity * 0.8})`
          : i < 6
          ? `rgba(255,215,0,${0.1 + intensity * 0.8})`
          : `rgba(255,77,77,${0.1 + intensity * 0.8})`

        return (
          <div key={i} style={{ flex: 1, textAlign: 'center' }}>
            <div
              style={{
                height: 50,
                background: color,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.75rem',
                fontWeight: 700,
                color: intensity > 0.5 ? '#000' : '#9AA0A6',
                marginBottom: 4,
              }}
            >
              {bucket.count > 0 ? bucket.count : ''}
            </div>
            <span style={{ fontSize: '0.6rem', color: '#9AA0A6' }}>{bucket.range}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Country Bar Chart ───────────────────────────────────────────────────────

function CountryBars({ data }: { data: CountryData[] }) {
  const maxCount = Math.max(1, ...data.map(d => d.count))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.slice(0, 12).map(country => (
        <div key={country.country} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: '0.78rem', minWidth: 100, textAlign: 'right', color: '#9AA0A6' }}>
            {country.country}
          </span>
          <div style={{ flex: 1, height: 18, background: 'rgba(255,255,255,0.04)', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
            <div style={{ width: `${(country.authentic / maxCount) * 100}%`, background: '#00E5FF', height: '100%' }} />
            <div style={{ width: `${(country.suspicious / maxCount) * 100}%`, background: '#FFD700', height: '100%' }} />
            <div style={{ width: `${(country.tampered / maxCount) * 100}%`, background: '#FF4D4D', height: '100%' }} />
          </div>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, minWidth: 30, color: '#E8EAED' }}>
            {country.count}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState(30)

  useEffect(() => {
    setIsLoading(true)
    fetch(`/api/analytics?days=${period}`)
      .then(r => r.json())
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(e.message))
      .finally(() => setIsLoading(false))
  }, [period])

  if (isLoading) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: '#9AA0A6' }}>
        <div style={{ fontSize: '1.5rem', marginBottom: 12 }}>Loading analytics...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: '#FF4D4D' }}>
        <div style={{ fontSize: '1.2rem', marginBottom: 8 }}>Error loading analytics</div>
        <div style={{ fontSize: '0.85rem', color: '#9AA0A6' }}>{error}</div>
      </div>
    )
  }

  const { summary } = data

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0 }}>
            Verification Analytics
          </h1>
          <p style={{ color: '#9AA0A6', margin: '4px 0 0', fontSize: '0.9rem' }}>
            KYC verification trends and risk intelligence
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[7, 14, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setPeriod(d)}
              style={{
                background: period === d ? 'rgba(0,229,255,0.15)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${period === d ? 'rgba(0,229,255,0.4)' : 'rgba(255,255,255,0.08)'}`,
                color: period === d ? '#00E5FF' : '#9AA0A6',
                padding: '6px 16px',
                borderRadius: 8,
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Total', value: summary.totalVerifications, color: '#E8EAED' },
          { label: 'Authentic', value: summary.authentic, color: '#00E5FF' },
          { label: 'Suspicious', value: summary.suspicious, color: '#FFD700' },
          { label: 'Tampered', value: summary.tampered, color: '#FF4D4D' },
          { label: 'Auth Rate', value: `${summary.authenticRate}%`, color: summary.authenticRate > 80 ? '#22C55E' : '#FFD700' },
          { label: 'Countries', value: summary.uniqueCountries, color: '#A78BFA' },
        ].map(card => (
          <div key={card.label} style={cardStyle}>
            <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#9AA0A6', letterSpacing: '0.06em' }}>
              {card.label}
            </span>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: card.color, marginTop: 2 }}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Charts row 1: Volume + Risk */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Daily volume */}
        <div style={cardStyle}>
          <h3 style={sectionTitle}>Daily Verification Volume</h3>
          {data.dailyVolume.length > 0 ? (
            <>
              <BarChart data={data.dailyVolume} />
              <div style={{ display: 'flex', gap: 16, marginTop: 12, justifyContent: 'center' }}>
                {[
                  { label: 'Authentic', color: '#00E5FF' },
                  { label: 'Suspicious', color: '#FFD700' },
                  { label: 'Tampered', color: '#FF4D4D' },
                ].map(l => (
                  <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: l.color }} />
                    <span style={{ fontSize: '0.72rem', color: '#9AA0A6' }}>{l.label}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ color: '#9AA0A6', textAlign: 'center', padding: 40 }}>No data for this period</div>
          )}
        </div>

        {/* Risk distribution heatmap */}
        <div style={cardStyle}>
          <h3 style={sectionTitle}>Risk Score Distribution</h3>
          <RiskHeatmap data={data.riskDistribution} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
            <span style={{ fontSize: '0.7rem', color: '#00E5FF' }}>← Low Risk</span>
            <span style={{ fontSize: '0.7rem', color: '#FF4D4D' }}>High Risk →</span>
          </div>
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: '#9AA0A6' }}>Average Risk Score: </span>
            <span style={{
              fontSize: '1.2rem',
              fontWeight: 800,
              color: summary.avgRiskScore < 30 ? '#00E5FF' : summary.avgRiskScore < 60 ? '#FFD700' : '#FF4D4D',
            }}>
              {summary.avgRiskScore}/100
            </span>
          </div>
        </div>
      </div>

      {/* Charts row 2: Countries + Doc Types + Expiring */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Country heatmap */}
        <div style={cardStyle}>
          <h3 style={sectionTitle}>Verifications by Country</h3>
          {data.countryHeatmap.length > 0 ? (
            <CountryBars data={data.countryHeatmap} />
          ) : (
            <div style={{ color: '#9AA0A6', textAlign: 'center', padding: 40 }}>No country data</div>
          )}
        </div>

        {/* Document types */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ ...sectionTitle, marginBottom: 0 }}>Document Types</h3>
          </div>
          {data.documentTypes.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.documentTypes.map(dt => {
                const pct = summary.totalVerifications > 0
                  ? Math.round((dt.count / summary.totalVerifications) * 100)
                  : 0
                return (
                  <div key={dt.type}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: '0.82rem', textTransform: 'capitalize', color: '#E8EAED' }}>
                        {dt.type.replace(/_/g, ' ')}
                      </span>
                      <span style={{ fontSize: '0.78rem', color: '#9AA0A6' }}>
                        {dt.count} ({pct}%)
                      </span>
                    </div>
                    <div style={{ height: 6, background: 'rgba(255,255,255,0.04)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, #00E5FF, #7B2FBE)',
                        borderRadius: 3,
                      }} />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ color: '#9AA0A6', textAlign: 'center', padding: 40 }}>No data</div>
          )}
        </div>
      </div>

      {/* Expiring documents */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ ...sectionTitle, marginBottom: 0 }}>
            Documents Expiring Soon
            {data.expiringSoon.length > 0 && (
              <span style={{
                background: 'rgba(255,77,77,0.12)',
                color: '#FF4D4D',
                padding: '2px 8px',
                borderRadius: 10,
                fontSize: '0.7rem',
                marginLeft: 10,
                fontWeight: 700,
              }}>
                {data.expiringSoon.length}
              </span>
            )}
          </h3>
          <Link
            href="/dashboard/verifications"
            style={{ color: '#00E5FF', fontSize: '0.78rem', fontWeight: 600, textDecoration: 'none' }}
          >
            View all verifications →
          </Link>
        </div>

        {data.expiringSoon.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <th style={{ padding: '10px 12px', fontSize: '0.7rem', textTransform: 'uppercase', color: '#9AA0A6', fontWeight: 600 }}>Holder</th>
                  <th style={{ padding: '10px 12px', fontSize: '0.7rem', textTransform: 'uppercase', color: '#9AA0A6', fontWeight: 600 }}>Nationality</th>
                  <th style={{ padding: '10px 12px', fontSize: '0.7rem', textTransform: 'uppercase', color: '#9AA0A6', fontWeight: 600 }}>Expiry Date</th>
                  <th style={{ padding: '10px 12px', fontSize: '0.7rem', textTransform: 'uppercase', color: '#9AA0A6', fontWeight: 600 }}>Days Left</th>
                  <th style={{ padding: '10px 12px', fontSize: '0.7rem', textTransform: 'uppercase', color: '#9AA0A6', fontWeight: 600 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.expiringSoon.map(doc => (
                  <tr key={doc.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <td style={{ padding: '10px 12px', fontSize: '0.85rem', fontWeight: 600 }}>{doc.holderName}</td>
                    <td style={{ padding: '10px 12px', fontSize: '0.85rem', color: '#9AA0A6' }}>{doc.nationality}</td>
                    <td style={{ padding: '10px 12px', fontSize: '0.85rem' }}>{doc.expiryDate}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{
                        background: doc.daysUntilExpiry <= 14
                          ? 'rgba(255,77,77,0.12)'
                          : doc.daysUntilExpiry <= 30
                          ? 'rgba(255,215,0,0.12)'
                          : 'rgba(0,229,255,0.08)',
                        color: doc.daysUntilExpiry <= 14
                          ? '#FF4D4D'
                          : doc.daysUntilExpiry <= 30
                          ? '#FFD700'
                          : '#00E5FF',
                        padding: '3px 10px',
                        borderRadius: 10,
                        fontSize: '0.75rem',
                        fontWeight: 700,
                      }}>
                        {doc.daysUntilExpiry}d
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <Link
                        href={`/verify/${doc.id}`}
                        style={{ color: '#00E5FF', fontSize: '0.78rem', fontWeight: 600, textDecoration: 'none' }}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ color: '#9AA0A6', textAlign: 'center', padding: 30, fontSize: '0.9rem' }}>
            No documents expiring within 90 days
          </div>
        )}
      </div>
    </div>
  )
}
