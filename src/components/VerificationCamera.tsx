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
    | 'Head Tilted'
    | 'Low confidence'
    | null

export interface VerificationCameraProps {
    onStatusChange?: (isVerified: boolean, type?: VerificationFailureReason) => void
    onLivenessScore?: (score: number) => void  // 0–100 liveness confidence
}

export interface VerificationCameraHandle {
    takeSnapshot: () => string | null
    getLivenessScore: () => number
}

// ─── Head pose estimation helpers ────────────────────────────────────────────

interface HeadPoseResult {
    yaw: 'left' | 'right' | 'center'       // horizontal rotation
    pitch: 'up' | 'down' | 'center'        // vertical rotation
    isFacing: boolean
    confidence: number                      // 0–1
}

/**
 * Estimates head pose from 68-point facial landmarks.
 * Uses the classical nose-eye symmetry heuristic plus chin-nose-forehead
 * distance for pitch estimation.
 */
function estimateHeadPose(landmarks: faceapi.FaceLandmarks68): HeadPoseResult {
    const leftEye = landmarks.getLeftEye()
    const rightEye = landmarks.getRightEye()
    const nose = landmarks.getNose()
    const jaw = landmarks.getJawOutline()

    // Midpoints
    const leftEyeCenter = {
        x: leftEye.reduce((s, p) => s + p.x, 0) / leftEye.length,
        y: leftEye.reduce((s, p) => s + p.y, 0) / leftEye.length,
    }
    const rightEyeCenter = {
        x: rightEye.reduce((s, p) => s + p.x, 0) / rightEye.length,
        y: rightEye.reduce((s, p) => s + p.y, 0) / rightEye.length,
    }
    const noseTip = nose[6]                  // bottom of nose
    const noseBridge = nose[0]               // top of nose bridge

    // ── Yaw (horizontal) ──────────────────────────────────────────────────────
    const leftDist = Math.abs(noseTip.x - leftEyeCenter.x)
    const rightDist = Math.abs(noseTip.x - rightEyeCenter.x)
    const yawRatio = leftDist / (rightDist || 1)

    let yaw: 'left' | 'right' | 'center'
    if (yawRatio > 1.7) yaw = 'right'
    else if (yawRatio < 0.58) yaw = 'left'
    else yaw = 'center'

    // ── Pitch (vertical) ──────────────────────────────────────────────────────
    const eyeMidY = (leftEyeCenter.y + rightEyeCenter.y) / 2
    const chinY = jaw[8].y
    const noseToEye = Math.abs(noseTip.y - eyeMidY)
    const noseToChin = Math.abs(chinY - noseTip.y)
    const pitchRatio = noseToEye / (noseToChin || 1)

    let pitch: 'up' | 'down' | 'center'
    if (pitchRatio < 0.45) pitch = 'up'
    else if (pitchRatio > 0.85) pitch = 'down'
    else pitch = 'center'

    // ── Inter-eye symmetry (roll / tilt) ─────────────────────────────────────
    const eyeDeltaY = Math.abs(leftEyeCenter.y - rightEyeCenter.y)
    const eyeSpan = Math.abs(leftEyeCenter.x - rightEyeCenter.x)
    const rollRatio = eyeDeltaY / (eyeSpan || 1)
    const isTilted = rollRatio > 0.3

    // ── Symmetry confidence ───────────────────────────────────────────────────
    const symmetry = 1 - Math.abs(yawRatio - 1) * 0.5
    const confidence = Math.max(0, Math.min(1, symmetry - (isTilted ? 0.2 : 0)))

    const isFacing = yaw === 'center' && pitch === 'center' && !isTilted

    return { yaw, pitch, isFacing, confidence }
}

/**
 * Simple liveness score: combines face detection confidence, head pose,
 * and blink-like landmark variation across frames.
 */
function computeLivenessScore(
    detectionScore: number,
    poseConfidence: number,
    recentFrameVariance: number   // variance in nose landmark across last N frames
): number {
    const base = detectionScore * 50             // 0–50 from detection confidence
    const poseBonus = poseConfidence * 30        // 0–30 from pose
    // Small variance in facial landmarks = likely a photo. Some variance = real face.
    const varianceBonus = Math.min(20, recentFrameVariance * 100)
    return Math.min(100, Math.round(base + poseBonus + varianceBonus))
}

// ─── Component ────────────────────────────────────────────────────────────────

const VerificationCamera = forwardRef<VerificationCameraHandle, VerificationCameraProps>(
    ({ onStatusChange, onLivenessScore }, ref) => {
        const webcamRef = useRef<Webcam>(null)
        const canvasRef = useRef<HTMLCanvasElement>(null)
        const livenessScoreRef = useRef(0)
        const noseHistoryRef = useRef<{ x: number; y: number }[]>([])

        const [isModelLoaded, setIsModelLoaded] = useState(false)
        const [modelLoadError, setModelLoadError] = useState<string | null>(null)
        const [verificationStatus, setVerificationStatus] = useState<'idle' | 'scanning' | 'verified' | 'failed'>('idle')
        const [failureReason, setFailureReason] = useState<VerificationFailureReason>(null)
        const [livenessScore, setLivenessScore] = useState(0)
        const [poseLabel, setPoseLabel] = useState<string>('–')

        // ── Imperative handle ─────────────────────────────────────────────────
        useImperativeHandle(ref, () => ({
            takeSnapshot: () => webcamRef.current?.getScreenshot() ?? null,
            getLivenessScore: () => livenessScoreRef.current,
        }))

        // ── Load models ───────────────────────────────────────────────────────
        useEffect(() => {
            let cancelled = false
            const loadModels = async () => {
                const MODEL_URL = '/models'
                try {
                    await Promise.all([
                        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
                        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
                    ])
                    if (!cancelled) {
                        setIsModelLoaded(true)
                        setVerificationStatus('scanning')
                    }
                } catch (error) {
                    console.error('Error loading AI models:', error)
                    if (!cancelled) setModelLoadError('AI models failed to load. Please refresh.')
                }
            }
            loadModels()
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

                // ── Draw on canvas ────────────────────────────────────────────
                if (canvasRef.current) {
                    const displaySize = { width: video.videoWidth, height: video.videoHeight }
                    faceapi.matchDimensions(canvasRef.current, displaySize)
                    const resized = faceapi.resizeResults(detections, displaySize)
                    const ctx = canvasRef.current.getContext('2d')
                    if (ctx) {
                        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
                        // Custom drawing for cleaner look
                        resized.forEach(det => {
                            const box = det.detection.box
                            ctx.strokeStyle = det.detection.score > 0.6 ? '#00ff9d' : '#ffd700'
                            ctx.lineWidth = 2
                            ctx.strokeRect(box.x, box.y, box.width, box.height)
                            // Draw key landmark points
                            det.landmarks.positions.forEach((pt, idx) => {
                                // Only draw key points for a cleaner look
                                if ([33, 263, 1, 61, 291, 199].includes(idx)) {
                                    ctx.beginPath()
                                    ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2)
                                    ctx.fillStyle = '#00ff9d'
                                    ctx.fill()
                                }
                            })
                        })
                    }
                }

                // ── Single face ───────────────────────────────────────────────
                if (detections.length === 1) {
                    const det = detections[0]

                    if (det.detection.score < 0.4) {
                        setVerificationStatus('scanning')
                        return
                    }

                    // Head pose
                    const pose = estimateHeadPose(det.landmarks)

                    // Nose landmark history for liveness
                    const noseTip = det.landmarks.getNose()[6]
                    noseHistoryRef.current.push({ x: noseTip.x, y: noseTip.y })
                    if (noseHistoryRef.current.length > 10) noseHistoryRef.current.shift()

                    let frameVariance = 0
                    if (noseHistoryRef.current.length >= 3) {
                        const xs = noseHistoryRef.current.map(p => p.x)
                        const ys = noseHistoryRef.current.map(p => p.y)
                        const meanX = xs.reduce((a, b) => a + b, 0) / xs.length
                        const meanY = ys.reduce((a, b) => a + b, 0) / ys.length
                        frameVariance = xs.reduce((s, x) => s + (x - meanX) ** 2, 0) / xs.length
                            + ys.reduce((s, y) => s + (y - meanY) ** 2, 0) / ys.length
                    }

                    const lScore = computeLivenessScore(det.detection.score, pose.confidence, frameVariance)
                    livenessScoreRef.current = lScore
                    setLivenessScore(lScore)
                    onLivenessScore?.(lScore)

                    // Pose label for display
                    if (!pose.isFacing) {
                        const parts = []
                        if (pose.yaw !== 'center') parts.push(`Looking ${pose.yaw}`)
                        if (pose.pitch !== 'center') parts.push(`Head ${pose.pitch}`)
                        setPoseLabel(parts.join(', ') || 'Head tilted')
                    } else {
                        setPoseLabel('Facing camera')
                    }

                    if (!pose.isFacing) {
                        const reason: VerificationFailureReason = pose.yaw !== 'center' ? 'Gaze Divergence' : 'Head Tilted'
                        setVerificationStatus('failed')
                        setFailureReason(reason)
                        onStatusChange?.(false, reason)
                    } else {
                        setVerificationStatus('verified')
                        setFailureReason(null)
                        onStatusChange?.(true)
                    }

                } else if (detections.length === 0) {
                    noseHistoryRef.current = []
                    setVerificationStatus('failed')
                    setFailureReason('No face detected')
                    onStatusChange?.(false, 'No face detected')
                    setPoseLabel('–')
                } else {
                    setVerificationStatus('failed')
                    setFailureReason('Multiple faces detected')
                    onStatusChange?.(false, 'Multiple faces detected')
                }
            }, 450) // ~2.2 fps — good balance between accuracy and CPU

            return () => clearInterval(interval)
        }, [isModelLoaded, onStatusChange, onLivenessScore])

        // ── Liveness bar color ────────────────────────────────────────────────
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
                        <div style={{
                            position: 'absolute', bottom: 0, left: 0, right: 0,
                            height: '3px', background: 'rgba(0,0,0,0.4)'
                        }}>
                            <div style={{
                                height: '100%', width: `${livenessScore}%`,
                                background: livenessColor, transition: 'width 0.4s ease, background 0.4s ease'
                            }} />
                        </div>
                    )}

                    {/* Status overlay */}
                    <div className={`${styles.statusOverlay} ${styles[verificationStatus]}`}>
                        <div className={styles.statusDot} />
                        <span className={styles.statusText}>
                            {modelLoadError && modelLoadError}
                            {!modelLoadError && verificationStatus === 'idle' && 'Initializing AI...'}
                            {!modelLoadError && verificationStatus === 'scanning' && 'Scanning...'}
                            {!modelLoadError && verificationStatus === 'verified' && `Verified · ${poseLabel}`}
                            {!modelLoadError && verificationStatus === 'failed' && (failureReason || 'Verification Failed')}
                        </span>
                    </div>
                </div>

                {/* Liveness score row */}
                {isModelLoaded && (
                    <div style={{
                        display: 'flex', justifyContent: 'space-between',
                        fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '6px', padding: '0 2px'
                    }}>
                        <span>Liveness Score</span>
                        <span style={{ color: livenessColor, fontWeight: 700 }}>{livenessScore}%</span>
                    </div>
                )}
            </div>
        )
    }
)

VerificationCamera.displayName = 'VerificationCamera'
export default VerificationCamera
