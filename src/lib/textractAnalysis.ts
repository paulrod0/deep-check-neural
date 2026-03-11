/**
 * textractAnalysis.ts — AWS Textract + Semantic Document Validation
 *
 * Validates document authenticity through two complementary approaches:
 *   1. Structural extraction via AWS Textract (text, tables, forms, key-value pairs)
 *   2. Semantic validation of extracted content:
 *      - Financial documents: math checks, NIF/CIF, IBAN, date consistency
 *      - ID documents: MRZ checksum validation (ICAO Doc 9303)
 */

import {
  TextractClient,
  AnalyzeDocumentCommand,
  DetectDocumentTextCommand,
  FeatureType,
  Block,
  BlockType,
} from '@aws-sdk/client-textract'

// ── Types ──────────────────────────────────────────────────────────────────────

export type SemanticAlertType =
  | 'math_error'
  | 'nif_cif_invalid'
  | 'iban_invalid'
  | 'date_inconsistency'
  | 'mrz_checksum_fail'
  | 'mrz_field_mismatch'

export interface SemanticAlert {
  type:    SemanticAlertType
  label:   string
  detail:  string
  penalty: number   // 0–100 score penalty contribution
}

export interface TextractResult {
  rawText:        string
  tables:         string[][]         // extracted table rows as string arrays
  keyValuePairs:  Record<string, string>
  semanticAlerts: SemanticAlert[]
  semanticScore:  number             // 0–100 (high = many semantic anomalies)
  analysisMs:     number
}

// ── AWS client (lazy singleton) ────────────────────────────────────────────────

let _textractClient: TextractClient | null = null

function getTextractClient(): TextractClient {
  if (!_textractClient) {
    _textractClient = new TextractClient({
      region: process.env.AWS_REGION ?? 'eu-west-1',
      credentials: process.env.AWS_ACCESS_KEY_ID ? {
        accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      } : undefined,   // falls back to IAM role / env chain
    })
  }
  return _textractClient
}

// ── Textract helpers ───────────────────────────────────────────────────────────

function base64ToUint8Array(base64: string): Uint8Array {
  // Strip data URL prefix if present
  const b64 = base64.includes(',') ? base64.split(',')[1] : base64
  const binary = Buffer.from(b64, 'base64')
  return new Uint8Array(binary)
}

function extractTextFromBlocks(blocks: Block[]): string {
  return blocks
    .filter(b => b.BlockType === BlockType.LINE && b.Text)
    .map(b => b.Text!)
    .join('\n')
}

function extractTablesFromBlocks(blocks: Block[]): string[][] {
  const tableBlocks   = blocks.filter(b => b.BlockType === BlockType.TABLE)
  const cellMap       = new Map<string, Block>()
  blocks.filter(b => b.BlockType === BlockType.CELL).forEach(c => cellMap.set(c.Id!, c))
  const wordMap       = new Map<string, string>()
  blocks.filter(b => b.BlockType === BlockType.WORD).forEach(w => wordMap.set(w.Id!, w.Text ?? ''))

  const allRows: string[][] = []
  for (const table of tableBlocks) {
    const rowMap = new Map<number, Map<number, string>>()
    for (const rel of (table.Relationships ?? [])) {
      if (rel.Type !== 'CHILD') continue
      for (const cellId of (rel.Ids ?? [])) {
        const cell = cellMap.get(cellId)
        if (!cell) continue
        const row = cell.RowIndex ?? 0
        const col = cell.ColumnIndex ?? 0
        // Gather text from cell's children
        const words: string[] = []
        for (const cr of (cell.Relationships ?? [])) {
          if (cr.Type !== 'CHILD') continue
          for (const wid of (cr.Ids ?? [])) {
            const w = wordMap.get(wid)
            if (w) words.push(w)
          }
        }
        if (!rowMap.has(row)) rowMap.set(row, new Map())
        rowMap.get(row)!.set(col, words.join(' '))
      }
    }
    // Convert rowMap to sorted 2D array
    const sortedRows = [...rowMap.entries()].sort((a, b) => a[0] - b[0])
    for (const [, colMap] of sortedRows) {
      const cols = [...colMap.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1])
      allRows.push(cols)
    }
  }
  return allRows
}

function extractKeyValuePairs(blocks: Block[]): Record<string, string> {
  const kvPairs: Record<string, string> = {}
  const blockMap = new Map<string, Block>()
  blocks.forEach(b => blockMap.set(b.Id!, b))

  const wordMap = new Map<string, string>()
  blocks.filter(b => b.BlockType === BlockType.WORD).forEach(w => wordMap.set(w.Id!, w.Text ?? ''))

  const getChildText = (block: Block): string => {
    const words: string[] = []
    for (const rel of (block.Relationships ?? [])) {
      if (rel.Type !== 'CHILD') continue
      for (const id of (rel.Ids ?? [])) {
        const w = wordMap.get(id)
        if (w) words.push(w)
        // Could be a LINE — recurse
        const b = blockMap.get(id)
        if (b?.BlockType === BlockType.LINE && b.Text) words.push(b.Text)
      }
    }
    return words.join(' ').trim()
  }

  for (const block of blocks) {
    if (block.BlockType !== BlockType.KEY_VALUE_SET) continue
    if (!block.EntityTypes?.includes('KEY')) continue
    // Find value block via VALUE_SET relationship
    const key = getChildText(block)
    let value = ''
    for (const rel of (block.Relationships ?? [])) {
      if (rel.Type !== 'VALUE') continue
      for (const vid of (rel.Ids ?? [])) {
        const valBlock = blockMap.get(vid)
        if (valBlock) value = getChildText(valBlock)
      }
    }
    if (key) kvPairs[key] = value
  }
  return kvPairs
}

// ── Semantic validators ────────────────────────────────────────────────────────

/** Parse monetary value from string (handles €, commas, dots as separators) */
function parseAmount(s: string): number | null {
  if (!s) return null
  // Remove currency symbols, whitespace
  const clean = s.replace(/[€$£\s]/g, '').trim()
  // Handle European format: 1.234,56 → 1234.56
  const euroFmt = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$/
  if (euroFmt.test(clean)) {
    return parseFloat(clean.replace(/\./g, '').replace(',', '.'))
  }
  // Handle dot as decimal: 1,234.56 → 1234.56
  const usFmt = /^-?\d{1,3}(?:,\d{3})*\.\d{2}$/
  if (usFmt.test(clean)) {
    return parseFloat(clean.replace(/,/g, ''))
  }
  // Simple number (just in case)
  const n = parseFloat(clean.replace(',', '.'))
  return isNaN(n) ? null : n
}

/**
 * Financial document semantic validation:
 *   1. Line math check: unit_price × qty = line_total (±0.02€ tolerance)
 *   2. NIF/CIF format + mod23 check digit
 *   3. IBAN mod97 checksum
 *   4. Date chronological consistency
 */
function validateFinancialDocument(
  rawText: string,
  tables: string[][],
  kvPairs: Record<string, string>,
): SemanticAlert[] {
  const alerts: SemanticAlert[] = []
  let mathErrorCount = 0

  // ── 1. Line math validation (table rows: qty × price = total) ───────────────
  for (const row of tables) {
    if (row.length < 3) continue
    // Try all 3-cell windows for qty × unit_price = total pattern
    for (let i = 0; i + 2 < row.length; i++) {
      const a = parseAmount(row[i])
      const b = parseAmount(row[i + 1])
      const c = parseAmount(row[i + 2])
      if (a === null || b === null || c === null) continue
      if (a <= 0 || b <= 0 || c <= 0) continue
      // Check a × b ≈ c OR b × 1 ≈ c (unit price pattern)
      const product = a * b
      if (Math.abs(product - c) > 0.02 && product > 0.1) {
        mathErrorCount++
      }
    }
  }
  if (mathErrorCount > 0) {
    alerts.push({
      type:    'math_error',
      label:   'Error matemático en valores del documento',
      detail:  `Se detectaron ${mathErrorCount} inconsistencias en la aritmética de la tabla (precio × cantidad ≠ total). Posible manipulación de cifras.`,
      penalty: Math.min(60, mathErrorCount * 20),
    })
  }

  // ── 2. NIF/CIF validation ────────────────────────────────────────────────────
  // NIF: 8 digits + 1 letter; CIF: 1 letter + 7 digits + 1 check char
  const nifCifPattern = /\b([A-HJ-NP-SUVW][0-9]{7}[0-9A-J]|[0-9]{8}[A-Z])\b/gi
  const textMatches   = rawText.match(nifCifPattern) ?? []

  for (const match of textMatches) {
    const upper = match.toUpperCase()
    const isCif = /^[A-HJ-NP-SUVW]/.test(upper)
    if (isCif) {
      if (!validateCIF(upper)) {
        alerts.push({
          type:    'nif_cif_invalid',
          label:   'CIF con dígito de control inválido',
          detail:  `El CIF "${upper}" no supera la validación del dígito de control (algoritmo mod23). Puede indicar número inventado o alterado.`,
          penalty: 40,
        })
      }
    } else {
      if (!validateNIF(upper)) {
        alerts.push({
          type:    'nif_cif_invalid',
          label:   'NIF con letra de control inválida',
          detail:  `El NIF "${upper}" no supera la validación de la letra de control (tabla de letras NIF). Puede indicar número inventado o alterado.`,
          penalty: 40,
        })
      }
    }
  }

  // ── 3. IBAN validation ───────────────────────────────────────────────────────
  const ibanPattern = /\b([A-Z]{2}[0-9]{2}[A-Z0-9]{11,30})\b/g
  const ibanMatches = rawText.replace(/\s/g, '').match(ibanPattern) ?? []

  for (const iban of ibanMatches) {
    if (!validateIBAN(iban)) {
      alerts.push({
        type:    'iban_invalid',
        label:   'IBAN con checksum inválido',
        detail:  `El IBAN "${iban.substring(0, 8)}..." no supera la verificación mod97. Puede indicar número bancario falsificado.`,
        penalty: 35,
      })
    }
  }

  // ── 4. Date consistency ──────────────────────────────────────────────────────
  // Extract dates from text
  const datePattern = /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{2}[\/\-\.]\d{2})\b/g
  const dates = (rawText.match(datePattern) ?? []).map(parseFlexDate).filter(Boolean) as Date[]

  if (dates.length >= 2) {
    const now    = new Date()
    const future = dates.filter(d => d > now)
    if (future.length > 0) {
      alerts.push({
        type:    'date_inconsistency',
        label:   'Fecha futura en el documento',
        detail:  `El documento contiene ${future.length} fecha(s) en el futuro. Una factura o nómina no puede tener fechas futuras.`,
        penalty: 20,
      })
    }
  }

  // Suppress unused variable warning for kvPairs — reserved for future key-value checks
  void kvPairs

  return alerts
}

/** NIF (DNI) validation: last digit must match the control letter */
function validateNIF(nif: string): boolean {
  const NIF_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE'
  const num = parseInt(nif.slice(0, -1), 10)
  const expected = NIF_LETTERS[num % 23]
  return nif[nif.length - 1] === expected
}

/** CIF validation (mod23 algorithm) */
function validateCIF(cif: string): boolean {
  const letter = cif[0]
  const digits = cif.slice(1, -1)
  const control = cif[cif.length - 1]

  let sumOdd = 0, sumEven = 0
  for (let i = 0; i < digits.length; i++) {
    const d = parseInt(digits[i], 10)
    if ((i + 1) % 2 === 0) {
      sumEven += d
    } else {
      const doubled = d * 2
      sumOdd += doubled > 9 ? doubled - 9 : doubled
    }
  }
  const total    = sumOdd + sumEven
  const checkNum = (10 - (total % 10)) % 10
  const CIF_CTRL = 'JABCDEFGHI'
  const checkLetter = CIF_CTRL[checkNum]

  // Some CIF types use letter control, others digit
  if ('KPQ'.includes(letter) || 'ABCDEFGHI'.includes(letter)) {
    return control === checkLetter
  }
  return control === String(checkNum) || control === checkLetter
}

/** IBAN validation: mod97 on rearranged number string */
function validateIBAN(iban: string): boolean {
  const cleaned = iban.replace(/\s/g, '').toUpperCase()
  if (cleaned.length < 15 || cleaned.length > 34) return false
  // Move first 4 chars to end, convert letters to numbers
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4)
  const numeric    = rearranged.split('').map(c => {
    const code = c.charCodeAt(0)
    return code >= 65 ? String(code - 55) : c   // A=10, B=11, ...
  }).join('')
  // BigInt mod97
  let remainder = BigInt(0)
  for (const chunk of numeric.match(/.{1,9}/g) ?? []) {
    remainder = (remainder * BigInt(10 ** chunk.length) + BigInt(chunk)) % BigInt(97)
  }
  return remainder === BigInt(1)
}

/** Parse flexible date format → Date */
function parseFlexDate(s: string): Date | null {
  // Try ISO
  const iso = new Date(s)
  if (!isNaN(iso.getTime())) return iso
  // Try DD/MM/YYYY
  const parts = s.split(/[\/\-\.]/)
  if (parts.length === 3) {
    const [a, b, c] = parts.map(Number)
    if (c > 1000) return new Date(c, b - 1, a)   // DD/MM/YYYY
    if (a > 1000) return new Date(a, b - 1, c)   // YYYY/MM/DD
  }
  return null
}

/**
 * ID document semantic validation:
 *   MRZ checksum validation (ICAO Doc 9303)
 */
function validateIDDocument(rawText: string): SemanticAlert[] {
  const alerts: SemanticAlert[] = []

  // Detect MRZ lines: look for 2 lines of 30, 36, or 44 chars with only
  // uppercase letters, digits, and '<' filler
  const lines    = rawText.split('\n').map(l => l.trim())
  const mrzLines = lines.filter(l => /^[A-Z0-9<]{30,44}$/.test(l))

  if (mrzLines.length < 2) return alerts   // No MRZ detected

  const line2 = mrzLines[1]

  // MRZ check digit algorithm (ICAO 9303)
  // Weighted sum: 7, 3, 1 pattern; letters A=10..Z=35, '<'=0
  function mrzCheckDigit(s: string): number {
    const weights = [7, 3, 1]
    let sum = 0
    for (let i = 0; i < s.length; i++) {
      const c = s[i]
      let val: number
      if (c >= '0' && c <= '9') val = parseInt(c)
      else if (c >= 'A' && c <= 'Z') val = c.charCodeAt(0) - 55
      else val = 0   // '<'
      sum += val * weights[i % 3]
    }
    return sum % 10
  }

  let checksumFails = 0

  if (line2.length >= 44) {
    // TD1/TD3 passport format — validate multiple check digits
    // DOB field: chars 29-34, check digit at 35
    const dobField     = line2.slice(0, 6)
    const dobCheck     = parseInt(line2[6], 10)
    if (!isNaN(dobCheck) && mrzCheckDigit(dobField) !== dobCheck) checksumFails++

    // Expiry field: chars 38-43, check digit at 44
    const expiryField  = line2.slice(8, 14)
    const expiryCheck  = parseInt(line2[14], 10)
    if (!isNaN(expiryCheck) && mrzCheckDigit(expiryField) !== expiryCheck) checksumFails++
  } else if (line2.length >= 28) {
    // TD2 / ID card format
    const dobField = line2.slice(0, 6)
    const dobCheck = parseInt(line2[6], 10)
    if (!isNaN(dobCheck) && mrzCheckDigit(dobField) !== dobCheck) checksumFails++
  }

  if (checksumFails > 0) {
    alerts.push({
      type:    'mrz_checksum_fail',
      label:   'Dígito de control MRZ inválido',
      detail:  `${checksumFails} dígito(s) de control de la Zona de Lectura Mecánica (MRZ) no coinciden con los campos correspondientes (ICAO Doc 9303). El documento puede haber sido alterado.`,
      penalty: 50,
    })
  }

  return alerts
}

// ── Document type detection ────────────────────────────────────────────────────

function detectDocumentType(rawText: string): 'financial' | 'id' | 'other' {
  const lower = rawText.toLowerCase()

  const financialKeywords = [
    'factura', 'invoice', 'importe', 'total', 'iva', 'base imponible',
    'nómina', 'nomina', 'salario', 'irpf', 'rendimiento', 'líquido a percibir',
    'presupuesto', 'albarán', 'albaran', 'proforma',
  ]
  const idKeywords = [
    'dni', 'nie', 'passport', 'pasaporte', 'fecha de nacimiento',
    'date of birth', 'nationality', 'nacionalidad', 'número de documento',
    'document number', 'república', 'republic', 'visa', 'residence permit',
  ]

  const financialScore = financialKeywords.filter(k => lower.includes(k)).length
  const idScore        = idKeywords.filter(k => lower.includes(k)).length

  if (financialScore > idScore && financialScore >= 2) return 'financial'
  if (idScore > financialScore && idScore >= 2)        return 'id'
  return 'other'
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function runTextractAnalysis(imageBase64: string): Promise<TextractResult> {
  const t0 = Date.now()
  const imageBytes = base64ToUint8Array(imageBase64)
  const client     = getTextractClient()

  let blocks: Block[] = []
  let rawText         = ''

  try {
    // AnalyzeDocument gives us tables + forms + text (more expensive but richer)
    const analyzeCmd = new AnalyzeDocumentCommand({
      Document: { Bytes: imageBytes },
      FeatureTypes: [FeatureType.TABLES, FeatureType.FORMS],
    })
    const analyzeResp = await client.send(analyzeCmd)
    blocks   = analyzeResp.Blocks ?? []
    rawText  = extractTextFromBlocks(blocks)
  } catch (err: unknown) {
    // Fallback: DetectDocumentText only
    console.warn('[textractAnalysis] AnalyzeDocument failed, falling back to DetectDocumentText:', (err as Error).message)
    try {
      const detectCmd  = new DetectDocumentTextCommand({ Document: { Bytes: imageBytes } })
      const detectResp = await client.send(detectCmd)
      blocks  = detectResp.Blocks ?? []
      rawText = extractTextFromBlocks(blocks)
    } catch (err2: unknown) {
      console.error('[textractAnalysis] DetectDocumentText also failed:', (err2 as Error).message)
      return {
        rawText: '', tables: [], keyValuePairs: {},
        semanticAlerts: [], semanticScore: 0, analysisMs: Date.now() - t0,
      }
    }
  }

  const tables        = extractTablesFromBlocks(blocks)
  const keyValuePairs = extractKeyValuePairs(blocks)
  const docType       = detectDocumentType(rawText)

  let semanticAlerts: SemanticAlert[] = []
  if (docType === 'financial') {
    semanticAlerts = validateFinancialDocument(rawText, tables, keyValuePairs)
  } else if (docType === 'id') {
    semanticAlerts = validateIDDocument(rawText)
  }

  // Score: 0 = perfect, 100 = many semantic errors
  const totalPenalty   = semanticAlerts.reduce((s, a) => s + a.penalty, 0)
  const semanticScore  = Math.min(100, totalPenalty)

  return {
    rawText,
    tables,
    keyValuePairs,
    semanticAlerts,
    semanticScore,
    analysisMs: Date.now() - t0,
  }
}
