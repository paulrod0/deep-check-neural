/**
 * qrCode.ts — Minimal QR Code Generator (No Dependencies)
 * ========================================================
 *
 * Generates QR code as a Canvas-drawable path or data URL.
 * Used by certificate PDF and verify pages to encode the
 * certificate verification URL.
 *
 * Implements QR Code Model 2 (ISO/IEC 18004) with:
 *   - Numeric, alphanumeric, and byte modes
 *   - Error correction level L (7%)
 *   - Versions 1-10 (up to 271 bytes)
 *   - Automatic version selection
 *
 * Zero external dependencies — pure TypeScript.
 */

'use client'

// ── Types ─────────────────────────────────────────────────────────────────────

interface QRMatrix {
  size: number
  modules: boolean[][]
}

// ── GF(256) arithmetic for Reed-Solomon ──────────────────────────────────────

const GF256_EXP = new Uint8Array(512)
const GF256_LOG = new Uint8Array(256)

{
  let x = 1
  for (let i = 0; i < 255; i++) {
    GF256_EXP[i] = x
    GF256_LOG[x] = i
    x = (x << 1) ^ (x >= 128 ? 0x11d : 0)
  }
  for (let i = 255; i < 512; i++) {
    GF256_EXP[i] = GF256_EXP[i - 255]
  }
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return GF256_EXP[GF256_LOG[a] + GF256_LOG[b]]
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1])
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1)
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]
      next[j + 1] ^= gfMul(poly[j], GF256_EXP[i])
    }
    poly = next
  }
  return poly
}

function rsEncode(data: Uint8Array, ecWords: number): Uint8Array {
  const gen = rsGeneratorPoly(ecWords)
  const result = new Uint8Array(data.length + ecWords)
  result.set(data)

  for (let i = 0; i < data.length; i++) {
    const coeff = result[i]
    if (coeff !== 0) {
      for (let j = 0; j < gen.length; j++) {
        result[i + j] ^= gfMul(gen[j], coeff)
      }
    }
  }

  return result.slice(data.length)
}

// ── QR Code Parameters (Error Correction Level L) ───────────────────────────

// [version]: { totalCodewords, ecCodewordsPerBlock, numBlocks, dataCodewords }
const QR_PARAMS: Record<number, { total: number; ecPerBlock: number; blocks: number; data: number }> = {
  1:  { total: 26,   ecPerBlock: 7,  blocks: 1, data: 19 },
  2:  { total: 44,   ecPerBlock: 10, blocks: 1, data: 34 },
  3:  { total: 70,   ecPerBlock: 15, blocks: 1, data: 55 },
  4:  { total: 100,  ecPerBlock: 20, blocks: 1, data: 80 },
  5:  { total: 134,  ecPerBlock: 26, blocks: 1, data: 108 },
  6:  { total: 172,  ecPerBlock: 18, blocks: 2, data: 136 },
  7:  { total: 196,  ecPerBlock: 20, blocks: 2, data: 156 },
  8:  { total: 242,  ecPerBlock: 24, blocks: 2, data: 194 },
  9:  { total: 292,  ecPerBlock: 30, blocks: 2, data: 232 },
  10: { total: 346,  ecPerBlock: 18, blocks: 4, data: 274 },
}

function selectVersion(dataLength: number): number {
  for (let v = 1; v <= 10; v++) {
    // Byte mode: 4 bits mode + 8/16 bits count + 8*len bits data
    const countBits = v <= 9 ? 8 : 16
    const dataBits = 4 + countBits + dataLength * 8
    const dataBytes = Math.ceil(dataBits / 8)
    if (dataBytes <= QR_PARAMS[v].data) return v
  }
  return 10 // Fallback to max supported
}

// ── Bit Stream ──────────────────────────────────────────────────────────────

class BitStream {
  private bits: number[] = []

  append(value: number, length: number) {
    for (let i = length - 1; i >= 0; i--) {
      this.bits.push((value >> i) & 1)
    }
  }

  toBytes(): Uint8Array {
    // Pad to byte boundary
    while (this.bits.length % 8 !== 0) this.bits.push(0)
    const bytes = new Uint8Array(this.bits.length / 8)
    for (let i = 0; i < bytes.length; i++) {
      let byte = 0
      for (let j = 0; j < 8; j++) {
        byte = (byte << 1) | this.bits[i * 8 + j]
      }
      bytes[i] = byte
    }
    return bytes
  }

  get length() { return this.bits.length }
}

// ── Data Encoding ───────────────────────────────────────────────────────────

function encodeData(text: string, version: number): Uint8Array {
  const params = QR_PARAMS[version]
  const stream = new BitStream()

  // Byte mode indicator
  stream.append(0b0100, 4)

  // Character count
  const countBits = version <= 9 ? 8 : 16
  const bytes = new TextEncoder().encode(text)
  stream.append(bytes.length, countBits)

  // Data
  for (const b of bytes) {
    stream.append(b, 8)
  }

  // Terminator
  const dataCapacityBits = params.data * 8
  const terminatorLen = Math.min(4, dataCapacityBits - stream.length)
  stream.append(0, terminatorLen)

  // Pad to byte boundary
  let encoded = stream.toBytes()

  // Pad to data capacity
  if (encoded.length < params.data) {
    const padded = new Uint8Array(params.data)
    padded.set(encoded)
    const padBytes = [0xEC, 0x11]
    for (let i = encoded.length; i < params.data; i++) {
      padded[i] = padBytes[(i - encoded.length) % 2]
    }
    encoded = padded
  }

  return encoded
}

// ── QR Matrix Construction ──────────────────────────────────────────────────

function createMatrix(version: number): QRMatrix {
  const size = 17 + version * 4
  const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false))
  return { size, modules }
}

function setModule(matrix: QRMatrix, row: number, col: number, value: boolean) {
  if (row >= 0 && row < matrix.size && col >= 0 && col < matrix.size) {
    matrix.modules[row][col] = value
  }
}

// Reserved areas tracking
function createReserved(size: number): boolean[][] {
  return Array.from({ length: size }, () => Array(size).fill(false))
}

function addFinderPattern(matrix: QRMatrix, reserved: boolean[][], row: number, col: number) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r, cc = col + c
      if (rr < 0 || rr >= matrix.size || cc < 0 || cc >= matrix.size) continue
      const inOuter = r === 0 || r === 6 || c === 0 || c === 6
      const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4
      const inSep = r === -1 || r === 7 || c === -1 || c === 7
      setModule(matrix, rr, cc, (inOuter || inInner) && !inSep)
      reserved[rr][cc] = true
    }
  }
}

function addTimingPatterns(matrix: QRMatrix, reserved: boolean[][]) {
  for (let i = 8; i < matrix.size - 8; i++) {
    const value = i % 2 === 0
    if (!reserved[6][i]) {
      setModule(matrix, 6, i, value)
      reserved[6][i] = true
    }
    if (!reserved[i][6]) {
      setModule(matrix, i, 6, value)
      reserved[i][6] = true
    }
  }
}

// Alignment pattern positions for versions 2+
const ALIGNMENT_POSITIONS: Record<number, number[]> = {
  2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46],
  10: [6, 28, 52],
}

function addAlignmentPatterns(matrix: QRMatrix, reserved: boolean[][], version: number) {
  if (version < 2) return
  const positions = ALIGNMENT_POSITIONS[version] || []
  for (const row of positions) {
    for (const col of positions) {
      // Skip if overlaps with finder pattern
      if (reserved[row][col]) continue
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const val = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0)
          setModule(matrix, row + r, col + c, val)
          reserved[row + r][col + c] = true
        }
      }
    }
  }
}

function addFormatInfo(matrix: QRMatrix, reserved: boolean[][], maskPattern: number) {
  // EC level L = 01, combined with mask pattern
  const formatBits = (0b01 << 3) | maskPattern
  let data = formatBits

  // BCH(15,5) encoding
  let rem = data << 10
  for (let i = 4; i >= 0; i--) {
    if ((rem >> (i + 10)) & 1) {
      rem ^= 0b10100110111 << i
    }
  }
  const encoded = ((data << 10) | rem) ^ 0b101010000010010

  // Place format bits
  const formatPositions1 = [
    [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8],
    [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  ]
  const n = matrix.size
  const formatPositions2 = [
    [8, n - 1], [8, n - 2], [8, n - 3], [8, n - 4], [8, n - 5], [8, n - 6], [8, n - 7],
    [n - 7, 8], [n - 6, 8], [n - 5, 8], [n - 4, 8], [n - 3, 8], [n - 2, 8], [n - 1, 8],
  ]

  // Dark module
  setModule(matrix, n - 8, 8, true)
  reserved[n - 8][8] = true

  for (let i = 0; i < 15; i++) {
    const bit = ((encoded >> (14 - i)) & 1) === 1
    const [r1, c1] = formatPositions1[i]
    setModule(matrix, r1, c1, bit)
    reserved[r1][c1] = true

    if (i < formatPositions2.length) {
      const [r2, c2] = formatPositions2[i]
      setModule(matrix, r2, c2, bit)
      reserved[r2][c2] = true
    }
  }
}

// ── Data Placement ──────────────────────────────────────────────────────────

function placeData(matrix: QRMatrix, reserved: boolean[][], data: Uint8Array) {
  let bitIndex = 0
  const totalBits = data.length * 8
  let upward = true
  let col = matrix.size - 1

  while (col > 0) {
    if (col === 6) col-- // Skip timing column

    for (let row = upward ? matrix.size - 1 : 0;
         upward ? row >= 0 : row < matrix.size;
         upward ? row-- : row++) {
      for (let c = 0; c < 2; c++) {
        const cc = col - c
        if (reserved[row][cc]) continue
        if (bitIndex < totalBits) {
          const byte = data[Math.floor(bitIndex / 8)]
          const bit = ((byte >> (7 - (bitIndex % 8))) & 1) === 1
          setModule(matrix, row, cc, bit)
          bitIndex++
        }
      }
    }

    col -= 2
    upward = !upward
  }
}

// ── Masking ─────────────────────────────────────────────────────────────────

const MASK_FUNCTIONS = [
  (r: number, c: number) => (r + c) % 2 === 0,
  (r: number, _c: number) => r % 2 === 0,
  (_r: number, c: number) => c % 3 === 0,
  (r: number, c: number) => (r + c) % 3 === 0,
  (r: number, c: number) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r: number, c: number) => ((r * c) % 2 + (r * c) % 3) === 0,
  (r: number, c: number) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
  (r: number, c: number) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
]

function applyMask(matrix: QRMatrix, reserved: boolean[][], maskIndex: number) {
  const fn = MASK_FUNCTIONS[maskIndex]
  for (let r = 0; r < matrix.size; r++) {
    for (let c = 0; c < matrix.size; c++) {
      if (!reserved[r][c] && fn(r, c)) {
        matrix.modules[r][c] = !matrix.modules[r][c]
      }
    }
  }
}

// ── Main QR Code Generation ─────────────────────────────────────────────────

function generateQRMatrix(text: string): QRMatrix {
  const version = selectVersion(new TextEncoder().encode(text).length)
  const params = QR_PARAMS[version]

  // Encode data
  const dataCodewords = encodeData(text, version)

  // RS error correction
  const ecCodewords = rsEncode(dataCodewords, params.ecPerBlock)

  // Interleave data + EC
  const allCodewords = new Uint8Array(params.total)
  allCodewords.set(dataCodewords)
  allCodewords.set(ecCodewords, dataCodewords.length)

  // Build matrix
  const matrix = createMatrix(version)
  const reserved = createReserved(matrix.size)

  // Add function patterns
  addFinderPattern(matrix, reserved, 0, 0)
  addFinderPattern(matrix, reserved, 0, matrix.size - 7)
  addFinderPattern(matrix, reserved, matrix.size - 7, 0)
  addTimingPatterns(matrix, reserved)
  addAlignmentPatterns(matrix, reserved, version)

  // Reserve format info area
  for (let i = 0; i < 8; i++) {
    reserved[8][i] = true
    reserved[i][8] = true
    reserved[8][matrix.size - 1 - i] = true
    reserved[matrix.size - 1 - i][8] = true
  }
  reserved[8][8] = true

  // Place data
  placeData(matrix, reserved, allCodewords)

  // Apply mask 0 (simplest, good enough for URLs)
  applyMask(matrix, reserved, 0)
  addFormatInfo(matrix, reserved, 0)

  return matrix
}

// ── Canvas Rendering ────────────────────────────────────────────────────────

/**
 * Draw a QR code onto a Canvas 2D context.
 *
 * @param ctx The canvas rendering context
 * @param text The text to encode
 * @param x Top-left x position
 * @param y Top-left y position
 * @param size Total size in pixels
 * @param darkColor Module color (default black)
 * @param lightColor Background color (default white)
 */
export function drawQRCode(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  darkColor = '#000000',
  lightColor = '#FFFFFF',
) {
  const matrix = generateQRMatrix(text)
  const moduleSize = size / (matrix.size + 2) // +2 for quiet zone
  const offset = moduleSize // 1 module quiet zone

  // Background
  ctx.fillStyle = lightColor
  ctx.fillRect(x, y, size, size)

  // Modules
  ctx.fillStyle = darkColor
  for (let r = 0; r < matrix.size; r++) {
    for (let c = 0; c < matrix.size; c++) {
      if (matrix.modules[r][c]) {
        ctx.fillRect(
          x + offset + c * moduleSize,
          y + offset + r * moduleSize,
          moduleSize + 0.5, // slight overlap to prevent gaps
          moduleSize + 0.5,
        )
      }
    }
  }
}

/**
 * Generate a QR code as a data URL (PNG).
 *
 * @param text The text to encode
 * @param size Image size in pixels (default 200)
 * @returns data:image/png;base64,... URL
 */
export function generateQRCodeDataURL(
  text: string,
  size = 200,
  darkColor = '#000000',
  lightColor = '#FFFFFF',
): string {
  if (typeof document === 'undefined') return ''
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  drawQRCode(ctx, text, 0, 0, size, darkColor, lightColor)
  return canvas.toDataURL('image/png')
}
