'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { preprocessImageSimple, calibrateScore } from '@/lib/facePreprocess'

// ── Constants ────────────────────────────────────────────────────────────────

const MODEL_PATH = '/models/deepfake/deepfake_pixel_v1.onnx'
const TARGET_SIZE   = 224
const MAX_PHOTOS    = 5

// ── Global model cache ──────────────────────────────────────────────────────

let cachedModelBuffer: ArrayBuffer | null = null

// ── Helpers ──────────────────────────────────────────────────────────────────

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('Failed to load image'))
    el.src = src
  })
}

function getRealityVerdict(score: number): { text: string; emoji: string; color: string } {
  if (score >= 70) return { text: 'Real Photo', emoji: '\u2705', color: '#00ff9d' }
  if (score >= 40) return { text: 'Possibly AI-Staged', emoji: '\u26A0\uFE0F', color: '#ffd700' }
  return { text: 'AI-Generated Listing', emoji: '\uD83D\uDEAB', color: '#ff4d4d' }
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

interface PhotoResult {
  previewUrl: string
  realityScore: number
  pFake: number
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ListingCheckPage() {
  const [phase, setPhase] = useState<Phase>('hero')
  const [photoResults, setPhotoResults] = useState<PhotoResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loadProgress, setLoadProgress] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [analyzeIndex, setAnalyzeIndex] = useState(0)
  const [totalPhotos, setTotalPhotos] = useState(0)
  const [animatedAvg, setAnimatedAvg] = useState(0)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── SEO ───────────────────────────────────────────────────────────────
  useEffect(() => {
    document.title = 'ListingCheck — Real Estate Photo Verifier | Deep-Check'
    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'description'
      document.head.appendChild(meta)
    }
    meta.content = 'Detect AI-generated real estate photos. Verify property listings for virtual staging and fake photos. 100% private, runs in your browser.'
  }, [])

  // ── Average score animation ───────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'result' || photoResults.length === 0) return
    const avgScore = Math.round(photoResults.reduce((s, r) => s + r.realityScore, 0) / photoResults.length)
    const duration = 1500
    const startTime = performance.now()
    let raf: number
    const animate = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setAnimatedAvg(Math.round(eased * avgScore))
      if (progress < 1) raf = requestAnimationFrame(animate)
    }
    raf = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(raf)
  }, [phase, photoResults])

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

  // ── Analyze multiple photos ───────────────────────────────────────────
  const analyzePhotos = useCallback(async (dataUrls: string[]) => {
    setPhase('loading')
    setLoadProgress(0)
    setError(null)
    setPhotoResults([])
    setTotalPhotos(dataUrls.length)
    setAnalyzeIndex(0)

    try {
      // Download model
      let modelBuffer: ArrayBuffer
      try {
        modelBuffer = await fetchModelWithProgress()
      } catch {
        throw new Error('Failed to download AI model. Check your internet connection.')
      }

      setPhase('analyzing')

      // Load ONNX Runtime
      const ort = await import('onnxruntime-web')
      ort.env.wasm.wasmPaths = '/'
      ort.env.wasm.numThreads = 1

      const session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      })

      const results: PhotoResult[] = []

      for (let idx = 0; idx < dataUrls.length; idx++) {
        setAnalyzeIndex(idx + 1)
        const img = await loadImage(dataUrls[idx])
        const tensorData = preprocessImageSimple(img)
        const input = new ort.Tensor('float32', tensorData, [1, 3, TARGET_SIZE, TARGET_SIZE])
        const inputName = session.inputNames[0]
        const outputName = session.outputNames[0]
        const feeds: Record<string, import('onnxruntime-web').Tensor> = { [inputName]: input }
        const output = await session.run(feeds)
        const logit = (output[outputName].data as Float32Array)[0]
        const pFake = sigmoid(logit)
        const realityScore = calibrateScore(pFake)

        results.push({ previewUrl: dataUrls[idx], realityScore, pFake })
      }

      setPhotoResults(results)
      setPhase('result')
    } catch (err) {
      console.error('[ListingCheck] Analysis error:', err)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setError(`Analysis failed: ${msg}`)
      setPhase('hero')
    }
  }, [fetchModelWithProgress])

  // ── File handling ─────────────────────────────────────────────────────
  const handleFiles = useCallback((files: FileList | File[]) => {
    const validFiles: File[] = []
    for (let i = 0; i < Math.min(files.length, MAX_PHOTOS); i++) {
      const f = files[i]
      if (f.type.startsWith('image/') && f.size <= 15 * 1024 * 1024) {
        validFiles.push(f)
      }
    }
    if (validFiles.length === 0) {
      setError('Please upload at least one image file (JPEG, PNG, WebP), max 15MB each')
      return
    }
    setError(null)

    const dataUrls: string[] = []
    let loaded = 0
    validFiles.forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => {
        dataUrls.push(reader.result as string)
        loaded++
        if (loaded === validFiles.length) {
          analyzePhotos(dataUrls)
        }
      }
      reader.readAsDataURL(file)
    })
  }, [analyzePhotos])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files)
    }
  }, [handleFiles])

  const resetTest = useCallback(() => {
    setPhotoResults([])
    setAnimatedAvg(0)
    setError(null)
    setPhase('hero')
  }, [])

  const avgScore = photoResults.length > 0
    ? Math.round(photoResults.reduce((s, r) => s + r.realityScore, 0) / photoResults.length)
    : 0

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100vh', background: colors.bg, color: colors.text,
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    }}>
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
        .lc-gradient-text {
          background: linear-gradient(135deg, #00ff9d, #00e5ff, #00ff9d);
          background-size: 300% 300%;
          animation: gradient-shift 4s ease infinite;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .lc-cta {
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
        .lc-cta:hover {
          transform: translateY(-2px) scale(1.02);
          box-shadow: 0 0 50px rgba(0, 255, 157, 0.5);
        }
        .lc-fade-in { animation: fade-in-up 0.6s ease both; }
        .lc-fade-in-delay { animation: fade-in-up 0.6s ease 0.2s both; }
        .lc-fade-in-delay2 { animation: fade-in-up 0.6s ease 0.4s both; }
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

      <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files) }}
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
            background: 'radial-gradient(circle, rgba(0,229,255,0.08) 0%, transparent 70%)',
            borderRadius: '50%', pointerEvents: 'none',
          }} />

          <div className="lc-fade-in" style={{ position: 'relative', zIndex: 1 }}>
            <div style={{
              display: 'inline-block', padding: '6px 16px', borderRadius: '999px',
              border: '1px solid rgba(0,255,157,0.25)', background: 'rgba(0,255,157,0.06)',
              fontSize: '0.85rem', color: '#00ff9d', marginBottom: '24px',
            }}>
              Powered by Deep-Check AI
            </div>
          </div>

          <h1 className="lc-fade-in" style={{
            fontSize: 'clamp(2.8rem, 8vw, 5.5rem)', fontWeight: 800,
            lineHeight: 1.05, marginBottom: '20px', position: 'relative', zIndex: 1,
          }}>
            <span className="lc-gradient-text">ListingCheck</span>
          </h1>

          <p className="lc-fade-in" style={{
            fontSize: 'clamp(1.2rem, 3vw, 1.6rem)', fontWeight: 700,
            marginBottom: '12px', position: 'relative', zIndex: 1,
          }}>
            Is This Listing Real?
          </p>

          <p className="lc-fade-in-delay" style={{
            fontSize: 'clamp(1rem, 2.5vw, 1.15rem)', color: colors.muted,
            maxWidth: '540px', lineHeight: 1.6, marginBottom: '32px', position: 'relative', zIndex: 1,
          }}>
            Upload up to {MAX_PHOTOS} property photos and our AI detects AI-generated
            images, virtual staging, and fake listing photos. Zero data leaves your browser.
          </p>

          {/* Upload zone */}
          <div
            className="lc-fade-in-delay"
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
            <div style={{ fontSize: '3rem', marginBottom: '12px' }}>{'\uD83C\uDFE0'}</div>
            <p style={{ fontWeight: 600, marginBottom: '8px' }}>
              Drop property photos here
            </p>
            <p style={{ color: colors.muted, fontSize: '0.85rem' }}>
              Up to {MAX_PHOTOS} photos &middot; click to browse
            </p>
          </div>

          {error && (
            <p style={{ marginTop: '24px', color: '#ff4d4d', fontSize: '0.9rem', maxWidth: '400px', position: 'relative', zIndex: 1 }}>
              {error}
            </p>
          )}

          {/* Target audience */}
          <div className="lc-fade-in-delay2" style={{
            marginTop: '48px', maxWidth: '560px', width: '100%',
            background: colors.surface, border: `1px solid ${colors.border}`,
            borderRadius: '16px', padding: '24px', textAlign: 'left',
            position: 'relative', zIndex: 1,
          }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '12px', color: colors.primary }}>
              Built for Renters, Buyers &amp; Platforms
            </h3>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              {['Airbnb', 'Idealista', 'Zillow', 'Rightmove', 'Fotocasa'].map((p) => (
                <span key={p} style={{
                  padding: '6px 14px', borderRadius: '8px',
                  background: 'rgba(0,255,157,0.08)', border: `1px solid rgba(0,255,157,0.2)`,
                  fontSize: '0.85rem', color: colors.muted,
                }}>{p}</span>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="lc-fade-in-delay2" style={{
            display: 'flex', gap: '40px', marginTop: '32px', flexWrap: 'wrap',
            justifyContent: 'center', position: 'relative', zIndex: 1,
          }}>
            {[
              { value: '18.6M', label: 'Model Parameters' },
              { value: '0.31%', label: 'Error Rate' },
              { value: '0ms', label: 'Data Sent to Server' },
            ].map((stat) => (
              <div key={stat.label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: colors.primary }}>{stat.value}</div>
                <div style={{ fontSize: '0.8rem', color: colors.dimText, marginTop: '4px' }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── LOADING ──────────────────────────────────────────────────── */}
      {phase === 'loading' && (
        <section style={{
          minHeight: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center',
        }}>
          <h2 className="lc-fade-in" style={{ fontSize: 'clamp(1.5rem, 4vw, 2.2rem)', fontWeight: 700, marginBottom: '8px' }}>
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
          <div style={{ marginBottom: '24px' }}>
            <div style={{
              width: '64px', height: '64px', border: '3px solid rgba(0,255,157,0.3)',
              borderTopColor: '#00ff9d', borderRadius: '50%', animation: 'spin 0.8s linear infinite',
              margin: '0 auto',
            }} />
          </div>
          <h2 className="lc-fade-in" style={{ fontSize: 'clamp(1.5rem, 4vw, 2.2rem)', fontWeight: 700, marginBottom: '8px' }}>
            Analyzing Photo {analyzeIndex} of {totalPhotos}...
          </h2>
          <p style={{ color: colors.muted, fontSize: '0.95rem' }}>
            Running neural network inference in your browser
          </p>
        </section>
      )}

      {/* ── RESULT ───────────────────────────────────────────────────── */}
      {phase === 'result' && photoResults.length > 0 && (
        <section style={{
          minHeight: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', padding: '24px 24px 64px', textAlign: 'center',
        }}>
          {/* Average score circle */}
          <div className="lc-fade-in" style={{ position: 'relative', width: '200px', height: '200px', marginBottom: '24px', marginTop: '24px' }}>
            <svg viewBox="0 0 200 200" style={{ width: '100%', height: '100%', animation: 'pulse-score 2s ease infinite' }}>
              <circle cx="100" cy="100" r="88" fill="none" stroke="#27272a" strokeWidth="8" />
              <circle cx="100" cy="100" r="88" fill="none"
                stroke={getRealityVerdict(avgScore).color}
                strokeWidth="8" strokeLinecap="round"
                strokeDasharray={`${(animatedAvg / 100) * 2 * Math.PI * 88} ${2 * Math.PI * 88}`}
                transform="rotate(-90 100 100)"
                style={{ transition: 'stroke-dasharray 0.1s linear', filter: `drop-shadow(0 0 8px ${getRealityVerdict(avgScore).color}60)` }}
              />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '3.5rem', fontWeight: 800, color: getRealityVerdict(avgScore).color, lineHeight: 1 }}>
                {animatedAvg}
              </span>
              <span style={{ fontSize: '0.85rem', color: colors.dimText, marginTop: '4px' }}>
                Avg Reality Score
              </span>
            </div>
          </div>

          {/* Verdict */}
          <div className="lc-fade-in-delay">
            <h2 style={{
              fontSize: 'clamp(1.5rem, 4vw, 2.2rem)', fontWeight: 700, marginBottom: '8px',
              color: getRealityVerdict(avgScore).color,
            }}>
              {getRealityVerdict(avgScore).emoji} {getRealityVerdict(avgScore).text}
            </h2>
            <p style={{ color: colors.muted, fontSize: '0.95rem', marginBottom: '24px' }}>
              {photoResults.length} photo{photoResults.length > 1 ? 's' : ''} analyzed
            </p>
          </div>

          {/* Individual photo results */}
          <div className="lc-fade-in-delay" style={{
            display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(160px, 1fr))`,
            gap: '16px', maxWidth: '600px', width: '100%', marginBottom: '36px',
          }}>
            {photoResults.map((pr, idx) => {
              const verdict = getRealityVerdict(pr.realityScore)
              return (
                <div key={idx} style={{
                  background: colors.surface, border: `1px solid ${colors.border}`,
                  borderRadius: '12px', overflow: 'hidden',
                }}>
                  <img src={pr.previewUrl} alt={`Photo ${idx + 1}`} style={{
                    width: '100%', height: '120px', objectFit: 'cover',
                  }} />
                  <div style={{ padding: '12px' }}>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: verdict.color }}>
                      {pr.realityScore}%
                    </div>
                    <div style={{ fontSize: '0.75rem', color: colors.muted, marginTop: '4px' }}>
                      {verdict.emoji} {verdict.text}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Action buttons */}
          <div className="lc-fade-in-delay2" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="lc-cta" onClick={resetTest}>Check Another Listing &rarr;</button>
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
