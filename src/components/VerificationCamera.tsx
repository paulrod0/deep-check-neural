'use client'

import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react'
import Webcam from 'react-webcam'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import styles from './VerificationCamera.module.css'
import {
    DeepfakeFrameBuffer,
    DeepfakeResult,
    extractDeepfakeFrame,
    runDeepfakeDetection,
    warmupDeepfakeModel,
} from '@/lib/deepfakeInference'
import { RPPGCouplingDetector, RPPGResult } from '@/lib/rppgCoupling'
import { FACSConstraintEngine, FACSResult, blendshapeCategoriesToScores } from '@/lib/facsConstraints'
import { computeEnsemble, LayerScore, EnsembleResult } from '@/lib/veritasEnsemble'
import { AuditChain } from '@/lib/auditChain'

// ─── Types (unchanged — backward-compatible) ─────────────────────────────────

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
    onAntiCheatEvent?: (event: AntiCheatEvent) => void
    lightingChallengeActive?: boolean
}

export interface VerificationCameraHandle {
    takeSnapshot: () => string | null
    getLivenessScore: () => number
    getBlinkRate: () => number
    getFaceMetrics: () => FaceMetrics | null
}

export type GazeDirection = 'center' | 'left' | 'right' | 'up' | 'down' | 'unknown'

export interface BlinkEvent {
    type: 'blink' | 'blink_rate_anomaly' | 'prolonged_closure'
    blinkDurationMs?: number
    blinkRate?: number
    detail?: string
    timestamp: number
}

export interface AntiCheatEvent {
    type:
        | 'lighting_challenge_pass'
        | 'lighting_challenge_fail'
        | 'saccade_detected'
        | 'saccade_too_smooth'
        | 'blink_edge_clean'
        | 'blink_edge_artifact'
        | 'oculo_manual_synced'
        | 'oculo_manual_desynced'
        | 'blendshape_anomaly'        // deepfake blendshape inconsistency
        | 'iris_landmark_anomaly'     // iris position inconsistent with gaze
        | 'deepfake_cnn_alert'        // CNN model flagged deepfake or photo replay
        | 'facs_violation'            // FACS biomechanical rule broken (L2)
        | 'rppg_decoupling'           // rPPG-motion coupling absent (L1)
        | 'veritas_alert'             // Ensemble pFake > 0.70
    confidence: number
    detail?: string
    timestamp: number
}

export interface FaceMetrics {
    livenessScore: number
    blinkRate: number
    blinkCount: number
    avgBlinkDuration: number
    headSymmetryScore: number
    microMovementScore: number
    eyeOpenness: number
    gazeStabilityScore: number
    faceBrightnessDelta: number
    lightingChallengesPassed: number
    lightingChallengesFailed: number
    saccadeScore: number
    blinkEdgeScore: number
    ocoloManualScore: number
    // MediaPipe-enhanced fields
    irisTrackingQuality?: number     // 0–100 iris landmark confidence
    blendshapeConsistency?: number   // 0–100 bilateral blendshape symmetry
    depthVariance?: number           // z-axis variance (flat image = 0)
    // Deepfake CNN fields
    deepfakeRiskScore?: number       // 0–100 (higher = more suspicious)
    deepfakePrediction?: 'real_human' | 'deepfake_video' | 'photo_replay' | null
    // Veritas Engine v2 fields
    facsScore?: number               // 0–100 FACS biomechanical fake score (L2)
    rppgCouplingStrength?: number    // 0–1 rPPG-motion coupling (L1)
    veritasPFake?: number            // 0–1 Bayesian ensemble P(fake)
    veritasVerdict?: 'real' | 'suspicious' | 'fake'
}

// ─── MediaPipe Configuration ─────────────────────────────────────────────────

const MP_WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm'
const MP_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

// MediaPipe FaceMesh landmark indices
const MP_IDX = {
    // Eye landmarks for EAR computation (6-point model)
    LEFT_EYE_EAR:  { p1: 33, p2: 160, p3: 158, p4: 133, p5: 153, p6: 145 },
    RIGHT_EYE_EAR: { p1: 263, p2: 385, p3: 387, p4: 362, p5: 373, p6: 380 },
    // Eye contours for drawing (16 points each)
    LEFT_EYE_CONTOUR:  [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7],
    RIGHT_EYE_CONTOUR: [362, 398, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380, 381, 382],
    // Iris (5 points each: center + 4 boundary)
    LEFT_IRIS:  { center: 468, ring: [469, 470, 471, 472] },
    RIGHT_IRIS: { center: 473, ring: [474, 475, 476, 477] },
    // Nose
    NOSE_TIP: 1,
    NOSE_BRIDGE: [6, 197, 195, 5, 4, 1],
    // Face oval for bounding box / symmetry
    FACE_OVAL: [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
                400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109],
    // Key pose points
    FOREHEAD: 10,
    CHIN: 152,
    LEFT_CHEEK: 234,
    RIGHT_CHEEK: 454,
} as const

// Blendshape names we care about
const BS_NAMES = {
    eyeBlinkLeft: 'eyeBlinkLeft',
    eyeBlinkRight: 'eyeBlinkRight',
    eyeLookDownLeft: 'eyeLookDownLeft',
    eyeLookDownRight: 'eyeLookDownRight',
    eyeLookInLeft: 'eyeLookInLeft',
    eyeLookInRight: 'eyeLookInRight',
    eyeLookOutLeft: 'eyeLookOutLeft',
    eyeLookOutRight: 'eyeLookOutRight',
    eyeLookUpLeft: 'eyeLookUpLeft',
    eyeLookUpRight: 'eyeLookUpRight',
    eyeSquintLeft: 'eyeSquintLeft',
    eyeSquintRight: 'eyeSquintRight',
    jawOpen: 'jawOpen',
    browDownLeft: 'browDownLeft',
    browDownRight: 'browDownRight',
    browInnerUp: 'browInnerUp',
    mouthSmileLeft: 'mouthSmileLeft',
    mouthSmileRight: 'mouthSmileRight',
    cheekSquintLeft: 'cheekSquintLeft',
    cheekSquintRight: 'cheekSquintRight',
} as const

// ─── Geometry helpers ────────────────────────────────────────────────────────

interface Point2D { x: number; y: number }

interface NormLandmark { x: number; y: number; z: number }

/** Convert normalized landmark [0,1] to pixel coords */
function lmToPixel(lm: NormLandmark, w: number, h: number): Point2D {
    return { x: lm.x * w, y: lm.y * h }
}

function dist2D(a: Point2D, b: Point2D): number {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

/** Extract a blendshape score by name from MediaPipe result */
function getBS(categories: Array<{ categoryName: string; score: number }>, name: string): number {
    return categories.find(c => c.categoryName === name)?.score ?? 0
}

// ─── EAR from 478-landmark mesh ──────────────────────────────────────────────

function computeEAR_MP(landmarks: NormLandmark[], eye: { p1: number; p2: number; p3: number; p4: number; p5: number; p6: number }, w: number, h: number): number {
    const p1 = lmToPixel(landmarks[eye.p1], w, h)
    const p2 = lmToPixel(landmarks[eye.p2], w, h)
    const p3 = lmToPixel(landmarks[eye.p3], w, h)
    const p4 = lmToPixel(landmarks[eye.p4], w, h)
    const p5 = lmToPixel(landmarks[eye.p5], w, h)
    const p6 = lmToPixel(landmarks[eye.p6], w, h)
    const a = dist2D(p2, p6)
    const b = dist2D(p3, p5)
    const c = dist2D(p1, p4) || 1
    return (a + b) / (2 * c)
}

// ─── Head pose from transformation matrix ────────────────────────────────────

interface HeadPoseResult {
    yaw: 'left' | 'right' | 'center'
    pitch: 'up' | 'down' | 'center'
    isFacing: boolean
    confidence: number
    symmetryScore: number
    yawDegrees: number
    pitchDegrees: number
    rollDegrees: number
}

function estimateHeadPoseFromMatrix(matrixData: number[], landmarks: NormLandmark[]): HeadPoseResult {
    // Extract Euler angles from 4x4 column-major transformation matrix
    // Column-major: data[col*4 + row]
    const m00 = matrixData[0], m10 = matrixData[1], m20 = matrixData[2]
    const m01 = matrixData[4], m11 = matrixData[5], m21 = matrixData[6]
    const m22 = matrixData[10]

    const RAD2DEG = 180 / Math.PI

    // ZYX Euler decomposition
    const pitchRad = Math.asin(Math.max(-1, Math.min(1, -m20)))
    const yawRad   = Math.atan2(m10, m00)
    const rollRad  = Math.atan2(m21, m22)

    const yawDeg   = yawRad * RAD2DEG
    const pitchDeg = pitchRad * RAD2DEG
    const rollDeg  = rollRad * RAD2DEG

    // Classify
    let yaw: 'left' | 'right' | 'center'
    if (yawDeg > 15)       yaw = 'right'
    else if (yawDeg < -15) yaw = 'left'
    else                   yaw = 'center'

    let pitch: 'up' | 'down' | 'center'
    if (pitchDeg > 15)       pitch = 'down'
    else if (pitchDeg < -15) pitch = 'up'
    else                     pitch = 'center'

    const isTilted = Math.abs(rollDeg) > 22

    // Bilateral symmetry from face oval landmarks
    const noseTip = landmarks[MP_IDX.NOSE_TIP]
    const oval = MP_IDX.FACE_OVAL.map(i => landmarks[i])
    const halfLen = Math.floor(oval.length / 2)
    let symSum = 0
    for (let i = 0; i < halfLen; i++) {
        const lDist = Math.abs(oval[i].x - noseTip.x)
        const rDist = Math.abs(oval[oval.length - 1 - i].x - noseTip.x)
        const ratio = Math.min(lDist, rDist) / (Math.max(lDist, rDist) || 0.001)
        symSum += ratio
    }
    const symmetryScore = Math.round((symSum / halfLen) * 100)

    const symmetry   = 1 - Math.abs(yawDeg) / 90
    const confidence = Math.max(0, Math.min(1, symmetry - (isTilted ? 0.2 : 0)))
    const isFacing   = yaw === 'center' && pitch === 'center' && !isTilted

    return { yaw, pitch, isFacing, confidence, symmetryScore, yawDegrees: yawDeg, pitchDegrees: pitchDeg, rollDegrees: rollDeg }
}

// ─── Iris-based gaze estimation ──────────────────────────────────────────────

interface GazeEstimate {
    direction: GazeDirection
    confidence: number
    leftIrisRatio: number
    rightIrisRatio: number
    leftEAR: number
    rightEAR: number
    avgEAR: number
    irisVerticalRatio: number
}

function estimateGazeFromIris(
    landmarks: NormLandmark[],
    blendshapes: Array<{ categoryName: string; score: number }>,
    w: number, h: number
): GazeEstimate {
    // Iris horizontal position relative to eye corners
    const leftIris   = landmarks[MP_IDX.LEFT_IRIS.center]
    const leftOuter  = landmarks[MP_IDX.LEFT_EYE_EAR.p1]
    const leftInner  = landmarks[MP_IDX.LEFT_EYE_EAR.p4]
    const leftEyeW   = leftInner.x - leftOuter.x || 0.001
    const leftIrisRatio = (leftIris.x - leftOuter.x) / leftEyeW

    const rightIris  = landmarks[MP_IDX.RIGHT_IRIS.center]
    const rightOuter = landmarks[MP_IDX.RIGHT_EYE_EAR.p1]
    const rightInner = landmarks[MP_IDX.RIGHT_EYE_EAR.p4]
    const rightEyeW  = rightInner.x - rightOuter.x || 0.001
    const rightIrisRatio = (rightIris.x - rightOuter.x) / Math.abs(rightEyeW)

    // Geometric EAR (for backward compat and display)
    const leftEAR  = computeEAR_MP(landmarks, MP_IDX.LEFT_EYE_EAR, w, h)
    const rightEAR = computeEAR_MP(landmarks, MP_IDX.RIGHT_EYE_EAR, w, h)
    const avgEAR   = (leftEAR + rightEAR) / 2

    // Vertical iris position
    const leftTop = landmarks[159]  // top of left eye
    const leftBot = landmarks[145]  // bottom of left eye
    const leftEyeH = leftBot.y - leftTop.y || 0.001
    const leftVRatio = (leftIris.y - leftTop.y) / leftEyeH
    const rightTop = landmarks[386]
    const rightBot = landmarks[380]
    const rightEyeH = rightBot.y - rightTop.y || 0.001
    const rightVRatio = (rightIris.y - rightTop.y) / rightEyeH
    const irisVerticalRatio = (leftVRatio + rightVRatio) / 2

    // Use blendshapes as primary gaze signal
    const lookInL  = getBS(blendshapes, BS_NAMES.eyeLookInLeft)
    const lookOutL = getBS(blendshapes, BS_NAMES.eyeLookOutLeft)
    const lookInR  = getBS(blendshapes, BS_NAMES.eyeLookInRight)
    const lookOutR = getBS(blendshapes, BS_NAMES.eyeLookOutRight)
    const lookUpL  = getBS(blendshapes, BS_NAMES.eyeLookUpLeft)
    const lookUpR  = getBS(blendshapes, BS_NAMES.eyeLookUpRight)
    const lookDnL  = getBS(blendshapes, BS_NAMES.eyeLookDownLeft)
    const lookDnR  = getBS(blendshapes, BS_NAMES.eyeLookDownRight)

    // Horizontal: "lookIn" = towards nose, "lookOut" = away from nose
    // For left eye: lookIn = looking right (from user's perspective), lookOut = looking left
    // For right eye: lookIn = looking left, lookOut = looking right
    // Combined: positive = looking right, negative = looking left
    const hScore = ((lookInL + lookOutR) - (lookOutL + lookInR)) / 2

    // Vertical: positive = looking up, negative = looking down
    const vScore = ((lookUpL + lookUpR) - (lookDnL + lookDnR)) / 2

    let direction: GazeDirection = 'center'
    let confidence = 0.85

    // Thresholds tuned for MediaPipe blendshapes (range 0-1)
    if (Math.abs(vScore) > 0.25 && Math.abs(vScore) > Math.abs(hScore)) {
        direction = vScore > 0 ? 'up' : 'down'
        confidence = Math.min(1, Math.abs(vScore))
    } else if (Math.abs(hScore) > 0.15) {
        direction = hScore > 0 ? 'right' : 'left'
        confidence = Math.min(1, Math.abs(hScore) * 2)
    }

    // Cross-validate with iris position (secondary signal)
    const avgIrisH = (leftIrisRatio + rightIrisRatio) / 2
    if (direction === 'center' && (avgIrisH < 0.35 || avgIrisH > 0.65)) {
        // Iris says off-center but blendshapes don't — flag as low confidence
        direction = avgIrisH < 0.35 ? 'right' : 'left'
        confidence = 0.5
    }

    return { direction, confidence, leftIrisRatio, rightIrisRatio, leftEAR, rightEAR, avgEAR, irisVerticalRatio }
}

// ─── Blendshape-based blink detection ────────────────────────────────────────
// Uses eyeBlinkLeft/Right blendshapes (0 = open, 1 = closed)
// Much more robust than geometric EAR — works with glasses, angles, heavy eyelids

const _sj = (() => { const t = performance.now(); return (t - Math.floor(t)) })()
const _BLINK_CLOSE_THRESH = 0.45 + (_sj * 0.06 - 0.03)  // ±0.03 around 0.45
const _BLINK_OPEN_THRESH  = 0.25 + (_sj * 0.04 - 0.02)  // ±0.02 around 0.25
const _FR_MIN = 2
const _FR_MAX = 12

interface BlinkState {
    closedFrames: number
    isInBlink: boolean
    blinkStart: number
}

// ─── Gaze stability ──────────────────────────────────────────────────────────

function computeGazeStability(gazeHistory: number[]): number {
    if (gazeHistory.length < 5) return 100
    const mean = gazeHistory.reduce((s, v) => s + v, 0) / gazeHistory.length
    const variance = gazeHistory.reduce((s, v) => s + (v - mean) ** 2, 0) / gazeHistory.length
    return Math.max(0, Math.min(100, Math.round(100 - variance * 3000)))
}

// ─── Micro-movement (liveness jitter) ────────────────────────────────────────

function computeMicroMovementScore(nosePts: Point2D[]): number {
    if (nosePts.length < 5) return 50
    const xs = nosePts.map(p => p.x)
    const ys = nosePts.map(p => p.y)
    const meanX = xs.reduce((s, v) => s + v, 0) / xs.length
    const meanY = ys.reduce((s, v) => s + v, 0) / ys.length
    const totalVar = xs.reduce((s, x) => s + (x - meanX) ** 2, 0) / xs.length
                   + ys.reduce((s, y) => s + (y - meanY) ** 2, 0) / ys.length
    if (totalVar < 0.05) return 10
    if (totalVar < 0.2)  return 40
    if (totalVar < 5.0)  return 85 + Math.min(15, totalVar * 5)
    if (totalVar < 15.0) return Math.max(50, 100 - totalVar * 3)
    return 30
}

// ─── Liveness score ──────────────────────────────────────────────────────────

function computeLivenessScore(
    poseConfidence: number,
    microMovement: number,
    blinkCount: number,
    elapsedMinutes: number,
    gazeStability: number,
    depthVariance: number,          // NEW: z-axis depth signal
    blendshapeConsistency: number   // NEW: bilateral consistency
): number {
    const poseBonus  = poseConfidence * 20          // 0–20
    const jitterScore = microMovement * 0.2         // 0–20
    const depthBonus = Math.min(15, depthVariance * 500)  // 0–15 (flat image = 0)

    const expectedBlinks = elapsedMinutes * 17
    const blinkRatio = expectedBlinks > 0
        ? Math.min(1, blinkCount / expectedBlinks)
        : (blinkCount > 0 ? 1 : 0)
    const blinkBonus = blinkRatio * 15              // 0–15

    const gazeBonus  = (gazeStability / 100) * 10   // 0–10
    const bsBonus    = (blendshapeConsistency / 100) * 20  // 0–20

    return Math.min(100, Math.round(poseBonus + jitterScore + blinkBonus + gazeBonus + depthBonus + bsBonus))
}

// ─── Saccade analysis (same algorithm, adapted) ─────────────────────────────

function _gk7(h: number[]): number {
    if (h.length < 8) return 50
    const d1: number[] = []
    for (let i = 1; i < h.length; i++) d1.push(h[i] - h[i - 1])
    const d2: number[] = []
    for (let i = 1; i < d1.length; i++) d2.push(d1[i] - d1[i - 1])
    const mu = d2.reduce((s, v) => s + v, 0) / d2.length
    const vr = d2.reduce((s, v) => s + (v - mu) ** 2, 0) / d2.length
    if (vr < 0.00005) return 5
    if (vr < 0.0001)  return 25
    if (vr < 0.0003)  return 60
    if (vr < 0.001)   return 85
    return 95
}

// ─── Blink-edge consistency (EAR trajectory) ─────────────────────────────────

interface EARFrame { leftEAR: number; rightEAR: number; ts: number }

function _qv3(earHistory: EARFrame[], blinkFrames: number[]): number {
    if (earHistory.length < 5 || blinkFrames.length === 0) return 75
    let tot = 0, n = 0
    blinkFrames.forEach(idx => {
        if (idx < 1 || idx >= earHistory.length) return
        const f = earHistory[idx]
        const b = earHistory[idx - 1]
        const a = idx + 1 < earHistory.length ? earHistory[idx + 1] : null
        const sc = (b.leftEAR - f.leftEAR) < 0.01
        const asym = Math.abs(f.leftEAR - f.rightEAR)
        const us = asym < 0.005
        const wk = asym > 0.10
        const so = a ? (a.leftEAR - f.leftEAR > 0.15) : false
        let s = 90
        if (sc) s -= 25
        if (us) s -= 20
        if (so) s -= 20
        if (wk) s -= 10
        tot += Math.max(0, s); n++
    })
    return n === 0 ? 75 : Math.round(tot / n)
}

// ─── Lighting challenge evaluator ────────────────────────────────────────────

interface LightingChallengeResult { passed: boolean; deltaEAR: number; confidence: number }

function _pr9(earBefore: number, earAfter: number[]): LightingChallengeResult {
    if (earAfter.length === 0) return { passed: false, deltaEAR: 0, confidence: 0 }
    const mn   = Math.min(...earAfter)
    const dEAR = earBefore - mn
    return { passed: dEAR > 0.018, deltaEAR: dEAR, confidence: Math.min(1, dEAR / 0.06) }
}

// ─── Blendshape consistency (anti-deepfake) ──────────────────────────────────
// Checks bilateral blendshape pairs: real faces have natural slight asymmetry.
// Deepfakes: either perfectly symmetric (<0.005 diff) or unnaturally asymmetric.

function computeBlendshapeConsistency(categories: Array<{ categoryName: string; score: number }>): number {
    const pairs: [string, string][] = [
        [BS_NAMES.eyeBlinkLeft, BS_NAMES.eyeBlinkRight],
        [BS_NAMES.eyeSquintLeft, BS_NAMES.eyeSquintRight],
        [BS_NAMES.eyeLookDownLeft, BS_NAMES.eyeLookDownRight],
        [BS_NAMES.eyeLookUpLeft, BS_NAMES.eyeLookUpRight],
        [BS_NAMES.browDownLeft, BS_NAMES.browDownRight],
        [BS_NAMES.mouthSmileLeft, BS_NAMES.mouthSmileRight],
        [BS_NAMES.cheekSquintLeft, BS_NAMES.cheekSquintRight],
    ]

    let totalScore = 0, count = 0
    for (const [left, right] of pairs) {
        const l = getBS(categories, left)
        const r = getBS(categories, right)
        const diff = Math.abs(l - r)
        // Natural: slight asymmetry (0.01–0.12)
        // Deepfake: perfect symmetry (<0.005) or extreme asymmetry (>0.25)
        if (diff < 0.005)      totalScore += 30
        else if (diff < 0.01)  totalScore += 65
        else if (diff < 0.12)  totalScore += 95
        else if (diff < 0.25)  totalScore += 60
        else                   totalScore += 20
        count++
    }
    return count > 0 ? Math.round(totalScore / count) : 50
}

// ─── Depth variance (anti-photo) ─────────────────────────────────────────────
// A real face has z-depth variation across landmarks. A flat photo → near-zero variance.

function computeDepthVariance(landmarks: NormLandmark[]): number {
    const keyPoints = [
        MP_IDX.NOSE_TIP, MP_IDX.FOREHEAD, MP_IDX.CHIN,
        MP_IDX.LEFT_CHEEK, MP_IDX.RIGHT_CHEEK,
        ...MP_IDX.LEFT_IRIS.ring, ...MP_IDX.RIGHT_IRIS.ring,
        MP_IDX.LEFT_EYE_EAR.p1, MP_IDX.RIGHT_EYE_EAR.p1,
    ]
    const zValues = keyPoints.map(i => landmarks[i]?.z ?? 0)
    const mean = zValues.reduce((s, v) => s + v, 0) / zValues.length
    return zValues.reduce((s, v) => s + (v - mean) ** 2, 0) / zValues.length
}

// ─── Canvas drawing helpers ──────────────────────────────────────────────────

function drawFaceOverlay(
    ctx: CanvasRenderingContext2D,
    landmarks: NormLandmark[],
    w: number, h: number,
    confidence: number
) {
    const color = confidence > 0.6 ? '#00ff9d' : '#ffd700'

    // Bounding box from face oval
    const ovalPts = MP_IDX.FACE_OVAL.map(i => lmToPixel(landmarks[i], w, h))
    const xs = ovalPts.map(p => p.x)
    const ys = ovalPts.map(p => p.y)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const pad = 8
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.strokeRect(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2)

    // Eye contours
    for (const contour of [MP_IDX.LEFT_EYE_CONTOUR, MP_IDX.RIGHT_EYE_CONTOUR]) {
        ctx.beginPath()
        const pts = contour.map(i => lmToPixel(landmarks[i], w, h))
        ctx.moveTo(pts[0].x, pts[0].y)
        pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y))
        ctx.closePath()
        ctx.strokeStyle = 'rgba(0,255,157,0.7)'
        ctx.lineWidth = 1.5
        ctx.stroke()
    }

    // Iris circles
    for (const iris of [MP_IDX.LEFT_IRIS, MP_IDX.RIGHT_IRIS]) {
        const center = lmToPixel(landmarks[iris.center], w, h)
        const ring = iris.ring.map(i => lmToPixel(landmarks[i], w, h))
        const avgR = ring.reduce((s, p) => s + dist2D(center, p), 0) / ring.length
        ctx.beginPath()
        ctx.arc(center.x, center.y, avgR, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(0,200,255,0.8)'
        ctx.lineWidth = 1.2
        ctx.stroke()
        // Iris center dot
        ctx.beginPath()
        ctx.arc(center.x, center.y, 1.5, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(0,200,255,0.9)'
        ctx.fill()
    }

    // Nose bridge
    const nosePts = MP_IDX.NOSE_BRIDGE.map(i => lmToPixel(landmarks[i], w, h))
    ctx.beginPath()
    ctx.moveTo(nosePts[0].x, nosePts[0].y)
    nosePts.slice(1).forEach(p => ctx.lineTo(p.x, p.y))
    ctx.strokeStyle = 'rgba(0,255,157,0.3)'
    ctx.lineWidth = 1
    ctx.stroke()
}

// ─── Component ───────────────────────────────────────────────────────────────

const VerificationCamera = forwardRef<VerificationCameraHandle, VerificationCameraProps>(
    ({ onStatusChange, onLivenessScore, onGazeEvent, onBlinkEvent, onFaceMetrics, onAntiCheatEvent, lightingChallengeActive }, ref) => {
        const webcamRef        = useRef<Webcam>(null)
        const canvasRef        = useRef<HTMLCanvasElement>(null)
        const landmarkerRef    = useRef<FaceLandmarker | null>(null)
        const livenessScoreRef = useRef(0)
        const noseHistoryRef   = useRef<Point2D[]>([])
        const gazeHistoryRef   = useRef<GazeDirection[]>([])
        const gazeRatioHistRef = useRef<number[]>([])
        const lastGazeEventRef = useRef<GazeDirection>('center')
        const sessionStartRef  = useRef<number>(0)

        // Blink tracking (blendshape-based)
        const blinkStateRef    = useRef<BlinkState>({ closedFrames: 0, isInBlink: false, blinkStart: 0 })
        const blinkCountRef    = useRef<number>(0)
        const blinkTimesRef    = useRef<number[]>([])
        const blinkDurationsRef= useRef<number[]>([])
        const blinkFrameIdxRef = useRef<number[]>([])

        // EAR history (for blink-edge analysis)
        const earHistoryRef    = useRef<EARFrame[]>([])
        const frameCounterRef  = useRef<number>(0)

        // Blendshape history (for temporal consistency)
        const bsConsistencyHistRef = useRef<number[]>([])

        // Lighting challenge
        const lcActiveRef             = useRef<boolean>(false)
        const lcEARBeforeRef          = useRef<number>(0)
        const lcAfterEARsRef          = useRef<number[]>([])
        const lcGazeRatiosDuringFlash = useRef<number[]>([])
        const lcGazeRatioBefore       = useRef<number>(0.5)
        const lcPassedRef             = useRef<number>(0)
        const lcFailedRef             = useRef<number>(0)

        // Anti-cheat scores
        const saccadeScoreRef         = useRef<number>(50)
        const blinkEdgeScoreRef       = useRef<number>(75)
        const consecutiveSmoothRef    = useRef<number>(0)
        const lastSaccadeTooSmoothRef = useRef<number>(0)

        // Deepfake CNN buffer + last result
        const deepfakeBufferRef       = useRef<DeepfakeFrameBuffer>(new DeepfakeFrameBuffer())
        const lastDeepfakeResultRef   = useRef<DeepfakeResult | null>(null)
        const lastDeepfakeCnnAlertRef = useRef<number>(0)
        const deepfakeCnnRunningRef   = useRef<boolean>(false)

        // Pixel deepfake model (server-side EfficientNet-B4)
        const pixelDeepfakeRunningRef = useRef<boolean>(false)
        const lastPixelAlertRef       = useRef<number>(0)
        const pixelModelAvailableRef  = useRef<boolean | null>(null)  // null=unknown, true/false

        // Veritas Engine v2 — L1 rPPG, L2 FACS, ensemble, audit chain
        const rppgDetectorRef       = useRef<RPPGCouplingDetector>(new RPPGCouplingDetector())
        const facsEngineRef         = useRef<FACSConstraintEngine>(new FACSConstraintEngine())
        const auditChainRef         = useRef<AuditChain>(new AuditChain())
        const prevLandmarksRef      = useRef<Array<{x: number; y: number; z: number}> | null>(null)
        const lastFacsResultRef     = useRef<FACSResult | null>(null)
        const lastRppgResultRef     = useRef<RPPGResult | null>(null)
        const lastEnsembleRef       = useRef<EnsembleResult | null>(null)
        const lastFacsAlertRef      = useRef<number>(0)
        const lastRppgAlertRef      = useRef<number>(0)
        const lastVeritasAlertRef   = useRef<number>(0)

        // Rich metrics
        const faceMetricsRef         = useRef<FaceMetrics | null>(null)
        const blinkRateRef           = useRef<number>(0)
        const lastBlinkCheckMinRef   = useRef<number>(-1)

        // Status dedup
        const lastStatusRef    = useRef<{ verified: boolean; reason: VerificationFailureReason }>({ verified: false, reason: null })
        const modelReadyTimeRef = useRef<number>(0)

        // rAF control
        const rafIdRef = useRef<number>(0)
        const lastDetectTimeRef = useRef<number>(0)

        const [isModelLoaded,      setIsModelLoaded]      = useState(false)
        const [modelLoadError,     setModelLoadError]     = useState<string | null>(null)
        const [verificationStatus, setVerificationStatus] = useState<'idle' | 'scanning' | 'verified' | 'failed'>('idle')
        const [failureReason,      setFailureReason]      = useState<VerificationFailureReason>(null)
        const [livenessScore,      setLivenessScore]      = useState(0)
        const [poseLabel,          setPoseLabel]          = useState<string>('–')
        const [gazeLabel,          setGazeLabel]          = useState<string>('')
        const [gazeRatioDebug,     setGazeRatioDebug]    = useState<number>(0.5)
        const [blinkDisplay,       setBlinkDisplay]       = useState({ count: 0, rate: 0, ear: 0 })
        const [deepfakeCnnDisplay, setDeepfakeCnnDisplay] = useState<{ risk: number; label: string } | null>(null)
        const [rppgDisplay,        setRppgDisplay]        = useState<{ bpm: number; coupling: number } | null>(null)
        const [facsDisplay,        setFacsDisplay]        = useState<{ score: number; topViolation: string } | null>(null)
        const [ensembleDisplay,    setEnsembleDisplay]    = useState<{ pFake: number; verdict: string } | null>(null)

        useImperativeHandle(ref, () => ({
            takeSnapshot:     () => webcamRef.current?.getScreenshot() ?? null,
            getLivenessScore: () => livenessScoreRef.current,
            getBlinkRate:     () => blinkRateRef.current,
            getFaceMetrics:   () => faceMetricsRef.current,
        }))

        // ── Init timing ──────────────────────────────────────────────────────
        useEffect(() => { sessionStartRef.current = performance.now() }, [])

        // ── Load MediaPipe FaceLandmarker ────────────────────────────────────
        useEffect(() => {
            let cancelled = false
            const init = async () => {
                try {
                    const vision = await FilesetResolver.forVisionTasks(MP_WASM_CDN)
                    const landmarker = await FaceLandmarker.createFromOptions(vision, {
                        baseOptions: {
                            modelAssetPath: MP_MODEL_URL,
                            delegate: 'GPU',
                        },
                        outputFaceBlendshapes: true,
                        outputFacialTransformationMatrixes: true,
                        runningMode: 'VIDEO',
                        numFaces: 2,  // need to detect >1 for "Multiple faces" check
                    })
                    if (!cancelled) {
                        landmarkerRef.current = landmarker
                        setIsModelLoaded(true)
                        setVerificationStatus('scanning')
                        modelReadyTimeRef.current = Date.now()
                        // Warm up deepfake CNN silently (non-blocking)
                        warmupDeepfakeModel().catch(() => {/* ignore — model may not exist yet */})
                    }
                } catch (e) {
                    console.error('MediaPipe FaceLandmarker load error:', e)
                    if (!cancelled) setModelLoadError('AI models failed to load. Please refresh.')
                }
            }
            init()
            return () => { cancelled = true; landmarkerRef.current?.close() }
        }, [])

        // ── Detection loop (rAF throttled to ~15fps) ─────────────────────────
        useEffect(() => {
            if (!isModelLoaded || !landmarkerRef.current) return

            const DETECT_INTERVAL_MS = 66 // ~15fps

            const detect = (timestamp: number) => {
                rafIdRef.current = requestAnimationFrame(detect)

                if (timestamp - lastDetectTimeRef.current < DETECT_INTERVAL_MS) return
                lastDetectTimeRef.current = timestamp

                const video = webcamRef.current?.video
                const landmarker = landmarkerRef.current
                if (!video || video.readyState < 4 || !landmarker) return

                const w = video.videoWidth
                const h = video.videoHeight

                // ── MediaPipe detection ──────────────────────────────────────
                let result
                try {
                    result = landmarker.detectForVideo(video, timestamp)
                } catch {
                    return // skip frame on error
                }

                // ── Draw ─────────────────────────────────────────────────────
                if (canvasRef.current) {
                    const displaySize = { width: w, height: h }
                    canvasRef.current.width  = displaySize.width
                    canvasRef.current.height = displaySize.height
                    const ctx = canvasRef.current.getContext('2d')
                    if (ctx) {
                        ctx.clearRect(0, 0, w, h)
                        result.faceLandmarks.forEach((landmarks, i) => {
                            const conf = result.faceBlendshapes[i]
                                ? 0.85
                                : 0.5
                            drawFaceOverlay(ctx, landmarks, w, h, conf)
                        })
                    }
                }

                const now = performance.now()

                // ── Analysis ─────────────────────────────────────────────────
                if (result.faceLandmarks.length === 1) {
                    const landmarks   = result.faceLandmarks[0]
                    const blendshapes = result.faceBlendshapes?.[0]?.categories ?? []
                    const matrix      = result.facialTransformationMatrixes?.[0]

                    // ── Head pose ────────────────────────────────────────────
                    const pose = matrix
                        ? estimateHeadPoseFromMatrix(matrix.data, landmarks)
                        : { yaw: 'center' as const, pitch: 'center' as const, isFacing: true, confidence: 0.5, symmetryScore: 50, yawDegrees: 0, pitchDegrees: 0, rollDegrees: 0 }

                    // ── Gaze (iris + blendshapes) ────────────────────────────
                    const gaze = estimateGazeFromIris(landmarks, blendshapes, w, h)

                    // ── Blendshape-based blink detection ─────────────────────
                    const blinkL = getBS(blendshapes, BS_NAMES.eyeBlinkLeft)
                    const blinkR = getBS(blendshapes, BS_NAMES.eyeBlinkRight)
                    const avgBlink = (blinkL + blinkR) / 2  // 0 = open, 1 = closed

                    const blinkState = blinkStateRef.current

                    if (avgBlink > _BLINK_CLOSE_THRESH) {
                        if (!blinkState.isInBlink) {
                            blinkState.isInBlink  = true
                            blinkState.blinkStart = now
                            blinkState.closedFrames = 1
                        } else {
                            blinkState.closedFrames++
                            if (blinkState.closedFrames > _FR_MAX) {
                                onBlinkEvent?.({
                                    type: 'prolonged_closure',
                                    blinkDurationMs: now - blinkState.blinkStart,
                                    detail: `Eyes closed for ${Math.round(now - blinkState.blinkStart)}ms`,
                                    timestamp: now,
                                })
                                blinkState.closedFrames = 0
                                blinkState.isInBlink    = false
                            }
                        }
                    } else if (avgBlink < _BLINK_OPEN_THRESH && blinkState.isInBlink) {
                        if (blinkState.closedFrames >= _FR_MIN) {
                            const blinkDur = now - blinkState.blinkStart
                            blinkCountRef.current++
                            blinkTimesRef.current.push(now)
                            blinkDurationsRef.current.push(blinkDur)
                            if (blinkTimesRef.current.length > 60)    blinkTimesRef.current.shift()
                            if (blinkDurationsRef.current.length > 60) blinkDurationsRef.current.shift()
                            onBlinkEvent?.({
                                type: 'blink',
                                blinkDurationMs: blinkDur,
                                blinkRate: blinkRateRef.current,
                                timestamp: now,
                            })
                        }
                        blinkState.isInBlink    = false
                        blinkState.closedFrames = 0
                    }

                    // Blink rate
                    const elapsedMin = (now - sessionStartRef.current) / 60000
                    blinkRateRef.current = elapsedMin > 0
                        ? Math.round(blinkCountRef.current / elapsedMin)
                        : blinkCountRef.current

                    // Blink rate anomaly
                    const blinkCheckMin = Math.floor(elapsedMin)
                    if (elapsedMin >= 2.0 && blinkCheckMin > lastBlinkCheckMinRef.current) {
                        lastBlinkCheckMinRef.current = blinkCheckMin
                        if (blinkRateRef.current === 0 && blinkCountRef.current === 0 && elapsedMin >= 3.0) {
                            onBlinkEvent?.({
                                type: 'blink_rate_anomaly',
                                blinkRate: 0,
                                detail: `No blinks detected in ${Math.floor(elapsedMin)} min — possible still image`,
                                timestamp: now,
                            })
                        } else if (blinkRateRef.current > 50) {
                            onBlinkEvent?.({
                                type: 'blink_rate_anomaly',
                                blinkRate: blinkRateRef.current,
                                detail: `High blink rate: ${blinkRateRef.current}/min (> 50)`,
                                timestamp: now,
                            })
                        }
                    }

                    // EAR display value (from blendshape, mapped to legacy EAR range)
                    const displayEAR = Math.round((1 - avgBlink) * 0.35 * 100) / 100
                    setBlinkDisplay({ count: blinkCountRef.current, rate: blinkRateRef.current, ear: displayEAR })

                    // ── EAR history (geometric, for blink-edge) ──────────────
                    const frameIdx = frameCounterRef.current++
                    earHistoryRef.current.push({ leftEAR: gaze.leftEAR, rightEAR: gaze.rightEAR, ts: now })
                    if (earHistoryRef.current.length > 60) earHistoryRef.current.shift()
                    if (avgBlink > _BLINK_CLOSE_THRESH && blinkState.isInBlink) {
                        blinkFrameIdxRef.current.push(earHistoryRef.current.length - 1)
                    }
                    if (blinkFrameIdxRef.current.length > 20) blinkFrameIdxRef.current.shift()

                    // ── Lighting challenge ────────────────────────────────────
                    if (lightingChallengeActive && !lcActiveRef.current) {
                        lcActiveRef.current  = true
                        lcEARBeforeRef.current = gaze.avgEAR
                        lcGazeRatioBefore.current = (gaze.leftIrisRatio + gaze.rightIrisRatio) / 2
                        lcAfterEARsRef.current = []
                        lcGazeRatiosDuringFlash.current = []
                    } else if (!lightingChallengeActive && lcActiveRef.current) {
                        lcActiveRef.current = false
                        if (lcAfterEARsRef.current.length >= 2) {
                            const result = _pr9(lcEARBeforeRef.current, lcAfterEARsRef.current)
                            let gazeFreezeDuringFlash = false
                            const gazeRatios = lcGazeRatiosDuringFlash.current
                            if (gazeRatios.length >= 2) {
                                const mean = gazeRatios.reduce((s, v) => s + v, 0) / gazeRatios.length
                                const variance = gazeRatios.reduce((s, v) => s + (v - mean) ** 2, 0) / gazeRatios.length
                                gazeFreezeDuringFlash = variance < 0.0001
                            }
                            if (result.passed && !gazeFreezeDuringFlash) {
                                lcPassedRef.current++
                                onAntiCheatEvent?.({
                                    type: 'lighting_challenge_pass',
                                    confidence: result.confidence,
                                    detail: `ΔEAR=${result.deltaEAR.toFixed(3)} — pupil/lid reflex detected`,
                                    timestamp: now,
                                })
                            } else {
                                lcFailedRef.current++
                                const failConfidence = gazeFreezeDuringFlash
                                    ? Math.min(1, (1 - result.confidence) + 0.3)
                                    : 1 - result.confidence
                                const detail = gazeFreezeDuringFlash && !result.passed
                                    ? `ΔEAR=${result.deltaEAR.toFixed(3)} + gaze frozen during flash — strong deepfake signal`
                                    : gazeFreezeDuringFlash
                                    ? `ΔEAR=${result.deltaEAR.toFixed(3)} — reflex detected but gaze frozen`
                                    : `ΔEAR=${result.deltaEAR.toFixed(3)} — no reflex to screen flash`
                                onAntiCheatEvent?.({
                                    type: 'lighting_challenge_fail',
                                    confidence: failConfidence,
                                    detail,
                                    timestamp: now,
                                })
                            }
                        }
                    } else if (lightingChallengeActive && lcActiveRef.current) {
                        lcAfterEARsRef.current.push(gaze.avgEAR)
                        lcGazeRatiosDuringFlash.current.push((gaze.leftIrisRatio + gaze.rightIrisRatio) / 2)
                    }

                    // ── Saccade score ────────────────────────────────────────
                    if (frameIdx % 10 === 0 && gazeRatioHistRef.current.length >= 25) {
                        const sScore = _gk7(gazeRatioHistRef.current)
                        saccadeScoreRef.current = sScore
                        if (sScore < 10) {
                            consecutiveSmoothRef.current += 1
                            if (consecutiveSmoothRef.current >= 3 && now - lastSaccadeTooSmoothRef.current > 60000) {
                                lastSaccadeTooSmoothRef.current = now
                                consecutiveSmoothRef.current = 0
                                onAntiCheatEvent?.({
                                    type: 'saccade_too_smooth',
                                    confidence: 1 - sScore / 20,
                                    detail: `Gaze acceleration variance too low (${sScore}/100) — 3 consecutive readings`,
                                    timestamp: now,
                                })
                            }
                        } else {
                            consecutiveSmoothRef.current = 0
                            if (sScore > 60 && frameIdx % 50 === 0) {
                                onAntiCheatEvent?.({ type: 'saccade_detected', confidence: sScore / 100, timestamp: now })
                            }
                        }
                    }

                    // ── Blink-edge score ─────────────────────────────────────
                    if (blinkFrameIdxRef.current.length > 0 && frameIdx % 5 === 0) {
                        const beScore = _qv3(earHistoryRef.current, blinkFrameIdxRef.current)
                        blinkEdgeScoreRef.current = beScore
                        if (beScore < 40) {
                            onAntiCheatEvent?.({
                                type: 'blink_edge_artifact',
                                confidence: 1 - beScore / 40,
                                detail: `Eyelid trajectory anomaly (score ${beScore}/100)`,
                                timestamp: now,
                            })
                        } else if (beScore > 70 && frameIdx % 30 === 0) {
                            onAntiCheatEvent?.({ type: 'blink_edge_clean', confidence: beScore / 100, timestamp: now })
                        }
                    }

                    // ── Blendshape consistency (anti-deepfake) ───────────────
                    const bsConsistency = computeBlendshapeConsistency(blendshapes)
                    bsConsistencyHistRef.current.push(bsConsistency)
                    if (bsConsistencyHistRef.current.length > 30) bsConsistencyHistRef.current.shift()

                    // Alert if consistently low (deepfake signal)
                    if (frameIdx % 20 === 0 && bsConsistencyHistRef.current.length >= 10) {
                        const avgBsC = bsConsistencyHistRef.current.reduce((s, v) => s + v, 0) / bsConsistencyHistRef.current.length
                        if (avgBsC < 40) {
                            onAntiCheatEvent?.({
                                type: 'blendshape_anomaly',
                                confidence: 1 - avgBsC / 50,
                                detail: `Bilateral blendshape consistency ${Math.round(avgBsC)}/100 — unnaturally symmetric or asymmetric`,
                                timestamp: now,
                            })
                        }
                    }

                    // ── Depth variance (anti-photo) ──────────────────────────
                    const depthVar = computeDepthVariance(landmarks)

                    // ── Deepfake CNN — push frame + async inference ───────────
                    if (blendshapes.length > 0) {
                        const dfFrame = extractDeepfakeFrame(blendshapes, landmarks)
                        deepfakeBufferRef.current.pushFrame(dfFrame)

                        // Run inference once the buffer is full, at most every 90 frames
                        if (deepfakeBufferRef.current.isReady && !deepfakeCnnRunningRef.current && frameIdx % 90 === 0) {
                            deepfakeCnnRunningRef.current = true
                            runDeepfakeDetection(deepfakeBufferRef.current)
                                .then(result => {
                                    lastDeepfakeResultRef.current = result
                                    // Update display state
                                    const predLabel =
                                        result.prediction === 'real_human'    ? 'Human' :
                                        result.prediction === 'deepfake_video' ? 'Deepfake' : 'Photo'
                                    setDeepfakeCnnDisplay({ risk: result.riskScore, label: predLabel })
                                    // Alert if deepfake or photo-replay with high confidence, rate-limited to once per 30s
                                    const now2 = performance.now()
                                    if (
                                        result.prediction !== 'real_human' &&
                                        result.riskScore >= 60 &&
                                        now2 - lastDeepfakeCnnAlertRef.current > 30000
                                    ) {
                                        lastDeepfakeCnnAlertRef.current = now2
                                        onAntiCheatEvent?.({
                                            type: 'deepfake_cnn_alert',
                                            confidence: result.riskScore / 100,
                                            detail: `CNN: ${result.prediction} (risk ${result.riskScore}%, ${result.confidence} confidence)`,
                                            timestamp: now2,
                                        })
                                    }
                                })
                                .catch(() => {/* model not loaded yet — silently skip */})
                                .finally(() => { deepfakeCnnRunningRef.current = false })
                        }
                    }

                    // ── Pixel Deepfake Model (server-side EfficientNet-B4) ────
                    // Runs every 150 frames (~10s at 15fps), only if server model available
                    if (
                        pixelModelAvailableRef.current !== false &&
                        !pixelDeepfakeRunningRef.current &&
                        frameIdx % 150 === 0
                    ) {
                        const video = webcamRef.current?.video
                        if (video && video.readyState >= 4) {
                            pixelDeepfakeRunningRef.current = true
                            const offscreen = new OffscreenCanvas(224, 224)
                            const offCtx = offscreen.getContext('2d')
                            if (offCtx) {
                                offCtx.drawImage(video, 0, 0, 224, 224)
                                const imgData = offCtx.getImageData(0, 0, 224, 224)
                                const pixelsRGBA = Array.from(imgData.data)

                                fetch('/api/deepfake', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ pixelsRGBA, imageWidth: 224, imageHeight: 224 }),
                                })
                                    .then(r => r.json())
                                    .then((pixelResult: {
                                        modelAvailable: boolean; score: number; label: string;
                                        confidence: number; calibratedProb: number; analysisMs: number
                                    }) => {
                                        // Track model availability to skip calls if not deployed
                                        pixelModelAvailableRef.current = pixelResult.modelAvailable

                                        if (!pixelResult.modelAvailable) return

                                        // Update CNN display if pixel model scores higher risk
                                        if (pixelResult.score > 60) {
                                            setDeepfakeCnnDisplay(prev => ({
                                                risk:  Math.max(prev?.risk ?? 0, pixelResult.score),
                                                label: pixelResult.label === 'fake' ? 'Deepfake' : (prev?.label ?? 'Human'),
                                            }))
                                        }

                                        // Fire anti-cheat alert — rate-limited to once per 30s
                                        const now3 = performance.now()
                                        if (
                                            pixelResult.label === 'fake' &&
                                            pixelResult.score >= 70 &&
                                            now3 - lastPixelAlertRef.current > 30000
                                        ) {
                                            lastPixelAlertRef.current = now3
                                            onAntiCheatEvent?.({
                                                type: 'deepfake_cnn_alert',
                                                confidence: pixelResult.calibratedProb,
                                                detail: `Pixel model: synthetic face detected (score ${pixelResult.score}%, ${pixelResult.analysisMs}ms)`,
                                                timestamp: now3,
                                            })
                                        }
                                    })
                                    .catch(() => { pixelModelAvailableRef.current = false })
                                    .finally(() => { pixelDeepfakeRunningRef.current = false })
                            } else {
                                pixelDeepfakeRunningRef.current = false
                            }
                        } else {
                            pixelDeepfakeRunningRef.current = false
                        }
                    }

                    // ── rPPG Coupling (L1) — extract skin + motion proxies ────
                    {
                        const foreheadIdxs = [10, 338, 297, 332, 284]
                        const skinProxy = foreheadIdxs.reduce((s, idx) => s + (landmarks[idx]?.y ?? 0), 0) / foreheadIdxs.length
                        const noseLm = landmarks[MP_IDX.NOSE_TIP]
                        const chinLm = landmarks[MP_IDX.CHIN]
                        const prevLm = prevLandmarksRef.current
                        let motionProxy = 0
                        if (prevLm) {
                            const noseDz = (noseLm?.z ?? 0) - (prevLm[MP_IDX.NOSE_TIP]?.z ?? 0)
                            const noseDy = (noseLm?.y ?? 0) - (prevLm[MP_IDX.NOSE_TIP]?.y ?? 0)
                            const chinDy = (chinLm?.y ?? 0) - (prevLm[MP_IDX.CHIN]?.y ?? 0)
                            motionProxy = Math.sqrt(noseDz * noseDz + noseDy * noseDy) + Math.abs(chinDy)
                        }
                        prevLandmarksRef.current = landmarks as Array<{x: number; y: number; z: number}>
                        rppgDetectorRef.current.pushSample(skinProxy, motionProxy)

                        if (frameIdx % 150 === 0 && rppgDetectorRef.current.isReady) {
                            const rppgResult = rppgDetectorRef.current.evaluate()
                            if (rppgResult) {
                                lastRppgResultRef.current = rppgResult
                                setRppgDisplay({ bpm: rppgResult.heartRateEstimate, coupling: Math.round(rppgResult.couplingStrength * 100) })
                                if (rppgResult.isSuspicious && now - lastRppgAlertRef.current > 30000) {
                                    lastRppgAlertRef.current = now
                                    onAntiCheatEvent?.({
                                        type: 'rppg_decoupling',
                                        confidence: 1 - rppgResult.couplingStrength,
                                        detail: `rPPG-motion coupling F=${rppgResult.grangerFStat.toFixed(2)} (${rppgResult.heartRateEstimate}bpm est.)`,
                                        timestamp: now,
                                    })
                                }
                            }
                        }
                    }

                    // ── FACS Engine (L2) — biomechanical constraints ──────────
                    facsEngineRef.current.pushFrame(blendshapeCategoriesToScores(blendshapes))
                    if (frameIdx % 30 === 0) {
                        const facsResult = facsEngineRef.current.evaluate()
                        lastFacsResultRef.current = facsResult
                        setFacsDisplay({
                            score: facsResult.score,
                            topViolation: facsResult.violations[0]?.rule ?? 'ok',
                        })
                        if (facsResult.score > 60 && now - lastFacsAlertRef.current > 15000) {
                            lastFacsAlertRef.current = now
                            const topV = facsResult.violations[0]
                            onAntiCheatEvent?.({
                                type: 'facs_violation',
                                confidence: facsResult.score / 100,
                                detail: topV ? `${topV.rule}: ${topV.description}` : 'Biomechanical violation',
                                timestamp: now,
                            })
                        }
                    }

                    // ── Veritas Ensemble (every 90 frames) ───────────────────
                    if (frameIdx % 90 === 0) {
                        const facsR  = lastFacsResultRef.current
                        const cnnR   = lastDeepfakeResultRef.current
                        const rppgR  = lastRppgResultRef.current
                        const layers: LayerScore[] = [
                            {
                                layer: 'facs',
                                score: facsR?.score ?? 0,
                                confidence: facsR && facsR.framesEvaluated >= 10 ? 0.8 : 0.3,
                                available: !!facsR,
                            },
                            {
                                // CNN v2 — 3-stream blendshape model (activated 2026-03-15)
                                layer: 'cnn_v2',
                                score: cnnR?.riskScore ?? 0,
                                confidence: cnnR ? 0.75 : 0, // slight discount: synthetic training
                                available: !!cnnR,
                                meta: { prediction: cnnR?.prediction },
                            },
                            {
                                layer: 'rppg',
                                score: rppgR ? Math.round((1 - rppgR.couplingStrength) * 100) : 0,
                                confidence: rppgR && rppgR.samplesUsed >= 90 ? 0.75 : 0,
                                available: !!rppgR,
                                meta: { grangerFStat: rppgR?.grangerFStat },
                            },
                        ]
                        const ensemble = computeEnsemble(layers)
                        lastEnsembleRef.current = ensemble
                        setEnsembleDisplay({ pFake: Math.round(ensemble.pFake * 100), verdict: ensemble.verdict })
                        if (ensemble.pFake > 0.70 && now - lastVeritasAlertRef.current > 30000) {
                            lastVeritasAlertRef.current = now
                            auditChainRef.current.addBlock('ensemble', ensemble.auditPayload).catch(() => {})
                            onAntiCheatEvent?.({
                                type: 'veritas_alert',
                                confidence: ensemble.pFake,
                                detail: ensemble.xaiExplanation,
                                timestamp: now,
                            })
                        }
                    }

                    // ── Gaze smoothing ───────────────────────────────────────
                    gazeHistoryRef.current.push(gaze.direction)
                    if (gazeHistoryRef.current.length > 4) gazeHistoryRef.current.shift()
                    const gazeCounts = gazeHistoryRef.current.reduce((acc, d) => {
                        acc[d] = (acc[d] || 0) + 1; return acc
                    }, {} as Record<string, number>)
                    const smoothGaze = Object.entries(gazeCounts).sort((a, b) => b[1] - a[1])[0][0] as GazeDirection

                    // Gaze ratio history (iris-based)
                    const avgIrisRatio = (gaze.leftIrisRatio + gaze.rightIrisRatio) / 2
                    gazeRatioHistRef.current.push(avgIrisRatio)
                    if (gazeRatioHistRef.current.length > 60) gazeRatioHistRef.current.shift()
                    const gazeStability = computeGazeStability(gazeRatioHistRef.current)

                    setGazeRatioDebug(Math.round(avgIrisRatio * 100) / 100)

                    // ── Nose micro-movement ──────────────────────────────────
                    const nosePx = lmToPixel(landmarks[MP_IDX.NOSE_TIP], w, h)
                    noseHistoryRef.current.push(nosePx)
                    if (noseHistoryRef.current.length > 20) noseHistoryRef.current.shift()
                    const microMovement = computeMicroMovementScore(noseHistoryRef.current)

                    // ── Liveness score (enhanced with depth + blendshape) ────
                    const lScore = computeLivenessScore(
                        pose.confidence,
                        microMovement,
                        blinkCountRef.current,
                        elapsedMin,
                        gazeStability,
                        depthVar,
                        bsConsistency,
                    )
                    livenessScoreRef.current = lScore
                    setLivenessScore(lScore)
                    onLivenessScore?.(lScore)

                    // ── Build FaceMetrics ─────────────────────────────────────
                    const avgBlinkDur = blinkDurationsRef.current.length > 0
                        ? blinkDurationsRef.current.reduce((s, v) => s + v, 0) / blinkDurationsRef.current.length
                        : 0

                    const metrics: FaceMetrics = {
                        livenessScore: lScore,
                        blinkRate: blinkRateRef.current,
                        blinkCount: blinkCountRef.current,
                        avgBlinkDuration: Math.round(avgBlinkDur),
                        headSymmetryScore: pose.symmetryScore,
                        microMovementScore: microMovement,
                        eyeOpenness: Math.round((1 - avgBlink) * 100) / 100,
                        gazeStabilityScore: gazeStability,
                        faceBrightnessDelta: Math.round(depthVar * 10000) / 10000,
                        lightingChallengesPassed: lcPassedRef.current,
                        lightingChallengesFailed: lcFailedRef.current,
                        saccadeScore: saccadeScoreRef.current,
                        blinkEdgeScore: blinkEdgeScoreRef.current,
                        ocoloManualScore: 50,
                        irisTrackingQuality: Math.round(Math.min(100, (1 - Math.abs(avgIrisRatio - 0.5) * 4) * 100)),
                        blendshapeConsistency: bsConsistency,
                        depthVariance: Math.round(depthVar * 100000) / 100000,
                        // Deepfake CNN
                        deepfakeRiskScore: lastDeepfakeResultRef.current?.riskScore ?? undefined,
                        deepfakePrediction: lastDeepfakeResultRef.current?.prediction ?? null,
                        // Veritas Engine v2
                        facsScore:             lastFacsResultRef.current?.score,
                        rppgCouplingStrength:  lastRppgResultRef.current?.couplingStrength,
                        veritasPFake:          lastEnsembleRef.current?.pFake,
                        veritasVerdict:        lastEnsembleRef.current?.verdict,
                    }
                    faceMetricsRef.current = metrics
                    onFaceMetrics?.(metrics)

                    // ── Gaze event ───────────────────────────────────────────
                    if (smoothGaze !== lastGazeEventRef.current) {
                        lastGazeEventRef.current = smoothGaze
                        onGazeEvent?.(smoothGaze)
                    }

                    // ── Status logic ─────────────────────────────────────────
                    const headOff = !pose.isFacing
                    const gazeOff = smoothGaze !== 'center' && smoothGaze !== 'unknown'

                    const fireStatus = (verified: boolean, reason: VerificationFailureReason) => {
                        const prev = lastStatusRef.current
                        if (prev.verified === verified && prev.reason === reason) return
                        lastStatusRef.current = { verified, reason }
                        onStatusChange?.(verified, reason ?? undefined)
                    }

                    if (headOff) {
                        const reason: VerificationFailureReason = pose.yaw !== 'center' ? 'Gaze Divergence' : 'Head Tilted'
                        setPoseLabel(pose.yaw !== 'center' ? `Head ${pose.yaw}` : 'Head tilted')
                        setGazeLabel('')
                        setVerificationStatus('failed')
                        setFailureReason(reason)
                        fireStatus(false, reason)
                    } else if (gazeOff) {
                        setPoseLabel('Facing camera')
                        setGazeLabel(`Looking ${smoothGaze}`)
                        setVerificationStatus('failed')
                        setFailureReason('Eye Gaze Detected')
                        fireStatus(false, 'Eye Gaze Detected')
                    } else {
                        setPoseLabel('Facing camera')
                        setGazeLabel('Eyes: center')
                        setVerificationStatus('verified')
                        setFailureReason(null)
                        fireStatus(true, null)
                    }

                } else if (result.faceLandmarks.length === 0) {
                    noseHistoryRef.current = []
                    gazeHistoryRef.current = []
                    gazeRatioHistRef.current = []
                    setVerificationStatus('failed')
                    setFailureReason('No face detected')
                    const msSinceReady = Date.now() - modelReadyTimeRef.current
                    if (msSinceReady > 4000) {
                        const prev = lastStatusRef.current
                        if (prev.verified !== false || prev.reason !== 'No face detected') {
                            lastStatusRef.current = { verified: false, reason: 'No face detected' }
                            onStatusChange?.(false, 'No face detected')
                        }
                    }
                    setPoseLabel('–'); setGazeLabel('')
                } else {
                    // Multiple faces
                    setVerificationStatus('failed')
                    setFailureReason('Multiple faces detected')
                    const prev = lastStatusRef.current
                    if (prev.verified !== false || prev.reason !== 'Multiple faces detected') {
                        lastStatusRef.current = { verified: false, reason: 'Multiple faces detected' }
                        onStatusChange?.(false, 'Multiple faces detected')
                    }
                }
            }

            rafIdRef.current = requestAnimationFrame(detect)
            return () => cancelAnimationFrame(rafIdRef.current)
        }, [isModelLoaded, onStatusChange, onLivenessScore, onGazeEvent, onBlinkEvent, onFaceMetrics, onAntiCheatEvent, lightingChallengeActive])

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

                    {isModelLoaded && (
                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '3px', background: 'rgba(0,0,0,0.4)' }}>
                            <div style={{ height: '100%', width: `${livenessScore}%`, background: livenessColor, transition: 'width 0.4s ease, background 0.4s ease' }} />
                        </div>
                    )}

                    <div className={`${styles.statusOverlay} ${styles[verificationStatus]}`}>
                        <div className={styles.statusDot} />
                        <span className={styles.statusText}>
                            {modelLoadError || (
                                verificationStatus === 'idle'     ? 'Initializing AI models...' :
                                verificationStatus === 'scanning' ? 'Center your face in the oval' :
                                verificationStatus === 'verified' ? `Identity Verified ✓` :
                                failureReason === 'No face detected'      ? 'Move closer to the camera' :
                                failureReason === 'Multiple faces detected' ? 'Only one face allowed' :
                                failureReason === 'Head Tilted'           ? 'Look straight at the camera' :
                                failureReason === 'Eye Gaze Detected'     ? 'Keep looking at the screen' :
                                failureReason === 'Low confidence'        ? 'Improve lighting — face us' :
                                (failureReason || 'Verification failed')
                            )}
                        </span>
                    </div>
                </div>

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
                            <span title="Eye Aspect Ratio — measures eye openness">Eye Openness <span style={{ color: blinkDisplay.ear < 0.2 ? '#ffd700' : 'var(--color-text-muted)' }}>{blinkDisplay.ear}</span></span>
                        </div>
                        {deepfakeCnnDisplay && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: '3px', padding: '0 2px' }}>
                                <span>AI Detection <span style={{ color: deepfakeCnnDisplay.risk > 60 ? '#ff4d4d' : deepfakeCnnDisplay.risk > 30 ? '#ffd700' : '#00ff9d', fontWeight: 600 }}>{deepfakeCnnDisplay.label}</span></span>
                                <span>Risk <span style={{ color: deepfakeCnnDisplay.risk > 60 ? '#ff4d4d' : deepfakeCnnDisplay.risk > 30 ? '#ffd700' : '#00ff9d' }}>{deepfakeCnnDisplay.risk}%</span></span>
                            </div>
                        )}
                        {facsDisplay && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: '3px', padding: '0 2px' }}>
                                <span title="Facial Action Coding System — checks biomechanical muscle rules">Face Biomechanics <span style={{ color: facsDisplay.score > 60 ? '#ff4d4d' : facsDisplay.score > 30 ? '#ffd700' : '#00ff9d', fontWeight: 600 }}>{facsDisplay.score > 0 ? `${facsDisplay.score}%` : 'OK'}</span></span>
                                <span style={{ fontSize: '0.65rem', opacity: 0.8 }}>{facsDisplay.topViolation !== 'ok' ? facsDisplay.topViolation : '✓ natural'}</span>
                            </div>
                        )}
                        {rppgDisplay && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: '3px', padding: '0 2px' }}>
                                <span title="Remote Photoplethysmography — detects heartbeat from skin color changes">Heartbeat Signal <span style={{ color: rppgDisplay.coupling < 30 ? '#ff4d4d' : rppgDisplay.coupling < 60 ? '#ffd700' : '#00ff9d', fontWeight: 600 }}>{rppgDisplay.coupling}%</span></span>
                                <span>{rppgDisplay.bpm > 0 ? `~${rppgDisplay.bpm} bpm` : 'measuring…'}</span>
                            </div>
                        )}
                        {ensembleDisplay && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginTop: '4px', padding: '2px 4px', borderRadius: '3px', background: ensembleDisplay.verdict === 'fake' ? 'rgba(255,77,77,0.15)' : ensembleDisplay.verdict === 'suspicious' ? 'rgba(255,215,0,0.10)' : 'rgba(0,255,157,0.08)', color: ensembleDisplay.verdict === 'fake' ? '#ff4d4d' : ensembleDisplay.verdict === 'suspicious' ? '#ffd700' : '#00ff9d', fontWeight: ensembleDisplay.verdict !== 'real' ? 700 : 400 }}>
                                <span title="Bayesian ensemble of all 6 detection layers">Trust Score</span>
                                <span>{ensembleDisplay.verdict === 'real' ? '✓ Verified Human' : ensembleDisplay.verdict === 'suspicious' ? '⚠ Suspicious' : '✗ Deepfake Detected'} · {ensembleDisplay.pFake}%</span>
                            </div>
                        )}
                        {lightingChallengeActive && (
                            <div style={{ marginTop: '4px', fontSize: '0.7rem', color: '#ffd700', textAlign: 'center', letterSpacing: '0.08em' }}>
                                ⚡ LIVENESS CHALLENGE — Follow the light
                            </div>
                        )}
                    </>
                )}
            </div>
        )
    }
)

VerificationCamera.displayName = 'VerificationCamera'
export default VerificationCamera
