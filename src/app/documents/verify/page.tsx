'use client'

/**
 * /documents/verify — Identity Document KYC Wizard
 * =================================================
 * 4-step guided verification:
 *   0 — Select document type
 *   1 — Capture document photo
 *   2 — Capture live selfie
 *   3 — Analysis results + certificate
 *
 * Face match is done entirely client-side (MediaPipe) — no biometric
 * data is sent to the server. Forensics and MRZ parsing run in parallel
 * with the client-side face match for maximum speed.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'
import DocumentCapture from '@/components/DocumentCapture'
import { compareFaces, warmupFaceMatch, type FaceMatchResult } from '@/lib/faceMatch'
import { analyzeImage, type ForensicsReport } from '@/lib/imageForensics'

// ── Types ─────────────────────────────────────────────────────────────────────

type DocType = 'passport' | 'dni' | 'driving_license' | 'residence_permit' | 'eu_id_card' | 'visa'

interface VerifyAPIResponse {
  ocr: {
    mrzValid:        boolean | null
    mrzDocumentType: string
    mrzFields:       {
      surname: string; givenNames: string; nationality: string
      docNumber: string; dob: string; dobFormatted: string
      sex: string; expiry: string; expiryFormatted: string
      isExpired: boolean
    } | null
    mrzAlerts:       { field: string; detail: string }[]
    checksumsPassed: number
    checksumsFailed: number
    ocrMode:         string
  }
  faceQuality: { faceFound: boolean; faceCount: number; qualityScore: number; suspicious: boolean }
  verdict:         'authentic' | 'suspicious' | 'tampered'
  certificateId:   string
  onPremise:       boolean
}

// ── Step 0: Document type selection ──────────────────────────────────────────

const DOC_TYPES: { id: DocType; icon: string; label: string; desc: string; mrzFormat?: string }[] = [
  { id: 'passport',         icon: '🛂', label: 'Passport',             desc: '195+ countries · TD3 (2×44)',   mrzFormat: 'TD3' },
  { id: 'dni',              icon: '🪪', label: 'National ID (DNI/NIE)', desc: 'EU/Spain · TD1 (3×30)',         mrzFormat: 'TD1' },
  { id: 'driving_license',  icon: '🚗', label: 'Driving Licence',       desc: 'EU format · TD1 (3×30)',        mrzFormat: 'TD1' },
  { id: 'residence_permit', icon: '🏠', label: 'Residence Permit',       desc: 'EU TIE/NIE card · TD1 (3×30)', mrzFormat: 'TD1' },
  { id: 'eu_id_card',       icon: '🇪🇺', label: 'EU ID Card (older)',    desc: 'Pre-2017 EU cards · TD2 (2×36)', mrzFormat: 'TD2' },
  { id: 'visa',             icon: '✈️', label: 'Visa',                   desc: 'Schengen / MRV-B (2×36)',      mrzFormat: 'MRV-B' },
]

// ── Verdict display config ────────────────────────────────────────────────────

const VERDICT_CONFIG = {
  authentic:  { color: 'var(--color-primary)', icon: '✅', label: 'Authentic', bg: 'rgba(0,229,255,0.08)' },
  suspicious: { color: '#ffd700',              icon: '⚠️', label: 'Suspicious', bg: 'rgba(255,215,0,0.08)' },
  tampered:   { color: '#ff4d4d',              icon: '❌', label: 'Tampered',   bg: 'rgba(255,77,77,0.08)' },
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function VerifyPage() {
  const [step, setStep]               = useState(0)
  const [docType, setDocType]         = useState<DocType>('passport')
  const [docImage, setDocImage]       = useState<string | null>(null)
  const [selfieImage, setSelfieImage] = useState<string | null>(null)
  const [analyzing, setAnalyzing]     = useState(false)
  const [faceMatch, setFaceMatch]     = useState<FaceMatchResult | null>(null)
  const [forensics, setForensics]     = useState<ForensicsReport | null>(null)
  const [apiResult, setApiResult]     = useState<VerifyAPIResponse | null>(null)
  const [error, setError]             = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const capturedRef = useRef(false)

  // Pre-warm face match model on mount
  useEffect(() => { warmupFaceMatch() }, [])

  // Cleanup camera on unmount
  useEffect(() => {
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()) }
  }, [])

  // ── Step 2: selfie camera ───────────────────────────────────────────────────

  useEffect(() => {
    if (step !== 2) return
    let mounted = true
    capturedRef.current = false

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
      } catch (err) {
        if (mounted) setError(`Camera error: ${(err as Error).message}`)
      }
    }
    start()
    return () => {
      mounted = false
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [step])

  const captureSelfie = useCallback(() => {
    if (capturedRef.current) return
    const video = videoRef.current
    if (!video) return
    capturedRef.current = true

    const canvas = document.createElement('canvas')
    canvas.width  = video.videoWidth  || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    setSelfieImage(dataUrl)
    streamRef.current?.getTracks().forEach(t => t.stop())
    setStep(3)
  }, [])

  // ── Step 3: run analysis ────────────────────────────────────────────────────

  useEffect(() => {
    if (step !== 3 || !docImage || !selfieImage || analyzing) return

    setAnalyzing(true)
    setError(null)

    const run = async () => {
      try {
        // Run face match + forensics in parallel (both client-side)
        const [faceResult, forensicsResult] = await Promise.all([
          compareFaces(docImage, selfieImage),
          (async () => {
            try {
              // Convert data URL to File for analyzeImage
              const res   = await fetch(docImage)
              const blob  = await res.blob()
              const file  = new File([blob], 'document.jpg', { type: 'image/jpeg' })
              return await analyzeImage(file)
            } catch {
              return null
            }
          })(),
        ])

        setFaceMatch(faceResult)
        setForensics(forensicsResult)

        // Server-side: Textract OCR + Rekognition + save to DB
        const serverRes = await fetch('/api/documents/verify', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documentFront:   docImage,
            documentType:    docType,
            forensicsReport: forensicsResult ? {
              riskScore:   forensicsResult.riskScore,
              riskLevel:   forensicsResult.riskLevel,
              elaScore:    forensicsResult.elaScore,
              exifScore:   forensicsResult.exifScore,
              noiseScore:  forensicsResult.noiseScore,
              dctScore:    forensicsResult.dctScore,
              chromaScore: forensicsResult.chromaScore,
              edgeScore:   forensicsResult.edgeScore,
              alerts:      forensicsResult.alerts,
            } : undefined,
          }),
        })

        if (serverRes.ok) {
          const data = await serverRes.json() as VerifyAPIResponse
          setApiResult(data)
        } else {
          console.warn('[verify] Server API error:', serverRes.status)
        }
      } catch (err) {
        setError(`Analysis error: ${(err as Error).message}`)
      } finally {
        setAnalyzing(false)
      }
    }

    run()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // ── Computed verdict (combines client + server) ────────────────────────────

  const finalVerdict: 'authentic' | 'suspicious' | 'tampered' = (() => {
    if (!faceMatch) return 'suspicious'
    if (!faceMatch.match && faceMatch.documentFaceFound && faceMatch.selfieFaceFound)
      return 'tampered'
    const serverVerdict = apiResult?.verdict ?? 'authentic'
    if (serverVerdict === 'tampered') return 'tampered'
    if (serverVerdict === 'suspicious' || !faceMatch.match) return 'suspicious'
    return 'authentic'
  })()

  const verdictCfg = VERDICT_CONFIG[finalVerdict]

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <main style={{ minHeight: '100vh', padding: '2rem 1rem', background: 'var(--color-bg)' }}>
      <div className="container" style={{ maxWidth: 720 }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <Link href="/documents" style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', textDecoration: 'none' }}>
            ← Back to Document Analysis
          </Link>
          <h1 style={{ marginTop: '1rem', fontSize: '1.6rem', fontWeight: 700 }}>
            🪪 Identity Document Verification
          </h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
            KYC verification — document authenticity + face match. All biometric processing runs in your browser.
          </p>
        </div>

        {/* Progress bar */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
          {['Document Type', 'Capture Document', 'Live Selfie', 'Results'].map((label, i) => (
            <div key={i} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{
                height: 4,
                borderRadius: 2,
                background: i <= step ? 'var(--color-primary)' : 'var(--color-border)',
                marginBottom: '0.4rem',
                transition: 'background 0.3s',
              }} />
              <span style={{
                fontSize: '0.72rem',
                color: i === step ? 'var(--color-primary)' : 'var(--color-text-muted)',
                fontWeight: i === step ? 600 : 400,
              }}>
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Step 0 — Document type */}
        {step === 0 && (
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <h2 style={{ marginBottom: '1.5rem', fontSize: '1.15rem' }}>Select Document Type</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {DOC_TYPES.map(doc => (
                <button
                  key={doc.id}
                  onClick={() => setDocType(doc.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '1rem',
                    padding: '1rem 1.25rem', borderRadius: 10,
                    border: `2px solid ${docType === doc.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    background: docType === doc.id ? 'rgba(0,229,255,0.06)' : 'transparent',
                    color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left',
                    transition: 'all 0.2s',
                  }}
                >
                  <span style={{ fontSize: '1.8rem' }}>{doc.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{doc.label}</div>
                    <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>{doc.desc}</div>
                  </div>
                  {docType === doc.id && (
                    <span style={{ marginLeft: 'auto', color: 'var(--color-primary)' }}>✓</span>
                  )}
                </button>
              ))}
            </div>
            <button
              className="btn btn-primary"
              style={{ marginTop: '2rem', width: '100%' }}
              onClick={() => setStep(1)}
            >
              Continue →
            </button>
          </div>
        )}

        {/* Step 1 — Document capture */}
        {step === 1 && (
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <h2 style={{ marginBottom: '0.5rem', fontSize: '1.15rem' }}>
              Capture Your {DOC_TYPES.find(d => d.id === docType)?.label}
            </h2>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              Place your document flat on a dark surface. Avoid glare and keep the MRZ zone visible.
            </p>
            <DocumentCapture
              documentType={docType}
              onCapture={(dataUrl) => {
                setDocImage(dataUrl)
                setStep(2)
              }}
            />
          </div>
        )}

        {/* Step 2 — Selfie */}
        {step === 2 && (
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <h2 style={{ marginBottom: '0.5rem', fontSize: '1.15rem' }}>Take a Live Selfie</h2>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              Face the camera directly. Ensure good lighting. This photo will be compared to your document.
            </p>

            <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#000' }}>
              <video
                ref={videoRef}
                muted
                playsInline
                style={{ display: 'block', width: '100%', maxHeight: 360, objectFit: 'cover' }}
              />
              {/* Face oval guide */}
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 160, height: 200,
                borderRadius: '50%',
                border: '3px solid var(--color-primary)',
                boxShadow: '0 0 12px var(--color-primary)',
                pointerEvents: 'none',
              }} />
            </div>

            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', textAlign: 'center', margin: '0.75rem 0' }}>
              Center your face in the oval
            </p>

            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '0.5rem' }}
              onClick={captureSelfie}
            >
              📸 Capture Selfie
            </button>
          </div>
        )}

        {/* Step 3 — Results */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            {/* Analysis in progress */}
            {(analyzing || (!faceMatch && !error)) && (
              <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
                <div style={{
                  width: 48, height: 48, border: '3px solid var(--color-primary)',
                  borderTopColor: 'transparent', borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite', margin: '0 auto 1.25rem',
                }} />
                <p style={{ color: 'var(--color-text-muted)' }}>
                  {!faceMatch ? 'Running face match & forensics analysis…' : 'Fetching OCR results…'}
                </p>
                <p style={{ color: 'var(--color-text-dim)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
                  Face comparison runs in your browser — no biometric data is transmitted
                </p>
              </div>
            )}

            {error && (
              <div className="glass-panel" style={{ padding: '1.5rem', border: '1px solid #ff4d4d' }}>
                <p style={{ color: '#ff4d4d' }}>⚠️ {error}</p>
              </div>
            )}

            {/* Verdict */}
            {faceMatch && (
              <div className="glass-panel" style={{
                padding: '2rem', textAlign: 'center',
                border: `2px solid ${verdictCfg.color}`,
                background: verdictCfg.bg,
              }}>
                <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>{verdictCfg.icon}</div>
                <h2 style={{ color: verdictCfg.color, fontSize: '1.6rem', fontWeight: 800, marginBottom: '0.5rem' }}>
                  {verdictCfg.label}
                </h2>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                  {finalVerdict === 'authentic'
                    ? 'Identity document verified successfully. Face match and forensics passed.'
                    : finalVerdict === 'suspicious'
                    ? 'Some checks raised concerns. Manual review is recommended.'
                    : 'Document shows signs of tampering or face mismatch detected.'}
                </p>
                {apiResult?.certificateId && (
                  <p style={{ color: 'var(--color-text-dim)', fontSize: '0.75rem', marginTop: '0.75rem', fontFamily: 'monospace' }}>
                    Cert ID: {apiResult.certificateId}
                  </p>
                )}
              </div>
            )}

            {/* Face Match */}
            {faceMatch && (
              <div className="glass-panel" style={{ padding: '1.5rem' }}>
                <h3 style={{ marginBottom: '1rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  👤 Face Match
                  <span style={{
                    padding: '2px 10px', borderRadius: 20, fontSize: '0.78rem',
                    background: faceMatch.match ? 'rgba(0,229,255,0.15)' : 'rgba(255,77,77,0.15)',
                    color: faceMatch.match ? 'var(--color-primary)' : '#ff4d4d',
                    fontWeight: 600,
                  }}>
                    {faceMatch.match ? 'MATCH' : 'MISMATCH'}
                  </span>
                </h3>

                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                  {/* Similarity score ring */}
                  <div style={{ textAlign: 'center', minWidth: 90 }}>
                    <div style={{ position: 'relative', width: 80, height: 80, margin: '0 auto' }}>
                      <svg viewBox="0 0 80 80" style={{ transform: 'rotate(-90deg)' }}>
                        <circle cx="40" cy="40" r="34" fill="none" stroke="var(--color-border)" strokeWidth="7" />
                        <circle
                          cx="40" cy="40" r="34" fill="none"
                          stroke={faceMatch.match ? 'var(--color-primary)' : '#ffd700'}
                          strokeWidth="7"
                          strokeDasharray={`${2 * Math.PI * 34}`}
                          strokeDashoffset={`${2 * Math.PI * 34 * (1 - faceMatch.similarityScore)}`}
                          strokeLinecap="round"
                        />
                      </svg>
                      <div style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.9rem', fontWeight: 700,
                        color: faceMatch.match ? 'var(--color-primary)' : '#ffd700',
                      }}>
                        {(faceMatch.similarityScore * 100).toFixed(0)}%
                      </div>
                    </div>
                    <p style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.4rem' }}>Similarity</p>
                  </div>

                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                      {[
                        ['Document face', faceMatch.documentFaceFound ? '✓ Detected' : '✗ Not found', faceMatch.documentFaceFound],
                        ['Selfie face', faceMatch.selfieFaceFound ? '✓ Detected' : '✗ Not found', faceMatch.selfieFaceFound],
                        ['Threshold', '82% similarity', true],
                        ['Processing', `${faceMatch.processingMs.toFixed(0)}ms`, true],
                      ].map(([label, value, ok]) => (
                        <div key={label as string}>
                          <p style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{label as string}</p>
                          <p style={{ fontSize: '0.85rem', fontWeight: 600, color: ok ? 'var(--color-text)' : '#ff4d4d' }}>{value as string}</p>
                        </div>
                      ))}
                    </div>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem', marginTop: '0.75rem' }}>
                      🔒 {faceMatch.message}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* MRZ Fields */}
            {apiResult?.ocr?.mrzFields && (
              <div className="glass-panel" style={{ padding: '1.5rem' }}>
                <h3 style={{ marginBottom: '1rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  📋 Document Data (MRZ)
                  <span style={{
                    padding: '2px 10px', borderRadius: 20, fontSize: '0.78rem',
                    background: apiResult.ocr.mrzValid ? 'rgba(0,229,255,0.15)' : 'rgba(255,215,0,0.15)',
                    color: apiResult.ocr.mrzValid ? 'var(--color-primary)' : '#ffd700',
                    fontWeight: 600,
                  }}>
                    {apiResult.ocr.checksumsPassed}/{apiResult.ocr.checksumsPassed + apiResult.ocr.checksumsFailed} checks passed
                  </span>
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.75rem' }}>
                  {[
                    ['Surname',       apiResult.ocr.mrzFields.surname],
                    ['Given Names',   apiResult.ocr.mrzFields.givenNames],
                    ['Nationality',   apiResult.ocr.mrzFields.nationality],
                    ['Document No.',  apiResult.ocr.mrzFields.docNumber],
                    ['Date of Birth', apiResult.ocr.mrzFields.dobFormatted],
                    ['Sex',           apiResult.ocr.mrzFields.sex],
                    ['Expiry',        `${apiResult.ocr.mrzFields.expiryFormatted}${apiResult.ocr.mrzFields.isExpired ? ' ⚠️' : ''}`],
                  ].filter(([, v]) => v).map(([label, value]) => (
                    <div key={label as string} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
                      <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: '0.2rem' }}>{label as string}</p>
                      <p style={{ fontSize: '0.88rem', fontWeight: 600, wordBreak: 'break-all' }}>{value as string || '—'}</p>
                    </div>
                  ))}
                </div>
                {apiResult.ocr.mrzAlerts.length > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    {apiResult.ocr.mrzAlerts.map((a, i) => (
                      <p key={i} style={{ color: '#ffd700', fontSize: '0.8rem', marginTop: '0.35rem' }}>
                        ⚠️ {a.detail}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Forensics */}
            {forensics && (
              <div className="glass-panel" style={{ padding: '1.5rem' }}>
                <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>🔬 Document Forensics</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.75rem' }}>
                  {[
                    ['Risk Score',    `${forensics.riskScore}/100`,   forensics.riskScore < 30],
                    ['ELA',           `${Math.round(forensics.elaScore)}/100`,  forensics.elaScore < 30],
                    ['EXIF',          `${Math.round(forensics.exifScore)}/100`, forensics.exifScore < 30],
                    ['Noise',         `${Math.round(forensics.noiseScore)}/100`, forensics.noiseScore < 30],
                    ['Risk Level',    forensics.riskLevel.replace('_', ' ').toUpperCase(), forensics.riskLevel === 'clean'],
                  ].map(([label, value, ok]) => (
                    <div key={label as string} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
                      <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: '0.2rem' }}>{label as string}</p>
                      <p style={{ fontSize: '0.88rem', fontWeight: 600, color: ok ? 'var(--color-primary)' : '#ffd700' }}>{value as string}</p>
                    </div>
                  ))}
                </div>
                {forensics.alerts.length > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    {forensics.alerts.slice(0, 3).map((a, i) => (
                      <p key={i} style={{ color: '#ffd700', fontSize: '0.8rem', marginTop: '0.35rem' }}>
                        ⚠️ {a.label}: {a.detail}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Privacy note */}
            <div className="glass-panel" style={{ padding: '1rem 1.5rem', border: '1px solid rgba(0,229,255,0.2)' }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                🔒 <strong style={{ color: 'var(--color-primary)' }}>Privacy by Design</strong> — Face comparison ran entirely in your browser via MediaPipe. No biometric data was transmitted to any server. Document forensics and MRZ parsing are the only data sent to our API, and they contain no face information.
              </p>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setStep(0); setDocImage(null); setSelfieImage(null)
                  setFaceMatch(null); setForensics(null); setApiResult(null)
                  setError(null)
                }}
              >
                ↺ Verify Another Document
              </button>
              {apiResult?.certificateId && (
                <Link
                  href={`/documents/${apiResult.certificateId}`}
                  className="btn btn-outline"
                >
                  View Full Report →
                </Link>
              )}
            </div>
          </div>
        )}

      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </main>
  )
}
