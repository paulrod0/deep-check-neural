/**
 * mrzTransliteration.ts — ICAO 9303 Document Name Transliteration
 * ================================================================
 *
 * Implements ICAO Doc 9303 Part 3 transliteration tables for converting
 * names between scripts. This is essential for:
 *   - Matching MRZ names (always Latin) against local-script names
 *   - Supporting 195 countries with diverse writing systems
 *   - Handling diacritics, ligatures, and script-specific rules
 *
 * Supported scripts:
 *   - Arabic → Latin (ICAO transliteration)
 *   - Cyrillic → Latin (ICAO transliteration)
 *   - Greek → Latin
 *   - Chinese (Pinyin) → MRZ representation
 *   - Japanese (Romaji) → MRZ representation
 *   - Korean (Revised Romanization) → MRZ representation
 *   - Thai → Latin (Royal Thai General System)
 *   - Devanagari → Latin (IAST-based)
 *   - Latin diacritics → MRZ-safe ASCII
 *
 * Zero external dependencies.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TransliterationResult {
  /** Original input string */
  original: string
  /** Transliterated MRZ-safe string (uppercase, A-Z only) */
  mrzForm: string
  /** Detected source script */
  sourceScript: ScriptType
  /** Whether transliteration was applied (false if already Latin) */
  wasTransliterated: boolean
  /** Similarity score vs a reference string (0-1), if provided */
  matchScore?: number
}

export type ScriptType =
  | 'latin' | 'arabic' | 'cyrillic' | 'greek' | 'chinese'
  | 'japanese' | 'korean' | 'thai' | 'devanagari' | 'unknown'

// ── Script Detection ──────────────────────────────────────────────────────────

const SCRIPT_RANGES: [ScriptType, RegExp][] = [
  ['arabic',     /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/],
  ['cyrillic',   /[\u0400-\u04FF\u0500-\u052F]/],
  ['greek',      /[\u0370-\u03FF\u1F00-\u1FFF]/],
  ['chinese',    /[\u4E00-\u9FFF\u3400-\u4DBF]/],
  ['japanese',   /[\u3040-\u309F\u30A0-\u30FF]/],
  ['korean',     /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/],
  ['thai',       /[\u0E00-\u0E7F]/],
  ['devanagari', /[\u0900-\u097F]/],
]

export function detectScript(text: string): ScriptType {
  for (const [script, regex] of SCRIPT_RANGES) {
    if (regex.test(text)) return script
  }
  if (/[A-Za-z]/.test(text)) return 'latin'
  return 'unknown'
}

// ── Latin Diacritics → MRZ ASCII ──────────────────────────────────────────────
// ICAO 9303 Part 3, Section 6 — Transliteration of Special Characters

const LATIN_DIACRITICS: Record<string, string> = {
  // German
  'Ä': 'AE', 'ä': 'AE', 'Ö': 'OE', 'ö': 'OE', 'Ü': 'UE', 'ü': 'UE', 'ß': 'SS',
  // Nordic
  'Å': 'AA', 'å': 'AA', 'Æ': 'AE', 'æ': 'AE', 'Ø': 'OE', 'ø': 'OE',
  // French/Spanish/Portuguese
  'À': 'A', 'Á': 'A', 'Â': 'A', 'Ã': 'A', 'à': 'A', 'á': 'A', 'â': 'A', 'ã': 'A',
  'È': 'E', 'É': 'E', 'Ê': 'E', 'Ë': 'E', 'è': 'E', 'é': 'E', 'ê': 'E', 'ë': 'E',
  'Ì': 'I', 'Í': 'I', 'Î': 'I', 'Ï': 'I', 'ì': 'I', 'í': 'I', 'î': 'I', 'ï': 'I',
  'Ò': 'O', 'Ó': 'O', 'Ô': 'O', 'Õ': 'O', 'ò': 'O', 'ó': 'O', 'ô': 'O', 'õ': 'O',
  'Ù': 'U', 'Ú': 'U', 'Û': 'U', 'ù': 'U', 'ú': 'U', 'û': 'U',
  'Ý': 'Y', 'ý': 'Y', 'ÿ': 'Y',
  'Ñ': 'N', 'ñ': 'N',
  'Ç': 'C', 'ç': 'C',
  'Ð': 'D', 'ð': 'D',
  'Þ': 'TH', 'þ': 'TH',
  // Polish
  'Ą': 'A', 'ą': 'A', 'Ć': 'C', 'ć': 'C', 'Ę': 'E', 'ę': 'E',
  'Ł': 'L', 'ł': 'L', 'Ń': 'N', 'ń': 'N', 'Ś': 'S', 'ś': 'S',
  'Ź': 'Z', 'ź': 'Z', 'Ż': 'Z', 'ż': 'Z',
  // Czech/Slovak
  'Č': 'C', 'č': 'C', 'Ď': 'D', 'ď': 'D', 'Ě': 'E', 'ě': 'E',
  'Ň': 'N', 'ň': 'N', 'Ř': 'R', 'ř': 'R', 'Š': 'S', 'š': 'S',
  'Ť': 'T', 'ť': 'T', 'Ů': 'U', 'ů': 'U', 'Ž': 'Z', 'ž': 'Z',
  // Romanian (Î/î already covered in French section)
  'Ă': 'A', 'ă': 'A', 'Ș': 'S', 'ș': 'S', 'Ț': 'T', 'ț': 'T',
  // Hungarian
  'Ő': 'O', 'ő': 'O', 'Ű': 'U', 'ű': 'U',
  // Turkish
  'Ğ': 'G', 'ğ': 'G', 'İ': 'I', 'ı': 'I', 'Ş': 'S', 'ş': 'S',
  // Vietnamese/Croatian (Đ = D in ICAO standard)
  'Đ': 'D', 'đ': 'D',
}

function transliterateLatin(text: string): string {
  let result = ''
  for (const char of text) {
    result += LATIN_DIACRITICS[char] || char
  }
  return result
}

// ── Arabic → Latin (ICAO) ──────────────────────────────────────────────────

const ARABIC_MAP: Record<string, string> = {
  'ا': 'A', 'أ': 'A', 'إ': 'I', 'آ': 'AA', 'ب': 'B', 'ت': 'T', 'ث': 'TH',
  'ج': 'J', 'ح': 'H', 'خ': 'KH', 'د': 'D', 'ذ': 'DH', 'ر': 'R', 'ز': 'Z',
  'س': 'S', 'ش': 'SH', 'ص': 'S', 'ض': 'D', 'ط': 'T', 'ظ': 'DH',
  'ع': 'A', 'غ': 'GH', 'ف': 'F', 'ق': 'Q', 'ك': 'K', 'ل': 'L', 'م': 'M',
  'ن': 'N', 'ه': 'H', 'و': 'W', 'ي': 'Y', 'ى': 'A', 'ة': 'H',
  // Diacritics
  '\u064E': 'A', '\u064F': 'U', '\u0650': 'I', '\u0651': '', '\u0652': '',
  // Persian additions
  'پ': 'P', 'چ': 'CH', 'ژ': 'ZH', 'گ': 'G',
  // Urdu additions
  'ٹ': 'T', 'ڈ': 'D', 'ڑ': 'R', 'ں': 'N', 'ے': 'E',
}

function transliterateArabic(text: string): string {
  let result = ''
  for (const char of text) {
    if (char === ' ') { result += ' '; continue }
    result += ARABIC_MAP[char] || ''
  }
  return result
}

// ── Cyrillic → Latin (ICAO) ────────────────────────────────────────────────

const CYRILLIC_MAP: Record<string, string> = {
  // Russian
  'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'E',
  'Ж': 'ZH', 'З': 'Z', 'И': 'I', 'Й': 'I', 'К': 'K', 'Л': 'L', 'М': 'M',
  'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U',
  'Ф': 'F', 'Х': 'KH', 'Ц': 'TS', 'Ч': 'CH', 'Ш': 'SH', 'Щ': 'SHCH',
  'Ъ': 'IE', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'IU', 'Я': 'IA',
  // Lowercase
  'а': 'A', 'б': 'B', 'в': 'V', 'г': 'G', 'д': 'D', 'е': 'E', 'ё': 'E',
  'ж': 'ZH', 'з': 'Z', 'и': 'I', 'й': 'I', 'к': 'K', 'л': 'L', 'м': 'M',
  'н': 'N', 'о': 'O', 'п': 'P', 'р': 'R', 'с': 'S', 'т': 'T', 'у': 'U',
  'ф': 'F', 'х': 'KH', 'ц': 'TS', 'ч': 'CH', 'ш': 'SH', 'щ': 'SHCH',
  'ъ': 'IE', 'ы': 'Y', 'ь': '', 'э': 'E', 'ю': 'IU', 'я': 'IA',
  // Ukrainian additions
  'Ґ': 'G', 'ґ': 'G', 'Є': 'IE', 'є': 'IE', 'І': 'I', 'і': 'I',
  'Ї': 'I', 'ї': 'I',
  // Serbian additions
  'Ђ': 'DJ', 'ђ': 'DJ', 'Ј': 'J', 'ј': 'J', 'Љ': 'LJ', 'љ': 'LJ',
  'Њ': 'NJ', 'њ': 'NJ', 'Ћ': 'C', 'ћ': 'C', 'Џ': 'DZ', 'џ': 'DZ',
  // Note: Ъ/ъ already in Russian set (mapped to 'IE'; Bulgarian uses 'A' — Russian takes precedence)
}

function transliterateCyrillic(text: string): string {
  let result = ''
  for (const char of text) {
    if (char === ' ') { result += ' '; continue }
    result += CYRILLIC_MAP[char] || char
  }
  return result
}

// ── Greek → Latin ──────────────────────────────────────────────────────────

const GREEK_MAP: Record<string, string> = {
  'Α': 'A', 'Β': 'V', 'Γ': 'G', 'Δ': 'D', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'I',
  'Θ': 'TH', 'Ι': 'I', 'Κ': 'K', 'Λ': 'L', 'Μ': 'M', 'Ν': 'N', 'Ξ': 'X',
  'Ο': 'O', 'Π': 'P', 'Ρ': 'R', 'Σ': 'S', 'Τ': 'T', 'Υ': 'Y', 'Φ': 'F',
  'Χ': 'CH', 'Ψ': 'PS', 'Ω': 'O',
  'α': 'A', 'β': 'V', 'γ': 'G', 'δ': 'D', 'ε': 'E', 'ζ': 'Z', 'η': 'I',
  'θ': 'TH', 'ι': 'I', 'κ': 'K', 'λ': 'L', 'μ': 'M', 'ν': 'N', 'ξ': 'X',
  'ο': 'O', 'π': 'P', 'ρ': 'R', 'σ': 'S', 'ς': 'S', 'τ': 'T', 'υ': 'Y',
  'φ': 'F', 'χ': 'CH', 'ψ': 'PS', 'ω': 'O',
  // With diacritics
  'ά': 'A', 'έ': 'E', 'ή': 'I', 'ί': 'I', 'ό': 'O', 'ύ': 'Y', 'ώ': 'O',
  'ΐ': 'I', 'ΰ': 'Y', 'ϊ': 'I', 'ϋ': 'Y',
}

function transliterateGreek(text: string): string {
  let result = ''
  for (const char of text) {
    if (char === ' ') { result += ' '; continue }
    result += GREEK_MAP[char] || char
  }
  return result
}

// ── Thai → Latin (Royal Thai General System) ────────────────────────────────

const THAI_CONSONANTS: Record<string, string> = {
  'ก': 'K', 'ข': 'KH', 'ฃ': 'KH', 'ค': 'KH', 'ฅ': 'KH', 'ฆ': 'KH',
  'ง': 'NG', 'จ': 'CH', 'ฉ': 'CH', 'ช': 'CH', 'ซ': 'S', 'ฌ': 'CH',
  'ญ': 'Y', 'ฎ': 'D', 'ฏ': 'T', 'ฐ': 'TH', 'ฑ': 'TH', 'ฒ': 'TH',
  'ณ': 'N', 'ด': 'D', 'ต': 'T', 'ถ': 'TH', 'ท': 'TH', 'ธ': 'TH',
  'น': 'N', 'บ': 'B', 'ป': 'P', 'ผ': 'PH', 'ฝ': 'F', 'พ': 'PH',
  'ฟ': 'F', 'ภ': 'PH', 'ม': 'M', 'ย': 'Y', 'ร': 'R', 'ฤ': 'RUE',
  'ล': 'L', 'ฦ': 'LUE', 'ว': 'W', 'ศ': 'S', 'ษ': 'S', 'ส': 'S',
  'ห': 'H', 'ฬ': 'L', 'อ': 'O', 'ฮ': 'H',
}

const THAI_VOWELS: Record<string, string> = {
  'ะ': 'A', 'า': 'A', 'ิ': 'I', 'ี': 'I', 'ึ': 'UE', 'ื': 'UE',
  'ุ': 'U', 'ู': 'U', 'เ': 'E', 'แ': 'AE', 'โ': 'O', 'ใ': 'AI',
  'ไ': 'AI', 'ำ': 'AM',
}

function transliterateThai(text: string): string {
  let result = ''
  for (const char of text) {
    if (char === ' ') { result += ' '; continue }
    result += THAI_CONSONANTS[char] || THAI_VOWELS[char] || ''
  }
  return result
}

// ── Devanagari → Latin (simplified IAST) ────────────────────────────────────

const DEVANAGARI_MAP: Record<string, string> = {
  'अ': 'A', 'आ': 'AA', 'इ': 'I', 'ई': 'II', 'उ': 'U', 'ऊ': 'UU',
  'ए': 'E', 'ऐ': 'AI', 'ओ': 'O', 'औ': 'AU',
  'क': 'K', 'ख': 'KH', 'ग': 'G', 'घ': 'GH', 'ङ': 'NG',
  'च': 'CH', 'छ': 'CHH', 'ज': 'J', 'झ': 'JH', 'ञ': 'NY',
  'ट': 'T', 'ठ': 'TH', 'ड': 'D', 'ढ': 'DH', 'ण': 'N',
  'त': 'T', 'थ': 'TH', 'द': 'D', 'ध': 'DH', 'न': 'N',
  'प': 'P', 'फ': 'PH', 'ब': 'B', 'भ': 'BH', 'म': 'M',
  'य': 'Y', 'र': 'R', 'ल': 'L', 'व': 'V', 'श': 'SH',
  'ष': 'SH', 'स': 'S', 'ह': 'H',
  // Vowel signs
  'ा': 'A', 'ि': 'I', 'ी': 'I', 'ु': 'U', 'ू': 'U',
  'े': 'E', 'ै': 'AI', 'ो': 'O', 'ौ': 'AU',
  '्': '', // Virama (suppresses inherent 'a')
  'ं': 'N', 'ः': 'H', 'ँ': 'N',
}

function transliterateDevanagari(text: string): string {
  let result = ''
  for (const char of text) {
    if (char === ' ') { result += ' '; continue }
    result += DEVANAGARI_MAP[char] || ''
  }
  return result
}

// ── MRZ Normalization ─────────────────────────────────────────────────────────

function toMRZForm(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z ]/g, '')  // Only A-Z and spaces
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Name Similarity (Levenshtein-based) ──────────────────────────────────────

function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

export function nameSimilarity(a: string, b: string): number {
  const na = toMRZForm(a)
  const nb = toMRZForm(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const maxLen = Math.max(na.length, nb.length)
  return 1 - levenshteinDistance(na, nb) / maxLen
}

// ── Main Transliteration Function ────────────────────────────────────────────

/**
 * Transliterate a name to ICAO MRZ-safe form (uppercase Latin A-Z).
 * Automatically detects the source script and applies appropriate mapping.
 *
 * @param name The name in any supported script
 * @param referenceLatinName Optional MRZ name to compare against
 * @returns TransliterationResult with MRZ form and optional match score
 */
export function transliterateName(
  name: string,
  referenceLatinName?: string,
): TransliterationResult {
  const script = detectScript(name)
  let transliterated: string

  switch (script) {
    case 'arabic':
      transliterated = transliterateArabic(name)
      break
    case 'cyrillic':
      transliterated = transliterateCyrillic(name)
      break
    case 'greek':
      transliterated = transliterateGreek(name)
      break
    case 'thai':
      transliterated = transliterateThai(name)
      break
    case 'devanagari':
      transliterated = transliterateDevanagari(name)
      break
    case 'chinese':
    case 'japanese':
    case 'korean':
      // CJK scripts require dictionary-based romanization
      // For now, pass through any embedded Latin characters
      transliterated = name.replace(/[^\x00-\x7F]/g, '')
      break
    case 'latin':
      transliterated = transliterateLatin(name)
      break
    default:
      transliterated = name
  }

  const mrzForm = toMRZForm(transliterated)

  const result: TransliterationResult = {
    original: name,
    mrzForm,
    sourceScript: script,
    wasTransliterated: script !== 'latin' || mrzForm !== toMRZForm(name),
  }

  if (referenceLatinName) {
    result.matchScore = nameSimilarity(mrzForm, referenceLatinName)
  }

  return result
}

/**
 * Compare two names accounting for transliteration differences.
 * Returns a similarity score (0-1) after normalizing both names.
 */
export function compareNames(
  name1: string,
  name2: string,
): { score: number; name1Mrz: string; name2Mrz: string; match: boolean } {
  const t1 = transliterateName(name1)
  const t2 = transliterateName(name2)
  const score = nameSimilarity(t1.mrzForm, t2.mrzForm)
  return {
    score,
    name1Mrz: t1.mrzForm,
    name2Mrz: t2.mrzForm,
    match: score >= 0.80, // 80% threshold for name match
  }
}
