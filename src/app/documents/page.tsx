'use client'

import React, { useState, useCallback, useRef, useEffect } from 'react'
import Link from 'next/link'
import { analyzeImage, riskLevelColor, riskLevelLabel, type ForensicsReport, type RiskLevel } from '@/lib/imageForensics'
import styles from './page.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecentAnalysis {
    id: string
    filename: string
    riskScore: number
    riskLevel: RiskLevel
    createdAt: string
    thumbnail?: string
    caseRef?: string
}

// ─── Upload zone ──────────────────────────────────────────────────────────────

function UploadZone({ onFile }: { onFile: (file: File) => void }) {
    const [dragging, setDragging] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files[0]
        if (file && /image\/(jpeg|png|webp|bmp|tiff)/.test(file.type)) {
            onFile(file)
        }
    }, [onFile])

    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) onFile(file)
    }, [onFile])

    return (
        <div
            className={`${styles.uploadZone} ${dragging ? styles.dragging : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
        >
            <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/bmp,image/tiff"
                style={{ display: 'none' }}
                onChange={handleChange}
            />
            <div className={styles.uploadIcon}>🔬</div>
            <p className={styles.uploadTitle}>Arrastra una imagen o haz clic para seleccionar</p>
            <p className={styles.uploadSub}>JPEG · PNG · WebP · BMP · TIFF — máx. 20 MB</p>
        </div>
    )
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function AnalysisProgress({ step }: { step: string }) {
    const steps = ['ELA', 'EXIF', 'Ruido', 'Score']
    const idx = ['ELA', 'EXIF', 'Ruido', 'Score'].indexOf(step)
    return (
        <div className={styles.progressContainer}>
            <div className={styles.scannerLine} />
            <p className={styles.analysisLabel}>Analizando imagen… {step}</p>
            <div className={styles.stepRow}>
                {steps.map((s, i) => (
                    <div key={s} className={`${styles.stepDot} ${i <= idx ? styles.stepDone : ''} ${i === idx ? styles.stepActive : ''}`}>
                        <span className={styles.stepLabel}>{s}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

// ─── Score ring ───────────────────────────────────────────────────────────────

function ScoreRing({ score, level }: { score: number; level: RiskLevel }) {
    const color = riskLevelColor(level)
    const r = 48
    const circ = 2 * Math.PI * r
    const dash = circ * (score / 100)
    return (
        <div className={styles.ringWrapper}>
            <svg width={120} height={120}>
                <circle cx={60} cy={60} r={r} fill="none" stroke="#1a1a2e" strokeWidth={10} />
                <circle
                    cx={60} cy={60} r={r} fill="none"
                    stroke={color} strokeWidth={10}
                    strokeDasharray={`${dash} ${circ}`}
                    strokeLinecap="round"
                    transform="rotate(-90 60 60)"
                    style={{ transition: 'stroke-dasharray 0.8s ease' }}
                />
                <text x={60} y={55} textAnchor="middle" fill={color} fontSize={22} fontWeight={700} fontFamily="monospace">{score}</text>
                <text x={60} y={72} textAnchor="middle" fill="#888" fontSize={9} fontFamily="monospace">RISK</text>
            </svg>
        </div>
    )
}

// ─── Result panel ─────────────────────────────────────────────────────────────

function ResultPanel({ report, file, onSave, saving, savedId }: {
    report: ForensicsReport
    file: File
    onSave: (caseRef: string) => void
    saving: boolean
    savedId: string | null
}) {
    const [caseRef, setCaseRef] = useState('')
    const color = riskLevelColor(report.riskLevel)
    const label = riskLevelLabel(report.riskLevel)

    return (
        <div className={styles.resultPanel}>
            {/* Header */}
            <div className={styles.resultHeader}>
                <div>
                    <h2 className={styles.resultFilename}>{file.name}</h2>
                    <p className={styles.resultMeta}>
                        {(file.size / 1024).toFixed(0)} KB &middot; Análisis en {report.analysisMs}ms
                    </p>
                </div>
                <div className={styles.verdictBadge} style={{ borderColor: color, color }}>
                    {label}
                </div>
            </div>

            {/* Score + images */}
            <div className={styles.scoreRow}>
                <ScoreRing score={report.riskScore} level={report.riskLevel} />

                <div className={styles.subScores}>
                    {[
                        { label: 'ELA', score: report.elaScore, tip: 'Manipulación JPEG' },
                        { label: 'EXIF', score: report.exifScore, tip: 'Anomalías metadatos' },
                        { label: 'Ruido', score: report.noiseScore, tip: 'Firma IA sintética' },
                    ].map(({ label, score, tip }) => (
                        <div key={label} className={styles.subScore}>
                            <div className={styles.subScoreBar}>
                                <div
                                    className={styles.subScoreBarFill}
                                    style={{ width: `${score}%`, background: score >= 60 ? '#ff4444' : score >= 30 ? '#ffaa00' : '#00ff9d' }}
                                />
                            </div>
                            <span className={styles.subScoreLabel}>{label} <span className={styles.subScoreVal}>{score}</span></span>
                            <span className={styles.subScoreTip}>{tip}</span>
                        </div>
                    ))}
                </div>

                {/* ELA heatmap */}
                <div className={styles.elaPreview}>
                    <p className={styles.elaLabel}>ELA Heatmap</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={report.ela.heatmapDataUrl} alt="ELA heatmap" className={styles.elaImg} />
                    <p className={styles.elaHint}>Zonas brillantes = posible edición</p>
                </div>
            </div>

            {/* Alerts */}
            {report.alerts.length > 0 && (
                <div className={styles.alertsSection}>
                    <h3 className={styles.sectionTitle}>Hallazgos</h3>
                    {report.alerts.map((a, i) => (
                        <div key={i} className={`${styles.alertCard} ${styles[`alert_${a.severity}`]}`}>
                            <div className={styles.alertTop}>
                                <span className={styles.alertSev}>{a.severity.toUpperCase()}</span>
                                <span className={styles.alertLabel}>{a.label}</span>
                                <span className={styles.alertModule}>[{a.module.toUpperCase()}]</span>
                            </div>
                            <p className={styles.alertDetail}>{a.detail}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* EXIF summary */}
            {Object.keys(report.exif.raw).length > 0 && (
                <div className={styles.exifSection}>
                    <h3 className={styles.sectionTitle}>Metadatos EXIF</h3>
                    <div className={styles.exifGrid}>
                        {[
                            ['Software', report.exif.software],
                            ['Fecha captura', report.exif.dateTime],
                            ['GPS', report.exif.gpsPresent ? 'Presente' : 'Ausente'],
                            ['Make', report.exif.raw.Make as string],
                            ['Model', report.exif.raw.Model as string],
                        ].filter(([, v]) => v).map(([k, v]) => (
                            <div key={k as string} className={styles.exifRow}>
                                <span className={styles.exifKey}>{k}</span>
                                <span className={styles.exifVal}>{String(v)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Save to case */}
            <div className={styles.saveSection}>
                <h3 className={styles.sectionTitle}>Guardar en expediente</h3>
                <div className={styles.saveRow}>
                    <input
                        className={styles.caseInput}
                        placeholder="Nº expediente (opcional)"
                        value={caseRef}
                        onChange={e => setCaseRef(e.target.value)}
                    />
                    {savedId ? (
                        <Link href={`/documents/${savedId}`} className={styles.viewBtn}>
                            Ver informe →
                        </Link>
                    ) : (
                        <button
                            className={styles.saveBtn}
                            onClick={() => onSave(caseRef)}
                            disabled={saving}
                        >
                            {saving ? 'Guardando…' : 'Guardar análisis'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}

// ─── Recent list ──────────────────────────────────────────────────────────────

function RecentList({ items }: { items: RecentAnalysis[] }) {
    if (items.length === 0) return null
    return (
        <div className={styles.recentSection}>
            <h2 className={styles.recentTitle}>Análisis recientes</h2>
            <div className={styles.recentGrid}>
                {items.map(item => {
                    const color = riskLevelColor(item.riskLevel)
                    return (
                        <Link key={item.id} href={`/documents/${item.id}`} className={styles.recentCard}>
                            {item.thumbnail && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={item.thumbnail} alt={item.filename} className={styles.recentThumb} />
                            )}
                            <div className={styles.recentInfo}>
                                <p className={styles.recentFilename}>{item.filename}</p>
                                {item.caseRef && <p className={styles.recentCase}>Exp. {item.caseRef}</p>}
                                <p className={styles.recentDate}>{new Date(item.createdAt).toLocaleDateString('es-ES')}</p>
                            </div>
                            <div className={styles.recentScore} style={{ color, borderColor: color }}>
                                {item.riskScore}
                            </div>
                        </Link>
                    )
                })}
            </div>
        </div>
    )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
    const [file, setFile] = useState<File | null>(null)
    const [analysisStep, setAnalysisStep] = useState<string | null>(null)
    const [report, setReport] = useState<ForensicsReport | null>(null)
    const [saving, setSaving] = useState(false)
    const [savedId, setSavedId] = useState<string | null>(null)
    const [recent, setRecent] = useState<RecentAnalysis[]>([])
    const [error, setError] = useState<string | null>(null)

    // Fetch recent on mount
    useEffect(() => {
        fetch('/api/documents?limit=12')
            .then(r => r.json())
            .then(d => setRecent(d.items ?? []))
            .catch(() => { /* ignore */ })
    }, [])

    const handleFile = useCallback(async (f: File) => {
        setFile(f)
        setReport(null)
        setSavedId(null)
        setError(null)

        // Fake step progression for UX — analysis is fast but multi-phase
        setAnalysisStep('ELA')
        try {
            const t0 = performance.now()
            const result = await analyzeImage(f)
            // Ensure at least 600ms of visible progress
            const elapsed = performance.now() - t0
            if (elapsed < 600) await new Promise(r => setTimeout(r, 600 - elapsed))
            setAnalysisStep('EXIF')
            await new Promise(r => setTimeout(r, 200))
            setAnalysisStep('Ruido')
            await new Promise(r => setTimeout(r, 200))
            setAnalysisStep('Score')
            await new Promise(r => setTimeout(r, 150))
            setAnalysisStep(null)
            setReport(result)
        } catch (e) {
            setAnalysisStep(null)
            setError(e instanceof Error ? e.message : 'Error analizando la imagen')
        }
    }, [])

    const handleSave = useCallback(async (caseRef: string) => {
        if (!report || !file) return
        setSaving(true)
        try {
            const res = await fetch('/api/documents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename:     file.name,
                    fileSize:     file.size,
                    mimeType:     file.type,
                    riskScore:    report.riskScore,
                    riskLevel:    report.riskLevel,
                    elaScore:     report.elaScore,
                    exifScore:    report.exifScore,
                    noiseScore:   report.noiseScore,
                    alerts:       report.alerts,
                    exifData:     report.exif.raw,
                    findings: {
                        ela:   { score: report.elaScore, suspiciousRegions: report.ela.suspiciousRegions, meanDiff: report.ela.meanDiff },
                        noise: { score: report.noiseScore, uniformityScore: report.noise.uniformityScore, laplacianVariance: report.noise.laplacianVariance },
                        exif:  { flags: report.exif.flags, software: report.exif.software, dateTime: report.exif.dateTime },
                    },
                    thumbnailUrl: report.thumbnail,
                    elaImageUrl:  report.ela.heatmapDataUrl,
                    caseRef:      caseRef || undefined,
                }),
            })
            const data = await res.json()
            if (data.id) {
                setSavedId(data.id)
                setRecent(prev => [{
                    id:         data.id,
                    filename:   file.name,
                    riskScore:  report.riskScore,
                    riskLevel:  report.riskLevel,
                    createdAt:  new Date().toISOString(),
                    thumbnail:  report.thumbnail,
                    caseRef:    caseRef || undefined,
                }, ...prev].slice(0, 12))
            }
        } catch (e) {
            console.error(e)
        } finally {
            setSaving(false)
        }
    }, [report, file])

    return (
        <div className={styles.page}>
            {/* Header */}
            <div className={styles.header}>
                <Link href="/" className={styles.back}>← Deep-Check</Link>
                <div>
                    <h1 className={styles.title}>Forensia Documental</h1>
                    <p className={styles.subtitle}>Detección de manipulación, metadatos anómalos e imágenes sintéticas</p>
                </div>
                <div className={styles.badges}>
                    <span className={styles.badge}>ELA</span>
                    <span className={styles.badge}>EXIF</span>
                    <span className={styles.badge}>AI Detection</span>
                </div>
            </div>

            <div className={styles.content}>
                {/* Upload */}
                {!analysisStep && !report && (
                    <UploadZone onFile={handleFile} />
                )}

                {/* Analysis in progress */}
                {analysisStep && <AnalysisProgress step={analysisStep} />}

                {/* Error */}
                {error && (
                    <div className={styles.errorBox}>
                        ⚠ {error}
                        <button className={styles.retryBtn} onClick={() => setError(null)}>Reintentar</button>
                    </div>
                )}

                {/* Result */}
                {report && file && !analysisStep && (
                    <>
                        <ResultPanel
                            report={report}
                            file={file}
                            onSave={handleSave}
                            saving={saving}
                            savedId={savedId}
                        />
                        <button className={styles.newBtn} onClick={() => { setFile(null); setReport(null); setSavedId(null) }}>
                            + Analizar otra imagen
                        </button>
                    </>
                )}

                {/* Recent analyses */}
                <RecentList items={recent} />
            </div>
        </div>
    )
}
