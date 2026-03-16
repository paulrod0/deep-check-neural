/**
 * crossValidation.ts — MRZ ↔ OCR Cross-Validation
 * ==================================================
 * Compares fields extracted from the MRZ zone against fields extracted
 * from the visual (OCR) zone of the document.
 *
 * Why this is critical:
 *   - Manipulators often edit the visual text (name, number, photo) but
 *     forget to update the MRZ zone (or vice versa).
 *   - Even if MRZ check digits pass and NIF validation passes, a mismatch
 *     between MRZ and visual text is a STRONG manipulation signal.
 *
 * Signals:
 *   1. Name mismatch — MRZ surname/given vs. OCR name
 *   2. Document number mismatch — MRZ docNumber vs. OCR number
 *   3. Date of birth mismatch — MRZ DOB vs. OCR DOB
 *   4. Nationality mismatch — MRZ nationality vs. OCR nationality
 *   5. Expiry date mismatch — MRZ expiry vs. OCR expiry
 *   6. Sex mismatch — MRZ sex vs. OCR sex
 */

export interface CrossValidationAlert {
  field:      string
  mrzValue:   string
  ocrValue:   string
  severity:   'critical' | 'warning'
  detail:     string
  penalty:    number   // 0–100
}

export interface CrossValidationResult {
  crossScore:      number     // 0–100 (0 = consistent, 100 = total mismatch)
  fieldsCompared:  number
  fieldsMatched:   number
  fieldsMismatched: number
  alerts:          CrossValidationAlert[]
}

/**
 * Normalise a text field for comparison:
 *   - Uppercase, trim, remove accents, collapse whitespace
 *   - Remove common filler characters
 */
function normalise(s: string | undefined): string {
  if (!s) return ''
  return s
    .toUpperCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip accents
    .replace(/[<.,\-_\/\\]/g, ' ')    // replace common separators
    .replace(/\s+/g, ' ')            // collapse whitespace
    .trim()
}

/**
 * Fuzzy string comparison: returns similarity 0–1
 * Uses longest common subsequence (LCS) ratio
 */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1

  const an = normalise(a)
  const bn = normalise(b)
  if (an === bn) return 1
  if (!an || !bn) return 0

  // Check if one contains the other (common for partial name extraction)
  if (an.includes(bn) || bn.includes(an)) return 0.85

  // LCS-based similarity
  const m = an.length
  const n = bn.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (an[i - 1] === bn[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  return (2 * dp[m][n]) / (m + n)
}

/**
 * Normalise date strings for comparison.
 * Converts various formats to YYYYMMDD for reliable comparison.
 */
function normaliseDate(d: string | undefined): string {
  if (!d) return ''
  // Remove separators
  const clean = d.replace(/[\/\-\.\s]/g, '')

  // YYMMDD (6 digits) → YYYYMMDD
  if (/^\d{6}$/.test(clean)) {
    const yy = parseInt(clean.slice(0, 2), 10)
    const yyyy = yy > 50 ? 1900 + yy : 2000 + yy
    return `${yyyy}${clean.slice(2)}`
  }

  // DDMMYYYY (8 digits)
  if (/^\d{8}$/.test(clean)) {
    const dd = clean.slice(0, 2)
    const mm = clean.slice(2, 4)
    const yyyy = clean.slice(4, 8)
    // If first part > 12, it's DD/MM/YYYY format
    if (parseInt(dd, 10) > 12) {
      return `${yyyy}${mm}${dd}`
    }
    // If last part is a year (starts with 19 or 20)
    if (yyyy.startsWith('19') || yyyy.startsWith('20')) {
      return `${yyyy}${mm}${dd}`
    }
    // Assume DDMMYYYY
    return `${yyyy}${mm}${dd}`
  }

  return clean
}

/**
 * Normalise document number for comparison.
 * Remove filler characters and normalize.
 */
function normaliseDocNumber(n: string | undefined): string {
  if (!n) return ''
  return n
    .toUpperCase()
    .replace(/[<\s\-\.]/g, '')
    .trim()
}

export interface MRZFieldsForCrossValidation {
  surname?:        string
  givenNames?:     string
  docNumber?:      string
  dob?:            string
  expiry?:         string
  nationality?:    string
  sex?:            string
  issuingCountry?: string
}

export interface OCRFieldsForCrossValidation {
  fullName?:       string
  docNumber?:      string
  dateOfBirth?:    string
  expiryDate?:     string
  nationality?:    string
  sex?:            string
  issuingCountry?: string
}

export function crossValidateMRZvsOCR(
  mrz: MRZFieldsForCrossValidation,
  ocr: OCRFieldsForCrossValidation,
): CrossValidationResult {

  const alerts: CrossValidationAlert[] = []
  let fieldsCompared = 0
  let fieldsMatched  = 0

  // ── 1. Name comparison ──────────────────────────────────────────────
  const mrzFullName = normalise([mrz.surname, mrz.givenNames].filter(Boolean).join(' '))
  const ocrFullName = normalise(ocr.fullName)

  if (mrzFullName && ocrFullName) {
    fieldsCompared++
    const sim = similarity(mrzFullName, ocrFullName)

    if (sim >= 0.7) {
      fieldsMatched++
    } else {
      alerts.push({
        field:    'Full Name',
        mrzValue: mrzFullName,
        ocrValue: ocrFullName,
        severity: 'critical',
        detail:   `Name in MRZ ("${mrzFullName}") does not match visual text ("${ocrFullName}"). Similarity: ${(sim * 100).toFixed(0)}%. This is a strong indicator of document tampering.`,
        penalty:  40,
      })
    }
  }

  // ── 2. Document number comparison ────────────────────────────────────
  const mrzDocNum = normaliseDocNumber(mrz.docNumber)
  const ocrDocNum = normaliseDocNumber(ocr.docNumber)

  if (mrzDocNum && ocrDocNum) {
    fieldsCompared++
    if (mrzDocNum === ocrDocNum || mrzDocNum.includes(ocrDocNum) || ocrDocNum.includes(mrzDocNum)) {
      fieldsMatched++
    } else {
      alerts.push({
        field:    'Document Number',
        mrzValue: mrzDocNum,
        ocrValue: ocrDocNum,
        severity: 'critical',
        detail:   `Document number in MRZ ("${mrzDocNum}") does not match visual text ("${ocrDocNum}"). This is a critical indicator of document forgery.`,
        penalty:  50,
      })
    }
  }

  // ── 3. Date of birth comparison ──────────────────────────────────────
  const mrzDob = normaliseDate(mrz.dob)
  const ocrDob = normaliseDate(ocr.dateOfBirth)

  if (mrzDob && ocrDob) {
    fieldsCompared++
    if (mrzDob === ocrDob) {
      fieldsMatched++
    } else {
      alerts.push({
        field:    'Date of Birth',
        mrzValue: mrz.dob ?? '',
        ocrValue: ocr.dateOfBirth ?? '',
        severity: 'critical',
        detail:   `Date of birth in MRZ ("${mrz.dob}") does not match visual text ("${ocr.dateOfBirth}"). Document may have been altered.`,
        penalty:  35,
      })
    }
  }

  // ── 4. Expiry date comparison ──────────────────────────────────────
  const mrzExpiry = normaliseDate(mrz.expiry)
  const ocrExpiry = normaliseDate(ocr.expiryDate)

  if (mrzExpiry && ocrExpiry) {
    fieldsCompared++
    if (mrzExpiry === ocrExpiry) {
      fieldsMatched++
    } else {
      alerts.push({
        field:    'Expiry Date',
        mrzValue: mrz.expiry ?? '',
        ocrValue: ocr.expiryDate ?? '',
        severity: 'warning',
        detail:   `Expiry date in MRZ ("${mrz.expiry}") does not match visual text ("${ocr.expiryDate}").`,
        penalty:  20,
      })
    }
  }

  // ── 5. Nationality comparison ──────────────────────────────────────
  const mrzNat = normalise(mrz.nationality)
  const ocrNat = normalise(ocr.nationality)

  if (mrzNat && ocrNat) {
    fieldsCompared++
    // Allow for common equivalences (ESP = ESPAÑOLA = SPANISH)
    const natEquivalences: Record<string, string[]> = {
      'ESP': ['ESPANOLA', 'ESPANOL', 'SPANISH', 'ESP'],
      'GBR': ['BRITISH', 'UNITED KINGDOM', 'GBR', 'UK'],
      'DEU': ['GERMAN', 'DEUTSCH', 'DEU'],
      'FRA': ['FRENCH', 'FRANCAIS', 'FRANCAISE', 'FRA'],
      'ITA': ['ITALIAN', 'ITALIANA', 'ITALIANO', 'ITA'],
      'PRT': ['PORTUGUESE', 'PORTUGUESA', 'PRT'],
      'USA': ['AMERICAN', 'UNITED STATES', 'USA'],
    }
    let natMatch = mrzNat === ocrNat
    if (!natMatch) {
      for (const [code, aliases] of Object.entries(natEquivalences)) {
        if ((mrzNat === code || aliases.includes(mrzNat)) &&
            (ocrNat === code || aliases.includes(ocrNat))) {
          natMatch = true
          break
        }
      }
    }

    if (natMatch) {
      fieldsMatched++
    } else {
      alerts.push({
        field:    'Nationality',
        mrzValue: mrzNat,
        ocrValue: ocrNat,
        severity: 'warning',
        detail:   `Nationality in MRZ ("${mrzNat}") does not match visual text ("${ocrNat}").`,
        penalty:  15,
      })
    }
  }

  // ── 6. Sex comparison ────────────────────────────────────────────────
  const mrzSex = normalise(mrz.sex)
  const ocrSex = normalise(ocr.sex)

  if (mrzSex && ocrSex) {
    fieldsCompared++
    const sexMap: Record<string, string[]> = {
      'M': ['M', 'MALE', 'MASCULINO', 'HOMME', 'MANNLICH'],
      'F': ['F', 'FEMALE', 'FEMENINO', 'FEMME', 'WEIBLICH'],
    }
    let sexMatch = mrzSex === ocrSex
    if (!sexMatch) {
      for (const [, aliases] of Object.entries(sexMap)) {
        if (aliases.includes(mrzSex) && aliases.includes(ocrSex)) {
          sexMatch = true
          break
        }
      }
    }

    if (sexMatch) {
      fieldsMatched++
    } else {
      alerts.push({
        field:    'Sex',
        mrzValue: mrzSex,
        ocrValue: ocrSex,
        severity: 'warning',
        detail:   `Sex field in MRZ ("${mrzSex}") does not match visual text ("${ocrSex}").`,
        penalty:  15,
      })
    }
  }

  // ── Compute overall cross-validation score ────────────────────────
  const totalPenalty = alerts.reduce((s, a) => s + a.penalty, 0)
  const crossScore   = Math.min(100, totalPenalty)

  return {
    crossScore,
    fieldsCompared,
    fieldsMatched,
    fieldsMismatched: fieldsCompared - fieldsMatched,
    alerts,
  }
}
