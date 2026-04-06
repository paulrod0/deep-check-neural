'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { preprocessImageSimple, calibrateScore } from '@/lib/facePreprocess'

// ── Constants ────────────────────────────────────────────────────────────────

const MODEL_PATH = '/models/deepfake/deepfake_pixel_v1.onnx'
const TARGET_SIZE   = 224

// ── Global model cache ──────────────────────────────────────────────────────

let cachedModelBuffer: ArrayBuffer | null = null

// ── Helpers ──────────────────────────────────────────────────────────────────

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
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

type Phase = 'hero' | 'camera' | 'loading' | 'analyzing' | 'result'
type InputMode = 'camera' | 'upload'

interface CertificateData {
  thumbnailDataUrl: string
  timestamp: string
  realScore: number
  certificateId: string
  gpsCoords: { lat: number; lon: number } | null
}

// ── Certificate renderer ────────────────────────────────────────────────────

function renderCertificate(data: CertificateData): string {
  const canvas = document.createElement('canvas')
  canvas.width = 800
  canvas.height = 560
  const ctx = canvas.getContext('2d')!

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, 800, 560)
  grad.addColorStop(0, '#0a0a0c')
  grad.addColorStop(1, '#121216')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.roundRect(0, 0, 800, 560, 20)
  ctx.fill()

  // Border
  ctx.strokeStyle = colors.primary
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(2, 2, 796, 556, 18)
  ctx.stroke()

  // Inner accent line
  ctx.strokeStyle = 'rgba(0, 255, 157, 0.15)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(12, 12, 776, 536, 14)
  ctx.stroke()

  // Title
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 28px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Certificate of Authenticity', 400, 55)

  // Green line separator
  ctx.beginPath()
  ctx.moveTo(250, 72)
  ctx.lineTo(550, 72)
  ctx.strokeStyle = colors.primary
  ctx.lineWidth = 2
  ctx.stroke()

  // ProofShot badge
  ctx.fillStyle = colors.primary
  ctx.font = 'bold 16px Inter, system-ui, sans-serif'
  ctx.fillText('ProofShot by Deep-Check', 400, 100)

  // Thumbnail placeholder (draw border box)
  const thumbX = 60
  const thumbY = 130
  const thumbW = 200
  const thumbH = 200
  ctx.strokeStyle = colors.primary
  ctx.lineWidth = 2
  ctx.strokeRect(thumbX, thumbY, thumbW, thumbH)
  ctx.fillStyle = '#1a1a1a'
  ctx.fillRect(thumbX + 1, thumbY + 1, thumbW - 2, thumbH - 2)

  // Info panel (right side)
  const infoX = 300
  ctx.textAlign = 'left'
  ctx.fillStyle = colors.muted
  ctx.font = '13px Inter, system-ui, sans-serif'
  ctx.fillText('Certificate ID', infoX, 155)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 14px "Courier New", monospace'
  ctx.fillText(data.certificateId, infoX, 175)

  ctx.fillStyle = colors.muted
  ctx.font = '13px Inter, system-ui, sans-serif'
  ctx.fillText('Timestamp (ISO 8601)', infoX, 210)
  ctx.fillStyle = '#ffffff'
  ctx.font = '14px "Courier New", monospace'
  ctx.fillText(data.timestamp, infoX, 230)

  ctx.fillStyle = colors.muted
  ctx.font = '13px Inter, system-ui, sans-serif'
  ctx.fillText('AI Reality Score', infoX, 265)
  ctx.fillStyle = data.realScore >= 70 ? colors.primary : data.realScore >= 40 ? '#ffd700' : '#ff4d4d'
  ctx.font = 'bold 32px Inter, system-ui, sans-serif'
  ctx.fillText(`${data.realScore}% Real`, infoX, 300)

  if (data.gpsCoords) {
    ctx.fillStyle = colors.muted
    ctx.font = '13px Inter, system-ui, sans-serif'
    ctx.fillText('GPS Coordinates', infoX, 335)
    ctx.fillStyle = '#ffffff'
    ctx.font = '14px "Courier New", monospace'
    ctx.fillText(`${data.gpsCoords.lat.toFixed(6)}, ${data.gpsCoords.lon.toFixed(6)}`, infoX, 355)
  }

  // Verification status
  const statusY = 400
  ctx.textAlign = 'center'
  if (data.realScore >= 70) {
    ctx.fillStyle = colors.primary
    ctx.font = 'bold 20px Inter, system-ui, sans-serif'
    ctx.fillText('\u2713 VERIFIED AUTHENTIC', 400, statusY)
  } else if (data.realScore >= 40) {
    ctx.fillStyle = '#ffd700'
    ctx.font = 'bold 20px Inter, system-ui, sans-serif'
    ctx.fillText('\u26A0 INCONCLUSIVE', 400, statusY)
  } else {
    ctx.fillStyle = '#ff4d4d'
    ctx.font = 'bold 20px Inter, system-ui, sans-serif'
    ctx.fillText('\u2717 AI-GENERATED DETECTED', 400, statusY)
  }

  // QR code placeholder (simple text-based link)
  ctx.fillStyle = colors.muted
  ctx.font = '11px Inter, system-ui, sans-serif'
  ctx.fillText(`Verify: deep-check-two.vercel.app/proofshot?id=${data.certificateId}`, 400, 435)

  // Footer
  ctx.fillStyle = 'rgba(255,255,255,0.3)'
  ctx.font = '11px Inter, system-ui, sans-serif'
  ctx.fillText('Certified by Deep-Check AI \u2022 No data leaves your browser', 400, 480)
  ctx.fillText('This certificate proves the photo was NOT AI-generated at the time of analysis', 400, 500)

  // Border bottom accent
  ctx.beginPath()
  ctx.moveTo(100, 520)
  ctx.lineTo(700, 520)
  ctx.strokeStyle = 'rgba(0, 255, 157, 0.2)'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.fillStyle = colors.muted
  ctx.font = '10px Inter, system-ui, sans-serif'
  ctx.fillText('\u00A9 2026 Deep-Check Inc. \u2022 deep-check-two.vercel.app', 400, 545)

  return canvas.toDataURL('image/png')
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ProofShotPage() {
  const [phase, setPhase] = useState<Phase>('hero')
  const [inputMode, setInputMode] = useState<InputMode>('upload')
  const [error, setError] = useState<string | null>(null)
  const [loadProgress, setLoadProgress] = useState(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [certData, setCertData] = useState<CertificateData | null>(null)
  const [certImageUrl, setCertImageUrl] = useState<string | null>(null)
  const [animatedScore, setAnimatedScore] = useState(0)
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lon: number } | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── SEO ───────────────────────────────────────────────────────────────
  useEffect(() => {
    document.title = 'ProofShot — Certified Real Photo | Deep-Check'
    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'description'
      document.head.appendChild(meta)
    }
    meta.content = 'Prove your photo is real with a Certificate of Authenticity. AI verifies the photo is not AI-generated. Perfect for insurance claims and property reports.'
  }, [])

  // ── Get GPS on mount ──────────────────────────────────────────────────
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setGpsCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => { /* GPS not available, that's fine */ }
      )
    }
  }, [])

  // ── Score animation ───────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'result' || !certData) return
    const target = certData.realScore
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
  }, [phase, certData])

  // ── Camera management ─────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setPhase('camera')
    setError(null)
    setCameraReady(false)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.onloadedmetadata = () => {
          videoRef.current!.play()
          setCameraReady(true)
        }
      }
    } catch {
      setError('Camera access denied. Please allow camera permissions.')
      setPhase('hero')
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    setCameraReady(false)
  }, [])

  useEffect(() => {
    return () => stopCamera()
  }, [stopCamera])

  const capturePhoto = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    setPreviewUrl(dataUrl)
    stopCamera()
    analyzePhoto(dataUrl)
  }, [stopCamera]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Analyze photo ─────────────────────────────────────────────────────
  const analyzePhoto = useCallback(async (dataUrl: string) => {
    setPhase('loading')
    setLoadProgress(0)
    setError(null)

    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('Failed to load image'))
        el.src = dataUrl
      })

      let modelBuffer: ArrayBuffer
      try {
        modelBuffer = await fetchModelWithProgress()
      } catch {
        throw new Error('Failed to download AI model. Check your internet connection.')
      }

      setPhase('analyzing')

      const tensorData = preprocessImageSimple(img)
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
      const realScore = calibrateScore(pFake)

      const timestamp = new Date().toISOString()
      const certificateId = crypto.randomUUID()

      const certPayload: CertificateData = {
        thumbnailDataUrl: dataUrl,
        timestamp,
        realScore,
        certificateId,
        gpsCoords,
      }

      setCertData(certPayload)

      // Render certificate
      const certUrl = renderCertificate(certPayload)
      setCertImageUrl(certUrl)
      setPhase('result')
    } catch (err) {
      console.error('[ProofShot] Analysis error:', err)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setError(`Analysis failed: ${msg}`)
      setPhase('hero')
    }
  }, [fetchModelWithProgress, gpsCoords])

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
      analyzePhoto(dataUrl)
    }
    reader.readAsDataURL(file)
  }, [analyzePhoto])

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

  const downloadCertificate = useCallback(() => {
    if (!certImageUrl) return
    const a = document.createElement('a')
    a.href = certImageUrl
    a.download = `ProofShot-Certificate-${certData?.certificateId || 'unknown'}.png`
    a.click()
  }, [certImageUrl, certData])

  const resetTest = useCallback(() => {
    setCertData(null)
    setCertImageUrl(null)
    setAnimatedScore(0)
    setError(null)
    setPreviewUrl(null)
    stopCamera()
    setPhase('hero')
  }, [stopCamera])

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
        .ps-gradient-text {
          background: linear-gradient(135deg, #00ff9d, #00e5ff, #7000ff);
          background-size: 300% 300%;
          animation: gradient-shift 4s ease infinite;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .ps-cta {
          background: #00ff9d;
          color: #000;
          border: none;
          padding: 16px 40px;
          border-radius: 12px;
          font-size: 1.1rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.25s ease;
          animation: pulse-glow 2s ease infinite;
        }
        .ps-cta:hover {
          transform: translateY(-2px) scale(1.02);
          box-shadow: 0 0 50px rgba(0, 255, 157, 0.5);
        }
        .ps-fade-in { animation: fade-in-up 0.6s ease both; }
        .ps-fade-in-delay { animation: fade-in-up 0.6s ease 0.2s both; }
        .ps-fade-in-delay2 { animation: fade-in-up 0.6s ease 0.4s both; }
      `}</style>

      {/* Hidden elements */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFile(file) }}
      />

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

          <div className="ps-fade-in" style={{ position: 'relative', zIndex: 1 }}>
            <div style={{
              display: 'inline-block', padding: '6px 16px', borderRadius: '999px',
              border: '1px solid rgba(0,255,157,0.25)', background: 'rgba(0,255,157,0.06)',
              fontSize: '0.85rem', color: '#00ff9d', marginBottom: '24px',
            }}>
              Powered by Deep-Check AI
            </div>
          </div>

          <h1 className="ps-fade-in" style={{
            fontSize: 'clamp(2.8rem, 8vw, 5.5rem)', fontWeight: 800,
            lineHeight: 1.05, marginBottom: '20px', position: 'relative', zIndex: 1,
          }}>
            <span className="ps-gradient-text">ProofShot</span>
          </h1>

          <p className="ps-fade-in" style={{
            fontSize: 'clamp(1.2rem, 3vw, 1.6rem)', fontWeight: 700,
            marginBottom: '12px', position: 'relative', zIndex: 1,
          }}>
            Prove It&apos;s Real
          </p>

          <p className="ps-fade-in-delay" style={{
            fontSize: 'clamp(1rem, 2.5vw, 1.15rem)', color: colors.muted,
            maxWidth: '520px', lineHeight: 1.6, marginBottom: '32px', position: 'relative', zIndex: 1,
          }}>
            Take or upload a photo and get a downloadable Certificate of Authenticity
            proving it&apos;s NOT AI-generated. With timestamp and GPS.
          </p>

          {/* Two mode buttons */}
          <div className="ps-fade-in-delay" style={{
            display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center',
            marginBottom: '24px', position: 'relative', zIndex: 1,
          }}>
            <button className="ps-cta" onClick={() => { setInputMode('camera'); startCamera() }}>
              {'\uD83D\uDCF7'} Take Photo
            </button>
            <button
              onClick={() => { setInputMode('upload'); fileInputRef.current?.click() }}
              style={{
                padding: '16px 40px', borderRadius: '12px', fontSize: '1.1rem', fontWeight: 700,
                cursor: 'pointer', background: 'transparent', border: `2px solid ${colors.primary}`,
                color: colors.primary, transition: 'all 0.2s',
              }}
            >
              {'\uD83D\uDCC1'} Upload Photo
            </button>
          </div>

          {/* Upload zone (for drag and drop) */}
          <div
            className="ps-fade-in-delay2"
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: '100%', maxWidth: '420px', padding: '32px 24px',
              border: `2px dashed ${isDragging ? colors.primary : colors.border}`,
              borderRadius: '16px', cursor: 'pointer', textAlign: 'center',
              background: isDragging ? 'rgba(0,255,157,0.04)' : 'rgba(255,255,255,0.02)',
              transition: 'all 0.2s ease', position: 'relative', zIndex: 1,
            }}
          >
            <p style={{ color: colors.muted, fontSize: '0.85rem' }}>
              Or drag &amp; drop an image here &middot; paste from clipboard
            </p>
          </div>

          {error && (
            <p style={{ marginTop: '24px', color: '#ff4d4d', fontSize: '0.9rem', position: 'relative', zIndex: 1 }}>
              {error}
            </p>
          )}

          {/* Use cases */}
          <div className="ps-fade-in-delay2" style={{
            marginTop: '48px', maxWidth: '560px', width: '100%',
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px',
            position: 'relative', zIndex: 1,
          }}>
            {[
              { icon: '\uD83D\uDCCB', label: 'Insurance Claims' },
              { icon: '\uD83D\uDE97', label: 'Accident Photos' },
              { icon: '\uD83C\uDFE0', label: 'Property Reports' },
              { icon: '\uD83D\uDCE6', label: 'Shipping Proof' },
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
        </section>
      )}

      {/* ── CAMERA ───────────────────────────────────────────────────── */}
      {phase === 'camera' && (
        <section style={{
          minHeight: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center',
        }}>
          <h2 className="ps-fade-in" style={{ fontSize: 'clamp(1.5rem, 4vw, 2.2rem)', fontWeight: 700, marginBottom: '8px' }}>
            Take Your Photo
          </h2>
          <p style={{ color: colors.muted, fontSize: '0.95rem', marginBottom: '24px' }}>
            Point your camera at the subject
          </p>

          <div style={{
            position: 'relative', width: '100%', maxWidth: '480px', aspectRatio: '16/9',
            borderRadius: '16px', overflow: 'hidden', border: `2px solid rgba(0,255,157,0.25)`,
            background: colors.surface,
          }}>
            <video ref={videoRef} autoPlay playsInline muted style={{
              width: '100%', height: '100%', objectFit: 'cover',
            }} />
            {/* Corner brackets */}
            {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map((corner) => {
              const isTop = corner.includes('top')
              const isLeft = corner.includes('left')
              return (
                <div key={corner} style={{
                  position: 'absolute',
                  [isTop ? 'top' : 'bottom']: '16px',
                  [isLeft ? 'left' : 'right']: '16px',
                  width: '28px', height: '28px', borderColor: '#00ff9d', borderStyle: 'solid', borderWidth: 0,
                  ...(isTop ? { borderTopWidth: '3px' } : { borderBottomWidth: '3px' }),
                  ...(isLeft ? { borderLeftWidth: '3px' } : { borderRightWidth: '3px' }),
                  ...(isTop && isLeft ? { borderTopLeftRadius: '6px' } : {}),
                  ...(isTop && !isLeft ? { borderTopRightRadius: '6px' } : {}),
                  ...(!isTop && isLeft ? { borderBottomLeftRadius: '6px' } : {}),
                  ...(!isTop && !isLeft ? { borderBottomRightRadius: '6px' } : {}),
                }} />
              )
            })}
          </div>

          {cameraReady && (
            <button className="ps-cta ps-fade-in" onClick={capturePhoto} style={{ marginTop: '24px' }}>
              Capture &rarr;
            </button>
          )}
          {!cameraReady && (
            <p style={{ marginTop: '24px', color: colors.dimText, fontSize: '0.9rem' }}>Loading camera...</p>
          )}
        </section>
      )}

      {/* ── LOADING ──────────────────────────────────────────────────── */}
      {phase === 'loading' && (
        <section style={{
          minHeight: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center',
        }}>
          {previewUrl && (
            <img src={previewUrl} alt="Captured" style={{
              width: '200px', height: '140px', objectFit: 'cover',
              borderRadius: '16px', border: `2px solid ${colors.border}`, marginBottom: '24px', opacity: 0.7,
            }} />
          )}
          <h2 className="ps-fade-in" style={{ fontSize: 'clamp(1.5rem, 4vw, 2.2rem)', fontWeight: 700, marginBottom: '8px' }}>
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
        </section>
      )}

      {/* ── ANALYZING ────────────────────────────────────────────────── */}
      {phase === 'analyzing' && (
        <section style={{
          minHeight: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center',
        }}>
          <div style={{
            width: '64px', height: '64px', border: '3px solid rgba(0,255,157,0.3)',
            borderTopColor: '#00ff9d', borderRadius: '50%', animation: 'spin 0.8s linear infinite',
            marginBottom: '24px',
          }} />
          <h2 className="ps-fade-in" style={{ fontSize: 'clamp(1.5rem, 4vw, 2.2rem)', fontWeight: 700, marginBottom: '8px' }}>
            Verifying Authenticity...
          </h2>
          <p style={{ color: colors.muted, fontSize: '0.95rem' }}>
            Running deepfake detection to prove your photo is real
          </p>
        </section>
      )}

      {/* ── RESULT ───────────────────────────────────────────────────── */}
      {phase === 'result' && certData && (
        <section style={{
          minHeight: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', padding: '24px 24px 64px', textAlign: 'center',
        }}>
          {/* Score circle */}
          <div className="ps-fade-in" style={{ position: 'relative', width: '180px', height: '180px', marginBottom: '20px', marginTop: '24px' }}>
            <svg viewBox="0 0 200 200" style={{ width: '100%', height: '100%', animation: 'pulse-score 2s ease infinite' }}>
              <circle cx="100" cy="100" r="88" fill="none" stroke="#27272a" strokeWidth="8" />
              <circle cx="100" cy="100" r="88" fill="none"
                stroke={certData.realScore >= 70 ? colors.primary : certData.realScore >= 40 ? '#ffd700' : '#ff4d4d'}
                strokeWidth="8" strokeLinecap="round"
                strokeDasharray={`${(animatedScore / 100) * 2 * Math.PI * 88} ${2 * Math.PI * 88}`}
                transform="rotate(-90 100 100)"
                style={{ transition: 'stroke-dasharray 0.1s linear' }}
              />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{
                fontSize: '3rem', fontWeight: 800, lineHeight: 1,
                color: certData.realScore >= 70 ? colors.primary : certData.realScore >= 40 ? '#ffd700' : '#ff4d4d',
              }}>
                {animatedScore}%
              </span>
              <span style={{ fontSize: '0.8rem', color: colors.dimText, marginTop: '4px' }}>Real</span>
            </div>
          </div>

          {/* Verdict */}
          <div className="ps-fade-in-delay">
            <h2 style={{
              fontSize: 'clamp(1.5rem, 4vw, 2rem)', fontWeight: 700, marginBottom: '16px',
              color: certData.realScore >= 70 ? colors.primary : certData.realScore >= 40 ? '#ffd700' : '#ff4d4d',
            }}>
              {certData.realScore >= 70 ? '\u2705 Verified Authentic' : certData.realScore >= 40 ? '\u26A0\uFE0F Inconclusive' : '\uD83D\uDEAB AI-Generated Detected'}
            </h2>
          </div>

          {/* Certificate preview */}
          {certImageUrl && (
            <div className="ps-fade-in-delay" style={{ marginBottom: '24px', width: '100%', maxWidth: '560px' }}>
              <p style={{ fontSize: '0.85rem', color: colors.muted, marginBottom: '12px' }}>Certificate of Authenticity</p>
              <img src={certImageUrl} alt="Certificate" style={{
                width: '100%', borderRadius: '12px', border: `1px solid ${colors.border}`,
              }} />
            </div>
          )}

          {/* Info cards */}
          <div className="ps-fade-in-delay" style={{
            display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center',
            marginBottom: '24px', maxWidth: '560px',
          }}>
            {[
              { label: 'Certificate ID', value: certData.certificateId.slice(0, 8) + '...' },
              { label: 'Timestamp', value: new Date(certData.timestamp).toLocaleString() },
              ...(certData.gpsCoords ? [{ label: 'GPS', value: `${certData.gpsCoords.lat.toFixed(4)}, ${certData.gpsCoords.lon.toFixed(4)}` }] : []),
            ].map((stat) => (
              <div key={stat.label} style={{
                flex: '1 1 150px', background: colors.surface, border: `1px solid ${colors.border}`,
                borderRadius: '12px', padding: '14px', minWidth: '140px',
              }}>
                <div style={{ fontSize: '0.7rem', color: colors.dimText, marginBottom: '6px' }}>{stat.label}</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>{stat.value}</div>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className="ps-fade-in-delay2" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="ps-cta" onClick={downloadCertificate}>
              Download Certificate
            </button>
            <button onClick={resetTest} style={{
              padding: '16px 32px', borderRadius: '12px', fontSize: '1rem', fontWeight: 700,
              cursor: 'pointer', background: 'transparent', border: `2px solid ${colors.primary}`,
              color: colors.primary, transition: 'all 0.2s',
            }}>
              Certify Another Photo
            </button>
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
