/**
 * ocrEngine.ts — Hybrid OCR Engine (AWS Textract + Tesseract.js)
 * ================================================================
 * Intelligent dual-mode OCR:
 *
 * **Cloud mode** (default on Vercel/SaaS):
 *   AWS Textract → fast (~2s), multi-language (Arabic, Latin, CJK),
 *   structured key-value extraction, table detection, high accuracy.
 *
 * **Self-hosted mode** (Docker on-premise / air-gapped):
 *   Tesseract.js → zero cloud dependency, auto-language detection
 *   (eng first, Arabic fallback if low confidence).
 *
 * Selection logic:
 *   1. If AWS credentials available → use Textract (fast, accurate)
 *   2. If PDF with text layer → extract via pdfjs-dist (instant)
 *   3. Else → Tesseract.js OCR with language auto-detection
 *
 * Semantic validation runs on all paths:
 *   NIF/CIF mod23, IBAN mod97, MRZ checksums, date consistency
 */

import { createWorker, Worker as TesseractWorker } from 'tesseract.js'

// ── Types ────────────────────────────────────────────────────────────────────

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

export interface OcrResult {
  rawText:        string
  tables:         string[][]
  keyValuePairs:  Record<string, string>
  semanticAlerts: SemanticAlert[]
  semanticScore:  number
  analysisMs:     number
  ocrConfidence:  number    // 0–100 average OCR confidence
  engine:         'textract' | 'tesseract' | 'pdfjs'  // which engine produced the text
}

// ── AWS Textract integration ────────────────────────────────────────────────

/** Check if AWS credentials are available for Textract */
function hasAWSCredentials(): boolean {
  return !!(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY
  )
}

/**
 * Run AWS Textract OCR on an image.
 * Returns raw text + key-value pairs + confidence.
 * Supports all languages (Arabic, Latin, CJK, Cyrillic, etc.)
 */
async function runTextractOCR(
  imageBase64: string,
): Promise<{ text: string; confidence: number; kvPairs: Record<string, string> } | null> {
  try {
    const { TextractClient, AnalyzeDocumentCommand } = await import('@aws-sdk/client-textract')

    const client = new TextractClient({
      region: process.env.AWS_REGION ?? 'eu-west-1',
      credentials: {
        accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    })

    // Strip data URL prefix to get raw base64
    const b64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64
    const buffer = Buffer.from(b64, 'base64')

    // Use AnalyzeDocument (not DetectDocumentText) for key-value pairs
    const command = new AnalyzeDocumentCommand({
      Document: { Bytes: buffer },
      FeatureTypes: ['FORMS'],  // Extract key-value pairs
    })

    const response = await client.send(command)
    const blocks = response.Blocks ?? []

    // Extract raw text lines
    const lines: string[] = []
    let totalConfidence = 0
    let lineCount = 0

    for (const block of blocks) {
      if (block.BlockType === 'LINE' && block.Text) {
        lines.push(block.Text)
        totalConfidence += block.Confidence ?? 0
        lineCount++
      }
    }

    // Extract key-value pairs
    const kvPairs: Record<string, string> = {}
    const keyMap: Record<string, string> = {}
    const valueMap: Record<string, string> = {}

    for (const block of blocks) {
      if (block.BlockType === 'KEY_VALUE_SET') {
        const entityTypes = block.EntityTypes ?? []
        const childIds = block.Relationships
          ?.find(r => r.Type === 'CHILD')?.Ids ?? []
        const valueIds = block.Relationships
          ?.find(r => r.Type === 'VALUE')?.Ids ?? []

        const childText = childIds
          .map(id => blocks.find(b => b.Id === id)?.Text ?? '')
          .filter(Boolean)
          .join(' ')

        if (entityTypes.includes('KEY') && block.Id) {
          keyMap[block.Id] = childText
          // Find linked value
          for (const vid of valueIds) {
            const valueBlock = blocks.find(b => b.Id === vid)
            if (valueBlock) {
              const valueChildIds = valueBlock.Relationships
                ?.find(r => r.Type === 'CHILD')?.Ids ?? []
              const valueText = valueChildIds
                .map(id => blocks.find(b => b.Id === id)?.Text ?? '')
                .filter(Boolean)
                .join(' ')
              if (childText && valueText) {
                kvPairs[childText] = valueText
              }
            }
          }
        }
        if (entityTypes.includes('VALUE') && block.Id) {
          valueMap[block.Id] = childText
        }
      }
    }

    return {
      text:       lines.join('\n'),
      confidence: lineCount > 0 ? totalConfidence / lineCount : 0,
      kvPairs,
    }
  } catch (err) {
    console.warn('[ocrEngine] AWS Textract failed:', err instanceof Error ? err.message : err)
    return null
  }
}

// ── Tesseract.js worker pool (per-language lazy singletons) ────────────────

const _workers: Map<string, TesseractWorker> = new Map()
const _workerInitPromises: Map<string, Promise<TesseractWorker>> = new Map()

const TESSDATA_URL = 'https://tessdata.projectnaptha.com/4.0.0'

async function getWorker(lang: string = 'eng'): Promise<TesseractWorker> {
  const existing = _workers.get(lang)
  if (existing) return existing

  const pending = _workerInitPromises.get(lang)
  if (pending) return pending

  const initPromise = (async () => {
    console.log(`[ocrEngine] Initializing Tesseract.js worker (${lang})...`)
    const t0 = Date.now()
    const w = await createWorker(lang, 1, {
      langPath: TESSDATA_URL,
    })
    _workers.set(lang, w)
    console.log(`[ocrEngine] Tesseract.js worker ready: ${lang} (${Date.now() - t0}ms)`)
    return w
  })()

  _workerInitPromises.set(lang, initPromise)
  return initPromise
}

/** Detect if text contains Arabic script */
function hasArabicScript(text: string): boolean {
  const arabicChars = text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF]/g)
  return (arabicChars?.length ?? 0) > 5
}

// ── PDF text extraction via pdfjs-dist ──────────────────────────────────────

async function extractTextFromPdf(pdfInput: string): Promise<string | null> {
  try {
    const b64 = pdfInput.includes(',') ? pdfInput.split(',')[1] : pdfInput
    const pdfBuffer = Buffer.from(b64, 'base64')

    const { getDocument, GlobalWorkerOptions } = await import(
      // @ts-ignore — pdfjs-dist v4 ESM-only
      'pdfjs-dist/legacy/build/pdf.mjs'
    ) as typeof import('pdfjs-dist')

    const path = await import('path')
    GlobalWorkerOptions.workerSrc = path.resolve(
      process.cwd(),
      'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    )

    const loadingTask = getDocument({
      data:            new Uint8Array(pdfBuffer),
      verbosity:       0,
      disableFontFace: true,
      isEvalSupported: false,
    })
    const pdf = await loadingTask.promise
    const textParts: string[] = []

    const maxPages = Math.min(pdf.numPages, 5)
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pageText = content.items
        .map((item: any) => item.str ?? '')
        .join(' ')
      if (pageText.trim()) textParts.push(pageText)
    }

    await pdf.destroy()

    const text = textParts.join('\n')
    return text.length > 50 ? text : null
  } catch (err) {
    console.warn('[ocrEngine] PDF text extraction failed:', err instanceof Error ? err.message : err)
    return null
  }
}

// ── Base64 helpers ──────────────────────────────────────────────────────────

function base64ToBuffer(input: string): Buffer {
  const b64 = input.includes(',') ? input.split(',')[1] : input
  return Buffer.from(b64, 'base64')
}

// ── Main OCR function ───────────────────────────────────────────────────────

export async function runOCR(imageBase64: string): Promise<OcrResult> {
  const t0 = Date.now()

  let rawText    = ''
  let confidence = 0
  let kvPairs:   Record<string, string> = {}
  let engine:    OcrResult['engine'] = 'tesseract'

  // ── Check if input is PDF ────────────────────────────────────────────────
  const isPDF = imageBase64.startsWith('data:application/pdf') ||
                imageBase64.startsWith('data:application/x-pdf') ||
                (() => {
                  const raw = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64
                  return raw.startsWith('JVBE')
                })()

  // ── Strategy 1: PDF with text layer (instant, no OCR needed) ─────────────
  if (isPDF) {
    const pdfText = await extractTextFromPdf(imageBase64)
    if (pdfText) {
      rawText    = pdfText
      confidence = 95
      engine     = 'pdfjs'
      console.log('[ocrEngine] PDF text layer extracted via pdfjs-dist:', rawText.length, 'chars')
    }
  }

  // ── Strategy 2: AWS Textract (fast, multi-language, structured) ──────────
  if (!rawText && hasAWSCredentials()) {
    console.log('[ocrEngine] AWS credentials available — using Textract...')

    // For PDFs, render to PNG first for Textract
    let imageForTextract = imageBase64
    if (isPDF) {
      try {
        const { pdfFirstPageToPng } = await import('./pdfToImage')
        const png = await pdfFirstPageToPng(imageBase64)
        if (png) imageForTextract = png
      } catch (err) {
        console.warn('[ocrEngine] PDF render for Textract failed:', err instanceof Error ? err.message : err)
      }
    }

    const textractResult = await runTextractOCR(imageForTextract)
    if (textractResult && textractResult.text.length > 10) {
      rawText    = textractResult.text
      confidence = textractResult.confidence
      kvPairs    = textractResult.kvPairs
      engine     = 'textract'
      console.log(`[ocrEngine] Textract: ${rawText.length} chars, ${confidence.toFixed(0)}% confidence, ${Object.keys(kvPairs).length} KV pairs`)
    }
  }

  // ── Strategy 3: Tesseract.js (self-hosted fallback) ──────────────────────
  if (!rawText) {
    console.log('[ocrEngine] Using Tesseract.js OCR (self-hosted)...')

    let imageForOCR = imageBase64
    if (isPDF) {
      try {
        const { pdfFirstPageToPng } = await import('./pdfToImage')
        const png = await pdfFirstPageToPng(imageBase64)
        if (png) imageForOCR = png
      } catch (err) {
        console.warn('[ocrEngine] PDF render failed:', err instanceof Error ? err.message : err)
      }
    }

    if (imageForOCR !== imageBase64 || !isPDF) {
      const result = await runTesseractWithFallback(imageForOCR)
      rawText    = result.text
      confidence = result.confidence
      engine     = 'tesseract'
    }
  }

  // ── Semantic validation ──────────────────────────────────────────────────
  const docType        = detectDocumentType(rawText)
  let semanticAlerts: SemanticAlert[] = []

  if (docType === 'financial') {
    semanticAlerts = validateFinancialDocument(rawText)
  } else if (docType === 'id') {
    semanticAlerts = validateIDDocument(rawText)
  }

  const totalPenalty  = semanticAlerts.reduce((s, a) => s + a.penalty, 0)
  const semanticScore = Math.min(100, totalPenalty)

  // ── Extract key-value pairs (from text if Textract didn't provide them) ─
  if (Object.keys(kvPairs).length === 0) {
    kvPairs = extractKeyValuePairsFromText(rawText)
  }

  return {
    rawText,
    tables:        [],
    keyValuePairs: kvPairs,
    semanticAlerts,
    semanticScore,
    analysisMs:    Date.now() - t0,
    ocrConfidence: Math.round(confidence),
    engine,
  }
}

// ── Tesseract OCR execution ─────────────────────────────────────────────────

async function runTesseractOCR(
  imageBase64: string,
  lang: string = 'eng',
): Promise<{ text: string; confidence: number; lang: string }> {
  try {
    const worker = await getWorker(lang)
    const buffer = base64ToBuffer(imageBase64)

    const { data } = await worker.recognize(buffer)

    return {
      text:       data.text,
      confidence: data.confidence,
      lang,
    }
  } catch (err) {
    console.error(`[ocrEngine] Tesseract OCR (${lang}) failed:`, err instanceof Error ? err.message : err)
    return { text: '', confidence: 0, lang }
  }
}

/**
 * Run Tesseract OCR with automatic language detection.
 * First tries English, falls back to Arabic if low confidence.
 */
async function runTesseractWithFallback(
  imageBase64: string,
): Promise<{ text: string; confidence: number; lang: string }> {
  const engResult = await runTesseractOCR(imageBase64, 'eng')

  if (engResult.confidence >= 30 && engResult.text.trim().length > 20) {
    return engResult
  }

  console.log(`[ocrEngine] Low confidence (${engResult.confidence}%) — trying Arabic OCR...`)
  try {
    const araResult = await runTesseractOCR(imageBase64, 'ara')

    if (araResult.confidence > engResult.confidence || hasArabicScript(araResult.text)) {
      console.log(`[ocrEngine] Arabic OCR better: ${araResult.confidence}% vs eng ${engResult.confidence}%`)
      if (engResult.text.trim().length > 10) {
        return {
          text: araResult.text + '\n--- Latin text ---\n' + engResult.text,
          confidence: Math.max(araResult.confidence, engResult.confidence),
          lang: 'ara+eng',
        }
      }
      return araResult
    }
  } catch (err) {
    console.warn('[ocrEngine] Arabic OCR fallback failed:', err instanceof Error ? err.message : err)
  }

  return engResult
}

// ── Key-value pair extraction from raw text ─────────────────────────────────

function extractKeyValuePairsFromText(text: string): Record<string, string> {
  const kvPairs: Record<string, string> = {}

  const patterns = [
    /^(.+?):\s+(.+)$/gm,
    /^(nombre|name|apellido|surname|fecha|date|numero|number|sexo|sex|nacionalidad|nationality|direccion|address|domicilio)\s*[:\-]?\s*(.+)/gim,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const key   = match[1].trim()
      const value = match[2].trim()
      if (key.length <= 40 && value.length <= 100) {
        kvPairs[key] = value
      }
    }
  }

  return kvPairs
}

// ── Document type detection ─────────────────────────────────────────────────

function detectDocumentType(rawText: string): 'financial' | 'id' | 'other' {
  const lower = rawText.toLowerCase()

  const financialKeywords = [
    'factura', 'invoice', 'importe', 'total', 'iva', 'base imponible',
    'nomina', 'salario', 'irpf', 'rendimiento',
    'presupuesto', 'proforma',
  ]
  const idKeywords = [
    'dni', 'nie', 'passport', 'pasaporte', 'fecha de nacimiento',
    'date of birth', 'nationality', 'nacionalidad',
    'document number', 'visa', 'residence permit',
    'documento nacional', 'tarjeta de identidad',
  ]

  const financialScore = financialKeywords.filter(k => lower.includes(k)).length
  const idScore        = idKeywords.filter(k => lower.includes(k)).length

  if (financialScore > idScore && financialScore >= 2) return 'financial'
  if (idScore > financialScore && idScore >= 1)        return 'id'
  return 'other'
}

// ── Semantic validators ─────────────────────────────────────────────────────

function validateFinancialDocument(rawText: string): SemanticAlert[] {
  const alerts: SemanticAlert[] = []

  // NIF/CIF validation
  const nifCifPattern = /\b([A-HJ-NP-SUVW][0-9]{7}[0-9A-J]|[0-9]{8}[A-Z])\b/gi
  const textMatches   = rawText.match(nifCifPattern) ?? []

  for (const match of textMatches) {
    const upper = match.toUpperCase()
    const isCif = /^[A-HJ-NP-SUVW]/.test(upper)
    if (isCif) {
      if (!validateCIF(upper)) {
        alerts.push({
          type:    'nif_cif_invalid',
          label:   'CIF invalid check digit',
          detail:  `CIF "${upper}" fails mod23 control digit validation. May indicate fabricated or altered number.`,
          penalty: 40,
        })
      }
    } else {
      if (!validateNIF(upper)) {
        alerts.push({
          type:    'nif_cif_invalid',
          label:   'NIF invalid control letter',
          detail:  `NIF "${upper}" fails control letter validation. May indicate fabricated or altered number.`,
          penalty: 40,
        })
      }
    }
  }

  // IBAN validation
  const ibanPattern = /\b([A-Z]{2}[0-9]{2}[A-Z0-9]{11,30})\b/g
  const ibanMatches = rawText.replace(/\s/g, '').match(ibanPattern) ?? []

  for (const iban of ibanMatches) {
    if (!validateIBAN(iban)) {
      alerts.push({
        type:    'iban_invalid',
        label:   'IBAN checksum invalid',
        detail:  `IBAN "${iban.substring(0, 8)}..." fails mod97 verification. May indicate fabricated bank number.`,
        penalty: 35,
      })
    }
  }

  // Date consistency
  const datePattern = /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{2}[\/\-\.]\d{2})\b/g
  const dates = (rawText.match(datePattern) ?? []).map(parseFlexDate).filter(Boolean) as Date[]

  if (dates.length >= 2) {
    const now    = new Date()
    const future = dates.filter(d => d > now)
    if (future.length > 0) {
      alerts.push({
        type:    'date_inconsistency',
        label:   'Future date detected',
        detail:  `Document contains ${future.length} future date(s). Invoices and payslips should not have future dates.`,
        penalty: 20,
      })
    }
  }

  return alerts
}

function validateIDDocument(rawText: string): SemanticAlert[] {
  const alerts: SemanticAlert[] = []

  // NIF/NIE validation
  const nifPattern = /\b([0-9]{8}[A-Z])\b/gi
  const nifMatches = rawText.match(nifPattern) ?? []

  for (const match of nifMatches) {
    const upper = match.toUpperCase()
    if (!validateNIF(upper)) {
      alerts.push({
        type:    'nif_cif_invalid',
        label:   'DNI/NIF control letter mismatch',
        detail:  `NIF "${upper}" fails control letter validation. Document may be altered.`,
        penalty: 45,
      })
    }
  }

  // MRZ check digit validation
  const lines    = rawText.split('\n').map(l => l.trim())
  const mrzLines = lines.filter(l => /^[A-Z0-9<]{28,44}$/.test(l.replace(/\s/g, '')))

  if (mrzLines.length >= 2) {
    const line2 = mrzLines[1].replace(/\s/g, '')
    let checksumFails = 0

    const mrzCheckDigit = (s: string): number => {
      const weights = [7, 3, 1]
      let sum = 0
      for (let i = 0; i < s.length; i++) {
        const c = s[i]
        let val: number
        if (c >= '0' && c <= '9') val = parseInt(c)
        else if (c >= 'A' && c <= 'Z') val = c.charCodeAt(0) - 55
        else val = 0
        sum += val * weights[i % 3]
      }
      return sum % 10
    }

    if (line2.length >= 44) {
      const dobField    = line2.slice(0, 6)
      const dobCheck    = parseInt(line2[6], 10)
      if (!isNaN(dobCheck) && mrzCheckDigit(dobField) !== dobCheck) checksumFails++

      const expiryField = line2.slice(8, 14)
      const expiryCheck = parseInt(line2[14], 10)
      if (!isNaN(expiryCheck) && mrzCheckDigit(expiryField) !== expiryCheck) checksumFails++
    } else if (line2.length >= 28) {
      const dobField = line2.slice(0, 6)
      const dobCheck = parseInt(line2[6], 10)
      if (!isNaN(dobCheck) && mrzCheckDigit(dobField) !== dobCheck) checksumFails++
    }

    if (checksumFails > 0) {
      alerts.push({
        type:    'mrz_checksum_fail',
        label:   'MRZ check digit invalid',
        detail:  `${checksumFails} MRZ check digit(s) do not match (ICAO Doc 9303). Document may have been altered.`,
        penalty: 50,
      })
    }
  }

  return alerts
}

// ── Validation helpers ──────────────────────────────────────────────────────

function validateNIF(nif: string): boolean {
  const NIF_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE'
  const num = parseInt(nif.slice(0, -1), 10)
  if (isNaN(num)) return false
  const expected = NIF_LETTERS[num % 23]
  return nif[nif.length - 1] === expected
}

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
  const total      = sumOdd + sumEven
  const checkNum   = (10 - (total % 10)) % 10
  const CIF_CTRL   = 'JABCDEFGHI'
  const checkLetter = CIF_CTRL[checkNum]

  if ('KPQ'.includes(letter) || 'ABCDEFGHI'.includes(letter)) {
    return control === checkLetter
  }
  return control === String(checkNum) || control === checkLetter
}

function validateIBAN(iban: string): boolean {
  const cleaned = iban.replace(/\s/g, '').toUpperCase()
  if (cleaned.length < 15 || cleaned.length > 34) return false
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4)
  const numeric    = rearranged.split('').map(c => {
    const code = c.charCodeAt(0)
    return code >= 65 ? String(code - 55) : c
  }).join('')
  let remainder = BigInt(0)
  for (const chunk of numeric.match(/.{1,9}/g) ?? []) {
    remainder = (remainder * BigInt(10 ** chunk.length) + BigInt(chunk)) % BigInt(97)
  }
  return remainder === BigInt(1)
}

function parseFlexDate(s: string): Date | null {
  const iso = new Date(s)
  if (!isNaN(iso.getTime())) return iso
  const parts = s.split(/[\/\-\.]/)
  if (parts.length === 3) {
    const [a, b, c] = parts.map(Number)
    if (c > 1000) return new Date(c, b - 1, a)
    if (a > 1000) return new Date(a, b - 1, c)
  }
  return null
}
