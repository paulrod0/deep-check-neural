'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'

// ── Constants ────────────────────────────────────────────────────────────────

const MODEL_PATH = '/models/deepfake/deepfake_pixel_v1.onnx'
const TARGET_SIZE = 224

// ── Shared face preprocessing ───────────────────────────────────────────────

import { preprocessImageForModel, calibrateScore } from '@/lib/facePreprocess'

// ── Global model cache ──────────────────────────────────────────────────────

let cachedModelBuffer: ArrayBuffer | null = null

// ── Helpers ──────────────────────────────────────────────────────────────────

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

function getCatfishVerdict(risk: number): { text: string; emoji: string; color: string } {
  if (risk <= 20) return { text: 'Looks Legit', emoji: '\u2705', color: '#00ff9d' }
  if (risk <= 60) return { text: 'Suspicious Profile', emoji: '\u26A0\uFE0F', color: '#ffd700' }
  return { text: 'Likely Catfish', emoji: '\uD83D\uDEAB', color: '#ff4d4d' }
}

function twitterShareUrl(risk: number): string {
  const text = `I tested a dating profile on DateSafe and got a ${risk}% catfish risk score! Are YOUR matches real? Try it:`
  const url = 'https://deep-check-two.vercel.app/datesafe'
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`
}

function linkedinShareUrl(): string {
  const url = 'https://deep-check-two.vercel.app/datesafe'
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`
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
  catfishRisk: number
  pFake: number
  inferenceMs: number
}

// ── Component ────────────────────────────────────────────────────────────────

export default function DateSafePage() {
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
    document.title = 'DateSafe — Catfish Detector | Deep-Check'
    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'description'
      document.head.appendChild(meta)
    }
    meta.content = 'Detect catfish profiles on dating apps. Upload a profile photo and our AI detects AI-generated faces. 100% private, runs in your browser.'
  }, [])

  // ── Score animation ───────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'result' || !result) return
    const target = result.catfishRisk
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

  // ── Analyze image ─────────────────────────────────────────────────────
  const analyzeImage = useCallback(async (dataUrl: string) => {
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

      // Preprocess: detect face → crop → normalize → tensor
      const tensorData = await preprocessImageForModel(img)

      // Load ONNX Runtime
      const ort = await import('onnxruntime-web')
      ort.env.wasm.wasmPaths = '/'
      ort.env.wasm.numThreads = 1

      // Create session
      const session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      })

      // Run inference
      const input = new ort.Tensor('float32', tensorData, [1, 3, TARGET_SIZE, TARGET_SIZE])
      const inputName = session.inputNames[0]
      const outputName = session.outputNames[0]
      const feeds: Record<string, import('onnxruntime-web').Tensor> = { [inputName]: input }
      const output = await session.run(feeds)
      const logit = (output[outputName].data as Float32Array)[0]
      const pFake = sigmoid(logit)
      const inferenceMs = Math.round(performance.now() - t0)

      // Use shared calibration (accounts for face crop + domain gap)
      const humanScore = calibrateScore(pFake)
      const catfishRisk = 100 - humanScore

      setResult({ catfishRisk, pFake, inferenceMs })
      setPhase('result')
    } catch (err) {
      console.error('[DateSafe] Inference error:', err)
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
    if (file.size > 10 * 1024 * 1024) {
      setError('Image must be under 10MB')
      return
    }
    setError(null)
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setPreviewUrl(dataUrl)
      analyzeImage(dataUrl)
    }
    reader.readAsDataURL(file)
  }, [analyzeImage])

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
        minHeight: '100vh',
        background: colors.bg,
        color: colors.text,
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
        .ds-gradient-text {
          background: linear-gradient(135deg, #ff6b9d, #00ff9d, #ff6b9d);
          background-size: 300% 300%;
          animation: gradient-shift 4s ease infinite;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .ds-cta {
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
        .ds-cta:hover {
          transform: translateY(-2px) scale(1.02);
          box-shadow: 0 0 50px rgba(0, 255, 157, 0.5);
        }
        .ds-fade-in { animation: fade-in-up 0.6s ease both; }
        .ds-fade-in-delay { animation: fade-in-up 0.6s ease 0.2s both; }
        .ds-fade-in-delay2 { animation: fade-in-up 0.6s ease 0.4s both; }
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

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
        }}
      />

      {/* ── HERO ─────────────────────────────────────────────────────── */}
      {phase === 'hero' && (
        <section style={{
          minHeight: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center',
          position: 'relative',
        }}>
          {/* Background glows */}
          <div style={{
            position: 'absolute', top: '-15%', left: '15%', width: '400px', height: '400px',
            background: 'radial-gradient(circle, rgba(255,107,157,0.12) 0%, transparent 70%)',
            borderRadius: '50%', pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', bottom: '5%', right: '10%', width: '350px', height: '350px',
            background: 'radial-gradient(circle, rgba(0,255,157,0.1) 0%, transparent 70%)',
            borderRadius: '50%', pointerEvents: 'none',
          }} />

          <div className="ds-fade-in" style={{ position: 'relative', zIndex: 1 }}>
            <div style={{
              display: 'inline-block', padding: '6px 16px', borderRadius: '999px',
              border: '1px solid rgba(0,255,157,0.25)', background: 'rgba(0,255,157,0.06)',
              fontSize: '0.85rem', color: '#00ff9d', marginBottom: '24px', letterSpacing: '0.04em',
            }}>
              Powered by Deep-Check AI
            </div>
          </div>

          <h1 className="ds-fade-in" style={{
            fontSize: 'clamp(2.8rem, 8vw, 5.5rem)', fontWeight: 800,
            lineHeight: 1.05, marginBottom: '20px', position: 'relative', zIndex: 1,
          }}>
            <span className="ds-gradient-text">DateSafe</span>
          </h1>

          <p className="ds-fade-in" style={{
            fontSize: 'clamp(1.2rem, 3vw, 1.6rem)', fontWeight: 700,
            marginBottom: '12px', position: 'relative', zIndex: 1,
          }}>
            Don&apos;t Get Catfished
          </p>

          <p className="ds-fade-in-delay" style={{
            fontSize: 'clamp(1rem, 2.5vw, 1.15rem)', color: colors.muted,
            maxWidth: '520px', lineHeight: 1.6, marginBottom: '32px', position: 'relative', zIndex: 1,
          }}>
            Upload a dating profile photo and our AI will tell you if
            the person is real or AI-generated. Zero data leaves your browser.
          </p>

          {/* Upload zone */}
          <div
            className="ds-fade-in-delay"
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
            <div style={{ fontSize: '3rem', marginBottom: '12px' }}>{'\uD83D\uDCF7'}</div>
            <p style={{ fontWeight: 600, marginBottom: '8px' }}>
              Drop a profile photo here
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

          {/* Stats */}
          <div className="ds-fade-in-delay2" style={{
            display: 'flex', gap: '40px', marginTop: '48px', flexWrap: 'wrap',
            justifyContent: 'center', position: 'relative', zIndex: 1,
          }}>
            {[
              { value: '$1.3B', label: 'Lost to Romance Scams/Year (FTC)' },
              { value: '18.6M', label: 'Model Parameters' },
              { value: '0ms', label: 'Data Sent to Server' },
            ].map((stat) => (
              <div key={stat.label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: colors.primary }}>{stat.value}</div>
                <div style={{ fontSize: '0.8rem', color: colors.dimText, marginTop: '4px' }}>{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Red flags tips */}
          <div className="ds-fade-in-delay2" style={{
            marginTop: '48px', maxWidth: '480px', width: '100%',
            background: colors.surface, border: `1px solid ${colors.border}`,
            borderRadius: '16px', padding: '24px', textAlign: 'left',
            position: 'relative', zIndex: 1,
          }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '12px', color: colors.primary }}>
              Red Flags to Watch For
            </h3>
            <ul style={{ color: colors.muted, fontSize: '0.9rem', lineHeight: 1.8, paddingLeft: '20px', margin: 0 }}>
              <li>Perfect skin with no pores or blemishes</li>
              <li>Asymmetric or misshapen ears/jewelry</li>
              <li>Blurry or distorted background behind the person</li>
              <li>Only one photo available on the profile</li>
              <li>Refuses to video call or meet in person</li>
            </ul>
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
              borderRadius: '16px', border: `2px solid ${colors.border}`, marginBottom: '24px',
              opacity: 0.7,
            }} />
          )}
          <h2 className="ds-fade-in" style={{ fontSize: 'clamp(1.5rem, 4vw, 2.2rem)', fontWeight: 700, marginBottom: '8px' }}>
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
          <p style={{ color: '#52525b', fontSize: '0.8rem', marginTop: '16px' }}>
            First time only — cached for future scans
          </p>
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
                borderRadius: '16px', border: `2px solid ${colors.primary}`,
                filter: 'brightness(0.7)',
              }} />
              <div style={{
                position: 'absolute', inset: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{
                  width: '48px', height: '48px', border: '3px solid rgba(0,255,157,0.3)',
                  borderTopColor: '#00ff9d', borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                }} />
              </div>
            </div>
          )}
          <h2 className="ds-fade-in" style={{ fontSize: 'clamp(1.5rem, 4vw, 2.2rem)', fontWeight: 700, marginBottom: '8px' }}>
            Scanning for Catfish...
          </h2>
          <p style={{ color: colors.muted, fontSize: '0.95rem' }}>
            Running deepfake detection neural network in your browser
          </p>
        </section>
      )}

      {/* ── RESULT ───────────────────────────────────────────────────── */}
      {phase === 'result' && result && (
        <section style={{
          minHeight: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center',
        }}>
          {previewUrl && (
            <img src={previewUrl} alt="Analyzed" className="ds-fade-in" style={{
              width: '120px', height: '120px', objectFit: 'cover',
              borderRadius: '16px', border: `2px solid ${getCatfishVerdict(result.catfishRisk).color}`,
              marginBottom: '24px',
            }} />
          )}

          {/* Score circle */}
          <div className="ds-fade-in" style={{ position: 'relative', width: '200px', height: '200px', marginBottom: '24px' }}>
            <svg viewBox="0 0 200 200" style={{ width: '100%', height: '100%', animation: 'pulse-score 2s ease infinite' }}>
              <circle cx="100" cy="100" r="88" fill="none" stroke="#27272a" strokeWidth="8" />
              <circle cx="100" cy="100" r="88" fill="none"
                stroke={getCatfishVerdict(result.catfishRisk).color}
                strokeWidth="8" strokeLinecap="round"
                strokeDasharray={`${(animatedScore / 100) * 2 * Math.PI * 88} ${2 * Math.PI * 88}`}
                transform="rotate(-90 100 100)"
                style={{ transition: 'stroke-dasharray 0.1s linear', filter: `drop-shadow(0 0 8px ${getCatfishVerdict(result.catfishRisk).color}60)` }}
              />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '3.5rem', fontWeight: 800, color: getCatfishVerdict(result.catfishRisk).color, lineHeight: 1 }}>
                {animatedScore}
              </span>
              <span style={{ fontSize: '0.85rem', color: colors.dimText, marginTop: '4px' }}>Catfish Risk</span>
            </div>
          </div>

          {/* Verdict */}
          <div className="ds-fade-in-delay">
            <h2 style={{
              fontSize: 'clamp(1.5rem, 4vw, 2.2rem)', fontWeight: 700, marginBottom: '8px',
              color: getCatfishVerdict(result.catfishRisk).color,
            }}>
              {getCatfishVerdict(result.catfishRisk).emoji} {getCatfishVerdict(result.catfishRisk).text}
            </h2>
          </div>

          {/* Stats cards */}
          <div className="ds-fade-in-delay" style={{
            display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center',
            marginBottom: '36px', marginTop: '24px', maxWidth: '560px',
          }}>
            {[
              { label: 'Authenticity Score', value: `${100 - result.catfishRisk}/100` },
              { label: 'Confidence', value: result.catfishRisk <= 15 ? 'High' : result.catfishRisk <= 40 ? 'Medium' : 'Low' },
              { label: 'Inference Time', value: `${result.inferenceMs}ms` },
            ].map((stat) => (
              <div key={stat.label} style={{
                flex: '1 1 150px', background: colors.surface, border: `1px solid ${colors.border}`,
                borderRadius: '12px', padding: '16px', minWidth: '140px',
              }}>
                <div style={{ fontSize: '0.75rem', color: colors.dimText, marginBottom: '6px' }}>{stat.label}</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 600 }}>{stat.value}</div>
              </div>
            ))}
          </div>

          {/* Share buttons */}
          <div className="ds-fade-in-delay2" style={{
            display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '24px',
          }}>
            <a href={twitterShareUrl(result.catfishRisk)} target="_blank" rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '12px 24px',
                borderRadius: '10px', background: '#1d1d22', border: `1px solid ${colors.border}`,
                color: '#ffffff', fontSize: '0.9rem', fontWeight: 600, textDecoration: 'none',
              }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              I caught a catfish!
            </a>
            <a href={linkedinShareUrl()} target="_blank" rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '12px 24px',
                borderRadius: '10px', background: '#1d1d22', border: `1px solid ${colors.border}`,
                color: '#ffffff', fontSize: '0.9rem', fontWeight: 600, textDecoration: 'none',
              }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
              Share on LinkedIn
            </a>
          </div>

          {/* Action buttons */}
          <div className="ds-fade-in-delay2" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="ds-cta" onClick={resetTest}>Check Another Profile &rarr;</button>
          </div>

          {/* Footer */}
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
