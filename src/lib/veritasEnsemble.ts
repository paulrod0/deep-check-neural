/**
 * Deep-Check — Veritas Ensemble Engine
 * =====================================
 * Bayesian logit ensemble that fuses all Veritas Engine v2 layers into
 * a single posterior probability of deepfake/fraud detection.
 *
 * Model:
 *   logit(P_fake) = Σᵢ wᵢ · logit(sᵢ/100) + bias
 *   P_fake = sigmoid(logit_sum)
 *
 * Where sᵢ is each layer's fake score 0–100, wᵢ is its learned weight.
 * Missing layers are ignored (their weight is redistributed).
 *
 * Also generates:
 *   - XAI explanations (which layers contributed most + why)
 *   - Confidence intervals (low/medium/high based on layer coverage)
 *   - Audit payload for the SHA-256 chain
 *
 * Veritas Engine v2 — Deep-Check
 */

'use client'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type LayerName =
    | 'rppg'
    | 'facs'
    | 'cnn_v1'
    | 'cnn_v2'
    | 'efficientnet'
    | 'keystroke'

export interface LayerScore {
    layer: LayerName
    /** 0 = definitely real, 100 = definitely fake */
    score: number
    /** 0–1 confidence in this layer's reading */
    confidence: number
    /** false if layer did not produce a result this cycle */
    available: boolean
    /** Optional metadata for XAI */
    meta?: Record<string, unknown>
}

export interface LayerContribution {
    layer: LayerName
    weight: number
    /** Signed logit contribution — positive means "pushing toward fake" */
    contribution: number
    /** Human-readable explanation of this layer's signal */
    explanation: string
}

export interface EnsembleResult {
    /** Posterior probability of deepfake/fraud (0–1) */
    pFake: number
    /** Integer fake score 0–100 */
    fakeScore: number
    /** Classification threshold: real < 0.35 ≤ suspicious < 0.65 ≤ fake */
    verdict: 'real' | 'suspicious' | 'fake'
    /** Confidence based on how many layers contributed */
    confidence: 'high' | 'medium' | 'low'
    /** Per-layer signed contributions */
    contributingLayers: LayerContribution[]
    /** Single human-readable XAI explanation */
    xaiExplanation: string
    /** Structured payload for audit chain */
    auditPayload: {
        pFake: number
        verdict: string
        layerCount: number
        topLayer: string
        timestamp: number
    }
}

// ─── Weights (v1.2 — pixel model activated 2026-03-16) ───────────────────────
// cnn_v1 validated on held-out synthetic set (seed=1337):
//   Accuracy=29.5%, Macro-F1=0.244, AUC=0.423, ECE=0.2376 — DEPRECATED
//
// cnn_v2 ACTIVATED 2026-03-15: 3-stream blendshape CNN, synthetic training
//   Temporal behavioral model. Discounted confidence (0.75) due to synthetic data.
//
// efficientnet ACTIVATED 2026-03-16: EfficientNet-B4 pixel forensics
//   deepfake_pixel_v1.onnx — trained on 10k IMDB-Wiki real + 2k StyleGAN2 fake
//   AUC 1.000, EER 0.000 on held-out set. Detects GAN spectral artifacts.
//   Layer activates in VerificationCamera once ONNX is deployed to public/models/deepfake/
//
// Current active weights (sum of non-zero = 1.00):
//   rppg:         0.00  (DISABLED — unreliable with standard webcams)
//   facs:         0.32  (biomechanical rules — model-agnostic)
//   cnn_v1:       0.00  (DEPRECATED)
//   cnn_v2:       0.18  (blendshape temporal CNN — synthetic training)
//   efficientnet: 0.30  (pixel forensics — EfficientNet + DINOv3)
//   keystroke:    0.20  (behavioral biometrics — Transformer encoder)

const BASE_WEIGHTS: Record<LayerName, number> = {
    rppg:        0.00,   // DISABLED: requires stable lighting + long video, unreliable on webcams
    facs:        0.32,   // Biomechanical rules — micro-expression analysis
    cnn_v1:      0.00,   // DEPRECATED: validated at 29.5% accuracy, superseded by v2
    cnn_v2:      0.18,   // ACTIVATED 2026-03-15: 3-stream blendshape CNN (synthetic training)
    efficientnet: 0.30,  // Pixel-level forensics — catches GAN + diffusion artifacts
    keystroke:   0.20,   // Behavioral biometrics — typing pattern DNA
}

/** Whether cnn_v1 has been superseded by real-data calibration. */
export const CNN_V1_CALIBRATION_STATUS = {
    accuracy:  0.295,
    macroF1:   0.244,
    macroAUC:  0.423,
    ece:       0.2376,
    note:      'Overfit to synthetic training seed=42. Use cnn_v2 once available.',
    validated: '2026-03-15',
} as const

const ENSEMBLE_BIAS = -0.2   // Slight prior toward "real" (reduces false positives)

// ─── Main function ─────────────────────────────────────────────────────────────

/**
 * Compute Bayesian ensemble from all available layer scores.
 */
export function computeEnsemble(layers: LayerScore[]): EnsembleResult {
    const available = layers.filter(l => l.available && l.confidence > 0.1)

    if (available.length === 0) {
        return _emptyResult()
    }

    // Normalize weights to available layers only
    const totalWeight = available.reduce((acc, l) => acc + BASE_WEIGHTS[l.layer], 0)
    if (totalWeight < 1e-6) return _emptyResult()

    // Compute logit ensemble
    let logitSum = ENSEMBLE_BIAS
    const contributions: LayerContribution[] = []

    for (const layer of available) {
        const w       = BASE_WEIGHTS[layer.layer] / totalWeight
        const s       = clamp(layer.score / 100, 0.001, 0.999)
        const logitS  = Math.log(s / (1 - s))  // logit transform
        const contrib = w * logitS * layer.confidence

        logitSum += contrib

        contributions.push({
            layer:        layer.layer,
            weight:       w,
            contribution: contrib,
            explanation:  _layerExplanation(layer),
        })
    }

    // Sort by absolute contribution (most influential first)
    contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))

    const pFake     = sigmoid(logitSum)
    const fakeScore = Math.round(pFake * 100)
    const verdict   = pFake < 0.35 ? 'real' : pFake < 0.65 ? 'suspicious' : 'fake'

    // Confidence based on coverage
    const coverage  = available.length / Object.keys(BASE_WEIGHTS).filter(k => BASE_WEIGHTS[k as LayerName] > 0).length
    const confidence: EnsembleResult['confidence'] =
        coverage >= 0.7 ? 'high' : coverage >= 0.4 ? 'medium' : 'low'

    const xaiExplanation = _generateExplanation(pFake, verdict, contributions, available.length)

    return {
        pFake,
        fakeScore,
        verdict,
        confidence,
        contributingLayers: contributions,
        xaiExplanation,
        auditPayload: {
            pFake:      Math.round(pFake * 1000) / 1000,
            verdict,
            layerCount: available.length,
            topLayer:   contributions[0]?.layer ?? 'none',
            timestamp:  Date.now(),
        },
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x))
}

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v))
}

function _emptyResult(): EnsembleResult {
    return {
        pFake: 0,
        fakeScore: 0,
        verdict: 'real',
        confidence: 'low',
        contributingLayers: [],
        xaiExplanation: 'Insufficient data — no layers produced results yet.',
        auditPayload: { pFake: 0, verdict: 'real', layerCount: 0, topLayer: 'none', timestamp: Date.now() },
    }
}

function _layerExplanation(layer: LayerScore): string {
    const score = layer.score
    const meta  = layer.meta ?? {}

    switch (layer.layer) {
        case 'rppg':
            if (score > 60) {
                const f = meta['grangerFStat'] as number | undefined
                return `rPPG-motion coupling absent (F=${f?.toFixed(2) ?? '?'}) — physiological signal decoupled`
            }
            return `rPPG coupling detected — heartbeat correlates with facial micro-vibration`

        case 'facs':
            if (score > 60) {
                const v = meta['violations'] as string[] | undefined
                return `FACS violations: ${v?.slice(0, 2).join(', ') ?? 'biomechanical rules broken'}`
            }
            return `FACS: natural expression biomechanics confirmed`

        case 'cnn_v1':
        case 'cnn_v2': {
            const version = layer.layer === 'cnn_v1' ? 'v1' : 'v2'
            const pred    = meta['prediction'] as string | undefined
            if (score > 60) return `CNN ${version}: classified as ${pred ?? 'deepfake'} (${score}% risk)`
            return `CNN ${version}: classified as real_human (${score}% risk)`
        }

        case 'efficientnet':
            if (score > 60) return `Pixel forensics: GAN artifacts detected in facial texture`
            return `Pixel forensics: no frequency anomalies detected`

        case 'keystroke':
            if (score > 60) return `Keystroke biometrics: behavioral pattern mismatch`
            return `Keystroke biometrics: behavioral pattern matches enrollment`

        default:
            return `Score: ${score}/100`
    }
}

function _generateExplanation(
    pFake: number,
    verdict: EnsembleResult['verdict'],
    contributions: LayerContribution[],
    layerCount: number,
): string {
    const pct = Math.round(pFake * 100)

    if (verdict === 'real') {
        const topReal = contributions
            .filter(c => c.contribution < 0)
            .slice(0, 2)
            .map(c => c.explanation)
        const evidence = topReal.length > 0 ? ` Evidence: ${topReal.join('; ')}.` : ''
        return `Veritas Engine: authentic human detected (${pct}% fake probability, ${layerCount} layers).${evidence}`
    }

    if (verdict === 'fake') {
        const topFake = contributions
            .filter(c => c.contribution > 0)
            .slice(0, 2)
            .map(c => c.explanation)
        const evidence = topFake.length > 0 ? ` Key signals: ${topFake.join('; ')}.` : ''
        return `ALERT — Veritas Engine: synthetic identity likely (${pct}% fake probability, ${layerCount} layers).${evidence}`
    }

    // suspicious
    const mixed = contributions.slice(0, 2).map(c => c.explanation)
    return `Veritas Engine: inconclusive (${pct}% fake probability, ${layerCount} layers). ${mixed.join('; ')}.`
}

// ─── Update weights (called after real-data training) ─────────────────────────

/**
 * Update ensemble weights from calibration output.
 * Call this at app startup if calibration weights are available.
 */
export function updateWeights(weights: Partial<Record<LayerName, number>>): void {
    for (const [layer, w] of Object.entries(weights) as [LayerName, number][]) {
        if (layer in BASE_WEIGHTS && typeof w === 'number') {
            BASE_WEIGHTS[layer] = w
        }
    }
}
