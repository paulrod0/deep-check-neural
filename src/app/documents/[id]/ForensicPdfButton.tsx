'use client'

import { useState } from 'react'
import { generateForensicPDF } from '@/lib/forensicReport'
import type { ForensicsReport } from '@/lib/imageForensics'
import type { DocumentType } from '@/lib/documentClassifier'

interface Props {
    filename: string
    caseRef?: string | null
    thumbnailUrl?: string | null
    elaImageUrl?: string | null
    riskScore: number
    riskLevel: 'clean' | 'suspicious' | 'high_risk'
    elaScore: number
    exifScore: number
    noiseScore: number
    alerts: ForensicsReport['alerts']
    findings: {
        ela?: { score: number; suspiciousRegions: number; meanDiff: number }
        noise?: { score: number; uniformityScore: number; laplacianVariance: number }
        exif?: { flags: string[]; software?: string; dateTime?: string }
    }
    documentType?: DocumentType | null
    cloneRegionsCount?: number
}

export default function ForensicPdfButton(props: Props) {
    const [loading, setLoading] = useState(false)

    async function handleDownload() {
        setLoading(true)
        try {
            // Reconstruct ForensicsReport from stored DB data
            const report: ForensicsReport = {
                elaScore: props.elaScore,
                exifScore: props.exifScore,
                noiseScore: props.noiseScore,
                riskScore: props.riskScore,
                riskLevel: props.riskLevel,
                alerts: props.alerts,
                analysisMs: 0,
                thumbnail: props.thumbnailUrl ?? '',
                ela: {
                    score: props.elaScore,
                    heatmapDataUrl: props.elaImageUrl ?? '',
                    maxDiff: 0,
                    meanDiff: props.findings?.ela?.meanDiff ?? 0,
                    suspiciousRegions: props.findings?.ela?.suspiciousRegions ?? 0,
                },
                exif: {
                    score: props.exifScore,
                    raw: {},
                    flags: props.findings?.exif?.flags ?? [],
                    software: props.findings?.exif?.software,
                    dateTime: props.findings?.exif?.dateTime,
                    gpsPresent: false,
                    editSoftwareDetected: (props.findings?.exif?.flags ?? []).includes('edit_software'),
                    dateTimeInconsistency: (props.findings?.exif?.flags ?? []).includes('datetime_mismatch'),
                },
                noise: {
                    score: props.noiseScore,
                    laplacianVariance: props.findings?.noise?.laplacianVariance ?? 0,
                    uniformityScore: props.findings?.noise?.uniformityScore ?? 0,
                    blockVarianceStd: 0,
                },
            }

            await generateForensicPDF({
                report,
                filename: props.filename,
                caseRef: props.caseRef ?? undefined,
                documentType: props.documentType ?? undefined,
                cloneRegionsCount: props.cloneRegionsCount,
                thumbnailUrl: props.thumbnailUrl ?? undefined,
            })
        } catch (e) {
            console.error('PDF generation error:', e)
            alert('Error al generar el PDF. Inténtalo de nuevo.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <button
            onClick={handleDownload}
            disabled={loading}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 20px',
                background: loading ? '#333' : '#0a0a1e',
                color: loading ? '#888' : '#00c89d',
                border: '1px solid #00c89d',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                fontFamily: 'monospace',
            }}
        >
            {loading ? (
                <>⏳ Generando PDF…</>
            ) : (
                <>📄 Descargar Informe PDF</>
            )}
        </button>
    )
}
