'use client'

/**
 * /demo/admissions — IE University Admissions Document Verification Demo
 * ========================================================================
 * Interactive demo for the IE University admissions department.
 * Accepts: DNI, Passport, Degree Certificate, Academic Transcript, CV, etc.
 *
 * Pipeline (server-side):
 *   DocForensics CNN → AWS Textract OCR → AWS Rekognition → Frequency analysis → MRZ parse
 */

import { useState, useCallback, useRef }  from 'react'
import type { AdmissionsVerifyResponse }  from '@/app/api/admissions-verify/route'

// ── Types ──────────────────────────────────────────────────────────────────────

type AnalysisState = 'idle' | 'uploading' | 'analyzing' | 'done' | 'error'

interface ProgressStep {
  id:     string
  label:  string
  status: 'pending' | 'running' | 'done' | 'skip'
}

const STEPS_TEMPLATE: ProgressStep[] = [
  { id: 'classify',    label: 'Document type classification (CNN)',    status: 'pending' },
  { id: 'ocr',         label: 'OCR text extraction (AWS Textract)',    status: 'pending' },
  { id: 'rekognition', label: 'Face & quality analysis (Rekognition)', status: 'pending' },
  { id: 'frequency',   label: 'Frequency / spectral forensics',        status: 'pending' },
  { id: 'mrz',         label: 'MRZ check-digit validation (ICAO)',     status: 'pending' },
  { id: 'score',       label: 'Authenticity score calculation',         status: 'pending' },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function verdictColor(v: string): string {
  if (v === 'authentic')  return '#00ff9d'
  if (v === 'suspicious') return '#ffd700'
  return '#ff4d4d'
}

function verdictIcon(v: string): string {
  if (v === 'authentic')  return '✅'
  if (v === 'suspicious') return '⚠️'
  return '🚨'
}

function verdictLabel(v: string): string {
  if (v === 'authentic')  return 'AUTHENTIC'
  if (v === 'suspicious') return 'SUSPICIOUS'
  return 'TAMPERED'
}

function scoreColor(score: number): string {
  if (score >= 72) return '#00ff9d'
  if (score >= 45) return '#ffd700'
  return '#ff4d4d'
}

function scoreGlow(score: number): string {
  if (score >= 72) return 'rgba(0,255,157,0.25)'
  if (score >= 45) return 'rgba(255,215,0,0.25)'
  return 'rgba(255,77,77,0.25)'
}

function alertColor(level: string): string {
  if (level === 'error')   return '#ff4d4d'
  if (level === 'warning') return '#ffd700'
  return '#7ab3ff'
}

function alertBg(level: string): string {
  if (level === 'error')   return 'rgba(255,77,77,0.08)'
  if (level === 'warning') return 'rgba(255,215,0,0.06)'
  return 'rgba(122,179,255,0.06)'
}

function signalLabel(score: number): string {
  if (score <= 20) return 'Clean'
  if (score <= 45) return 'Low risk'
  if (score <= 65) return 'Moderate'
  return 'High risk'
}

function signalColor(score: number): string {
  if (score <= 20) return '#00ff9d'
  if (score <= 45) return '#7ab3ff'
  if (score <= 65) return '#ffd700'
  return '#ff4d4d'
}

function formatField(val: string | boolean | undefined): string {
  if (val === undefined || val === null || val === '') return '—'
  if (typeof val === 'boolean') return val ? 'Yes' : 'No'
  return val
}

// ── Component ──────────────────────────────────────────────────────────────────

// ── Completed document result type ─────────────────────────────────────────────

interface CompletedDoc {
  id:       string
  fileName: string
  isPdf:    boolean
  preview:  string
  result:   AdmissionsVerifyResponse
}

export default function AdmissionsDemoPage() {
  const [state,    setState]    = useState<AnalysisState>('idle')
  const [preview,  setPreview]  = useState<string | null>(null)
  const [isPdf,    setIsPdf]    = useState(false)
  const [fileName, setFileName] = useState('')
  const [steps,    setSteps]    = useState<ProgressStep[]>(STEPS_TEMPLATE.map(s => ({ ...s })))
  const [result,   setResult]   = useState<AdmissionsVerifyResponse | null>(null)
  const [errMsg,   setErrMsg]   = useState<string>('')
  const [drag,     setDrag]     = useState(false)
  // ── Multi-document history ────────────────────────────────────────────────
  const [history,  setHistory]  = useState<CompletedDoc[]>([])
  const [viewDoc,  setViewDoc]  = useState<CompletedDoc | null>(null)
  const fileRef  = useRef<HTMLInputElement>(null)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  // ── Simulate step-by-step progress while API runs ──────────────────────────

  const animateSteps = useCallback(() => {
    // Clear any previous timers
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    const STEP_DELAYS = [0, 1400, 2800, 4000, 5400, 7000]
    STEP_DELAYS.forEach((delay, i) => {
      const t = setTimeout(() => {
        setSteps(prev => prev.map((s, idx) => {
          if (idx < i)   return { ...s, status: 'done' }
          if (idx === i) return { ...s, status: 'running' }
          return s
        }))
      }, delay)
      timersRef.current.push(t)
    })
  }, [])

  // ── Core analysis ──────────────────────────────────────────────────────────

  const analyzeImage = useCallback(async (file: File) => {
    setErrMsg('')
    setResult(null)
    setSteps(STEPS_TEMPLATE.map(s => ({ ...s })))
    setFileName(file.name)
    const pdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    setIsPdf(pdf)

    // Read file as data URL — handles any size, works for images and PDF
    let dataUrl: string
    try {
      dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload  = e => {
          const result = e.target?.result as string
          setPreview(result)  // set preview from same read
          resolve(result)
        }
        reader.onerror = () => reject(new Error('Failed to read file'))
        reader.readAsDataURL(file)
      })
    } catch (readErr) {
      setErrMsg(`File read failed: ${readErr instanceof Error ? readErr.message : 'unknown'}`)
      setState('error')
      return
    }

    setState('analyzing')
    animateSteps()

    try {
      const resp = await fetch('/api/admissions-verify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ image: dataUrl }),
      })

      // Complete all steps
      timersRef.current.forEach(clearTimeout)
      setSteps(STEPS_TEMPLATE.map(s => ({ ...s, status: 'done' })))

      if (!resp.ok) {
        const e = await resp.json().catch(() => ({ error: 'Server error' }))
        throw new Error((e as { error?: string }).error ?? `HTTP ${resp.status}`)
      }

      const data = await resp.json() as AdmissionsVerifyResponse
      setResult(data)
      setState('done')

      // Save to multi-document history
      setHistory(prev => [{
        id:       `doc-${Date.now()}`,
        fileName: file.name,
        isPdf:    pdf,
        preview:  dataUrl.slice(0, 200), // just enough for type detection, not full data URL
        result:   data,
      }, ...prev])
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Unknown error')
      setState('error')
      setSteps(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'pending' } : s))
    }
  }, [animateSteps])

  // ── Drag & drop ────────────────────────────────────────────────────────────

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDrag(false)
    const file = e.dataTransfer.files?.[0]
    if (file && (file.type.startsWith('image/') || file.type === 'application/pdf')) {
      analyzeImage(file)
    }
  }, [analyzeImage])

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) analyzeImage(file)
    e.target.value = ''
  }, [analyzeImage])

  const reset = () => {
    timersRef.current.forEach(clearTimeout)
    setState('idle')
    setPreview(null)
    setIsPdf(false)
    setFileName('')
    setResult(null)
    setViewDoc(null)
    setErrMsg('')
    setSteps(STEPS_TEMPLATE.map(s => ({ ...s })))
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{
      minHeight: '100vh',
      background: '#07070f',
      color: '#e0e0e0',
      fontFamily: "'Inter', system-ui, sans-serif",
      padding: '0',
    }}>

      {/* ── Header bar ─────────────────────────────────────────────────── */}
      <header style={{
        background: '#0d0d1a',
        borderBottom: '1px solid #1e1e30',
        padding: '14px 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: '#00ff9d', letterSpacing: -1 }}>
            Deep<span style={{ color: '#7000ff' }}>Check</span>
          </span>
          <span style={{ color: '#333', fontWeight: 300 }}>|</span>
          <span style={{ fontSize: 13, color: '#888', letterSpacing: 0.5 }}>
            Admissions Document Verification
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: 1,
            background: 'rgba(112,0,255,0.15)', border: '1px solid rgba(112,0,255,0.35)',
            color: '#b57bff', padding: '3px 10px', borderRadius: 20,
          }}>IE UNIVERSITY DEMO</span>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: 1,
            background: 'rgba(0,255,157,0.1)', border: '1px solid rgba(0,255,157,0.25)',
            color: '#00ff9d', padding: '3px 10px', borderRadius: 20,
          }}>AWS LIVE</span>
        </div>
      </header>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px' }}>

        {/* ── Title ─────────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 36, textAlign: 'center' }}>
          <h1 style={{ fontSize: 32, fontWeight: 800, margin: '0 0 8px', color: '#fff', letterSpacing: -1 }}>
            Admissions Document Authenticator
          </h1>
          <p style={{ fontSize: 15, color: '#666', margin: 0, maxWidth: 600, marginInline: 'auto' }}>
            Upload any admissions document — DNI, passport, degree certificate, academic transcript or CV.
            AI forensics runs in seconds.
          </p>
        </div>

        {/* ── Supported document chips ───────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 32 }}>
          {[
            { label: '🛂 Passport', color: '#7ab3ff' },
            { label: '🪪 DNI / NIE', color: '#7ab3ff' },
            { label: '🎓 Degree', color: '#00ff9d' },
            { label: '📄 Transcript', color: '#00ff9d' },
            { label: '📋 CV / Résumé', color: '#ffd700' },
            { label: '🌍 Any country', color: '#888' },
          ].map(({ label, color }) => (
            <span key={label} style={{
              fontSize: 12, padding: '5px 12px', borderRadius: 20,
              border: `1px solid ${color}33`, color, background: `${color}0d`,
              fontWeight: 600, letterSpacing: 0.3,
            }}>{label}</span>
          ))}
        </div>

        {/* ── Upload zone ────────────────────────────────────────────────── */}
        {state === 'idle' && (
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            style={{
              border: `2px dashed ${drag ? '#00ff9d' : '#2a2a40'}`,
              borderRadius: 20,
              padding: '72px 32px',
              textAlign: 'center',
              cursor: 'pointer',
              background: drag ? 'rgba(0,255,157,0.04)' : '#0d0d1a',
              transition: 'all 0.2s',
            }}
          >
            <div style={{ fontSize: 56, marginBottom: 16 }}>📂</div>
            <p style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: '0 0 8px' }}>
              Drop document here
            </p>
            <p style={{ fontSize: 14, color: '#555', margin: '0 0 20px' }}>
              JPG, PNG, PDF — photo or scan — any country
            </p>
            <button style={{
              background: 'linear-gradient(135deg, #00ff9d, #00c97e)',
              color: '#000', border: 'none', borderRadius: 12,
              padding: '12px 32px', fontSize: 15, fontWeight: 800,
              cursor: 'pointer', letterSpacing: 0.3,
            }}>
              Select File
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              onChange={onFileChange}
              style={{ display: 'none' }}
            />
          </div>
        )}

        {/* ── Analyzing view ─────────────────────────────────────────────── */}
        {(state === 'uploading' || state === 'analyzing') && (
          <div style={{
            display: 'grid', gridTemplateColumns: preview ? '1fr 1fr' : '1fr',
            gap: 24, alignItems: 'start',
          }}>

            {/* Preview */}
            {preview && (
              <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid #1e1e30', position: 'relative', background: '#0d0d1a' }}>
                {isPdf ? (
                  /* PDF — show iframe embed with filename badge */
                  <div style={{ height: 380, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
                    <div style={{ fontSize: 64 }}>📄</div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#e0e0e0', marginBottom: 4 }}>{fileName}</div>
                      <div style={{ fontSize: 12, color: '#555' }}>PDF — sending to AWS Textract for full text extraction</div>
                    </div>
                    <div style={{
                      fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
                      background: 'rgba(0,255,157,0.1)', border: '1px solid rgba(0,255,157,0.25)',
                      color: '#00ff9d', padding: '4px 12px', borderRadius: 20,
                    }}>OCR in progress…</div>
                  </div>
                ) : (
                  /* Image */
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={preview} alt="Document" style={{ width: '100%', display: 'block', maxHeight: 420, objectFit: 'contain' }} />
                    <div style={{
                      position: 'absolute', inset: 0,
                      animation: 'scanline 2s linear infinite',
                      backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 10px, rgba(0,255,157,0.04) 10px, rgba(0,255,157,0.04) 11px)',
                      backgroundSize: '100% 200px',
                      pointerEvents: 'none',
                    }} />
                  </>
                )}
              </div>
            )}

            {/* Progress steps */}
            <div style={{ background: '#0d0d1a', borderRadius: 16, border: '1px solid #1e1e30', padding: 24 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#00ff9d', margin: '0 0 20px', letterSpacing: 1, textTransform: 'uppercase' }}>
                ⚙ Forensics Running...
              </p>
              {steps.map(step => (
                <div key={step.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 0', borderBottom: '1px solid #1a1a28',
                }}>
                  <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>
                    {step.status === 'done'    ? '✅'
                     : step.status === 'running' ? '⏳'
                     : step.status === 'skip'    ? '⏭'
                     : '○'}
                  </span>
                  <span style={{
                    fontSize: 13,
                    color: step.status === 'done'    ? '#00ff9d'
                         : step.status === 'running' ? '#fff'
                         : '#444',
                    transition: 'color 0.3s',
                  }}>{step.label}</span>
                </div>
              ))}
              <div style={{ marginTop: 20, height: 3, background: '#1a1a28', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${(steps.filter(s => s.status === 'done').length / steps.length) * 100}%`,
                  background: 'linear-gradient(90deg, #00ff9d, #7000ff)',
                  transition: 'width 0.5s ease',
                  borderRadius: 3,
                }} />
              </div>
            </div>
          </div>
        )}

        {/* ── Error ──────────────────────────────────────────────────────── */}
        {state === 'error' && (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
            <p style={{ fontSize: 18, fontWeight: 700, color: '#ff4d4d', margin: '0 0 8px' }}>Analysis Failed</p>
            <p style={{ fontSize: 14, color: '#666', margin: '0 0 24px' }}>{errMsg}</p>
            <button onClick={reset} style={{
              background: '#ff4d4d22', border: '1px solid #ff4d4d66',
              color: '#ff4d4d', borderRadius: 10, padding: '10px 24px',
              fontSize: 14, cursor: 'pointer', fontWeight: 700,
            }}>Try Again</button>
          </div>
        )}

        {/* ── Results ────────────────────────────────────────────────────── */}
        {state === 'done' && result && (
          <div>
            {/* Top bar: score + verdict + doc type */}
            <div style={{
              display: 'grid', gridTemplateColumns: '200px 1fr auto',
              gap: 20, marginBottom: 24, alignItems: 'center',
            }}>

              {/* Score circle */}
              <div style={{
                background: '#0d0d1a', border: `2px solid ${scoreColor(result.authenticityScore)}33`,
                borderRadius: 20, padding: '28px 20px', textAlign: 'center',
                boxShadow: `0 0 24px ${scoreGlow(result.authenticityScore)}`,
              }}>
                <div style={{ fontSize: 56, fontWeight: 900, color: scoreColor(result.authenticityScore), lineHeight: 1 }}>
                  {result.authenticityScore}
                </div>
                <div style={{ fontSize: 11, color: '#555', marginTop: 4, letterSpacing: 1, textTransform: 'uppercase' }}>Authenticity</div>
                <div style={{ fontSize: 22, marginTop: 8 }}>{verdictIcon(result.verdict)}</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: verdictColor(result.verdict), letterSpacing: 1 }}>
                  {verdictLabel(result.verdict)}
                </div>
              </div>

              {/* Doc type + summary */}
              <div style={{ background: '#0d0d1a', border: '1px solid #1e1e30', borderRadius: 20, padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
                    background: result.documentType.isIdentity ? 'rgba(122,179,255,0.12)' :
                                result.documentType.isAcademic ? 'rgba(0,255,157,0.10)' :
                                                                  'rgba(255,215,0,0.10)',
                    color: result.documentType.isIdentity ? '#7ab3ff' :
                           result.documentType.isAcademic ? '#00ff9d' : '#ffd700',
                    border: `1px solid ${result.documentType.isIdentity ? '#7ab3ff44' : result.documentType.isAcademic ? '#00ff9d44' : '#ffd70044'}`,
                    padding: '3px 10px', borderRadius: 20,
                  }}>
                    {result.documentType.isIdentity ? 'IDENTITY' : result.documentType.isAcademic ? 'ACADEMIC' : 'OTHER'}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, color: '#555',
                    background: '#1a1a28', padding: '3px 10px', borderRadius: 20,
                  }}>
                    {(result.documentType.confidence * 100).toFixed(0)}% confidence
                  </span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 6 }}>
                  {result.documentType.label}
                </div>
                <div style={{ fontSize: 13, color: '#555' }}>
                  Processing time: <span style={{ color: '#888' }}>{result.processingMs}ms</span> ·
                  Signals: CNN + Textract + Rekognition + Frequency{result.mrzAnalysis?.detected ? ' + MRZ' : ''}
                </div>
              </div>

              {/* New analysis button */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button onClick={reset} style={{
                  background: 'linear-gradient(135deg, #00ff9d, #00c97e)',
                  color: '#000', border: 'none', borderRadius: 12,
                  padding: '12px 20px', fontSize: 14, fontWeight: 800,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}>
                  + New Document
                </button>
              </div>
            </div>

            {/* Main grid: extracted data + forensics signals + MRZ */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>

              {/* Extracted data */}
              <div style={{ background: '#0d0d1a', border: '1px solid #1e1e30', borderRadius: 16, padding: 20 }}>
                <h3 style={{ fontSize: 12, fontWeight: 700, color: '#555', letterSpacing: 1, textTransform: 'uppercase', margin: '0 0 16px' }}>
                  Extracted Data
                </h3>
                {(() => {
                  const d = result.extractedData
                  const rows: [string, string | boolean | undefined][] = []
                  if (d.fullName)        rows.push(['Full Name',       d.fullName])
                  if (d.studentName)     rows.push(['Name',            d.studentName])
                  if (d.docNumber)       rows.push(['Document No.',    d.docNumber])
                  if (d.dateOfBirth)     rows.push(['Date of Birth',   d.dateOfBirth])
                  if (d.expiryDate)      rows.push(['Expires',         d.expiryDate])
                  if (d.nationality)     rows.push(['Nationality',     d.nationality])
                  if (d.issuingCountry)  rows.push(['Issuing Country', d.issuingCountry])
                  if (d.sex)             rows.push(['Sex',             d.sex])
                  if (d.isExpired !== undefined) rows.push(['Expired', d.isExpired])
                  if (d.institution)     rows.push(['Institution',     d.institution])
                  if (d.degree)          rows.push(['Degree',          d.degree])
                  if (d.graduationDate)  rows.push(['Graduated',       d.graduationDate])
                  if (d.grade)           rows.push(['Grade',           d.grade])

                  if (rows.length === 0) {
                    return (
                      <div>
                        <p style={{ fontSize: 13, color: '#444', marginBottom: 12 }}>No structured fields extracted automatically.</p>
                        {d.ocrText && (
                          <div style={{ background: '#111120', borderRadius: 8, padding: 12 }}>
                            <p style={{ fontSize: 11, color: '#555', margin: '0 0 6px', letterSpacing: 0.5 }}>RAW OCR TEXT</p>
                            <pre style={{ fontSize: 11, color: '#777', margin: 0, whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto' }}>
                              {d.ocrText.slice(0, 800)}{d.ocrText.length > 800 ? '…' : ''}
                            </pre>
                          </div>
                        )}
                      </div>
                    )
                  }
                  return rows.map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #1a1a28' }}>
                      <span style={{ fontSize: 12, color: '#555' }}>{k}</span>
                      <span style={{
                        fontSize: 13, fontWeight: 600,
                        color: k === 'Expired' && v === true ? '#ff4d4d' : '#e0e0e0',
                      }}>{formatField(v as string | boolean | undefined)}</span>
                    </div>
                  ))
                })()}
              </div>

              {/* Forensics signals */}
              <div style={{ background: '#0d0d1a', border: '1px solid #1e1e30', borderRadius: 16, padding: 20 }}>
                <h3 style={{ fontSize: 12, fontWeight: 700, color: '#555', letterSpacing: 1, textTransform: 'uppercase', margin: '0 0 16px' }}>
                  Forensics Signals
                </h3>
                {[
                  { name: 'Manipulation (CNN)',           score: result.forensics.manipulationScore, desc: 'DocForensics CNN — pixel-level manipulation detection' },
                  { name: 'Frequency / Spectral',         score: result.forensics.frequencyScore,    desc: 'FFT + Haar wavelet — splice and copy-move detection' },
                  { name: 'Semantic Validation',          score: result.forensics.semanticScore,     desc: 'AWS Textract — field consistency and anomaly flags' },
                  { name: 'Face / Quality (Rekognition)', score: result.forensics.rekognitionScore,  desc: 'AWS Rekognition — face quality and print/screen detection' },
                ].map(({ name, score, desc }) => (
                  <div key={name} style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#ccc' }}>{name}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: signalColor(score) }}>
                        {signalLabel(score)} ({score.toFixed(0)})
                      </span>
                    </div>
                    <div style={{ height: 6, background: '#1a1a28', borderRadius: 4, overflow: 'hidden', marginBottom: 3 }}>
                      <div style={{
                        height: '100%', width: `${score}%`,
                        background: `linear-gradient(90deg, #00ff9d, ${signalColor(score)})`,
                        borderRadius: 4, transition: 'width 0.8s ease',
                      }} />
                    </div>
                    <span style={{ fontSize: 11, color: '#3a3a55' }}>{desc}</span>
                  </div>
                ))}

                {/* Face detection status */}
                <div style={{ marginTop: 8, padding: '10px 14px', background: '#111120', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: '#555' }}>Face detected</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: result.forensics.faceDetected ? '#00ff9d' : '#555' }}>
                    {result.forensics.faceDetected ? `Yes (${result.forensics.faceCount})` : 'No'}
                  </span>
                </div>
              </div>
            </div>

            {/* MRZ panel (identity docs only) */}
            {result.mrzAnalysis && (
              <div style={{ background: '#0d0d1a', border: `1px solid ${result.mrzAnalysis.valid ? '#00ff9d33' : '#ff4d4d33'}`, borderRadius: 16, padding: 20, marginBottom: 20 }}>
                <h3 style={{ fontSize: 12, fontWeight: 700, color: '#555', letterSpacing: 1, textTransform: 'uppercase', margin: '0 0 16px' }}>
                  MRZ Validation — ICAO Doc 9303
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                  {[
                    { label: 'Format',   value: result.mrzAnalysis.format },
                    { label: 'Valid',    value: result.mrzAnalysis.valid ? '✅ All passed' : `❌ ${result.mrzAnalysis.checksumsFailed} failed` },
                    { label: '✓ Passed', value: String(result.mrzAnalysis.checksumsPassed) },
                    { label: '✗ Failed', value: String(result.mrzAnalysis.checksumsFailed) },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ background: '#111120', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: '#444', marginBottom: 4, letterSpacing: 0.5, textTransform: 'uppercase' }}>{label}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#e0e0e0' }}>{value}</div>
                    </div>
                  ))}
                </div>
                {result.mrzAnalysis.alerts.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    {result.mrzAnalysis.alerts.map((a, i) => (
                      <div key={i} style={{ fontSize: 12, color: '#ff4d4d', padding: '4px 0' }}>⚠ {a}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Alerts */}
            {result.alerts.length > 0 && (
              <div style={{ background: '#0d0d1a', border: '1px solid #1e1e30', borderRadius: 16, padding: 20, marginBottom: 20 }}>
                <h3 style={{ fontSize: 12, fontWeight: 700, color: '#555', letterSpacing: 1, textTransform: 'uppercase', margin: '0 0 14px' }}>
                  Alerts & Flags ({result.alerts.length})
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {result.alerts.map((alert, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                      background: alertBg(alert.level),
                      border: `1px solid ${alertColor(alert.level)}33`,
                      borderRadius: 10, padding: '10px 14px',
                    }}>
                      <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>
                        {alert.level === 'error' ? '🚨' : alert.level === 'warning' ? '⚠️' : 'ℹ️'}
                      </span>
                      <div>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: alertColor(alert.level), textTransform: 'uppercase', marginRight: 8 }}>
                          {alert.level}
                        </span>
                        <span style={{ fontSize: 13, color: '#ccc' }}>{alert.message}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* OCR full text (collapsible) */}
            {result.extractedData.ocrText && result.extractedData.ocrText.length > 10 && (
              <details style={{
                background: '#0d0d1a', border: '1px solid #1e1e30', borderRadius: 16, padding: '16px 20px',
              }}>
                <summary style={{ fontSize: 12, fontWeight: 700, color: '#444', letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' }}>
                  Raw OCR Text (click to expand)
                </summary>
                <pre style={{ fontSize: 12, color: '#555', marginTop: 14, whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto', lineHeight: 1.6 }}>
                  {result.extractedData.ocrText}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* ── Multi-document history ──────────────────────────────────── */}
        {history.length > 0 && (
          <div style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: '#555', letterSpacing: -0.3, margin: '0 0 16px' }}>
              Verified Documents ({history.length})
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {history.map(doc => (
                <div
                  key={doc.id}
                  onClick={() => { setViewDoc(doc); setResult(doc.result); setState('done') }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    background: '#0d0d1a', border: '1px solid #1e1e30', borderRadius: 14,
                    padding: '14px 18px', cursor: 'pointer',
                    transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#00ff9d44')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#1e1e30')}
                >
                  {/* Verdict badge */}
                  <div style={{
                    width: 48, height: 48, borderRadius: 12,
                    background: `${scoreColor(doc.result.authenticityScore)}11`,
                    border: `2px solid ${scoreColor(doc.result.authenticityScore)}44`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, fontWeight: 900, color: scoreColor(doc.result.authenticityScore),
                    flexShrink: 0,
                  }}>
                    {doc.result.authenticityScore}
                  </div>
                  {/* Doc info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#e0e0e0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {doc.fileName}
                    </div>
                    <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>
                      {doc.result.documentType.label} · {doc.result.processingMs}ms
                    </div>
                  </div>
                  {/* Type badge */}
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase',
                    padding: '3px 8px', borderRadius: 20,
                    background: doc.result.documentType.isIdentity ? 'rgba(122,179,255,0.12)' :
                                doc.result.documentType.isAcademic ? 'rgba(0,255,157,0.10)' : 'rgba(255,215,0,0.10)',
                    color: doc.result.documentType.isIdentity ? '#7ab3ff' :
                           doc.result.documentType.isAcademic ? '#00ff9d' : '#ffd700',
                    border: `1px solid ${doc.result.documentType.isIdentity ? '#7ab3ff33' : doc.result.documentType.isAcademic ? '#00ff9d33' : '#ffd70033'}`,
                    flexShrink: 0,
                  }}>
                    {doc.result.documentType.isIdentity ? 'IDENTITY' : doc.result.documentType.isAcademic ? 'ACADEMIC' : doc.result.documentType.type.toUpperCase()}
                  </span>
                  {/* Verdict */}
                  <span style={{ fontSize: 16, flexShrink: 0 }}>
                    {verdictIcon(doc.result.verdict)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <footer style={{ marginTop: 60, textAlign: 'center', borderTop: '1px solid #1a1a28', paddingTop: 24 }}>
          <p style={{ fontSize: 12, color: '#2a2a3a', margin: 0 }}>
            Deep-Check · Admissions Verification Demo · IE University Partnership ·
            All analysis server-side via AWS · Zero biometric data stored
          </p>
        </footer>
      </div>

      {/* Scanline animation */}
      <style>{`
        @keyframes scanline {
          0%   { background-position: 0 0; }
          100% { background-position: 0 200px; }
        }
      `}</style>
    </div>
  )
}
