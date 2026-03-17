'use client'

import React, { useState, useCallback, useRef, useEffect, startTransition } from 'react'
import Link from 'next/link'
import {
  extractFrames,
  analyzeFrameConsistency,
  detectTemporalAnomalies,
  videoRiskColor,
  type VideoAnalysisReport,
  type FrameAnalysisResult,
} from '@/lib/videoAnalysis'

// ─── Types ─────────────────────────────────────────────────────────────────────

type AnalysisMode = 'fast' | 'standard' | 'forensic'

const MODE_CONFIG: Record<AnalysisMode, { label: string; fps: number; maxFrames: number; desc: string }> = {
  fast:     { label: 'Rápido (1fps)',    fps: 1,   maxFrames: 60,  desc: '1 frame/s · hasta 60 frames' },
  standard: { label: 'Estándar (2fps)',  fps: 2,   maxFrames: 120, desc: '2 frames/s · hasta 120 frames' },
  forensic: { label: 'Forense (5fps)',   fps: 5,   maxFrames: 300, desc: '5 frames/s · hasta 300 frames · más lento' },
}

interface RecentVideoAnalysis {
  id: string
  filename: string
  duration: number
  framesAnalyzed: number
  overallRiskScore: number
  riskLevel: VideoAnalysisReport['riskLevel']
  deepfakeScore: number
  splicingDetected: boolean
  createdAt: string
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function riskBadgeStyle(level: VideoAnalysisReport['riskLevel']): React.CSSProperties {
  const color = videoRiskColor(level)
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 14px',
    borderRadius: 6,
    border: `2px solid ${color}`,
    color,
    fontWeight: 700,
    fontSize: 13,
    fontFamily: 'monospace',
    letterSpacing: '0.5px',
    background: `${color}18`,
  }
}

// ─── Upload Zone ───────────────────────────────────────────────────────────────

function UploadZone({ onFile }: { onFile: (file: File) => void }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const validate = useCallback((file: File): boolean => {
    const validTypes = ['video/mp4', 'video/quicktime', 'video/avi', 'video/webm', 'video/x-msvideo', 'video/x-matroska']
    const validExts  = /\.(mp4|mov|avi|webm|mkv)$/i.test(file.name)
    if (!validTypes.includes(file.type) && !validExts) return false
    if (file.size > 500 * 1024 * 1024) return false // 500 MB
    return true
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && validate(file)) onFile(file)
  }, [onFile, validate])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && validate(file)) onFile(file)
  }, [onFile, validate])

  return (
    <div
      style={{
        border: `2px dashed ${dragging ? '#00ff9d' : '#333'}`,
        borderRadius: 12,
        padding: '64px 32px',
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'border-color 0.2s, background 0.2s',
        background: dragging ? '#0a0f1a' : '#0d0d1f',
      }}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/avi,video/webm,.mp4,.mov,.avi,.webm,.mkv"
        style={{ display: 'none' }}
        onChange={handleChange}
      />
      <div style={{ fontSize: 48, marginBottom: 16 }}>🎬</div>
      <p style={{ fontSize: 16, color: '#ccc', margin: '0 0 8px', fontFamily: 'monospace' }}>
        Arrastra un vídeo o haz clic para seleccionar
      </p>
      <p style={{ fontSize: 12, color: '#555', margin: 0, fontFamily: 'monospace' }}>
        MP4 · MOV · AVI · WebM · MKV — máx. 500 MB
      </p>
    </div>
  )
}

// ─── Mode Selector ─────────────────────────────────────────────────────────────

function ModeSelector({ mode, onChange }: { mode: AnalysisMode; onChange: (m: AnalysisMode) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{ fontSize: 12, color: '#888', margin: 0, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Modo análisis
      </p>
      <div style={{ display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #2a2a4a', fontFamily: 'monospace' }}>
        {(Object.keys(MODE_CONFIG) as AnalysisMode[]).map(m => (
          <button
            key={m}
            onClick={() => onChange(m)}
            style={{
              padding: '9px 18px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              border: 'none',
              borderRight: m !== 'forensic' ? '1px solid #2a2a4a' : 'none',
              fontFamily: 'monospace',
              background: mode === m ? '#00ff9d' : 'transparent',
              color: mode === m ? '#000' : '#666',
              transition: 'all 0.2s',
              whiteSpace: 'nowrap',
            }}
          >
            {MODE_CONFIG[m].label}
          </button>
        ))}
      </div>
      <p style={{ fontSize: 11, color: '#555', margin: 0, fontFamily: 'monospace' }}>
        {MODE_CONFIG[mode].desc}
      </p>
    </div>
  )
}

// ─── Progress Bar ──────────────────────────────────────────────────────────────

function ProgressBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#00ff9d', fontFamily: 'monospace' }}>{label}</span>
        <span style={{ fontSize: 12, color: '#666', fontFamily: 'monospace' }}>{pct}%</span>
      </div>
      <div style={{ height: 6, background: '#1a1a2e', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          borderRadius: 3,
          background: 'linear-gradient(90deg, #00ff9d, #00cfff)',
          width: `${pct}%`,
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  )
}

// ─── Analysis in Progress ──────────────────────────────────────────────────────

function AnalysisInProgress({
  stage,
  extractPct,
  analyzePct,
  framesDone,
  framesTotal,
}: {
  stage: 'extracting' | 'analyzing'
  extractPct: number
  analyzePct: number
  framesDone: number
  framesTotal: number
}) {
  return (
    <div style={{
      background: '#0d0d1f',
      border: '1px solid #1e1e3a',
      borderRadius: 12,
      padding: '48px 32px',
      textAlign: 'center',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Scanner line */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: '-100%',
        width: '100%',
        height: 3,
        background: 'linear-gradient(90deg, transparent, #00ff9d, transparent)',
        animation: 'scan 1.5s linear infinite',
      }} />

      <div style={{ fontSize: 36, marginBottom: 16 }}>
        {stage === 'extracting' ? '🎞️' : '🔬'}
      </div>
      <p style={{ fontSize: 14, color: '#00ff9d', fontFamily: 'monospace', margin: '0 0 4px' }}>
        {stage === 'extracting' ? 'Extrayendo frames…' : 'Analizando frames…'}
      </p>
      {stage === 'analyzing' && framesTotal > 0 && (
        <p style={{ fontSize: 12, color: '#666', fontFamily: 'monospace', margin: '0 0 24px' }}>
          {framesDone} / {framesTotal} frames procesados
        </p>
      )}
      {stage === 'extracting' && (
        <p style={{ fontSize: 12, color: '#666', fontFamily: 'monospace', margin: '0 0 24px' }}>
          Usando Canvas API para capturar frames del vídeo
        </p>
      )}

      <div style={{ maxWidth: 500, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ProgressBar
          label="Extracción de frames"
          pct={extractPct}
        />
        {stage === 'analyzing' && (
          <ProgressBar
            label="Análisis forense"
            pct={analyzePct}
          />
        )}
      </div>

      <style>{`
        @keyframes scan {
          0%   { left: -100% }
          100% { left: 200% }
        }
      `}</style>
    </div>
  )
}

// ─── Timeline Visualization ────────────────────────────────────────────────────

function Timeline({
  frameResults,
  suspiciousSegments,
  duration,
  onFrameClick,
}: {
  frameResults: FrameAnalysisResult[]
  suspiciousSegments: VideoAnalysisReport['suspiciousSegments']
  duration: number
  onFrameClick?: (idx: number) => void
}) {
  if (frameResults.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{ fontSize: 11, color: '#666', fontFamily: 'monospace', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Timeline — {frameResults.length} frames analizados
      </p>

      {/* Frame bar */}
      <div style={{
        display: 'flex',
        height: 40,
        borderRadius: 6,
        overflow: 'hidden',
        border: '1px solid #1e1e3a',
        gap: 1,
        background: '#0d0d1f',
      }}>
        {frameResults.map((frame, idx) => {
          const riskScore = Math.max(frame.elaScore, frame.aiScore)
          const color = riskScore >= 70 ? '#ff2222'
                      : riskScore >= 50 ? '#ff8800'
                      : riskScore >= 30 ? '#ffcc00'
                      : '#00ff9d'
          const opacity = 0.3 + (riskScore / 100) * 0.7
          return (
            <div
              key={idx}
              title={`Frame ${frame.frameNumber} · t=${formatTimestamp(frame.timestamp)} · risk=${riskScore}`}
              onClick={() => onFrameClick?.(idx)}
              style={{
                flex: 1,
                background: color,
                opacity,
                cursor: 'pointer',
                transition: 'opacity 0.1s',
                minWidth: 2,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = String(opacity) }}
            />
          )
        })}
      </div>

      {/* Time labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', fontSize: 10, color: '#555' }}>
        <span>0:00</span>
        {duration > 0 && <span>{formatDuration(duration / 2)}</span>}
        {duration > 0 && <span>{formatDuration(duration)}</span>}
      </div>

      {/* Suspicious segment markers */}
      {suspiciousSegments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {suspiciousSegments.map((seg, i) => {
            const typeColors: Record<string, string> = {
              splice:           '#ff8800',
              deepfake:         '#ff2222',
              ai_generated:     '#cc44ff',
              metadata_anomaly: '#ffcc00',
            }
            const color = typeColors[seg.type] ?? '#888'
            return (
              <div key={i} style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 10px',
                borderRadius: 4,
                background: `${color}22`,
                border: `1px solid ${color}55`,
                fontSize: 10,
                color,
                fontFamily: 'monospace',
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
                {formatTimestamp(seg.startTime)}–{formatTimestamp(seg.endTime)} · {seg.type} · {Math.round(seg.confidence * 100)}%
              </div>
            )
          })}
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
        {[
          { color: '#00ff9d', label: 'Limpio' },
          { color: '#ffcc00', label: 'Moderado' },
          { color: '#ff8800', label: 'Alto' },
          { color: '#ff2222', label: 'Crítico' },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#666', fontFamily: 'monospace' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Score Ring ────────────────────────────────────────────────────────────────

function ScoreRing({ score, level }: { score: number; level: VideoAnalysisReport['riskLevel'] }) {
  const color = videoRiskColor(level)
  const r = 48
  const circ = 2 * Math.PI * r
  const dash = circ * (score / 100)
  return (
    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
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
      <div style={riskBadgeStyle(level)}>{level}</div>
    </div>
  )
}

// ─── Frame Table ───────────────────────────────────────────────────────────────

function FrameTable({
  frameResults,
  highlightedIdx,
}: {
  frameResults: FrameAnalysisResult[]
  highlightedIdx: number | null
}) {
  const [userPage, setUserPage] = useState(0)
  const PER_PAGE = 10
  const page = highlightedIdx !== null ? Math.floor(highlightedIdx / PER_PAGE) : userPage
  const totalPages = Math.ceil(frameResults.length / PER_PAGE)
  const slice = frameResults.slice(page * PER_PAGE, (page + 1) * PER_PAGE)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <p style={{ fontSize: 13, color: '#888', margin: 0, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Resultados por frame
        </p>
        <p style={{ fontSize: 11, color: '#555', margin: 0, fontFamily: 'monospace' }}>
          {frameResults.length} frames · pág. {page + 1} / {totalPages}
        </p>
      </div>

      {/* Table header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '60px 70px 70px 70px 70px 1fr',
        gap: 8,
        padding: '6px 12px',
        background: '#111122',
        borderRadius: '6px 6px 0 0',
        fontSize: 10,
        color: '#555',
        fontFamily: 'monospace',
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
      }}>
        <span>Frame</span>
        <span>Tiempo</span>
        <span>ELA</span>
        <span>Ruido</span>
        <span>IA</span>
        <span>Alertas</span>
      </div>

      {slice.map((frame, localIdx) => {
        const globalIdx = page * PER_PAGE + localIdx
        const maxScore = Math.max(frame.elaScore, frame.noiseScore, frame.aiScore)
        const rowColor = maxScore >= 70 ? '#ff2222' : maxScore >= 50 ? '#ff8800' : maxScore >= 30 ? '#ffcc00' : '#00ff9d'
        const isHighlighted = globalIdx === highlightedIdx

        return (
          <div
            key={frame.frameNumber}
            style={{
              display: 'grid',
              gridTemplateColumns: '60px 70px 70px 70px 70px 1fr',
              gap: 8,
              padding: '8px 12px',
              background: isHighlighted ? '#1a1a3a' : '#0d0d1f',
              borderLeft: `3px solid ${isHighlighted ? '#00cfff' : rowColor + '66'}`,
              borderRadius: '0 6px 6px 0',
              fontSize: 12,
              fontFamily: 'monospace',
              alignItems: 'center',
              transition: 'background 0.2s',
            }}
          >
            <span style={{ color: '#666' }}>#{frame.frameNumber}</span>
            <span style={{ color: '#aaa' }}>{formatTimestamp(frame.timestamp)}</span>
            <span style={{ color: frame.elaScore >= 50 ? '#ff8800' : '#00ff9d' }}>{frame.elaScore}</span>
            <span style={{ color: frame.noiseScore >= 50 ? '#cc44ff' : '#00ff9d' }}>{frame.noiseScore}</span>
            <span style={{ color: frame.aiScore >= 50 ? '#ff2222' : '#00ff9d' }}>{frame.aiScore}</span>
            <span style={{ color: '#555', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {frame.alerts.length > 0 ? frame.alerts.join(' · ') : '—'}
            </span>
          </div>
        )
      })}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 8 }}>
          <button
            onClick={() => setUserPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{
              background: 'transparent',
              border: '1px solid #2a2a4a',
              color: page === 0 ? '#333' : '#888',
              borderRadius: 6,
              padding: '6px 16px',
              fontFamily: 'monospace',
              fontSize: 12,
              cursor: page === 0 ? 'default' : 'pointer',
            }}
          >
            ← Anterior
          </button>
          <span style={{ fontSize: 12, color: '#555', fontFamily: 'monospace', padding: '6px 8px' }}>
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setUserPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1}
            style={{
              background: 'transparent',
              border: '1px solid #2a2a4a',
              color: page === totalPages - 1 ? '#333' : '#888',
              borderRadius: 6,
              padding: '6px 16px',
              fontFamily: 'monospace',
              fontSize: 12,
              cursor: page === totalPages - 1 ? 'default' : 'pointer',
            }}
          >
            Siguiente →
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Results Panel ─────────────────────────────────────────────────────────────

function ResultsPanel({
  report,
  videoFile,
  onExportPDF,
  onReset,
}: {
  report: VideoAnalysisReport
  videoFile: File
  onExportPDF: () => void
  onReset: () => void
}) {
  const [highlightedFrame, setHighlightedFrame] = useState<number | null>(null)

  const color = videoRiskColor(report.riskLevel)

  return (
    <div style={{
      background: '#0d0d1f',
      border: '1px solid #1e1e3a',
      borderRadius: 12,
      padding: 28,
      display: 'flex',
      flexDirection: 'column',
      gap: 24,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 18, color: '#e0e0e0', margin: '0 0 4px', fontWeight: 600, fontFamily: 'monospace' }}>
            {videoFile.name}
          </h2>
          <p style={{ fontSize: 12, color: '#555', margin: 0, fontFamily: 'monospace' }}>
            {(videoFile.size / (1024 * 1024)).toFixed(1)} MB
            &nbsp;&middot;&nbsp;{formatDuration(report.duration)}
            &nbsp;&middot;&nbsp;{report.framesAnalyzed} frames analizados
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onExportPDF}
            style={{
              background: '#00ff9d22',
              border: '1px solid #00ff9d',
              color: '#00ff9d',
              borderRadius: 8,
              padding: '8px 18px',
              fontSize: 12,
              fontFamily: 'monospace',
              cursor: 'pointer',
            }}
          >
            Exportar informe PDF
          </button>
        </div>
      </div>

      {/* Score row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 32,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}>
        <ScoreRing score={report.overallRiskScore} level={report.riskLevel} />

        {/* Sub-scores */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[
            { label: 'Deepfake score',      score: report.deepfakeScore,    desc: 'Manipulación facial/temporal' },
            { label: 'ELA medio',           score: Math.round(report.frameResults.reduce((a, f) => a + f.elaScore, 0) / Math.max(1, report.frameResults.length)), desc: 'Artefactos de compresión' },
            { label: 'Score IA medio',      score: Math.round(report.frameResults.reduce((a, f) => a + f.aiScore,  0) / Math.max(1, report.frameResults.length)), desc: 'Contenido generado por IA' },
          ].map(({ label, score, desc }) => (
            <div key={label} style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gridTemplateRows: 'auto auto', gap: '4px 8px', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#aaa', fontFamily: 'monospace' }}>
                {label} <span style={{ fontWeight: 700, color: '#e0e0e0' }}>{score}</span>
              </span>
              <span style={{ fontSize: 11, color: '#555', textAlign: 'right', fontFamily: 'monospace' }}>{desc}</span>
              <div style={{ gridColumn: 1, height: 5, background: '#1a1a2e', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  borderRadius: 3,
                  background: score >= 60 ? '#ff4444' : score >= 30 ? '#ffaa00' : '#00ff9d',
                  width: `${score}%`,
                  transition: 'width 0.7s ease',
                }} />
              </div>
            </div>
          ))}
        </div>

        {/* Quick verdict */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'monospace', fontSize: 12 }}>
          <div style={{
            padding: '8px 14px',
            borderRadius: 8,
            background: report.splicingDetected ? '#ff880022' : '#00ff9d22',
            border: `1px solid ${report.splicingDetected ? '#ff8800' : '#00ff9d'}55`,
            color: report.splicingDetected ? '#ff8800' : '#00ff9d',
          }}>
            {report.splicingDetected ? 'Empalme detectado' : 'Sin empalmes'}
          </div>
          <div style={{
            padding: '8px 14px',
            borderRadius: 8,
            background: report.deepfakeScore > 50 ? '#ff222222' : '#00ff9d22',
            border: `1px solid ${report.deepfakeScore > 50 ? '#ff2222' : '#00ff9d'}55`,
            color: report.deepfakeScore > 50 ? '#ff2222' : '#00ff9d',
          }}>
            Deepfake: {report.deepfakeScore}/100
          </div>
        </div>
      </div>

      {/* Summary */}
      <div style={{
        borderTop: '1px solid #1e1e3a',
        paddingTop: 20,
        background: '#111122',
        borderRadius: 8,
        padding: 16,
        fontFamily: 'monospace',
        fontSize: 13,
        color: '#ccc',
        lineHeight: 1.6,
        borderLeft: `4px solid ${color}`,
      }}>
        <p style={{ margin: 0 }}>{report.summary}</p>
      </div>

      {/* Suspicious segments */}
      {report.suspiciousSegments.length > 0 && (
        <div style={{ borderTop: '1px solid #1e1e3a', paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: 13, color: '#888', margin: 0, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Segmentos sospechosos ({report.suspiciousSegments.length})
          </p>
          {report.suspiciousSegments.map((seg, i) => {
            const typeLabels: Record<string, string> = {
              splice:           'Empalme/corte',
              deepfake:         'Deepfake',
              ai_generated:     'Generado por IA',
              metadata_anomaly: 'Anomalía de metadatos',
            }
            const typeColors: Record<string, string> = {
              splice:           '#ff8800',
              deepfake:         '#ff2222',
              ai_generated:     '#cc44ff',
              metadata_anomaly: '#ffcc00',
            }
            const segColor = typeColors[seg.type] ?? '#888'
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '12px 16px',
                  background: '#111122',
                  borderRadius: 8,
                  borderLeft: `4px solid ${segColor}`,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ fontFamily: 'monospace', fontSize: 13, color: segColor, fontWeight: 600 }}>
                  {typeLabels[seg.type] ?? seg.type}
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#888' }}>
                  {formatTimestamp(seg.startTime)} – {formatTimestamp(seg.endTime)}
                </div>
                <div style={{
                  marginLeft: 'auto',
                  padding: '3px 10px',
                  borderRadius: 4,
                  background: `${segColor}22`,
                  border: `1px solid ${segColor}55`,
                  fontSize: 11,
                  color: segColor,
                  fontFamily: 'monospace',
                }}>
                  {Math.round(seg.confidence * 100)}% confianza
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Timeline */}
      <div style={{ borderTop: '1px solid #1e1e3a', paddingTop: 20 }}>
        <Timeline
          frameResults={report.frameResults}
          suspiciousSegments={report.suspiciousSegments}
          duration={report.duration}
          onFrameClick={idx => setHighlightedFrame(idx === highlightedFrame ? null : idx)}
        />
      </div>

      {/* Frame table */}
      <div style={{ borderTop: '1px solid #1e1e3a', paddingTop: 20 }}>
        <FrameTable
          frameResults={report.frameResults}
          highlightedIdx={highlightedFrame}
        />
      </div>

      {/* New analysis button */}
      <button
        onClick={onReset}
        style={{
          background: 'transparent',
          border: '1px dashed #333',
          color: '#666',
          borderRadius: 8,
          padding: '12px 24px',
          fontSize: 13,
          fontFamily: 'monospace',
          cursor: 'pointer',
          alignSelf: 'flex-start',
          transition: 'border-color 0.2s, color 0.2s',
        }}
        onMouseEnter={e => { const el = e.currentTarget; el.style.borderColor = '#00ff9d'; el.style.color = '#00ff9d' }}
        onMouseLeave={e => { const el = e.currentTarget; el.style.borderColor = '#333'; el.style.color = '#666' }}
      >
        + Analizar otro vídeo
      </button>
    </div>
  )
}

// ─── Video Preview ──────────────────────────────────────────────────────────────

function VideoPreview({ file }: { file: File }) {
  const url = useRef<string | null>(null)
  const [src, setSrc] = useState<string>('')

  useEffect(() => {
    const objUrl = URL.createObjectURL(file)
    url.current = objUrl
    startTransition(() => setSrc(objUrl))
    return () => URL.revokeObjectURL(objUrl)
  }, [file])

  if (!src) return null

  return (
    <div style={{
      background: '#0d0d1f',
      border: '1px solid #1e1e3a',
      borderRadius: 12,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
    }}>
      { }
      <video
        src={src}
        controls
        style={{
          width: '100%',
          maxHeight: 360,
          background: '#000',
          display: 'block',
        }}
      />
      <div style={{ padding: '10px 16px', width: '100%', display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', fontSize: 11, color: '#555' }}>
        <span>{file.name}</span>
        <span>{(file.size / (1024 * 1024)).toFixed(1)} MB</span>
      </div>
    </div>
  )
}

// ─── Recent analyses ───────────────────────────────────────────────────────────

function RecentList({ items }: { items: RecentVideoAnalysis[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <p style={{ fontSize: 13, color: '#666', margin: '0 0 12px', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Análisis recientes
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {items.map(item => {
          const color = videoRiskColor(item.riskLevel)
          return (
            <div
              key={item.id}
              style={{
                background: '#0d0d1f',
                border: '1px solid #1e1e3a',
                borderRadius: 10,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                fontFamily: 'monospace',
              }}
            >
              <p style={{ fontSize: 12, color: '#ccc', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.filename}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: '#555' }}>{formatDuration(item.duration)}</span>
                <span style={{ fontSize: 10, color: '#555' }}>{item.framesAnalyzed} frames</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#444' }}>
                  {new Date(item.createdAt).toLocaleDateString('es-ES')}
                </span>
                <div style={{
                  border: `1px solid ${color}`,
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontSize: 11,
                  color,
                  fontWeight: 700,
                }}>
                  {item.riskLevel} · {item.overallRiskScore}
                </div>
              </div>
              {item.splicingDetected && (
                <span style={{ fontSize: 10, color: '#ff8800' }}>Empalme detectado</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── PDF Export ────────────────────────────────────────────────────────────────

function exportReportPDF(report: VideoAnalysisReport, filename: string) {
  const lines: string[] = [
    'INFORME FORENSE DE VIDEO — DEEP-CHECK',
    '=' .repeat(50),
    '',
    `Archivo:          ${filename}`,
    `Duración:         ${formatDuration(report.duration)}`,
    `Frames totales:   ${report.totalFrames}`,
    `Frames analizados:${report.framesAnalyzed}`,
    '',
    'RESULTADO GLOBAL',
    '-'.repeat(30),
    `Score de riesgo:  ${report.overallRiskScore}/100`,
    `Nivel de riesgo:  ${report.riskLevel}`,
    `Deepfake score:   ${report.deepfakeScore}/100`,
    `Empalme detectado:${report.splicingDetected ? 'SÍ' : 'NO'}`,
    '',
    'RESUMEN',
    '-'.repeat(30),
    report.summary,
    '',
  ]

  if (report.suspiciousSegments.length > 0) {
    lines.push('SEGMENTOS SOSPECHOSOS', '-'.repeat(30))
    for (const seg of report.suspiciousSegments) {
      lines.push(
        `  ${formatTimestamp(seg.startTime)}–${formatTimestamp(seg.endTime)}  ${seg.type}  ${Math.round(seg.confidence * 100)}% confianza`
      )
    }
    lines.push('')
  }

  lines.push('RESULTADOS POR FRAME', '-'.repeat(30))
  lines.push('Frame  Tiempo  ELA  Ruido  IA   Alertas')
  for (const fr of report.frameResults) {
    lines.push(
      `${String(fr.frameNumber).padStart(5)}  ${formatTimestamp(fr.timestamp).padEnd(6)}  ${String(fr.elaScore).padStart(3)}  ${String(fr.noiseScore).padStart(5)}  ${String(fr.aiScore).padStart(3)}  ${fr.alerts.join(', ')}`
    )
  }

  lines.push('')
  lines.push(`Generado: ${new Date().toLocaleString('es-ES')} — Deep-Check`)

  const text = lines.join('\n')
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `deepcheck-video-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}-${Date.now()}.txt`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function VideoForensicsPage() {
  const [videoFile, setVideoFile]       = useState<File | null>(null)
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('standard')
  const [stage, setStage]               = useState<'idle' | 'extracting' | 'analyzing' | 'done' | 'error'>('idle')
  const [extractPct, setExtractPct]     = useState(0)
  const [analyzePct, setAnalyzePct]     = useState(0)
  const [framesDone, setFramesDone]     = useState(0)
  const [framesTotal, setFramesTotal]   = useState(0)
  const [report, setReport]             = useState<VideoAnalysisReport | null>(null)
  const [error, setError]               = useState<string | null>(null)
  const [recent, setRecent]             = useState<RecentVideoAnalysis[]>([])

  // Fetch recent analyses on mount
  useEffect(() => {
    fetch('/api/video?limit=12')
      .then(r => r.json())
      .then(d => setRecent(d.items ?? []))
      .catch(err => console.error('[video] Failed to load recent analyses:', err))
  }, [])

  const handleFile = useCallback((file: File) => {
    setVideoFile(file)
    setReport(null)
    setError(null)
    setStage('idle')
    setExtractPct(0)
    setAnalyzePct(0)
    setFramesDone(0)
    setFramesTotal(0)
  }, [])

  const handleAnalyze = useCallback(async () => {
    if (!videoFile) return
    setReport(null)
    setError(null)

    const cfg = MODE_CONFIG[analysisMode]

    try {
      // ── 1. Extract frames client-side ────────────────────────────────────────
      setStage('extracting')
      setExtractPct(0)

      const extractedFrames = await extractFrames(
        videoFile,
        cfg.fps,
        cfg.maxFrames,
        pct => setExtractPct(pct),
      )

      setExtractPct(100)

      if (extractedFrames.length === 0) {
        setError('No se pudieron extraer frames del vídeo. Verifica que el formato es compatible.')
        setStage('error')
        return
      }

      // ── 2. Run client-side ELA consistency analysis ───────────────────────────
      const { splicePoints, consistencyScore } = analyzeFrameConsistency(extractedFrames)

      setStage('analyzing')
      setFramesTotal(extractedFrames.length)

      // ── 3. Send frames to API for server-side scoring ─────────────────────────
      // We send the raw base64 frames; server returns full VideoAnalysisReport.
      // For very large frame sets, we send in batches to avoid body size limits.
      const BATCH_SIZE = 30

      // We get the video duration from a quick HTMLVideoElement load
      let duration = 0
      try {
        duration = await getVideoDuration(videoFile)
      } catch { /* ignore */ }

      const allFrames = extractedFrames.map(f => ({
        frameNumber: f.frameNumber,
        timestamp:   f.timestamp,
        imageData:   f.imageData,
      }))

      // For large sets, the API analyses all frames in a single POST.
      // We track progress locally since the server doesn't stream.
      setFramesDone(0)
      setAnalyzePct(0)

      // Simulate incremental progress while waiting for server
      const progressInterval = setInterval(() => {
        setAnalyzePct(p => Math.min(p + 2, 90))
      }, 200)

      let serverReport: VideoAnalysisReport & { id?: string }

      try {
        const res = await fetch('/api/video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename:    videoFile.name,
            duration,
            totalFrames: allFrames.length,
            frames:      allFrames,
          }),
        })

        clearInterval(progressInterval)
        setAnalyzePct(100)
        setFramesDone(allFrames.length)

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          throw new Error(errData.error ?? `Error del servidor: ${res.status}`)
        }

        serverReport = await res.json()
      } catch (fetchErr) {
        clearInterval(progressInterval)
        // Fallback: build report client-side if server fails
        console.warn('[VideoForensics] Server analysis failed, building client-side report:', fetchErr)

        const { analyzeFrame: analyzeFrameClient, buildVideoReport: buildReportClient } = await import('@/lib/videoAnalysis')

        const clientFrameResults = await Promise.all(
          extractedFrames.map((f, i) => {
            setFramesDone(i + 1)
            setAnalyzePct(Math.round(((i + 1) / extractedFrames.length) * 100))
            return analyzeFrameClient(f.imageData, f.frameNumber, f.timestamp)
          })
        )

        const { deepfakeScore: dfScore, anomalyFrames } = detectTemporalAnomalies(clientFrameResults)

        serverReport = buildReportClient({
          filename:         videoFile.name,
          duration,
          totalFrames:      allFrames.length,
          frameResults:     clientFrameResults,
          splicePoints,
          consistencyScore,
          deepfakeScore:    dfScore,
          anomalyFrames,
        })
      }

      setReport(serverReport)
      setStage('done')

      // Add to recent list
      if (serverReport) {
        setRecent(prev => [{
          id:               (serverReport as { id?: string }).id ?? `local-${Date.now()}`,
          filename:         videoFile.name,
          duration,
          framesAnalyzed:   serverReport.framesAnalyzed,
          overallRiskScore: serverReport.overallRiskScore,
          riskLevel:        serverReport.riskLevel,
          deepfakeScore:    serverReport.deepfakeScore,
          splicingDetected: serverReport.splicingDetected,
          createdAt:        new Date().toISOString(),
        }, ...prev].slice(0, 12))
      }
    } catch (e) {
      console.error('[VideoForensics] Analysis error:', e)
      setError(e instanceof Error ? e.message : 'Error durante el análisis del vídeo')
      setStage('error')
    }
  }, [videoFile, analysisMode])

  const handleReset = useCallback(() => {
    setVideoFile(null)
    setReport(null)
    setError(null)
    setStage('idle')
    setExtractPct(0)
    setAnalyzePct(0)
  }, [])

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a12',
      color: '#e0e0e0',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      padding: 24,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 24,
        marginBottom: 32,
        flexWrap: 'wrap',
      }}>
        <Link href="/" style={{ color: '#555', textDecoration: 'none', fontSize: 13, paddingTop: 6, whiteSpace: 'nowrap' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#00ff9d' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#555' }}
        >
          ← Deep-Check
        </Link>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#00ff9d', margin: '0 0 4px', letterSpacing: '-0.5px' }}>
            Forense de Vídeo
          </h1>
          <p style={{ fontSize: 13, color: '#666', margin: 0 }}>
            Detección de deepfakes, empalmes y contenido generado por IA en vídeo
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap', alignItems: 'center' }}>
          {['ELA', 'EXIF', 'AI Detection', 'VIDEO'].map(badge => (
            <span key={badge} style={{
              background: '#0d0d1f',
              border: `1px solid ${badge === 'VIDEO' ? '#00ff9d' : '#333'}`,
              borderRadius: 4,
              padding: '3px 10px',
              fontSize: 11,
              color: badge === 'VIDEO' ? '#00ff9d' : '#00cfff',
              letterSpacing: '0.5px',
            }}>
              {badge}
            </span>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32 }}>

        {/* Stage: idle — show upload + options */}
        {stage === 'idle' && !videoFile && (
          <>
            <ModeSelector mode={analysisMode} onChange={setAnalysisMode} />
            <UploadZone onFile={handleFile} />
          </>
        )}

        {/* Stage: file selected — show preview + controls */}
        {stage === 'idle' && videoFile && (
          <>
            <VideoPreview file={videoFile} />
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <ModeSelector mode={analysisMode} onChange={setAnalysisMode} />
              <button
                onClick={handleAnalyze}
                style={{
                  background: '#00ff9d',
                  border: 'none',
                  color: '#000',
                  borderRadius: 8,
                  padding: '10px 28px',
                  fontSize: 13,
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'opacity 0.2s',
                  alignSelf: 'flex-end',
                  marginBottom: 0,
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.85' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
              >
                Analizar vídeo
              </button>
              <button
                onClick={() => { setVideoFile(null); setError(null) }}
                style={{
                  background: 'transparent',
                  border: '1px solid #333',
                  color: '#666',
                  borderRadius: 8,
                  padding: '10px 18px',
                  fontSize: 13,
                  fontFamily: 'monospace',
                  cursor: 'pointer',
                  alignSelf: 'flex-end',
                }}
              >
                Cambiar vídeo
              </button>
            </div>
          </>
        )}

        {/* Stage: extracting or analyzing */}
        {(stage === 'extracting' || stage === 'analyzing') && (
          <AnalysisInProgress
            stage={stage === 'extracting' ? 'extracting' : 'analyzing'}
            extractPct={extractPct}
            analyzePct={analyzePct}
            framesDone={framesDone}
            framesTotal={framesTotal}
          />
        )}

        {/* Error state */}
        {(stage === 'error' || error) && (
          <div style={{
            background: '#1a0000',
            border: '1px solid #ff4444',
            borderRadius: 8,
            padding: '16px 20px',
            color: '#ff7777',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
            fontFamily: 'monospace',
          }}>
            <span>Error: {error}</span>
            <button
              onClick={handleReset}
              style={{
                background: 'transparent',
                border: '1px solid #ff4444',
                color: '#ff4444',
                borderRadius: 6,
                padding: '6px 14px',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'monospace',
              }}
            >
              Reintentar
            </button>
          </div>
        )}

        {/* Results */}
        {stage === 'done' && report && videoFile && (
          <ResultsPanel
            report={report}
            videoFile={videoFile}
            onExportPDF={() => exportReportPDF(report, videoFile.name)}
            onReset={handleReset}
          />
        )}

        {/* Recent analyses */}
        {stage !== 'extracting' && stage !== 'analyzing' && (
          <RecentList items={recent} />
        )}
      </div>
    </div>
  )
}

// ─── Utility: get video duration ───────────────────────────────────────────────

function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const dur = video.duration
      URL.revokeObjectURL(url)
      video.src = ''
      resolve(isFinite(dur) ? dur : 0)
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not load video metadata'))
    }
    video.src = url
  })
}
