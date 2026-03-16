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

import { NextRequest, NextResponse } from 'next/server'
import { runDocumentForensics }      from '@/lib/documentForensics'
import { parseMRZ }                  from '@/lib/mrzParser'
import type { MRZFields }            from '@/lib/mrzParser'
import type { DocumentClass }        from '@/lib/docForensicsCnn'
import type { TextractResult }       from '@/lib/textractAnalysis'
import type { RekognitionResult }    from '@/lib/rekognitionAnalysis'

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
  'documento nacional de identidad', 'dni', 'nie',
  'tarjeta de residencia', 'permiso de residencia',
  'national identity', 'identity card', 'carte nationale',
  'personalausweis', 'carta d\'identità', 'identiteitskaart',
]

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
): AdmissionsDocTypeResult {

  const academicScore = countKeywords(ocrLower, [...ACADEMIC_KW_ES, ...ACADEMIC_KW_EN])
  const cvScore       = countKeywords(ocrLower, CV_KW)
  const idScore       = countKeywords(ocrLower, ID_KW)
  const hasTranscript = ocrLower.includes('transcript') || ocrLower.includes('expediente')

  // CNN-based type
  if (cnnType === 'passport') {
    return { type: 'passport', label: 'International Passport', confidence: 0.90, isIdentity: true, isAcademic: false, isRelevant: true }
  }
  if (cnnType === 'id_card' || idScore >= 1) {
    const isNIE = ocrLower.includes('nie') || ocrLower.includes('extranjero')
    return { type: 'dni', label: isNIE ? 'Spanish NIE (Residency Permit)' : 'National ID Card (DNI)', confidence: 0.85, isIdentity: true, isAcademic: false, isRelevant: true }
  }
  if (cnnType === 'certificate' || academicScore >= 2) {
    if (hasTranscript) {
      return { type: 'academic_transcript', label: 'Academic Transcript / Grade Record', confidence: 0.80, isIdentity: false, isAcademic: true, isRelevant: true }
    }
    return { type: 'degree_certificate', label: 'Degree / Diploma Certificate', confidence: 0.80, isIdentity: false, isAcademic: true, isRelevant: true }
  }
  if (cvScore >= 2) {
    return { type: 'cv_resume', label: 'CV / Résumé', confidence: 0.75, isIdentity: false, isAcademic: false, isRelevant: true }
  }
  if (cnnType === 'invoice') {
    return { type: 'invoice', label: 'Invoice / Financial Document', confidence: 0.80, isIdentity: false, isAcademic: false, isRelevant: false }
  }
  if (cnnType === 'payslip') {
    return { type: 'payslip', label: 'Payslip / Employment Document', confidence: 0.80, isIdentity: false, isAcademic: false, isRelevant: false }
  }
  if (cnnType === 'media_photo' || (rekResult?.faceCount ?? 0) > 0) {
    return { type: 'photo', label: 'Photo / Portrait', confidence: 0.70, isIdentity: false, isAcademic: false, isRelevant: false }
  }

  return { type: 'other', label: 'Unknown Document', confidence: 0.40, isIdentity: false, isAcademic: false, isRelevant: false }
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

  // ── Run full forensics pipeline ──────────────────────────────────────────────
  let forensicsResult
  try {
    forensicsResult = await runDocumentForensics(image, {
      enableTextract:    true,
      enableCnn:         true,
      enableRekognition: true,
      enableFrequency:   true,
    })
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
  )

  // ── Parse MRZ (ID/passport only) ─────────────────────────────────────────────
  const mrzAnalysis = docType.isIdentity ? extractMRZ(ocrText) : null

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
