'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Verification {
  id: string
  createdAt: string
  verdict: 'authentic' | 'suspicious' | 'tampered' | string
  documentType: string
  holderName: string | null
  nationality: string | null
  docNumber: string | null
  dateOfBirth: string | null
  expiryDate: string | null
  isExpired: boolean
  riskScore: number
  riskLevel: string
  mrzValid: boolean | null
  faceQuality: number | null
  ocrMode: string | null
  onPremise: boolean
  countryInfo: { name: string; region: string } | null
  countryValidation: { valid: boolean; documentType: string; details: string } | null
  alertCount: number
}

interface Stats {
  total: number
  authentic: number
  suspicious: number
  tampered: number
}

interface Pagination {
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

type VerdictFilter = 'all' | 'authentic' | 'suspicious' | 'tampered'
type SortField = 'created_at' | 'risk_score'

// ── Verdict colors ──────────────────────────────────────────────────────────

const VERDICT_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  authentic:  { bg: 'rgba(0,229,255,0.12)', fg: '#00E5FF', label: '✓ Authentic' },
  suspicious: { bg: 'rgba(255,215,0,0.12)', fg: '#FFD700', label: '⚠ Suspicious' },
  tampered:   { bg: 'rgba(255,77,77,0.12)',  fg: '#FF4D4D', label: '✗ Tampered' },
  unknown:    { bg: 'rgba(255,255,255,0.05)', fg: '#9AA0A6', label: '? Unknown' },
}

// ── CSV export ──────────────────────────────────────────────────────────────

function exportCSV(rows: Verification[]) {
  const headers = [
    'Certificate ID', 'Date', 'Verdict', 'Document Type', 'Holder Name',
    'Nationality', 'Doc Number', 'DOB', 'Expiry', 'Risk Score',
    'MRZ Valid', 'Alerts', 'Country', 'On-Premise',
  ]
  const csvRows = rows.map(v => [
    v.id,
    new Date(v.createdAt).toISOString(),
    v.verdict,
    v.documentType,
    v.holderName || '',
    v.nationality || '',
    v.docNumber || '',
    v.dateOfBirth || '',
    v.expiryDate || '',
    String(v.riskScore),
    v.mrzValid === null ? 'N/A' : v.mrzValid ? 'Yes' : 'No',
    String(v.alertCount),
    v.countryInfo?.name || '',
    v.onPremise ? 'Yes' : 'No',
  ])
  const csv = [headers, ...csvRows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `deep-check-verifications-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function VerificationsPage() {
  const [verifications, setVerifications] = useState<Verification[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, authentic: 0, suspicious: 0, tampered: 0 })
  const [pagination, setPagination] = useState<Pagination>({ total: 0, limit: 50, offset: 0, hasMore: false })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('all')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(0)

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const PAGE_SIZE = 25

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
        sort: sortField,
        order: sortOrder,
      })
      if (verdictFilter !== 'all') params.set('verdict', verdictFilter)
      if (search) params.set('search', search)
      if (dateFrom) params.set('from', dateFrom)
      if (dateTo) params.set('to', dateTo)

      const res = await fetch(`/api/verifications?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setVerifications(data.verifications)
      setStats(data.stats)
      setPagination(data.pagination)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [verdictFilter, search, dateFrom, dateTo, sortField, sortOrder, page])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Debounced search
  const [searchInput, setSearchInput] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput)
      setPage(0)
    }, 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  const totalPages = Math.ceil(pagination.total / PAGE_SIZE)

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
    setPage(0)
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0 }}>
            Verification History
          </h1>
          <p style={{ color: '#9AA0A6', margin: '4px 0 0', fontSize: '0.9rem' }}>
            KYC identity verification records · {pagination.total} total
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <Link
            href="/documents/verify"
            style={{
              background: '#00E5FF',
              color: '#000',
              padding: '10px 20px',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: '0.85rem',
              textDecoration: 'none',
            }}
          >
            + New Verification
          </Link>
          <button
            onClick={() => exportCSV(verifications)}
            disabled={verifications.length === 0}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#E8EAED',
              padding: '10px 20px',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: verifications.length === 0 ? 'not-allowed' : 'pointer',
              opacity: verifications.length === 0 ? 0.5 : 1,
            }}
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Stats cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Total Verifications', value: pagination.total, color: '#E8EAED' },
          { label: 'Authentic', value: stats.authentic, color: '#00E5FF' },
          { label: 'Suspicious', value: stats.suspicious, color: '#FFD700' },
          { label: 'Tampered', value: stats.tampered, color: '#FF4D4D' },
        ].map(card => (
          <div
            key={card.label}
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 12,
              padding: '20px 24px',
            }}
          >
            <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: '#9AA0A6', letterSpacing: '0.05em' }}>
              {card.label}
            </span>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: card.color, marginTop: 4 }}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Filters bar */}
      <div style={{
        display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 12,
        padding: '16px 20px',
      }}>
        {/* Search */}
        <input
          type="text"
          placeholder="Search by name, ID, doc number..."
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          style={{
            flex: 1, minWidth: 200,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            padding: '8px 14px',
            fontSize: '0.85rem',
            color: '#E8EAED',
            outline: 'none',
          }}
        />

        {/* Verdict pills */}
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'authentic', 'suspicious', 'tampered'] as const).map(v => (
            <button
              key={v}
              onClick={() => { setVerdictFilter(v); setPage(0) }}
              style={{
                background: verdictFilter === v
                  ? (v === 'all' ? 'rgba(255,255,255,0.1)' : VERDICT_STYLE[v].bg)
                  : 'transparent',
                border: `1px solid ${verdictFilter === v
                  ? (v === 'all' ? 'rgba(255,255,255,0.2)' : VERDICT_STYLE[v].fg)
                  : 'rgba(255,255,255,0.08)'}`,
                color: verdictFilter === v
                  ? (v === 'all' ? '#E8EAED' : VERDICT_STYLE[v].fg)
                  : '#9AA0A6',
                padding: '6px 14px',
                borderRadius: 20,
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {v === 'all' ? 'All' : v}
            </button>
          ))}
        </div>

        {/* Date range */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="date"
            value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setPage(0) }}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: '0.8rem',
              color: '#9AA0A6',
              outline: 'none',
            }}
          />
          <span style={{ color: '#9AA0A6', fontSize: '0.8rem' }}>→</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => { setDateTo(e.target.value); setPage(0) }}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: '0.8rem',
              color: '#9AA0A6',
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Table */}
      <div style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 12,
        overflow: 'hidden',
      }}>
        {isLoading ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#9AA0A6' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: 12 }}>Loading...</div>
            <div style={{ fontSize: '0.85rem' }}>Fetching verification records</div>
          </div>
        ) : error ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#FF4D4D' }}>
            <div style={{ fontSize: '1.2rem', marginBottom: 8 }}>Error loading data</div>
            <div style={{ fontSize: '0.85rem', color: '#9AA0A6' }}>{error}</div>
            <button
              onClick={fetchData}
              style={{
                marginTop: 16,
                background: 'rgba(255,77,77,0.1)',
                border: '1px solid rgba(255,77,77,0.3)',
                color: '#FF4D4D',
                padding: '8px 20px',
                borderRadius: 8,
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Retry
            </button>
          </div>
        ) : verifications.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#9AA0A6' }}>
            <div style={{ fontSize: '2rem', marginBottom: 12 }}>No verifications found</div>
            <div style={{ fontSize: '0.9rem', marginBottom: 20 }}>
              {search || verdictFilter !== 'all' || dateFrom || dateTo
                ? 'Try adjusting your filters'
                : 'Start by verifying an identity document'}
            </div>
            <Link
              href="/documents/verify"
              style={{
                background: '#00E5FF',
                color: '#000',
                padding: '10px 24px',
                borderRadius: 8,
                fontWeight: 700,
                fontSize: '0.85rem',
                textDecoration: 'none',
              }}
            >
              Start KYC Verification
            </Link>
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <th style={thStyle}>Verdict</th>
                    <th
                      style={{ ...thStyle, cursor: 'pointer' }}
                      onClick={() => handleSort('created_at')}
                    >
                      Date {sortField === 'created_at' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
                    </th>
                    <th style={thStyle}>Holder</th>
                    <th style={thStyle}>Document</th>
                    <th style={thStyle}>Country</th>
                    <th
                      style={{ ...thStyle, cursor: 'pointer' }}
                      onClick={() => handleSort('risk_score')}
                    >
                      Risk {sortField === 'risk_score' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
                    </th>
                    <th style={thStyle}>MRZ</th>
                    <th style={thStyle}>Alerts</th>
                    <th style={thStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {verifications.map(v => {
                    const vs = VERDICT_STYLE[v.verdict] || VERDICT_STYLE.unknown
                    const isExpanded = expandedId === v.id
                    return (
                      <React.Fragment key={v.id}>
                        <tr
                          style={{
                            borderBottom: '1px solid rgba(255,255,255,0.03)',
                            cursor: 'pointer',
                            background: isExpanded ? 'rgba(0,229,255,0.03)' : 'transparent',
                          }}
                          onClick={() => setExpandedId(isExpanded ? null : v.id)}
                        >
                          {/* Verdict badge */}
                          <td style={tdStyle}>
                            <span style={{
                              background: vs.bg,
                              color: vs.fg,
                              padding: '4px 10px',
                              borderRadius: 6,
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                            }}>
                              {vs.label}
                            </span>
                          </td>

                          {/* Date */}
                          <td style={tdStyle}>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{formatDate(v.createdAt)}</div>
                            <div style={{ fontSize: '0.7rem', color: '#9AA0A6' }}>{formatTime(v.createdAt)}</div>
                          </td>

                          {/* Holder */}
                          <td style={tdStyle}>
                            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{v.holderName || '—'}</div>
                            <div style={{ fontSize: '0.7rem', color: '#9AA0A6', fontFamily: 'monospace' }}>
                              {v.id.slice(0, 12)}...
                            </div>
                          </td>

                          {/* Document type */}
                          <td style={tdStyle}>
                            <span style={{
                              background: 'rgba(255,255,255,0.05)',
                              padding: '3px 8px',
                              borderRadius: 4,
                              fontSize: '0.75rem',
                              textTransform: 'capitalize',
                            }}>
                              {v.documentType.replace(/_/g, ' ')}
                            </span>
                            {v.docNumber && (
                              <div style={{ fontSize: '0.7rem', color: '#9AA0A6', fontFamily: 'monospace', marginTop: 2 }}>
                                {v.docNumber}
                              </div>
                            )}
                          </td>

                          {/* Country */}
                          <td style={tdStyle}>
                            <span style={{ fontSize: '0.85rem' }}>
                              {v.countryInfo
                                ? (v.countryInfo as { name: string }).name
                                : v.nationality || '—'}
                            </span>
                          </td>

                          {/* Risk score */}
                          <td style={tdStyle}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{
                                width: 60, height: 6,
                                background: 'rgba(255,255,255,0.06)',
                                borderRadius: 3,
                                overflow: 'hidden',
                              }}>
                                <div style={{
                                  width: `${v.riskScore}%`,
                                  height: '100%',
                                  background: v.riskScore < 30 ? '#00E5FF' : v.riskScore < 60 ? '#FFD700' : '#FF4D4D',
                                  borderRadius: 3,
                                }} />
                              </div>
                              <span style={{
                                fontSize: '0.8rem',
                                fontWeight: 700,
                                color: v.riskScore < 30 ? '#00E5FF' : v.riskScore < 60 ? '#FFD700' : '#FF4D4D',
                              }}>
                                {v.riskScore}
                              </span>
                            </div>
                          </td>

                          {/* MRZ */}
                          <td style={tdStyle}>
                            {v.mrzValid === null ? (
                              <span style={{ color: '#9AA0A6', fontSize: '0.8rem' }}>N/A</span>
                            ) : v.mrzValid ? (
                              <span style={{ color: '#22C55E', fontSize: '0.8rem', fontWeight: 600 }}>✓ Valid</span>
                            ) : (
                              <span style={{ color: '#FF4D4D', fontSize: '0.8rem', fontWeight: 600 }}>✗ Invalid</span>
                            )}
                          </td>

                          {/* Alerts */}
                          <td style={tdStyle}>
                            {v.alertCount > 0 ? (
                              <span style={{
                                background: 'rgba(255,77,77,0.1)',
                                color: '#FF4D4D',
                                padding: '2px 8px',
                                borderRadius: 10,
                                fontSize: '0.75rem',
                                fontWeight: 700,
                              }}>
                                {v.alertCount}
                              </span>
                            ) : (
                              <span style={{ color: '#9AA0A6', fontSize: '0.8rem' }}>0</span>
                            )}
                          </td>

                          {/* Actions */}
                          <td style={tdStyle} onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <Link
                                href={`/verify/${v.id}`}
                                style={{
                                  color: '#00E5FF',
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                  textDecoration: 'none',
                                }}
                              >
                                Certificate
                              </Link>
                            </div>
                          </td>
                        </tr>

                        {/* Expanded details */}
                        {isExpanded && (
                          <tr>
                            <td colSpan={9} style={{ padding: 0 }}>
                              <div style={{
                                background: 'rgba(0,229,255,0.02)',
                                borderTop: '1px solid rgba(0,229,255,0.1)',
                                padding: '20px 24px',
                                display: 'grid',
                                gridTemplateColumns: 'repeat(3, 1fr)',
                                gap: 20,
                              }}>
                                {/* Holder details */}
                                <div>
                                  <h4 style={{ color: '#00E5FF', fontSize: '0.8rem', fontWeight: 700, marginBottom: 10, textTransform: 'uppercase' }}>
                                    Document Holder
                                  </h4>
                                  {[
                                    ['Name', v.holderName],
                                    ['Nationality', v.nationality],
                                    ['Doc Number', v.docNumber],
                                    ['Date of Birth', v.dateOfBirth],
                                    ['Expiry', v.expiryDate ? `${v.expiryDate}${v.isExpired ? ' (EXPIRED)' : ''}` : null],
                                  ].map(([label, val]) => (
                                    <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.82rem' }}>
                                      <span style={{ color: '#9AA0A6' }}>{label}</span>
                                      <span style={{ fontWeight: 600, color: val ? '#E8EAED' : '#555' }}>{val || '—'}</span>
                                    </div>
                                  ))}
                                </div>

                                {/* Verification details */}
                                <div>
                                  <h4 style={{ color: '#00E5FF', fontSize: '0.8rem', fontWeight: 700, marginBottom: 10, textTransform: 'uppercase' }}>
                                    Verification Details
                                  </h4>
                                  {[
                                    ['Risk Score', `${v.riskScore}/100 (${v.riskLevel})`],
                                    ['MRZ Valid', v.mrzValid === null ? 'N/A' : v.mrzValid ? 'Yes' : 'No'],
                                    ['Face Quality', v.faceQuality !== null ? `${v.faceQuality}/100` : 'N/A'],
                                    ['OCR Mode', v.ocrMode || 'None'],
                                    ['On-Premise', v.onPremise ? 'Yes' : 'No'],
                                  ].map(([label, val]) => (
                                    <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.82rem' }}>
                                      <span style={{ color: '#9AA0A6' }}>{label}</span>
                                      <span style={{ fontWeight: 600 }}>{val}</span>
                                    </div>
                                  ))}
                                </div>

                                {/* Country validation */}
                                <div>
                                  <h4 style={{ color: '#00E5FF', fontSize: '0.8rem', fontWeight: 700, marginBottom: 10, textTransform: 'uppercase' }}>
                                    Country Validation
                                  </h4>
                                  {v.countryInfo ? (
                                    <>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.82rem' }}>
                                        <span style={{ color: '#9AA0A6' }}>Country</span>
                                        <span style={{ fontWeight: 600 }}>{(v.countryInfo as { name: string }).name}</span>
                                      </div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.82rem' }}>
                                        <span style={{ color: '#9AA0A6' }}>Region</span>
                                        <span style={{ fontWeight: 600 }}>{(v.countryInfo as { region: string }).region}</span>
                                      </div>
                                    </>
                                  ) : (
                                    <div style={{ color: '#9AA0A6', fontSize: '0.82rem' }}>No country data available</div>
                                  )}
                                  {v.countryValidation && (
                                    <>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.82rem' }}>
                                        <span style={{ color: '#9AA0A6' }}>Doc Valid</span>
                                        <span style={{
                                          fontWeight: 700,
                                          color: (v.countryValidation as { valid: boolean }).valid ? '#22C55E' : '#FF4D4D',
                                        }}>
                                          {(v.countryValidation as { valid: boolean }).valid ? '✓ Valid' : '✗ Invalid'}
                                        </span>
                                      </div>
                                      <div style={{ fontSize: '0.75rem', color: '#9AA0A6', marginTop: 4 }}>
                                        {(v.countryValidation as { details: string }).details}
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Actions bar */}
                              <div style={{
                                background: 'rgba(0,229,255,0.02)',
                                borderTop: '1px solid rgba(255,255,255,0.04)',
                                padding: '12px 24px',
                                display: 'flex',
                                gap: 12,
                              }}>
                                <Link
                                  href={`/verify/${v.id}`}
                                  style={{
                                    background: 'rgba(0,229,255,0.1)',
                                    border: '1px solid rgba(0,229,255,0.3)',
                                    color: '#00E5FF',
                                    padding: '6px 16px',
                                    borderRadius: 6,
                                    fontSize: '0.78rem',
                                    fontWeight: 600,
                                    textDecoration: 'none',
                                  }}
                                >
                                  View Certificate
                                </Link>
                                <span style={{
                                  color: '#9AA0A6',
                                  fontSize: '0.75rem',
                                  display: 'flex',
                                  alignItems: 'center',
                                  fontFamily: 'monospace',
                                }}>
                                  ID: {v.id}
                                </span>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px 24px',
                borderTop: '1px solid rgba(255,255,255,0.06)',
              }}>
                <span style={{ color: '#9AA0A6', fontSize: '0.82rem' }}>
                  Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, pagination.total)} of {pagination.total}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    style={paginationBtnStyle(page === 0)}
                  >
                    ← Prev
                  </button>
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    const pageNum = page < 3 ? i : page + i - 2
                    if (pageNum < 0 || pageNum >= totalPages) return null
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setPage(pageNum)}
                        style={{
                          ...paginationBtnStyle(false),
                          background: page === pageNum ? 'rgba(0,229,255,0.15)' : 'transparent',
                          color: page === pageNum ? '#00E5FF' : '#9AA0A6',
                          fontWeight: page === pageNum ? 700 : 400,
                        }}
                      >
                        {pageNum + 1}
                      </button>
                    )
                  })}
                  <button
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    style={paginationBtnStyle(page >= totalPages - 1)}
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: '14px 16px',
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  color: '#9AA0A6',
  fontWeight: 600,
  letterSpacing: '0.05em',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
}

const tdStyle: React.CSSProperties = {
  padding: '14px 16px',
}

function paginationBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: disabled ? '#555' : '#E8EAED',
    padding: '6px 14px',
    borderRadius: 6,
    fontSize: '0.8rem',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 500,
  }
}
