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
    onBlinkEvent?: (event: BlinkEvent) => void
    onFaceMetrics?: (metrics: FaceMetrics) => void
}

export interface VerificationCameraHandle {
    takeSnapshot: () => string | null
    getLivenessScore: () => number
    getBlinkRate: () => number
    getFaceMetrics: () => FaceMetrics | null
}

export type GazeDirection = 'center' | 'left' | 'right' | 'up' | 'down' | 'unknown'

// ─── Blink event ─────────────────────────────────────────────────────────────

export interface BlinkEvent {
    type: 'blink' | 'blink_rate_anomaly' | 'prolonged_closure'
    blinkDurationMs?: number
    blinkRate?: number          // blinks per minute
    detail?: string
    timestamp: number
}

// ─── Face metrics (rich signal set) ──────────────────────────────────────────

export interface FaceMetrics {
    livenessScore: number
    blinkRate: number           // blinks per minute
    blinkCount: number
    avgBlinkDuration: number    // ms
    headSymmetryScore: number   // 0–100 (100 = perfectly symmetric)
    microMovementScore: number  // 0–100 (natural micro-jitter score)
    eyeOpenness: number         // average EAR 0–1
    gazeStabilityScore: number  // 0–100 (how steady gaze is)
    faceBrightnessDelta: number // variance in detection score (photosubstitution proxy)
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

interface Point2D { x: number; y: number }

function centroid(pts: readonly faceapi.Point[]): Point2D {
    return {
        x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
        y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    }
}

function dist2D(a: faceapi.Point, b: faceapi.Point): number {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

// ─── Head pose estimation ─────────────────────────────────────────────────────

interface HeadPoseResult {
    yaw: 'left' | 'right' | 'center'
    pitch: 'up' | 'down' | 'center'
    isFacing: boolean
    confidence: number
    symmetryScore: number   // 0–100 — facial bilateral symmetry
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
    const eyeMidY    = (leftEye.y + rightEye.y) / 2
    const chinY      = jaw[8].y
    const noseToEye  = Math.abs(noseTip.y - eyeMidY)
    const noseToChin = Math.abs(chinY - noseTip.y)
    const pitchRatio = noseToEye / (noseToChin || 1)

    let pitch: 'up' | 'down' | 'center'
    if (pitchRatio < 0.45) pitch = 'up'
    else if (pitchRatio > 0.85) pitch = 'down'
    else pitch = 'center'

    // Roll — eye height difference
    const eyeSpan   = Math.abs(leftEye.x - rightEye.x)
    const eyeDeltaY = Math.abs(leftEye.y - rightEye.y)
    const isTilted  = eyeDeltaY / (eyeSpan || 1) > 0.3

    // Bilateral face symmetry score
    // Compare left jaw half to right jaw half (midpoint at jaw[8])
    const jawLeft  = jaw.slice(0, 8)
    const jawRight = jaw.slice(9, 17).reverse()
    let symSum = 0
    for (let i = 0; i < Math.min(jawLeft.length, jawRight.length); i++) {
        const lDist = Math.abs(jawLeft[i].x - noseTip.x)
        const rDist = Math.abs(jawRight[i].x - noseTip.x)
        const ratio = Math.min(lDist, rDist) / (Math.max(lDist, rDist) || 1)
        symSum += ratio
    }
    const symmetryScore = Math.round((symSum / 8) * 100)

    const symmetry   = 1 - Math.abs(yawRatio - 1) * 0.5
    const confidence = Math.max(0, Math.min(1, symmetry - (isTilted ? 0.2 : 0)))
    const isFacing   = yaw === 'center' && pitch === 'center' && !isTilted

    return { yaw, pitch, isFacing, confidence, symmetryScore }
}

// ─── Eye Aspect Ratio (EAR) ───────────────────────────────────────────────────
// EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)
// Used for: blink detection (EAR drops < 0.2), gaze vertical estimation.
// Reference: Soukupová & Čech 2016 "Real-Time Eye Blink Detection using Facial Landmarks"

function computeEAR(eye: faceapi.Point[]): number {
    const a = dist2D(eye[1], eye[5])
    const b = dist2D(eye[2], eye[4])
    const c = dist2D(eye[0], eye[3]) || 1
    return (a + b) / (2 * c)
}

// ─── Gaze / iris direction estimation ────────────────────────────────────────

interface GazeEstimate {
    direction: GazeDirection
    confidence: number
    leftRatio: number
    rightRatio: number
    leftEAR: number
    rightEAR: number
    avgEAR: number
}

function estimateGaze(landmarks: faceapi.FaceLandmarks68): GazeEstimate {
    const le = landmarks.getLeftEye()
    const re = landmarks.getRightEye()

    const eyeRatio = (eye: faceapi.Point[]): number => {
        const outerCorner = eye[0]
        const innerCorner = eye[3]
        const eyeWidth    = Math.abs(innerCorner.x - outerCorner.x) || 1
        const upperMidX   = (eye[1].x + eye[2].x) / 2
        const lowerMidX   = (eye[4].x + eye[5].x) / 2
        const lidCentreX  = (upperMidX + lowerMidX) / 2
        return (lidCentreX - outerCorner.x) / eyeWidth
    }

    const leftRatio  = eyeRatio(le)
    const rightRatio = eyeRatio(re)
    const avgRatio   = (leftRatio + rightRatio) / 2

    const leftEAR  = computeEAR(le)
    const rightEAR = computeEAR(re)
    const avgEAR   = (leftEAR + rightEAR) / 2

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

    return { direction, confidence, leftRatio, rightRatio, leftEAR, rightEAR, avgEAR }
}

// ─── Blink detection state machine ───────────────────────────────────────────
// Threshold: EAR < BLINK_THRESHOLD for MIN_BLINK_FRAMES frames = blink
// EAR > BLINK_OPEN_THRESHOLD = eye has reopened
// PROLONGED: eye stays closed for > PROLONGED_MS = probably not a blink

const BLINK_THRESHOLD   = 0.20   // EAR below this = eyes closing/closed
const BLINK_OPEN        = 0.25   // EAR above this = eyes open
const MIN_BLINK_FRAMES  = 2      // Min consecutive frames below threshold
const MAX_BLINK_FRAMES  = 12     // Max frames = ~540ms at 45ms interval

interface BlinkState {
    closedFrames: number
    isInBlink: boolean
    blinkStart: number
}

// ─── Gaze stability tracker ───────────────────────────────────────────────────
// Measure variance of gaze ratio over last N frames — high variance = nervous/looking around

function computeGazeStability(gazeHistory: number[]): number {
    if (gazeHistory.length < 5) return 100
    const mean = gazeHistory.reduce((s, v) => s + v, 0) / gazeHistory.length
    const variance = gazeHistory.reduce((s, v) => s + (v - mean) ** 2, 0) / gazeHistory.length
    // Map variance to 0-100 score (lower variance = more stable)
    // Typical human focused gaze: variance ~0.002. Looking around: ~0.02+
    return Math.max(0, Math.min(100, Math.round(100 - variance * 3000)))
}

// ─── Micro-movement (liveness jitter) ────────────────────────────────────────
// Natural head micro-movements: small random jitter from breathing, heartbeat, muscle.
// Spoofed photo/video: either no movement or perfectly looped motion.
// We compute variance of nose-tip positions — too low (photo) or too rhythmic (loop) = suspicious.

function computeMicroMovementScore(nosePts: Point2D[]): number {
    if (nosePts.length < 5) return 50
    const xs = nosePts.map(p => p.x)
    const ys = nosePts.map(p => p.y)
    const meanX = xs.reduce((s, v) => s + v, 0) / xs.length
    const meanY = ys.reduce((s, v) => s + v, 0) / ys.length
    const totalVar = xs.reduce((s, x) => s + (x - meanX) ** 2, 0) / xs.length
                   + ys.reduce((s, y) => s + (y - meanY) ** 2, 0) / ys.length

    // Sweet spot: some variance = alive. Score peaks at variance ~0.5–3 pixels².
    // Near-zero (0 < 0.05) = static image. Very high (>10) = too much movement.
    if (totalVar < 0.05) return 10         // Completely static — photo
    if (totalVar < 0.2)  return 40         // Very still
    if (totalVar < 5.0)  return 85 + Math.min(15, totalVar * 5)  // Natural range
    if (totalVar < 15.0) return Math.max(50, 100 - totalVar * 3) // Too much movement
    return 30                              // Excessive — could be video artifact
}

// ─── Liveness score (enhanced) ────────────────────────────────────────────────
// Now incorporates blink presence, micro-movement, and gaze stability.

function computeLivenessScore(
    detectionScore: number,
    poseConfidence: number,
    microMovement: number,
    blinkCount: number,       // session total
    elapsedMinutes: number,
    gazeStability: number
): number {
    const base       = detectionScore * 35          // 0–35
    const poseBonus  = poseConfidence * 20          // 0–20
    const jitterScore = microMovement * 0.2         // 0–20

    // Blink rate bonus: expected 15–20/min. 0 blinks = suspicious.
    const expectedBlinks = elapsedMinutes * 17      // average rate
    const blinkRatio = expectedBlinks > 0
        ? Math.min(1, blinkCount / expectedBlinks)
        : (blinkCount > 0 ? 1 : 0)
    const blinkBonus = blinkRatio * 15              // 0–15

    // Gaze stability bonus (staying focused on screen)
    const gazeBonus  = (gazeStability / 100) * 10  // 0–10

    return Math.min(100, Math.round(base + poseBonus + jitterScore + blinkBonus + gazeBonus))
}

// ─── Component ────────────────────────────────────────────────────────────────

const VerificationCamera = forwardRef<VerificationCameraHandle, VerificationCameraProps>(
    ({ onStatusChange, onLivenessScore, onGazeEvent, onBlinkEvent, onFaceMetrics }, ref) => {
        const webcamRef        = useRef<Webcam>(null)
        const canvasRef        = useRef<HTMLCanvasElement>(null)
        const livenessScoreRef = useRef(0)
        const noseHistoryRef   = useRef<Point2D[]>([])
        const gazeHistoryRef   = useRef<GazeDirection[]>([])
        const gazeRatioHistRef = useRef<number[]>([])   // raw ratios for stability
        const lastGazeEventRef = useRef<GazeDirection>('center')
        const sessionStartRef  = useRef<number>(performance.now())

        // Blink tracking
        const blinkStateRef    = useRef<BlinkState>({ closedFrames: 0, isInBlink: false, blinkStart: 0 })
        const blinkCountRef    = useRef<number>(0)
        const blinkTimesRef    = useRef<number[]>([])    // timestamps of blinks
        const blinkDurationsRef= useRef<number[]>([])   // durations of blinks (ms)
        const detectionScoreHistRef = useRef<number[]>([])  // for face brightness stability

        // Rich metrics ref (exposed via handle)
        const faceMetricsRef   = useRef<FaceMetrics | null>(null)
        const blinkRateRef     = useRef<number>(0)

        const [isModelLoaded,      setIsModelLoaded]      = useState(false)
        const [modelLoadError,     setModelLoadError]     = useState<string | null>(null)
        const [verificationStatus, setVerificationStatus] = useState<'idle' | 'scanning' | 'verified' | 'failed'>('idle')
        const [failureReason,      setFailureReason]      = useState<VerificationFailureReason>(null)
        const [livenessScore,      setLivenessScore]      = useState(0)
        const [poseLabel,          setPoseLabel]          = useState<string>('–')
        const [gazeLabel,          setGazeLabel]          = useState<string>('')
        const [gazeRatioDebug,     setGazeRatioDebug]    = useState<number>(0.5)
        const [blinkDisplay,       setBlinkDisplay]       = useState({ count: 0, rate: 0, ear: 0 })

        useImperativeHandle(ref, () => ({
            takeSnapshot:     () => webcamRef.current?.getScreenshot() ?? null,
            getLivenessScore: () => livenessScoreRef.current,
            getBlinkRate:     () => blinkRateRef.current,
            getFaceMetrics:   () => faceMetricsRef.current,
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
                            ctx.strokeStyle = det.detection.score > 0.6 ? '#00ff9d' : '#ffd700'
                            ctx.lineWidth   = 2
                            ctx.strokeRect(box.x, box.y, box.width, box.height)

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
                    const det  = detections[0]
                    if (det.detection.score < 0.4) { setVerificationStatus('scanning'); return }

                    const now  = performance.now()
                    const pose = estimateHeadPose(det.landmarks)
                    const gaze = estimateGaze(det.landmarks)

                    // Track detection score history (spoof proxy — a photo has unnaturally stable score)
                    detectionScoreHistRef.current.push(det.detection.score)
                    if (detectionScoreHistRef.current.length > 20) detectionScoreHistRef.current.shift()

                    // ── Blink detection ────────────────────────────────────────
                    // Uses EAR averaged between both eyes
                    const avgEAR     = gaze.avgEAR
                    const blinkState = blinkStateRef.current

                    if (avgEAR < BLINK_THRESHOLD) {
                        // Eyes are closing/closed
                        if (!blinkState.isInBlink) {
                            blinkState.isInBlink  = true
                            blinkState.blinkStart = now
                            blinkState.closedFrames = 1
                        } else {
                            blinkState.closedFrames++
                            // Prolonged closure (> MAX_BLINK_FRAMES * 45ms ≈ 540ms)
                            if (blinkState.closedFrames > MAX_BLINK_FRAMES) {
                                onBlinkEvent?.({
                                    type: 'prolonged_closure',
                                    blinkDurationMs: now - blinkState.blinkStart,
                                    detail: `Eyes closed for ${Math.round(now - blinkState.blinkStart)}ms`,
                                    timestamp: now
                                })
                                // Reset to avoid repeated events
                                blinkState.closedFrames = 0
                                blinkState.isInBlink    = false
                            }
                        }
                    } else if (avgEAR > BLINK_OPEN && blinkState.isInBlink) {
                        // Eyes have reopened — blink complete
                        if (blinkState.closedFrames >= MIN_BLINK_FRAMES) {
                            const blinkDur = now - blinkState.blinkStart
                            blinkCountRef.current++
                            blinkTimesRef.current.push(now)
                            blinkDurationsRef.current.push(blinkDur)

                            // Keep only last 60 blinks for statistics
                            if (blinkTimesRef.current.length > 60)    blinkTimesRef.current.shift()
                            if (blinkDurationsRef.current.length > 60) blinkDurationsRef.current.shift()

                            onBlinkEvent?.({
                                type: 'blink',
                                blinkDurationMs: blinkDur,
                                blinkRate: blinkRateRef.current,
                                timestamp: now
                            })
                        }
                        blinkState.isInBlink    = false
                        blinkState.closedFrames = 0
                    }

                    // Compute blink rate (blinks/min over last 60 seconds)
                    const oneMinAgo    = now - 60000
                    const recentBlinks = blinkTimesRef.current.filter(t => t > oneMinAgo)
                    const elapsedMin   = (now - sessionStartRef.current) / 60000
                    blinkRateRef.current = elapsedMin > 0
                        ? Math.round(blinkCountRef.current / elapsedMin)
                        : recentBlinks.length

                    // Blink rate anomaly detection
                    // Human range: 8–30 blinks/min. Below 5 = staring (video?). Above 40 = anxiety or artifact.
                    if (elapsedMin > 0.5 && blinkRateRef.current < 5 && blinkCountRef.current < 2) {
                        onBlinkEvent?.({
                            type: 'blink_rate_anomaly',
                            blinkRate: blinkRateRef.current,
                            detail: `Low blink rate: ${blinkRateRef.current}/min (expected 8–30)`,
                            timestamp: now
                        })
                    } else if (elapsedMin > 0.5 && blinkRateRef.current > 40) {
                        onBlinkEvent?.({
                            type: 'blink_rate_anomaly',
                            blinkRate: blinkRateRef.current,
                            detail: `High blink rate: ${blinkRateRef.current}/min`,
                            timestamp: now
                        })
                    }

                    setBlinkDisplay({ count: blinkCountRef.current, rate: blinkRateRef.current, ear: Math.round(avgEAR * 100) / 100 })

                    // ── Gaze smoothing ─────────────────────────────────────────
                    gazeHistoryRef.current.push(gaze.direction)
                    if (gazeHistoryRef.current.length > 4) gazeHistoryRef.current.shift()
                    const gazeCounts = gazeHistoryRef.current.reduce((acc, d) => {
                        acc[d] = (acc[d] || 0) + 1; return acc
                    }, {} as Record<string, number>)
                    const smoothGaze = Object.entries(gazeCounts).sort((a, b) => b[1] - a[1])[0][0] as GazeDirection

                    // Gaze ratio history for stability
                    const avgRatio = (gaze.leftRatio + gaze.rightRatio) / 2
                    gazeRatioHistRef.current.push(avgRatio)
                    if (gazeRatioHistRef.current.length > 20) gazeRatioHistRef.current.shift()
                    const gazeStability = computeGazeStability(gazeRatioHistRef.current)

                    setGazeRatioDebug(Math.round(avgRatio * 100) / 100)

                    // ── Nose micro-movement ────────────────────────────────────
                    const noseTip = det.landmarks.getNose()[6]
                    noseHistoryRef.current.push({ x: noseTip.x, y: noseTip.y })
                    if (noseHistoryRef.current.length > 20) noseHistoryRef.current.shift()
                    const microMovement = computeMicroMovementScore(noseHistoryRef.current)

                    // ── Liveness score (enhanced) ──────────────────────────────
                    const lScore = computeLivenessScore(
                        det.detection.score,
                        pose.confidence,
                        microMovement,
                        blinkCountRef.current,
                        elapsedMin,
                        gazeStability
                    )
                    livenessScoreRef.current = lScore
                    setLivenessScore(lScore)
                    onLivenessScore?.(lScore)

                    // ── Build rich FaceMetrics ─────────────────────────────────
                    const avgBlinkDur = blinkDurationsRef.current.length > 0
                        ? blinkDurationsRef.current.reduce((s, v) => s + v, 0) / blinkDurationsRef.current.length
                        : 0
                    const detScoreStd = detectionScoreHistRef.current.length > 3
                        ? Math.sqrt(detectionScoreHistRef.current.reduce((s, v) => {
                            const m = detectionScoreHistRef.current.reduce((a, b) => a + b, 0) / detectionScoreHistRef.current.length
                            return s + (v - m) ** 2
                          }, 0) / detectionScoreHistRef.current.length)
                        : 0

                    const metrics: FaceMetrics = {
                        livenessScore: lScore,
                        blinkRate: blinkRateRef.current,
                        blinkCount: blinkCountRef.current,
                        avgBlinkDuration: Math.round(avgBlinkDur),
                        headSymmetryScore: pose.symmetryScore,
                        microMovementScore: microMovement,
                        eyeOpenness: Math.round(avgEAR * 100) / 100,
                        gazeStabilityScore: gazeStability,
                        faceBrightnessDelta: Math.round(detScoreStd * 1000) / 1000,
                    }
                    faceMetricsRef.current = metrics
                    onFaceMetrics?.(metrics)

                    // ── Gaze event ─────────────────────────────────────────────
                    if (smoothGaze !== lastGazeEventRef.current) {
                        lastGazeEventRef.current = smoothGaze
                        onGazeEvent?.(smoothGaze)
                    }

                    // ── Status logic ───────────────────────────────────────────
                    const headOff = !pose.isFacing
                    const gazeOff = smoothGaze !== 'center' && smoothGaze !== 'unknown'

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
                    gazeRatioHistRef.current = []
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
        }, [isModelLoaded, onStatusChange, onLivenessScore, onGazeEvent, onBlinkEvent, onFaceMetrics])

        const livenessColor  = livenessScore > 70 ? '#00ff9d' : livenessScore > 40 ? '#ffd700' : '#ff4d4d'
        const blinkRateColor = blinkDisplay.rate > 5 && blinkDisplay.rate < 40 ? '#00ff9d' : '#ffd700'

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

                {/* Metrics rows */}
                {isModelLoaded && (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '6px', padding: '0 2px' }}>
                            <span>Liveness <span style={{ color: livenessColor, fontWeight: 700 }}>{livenessScore}%</span></span>
                            <span style={{ color: gazeLabel && gazeLabel !== 'Eyes: center' ? '#ffd700' : 'var(--color-text-muted)' }}>
                                {gazeLabel || '–'}
                            </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '3px', padding: '0 2px' }}>
                            <span>Blinks <span style={{ color: blinkRateColor, fontWeight: 600 }}>{blinkDisplay.count}</span></span>
                            <span>Rate <span style={{ color: blinkRateColor }}>{blinkDisplay.rate}/min</span></span>
                            <span>EAR <span style={{ color: blinkDisplay.ear < 0.2 ? '#ffd700' : 'var(--color-text-muted)' }}>{blinkDisplay.ear}</span></span>
                        </div>
                    </>
                )}
            </div>
        )
    }
)

VerificationCamera.displayName = 'VerificationCamera'
export default VerificationCamera
