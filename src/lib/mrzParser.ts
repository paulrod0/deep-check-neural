/**
 * mrzParser.ts — Offline MRZ Parser (ICAO Doc 9303)
 * ===================================================
 * Parses Machine Readable Zone from identity documents without
 * any cloud dependency. Works on-premise and air-gapped.
 *
 * Supported formats:
 *   TD1 — 3 lines × 30 chars (EU/Spanish DNI, residence permits)
 *   TD3 — 2 lines × 44 chars (passports, visas)
 *
 * Check digit algorithm: ICAO 9303 weighted sum (7, 3, 1 cycle)
 *   A=10 … Z=35, 0-9=face value, '<'=0
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MRZFields {
  surname:     string
  givenNames:  string
  nationality: string
  docNumber:   string
  dob:         string   // YYMMDD
  dobFormatted:string   // DD/MM/YYYY (best effort)
  sex:         string
  expiry:      string   // YYMMDD
  expiryFormatted: string
  isExpired:   boolean
  personalNumber: string
}

export interface MRZAlert {
  field:  string
  detail: string
}

export interface MRZResult {
  /** Whether all check digits passed */
  valid:           boolean
  documentType:    'TD1' | 'TD3' | 'unknown'
  fields:          MRZFields
  checksumsPassed: number
  checksumsFailed: number
  alerts:          MRZAlert[]
  /** Raw MRZ lines detected */
  rawLines:        string[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EMPTY_FIELDS: MRZFields = {
  surname: '', givenNames: '', nationality: '', docNumber: '',
  dob: '', dobFormatted: '', sex: '', expiry: '', expiryFormatted: '',
  isExpired: false, personalNumber: '',
}

// ── ICAO check digit ──────────────────────────────────────────────────────────

function mrzCharValue(c: string): number {
  if (c >= '0' && c <= '9') return parseInt(c, 10)
  if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 55  // A=10 … Z=35
  return 0  // '<' and anything else
}

function checkDigit(s: string): number {
  const weights = [7, 3, 1]
  let sum = 0
  for (let i = 0; i < s.length; i++) {
    sum += mrzCharValue(s[i]) * weights[i % 3]
  }
  return sum % 10
}

function verifyCheck(field: string, expectedDigit: string): boolean {
  const expected = parseInt(expectedDigit, 10)
  if (isNaN(expected)) return false
  return checkDigit(field) === expected
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function formatMRZDate(yymmdd: string, isBirth = false): string {
  if (!/^\d{6}$/.test(yymmdd)) return yymmdd
  const yy = parseInt(yymmdd.slice(0, 2), 10)
  const mm = yymmdd.slice(2, 4)
  const dd = yymmdd.slice(4, 6)
  // Pivot: if birth year > current year → 1900s; else 2000s
  const currentYear = new Date().getFullYear() % 100
  let yyyy: number
  if (isBirth) {
    yyyy = yy > currentYear ? 1900 + yy : 2000 + yy
  } else {
    // Expiry: always future-leaning
    yyyy = yy >= 0 ? 2000 + yy : 1900 + yy
  }
  return `${dd}/${mm}/${yyyy}`
}

function isDateExpired(yymmdd: string): boolean {
  if (!/^\d{6}$/.test(yymmdd)) return false
  const yy = parseInt(yymmdd.slice(0, 2), 10)
  const mm = parseInt(yymmdd.slice(2, 4), 10) - 1
  const dd = parseInt(yymmdd.slice(4, 6), 10)
  const year = 2000 + yy  // expiry dates are always future
  const expDate = new Date(year, mm, dd)
  return expDate < new Date()
}

// ── Name parser ───────────────────────────────────────────────────────────────

function parseName(nameField: string): { surname: string; givenNames: string } {
  // Name field: SURNAME<<GIVENNAME<MIDDLE
  const parts = nameField.split('<<')
  const surname    = (parts[0] ?? '').replace(/</g, ' ').trim()
  const givenNames = (parts.slice(1).join(' ')).replace(/</g, ' ').trim()
  return { surname, givenNames }
}

// ── MRZ line detection ────────────────────────────────────────────────────────

/**
 * Detect MRZ lines from OCR text output.
 * Looks for lines of 30 or 44 uppercase alphanumeric + '<' characters.
 */
function detectMRZLines(text: string): string[] {
  const lines = text.split(/\r?\n/).map(l => l.trim())
  // TD3: 44 chars; TD1: 30 chars
  return lines.filter(l => /^[A-Z0-9<]{29,44}$/.test(l) && l.length >= 29)
}

// ── TD3 parser (Passports) ────────────────────────────────────────────────────

function parseTD3(line1: string, line2: string): Omit<MRZResult, 'rawLines'> {
  const alerts: MRZAlert[] = []
  let checksumsPassed = 0
  let checksumsFailed = 0

  const check = (field: string, digit: string, label: string) => {
    if (verifyCheck(field, digit)) {
      checksumsPassed++
    } else {
      checksumsFailed++
      alerts.push({ field: label, detail: `Check digit mismatch for ${label} field (expected ${checkDigit(field)}, got ${digit})` })
    }
  }

  // Line 1: [0] doc type (1), [1] issuing country (3), [5-43] name (39)
  const docType    = line1[0]
  const issuingCountry = line1.slice(2, 5)
  const nameField  = line1.slice(5, 44)

  // Line 2 offsets (TD3 passport):
  // [0-8]   document number (9) + check digit [9]
  // [10-19] nationality (3) + DOB (6) + check digit
  // [20-26] expiry (6) + check digit [26]
  // [27-42] personal number (14) + check digit [42]
  // [43]    final composite check digit
  const docNumber  = line2.slice(0, 9)
  const docCheck   = line2[9]
  const nationality = line2.slice(10, 13)
  const dob        = line2.slice(13, 19)
  const dobCheck   = line2[19]
  const sex        = line2[20]
  const expiry     = line2.slice(21, 27)
  const expCheck   = line2[27]
  const personalNumber = line2.slice(28, 42).replace(/</g, '').trim()
  const finalCheck = line2[43]

  check(docNumber, docCheck, 'Document number')
  check(dob, dobCheck, 'Date of birth')
  check(expiry, expCheck, 'Expiry date')

  // Composite check: doc_number + doc_check + dob + dob_check + expiry + expiry_check + personal_number + personal_check
  const composite = line2.slice(0, 10) + line2.slice(13, 20) + line2.slice(21, 43)
  check(composite, finalCheck, 'Composite check digit')

  void docType
  void issuingCountry

  const { surname, givenNames } = parseName(nameField)

  const fields: MRZFields = {
    surname,
    givenNames,
    nationality:      nationality.replace(/</g, ''),
    docNumber:        docNumber.replace(/</g, ''),
    dob,
    dobFormatted:     formatMRZDate(dob, true),
    sex:              sex === 'M' ? 'Male' : sex === 'F' ? 'Female' : 'Unspecified',
    expiry,
    expiryFormatted:  formatMRZDate(expiry, false),
    isExpired:        isDateExpired(expiry),
    personalNumber,
  }

  if (fields.isExpired) {
    alerts.push({ field: 'Expiry', detail: `Document expired on ${fields.expiryFormatted}` })
  }

  return {
    valid:        checksumsFailed === 0,
    documentType: 'TD3',
    fields,
    checksumsPassed,
    checksumsFailed,
    alerts,
  }
}

// ── TD1 parser (ID Cards — EU DNI, Residence Permits) ────────────────────────

function parseTD1(line1: string, line2: string, line3: string): Omit<MRZResult, 'rawLines'> {
  const alerts: MRZAlert[] = []
  let checksumsPassed = 0
  let checksumsFailed = 0

  const check = (field: string, digit: string, label: string) => {
    if (verifyCheck(field, digit)) {
      checksumsPassed++
    } else {
      checksumsFailed++
      alerts.push({ field: label, detail: `Check digit mismatch for ${label} (expected ${checkDigit(field)}, got ${digit})` })
    }
  }

  // Line 1 (TD1, 30 chars):
  // [0]    document type
  // [2-4]  issuing country
  // [5-14] document number (9 chars)
  // [14]   document number check digit
  // [15-29] optional data line 1
  const docNumber = line1.slice(5, 14)
  const docCheck  = line1[14]
  check(docNumber, docCheck, 'Document number')

  // Line 2 (30 chars):
  // [0-5]  DOB (6)
  // [6]    DOB check
  // [7]    sex
  // [8-13] expiry (6)
  // [14]   expiry check
  // [15-26] nationality (3) + optional
  // [27-28] composite check digits
  const dob       = line2.slice(0, 6)
  const dobCheck  = line2[6]
  const sex       = line2[7]
  const expiry    = line2.slice(8, 14)
  const expCheck  = line2[14]
  const nationality = line2.slice(15, 18)

  check(dob, dobCheck, 'Date of birth')
  check(expiry, expCheck, 'Expiry date')

  // Composite: line1[5..29] + line2[0..6] + line2[8..14] (+ optional fields)
  const composite = line1.slice(5, 30) + line2.slice(0, 7) + line2.slice(8, 15) + line2.slice(18, 29)
  const compositeCheck = line2[29]
  check(composite, compositeCheck, 'Composite check digit')

  // Line 3: name field
  const { surname, givenNames } = parseName(line3)

  const fields: MRZFields = {
    surname,
    givenNames,
    nationality:      nationality.replace(/</g, ''),
    docNumber:        docNumber.replace(/</g, ''),
    dob,
    dobFormatted:     formatMRZDate(dob, true),
    sex:              sex === 'M' ? 'Male' : sex === 'F' ? 'Female' : 'Unspecified',
    expiry,
    expiryFormatted:  formatMRZDate(expiry, false),
    isExpired:        isDateExpired(expiry),
    personalNumber:   line1.slice(15, 30).replace(/</g, '').trim(),
  }

  if (fields.isExpired) {
    alerts.push({ field: 'Expiry', detail: `Document expired on ${fields.expiryFormatted}` })
  }

  return {
    valid:        checksumsFailed === 0,
    documentType: 'TD1',
    fields,
    checksumsPassed,
    checksumsFailed,
    alerts,
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Parse MRZ from OCR text output.
 *
 * @param text - Raw text extracted from document (e.g. from Textract or canvas OCR)
 * @returns MRZResult with parsed fields, check digit results, and alerts
 *
 * @example
 * const result = parseMRZ(ocrText)
 * if (result.valid) {
 *   console.log(result.fields.surname, result.fields.docNumber)
 * }
 */
export function parseMRZ(text: string): MRZResult {
  const mrzLines = detectMRZLines(text)

  if (mrzLines.length === 0) {
    return {
      valid: false,
      documentType: 'unknown',
      fields: { ...EMPTY_FIELDS },
      checksumsPassed: 0,
      checksumsFailed: 0,
      alerts: [{ field: 'MRZ', detail: 'No MRZ lines detected in text. Document may not contain a machine-readable zone, or the image quality is insufficient for OCR.' }],
      rawLines: [],
    }
  }

  // TD3: 2 lines of 44
  const td3Lines = mrzLines.filter(l => l.length === 44)
  if (td3Lines.length >= 2) {
    const result = parseTD3(td3Lines[0], td3Lines[1])
    return { ...result, rawLines: [td3Lines[0], td3Lines[1]] }
  }

  // TD1: 3 lines of 30
  const td1Lines = mrzLines.filter(l => l.length === 30)
  if (td1Lines.length >= 3) {
    const result = parseTD1(td1Lines[0], td1Lines[1], td1Lines[2])
    return { ...result, rawLines: [td1Lines[0], td1Lines[1], td1Lines[2]] }
  }

  // Partial match — return what we have
  const partial = mrzLines[0]
  const isLong  = partial.length >= 40
  return {
    valid: false,
    documentType: isLong ? 'TD3' : 'TD1',
    fields: { ...EMPTY_FIELDS },
    checksumsPassed: 0,
    checksumsFailed: 1,
    alerts: [{ field: 'MRZ', detail: `Incomplete MRZ detected (found ${mrzLines.length} line(s), need ${isLong ? 2 : 3}). Ensure both sides of the document are captured.` }],
    rawLines: mrzLines,
  }
}

/**
 * Quick check: does the text contain a valid-looking MRZ?
 */
export function hasMRZ(text: string): boolean {
  return detectMRZLines(text).length >= 2
}
