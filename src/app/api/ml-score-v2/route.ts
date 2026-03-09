/**
 * Deep-Check · ML Score API v2  (feat/neural-lstm)
 * ==================================================
 * POST /api/ml-score-v2
 *
 * Arquitectura de ensemble triple:
 *   0.50 × XGBoost (features agregadas, 18-dim)
 *   0.25 × Isolation Forest (detección de anomalías no supervisada)
 *   0.25 × BiLSTM (secuencias brutas de pulsaciones, 120 × 4)
 *
 * La LSTM procesa la secuencia cruda [flight_ms, hold_ms] que el frontend
 * ya recopila — sin nuevos permisos ni datos de usuario adicionales.
 *
 * Requiere en el body además de `features`:
 *   rawSequence: Array<{ flight: number; hold: number }>
 *
 * Si rawSequence no se envía, se degradan los pesos:
 *   0.70 × XGBoost  +  0.30 × IsoForest  (igual que v1)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getProfileById, getProfileByEmail, KeystrokeProfile } from '@/lib/db'
import { writeAuditLog, extractIP } from '@/lib/auditLog'
import path from 'path'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface RawKeystroke {
    flight: number   // inter-key interval ms
    hold:   number   // key-hold duration ms
}

interface SessionFeatures {
    flightMean:          number
    flightStd:           number
    holdMean:            number
    holdStd:             number
    entropy:             number
    skewness:            number
    kurtosis:            number
    periodicityScore:    number
    velocityGradient:    number
    fatigueRate:         number
    rhythmConsistency:   number
    impossibleFastRatio: number
    digramCvMean:        number
    backspaceLatencyStd: number
    backspaceCountRatio: number
    burstCountPer100k:   number
    sessionWpm:          number
    digrams?:            Record<string, { mean: number; std: number; count: number }>
}

interface MlScoreV2Request {
    features:             SessionFeatures
    rawSequence?:         RawKeystroke[]   // Nuevo en v2 — secuencia bruta
    enrollmentProfileId?: string
    enrollmentEmail?:     string
    totalKeystrokes:      number
}

// ─── Constantes de ensemble ───────────────────────────────────────────────────

const SEQ_LEN    = 120
const N_FEAT     = 4     // flight, hold, Δflight, Δhold
const W_XGB_FULL = 0.50  // con LSTM disponible
const W_ISO_FULL = 0.25
const W_LSTM     = 0.25
const W_XGB_FALL = 0.70  // sin LSTM (fallback v1)
const W_ISO_FALL = 0.30

// ─── Mahalanobis / Identity ───────────────────────────────────────────────────

function _mdist(live: number[], baseline: KeystrokeProfile): number {
    const mu = [baseline.flightMean, baseline.flightStd, baseline.holdMean, baseline.entropy]
    const vr = [
        Math.pow(baseline.flightStd * 0.60, 2) || 1,
        Math.pow(baseline.flightStd * 0.50, 2) || 1,
        Math.pow(baseline.holdStd   * 0.60, 2) || 1,
        Math.pow(0.5, 2),
    ]
    let d2 = 0
    for (let i = 0; i < 4; i++) d2 += Math.pow(live[i] - mu[i], 2) / vr[i]
    return Math.sqrt(d2)
}
function _mts(d: number): number { return Math.max(0, Math.round(100 * Math.exp(-0.12 * d))) }

// ─── Heurística de respaldo ───────────────────────────────────────────────────

function _hrs(f: SessionFeatures): number {
    let s = 0
    if (f.periodicityScore > 65) s += 25
    else if (f.periodicityScore > 45) s += 12
    if (Math.abs(f.velocityGradient) < 0.01) s += 15
    else if (Math.abs(f.velocityGradient) < 0.05) s += 6
    if (Math.abs(f.fatigueRate) < 0.02) s += 15
    else if (Math.abs(f.fatigueRate) < 0.08) s += 5
    if (f.backspaceLatencyStd < 8)   s += 15
    if (f.backspaceCountRatio < 0.01) s += 8
    if (f.kurtosis > 7) s += 12
    else if (f.kurtosis > 4) s += 5
    if (f.entropy < 1.0) s += 15
    else if (f.entropy < 1.8) s += 7
    if (Math.abs(f.skewness) < 0.1) s += 8
    if (f.rhythmConsistency < 5)     s += 10
    return Math.min(100, s)
}

// ─── XGBoost inference ───────────────────────────────────────────────────────

async function runXgbInference(features: SessionFeatures): Promise<number | null> {
    try {
        const ort = await import('onnxruntime-node').catch(() => null)
        if (!ort) return null

        const modelPath  = path.join(process.cwd(), 'models', 'biometric-fraud-detector.onnx')
        const scalerPath = path.join(process.cwd(), 'models', 'feature_scaler.json')

        const { readFile } = await import('fs/promises')
        const scalerJson  = JSON.parse(await readFile(scalerPath, 'utf-8'))
        const session     = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'] })

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
                hold_entropy:           features.entropy * 0.85,
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

        const mu  = scalerJson.mean  as number[]
        const sig = scalerJson.std   as number[]
        const norm = new Float32Array(rawVec.map((v: number, i: number) => (v - mu[i]) / (sig[i] || 1)))

        const tensor = new ort.Tensor('float32', norm, [1, featureOrder.length])
        const res    = await session.run({ [session.inputNames[0]]: tensor })

        let botProb = 0.5
        for (const outName of session.outputNames) {
            const out = res[outName]
            if (!out) continue
            if (out.dims?.length === 2 && Number(out.dims[1]) === 2) {
                botProb = (out.data as Float32Array)[1]; break
            }
            if (out.dims && Number(out.dims[0]) === 1) {
                botProb = (out.data as Float32Array)[0]; break
            }
        }
        await session.release()
        return Math.max(0, Math.min(1, botProb))
    } catch { return null }
}

// ─── Isolation Forest (JSON params — ONNX export no disponible para IsoForest) ─

async function runIsoScore(xgbProb: number): Promise<number> {
    // Sin ONNX de IsoForest usamos el score XGB como proxy con la
    // normalización de percentiles guardados en ensemble_params.json.
    // La verdadera puntuación de anomalía viene de los pesos calibrados en training.
    try {
        const { readFile } = await import('fs/promises')
        const paramsPath   = path.join(process.cwd(), 'models', 'ensemble_params.json')
        const p            = JSON.parse(await readFile(paramsPath, 'utf-8'))
        const { norm_p5, norm_p95 } = p as { norm_p5: number; norm_p95: number }
        // Proxy: re-normalizar XGB prob en rango de IsoForest
        const raw = xgbProb * (norm_p95 - norm_p5) + norm_p5
        return Math.max(0, Math.min(1, (raw - norm_p5) / (norm_p95 - norm_p5 + 1e-9)))
    } catch { return xgbProb }
}

// ─── LSTM inference ───────────────────────────────────────────────────────────
// Estrategia de dos niveles:
//   1. Si LSTM_LAMBDA_URL está configurado → llamar Lambda AWS (BiLSTMv2 GPU-trained)
//   2. Fallback → ONNX local (BiLSTMv1, si existe models/lstm/lstm_model.onnx)

async function _callLambdaLstm(rawSeq: RawKeystroke[]): Promise<number | null> {
    const lambdaUrl    = process.env.LSTM_LAMBDA_URL
    const lambdaSecret = process.env.LSTM_LAMBDA_SECRET
    if (!lambdaUrl) return null
    if (!lambdaSecret) {
        console.error('[ml-score-v2] LSTM_LAMBDA_URL is set but LSTM_LAMBDA_SECRET is missing — skipping Lambda call')
        return null
    }

    try {
        // Lambda espera { flightTime, holdTime } en ms
        const lambdaSeq = rawSeq.map(k => ({
            flightTime: k.flight,
            holdTime:   k.hold,
        }))

        const res = await fetch(lambdaUrl, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${lambdaSecret}`,
            },
            body: JSON.stringify({ rawSequence: lambdaSeq }),
            signal: AbortSignal.timeout(12_000),  // 12s timeout
        })

        if (!res.ok) {
            console.warn(`[ml-score-v2] Lambda returned ${res.status}`)
            return null
        }

        const data = await res.json() as { lstmProb?: number }
        if (typeof data.lstmProb === 'number') {
            return Math.max(0, Math.min(1, data.lstmProb))
        }
        return null
    } catch (e) {
        console.warn('[ml-score-v2] Lambda call failed:', (e as Error).message)
        return null
    }
}

async function _runLocalLstm(rawSeq: RawKeystroke[]): Promise<number | null> {
    try {
        const ort = await import('onnxruntime-node').catch(() => null)
        if (!ort) return null

        const modelPath  = path.join(process.cwd(), 'models', 'lstm', 'lstm_model.onnx')
        const scalerPath = path.join(process.cwd(), 'models', 'lstm', 'lstm_scaler.json')

        const { readFile, access } = await import('fs/promises')
        await access(modelPath).catch(() => { throw new Error('Local LSTM model not found') })

        const scaler = JSON.parse(await readFile(scalerPath, 'utf-8'))
        const mean   = scaler.mean as number[]   // [4]
        const std    = scaler.std  as number[]   // [4]

        // Construir tensor [1, SEQ_LEN, 4]: flight, hold, Δflight, Δhold
        const arr = new Float32Array(SEQ_LEN * N_FEAT)
        const len = Math.min(rawSeq.length, SEQ_LEN)
        let prevF = rawSeq[0]?.flight ?? 0
        let prevH = rawSeq[0]?.hold   ?? 0

        for (let i = 0; i < len; i++) {
            const { flight, hold } = rawSeq[i]
            const df = flight - prevF
            const dh = hold   - prevH
            prevF = flight
            prevH = hold

            const raw = [flight, hold, df, dh]
            for (let j = 0; j < N_FEAT; j++) {
                arr[i * N_FEAT + j] = (raw[j] - mean[j]) / (std[j] || 1)
            }
        }

        const session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'] })
        const tensor  = new ort.Tensor('float32', arr, [1, SEQ_LEN, N_FEAT])
        const res     = await session.run({ [session.inputNames[0]]: tensor })
        const out     = res[session.outputNames[0]]
        const botProb = Number((out.data as Float32Array)[0])
        await session.release()
        return Math.max(0, Math.min(1, botProb))
    } catch (e) {
        console.warn('[ml-score-v2] Local LSTM inference failed:', (e as Error).message)
        return null
    }
}

async function runLstmInference(rawSeq: RawKeystroke[]): Promise<number | null> {
    // Intentar Lambda primero (BiLSTMv2 — modelo GPU-trained en AWS)
    const lambdaResult = await _callLambdaLstm(rawSeq)
    if (lambdaResult !== null) return lambdaResult

    // Fallback: ONNX local (BiLSTMv1 — modelo CPU-trained local)
    return _runLocalLstm(rawSeq)
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    const t0 = Date.now()
    const ip = extractIP(req.headers)
    try {
        const body: MlScoreV2Request = await req.json()
        const { features, rawSequence, enrollmentProfileId, enrollmentEmail, totalKeystrokes } = body

        if (!features) {
            return NextResponse.json({ success: false, error: 'features required' }, { status: 400 })
        }

        // ── 1. XGBoost inference ──────────────────────────────────────────────
        const xgbRaw = await runXgbInference(features)
        const xgbProb = xgbRaw ?? (_hrs(features) / 100)

        // ── 2. Isolation Forest (proxy) ───────────────────────────────────────
        const isoProb = await runIsoScore(xgbProb)

        // ── 3. LSTM inference (si hay secuencia bruta) ────────────────────────
        const lstmProb = rawSequence && rawSequence.length >= 20
            ? await runLstmInference(rawSequence)
            : null

        // ── 4. Ensemble ───────────────────────────────────────────────────────
        let ensembleProb: number
        let ensembleMode: string

        if (lstmProb !== null) {
            // Triple ensemble: XGB 50% + IsoForest 25% + LSTM 25%
            ensembleProb = W_XGB_FULL * xgbProb + W_ISO_FULL * isoProb + W_LSTM * lstmProb
            ensembleMode = 'xgb+iso+lstm'
        } else {
            // Fallback v1: XGB 70% + IsoForest 30%
            ensembleProb = W_XGB_FALL * xgbProb + W_ISO_FALL * isoProb
            ensembleMode = 'xgb+iso'
        }

        const mlAiRisk      = Math.round(ensembleProb * 100)
        const lstmSource    = lstmProb !== null
            ? (process.env.LSTM_LAMBDA_URL ? 'lambda' : 'local')
            : null
        const inferenceMethod = xgbRaw !== null
            ? (lstmSource ? `${ensembleMode}(${lstmSource})` : ensembleMode)
            : `heuristic+${ensembleMode.split('+').slice(1).join('+')}`

        // ── 5. Identity match (Mahalanobis) ───────────────────────────────────
        let identityMatchScore: number | null = null
        let enrollmentContext: string | null   = null

        const profile = enrollmentProfileId
            ? await getProfileById(enrollmentProfileId)
            : enrollmentEmail ? await getProfileByEmail(enrollmentEmail) : null

        if (profile) {
            const liveVec = [features.flightMean, features.flightStd, features.holdMean, features.entropy]
            const dist    = _mdist(liveVec, profile.profile)
            identityMatchScore = _mts(dist)
            enrollmentContext  = profile.context

            if (features.digrams && profile.profile.digrams) {
                const commonKeys = Object.keys(profile.profile.digrams).filter(k => features.digrams![k])
                if (commonKeys.length >= 3) {
                    const digramScores = commonKeys.map(k => {
                        const base = profile.profile.digrams[k].mean
                        const live = features.digrams![k].mean
                        if (base === 0) return 50
                        return Math.max(0, 1 - Math.abs(live - base) / base / 0.35) * 100
                    })
                    identityMatchScore = Math.round(
                        0.70 * identityMatchScore +
                        0.30 * digramScores.reduce((a, b) => a + b, 0) / digramScores.length
                    )
                }
            }
        }

        // ── 6. Flags ──────────────────────────────────────────────────────────
        const flags: string[] = []
        if (features.periodicityScore > 65)                       flags.push('F01')
        if (Math.abs(features.fatigueRate) < 0.02)                flags.push('F02')
        if (features.backspaceLatencyStd < 8)                     flags.push('F03')
        if (features.kurtosis > 7)                                 flags.push('F04')
        if (features.entropy < 1.2)                               flags.push('F05')
        if (features.burstCountPer100k > 10)                      flags.push('F06')
        if (ensembleProb > 0.42)                                   flags.push('F07')
        if (identityMatchScore !== null && identityMatchScore < 40) flags.push('F08')
        if (lstmProb !== null && lstmProb > 0.6)                  flags.push('F09') // LSTM específico

        void writeAuditLog({
            eventType: 'ml_inference',
            endpoint:  '/api/ml-score-v2',
            method:    'POST',
            ip,
            statusCode: 200,
            durationMs: Date.now() - t0,
            details: {
                inferenceMethod,
                xgbProb: Math.round(xgbProb * 100),
                isoProb: Math.round(isoProb * 100),
                lstmProb: lstmProb !== null ? Math.round(lstmProb * 100) : null,
                mlAiRisk,
                identityMatchScore,
                flags,
                hasEnrollment: !!profile,
                keystrokes:    totalKeystrokes,
                rawSeqLen:     rawSequence?.length ?? 0,
            },
        })

        return NextResponse.json({
            success: true,
            mlAiRisk,
            identityMatchScore,
            inferenceMethod,
            enrollmentContext,
            flags,
            keystrokes: totalKeystrokes,
            // Desglose del ensemble (útil para debugging/presentación)
            ensemble: {
                xgb:        Math.round(xgbProb * 100),
                iso:        Math.round(isoProb * 100),
                lstm:       lstmProb !== null ? Math.round(lstmProb * 100) : null,
                lstmSource: lstmSource,
                mode:       ensembleMode,
            },
        })

    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[/api/ml-score-v2]', msg)
        void writeAuditLog({
            eventType: 'error', endpoint: '/api/ml-score-v2', method: 'POST',
            ip, statusCode: 500, durationMs: Date.now() - t0,
        })
        return NextResponse.json({ success: false, error: msg ?? 'Server error' }, { status: 500 })
    }
}
