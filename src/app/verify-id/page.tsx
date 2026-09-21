'use client'

import { useState, useRef } from 'react'

type DocMode = 'identity' | 'document'
type Step = 'select' | 'front' | 'back' | 'upload_pdf' | 'processing' | 'result'

export default function VerifyId() {
  const [mode, setMode] = useState<DocMode | null>(null)
  const [step, setStep] = useState<Step>('select')
  const [frontFile, setFrontFile] = useState<File | null>(null)
  const [backFile, setBackFile] = useState<File | null>(null)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [frontPreview, setFrontPreview] = useState<string | null>(null)
  const [backPreview, setBackPreview] = useState<string | null>(null)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const frontRef = useRef<HTMLInputElement>(null)
  const backRef = useRef<HTMLInputElement>(null)
  const pdfRef = useRef<HTMLInputElement>(null)

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
    setStep('processing')
    setProcessing(true)
    setError(null)

    try {
      if (mode === 'identity' && frontFile && backFile) {
        const form = new FormData()
        form.append('front', frontFile)
        form.append('back', backFile)
        const res = await fetch('/api/verify-identity', { method: 'POST', body: form })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setResult(await res.json())
      } else if (mode === 'document' && pdfFile) {
        const form = new FormData()
        form.append('image', pdfFile)
        form.append('backend', 'xeon')
        const res = await fetch('/api/verify-proxy', { method: 'POST', body: form })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setResult(await res.json())
      }
      setStep('result')
    } catch (e: any) {
      setError(e.message)
      setStep('result')
    } finally {
      setProcessing(false)
    }
  }

  const reset = () => {
    setStep('select')
    setMode(null)
    setFrontFile(null)
    setBackFile(null)
    setPdfFile(null)
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

        {/* Step: Select Document Type */}
        {step === 'select' && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, textAlign: 'center', marginBottom: 8 }}>What do you want to verify?</h2>
            <p style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', marginBottom: 24 }}>
              Select the type of document to use the right verification method
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button onClick={() => { setMode('identity'); setStep('front') }}
                style={{
                  padding: '20px 16px', borderRadius: 12, border: '2px solid #1e293b', background: '#111827',
                  cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.2s',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 36 }}>🪪</div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#10b981' }}>ID Document (DNI / Passport)</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>Take photos of front + back with your camera</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                      Pixel forensics + MRZ + check digit + cross-validation
                    </div>
                  </div>
                </div>
              </button>
              <button onClick={() => { setMode('document'); setStep('upload_pdf') }}
                style={{
                  padding: '20px 16px', borderRadius: 12, border: '2px solid #1e293b', background: '#111827',
                  cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.2s',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 36 }}>📄</div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#3b82f6' }}>Document (Payslip / Diploma / Certificate)</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>Upload PDF file</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                      PDF structural analysis + QR validation + text extraction
                    </div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Step: Upload PDF */}
        {step === 'upload_pdf' && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, textAlign: 'center', marginBottom: 8 }}>Upload Document</h2>
            <p style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', marginBottom: 20 }}>
              Upload the PDF of your payslip, diploma, or certificate
            </p>
            <div onClick={() => pdfRef.current?.click()}
              style={{
                border: '2px dashed #3b82f6', borderRadius: 12, padding: pdfFile ? 24 : 48, textAlign: 'center',
                cursor: 'pointer', background: '#3b82f608', marginBottom: 16,
              }}>
              {pdfFile ? (
                <div>
                  <div style={{ fontSize: 48, marginBottom: 8 }}>📄</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#3b82f6' }}>{pdfFile.name}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{Math.round(pdfFile.size / 1024)} KB</div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 56, marginBottom: 12 }}>📁</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#3b82f6' }}>Tap to select PDF</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
                    Payslip, diploma, certificate, transcript...
                  </div>
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 8, padding: '6px 12px', background: '#111827', borderRadius: 6, display: 'inline-block' }}>
                    QR codes will be scanned and validated automatically
                  </div>
                </div>
              )}
            </div>
            <input ref={pdfRef} type="file" accept=".pdf,application/pdf" hidden
              onChange={e => { if (e.target.files?.[0]) setPdfFile(e.target.files[0]) }} />

            {pdfFile && (
              <button onClick={verify}
                style={{
                  width: '100%', padding: '16px', borderRadius: 12, border: 'none', fontSize: 15, fontWeight: 700,
                  background: 'linear-gradient(135deg, #3b82f6, #6366f1)', color: 'white', cursor: 'pointer',
                }}>
                Verify Document
              </button>
            )}
          </div>
        )}

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

            {/* QR Codes (PDF documents) */}
            {result.forensics?.qr_codes && result.forensics.qr_codes.length > 0 && (
              <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 14, marginBottom: 16 }}>
                <h3 style={{ fontSize: 12, marginBottom: 10 }}>QR Codes Found</h3>
                {result.forensics.qr_codes.map((qr: any, i: number) => (
                  <div key={i} style={{ fontSize: 12, marginBottom: 8, padding: 8, background: '#0a0e17', borderRadius: 6 }}>
                    <div style={{ color: '#3b82f6', fontWeight: 600 }}>{qr.type} ({qr.source})</div>
                    <div style={{ color: '#94a3b8', marginTop: 2, wordBreak: 'break-all', fontSize: 11 }}>{qr.data}</div>
                  </div>
                ))}
                {result.forensics.qr_validation && (
                  <div style={{ marginTop: 8 }}>
                    {result.forensics.qr_validation.validations?.map((v: string, i: number) => (
                      <div key={i} style={{ fontSize: 11, color: '#10b981', marginBottom: 2 }}>✅ {v}</div>
                    ))}
                    {result.forensics.qr_validation.issues?.map((v: string, i: number) => (
                      <div key={i} style={{ fontSize: 11, color: '#ef4444', marginBottom: 2 }}>🚨 {v}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* PDF Structural (PDF documents) */}
            {result.forensics?.pdf_structural && (
              <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 14, marginBottom: 16 }}>
                <h3 style={{ fontSize: 12, marginBottom: 10 }}>PDF Structure</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 12 }}>
                  <div style={{ color: '#64748b' }}>Producer</div><div>{result.forensics.pdf_structural.producer || 'Unknown'}</div>
                  <div style={{ color: '#64748b' }}>Creator</div><div>{result.forensics.pdf_structural.creator || 'Unknown'}</div>
                  <div style={{ color: '#64748b' }}>Pages</div><div>{result.forensics.pdf_structural.pages}</div>
                  <div style={{ color: '#64748b' }}>Native text</div><div>{result.forensics.pdf_structural.has_native_text ? '✅ Yes' : '❌ No (scanned)'}</div>
                  <div style={{ color: '#64748b' }}>Fonts</div><div>{result.forensics.pdf_structural.fonts_count}</div>
                  <div style={{ color: '#64748b' }}>Annotations</div><div>{result.forensics.pdf_structural.has_annotations ? '⚠️ Yes' : '✅ None'}</div>
                  <div style={{ color: '#64748b' }}>Layers</div><div>{result.forensics.pdf_structural.has_layers ? '⚠️ Yes' : '✅ None'}</div>
                </div>
                {result.forensics.pdf_structural.risk_indicators?.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    {result.forensics.pdf_structural.risk_indicators.map((r: string, i: number) => (
                      <div key={i} style={{ fontSize: 11, color: r.includes('positive') ? '#10b981' : '#f59e0b', marginBottom: 2 }}>
                        {r.includes('positive') ? '✅' : '⚠️'} {r}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Extracted Text (PDF) */}
            {result.forensics?.text_extracted && (
              <details style={{ marginBottom: 16 }}>
                <summary style={{ fontSize: 12, color: '#64748b', cursor: 'pointer' }}>Extracted Text</summary>
                <div style={{ background: '#0a0e17', border: '1px solid #1e293b', borderRadius: 8, padding: 12, fontSize: 11, fontFamily: 'monospace', maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap', marginTop: 8 }}>
                  {result.forensics.text_extracted}
                </div>
              </details>
            )}

            {/* Analysis from /analyze/document (PDF mode) */}
            {result.analysis?.ocr_text && (
              <details style={{ marginBottom: 16 }}>
                <summary style={{ fontSize: 12, color: '#64748b', cursor: 'pointer' }}>AI Analysis (OCR)</summary>
                <div style={{ background: '#0a0e17', border: '1px solid #1e293b', borderRadius: 8, padding: 12, fontSize: 11, maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap', marginTop: 8 }}>
                  {result.analysis.ocr_text}
                </div>
              </details>
            )}
            {result.analysis?.explanation && (
              <div style={{ background: '#111827', border: '1px solid #8b5cf630', borderRadius: 10, borderLeft: '3px solid #8b5cf6', padding: 14, marginBottom: 16 }}>
                <h3 style={{ fontSize: 12, marginBottom: 8 }}>AI Explanation</h3>
                <div style={{ fontSize: 12, lineHeight: 1.6, color: '#94a3b8' }}>{result.analysis.explanation}</div>
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
