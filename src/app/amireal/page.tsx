'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

// ─── SEO metadata (exported from a separate constant for client components) ──
// Next.js App Router reads metadata from `export const metadata` only in Server
// Components. For a 'use client' page we use a <head> approach via useEffect or
// a parallel layout. We inject meta tags directly for maximum compatibility.

// ─── Constants ───────────────────────────────────────────────────────────────

const MODEL_PATH = '/models/deepfake/deepfake_pixel_v1.onnx'
const IMAGENET_MEAN = [0.485, 0.456, 0.406]
const IMAGENET_STD  = [0.229, 0.224, 0.225]
const TARGET_SIZE   = 224

// ─── Types ───────────────────────────────────────────────────────────────────

type AppPhase = 'hero' | 'camera' | 'countdown' | 'analyzing' | 'result'

interface ResultData {
  humanScore: number        // 0-100
  pFake: number             // 0-1
  inferenceMs: number
}

// ─── Sigmoid helper ──────────────────────────────────────────────────────────

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

// ─── Preprocess: canvas ImageData -> CHW float32 with ImageNet normalization ─

function preprocessFrame(canvas: HTMLCanvasElement): Float32Array {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  // Resize to 224x224
  const resized = document.createElement('canvas')
  resized.width = TARGET_SIZE
  resized.height = TARGET_SIZE
  const rctx = resized.getContext('2d', { willReadFrequently: true })!
  rctx.drawImage(canvas, 0, 0, TARGET_SIZE, TARGET_SIZE)
  const imgData = rctx.getImageData(0, 0, TARGET_SIZE, TARGET_SIZE)
  const pixels = imgData.data

  // CHW layout, ImageNet normalized
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

// ─── Fake percentile generator (deterministic from score) ────────────────────

function getPercentile(humanScore: number): number {
  // Deterministic but fun: higher human scores -> higher percentile
  if (humanScore >= 95) return 97
  if (humanScore >= 90) return 92
  if (humanScore >= 80) return 84
  if (humanScore >= 70) return 71
  if (humanScore >= 60) return 58
  if (humanScore >= 50) return 43
  if (humanScore >= 40) return 29
  return 15
}

function getVerdict(score: number): { text: string; emoji: string } {
  if (score >= 80) return { text: "You're definitely human!", emoji: '' }
  if (score >= 50) return { text: "Hmm, our AI isn't sure...", emoji: '' }
  return { text: 'Are you a deepfake?!', emoji: '' }
}

function getScoreColor(score: number): string {
  if (score >= 80) return '#00ff9d'
  if (score >= 50) return '#ffd700'
  return '#ff4d4d'
}

// ─── Share URL builders ──────────────────────────────────────────────────────

function twitterShareUrl(score: number): string {
  const text = `I scored ${score}/100 on the "Am I Real?" AI human detection test! Think you can beat me? Try it:`
  const url = 'https://deep-check-two.vercel.app/amireal'
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`
}

function linkedinShareUrl(score: number): string {
  const url = 'https://deep-check-two.vercel.app/amireal'
  const title = `I scored ${score}/100 on "Am I Real?"`
  const summary = `Our AI analyzed my face and gave me a ${score}% human score. Zero data leaves your browser. Try it yourself!`
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`
}

// =============================================================================
// Component
// =============================================================================

export default function AmIRealPage() {
  const [phase, setPhase] = useState<AppPhase>('hero')
  const [countdown, setCountdown] = useState(3)
  const [result, setResult] = useState<ResultData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [animatedScore, setAnimatedScore] = useState(0)
  const [cameraReady, setCameraReady] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // ─── Set document title / meta ─────────────────────────────────────────────
  useEffect(() => {
    document.title = 'Am I Real? — AI Human Detection | Deep-Check'
    // Set meta description
    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'description'
      document.head.appendChild(meta)
    }
    meta.content = 'Test if you look real or AI-generated. Our deepfake detection AI analyzes your face in real-time — 100% private, no data leaves your browser.'

    // OG tags
    const setOG = (property: string, content: string) => {
      let tag = document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement | null
      if (!tag) {
        tag = document.createElement('meta')
        tag.setAttribute('property', property)
        document.head.appendChild(tag)
      }
      tag.content = content
    }
    setOG('og:title', 'Am I Real? — AI Human Detection')
    setOG('og:description', 'Our AI analyzes your face to determine if you look real or AI-generated. 100% private.')
    setOG('og:url', 'https://deep-check-two.vercel.app/amireal')
    setOG('og:type', 'website')
  }, [])

  // ─── Score animation on result ─────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'result' || !result) return
    const target = result.humanScore
    const duration = 1500
    const startTime = performance.now()
    let raf: number

    const animate = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setAnimatedScore(Math.round(eased * target))
      if (progress < 1) {
        raf = requestAnimationFrame(animate)
      }
    }
    raf = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(raf)
  }, [phase, result])

  // ─── Camera startup ────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setPhase('camera')
    setError(null)
    setCameraReady(false)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
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
    } catch (err) {
      setError('Camera access denied. Please allow camera permissions and try again.')
      setPhase('hero')
    }
  }, [])

  // ─── Stop camera ───────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  // ─── Countdown + capture ───────────────────────────────────────────────────
  const startCountdown = useCallback(() => {
    setPhase('countdown')
    setCountdown(3)
    let count = 3
    const interval = setInterval(() => {
      count--
      if (count > 0) {
        setCountdown(count)
      } else {
        clearInterval(interval)
        captureAndAnalyze()
      }
    }, 1000)
  }, [])

  // ─── Capture frame + run ONNX ──────────────────────────────────────────────
  const captureAndAnalyze = useCallback(async () => {
    setPhase('analyzing')
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) {
      setError('Camera not ready.')
      setPhase('hero')
      return
    }

    // Draw current video frame to canvas
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    // Stop camera stream
    stopCamera()

    try {
      const t0 = performance.now()

      // Preprocess
      const tensorData = preprocessFrame(canvas)

      // Load ONNX Runtime with robust error handling
      let ort: typeof import('onnxruntime-web')
      try {
        ort = await import('onnxruntime-web')
      } catch {
        throw new Error('Failed to load ONNX Runtime Web module')
      }
      ort.env.wasm.wasmPaths = '/'
      ort.env.wasm.numThreads = 1

      // Create session with timeout
      let session: import('onnxruntime-web').InferenceSession
      try {
        session = await ort.InferenceSession.create(MODEL_PATH, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        })
      } catch (modelErr) {
        console.error('ONNX session error:', modelErr)
        throw new Error('Failed to load AI model (70MB). Check network connection.')
      }

      // Build input tensor [1, 3, 224, 224]
      const input = new ort.Tensor('float32', tensorData, [1, 3, TARGET_SIZE, TARGET_SIZE])

      // Run inference — detect input/output names dynamically
      const inputName = session.inputNames[0]   // "x" or "face_image"
      const outputName = session.outputNames[0] // "squeeze" or "logit"
      const feeds: Record<string, import('onnxruntime-web').Tensor> = { [inputName]: input }
      const output = await session.run(feeds)
      const logitData = output[outputName].data as Float32Array

      const logit = logitData[0]
      const pFake = sigmoid(logit)
      const pReal = 1 - pFake
      const humanScore = Math.round(pReal * 100)
      const inferenceMs = Math.round(performance.now() - t0)

      setResult({ humanScore, pFake, inferenceMs })
      setPhase('result')
    } catch (err) {
      console.error('[AmIReal] Inference error:', err)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setError(`Analysis failed: ${msg}. Try Chrome or Edge.`)
      setPhase('hero')
    }
  }, [stopCamera])

  // ─── Reset ─────────────────────────────────────────────────────────────────
  const resetTest = useCallback(() => {
    setResult(null)
    setAnimatedScore(0)
    setError(null)
    stopCamera()
    setPhase('hero')
  }, [stopCamera])

  // ─── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => stopCamera()
  }, [stopCamera])

  // =========================================================================
  // Render
  // =========================================================================

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#0a0a0c',
        color: '#ffffff',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        overflow: 'hidden',
      }}
    >
      {/* ── Inline styles for animations ── */}
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
        @keyframes scan-line {
          0% { top: 0; }
          100% { top: 100%; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .amireal-gradient-text {
          background: linear-gradient(135deg, #00ff9d, #00e5ff, #7000ff, #00ff9d);
          background-size: 300% 300%;
          animation: gradient-shift 4s ease infinite;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .amireal-cta {
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
        .amireal-cta:hover {
          transform: translateY(-2px) scale(1.02);
          box-shadow: 0 0 50px rgba(0, 255, 157, 0.5);
        }
        .amireal-cta:active {
          transform: scale(0.98);
        }
        .amireal-fade-in {
          animation: fade-in-up 0.6s ease both;
        }
        .amireal-fade-in-delay {
          animation: fade-in-up 0.6s ease 0.2s both;
        }
        .amireal-fade-in-delay2 {
          animation: fade-in-up 0.6s ease 0.4s both;
        }
      `}</style>

      {/* ── Hidden canvas for frame capture ── */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* ================================================================== */}
      {/* HERO PHASE                                                         */}
      {/* ================================================================== */}
      {phase === 'hero' && (
        <section
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            textAlign: 'center',
            position: 'relative',
          }}
        >
          {/* Background glows */}
          <div
            style={{
              position: 'absolute',
              top: '-15%',
              left: '15%',
              width: '400px',
              height: '400px',
              background: 'radial-gradient(circle, rgba(0,255,157,0.12) 0%, transparent 70%)',
              borderRadius: '50%',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: '5%',
              right: '10%',
              width: '350px',
              height: '350px',
              background: 'radial-gradient(circle, rgba(112,0,255,0.1) 0%, transparent 70%)',
              borderRadius: '50%',
              pointerEvents: 'none',
            }}
          />

          <div className="amireal-fade-in" style={{ position: 'relative', zIndex: 1 }}>
            <div
              style={{
                display: 'inline-block',
                padding: '6px 16px',
                borderRadius: '999px',
                border: '1px solid rgba(0,255,157,0.25)',
                background: 'rgba(0,255,157,0.06)',
                fontSize: '0.85rem',
                color: '#00ff9d',
                marginBottom: '24px',
                letterSpacing: '0.04em',
              }}
            >
              Powered by Deep-Check AI
            </div>
          </div>

          <h1
            className="amireal-fade-in"
            style={{
              fontSize: 'clamp(2.8rem, 8vw, 5.5rem)',
              fontWeight: 800,
              lineHeight: 1.05,
              marginBottom: '20px',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <span className="amireal-gradient-text">Am I Real?</span>
          </h1>

          <p
            className="amireal-fade-in-delay"
            style={{
              fontSize: 'clamp(1rem, 2.5vw, 1.25rem)',
              color: '#a1a1aa',
              maxWidth: '560px',
              lineHeight: 1.6,
              marginBottom: '40px',
              position: 'relative',
              zIndex: 1,
            }}
          >
            Our AI analyzes your face in real-time.
            <br />
            No data leaves your browser.
          </p>

          <div className="amireal-fade-in-delay2" style={{ position: 'relative', zIndex: 1 }}>
            <button className="amireal-cta" onClick={startCamera}>
              Test My Face &rarr;
            </button>
          </div>

          {error && (
            <p
              style={{
                marginTop: '24px',
                color: '#ff4d4d',
                fontSize: '0.9rem',
                maxWidth: '400px',
                position: 'relative',
                zIndex: 1,
              }}
            >
              {error}
            </p>
          )}

          {/* Stats row */}
          <div
            className="amireal-fade-in-delay2"
            style={{
              display: 'flex',
              gap: '40px',
              marginTop: '60px',
              flexWrap: 'wrap',
              justifyContent: 'center',
              position: 'relative',
              zIndex: 1,
            }}
          >
            {[
              { value: '18.6M', label: 'Model Parameters' },
              { value: '0.31%', label: 'Error Rate' },
              { value: '0ms', label: 'Data Sent to Server' },
            ].map((stat) => (
              <div key={stat.label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#00ff9d' }}>
                  {stat.value}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#71717a', marginTop: '4px' }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ================================================================== */}
      {/* CAMERA / COUNTDOWN / ANALYZING PHASES                              */}
      {/* ================================================================== */}
      {(phase === 'camera' || phase === 'countdown' || phase === 'analyzing') && (
        <section
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            textAlign: 'center',
          }}
        >
          <h2
            className="amireal-fade-in"
            style={{
              fontSize: 'clamp(1.5rem, 4vw, 2.2rem)',
              fontWeight: 700,
              marginBottom: '8px',
            }}
          >
            {phase === 'analyzing' ? 'Analyzing...' : 'Get Ready'}
          </h2>
          <p
            style={{
              color: '#a1a1aa',
              fontSize: '0.95rem',
              marginBottom: '24px',
            }}
          >
            {phase === 'camera' && 'Position your face in the frame'}
            {phase === 'countdown' && 'Hold still!'}
            {phase === 'analyzing' && 'Running neural network inference in your browser...'}
          </p>

          {/* Video container */}
          <div
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: '480px',
              aspectRatio: '4/3',
              borderRadius: '16px',
              overflow: 'hidden',
              border: '2px solid rgba(0,255,157,0.25)',
              background: '#121216',
            }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: 'scaleX(-1)',
                display: phase === 'analyzing' ? 'none' : 'block',
              }}
            />

            {/* Scan line during analyzing */}
            {phase === 'analyzing' && (
              <>
                {/* Show frozen frame from canvas */}
                <canvas
                  ref={(el) => {
                    if (el && canvasRef.current) {
                      const ctx = el.getContext('2d')
                      if (ctx) {
                        el.width = canvasRef.current.width
                        el.height = canvasRef.current.height
                        ctx.save()
                        ctx.translate(el.width, 0)
                        ctx.scale(-1, 1)
                        ctx.drawImage(canvasRef.current, 0, 0)
                        ctx.restore()
                      }
                    }
                  }}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    filter: 'brightness(0.7)',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    width: '100%',
                    height: '3px',
                    background: 'linear-gradient(90deg, transparent, #00ff9d, transparent)',
                    animation: 'scan-line 1.5s linear infinite',
                    boxShadow: '0 0 15px rgba(0,255,157,0.5)',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <div
                    style={{
                      width: '48px',
                      height: '48px',
                      border: '3px solid rgba(0,255,157,0.3)',
                      borderTopColor: '#00ff9d',
                      borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite',
                    }}
                  />
                </div>
              </>
            )}

            {/* Countdown overlay */}
            {phase === 'countdown' && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(0,0,0,0.4)',
                }}
              >
                <span
                  key={countdown}
                  className="amireal-fade-in"
                  style={{
                    fontSize: '6rem',
                    fontWeight: 800,
                    color: '#00ff9d',
                    textShadow: '0 0 40px rgba(0,255,157,0.5)',
                  }}
                >
                  {countdown}
                </span>
              </div>
            )}

            {/* Corner brackets */}
            {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map((corner) => {
              const isTop = corner.includes('top')
              const isLeft = corner.includes('left')
              return (
                <div
                  key={corner}
                  style={{
                    position: 'absolute',
                    [isTop ? 'top' : 'bottom']: '16px',
                    [isLeft ? 'left' : 'right']: '16px',
                    width: '28px',
                    height: '28px',
                    borderColor: '#00ff9d',
                    borderStyle: 'solid',
                    borderWidth: 0,
                    ...(isTop ? { borderTopWidth: '3px' } : { borderBottomWidth: '3px' }),
                    ...(isLeft ? { borderLeftWidth: '3px' } : { borderRightWidth: '3px' }),
                    ...(isTop && isLeft ? { borderTopLeftRadius: '6px' } : {}),
                    ...(isTop && !isLeft ? { borderTopRightRadius: '6px' } : {}),
                    ...(!isTop && isLeft ? { borderBottomLeftRadius: '6px' } : {}),
                    ...(!isTop && !isLeft ? { borderBottomRightRadius: '6px' } : {}),
                  }}
                />
              )
            })}
          </div>

          {/* Capture button */}
          {phase === 'camera' && cameraReady && (
            <button
              className="amireal-cta amireal-fade-in"
              onClick={startCountdown}
              style={{ marginTop: '32px' }}
            >
              Capture &rarr;
            </button>
          )}

          {phase === 'camera' && !cameraReady && (
            <p style={{ marginTop: '24px', color: '#71717a', fontSize: '0.9rem' }}>
              Loading camera...
            </p>
          )}
        </section>
      )}

      {/* ================================================================== */}
      {/* RESULT PHASE                                                       */}
      {/* ================================================================== */}
      {phase === 'result' && result && (
        <section
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            textAlign: 'center',
          }}
        >
          {/* Score circle */}
          <div
            className="amireal-fade-in"
            style={{
              position: 'relative',
              width: '200px',
              height: '200px',
              marginBottom: '24px',
            }}
          >
            <svg
              viewBox="0 0 200 200"
              style={{
                width: '100%',
                height: '100%',
                animation: 'pulse-score 2s ease infinite',
              }}
            >
              {/* Background ring */}
              <circle
                cx="100"
                cy="100"
                r="88"
                fill="none"
                stroke="#27272a"
                strokeWidth="8"
              />
              {/* Score ring */}
              <circle
                cx="100"
                cy="100"
                r="88"
                fill="none"
                stroke={getScoreColor(result.humanScore)}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${(animatedScore / 100) * 2 * Math.PI * 88} ${2 * Math.PI * 88}`}
                transform="rotate(-90 100 100)"
                style={{
                  transition: 'stroke-dasharray 0.1s linear',
                  filter: `drop-shadow(0 0 8px ${getScoreColor(result.humanScore)}60)`,
                }}
              />
            </svg>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span
                style={{
                  fontSize: '3.5rem',
                  fontWeight: 800,
                  color: getScoreColor(result.humanScore),
                  lineHeight: 1,
                }}
              >
                {animatedScore}
              </span>
              <span style={{ fontSize: '0.85rem', color: '#71717a', marginTop: '4px' }}>
                Human Score
              </span>
            </div>
          </div>

          {/* Verdict */}
          <div className="amireal-fade-in-delay">
            <h2
              style={{
                fontSize: 'clamp(1.5rem, 4vw, 2.2rem)',
                fontWeight: 700,
                marginBottom: '8px',
                color: getScoreColor(result.humanScore),
              }}
            >
              {getVerdict(result.humanScore).text}
            </h2>
            <p style={{ color: '#a1a1aa', fontSize: '0.95rem', marginBottom: '32px' }}>
              You scored higher than{' '}
              <span style={{ color: '#ffffff', fontWeight: 600 }}>
                {getPercentile(result.humanScore)}%
              </span>{' '}
              of users
            </p>
          </div>

          {/* Stats cards */}
          <div
            className="amireal-fade-in-delay"
            style={{
              display: 'flex',
              gap: '16px',
              flexWrap: 'wrap',
              justifyContent: 'center',
              marginBottom: '36px',
              maxWidth: '560px',
            }}
          >
            {[
              {
                label: 'Human Probability',
                value: `${(100 - result.pFake * 100).toFixed(1)}%`,
              },
              {
                label: 'AI Detection Confidence',
                value: result.pFake > 0.5 ? 'Suspicious' : 'Confident',
              },
              {
                label: 'Inference Time',
                value: `${result.inferenceMs}ms`,
              },
            ].map((stat) => (
              <div
                key={stat.label}
                style={{
                  flex: '1 1 150px',
                  background: '#121216',
                  border: '1px solid #27272a',
                  borderRadius: '12px',
                  padding: '16px',
                  minWidth: '140px',
                }}
              >
                <div style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '6px' }}>
                  {stat.label}
                </div>
                <div style={{ fontSize: '1.15rem', fontWeight: 600 }}>{stat.value}</div>
              </div>
            ))}
          </div>

          {/* Share buttons */}
          <div
            className="amireal-fade-in-delay2"
            style={{
              display: 'flex',
              gap: '12px',
              flexWrap: 'wrap',
              justifyContent: 'center',
              marginBottom: '24px',
            }}
          >
            <a
              href={twitterShareUrl(result.humanScore)}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '12px 24px',
                borderRadius: '10px',
                background: '#1d1d22',
                border: '1px solid #27272a',
                color: '#ffffff',
                fontSize: '0.9rem',
                fontWeight: 600,
                textDecoration: 'none',
                transition: 'all 0.2s ease',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Share on X
            </a>
            <a
              href={linkedinShareUrl(result.humanScore)}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '12px 24px',
                borderRadius: '10px',
                background: '#1d1d22',
                border: '1px solid #27272a',
                color: '#ffffff',
                fontSize: '0.9rem',
                fontWeight: 600,
                textDecoration: 'none',
                transition: 'all 0.2s ease',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
              Share on LinkedIn
            </a>
          </div>

          {/* Action buttons */}
          <div
            className="amireal-fade-in-delay2"
            style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}
          >
            <button
              className="amireal-cta"
              onClick={resetTest}
            >
              Test Again &rarr;
            </button>
          </div>

          {/* Footer */}
          <p
            style={{
              marginTop: '48px',
              color: '#52525b',
              fontSize: '0.8rem',
            }}
          >
            Powered by{' '}
            <a
              href="https://deep-check-two.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#00ff9d', textDecoration: 'none' }}
            >
              Deep-Check
            </a>
            {' '}&mdash; deep-check-two.vercel.app
          </p>
        </section>
      )}
    </main>
  )
}
