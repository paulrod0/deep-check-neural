/**
 * Deep-Check · Document Classifier & Clone Detection
 * Runs entirely in the browser (Canvas API, no server needed).
 *
 * Modules:
 *   1. classifyDocument  — infers document type from shape, aspect ratio, colour
 *   2. runCloneDetection — copy-move forgery detection via perceptual block hashing
 */
'use client'

// ─── Types ────────────────────────────────────────────────────────────────────

export type DocumentType =
    | 'dni'
    | 'factura'
    | 'foto_persona'
    | 'captura_pantalla'
    | 'documento_generico'
    | 'desconocido'

export interface DocumentClassification {
    type: DocumentType
    confidence: number          // 0–1
    label: string
    icon: string
    aspects: string[]           // reasoning clues
}

export interface CloneBlock {
    x1: number; y1: number      // top-left of first block (px)
    x2: number; y2: number      // top-left of duplicate block (px)
    size: number                // block size in px
    similarity: number          // 0–1
}

export interface CloneDetectionResult {
    suspiciousBlocks: CloneBlock[]
    score: number               // 0–100
    riskLevel: 'clean' | 'suspicious' | 'high_risk'
    analysisMs: number
}

// ─── 1. Document Classifier ───────────────────────────────────────────────────

const DOC_LABELS: Record<DocumentType, string> = {
    dni: 'DNI / Documento de Identidad',
    factura: 'Factura / Documento Financiero',
    foto_persona: 'Fotografía de Persona',
    captura_pantalla: 'Captura de Pantalla',
    documento_generico: 'Documento Genérico',
    desconocido: 'Tipo Desconocido',
}

const DOC_ICONS: Record<DocumentType, string> = {
    dni: '🪪',
    factura: '🧾',
    foto_persona: '👤',
    captura_pantalla: '🖥️',
    documento_generico: '📄',
    desconocido: '❓',
}

/**
 * Lightweight heuristic classifier based on:
 * - Aspect ratio (DNI ≈ 1.586, A4 ≈ 1.414, portrait photo ≈ 0.75)
 * - Dominant colour distribution (ID cards: blue, white; invoices: high white)
 * - Text density estimate (invoices: dark on white, high contrast regions)
 * - Edge density (documents have many straight horizontal edges)
 */
export function classifyDocument(img: HTMLImageElement): DocumentClassification {
    const W = img.width
    const H = img.height
    const ar = W / H   // aspect ratio
    const aspects: string[] = []

    const canvas = document.createElement('canvas')
    const SAMPLE = 200  // downsample for speed
    const scale = Math.min(1, SAMPLE / Math.max(W, H))
    const sw = Math.round(W * scale)
    const sh = Math.round(H * scale)
    canvas.width = sw
    canvas.height = sh
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(img, 0, 0, sw, sh)
    const { data } = ctx.getImageData(0, 0, sw, sh)

    // --- Colour stats ---
    let totalR = 0, totalG = 0, totalB = 0
    let whiteCount = 0   // r,g,b all > 220
    let darkCount = 0    // r+g+b < 150
    let highSatCount = 0 // strong colour bias
    const N = sw * sh

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2]
        totalR += r; totalG += g; totalB += b
        if (r > 220 && g > 220 && b > 220) whiteCount++
        if (r + g + b < 150) darkCount++
        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        if (max - min > 60) highSatCount++
    }

    const whiteFrac = whiteCount / N
    const darkFrac = darkCount / N
    const satFrac = highSatCount / N
    const avgR = totalR / N
    const avgG = totalG / N
    const avgB = totalB / N

    // --- Edge density (horizontal) ---
    let edgeCount = 0
    for (let y = 1; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
            const i = (y * sw + x) * 4
            const iprev = ((y - 1) * sw + x) * 4
            const diff = Math.abs(
                (data[i] + data[i + 1] + data[i + 2]) / 3 -
                (data[iprev] + data[iprev + 1] + data[iprev + 2]) / 3
            )
            if (diff > 40) edgeCount++
        }
    }
    const edgeFrac = edgeCount / (sw * sh)

    // --- Scoring ---
    let scores: Partial<Record<DocumentType, number>> = {
        dni: 0, factura: 0, foto_persona: 0, captura_pantalla: 0, documento_generico: 0,
    }

    // DNI: landscape (ar ~1.5–1.7), mixed colour (chip gold, photo area), not mostly white
    if (ar > 1.45 && ar < 1.75) { scores.dni = (scores.dni ?? 0) + 35; aspects.push(`Proporción DNI (${ar.toFixed(2)})`) }
    if (whiteFrac < 0.55 && satFrac > 0.15) { scores.dni = (scores.dni ?? 0) + 20; aspects.push('Distribución de color mixta') }
    if (avgB > avgR && avgB > avgG) { scores.dni = (scores.dni ?? 0) + 10 }  // blue tint common in IDs

    // Factura: portrait A4-ish (ar ~0.6–0.8), mostly white, many edges (text lines), high dark pixels
    if (ar > 0.55 && ar < 0.85) { scores.factura = (scores.factura ?? 0) + 30; aspects.push(`Proporción A4 portrait (${ar.toFixed(2)})`) }
    if (whiteFrac > 0.5) { scores.factura = (scores.factura ?? 0) + 25; aspects.push('Fondo predominantemente blanco') }
    if (edgeFrac > 0.08) { scores.factura = (scores.factura ?? 0) + 20; aspects.push('Alta densidad de bordes (texto)') }
    if (darkFrac > 0.05 && darkFrac < 0.3) { scores.factura = (scores.factura ?? 0) + 10 }

    // Photo of person: portrait (ar ~0.65–0.85) or near-square, high saturation, skin tones
    const skinLike = avgR > 140 && avgR > avgB + 20 && avgG > avgB + 10
    if (ar > 0.6 && ar < 1.1 && skinLike) { scores.foto_persona = (scores.foto_persona ?? 0) + 40; aspects.push('Tonos de piel detectados') }
    if (satFrac > 0.25 && !skinLike) { scores.foto_persona = (scores.foto_persona ?? 0) + 10 }

    // Screenshot: usually landscape, very white or uniform background, low saturation
    if (ar > 1.2 && whiteFrac > 0.6 && satFrac < 0.15) {
        scores.captura_pantalla = (scores.captura_pantalla ?? 0) + 45
        aspects.push('Fondo muy uniforme (screenshot)')
    }
    if (ar > 1.5 && edgeFrac > 0.06 && whiteFrac > 0.5) { scores.captura_pantalla = (scores.captura_pantalla ?? 0) + 20 }

    // Generic document: any portrait A4-like we didn't classify otherwise
    if (ar > 0.6 && ar < 0.9) { scores.documento_generico = (scores.documento_generico ?? 0) + 10 }

    // Pick winner
    const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a)
    const [bestType, bestScore] = sorted[0] as [DocumentType, number]
    const totalPossible = 100
    const confidence = Math.min(0.98, bestScore / totalPossible)

    const type: DocumentType = confidence < 0.15 ? 'desconocido' : bestType

    return {
        type,
        confidence,
        label: DOC_LABELS[type],
        icon: DOC_ICONS[type],
        aspects: aspects.slice(0, 4),
    }
}

// ─── 2. Clone / Copy-Move Detection ──────────────────────────────────────────

const BLOCK = 16        // block size in px
const HASH_DIM = 8      // DCT hash dimension (8×8 → 64-bit)
const SIMILARITY_THRESHOLD = 0.93

/**
 * Compute a perceptual hash of an image block using average-hash approach.
 * Returns a Float32Array of length HASH_DIM² representing normalized pixel means.
 */
function blockHash(
    data: Uint8ClampedArray,
    imgW: number,
    bx: number,
    by: number,
    bSize: number,
): Float32Array {
    const hash = new Float32Array(HASH_DIM * HASH_DIM)
    const cellW = bSize / HASH_DIM
    const cellH = bSize / HASH_DIM

    for (let cy = 0; cy < HASH_DIM; cy++) {
        for (let cx = 0; cx < HASH_DIM; cx++) {
            let sum = 0
            let count = 0
            const startX = Math.round(bx + cx * cellW)
            const startY = Math.round(by + cy * cellH)
            const endX = Math.min(startX + Math.ceil(cellW), bx + bSize)
            const endY = Math.min(startY + Math.ceil(cellH), by + bSize)
            for (let py = startY; py < endY; py++) {
                for (let px = startX; px < endX; px++) {
                    const idx = (py * imgW + px) * 4
                    sum += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
                    count++
                }
            }
            hash[cy * HASH_DIM + cx] = count > 0 ? sum / count / 255 : 0
        }
    }
    return hash
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0, normA = 0, normB = 0
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]
        normA += a[i] * a[i]
        normB += b[i] * b[i]
    }
    return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Detect copy-move regions in an image.
 *
 * Algorithm:
 *   1. Sample non-overlapping blocks of size BLOCK×BLOCK
 *   2. Compute perceptual hash for each block
 *   3. Compare all pairs — O(n²) but limited by MAX_BLOCKS cap
 *   4. Flag pairs with similarity > SIMILARITY_THRESHOLD and distance > min_dist
 */
export async function runCloneDetection(img: HTMLImageElement): Promise<CloneDetectionResult> {
    const t0 = performance.now()

    const MAX_DIM = 600  // downsample large images for speed
    const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height))
    const W = Math.round(img.width * scale)
    const H = Math.round(img.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(img, 0, 0, W, H)
    const { data } = ctx.getImageData(0, 0, W, H)

    // Build block list
    interface Block { x: number; y: number; hash: Float32Array }
    const blocks: Block[] = []
    const MAX_BLOCKS = 300  // cap for performance

    const stepX = Math.max(BLOCK, Math.round(W / Math.sqrt(MAX_BLOCKS)))
    const stepY = Math.max(BLOCK, Math.round(H / Math.sqrt(MAX_BLOCKS)))

    for (let by = 0; by + BLOCK <= H; by += stepY) {
        for (let bx = 0; bx + BLOCK <= W; bx += stepX) {
            if (blocks.length >= MAX_BLOCKS) break
            blocks.push({ x: bx, y: by, hash: blockHash(data, W, bx, by, BLOCK) })
        }
        if (blocks.length >= MAX_BLOCKS) break
    }

    // Compare all pairs
    const MIN_DIST = BLOCK * 3  // blocks must be far apart to count as clone
    const suspicious: CloneBlock[] = []
    const scaleInv = 1 / scale  // convert back to original image coords

    for (let i = 0; i < blocks.length; i++) {
        for (let j = i + 1; j < blocks.length; j++) {
            const dx = Math.abs(blocks[i].x - blocks[j].x)
            const dy = Math.abs(blocks[i].y - blocks[j].y)
            if (dx < MIN_DIST && dy < MIN_DIST) continue  // too close — same region

            const sim = cosineSimilarity(blocks[i].hash, blocks[j].hash)
            if (sim >= SIMILARITY_THRESHOLD) {
                suspicious.push({
                    x1: Math.round(blocks[i].x * scaleInv),
                    y1: Math.round(blocks[i].y * scaleInv),
                    x2: Math.round(blocks[j].x * scaleInv),
                    y2: Math.round(blocks[j].y * scaleInv),
                    size: Math.round(BLOCK * scaleInv),
                    similarity: sim,
                })
            }
        }
    }

    // Score: 0 = clean, 100 = many clone pairs
    const rawScore = Math.min(100, suspicious.length * 10)
    const score = Math.round(rawScore)
    const riskLevel =
        score >= 30 ? 'high_risk' : score >= 10 ? 'suspicious' : 'clean'

    return {
        suspiciousBlocks: suspicious.slice(0, 20),  // top 20 matches
        score,
        riskLevel,
        analysisMs: Math.round(performance.now() - t0),
    }
}

// ─── 3. Overlay renderer ─────────────────────────────────────────────────────

/**
 * Render clone detection results on top of the original image.
 * Returns a data URL with suspicious blocks highlighted.
 */
export function renderCloneOverlay(
    img: HTMLImageElement,
    result: CloneDetectionResult,
): string {
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)

    if (result.suspiciousBlocks.length === 0) return canvas.toDataURL('image/jpeg', 0.85)

    ctx.lineWidth = 2

    result.suspiciousBlocks.forEach((block, i) => {
        const hue = (i * 37) % 360  // different colour per pair
        ctx.strokeStyle = `hsla(${hue}, 100%, 60%, 0.9)`
        ctx.fillStyle = `hsla(${hue}, 100%, 60%, 0.15)`

        ctx.fillRect(block.x1, block.y1, block.size, block.size)
        ctx.strokeRect(block.x1, block.y1, block.size, block.size)

        ctx.fillRect(block.x2, block.y2, block.size, block.size)
        ctx.strokeRect(block.x2, block.y2, block.size, block.size)

        // Connecting line
        ctx.beginPath()
        ctx.strokeStyle = `hsla(${hue}, 100%, 70%, 0.4)`
        ctx.lineWidth = 1
        ctx.setLineDash([4, 4])
        ctx.moveTo(block.x1 + block.size / 2, block.y1 + block.size / 2)
        ctx.lineTo(block.x2 + block.size / 2, block.y2 + block.size / 2)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.lineWidth = 2
    })

    return canvas.toDataURL('image/jpeg', 0.85)
}
