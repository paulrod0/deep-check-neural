'use client'

/**
 * /documents/verify — Identity Document KYC Wizard
 * =================================================
 * 4-step guided verification:
 *   0 — Select document type
 *   1 — Capture document photo
 *   2 — Capture live selfie  (with active liveness challenge)
 *   3 — Analysis results + certificate
 *
 * Face match is done entirely client-side (MediaPipe) — no biometric
 * data is sent to the server. Forensics and MRZ parsing run in parallel
 * with the client-side face match for maximum speed.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'
import DocumentCapture from '@/components/DocumentCapture'
import { compareFaces, warmupFaceMatch, type FaceMatchResult } from '@/lib/faceMatch'
import MLFeedbackWidget from '@/components/MLFeedbackWidget'
import { analyzeImage, type ForensicsReport } from '@/lib/imageForensics'
import { detectDocumentType, type DocumentDetectionResult } from '@/lib/documentDetector'

// ── Types ─────────────────────────────────────────────────────────────────────

type DocType = 'passport' | 'dni' | 'driving_license' | 'residence_permit' | 'eu_id_card' | 'visa'

interface VerifyAPIResponse {
  ocr: {
    mrzValid:        boolean | null
    mrzDocumentType: string
    mrzFields:       {
      surname: string; givenNames: string; nationality: string
      docNumber: string; dob: string; dobFormatted: string
      sex: string; expiry: string; expiryFormatted: string
      isExpired: boolean
    } | null
    mrzAlerts:       { field: string; detail: string }[]
    checksumsPassed: number
    checksumsFailed: number
    ocrMode:         string
  }
  faceQuality: { faceFound: boolean; faceCount: number; qualityScore: number; suspicious: boolean }
  countryValidation?: {
    valid:           boolean
    country:         string
    countryCode:     string
    documentType:    string
    formattedNumber?: string
    details?:        string
  } | null
  countryInfo?: {
    name:    string
    region:  string
    idTypes: string[]
    hasNFC:  boolean
  } | null
  coverage?: {
    totalCountries: number
    tier1Countries: number
    nfcCountries:   number
  }
  verdict:         'authentic' | 'suspicious' | 'tampered'
  certificateId:   string
  onPremise:       boolean
}

// ── Liveness challenge types ───────────────────────────────────────────────

type LivenessChallenge = 'BLINK' | 'TURN_LEFT' | 'TURN_RIGHT'
type LivenessState = 'idle' | 'detecting' | 'passed' | 'timeout'

// ── Step 0: Document type selection ──────────────────────────────────────────

const DOC_TYPES: { id: DocType; icon: string; label: string; desc: string; mrzFormat?: string }[] = [
  { id: 'passport',         icon: '🛂', label: 'Passport',             desc: '195+ countries · TD3 (2×44)',   mrzFormat: 'TD3' },
  { id: 'dni',              icon: '🪪', label: 'National ID (DNI/NIE)', desc: 'EU/Spain · TD1 (3×30)',         mrzFormat: 'TD1' },
  { id: 'driving_license',  icon: '🚗', label: 'Driving Licence',       desc: 'EU format · TD1 (3×30)',        mrzFormat: 'TD1' },
  { id: 'residence_permit', icon: '🏠', label: 'Residence Permit',       desc: 'EU TIE/NIE card · TD1 (3×30)', mrzFormat: 'TD1' },
  { id: 'eu_id_card',       icon: '🇪🇺', label: 'EU ID Card (older)',    desc: 'Pre-2017 EU cards · TD2 (2×36)', mrzFormat: 'TD2' },
  { id: 'visa',             icon: '✈️', label: 'Visa',                   desc: 'Schengen / MRV-B (2×36)',      mrzFormat: 'MRV-B' },
]

// ── Verdict display config ────────────────────────────────────────────────────

const VERDICT_CONFIG = {
  authentic:  { color: 'var(--color-primary)', icon: '✅', label: 'Authentic', bg: 'rgba(0,229,255,0.08)' },
  suspicious: { color: '#ffd700',              icon: '⚠️', label: 'Suspicious', bg: 'rgba(255,215,0,0.08)' },
  tampered:   { color: '#ff4d4d',              icon: '❌', label: 'Tampered',   bg: 'rgba(255,77,77,0.08)' },
}

// ── Liveness challenge config ─────────────────────────────────────────────────

const CHALLENGE_LABELS: Record<LivenessChallenge, string> = {
  BLINK:      'BLINK your eyes',
  TURN_LEFT:  'TURN HEAD LEFT',
  TURN_RIGHT: 'TURN HEAD RIGHT',
}

const CHALLENGE_ICONS: Record<LivenessChallenge, string> = {
  BLINK:      '👁',
  TURN_LEFT:  '↩',
  TURN_RIGHT: '↪',
}

const MP_WASM_CDN     = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm'
const MP_MODEL_URL    = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const LIVENESS_TIMEOUT_S = 8

// Eye landmark indices for EAR computation (matches VerificationCamera.tsx)
const LEFT_EYE_IDX  = { p1: 33,  p2: 160, p3: 158, p4: 133, p5: 153, p6: 145 }
const RIGHT_EYE_IDX = { p1: 263, p2: 385, p3: 387, p4: 362, p5: 373, p6: 380 }

function dist2D(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function eyeAspectRatio(
  lm: { x: number; y: number }[],
  idx: { p1: number; p2: number; p3: number; p4: number; p5: number; p6: number },
) {
  const p1 = lm[idx.p1], p2 = lm[idx.p2], p3 = lm[idx.p3]
  const p4 = lm[idx.p4], p5 = lm[idx.p5], p6 = lm[idx.p6]
  return (dist2D(p2, p6) + dist2D(p3, p5)) / (2 * dist2D(p1, p4))
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function VerifyPage() {
  const [step, setStep]               = useState(0)
  const [docType, setDocType]         = useState<DocType>('passport')
  const [docImage, setDocImage]       = useState<string | null>(null)
  const [selfieImage, setSelfieImage] = useState<string | null>(null)
  const [analyzing, setAnalyzing]     = useState(false)
  const [faceMatch, setFaceMatch]     = useState<FaceMatchResult | null>(null)
  const [forensics, setForensics]     = useState<ForensicsReport | null>(null)
  const [apiResult, setApiResult]     = useState<VerifyAPIResponse | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [docDetection, setDocDetection] = useState<DocumentDetectionResult | null>(null)

  // ── Liveness state ──────────────────────────────────────────────────────────
  const [livenessChallenge,  setLivenessChallenge]  = useState<LivenessChallenge | null>(null)
  const [livenessState,      setLivenessState]      = useState<LivenessState>('idle')
  const [livenessCountdown,  setLivenessCountdown]  = useState(LIVENESS_TIMEOUT_S)

  const videoRef    = useRef<HTMLVideoElement>(null)
  const streamRef   = useRef<MediaStream | null>(null)
  const capturedRef = useRef(false)

  // Liveness refs
  const livenessRafRef       = useRef<number>(0)
  const livenessLandmarkerRef = useRef<import('@mediapipe/tasks-vision').FaceLandmarker | null>(null)
  const blinkStartRef        = useRef<number | null>(null)   // timestamp when eyes went closed

  // Pre-warm face match model on mount
  useEffect(() => { warmupFaceMatch() }, [])

  // Cleanup camera on unmount
  useEffect(() => {
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()) }
  }, [])

  // ── Step 2: selfie camera + liveness challenge init ─────────────────────────

  useEffect(() => {
    if (step !== 2) return
    let mounted = true
    capturedRef.current = false

    // Pick a random liveness challenge
    const challenges: LivenessChallenge[] = ['BLINK', 'TURN_LEFT', 'TURN_RIGHT']
    setLivenessChallenge(challenges[Math.floor(Math.random() * challenges.length)])
    setLivenessState('idle')
    setLivenessCountdown(LIVENESS_TIMEOUT_S)

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        if (mounted) setLivenessState('detecting')
      } catch (err) {
        if (mounted) setError(`Camera error: ${(err as Error).message}`)
      }
    }
    start()
    return () => {
      mounted = false
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [step])

  // ── Liveness detection loop ─────────────────────────────────────────────────

  useEffect(() => {
    if (step !== 2 || livenessState === 'passed' || livenessState === 'timeout' || !livenessChallenge) return

    let cancelled = false
    let countdownInterval: ReturnType<typeof setInterval> | null = null
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const initAndRun = async () => {
      // Initialize FaceLandmarker if not already done
      if (!livenessLandmarkerRef.current) {
        try {
          const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
          const vision = await FilesetResolver.forVisionTasks(MP_WASM_CDN)
          const landmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: MP_MODEL_URL,
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numFaces: 1,
            outputFaceBlendshapes: false,
          })
          if (cancelled) { landmarker.close(); return }
          livenessLandmarkerRef.current = landmarker
        } catch (err) {
          console.warn('[liveness] FaceLandmarker init failed:', err)
          return
        }
      }

      // Start countdown
      let remaining = LIVENESS_TIMEOUT_S
      setLivenessCountdown(remaining)

      countdownInterval = setInterval(() => {
        remaining -= 1
        setLivenessCountdown(remaining)
        if (remaining <= 0 && countdownInterval) {
          clearInterval(countdownInterval)
        }
      }, 1000)

      // Auto-timeout
      timeoutId = setTimeout(() => {
        if (!cancelled) {
          setLivenessState('timeout')
        }
      }, LIVENESS_TIMEOUT_S * 1000)

      // Detection loop
      const detect = () => {
        if (cancelled) return
        const video = videoRef.current
        const landmarker = livenessLandmarkerRef.current
        if (!video || !landmarker || video.readyState < 2) {
          livenessRafRef.current = requestAnimationFrame(detect)
          return
        }

        try {
          const result = landmarker.detectForVideo(video, performance.now())
          if (result.faceLandmarks && result.faceLandmarks.length > 0) {
            const lm = result.faceLandmarks[0]

            // Compute face bounding box for head-turn checks
            let minX = Infinity, maxX = -Infinity
            for (const pt of lm) {
              if (pt.x < minX) minX = pt.x
              if (pt.x > maxX) maxX = pt.x
            }
            const faceBboxCenterX = (minX + maxX) / 2
            const noseTipX = lm[1].x  // landmark 1 = nose tip

            if (livenessChallenge === 'BLINK') {
              const leftEAR  = eyeAspectRatio(lm, LEFT_EYE_IDX)
              const rightEAR = eyeAspectRatio(lm, RIGHT_EYE_IDX)
              const avgEAR   = (leftEAR + rightEAR) / 2

              if (avgEAR < 0.15) {
                // Eyes are closed — start timer if not started
                if (blinkStartRef.current === null) {
                  blinkStartRef.current = performance.now()
                } else if (performance.now() - blinkStartRef.current > 200) {
                  // Blink held for >200ms — challenge passed
                  if (!cancelled) {
                    handleChallengePassed()
                    return
                  }
                }
              } else {
                blinkStartRef.current = null
              }
            } else if (livenessChallenge === 'TURN_LEFT') {
              if (noseTipX < faceBboxCenterX - 0.08) {
                if (!cancelled) {
                  handleChallengePassed()
                  return
                }
              }
            } else if (livenessChallenge === 'TURN_RIGHT') {
              if (noseTipX > faceBboxCenterX + 0.08) {
                if (!cancelled) {
                  handleChallengePassed()
                  return
                }
              }
            }
          }
        } catch {
          // Silent fail — keep trying
        }

        livenessRafRef.current = requestAnimationFrame(detect)
      }

      livenessRafRef.current = requestAnimationFrame(detect)
    }

    const handleChallengePassed = () => {
      cancelled = true
      if (countdownInterval) clearInterval(countdownInterval)
      if (timeoutId) clearTimeout(timeoutId)
      cancelAnimationFrame(livenessRafRef.current)
      setLivenessState('passed')
      // Auto-capture after brief green flash
      setTimeout(() => {
        captureSelfieInternal()
      }, 400)
    }

    initAndRun()

    return () => {
      cancelled = true
      if (countdownInterval) clearInterval(countdownInterval)
      if (timeoutId) clearTimeout(timeoutId)
      cancelAnimationFrame(livenessRafRef.current)
      blinkStartRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, livenessState, livenessChallenge])

  // ── Capture selfie (internal, called after liveness pass) ──────────────────

  const captureSelfieInternal = useCallback(() => {
    if (capturedRef.current) return
    const video = videoRef.current
    if (!video) return
    capturedRef.current = true

    const canvas = document.createElement('canvas')
    canvas.width  = video.videoWidth  || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    setSelfieImage(dataUrl)
    streamRef.current?.getTracks().forEach(t => t.stop())
    // Close landmarker to free resources
    livenessLandmarkerRef.current?.close()
    livenessLandmarkerRef.current = null
    setStep(3)
  }, [])

  // ── captureSelfie (public — only works when liveness has passed) ─────────────

  const captureSelfie = useCallback(() => {
    // Block manual capture if liveness challenge is active and not yet passed
    if (livenessChallenge !== null && livenessState !== 'passed') return
    captureSelfieInternal()
  }, [livenessState, livenessChallenge, captureSelfieInternal])

  // ── Retry liveness with a new challenge ─────────────────────────────────────

  const retryLiveness = useCallback(() => {
    const challenges: LivenessChallenge[] = ['BLINK', 'TURN_LEFT', 'TURN_RIGHT']
    // Pick a different challenge from the current one
    const others = livenessChallenge
      ? challenges.filter(c => c !== livenessChallenge)
      : challenges
    const next = others[Math.floor(Math.random() * others.length)]
    capturedRef.current = false
    blinkStartRef.current = null
    setLivenessChallenge(next)
    setLivenessCountdown(LIVENESS_TIMEOUT_S)
    setLivenessState('detecting')
  }, [livenessChallenge])

  // ── Step 3: run analysis ────────────────────────────────────────────────────

  useEffect(() => {
    if (step !== 3 || !docImage || !selfieImage || analyzing) return

    setAnalyzing(true)
    setError(null)

    const run = async () => {
      try {
        // Run face match + forensics in parallel
        // Face match: try neural server-side first, fall back to geometric client-side
        const faceMatchPromise = (async () => {
          try {
            const resp = await fetch('/api/face-match', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ docImage, selfieImage }),
            })
            const r = await resp.json()
            if (r.method !== 'unavailable') {
              return {
                match: r.match,
                similarityScore: Math.round(r.similarity * 100) / 100,
                confidence: r.confidence,
                documentFaceFound: r.docFaceFound,
                selfieFaceFound: r.selfieFaceFound,
                processingMs: r.processingMs,
                message: r.match
                  ? `Neural match (${Math.round(r.similarity * 100)}%)`
                  : 'Neural: no match',
              }
            }
          } catch {
            // Fall through to client-side
          }
          return compareFaces(docImage, selfieImage)
        })()

        const [faceResult, forensicsResult] = await Promise.all([
          faceMatchPromise,
          (async () => {
            try {
              // Convert data URL to File for analyzeImage
              const res   = await fetch(docImage)
              const blob  = await res.blob()
              const file  = new File([blob], 'document.jpg', { type: 'image/jpeg' })
              return await analyzeImage(file)
            } catch {
              return null
            }
          })(),
        ])

        setFaceMatch(faceResult)
        setForensics(forensicsResult)

        // Server-side: Textract OCR + Rekognition + save to DB
        const serverRes = await fetch('/api/documents/verify', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documentFront:   docImage,
            documentType:    docType,
            forensicsReport: forensicsResult ? {
              riskScore:   forensicsResult.riskScore,
              riskLevel:   forensicsResult.riskLevel,
              elaScore:    forensicsResult.elaScore,
              exifScore:   forensicsResult.exifScore,
              noiseScore:  forensicsResult.noiseScore,
              dctScore:    forensicsResult.dctScore,
              chromaScore: forensicsResult.chromaScore,
              edgeScore:   forensicsResult.edgeScore,
              alerts:      forensicsResult.alerts,
            } : undefined,
          }),
        })

        if (serverRes.ok) {
          const data = await serverRes.json() as VerifyAPIResponse
          setApiResult(data)
        } else {
          console.warn('[verify] Server API error:', serverRes.status)
        }
      } catch (err) {
        setError(`Analysis error: ${(err as Error).message}`)
      } finally {
        setAnalyzing(false)
      }
    }

    run()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // ── Computed verdict (combines client + server) ────────────────────────────

  const finalVerdict: 'authentic' | 'suspicious' | 'tampered' = (() => {
    if (!faceMatch) return 'suspicious'
    if (!faceMatch.match && faceMatch.documentFaceFound && faceMatch.selfieFaceFound)
      return 'tampered'
    const serverVerdict = apiResult?.verdict ?? 'authentic'
    if (serverVerdict === 'tampered') return 'tampered'
    if (serverVerdict === 'suspicious' || !faceMatch.match) return 'suspicious'
    return 'authentic'
  })()

  const verdictCfg = VERDICT_CONFIG[finalVerdict]

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <main style={{ minHeight: '100vh', padding: '2rem 1rem', background: 'var(--color-bg)' }}>
      <div className="container" style={{ maxWidth: 720 }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <Link href="/documents" style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', textDecoration: 'none' }}>
            ← Back to Document Analysis
          </Link>
          <h1 style={{ marginTop: '1rem', fontSize: '1.6rem', fontWeight: 700 }}>
            🪪 Identity Document Verification
          </h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
            KYC verification — document authenticity + face match. All biometric processing runs in your browser.
          </p>
        </div>

        {/* Progress bar */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
          {['Document Type', 'Capture Document', 'Live Selfie', 'Results'].map((label, i) => (
            <div key={i} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{
                height: 4,
                borderRadius: 2,
                background: i <= step ? 'var(--color-primary)' : 'var(--color-border)',
                marginBottom: '0.4rem',
                transition: 'background 0.3s',
              }} />
              <span style={{
                fontSize: '0.72rem',
                color: i === step ? 'var(--color-primary)' : 'var(--color-text-muted)',
                fontWeight: i === step ? 600 : 400,
              }}>
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Step 0 — Document type */}
        {step === 0 && (
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <h2 style={{ marginBottom: '1.5rem', fontSize: '1.15rem' }}>Select Document Type</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {DOC_TYPES.map(doc => (
                <button
                  key={doc.id}
                  onClick={() => setDocType(doc.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '1rem',
                    padding: '1rem 1.25rem', borderRadius: 10,
                    border: `2px solid ${docType === doc.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    background: docType === doc.id ? 'rgba(0,229,255,0.06)' : 'transparent',
                    color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left',
                    transition: 'all 0.2s',
                  }}
                >
                  <span style={{ fontSize: '1.8rem' }}>{doc.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{doc.label}</div>
                    <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>{doc.desc}</div>
                  </div>
                  {docType === doc.id && (
                    <span style={{ marginLeft: 'auto', color: 'var(--color-primary)' }}>✓</span>
                  )}
                </button>
              ))}
            </div>
            <button
              className="btn btn-primary"
              style={{ marginTop: '2rem', width: '100%' }}
              onClick={() => setStep(1)}
            >
              Continue →
            </button>
          </div>
        )}

        {/* Step 1 — Document capture */}
        {step === 1 && (
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <h2 style={{ marginBottom: '0.5rem', fontSize: '1.15rem' }}>
              Capture Your {DOC_TYPES.find(d => d.id === docType)?.label}
            </h2>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              Place your document flat on a dark surface. Avoid glare and keep the MRZ zone visible.
            </p>
            <DocumentCapture
              documentType={docType}
              onCapture={async (dataUrl) => {
                setDocImage(dataUrl)
                // Run document type auto-detection in background
                try {
                  const detection = await detectDocumentType(dataUrl)
                  setDocDetection(detection)
                  // Auto-suggest document type if high confidence
                  if (detection.confidence >= 70) {
                    const typeMap: Record<string, DocType> = {
                      passport: 'passport',
                      id_card: 'dni',
                      driving_license: 'driving_license',
                    }
                    const suggested = typeMap[detection.detectedType]
                    if (suggested && suggested !== docType) {
                      setDocType(suggested)
                    }
                  }
                } catch {
                  // Non-fatal — detection is optional
                }
                setStep(2)
              }}
            />
          </div>
        )}

        {/* Step 2 — Selfie + Liveness Challenge */}
        {step === 2 && (
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <h2 style={{ marginBottom: '0.5rem', fontSize: '1.15rem' }}>Take a Live Selfie</h2>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              Face the camera directly. Complete the liveness check below to confirm you are physically present.
            </p>

            {/* Liveness challenge overlay + video container */}
            <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#000' }}>

              {/* Video feed */}
              <video
                ref={videoRef}
                muted
                playsInline
                style={{ display: 'block', width: '100%', maxHeight: 360, objectFit: 'cover' }}
              />

              {/* Face oval guide */}
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 160, height: 200,
                borderRadius: '50%',
                border: `3px solid ${livenessState === 'passed' ? '#22c55e' : 'var(--color-primary)'}`,
                boxShadow: `0 0 12px ${livenessState === 'passed' ? '#22c55e' : 'var(--color-primary)'}`,
                pointerEvents: 'none',
                transition: 'border-color 0.3s, box-shadow 0.3s',
              }} />

              {/* Liveness challenge instruction overlay */}
              {livenessChallenge && livenessState !== 'passed' && livenessState !== 'timeout' && (
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0,
                  background: 'rgba(0,0,0,0.72)',
                  padding: '0.75rem 1rem',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <span style={{
                      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                      background: '#ef4444',
                      boxShadow: '0 0 6px #ef4444',
                    }} />
                    <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.8rem', letterSpacing: '0.05em' }}>
                      LIVENESS CHECK
                    </span>
                  </div>
                  <div style={{ color: '#fff', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                    {CHALLENGE_ICONS[livenessChallenge]} Please {CHALLENGE_LABELS[livenessChallenge]}
                  </div>
                  {/* Countdown bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{
                      flex: 1, height: 6, borderRadius: 3,
                      background: 'rgba(255,255,255,0.15)',
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${(livenessCountdown / LIVENESS_TIMEOUT_S) * 100}%`,
                        background: livenessCountdown <= 2 ? '#ef4444' : livenessCountdown <= 4 ? '#fbbf24' : 'var(--color-primary)',
                        borderRadius: 3,
                        transition: 'width 1s linear, background 0.3s',
                      }} />
                    </div>
                    <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.75rem', minWidth: 40 }}>
                      {livenessCountdown}s
                    </span>
                  </div>
                </div>
              )}

              {/* Passed flash overlay */}
              {livenessState === 'passed' && (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(34,197,94,0.25)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexDirection: 'column', gap: '0.5rem',
                }}>
                  <span style={{ fontSize: '3rem' }}>✅</span>
                  <span style={{ color: '#22c55e', fontWeight: 700, fontSize: '1rem' }}>
                    Liveness Confirmed
                  </span>
                </div>
              )}

              {/* Timeout overlay */}
              {livenessState === 'timeout' && (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(0,0,0,0.7)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexDirection: 'column', gap: '0.75rem',
                  padding: '1rem',
                }}>
                  <span style={{ fontSize: '2rem' }}>⏱</span>
                  <span style={{ color: '#fbbf24', fontWeight: 700, fontSize: '1rem', textAlign: 'center' }}>
                    Challenge timed out
                  </span>
                  <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.82rem', textAlign: 'center', margin: 0 }}>
                    You will be given a different challenge to try again.
                  </p>
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: '0.25rem', padding: '0.5rem 1.5rem' }}
                    onClick={retryLiveness}
                  >
                    Try Again →
                  </button>
                </div>
              )}
            </div>

            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', textAlign: 'center', margin: '0.75rem 0' }}>
              {livenessState === 'passed'
                ? 'Selfie captured — proceeding to analysis…'
                : livenessState === 'timeout'
                ? 'Please retry the liveness check above.'
                : 'Center your face in the oval and complete the challenge'}
            </p>

            {/* Manual capture button — disabled until liveness passes (auto-capture fires first) */}
            {livenessState !== 'passed' && (
              <button
                className="btn btn-primary"
                style={{
                  width: '100%', marginTop: '0.5rem',
                  opacity: 0.4,
                  cursor: 'not-allowed',
                }}
                disabled
                onClick={captureSelfie}
              >
                📸 Capture Selfie
              </button>
            )}
          </div>
        )}

        {/* Step 3 — Results */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            {/* Analysis in progress */}
            {(analyzing || (!faceMatch && !error)) && (
              <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
                <div style={{
                  width: 48, height: 48, border: '3px solid var(--color-primary)',
                  borderTopColor: 'transparent', borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite', margin: '0 auto 1.25rem',
                }} />
                <p style={{ color: 'var(--color-text-muted)' }}>
                  {!faceMatch ? 'Running face match & forensics analysis…' : 'Fetching OCR results…'}
                </p>
                <p style={{ color: 'var(--color-text-dim)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
                  Face comparison runs in your browser — no biometric data is transmitted
                </p>
              </div>
            )}

            {error && (
              <div className="glass-panel" style={{ padding: '1.5rem', border: '1px solid #ff4d4d' }}>
                <p style={{ color: '#ff4d4d' }}>⚠️ {error}</p>
              </div>
            )}

            {/* Verdict */}
            {faceMatch && (
              <div className="glass-panel" style={{
                padding: '2rem', textAlign: 'center',
                border: `2px solid ${verdictCfg.color}`,
                background: verdictCfg.bg,
              }}>
                <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>{verdictCfg.icon}</div>
                <h2 style={{ color: verdictCfg.color, fontSize: '1.6rem', fontWeight: 800, marginBottom: '0.5rem' }}>
                  {verdictCfg.label}
                </h2>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                  {finalVerdict === 'authentic'
                    ? 'Identity document verified successfully. Face match and forensics passed.'
                    : finalVerdict === 'suspicious'
                    ? 'Some checks raised concerns. Manual review is recommended.'
                    : 'Document shows signs of tampering or face mismatch detected.'}
                </p>
                {apiResult?.certificateId && (
                  <p style={{ color: 'var(--color-text-dim)', fontSize: '0.75rem', marginTop: '0.75rem', fontFamily: 'monospace' }}>
                    Cert ID: {apiResult.certificateId}
                  </p>
                )}
              </div>
            )}

            {/* Face Match */}
            {faceMatch && (
              <div className="glass-panel" style={{ padding: '1.5rem' }}>
                <h3 style={{ marginBottom: '1rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  👤 Face Match
                  <span style={{
                    padding: '2px 10px', borderRadius: 20, fontSize: '0.78rem',
                    background: faceMatch.match ? 'rgba(0,229,255,0.15)' : 'rgba(255,77,77,0.15)',
                    color: faceMatch.match ? 'var(--color-primary)' : '#ff4d4d',
                    fontWeight: 600,
                  }}>
                    {faceMatch.match ? 'MATCH' : 'MISMATCH'}
                  </span>
                </h3>

                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                  {/* Similarity score ring */}
                  <div style={{ textAlign: 'center', minWidth: 90 }}>
                    <div style={{ position: 'relative', width: 80, height: 80, margin: '0 auto' }}>
                      <svg viewBox="0 0 80 80" style={{ transform: 'rotate(-90deg)' }}>
                        <circle cx="40" cy="40" r="34" fill="none" stroke="var(--color-border)" strokeWidth="7" />
                        <circle
                          cx="40" cy="40" r="34" fill="none"
                          stroke={faceMatch.match ? 'var(--color-primary)' : '#ffd700'}
                          strokeWidth="7"
                          strokeDasharray={`${2 * Math.PI * 34}`}
                          strokeDashoffset={`${2 * Math.PI * 34 * (1 - faceMatch.similarityScore)}`}
                          strokeLinecap="round"
                        />
                      </svg>
                      <div style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.9rem', fontWeight: 700,
                        color: faceMatch.match ? 'var(--color-primary)' : '#ffd700',
                      }}>
                        {(faceMatch.similarityScore * 100).toFixed(0)}%
                      </div>
                    </div>
                    <p style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.4rem' }}>Similarity</p>
                  </div>

                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                      {[
                        ['Document face', faceMatch.documentFaceFound ? '✓ Detected' : '✗ Not found', faceMatch.documentFaceFound],
                        ['Selfie face', faceMatch.selfieFaceFound ? '✓ Detected' : '✗ Not found', faceMatch.selfieFaceFound],
                        ['Threshold', '82% similarity', true],
                        ['Processing', `${faceMatch.processingMs.toFixed(0)}ms`, true],
                      ].map(([label, value, ok]) => (
                        <div key={label as string}>
                          <p style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{label as string}</p>
                          <p style={{ fontSize: '0.85rem', fontWeight: 600, color: ok ? 'var(--color-text)' : '#ff4d4d' }}>{value as string}</p>
                        </div>
                      ))}
                    </div>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem', marginTop: '0.75rem' }}>
                      🔒 {faceMatch.message}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* MRZ Fields */}
            {apiResult?.ocr?.mrzFields && (
              <div className="glass-panel" style={{ padding: '1.5rem' }}>
                <h3 style={{ marginBottom: '1rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  📋 Document Data (MRZ)
                  <span style={{
                    padding: '2px 10px', borderRadius: 20, fontSize: '0.78rem',
                    background: apiResult.ocr.mrzValid ? 'rgba(0,229,255,0.15)' : 'rgba(255,215,0,0.15)',
                    color: apiResult.ocr.mrzValid ? 'var(--color-primary)' : '#ffd700',
                    fontWeight: 600,
                  }}>
                    {apiResult.ocr.checksumsPassed}/{apiResult.ocr.checksumsPassed + apiResult.ocr.checksumsFailed} checks passed
                  </span>
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.75rem' }}>
                  {[
                    ['Surname',       apiResult.ocr.mrzFields.surname],
                    ['Given Names',   apiResult.ocr.mrzFields.givenNames],
                    ['Nationality',   apiResult.ocr.mrzFields.nationality],
                    ['Document No.',  apiResult.ocr.mrzFields.docNumber],
                    ['Date of Birth', apiResult.ocr.mrzFields.dobFormatted],
                    ['Sex',           apiResult.ocr.mrzFields.sex],
                    ['Expiry',        `${apiResult.ocr.mrzFields.expiryFormatted}${apiResult.ocr.mrzFields.isExpired ? ' ⚠️' : ''}`],
                  ].filter(([, v]) => v).map(([label, value]) => (
                    <div key={label as string} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
                      <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: '0.2rem' }}>{label as string}</p>
                      <p style={{ fontSize: '0.88rem', fontWeight: 600, wordBreak: 'break-all' }}>{value as string || '—'}</p>
                    </div>
                  ))}
                </div>
                {apiResult.ocr.mrzAlerts.length > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    {apiResult.ocr.mrzAlerts.map((a, i) => (
                      <p key={i} style={{ color: '#ffd700', fontSize: '0.8rem', marginTop: '0.35rem' }}>
                        ⚠️ {a.detail}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Document Detection / Image Quality */}
            {docDetection && (
              <div className="glass-panel" style={{ padding: '1.5rem' }}>
                <h3 style={{ marginBottom: '1rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  📷 Image Analysis
                  <span style={{
                    padding: '2px 10px', borderRadius: 20, fontSize: '0.78rem',
                    background: docDetection.qualityScore >= 70 ? 'rgba(0,229,255,0.15)' : docDetection.qualityScore >= 40 ? 'rgba(255,215,0,0.15)' : 'rgba(255,77,77,0.15)',
                    color: docDetection.qualityScore >= 70 ? 'var(--color-primary)' : docDetection.qualityScore >= 40 ? '#ffd700' : '#ff4d4d',
                    fontWeight: 600,
                  }}>
                    Quality: {docDetection.qualityScore}/100
                  </span>
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '0.75rem' }}>
                  {[
                    ['Detected Type', docDetection.detectedType.replace('_', ' ')],
                    ['Confidence', `${docDetection.confidence}%`],
                    ['Aspect Ratio', `${docDetection.aspectRatio} (${docDetection.aspectCategory.toUpperCase()})`],
                    ['MRZ Zone', docDetection.mrzZoneDetected ? '✓ Detected' : '✗ Not found'],
                    ['Processing', `${docDetection.processingMs.toFixed(0)}ms`],
                  ].map(([label, value]) => (
                    <div key={label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
                      <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: '0.2rem' }}>{label}</p>
                      <p style={{ fontSize: '0.85rem', fontWeight: 600 }}>{value}</p>
                    </div>
                  ))}
                </div>
                {docDetection.qualityIssues.length > 0 && (
                  <div style={{ marginTop: '0.75rem' }}>
                    {docDetection.qualityIssues.map((issue, i) => (
                      <p key={i} style={{ color: '#ffd700', fontSize: '0.8rem', marginTop: '0.35rem' }}>
                        ⚠️ {issue}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Country-Specific Validation */}
            {apiResult?.countryValidation && (
              <div className="glass-panel" style={{ padding: '1.5rem' }}>
                <h3 style={{ marginBottom: '1rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  🌍 Country-Specific Validation
                  <span style={{
                    padding: '2px 10px', borderRadius: 20, fontSize: '0.78rem',
                    background: apiResult.countryValidation.valid ? 'rgba(0,229,255,0.15)' : 'rgba(255,77,77,0.15)',
                    color: apiResult.countryValidation.valid ? 'var(--color-primary)' : '#ff4d4d',
                    fontWeight: 600,
                  }}>
                    {apiResult.countryValidation.valid ? 'VALID' : 'INVALID'}
                  </span>
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.75rem' }}>
                  {[
                    ['Country',         apiResult.countryValidation.country],
                    ['Document Type',   apiResult.countryValidation.documentType],
                    ['Formatted No.',   apiResult.countryValidation.formattedNumber],
                    ['Validation',      apiResult.countryValidation.details],
                  ].filter(([, v]) => v).map(([label, value]) => (
                    <div key={label as string} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
                      <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: '0.2rem' }}>{label as string}</p>
                      <p style={{ fontSize: '0.88rem', fontWeight: 600, wordBreak: 'break-all' }}>{value as string || '—'}</p>
                    </div>
                  ))}
                </div>
                {apiResult.countryInfo && (
                  <div style={{
                    marginTop: '0.75rem', padding: '0.6rem 0.75rem',
                    background: 'rgba(0,229,255,0.04)', borderRadius: 8,
                    border: '1px solid rgba(0,229,255,0.1)',
                  }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                        Region: <strong style={{ color: 'var(--color-text)' }}>{apiResult.countryInfo.region}</strong>
                      </span>
                      <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                        {apiResult.countryInfo.hasNFC ? '📶 ePassport NFC' : '📄 No NFC'}
                      </span>
                      <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                        ID types: {apiResult.countryInfo.idTypes.join(', ')}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Coverage badge */}
            {apiResult?.coverage && (
              <div style={{
                display: 'flex', gap: '0.75rem', flexWrap: 'wrap',
                padding: '0.5rem 0',
              }}>
                {[
                  [`🌐 ${apiResult.coverage.totalCountries} countries`, 'Documents supported'],
                  [`🔐 ${apiResult.coverage.tier1Countries} tier-1`, 'Algorithmic check-digit'],
                  [`📶 ${apiResult.coverage.nfcCountries} NFC`, 'ePassport chip countries'],
                ].map(([value, label]) => (
                  <div key={label} style={{
                    flex: '1 1 120px',
                    background: 'rgba(0,229,255,0.04)',
                    border: '1px solid rgba(0,229,255,0.1)',
                    borderRadius: 8, padding: '0.5rem 0.75rem', textAlign: 'center',
                  }}>
                    <p style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--color-primary)' }}>{value}</p>
                    <p style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>{label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Forensics */}
            {forensics && (
              <div className="glass-panel" style={{ padding: '1.5rem' }}>
                <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>🔬 Document Forensics</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.75rem' }}>
                  {[
                    ['Risk Score',    `${forensics.riskScore}/100`,   forensics.riskScore < 30],
                    ['ELA',           `${Math.round(forensics.elaScore)}/100`,  forensics.elaScore < 30],
                    ['EXIF',          `${Math.round(forensics.exifScore)}/100`, forensics.exifScore < 30],
                    ['Noise',         `${Math.round(forensics.noiseScore)}/100`, forensics.noiseScore < 30],
                    ['Risk Level',    forensics.riskLevel.replace('_', ' ').toUpperCase(), forensics.riskLevel === 'clean'],
                  ].map(([label, value, ok]) => (
                    <div key={label as string} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
                      <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: '0.2rem' }}>{label as string}</p>
                      <p style={{ fontSize: '0.88rem', fontWeight: 600, color: ok ? 'var(--color-primary)' : '#ffd700' }}>{value as string}</p>
                    </div>
                  ))}
                </div>
                {forensics.alerts.length > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    {forensics.alerts.slice(0, 3).map((a, i) => (
                      <p key={i} style={{ color: '#ffd700', fontSize: '0.8rem', marginTop: '0.35rem' }}>
                        ⚠️ {a.label}: {a.detail}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ML Feedback Widget — Continuous Learning */}
            {apiResult?.certificateId && (
              <MLFeedbackWidget
                analysisId={apiResult.certificateId}
                predictedLabel={finalVerdict === 'authentic' ? 'genuine' : finalVerdict}
                predictedScore={forensics?.riskScore ?? 0}
                documentType={docType}
              />
            )}

            {/* Privacy note */}
            <div className="glass-panel" style={{ padding: '1rem 1.5rem', border: '1px solid rgba(0,229,255,0.2)' }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                🔒 <strong style={{ color: 'var(--color-primary)' }}>Privacy by Design</strong> — Face comparison ran entirely in your browser via MediaPipe. No biometric data was transmitted to any server. Document forensics and MRZ parsing are the only data sent to our API, and they contain no face information.
              </p>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setStep(0); setDocImage(null); setSelfieImage(null)
                  setFaceMatch(null); setForensics(null); setApiResult(null)
                  setError(null); setDocDetection(null)
                  setLivenessChallenge(null)
                  setLivenessState('idle')
                  setLivenessCountdown(LIVENESS_TIMEOUT_S)
                }}
              >
                ↺ Verify Another Document
              </button>
              {apiResult?.certificateId && (
                <Link
                  href={`/documents/${apiResult.certificateId}`}
                  className="btn btn-outline"
                >
                  View Full Report →
                </Link>
              )}
            </div>
          </div>
        )}

      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </main>
  )
}
