/**
 * Deep-Check · Forensic PDF Report Generator
 * Generates a professional-grade forensic report using jsPDF.
 * Suitable as technical evidence for administrative and legal proceedings.
 *
 * Usage (client-side only):
 *   import { generateForensicPDF } from '@/lib/forensicReport'
 *   await generateForensicPDF(reportData, 'DNI_scan.jpg', 'EXP-2024-001')
 */
'use client'

import { jsPDF } from 'jspdf'
import type { ForensicsReport } from './imageForensics'
import type { DocumentType } from './documentClassifier'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ForensicReportInput {
    report: ForensicsReport
    filename: string
    caseRef?: string
    analystName?: string
    documentType?: DocumentType
    cloneRegionsCount?: number
    /** Base64 data URL of the original thumbnail (stored in DB) */
    thumbnailUrl?: string | null
}

// ─── Colour helpers ────────────────────────────────────────────────────────────

type RGB = [number, number, number]

function riskRGB(score: number): RGB {
    return score >= 60 ? [220, 38, 38] : score >= 30 ? [217, 119, 6] : [34, 197, 94]
}

function severityRGB(sev: 'high' | 'medium' | 'low'): RGB {
    return sev === 'high' ? [220, 38, 38] : sev === 'medium' ? [217, 119, 6] : [80, 150, 80]
}

// ─── XAI text builders ────────────────────────────────────────────────────────

function buildSummary(r: ForensicsReport, filename: string): string {
    const verdict =
        r.riskLevel === 'high_risk'
            ? 'presenta indicios técnicos significativos de manipulación digital'
            : r.riskLevel === 'suspicious'
            ? 'presenta anomalías técnicas que requieren investigación adicional'
            : 'no presenta indicios significativos de manipulación digital'

    const high = r.alerts.filter(a => a.severity === 'high').length
    const total = r.alerts.length

    return (
        `El archivo "${filename}" ${verdict} (puntuación de riesgo global: ${r.riskScore}/100).\n\n` +
        `Se han aplicado tres módulos de análisis independientes: ` +
        `análisis de nivel de error JPEG (ELA), validación de metadatos EXIF y análisis de distribución ` +
        `de ruido para detección de imágenes sintéticas generadas por IA. ` +
        (total > 0
            ? `Se identificaron ${total} indicador${total !== 1 ? 'es' : ''} de anomalía, de los cuales ${high} son de severidad alta.`
            : 'Ninguno de los módulos detectó anomalías significativas.')
    )
}

function buildELAExplanation(r: ForensicsReport): string {
    const { ela } = r
    if (ela.score >= 65)
        return `Puntuación alta (${ela.score}/100). Se detectaron ${ela.suspiciousRegions} bloques de 8×8 px con historial de compresión inconsistente (diferencia media amplificada: ${ela.meanDiff.toFixed(1)}). Indica que regiones específicas fueron modificadas y re-guardadas tras la compresión JPEG original.`
    if (ela.score >= 35)
        return `Puntuación moderada (${ela.score}/100). ${ela.suspiciousRegions} bloques presentan diferencia de compresión elevada. Puede indicar retoque localizado o múltiples ciclos de compresión. Se recomienda análisis complementario.`
    if (ela.score < 8)
        return `Puntuación muy baja (${ela.score}/100). Ausencia de artefactos JPEG característicos de fotografías reales. Patrón consistente con imágenes generadas sintéticamente (IA generativa) o capturas de pantalla sin historial de compresión previo.`
    return `Puntuación normal (${ela.score}/100). Artefactos de compresión JPEG uniformes sin anomalías. Historial de compresión consistente en toda la imagen.`
}

function buildEXIFExplanation(r: ForensicsReport): string {
    const { exif } = r
    const parts: string[] = []
    if (exif.editSoftwareDetected)
        parts.push(`Software de edición detectado en metadatos: "${exif.software}".`)
    if (exif.dateTimeInconsistency)
        parts.push('Inconsistencia entre DateTimeOriginal y DateTime: el archivo fue editado tras su captura.')
    if (exif.flags.includes('no_exif_data'))
        parts.push('Ausencia total de metadatos EXIF — inusual en imágenes de dispositivos reales; sugiere imagen sintética o captura de pantalla.')
    if (exif.flags.includes('no_camera_make'))
        parts.push('No se identificó fabricante ni modelo del dispositivo de captura.')
    if (parts.length === 0)
        return `Puntuación normal (${exif.score}/100). Metadatos EXIF consistentes con una fotografía original sin edición.`
    return `Puntuación ${exif.score >= 60 ? 'alta' : 'moderada'} (${exif.score}/100). ${parts.join(' ')}`
}

function buildNoiseExplanation(r: ForensicsReport): string {
    const { noise } = r
    if (noise.score >= 65)
        return `Puntuación alta (${noise.score}/100). Varianza Laplaciana: ${noise.laplacianVariance.toFixed(1)}. Uniformidad entre bloques: ${(noise.uniformityScore * 100).toFixed(0)}%. Patrón estadístico consistente con imágenes generadas por modelos de IA (GANs, modelos de difusión). Las fotografías reales exhiben ruido heterogéneo del sensor.`
    if (noise.score >= 40)
        return `Puntuación moderada (${noise.score}/100). Uniformidad de ruido ligeramente atípica. Puede corresponder a imagen renderizada, fotografía con reducción de ruido agresiva o imagen sintética.`
    return `Puntuación normal (${noise.score}/100). Distribución de ruido (varianza Laplaciana: ${noise.laplacianVariance.toFixed(1)}) consistente con fotografía real.`
}

function buildConclusion(r: ForensicsReport, filename: string, docType?: DocumentType): string {
    const highAlerts = r.alerts.filter(a => a.severity === 'high')
    const docDesc = docType && docType !== 'desconocido' ? ` (clasificado como: ${DOC_TYPE_LABELS[docType]})` : ''

    if (r.riskLevel === 'high_risk')
        return (
            `Con base en el análisis multi-módulo del archivo "${filename}"${docDesc}, el sistema detecta indicios técnicos significativos de manipulación. ` +
            (highAlerts.length > 0 ? `Hallazgos críticos: ${highAlerts.map(a => a.label).join('; ')}. ` : '') +
            `Recomendaciones: (1) no aceptar este documento como válido sin verificación adicional; ` +
            `(2) solicitar el original en soporte físico o en formato RAW sin procesar; ` +
            `(3) remitir a análisis pericial forense certificado si se utilizará como evidencia en procedimiento administrativo o judicial. ` +
            `Este informe constituye evidencia técnica preliminar.`
        )

    if (r.riskLevel === 'suspicious')
        return (
            `El análisis del archivo "${filename}"${docDesc} revela anomalías técnicas que no permiten certificar su autenticidad con plena confianza. ` +
            `Se recomienda solicitar documentación adicional o el archivo original antes de aceptarlo en un proceso formal. ` +
            `El nivel de riesgo (${r.riskScore}/100) no es concluyente pero justifica precaución adicional.`
        )

    return (
        `El análisis forense del archivo "${filename}"${docDesc} no detecta indicios significativos de manipulación digital. ` +
        `Los tres módulos (ELA, EXIF, Ruido) presentan valores dentro de rangos esperados para una imagen auténtica. ` +
        `Esto no certifica de manera absoluta la autenticidad: existen técnicas de manipulación avanzada que pueden eludir el análisis automatizado. ` +
        `Para casos de alta criticidad se recomienda la verificación pericial humana.`
    )
}

const DOC_TYPE_LABELS: Record<string, string> = {
    dni: 'DNI / Documento de Identidad',
    factura: 'Factura / Documento Financiero',
    foto_persona: 'Fotografía de Persona',
    captura_pantalla: 'Captura de Pantalla',
    documento_generico: 'Documento Genérico',
    desconocido: 'Tipo Desconocido',
}

// ─── PDF builder ──────────────────────────────────────────────────────────────

export async function generateForensicPDF(input: ForensicReportInput): Promise<void> {
    const { report, filename, caseRef, analystName, documentType, cloneRegionsCount, thumbnailUrl } = input

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const W = 210
    const MARGIN = 18
    const CW = W - 2 * MARGIN   // content width
    let y = 0
    let sectionIdx = 0

    function nextSection(title: string, spaceNeeded = 20): string {
        checkPage(spaceNeeded)
        sectionIdx++
        doc.setDrawColor(200, 200, 220)
        doc.setLineWidth(0.3)
        doc.line(MARGIN, y, W - MARGIN, y)
        y += 5
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(11)
        doc.setTextColor(20, 20, 50)
        doc.text(`${sectionIdx}. ${title}`, MARGIN, y)
        y += 7
        return `${sectionIdx}`
    }

    function checkPage(needed: number) {
        if (y + needed > 278) {
            doc.addPage()
            y = 15
        }
    }

    function textBlock(text: string, fontSize = 8.5, color: RGB = [55, 55, 75]) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(fontSize)
        doc.setTextColor(...color)
        const lines = doc.splitTextToSize(text, CW)
        checkPage(lines.length * (fontSize * 0.38) + 5)
        doc.text(lines, MARGIN, y)
        y += lines.length * (fontSize * 0.38) + 4
    }

    // ── Cover header ──────────────────────────────────────────────────────────
    doc.setFillColor(8, 8, 28)
    doc.rect(0, 0, 210, 46, 'F')

    // Logo area
    doc.setFillColor(0, 200, 155)
    doc.roundedRect(MARGIN, 8, 34, 14, 2, 2, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(8, 8, 28)
    doc.text('DEEP-CHECK', MARGIN + 2, 17)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    doc.setTextColor(255, 255, 255)
    doc.text('INFORME FORENSE DIGITAL', MARGIN + 38, 16)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(180, 180, 210)
    doc.text('Análisis de Autenticidad de Imagen · Deep-Check Forensics Engine v2.0', MARGIN + 38, 22)

    // Risk badge (top right)
    const [rR, rG, rB] = riskRGB(report.riskScore)
    const riskLabel =
        report.riskLevel === 'high_risk' ? 'ALTO RIESGO'
        : report.riskLevel === 'suspicious' ? 'SOSPECHOSO'
        : 'LIMPIO'
    const badgeX = W - MARGIN - 38
    doc.setFillColor(rR, rG, rB)
    doc.roundedRect(badgeX, 8, 38, 22, 2, 2, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(255, 255, 255)
    doc.text(riskLabel, badgeX + 19, 14, { align: 'center' })
    doc.setFontSize(18)
    doc.text(`${report.riskScore}`, badgeX + 19, 23, { align: 'center' })
    doc.setFontSize(7)
    doc.text('/100', badgeX + 19, 28, { align: 'center' })

    y = 52

    // ── Case metadata box ─────────────────────────────────────────────────────
    doc.setFillColor(240, 240, 248)
    doc.rect(MARGIN, y, CW, 30, 'F')
    doc.setFillColor(rR, rG, rB)
    doc.rect(MARGIN, y, 3, 30, 'F')

    const cols = [
        ['EXPEDIENTE', caseRef || '—'],
        ['FECHA', new Date().toLocaleDateString('es-ES', { dateStyle: 'long' })],
        ['ARCHIVO', filename.length > 22 ? filename.slice(0, 22) + '…' : filename],
        ['ANALISTA', analystName || 'Sistema Deep-Check'],
    ]
    const colW = CW / cols.length
    cols.forEach(([label, value], i) => {
        const cx = MARGIN + 3 + i * colW + 4
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7)
        doc.setTextColor(120, 120, 150)
        doc.text(label, cx, y + 9)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8.5)
        doc.setTextColor(25, 25, 45)
        doc.text(value, cx, y + 18)
    })

    // Document type badge
    if (documentType && documentType !== 'desconocido') {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7)
        doc.setTextColor(120, 120, 150)
        doc.text('TIPO DOCUMENTO', MARGIN + 6, y + 27)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(25, 25, 45)
        doc.text(DOC_TYPE_LABELS[documentType] ?? documentType, MARGIN + 50, y + 27)
    }

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(160, 160, 180)
    doc.text(`UTC: ${new Date().toISOString()} · ID análisis: ${Date.now()}`, W - MARGIN, y + 27, { align: 'right' })

    y += 37

    // ── 1. Executive Summary ──────────────────────────────────────────────────
    nextSection('RESUMEN EJECUTIVO', 30)
    textBlock(buildSummary(report, filename))

    // ── 2. Score breakdown ────────────────────────────────────────────────────
    nextSection('SEÑALES DE ANÁLISIS', 60)

    const modules = [
        { name: 'ELA — Análisis de Nivel de Error JPEG', score: report.elaScore, desc: buildELAExplanation(report) },
        { name: 'EXIF — Validación de Metadatos', score: report.exifScore, desc: buildEXIFExplanation(report) },
        { name: 'Ruido — Detección de Imagen Sintética (IA)', score: report.noiseScore, desc: buildNoiseExplanation(report) },
    ]
    if (cloneRegionsCount !== undefined && cloneRegionsCount > 0) {
        const cloneScore = Math.min(100, cloneRegionsCount * 12)
        modules.push({
            name: 'Clonado — Detección de Regiones Copiadas',
            score: cloneScore,
            desc: `Se detectaron ${cloneRegionsCount} pares de bloques con contenido visual idéntico o casi idéntico, indicativos de operaciones de copia-pega (copy-move) para ocultar o reemplazar información.`,
        })
    }

    for (const mod of modules) {
        checkPage(30)
        const [mR, mG, mB] = riskRGB(mod.score)

        // Bar background
        doc.setFillColor(228, 228, 235)
        doc.roundedRect(MARGIN, y, CW, 7, 1, 1, 'F')
        // Bar fill
        doc.setFillColor(mR, mG, mB)
        doc.roundedRect(MARGIN, y, Math.max(3, (mod.score / 100) * CW), 7, 1, 1, 'F')
        // Bar labels
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7.5)
        doc.setTextColor(255, 255, 255)
        doc.text(mod.name, MARGIN + 2, y + 5)
        doc.text(`${mod.score}/100`, W - MARGIN - 2, y + 5, { align: 'right' })
        y += 10

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(60, 60, 80)
        const descLines = doc.splitTextToSize(mod.desc, CW)
        doc.text(descLines, MARGIN, y)
        y += descLines.length * 3.5 + 7
    }

    // ── 3. Findings ──────────────────────────────────────────────────────────
    if (report.alerts.length > 0) {
        nextSection('HALLAZGOS DETALLADOS', 30)

        const sorted = [...report.alerts].sort((a, b) => {
            const w = { high: 0, medium: 1, low: 2 }
            return w[a.severity] - w[b.severity]
        })

        for (const alert of sorted) {
            checkPage(28)
            const [aR, aG, aB] = severityRGB(alert.severity)

            // Left accent + card
            doc.setFillColor(aR, aG, aB, 0.06)
            doc.setFillColor(248, 248, 252)
            doc.rect(MARGIN + 3, y, CW - 3, 18, 'F')
            doc.setFillColor(aR, aG, aB)
            doc.rect(MARGIN, y, 3, 18, 'F')

            // Severity pill
            doc.setFillColor(aR, aG, aB)
            doc.roundedRect(MARGIN + 6, y + 2, 18, 5, 1, 1, 'F')
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(6.5)
            doc.setTextColor(255, 255, 255)
            doc.text(alert.severity.toUpperCase(), MARGIN + 15, y + 5.5, { align: 'center' })

            // Module badge
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(7)
            doc.setTextColor(aR, aG, aB)
            doc.text(`[${alert.module.toUpperCase()}]`, MARGIN + 27, y + 5.5)

            // Label
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(8)
            doc.setTextColor(20, 20, 40)
            doc.text(alert.label, MARGIN + 50, y + 5.5)

            // Detail text
            doc.setFont('helvetica', 'normal')
            doc.setFontSize(7.5)
            doc.setTextColor(60, 60, 80)
            const detailLines = doc.splitTextToSize(alert.detail, CW - 8)
            if (detailLines.length <= 2) {
                doc.text(detailLines, MARGIN + 6, y + 13)
                y += 22
            } else {
                y += 20
                const extraLines = doc.splitTextToSize(alert.detail, CW)
                doc.text(extraLines, MARGIN, y)
                y += extraLines.length * 3.5 + 5
            }
        }
    }

    // ── 4. ELA Heatmap images ─────────────────────────────────────────────────
    const hasImages = report.ela.heatmapDataUrl || thumbnailUrl
    if (hasImages) {
        nextSection('MAPA DE CALOR ELA', 75)

        const imgH = 55
        const col1W = (CW - 5) / 2
        let imgX = MARGIN

        if (thumbnailUrl) {
            try {
                doc.addImage(thumbnailUrl, 'JPEG', imgX, y, col1W, imgH)
                doc.setFont('helvetica', 'italic')
                doc.setFontSize(7)
                doc.setTextColor(120, 120, 140)
                doc.text('Fig. 1 — Imagen original analizada', imgX + col1W / 2, y + imgH + 4, { align: 'center' })
                imgX += col1W + 5
            } catch { /* skip if image fails */ }
        }

        if (report.ela.heatmapDataUrl) {
            try {
                const elaX = thumbnailUrl ? imgX : MARGIN
                const elaW = thumbnailUrl ? col1W : CW * 0.6
                doc.addImage(report.ela.heatmapDataUrl, 'JPEG', elaX, y, elaW, imgH)
                doc.setFont('helvetica', 'italic')
                doc.setFontSize(7)
                doc.setTextColor(120, 120, 140)
                doc.text('Fig. 2 — Mapa ELA (zonas brillantes = posible edición)', elaX + elaW / 2, y + imgH + 4, { align: 'center' })
            } catch { /* skip */ }
        }

        y += imgH + 10

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(80, 80, 100)
        doc.text(
            `Diferencia media amplificada: ${report.ela.meanDiff.toFixed(2)} · Bloques sospechosos (8×8 px): ${report.ela.suspiciousRegions} · Amplificación: ×12`,
            MARGIN, y
        )
        y += 8
    }

    // ── 5. Methodology ───────────────────────────────────────────────────────
    nextSection('METODOLOGÍA', 50)
    textBlock(
        'ELA (Error Level Analysis): Técnica estándar en forense digital que re-comprime la imagen ' +
        'a calidad controlada (75%) y amplifica (×12) la diferencia píxel a píxel. Las regiones editadas ' +
        'presentan un historial de compresión diferente, generando mayor brillo en el mapa de calor. ' +
        'Referencia: Krawetz (2007), "A Picture\'s Worth – Digital Image Analysis and Forensics".\n\n' +
        'Análisis EXIF: Extracción y validación de metadatos embebidos (TIFF/EXIF/IPTC). Se verifican: ' +
        'software de edición, inconsistencias en timestamps, ausencia de datos de dispositivo y herramientas de IA.\n\n' +
        'Análisis de Ruido (Detección IA): La varianza Laplaciana y la distribución estadística del ruido ' +
        'por bloques detectan imágenes generadas por modelos de difusión y GAN (Stable Diffusion, DALL-E, ' +
        'Midjourney, GAN outputs), que exhiben uniformidad anómala respecto a fotografías reales.' +
        (cloneRegionsCount !== undefined
            ? '\n\nDetección de Clonado (Copy-Move): Algoritmo de hash perceptual por bloques que identifica ' +
              'regiones duplicadas dentro de la misma imagen, indicativas de operaciones de copia-pega para ' +
              'ocultar o reemplazar información original.'
            : '')
    )

    // ── 6. Conclusions ───────────────────────────────────────────────────────
    nextSection('CONCLUSIONES Y RECOMENDACIONES', 40)
    textBlock(buildConclusion(report, filename, documentType), 8.5)

    // ── 7. Chain of Custody ──────────────────────────────────────────────────
    checkPage(40)
    y += 4
    doc.setFillColor(238, 238, 248)
    doc.rect(MARGIN, y, CW, 35, 'F')
    doc.setFillColor(80, 80, 180)
    doc.rect(MARGIN, y, 3, 35, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(60, 60, 120)
    doc.text('CADENA DE CUSTODIA', MARGIN + 6, y + 7)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(50, 50, 80)
    doc.text(`Sistema: Deep-Check Forensics Engine v2.0`, MARGIN + 6, y + 14)
    doc.text(`Timestamp UTC: ${new Date().toISOString()}`, MARGIN + 6, y + 19)
    doc.text(`Archivo: ${filename} · Duración del análisis: ${report.analysisMs}ms`, MARGIN + 6, y + 24)
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(7)
    doc.setTextColor(140, 140, 170)
    doc.text(
        'Este informe ha sido generado automáticamente. Los hallazgos constituyen indicios técnicos y deben ser',
        MARGIN + 6, y + 31
    )

    // ── Footer on all pages ───────────────────────────────────────────────────
    const pageCount = doc.getNumberOfPages()
    for (let p = 1; p <= pageCount; p++) {
        doc.setPage(p)
        doc.setFillColor(8, 8, 28)
        doc.rect(0, 288, 210, 9, 'F')
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(6.5)
        doc.setTextColor(140, 140, 180)
        doc.text('Deep-Check · IA Forense · deepcheck.io', MARGIN, 293.5)
        doc.text(`Página ${p} de ${pageCount}`, W - MARGIN, 293.5, { align: 'right' })
        if (caseRef) doc.text(`Exp. ${caseRef}`, W / 2, 293.5, { align: 'center' })
    }

    const safeCase = caseRef ? caseRef.replace(/[^a-z0-9]/gi, '-') : 'deepcheck'
    doc.save(`informe-forense-${safeCase}-${Date.now()}.pdf`)
}
