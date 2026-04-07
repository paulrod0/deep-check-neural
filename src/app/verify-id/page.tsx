'use client'

import { useState, useRef } from 'react'

type Step = 'front' | 'back' | 'processing' | 'result'

export default function VerifyId() {
  const [step, setStep] = useState<Step>('front')
  const [frontFile, setFrontFile] = useState<File | null>(null)
  const [backFile, setBackFile] = useState<File | null>(null)
  const [frontPreview, setFrontPreview] = useState<string | null>(null)
  const [backPreview, setBackPreview] = useState<string | null>(null)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const frontRef = useRef<HTMLInputElement>(null)
  const backRef = useRef<HTMLInputElement>(null)

  const compressImage = (file: File, maxSize = 1500): Promise<File> => {
    return new Promise((resolve) => {
      const img = new window.Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        const canvas = document.createElement('canvas')
        let w = img.width, h = img.height
        if (w > maxSize || h > maxSize) {
          const ratio = Math.min(maxSize / w, maxSize / h)
          w = Math.round(w * ratio)
          h = Math.round(h * ratio)
        }
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, w, h)
        canvas.toBlob((blob) => {
          resolve(new File([blob!], file.name, { type: 'image/jpeg' }))
        }, 'image/jpeg', 0.85)
      }
      img.src = url
    })
  }

  const handleCapture = async (file: File, side: 'front' | 'back') => {
    const compressed = await compressImage(file)
    const reader = new FileReader()
    reader.onload = e => {
      if (side === 'front') {
        setFrontFile(compressed)
        setFrontPreview(e.target?.result as string)
        setStep('back')
      } else {
        setBackFile(compressed)
        setBackPreview(e.target?.result as string)
      }
    }
    reader.readAsDataURL(compressed)
  }

  const verify = async () => {
    if (!frontFile || !backFile) return
    setStep('processing')
    setProcessing(true)
    setError(null)

    try {
      const form = new FormData()
      form.append('front', frontFile)
      form.append('back', backFile)

      const res = await fetch('/api/verify-identity', { method: 'POST', body: form })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setResult(data)
      setStep('result')
    } catch (e: any) {
      setError(e.message)
      setStep('result')
    } finally {
      setProcessing(false)
    }
  }

  const reset = () => {
    setStep('front')
    setFrontFile(null)
    setBackFile(null)
    setFrontPreview(null)
    setBackPreview(null)
    setResult(null)
    setError(null)
  }

  const verdictColor = (v: string) =>
    v === 'authentic' ? '#10b981' : v === 'review_needed' ? '#f59e0b' : v === 'suspicious' ? '#f59e0b' : '#ef4444'

  return (
    <div style={{ minHeight: '100vh', background: '#0a0e17', color: '#e2e8f0', fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Deep-Check</h1>
        <span style={{ background: '#10b981', color: 'white', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600 }}>ID VERIFY</span>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px' }}>
        {/* Progress Steps */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, justifyContent: 'center' }}>
          {['Front', 'Back', 'Verify'].map((label, i) => {
            const stepIdx = i === 0 ? 'front' : i === 1 ? 'back' : 'processing'
            const active = step === stepIdx || (step === 'result' && i <= 2)
            const done = (i === 0 && frontFile) || (i === 1 && backFile) || (i === 2 && result)
            return (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700,
                  background: done ? '#10b981' : active ? '#3b82f6' : '#1e293b',
                  color: done || active ? 'white' : '#64748b',
                }}>{done ? '✓' : i + 1}</div>
                <span style={{ fontSize: 12, color: active ? '#e2e8f0' : '#64748b' }}>{label}</span>
                {i < 2 && <div style={{ width: 24, height: 1, background: '#1e293b' }} />}
              </div>
            )
          })}
        </div>

        {/* Step: Front */}
        {step === 'front' && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, textAlign: 'center', marginBottom: 8 }}>Document Front</h2>
            <p style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', marginBottom: 20 }}>
              Take a photo of the FRONT of your ID (face side)
            </p>
            <div onClick={() => frontRef.current?.click()}
              style={{
                border: '2px dashed #10b981', borderRadius: 12, padding: 48, textAlign: 'center',
                cursor: 'pointer', background: '#10b98108', marginBottom: 16,
              }}>
              <div style={{ fontSize: 56, marginBottom: 12 }}>📸</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#10b981' }}>Tap to take photo</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>Camera will open — capture the front of your document</div>
            </div>
            <input ref={frontRef} type="file" accept="image/*" capture="environment" hidden
              onChange={e => { if (e.target.files?.[0]) handleCapture(e.target.files[0], 'front') }} />
          </div>
        )}

        {/* Step: Back */}
        {step === 'back' && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, textAlign: 'center', marginBottom: 8 }}>Document Back</h2>
            <p style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', marginBottom: 12 }}>
              Now take a photo of the BACK of your ID (MRZ side)
            </p>

            {/* Front preview */}
            {frontPreview && (
              <div style={{ marginBottom: 16, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Front captured ✓</div>
                <img src={frontPreview} alt="front" style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 8, opacity: 0.6 }} />
              </div>
            )}

            <div onClick={() => backRef.current?.click()}
              style={{
                border: '2px dashed #3b82f6', borderRadius: 12, padding: 48, textAlign: 'center',
                cursor: 'pointer', background: '#3b82f608', marginBottom: 16,
              }}>
              <div style={{ fontSize: 56, marginBottom: 12 }}>🔄</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#3b82f6' }}>Tap to capture back</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>Flip the document — capture the back with MRZ</div>
            </div>
            <input ref={backRef} type="file" accept="image/*" capture="environment" hidden
              onChange={e => { if (e.target.files?.[0]) handleCapture(e.target.files[0], 'back') }} />

            {backPreview && (
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <img src={backPreview} alt="back" style={{ maxWidth: '100%', maxHeight: 160, borderRadius: 8 }} />
              </div>
            )}

            {backFile && (
              <button onClick={verify}
                style={{
                  width: '100%', padding: '16px', borderRadius: 12, border: 'none', fontSize: 15, fontWeight: 700,
                  background: 'linear-gradient(135deg, #10b981, #3b82f6)', color: 'white', cursor: 'pointer',
                }}>
                Verify Document
              </button>
            )}
          </div>
        )}

        {/* Step: Processing */}
        {step === 'processing' && (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <div style={{
              width: 48, height: 48, border: '4px solid #1e293b', borderTopColor: '#10b981',
              borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 20px',
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            <h3 style={{ fontSize: 16, marginBottom: 8 }}>Verifying document...</h3>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              <div style={{ marginBottom: 4 }}>DINOv2 pixel forensics (front + back)</div>
              <div style={{ marginBottom: 4 }}>MRZ parsing + check digit validation</div>
              <div>Cross-validation front vs back</div>
            </div>
          </div>
        )}

        {/* Step: Result */}
        {step === 'result' && error && (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>❌</div>
            <h3 style={{ color: '#ef4444', marginBottom: 8 }}>Verification Failed</h3>
            <p style={{ fontSize: 13, color: '#94a3b8' }}>{error}</p>
            <button onClick={reset} style={{ marginTop: 16, padding: '10px 24px', borderRadius: 8, border: '1px solid #1e293b', background: '#111827', color: '#e2e8f0', cursor: 'pointer' }}>
              Try Again
            </button>
          </div>
        )}

        {step === 'result' && result && (
          <div>
            {/* Verdict */}
            <div style={{ textAlign: 'center', marginBottom: 24, padding: 20, background: '#111827', borderRadius: 12, border: `2px solid ${verdictColor(result.verdict)}` }}>
              <div style={{ fontSize: 32, fontWeight: 800, color: verdictColor(result.verdict) }}>
                {result.verdict.toUpperCase().replace('_', ' ')}
              </div>
              <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 4 }}>
                Confidence: {(result.confidence * 100).toFixed(1)}%
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                {result.processing_ms}ms | On-Premise
              </div>
            </div>

            {/* Front + Back Previews */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Front</div>
                {frontPreview && <img src={frontPreview} alt="front" style={{ width: '100%', borderRadius: 8 }} />}
                <div style={{ fontSize: 11, color: result.front?.forensics?.verdict === 'authentic' ? '#10b981' : '#f59e0b', marginTop: 4 }}>
                  {((result.front?.forensics?.p_tampered || 0) * 100).toFixed(1)}% pixel
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Back</div>
                {backPreview && <img src={backPreview} alt="back" style={{ width: '100%', borderRadius: 8 }} />}
                <div style={{ fontSize: 11, color: result.back?.forensics?.verdict === 'authentic' ? '#10b981' : '#f59e0b', marginTop: 4 }}>
                  {((result.back?.forensics?.p_tampered || 0) * 100).toFixed(1)}% pixel
                </div>
              </div>
            </div>

            {/* Fields */}
            {(Object.keys(result.front?.fields || {}).length > 0 || Object.keys(result.back?.fields || {}).length > 0) && (
              <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 14, marginBottom: 16 }}>
                <h3 style={{ fontSize: 12, marginBottom: 10 }}>Extracted Fields</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 12 }}>
                  {Object.entries({...result.front?.fields, ...result.back?.fields}).filter(([,v]) => v).map(([k, v]) => (
                    <div key={k} style={{ display: 'contents' }}>
                      <div style={{ color: '#64748b', textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</div>
                      <div style={{ fontWeight: 500 }}>{String(v)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Cross Validation */}
            {result.cross_validation && (
              <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 14, marginBottom: 16 }}>
                <h3 style={{ fontSize: 12, marginBottom: 10 }}>Cross-Validation</h3>
                {result.cross_validation.dni_check?.map((issue: string, i: number) => (
                  <div key={i} style={{ fontSize: 12, color: issue.includes('valid') ? '#10b981' : '#ef4444', marginBottom: 4 }}>
                    {issue.includes('CRITICAL') ? '🚨' : issue.includes('valid') ? '✅' : '⚠️'} {issue}
                  </div>
                ))}
                {result.cross_validation.issues?.filter((i: string) => !result.cross_validation.dni_check?.includes(i)).map((issue: string, i: number) => (
                  <div key={`i${i}`} style={{ fontSize: 12, color: issue.includes('CRITICAL') ? '#ef4444' : '#f59e0b', marginBottom: 4 }}>
                    {issue.includes('CRITICAL') ? '🚨' : '⚠️'} {issue}
                  </div>
                ))}
                {(!result.cross_validation.issues || result.cross_validation.issues.length === 0) && (
                  <div style={{ fontSize: 12, color: '#10b981' }}>✅ No issues found</div>
                )}
              </div>
            )}

            {/* MRZ */}
            {result.back?.mrz && (
              <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 14, marginBottom: 16 }}>
                <h3 style={{ fontSize: 12, marginBottom: 10 }}>MRZ Data</h3>
                <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#94a3b8' }}>
                  {result.back.mrz.mrz_lines?.map((line: string, i: number) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
                <div style={{ fontSize: 11, marginTop: 8, color: result.back.mrz.check_digits_valid ? '#10b981' : '#ef4444' }}>
                  Check digits: {result.back.mrz.check_digits_valid ? '✅ Valid' : '❌ Invalid'}
                </div>
              </div>
            )}

            {/* Raw JSON */}
            <details style={{ marginTop: 16 }}>
              <summary style={{ fontSize: 12, color: '#64748b', cursor: 'pointer' }}>Raw JSON</summary>
              <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 8, padding: 12, fontSize: 10, fontFamily: 'monospace', maxHeight: 300, overflowY: 'auto', whiteSpace: 'pre-wrap', marginTop: 8 }}>
                {JSON.stringify(result, null, 2)}
              </div>
            </details>

            <button onClick={reset} style={{
              width: '100%', marginTop: 20, padding: '14px', borderRadius: 10, border: 'none',
              background: '#1e293b', color: '#e2e8f0', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}>
              Verify Another Document
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
