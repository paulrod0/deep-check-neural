/**
 * POST /api/admissions-verify
 * ===========================
 * IE University Admissions — Document Authenticity Verification
 *
 * **Self-hosted pipeline — zero cloud dependency.**
 *
 * Accepts any document image (DNI, passport, degree, diploma, CV, transcript).
 * Supports documents in any language (Latin + Arabic scripts auto-detected).
 * Runs the full Deep-Check forensics stack server-side:
 *   1. Tesseract.js OCR      — multi-language text extraction (eng/ara auto)
 *   2. Face detection         — YCbCr skin-color analysis + connected components
 *   3. Frequency analysis     — FFT spectral + wavelet splice detection
 *   4. MRZ parsing            — ICAO 9303 check-digit validation (offline)
 *   5. Semantic validation    — NIF/CIF, IBAN, date, MRZ checksums
 *   6. Academic keyword scan  — degree/certificate structural validation
 *
 * No authentication required — demo endpoint.
 */

// Vercel serverless function timeout: 60s (Tesseract.js cold start ~15s)
export const maxDuration = 60

import { NextRequest, NextResponse }    from 'next/server'
import { runOCR }                       from '@/lib/ocrEngine'
import { detectFaces }                  from '@/lib/faceDetection'
import { parseMRZ }                     from '@/lib/mrzParser'
import { isPdfInput }                   from '@/lib/pdfToImage'
import { runELA }                       from '@/lib/elaAnalysis'
import { runExifAnalysis }              from '@/lib/exifAnalysis'
import { runTextConsistencyAnalysis }   from '@/lib/textConsistency'
import { crossValidateMRZvsOCR }        from '@/lib/crossValidation'
import type { MRZFields }              from '@/lib/mrzParser'
import type { OcrResult }              from '@/lib/ocrEngine'
import type { FaceDetectionResult }    from '@/lib/faceDetection'
import type { ELAResult }              from '@/lib/elaAnalysis'
import type { ExifForensicResult }     from '@/lib/exifAnalysis'
import type { TextConsistencyResult }  from '@/lib/textConsistency'
import type { CrossValidationResult }  from '@/lib/crossValidation'

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
  manipulationScore: number   // 0–100 (overall manipulation indicator)
  frequencyScore:    number   // 0–100 (FFT/wavelet)
  semanticScore:     number   // 0–100 (OCR semantic anomaly)
  faceQualityScore:  number   // 0–100 (face quality anomaly)
  elaScore:          number   // 0–100 (Error Level Analysis)
  exifScore:         number   // 0–100 (EXIF metadata forensics)
  textConsistency:   number   // 0–100 (text/font consistency)
  crossValidation:   number   // 0–100 (MRZ ↔ OCR field mismatch)
  overallRiskScore:  number   // 0–100 weighted combination
  faceDetected:      boolean
  faceCount:         number
  ocrConfidence:     number   // 0–100 Tesseract confidence
  semanticAlerts:    { type: string; label: string; detail: string }[]
  crossValidationAlerts: { field: string; mrzValue: string; ocrValue: string; detail: string }[]
  exifAlerts:        { type: string; detail: string }[]
}

export interface AdmissionsAlert {
  level:   'info' | 'warning' | 'error'
  code:    string
  message: string
}

export interface AdmissionsVerifyResponse {
  documentType:       AdmissionsDocTypeResult
  extractedData:      AdmissionsExtractedFields
  mrzAnalysis:        AdmissionsMRZAnalysis | null
  forensics:          AdmissionsForensicsSignals
  authenticityScore:  number   // 0–100 (higher = more authentic)
  verdict:            'authentic' | 'suspicious' | 'tampered'
  alerts:             AdmissionsAlert[]
  processingMs:       number
  backImageProcessed: boolean  // true if imageBack was provided and processed
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
  // ── Spanish DNI / NIE
  'documento nacional de identidad', 'dni', 'nie', 'd.n.i',
  'tarjeta de identidad', 'tarjeta de residencia', 'permiso de residencia',
  'españa', 'espana', 'espagne', 'spanien', 'reino de españa', 'reino de espana',
  'ministerio del interior',
  // ── Spanish DNI OCR fragments
  'apellido', 'primer apellido', 'segundo apellido',
  'fecha de nacimiento', 'fecha de validez', 'fecha de expedición',
  'nacionalidad', 'sexo', 'domicilio', 'lugar de nacimiento',
  'num soporte', 'equipo', 'idesp',
  // ── Passport
  'passport', 'pasaporte', 'reisepass', 'passeport', 'passaporto',
  'type/tipo', 'type / type', 'issuing authority',
  // ── Generic identity document (multi-country)
  'national identity', 'identity card', 'carte nationale', "carte d'identité",
  'personalausweis', "carta d'identità", 'identiteitskaart', 'bilhete de identidade',
  'cartão de cidadão', 'identity document', 'documento de identidad',
  'permis de conduire', 'driving licence', 'permiso de conducir',
  'date of birth', 'date of expiry', 'date of issue',
  'place of birth', 'nationality', 'authority',
  // ── Arabic / Middle East / North Africa identity documents
  '\u0628\u0637\u0627\u0642\u0629',                    // بطاقة (card)
  '\u0647\u0648\u064a\u0629',                          // هوية (identity)
  '\u0628\u0637\u0627\u0642\u0629 \u0647\u0648\u064a\u0629',  // بطاقة هوية (identity card)
  '\u062c\u0648\u0627\u0632',                          // جواز (passport)
  '\u062c\u0648\u0627\u0632 \u0633\u0641\u0631',       // جواز سفر (passport)
  '\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0645\u064a\u0644\u0627\u062f',  // تاريخ الميلاد (date of birth)
  '\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0627\u0646\u062a\u0647\u0627\u0621', // تاريخ الانتهاء (expiry date)
  '\u0627\u0644\u062c\u0646\u0633\u064a\u0629',        // الجنسية (nationality)
  '\u0627\u0644\u0627\u0633\u0645',                    // الاسم (name)
  '\u0631\u0642\u0645',                                // رقم (number)
  // ── Arabic country names
  '\u0627\u0644\u0645\u0645\u0644\u0643\u0629 \u0627\u0644\u0639\u0631\u0628\u064a\u0629 \u0627\u0644\u0633\u0639\u0648\u062f\u064a\u0629', // Saudi Arabia
  '\u0627\u0644\u0625\u0645\u0627\u0631\u0627\u062a',  // Emirates
  '\u0645\u0635\u0631',                                // Egypt
  '\u0627\u0644\u0623\u0631\u062f\u0646',              // Jordan
  '\u0627\u0644\u0639\u0631\u0627\u0642',              // Iraq
  '\u0627\u0644\u0645\u063a\u0631\u0628',              // Morocco
  '\u062a\u0648\u0646\u0633',                          // Tunisia
  '\u0644\u0628\u0646\u0627\u0646',                    // Lebanon
  // ── Country names in Latin (Arabic countries)
  'saudi arabia', 'kingdom of saudi arabia', 'united arab emirates', 'uae',
  'egypt', 'jordan', 'iraq', 'morocco', 'tunisia', 'lebanon', 'qatar',
  'bahrain', 'kuwait', 'oman', 'algeria', 'libya', 'sudan', 'yemen',
  // ── Other non-Latin script countries
  'türkiye', 'turkiye', 'republic of turkey',
  // ── MRZ-adjacent keywords
  'machine readable', 'mrz',
]

// ── Passport-specific keywords (subset, high confidence)

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
    // MRZ lines: 28-44 chars of [A-Z0-9<] only
    if (clean.length >= 28 && /^[A-Z0-9<]{28,44}$/.test(clean)) {
      mrzLineCount++
    }
  }
  return mrzLineCount >= 2
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function countKeywords(text: string, keywords: string[]): number {
  return keywords.filter(kw => text.includes(kw)).length
}

/** Detect country from Arabic or mixed text */
function detectArabicCountry(raw: string, lower: string): string | null {
  // Arabic country names in Arabic script
  const countryMap: [string, string][] = [
    ['\u0627\u0644\u0645\u0645\u0644\u0643\u0629 \u0627\u0644\u0639\u0631\u0628\u064a\u0629 \u0627\u0644\u0633\u0639\u0648\u062f\u064a\u0629', 'Saudi Arabia'],
    ['\u0627\u0644\u0633\u0639\u0648\u062f\u064a\u0629', 'Saudi Arabia'],
    ['\u0627\u0644\u0625\u0645\u0627\u0631\u0627\u062a', 'UAE'],
    ['\u0645\u0635\u0631', 'Egypt'],
    ['\u0627\u0644\u0623\u0631\u062f\u0646', 'Jordan'],
    ['\u0627\u0644\u0639\u0631\u0627\u0642', 'Iraq'],
    ['\u0627\u0644\u0645\u063a\u0631\u0628', 'Morocco'],
    ['\u062a\u0648\u0646\u0633', 'Tunisia'],
    ['\u0644\u0628\u0646\u0627\u0646', 'Lebanon'],
    ['\u0642\u0637\u0631', 'Qatar'],
    ['\u0627\u0644\u0628\u062d\u0631\u064a\u0646', 'Bahrain'],
    ['\u0627\u0644\u0643\u0648\u064a\u062a', 'Kuwait'],
    ['\u0639\u0645\u0627\u0646', 'Oman'],
    ['\u0627\u0644\u062c\u0632\u0627\u0626\u0631', 'Algeria'],
    ['\u0644\u064a\u0628\u064a\u0627', 'Libya'],
    ['\u0627\u0644\u0633\u0648\u062f\u0627\u0646', 'Sudan'],
    ['\u0627\u0644\u064a\u0645\u0646', 'Yemen'],
  ]
  for (const [arabic, english] of countryMap) {
    if (raw.includes(arabic)) return english
  }
  // Latin name fallback
  const latinCountries: [string, string][] = [
    ['saudi', 'Saudi Arabia'], ['emirates', 'UAE'], ['uae', 'UAE'],
    ['egypt', 'Egypt'], ['jordan', 'Jordan'], ['iraq', 'Iraq'],
    ['morocco', 'Morocco'], ['tunisia', 'Tunisia'], ['lebanon', 'Lebanon'],
    ['qatar', 'Qatar'], ['bahrain', 'Bahrain'], ['kuwait', 'Kuwait'],
    ['oman', 'Oman'], ['algeria', 'Algeria'], ['libya', 'Libya'],
    ['sudan', 'Sudan'], ['yemen', 'Yemen'], ['turkey', 'Turkey'],
    ['türkiye', 'Turkey'], ['turkiye', 'Turkey'],
  ]
  for (const [kw, name] of latinCountries) {
    if (lower.includes(kw)) return name
  }
  return null
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
  ocrLower:    string,
  ocrRaw:      string,
  hasFace:     boolean,
): AdmissionsDocTypeResult {

  const academicScore = countKeywords(ocrLower, [...ACADEMIC_KW_ES, ...ACADEMIC_KW_EN])
  const cvScore       = countKeywords(ocrLower, CV_KW)
  const idScore       = countKeywords(ocrLower, ID_KW) + countKeywords(ocrRaw, ID_KW) // check raw for Arabic chars
  const passportScore = countKeywords(ocrLower, PASSPORT_KW) + countKeywords(ocrRaw, PASSPORT_KW)
  const hasMRZ        = hasMRZPattern(ocrRaw)
  const hasTranscript = ocrLower.includes('transcript') || ocrLower.includes('expediente')
  const hasArabic     = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF]{3,}/.test(ocrRaw)

  // ── 1. Strong MRZ signal → identity document (highest priority)
  if (hasMRZ) {
    if (passportScore >= 1 || ocrLower.includes('p<')) {
      return { type: 'passport', label: 'International Passport', confidence: 0.95, isIdentity: true, isAcademic: false, isRelevant: true }
    }
    const isNIE = ocrLower.includes('nie') || ocrLower.includes('extranjero') || ocrLower.includes('tarjeta de residencia')
    const isDNI = ocrLower.includes('españa') || ocrLower.includes('espana') || ocrLower.includes('espagne') || ocrLower.includes('idesp') || ocrLower.includes('dni')
    return {
      type: 'dni',
      label: isNIE ? 'Spanish NIE / Residence Permit' : isDNI ? 'Spanish DNI (National ID)' : 'National Identity Card',
      confidence: 0.95,
      isIdentity: true, isAcademic: false, isRelevant: true,
    }
  }

  // ── 2. Keyword-based identity detection
  if (idScore >= 2 || (idScore >= 1 && hasFace) || (hasArabic && hasFace)) {
    if (passportScore >= 1) {
      return { type: 'passport', label: 'International Passport', confidence: 0.85, isIdentity: true, isAcademic: false, isRelevant: true }
    }
    const isNIE = ocrLower.includes('nie') || ocrLower.includes('extranjero') || ocrLower.includes('tarjeta de residencia')
    const isDNI = ocrLower.includes('españa') || ocrLower.includes('espana') || ocrLower.includes('espagne') || ocrLower.includes('dni') || ocrLower.includes('idesp')
    const isLicence = ocrLower.includes('permiso de conducir') || ocrLower.includes('driving licence') || ocrLower.includes('permis de conduire')

    // Detect Arabic ID cards
    const isArabicID = hasArabic && (
      ocrRaw.includes('\u0628\u0637\u0627\u0642\u0629') || // بطاقة
      ocrRaw.includes('\u0647\u0648\u064a\u0629') ||       // هوية
      ocrLower.includes('saudi') || ocrLower.includes('emirates') || ocrLower.includes('uae') ||
      ocrLower.includes('egypt') || ocrLower.includes('jordan') || ocrLower.includes('morocco') ||
      ocrLower.includes('tunisia') || ocrLower.includes('lebanon') || ocrLower.includes('iraq') ||
      ocrLower.includes('qatar') || ocrLower.includes('bahrain') || ocrLower.includes('kuwait') ||
      ocrLower.includes('oman') || ocrLower.includes('algeria')
    )

    // Detect country from Arabic text
    const arabicCountry = hasArabic ? detectArabicCountry(ocrRaw, ocrLower) : null

    return {
      type: isArabicID ? 'eu_id' : 'dni',
      label: isLicence ? 'Driving Licence'
           : isNIE ? 'Spanish NIE / Residence Permit'
           : isDNI ? 'Spanish DNI (National ID)'
           : isArabicID ? `National Identity Card${arabicCountry ? ` (${arabicCountry})` : ''}`
           : 'National Identity Card',
      confidence: idScore >= 2 ? 0.85 : 0.75,
      isIdentity: true, isAcademic: false, isRelevant: true,
    }
  }

  // ── 3. Academic documents
  if (academicScore >= 2) {
    if (hasTranscript) {
      return { type: 'academic_transcript', label: 'Academic Transcript / Grade Record', confidence: 0.80, isIdentity: false, isAcademic: true, isRelevant: true }
    }
    return { type: 'degree_certificate', label: 'Degree / Diploma Certificate', confidence: 0.80, isIdentity: false, isAcademic: true, isRelevant: true }
  }

  // ── 4. CV / Résumé
  if (cvScore >= 2) {
    return { type: 'cv_resume', label: 'CV / Résumé', confidence: 0.75, isIdentity: false, isAcademic: false, isRelevant: true }
  }

  // ── 5. Face + at least 1 identity keyword → treat as ID
  if (hasFace && idScore >= 1) {
    const country = detectArabicCountry(ocrRaw, ocrLower)
    return { type: 'dni', label: country ? `Identity Document (${country})` : 'Identity Document (unclassified)', confidence: 0.60, isIdentity: true, isAcademic: false, isRelevant: true }
  }

  // ── 5b. Face + Arabic text → likely Arabic ID card
  if (hasFace && hasArabic) {
    const country = detectArabicCountry(ocrRaw, ocrLower)
    return { type: 'eu_id', label: `National Identity Card${country ? ` (${country})` : ' (Arabic)'}`, confidence: 0.70, isIdentity: true, isAcademic: false, isRelevant: true }
  }

  // ── 6. Face only → photo
  if (hasFace) {
    return { type: 'photo', label: 'Photo / Portrait', confidence: 0.50, isIdentity: false, isAcademic: false, isRelevant: false }
  }

  // ── 7. No signals → check for some text content
  if (ocrLower.length > 100) {
    // Has substantial text but no classification — generic document
    if (academicScore >= 1) {
      return { type: 'degree_certificate', label: 'Academic Document', confidence: 0.55, isIdentity: false, isAcademic: true, isRelevant: true }
    }
    return { type: 'other', label: 'Document (unclassified)', confidence: 0.40, isIdentity: false, isAcademic: false, isRelevant: false }
  }

  return { type: 'other', label: 'Unknown Document', confidence: 0.30, isIdentity: false, isAcademic: false, isRelevant: false }
}

// ── Field extraction from OCR text ────────────────────────────────────────────

function extractFields(
  rawText:   string,
  docType:   AdmissionsDocType,
  mrzData:   AdmissionsMRZAnalysis | null,
  kvPairs:   Record<string, string>,
): AdmissionsExtractedFields {

  const txt = rawText

  // Helper: search key-value pairs (case-insensitive)
  const kv_get = (keys: string[]) => {
    for (const k of keys) {
      const found = Object.entries(kvPairs).find(([key]) => key.toLowerCase().includes(k.toLowerCase()))
      if (found) return found[1]
    }
    return undefined
  }

  // ── Identity documents from MRZ
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

  // ── Identity documents from OCR text + key-value pairs
  if (docType === 'passport' || docType === 'dni' || docType === 'eu_id') {
    const fullName   = kv_get(['nombre', 'name', 'apellido', 'surname', 'nom', '\u0627\u0644\u0627\u0633\u0645']) ??
      firstMatch(txt, [
        /(?:nombre|name|nom)\s*[:\-]?\s*([A-ZÁÉÍÓÚÜÑ][^\n,]{2,50})/i,
        // Spanish DNI layout: name appears as standalone ALL-CAPS line after IDENTIDAD
        /(?:IDENTIDAD|IDENTITY).*?\n.*?\n.*?([A-ZÁÉÍÓÚÜÑ]{3,}(?:\s+[A-ZÁÉÍÓÚÜÑ]{2,})*)/,
        // Arabic name: sequence of Arabic chars after الاسم
        /\u0627\u0644\u0627\u0633\u0645\s*[:\-]?\s*([\u0600-\u06FF\u0750-\u077F\s]{3,50})/,
        // General: any Arabic word sequence of 3+ words (likely a name)
        /([\u0600-\u06FF]{2,}(?:\s+[\u0600-\u06FF]{2,}){1,4})/,
      ])
    const docNumber  = kv_get(['número', 'number', 'num', 'document', '\u0631\u0642\u0645']) ??
      firstMatch(txt, [
        /(?:num(?:ero)?\.?\s*(?:soporte|documento|doc)?)\s*[:\-]?\s*([A-Z0-9]{6,12})/i,
        // Spanish DNI number: 8 digits + 1 letter
        /\b(\d{8}[A-Z])\b/,
        // Generic document number: alphanumeric 6-15 chars
        /(?:number|no\.?|num|رقم)\s*[:\-]?\s*([A-Z0-9]{6,15})/i,
      ])
    const dob        = kv_get(['nacimiento', 'birth', 'naissance', '\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0645\u064a\u0644\u0627\u062f']) ??
      firstMatch(txt, [
        // DD MM YYYY or DD/MM/YYYY patterns
        /(?:nacimiento|birth|nac)\S*\s*[:\-]?\s*(\d{2}\s+\d{2}\s+\d{4})/i,
        // Fallback: date after name, before EMISION
        /(\d{2}\s+\d{2}\s+\d{4})(?=[\s\S]*?(?:EMISION|VALIDEZ|expiry))/i,
        // DD/MM/YYYY with separators
        /(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/,
      ])
    const nationality = kv_get(['nacionalidad', 'nationality', 'nationalité', '\u0627\u0644\u062c\u0646\u0633\u064a\u0629']) ??
      firstMatch(txt, [
        /(?:nacionalidad|nationality)\s*[:\-]?\s*([A-Za-zÁÉÍÓÚÜÑ]+)/i,
        // Arabic nationality
        /\u0627\u0644\u062c\u0646\u0633\u064a\u0629\s*[:\-]?\s*([\u0600-\u06FF\s]{2,30})/,
      ])
    // Parse emission date (to differentiate from expiry)
    const emisionDate = kv_get(['emisión', 'emision', 'emission', 'expedición', 'expedicion', 'issue', 'date of issue']) ??
      firstMatch(txt, [
        /(?:EMISI[ÓO]N|EXPEDICI[ÓO]N|issue)\s*[:\-]?\s*(\d{2}[\s\/\-\.]\d{2}[\s\/\-\.]\d{4})/i,
      ])

    // Parse expiry date — use KV pairs first (most reliable), then regex
    // IMPORTANT: Spanish DNI has EMISIÓN and VALIDEZ side by side.
    // Textract linearizes as "EMISIÓN VALIDEZ\n05 09 2022 05 09 2027"
    // so we must find ALL dates near VALIDEZ and pick the one that ISN'T the emission date.
    const expiryFromKV = kv_get(['validez', 'expiry', 'caducidad', 'date of expiry', 'válido hasta', 'valido hasta'])
    let expiryDate: string | undefined = expiryFromKV

    if (!expiryDate) {
      // Strategy: find ALL dates in the text, filter out emission date, pick the latest
      const allDates = [...txt.matchAll(/(\d{2}[\s\/\-\.]\d{2}[\s\/\-\.]\d{4})/g)].map(m => m[1])
      if (allDates.length >= 2 && emisionDate) {
        // Find the date that's NOT the emission date
        const emisionNorm = emisionDate.replace(/[\s\/\-\.]/g, '')
        const candidates = allDates.filter(d => d.replace(/[\s\/\-\.]/g, '') !== emisionNorm)
        if (candidates.length > 0) {
          // Pick the latest date (most likely the expiry)
          expiryDate = candidates[candidates.length - 1]
        }
      }
      // Fallback: look for date specifically after VALIDEZ keyword
      if (!expiryDate) {
        // Match text like "VALIDEZ\n05 09 2022 05 09 2027" → capture LAST date on that line
        const validezBlock = txt.match(/VALIDEZ[\s\S]{0,50}?(\d{2}[\s\/\-\.]\d{2}[\s\/\-\.]\d{4})[\s\S]{0,20}?(\d{2}[\s\/\-\.]\d{2}[\s\/\-\.]\d{4})/i)
        if (validezBlock && validezBlock[2]) {
          expiryDate = validezBlock[2]  // second date is the one under VALIDEZ
        } else {
          expiryDate = firstMatch(txt, [
            /VALIDEZ\s*[:\-]?\s*(\d{2}[\s\/\-\.]\d{2}[\s\/\-\.]\d{4})/i,
            /(?:validez|expiry|caducidad)\S*\s*[:\-]?\s*(\d{2}[\s\/\-\.]\d{2}[\s\/\-\.]\d{4})/i,
            /\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0627\u0646\u062a\u0647\u0627\u0621\s*[:\-]?\s*(\d{2}[\s\/\-\.]\d{2}[\s\/\-\.]\d{4})/,
          ])
        }
      }
    }
    // Parse issuing country
    const issuingCountryFromText = detectArabicCountry(txt, txt.toLowerCase())
    const issuingCountry = (txt.includes('ESPAÑA') || txt.includes('ESPANA') || txt.includes('ESPAGNE'))
      ? 'ESP'
      : issuingCountryFromText ?? undefined

    return {
      fullName,
      docNumber,
      dateOfBirth: dob,
      expiryDate,
      nationality,
      issuingCountry,
      ocrText: txt,
    }
  }

  // ── Academic documents
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

  // ── CV
  if (docType === 'cv_resume') {
    const studentName = firstMatch(txt, [
      /^([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+(?: [A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+){1,4})/m,
    ])
    return { studentName, ocrText: txt }
  }

  // ── Generic
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
    frequencyScore:    number
    semanticScore:     number
    faceQualityScore:  number
    elaScore:          number
    exifScore:         number
    textConsistency:   number
    crossValidation:   number
  },
  mrz:     AdmissionsMRZAnalysis | null,
  docType: AdmissionsDocTypeResult,
  ocrConfidence: number,
): number {

  // Risk scores 0–100 where 100 = highest risk
  // Weighting includes all 7 forensic signals
  // When no MRZ is available, redistribute cross-validation weight to other signals
  const hasMRZ = !!(mrz?.detected)
  const forensicRisk = hasMRZ
    ? (
        forensics.frequencyScore   * 0.12 +
        forensics.semanticScore    * 0.13 +
        forensics.faceQualityScore * 0.05 +
        forensics.elaScore         * 0.20 +
        forensics.exifScore        * 0.10 +
        forensics.textConsistency  * 0.10 +
        forensics.crossValidation  * 0.30
      )
    : (
        // No MRZ → upweight pixel-level signals that can detect manipulation
        forensics.frequencyScore   * 0.15 +
        forensics.semanticScore    * 0.15 +
        forensics.faceQualityScore * 0.05 +
        forensics.elaScore         * 0.25 +   // ELA becomes primary
        forensics.exifScore        * 0.15 +
        forensics.textConsistency  * 0.25     // Text consistency becomes primary
      )

  let score = 100 - forensicRisk

  // ── MRZ bonus/penalty ─────────────────────────────────────────────────
  if (docType.isIdentity && mrz) {
    if (mrz.detected) {
      score = mrz.valid
        ? score * 0.60 + 100 * 0.40   // MRZ valid → strong boost
        : score * 0.60 + 0   * 0.40   // MRZ invalid → strong penalty
    }
  }

  // ── CRITICAL: Identity document WITHOUT MRZ → cannot fully verify ─────
  // A DNI/passport without MRZ visible is inherently unverifiable.
  // Cap the score: we cannot grant "authentic" without MRZ cross-check.
  if (docType.isIdentity && !hasMRZ) {
    score = Math.min(score, 78)  // max "suspicious" zone — never "authentic" without MRZ
  }

  // ── Cross-validation: severe penalty if MRZ and OCR disagree ──────────
  if (forensics.crossValidation >= 40) {
    score = Math.min(score, 100 - forensics.crossValidation)
  }

  // ── Text consistency: penalty for inconsistent rendering ──────────────
  // This catches manipulations even without MRZ (like changing "Pablo" to "Pedro")
  if (forensics.textConsistency >= 50) {
    // Strong signal: different noise/sharpness across regions = editing
    const textPenalty = Math.round(forensics.textConsistency * 0.4)
    score = Math.min(score, 100 - textPenalty)
  }

  // ── ELA: JPEG manipulation detected ───────────────────────────────────
  if (forensics.elaScore >= 40) {
    score = Math.min(score, 80 - Math.round(forensics.elaScore * 0.2))
  }

  // ── Editing software in EXIF ──────────────────────────────────────────
  if (forensics.exifScore >= 25) {
    score = Math.min(score, 75)
  }

  // ── Semantic: NIF/CIF/IBAN validation failure ─────────────────────────
  if (forensics.semanticScore >= 35) {
    score = Math.min(score, 65)
  }

  // ── Compound signals: multiple moderate signals = stronger penalty ────
  // If 2+ signals are in "moderate" zone (≥30), that's more suspicious than any single signal
  const moderateSignals = [
    forensics.elaScore,
    forensics.textConsistency,
    forensics.frequencyScore,
    forensics.exifScore,
    forensics.semanticScore,
  ].filter(s => s >= 30).length

  if (moderateSignals >= 2) {
    score = Math.min(score, 75 - (moderateSignals - 2) * 5)
  }
  if (moderateSignals >= 3) {
    score = Math.min(score, 65)  // 3+ moderate signals → suspicious at best
  }

  // ── OCR confidence bonus ──────────────────────────────────────────────
  if (ocrConfidence >= 80 && docType.isIdentity && hasMRZ) {
    // Only give OCR bonus if MRZ is present (otherwise we're less certain)
    score = Math.min(100, score + 2)
  }

  // ── CV/resume: cannot verify cryptographically ────────────────────────
  if (docType.type === 'cv_resume') {
    score = Math.min(score, 62)
  }

  return Math.round(Math.max(0, Math.min(100, score)))
}

// ── Verdict ────────────────────────────────────────────────────────────────────

function computeVerdict(score: number, docType: AdmissionsDocTypeResult): 'authentic' | 'suspicious' | 'tampered' {
  if (docType.type === 'cv_resume') return 'suspicious'
  if (score >= 72) return 'authentic'
  if (score >= 45) return 'suspicious'
  return 'tampered'
}

// ── Alert generation ───────────────────────────────────────────────────────────

function buildAlerts(
  docType:   AdmissionsDocTypeResult,
  mrz:       AdmissionsMRZAnalysis | null,
  forensics: AdmissionsForensicsSignals,
  extracted: AdmissionsExtractedFields,
): AdmissionsAlert[] {

  const alerts: AdmissionsAlert[] = []

  if (!docType.isRelevant) {
    alerts.push({ level: 'warning', code: 'DOC_NOT_ADMISSIONS_RELEVANT', message: `Document type "${docType.label}" is not typically required for admissions.` })
  }

  if (docType.type === 'cv_resume') {
    alerts.push({ level: 'info', code: 'CV_UNVERIFIABLE', message: 'CVs cannot be cryptographically verified. Cross-reference with identity document and LinkedIn/professional profiles.' })
  }

  // ── MRZ alerts ─────────────────────────────────────────────────────────
  if (mrz?.detected && !mrz.valid) {
    alerts.push({ level: 'error', code: 'MRZ_CHECKSUM_FAIL', message: `MRZ check-digits failed (${mrz.checksumsFailed} of ${mrz.checksumsPassed + mrz.checksumsFailed}). Document may be altered.` })
    for (const a of mrz.alerts) {
      alerts.push({ level: 'error', code: 'MRZ_ALERT', message: a })
    }
  }

  if (docType.isIdentity && !mrz?.detected) {
    alerts.push({ level: 'warning', code: 'MRZ_NOT_FOUND', message: 'No MRZ zone detected. Ensure the full document (including bottom strip) is visible in the scan.' })
  }

  if (extracted.isExpired) {
    alerts.push({ level: 'error', code: 'DOCUMENT_EXPIRED', message: `Document expired on ${extracted.expiryDate ?? 'unknown date'}.` })
  }

  // ── Cross-validation alerts (MRZ ↔ OCR) ────────────────────────────────
  for (const cva of forensics.crossValidationAlerts) {
    alerts.push({
      level:   'error',
      code:    'CROSS_VALIDATION_MISMATCH',
      message: `⚠️ ${cva.field}: MRZ says "${cva.mrzValue}" but visual text says "${cva.ocrValue}". ${cva.detail}`,
    })
  }

  // ── ELA alerts ─────────────────────────────────────────────────────────
  if (forensics.elaScore >= 40) {
    alerts.push({
      level:   forensics.elaScore >= 60 ? 'error' : 'warning',
      code:    'ELA_MANIPULATION',
      message: `Error Level Analysis detected inconsistent JPEG compression (score: ${forensics.elaScore}/100). Regions of the image may have been edited and re-saved.`,
    })
  }

  // ── EXIF alerts ────────────────────────────────────────────────────────
  for (const ea of forensics.exifAlerts) {
    alerts.push({
      level:   ea.type === 'EDITING_SOFTWARE' ? 'error' : 'warning',
      code:    ea.type,
      message: ea.detail,
    })
  }

  // ── Text consistency alerts ────────────────────────────────────────────
  if (forensics.textConsistency >= 40) {
    alerts.push({
      level:   forensics.textConsistency >= 60 ? 'error' : 'warning',
      code:    'TEXT_INCONSISTENCY',
      message: `Text rendering analysis detected inconsistencies (score: ${forensics.textConsistency}/100). Different regions show different noise/sharpness profiles, suggesting parts of the text may have been edited.`,
    })
  }

  // ── Frequency analysis alerts ──────────────────────────────────────────
  if (forensics.frequencyScore >= 55) {
    alerts.push({ level: 'warning', code: 'FREQUENCY_ANOMALY', message: 'Spectral frequency anomalies detected. May indicate copy-paste or re-compression artifacts.' })
  }

  // ── Semantic alerts ────────────────────────────────────────────────────
  for (const sa of forensics.semanticAlerts) {
    alerts.push({ level: 'warning', code: sa.type.toUpperCase(), message: `${sa.label}: ${sa.detail}` })
  }

  return alerts
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse<AdmissionsVerifyResponse | { error: string }>> {
  const t0 = Date.now()

  let image: string
  let imageBack: string | undefined
  let userDocType: string | undefined
  try {
    const body = await req.json() as { image?: string; imageBack?: string; documentType?: string }
    image = body.image ?? ''
    imageBack = body.imageBack || undefined
    userDocType = body.documentType || undefined
    if (!image) throw new Error('missing image')
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON with { image: base64String }' }, { status: 400 })
  }

  // ── PDF detection ─────────────────────────────────────────────────────────
  const isPDF = isPdfInput(image)

  // ── Run analyses in parallel ──────────────────────────────────────────────
  // 1. OCR (Tesseract.js — handles both PDF and images)
  // 2. Face detection (face-api.js — needs raster image)
  // 3. Frequency analysis (sharp — needs raster image)

  // For face and frequency, we need a raster image
  let imageForPixel = image
  if (isPDF) {
    console.log('[admissions-verify] PDF detected — rendering to PNG for pixel analyses...')
    try {
      const { pdfFirstPageToPng } = await import('@/lib/pdfToImage')
      const png = await pdfFirstPageToPng(image)
      if (png) {
        imageForPixel = png
        console.log('[admissions-verify] PDF rendered to PNG successfully')
      } else {
        console.warn('[admissions-verify] PDF render failed — OCR-only mode')
      }
    } catch (err) {
      console.warn('[admissions-verify] PDF render error:', err instanceof Error ? err.message : err)
    }
  }

  // Run ALL analyses in parallel (6 modules)
  const canDoPixelAnalysis = imageForPixel !== image || !isPDF
  const [ocrSettled, faceSettled, frequencySettled, elaSettled, exifSettled, textConsistencySettled] = await Promise.allSettled([
    runOCR(image),
    canDoPixelAnalysis ? detectFaces(imageForPixel) : Promise.resolve(null),
    canDoPixelAnalysis ? import('@/lib/frequencyAnalysis').then(m => m.runFrequencyAnalysis(imageForPixel)) : Promise.resolve(null),
    canDoPixelAnalysis ? runELA(imageForPixel) : Promise.resolve(null),
    canDoPixelAnalysis ? runExifAnalysis(imageForPixel) : Promise.resolve(null),
    canDoPixelAnalysis ? runTextConsistencyAnalysis(imageForPixel) : Promise.resolve(null),
  ])

  // ── Extract results safely ────────────────────────────────────────────────
  const ocrResult: OcrResult | null =
    ocrSettled.status === 'fulfilled' ? ocrSettled.value : null
  const faceResult: FaceDetectionResult | null =
    faceSettled.status === 'fulfilled' ? faceSettled.value : null
  const frequencyResult =
    frequencySettled.status === 'fulfilled' ? frequencySettled.value : null
  const elaResult: ELAResult | null =
    elaSettled.status === 'fulfilled' ? elaSettled.value : null
  const exifResult: ExifForensicResult | null =
    exifSettled.status === 'fulfilled' ? exifSettled.value : null
  const textConsistencyResult: TextConsistencyResult | null =
    textConsistencySettled.status === 'fulfilled' ? textConsistencySettled.value : null

  // Log errors (non-critical — each module is independent)
  if (ocrSettled.status === 'rejected') {
    console.error('[admissions-verify] OCR error:', ocrSettled.reason)
  }
  if (faceSettled.status === 'rejected') {
    console.error('[admissions-verify] Face detection error:', faceSettled.reason)
  }
  if (frequencySettled.status === 'rejected') {
    console.error('[admissions-verify] Frequency error:', frequencySettled.reason)
  }
  if (elaSettled.status === 'rejected') {
    console.error('[admissions-verify] ELA error:', elaSettled.reason)
  }
  if (exifSettled.status === 'rejected') {
    console.error('[admissions-verify] EXIF error:', exifSettled.reason)
  }
  if (textConsistencySettled.status === 'rejected') {
    console.error('[admissions-verify] Text consistency error:', textConsistencySettled.reason)
  }

  // ── Process back image OCR if provided (DNI reverse side for MRZ) ──────
  let backOcrResult: OcrResult | null = null
  if (imageBack) {
    console.log('[admissions-verify] Processing back image for MRZ extraction...')
    try {
      backOcrResult = await runOCR(imageBack)
      console.log(`[admissions-verify] Back OCR: ${backOcrResult?.rawText?.length ?? 0} chars extracted`)
    } catch (err) {
      console.error('[admissions-verify] Back OCR error:', err instanceof Error ? err.message : err)
    }
  }

  // Merge front + back OCR text (back image typically contains MRZ zone for DNIs)
  const frontText = ocrResult?.rawText ?? ''
  const backText  = backOcrResult?.rawText ?? ''
  const ocrText   = backText ? `${frontText}\n\n--- REVERSE SIDE ---\n${backText}` : frontText
  const ocrLower  = ocrText.toLowerCase()

  // Merge key-value pairs from both sides
  const mergedKvPairs: Record<string, string> = {
    ...(ocrResult?.keyValuePairs ?? {}),
    ...(backOcrResult?.keyValuePairs ?? {}),
  }

  // ── Classify document ────────────────────────────────────────────────────
  let docType = classifyDocument(
    ocrLower,
    ocrText,
    (faceResult?.faceCount ?? 0) > 0,
  )

  // Override classification if user explicitly selected document type
  if (userDocType) {
    const typeOverrides: Record<string, Partial<AdmissionsDocTypeResult>> = {
      'passport':            { type: 'passport', label: 'International Passport', isIdentity: true, isAcademic: false, isRelevant: true },
      'dni':                 { type: 'dni', label: 'National ID Card (DNI)', isIdentity: true, isAcademic: false, isRelevant: true },
      'eu_id':               { type: 'eu_id', label: 'National Identity Card', isIdentity: true, isAcademic: false, isRelevant: true },
      'degree_certificate':  { type: 'degree_certificate', label: 'Degree / Diploma Certificate', isIdentity: false, isAcademic: true, isRelevant: true },
      'academic_transcript': { type: 'academic_transcript', label: 'Academic Transcript', isIdentity: false, isAcademic: true, isRelevant: true },
      'cv_resume':           { type: 'cv_resume', label: 'CV / Résumé', isIdentity: false, isAcademic: false, isRelevant: true },
      'other':               { type: 'other', label: 'Other Document', isIdentity: false, isAcademic: false, isRelevant: true },
    }
    const override = typeOverrides[userDocType]
    if (override) {
      docType = { ...docType, ...override, confidence: Math.max(docType.confidence, 0.90) } as AdmissionsDocTypeResult
      console.log(`[admissions-verify] User override → ${userDocType}`)
    }
  }

  // ── Parse MRZ ────────────────────────────────────────────────────────────
  const mrzAnalysis = extractMRZ(ocrText)

  // ── Extract fields ───────────────────────────────────────────────────────
  const extractedData = extractFields(
    ocrText,
    docType.type,
    mrzAnalysis,
    mergedKvPairs,
  )

  // ── Cross-validation: MRZ ↔ OCR ─────────────────────────────────────────
  let crossValidationResult: CrossValidationResult | null = null
  if (mrzAnalysis?.detected && mrzAnalysis.fields && docType.isIdentity) {
    crossValidationResult = crossValidateMRZvsOCR(
      {
        surname:        mrzAnalysis.fields.surname,
        givenNames:     mrzAnalysis.fields.givenNames,
        docNumber:      mrzAnalysis.fields.docNumber,
        dob:            mrzAnalysis.fields.dob,
        expiry:         mrzAnalysis.fields.expiry,
        nationality:    mrzAnalysis.fields.nationality,
        sex:            mrzAnalysis.fields.sex,
        issuingCountry: mrzAnalysis.fields.issuingCountry,
      },
      {
        fullName:       extractedData.fullName,
        docNumber:      extractedData.docNumber,
        dateOfBirth:    extractedData.dateOfBirth,
        expiryDate:     extractedData.expiryDate,
        nationality:    extractedData.nationality,
        sex:            extractedData.sex,
        issuingCountry: extractedData.issuingCountry,
      },
    )
    console.log(`[admissions-verify] Cross-validation: ${crossValidationResult.fieldsMatched}/${crossValidationResult.fieldsCompared} matched, score=${crossValidationResult.crossScore}`)
  }

  // ── Forensics signals (all 7 modules) ──────────────────────────────────
  const frequencyScore    = frequencyResult?.score ?? 0
  const semanticScore     = ocrResult?.semanticScore ?? 0
  const faceQualityScore  = faceResult?.score ?? 0
  const elaScore          = elaResult?.elaScore ?? 0
  const exifScore         = exifResult?.exifScore ?? 0
  const textConsistency   = textConsistencyResult?.consistencyScore ?? 0
  const crossValidation   = crossValidationResult?.crossScore ?? 0
  const ocrConfidence     = Math.max(ocrResult?.ocrConfidence ?? 0, backOcrResult?.ocrConfidence ?? 0)

  // Weighted overall risk score — all signals contribute
  const overallRiskScore = Math.round(
    frequencyScore   * 0.15 +   // FFT/wavelet
    semanticScore    * 0.15 +   // NIF/IBAN/date validation
    faceQualityScore * 0.05 +   // Face quality
    elaScore         * 0.20 +   // Error Level Analysis (strong)
    exifScore        * 0.10 +   // EXIF metadata
    textConsistency  * 0.10 +   // Text/font consistency
    crossValidation  * 0.25     // MRZ ↔ OCR cross-validation (strongest)
  )

  // Manipulation score: best single proxy = max of the strongest signals
  const manipulationScore = Math.max(
    crossValidation,           // MRZ ↔ OCR mismatch (strongest signal)
    elaScore,                  // JPEG re-compression artifacts
    Math.round(frequencyScore * 0.7 + textConsistency * 0.3),  // frequency + text
  )

  const forensics: AdmissionsForensicsSignals = {
    manipulationScore,
    frequencyScore,
    semanticScore,
    faceQualityScore,
    elaScore,
    exifScore,
    textConsistency,
    crossValidation,
    overallRiskScore,
    faceDetected:   (faceResult?.faceCount ?? 0) > 0,
    faceCount:      faceResult?.faceCount ?? 0,
    ocrConfidence,
    semanticAlerts: [
      ...(ocrResult?.semanticAlerts ?? []),
      ...(backOcrResult?.semanticAlerts ?? []),
    ].map(a => ({
      type:   a.type,
      label:  a.label,
      detail: a.detail,
    })),
    crossValidationAlerts: (crossValidationResult?.alerts ?? []).map(a => ({
      field:    a.field,
      mrzValue: a.mrzValue,
      ocrValue: a.ocrValue,
      detail:   a.detail,
    })),
    exifAlerts: (exifResult?.alerts ?? []).map(a => ({
      type:   a.type,
      detail: a.detail,
    })),
  }

  // ── Compute final score & verdict ─────────────────────────────────────────
  const authenticityScore = computeAuthenticityScore(
    {
      frequencyScore,
      semanticScore,
      faceQualityScore,
      elaScore,
      exifScore,
      textConsistency,
      crossValidation,
    },
    mrzAnalysis,
    docType,
    ocrConfidence,
  )
  const verdict = computeVerdict(authenticityScore, docType)

  // ── Build alerts ──────────────────────────────────────────────────────────
  const alerts = buildAlerts(docType, mrzAnalysis, forensics, extractedData)

  // Metadata alert
  alerts.unshift({
    level:   'info',
    code:    'PIPELINE_INFO',
    message: `7-layer forensics: OCR (${ocrResult?.engine ?? 'N/A'}) + MRZ ICAO-9303 + Cross-validation + ELA + EXIF + FFT/Wavelet + Text consistency. ${imageBack ? 'Front + back images analyzed.' : isPDF ? 'PDF rendered to PNG.' : 'Direct image analysis.'}`,
  })

  return NextResponse.json({
    documentType:      docType,
    extractedData,
    mrzAnalysis,
    forensics,
    authenticityScore,
    verdict,
    alerts,
    processingMs:       Date.now() - t0,
    backImageProcessed: !!backOcrResult,
  })
}
