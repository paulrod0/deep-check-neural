/**
 * Deep-Check — FACS Biomechanical Constraint Engine (L2)
 * =======================================================
 * Maps MediaPipe's 52 blendshapes to Ekman's Action Units and applies
 * 6 biomechanical rules to detect anatomically impossible expressions
 * that betray deepfake video.
 *
 * Rules:
 *   R1  Duchenne test       — real smiles need AU6 (cheek raise) with AU12 (lip corner)
 *   R2  Bilateral sync      — left/right AUs must be within 20% for natural expressions
 *   R3  Co-contraction      — AU1+AU4 cannot both reach max (anatomical antagonists)
 *   R4  Blink trajectory    — blink close/open must follow natural timing (~5–8 frames)
 *   R5  Expression coherence — joy and disgust cannot activate simultaneously
 *   R6  Velocity limits     — expression changes must follow biomechanical speed caps
 *
 * Veritas Engine v2 — Deep-Check
 */

'use client'

// ─── Blendshape index constants (MediaPipe standard order, 52 blendshapes) ────

const BS = {
    NEUTRAL:              0,
    BROW_DOWN_L:          1,   // AU4 left
    BROW_DOWN_R:          2,   // AU4 right
    BROW_INNER_UP:        3,   // AU1
    BROW_OUTER_UP_L:      4,   // AU2 left
    BROW_OUTER_UP_R:      5,   // AU2 right
    CHEEK_PUFF:           6,
    CHEEK_SQUINT_L:       7,   // AU6 left (Duchenne)
    CHEEK_SQUINT_R:       8,   // AU6 right (Duchenne)
    EYE_BLINK_L:          9,   // AU46 left
    EYE_BLINK_R:         10,   // AU46 right
    EYE_LOOK_DOWN_L:     11,
    EYE_LOOK_DOWN_R:     12,
    EYE_LOOK_IN_L:       13,
    EYE_LOOK_IN_R:       14,
    EYE_LOOK_OUT_L:      15,
    EYE_LOOK_OUT_R:      16,
    EYE_LOOK_UP_L:       17,
    EYE_LOOK_UP_R:       18,
    EYE_SQUINT_L:        19,
    EYE_SQUINT_R:        20,
    EYE_WIDE_L:          21,   // AU5 left
    EYE_WIDE_R:          22,   // AU5 right
    JAW_FORWARD:         23,
    JAW_LEFT:            24,
    JAW_OPEN:            25,   // AU27
    JAW_RIGHT:           26,
    MOUTH_CLOSE:         27,
    MOUTH_DIMPLE_L:      28,
    MOUTH_DIMPLE_R:      29,
    MOUTH_FROWN_L:       30,   // AU15 left
    MOUTH_FROWN_R:       31,   // AU15 right
    MOUTH_FUNNEL:        32,
    MOUTH_LEFT:          33,
    MOUTH_LOWER_DOWN_L:  34,
    MOUTH_LOWER_DOWN_R:  35,
    MOUTH_PRESS_L:       36,
    MOUTH_PRESS_R:       37,
    MOUTH_PUCKER:        38,
    MOUTH_RIGHT:         39,
    MOUTH_ROLL_LOWER:    40,
    MOUTH_ROLL_UPPER:    41,
    MOUTH_SHRUG_LOWER:   42,
    MOUTH_SHRUG_UPPER:   43,
    MOUTH_SMILE_L:       44,   // AU12 left
    MOUTH_SMILE_R:       45,   // AU12 right
    MOUTH_STRETCH_L:     46,
    MOUTH_STRETCH_R:     47,
    MOUTH_UPPER_UP_L:    48,
    MOUTH_UPPER_UP_R:    49,
    NOSE_SNEER_L:        50,   // AU9 left
    NOSE_SNEER_R:        51,   // AU9 right
} as const

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface FACSViolation {
    rule: 'duchenne' | 'bilateral' | 'cocontraction' | 'blink' | 'coherence' | 'velocity'
    severity: 'mild' | 'moderate' | 'strong'
    description: string
    auUnits: string[]
    score: number   // contribution to fake score (0–100)
}

export interface FACSResult {
    /** 0 = definitely real, 100 = definitely fake */
    score: number
    violations: FACSViolation[]
    /** True if genuine Duchenne smile was detected */
    duchenne: boolean
    /** Bilateral symmetry score 0–1 (1 = perfectly symmetric) */
    bilateralSync: number
    /** Number of frames evaluated */
    framesEvaluated: number
}

// ─── Sliding window ────────────────────────────────────────────────────────────

const WINDOW_SIZE  = 30   // ~1 second at 30fps
const MIN_FRAMES   = 10   // minimum to evaluate

// Velocity cap (max Δ blendshape per frame at 30fps)
const MAX_VELOCITY: Partial<Record<keyof typeof BS, number>> = {
    BROW_INNER_UP:   0.12,
    BROW_DOWN_L:     0.10,
    BROW_DOWN_R:     0.10,
    EYE_WIDE_L:      0.15,
    EYE_WIDE_R:      0.15,
    MOUTH_SMILE_L:   0.10,
    MOUTH_SMILE_R:   0.10,
    JAW_OPEN:        0.18,
}

// ─── FACSConstraintEngine ──────────────────────────────────────────────────────

export class FACSConstraintEngine {
    private window: number[][] = []    // [frameIdx][blendshapeIdx]
    private blinkState = { left: 0, right: 0 }  // frames since blink started

    pushFrame(blendshapes: number[]): void {
        if (blendshapes.length < 52) return
        const frame = blendshapes.slice(0, 52)
        this.window.push(frame)
        if (this.window.length > WINDOW_SIZE) this.window.shift()
    }

    evaluate(): FACSResult {
        const n = this.window.length
        if (n < MIN_FRAMES) {
            return { score: 0, violations: [], duchenne: false, bilateralSync: 1, framesEvaluated: n }
        }

        const violations: FACSViolation[] = []

        // Run all rules
        const r1 = this._checkDuchenne()
        const r2 = this._checkBilateral()
        const r3 = this._checkCoContraction()
        const r4 = this._checkBlinkTrajectory()
        const r5 = this._checkCoherence()
        const r6 = this._checkVelocity()

        violations.push(...r1.violations, ...r2.violations, ...r3.violations,
                         ...r4.violations, ...r5.violations, ...r6.violations)

        // Aggregate score (weighted sum, capped at 100)
        const totalScore = Math.min(100, violations.reduce((acc, v) => acc + v.score, 0))

        return {
            score: totalScore,
            violations,
            duchenne: r1.duchenne,
            bilateralSync: r2.symmetry,
            framesEvaluated: n,
        }
    }

    reset(): void {
        this.window = []
        this.blinkState = { left: 0, right: 0 }
    }

    // ── R1: Duchenne test ──────────────────────────────────────────────────────

    private _checkDuchenne(): { duchenne: boolean; violations: FACSViolation[] } {
        const violations: FACSViolation[] = []

        // Count frames with active smile (mouthSmile > 0.35)
        let smileFrames    = 0
        let duchenneFrames = 0

        for (const f of this.window) {
            const smileL = f[BS.MOUTH_SMILE_L]
            const smileR = f[BS.MOUTH_SMILE_R]
            const cheekL = f[BS.CHEEK_SQUINT_L]
            const cheekR = f[BS.CHEEK_SQUINT_R]
            const smileAU = (smileL + smileR) / 2

            if (smileAU > 0.35) {
                smileFrames++
                if ((cheekL + cheekR) / 2 > 0.2) duchenneFrames++
            }
        }

        // If sustained smile without Duchenne marker → suspicious
        if (smileFrames >= 8 && duchenneFrames / smileFrames < 0.3) {
            violations.push({
                rule: 'duchenne',
                severity: 'moderate',
                description: 'Smile without Duchenne marker (AU6 absent): possible synthetic expression',
                auUnits: ['AU6', 'AU12'],
                score: 25,
            })
        }

        return { duchenne: duchenneFrames >= 5, violations }
    }

    // ── R2: Bilateral symmetry ─────────────────────────────────────────────────

    private _checkBilateral(): { symmetry: number; violations: FACSViolation[] } {
        const violations: FACSViolation[] = []
        const asymmetries: number[] = []

        for (const f of this.window) {
            // Paired AU comparisons
            const pairs: [number, number][] = [
                [BS.BROW_DOWN_L,   BS.BROW_DOWN_R],
                [BS.BROW_OUTER_UP_L, BS.BROW_OUTER_UP_R],
                [BS.CHEEK_SQUINT_L, BS.CHEEK_SQUINT_R],
                [BS.EYE_BLINK_L,   BS.EYE_BLINK_R],
                [BS.EYE_WIDE_L,    BS.EYE_WIDE_R],
                [BS.MOUTH_SMILE_L, BS.MOUTH_SMILE_R],
                [BS.MOUTH_FROWN_L, BS.MOUTH_FROWN_R],
            ]

            let frameAsymmetry = 0
            for (const [l, r] of pairs) {
                const diff = Math.abs(f[l] - f[r])
                const avg  = (f[l] + f[r]) / 2 + 0.001
                frameAsymmetry += diff / avg
            }
            asymmetries.push(frameAsymmetry / pairs.length)
        }

        const avgAsymmetry = asymmetries.reduce((a, b) => a + b, 0) / asymmetries.length
        const symmetryScore = Math.max(0, 1 - avgAsymmetry * 2)

        // Deepfakes often have unnatural bilateral asymmetry >30%
        if (avgAsymmetry > 0.30) {
            violations.push({
                rule: 'bilateral',
                severity: avgAsymmetry > 0.5 ? 'strong' : 'moderate',
                description: `Bilateral asymmetry ${(avgAsymmetry * 100).toFixed(0)}% — exceeds natural threshold`,
                auUnits: ['AU4', 'AU6', 'AU12', 'AU46'],
                score: Math.min(30, Math.floor(avgAsymmetry * 60)),
            })
        }

        return { symmetry: symmetryScore, violations }
    }

    // ── R3: Co-contraction impossibility ──────────────────────────────────────

    private _checkCoContraction(): { violations: FACSViolation[] } {
        const violations: FACSViolation[] = []
        let violationFrames = 0

        for (const f of this.window) {
            const browInnerUp = f[BS.BROW_INNER_UP]
            const browDownAvg = (f[BS.BROW_DOWN_L] + f[BS.BROW_DOWN_R]) / 2

            // AU1 (inner raise) + AU4 (brow lower) both > 0.6 simultaneously
            // is anatomically very difficult for real humans
            if (browInnerUp > 0.6 && browDownAvg > 0.6) violationFrames++

            // Joy (AU6+AU12) and disgust (AU9+AU15) simultaneously at high levels
            const joyScore     = Math.min(f[BS.CHEEK_SQUINT_L], f[BS.MOUTH_SMILE_L])
            const disgustScore = Math.min(f[BS.NOSE_SNEER_L],   f[BS.MOUTH_FROWN_L])
            if (joyScore > 0.5 && disgustScore > 0.5) violationFrames++
        }

        if (violationFrames >= 3) {
            violations.push({
                rule: 'cocontraction',
                severity: violationFrames >= 6 ? 'strong' : 'mild',
                description: `Anatomically impossible co-contraction in ${violationFrames} frames`,
                auUnits: ['AU1', 'AU4'],
                score: Math.min(20, violationFrames * 3),
            })
        }

        return { violations }
    }

    // ── R4: Blink trajectory ───────────────────────────────────────────────────

    private _checkBlinkTrajectory(): { violations: FACSViolation[] } {
        const violations: FACSViolation[] = []
        const n = this.window.length

        let suspiciousBlinks = 0

        for (let i = 1; i < n; i++) {
            const prev = this.window[i - 1]
            const curr = this.window[i]

            // Detect blink close event: eyeBlink jumps from < 0.1 to > 0.7 in one frame
            const blinkLJump = curr[BS.EYE_BLINK_L] - prev[BS.EYE_BLINK_L]
            const blinkRJump = curr[BS.EYE_BLINK_R] - prev[BS.EYE_BLINK_R]

            // At 30fps: natural blink close takes ~4-6 frames (0.13-0.20s)
            // A jump > 0.5 in a single frame is unnaturally fast
            if (blinkLJump > 0.5 || blinkRJump > 0.5) suspiciousBlinks++

            // Monocular blink: one eye blinks while the other stays open > 0.7 difference
            const blinkDiff = Math.abs(curr[BS.EYE_BLINK_L] - curr[BS.EYE_BLINK_R])
            if (blinkDiff > 0.5 && Math.max(curr[BS.EYE_BLINK_L], curr[BS.EYE_BLINK_R]) > 0.7) {
                suspiciousBlinks++
            }
        }

        if (suspiciousBlinks >= 2) {
            violations.push({
                rule: 'blink',
                severity: suspiciousBlinks >= 4 ? 'strong' : 'moderate',
                description: `Unnatural blink trajectory: ${suspiciousBlinks} suspicious events`,
                auUnits: ['AU46'],
                score: Math.min(25, suspiciousBlinks * 8),
            })
        }

        return { violations }
    }

    // ── R5: Expression coherence ───────────────────────────────────────────────

    private _checkCoherence(): { violations: FACSViolation[] } {
        const violations: FACSViolation[] = []
        let incoherentFrames = 0

        for (const f of this.window) {
            // Surprise: browInnerUp + eyeWide + jawOpen
            const surpriseScore = (f[BS.BROW_INNER_UP] + f[BS.EYE_WIDE_L] + f[BS.JAW_OPEN]) / 3
            // Disgust: noseSneer + mouthFrown
            const disgustScore  = (f[BS.NOSE_SNEER_L] + f[BS.NOSE_SNEER_R] + f[BS.MOUTH_FROWN_L]) / 3
            // Contempt: asymmetric smile (one side only)
            const smileAsymmetry = Math.abs(f[BS.MOUTH_SMILE_L] - f[BS.MOUTH_SMILE_R])

            // Surprise + disgust simultaneously at high levels is incoherent
            if (surpriseScore > 0.5 && disgustScore > 0.5) incoherentFrames++

            // Extreme contempt asymmetry with both cheeks squinted (incoherent anatomy)
            if (smileAsymmetry > 0.5 && f[BS.CHEEK_SQUINT_L] > 0.4 && f[BS.CHEEK_SQUINT_R] > 0.4) {
                incoherentFrames++
            }
        }

        if (incoherentFrames >= 3) {
            violations.push({
                rule: 'coherence',
                severity: incoherentFrames >= 6 ? 'strong' : 'mild',
                description: `Expression incoherence in ${incoherentFrames} frames — impossible AU combinations`,
                auUnits: ['AU1', 'AU9', 'AU15', 'AU27'],
                score: Math.min(20, incoherentFrames * 4),
            })
        }

        return { violations }
    }

    // ── R6: Velocity limits ────────────────────────────────────────────────────

    private _checkVelocity(): { violations: FACSViolation[] } {
        const violations: FACSViolation[] = []
        const n = this.window.length
        if (n < 2) return { violations }

        let tooFastEvents = 0
        const caps = Object.entries(MAX_VELOCITY) as [keyof typeof BS, number][]

        for (let i = 1; i < n; i++) {
            for (const [key, cap] of caps) {
                const idx  = BS[key]
                const delta = Math.abs(this.window[i][idx] - this.window[i - 1][idx])
                if (delta > cap) tooFastEvents++
            }
        }

        if (tooFastEvents >= 5) {
            violations.push({
                rule: 'velocity',
                severity: tooFastEvents >= 10 ? 'strong' : 'mild',
                description: `${tooFastEvents} super-threshold velocity events — unnatural expression changes`,
                auUnits: ['AU1', 'AU4', 'AU5', 'AU12', 'AU27'],
                score: Math.min(15, Math.floor(tooFastEvents * 1.5)),
            })
        }

        return { violations }
    }
}

// ─── Convenience export for blendshape index map ──────────────────────────────
export { BS as BLENDSHAPE_INDICES }

// ─── Ordered blendshape names (MediaPipe standard, 52 values) ─────────────────
export const FACS_BLENDSHAPE_ORDER = [
    '_neutral', 'browDownLeft', 'browDownRight', 'browInnerUp',
    'browOuterUpLeft', 'browOuterUpRight', 'cheekPuff', 'cheekSquintLeft',
    'cheekSquintRight', 'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft',
    'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft',
    'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft',
    'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight', 'jawForward',
    'jawLeft', 'jawOpen', 'jawRight', 'mouthClose',
    'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight',
    'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight',
    'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight',
    'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
    'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight',
    'mouthUpperUpLeft', 'mouthUpperUpRight', 'noseSneerLeft', 'noseSneerRight',
]

/** Convert MediaPipe blendshapeCategories to ordered number[] for pushFrame() */
export function blendshapeCategoriesToScores(
    categories: Array<{ categoryName: string; score: number }>
): number[] {
    const bsMap = new Map(categories.map(c => [c.categoryName, c.score]))
    return FACS_BLENDSHAPE_ORDER.map(name => bsMap.get(name) ?? 0)
}
