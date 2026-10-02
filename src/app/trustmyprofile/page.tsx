'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'

// ── Constants ────────────────────────────────────────────────────────────────

const MATCH_THRESHOLD = 0.82
const MP_WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm'
const MP_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const DEEPFAKE_MODEL_URL = '/models/deepfake/deepfake_pixel_v1.onnx'

const NOSE_TIP = 1
const LEFT_EYE_PUPIL = 33
const RIGHT_EYE_PUPIL = 263

const IMAGENET_MEAN = [0.485, 0.456, 0.406]
const IMAGENET_STD = [0.229, 0.224, 0.225]

// ── Types ────────────────────────────────────────────────────────────────────

type VerifyMode = 'check_profile' | 'verify_self'
type Step = 'landing' | 'upload' | 'selfie' | 'verifying' | 'result'

interface Landmark {
  x: number
  y: number
  z: number
}

interface VerificationResult {
  match: boolean
  similarity: number
  confidence: number
  deepfakeDetected: boolean
  deepfakeScore: number
  profileFaceFound: boolean
  selfieFaceFound: boolean
}

// ── Styles ───────────────────────────────────────────────────────────────────

const colors = {
  bg: '#0a0a0c',
  surface: '#121216',
  surfaceHover: '#1c1c22',
  primary: '#00ff9d',
  primaryGlow: 'rgba(0, 255, 157, 0.4)',
  secondary: '#7000ff',
  text: '#ffffff',
  muted: '#a1a1aa',
  border: '#27272a',
  warning: '#facc15',
  danger: '#ef4444',
}

// ── Face matching utilities ──────────────────────────────────────────────────

function normalizeLandmarks(landmarks: Landmark[]): Float32Array {
  if (landmarks.length === 0) return new Float32Array(0)
  const nose = landmarks[NOSE_TIP]
  const lEye = landmarks[LEFT_EYE_PUPIL]
  const rEye = landmarks[RIGHT_EYE_PUPIL]
  const ipd = Math.sqrt(
    Math.pow(rEye.x - lEye.x, 2) + Math.pow(rEye.y - lEye.y, 2)
  ) || 1.0
  const vec = new Float32Array(landmarks.length * 3)
  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i]
    vec[i * 3 + 0] = (lm.x - nose.x) / ipd
    vec[i * 3 + 1] = (lm.y - nose.y) / ipd
    vec[i * 3 + 2] = (lm.z - nose.z) / ipd
  }
  return vec
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

// ── Badge generation ─────────────────────────────────────────────────────────

function generateBadge(confidence: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = 600
  canvas.height = 340
  const ctx = canvas.getContext('2d')!

  // Background
  const grad = ctx.createLinearGradient(0, 0, 600, 340)
  grad.addColorStop(0, '#0a0a0c')
  grad.addColorStop(1, '#121216')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.roundRect(0, 0, 600, 340, 20)
  ctx.fill()

  // Border
  ctx.strokeStyle = colors.primary
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(2, 2, 596, 336, 18)
  ctx.stroke()

  // Shield icon
  ctx.fillStyle = colors.primary
  ctx.font = '48px serif'
  ctx.textAlign = 'center'
  ctx.fillText('\uD83D\uDEE1\uFE0F', 300, 70)

  // Title
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 32px Inter, system-ui, sans-serif'
  ctx.fillText('TrustMyProfile', 300, 120)

  // VERIFIED
  ctx.fillStyle = colors.primary
  ctx.font = 'bold 24px Inter, system-ui, sans-serif'
  ctx.fillText('VERIFIED', 300, 165)

  // Checkmark circle
  ctx.beginPath()
  ctx.arc(300, 215, 28, 0, Math.PI * 2)
  ctx.fillStyle = colors.primary
  ctx.fill()
  ctx.fillStyle = '#000000'
  ctx.font = 'bold 28px sans-serif'
  ctx.fillText('\u2713', 300, 225)

  // Confidence
  ctx.fillStyle = colors.muted
  ctx.font = '16px Inter, system-ui, sans-serif'
  ctx.fillText(`Trust Score: ${confidence}%`, 300, 270)

  // Date and provider
  const date = new Date().toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
  ctx.fillStyle = colors.muted
  ctx.font = '13px Inter, system-ui, sans-serif'
  ctx.fillText(`Verified on ${date}`, 300, 300)
  ctx.fillText('Powered by Deep-Check', 300, 322)

  return canvas.toDataURL('image/png')
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function TrustMyProfilePage() {
  const [step, setStep] = useState<Step>('landing')
  const [mode, setMode] = useState<VerifyMode>('check_profile')
  const [profileImage, setProfileImage] = useState<string | null>(null)
  const [selfieImage, setSelfieImage] = useState<string | null>(null)
  const [result, setResult] = useState<VerificationResult | null>(null)
  const [badgeDataUrl, setBadgeDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusText, setStatusText] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Camera management ──────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    try {
      setCameraReady(false)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play()
          setCameraReady(true)
        }
      }
    } catch {
      setError('Could not access camera. Please allow camera permissions.')
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
    return () => { stopCamera() }
  }, [stopCamera])

  // ── File upload handling ────────────────────────────────────────────────

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
      setProfileImage(reader.result as string)
    }
    reader.readAsDataURL(file)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  // ── Capture selfie ─────────────────────────────────────────────────────

  const captureSelfie = useCallback(() => {
    if (!videoRef.current) return
    const video = videoRef.current
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    setSelfieImage(dataUrl)
    stopCamera()
  }, [stopCamera])

  // ── Verification engine ────────────────────────────────────────────────

  const runVerification = useCallback(async () => {
    if (!profileImage || !selfieImage) return
    setStep('verifying')
    setError(null)

    try {
      // Step 1: Load MediaPipe FaceLandmarker
      setStatusText('Loading face detection model...')
      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
      const fileset = await FilesetResolver.forVisionTasks(MP_WASM_CDN)
      const landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MP_MODEL_URL, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      })

      // Step 2: Load images
      setStatusText('Processing images...')
      const loadImg = (src: string): Promise<HTMLImageElement> =>
        new Promise((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error('Failed to load image'))
          img.src = src
        })

      const profileImg = await loadImg(profileImage)

      let match = false
      let similarity = 0
      let confidence = 0
      let profileFaceFound = false
      let selfieFaceFound = !selfieImage  // true if no selfie needed

      // Face detection on profile photo
      setStatusText('Detecting faces...')
      const profileResult = landmarker.detect(profileImg)
      profileFaceFound = profileResult.faceLandmarks.length > 0

      if (!profileFaceFound) {
        setResult({
          match: false, similarity: 0, confidence: 0,
          deepfakeDetected: false, deepfakeScore: 0,
          profileFaceFound, selfieFaceFound: true,
        })
        setStep('result')
        landmarker.close()
        return
      }

      // Face comparison (only if selfie provided — verify_self mode)
      if (selfieImage) {
        const selfieImg = await loadImg(selfieImage)
        const selfieResult = landmarker.detect(selfieImg)
        selfieFaceFound = selfieResult.faceLandmarks.length > 0

        if (!selfieFaceFound) {
          setResult({
            match: false, similarity: 0, confidence: 0,
            deepfakeDetected: false, deepfakeScore: 0,
            profileFaceFound, selfieFaceFound,
          })
          setStep('result')
          landmarker.close()
          return
        }

        setStatusText('Comparing face geometry...')
        const profileVec = normalizeLandmarks(profileResult.faceLandmarks[0] as Landmark[])
        const selfieVec = normalizeLandmarks(selfieResult.faceLandmarks[0] as Landmark[])
        similarity = Math.max(0, Math.min(1, cosineSimilarity(profileVec, selfieVec)))
        match = similarity >= MATCH_THRESHOLD
        confidence = Math.round(Math.max(0, Math.min(100, ((similarity - 0.6) / 0.4) * 100)))
      }

      landmarker.close()

      // Step 5: Deepfake detection on profile photo
      setStatusText('Scanning for AI-generated artifacts...')
      let deepfakeDetected = false
      let deepfakeScore = 0

      try {
        // Check if the ONNX model exists
        const modelCheck = await fetch(DEEPFAKE_MODEL_URL, { method: 'HEAD' })
        if (modelCheck.ok) {
          const ort = await import('onnxruntime-web')
          ort.env.wasm.wasmPaths = '/'

          const session = await ort.InferenceSession.create(DEEPFAKE_MODEL_URL)

          // Preprocess: resize to 224x224, ImageNet normalize, CHW layout
          const TARGET = 224
          const prepCanvas = document.createElement('canvas')
          prepCanvas.width = TARGET
          prepCanvas.height = TARGET
          const prepCtx = prepCanvas.getContext('2d', { willReadFrequently: true })!
          prepCtx.drawImage(profileImg, 0, 0, TARGET, TARGET)
          const pixels = prepCtx.getImageData(0, 0, TARGET, TARGET).data

          const tensor = new Float32Array(3 * TARGET * TARGET)
          for (let i = 0; i < TARGET * TARGET; i++) {
            const r = pixels[i * 4] / 255.0
            const g = pixels[i * 4 + 1] / 255.0
            const b = pixels[i * 4 + 2] / 255.0
            tensor[i] = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0]
            tensor[TARGET * TARGET + i] = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1]
            tensor[2 * TARGET * TARGET + i] = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2]
          }

          const input = new ort.Tensor('float32', tensor, [1, 3, TARGET, TARGET])
          const inputName = session.inputNames[0]
          const outputName = session.outputNames[0]
          const feeds: Record<string, import('onnxruntime-web').Tensor> = { [inputName]: input }
          const output = await session.run(feeds)
          const logit = (output[outputName].data as Float32Array)[0]
          const pFake = 1 / (1 + Math.exp(-logit)) // sigmoid

          deepfakeScore = Math.round(pFake * 100)
          deepfakeDetected = pFake > 0.5
        }
      } catch {
        // Model not available or inference failed — continue without deepfake score
        console.debug('[TrustMyProfile] Deepfake model not available, skipping')
      }

      // Step 6: Generate badge if verified
      setStatusText('Generating results...')
      const verificationResult: VerificationResult = {
        match,
        similarity,
        confidence,
        deepfakeDetected,
        deepfakeScore,
        profileFaceFound,
        selfieFaceFound,
      }
      setResult(verificationResult)

      // In check_profile mode, "match" means "photo is real" (not deepfake)
      if (mode === 'check_profile') {
        match = !deepfakeDetected
        confidence = deepfakeDetected ? deepfakeScore : (100 - deepfakeScore)
      }

      if (match && !deepfakeDetected) {
        setBadgeDataUrl(generateBadge(confidence))
      }

      setStep('result')
    } catch (err) {
      console.error('[TrustMyProfile] Verification error:', err)
      setError('Verification failed. Please try again.')
      setStep('selfie')
    }
  }, [profileImage, selfieImage, mode])

  // ── Step navigation ────────────────────────────────────────────────────

  const goToUpload = () => {
    setStep('upload')
    setProfileImage(null)
    setSelfieImage(null)
    setResult(null)
    setBadgeDataUrl(null)
    setError(null)
  }

  const goToSelfie = () => {
    if (mode === 'check_profile') {
      // Skip selfie — go directly to verification with photo-only deepfake check
      runVerification()
      return
    }
    setStep('selfie')
    setSelfieImage(null)
    startCamera()
  }

  const retakeSelfie = () => {
    setSelfieImage(null)
    startCamera()
  }

  const startOver = () => {
    stopCamera()
    setStep('landing')
    setProfileImage(null)
    setSelfieImage(null)
    setResult(null)
    setBadgeDataUrl(null)
    setError(null)
  }

  const downloadBadge = () => {
    if (!badgeDataUrl) return
    const a = document.createElement('a')
    a.href = badgeDataUrl
    a.download = 'TrustMyProfile-Badge.png'
    a.click()
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div style={{
      minHeight: '100vh',
      background: colors.bg,
      color: colors.text,
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    }}>
      {/* Nav */}
      <nav style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '1rem 1.5rem',
        borderBottom: `1px solid ${colors.border}`,
        maxWidth: 800,
        margin: '0 auto',
      }}>
        <Link href="/" style={{
          textDecoration: 'none',
          fontSize: '1.15rem',
          fontWeight: 800,
          color: '#fff',
        }}>
          Deep-Check<span style={{ color: colors.primary }}>.</span>
        </Link>
        {step !== 'landing' && (
          <button
            onClick={startOver}
            style={{
              background: 'transparent',
              border: `1px solid ${colors.border}`,
              color: colors.muted,
              padding: '0.4rem 1rem',
              borderRadius: 8,
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            Start over
          </button>
        )}
      </nav>

      <main style={{
        maxWidth: 520,
        margin: '0 auto',
        padding: '2rem 1.25rem 4rem',
      }}>

        {/* ── LANDING ────────────────────────────────────────────────── */}
        {step === 'landing' && (
          <div style={{ textAlign: 'center' }}>
            {/* Shield icon */}
            <div style={{
              fontSize: '4rem',
              marginBottom: '0.75rem',
              lineHeight: 1,
            }}>
              {'\uD83D\uDEE1\uFE0F'}
            </div>

            <h1 style={{
              fontSize: 'clamp(2rem, 6vw, 2.8rem)',
              fontWeight: 800,
              marginBottom: '0.75rem',
              lineHeight: 1.1,
              letterSpacing: '-0.03em',
            }}>
              Trust<span style={{ color: colors.primary }}>My</span>Profile
            </h1>

            <p style={{
              fontSize: '1.15rem',
              color: colors.muted,
              marginBottom: '2.5rem',
              lineHeight: 1.5,
              maxWidth: 400,
              margin: '0 auto 2.5rem',
            }}>
              Verify your dating profile is really you.<br />
              Get a Trust Badge.
            </p>

            {/* CTA */}
            <button
              onClick={goToUpload}
              style={{
                background: colors.primary,
                color: '#000',
                border: 'none',
                padding: '1rem 2.5rem',
                borderRadius: 12,
                fontSize: '1.1rem',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: `0 0 30px ${colors.primaryGlow}`,
                transition: 'transform 0.15s, box-shadow 0.15s',
                marginBottom: '2rem',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.boxShadow = `0 0 45px ${colors.primaryGlow}`
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = `0 0 30px ${colors.primaryGlow}`
              }}
            >
              🔍 Check a Profile
            </button>

            <button
              onClick={() => { setMode('verify_self'); setStep('upload') }}
              style={{
                display: 'block',
                margin: '0.75rem auto 0',
                padding: '0.9rem 2.5rem',
                background: 'transparent',
                border: `2px solid ${colors.primary}`,
                color: colors.primary,
                fontSize: '1.05rem',
                fontWeight: 700,
                borderRadius: '14px',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              🤳 Verify Myself
            </button>

            <p style={{ color: colors.muted, fontSize: '0.8rem', marginTop: '0.75rem' }}>
              <strong>Check a Profile:</strong> Upload any photo → AI tells you if it&apos;s real or fake<br/>
              <strong>Verify Myself:</strong> Upload photo + live selfie → proves you are who you say
            </p>

            {/* Benefits */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              marginTop: '2.5rem',
              textAlign: 'left',
            }}>
              {[
                { icon: '\u2764\uFE0F', text: 'Works with Tinder, Bumble, Hinge, any app' },
                { icon: '\uD83D\uDD12', text: '100% private \u2014 processed in your browser' },
                { icon: '\u26A1', text: 'Results in under 30 seconds' },
                { icon: '\u2705', text: 'Downloadable Trust Badge for your profile' },
              ].map(({ icon, text }) => (
                <div key={text} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 12,
                  padding: '1rem 1.25rem',
                }}>
                  <span style={{ fontSize: '1.25rem', flexShrink: 0 }}>{icon}</span>
                  <span style={{ fontSize: '0.95rem', color: colors.muted }}>{text}</span>
                </div>
              ))}
            </div>

            {/* Trust signal */}
            <p style={{
              marginTop: '2rem',
              fontSize: '0.8rem',
              color: colors.muted,
              opacity: 0.7,
            }}>
              No data leaves your device. Zero biometric data sent to any server.
            </p>
          </div>
        )}

        {/* ── STEP 1: UPLOAD ─────────────────────────────────────────── */}
        {step === 'upload' && (
          <div>
            <StepIndicator current={1} />
            <h2 style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              marginBottom: '0.5rem',
              textAlign: 'center',
            }}>
              Upload Your Profile Photo
            </h2>
            <p style={{
              color: colors.muted,
              textAlign: 'center',
              marginBottom: '1.5rem',
              fontSize: '0.9rem',
            }}>
              Upload the photo you use on your dating profile
            </p>

            {!profileImage ? (
              <div
                onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${isDragging ? colors.primary : colors.border}`,
                  borderRadius: 16,
                  padding: '3rem 2rem',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: isDragging ? 'rgba(0,255,157,0.04)' : colors.surface,
                  transition: 'border-color 0.2s, background 0.2s',
                }}
              >
                <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>
                  {'\uD83D\uDCF7'}
                </div>
                <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
                  Drag & drop your photo here
                </p>
                <p style={{ color: colors.muted, fontSize: '0.85rem' }}>
                  or click to browse files
                </p>
                <p style={{ color: colors.muted, fontSize: '0.75rem', marginTop: '0.75rem' }}>
                  JPEG, PNG, or WebP &middot; Max 10 MB
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) handleFile(file)
                  }}
                />
              </div>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  position: 'relative',
                  display: 'inline-block',
                  borderRadius: 16,
                  overflow: 'hidden',
                  border: `2px solid ${colors.border}`,
                  maxWidth: '100%',
                }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={profileImage}
                    alt="Profile photo preview"
                    style={{
                      display: 'block',
                      maxWidth: '100%',
                      maxHeight: 360,
                      objectFit: 'contain',
                    }}
                  />
                </div>
                <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                  <button
                    onClick={() => { setProfileImage(null); setError(null) }}
                    style={{
                      background: 'transparent',
                      border: `1px solid ${colors.border}`,
                      color: colors.muted,
                      padding: '0.6rem 1.25rem',
                      borderRadius: 8,
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                    }}
                  >
                    Change photo
                  </button>
                  <button
                    onClick={goToSelfie}
                    style={{
                      background: colors.primary,
                      color: '#000',
                      border: 'none',
                      padding: '0.6rem 1.5rem',
                      borderRadius: 8,
                      fontSize: '0.9rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: `0 0 20px ${colors.primaryGlow}`,
                    }}
                  >
                    Next &rarr;
                  </button>
                </div>
              </div>
            )}

            {error && (
              <p style={{ color: colors.danger, fontSize: '0.85rem', marginTop: '1rem', textAlign: 'center' }}>
                {error}
              </p>
            )}
          </div>
        )}

        {/* ── STEP 2: SELFIE ─────────────────────────────────────────── */}
        {step === 'selfie' && (
          <div>
            <StepIndicator current={2} />
            <h2 style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              marginBottom: '0.5rem',
              textAlign: 'center',
            }}>
              Take a Live Selfie
            </h2>
            <p style={{
              color: colors.muted,
              textAlign: 'center',
              marginBottom: '1.5rem',
              fontSize: '0.9rem',
            }}>
              Look straight at the camera in good lighting
            </p>

            {!selfieImage ? (
              <div>
                {/* Camera viewport */}
                <div style={{
                  position: 'relative',
                  borderRadius: 16,
                  overflow: 'hidden',
                  border: `2px solid ${colors.border}`,
                  background: '#000',
                  aspectRatio: '4/3',
                  marginBottom: '1rem',
                }}>
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
                    }}
                  />
                  {/* Face guide overlay */}
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                  }}>
                    <div style={{
                      width: '55%',
                      aspectRatio: '3/4',
                      border: `2px dashed ${colors.primary}`,
                      borderRadius: '50%',
                      opacity: 0.5,
                    }} />
                  </div>
                  {!cameraReady && (
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'rgba(0,0,0,0.8)',
                    }}>
                      <Spinner />
                      <span style={{ marginLeft: '0.75rem', color: colors.muted }}>Starting camera...</span>
                    </div>
                  )}
                </div>

                <button
                  onClick={captureSelfie}
                  disabled={!cameraReady}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    width: '100%',
                    background: cameraReady ? colors.primary : colors.surfaceHover,
                    color: cameraReady ? '#000' : colors.muted,
                    border: 'none',
                    padding: '0.85rem',
                    borderRadius: 12,
                    fontSize: '1rem',
                    fontWeight: 700,
                    cursor: cameraReady ? 'pointer' : 'not-allowed',
                    boxShadow: cameraReady ? `0 0 20px ${colors.primaryGlow}` : 'none',
                  }}
                >
                  {'\uD83D\uDCF8'} Capture
                </button>
              </div>
            ) : (
              <div>
                {/* Side by side comparison */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '0.75rem',
                  marginBottom: '1.25rem',
                }}>
                  <div>
                    <p style={{ fontSize: '0.75rem', color: colors.muted, marginBottom: '0.5rem', textAlign: 'center' }}>
                      Profile Photo
                    </p>
                    <div style={{
                      borderRadius: 12,
                      overflow: 'hidden',
                      border: `1px solid ${colors.border}`,
                      aspectRatio: '1',
                    }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={profileImage!}
                        alt="Profile photo"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    </div>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.75rem', color: colors.muted, marginBottom: '0.5rem', textAlign: 'center' }}>
                      Live Selfie
                    </p>
                    <div style={{
                      borderRadius: 12,
                      overflow: 'hidden',
                      border: `1px solid ${colors.border}`,
                      aspectRatio: '1',
                    }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={selfieImage}
                        alt="Captured selfie"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          transform: 'scaleX(-1)',
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button
                    onClick={retakeSelfie}
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: `1px solid ${colors.border}`,
                      color: colors.muted,
                      padding: '0.7rem',
                      borderRadius: 10,
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                    }}
                  >
                    Retake
                  </button>
                  <button
                    onClick={runVerification}
                    style={{
                      flex: 2,
                      background: colors.primary,
                      color: '#000',
                      border: 'none',
                      padding: '0.7rem',
                      borderRadius: 10,
                      fontSize: '0.9rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: `0 0 20px ${colors.primaryGlow}`,
                    }}
                  >
                    Verify &rarr;
                  </button>
                </div>
              </div>
            )}

            {error && (
              <p style={{ color: colors.danger, fontSize: '0.85rem', marginTop: '1rem', textAlign: 'center' }}>
                {error}
              </p>
            )}
          </div>
        )}

        {/* ── STEP 3: VERIFYING ──────────────────────────────────────── */}
        {step === 'verifying' && (
          <div style={{ textAlign: 'center', paddingTop: '4rem' }}>
            <StepIndicator current={3} />
            <div style={{ marginBottom: '2rem' }}>
              <Spinner size={48} />
            </div>
            <h2 style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              marginBottom: '0.75rem',
            }}>
              Analyzing...
            </h2>
            <p style={{
              color: colors.muted,
              fontSize: '0.9rem',
              marginBottom: '0.5rem',
            }}>
              {statusText}
            </p>
            <p style={{
              color: colors.muted,
              fontSize: '0.75rem',
              opacity: 0.6,
            }}>
              All processing happens locally in your browser
            </p>
          </div>
        )}

        {/* ── RESULT ─────────────────────────────────────────────────── */}
        {step === 'result' && result && (
          <div style={{ textAlign: 'center' }}>
            {/* No face found */}
            {(!result.profileFaceFound || !result.selfieFaceFound) && (
              <div>
                <div style={{
                  fontSize: '4rem',
                  marginBottom: '1rem',
                  lineHeight: 1,
                }}>
                  {'\u26A0\uFE0F'}
                </div>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.75rem' }}>
                  Face Not Detected
                </h2>
                <p style={{ color: colors.muted, marginBottom: '2rem', lineHeight: 1.6 }}>
                  {!result.profileFaceFound
                    ? 'No face was found in your profile photo. Please upload a clear photo showing your face.'
                    : 'No face was found in your selfie. Please ensure your face is clearly visible and well-lit.'}
                </p>
                <button
                  onClick={startOver}
                  style={{
                    background: colors.primary,
                    color: '#000',
                    border: 'none',
                    padding: '0.75rem 2rem',
                    borderRadius: 10,
                    fontSize: '1rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Try Again
                </button>
              </div>
            )}

            {/* Deepfake detected */}
            {result.profileFaceFound && result.selfieFaceFound && result.deepfakeDetected && (
              <div>
                <div style={{
                  fontSize: '4rem',
                  marginBottom: '1rem',
                  lineHeight: 1,
                }}>
                  {'\uD83D\uDEA8'}
                </div>
                <h2 style={{
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color: colors.danger,
                  marginBottom: '0.75rem',
                }}>
                  Profile Photo Appears AI-Generated
                </h2>
                <p style={{ color: colors.muted, marginBottom: '1.5rem', lineHeight: 1.6 }}>
                  Our analysis detected indicators that your profile photo may have been
                  generated or significantly altered by AI. Trust badges cannot be issued
                  for AI-generated photos.
                </p>
                <div style={{
                  background: colors.surface,
                  border: `1px solid ${colors.danger}`,
                  borderRadius: 12,
                  padding: '1.25rem',
                  marginBottom: '2rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{ color: colors.muted, fontSize: '0.85rem' }}>AI Generation Score</span>
                    <span style={{ color: colors.danger, fontWeight: 700 }}>{result.deepfakeScore}%</span>
                  </div>
                  <div style={{
                    height: 6,
                    borderRadius: 3,
                    background: colors.surfaceHover,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${result.deepfakeScore}%`,
                      background: colors.danger,
                      borderRadius: 3,
                    }} />
                  </div>
                </div>
                <button
                  onClick={startOver}
                  style={{
                    background: colors.primary,
                    color: '#000',
                    border: 'none',
                    padding: '0.75rem 2rem',
                    borderRadius: 10,
                    fontSize: '1rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Try With a Real Photo
                </button>
              </div>
            )}

            {/* Match failed */}
            {result.profileFaceFound && result.selfieFaceFound && !result.deepfakeDetected && !result.match && (
              <div>
                <div style={{
                  fontSize: '4rem',
                  marginBottom: '1rem',
                  lineHeight: 1,
                }}>
                  {'\u26A0\uFE0F'}
                </div>
                <h2 style={{
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color: colors.warning,
                  marginBottom: '0.75rem',
                }}>
                  Photos Don&apos;t Match
                </h2>
                <p style={{ color: colors.muted, marginBottom: '1.5rem', lineHeight: 1.6 }}>
                  We couldn&apos;t confirm a strong enough match between your profile photo
                  and live selfie. This can happen with very different angles, lighting,
                  or if significant time has passed.
                </p>
                <div style={{
                  background: colors.surface,
                  border: `1px solid ${colors.warning}`,
                  borderRadius: 12,
                  padding: '1.25rem',
                  marginBottom: '2rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{ color: colors.muted, fontSize: '0.85rem' }}>Similarity</span>
                    <span style={{ color: colors.warning, fontWeight: 700 }}>
                      {(result.similarity * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div style={{
                    height: 6,
                    borderRadius: 3,
                    background: colors.surfaceHover,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${result.similarity * 100}%`,
                      background: colors.warning,
                      borderRadius: 3,
                    }} />
                  </div>
                  <p style={{ color: colors.muted, fontSize: '0.75rem', marginTop: '0.5rem' }}>
                    Minimum {MATCH_THRESHOLD * 100}% required for verification
                  </p>
                </div>
                <div style={{ fontSize: '0.85rem', color: colors.muted, marginBottom: '2rem', textAlign: 'left' }}>
                  <p style={{ fontWeight: 600, color: colors.text, marginBottom: '0.5rem' }}>Tips for a better match:</p>
                  <ul style={{ paddingLeft: '1.25rem', lineHeight: 1.8 }}>
                    <li>Use a well-lit environment for the selfie</li>
                    <li>Face the camera directly, similar to your profile photo</li>
                    <li>Remove sunglasses, hats, or heavy filters</li>
                    <li>Make sure your full face is visible</li>
                  </ul>
                </div>
                <button
                  onClick={startOver}
                  style={{
                    background: colors.primary,
                    color: '#000',
                    border: 'none',
                    padding: '0.75rem 2rem',
                    borderRadius: 10,
                    fontSize: '1rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Try Again
                </button>
              </div>
            )}

            {/* Success! */}
            {result.profileFaceFound && result.selfieFaceFound && !result.deepfakeDetected && result.match && (
              <div>
                {/* Success animation */}
                <div style={{
                  width: 80,
                  height: 80,
                  borderRadius: '50%',
                  background: colors.primary,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 1.25rem',
                  boxShadow: `0 0 40px ${colors.primaryGlow}`,
                }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>

                <h2 style={{
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color: colors.primary,
                  marginBottom: '0.5rem',
                }}>
                  VERIFIED &mdash; This Is Really You!
                </h2>
                <p style={{ color: colors.muted, marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                  Your profile photo matches your live selfie.
                </p>

                {/* Score card */}
                <div style={{
                  background: colors.surface,
                  border: `1px solid ${colors.primary}`,
                  borderRadius: 16,
                  padding: '1.5rem',
                  marginBottom: '1.5rem',
                  boxShadow: `0 0 30px rgba(0,255,157,0.06)`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <span style={{ color: colors.muted, fontSize: '0.85rem' }}>Trust Score</span>
                    <span style={{ color: colors.primary, fontSize: '2rem', fontWeight: 800 }}>
                      {result.confidence}%
                    </span>
                  </div>
                  <div style={{
                    height: 8,
                    borderRadius: 4,
                    background: colors.surfaceHover,
                    overflow: 'hidden',
                    marginBottom: '1rem',
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${result.confidence}%`,
                      background: `linear-gradient(90deg, ${colors.primary}, ${colors.secondary})`,
                      borderRadius: 4,
                      transition: 'width 0.8s ease-out',
                    }} />
                  </div>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '0.75rem',
                    fontSize: '0.8rem',
                  }}>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ color: colors.muted }}>Face Match</div>
                      <div style={{ color: colors.primary, fontWeight: 600 }}>
                        {(result.similarity * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: colors.muted }}>AI Detection</div>
                      <div style={{ color: colors.primary, fontWeight: 600 }}>
                        {result.deepfakeScore > 0 ? 'Passed' : 'N/A'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Badge preview */}
                {badgeDataUrl && (
                  <div style={{ marginBottom: '1.5rem' }}>
                    <p style={{ color: colors.muted, fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                      Your Trust Badge:
                    </p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={badgeDataUrl}
                      alt="TrustMyProfile verification badge"
                      style={{
                        width: '100%',
                        maxWidth: 360,
                        borderRadius: 12,
                        border: `1px solid ${colors.border}`,
                      }}
                    />
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <button
                    onClick={downloadBadge}
                    style={{
                      background: colors.primary,
                      color: '#000',
                      border: 'none',
                      padding: '0.85rem',
                      borderRadius: 12,
                      fontSize: '1rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: `0 0 20px ${colors.primaryGlow}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    {'\u2B07\uFE0F'} Download Trust Badge
                  </button>

                  {/* Share buttons */}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={() => {
                        if (navigator.share) {
                          navigator.share({
                            title: 'TrustMyProfile - Verified!',
                            text: `I just verified my dating profile with TrustMyProfile. Trust Score: ${result.confidence}%`,
                            url: window.location.href,
                          }).catch(() => {})
                        } else {
                          navigator.clipboard.writeText(
                            `I just verified my dating profile with TrustMyProfile! Trust Score: ${result.confidence}% \u2705\n${window.location.href}`
                          ).catch(() => {})
                        }
                      }}
                      style={{
                        flex: 1,
                        background: colors.surface,
                        border: `1px solid ${colors.border}`,
                        color: colors.text,
                        padding: '0.7rem',
                        borderRadius: 10,
                        fontSize: '0.9rem',
                        cursor: 'pointer',
                      }}
                    >
                      Share
                    </button>
                    <button
                      onClick={startOver}
                      style={{
                        flex: 1,
                        background: 'transparent',
                        border: `1px solid ${colors.border}`,
                        color: colors.muted,
                        padding: '0.7rem',
                        borderRadius: 10,
                        fontSize: '0.9rem',
                        cursor: 'pointer',
                      }}
                    >
                      Verify Another
                    </button>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <p style={{ color: colors.danger, fontSize: '0.85rem', marginTop: '1rem' }}>
                {error}
              </p>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{
        borderTop: `1px solid ${colors.border}`,
        padding: '1.5rem',
        textAlign: 'center',
      }}>
        <p style={{ color: colors.muted, fontSize: '0.75rem', opacity: 0.6 }}>
          TrustMyProfile is powered by{' '}
          <Link href="/" style={{ color: colors.primary, textDecoration: 'underline' }}>
            Deep-Check
          </Link>
          {' '}&middot; All processing runs in your browser &middot; Zero data sent to servers
        </p>
      </footer>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  const steps = ['Upload', 'Selfie', 'Verify']
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '0.5rem',
      marginBottom: '2rem',
    }}>
      {steps.map((label, i) => {
        const stepNum = i + 1
        const isActive = stepNum === current
        const isDone = stepNum < current
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.75rem',
              fontWeight: 700,
              background: isDone ? colors.primary : isActive ? colors.primary : colors.surface,
              color: isDone || isActive ? '#000' : colors.muted,
              border: isDone || isActive ? 'none' : `1px solid ${colors.border}`,
              transition: 'all 0.2s',
            }}>
              {isDone ? '\u2713' : stepNum}
            </div>
            <span style={{
              fontSize: '0.8rem',
              color: isActive ? colors.text : colors.muted,
              fontWeight: isActive ? 600 : 400,
            }}>
              {label}
            </span>
            {i < steps.length - 1 && (
              <div style={{
                width: 24,
                height: 1,
                background: isDone ? colors.primary : colors.border,
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function Spinner({ size = 24 }: { size?: number }) {
  return (
    <div style={{
      width: size,
      height: size,
      border: `3px solid ${colors.surfaceHover}`,
      borderTopColor: colors.primary,
      borderRadius: '50%',
      animation: 'trustmyprofile-spin 0.8s linear infinite',
      display: 'inline-block',
    }}>
      <style>{`
        @keyframes trustmyprofile-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
