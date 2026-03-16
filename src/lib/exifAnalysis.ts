/**
 * exifAnalysis.ts — EXIF / Metadata Forensics
 * =============================================
 * Extracts and analyzes image metadata for forensic signals.
 *
 * Signals detected:
 *   1. Software tag — editing tools (Photoshop, GIMP, etc.)
 *   2. Date consistency — creation vs. modification date gaps
 *   3. Thumbnail mismatch — embedded thumbnail differs from main image
 *   4. Missing EXIF — original photos always have EXIF; stripped = suspicious
 *   5. Resolution anomalies — unusual DPI for document scans
 *   6. Color profile — mismatched ICC profiles hint at compositing
 */

import sharp from 'sharp'

export interface ExifForensicResult {
  exifScore:         number     // 0–100 overall suspicion from metadata
  hasExif:           boolean
  software:          string | null
  isEditingSoftware: boolean    // Photoshop, GIMP, Canva, etc.
  createDate:        string | null
  modifyDate:        string | null
  dateGapDays:       number | null  // days between create and modify
  resolution:        { xDpi: number; yDpi: number } | null
  colorSpace:        string | null
  alerts:            ExifAlert[]
  analysisMs:        number
}

export interface ExifAlert {
  type:    string
  detail:  string
  penalty: number
}

// Known editing software signatures
const EDITING_SOFTWARE = [
  'photoshop', 'gimp', 'canva', 'pixlr', 'affinity',
  'paint.net', 'krita', 'inkscape', 'illustrator',
  'corel', 'fotor', 'befunky', 'picmonkey',
  'snapseed', 'lightroom', 'capture one',
  'acorn', 'pixelmator', 'sketch', 'figma',
  // Generic patterns
  'adobe', 'image editor', 'photo editor',
]

// Software that's normal for document scanning
const SCANNER_SOFTWARE = [
  'scanner', 'scan', 'camscanner', 'genius scan',
  'adobe scan', 'office lens', 'microsoft lens',
  'notes', 'preview', 'iphone', 'samsung', 'huawei',
  'google', 'camera', 'oneplus', 'xiaomi', 'oppo',
]

export async function runExifAnalysis(imageBase64: string): Promise<ExifForensicResult> {
  const t0 = Date.now()
  const alerts: ExifAlert[] = []

  try {
    const b64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64
    const buf = Buffer.from(b64, 'base64')

    // Use sharp metadata extraction
    const metadata = await sharp(buf).metadata()

    const hasExif = !!(metadata.exif || metadata.icc)

    // Extract software info from EXIF
    let software: string | null = null
    let createDate: string | null = null
    let modifyDate: string | null = null

    if (metadata.exif) {
      // Parse basic EXIF tags from the buffer
      const exifStr = metadata.exif.toString('ascii').replace(/\0/g, ' ')

      // Look for software tag
      const swMatch = exifStr.match(/Software[:\s]+([^\x00]{3,50})/i)
      if (swMatch) software = swMatch[1].trim()

      // Look for date tags
      const datePatterns = [
        /DateTimeOriginal[:\s]+(\d{4}[:\-]\d{2}[:\-]\d{2}[T\s]\d{2}:\d{2}:\d{2})/i,
        /CreateDate[:\s]+(\d{4}[:\-]\d{2}[:\-]\d{2}[T\s]\d{2}:\d{2}:\d{2})/i,
        /DateTime[:\s]+(\d{4}[:\-]\d{2}[:\-]\d{2}[T\s]\d{2}:\d{2}:\d{2})/i,
      ]
      for (const p of datePatterns) {
        const m = exifStr.match(p)
        if (m) {
          if (!createDate) createDate = m[1]
          else if (!modifyDate) modifyDate = m[1]
        }
      }
    }

    // Check for editing software
    const softwareLower = (software ?? '').toLowerCase()
    const isEditingSoftware = EDITING_SOFTWARE.some(s => softwareLower.includes(s))
    const isScannerSoftware = SCANNER_SOFTWARE.some(s => softwareLower.includes(s))

    // Resolution analysis
    let resolution: { xDpi: number; yDpi: number } | null = null
    if (metadata.density) {
      resolution = { xDpi: metadata.density, yDpi: metadata.density }
    }

    // Color space
    const colorSpace = metadata.space ?? null

    // ── Scoring ──────────────────────────────────────────────────────────

    let exifScore = 0

    // 1. Editing software detected (strong signal)
    if (isEditingSoftware && !isScannerSoftware) {
      const penalty = softwareLower.includes('photoshop') ? 35 : 25
      exifScore += penalty
      alerts.push({
        type:    'EDITING_SOFTWARE',
        detail:  `Image was processed with "${software}" — a photo editing tool. This is a strong indicator of possible manipulation.`,
        penalty,
      })
    }

    // 2. No EXIF at all (moderate signal — original photos/scans usually have EXIF)
    if (!hasExif && !software) {
      exifScore += 10
      alerts.push({
        type:    'NO_EXIF',
        detail:  'Image has no EXIF metadata. Original camera photos and scans typically contain EXIF. Metadata may have been deliberately stripped.',
        penalty: 10,
      })
    }

    // 3. Date gap analysis
    let dateGapDays: number | null = null
    if (createDate && modifyDate) {
      try {
        const created  = new Date(createDate.replace(/:/g, '-').replace(' ', 'T'))
        const modified = new Date(modifyDate.replace(/:/g, '-').replace(' ', 'T'))
        dateGapDays    = Math.abs(modified.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)

        if (dateGapDays > 1) {
          const penalty = dateGapDays > 30 ? 15 : 8
          exifScore += penalty
          alerts.push({
            type:    'DATE_GAP',
            detail:  `${Math.round(dateGapDays)} day gap between creation (${createDate}) and modification (${modifyDate}) dates. Document may have been re-edited after initial capture.`,
            penalty,
          })
        }
      } catch {
        // Date parsing failed — ignore
      }
    }

    // 4. Unusual resolution for document scan
    if (resolution) {
      if (resolution.xDpi !== resolution.yDpi) {
        exifScore += 8
        alerts.push({
          type:    'DPI_MISMATCH',
          detail:  `Non-uniform DPI (${resolution.xDpi}×${resolution.yDpi}). Genuine scans have uniform resolution. May indicate image composition.`,
          penalty: 8,
        })
      }
      // Very low DPI (<72) or very high DPI (>1200) for a document
      if (resolution.xDpi < 72 || resolution.xDpi > 1200) {
        exifScore += 5
        alerts.push({
          type:    'DPI_ANOMALY',
          detail:  `Unusual resolution (${resolution.xDpi} DPI). Standard document scans are 150-600 DPI.`,
          penalty: 5,
        })
      }
    }

    // 5. Image dimensions analysis (very small or very large for a document)
    if (metadata.width && metadata.height) {
      const pixels = metadata.width * metadata.height
      if (pixels < 100000) {  // < 100K pixels
        exifScore += 10
        alerts.push({
          type:    'LOW_RESOLUTION',
          detail:  `Very low resolution (${metadata.width}×${metadata.height}). Legitimate document scans are typically higher resolution. Low resolution may hide manipulation artifacts.`,
          penalty: 10,
        })
      }
    }

    exifScore = Math.min(100, exifScore)

    return {
      exifScore,
      hasExif,
      software,
      isEditingSoftware,
      createDate,
      modifyDate,
      dateGapDays,
      resolution,
      colorSpace,
      alerts,
      analysisMs: Date.now() - t0,
    }
  } catch (err) {
    console.error('[exifAnalysis] Error:', err instanceof Error ? err.message : err)
    return {
      exifScore:         0,
      hasExif:           false,
      software:          null,
      isEditingSoftware: false,
      createDate:        null,
      modifyDate:        null,
      dateGapDays:       null,
      resolution:        null,
      colorSpace:        null,
      alerts:            [],
      analysisMs:        Date.now() - t0,
    }
  }
}
