'use client'

/**
 * /demo/admissions — IE University Admissions Document Verification Demo
 * ========================================================================
 * Interactive demo with document type selector and multi-image upload.
 * - Identity docs (DNI/ID card): front + back required (back has MRZ)
 * - Passport: single image (MRZ is on the same page)
 * - Other docs: single image
 *
 * Pipeline (server-side):
 *   OCR (Textract) → Face detection → ELA → FFT → EXIF → Text consistency → MRZ → Cross-validation
 */

import { useState, useCallback, useRef }  from 'react'
import type { AdmissionsVerifyResponse }  from '@/app/api/admissions-verify/route'

// ── Types ──────────────────────────────────────────────────────────────────────

type FlowState = 'select-type' | 'upload' | 'analyzing' | 'done' | 'error'

interface DocTypeOption {
  id:          string
  label:       string
  icon:        string
  desc:        string
  needsBack:   boolean   // requires front + back image
  apiType:     string    // sent to API as documentType
  color:       string
}

const DOC_TYPES: DocTypeOption[] = [
  { id: 'dni',       label: 'DNI / ID Card',      icon: '🪪', desc: 'National identity card (front + back)',  needsBack: true,  apiType: 'dni',                 color: '#7ab3ff' },
  { id: 'passport',  label: 'Passport',            icon: '🛂', desc: 'International passport (single page)',   needsBack: false, apiType: 'passport',            color: '#7ab3ff' },
  { id: 'eu_id',     label: 'EU / Foreign ID',     icon: '🌍', desc: 'Foreign national ID (front + back)',     needsBack: true,  apiType: 'eu_id',               color: '#7ab3ff' },
  { id: 'degree',    label: 'Degree / Diploma',    icon: '🎓', desc: 'University degree or diploma certificate', needsBack: false, apiType: 'degree_certificate', color: '#00ff9d' },
  { id: 'transcript',label: 'Academic Transcript',  icon: '📄', desc: 'Official academic record / grades',     needsBack: false, apiType: 'academic_transcript', color: '#00ff9d' },
  { id: 'cv',        label: 'CV / Resume',          icon: '📋', desc: 'Curriculum vitae or resume',            needsBack: false, apiType: 'cv_resume',           color: '#ffd700' },
  { id: 'other',     label: 'Other Document',       icon: '📎', desc: 'Any other document for verification',   needsBack: false, apiType: 'other',               color: '#888'    },
]

interface ProgressStep {
  id:     string
  label:  string
  status: 'pending' | 'running' | 'done' | 'skip'
}

const STEPS_TEMPLATE: ProgressStep[] = [
  { id: 'ocr',         label: 'OCR text extraction (AWS Textract)',      status: 'pending' },
  { id: 'face',        label: 'Face detection & quality (YCbCr)',        status: 'pending' },
  { id: 'ela',         label: 'Error Level Analysis (JPEG forensics)',   status: 'pending' },
  { id: 'frequency',   label: 'Frequency / spectral forensics (FFT)',   status: 'pending' },
  { id: 'exif',        label: 'EXIF / metadata forensics',              status: 'pending' },
  { id: 'text',        label: 'Text consistency analysis',              status: 'pending' },
  { id: 'mrz',         label: 'MRZ check-digit validation (ICAO)',      status: 'pending' },
  { id: 'crossval',    label: 'MRZ ↔ OCR cross-validation',             status: 'pending' },
  { id: 'semantic',    label: 'Semantic validation (NIF/IBAN/dates)',    status: 'pending' },
  { id: 'score',       label: 'Authenticity score calculation',          status: 'pending' },
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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = e => resolve(e.target?.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

// ── Completed doc history ────────────────────────────────────────────────────

interface CompletedDoc {
  id:       string
  fileName: string
  isPdf:    boolean
  preview:  string
  result:   AdmissionsVerifyResponse
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function AdmissionsDemoPage() {
  // ── State ─────────────────────────────────────────────────────────────────
  const [flowState,     setFlowState]     = useState<FlowState>('select-type')
  const [selectedType,  setSelectedType]  = useState<DocTypeOption | null>(null)

  // Upload state
  const [frontImage,    setFrontImage]    = useState<string | null>(null)
  const [backImage,     setBackImage]     = useState<string | null>(null)
  const [frontFile,     setFrontFile]     = useState<string>('')  // filename
  const [backFile,      setBackFile]      = useState<string>('')
  const [dragFront,     setDragFront]     = useState(false)
  const [dragBack,      setDragBack]      = useState(false)

  // Analysis state
  const [steps,         setSteps]         = useState<ProgressStep[]>(STEPS_TEMPLATE.map(s => ({ ...s })))
  const [result,        setResult]        = useState<AdmissionsVerifyResponse | null>(null)
  const [errMsg,        setErrMsg]        = useState('')

  // History
  const [history,       setHistory]       = useState<CompletedDoc[]>([])

  const frontRef  = useRef<HTMLInputElement>(null)
  const backRef   = useRef<HTMLInputElement>(null)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  // ── Step-by-step progress animation ─────────────────────────────────────

  const animateSteps = useCallback(() => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    const STEP_DELAYS = [0, 800, 1500, 2200, 2900, 3600, 4300, 5000, 5700, 6400]
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

  // ── Handle file for front image ──────────────────────────────────────────

  const handleFrontFile = useCallback(async (file: File) => {
    try {
      const dataUrl = await readFileAsDataUrl(file)
      setFrontImage(dataUrl)
      setFrontFile(file.name)
    } catch {
      setErrMsg('Failed to read front image')
    }
  }, [])

  const handleBackFile = useCallback(async (file: File) => {
    try {
      const dataUrl = await readFileAsDataUrl(file)
      setBackImage(dataUrl)
      setBackFile(file.name)
    } catch {
      setErrMsg('Failed to read back image')
    }
  }, [])

  // ── Submit for analysis ──────────────────────────────────────────────────

  const submitAnalysis = useCallback(async () => {
    if (!frontImage || !selectedType) return
    if (selectedType.needsBack && !backImage) return

    setFlowState('analyzing')
    setSteps(STEPS_TEMPLATE.map(s => ({ ...s })))
    setResult(null)
    setErrMsg('')
    animateSteps()

    try {
      const payload: Record<string, string> = {
        image:        frontImage,
        documentType: selectedType.apiType,
      }
      if (backImage && selectedType.needsBack) {
        payload.imageBack = backImage
      }

      const resp = await fetch('/api/admissions-verify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
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
      setFlowState('done')

      // Save to history
      setHistory(prev => [{
        id:       `doc-${Date.now()}`,
        fileName: frontFile + (backFile ? ` + ${backFile}` : ''),
        isPdf:    false,
        preview:  frontImage.slice(0, 200),
        result:   data,
      }, ...prev])
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Unknown error')
      setFlowState('error')
      setSteps(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'pending' } : s))
    }
  }, [frontImage, backImage, selectedType, frontFile, backFile, animateSteps])

  // ── Quick upload (for non-ID docs, skip to upload → auto-submit) ────────

  const handleQuickUpload = useCallback(async (file: File) => {
    if (!selectedType) return
    try {
      const dataUrl = await readFileAsDataUrl(file)
      setFrontImage(dataUrl)
      setFrontFile(file.name)
      // Auto-submit for non-ID docs that don't need back
      if (!selectedType.needsBack) {
        setFlowState('analyzing')
        setSteps(STEPS_TEMPLATE.map(s => ({ ...s })))
        setResult(null)
        setErrMsg('')
        animateSteps()

        const resp = await fetch('/api/admissions-verify', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ image: dataUrl, documentType: selectedType.apiType }),
        })

        timersRef.current.forEach(clearTimeout)
        setSteps(STEPS_TEMPLATE.map(s => ({ ...s, status: 'done' })))

        if (!resp.ok) {
          const e = await resp.json().catch(() => ({ error: 'Server error' }))
          throw new Error((e as { error?: string }).error ?? `HTTP ${resp.status}`)
        }

        const data = await resp.json() as AdmissionsVerifyResponse
        setResult(data)
        setFlowState('done')

        setHistory(prev => [{
          id: `doc-${Date.now()}`, fileName: file.name, isPdf: false,
          preview: dataUrl.slice(0, 200), result: data,
        }, ...prev])
      }
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Unknown error')
      setFlowState('error')
    }
  }, [selectedType, animateSteps])

  // ── Reset ────────────────────────────────────────────────────────────────

  const reset = () => {
    timersRef.current.forEach(clearTimeout)
    setFlowState('select-type')
    setSelectedType(null)
    setFrontImage(null)
    setBackImage(null)
    setFrontFile('')
    setBackFile('')
    setDragFront(false)
    setDragBack(false)
    setResult(null)
    setErrMsg('')
    setSteps(STEPS_TEMPLATE.map(s => ({ ...s })))
  }

  const goToUpload = (docType: DocTypeOption) => {
    setSelectedType(docType)
    setFrontImage(null)
    setBackImage(null)
    setFrontFile('')
    setBackFile('')
    setFlowState('upload')
  }

  // ── File drop helpers ────────────────────────────────────────────────────

  const dropHandler = (setter: (f: File) => void) => (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file && (file.type.startsWith('image/') || file.type === 'application/pdf')) {
      setter(file)
    }
  }

  const fileHandler = (setter: (f: File) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setter(file)
    e.target.value = ''
  }

  // ── Can submit? ──────────────────────────────────────────────────────────

  const canSubmit = !!frontImage && (!selectedType?.needsBack || !!backImage)

  // ── Render ───────────────────────────────────────────────────────────────

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
          }}>SELF-HOSTED AI</span>
        </div>
      </header>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px' }}>

        {/* ── Title ─────────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 36, textAlign: 'center' }}>
          <h1 style={{ fontSize: 32, fontWeight: 800, margin: '0 0 8px', color: '#fff', letterSpacing: -1 }}>
            Admissions Document Authenticator
          </h1>
          <p style={{ fontSize: 15, color: '#666', margin: 0, maxWidth: 600, marginInline: 'auto' }}>
            Select your document type, then upload for AI-powered forensic verification.
          </p>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* STEP 1: Document Type Selector                                  */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {flowState === 'select-type' && (
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#555', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 20, textAlign: 'center' }}>
              1. Select Document Type
            </p>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 14,
            }}>
              {DOC_TYPES.map(dt => (
                <button
                  key={dt.id}
                  onClick={() => goToUpload(dt)}
                  style={{
                    background: '#0d0d1a',
                    border: `2px solid #1e1e30`,
                    borderRadius: 16,
                    padding: '24px 18px',
                    cursor: 'pointer',
                    textAlign: 'center',
                    transition: 'all 0.2s',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 10,
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = dt.color
                    e.currentTarget.style.background = `${dt.color}08`
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = '#1e1e30'
                    e.currentTarget.style.background = '#0d0d1a'
                  }}
                >
                  <span style={{ fontSize: 36 }}>{dt.icon}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{dt.label}</span>
                  <span style={{ fontSize: 11, color: '#555', lineHeight: 1.4 }}>{dt.desc}</span>
                  {dt.needsBack && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                      background: 'rgba(122,179,255,0.10)', border: '1px solid rgba(122,179,255,0.25)',
                      color: '#7ab3ff', padding: '2px 8px', borderRadius: 10,
                    }}>FRONT + BACK</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* STEP 2: Upload Images                                           */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {flowState === 'upload' && selectedType && (
          <div>
            {/* Breadcrumb / back */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <button onClick={reset} style={{
                background: 'none', border: '1px solid #2a2a40', color: '#888',
                borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer',
                fontWeight: 600,
              }}>
                ← Back
              </button>
              <span style={{ fontSize: 28 }}>{selectedType.icon}</span>
              <div>
                <span style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{selectedType.label}</span>
                {selectedType.needsBack && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.5, marginLeft: 10,
                    background: 'rgba(122,179,255,0.10)', border: '1px solid rgba(122,179,255,0.25)',
                    color: '#7ab3ff', padding: '2px 8px', borderRadius: 10,
                  }}>FRONT + BACK REQUIRED</span>
                )}
              </div>
            </div>

            {selectedType.needsBack ? (
              /* ── Two-image upload for ID docs ───────────────────────── */
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                {/* Front */}
                <div
                  onClick={() => frontRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragFront(true) }}
                  onDragLeave={() => setDragFront(false)}
                  onDrop={e => { setDragFront(false); dropHandler(handleFrontFile)(e) }}
                  style={{
                    border: `2px dashed ${frontImage ? '#00ff9d44' : dragFront ? '#00ff9d' : '#2a2a40'}`,
                    borderRadius: 16,
                    padding: frontImage ? '0' : '48px 20px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: frontImage ? '#0d0d1a' : dragFront ? 'rgba(0,255,157,0.04)' : '#0d0d1a',
                    transition: 'all 0.2s',
                    overflow: 'hidden',
                    position: 'relative',
                    minHeight: 200,
                  }}
                >
                  {frontImage ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={frontImage} alt="Front" style={{ width: '100%', display: 'block', maxHeight: 300, objectFit: 'contain' }} />
                      <div style={{
                        position: 'absolute', top: 10, left: 10,
                        fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                        background: 'rgba(0,255,157,0.15)', border: '1px solid rgba(0,255,157,0.3)',
                        color: '#00ff9d', padding: '3px 10px', borderRadius: 10,
                      }}>✅ FRONT</div>
                      <div style={{
                        position: 'absolute', bottom: 10, right: 10,
                        fontSize: 10, color: '#555', background: '#0d0d1acc', padding: '2px 8px', borderRadius: 6,
                      }}>{frontFile}</div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 42, marginBottom: 10 }}>📸</div>
                      <p style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>Front Side</p>
                      <p style={{ fontSize: 12, color: '#555', margin: 0 }}>Photo with name, photo, and personal data</p>
                    </>
                  )}
                  <input ref={frontRef} type="file" accept="image/*,application/pdf" onChange={fileHandler(handleFrontFile)} style={{ display: 'none' }} />
                </div>

                {/* Back */}
                <div
                  onClick={() => backRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragBack(true) }}
                  onDragLeave={() => setDragBack(false)}
                  onDrop={e => { setDragBack(false); dropHandler(handleBackFile)(e) }}
                  style={{
                    border: `2px dashed ${backImage ? '#00ff9d44' : dragBack ? '#00ff9d' : '#2a2a40'}`,
                    borderRadius: 16,
                    padding: backImage ? '0' : '48px 20px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: backImage ? '#0d0d1a' : dragBack ? 'rgba(0,255,157,0.04)' : '#0d0d1a',
                    transition: 'all 0.2s',
                    overflow: 'hidden',
                    position: 'relative',
                    minHeight: 200,
                  }}
                >
                  {backImage ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={backImage} alt="Back" style={{ width: '100%', display: 'block', maxHeight: 300, objectFit: 'contain' }} />
                      <div style={{
                        position: 'absolute', top: 10, left: 10,
                        fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                        background: 'rgba(0,255,157,0.15)', border: '1px solid rgba(0,255,157,0.3)',
                        color: '#00ff9d', padding: '3px 10px', borderRadius: 10,
                      }}>✅ BACK</div>
                      <div style={{
                        position: 'absolute', bottom: 10, right: 10,
                        fontSize: 10, color: '#555', background: '#0d0d1acc', padding: '2px 8px', borderRadius: 6,
                      }}>{backFile}</div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 42, marginBottom: 10 }}>🔄</div>
                      <p style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>Back Side</p>
                      <p style={{ fontSize: 12, color: '#555', margin: 0 }}>Side with MRZ code (machine-readable zone)</p>
                    </>
                  )}
                  <input ref={backRef} type="file" accept="image/*,application/pdf" onChange={fileHandler(handleBackFile)} style={{ display: 'none' }} />
                </div>
              </div>
            ) : (
              /* ── Single-image upload ────────────────────────────────── */
              <div
                onClick={() => frontRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragFront(true) }}
                onDragLeave={() => setDragFront(false)}
                onDrop={e => { setDragFront(false); dropHandler(f => handleQuickUpload(f))(e) }}
                style={{
                  border: `2px dashed ${frontImage ? '#00ff9d44' : dragFront ? '#00ff9d' : '#2a2a40'}`,
                  borderRadius: 20,
                  padding: frontImage ? '0' : '64px 32px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: frontImage ? '#0d0d1a' : dragFront ? 'rgba(0,255,157,0.04)' : '#0d0d1a',
                  transition: 'all 0.2s',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                {frontImage ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={frontImage} alt="Document" style={{ width: '100%', display: 'block', maxHeight: 420, objectFit: 'contain' }} />
                    <div style={{
                      position: 'absolute', top: 10, left: 10,
                      fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                      background: 'rgba(0,255,157,0.15)', border: '1px solid rgba(0,255,157,0.3)',
                      color: '#00ff9d', padding: '3px 10px', borderRadius: 10,
                    }}>✅ UPLOADED</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 56, marginBottom: 16 }}>📂</div>
                    <p style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: '0 0 8px' }}>
                      Drop {selectedType.label} here
                    </p>
                    <p style={{ fontSize: 14, color: '#555', margin: '0 0 20px' }}>
                      JPG, PNG, PDF — photo or scan
                    </p>
                    <span style={{
                      background: 'linear-gradient(135deg, #00ff9d, #00c97e)',
                      color: '#000', borderRadius: 12,
                      padding: '12px 32px', fontSize: 15, fontWeight: 800,
                      letterSpacing: 0.3, display: 'inline-block',
                    }}>
                      Select File
                    </span>
                  </>
                )}
                <input ref={frontRef} type="file" accept="image/*,application/pdf" onChange={fileHandler(f => handleQuickUpload(f))} style={{ display: 'none' }} />
              </div>
            )}

            {/* Submit button for dual-image uploads */}
            {selectedType.needsBack && (
              <div style={{ marginTop: 24, textAlign: 'center' }}>
                <button
                  onClick={submitAnalysis}
                  disabled={!canSubmit}
                  style={{
                    background: canSubmit
                      ? 'linear-gradient(135deg, #00ff9d, #00c97e)'
                      : '#1a1a28',
                    color: canSubmit ? '#000' : '#444',
                    border: canSubmit ? 'none' : '1px solid #2a2a40',
                    borderRadius: 14,
                    padding: '14px 48px',
                    fontSize: 16,
                    fontWeight: 800,
                    cursor: canSubmit ? 'pointer' : 'not-allowed',
                    letterSpacing: 0.3,
                    transition: 'all 0.2s',
                  }}
                >
                  {canSubmit ? '🔍 Analyze Document' : `Upload ${!frontImage ? 'front' : 'back'} side to continue`}
                </button>
                {!canSubmit && (
                  <p style={{ fontSize: 12, color: '#555', marginTop: 10 }}>
                    {!frontImage && !backImage
                      ? 'Upload both front and back images of your ID document'
                      : !frontImage
                      ? 'Upload the front side of your document'
                      : 'Upload the back side (with MRZ zone) of your document'}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* STEP 3: Analyzing                                               */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {flowState === 'analyzing' && (
          <div style={{
            display: 'grid', gridTemplateColumns: frontImage ? '1fr 1fr' : '1fr',
            gap: 24, alignItems: 'start',
          }}>

            {/* Preview */}
            {frontImage && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid #1e1e30', position: 'relative', background: '#0d0d1a' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={frontImage} alt="Front" style={{ width: '100%', display: 'block', maxHeight: 280, objectFit: 'contain' }} />
                  <div style={{
                    position: 'absolute', inset: 0,
                    animation: 'scanline 2s linear infinite',
                    backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 10px, rgba(0,255,157,0.04) 10px, rgba(0,255,157,0.04) 11px)',
                    backgroundSize: '100% 200px',
                    pointerEvents: 'none',
                  }} />
                  <div style={{
                    position: 'absolute', top: 8, left: 8,
                    fontSize: 10, fontWeight: 700, background: '#0d0d1acc', color: '#888',
                    padding: '2px 8px', borderRadius: 6,
                  }}>FRONT</div>
                </div>
                {backImage && (
                  <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid #1e1e30', position: 'relative', background: '#0d0d1a' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={backImage} alt="Back" style={{ width: '100%', display: 'block', maxHeight: 200, objectFit: 'contain' }} />
                    <div style={{
                      position: 'absolute', inset: 0,
                      animation: 'scanline 2s linear infinite',
                      backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 10px, rgba(112,0,255,0.04) 10px, rgba(112,0,255,0.04) 11px)',
                      backgroundSize: '100% 200px',
                      pointerEvents: 'none',
                    }} />
                    <div style={{
                      position: 'absolute', top: 8, left: 8,
                      fontSize: 10, fontWeight: 700, background: '#0d0d1acc', color: '#888',
                      padding: '2px 8px', borderRadius: 6,
                    }}>BACK (MRZ)</div>
                  </div>
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

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* Error                                                           */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {flowState === 'error' && (
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

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* STEP 4: Results                                                 */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {flowState === 'done' && result && (
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
                  {result.backImageProcessed && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                      background: 'rgba(112,0,255,0.10)', border: '1px solid rgba(112,0,255,0.25)',
                      color: '#b57bff', padding: '2px 8px', borderRadius: 10,
                    }}>FRONT + BACK</span>
                  )}
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 6 }}>
                  {result.documentType.label}
                </div>
                <div style={{ fontSize: 13, color: '#555' }}>
                  Processing: <span style={{ color: '#888' }}>{result.processingMs}ms</span> ·
                  7 forensic layers: ELA + Cross-val + FFT + Text + EXIF + Semantic + Face{result.mrzAnalysis?.detected ? ' + MRZ' : ''}
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
                              {d.ocrText.slice(0, 800)}{d.ocrText.length > 800 ? '...' : ''}
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

              {/* Forensics signals — 7-layer analysis */}
              <div style={{ background: '#0d0d1a', border: '1px solid #1e1e30', borderRadius: 16, padding: 20 }}>
                <h3 style={{ fontSize: 12, fontWeight: 700, color: '#555', letterSpacing: 1, textTransform: 'uppercase', margin: '0 0 4px' }}>
                  7-Layer Forensics
                </h3>
                <p style={{ fontSize: 11, color: '#333', margin: '0 0 16px' }}>
                  Overall manipulation score: <span style={{ fontWeight: 700, color: signalColor(result.forensics.manipulationScore) }}>{result.forensics.manipulationScore}/100</span>
                </p>
                {[
                  { name: '🔍 MRZ ↔ OCR Cross-validation', score: result.forensics.crossValidation ?? 0, desc: 'Compares name, doc number, dates between MRZ zone and visual text — strongest forgery signal' },
                  { name: '🖼️ Error Level Analysis (ELA)',   score: result.forensics.elaScore ?? 0,       desc: 'Re-compresses JPEG and compares — edited regions show different error levels' },
                  { name: '📊 Frequency / Spectral',         score: result.forensics.frequencyScore,       desc: 'FFT + Haar wavelet — splice, copy-move, re-compression artifacts' },
                  { name: '🔤 Text Consistency',             score: result.forensics.textConsistency ?? 0, desc: 'Noise, edge sharpness, and contrast uniformity across text regions' },
                  { name: '📋 EXIF / Metadata',              score: result.forensics.exifScore ?? 0,       desc: 'Editing software detection, date gaps, resolution anomalies' },
                  { name: '✅ Semantic Validation',           score: result.forensics.semanticScore,        desc: 'NIF/CIF mod23 + IBAN mod97 + date consistency + MRZ checksums' },
                  { name: '👤 Face Quality',                  score: result.forensics.faceQualityScore,     desc: 'YCbCr skin-color analysis + connected component detection' },
                ].map(({ name, score, desc }) => (
                  <div key={name} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#ccc' }}>{name}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: signalColor(score) }}>
                        {signalLabel(score)} ({score.toFixed(0)})
                      </span>
                    </div>
                    <div style={{ height: 5, background: '#1a1a28', borderRadius: 4, overflow: 'hidden', marginBottom: 2 }}>
                      <div style={{
                        height: '100%', width: `${Math.max(score, 2)}%`,
                        background: `linear-gradient(90deg, #00ff9d, ${signalColor(score)})`,
                        borderRadius: 4, transition: 'width 0.8s ease',
                      }} />
                    </div>
                    <span style={{ fontSize: 10, color: '#3a3a55' }}>{desc}</span>
                  </div>
                ))}

                {/* Face + OCR summary bar */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                  <div style={{ padding: '8px 12px', background: '#111120', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#555' }}>Face</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: result.forensics.faceDetected ? '#00ff9d' : '#555' }}>
                      {result.forensics.faceDetected ? `✅ ${result.forensics.faceCount}` : '—'}
                    </span>
                  </div>
                  <div style={{ padding: '8px 12px', background: '#111120', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#555' }}>OCR</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: (result.forensics.ocrConfidence ?? 0) >= 80 ? '#00ff9d' : '#ffd700' }}>
                      {result.forensics.ocrConfidence ?? 0}%
                    </span>
                  </div>
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
                  onClick={() => { setResult(doc.result); setFlowState('done') }}
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
            7-layer forensics · AWS Textract + ELA + FFT + Cross-validation · Zero biometric data stored
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
