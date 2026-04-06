'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'

// ── Constants ────────────────────────────────────────────────────────────────

const MODEL_PATH = '/models/deepfake/deepfake_pixel_v1.onnx'
const IMAGENET_MEAN = [0.485, 0.456, 0.406]
const IMAGENET_STD  = [0.229, 0.224, 0.225]
const TARGET_SIZE   = 224
const ELA_QUALITY   = 0.75  // JPEG quality for ELA recompression

// ── Global model cache ──────────────────────────────────────────────────────

let cachedModelBuffer: ArrayBuffer | null = null

// ── Helpers ──────────────────────────────────────────────────────────────────

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

function preprocessImage(img: HTMLImageElement): Float32Array {
  const canvas = document.createElement('canvas')
  canvas.width = TARGET_SIZE
  canvas.height = TARGET_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, TARGET_SIZE, TARGET_SIZE)
  const pixels = ctx.getImageData(0, 0, TARGET_SIZE, TARGET_SIZE).data

  const tensor = new Float32Array(3 * TARGET_SIZE * TARGET_SIZE)
  const numPixels = TARGET_SIZE * TARGET_SIZE
  for (let i = 0; i < numPixels; i++) {
    const r = pixels[i * 4] / 255
    const g = pixels[i * 4 + 1] / 255
    const b = pixels[i * 4 + 2] / 255
    tensor[i]                  = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0]
    tensor[numPixels + i]      = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1]
    tensor[2 * numPixels + i]  = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2]
  }
  return tensor
}

/** Async ELA using real JPEG round-trip */
async function computeELAAsync(img: HTMLImageElement): Promise<{ elaDataUrl: string; elaScore: number }> {
  const w = Math.min(img.naturalWidth, 800)
  const h = Math.round((img.naturalHeight / img.naturalWidth) * w)

  // Draw original
  const origCanvas = document.createElement('canvas')
  origCanvas.width = w
  origCanvas.height = h
  const origCtx = origCanvas.getContext('2d', { willReadFrequently: true })!
  origCtx.drawImage(img, 0, 0, w, h)
  const origPixels = origCtx.getImageData(0, 0, w, h).data

  // Recompress as JPEG
  const jpegBlob = await new Promise<Blob>((resolve) => {
    origCanvas.toBlob((blob) => resolve(blob!), 'image/jpeg', ELA_QUALITY)
  })

  // Reload the JPEG to get recompressed pixels
  const jpegUrl = URL.createObjectURL(jpegBlob)
  const recompImg = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('Failed to load recompressed image'))
    el.src = jpegUrl
  })
  URL.revokeObjectURL(jpegUrl)

  const recompCanvas = document.createElement('canvas')
  recompCanvas.width = w
  recompCanvas.height = h
  const recompCtx = recompCanvas.getContext('2d', { willReadFrequently: true })!
  recompCtx.drawImage(recompImg, 0, 0, w, h)
  const recompPixels = recompCtx.getImageData(0, 0, w, h).data

  // Compute pixel-by-pixel difference x10
  const elaCanvas = document.createElement('canvas')
  elaCanvas.width = w
  elaCanvas.height = h
  const elaCtx = elaCanvas.getContext('2d', { willReadFrequently: true })!
  const elaImageData = elaCtx.createImageData(w, h)
  const elaPixelData = elaImageData.data

  let totalDiff = 0
  for (let i = 0; i < origPixels.length; i += 4) {
    const dr = Math.abs(origPixels[i] - recompPixels[i]) * 10
    const dg = Math.abs(origPixels[i + 1] - recompPixels[i + 1]) * 10
    const db = Math.abs(origPixels[i + 2] - recompPixels[i + 2]) * 10

    elaPixelData[i]     = Math.min(255, dr)
    elaPixelData[i + 1] = Math.min(255, dg)
    elaPixelData[i + 2] = Math.min(255, db)
    elaPixelData[i + 3] = 255

    totalDiff += dr + dg + db
  }

  elaCtx.putImageData(elaImageData, 0, 0)

  const avgDiff = totalDiff / (w * h * 3)
  const elaScore = Math.min(100, Math.round(avgDiff * 2))

  return { elaDataUrl: elaCanvas.toDataURL('image/png'), elaScore }
}

function getDocVerdict(score: number): { text: string; emoji: string; color: string } {
  if (score <= 25) return { text: 'Authentic', emoji: '\u2705', color: '#00ff9d' }
  if (score <= 60) return { text: 'Possibly Modified', emoji: '\u26A0\uFE0F', color: '#ffd700' }
  return { text: 'Likely Tampered', emoji: '\uD83D\uDEAB', color: '#ff4d4d' }
}

// ── Colors ───────────────────────────────────────────────────────────────────

const colors = {
  bg: '#0a0a0c',
  surface: '#121216',
  primary: '#00ff9d',
  primaryGlow: 'rgba(0, 255, 157, 0.4)',
  text: '#ffffff',
  muted: '#a1a1aa',
  border: '#27272a',
  dimText: '#71717a',
}

// ── Types ────────────────────────────────────────────────────────────────────

type Phase = 'hero' | 'loading' | 'analyzing' | 'result'

interface ResultData {
  tamperingScore: number
  elaScore: number
  aiScore: number
  pFake: number
  elaDataUrl: string
  inferenceMs: number
}

// ── Component ────────────────────────────────────────────────────────────────

export default function DocSafePage() {
  const [phase, setPhase] = useState<Phase>('hero')
  const [result, setResult] = useState<ResultData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [animatedScore, setAnimatedScore] = useState(0)
  const [loadProgress, setLoadProgress] = useState(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── SEO ───────────────────────────────────────────────────────────────
  useEffect(() => {
    document.title = 'DocSafe — Document Verification | Deep-Check'
    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'description'
      document.head.appendChild(meta)
    }
    meta.content = 'Verify document authenticity with AI. Detect tampered IDs, payslips, contracts using Error Level Analysis and deepfake detection. 100% private.'
  }, [])

  // ── Score animation ───────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'result' || !result) return
    const target = result.tamperingScore
    const duration = 1500
    const startTime = performance.now()
    let raf: number
    const animate = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setAnimatedScore(Math.round(eased * target))
      if (progress < 1) raf = requestAnimationFrame(animate)
    }
    raf = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(raf)
  }, [phase, result])

  // ── Model download with progress ──────────────────────────────────────
  const fetchModelWithProgress = useCallback(async (): Promise<ArrayBuffer> => {
    if (cachedModelBuffer) {
      setLoadProgress(100)
      return cachedModelBuffer
    }
    const response = await fetch(MODEL_PATH)
    if (!response.ok) throw new Error(`Model download failed (HTTP ${response.status})`)
    const contentLength = response.headers.get('content-length')
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 70_000_000
    const reader = response.body?.getReader()
    if (!reader) {
      const buf = await response.arrayBuffer()
      cachedModelBuffer = buf
      setLoadProgress(100)
      return buf
    }
    const chunks: Uint8Array[] = []
    let receivedBytes = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      receivedBytes += value.length
      setLoadProgress(Math.min(Math.round((receivedBytes / totalBytes) * 100), 99))
    }
    const merged = new Uint8Array(receivedBytes)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    cachedModelBuffer = merged.buffer
    setLoadProgress(100)
    return cachedModelBuffer
  }, [])

  // ── Analyze document ──────────────────────────────────────────────────
  const analyzeDocument = useCallback(async (dataUrl: string) => {
    setPhase('loading')
    setLoadProgress(0)
    setError(null)

    try {
      // Load image
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('Failed to load image'))
        el.src = dataUrl
      })

      // Download model
      let modelBuffer: ArrayBuffer
      try {
        modelBuffer = await fetchModelWithProgress()
      } catch {
        throw new Error('Failed to download AI model. Check your internet connection.')
      }

      setPhase('analyzing')
      const t0 = performance.now()

      // 1. ELA Analysis
      const { elaDataUrl, elaScore } = await computeELAAsync(img)

      // 2. AI Detection via ONNX
      const tensorData = preprocessImage(img)
      const ort = await import('onnxruntime-web')
      ort.env.wasm.wasmPaths = '/'
      ort.env.wasm.numThreads = 1

      const session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      })

      const input = new ort.Tensor('float32', tensorData, [1, 3, TARGET_SIZE, TARGET_SIZE])
      const inputName = session.inputNames[0]
      const outputName = session.outputNames[0]
      const feeds: Record<string, import('onnxruntime-web').Tensor> = { [inputName]: input }
      const output = await session.run(feeds)
      const logit = (output[outputName].data as Float32Array)[0]
      const pFake = sigmoid(logit)
      // Calibrate: documents are scanned/photographed, not AI faces
      const calibratedFake = 1 / (1 + Math.exp(10 * (pFake - 0.78)))
      const aiScore = Math.max(1, Math.min(99, Math.round((1 - calibratedFake) * 100)))

      // Combined tampering score (weighted average of ELA and AI)
      const tamperingScore = Math.round(elaScore * 0.4 + aiScore * 0.6)
      const inferenceMs = Math.round(performance.now() - t0)

      setResult({ tamperingScore, elaScore, aiScore, pFake, elaDataUrl, inferenceMs })
      setPhase('result')
    } catch (err) {
      console.error('[DocSafe] Analysis error:', err)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setError(`Analysis failed: ${msg}`)
      setPhase('hero')
    }
  }, [fetchModelWithProgress])

  // ── File handling ─────────────────────────────────────────────────────
  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file (JPEG, PNG, WebP)')
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      setError('Image must be under 15MB')
      return
    }
    setError(null)
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setPreviewUrl(dataUrl)
      analyzeDocument(dataUrl)
    }
    reader.readAsDataURL(file)
  }, [analyzeDocument])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile()
        if (file) handleFile(file)
        break
      }
    }
  }, [handleFile])

  const resetTest = useCallback(() => {
    setResult(null)
    setAnimatedScore(0)
    setError(null)
    setPreviewUrl(null)
    setPhase('hero')
  }, [])

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div
      onPaste={handlePaste}
      style={{
        minHeight: '100vh', background: colors.bg, color: colors.text,
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}
    >
      <style>{`
        @keyframes gradient-shift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 20px rgba(0, 255, 157, 0.3); }
          50% { box-shadow: 0 0 40px rgba(0, 255, 157, 0.6); }
        }
        @keyframes pulse-score {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.03); }
        }
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .docsafe-gradient-text {
          background: linear-gradient(135deg, #00ff9d, #00e5ff, #7000ff);
          background-size: 300% 300%;
          animation: gradient-shift 4s ease infinite;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .docsafe-cta {
          background: #00ff9d;
          color: #000;
          border: none;
          padding: 16px 40px;
          border-radius: 12px;
          font-size: 1.2rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.25s ease;
          animation: pulse-glow 2s ease infinite;
        }
        .docsafe-cta:hover {
          transform: translateY(-2px) scale(1.02);
          box-shadow: 0 0 50px rgba(0, 255, 157, 0.5);
        }
        .docsafe-fade-in { animation: fade-in-up 0.6s ease both; }
        .docsafe-fade-in-delay { animation: fade-in-up 0.6s ease 0.2s both; }
        .docsafe-fade-in-delay2 { animation: fade-in-up 0.6s ease 0.4s both; }
      `}</style>

      {/* Nav */}
      <nav style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '1rem 1.5rem', borderBottom: `1px solid ${colors.border}`,
        maxWidth: 800, margin: '0 auto',
      }}>
        <Link href="/" style={{ textDecoration: 'none', fontSize: '1.15rem', fontWeight: 800, color: '#fff' }}>
          Deep-Check<span style={{ color: colors.primary }}>.</span>
        </Link>
        {phase !== 'hero' && (
          <button onClick={resetTest} style={{
            background: 'transparent', border: `1px solid ${colors.border}`,
            color: colors.muted, padding: '0.4rem 1rem', borderRadius: 8,
            fontSize: '0.85rem', cursor: 'pointer',
          }}>
            Start over
          </button>
        )}
      </nav>

      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFile(file) }}
      />

      {/* ── HERO ─────────────────────────────────────────────────────── */}
      {phase === 'hero' && (
        <section style={{
          minHeight: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center',
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute', top: '-15%', left: '15%', width: '400px', height: '400px',
            background: 'radial-gradient(circle, rgba(0,255,157,0.12) 0%, transparent 70%)',
            borderRadius: '50%', pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', bottom: '5%', right: '10%', width: '350px', height: '350px',
            background: 'radial-gradient(circle, rgba(112,0,255,0.1) 0%, transparent 70%)',
            borderRadius: '50%', pointerEvents: 'none',
          }} />

          <div className="docsafe-fade-in" style={{ position: 'relative', zIndex: 1 }}>
            <div style={{
              display: 'inline-block', padding: '6px 16px', borderRadius: '999px',
              border: '1px solid rgba(0,255,157,0.25)', background: 'rgba(0,255,157,0.06)',
              fontSize: '0.85rem', color: '#00ff9d', marginBottom: '24px',
            }}>
              Powered by Deep-Check AI
            </div>
          </div>

          <h1 className="docsafe-fade-in" style={{
            fontSize: 'clamp(2.8rem, 8vw, 5.5rem)', fontWeight: 800,
            lineHeight: 1.05, marginBottom: '20px', position: 'relative', zIndex: 1,
          }}>
            <span className="docsafe-gradient-text">DocSafe</span>
          </h1>

          <p className="docsafe-fade-in" style={{
            fontSize: 'clamp(1.2rem, 3vw, 1.6rem)', fontWeight: 700,
            marginBottom: '12px', position: 'relative', zIndex: 1,
          }}>
            Is This Document Real?
          </p>

          <p className="docsafe-fade-in-delay" style={{
            fontSize: 'clamp(1rem, 2.5vw, 1.15rem)', color: colors.muted,
            maxWidth: '540px', lineHeight: 1.6, marginBottom: '32px', position: 'relative', zIndex: 1,
          }}>
            Upload a document photo (ID, payslip, contract, bank statement) and we&apos;ll detect
            tampering using Error Level Analysis and AI detection. Zero data leaves your browser.
          </p>

          {/* Upload zone */}
          <div
            className="docsafe-fade-in-delay"
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: '100%', maxWidth: '420px', padding: '48px 24px',
              border: `2px dashed ${isDragging ? colors.primary : colors.border}`,
              borderRadius: '16px', cursor: 'pointer', textAlign: 'center',
              background: isDragging ? 'rgba(0,255,157,0.04)' : 'rgba(255,255,255,0.02)',
              transition: 'all 0.2s ease', position: 'relative', zIndex: 1,
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '12px' }}>{'\uD83D\uDCC4'}</div>
            <p style={{ fontWeight: 600, marginBottom: '8px' }}>
              Drop a document photo here
            </p>
            <p style={{ color: colors.muted, fontSize: '0.85rem' }}>
              or click to browse &middot; paste from clipboard
            </p>
          </div>

          {error && (
            <p style={{ marginTop: '24px', color: '#ff4d4d', fontSize: '0.9rem', maxWidth: '400px', position: 'relative', zIndex: 1 }}>
              {error}
            </p>
          )}

          {/* Use cases */}
          <div className="docsafe-fade-in-delay2" style={{
            marginTop: '48px', maxWidth: '560px', width: '100%',
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px',
            position: 'relative', zIndex: 1,
          }}>
            {[
              { icon: '\uD83C\uDFE0', label: 'Landlords' },
              { icon: '\uD83D\uDCBC', label: 'HR Departments' },
              { icon: '\uD83D\uDCBB', label: 'Freelance Platforms' },
              { icon: '\uD83C\uDFE6', label: 'Financial Services' },
            ].map((uc) => (
              <div key={uc.label} style={{
                background: colors.surface, border: `1px solid ${colors.border}`,
                borderRadius: '12px', padding: '16px', textAlign: 'center',
              }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '4px' }}>{uc.icon}</div>
                <div style={{ fontSize: '0.85rem', color: colors.muted }}>{uc.label}</div>
              </div>
            ))}
          </div>

          {/* Two analysis explainer */}
          <div className="docsafe-fade-in-delay2" style={{
            marginTop: '32px', maxWidth: '560px', width: '100%',
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px',
            position: 'relative', zIndex: 1,
          }}>
            <div style={{
              background: colors.surface, border: `1px solid ${colors.border}`,
              borderRadius: '16px', padding: '20px', textAlign: 'left',
            }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>{'\uD83D\uDD2C'}</div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '8px', color: colors.primary }}>ELA Analysis</h3>
              <p style={{ fontSize: '0.85rem', color: colors.muted, lineHeight: 1.5 }}>
                Re-compresses the image as JPEG and computes pixel-level differences.
                Edited regions show up as bright spots.
              </p>
            </div>
            <div style={{
              background: colors.surface, border: `1px solid ${colors.border}`,
              borderRadius: '16px', padding: '20px', textAlign: 'left',
            }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>{'\uD83E\uDD16'}</div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '8px', color: colors.primary }}>AI Detection</h3>
              <p style={{ fontSize: '0.85rem', color: colors.muted, lineHeight: 1.5 }}>
                Runs the document through our 18.6M-parameter neural network to detect
                AI-generated content.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* ── LOADING ──────────────────────────────────────────────────── */}
      {phase === 'loading' && (
        <section style={{
          minHeight: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center',
        }}>
          {previewUrl && (
            <img src={previewUrl} alt="Uploaded" style={{
              width: '160px', height: '160px', objectFit: 'cover',
              borderRadius: '16px', border: `2px solid ${colors.border}`, marginBottom: '24px', opacity: 0.7,
            }} />
          )}
          <h2 className="docsafe-fade-in" style={{ fontSize: 'clamp(1.5rem, 4vw, 2.2rem)', fontWeight: 700, marginBottom: '8px' }}>
            Loading AI Model...
          </h2>
          <p style={{ color: colors.muted, fontSize: '0.95rem', marginBottom: '32px' }}>
            Downloading 70MB neural network to your browser
          </p>
          <div style={{
            width: '100%', maxWidth: '400px', height: '8px', borderRadius: '4px',
            background: 'rgba(255,255,255,0.1)', overflow: 'hidden', marginBottom: '16px',
          }}>
            <div style={{
              width: `${loadProgress}%`, height: '100%', borderRadius: '4px',
              background: 'linear-gradient(90deg, #00ff9d, #00cc7d)',
              transition: 'width 0.3s ease', boxShadow: '0 0 10px rgba(0,255,157,0.4)',
            }} />
          </div>
          <p style={{ color: colors.primary, fontSize: '1.1rem', fontWeight: 600 }}>{loadProgress}%</p>
          <p style={{ color: '#52525b', fontSize: '0.8rem', marginTop: '16px' }}>First time only — cached for future scans</p>
        </section>
      )}

      {/* ── ANALYZING ────────────────────────────────────────────────── */}
      {phase === 'analyzing' && (
        <section style={{
          minHeight: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center',
        }}>
          {previewUrl && (
            <div style={{ position: 'relative', marginBottom: '24px' }}>
              <img src={previewUrl} alt="Analyzing" style={{
                width: '200px', height: '200px', objectFit: 'cover',
                borderRadius: '16px', border: `2px solid ${colors.primary}`, filter: 'brightness(0.7)',
              }} />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{
                  width: '48px', height: '48px', border: '3px solid rgba(0,255,157,0.3)',
                  borderTopColor: '#00ff9d', borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                }} />
              </div>
            </div>
          )}
          <h2 className="docsafe-fade-in" style={{ fontSize: 'clamp(1.5rem, 4vw, 2.2rem)', fontWeight: 700, marginBottom: '8px' }}>
            Analyzing Document...
          </h2>
          <p style={{ color: colors.muted, fontSize: '0.95rem' }}>
            Running ELA + AI detection in your browser
          </p>
        </section>
      )}

      {/* ── RESULT ───────────────────────────────────────────────────── */}
      {phase === 'result' && result && (
        <section style={{
          minHeight: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', padding: '24px 24px 64px', textAlign: 'center',
        }}>
          {/* Score circle */}
          <div className="docsafe-fade-in" style={{ position: 'relative', width: '200px', height: '200px', marginBottom: '24px', marginTop: '24px' }}>
            <svg viewBox="0 0 200 200" style={{ width: '100%', height: '100%', animation: 'pulse-score 2s ease infinite' }}>
              <circle cx="100" cy="100" r="88" fill="none" stroke="#27272a" strokeWidth="8" />
              <circle cx="100" cy="100" r="88" fill="none"
                stroke={getDocVerdict(result.tamperingScore).color}
                strokeWidth="8" strokeLinecap="round"
                strokeDasharray={`${(animatedScore / 100) * 2 * Math.PI * 88} ${2 * Math.PI * 88}`}
                transform="rotate(-90 100 100)"
                style={{ transition: 'stroke-dasharray 0.1s linear', filter: `drop-shadow(0 0 8px ${getDocVerdict(result.tamperingScore).color}60)` }}
              />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '3.5rem', fontWeight: 800, color: getDocVerdict(result.tamperingScore).color, lineHeight: 1 }}>
                {animatedScore}
              </span>
              <span style={{ fontSize: '0.85rem', color: colors.dimText, marginTop: '4px' }}>Tampering Score</span>
            </div>
          </div>

          {/* Verdict */}
          <div className="docsafe-fade-in-delay">
            <h2 style={{
              fontSize: 'clamp(1.5rem, 4vw, 2.2rem)', fontWeight: 700, marginBottom: '8px',
              color: getDocVerdict(result.tamperingScore).color,
            }}>
              {getDocVerdict(result.tamperingScore).emoji} {getDocVerdict(result.tamperingScore).text}
            </h2>
          </div>

          {/* Side-by-side: Original vs ELA */}
          <div className="docsafe-fade-in-delay" style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px',
            maxWidth: '560px', width: '100%', marginTop: '24px', marginBottom: '24px',
          }}>
            <div>
              <p style={{ fontSize: '0.8rem', color: colors.muted, marginBottom: '8px' }}>Original</p>
              {previewUrl && (
                <img src={previewUrl} alt="Original" style={{
                  width: '100%', borderRadius: '12px', border: `1px solid ${colors.border}`,
                }} />
              )}
            </div>
            <div>
              <p style={{ fontSize: '0.8rem', color: colors.muted, marginBottom: '8px' }}>ELA Heatmap</p>
              <img src={result.elaDataUrl} alt="ELA Heatmap" style={{
                width: '100%', borderRadius: '12px', border: `1px solid ${colors.border}`,
              }} />
            </div>
          </div>

          {/* Stats cards */}
          <div className="docsafe-fade-in-delay" style={{
            display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center',
            marginBottom: '36px', maxWidth: '560px',
          }}>
            {[
              { label: 'ELA Score', value: `${result.elaScore}/100` },
              { label: 'AI Generation Score', value: `${result.aiScore}/100` },
              { label: 'Combined Tampering', value: `${result.tamperingScore}/100` },
              { label: 'Inference Time', value: `${result.inferenceMs}ms` },
            ].map((stat) => (
              <div key={stat.label} style={{
                flex: '1 1 120px', background: colors.surface, border: `1px solid ${colors.border}`,
                borderRadius: '12px', padding: '14px', minWidth: '120px',
              }}>
                <div style={{ fontSize: '0.7rem', color: colors.dimText, marginBottom: '6px' }}>{stat.label}</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{stat.value}</div>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className="docsafe-fade-in-delay2" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="docsafe-cta" onClick={resetTest}>Check Another Document &rarr;</button>
          </div>

          <p style={{ marginTop: '48px', color: '#52525b', fontSize: '0.8rem' }}>
            Powered by{' '}
            <Link href="/" style={{ color: colors.primary, textDecoration: 'none' }}>Deep-Check</Link>
            {' '}&mdash; 100% private, no data leaves your browser
          </p>
        </section>
      )}
    </div>
  )
}
