'use client'

import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef, useCallback } from 'react'
import Webcam from 'react-webcam'
import * as faceapi from '@vladmandic/face-api'
import styles from './VerificationCamera.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

export type VerificationFailureReason =
    | 'No face detected'
    | 'Multiple faces detected'
    | 'Gaze Divergence'
    | 'Eye Gaze Detected'
    | 'Head Tilted'
    | 'Low confidence'
    | null

export interface VerificationCameraProps {
    onStatusChange?: (isVerified: boolean, type?: VerificationFailureReason) => void
    onLivenessScore?: (score: number) => void
    onGazeEvent?: (direction: GazeDirection) => void
}

export interface VerificationCameraHandle {
    takeSnapshot: () => string | null
    getLivenessScore: () => number
}

export type GazeDirection = 'center' | 'left' | 'right' | 'up' | 'down' | 'unknown'

// ─── Geometry helpers ─────────────────────────────────────────────────────────

interface Point2D { x: number; y: number }

function centroid(pts: readonly faceapi.Point[]): Point2D {
    return {
        x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
        y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    }
}

// ─── Head pose estimation ─────────────────────────────────────────────────────

interface HeadPoseResult {
    yaw: 'left' | 'right' | 'center'
    pitch: 'up' | 'down' | 'center'
    isFacing: boolean
    confidence: number
}

function estimateHeadPose(landmarks: faceapi.FaceLandmarks68): HeadPoseResult {
    const leftEye  = centroid(landmarks.getLeftEye())
    const rightEye = centroid(landmarks.getRightEye())
    const nose     = landmarks.getNose()
    const jaw      = landmarks.getJawOutline()

    const noseTip = nose[6]

    // Yaw — ratio of nose-to-eye horizontal distances
    const leftDist  = Math.abs(noseTip.x - leftEye.x)
    const rightDist = Math.abs(noseTip.x - rightEye.x)
    const yawRatio  = leftDist / (rightDist || 1)

    let yaw: 'left' | 'right' | 'center'
    if (yawRatio > 1.7) yaw = 'right'
    else if (yawRatio < 0.58) yaw = 'left'
    else yaw = 'center'

    // Pitch — nose-tip to eye midpoint vs nose-tip to chin
    const eyeMidY   = (leftEye.y + rightEye.y) / 2
    const chinY     = jaw[8].y
    const noseToEye = Math.abs(noseTip.y - eyeMidY)
    const noseToChin= Math.abs(chinY - noseTip.y)
    const pitchRatio= noseToEye / (noseToChin || 1)

    let pitch: 'up' | 'down' | 'center'
    if (pitchRatio < 0.45) pitch = 'up'
    else if (pitchRatio > 0.85) pitch = 'down'
    else pitch = 'center'

    // Roll — eye height difference
    const eyeSpan   = Math.abs(leftEye.x - rightEye.x)
    const eyeDeltaY = Math.abs(leftEye.y - rightEye.y)
    const isTilted  = eyeDeltaY / (eyeSpan || 1) > 0.3

    const symmetry  = 1 - Math.abs(yawRatio - 1) * 0.5
    const confidence= Math.max(0, Math.min(1, symmetry - (isTilted ? 0.2 : 0)))
    const isFacing  = yaw === 'center' && pitch === 'center' && !isTilted

    return { yaw, pitch, isFacing, confidence }
}

// ─── Gaze / iris direction estimation ────────────────────────────────────────
//
// The 68-point model gives us the 6 eyelid points per eye but NOT the iris.
// We use the Eye Aspect Ratio and the horizontal position of the inner-corner
// relative to the eye bounding box as a proxy for iris position.
//
// Left eye  landmarks: 36–41 (faceapi returns them 0-indexed inside getLeftEye())
//   [0]=outer-corner, [1]=upper-outer, [2]=upper-inner, [3]=inner-corner,
//   [4]=lower-inner,  [5]=lower-outer
// Right eye landmarks: 42–47, same convention mirrored.
//
// Gaze estimation:
//   - Horizontal: compare centre-of-eye-bbox to the average of the upper+lower
//     midpoints. If the horizontal centroid of the visible sclera shifts, the
//     iris has moved that way.
//   - We use the ratio: (inner-corner.x − outer-corner.x) vs eye width.
//     When looking left, the inner corner appears closer to the outer corner
//     (iris moved toward nose). Mirrored webcam makes left/right intuitive.

interface GazeEstimate {
    direction: GazeDirection
    confidence: number   // 0–1
    leftRatio: number    // raw horizontal ratio left eye
    rightRatio: number   // raw horizontal ratio right eye
}

function estimateGaze(landmarks: faceapi.FaceLandmarks68): GazeEstimate {
    const le = landmarks.getLeftEye()   // 6 points
    const re = landmarks.getRightEye()  // 6 points

    // For each eye compute the horizontal position of the "pupil proxy":
    // the midpoint between upper-outer and lower-outer (idx 1 & 5) vs
    // the midpoint between upper-inner and lower-inner (idx 2 & 4).
    // The ratio (inner_mid.x - outer_corner.x) / eye_width tells us
    // how far the visible sclera is shifted.
    const eyeRatio = (eye: faceapi.Point[]): number => {
        const outerCorner = eye[0]
        const innerCorner = eye[3]
        const eyeWidth    = Math.abs(innerCorner.x - outerCorner.x) || 1

        // Upper eyelid midpoint (between points 1 and 2)
        const upperMidX   = (eye[1].x + eye[2].x) / 2
        // Lower eyelid midpoint (between points 4 and 5)
        const lowerMidX   = (eye[4].x + eye[5].x) / 2
        // Horizontal centre of the visible eye opening
        const lidCentreX  = (upperMidX + lowerMidX) / 2

        // Normalised position: 0 = all the way to outer corner, 1 = inner corner
        return (lidCentreX - outerCorner.x) / eyeWidth
    }

    // Vertical: Eye Aspect Ratio — when looking up, upper lid rises (EAR increases);
    // when looking down, lids narrow. We compare to neutral ~0.25.
    const earVertical = (eye: faceapi.Point[]): number => {
        // EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)
        const dist = (a: faceapi.Point, b: faceapi.Point) =>
            Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
        const vertical   = (dist(eye[1], eye[5]) + dist(eye[2], eye[4])) / 2
        const horizontal = dist(eye[0], eye[3]) || 1
        return vertical / horizontal
    }

    const leftRatio  = eyeRatio(le)
    const rightRatio = eyeRatio(re)
    const avgRatio   = (leftRatio + rightRatio) / 2

    const leftEAR    = earVertical(le)
    const rightEAR   = earVertical(re)
    const avgEAR     = (leftEAR + rightEAR) / 2

    // Calibrated thresholds (webcam mirrored):
    // avgRatio < 0.38 → looking to the right (their actual right, screen-left)
    // avgRatio > 0.62 → looking to the left  (screen-right)
    // avgEAR < 0.12   → looking down (eyes nearly closed)
    // avgEAR > 0.38   → looking up

    let direction: GazeDirection = 'center'
    let confidence = 0.8

    if (avgEAR < 0.12) {
        direction  = 'down'
        confidence = 0.7
    } else if (avgEAR > 0.38) {
        direction  = 'up'
        confidence = 0.7
    } else if (avgRatio < 0.38) {
        direction  = 'right'
        confidence = 1 - avgRatio / 0.38
    } else if (avgRatio > 0.62) {
        direction  = 'left'
        confidence = (avgRatio - 0.62) / 0.38
    }

    return { direction, confidence, leftRatio, rightRatio }
}

// ─── Liveness score ───────────────────────────────────────────────────────────

function computeLivenessScore(
    detectionScore: number,
    poseConfidence: number,
    frameVariance: number
): number {
    const base          = detectionScore * 50
    const poseBonus     = poseConfidence * 30
    const varianceBonus = Math.min(20, frameVariance * 100)
    return Math.min(100, Math.round(base + poseBonus + varianceBonus))
}

// ─── Component ────────────────────────────────────────────────────────────────

const VerificationCamera = forwardRef<VerificationCameraHandle, VerificationCameraProps>(
    ({ onStatusChange, onLivenessScore, onGazeEvent }, ref) => {
        const webcamRef       = useRef<Webcam>(null)
        const canvasRef       = useRef<HTMLCanvasElement>(null)
        const livenessScoreRef= useRef(0)
        const noseHistoryRef  = useRef<Point2D[]>([])
        // Gaze smoothing: keep last N directions to avoid single-frame spikes
        const gazeHistoryRef  = useRef<GazeDirection[]>([])
        const lastGazeEventRef= useRef<GazeDirection>('center')

        const [isModelLoaded,     setIsModelLoaded]     = useState(false)
        const [modelLoadError,    setModelLoadError]    = useState<string | null>(null)
        const [verificationStatus,setVerificationStatus]= useState<'idle' | 'scanning' | 'verified' | 'failed'>('idle')
        const [failureReason,     setFailureReason]     = useState<VerificationFailureReason>(null)
        const [livenessScore,     setLivenessScore]     = useState(0)
        const [poseLabel,         setPoseLabel]         = useState<string>('–')
        const [gazeLabel,         setGazeLabel]         = useState<string>('')
        const [gazeRatioDebug,    setGazeRatioDebug]   = useState<number>(0.5)

        useImperativeHandle(ref, () => ({
            takeSnapshot:    () => webcamRef.current?.getScreenshot() ?? null,
            getLivenessScore:() => livenessScoreRef.current,
        }))

        // ── Load models ───────────────────────────────────────────────────────
        useEffect(() => {
            let cancelled = false
            const load = async () => {
                try {
                    await Promise.all([
                        faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
                        faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
                    ])
                    if (!cancelled) { setIsModelLoaded(true); setVerificationStatus('scanning') }
                } catch (e) {
                    console.error('Model load error:', e)
                    if (!cancelled) setModelLoadError('AI models failed to load. Please refresh.')
                }
            }
            load()
            return () => { cancelled = true }
        }, [])

        // ── Detection loop ────────────────────────────────────────────────────
        useEffect(() => {
            if (!isModelLoaded) return

            const interval = setInterval(async () => {
                const video = webcamRef.current?.video
                if (!video || video.readyState < 4) return

                const detections = await faceapi
                    .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4 }))
                    .withFaceLandmarks()

                // ── Draw ──────────────────────────────────────────────────────
                if (canvasRef.current) {
                    const displaySize = { width: video.videoWidth, height: video.videoHeight }
                    faceapi.matchDimensions(canvasRef.current, displaySize)
                    const resized = faceapi.resizeResults(detections, displaySize)
                    const ctx     = canvasRef.current.getContext('2d')
                    if (ctx) {
                        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
                        resized.forEach(det => {
                            const box = det.detection.box
                            // Face bounding box
                            ctx.strokeStyle = det.detection.score > 0.6 ? '#00ff9d' : '#ffd700'
                            ctx.lineWidth   = 2
                            ctx.strokeRect(box.x, box.y, box.width, box.height)

                            // Eye landmarks — draw the 6 eyelid points per eye
                            const le = det.landmarks.getLeftEye()
                            const re = det.landmarks.getRightEye()
                            ;[le, re].forEach(eye => {
                                ctx.beginPath()
                                ctx.moveTo(eye[0].x, eye[0].y)
                                eye.forEach(p => ctx.lineTo(p.x, p.y))
                                ctx.closePath()
                                ctx.strokeStyle = 'rgba(0,255,157,0.7)'
                                ctx.lineWidth   = 1.5
                                ctx.stroke()
                            })

                            // Nose bridge line
                            const nose = det.landmarks.getNose()
                            ctx.beginPath()
                            ctx.moveTo(nose[0].x, nose[0].y)
                            nose.slice(1).forEach(p => ctx.lineTo(p.x, p.y))
                            ctx.strokeStyle = 'rgba(0,255,157,0.3)'
                            ctx.lineWidth   = 1
                            ctx.stroke()
                        })
                    }
                }

                // ── Analysis ──────────────────────────────────────────────────
                if (detections.length === 1) {
                    const det = detections[0]
                    if (det.detection.score < 0.4) { setVerificationStatus('scanning'); return }

                    const pose = estimateHeadPose(det.landmarks)
                    const gaze = estimateGaze(det.landmarks)

                    // Gaze smoothing: majority vote over last 4 frames
                    gazeHistoryRef.current.push(gaze.direction)
                    if (gazeHistoryRef.current.length > 4) gazeHistoryRef.current.shift()
                    const gazeCounts = gazeHistoryRef.current.reduce((acc, d) => {
                        acc[d] = (acc[d] || 0) + 1; return acc
                    }, {} as Record<string, number>)
                    const smoothGaze = Object.entries(gazeCounts).sort((a, b) => b[1] - a[1])[0][0] as GazeDirection

                    setGazeRatioDebug(Math.round(((gaze.leftRatio + gaze.rightRatio) / 2) * 100) / 100)

                    // Nose history for liveness
                    const noseTip = det.landmarks.getNose()[6]
                    noseHistoryRef.current.push({ x: noseTip.x, y: noseTip.y })
                    if (noseHistoryRef.current.length > 10) noseHistoryRef.current.shift()

                    let frameVariance = 0
                    if (noseHistoryRef.current.length >= 3) {
                        const xs    = noseHistoryRef.current.map(p => p.x)
                        const ys    = noseHistoryRef.current.map(p => p.y)
                        const meanX = xs.reduce((a, b) => a + b, 0) / xs.length
                        const meanY = ys.reduce((a, b) => a + b, 0) / ys.length
                        frameVariance = xs.reduce((s, x) => s + (x - meanX) ** 2, 0) / xs.length
                                      + ys.reduce((s, y) => s + (y - meanY) ** 2, 0) / ys.length
                    }

                    const lScore = computeLivenessScore(det.detection.score, pose.confidence, frameVariance)
                    livenessScoreRef.current = lScore
                    setLivenessScore(lScore)
                    onLivenessScore?.(lScore)

                    // ── Gaze event (only fire when direction changes) ─────────
                    if (smoothGaze !== lastGazeEventRef.current) {
                        lastGazeEventRef.current = smoothGaze
                        onGazeEvent?.(smoothGaze)
                    }

                    // ── Status logic ──────────────────────────────────────────
                    // Priority: head pose first, then gaze
                    const headOff  = !pose.isFacing
                    const gazeOff  = smoothGaze !== 'center' && smoothGaze !== 'unknown'

                    if (headOff) {
                        const reason: VerificationFailureReason = pose.yaw !== 'center' ? 'Gaze Divergence' : 'Head Tilted'
                        setPoseLabel(pose.yaw !== 'center' ? `Head ${pose.yaw}` : 'Head tilted')
                        setGazeLabel('')
                        setVerificationStatus('failed')
                        setFailureReason(reason)
                        onStatusChange?.(false, reason)
                    } else if (gazeOff) {
                        const gazeDirectionLabel = `Looking ${smoothGaze}`
                        setPoseLabel('Facing camera')
                        setGazeLabel(gazeDirectionLabel)
                        setVerificationStatus('failed')
                        setFailureReason('Eye Gaze Detected')
                        onStatusChange?.(false, 'Eye Gaze Detected')
                    } else {
                        setPoseLabel('Facing camera')
                        setGazeLabel('Eyes: center')
                        setVerificationStatus('verified')
                        setFailureReason(null)
                        onStatusChange?.(true)
                    }

                } else if (detections.length === 0) {
                    noseHistoryRef.current = []
                    gazeHistoryRef.current = []
                    setVerificationStatus('failed')
                    setFailureReason('No face detected')
                    onStatusChange?.(false, 'No face detected')
                    setPoseLabel('–'); setGazeLabel('')
                } else {
                    setVerificationStatus('failed')
                    setFailureReason('Multiple faces detected')
                    onStatusChange?.(false, 'Multiple faces detected')
                }
            }, 450)

            return () => clearInterval(interval)
        }, [isModelLoaded, onStatusChange, onLivenessScore, onGazeEvent])

        const livenessColor = livenessScore > 70 ? '#00ff9d' : livenessScore > 40 ? '#ffd700' : '#ff4d4d'

        return (
            <div className={styles.container}>
                <div className={styles.cameraWrapper}>
                    <Webcam
                        ref={webcamRef}
                        audio={false}
                        screenshotFormat="image/jpeg"
                        screenshotQuality={0.8}
                        className={styles.webcam}
                        mirrored={true}
                        videoConstraints={{ facingMode: 'user', width: 640, height: 480 }}
                    />
                    <canvas ref={canvasRef} className={styles.canvas} />

                    {/* Liveness bar */}
                    {isModelLoaded && (
                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '3px', background: 'rgba(0,0,0,0.4)' }}>
                            <div style={{ height: '100%', width: `${livenessScore}%`, background: livenessColor, transition: 'width 0.4s ease, background 0.4s ease' }} />
                        </div>
                    )}

                    {/* Status overlay */}
                    <div className={`${styles.statusOverlay} ${styles[verificationStatus]}`}>
                        <div className={styles.statusDot} />
                        <span className={styles.statusText}>
                            {modelLoadError || (
                                verificationStatus === 'idle'     ? 'Initializing AI...' :
                                verificationStatus === 'scanning' ? 'Scanning...' :
                                verificationStatus === 'verified' ? `Verified · ${poseLabel}` :
                                failureReason === 'Eye Gaze Detected' ? `Eyes: ${gazeLabel.replace('Looking ', '')} ← off screen`
                                : (failureReason || 'Failed')
                            )}
                        </span>
                    </div>
                </div>

                {/* Metrics row */}
                {isModelLoaded && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '6px', padding: '0 2px' }}>
                        <span>Liveness <span style={{ color: livenessColor, fontWeight: 700 }}>{livenessScore}%</span></span>
                        <span style={{ color: gazeLabel && gazeLabel !== 'Eyes: center' ? '#ffd700' : 'var(--color-text-muted)' }}>
                            {gazeLabel || '–'}
                        </span>
                    </div>
                )}
            </div>
        )
    }
)

VerificationCamera.displayName = 'VerificationCamera'
export default VerificationCamera
