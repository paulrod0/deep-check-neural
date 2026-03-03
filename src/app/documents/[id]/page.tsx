import React from 'react'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { riskLevelColor, riskLevelLabel, type RiskLevel } from '@/lib/imageForensics'
import ForensicPdfButton from './ForensicPdfButton'
import styles from './page.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DocumentAnalysis {
    id: string
    created_at: string
    filename: string
    file_size: number | null
    mime_type: string | null
    risk_score: number
    risk_level: RiskLevel
    ela_score: number
    exif_score: number
    noise_score: number
    alerts: {
        code: string
        label: string
        detail: string
        severity: 'low' | 'medium' | 'high'
        module: string
    }[]
    exif_data: Record<string, unknown>
    findings: {
        ela?: { score: number; suspiciousRegions: number; meanDiff: number }
        noise?: { score: number; uniformityScore: number; laplacianVariance: number }
        exif?: { flags: string[]; software?: string; dateTime?: string }
        docType?: string | null
        docTypeConfidence?: number | null
        cloneScore?: number | null
        cloneRegions?: number
    }
    thumbnail_url: string | null
    ela_image_url: string | null
    submitted_by: string | null
    case_ref: string | null
    notes: string | null
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getAnalysis(id: string): Promise<DocumentAnalysis | null> {
    const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } }
    )
    const { data } = await sb
        .from('dc_document_analyses')
        .select('*')
        .eq('id', id)
        .single()
    return data as DocumentAnalysis | null
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreMeter({ label, score, detail }: { label: string; score: number; detail: string }) {
    const color = score >= 60 ? '#ff4444' : score >= 30 ? '#ffaa00' : '#00ff9d'
    return (
        <div className={styles.meter}>
            <div className={styles.meterHeader}>
                <span className={styles.meterLabel}>{label}</span>
                <span className={styles.meterScore} style={{ color }}>{score}</span>
            </div>
            <div className={styles.meterBar}>
                <div className={styles.meterFill} style={{ width: `${score}%`, background: color }} />
            </div>
            <p className={styles.meterDetail}>{detail}</p>
        </div>
    )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DocumentReportPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const doc = await getAnalysis(id)

    if (!doc) {
        return (
            <div className={styles.notFound}>
                <p>Análisis no encontrado.</p>
                <Link href="/documents" className={styles.backLink}>← Volver a Forensia Documental</Link>
            </div>
        )
    }

    const color = riskLevelColor(doc.risk_level)
    const label = riskLevelLabel(doc.risk_level)
    const date  = new Date(doc.created_at).toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short' })

    const highAlerts   = doc.alerts.filter(a => a.severity === 'high')
    const medAlerts    = doc.alerts.filter(a => a.severity === 'medium')
    const lowAlerts    = doc.alerts.filter(a => a.severity === 'low')

    return (
        <div className={styles.page}>

            {/* Header */}
            <div className={styles.headerBar}>
                <Link href="/documents" className={styles.back}>← Forensia Documental</Link>
                <Link href="/dashboard" className={styles.dashLink}>Dashboard →</Link>
            </div>

            {/* Hero verdict */}
            <div className={styles.hero}>
                <div className={styles.heroLeft}>
                    <div className={styles.verdictBadge} style={{ background: `${color}22`, borderColor: color, color }}>
                        {label}
                    </div>
                    <h1 className={styles.filename}>{doc.filename}</h1>
                    <div className={styles.metaRow}>
                        {doc.case_ref && <span className={styles.metaTag}>Exp. {doc.case_ref}</span>}
                        {doc.file_size && <span className={styles.metaMuted}>{(doc.file_size / 1024).toFixed(0)} KB</span>}
                        <span className={styles.metaMuted}>{date}</span>
                        <span className={styles.metaTag} style={{ fontFamily: 'monospace', fontSize: 11 }}>ID: {doc.id.slice(0, 8)}</span>
                    </div>
                </div>

                <div className={styles.heroRight}>
                    <div className={styles.bigScore} style={{ color }}>
                        {doc.risk_score}
                        <span className={styles.bigScoreLabel}>/ 100</span>
                    </div>
                    <p className={styles.bigScoreSub}>Riesgo global</p>
                </div>
            </div>

            {/* Images */}
            <div className={styles.imagesRow}>
                {doc.thumbnail_url && (
                    <div className={styles.imageCard}>
                        <p className={styles.imageLabel}>Original</p>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={doc.thumbnail_url} alt="Original" className={styles.imagePreview} />
                    </div>
                )}
                {doc.ela_image_url && (
                    <div className={styles.imageCard}>
                        <p className={styles.imageLabel}>ELA Heatmap</p>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={doc.ela_image_url} alt="ELA" className={styles.imagePreview} />
                        <p className={styles.imageHint}>Zonas brillantes indican edición</p>
                    </div>
                )}
            </div>

            {/* Score breakdown */}
            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>Desglose de señales</h2>
                <div className={styles.metersGrid}>
                    <ScoreMeter
                        label="ELA — Análisis de nivel de error"
                        score={doc.ela_score}
                        detail={
                            doc.findings?.ela
                                ? `${doc.findings.ela.suspiciousRegions} bloques sospechosos · diferencia media: ${doc.findings.ela.meanDiff.toFixed(1)}`
                                : 'Análisis de artefactos de compresión JPEG'
                        }
                    />
                    <ScoreMeter
                        label="EXIF — Anomalías en metadatos"
                        score={doc.exif_score}
                        detail={
                            doc.findings?.exif?.flags?.length
                                ? `Indicadores: ${doc.findings.exif.flags.join(', ')}`
                                : 'Sin anomalías en metadatos'
                        }
                    />
                    <ScoreMeter
                        label="Ruido — Firma IA sintética"
                        score={doc.noise_score}
                        detail={
                            doc.findings?.noise
                                ? `Uniformidad: ${(doc.findings.noise.uniformityScore * 100).toFixed(0)}% · Varianza Laplaciana: ${doc.findings.noise.laplacianVariance.toFixed(1)}`
                                : 'Análisis de distribución de ruido'
                        }
                    />
                </div>
            </div>

            {/* Alerts */}
            {doc.alerts.length > 0 && (
                <div className={styles.section}>
                    <h2 className={styles.sectionTitle}>
                        Hallazgos
                        <span className={styles.alertCounts}>
                            {highAlerts.length > 0 && <span className={styles.countHigh}>{highAlerts.length} alto</span>}
                            {medAlerts.length > 0  && <span className={styles.countMed}>{medAlerts.length} medio</span>}
                            {lowAlerts.length > 0  && <span className={styles.countLow}>{lowAlerts.length} bajo</span>}
                        </span>
                    </h2>
                    <div className={styles.alertsList}>
                        {[...highAlerts, ...medAlerts, ...lowAlerts].map((alert, i) => (
                            <div key={i} className={`${styles.alertCard} ${styles[`sev_${alert.severity}`]}`}>
                                <div className={styles.alertTop}>
                                    <span className={styles.alertSev}>{alert.severity.toUpperCase()}</span>
                                    <span className={styles.alertLabel}>{alert.label}</span>
                                    <span className={styles.alertMod}>[{alert.module.toUpperCase()}]</span>
                                </div>
                                <p className={styles.alertDetail}>{alert.detail}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* EXIF */}
            {Object.keys(doc.exif_data ?? {}).length > 0 && (
                <div className={styles.section}>
                    <h2 className={styles.sectionTitle}>Metadatos EXIF</h2>
                    <div className={styles.exifTable}>
                        {Object.entries(doc.exif_data)
                            .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
                            .slice(0, 20)
                            .map(([k, v]) => (
                                <div key={k} className={styles.exifRow}>
                                    <span className={styles.exifKey}>{k}</span>
                                    <span className={styles.exifVal}>{String(v)}</span>
                                </div>
                            ))
                        }
                    </div>
                </div>
            )}

            {/* No findings */}
            {doc.alerts.length === 0 && (
                <div className={styles.cleanBanner}>
                    <span className={styles.cleanIcon}>✓</span>
                    <div>
                        <p className={styles.cleanTitle}>Imagen sin indicios de manipulación</p>
                        <p className={styles.cleanDetail}>ELA, EXIF y análisis de ruido no detectaron anomalías significativas.</p>
                    </div>
                </div>
            )}

            {/* XAI — Explicabilidad */}
            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>Explicabilidad (XAI) — ¿Por qué este resultado?</h2>
                <div style={{ display: 'grid', gap: 12 }}>

                    {/* Document type */}
                    {doc.findings?.docType && (
                        <div style={{ padding: '12px 16px', background: 'rgba(0,200,155,0.07)', border: '1px solid rgba(0,200,155,0.2)', borderRadius: 8 }}>
                            <p style={{ margin: 0, fontSize: 12, color: '#00c89d', fontWeight: 700, letterSpacing: 1 }}>TIPO DE DOCUMENTO DETECTADO</p>
                            <p style={{ margin: '4px 0 0', fontSize: 14, color: '#e0e0e0' }}>
                                {doc.findings.docType === 'dni' ? '🪪 DNI / Documento de Identidad'
                                    : doc.findings.docType === 'factura' ? '🧾 Factura / Documento Financiero'
                                    : doc.findings.docType === 'foto_persona' ? '👤 Fotografía de Persona'
                                    : doc.findings.docType === 'captura_pantalla' ? '🖥️ Captura de Pantalla'
                                    : '📄 Documento Genérico'}
                                {doc.findings.docTypeConfidence != null && (
                                    <span style={{ opacity: 0.6, fontSize: 12, marginLeft: 8 }}>
                                        ({Math.round(doc.findings.docTypeConfidence * 100)}% confianza)
                                    </span>
                                )}
                            </p>
                        </div>
                    )}

                    {/* Clone detection */}
                    {doc.findings?.cloneScore != null && (
                        <div style={{
                            padding: '12px 16px',
                            background: (doc.findings.cloneScore ?? 0) >= 30 ? 'rgba(255,68,68,0.07)' : 'rgba(0,200,155,0.07)',
                            border: `1px solid ${(doc.findings.cloneScore ?? 0) >= 30 ? 'rgba(255,68,68,0.3)' : 'rgba(0,200,155,0.2)'}`,
                            borderRadius: 8,
                        }}>
                            <p style={{ margin: 0, fontSize: 12, color: (doc.findings.cloneScore ?? 0) >= 30 ? '#ff4444' : '#00c89d', fontWeight: 700, letterSpacing: 1 }}>
                                DETECCIÓN DE CLONADO (COPY-MOVE)
                            </p>
                            <p style={{ margin: '4px 0 0', fontSize: 14, color: '#e0e0e0' }}>
                                {(doc.findings.cloneRegions ?? 0) > 0
                                    ? `${doc.findings.cloneRegions} regiones duplicadas detectadas — posible operación de copia-pega para ocultar o modificar información`
                                    : 'No se detectaron regiones duplicadas significativas en la imagen'}
                            </p>
                            <p style={{ margin: '4px 0 0', fontSize: 11, color: '#888' }}>
                                Score de clonado: {doc.findings.cloneScore}/100 · Algoritmo: hash perceptual por bloques (16×16 px)
                            </p>
                        </div>
                    )}

                    {/* ELA explanation */}
                    <div style={{ padding: '12px 16px', background: '#0a0a1e', border: '1px solid #1e1e3e', borderRadius: 8 }}>
                        <p style={{ margin: 0, fontSize: 12, color: '#8888aa', fontWeight: 700, letterSpacing: 1 }}>ELA — ANÁLISIS DE NIVEL DE ERROR</p>
                        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#c0c0d0', lineHeight: 1.6 }}>
                            {doc.ela_score >= 65
                                ? `Puntuación alta (${doc.ela_score}/100): ${doc.findings?.ela?.suspiciousRegions ?? '?'} bloques de 8×8 px con historial de compresión inconsistente. Las regiones editadas y re-guardadas en JPEG generan artefactos de compresión diferentes al resto de la imagen, que se amplifican ×12 en el mapa de calor.`
                                : doc.ela_score < 8
                                ? `Puntuación muy baja (${doc.ela_score}/100): ausencia de artefactos JPEG típicos de fotografías reales. Patrón consistente con imagen generada por IA o captura de pantalla sin historial de compresión previo.`
                                : `Puntuación ${doc.ela_score}/100: artefactos de compresión dentro del rango normal para fotografías auténticas.`}
                        </p>
                    </div>

                    {/* EXIF explanation */}
                    <div style={{ padding: '12px 16px', background: '#0a0a1e', border: '1px solid #1e1e3e', borderRadius: 8 }}>
                        <p style={{ margin: 0, fontSize: 12, color: '#8888aa', fontWeight: 700, letterSpacing: 1 }}>EXIF — METADATOS</p>
                        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#c0c0d0', lineHeight: 1.6 }}>
                            {doc.exif_score >= 60
                                ? `Puntuación alta (${doc.exif_score}/100): se detectaron anomalías en metadatos — ${(doc.findings?.exif?.flags ?? []).join(', ')}. Los metadatos EXIF registran toda la historia del archivo; software de edición detectado o inconsistencias de fecha son evidencia directa de manipulación.`
                                : `Puntuación ${doc.exif_score}/100: metadatos EXIF ${doc.findings?.exif?.flags?.length ? `con indicadores: ${doc.findings.exif.flags.join(', ')}` : 'sin anomalías significativas'}.`}
                        </p>
                    </div>

                    {/* Noise explanation */}
                    <div style={{ padding: '12px 16px', background: '#0a0a1e', border: '1px solid #1e1e3e', borderRadius: 8 }}>
                        <p style={{ margin: 0, fontSize: 12, color: '#8888aa', fontWeight: 700, letterSpacing: 1 }}>RUIDO — FIRMA DE IA GENERATIVA</p>
                        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#c0c0d0', lineHeight: 1.6 }}>
                            {doc.noise_score >= 65
                                ? `Puntuación alta (${doc.noise_score}/100): distribución de ruido anómalamente uniforme. Los modelos de difusión (Stable Diffusion, DALL-E, Midjourney) y GANs producen imágenes con varianza Laplaciana baja y uniformidad entre bloques característica, ausente en fotografías reales.`
                                : `Puntuación ${doc.noise_score}/100: distribución de ruido ${doc.noise_score < 30 ? 'consistente con fotografía real' : 'con cierta uniformidad atípica — posible imagen renderizada o sintética'}.`}
                        </p>
                    </div>
                </div>
            </div>

            {/* Footer actions */}
            <div className={styles.actions}>
                <Link href="/documents" className={styles.actionBtn}>
                    + Nuevo análisis
                </Link>
                <ForensicPdfButton
                    filename={doc.filename}
                    caseRef={doc.case_ref}
                    thumbnailUrl={doc.thumbnail_url}
                    elaImageUrl={doc.ela_image_url}
                    riskScore={doc.risk_score}
                    riskLevel={doc.risk_level}
                    elaScore={doc.ela_score}
                    exifScore={doc.exif_score}
                    noiseScore={doc.noise_score}
                    alerts={doc.alerts}
                    findings={doc.findings ?? {}}
                    documentType={(doc.findings?.docType as import('@/lib/documentClassifier').DocumentType) ?? undefined}
                    cloneRegionsCount={doc.findings?.cloneRegions}
                />
                <Link href="/dashboard" className={styles.actionBtnSecondary}>
                    Ver dashboard
                </Link>
            </div>
        </div>
    )
}
