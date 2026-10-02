'use client'

import React, { useState, useCallback, useRef, useEffect } from 'react'
import Link from 'next/link'
import { analyzeImage, riskLevelColor, riskLevelLabel, type ForensicsReport, type RiskLevel } from '@/lib/imageForensics'
import { classifyDocument, runCloneDetection, renderCloneOverlay, type DocumentClassification, type CloneDetectionResult } from '@/lib/documentClassifier'
import { analyzeWithNeural, type NeuralForensicsResult } from '@/lib/neuralForensics'
import NeuralAnalysisPanel from './NeuralAnalysisPanel'
import styles from './page.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FullReport extends ForensicsReport {
    docClassification?: DocumentClassification
    cloneResult?: CloneDetectionResult
    cloneOverlayUrl?: string
}

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
    const steps = ['ELA', 'EXIF', 'PRNU', 'DCT', 'Chroma', 'Tipo', 'Clonado', 'Score']
    const idx = steps.indexOf(step)
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

// ─── Doc type badge ───────────────────────────────────────────────────────────

function DocTypeBadge({ classification }: { classification: DocumentClassification }) {
    return (
        <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '6px 14px', borderRadius: 20,
            background: 'rgba(0,200,155,0.1)', border: '1px solid rgba(0,200,155,0.3)',
            fontSize: 13, color: '#00c89d', fontWeight: 600,
        }}>
            <span>{classification.icon}</span>
            <span>{classification.label}</span>
            <span style={{ opacity: 0.6, fontSize: 11 }}>
                ({Math.round(classification.confidence * 100)}% confianza)
            </span>
        </div>
    )
}

// ─── Clone detection badge ────────────────────────────────────────────────────

function CloneBadge({ result }: { result: CloneDetectionResult }) {
    const color = result.riskLevel === 'high_risk' ? '#ff4444'
        : result.riskLevel === 'suspicious' ? '#ffaa00' : '#00c89d'
    const label = result.riskLevel === 'high_risk' ? 'Clonado detectado'
        : result.riskLevel === 'suspicious' ? 'Posible clonado'
        : 'Sin clonado'
    return (
        <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '6px 14px', borderRadius: 20,
            background: `${color}18`, border: `1px solid ${color}55`,
            fontSize: 13, color, fontWeight: 600,
        }}>
            <span>🔍</span>
            <span>{label}</span>
            {result.suspiciousBlocks.length > 0 && (
                <span style={{ opacity: 0.7, fontSize: 11 }}>
                    ({result.suspiciousBlocks.length} pares)
                </span>
            )}
        </div>
    )
}

// ─── Result panel ─────────────────────────────────────────────────────────────

function ResultPanel({ report, file, onSave, saving, savedId }: {
    report: FullReport
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
                    {/* Doc type + clone badges */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                        {report.docClassification && <DocTypeBadge classification={report.docClassification} />}
                        {report.cloneResult && <CloneBadge result={report.cloneResult} />}
                    </div>
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

                {/* Clone overlay */}
                {report.cloneOverlayUrl && report.cloneResult && report.cloneResult.suspiciousBlocks.length > 0 && (
                    <div className={styles.elaPreview}>
                        <p className={styles.elaLabel}>Clone Map</p>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={report.cloneOverlayUrl} alt="Clone detection overlay" className={styles.elaImg} />
                        <p className={styles.elaHint}>{report.cloneResult.suspiciousBlocks.length} regiones duplicadas</p>
                    </div>
                )}
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

// ─── Analysis Mode Toggle ─────────────────────────────────────────────────────

type AnalysisMode = 'standard' | 'neural'

function ModeToggle({ mode, onChange }: { mode: AnalysisMode; onChange: (m: AnalysisMode) => void }) {
    return (
        <div style={{
            display: 'inline-flex', borderRadius: 8, overflow: 'hidden',
            border: '1px solid #2a2a4a', marginBottom: 20, fontFamily: 'monospace',
        }}>
            {(['standard', 'neural'] as AnalysisMode[]).map(m => (
                <button
                    key={m}
                    onClick={() => onChange(m)}
                    style={{
                        padding: '8px 20px', fontSize: 13, fontWeight: 600,
                        cursor: 'pointer', border: 'none', fontFamily: 'monospace',
                        background: mode === m ? '#00c89d' : 'transparent',
                        color: mode === m ? '#000' : '#666',
                        transition: 'all 0.2s',
                    }}
                >
                    {m === 'standard' ? '⚗️ Estándar' : '🧠 Neural IA'}
                </button>
            ))}
        </div>
    )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
    const [file, setFile] = useState<File | null>(null)
    const [analysisStep, setAnalysisStep] = useState<string | null>(null)
    const [report, setReport] = useState<FullReport | null>(null)
    const [neuralReport, setNeuralReport] = useState<NeuralForensicsResult | null>(null)
    const [neuralRunning, setNeuralRunning] = useState(false)
    const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('standard')
    const [saving, setSaving] = useState(false)
    const [savedId, setSavedId] = useState<string | null>(null)
    const [recent, setRecent] = useState<RecentAnalysis[]>([])
    const [error, setError] = useState<string | null>(null)

    // Fetch recent on mount
    useEffect(() => {
        fetch('/api/documents?limit=12')
            .then(r => r.json())
            .then(d => setRecent(d.items ?? []))
            .catch(err => console.error('[documents] Failed to load recent analyses:', err))
    }, [])

    const handleFile = useCallback(async (f: File) => {
        setFile(f)
        setReport(null)
        setNeuralReport(null)
        setSavedId(null)
        setError(null)

        // Multi-phase analysis with progress feedback
        setAnalysisStep('ELA')
        try {
            const t0 = performance.now()
            const result = await analyzeImage(f)
            const elapsed = performance.now() - t0
            if (elapsed < 600) await new Promise(r => setTimeout(r, 600 - elapsed))

            setAnalysisStep('EXIF')
            await new Promise(r => setTimeout(r, 150))

            setAnalysisStep('PRNU')
            await new Promise(r => setTimeout(r, 150))

            setAnalysisStep('DCT')
            await new Promise(r => setTimeout(r, 100))

            setAnalysisStep('Chroma')
            await new Promise(r => setTimeout(r, 100))

            setAnalysisStep('Tipo')
            const dataUrl = await new Promise<string>((res, rej) => {
                const reader = new FileReader()
                reader.onload = e => res(e.target!.result as string)
                reader.onerror = rej
                reader.readAsDataURL(f)
            })
            const img = await new Promise<HTMLImageElement>((res, rej) => {
                const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl
            })
            const docClassification = classifyDocument(img)

            setAnalysisStep('Clonado')
            const cloneResult = await runCloneDetection(img)
            const cloneOverlayUrl = cloneResult.suspiciousBlocks.length > 0
                ? renderCloneOverlay(img, cloneResult)
                : undefined

            setAnalysisStep('Score')
            await new Promise(r => setTimeout(r, 100))
            setAnalysisStep(null)

            const finalReport = { ...result, docClassification, cloneResult, cloneOverlayUrl }
            setReport(finalReport)

            // Neural mode: run enhanced analysis after standard results are shown
            if (analysisMode === 'neural') {
                setNeuralRunning(true)
                try {
                    const nResult = await analyzeWithNeural(img)
                    setNeuralReport(nResult)
                } catch (ne) {
                    console.error('Neural analysis error:', ne)
                } finally {
                    setNeuralRunning(false)
                }
            }
        } catch (e) {
            setAnalysisStep(null)
            setError(e instanceof Error ? e.message : 'Error analizando la imagen')
        }
    }, [analysisMode])

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
                    riskScore:            report.riskScore,
                    riskLevel:            report.riskLevel,
                    elaScore:             report.elaScore,
                    exifScore:            report.exifScore,
                    noiseScore:           report.noiseScore,
                    dctScore:             report.dctScore             ?? 0,
                    chromaScore:          report.chromaScore          ?? 0,
                    edgeScore:            report.edgeScore            ?? 0,
                    manipulationProb:     report.manipulationProb     ?? 0,
                    confidenceLevel:      report.confidenceLevel      ?? 0,
                    signalsAboveThresh:   report.signalsAboveThresh   ?? 0,
                    alerts:               report.alerts,
                    exifData:     report.exif.raw,
                    findings: {
                        ela:   { score: report.elaScore, suspiciousRegions: report.ela.suspiciousRegions, meanDiff: report.ela.meanDiff },
                        noise: { score: report.noiseScore, uniformityScore: report.noise.uniformityScore, laplacianVariance: report.noise.laplacianVariance },
                        exif:  { flags: report.exif.flags, software: report.exif.software, dateTime: report.exif.dateTime },
                        docType: report.docClassification?.type ?? null,
                        docTypeConfidence: report.docClassification?.confidence ?? null,
                        cloneScore: report.cloneResult?.score ?? null,
                        cloneRegions: report.cloneResult?.suspiciousBlocks?.length ?? 0,
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
                {/* Identity KYC CTA */}
                {!analysisStep && !report && (
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        background: 'rgba(0,229,255,0.06)', border: '1px solid rgba(0,229,255,0.2)',
                        borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem',
                    }}>
                        <div>
                            <p style={{ fontWeight: 600, marginBottom: '0.2rem', fontSize: '0.95rem' }}>
                                🪪 Verify an Identity Document
                            </p>
                            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
                                Passport · DNI · Driving Licence — face match + MRZ validation + forensics
                            </p>
                        </div>
                        <Link href="/documents/verify" className="btn btn-primary" style={{ fontSize: '0.85rem', padding: '0.55rem 1.25rem', whiteSpace: 'nowrap' }}>
                            Start KYC Verification →
                        </Link>
                    </div>
                )}

                {/* Analysis mode selector */}
                {!analysisStep && !report && (
                    <div style={{ textAlign: 'center' }}>
                        <ModeToggle mode={analysisMode} onChange={m => { setAnalysisMode(m); setNeuralReport(null) }} />
                        {analysisMode === 'neural' && (
                            <p style={{
                                fontSize: 12, color: '#888', marginBottom: 12, fontFamily: 'monospace',
                            }}>
                                🧠 Análisis neural: multi-escala ELA + DCT + consistencia regional + firma IA
                                {' '}— más preciso, más lento (~3-8s extra)
                            </p>
                        )}
                    </div>
                )}

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

                        {/* Neural analysis — shows when mode is neural */}
                        {analysisMode === 'neural' && (
                            <div style={{ marginTop: 8 }}>
                                {neuralRunning && (
                                    <div style={{
                                        border: '1px solid #2a2a4a', borderRadius: 12, padding: 24,
                                        textAlign: 'center', color: '#888', fontFamily: 'monospace',
                                        background: 'rgba(0,0,0,0.3)',
                                    }}>
                                        <div style={{ fontSize: 24, marginBottom: 8 }}>🧠</div>
                                        <p>Ejecutando análisis neural…</p>
                                        <p style={{ fontSize: 11, opacity: 0.6 }}>
                                            ELA multi-escala · DCT · consistencia regional · correlación cromática
                                        </p>
                                    </div>
                                )}
                                {neuralReport && !neuralRunning && (
                                    <NeuralAnalysisPanel result={neuralReport} />
                                )}
                            </div>
                        )}

                        <button className={styles.newBtn} onClick={() => { setFile(null); setReport(null); setNeuralReport(null); setSavedId(null) }}>
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
