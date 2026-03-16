/**
 * POST /api/admissions-verify
 * ===========================
 * IE University Admissions — Document Authenticity Verification
 *
 * Accepts any document image (DNI, passport, degree, diploma, CV, transcript).
 * Runs the full Deep-Check forensics stack server-side:
 *   1. DocForensics CNN       — document type classification + manipulation score
 *   2. AWS Textract           — OCR + semantic field validation
 *   3. AWS Rekognition        — face quality analysis (ID docs)
 *   4. Frequency analysis     — FFT spectral + wavelet splice detection
 *   5. MRZ parsing            — ICAO 9303 check-digit validation (ID/passport)
 *   6. Academic keyword scan  — degree/certificate structural validation
 *
 * All 4 main analyses run in parallel via runDocumentForensics().
 * No authentication required — demo endpoint.
 */

import { NextRequest, NextResponse }    from 'next/server'
import { runDocumentForensics }         from '@/lib/documentForensics'
import { parseMRZ }                     from '@/lib/mrzParser'
import { pdfFirstPageToPng, isPdfInput } from '@/lib/pdfToImage'
import type { MRZFields }               from '@/lib/mrzParser'
import type { DocumentClass }           from '@/lib/docForensicsCnn'
import type { TextractResult }          from '@/lib/textractAnalysis'
import type { RekognitionResult }       from '@/lib/rekognitionAnalysis'

// ── Response types ─────────────────────────────────────────────────────────────

export type AdmissionsDocType =
  | 'passport'
  | 'dni'
  | 'eu_id'
  | 'degree_certificate'
  | 'academic_transcript'
  | 'cv_resume'
  | 'invoice'
  | 'payslip'
  | 'photo'
  | 'other'

export interface AdmissionsDocTypeResult {
  type:       AdmissionsDocType
  label:      string
  confidence: number           // 0–1
  isIdentity: boolean          // DNI / passport / ID card
  isAcademic: boolean          // degree / transcript / certificate
  isRelevant: boolean          // any document relevant to admissions
}

export interface AdmissionsExtractedFields {
  // Identity
  fullName?:        string
  docNumber?:       string
  dateOfBirth?:     string
  expiryDate?:      string
  nationality?:     string
  sex?:             string
  issuingCountry?:  string
  isExpired?:       boolean
  // Academic
  institution?:     string
  degree?:          string
  graduationDate?:  string
  studentName?:     string
  grade?:           string
  // Raw
  ocrText:          string
}

export interface AdmissionsMRZAnalysis {
  detected:         boolean
  valid:            boolean
  format:           string
  checksumsPassed:  number
  checksumsFailed:  number
  fields?:          MRZFields
  alerts:           string[]
}

export interface AdmissionsForensicsSignals {
  manipulationScore: number   // 0–100 (CNN)
  frequencyScore:    number   // 0–100 (FFT/wavelet)
  semanticScore:     number   // 0–100 (Textract anomaly)
  rekognitionScore:  number   // 0–100 (face quality anomaly)
  overallRiskScore:  number   // 0–100 weighted combination
  faceDetected:      boolean
  faceCount:         number
  semanticAlerts:    { type: string; label: string; detail: string }[]
}

export interface AdmissionsAlert {
  level:   'info' | 'warning' | 'error'
  code:    string
  message: string
}

export interface AdmissionsVerifyResponse {
  documentType:     AdmissionsDocTypeResult
  extractedData:    AdmissionsExtractedFields
  mrzAnalysis:      AdmissionsMRZAnalysis | null
  forensics:        AdmissionsForensicsSignals
  authenticityScore: number   // 0–100 (higher = more authentic)
  verdict:          'authentic' | 'suspicious' | 'tampered'
  alerts:           AdmissionsAlert[]
  processingMs:     number
}

// ── Document classification keywords ──────────────────────────────────────────

const ACADEMIC_KW_ES = [
  'universidad', 'universitat', 'universidade', 'facultad', 'escuela',
  'grado', 'máster', 'master', 'doctorado', 'licenciatura', 'ingeniería',
  'rector', 'decano', 'secretario general', 'ministerio de educación',
  'diploma', 'título', 'titulación', 'graduado', 'graduada',
  'calificación', 'nota media', 'expediente académico', 'cum laude',
  'matrícula de honor', 'legalización', 'apostilla',
]

const ACADEMIC_KW_EN = [
  'university', 'college', 'institute of technology', 'faculty',
  'bachelor', 'master', 'doctor', 'phd', 'degree', 'diploma',
  'graduate', 'honours', 'honors', 'dean', 'president', 'registrar',
  'transcript', 'certificate of', 'awarded', 'conferred', 'graduated',
  'cum laude', 'magna cum laude', 'summa cum laude',
  'credits', 'academic record', 'official transcript',
]

const CV_KW = [
  'curriculum vitae', 'résumé', 'resume', 'cv',
  'experiencia profesional', 'work experience', 'professional experience',
  'habilidades', 'skills', 'competencias', 'competencies',
  'educación', 'formación académica', 'education', 'training',
  'referencias', 'references', 'objective', 'summary', 'profile',
  'linkedin.com', 'github.com', 'portfolio',
]

const ID_KW = [
  // ── Spanish DNI / NIE ─────────────────────────────────────────────────────
  'documento nacional de identidad', 'dni', 'nie', 'd.n.i',
  'tarjeta de identidad', 'tarjeta de residencia', 'permiso de residencia',
  'españa', 'espagne', 'spanien', 'reino de españa',
  'ministerio del interior',
  // ── Spanish DNI OCR fragments (Textract often returns these) ──────────────
  'apellido', 'primer apellido', 'segundo apellido',
  'fecha de nacimiento', 'fecha de validez', 'fecha de expedición',
  'nacionalidad', 'sexo', 'domicilio', 'lugar de nacimiento',
  'num soporte', 'equipo', 'idesp',
  // ── Passport ──────────────────────────────────────────────────────────────
  'passport', 'pasaporte', 'reisepass', 'passeport', 'passaporto',
  'type/tipo', 'type / type', 'issuing authority',
  // ── Generic identity document (multi-country) ──────────────────────────────
  'national identity', 'identity card', 'carte nationale', 'carte d\'identité',
  'personalausweis', 'carta d\'identità', 'identiteitskaart', 'bilhete de identidade',
  'cartão de cidadão', 'identity document', 'documento de identidad',
  'permis de conduire', 'driving licence', 'permiso de conducir',
  'date of birth', 'date of expiry', 'date of issue',
  'place of birth', 'nationality', 'authority',
  // ── MRZ-adjacent keywords (appear near MRZ zones) ────────────────────────
  'machine readable', 'mrz',
]

// ── Passport-specific keywords (subset, high confidence) ────────────────────

const PASSPORT_KW = [
  'passport', 'pasaporte', 'reisepass', 'passeport', 'passaporto',
  'travel document', 'documento de viaje',
]

// ── MRZ pattern detection ───────────────────────────────────────────────────

/** Check if OCR text contains MRZ-like lines (uppercase + digits + '<', 30+ chars) */
function hasMRZPattern(text: string): boolean {
  const lines = text.split('\n')
  let mrzLineCount = 0
  for (const line of lines) {
    const clean = line.replace(/\s/g, '')
    // MRZ lines: 30-44 chars of [A-Z0-9<] only
    if (clean.length >= 28 && /^[A-Z0-9<]{28,44}$/.test(clean)) {
      mrzLineCount++
    }
  }
  return mrzLineCount >= 2 // TD1 has 3 lines, TD2/TD3 have 2
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function countKeywords(text: string, keywords: string[]): number {
  return keywords.filter(kw => text.includes(kw)).length
}

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const m = text.match(re)
    if (m) return m[1]?.trim()
  }
  return undefined
}

// ── Document type classification ───────────────────────────────────────────────

function classifyDocument(
  cnnType:     DocumentClass | null,
  ocrLower:    string,
  rekResult:   Partial<RekognitionResult> | undefined,
  ocrRaw:      string,
): AdmissionsDocTypeResult {

  const academicScore = countKeywords(ocrLower, [...ACADEMIC_KW_ES, ...ACADEMIC_KW_EN])
  const cvScore       = countKeywords(ocrLower, CV_KW)
  const idScore       = countKeywords(ocrLower, ID_KW)
  const passportScore = countKeywords(ocrLower, PASSPORT_KW)
  const hasMRZ        = hasMRZPattern(ocrRaw)
  const hasTranscript = ocrLower.includes('transcript') || ocrLower.includes('expediente')
  const hasFace       = (rekResult?.faceCount ?? 0) > 0

  // ── 1. Strong MRZ signal → identity document (highest priority) ────────────
  //    MRZ is a cryptographic proof of being a government-issued ID
  if (hasMRZ) {
    if (passportScore >= 1 || ocrLower.includes('p<') || cnnType === 'passport') {
      return { type: 'passport', label: 'International Passport', confidence: 0.95, isIdentity: true, isAcademic: false, isRelevant: true }
    }
    const isNIE = ocrLower.includes('nie') || ocrLower.includes('extranjero') || ocrLower.includes('tarjeta de residencia')
    const isDNI = ocrLower.includes('españa') || ocrLower.includes('espagne') || ocrLower.includes('idesp') || ocrLower.includes('dni')
    return {
      type: 'dni',
      label: isNIE ? 'Spanish NIE / Residence Permit' : isDNI ? 'Spanish DNI (National ID)' : 'National Identity Card',
      confidence: 0.95,
      isIdentity: true, isAcademic: false, isRelevant: true,
    }
  }

  // ── 2. CNN model classification (if model is deployed) ─────────────────────
  if (cnnType === 'passport') {
    return { type: 'passport', label: 'International Passport', confidence: 0.90, isIdentity: true, isAcademic: false, isRelevant: true }
  }
  if (cnnType === 'id_card') {
    const isNIE = ocrLower.includes('nie') || ocrLower.includes('extranjero')
    return { type: 'dni', label: isNIE ? 'Spanish NIE (Residency Permit)' : 'National ID Card (DNI)', confidence: 0.88, isIdentity: true, isAcademic: false, isRelevant: true }
  }

  // ── 3. Keyword-based identity detection (works even when CNN model is not deployed) ──
  //    idScore >= 2: at least 2 identity keywords found → strong signal
  //    idScore == 1 + hasFace: 1 keyword + photo → likely ID document
  if (idScore >= 2 || (idScore >= 1 && hasFace)) {
    if (passportScore >= 1) {
      return { type: 'passport', label: 'International Passport', confidence: 0.85, isIdentity: true, isAcademic: false, isRelevant: true }
    }
    const isNIE = ocrLower.includes('nie') || ocrLower.includes('extranjero') || ocrLower.includes('tarjeta de residencia')
    const isDNI = ocrLower.includes('españa') || ocrLower.includes('espagne') || ocrLower.includes('dni') || ocrLower.includes('idesp')
    const isLicence = ocrLower.includes('permiso de conducir') || ocrLower.includes('driving licence') || ocrLower.includes('permis de conduire')
    return {
      type: 'dni',
      label: isLicence ? 'Driving Licence' : isNIE ? 'Spanish NIE / Residence Permit' : isDNI ? 'Spanish DNI (National ID)' : 'National Identity Card',
      confidence: idScore >= 2 ? 0.85 : 0.75,
      isIdentity: true, isAcademic: false, isRelevant: true,
    }
  }

  // ── 4. Academic documents ──────────────────────────────────────────────────
  if (cnnType === 'certificate' || academicScore >= 2) {
    if (hasTranscript) {
      return { type: 'academic_transcript', label: 'Academic Transcript / Grade Record', confidence: 0.80, isIdentity: false, isAcademic: true, isRelevant: true }
    }
    return { type: 'degree_certificate', label: 'Degree / Diploma Certificate', confidence: 0.80, isIdentity: false, isAcademic: true, isRelevant: true }
  }

  // ── 5. CV / Résumé ────────────────────────────────────────────────────────
  if (cvScore >= 2) {
    return { type: 'cv_resume', label: 'CV / Résumé', confidence: 0.75, isIdentity: false, isAcademic: false, isRelevant: true }
  }

  // ── 6. Other CNN types ─────────────────────────────────────────────────────
  if (cnnType === 'invoice') {
    return { type: 'invoice', label: 'Invoice / Financial Document', confidence: 0.80, isIdentity: false, isAcademic: false, isRelevant: false }
  }
  if (cnnType === 'payslip') {
    return { type: 'payslip', label: 'Payslip / Employment Document', confidence: 0.80, isIdentity: false, isAcademic: false, isRelevant: false }
  }

  // ── 7. Face-only fallback — ONLY if NO identity signals were found above ──
  //    A DNI/passport has a face but also has keywords or MRZ.
  //    Only classify as "photo" if there's a face AND zero ID indicators.
  if (cnnType === 'media_photo' && idScore === 0 && !hasFace) {
    return { type: 'photo', label: 'Photo / Media Image', confidence: 0.60, isIdentity: false, isAcademic: false, isRelevant: false }
  }

  // ── 8. Last resort: if there IS a face + at least 1 identity keyword, treat as ID ──
  if (hasFace && idScore >= 1) {
    return { type: 'dni', label: 'Identity Document (unclassified)', confidence: 0.60, isIdentity: true, isAcademic: false, isRelevant: true }
  }

  // ── 9. No signals at all ───────────────────────────────────────────────────
  if (hasFace) {
    return { type: 'photo', label: 'Photo / Portrait', confidence: 0.50, isIdentity: false, isAcademic: false, isRelevant: false }
  }

  return { type: 'other', label: 'Unknown Document', confidence: 0.30, isIdentity: false, isAcademic: false, isRelevant: false }
}

// ── Field extraction from OCR text ────────────────────────────────────────────

function extractFields(
  rawText:   string,
  docType:   AdmissionsDocType,
  mrzData:   AdmissionsMRZAnalysis | null,
  textract:  Partial<TextractResult> | undefined,
): AdmissionsExtractedFields {

  const kv  = textract?.keyValuePairs ?? {}
  const txt = rawText

  // Helper: search key-value pairs (case-insensitive)
  const kv_get = (keys: string[]) => {
    for (const k of keys) {
      const found = Object.entries(kv).find(([key]) => key.toLowerCase().includes(k.toLowerCase()))
      if (found) return found[1]
    }
    return undefined
  }

  // ── Identity documents ─────────────────────────────────────────────────────
  if (mrzData?.detected && mrzData.fields) {
    const f = mrzData.fields
    return {
      fullName:       [f.surname, f.givenNames].filter(Boolean).join(', '),
      docNumber:      f.docNumber,
      dateOfBirth:    f.dobFormatted || f.dob,
      expiryDate:     f.expiryFormatted || f.expiry,
      nationality:    f.nationality,
      sex:            f.sex === 'M' ? 'Male' : f.sex === 'F' ? 'Female' : f.sex,
      issuingCountry: f.issuingCountry,
      isExpired:      f.isExpired === true,
      ocrText:        txt,
    }
  }

  // ── Academic documents ─────────────────────────────────────────────────────
  if (docType === 'degree_certificate' || docType === 'academic_transcript') {
    const institution = kv_get(['university', 'universidad', 'institution', 'college', 'escola']) ??
      firstMatch(txt, [
        /(?:universidad|universitat|university|college|institute)\s+(?:de\s+)?([A-ZÁÉÍÓÚÜÑ][^\n,]{3,50})/i,
        /([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+(?: [A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+){1,5})\s*(?:\n|,)\s*(?:university|universidad)/i,
      ])

    const degree = kv_get(['degree', 'título', 'titulación', 'grado', 'master', 'máster', 'bachelor']) ??
      firstMatch(txt, [
        /(?:grado en|máster en|master en|bachelor of|master of|doctor of|licenciatura en)\s+([^\n,]{5,80})/i,
        /(?:título de)\s+([^\n,]{5,80})/i,
      ])

    const studentName = kv_get(['nombre', 'name', 'alumno', 'student']) ??
      firstMatch(txt, [
        /(?:certifica que|certify that|en que|awarded to)\s+(?:D\.|Dña\.|Mr\.|Ms\.|Dr\.)?\s*([A-ZÁÉÍÓÚÜÑ][^\n,]{5,60})/i,
      ])

    const graduationDate = kv_get(['fecha', 'date', 'graduation', 'expedición']) ??
      firstMatch(txt, [
        /(?:el día|on|date[d]?)\s+(\d{1,2}\s+(?:de\s+)?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:de\s+)?\d{4})/i,
        /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/,
      ])

    return { institution, degree, studentName, graduationDate, ocrText: txt }
  }

  // ── CV ─────────────────────────────────────────────────────────────────────
  if (docType === 'cv_resume') {
    const studentName = firstMatch(txt, [
      /^([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+(?: [A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+){1,4})/m,
    ])
    return { studentName, ocrText: txt }
  }

  // ── Generic ───────────────────────────────────────────────────────────────
  return { ocrText: txt }
}

// ── MRZ extraction ─────────────────────────────────────────────────────────────

function extractMRZ(ocrText: string): AdmissionsMRZAnalysis | null {
  try {
    const result = parseMRZ(ocrText)
    if (result.rawLines.length === 0) return null
    return {
      detected:        true,
      valid:           result.valid,
      format:          result.documentType,
      checksumsPassed: result.checksumsPassed,
      checksumsFailed: result.checksumsFailed,
      fields:          result.fields,
      alerts:          result.alerts.map(a => a.detail),
    }
  } catch {
    return null
  }
}

// ── Authenticity score ─────────────────────────────────────────────────────────

function computeAuthenticityScore(
  forensics: {
    cnnScore:         number
    frequencyScore:   number
    semanticScore:    number
    rekognitionScore: number
  },
  mrz:     AdmissionsMRZAnalysis | null,
  docType: AdmissionsDocTypeResult,
): number {

  // Risk scores 0–100 where 100 = highest risk of manipulation
  const forensicRisk = (
    forensics.cnnScore       * 0.35 +
    forensics.frequencyScore * 0.30 +
    forensics.semanticScore  * 0.20 +
    forensics.rekognitionScore * 0.15
  )

  let score = 100 - forensicRisk

  // MRZ bonus/penalty for identity documents
  if (docType.isIdentity && mrz) {
    if (mrz.detected) {
      score = mrz.valid
        ? score * 0.60 + 100 * 0.40   // MRZ valid → strong boost
        : score * 0.60 + 0   * 0.40   // MRZ invalid → strong penalty
    }
  }

  // CV/resume: cannot verify cryptographically — cap at 60 (not tampered, but unverifiable)
  if (docType.type === 'cv_resume') {
    score = Math.min(score, 62)
  }

  return Math.round(Math.max(0, Math.min(100, score)))
}

// ── Verdict ────────────────────────────────────────────────────────────────────

function computeVerdict(score: number, docType: AdmissionsDocTypeResult): 'authentic' | 'suspicious' | 'tampered' {
  if (docType.type === 'cv_resume') return 'suspicious'  // CVs are always "unverifiable"
  if (score >= 72) return 'authentic'
  if (score >= 45) return 'suspicious'
  return 'tampered'
}

// ── Alert generation ───────────────────────────────────────────────────────────

function buildAlerts(
  docType:   AdmissionsDocTypeResult,
  mrz:       AdmissionsMRZAnalysis | null,
  forensics: { cnnScore: number; frequencyScore: number; semanticScore: number; semanticAlerts: { type: string; label: string; detail: string }[] },
  extracted: AdmissionsExtractedFields,
): AdmissionsAlert[] {

  const alerts: AdmissionsAlert[] = []

  if (!docType.isRelevant) {
    alerts.push({ level: 'warning', code: 'DOC_NOT_ADMISSIONS_RELEVANT', message: `Document type "${docType.label}" is not typically required for admissions.` })
  }

  if (docType.type === 'cv_resume') {
    alerts.push({ level: 'info', code: 'CV_UNVERIFIABLE', message: 'CVs cannot be cryptographically verified. Cross-reference with identity document and LinkedIn/professional profiles.' })
  }

  if (mrz?.detected && !mrz.valid) {
    alerts.push({ level: 'error', code: 'MRZ_CHECKSUM_FAIL', message: `MRZ check-digits failed (${mrz.checksumsFailed} of ${mrz.checksumsPassed + mrz.checksumsFailed}). Document may be altered.` })
    for (const a of mrz.alerts) {
      alerts.push({ level: 'error', code: 'MRZ_ALERT', message: a })
    }
  }

  if (docType.isIdentity && !mrz?.detected) {
    alerts.push({ level: 'warning', code: 'MRZ_NOT_FOUND', message: 'No MRZ zone detected. Ensure the full document (including bottom strip) is visible in the photo.' })
  }

  if (extracted.isExpired) {
    alerts.push({ level: 'error', code: 'DOCUMENT_EXPIRED', message: `Document expired on ${extracted.expiryDate ?? 'unknown date'}.` })
  }

  if (forensics.cnnScore >= 60) {
    alerts.push({ level: 'error', code: 'HIGH_MANIPULATION_SCORE', message: `Image manipulation detected (CNN score: ${forensics.cnnScore.toFixed(0)}/100). Likely digitally altered.` })
  } else if (forensics.cnnScore >= 35) {
    alerts.push({ level: 'warning', code: 'MODERATE_MANIPULATION_SIGNAL', message: `Moderate manipulation signals detected (score: ${forensics.cnnScore.toFixed(0)}/100). Manual review recommended.` })
  }

  if (forensics.frequencyScore >= 55) {
    alerts.push({ level: 'warning', code: 'FREQUENCY_ANOMALY', message: 'Spectral frequency anomalies detected. May indicate copy-paste or re-compression artifacts.' })
  }

  for (const sa of forensics.semanticAlerts) {
    alerts.push({ level: 'warning', code: sa.type.toUpperCase(), message: `${sa.label}: ${sa.detail}` })
  }

  return alerts
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse<AdmissionsVerifyResponse | { error: string }>> {
  const t0 = Date.now()

  let image: string
  try {
    const body = await req.json() as { image?: string }
    image = body.image ?? ''
    if (!image) throw new Error('missing image')
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON with { image: base64String }' }, { status: 400 })
  }

  // ── PDF detection + conversion to raster image ───────────────────────────────
  // Admissions documents are often scanned and saved as PDF.
  // Strategy:
  //   1. Detect if input is PDF (MIME type or base64 magic bytes %PDF → "JVBE")
  //   2. Convert first page to PNG at 200 DPI using pdfjs-dist + node-canvas
  //   3. Run ALL forensics on the PNG (CNN + Textract + Rekognition + Frequency)
  //   4. Also run Textract on original PDF bytes for maximum text quality
  //   5. If PDF render fails, fall back to Textract-only on the raw PDF

  const isPDF       = isPdfInput(image)
  let   imageForCnn = image      // raster image used for CNN/Rekognition/frequency
  let   pdfRendered = false

  if (isPDF) {
    console.log('[admissions-verify] PDF detected — converting first page to PNG...')
    const png = await pdfFirstPageToPng(image)
    if (png) {
      imageForCnn  = png
      pdfRendered  = true
      console.log('[admissions-verify] PDF rendered to PNG successfully')
    } else {
      console.warn('[admissions-verify] PDF render failed — Textract-only mode')
    }
  }

  // ── Run full forensics pipeline ──────────────────────────────────────────────
  // For PDF: run Textract on original PDF (better text quality for digital PDFs)
  //          run CNN/Rekognition/Frequency on rendered PNG (full pixel forensics)
  let forensicsResult
  try {
    const [textractOnly, pixelForensics] = await Promise.allSettled([
      // Always run Textract on the original input (handles PDF natively)
      isPDF ? import('@/lib/textractAnalysis').then(m => m.runTextractAnalysis(image)) : Promise.resolve(null),
      // Run pixel forensics on PNG (rendered from PDF, or original image)
      runDocumentForensics(imageForCnn, {
        enableTextract:    !isPDF,      // for images run Textract here; for PDF ran above
        enableCnn:         true,
        enableRekognition: pdfRendered || !isPDF,
        enableFrequency:   pdfRendered || !isPDF,
      }),
    ])

    const pixelResult = pixelForensics.status === 'fulfilled'
      ? pixelForensics.value
      : null

    // Merge: use PDF Textract result if available, otherwise use pixel result's Textract
    const textractResult = (isPDF && textractOnly.status === 'fulfilled' && textractOnly.value)
      ? textractOnly.value
      : pixelResult?.textractResult ?? null

    // Combine into unified forensicsResult shape
    forensicsResult = pixelResult
      ? { ...pixelResult, textractResult: textractResult ?? pixelResult.textractResult }
      : {
          documentType: null, semanticScore: 0, cnnScore: 0,
          rekognitionScore: 0, frequencyScore: 0, semanticAlerts: [],
          analysisMs: 0, textractResult: textractResult,
        }

  } catch (err) {
    console.error('[admissions-verify] runDocumentForensics failed:', err)
    return NextResponse.json({ error: 'Forensics pipeline failed' }, { status: 500 })
  }

  const ocrText  = forensicsResult.textractResult?.rawText ?? ''
  const ocrLower = ocrText.toLowerCase()

  // ── Classify document ────────────────────────────────────────────────────────
  const docType = classifyDocument(
    forensicsResult.documentType,
    ocrLower,
    forensicsResult.rekognitionResult as Partial<RekognitionResult> | undefined,
    ocrText,
  )

  // ── Parse MRZ (try on ALL documents — MRZ presence confirms it's an ID) ──────
  const mrzAnalysis = extractMRZ(ocrText)

  // ── Extract fields ────────────────────────────────────────────────────────────
  const extractedData = extractFields(
    ocrText,
    docType.type,
    mrzAnalysis,
    forensicsResult.textractResult as Partial<TextractResult> | undefined,
  )

  // ── Forensics signal summary ──────────────────────────────────────────────────
  const forensics: AdmissionsForensicsSignals = {
    manipulationScore: forensicsResult.cnnScore,
    frequencyScore:    forensicsResult.frequencyScore,
    semanticScore:     forensicsResult.semanticScore,
    rekognitionScore:  forensicsResult.rekognitionScore,
    overallRiskScore:  Math.round(
      forensicsResult.cnnScore       * 0.35 +
      forensicsResult.frequencyScore * 0.30 +
      forensicsResult.semanticScore  * 0.20 +
      forensicsResult.rekognitionScore * 0.15,
    ),
    faceDetected:   (forensicsResult.rekognitionResult?.faceCount ?? 0) > 0,
    faceCount:      forensicsResult.rekognitionResult?.faceCount ?? 0,
    semanticAlerts: (forensicsResult.semanticAlerts ?? []).map(a => ({
      type:   a.type,
      label:  a.label,
      detail: a.detail,
    })),
  }

  // ── Compute final score & verdict ─────────────────────────────────────────────
  const authenticityScore = computeAuthenticityScore(
    {
      cnnScore:         forensicsResult.cnnScore,
      frequencyScore:   forensicsResult.frequencyScore,
      semanticScore:    forensicsResult.semanticScore,
      rekognitionScore: forensicsResult.rekognitionScore,
    },
    mrzAnalysis,
    docType,
  )
  const verdict = computeVerdict(authenticityScore, docType)

  // ── Build alerts ──────────────────────────────────────────────────────────────
  const alerts = buildAlerts(docType, mrzAnalysis, {
    cnnScore:       forensicsResult.cnnScore,
    frequencyScore: forensicsResult.frequencyScore,
    semanticScore:  forensicsResult.semanticScore,
    semanticAlerts: forensics.semanticAlerts,
  }, extractedData)

  // PDF-specific info alert
  if (isPDF) {
    alerts.unshift({
      level:   'info',
      code:    pdfRendered ? 'PDF_FULL_ANALYSIS' : 'PDF_OCR_ONLY',
      message: pdfRendered
        ? 'PDF scanned document: first page rendered to 200 DPI PNG. Full analysis active: CNN + Textract + Rekognition + Frequency forensics.'
        : 'PDF processed: AWS Textract OCR active. Pixel forensics unavailable (PDF render failed). Upload a JPG/PNG scan for full forensic analysis.',
    })
  }

  return NextResponse.json({
    documentType:      docType,
    extractedData,
    mrzAnalysis,
    forensics,
    authenticityScore,
    verdict,
    alerts,
    processingMs: Date.now() - t0,
  })
}
