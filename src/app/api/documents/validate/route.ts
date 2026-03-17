/**
 * POST /api/documents/validate
 * =============================
 * Standalone document number validation endpoint.
 * Validates national IDs, passport numbers, IBANs, and tax codes
 * without requiring image upload or OCR.
 *
 * Useful for:
 *   - Quick KYC pre-check before full verification
 *   - Form field validation in registration flows
 *   - API integrations (programmatic validation)
 *
 * Supports 195 countries with tiered validation:
 *   Tier 1 — Full algorithmic check digit (22 countries)
 *   Tier 2 — Format/pattern validation (40+ countries)
 *   Tier 3 — Basic validation (remaining countries)
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  autoValidateDocument,
  validateIBAN,
  validatePassportNumber,
  getCountryByCode,
  validateSpanishNIF,
  validateItalianCF,
  validateBrazilCPF,
  validateChileRUN,
  validateMexicoCURP,
  validateTurkeyTC,
  validateIndiaAadhaar,
  validateSouthAfricaID,
  validateGermanID,
  validateSingaporeNRIC,
  validateSouthKoreaRRN,
  validateJapanMyNumber,
  validatePolandPESEL,
  validateRomaniaCNP,
  validateCzechRC,
  validateNetherlandsBSN,
  validateBelgiumNN,
  validateChinaID,
  validateEcuadorCedula,
  type ValidationResult,
} from '@/lib/countryValidators'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ValidateRequest {
  /** The document number to validate */
  documentNumber: string
  /** ISO 3166-1 country code (alpha-2 or alpha-3) OR MRZ nationality code */
  countryCode?: string
  /** Document type hint: 'nif', 'passport', 'iban', 'national_id', 'tax_id' */
  documentType?: string
}

// ── Named validators by type ─────────────────────────────────────────────────

const NAMED_VALIDATORS: Record<string, (num: string) => ValidationResult> = {
  'nif':           validateSpanishNIF,
  'nie':           validateSpanishNIF,
  'codice_fiscale': validateItalianCF,
  'cpf':           validateBrazilCPF,
  'run':           validateChileRUN,
  'rut':           validateChileRUN,
  'curp':          validateMexicoCURP,
  'tc_kimlik':     validateTurkeyTC,
  'aadhaar':       validateIndiaAadhaar,
  'sa_id':         validateSouthAfricaID,
  'personalausweis': validateGermanID,
  'nric':          validateSingaporeNRIC,
  'fin':           validateSingaporeNRIC,
  'rrn':           validateSouthKoreaRRN,
  'my_number':     validateJapanMyNumber,
  'pesel':         validatePolandPESEL,
  'cnp':           validateRomaniaCNP,
  'rodne_cislo':   validateCzechRC,
  'bsn':           validateNetherlandsBSN,
  'nn':            validateBelgiumNN,
  'china_id':      validateChinaID,
  'cedula_ec':     validateEcuadorCedula,
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: ValidateRequest
  try {
    body = await req.json() as ValidateRequest
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { documentNumber, countryCode, documentType } = body

  if (!documentNumber) {
    return NextResponse.json(
      { error: 'documentNumber is required' },
      { status: 400 },
    )
  }

  let result: ValidationResult | null = null

  // 1. Try named document type first
  if (documentType) {
    const normalizedType = documentType.toLowerCase().replace(/[\s-]/g, '_')

    if (normalizedType === 'iban') {
      result = validateIBAN(documentNumber)
    } else if (normalizedType === 'passport') {
      result = validatePassportNumber(documentNumber, countryCode)
    } else if (NAMED_VALIDATORS[normalizedType]) {
      result = NAMED_VALIDATORS[normalizedType](documentNumber)
    }
  }

  // 2. Try auto-detection from country code
  if (!result && countryCode) {
    result = autoValidateDocument(countryCode, documentNumber)
  }

  // 3. Try IBAN auto-detection (starts with 2 letters)
  if (!result && /^[A-Z]{2}/i.test(documentNumber.replace(/\s/g, ''))) {
    const ibanResult = validateIBAN(documentNumber)
    if (ibanResult.valid) result = ibanResult
  }

  // 4. Fallback: validate as generic passport number
  if (!result) {
    result = validatePassportNumber(documentNumber, countryCode)
  }

  // Enrich with country info
  const country = countryCode ? getCountryByCode(countryCode) : null

  return NextResponse.json({
    ...result,
    countryInfo: country ? {
      name:    country.name,
      region:  country.region,
      idTypes: country.idTypes,
      hasNFC:  country.hasNFC,
    } : null,
  })
}
