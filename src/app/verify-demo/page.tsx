'use client'

import { useState, useRef, useCallback } from 'react'

type Backend = 'xeon' | 'aws'
type AnalysisResult = {
  forensics?: { p_tampered: number; verdict: string; model: string; version: string; processing_ms?: number }
  analysis?: {
    ocr_text: string; fields: Record<string, string>; mrz?: any; doc_type: string
    coherence_issues: string[]; explanation: string; llm_enabled?: boolean
  }
  // Gemma 4 direct response
  doc_type?: string; ocr_text?: string; fields?: Record<string, string>
  coherence_issues?: string[]; explanation?: string
  processing_ms?: number
}

const BACKENDS = {
  xeon: { label: 'Xeon On-Premise', desc: 'DINOv2 + Ollama Gemma 3 4B', url: 'http://100.116.188.12:8001', icon: '🖥️', color: '#3b82f6' },
  aws: { label: 'AWS GPU', desc: 'Gemma 4 E4B on A10G', url: 'http://54.229.204.211:8002', icon: '☁️', color: '#8b5cf6' },
}

const PIPELINE_STEPS = {
  xeon: [
    { id: 'upload', label: 'Document received', sub: 'PDF auto-converted to 300dpi JPEG' },
    { id: 'ela', label: 'Error Level Analysis', sub: 'Multi-level re-compression (Q90+Q70+Q50)' },
    { id: 'dino', label: 'DINOv2 ViT-L/14 Forensics', sub: '304M params — pixel-level tampering detection' },
    { id: 'score', label: 'Forensic Scoring', sub: 'p_tampered + verdict' },
    { id: 'ollama', label: 'Ollama Gemma 3 4B', sub: 'OCR + field extraction + explanation' },
  ],
  aws: [
    { id: 'upload', label: 'Document received', sub: 'PDF auto-converted to 300dpi JPEG' },
    { id: 'gemma', label: 'Gemma 4 E4B (A10G GPU)', sub: 'Full multimodal analysis — OCR + fields + coherence' },
    { id: 'explanation', label: 'AI Explanation', sub: 'Professional authenticity assessment' },
  ],
}

export default function VerifyDemo() {
  const [backend, setBackend] = useState<Backend>('xeon')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [inputMode, setInputMode] = useState<'file' | 'camera'>('file')
  const cameraRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [activeStep, setActiveStep] = useState(-1)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((f: File) => {
    setFile(f)
    setResult(null)
    setError(null)
    setActiveStep(-1)
    if (f.type === 'application/pdf' || f.name.endsWith('.pdf')) {
      setPreview(null)
    } else {
      const reader = new FileReader()
      reader.onload = e => setPreview(e.target?.result as string)
      reader.readAsDataURL(f)
    }
  }, [])

  const analyze = async () => {
    if (!file) return
    setLoading(true)
    setResult(null)
    setError(null)
    setActiveStep(0)

    const steps = PIPELINE_STEPS[backend]
    let stepTimer: ReturnType<typeof setInterval>
    let currentStep = 0
    stepTimer = setInterval(() => {
      if (currentStep < steps.length - 1) {
        currentStep++
        setActiveStep(currentStep)
      }
    }, backend === 'xeon' ? 800 : 1200)

    const t0 = performance.now()

    try {
      const form = new FormData()
      form.append('image', file)
      form.append('backend', backend)

      const res = await fetch('/api/verify-proxy', { method: 'POST', body: form })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()

      clearInterval(stepTimer)
      setActiveStep(steps.length - 1)
      setElapsed(Math.round(performance.now() - t0))
      setResult(data)
    } catch (e: any) {
      clearInterval(stepTimer)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const forensics = result?.forensics
  const combined = result?.combined
  const analysis = result?.analysis || {
    ocr_text: result?.ocr_text || '',
    fields: result?.fields || {},
    doc_type: result?.doc_type || 'unknown',
    coherence_issues: result?.coherence_issues || [],
    explanation: result?.explanation || '',
  }
  // Use combined verdict (forensics + LLM) if available, else fallback to forensics only
  const verdict = result?.verdict || combined?.verdict || forensics?.verdict || null
  const pTampered = combined?.p_tampered_combined ?? forensics?.p_tampered
  const confidenceScore = result?.confidence_score

  return (
    <div style={{ minHeight: '100vh', background: '#0a0e17', color: '#e2e8f0', fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ padding: '20px 32px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Deep-Check</h1>
        <span style={{ background: '#8b5cf6', color: 'white', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>VERIFY DEMO</span>
        <span style={{ color: '#94a3b8', fontSize: 13, marginLeft: 'auto' }}>Pre-production | Document Verification Pipeline</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 'calc(100vh - 61px)' }}>
        {/* LEFT: Input */}
        <div style={{ padding: '24px 32px', borderRight: '1px solid #1e293b' }}>
          {/* Backend Selector */}
          <h3 style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>Select Backend</h3>
          <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
            {(Object.keys(BACKENDS) as Backend[]).map(key => (
              <button key={key} onClick={() => { setBackend(key); setResult(null); setActiveStep(-1) }}
                style={{
                  flex: 1, padding: '14px 16px', borderRadius: 10, border: `2px solid ${backend === key ? BACKENDS[key].color : '#1e293b'}`,
                  background: backend === key ? `${BACKENDS[key].color}15` : '#111827', cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s',
                }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>{BACKENDS[key].icon}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: backend === key ? BACKENDS[key].color : '#e2e8f0' }}>{BACKENDS[key].label}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{BACKENDS[key].desc}</div>
              </button>
            ))}
          </div>

          {/* Input Mode Selector */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button onClick={() => setInputMode('camera')}
              style={{
                flex: 1, padding: '10px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${inputMode === 'camera' ? '#10b981' : '#1e293b'}`,
                background: inputMode === 'camera' ? '#10b98115' : '#111827',
                color: inputMode === 'camera' ? '#10b981' : '#94a3b8',
              }}>
              📸 Camera {backend === 'xeon' && <span style={{ fontSize: 10, color: '#10b981' }}>(recommended)</span>}
            </button>
            <button onClick={() => setInputMode('file')}
              style={{
                flex: 1, padding: '10px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${inputMode === 'file' ? BACKENDS[backend].color : '#1e293b'}`,
                background: inputMode === 'file' ? `${BACKENDS[backend].color}15` : '#111827',
                color: inputMode === 'file' ? BACKENDS[backend].color : '#94a3b8',
              }}>
              📁 Upload File
            </button>
          </div>

          {/* Camera / Upload Zone */}
          {inputMode === 'camera' ? (
            <div onClick={() => cameraRef.current?.click()}
              style={{
                border: '2px dashed #10b981', borderRadius: 10, padding: file ? 16 : 40, textAlign: 'center',
                cursor: 'pointer', marginBottom: 16, background: '#10b98108',
              }}>
              {file && preview ? (
                <div>
                  <img src={preview} alt="captured" style={{ maxWidth: 250, maxHeight: 180, borderRadius: 8, marginBottom: 8 }} />
                  <div style={{ fontSize: 13, color: '#94a3b8' }}>{file.name} ({Math.round(file.size / 1024)} KB)</div>
                  <div style={{ fontSize: 11, color: '#10b981', marginTop: 4 }}>Direct camera capture — optimal for forensic analysis</div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 48, marginBottom: 8 }}>📸</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#10b981' }}>Take photo of document</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Opens your camera — best accuracy for forensic detection</div>
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 8, padding: '6px 12px', background: '#111827', borderRadius: 6, display: 'inline-block' }}>
                    Direct photo = no PDF conversion artifacts = more accurate results
                  </div>
                </div>
              )}
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
            </div>
          ) : (
            <div onClick={() => fileRef.current?.click()}
              onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]) }}
              onDragOver={e => e.preventDefault()}
              style={{
                border: '2px dashed #1e293b', borderRadius: 10, padding: file ? 16 : 40, textAlign: 'center',
                cursor: 'pointer', marginBottom: 16, transition: 'border-color 0.2s',
              }}>
              {file ? (
                <div>
                  {preview ? <img src={preview} alt="preview" style={{ maxWidth: 250, maxHeight: 180, borderRadius: 8, marginBottom: 8 }} /> :
                    <div style={{ fontSize: 48, marginBottom: 8 }}>📄</div>}
                  <div style={{ fontSize: 13, color: '#94a3b8' }}>{file.name} ({Math.round(file.size / 1024)} KB)</div>
                  {file.name.endsWith('.pdf') && <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>PDF — pages auto-converted. Camera capture recommended for best accuracy.</div>}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>🪪</div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>Drop document or click to upload</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>PDF, JPEG, PNG — DNI, passport, diploma, invoice (195 countries)</div>
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/*,.pdf,application/pdf" hidden onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
            </div>
          )}

          <button onClick={analyze} disabled={!file || loading}
            style={{
              width: '100%', padding: '14px 24px', borderRadius: 10, border: 'none', fontSize: 14, fontWeight: 600,
              background: `linear-gradient(135deg, ${BACKENDS[backend].color}, #6366f1)`, color: 'white', cursor: file && !loading ? 'pointer' : 'not-allowed',
              opacity: file && !loading ? 1 : 0.5, transition: 'all 0.2s',
            }}>
            {loading ? 'Processing...' : `Verify with ${BACKENDS[backend].label}`}
          </button>

          {/* Pipeline Tracker */}
          {(loading || result) && (
            <div style={{ marginTop: 24, padding: 16, background: '#111827', border: '1px solid #1e293b', borderRadius: 10 }}>
              <h3 style={{ fontSize: 12, color: BACKENDS[backend].color, marginBottom: 14, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {BACKENDS[backend].icon} Pipeline — {BACKENDS[backend].label}
              </h3>
              {PIPELINE_STEPS[backend].map((step, i) => (
                <div key={step.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, flexShrink: 0, transition: 'all 0.3s',
                    background: i <= activeStep ? BACKENDS[backend].color : '#1e293b',
                    color: i <= activeStep ? 'white' : '#64748b',
                  }}>{i <= activeStep && result ? '✓' : i + 1}</div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: i <= activeStep ? '#e2e8f0' : '#64748b', transition: 'color 0.3s' }}>{step.label}</div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>{step.sub}</div>
                  </div>
                </div>
              ))}
              {result && <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, textAlign: 'right' }}>Total: {elapsed}ms</div>}
            </div>
          )}
        </div>

        {/* RIGHT: Results */}
        <div style={{ padding: '24px 32px', overflowY: 'auto' }}>
          {error && (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>❌</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#ef4444', marginBottom: 8 }}>Request Failed</div>
              <div style={{ fontSize: 13, color: '#94a3b8' }}>{error}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>Check that the {BACKENDS[backend].label} backend is running.</div>
            </div>
          )}

          {!result && !error && !loading && (
            <div style={{ padding: '80px 32px', textAlign: 'center', color: '#64748b' }}>
              <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>⚡</div>
              <h3 style={{ fontSize: 16, marginBottom: 8, color: '#94a3b8' }}>Ready to verify</h3>
              <p style={{ fontSize: 13 }}>Upload a document and select your backend to see the full AI verification pipeline in action.</p>
            </div>
          )}

          {loading && !result && (
            <div style={{ padding: '80px 32px', textAlign: 'center' }}>
              <div style={{ width: 24, height: 24, border: '3px solid #1e293b', borderTopColor: BACKENDS[backend].color, borderRadius: '50%', animation: 'spin 0.6s linear infinite', margin: '0 auto 16px' }} />
              <div style={{ fontSize: 13, color: '#94a3b8' }}>Analyzing document with {BACKENDS[backend].label}...</div>
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            </div>
          )}

          {result && (
            <div>
              {/* Verdict */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #1e293b' }}>
                <span style={{
                  fontSize: 28, fontWeight: 800,
                  color: verdict === 'authentic' ? '#10b981' : verdict === 'suspicious' ? '#f59e0b' : '#ef4444',
                }}>{(verdict || analysis.doc_type || 'ANALYZED').toUpperCase()}</span>
                <span style={{ fontSize: 12, color: '#64748b', marginLeft: 'auto' }}>
                  {elapsed}ms | {BACKENDS[backend].label}
                </span>
              </div>

              {/* Metrics */}
              {(pTampered !== undefined || confidenceScore !== undefined) && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                  {confidenceScore !== undefined && (
                    <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 8, padding: 14 }}>
                      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase' }}>Confidence</div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: confidenceScore > 0.7 ? '#10b981' : confidenceScore > 0.4 ? '#f59e0b' : '#ef4444', marginTop: 4 }}>{(confidenceScore * 100).toFixed(1)}%</div>
                      <div style={{ height: 4, background: '#1e293b', borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(100, confidenceScore * 100)}%`, background: confidenceScore > 0.7 ? '#10b981' : '#f59e0b', borderRadius: 2, transition: 'width 0.5s' }} />
                      </div>
                      <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>Combined: forensics (60%) + AI semantic (40%)</div>
                    </div>
                  )}
                  <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 8, padding: 14 }}>
                    <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase' }}>Forensics Score</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: (forensics?.p_tampered || 0) > 0.3 ? '#f59e0b' : '#10b981', marginTop: 4 }}>{((forensics?.p_tampered || 0) * 100).toFixed(1)}% pixel</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{forensics?.model || 'DINOv2+ELA'} ({forensics?.version || 'v2b'})</div>
                    {combined?.llm_confirms_authentic && <div style={{ fontSize: 10, color: '#10b981', marginTop: 4 }}>LLM confirms authentic</div>}
                    {combined && !combined.llm_confirms_authentic && <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 4 }}>LLM flagged issues</div>}
                  </div>
                </div>
              )}

              {/* Document Type */}
              {analysis.doc_type && analysis.doc_type !== 'unknown' && (
                <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 8, padding: 14, marginBottom: 16 }}>
                  <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Document Type</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: BACKENDS[backend].color }}>{analysis.doc_type}</div>
                </div>
              )}

              {/* Fields */}
              {analysis.fields && Object.keys(analysis.fields).filter(k => analysis.fields[k]).length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>📋 Extracted Fields</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px', fontSize: 12, background: '#111827', border: '1px solid #1e293b', borderRadius: 8, padding: 14 }}>
                    {Object.entries(analysis.fields).filter(([, v]) => v).map(([k, v]) => (
                      <div key={k} style={{ display: 'contents' }}>
                        <div style={{ color: '#64748b', textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</div>
                        <div style={{ fontWeight: 500 }}>{String(v)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* OCR Text */}
              {analysis.ocr_text && (
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>📝 OCR Text</h3>
                  <div style={{ background: '#0a0e17', border: '1px solid #1e293b', borderRadius: 8, padding: 14, fontSize: 11, fontFamily: "'JetBrains Mono', monospace", maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                    {analysis.ocr_text}
                  </div>
                </div>
              )}

              {/* Coherence Issues */}
              {analysis.coherence_issues && analysis.coherence_issues.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>⚠️ Coherence Issues</h3>
                  <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 8, padding: 14 }}>
                    {analysis.coherence_issues.map((issue, i) => (
                      <div key={i} style={{ fontSize: 12, color: '#f59e0b', marginBottom: 4 }}>• {issue}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Explanation */}
              {analysis.explanation && (
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>💬 AI Explanation</h3>
                  <div style={{ background: '#111827', border: `1px solid ${BACKENDS[backend].color}30`, borderRadius: 8, padding: 14, fontSize: 13, lineHeight: 1.6, borderLeft: `3px solid ${BACKENDS[backend].color}` }}>
                    {analysis.explanation}
                  </div>
                </div>
              )}

              {/* Raw JSON */}
              <details style={{ marginTop: 16 }}>
                <summary style={{ fontSize: 12, color: '#64748b', cursor: 'pointer', marginBottom: 8 }}>Raw JSON Response</summary>
                <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 8, padding: 14, fontSize: 10, fontFamily: "'JetBrains Mono', monospace", maxHeight: 300, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(result, null, 2)}
                </div>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
