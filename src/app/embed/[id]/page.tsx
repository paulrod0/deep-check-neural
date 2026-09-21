'use client'

import React, { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

interface CertificateData {
  valid: boolean
  expired: boolean
  certificate: {
    id: string
    version: string
    issuedAt: string
    expiresAt: string
    verification: {
      verdict: 'authentic' | 'suspicious' | 'tampered'
      documentType: string
      mrzSummary: {
        nationality: string
        documentType: string
        isExpired: boolean
        checksumsPassed: number
        checksumsFailed: number
      } | null
      forensicsSummary: {
        riskScore: number
        riskLevel: string
      }
      faceMatchPerformed: boolean
      livenessCheckPerformed: boolean
    }
    verifyUrl: string
    signature: string
    issuer: {
      name: string
      url: string
      deployMode: string
    }
  }
}

const VERDICT_STYLE: Record<string, { bg: string; color: string; icon: string; label: string }> = {
  authentic:  { bg: 'rgba(0,229,255,0.12)', color: '#00E5FF', icon: '✓', label: 'Verified Authentic' },
  suspicious: { bg: 'rgba(255,215,0,0.12)', color: '#FFD700', icon: '⚠', label: 'Suspicious' },
  tampered:   { bg: 'rgba(255,77,77,0.12)',  color: '#FF4D4D', icon: '✗', label: 'Tampered' },
}

export default function EmbedPage() {
  const params = useParams()
  const id = params.id as string
  const [data, setData] = useState<CertificateData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    fetch(`/api/certificates?id=${id}`)
      .then(r => r.json())
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={{ color: '#9AA0A6', fontSize: '0.85rem' }}>Verifying certificate...</div>
      </div>
    )
  }

  if (error || !data || !data.certificate) {
    return (
      <div style={containerStyle}>
        <div style={{ color: '#FF4D4D', fontWeight: 700, fontSize: '0.9rem' }}>Certificate Not Found</div>
        <div style={{ color: '#9AA0A6', fontSize: '0.75rem', marginTop: 4 }}>ID: {id}</div>
      </div>
    )
  }

  const cert = data.certificate
  const v = cert.verification
  const vs = VERDICT_STYLE[v.verdict] || VERDICT_STYLE.suspicious
  const issuedDate = new Date(cert.issuedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <div style={containerStyle}>
      {/* Gradient top bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: 'linear-gradient(90deg, #00E5FF, #7B2FBE)',
        borderRadius: '8px 8px 0 0',
      }} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: '0.95rem', fontWeight: 800 }}>
          Deep-Check<span style={{ color: '#00E5FF' }}>.</span>
        </div>
        <div style={{
          background: vs.bg,
          color: vs.color,
          padding: '3px 12px',
          borderRadius: 6,
          fontSize: '0.72rem',
          fontWeight: 700,
        }}>
          {vs.icon} {vs.label}
        </div>
      </div>

      {/* Certificate details */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
        <div>
          <span style={{ fontSize: '0.65rem', color: '#9AA0A6', textTransform: 'uppercase' }}>Certificate ID</span>
          <div style={{ fontSize: '0.78rem', fontWeight: 600, fontFamily: 'monospace', color: '#00E5FF' }}>
            {cert.id.slice(0, 20)}...
          </div>
        </div>
        <div>
          <span style={{ fontSize: '0.65rem', color: '#9AA0A6', textTransform: 'uppercase' }}>Issued</span>
          <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>{issuedDate}</div>
        </div>
        <div>
          <span style={{ fontSize: '0.65rem', color: '#9AA0A6', textTransform: 'uppercase' }}>Document Type</span>
          <div style={{ fontSize: '0.78rem', fontWeight: 600, textTransform: 'capitalize' }}>{v.documentType.replace(/_/g, ' ')}</div>
        </div>
        <div>
          <span style={{ fontSize: '0.65rem', color: '#9AA0A6', textTransform: 'uppercase' }}>Risk Score</span>
          <div style={{
            fontSize: '0.78rem', fontWeight: 700,
            color: v.forensicsSummary.riskScore < 30 ? '#00E5FF' : v.forensicsSummary.riskScore < 60 ? '#FFD700' : '#FF4D4D',
          }}>
            {v.forensicsSummary.riskScore}/100
          </div>
        </div>
      </div>

      {/* Checks summary */}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {v.mrzSummary && (
          <span style={chipStyle(!v.mrzSummary.isExpired)}>
            MRZ {v.mrzSummary.checksumsPassed}/{v.mrzSummary.checksumsPassed + v.mrzSummary.checksumsFailed}
          </span>
        )}
        {v.faceMatchPerformed && <span style={chipStyle(true)}>Face Match</span>}
        {v.livenessCheckPerformed && <span style={chipStyle(true)}>Liveness</span>}
        {data.valid && <span style={chipStyle(true)}>Signature Valid</span>}
        {data.expired && <span style={chipStyle(false)}>Expired</span>}
      </div>

      {/* Footer */}
      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <a
          href={cert.verifyUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#00E5FF', fontSize: '0.7rem', fontWeight: 600, textDecoration: 'none' }}
        >
          Verify at deep-check.io →
        </a>
        <span style={{ fontSize: '0.6rem', color: '#555' }}>
          Powered by Deep-Check · {cert.issuer.deployMode}
        </span>
      </div>
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  position: 'relative',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  background: '#0A0F14',
  color: '#E8EAED',
  borderRadius: 8,
  border: '1px solid #1E2A36',
  padding: '16px 20px',
  maxWidth: 400,
  margin: 0,
  overflow: 'hidden',
}

function chipStyle(ok: boolean): React.CSSProperties {
  return {
    background: ok ? 'rgba(34,197,94,0.1)' : 'rgba(255,77,77,0.1)',
    color: ok ? '#22C55E' : '#FF4D4D',
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: '0.65rem',
    fontWeight: 600,
  }
}
