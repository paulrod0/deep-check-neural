'use client'

/**
 * NeuralAnalysisPanel — shows the results of the neural/enhanced analysis.
 * Rendered inside the documents upload page when the user selects "Análisis IA".
 */

import type { NeuralForensicsResult } from '@/lib/neuralForensics'

interface Props {
    result: NeuralForensicsResult
}

const sevColor = {
    low: '#ffaa00',
    medium: '#ff7700',
    high: '#ff4444',
}

function MiniBar({ value, color }: { value: number; color: string }) {
    return (
        <div style={{
            height: 6, borderRadius: 3, background: '#1a1a2e',
            overflow: 'hidden', flexShrink: 0, width: '100%',
        }}>
            <div style={{
                width: `${value}%`, height: '100%',
                background: color, borderRadius: 3,
                transition: 'width 0.8s ease',
            }} />
        </div>
    )
}

function MetricRow({ label, value, max = 100, color }: {
    label: string; value: number; max?: number; color: string
}) {
    const pct = Math.round((value / max) * 100)
    return (
        <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: '#aaa' }}>{label}</span>
                <span style={{ fontSize: 12, color, fontWeight: 700, fontFamily: 'monospace' }}>
                    {value.toFixed(0)}<span style={{ opacity: 0.5, fontWeight: 400 }}>/{max}</span>
                </span>
            </div>
            <MiniBar value={pct} color={color} />
        </div>
    )
}

export default function NeuralAnalysisPanel({ result }: Props) {
    const scoreColor = result.riskLevel === 'high_risk' ? '#ff4444'
        : result.riskLevel === 'suspicious' ? '#ffaa00' : '#00c89d'

    const modeLabel = result.mode === 'onnx'
        ? '🧠 Red Neuronal (ONNX)'
        : '⚗️ Heurística Multi-escala'

    const riskLabel = result.riskLevel === 'high_risk' ? 'ALTO RIESGO'
        : result.riskLevel === 'suspicious' ? 'SOSPECHOSO' : 'LIMPIO'

    return (
        <div style={{
            marginTop: 24,
            border: `1px solid ${scoreColor}55`,
            borderRadius: 12,
            padding: 24,
            background: 'rgba(0,0,0,0.3)',
        }}>
            {/* Header */}
            <div style={{
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12,
            }}>
                <div>
                    <h3 style={{ margin: 0, color: '#fff', fontFamily: 'monospace', fontSize: 16 }}>
                        Análisis Neural IA
                    </h3>
                    <span style={{
                        fontSize: 11, color: '#888', fontFamily: 'monospace',
                        background: '#1a1a2e', padding: '2px 8px', borderRadius: 10,
                        display: 'inline-block', marginTop: 4,
                    }}>
                        {modeLabel} · {result.analysisMs} ms · confianza {Math.round(result.confidence * 100)}%
                    </span>
                </div>

                {/* Score badge */}
                <div style={{
                    textAlign: 'center',
                    background: `${scoreColor}18`,
                    border: `2px solid ${scoreColor}`,
                    borderRadius: 12,
                    padding: '10px 20px',
                }}>
                    <div style={{
                        fontSize: 28, fontWeight: 800, fontFamily: 'monospace',
                        color: scoreColor, lineHeight: 1,
                    }}>
                        {result.neuralScore}
                    </div>
                    <div style={{ fontSize: 10, color: '#888', fontFamily: 'monospace' }}>SCORE IA</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: scoreColor, marginTop: 2 }}>
                        {riskLabel}
                    </div>
                </div>
            </div>

            {/* Metrics */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '20px 32px',
                marginBottom: 20,
            }}>
                <div>
                    <p style={{ margin: '0 0 8px', fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>
                        ELA Multi-escala
                    </p>
                    <MetricRow
                        label={`Splice (${Object.keys(result.findings.multiScaleELA.qualityScores).join('/')} q)`}
                        value={result.findings.multiScaleELA.spliceIndicatorScore}
                        color={result.findings.multiScaleELA.spliceIndicatorScore > 50 ? '#ff4444' : '#00c89d'}
                    />
                    <MetricRow
                        label="Varianza inter-calidad"
                        value={result.findings.multiScaleELA.varianceAcrossQualities}
                        max={30}
                        color={result.findings.multiScaleELA.varianceAcrossQualities > 15 ? '#ffaa00' : '#00c89d'}
                    />
                </div>

                <div>
                    <p style={{ margin: '0 0 8px', fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>
                        Dominio Frecuencial
                    </p>
                    <MetricRow
                        label="Doble JPEG (DCT)"
                        value={result.findings.frequencyAnalysis.doubleJpegScore}
                        color={result.findings.frequencyAnalysis.doubleJpegScore > 40 ? '#ff7700' : '#00c89d'}
                    />
                    <MetricRow
                        label="Alta frecuencia"
                        value={result.findings.frequencyAnalysis.highFreqRatio * 1000}
                        max={100}
                        color="#7777ff"
                    />
                </div>

                <div>
                    <p style={{ margin: '0 0 8px', fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>
                        Consistencia Regional
                    </p>
                    <MetricRow
                        label="Inconsistencia de ruido"
                        value={result.findings.regionalConsistency.consistencyScore}
                        color={result.findings.regionalConsistency.consistencyScore > 40 ? '#ff4444' : '#00c89d'}
                    />
                    <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                        Zonas sospechosas: {result.findings.regionalConsistency.spliceZones}/9
                        {' · '}CV: {(result.findings.regionalConsistency.noiseCV * 100).toFixed(1)}%
                    </div>
                </div>

                <div>
                    <p style={{ margin: '0 0 8px', fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>
                        Canal Cromático
                    </p>
                    <MetricRow
                        label="Firma IA (correlación)"
                        value={result.findings.channelAnalysis.aiSignatureScore}
                        color={result.findings.channelAnalysis.aiSignatureScore > 30 ? '#ff7700' : '#00c89d'}
                    />
                    <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                        R↔G: {result.findings.channelAnalysis.rgCorrelation.toFixed(2)}
                        {' · '}Kurt: {((result.findings.channelAnalysis.kurtosisR + result.findings.channelAnalysis.kurtosisG + result.findings.channelAnalysis.kurtosisB) / 3).toFixed(2)}
                    </div>
                </div>
            </div>

            {/* ONNX prediction if available */}
            {result.findings.onnxPrediction && (
                <div style={{
                    background: 'rgba(0,200,155,0.08)',
                    border: '1px solid rgba(0,200,155,0.3)',
                    borderRadius: 8, padding: '12px 16px',
                    marginBottom: 16, fontFamily: 'monospace',
                }}>
                    🧠 <span style={{ color: '#00c89d', fontWeight: 700 }}>Predicción ONNX</span>
                    <span style={{ color: '#888', marginLeft: 12, fontSize: 12 }}>
                        Falsificación: {Math.round(result.findings.onnxPrediction.forgedProbability * 100)}%
                        {' · '}
                        Autenticidad: {Math.round(result.findings.onnxPrediction.authenticity * 100)}%
                    </span>
                </div>
            )}

            {/* Alerts */}
            {result.alerts.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                    <p style={{ margin: '0 0 10px', fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>
                        Señales detectadas ({result.alerts.length})
                    </p>
                    {result.alerts.map((alert, i) => (
                        <div key={i} style={{
                            borderLeft: `3px solid ${sevColor[alert.severity]}`,
                            paddingLeft: 12, marginBottom: 10,
                        }}>
                            <div style={{ fontSize: 13, color: sevColor[alert.severity], fontWeight: 600 }}>
                                {alert.label}
                            </div>
                            <div style={{ fontSize: 11, color: '#888', marginTop: 3, lineHeight: 1.5 }}>
                                {alert.detail}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Explanation */}
            <div style={{
                background: '#0a0a1e', borderRadius: 8,
                padding: '12px 16px', fontSize: 12, color: '#aaa', lineHeight: 1.6,
            }}>
                <span style={{ color: '#00c89d', fontWeight: 600 }}>📝 Explicación: </span>
                {result.explanation}
            </div>
        </div>
    )
}
