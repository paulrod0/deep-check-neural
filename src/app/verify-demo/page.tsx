'use client'

import { useState, useRef } from 'react'

type DocMode = 'identity' | 'document'
type Backend = 'xeon' | 'aws'

const BACKENDS = {
  xeon: { label: 'On-Premise', desc: 'DINOv2 + Ollama', icon: '🖥️', color: '#3b82f6' },
  aws: { label: 'AWS GPU', desc: 'DINOv2 + Gemma 4 E4B', icon: '☁️', color: '#8b5cf6' },
}

export default function VerifyDemo() {
  const [mode, setMode] = useState<DocMode>('identity')
  const [backend, setBackend] = useState<Backend>('xeon')
  const [frontFile, setFrontFile] = useState<File | null>(null)
  const [backFile, setBackFile] = useState<File | null>(null)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [frontPreview, setFrontPreview] = useState<string | null>(null)
  const [backPreview, setBackPreview] = useState<string | null>(null)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const frontRef = useRef<HTMLInputElement>(null)
  const backRef = useRef<HTMLInputElement>(null)
  const pdfRef = useRef<HTMLInputElement>(null)

  const compress = (file: File, max = 1500): Promise<File> =>
    new Promise(resolve => {
      const img = new window.Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        const c = document.createElement('canvas')
        let w = img.width, h = img.height
        if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r) }
        c.width = w; c.height = h
        c.getContext('2d')!.drawImage(img, 0, 0, w, h)
        c.toBlob(b => resolve(new File([b!], file.name, { type: 'image/jpeg' })), 'image/jpeg', 0.85)
      }
      img.src = url
    })

  const handleCapture = async (file: File, side: 'front' | 'back') => {
    const compressed = await compress(file)
    const reader = new FileReader()
    reader.onload = e => {
      if (side === 'front') { setFrontFile(compressed); setFrontPreview(e.target?.result as string) }
      else { setBackFile(compressed); setBackPreview(e.target?.result as string) }
    }
    reader.readAsDataURL(compressed)
  }

  const canVerify = mode === 'identity' ? !!(frontFile && backFile) : !!pdfFile

  const verify = async () => {
    if (!canVerify) return
    setLoading(true); setResult(null); setError(null)
    const t0 = performance.now()
    try {
      let res: Response
      if (mode === 'identity') {
        const form = new FormData()
        form.append('front', frontFile!)
        form.append('back', backFile!)
        res = await fetch('/api/verify-identity', { method: 'POST', body: form })
      } else {
        const form = new FormData()
        form.append('image', pdfFile!)
        form.append('backend', backend)
        res = await fetch('/api/verify-proxy', { method: 'POST', body: form })
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setResult(await res.json())
      setElapsed(Math.round(performance.now() - t0))
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const reset = () => {
    setFrontFile(null); setBackFile(null); setPdfFile(null)
    setFrontPreview(null); setBackPreview(null)
    setResult(null); setError(null); setElapsed(0)
  }

  const vc = (v: string) => v === 'authentic' ? '#10b981' : v === 'likely_authentic' ? '#10b981' : v === 'suspicious' || v === 'review_needed' ? '#f59e0b' : '#ef4444'
  const verdict = result?.verdict || result?.forensics?.verdict
  const confidence = result?.confidence_score ?? result?.confidence

  return (
    <div style={{ minHeight: '100vh', background: '#0a0e17', color: '#e2e8f0', fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Deep-Check</h1>
        <span style={{ background: '#8b5cf6', color: 'white', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600 }}>VERIFY</span>
        <span style={{ color: '#64748b', fontSize: 12, marginLeft: 'auto' }}>Pre-production</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 'calc(100vh - 53px)' }}>
        {/* LEFT */}
        <div style={{ padding: '20px 24px', borderRight: '1px solid #1e293b', overflowY: 'auto' }}>

          {/* Document Type */}
          <h3 style={{ fontSize: 11, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Document Type</h3>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {([
              { key: 'identity' as DocMode, icon: '🪪', label: 'ID Document', sub: 'DNI / Passport', color: '#10b981' },
              { key: 'document' as DocMode, icon: '📄', label: 'PDF Document', sub: 'Payslip / Diploma / Certificate', color: '#3b82f6' },
            ]).map(opt => (
              <button key={opt.key} onClick={() => { setMode(opt.key); reset() }}
                style={{
                  flex: 1, padding: '12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                  border: `2px solid ${mode === opt.key ? opt.color : '#1e293b'}`,
                  background: mode === opt.key ? `${opt.color}10` : '#111827',
                }}>
                <div style={{ fontSize: 20 }}>{opt.icon}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: mode === opt.key ? opt.color : '#e2e8f0', marginTop: 4 }}>{opt.label}</div>
                <div style={{ fontSize: 10, color: '#64748b' }}>{opt.sub}</div>
              </button>
            ))}
          </div>

          {/* Backend (only for PDF mode) */}
          {mode === 'document' && (
            <>
              <h3 style={{ fontSize: 11, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Backend</h3>
              <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                {(Object.keys(BACKENDS) as Backend[]).map(key => (
                  <button key={key} onClick={() => setBackend(key)}
                    style={{
                      flex: 1, padding: '10px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                      border: `1px solid ${backend === key ? BACKENDS[key].color : '#1e293b'}`,
                      background: backend === key ? `${BACKENDS[key].color}10` : '#111827', fontSize: 12,
                    }}>
                    <span>{BACKENDS[key].icon} </span>
                    <span style={{ fontWeight: 600, color: backend === key ? BACKENDS[key].color : '#94a3b8' }}>{BACKENDS[key].label}</span>
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{BACKENDS[key].desc}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ID Mode: Camera Front + Back */}
          {mode === 'identity' && (
            <div>
              <h3 style={{ fontSize: 11, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Capture Document</h3>

              {/* Front */}
              <div onClick={() => frontRef.current?.click()}
                style={{
                  border: `2px dashed ${frontFile ? '#10b981' : '#1e293b'}`, borderRadius: 10, padding: frontPreview ? 12 : 28,
                  textAlign: 'center', cursor: 'pointer', marginBottom: 8, background: frontFile ? '#10b98108' : 'transparent',
                }}>
                {frontPreview ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <img src={frontPreview} alt="front" style={{ width: 80, height: 50, objectFit: 'cover', borderRadius: 6 }} />
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#10b981' }}>Front captured ✓</div>
                      <div style={{ fontSize: 10, color: '#64748b' }}>{frontFile?.name}</div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 24 }}>📸</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#10b981', marginTop: 4 }}>Take photo — FRONT</div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>Face side of document</div>
                  </div>
                )}
              </div>
              <input ref={frontRef} type="file" accept="image/*" capture="environment" hidden
                onChange={e => { if (e.target.files?.[0]) handleCapture(e.target.files[0], 'front') }} />

              {/* Back */}
              <div onClick={() => backRef.current?.click()}
                style={{
                  border: `2px dashed ${backFile ? '#10b981' : '#1e293b'}`, borderRadius: 10, padding: backPreview ? 12 : 28,
                  textAlign: 'center', cursor: 'pointer', marginBottom: 16, background: backFile ? '#10b98108' : 'transparent',
                  opacity: frontFile ? 1 : 0.4, pointerEvents: frontFile ? 'auto' : 'none',
                }}>
                {backPreview ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <img src={backPreview} alt="back" style={{ width: 80, height: 50, objectFit: 'cover', borderRadius: 6 }} />
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#10b981' }}>Back captured ✓</div>
                      <div style={{ fontSize: 10, color: '#64748b' }}>{backFile?.name}</div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 24 }}>🔄</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#3b82f6', marginTop: 4 }}>Take photo — BACK</div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>MRZ side of document</div>
                  </div>
                )}
              </div>
              <input ref={backRef} type="file" accept="image/*" capture="environment" hidden
                onChange={e => { if (e.target.files?.[0]) handleCapture(e.target.files[0], 'back') }} />

              <div style={{ fontSize: 11, color: '#475569', padding: '8px 12px', background: '#111827', borderRadius: 8, marginBottom: 16, textAlign: 'center' }}>
                DINOv2 pixel forensics + MRZ check digits + DNI validation + cross-validation front vs back
              </div>
            </div>
          )}

          {/* PDF Mode: Upload */}
          {mode === 'document' && (
            <div>
              <h3 style={{ fontSize: 11, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Upload PDF</h3>
              <div onClick={() => pdfRef.current?.click()}
                style={{
                  border: `2px dashed ${pdfFile ? '#3b82f6' : '#1e293b'}`, borderRadius: 10, padding: pdfFile ? 16 : 32,
                  textAlign: 'center', cursor: 'pointer', marginBottom: 16, background: pdfFile ? '#3b82f608' : 'transparent',
                }}>
                {pdfFile ? (
                  <div>
                    <div style={{ fontSize: 32 }}>📄</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#3b82f6', marginTop: 4 }}>{pdfFile.name}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{Math.round(pdfFile.size / 1024)} KB</div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 36 }}>📁</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#3b82f6', marginTop: 4 }}>Tap to select PDF</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Payslip, diploma, certificate, transcript...</div>
                  </div>
                )}
              </div>
              <input ref={pdfRef} type="file" accept=".pdf,application/pdf" hidden
                onChange={e => { if (e.target.files?.[0]) setPdfFile(e.target.files[0]) }} />

              <div style={{ fontSize: 11, color: '#475569', padding: '8px 12px', background: '#111827', borderRadius: 8, marginBottom: 16, textAlign: 'center' }}>
                PDF structural analysis + QR code validation + text extraction + pixel forensics
              </div>
            </div>
          )}

          {/* Verify Button */}
          <button onClick={verify} disabled={!canVerify || loading}
            style={{
              width: '100%', padding: '14px', borderRadius: 10, border: 'none', fontSize: 14, fontWeight: 700,
              background: canVerify && !loading ? `linear-gradient(135deg, ${mode === 'identity' ? '#10b981' : BACKENDS[backend].color}, #6366f1)` : '#1e293b',
              color: 'white', cursor: canVerify && !loading ? 'pointer' : 'not-allowed', opacity: canVerify && !loading ? 1 : 0.5,
            }}>
            {loading ? 'Verifying...' : mode === 'identity' ? 'Verify ID Document' : `Verify with ${BACKENDS[backend].label}`}
          </button>
        </div>

        {/* RIGHT: Results */}
        <div style={{ padding: '20px 24px', overflowY: 'auto' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <div style={{ width: 32, height: 32, border: '3px solid #1e293b', borderTopColor: '#10b981', borderRadius: '50%', animation: 'spin 0.6s linear infinite', margin: '0 auto 16px' }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
              <div style={{ fontSize: 13, color: '#94a3b8' }}>Analyzing {mode === 'identity' ? 'front + back' : 'PDF'}...</div>
            </div>
          )}

          {error && (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>❌</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#ef4444' }}>Request Failed</div>
              <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>{error}</div>
              <button onClick={reset} style={{ marginTop: 16, padding: '8px 20px', borderRadius: 8, border: '1px solid #1e293b', background: '#111827', color: '#e2e8f0', cursor: 'pointer', fontSize: 12 }}>Try Again</button>
            </div>
          )}

          {!result && !error && !loading && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#475569' }}>
              <div style={{ fontSize: 48, opacity: 0.2, marginBottom: 12 }}>⚡</div>
              <div style={{ fontSize: 14, color: '#64748b' }}>Select document type and upload to verify</div>
            </div>
          )}

          {result && (
            <div>
              {/* Verdict */}
              <div style={{ textAlign: 'center', marginBottom: 20, padding: 16, background: '#111827', borderRadius: 12, border: `2px solid ${vc(verdict || '')}` }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: vc(verdict || '') }}>
                  {(verdict || 'ANALYZED').toUpperCase().replace(/_/g, ' ')}
                </div>
                {confidence !== undefined && (
                  <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>Confidence: {(confidence * 100).toFixed(1)}%</div>
                )}
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{elapsed}ms | {mode === 'identity' ? 'On-Premise' : BACKENDS[backend].label}</div>
              </div>

              {/* ID Mode: Front + Back previews */}
              {mode === 'identity' && frontPreview && backPreview && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>Front</div>
                    <img src={frontPreview} alt="front" style={{ width: '100%', borderRadius: 8 }} />
                    <div style={{ fontSize: 10, color: '#10b981', marginTop: 4 }}>{((result.front?.forensics?.p_tampered || 0) * 100).toFixed(1)}% pixel</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>Back</div>
                    <img src={backPreview} alt="back" style={{ width: '100%', borderRadius: 8 }} />
                    <div style={{ fontSize: 10, color: '#10b981', marginTop: 4 }}>{((result.back?.forensics?.p_tampered || 0) * 100).toFixed(1)}% pixel</div>
                  </div>
                </div>
              )}

              {/* Forensics Score (PDF mode) */}
              {mode === 'document' && result.forensics && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                  <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase' }}>P(Tampered)</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: (result.forensics.p_tampered || 0) > 0.3 ? '#ef4444' : '#10b981', marginTop: 4 }}>{((result.forensics.p_tampered || 0) * 100).toFixed(1)}%</div>
                  </div>
                  <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase' }}>Model</div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{result.forensics.model || 'DINOv2+ELA'}</div>
                  </div>
                </div>
              )}

              {/* Fields */}
              {(() => {
                const fields = mode === 'identity' ? { ...result.front?.fields, ...result.back?.fields } : { ...result.forensics?.fields_from_pdf, ...result.analysis?.fields }
                const entries = Object.entries(fields || {}).filter(([, v]) => v && String(v).length > 0)
                if (!entries.length) return null
                return (
                  <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 14, marginBottom: 16 }}>
                    <h3 style={{ fontSize: 12, marginBottom: 10 }}>📋 Extracted Fields</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 12 }}>
                      {entries.map(([k, v]) => (
                        <div key={k} style={{ display: 'contents' }}>
                          <div style={{ color: '#64748b', textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</div>
                          <div style={{ fontWeight: 500 }}>{String(v)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}

              {/* Cross Validation (ID mode) */}
              {result.cross_validation && (
                <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 14, marginBottom: 16 }}>
                  <h3 style={{ fontSize: 12, marginBottom: 10 }}>🔗 Cross-Validation</h3>
                  {result.cross_validation.dni_check?.map((c: string, i: number) => (
                    <div key={i} style={{ fontSize: 11, color: c.includes('valid') && !c.includes('invalid') ? '#10b981' : '#ef4444', marginBottom: 3 }}>
                      {c.includes('CRITICAL') ? '🚨' : c.includes('valid') && !c.includes('invalid') ? '✅' : '⚠️'} {c}
                    </div>
                  ))}
                  {result.cross_validation.issues?.filter((c: string) => !result.cross_validation.dni_check?.includes(c)).map((c: string, i: number) => (
                    <div key={`i${i}`} style={{ fontSize: 11, color: c.includes('CRITICAL') ? '#ef4444' : '#f59e0b', marginBottom: 3 }}>
                      {c.includes('CRITICAL') ? '🚨' : '⚠️'} {c}
                    </div>
                  ))}
                  {(!result.cross_validation.issues?.length) && <div style={{ fontSize: 11, color: '#10b981' }}>✅ No issues found</div>}
                </div>
              )}

              {/* MRZ (ID mode) */}
              {result.back?.mrz?.mrz_lines && (
                <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 14, marginBottom: 16 }}>
                  <h3 style={{ fontSize: 12, marginBottom: 8 }}>🔖 MRZ</h3>
                  <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#94a3b8' }}>
                    {result.back.mrz.mrz_lines.map((l: string, i: number) => <div key={i}>{l}</div>)}
                  </div>
                  <div style={{ fontSize: 10, marginTop: 6, color: result.back.mrz.check_digits_valid ? '#10b981' : '#ef4444' }}>
                    Check digits: {result.back.mrz.check_digits_valid ? '✅ Valid' : '❌ Invalid'}
                  </div>
                </div>
              )}

              {/* QR Codes (PDF mode) */}
              {result.forensics?.qr_codes?.length > 0 && (
                <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 14, marginBottom: 16 }}>
                  <h3 style={{ fontSize: 12, marginBottom: 10 }}>📱 QR Codes</h3>
                  {result.forensics.qr_codes.map((qr: any, i: number) => (
                    <div key={i} style={{ fontSize: 11, padding: 8, background: '#0a0e17', borderRadius: 6, marginBottom: 6 }}>
                      <div style={{ color: '#3b82f6', fontWeight: 600 }}>{qr.type} ({qr.source})</div>
                      <div style={{ color: '#94a3b8', wordBreak: 'break-all', marginTop: 2 }}>{qr.data}</div>
                    </div>
                  ))}
                  {result.forensics.qr_validation?.validations?.map((v: string, i: number) => (
                    <div key={i} style={{ fontSize: 10, color: '#10b981', marginTop: 2 }}>✅ {v}</div>
                  ))}
                  {result.forensics.qr_validation?.issues?.map((v: string, i: number) => (
                    <div key={i} style={{ fontSize: 10, color: '#ef4444', marginTop: 2 }}>🚨 {v}</div>
                  ))}
                </div>
              )}

              {/* PDF Structure (PDF mode) */}
              {result.forensics?.pdf_structural && (
                <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 14, marginBottom: 16 }}>
                  <h3 style={{ fontSize: 12, marginBottom: 10 }}>🔍 PDF Structure</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 12px', fontSize: 11 }}>
                    <div style={{ color: '#64748b' }}>Producer</div><div>{result.forensics.pdf_structural.producer || '?'}</div>
                    <div style={{ color: '#64748b' }}>Pages</div><div>{result.forensics.pdf_structural.pages}</div>
                    <div style={{ color: '#64748b' }}>Native text</div><div>{result.forensics.pdf_structural.has_native_text ? '✅' : '❌ Scanned'}</div>
                    <div style={{ color: '#64748b' }}>Fonts</div><div>{result.forensics.pdf_structural.fonts_count}</div>
                    <div style={{ color: '#64748b' }}>Annotations</div><div>{result.forensics.pdf_structural.has_annotations ? '⚠️' : '✅'}</div>
                    <div style={{ color: '#64748b' }}>Layers</div><div>{result.forensics.pdf_structural.has_layers ? '⚠️' : '✅'}</div>
                  </div>
                  {result.forensics.pdf_structural.risk_indicators?.map((r: string, i: number) => (
                    <div key={i} style={{ fontSize: 10, color: r.includes('positive') ? '#10b981' : '#f59e0b', marginTop: 4 }}>
                      {r.includes('positive') ? '✅' : '⚠️'} {r}
                    </div>
                  ))}
                </div>
              )}

              {/* AI Explanation */}
              {result.analysis?.explanation && (
                <div style={{ background: '#111827', borderLeft: '3px solid #8b5cf6', borderRadius: 10, padding: 14, marginBottom: 16 }}>
                  <h3 style={{ fontSize: 12, marginBottom: 8 }}>💬 AI Explanation</h3>
                  <div style={{ fontSize: 12, lineHeight: 1.6, color: '#94a3b8' }}>{result.analysis.explanation}</div>
                </div>
              )}

              {/* Raw JSON */}
              <details>
                <summary style={{ fontSize: 11, color: '#475569', cursor: 'pointer' }}>Raw JSON</summary>
                <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 8, padding: 12, fontSize: 9, fontFamily: 'monospace', maxHeight: 300, overflowY: 'auto', whiteSpace: 'pre-wrap', marginTop: 8 }}>
                  {JSON.stringify(result, null, 2)}
                </div>
              </details>

              <button onClick={reset} style={{ width: '100%', marginTop: 16, padding: '12px', borderRadius: 10, border: 'none', background: '#1e293b', color: '#e2e8f0', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Verify Another Document
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
