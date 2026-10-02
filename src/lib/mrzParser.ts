/**
 * mrzParser.ts — Offline MRZ Parser (ICAO Doc 9303)
 * ===================================================
 * Parses Machine Readable Zone from identity documents without
 * any cloud dependency. Works on-premise and air-gapped.
 *
 * Supported formats:
 *   TD1  — 3 lines × 30 chars  (EU/Spanish DNI, EU residence permits)
 *   TD2  — 2 lines × 36 chars  (older EU ID cards, German Reiseausweis)
 *   TD3  — 2 lines × 44 chars  (passports, MRV-A visas)
 *   MRV-B — 2 lines × 36 chars (visa in small passport booklet, same layout as TD2)
 *
 * Check digit algorithm: ICAO 9303 weighted sum (7, 3, 1 cycle)
 *   A=10 … Z=35, 0-9=face value, '<'=0
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MRZFields {
  surname:        string
  givenNames:     string
  nationality:    string
  docNumber:      string
  dob:            string   // YYMMDD
  dobFormatted:   string   // DD/MM/YYYY (best effort)
  sex:            string
  expiry:         string   // YYMMDD
  expiryFormatted: string
  isExpired:      boolean
  personalNumber: string
  issuingCountry: string
}

export interface MRZAlert {
  field:  string
  detail: string
}

export interface MRZResult {
  /** Whether all check digits passed */
  valid:           boolean
  documentType:    'TD1' | 'TD2' | 'TD3' | 'MRV-B' | 'unknown'
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
  isExpired: false, personalNumber: '', issuingCountry: '',
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
    yyyy = 2000 + yy
  }
  return `${dd}/${mm}/${yyyy}`
}

function isDateExpired(yymmdd: string): boolean {
  if (!/^\d{6}$/.test(yymmdd)) return false
  const yy = parseInt(yymmdd.slice(0, 2), 10)
  const mm = parseInt(yymmdd.slice(2, 4), 10) - 1
  const dd = parseInt(yymmdd.slice(4, 6), 10)
  const expDate = new Date(2000 + yy, mm, dd)
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
 * Accepts lines of 30 (TD1), 36 (TD2/MRV-B), or 44 (TD3) uppercase chars + '<'.
 */
function detectMRZLines(text: string): string[] {
  const lines = text.split(/\r?\n/).map(l => l.trim().toUpperCase())
  return lines.filter(l =>
    /^[A-Z0-9<]{29,44}$/.test(l) &&
    (l.length === 30 || l.length === 36 || l.length === 44)
  )
}

// ── TD3 parser (Passports, 2×44) ─────────────────────────────────────────────

function parseTD3(line1: string, line2: string): Omit<MRZResult, 'rawLines'> {
  const alerts: MRZAlert[] = []
  let checksumsPassed = 0
  let checksumsFailed = 0

  const check = (field: string, digit: string, label: string) => {
    if (verifyCheck(field, digit)) { checksumsPassed++ }
    else {
      checksumsFailed++
      alerts.push({ field: label, detail: `Check digit mismatch (expected ${checkDigit(field)}, got ${digit})` })
    }
  }

  // Line 1: [0] doc type, [2-4] issuing country, [5-43] name (39 chars)
  const issuingCountry = line1.slice(2, 5).replace(/</g, '')
  const nameField      = line1.slice(5, 44)

  // Line 2: docNumber[0-8] + check[9] + nationality[10-12] + DOB[13-18] + check[19]
  //         + sex[20] + expiry[21-26] + check[27] + personalNum[28-41] + check[42] + composite[43]
  const docNumber      = line2.slice(0, 9)
  const nationality    = line2.slice(10, 13)
  const dob            = line2.slice(13, 19)
  const sex            = line2[20]
  const expiry         = line2.slice(21, 27)
  const personalNumber = line2.slice(28, 42).replace(/</g, '').trim()
  const finalCheck     = line2[43]

  check(docNumber,  line2[9],  'Document number')
  check(dob,        line2[19], 'Date of birth')
  check(expiry,     line2[27], 'Expiry date')

  // Composite check covers: docNum+check + DOB+check + expiry+check + personalNum+check
  const composite = line2.slice(0, 10) + line2.slice(13, 20) + line2.slice(21, 43)
  check(composite, finalCheck, 'Composite check digit')

  const { surname, givenNames } = parseName(nameField)
  const fields: MRZFields = {
    surname, givenNames,
    issuingCountry,
    nationality:     nationality.replace(/</g, ''),
    docNumber:       docNumber.replace(/</g, ''),
    dob,
    dobFormatted:    formatMRZDate(dob, true),
    sex:             sex === 'M' ? 'Male' : sex === 'F' ? 'Female' : 'Unspecified',
    expiry,
    expiryFormatted: formatMRZDate(expiry, false),
    isExpired:       isDateExpired(expiry),
    personalNumber,
  }

  if (fields.isExpired) alerts.push({ field: 'Expiry', detail: `Document expired on ${fields.expiryFormatted}` })

  return { valid: checksumsFailed === 0, documentType: 'TD3', fields, checksumsPassed, checksumsFailed, alerts }
}

// ── TD2 / MRV-B parser (EU ID cards, visas, 2×36) ────────────────────────────

function parseTD2(line1: string, line2: string): Omit<MRZResult, 'rawLines'> {
  const alerts: MRZAlert[] = []
  let checksumsPassed = 0
  let checksumsFailed = 0

  const check = (field: string, digit: string, label: string) => {
    if (verifyCheck(field, digit)) { checksumsPassed++ }
    else {
      checksumsFailed++
      alerts.push({ field: label, detail: `Check digit mismatch (expected ${checkDigit(field)}, got ${digit})` })
    }
  }

  // TD2 Line 1 (36 chars):
  // [0]    doc type
  // [2-4]  issuing country
  // [5-35] name (31 chars)
  const issuingCountry = line1.slice(2, 5).replace(/</g, '')
  const nameField      = line1.slice(5, 36)

  // TD2 Line 2 (36 chars):
  // [0-8]   document number (9)
  // [9]     doc check
  // [10-12] nationality (3)
  // [13-18] DOB (6)
  // [19]    DOB check
  // [20]    sex
  // [21-26] expiry (6)
  // [27]    expiry check
  // [28-34] optional (7)
  // [35]    final composite check
  const docNumber   = line2.slice(0, 9)
  const nationality = line2.slice(10, 13)
  const dob         = line2.slice(13, 19)
  const sex         = line2[20]
  const expiry      = line2.slice(21, 27)
  const finalCheck  = line2[35]

  check(docNumber, line2[9],  'Document number')
  check(dob,       line2[19], 'Date of birth')
  check(expiry,    line2[27], 'Expiry date')

  // Composite: docNum+check + DOB+check + expiry+check + optional
  const composite = line2.slice(0, 10) + line2.slice(13, 20) + line2.slice(21, 35)
  check(composite, finalCheck, 'Composite check digit')

  const { surname, givenNames } = parseName(nameField)

  // Detect MRV-B (visa) by doc type char = 'V'
  const docTypeChar = line1[0]
  const documentType: MRZResult['documentType'] = docTypeChar === 'V' ? 'MRV-B' : 'TD2'

  const fields: MRZFields = {
    surname, givenNames,
    issuingCountry,
    nationality:     nationality.replace(/</g, ''),
    docNumber:       docNumber.replace(/</g, ''),
    dob,
    dobFormatted:    formatMRZDate(dob, true),
    sex:             sex === 'M' ? 'Male' : sex === 'F' ? 'Female' : 'Unspecified',
    expiry,
    expiryFormatted: formatMRZDate(expiry, false),
    isExpired:       isDateExpired(expiry),
    personalNumber:  line2.slice(28, 35).replace(/</g, '').trim(),
  }

  if (fields.isExpired) alerts.push({ field: 'Expiry', detail: `Document expired on ${fields.expiryFormatted}` })

  return { valid: checksumsFailed === 0, documentType, fields, checksumsPassed, checksumsFailed, alerts }
}

// ── TD1 parser (EU DNI, Residence Permits, 3×30) ─────────────────────────────

function parseTD1(line1: string, line2: string, line3: string): Omit<MRZResult, 'rawLines'> {
  const alerts: MRZAlert[] = []
  let checksumsPassed = 0
  let checksumsFailed = 0

  const check = (field: string, digit: string, label: string) => {
    if (verifyCheck(field, digit)) { checksumsPassed++ }
    else {
      checksumsFailed++
      alerts.push({ field: label, detail: `Check digit mismatch for ${label} (expected ${checkDigit(field)}, got ${digit})` })
    }
  }

  // Line 1 (30 chars): [0] doc type, [2-4] country, [5-13] docNum, [14] check, [15-29] optional
  const issuingCountry = line1.slice(2, 5).replace(/</g, '')
  const docNumber      = line1.slice(5, 14)
  check(docNumber, line1[14], 'Document number')

  // Line 2 (30 chars): [0-5] DOB, [6] check, [7] sex, [8-13] expiry, [14] check,
  //                    [15-17] nationality, [18-28] optional, [29] composite check
  const dob         = line2.slice(0, 6)
  const sex         = line2[7]
  const expiry      = line2.slice(8, 14)
  const nationality = line2.slice(15, 18)

  check(dob,    line2[6],  'Date of birth')
  check(expiry, line2[14], 'Expiry date')

  // Composite: line1[5..29] + line2[0..6] + line2[8..14] + line2[18..28]
  const composite      = line1.slice(5, 30) + line2.slice(0, 7) + line2.slice(8, 15) + line2.slice(18, 29)
  check(composite, line2[29], 'Composite check digit')

  const { surname, givenNames } = parseName(line3)

  const fields: MRZFields = {
    surname, givenNames,
    issuingCountry,
    nationality:     nationality.replace(/</g, ''),
    docNumber:       docNumber.replace(/</g, ''),
    dob,
    dobFormatted:    formatMRZDate(dob, true),
    sex:             sex === 'M' ? 'Male' : sex === 'F' ? 'Female' : 'Unspecified',
    expiry,
    expiryFormatted: formatMRZDate(expiry, false),
    isExpired:       isDateExpired(expiry),
    personalNumber:  line1.slice(15, 30).replace(/</g, '').trim(),
  }

  if (fields.isExpired) alerts.push({ field: 'Expiry', detail: `Document expired on ${fields.expiryFormatted}` })

  return { valid: checksumsFailed === 0, documentType: 'TD1', fields, checksumsPassed, checksumsFailed, alerts }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Parse MRZ from OCR text output.
 *
 * @param text - Raw text extracted from document (Textract, Tesseract, canvas OCR, etc.)
 * @returns MRZResult with parsed fields, check digit results, and alerts
 */
export function parseMRZ(text: string): MRZResult {
  const mrzLines = detectMRZLines(text)

  if (mrzLines.length === 0) {
    return {
      valid: false, documentType: 'unknown',
      fields: { ...EMPTY_FIELDS },
      checksumsPassed: 0, checksumsFailed: 0,
      alerts: [{ field: 'MRZ', detail: 'No MRZ lines detected. Document may not contain a machine-readable zone, or image quality is insufficient for OCR.' }],
      rawLines: [],
    }
  }

  // TD3: 2 lines of 44 chars (passports)
  const td3Lines = mrzLines.filter(l => l.length === 44)
  if (td3Lines.length >= 2) {
    const result = parseTD3(td3Lines[0], td3Lines[1])
    return { ...result, rawLines: [td3Lines[0], td3Lines[1]] }
  }

  // TD1: 3 lines of 30 chars (EU DNI, residence permits)
  const td1Lines = mrzLines.filter(l => l.length === 30)
  if (td1Lines.length >= 3) {
    const result = parseTD1(td1Lines[0], td1Lines[1], td1Lines[2])
    return { ...result, rawLines: [td1Lines[0], td1Lines[1], td1Lines[2]] }
  }

  // TD2 / MRV-B: 2 lines of 36 chars (older EU ID cards, visas)
  const td2Lines = mrzLines.filter(l => l.length === 36)
  if (td2Lines.length >= 2) {
    const result = parseTD2(td2Lines[0], td2Lines[1])
    return { ...result, rawLines: [td2Lines[0], td2Lines[1]] }
  }

  // Partial MRZ — return what we have with best-guess type
  const longest = mrzLines.reduce((a, b) => a.length >= b.length ? a : b, mrzLines[0])
  const docType = longest.length >= 40 ? 'TD3' : longest.length >= 33 ? 'TD2' : 'TD1'
  const needed  = docType === 'TD1' ? 3 : 2
  return {
    valid: false, documentType: docType,
    fields: { ...EMPTY_FIELDS },
    checksumsPassed: 0, checksumsFailed: 1,
    alerts: [{ field: 'MRZ', detail: `Incomplete MRZ: found ${mrzLines.length} valid line(s), need ${needed}. Ensure all sides of the document are captured clearly.` }],
    rawLines: mrzLines,
  }
}

/**
 * Quick check: does the text likely contain a valid MRZ?
 */
export function hasMRZ(text: string): boolean {
  return detectMRZLines(text).length >= 2
}

/**
 * Human-readable label for document type codes
 */
export function documentTypeLabel(t: MRZResult['documentType']): string {
  const labels: Record<string, string> = {
    TD1: 'ID Card / Residence Permit',
    TD2: 'EU ID Card (older format)',
    TD3: 'Passport',
    'MRV-B': 'Visa',
    unknown: 'Unknown',
  }
  return labels[t] ?? t
}
