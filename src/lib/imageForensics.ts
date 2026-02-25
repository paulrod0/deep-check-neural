/**
 * Deep-Check · Image Forensics Engine
 * Client-side analysis (runs in browser via Canvas API + exifr).
 *
 * Modules
 *   1. ELA  — Error Level Analysis (JPEG compression artifact delta)
 *   2. EXIF — Metadata anomaly detection
 *   3. NOISE — Laplacian noise variance uniformity (AI image signature)
 *   4. SCORE — Aggregate risk scoring (0–100)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type RiskLevel = 'clean' | 'suspicious' | 'high_risk'

export interface ForensicAlert {
    code: string
    label: string
    detail: string
    severity: 'low' | 'medium' | 'high'
    module: 'ela' | 'exif' | 'noise' | 'meta'
}

export interface ELAResult {
    score: number          // 0–100 (higher = more manipulation evidence)
    heatmapDataUrl: string // amplified diff rendered as data URL
    maxDiff: number
    meanDiff: number
    suspiciousRegions: number // count of 8×8 blocks with high delta
}

export interface EXIFResult {
    score: number          // 0–100 (higher = more anomalies)
    raw: Record<string, unknown>
    flags: string[]
    software?: string
    dateTime?: string
    gpsPresent: boolean
    editSoftwareDetected: boolean
    dateTimeInconsistency: boolean
}

export interface NoiseResult {
    score: number          // 0–100 (higher = more AI/synthetic probability)
    laplacianVariance: number
    uniformityScore: number  // 0–1 (high = suspiciously uniform = AI)
    blockVarianceStd: number // std of per-block variances (low = AI)
}

export interface ForensicsReport {
    elaScore: number
    exifScore: number
    noiseScore: number
    riskScore: number           // final 0–100
    riskLevel: RiskLevel
    ela: ELAResult
    exif: EXIFResult
    noise: NoiseResult
    alerts: ForensicAlert[]
    thumbnail: string           // 200px wide thumbnail data URL
    analysisMs: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v))
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = src
    })
}

function fileToDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = e => resolve(e.target!.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
    })
}

// ─── Thumbnail ────────────────────────────────────────────────────────────────

function makeThumbnail(img: HTMLImageElement, maxW = 320): string {
    const scale = Math.min(1, maxW / img.width)
    const w = Math.round(img.width * scale)
    const h = Math.round(img.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', 0.7)
}

// ─── 1. ELA ───────────────────────────────────────────────────────────────────

/**
 * Error Level Analysis
 *
 * Algorithm:
 *   - Re-save the image as JPEG at quality=75 (a known compression level)
 *   - Compare per-pixel brightness against the original
 *   - Amplify differences (×12) and render as a heatmap
 *   - Manipulated regions have a different compression history → glow brighter
 *   - AI-generated images: very low uniform ELA (never compressed before)
 */
async function runELA(img: HTMLImageElement): Promise<ELAResult> {
    const W = img.width
    const H = img.height

    // --- Original pixel data ---
    const c0 = document.createElement('canvas')
    c0.width = W; c0.height = H
    const ctx0 = c0.getContext('2d')!
    ctx0.drawImage(img, 0, 0)
    const orig = ctx0.getImageData(0, 0, W, H)

    // --- Re-compress at quality 75 ---
    const recompressedUrl = c0.toDataURL('image/jpeg', 0.75)
    const recompImg = await loadImage(recompressedUrl)
    const c1 = document.createElement('canvas')
    c1.width = W; c1.height = H
    const ctx1 = c1.getContext('2d')!
    ctx1.drawImage(recompImg, 0, 0)
    const recomp = ctx1.getImageData(0, 0, W, H)

    // --- Compute ELA heatmap ---
    const AMPLIFY = 12
    const ela = ctx1.createImageData(W, H)
    let totalBrightness = 0
    let maxBrightness = 0

    for (let i = 0; i < orig.data.length; i += 4) {
        const dr = Math.abs(orig.data[i]   - recomp.data[i])   * AMPLIFY
        const dg = Math.abs(orig.data[i+1] - recomp.data[i+1]) * AMPLIFY
        const db = Math.abs(orig.data[i+2] - recomp.data[i+2]) * AMPLIFY
        const r = clamp(dr, 0, 255)
        const g = clamp(dg, 0, 255)
        const b = clamp(db, 0, 255)
        const brightness = (r + g + b) / 3

        ela.data[i]   = r
        ela.data[i+1] = g
        ela.data[i+2] = b
        ela.data[i+3] = 255

        totalBrightness += brightness
        if (brightness > maxBrightness) maxBrightness = brightness
    }

    const meanDiff = totalBrightness / (W * H)

    // Count suspicious 8×8 blocks (mean brightness > threshold)
    const BLOCK = 8
    const HIGH_THRESHOLD = 40
    let suspiciousRegions = 0
    for (let by = 0; by < H; by += BLOCK) {
        for (let bx = 0; bx < W; bx += BLOCK) {
            let bSum = 0, bCount = 0
            for (let y = by; y < Math.min(by + BLOCK, H); y++) {
                for (let x = bx; x < Math.min(bx + BLOCK, W); x++) {
                    const idx = (y * W + x) * 4
                    bSum += (ela.data[idx] + ela.data[idx+1] + ela.data[idx+2]) / 3
                    bCount++
                }
            }
            if (bCount > 0 && bSum / bCount > HIGH_THRESHOLD) suspiciousRegions++
        }
    }

    // Render heatmap
    ctx0.putImageData(ela, 0, 0)
    const heatmapDataUrl = c0.toDataURL('image/jpeg', 0.85)

    // Score: combination of mean brightness and suspicious block ratio
    const totalBlocks = Math.ceil(H / BLOCK) * Math.ceil(W / BLOCK)
    const suspiciousRatio = totalBlocks > 0 ? suspiciousRegions / totalBlocks : 0
    const rawScore = (meanDiff / 255) * 60 + suspiciousRatio * 40
    const score = clamp(Math.round(rawScore * 100), 0, 100)

    return { score, heatmapDataUrl, maxDiff: maxBrightness, meanDiff, suspiciousRegions }
}

// ─── 2. EXIF ──────────────────────────────────────────────────────────────────

const EDIT_SOFTWARE_PATTERNS = [
    'photoshop', 'lightroom', 'gimp', 'affinity', 'paint.net',
    'canva', 'pixlr', 'snapseed', 'facetune', 'meitu',
    'stable diffusion', 'midjourney', 'dall-e', 'firefly',
]

async function runEXIF(file: File): Promise<EXIFResult> {
    let raw: Record<string, unknown> = {}
    let score = 0
    const flags: string[] = []
    let software: string | undefined
    let dateTime: string | undefined
    let gpsPresent = false
    let editSoftwareDetected = false
    let dateTimeInconsistency = false

    try {
        // Dynamic import — exifr is ESM, works in browser
        const exifr = await import('exifr')
        const data = await exifr.parse(file, {
            tiff: true, exif: true, gps: true, iptc: true, icc: false,
            sanitize: true, mergeOutput: false,
        })
        if (data) {
            raw = { ...data.tiff, ...data.exif, gps: data.gps }
        }
    } catch {
        // exifr may fail for PNGs / non-EXIF files — treat as no metadata
        return { score: 15, raw: {}, flags: ['no_exif'], gpsPresent: false,
            editSoftwareDetected: false, dateTimeInconsistency: false }
    }

    // --- Check software ---
    const sw = (raw.Software as string | undefined)?.toLowerCase() ?? ''
    if (sw) {
        software = raw.Software as string
        for (const pat of EDIT_SOFTWARE_PATTERNS) {
            if (sw.includes(pat)) {
                editSoftwareDetected = true
                flags.push(`edit_software:${pat}`)
                score += 35
                break
            }
        }
    } else {
        // Missing software tag is slightly suspicious (phones always set it)
        score += 5
        flags.push('missing_software')
    }

    // --- Check GPS ---
    const gps = (raw.gps as Record<string, unknown> | undefined)
    gpsPresent = !!(gps?.latitude)

    // --- Check DateTimeOriginal vs FileModifyDate inconsistency ---
    const dto = raw.DateTimeOriginal as string | undefined
    const dtd = raw.DateTime as string | undefined
    dateTime = dto ?? dtd

    if (dto && dtd && dto !== dtd) {
        // Large discrepancy between capture date and modification date
        const dtoMs = new Date(dto.replace(':', '-').replace(':', '-')).getTime()
        const dtdMs = new Date(dtd.replace(':', '-').replace(':', '-')).getTime()
        if (Math.abs(dtoMs - dtdMs) > 60_000) {
            dateTimeInconsistency = true
            flags.push('datetime_mismatch')
            score += 20
        }
    }

    // --- Missing make/model (for suspected ID photos, invoices etc.) ---
    if (!raw.Make && !raw.Model) {
        flags.push('no_camera_make')
        score += 10
    }

    // --- XMP:CreatorTool ---
    const creator = (raw.CreatorTool as string | undefined)?.toLowerCase() ?? ''
    if (creator && EDIT_SOFTWARE_PATTERNS.some(p => creator.includes(p))) {
        score += 25
        flags.push(`creator_tool_edit`)
    }

    // --- PNG or screenshot (no EXIF at all → possibly AI / screenshot) ---
    if (Object.keys(raw).length === 0) {
        score = Math.max(score, 20)
        flags.push('no_exif_data')
    }

    return {
        score: clamp(score, 0, 100),
        raw,
        flags,
        software,
        dateTime,
        gpsPresent,
        editSoftwareDetected,
        dateTimeInconsistency,
    }
}

// ─── 3. NOISE (AI Detection heuristic) ───────────────────────────────────────

/**
 * AI-generated images (Stable Diffusion, DALL-E, Midjourney, GAN outputs)
 * have characteristically uniform noise: the Laplacian variance is low and
 * its distribution across 16×16 blocks is very uniform (low std of block
 * variances). Real photographs have heterogeneous noise from sensor shot noise,
 * JPEG quantisation, and scene variation.
 *
 * Score: 0 = definitely real photo / high real-world noise
 *        100 = suspiciously uniform / AI-like
 */
function runNoise(img: HTMLImageElement): NoiseResult {
    const W = img.width
    const H = img.height
    const canvas = document.createElement('canvas')
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const { data } = ctx.getImageData(0, 0, W, H)

    // Convert to greyscale
    const grey = new Float32Array(W * H)
    for (let i = 0; i < W * H; i++) {
        grey[i] = 0.299 * data[i*4] + 0.587 * data[i*4+1] + 0.114 * data[i*4+2]
    }

    // Laplacian kernel: [0,1,0,1,-4,1,0,1,0]
    let totalLaplacian = 0
    let laplacianCount = 0
    for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
            const c = grey[y * W + x]
            const lap = (
                grey[(y-1)*W+x] + grey[(y+1)*W+x] +
                grey[y*W+(x-1)] + grey[y*W+(x+1)] - 4 * c
            )
            totalLaplacian += lap * lap
            laplacianCount++
        }
    }
    const laplacianVariance = laplacianCount > 0 ? totalLaplacian / laplacianCount : 0

    // Per-block variance (16×16 blocks)
    const BLOCK = 16
    const blockVars: number[] = []
    for (let by = 0; by < H - BLOCK; by += BLOCK) {
        for (let bx = 0; bx < W - BLOCK; bx += BLOCK) {
            const vals: number[] = []
            for (let y = by; y < by + BLOCK; y++) {
                for (let x = bx; x < bx + BLOCK; x++) {
                    vals.push(grey[y * W + x])
                }
            }
            const mean = vals.reduce((a, b) => a + b, 0) / vals.length
            const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length
            blockVars.push(variance)
        }
    }

    if (blockVars.length === 0) {
        return { score: 0, laplacianVariance: 0, uniformityScore: 0, blockVarianceStd: 0 }
    }

    const meanBlockVar = blockVars.reduce((a, b) => a + b, 0) / blockVars.length
    const blockVarianceStd = Math.sqrt(
        blockVars.reduce((a, v) => a + (v - meanBlockVar) ** 2, 0) / blockVars.length
    )

    // Uniformity: ratio of std to mean (coefficient of variation)
    // Real photos: high CV (heterogeneous), AI: low CV (uniform)
    const cv = meanBlockVar > 0 ? blockVarianceStd / meanBlockVar : 1
    const uniformityScore = clamp(1 - cv, 0, 1)  // high = uniform = AI

    // Low Laplacian variance + high uniformity → AI
    // Laplacian < 50 is very smooth (typical for AI): score goes up
    const lapFlag = laplacianVariance < 200 ? clamp(1 - laplacianVariance / 200, 0, 1) : 0
    const rawScore = (uniformityScore * 0.65 + lapFlag * 0.35) * 100
    const score = clamp(Math.round(rawScore), 0, 100)

    return { score, laplacianVariance, uniformityScore, blockVarianceStd }
}

// ─── 4. Aggregate scoring ─────────────────────────────────────────────────────

function computeRiskScore(ela: number, exif: number, noise: number): {
    riskScore: number
    riskLevel: RiskLevel
} {
    // Weighted combination: ELA has highest weight (most diagnostic)
    const riskScore = clamp(
        Math.round(ela * 0.50 + exif * 0.30 + noise * 0.20),
        0, 100
    )
    const riskLevel: RiskLevel =
        riskScore >= 60 ? 'high_risk'   :
        riskScore >= 30 ? 'suspicious'  : 'clean'

    return { riskScore, riskLevel }
}

function buildAlerts(
    ela: ELAResult,
    exif: EXIFResult,
    noise: NoiseResult,
): ForensicAlert[] {
    const alerts: ForensicAlert[] = []

    // ELA alerts
    if (ela.score >= 65) {
        alerts.push({
            code: 'ela_high',
            label: 'Alta probabilidad de manipulación',
            detail: `El análisis ELA detectó ${ela.suspiciousRegions} regiones con historial de compresión inconsistente, indicativo de edición post-captura.`,
            severity: 'high', module: 'ela',
        })
    } else if (ela.score >= 35) {
        alerts.push({
            code: 'ela_medium',
            label: 'Artefactos de compresión anómalos',
            detail: `Regiones sospechosas detectadas (${ela.suspiciousRegions} bloques). Puede indicar retoque localizado.`,
            severity: 'medium', module: 'ela',
        })
    } else if (ela.score < 8) {
        alerts.push({
            code: 'ela_too_clean',
            label: 'Sin artefactos JPEG (imagen posiblemente sintética)',
            detail: 'La imagen carece del patrón de ruido típico de una fotografía real. Es consistente con generación por IA o captura de pantalla.',
            severity: 'medium', module: 'ela',
        })
    }

    // EXIF alerts
    if (exif.editSoftwareDetected) {
        alerts.push({
            code: 'exif_edit_software',
            label: 'Software de edición detectado en metadatos',
            detail: `Los metadatos EXIF registran el uso de: ${exif.software}. Prueba directa de procesamiento post-captura.`,
            severity: 'high', module: 'exif',
        })
    }
    if (exif.dateTimeInconsistency) {
        alerts.push({
            code: 'exif_date_mismatch',
            label: 'Inconsistencia en fechas EXIF',
            detail: 'La fecha de captura original difiere de la fecha de modificación. El archivo fue editado y re-guardado tras su creación.',
            severity: 'medium', module: 'exif',
        })
    }
    if (exif.flags.includes('no_exif_data')) {
        alerts.push({
            code: 'exif_missing',
            label: 'Sin metadatos EXIF',
            detail: 'La imagen no contiene metadatos de cámara. Las fotos de teléfono/cámara siempre incluyen EXIF. Posible captura de pantalla o imagen sintética.',
            severity: 'low', module: 'exif',
        })
    }
    if (exif.flags.includes('no_camera_make')) {
        alerts.push({
            code: 'exif_no_camera',
            label: 'Sin datos de dispositivo (Make/Model)',
            detail: 'No se identificó el dispositivo de captura. Inusual en imágenes tomadas con cámara real.',
            severity: 'low', module: 'exif',
        })
    }

    // Noise / AI alerts
    if (noise.score >= 65) {
        alerts.push({
            code: 'noise_ai_likely',
            label: 'Firma de imagen sintética (IA generativa)',
            detail: `La distribución del ruido es anómalamente uniforme (CV=${noise.uniformityScore.toFixed(2)}). Los modelos de IA generativa producen este patrón. Alta probabilidad de imagen generada por IA.`,
            severity: 'high', module: 'noise',
        })
    } else if (noise.score >= 40) {
        alerts.push({
            code: 'noise_ai_possible',
            label: 'Patrón de ruido atípico',
            detail: 'El perfil de ruido difiere del esperado en una fotografía real. Puede ser imagen sintética, renderizado 3D o captura de pantalla.',
            severity: 'medium', module: 'noise',
        })
    }

    return alerts
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function analyzeImage(file: File): Promise<ForensicsReport> {
    const t0 = performance.now()

    const dataUrl = await fileToDataURL(file)
    const img = await loadImage(dataUrl)

    // Run all modules in parallel where possible
    const [ela, exif, noise, thumbnail] = await Promise.all([
        runELA(img),
        runEXIF(file),
        Promise.resolve(runNoise(img)),
        Promise.resolve(makeThumbnail(img)),
    ])

    const { riskScore, riskLevel } = computeRiskScore(ela.score, exif.score, noise.score)
    const alerts = buildAlerts(ela, exif, noise)

    return {
        elaScore:   ela.score,
        exifScore:  exif.score,
        noiseScore: noise.score,
        riskScore,
        riskLevel,
        ela,
        exif,
        noise,
        alerts,
        thumbnail,
        analysisMs: Math.round(performance.now() - t0),
    }
}

export function riskLevelColor(level: RiskLevel): string {
    return level === 'high_risk' ? '#ff4444'
         : level === 'suspicious' ? '#ffaa00'
         : '#00ff9d'
}

export function riskLevelLabel(level: RiskLevel): string {
    return level === 'high_risk' ? 'Alto Riesgo'
         : level === 'suspicious' ? 'Sospechoso'
         : 'Limpio'
}
