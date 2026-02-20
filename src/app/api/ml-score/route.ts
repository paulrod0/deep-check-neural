/**
 * Deep-Check · ML Score API
 * ==========================
 * POST /api/ml-score
 *
 * Receives session feature values + optional enrollmentProfileId.
 * Returns:
 *   - identityMatchScore (0-100) via Mahalanobis distance vs enrolled profile
 *   - mlAiRisk (0-100) from the ONNX model (server-side via onnxruntime-node)
 *   - flags: summary of which signals were suspicious
 *
 * Server-side inference uses onnxruntime-node for environments where WASM
 * is not available (Vercel Edge / server components).
 * If the model can't be loaded, falls back to heuristic scoring.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getProfileById, getProfileByEmail, KeystrokeProfile } from '@/lib/db'
import path from 'path'

// ─── Mahalanobis identity match ───────────────────────────────────────────────
// Uses 4 core features: [flightMean, flightStd, holdMean, entropy]
// The covariance matrix is estimated from the enrolled profile's stored stats.

interface SessionFeatures {
    // Core biometric stats
    flightMean:        number
    flightStd:         number
    holdMean:          number
    holdStd:           number
    entropy:           number
    // Advanced stats
    skewness:          number
    kurtosis:          number
    periodicityScore:  number
    velocityGradient:  number
    fatigueRate:       number
    rhythmConsistency: number
    impossibleFastRatio: number
    digramCvMean:      number
    backspaceLatencyStd: number
    backspaceCountRatio: number
    burstCountPer100k: number
    sessionWpm:        number
    digrams?:          Record<string, { mean: number; std: number; count: number }>
}

interface MlScoreRequest {
    features:            SessionFeatures
    enrollmentProfileId?: string
    enrollmentEmail?:    string
    totalKeystrokes:     number
}

function mahalanobisDistance(
    live: number[],    // [flightMean, flightStd, holdMean, entropy]
    baseline: KeystrokeProfile
): number {
    // Build mean vector from baseline
    const mu = [
        baseline.flightMean,
        baseline.flightStd,
        baseline.holdMean,
        baseline.entropy,
    ]

    // Approximate diagonal covariance (no off-diagonal available at enrollment)
    // Using flightStd as proxy for variance in each dimension
    // Variance heuristics: σ² ≈ (feature * 0.30)² for each feature
    const variances = [
        Math.pow(baseline.flightStd * 0.60, 2) || 1,
        Math.pow(baseline.flightStd * 0.50, 2) || 1,
        Math.pow(baseline.holdStd   * 0.60, 2) || 1,
        Math.pow(0.5, 2),  // entropy variance in bits²
    ]

    // D² = Σ (xi - μi)² / σi²
    let d2 = 0
    for (let i = 0; i < 4; i++) {
        d2 += Math.pow(live[i] - mu[i], 2) / variances[i]
    }

    // Add digram similarity if available
    // (increases confidence when there are matching digram pairs)
    return Math.sqrt(d2)
}

function mahalanobisToScore(distance: number): number {
    // Convert Mahalanobis distance to 0-100 identity match score
    // D=0: perfect match = 100
    // D=2: good match ≈ 85 (within 2 std devs on each feature)
    // D=4: marginal ≈ 50
    // D=8+: mismatch < 10
    return Math.max(0, Math.round(100 * Math.exp(-0.12 * distance)))
}

// ─── Heuristic fallback AI score ──────────────────────────────────────────────

function heuristicAiScore(f: SessionFeatures): number {
    let score = 0

    // Periodicity (FFT)
    if (f.periodicityScore > 65) score += 25
    else if (f.periodicityScore > 45) score += 12

    // Velocity gradient (bots are flat)
    if (Math.abs(f.velocityGradient) < 0.01) score += 15
    else if (Math.abs(f.velocityGradient) < 0.05) score += 6

    // Fatigue rate (bots show no fatigue)
    if (Math.abs(f.fatigueRate) < 0.02) score += 15
    else if (Math.abs(f.fatigueRate) < 0.08) score += 5

    // Backspace uniformity (bots don't self-correct naturally)
    if (f.backspaceLatencyStd < 8) score += 15
    if (f.backspaceCountRatio < 0.01) score += 8

    // Kurtosis (leptokurtic = bot)
    if (f.kurtosis > 7) score += 12
    else if (f.kurtosis > 4) score += 5

    // Entropy
    if (f.entropy < 1.0) score += 15
    else if (f.entropy < 1.8) score += 7

    // Skewness (symmetric = bot)
    if (Math.abs(f.skewness) < 0.1) score += 8

    // Rhythm
    if (f.rhythmConsistency < 5) score += 10

    return Math.min(100, score)
}

// ─── ONNX Runtime Node inference (optional) ──────────────────────────────────

async function runOnnxInference(features: SessionFeatures): Promise<number | null> {
    try {
        const ort = await import('onnxruntime-node').catch(() => null)
        if (!ort) return null

        const modelPath = path.join(process.cwd(), 'public', 'models', 'biometric-fraud-detector.onnx')
        const scalerPath = path.join(process.cwd(), 'public', 'models', 'feature_scaler.json')

        const { readFile } = await import('fs/promises')
        const scalerJson = JSON.parse(await readFile(scalerPath, 'utf-8'))

        const session = await ort.InferenceSession.create(modelPath, {
            executionProviders: ['cpu'],
        })

        // Build feature vector in training order
        const featureOrder = scalerJson.features as string[]
        const rawVec = featureOrder.map((name: string) => {
            const map: Record<string, number> = {
                flight_mean:            features.flightMean,
                flight_std:             features.flightStd,
                hold_mean:              features.holdMean,
                hold_std:               features.holdStd,
                flight_skewness:        features.skewness,
                flight_kurtosis:        features.kurtosis,
                flight_entropy:         features.entropy,
                hold_entropy:           features.entropy * 0.85,  // approximation
                periodicity_score:      features.periodicityScore,
                velocity_gradient:      features.velocityGradient,
                fatigue_rate:           features.fatigueRate,
                rhythm_consistency:     features.rhythmConsistency,
                impossible_fast_ratio:  features.impossibleFastRatio,
                digram_cv_mean:         features.digramCvMean,
                backspace_latency_std:  features.backspaceLatencyStd,
                backspace_count_ratio:  features.backspaceCountRatio,
                burst_count_per_100k:   features.burstCountPer100k,
                session_wpm:            features.sessionWpm,
            }
            return map[name] ?? 0
        })

        // Normalise
        const mu  = scalerJson.mean  as number[]
        const sig = scalerJson.std   as number[]
        const normalised = new Float32Array(rawVec.map((v: number, i: number) => (v - mu[i]) / (sig[i] || 1)))

        const inputTensor  = new ort.Tensor('float32', normalised, [1, featureOrder.length])
        const inputName    = session.inputNames[0]
        const results      = await session.run({ [inputName]: inputTensor })

        // Extract bot probability from whichever output format is used
        let botProb = 0.5
        for (const outName of session.outputNames) {
            const out = results[outName]
            if (!out) continue

            // Dense tensor [1, 2]
            if (out.dims && out.dims.length === 2 && Number(out.dims[1]) === 2) {
                const d = out.data as Float32Array
                botProb = d[1]; break
            }
            // Single probability
            if (out.dims && Number(out.dims[0]) === 1) {
                const d = out.data as Float32Array
                botProb = d[0]; break
            }
        }

        await session.release()
        return Math.round(Math.max(0, Math.min(1, botProb)) * 100)

    } catch (e) {
        console.warn('[ml-score] ONNX inference failed, using heuristic:', (e as Error).message)
        return null
    }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    try {
        const body: MlScoreRequest = await req.json()
        const { features, enrollmentProfileId, enrollmentEmail, totalKeystrokes } = body

        if (!features) {
            return NextResponse.json({ success: false, error: 'features required' }, { status: 400 })
        }

        // 1. Try ONNX inference first, fall back to heuristic
        const onnxScore = await runOnnxInference(features)
        const mlAiRisk  = onnxScore ?? heuristicAiScore(features)
        const inferenceMethod = onnxScore !== null ? 'onnx' : 'heuristic'

        // 2. Identity match (Mahalanobis) if enrollment profile provided
        let identityMatchScore: number | null = null
        let enrollmentContext: string | null = null

        const profile = enrollmentProfileId
            ? await getProfileById(enrollmentProfileId)
            : enrollmentEmail
                ? await getProfileByEmail(enrollmentEmail)
                : null

        if (profile) {
            const liveVec = [
                features.flightMean,
                features.flightStd,
                features.holdMean,
                features.entropy,
            ]
            const dist = mahalanobisDistance(liveVec, profile.profile)
            identityMatchScore = mahalanobisToScore(dist)
            enrollmentContext = profile.context

            // Bonus: check digram overlap if available
            if (features.digrams && profile.profile.digrams) {
                const commonKeys = Object.keys(profile.profile.digrams)
                    .filter(k => features.digrams![k])
                if (commonKeys.length >= 3) {
                    const digramScores = commonKeys.map(k => {
                        const base = profile.profile.digrams[k].mean
                        const live = features.digrams![k].mean
                        if (base === 0) return 50
                        const delta = Math.abs(live - base) / base
                        return Math.max(0, 1 - delta / 0.35) * 100
                    })
                    const digramMatch = Math.round(
                        digramScores.reduce((a, b) => a + b, 0) / digramScores.length
                    )
                    // Weighted average: 70% Mahalanobis, 30% digram
                    identityMatchScore = Math.round(
                        0.70 * identityMatchScore + 0.30 * digramMatch
                    )
                }
            }
        }

        // 3. Generate flags
        const flags: string[] = []
        if (features.periodicityScore > 65)       flags.push('high_periodicity')
        if (Math.abs(features.fatigueRate) < 0.02) flags.push('no_fatigue')
        if (features.backspaceLatencyStd < 8)      flags.push('uniform_backspace')
        if (features.kurtosis > 7)                 flags.push('leptokurtic')
        if (features.entropy < 1.2)                flags.push('low_entropy')
        if (features.burstCountPer100k > 10)       flags.push('high_burst_rate')
        if (mlAiRisk > 70)                         flags.push('ai_bot_detected')
        if (identityMatchScore !== null && identityMatchScore < 40) flags.push('identity_mismatch')

        return NextResponse.json({
            success: true,
            mlAiRisk,
            identityMatchScore,
            inferenceMethod,
            enrollmentContext,
            flags,
            keystrokes: totalKeystrokes,
        })

    } catch (err: any) {
        console.error('[/api/ml-score]', err?.message)
        return NextResponse.json(
            { success: false, error: err?.message ?? 'Server error' },
            { status: 500 }
        )
    }
}
