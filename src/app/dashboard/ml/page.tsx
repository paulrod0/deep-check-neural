'use client'

/**
 * /dashboard/ml — ML Model Dashboard
 * ====================================
 *
 * Real-time view of the continuous learning system.
 * Shows deployed model metrics, retraining status, feedback stats,
 * model version history, and training job log.
 *
 * This is a premium feature — demonstrates the ML competitive advantage
 * that makes Deep-Check worth millions.
 */

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

// ── Types ────────────────────────────────────────────────────────────────────────

interface ModelVersion {
  id: string
  version: number
  auc: number
  accuracy: number
  f1: number
  training_samples: number
  model_path: string
  deployed: boolean
  created_at: string
}

interface RetrainStatus {
  canRetrain: boolean
  feedbackCount: number
  threshold: number
  lastTrainedAt: string | null
  lastAuc: number | null
  pendingSamples: number
}

interface TrainingJob {
  id: string
  org_id: string
  job_name: string
  status: string
  feedback_count: number
  metrics_auc: number | null
  metrics_f1: number | null
  error_message: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

interface FeedbackStats {
  total: number
  used: number
  corrections: number
}

interface MLStatusResponse {
  deployedModel: ModelVersion | null
  retrainStatus: RetrainStatus
  modelHistory: ModelVersion[]
  trainingJobs: TrainingJob[]
  feedbackStats: FeedbackStats
  deployMode: string
  sagemakerConfigured: boolean
}

// ── Score Ring Component ──────────────────────────────────────────────────────────

function MetricRing({ value, label, max, color }: { value: number; label: string; max: number; color: string }) {
  const r = 32
  const circ = 2 * Math.PI * r
  const pct = Math.min(value / max, 1)

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ position: 'relative', width: 76, height: 76, margin: '0 auto' }}>
        <svg viewBox="0 0 76 76" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="38" cy="38" r={r} fill="none" stroke="var(--color-border)" strokeWidth="6" />
          <circle
            cx="38" cy="38" r={r} fill="none"
            stroke={color}
            strokeWidth="6"
            strokeDasharray={`${circ * pct} ${circ}`}
            strokeLinecap="round"
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.85rem', fontWeight: 700, color,
        }}>
          {(value * 100).toFixed(1)}%
        </div>
      </div>
      <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: '0.3rem' }}>{label}</p>
    </div>
  )
}

// ── Status Badge ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { color: string; bg: string }> = {
    pending:   { color: '#ffd700', bg: 'rgba(255,215,0,0.1)' },
    running:   { color: 'var(--color-primary)', bg: 'rgba(0,229,255,0.1)' },
    completed: { color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
    deployed:  { color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
    failed:    { color: '#ff4d4d', bg: 'rgba(255,77,77,0.1)' },
  }
  const c = config[status] || config.pending

  return (
    <span style={{
      padding: '2px 10px', borderRadius: 20, fontSize: '0.72rem',
      fontWeight: 600, color: c.color, background: c.bg,
      textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>
      {status}
    </span>
  )
}

// ── Main Dashboard ───────────────────────────────────────────────────────────────

export default function MLDashboard() {
  const [data, setData] = useState<MLStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [triggering, setTriggering] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/ml/status?org=global')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    // Auto-refresh every 30s
    const interval = setInterval(fetchStatus, 30000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const triggerRetrain = useCallback(async () => {
    setTriggering(true)
    try {
      const res = await fetch('/api/ml/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysis_id: 'manual-trigger',
          predicted_label: 'genuine',
          predicted_score: 0,
          actual_label: 'genuine',
          document_type: 'manual_trigger',
        }),
      })
      if (!res.ok) throw new Error('Failed')
      await fetchStatus()
    } catch {
      // Non-fatal
    } finally {
      setTriggering(false)
    }
  }, [fetchStatus])

  if (loading) {
    return (
      <main style={{ minHeight: '100vh', padding: '2rem 1rem', background: 'var(--color-bg)' }}>
        <div className="container" style={{ maxWidth: 960 }}>
          <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--color-text-muted)' }}>
            <div style={{
              width: 40, height: 40, border: '3px solid var(--color-primary)',
              borderTopColor: 'transparent', borderRadius: '50%',
              animation: 'spin 0.8s linear infinite', margin: '0 auto 1rem',
            }} />
            Loading ML status…
          </div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </main>
    )
  }

  return (
    <main style={{ minHeight: '100vh', padding: '2rem 1rem', background: 'var(--color-bg)' }}>
      <div className="container" style={{ maxWidth: 960 }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <Link href="/dashboard" style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', textDecoration: 'none' }}>
            ← Back to Dashboard
          </Link>
          <h1 style={{ marginTop: '0.75rem', fontSize: '1.5rem', fontWeight: 700 }}>
            🧠 ML Model Dashboard
          </h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            Continuous learning system — every verification improves the model
          </p>
        </div>

        {error && (
          <div className="glass-panel" style={{ padding: '1rem', border: '1px solid rgba(255,215,0,0.3)', marginBottom: '1.5rem' }}>
            <p style={{ color: '#ffd700', fontSize: '0.85rem' }}>⚠️ {error}</p>
          </div>
        )}

        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            {/* ── Row 1: Deployed Model Metrics ──────────────────────────────── */}
            <div className="glass-panel" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <h2 style={{ fontSize: '1.05rem', fontWeight: 600 }}>Deployed Model</h2>
                <StatusBadge status={data.deployedModel ? 'deployed' : 'none'} />
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-dim)', marginLeft: 'auto' }}>
                  Mode: <strong style={{ color: 'var(--color-primary)' }}>{data.deployMode}</strong>
                  {data.sagemakerConfigured && ' · SageMaker ✓'}
                </span>
              </div>

              {data.deployedModel ? (
                <div style={{ display: 'flex', gap: '2rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <MetricRing value={data.deployedModel.auc} label="AUC" max={1} color="var(--color-primary)" />
                  <MetricRing value={data.deployedModel.accuracy} label="Accuracy" max={1} color="#22c55e" />
                  <MetricRing value={data.deployedModel.f1} label="F1 Score" max={1} color="#ffd700" />

                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                      {[
                        ['Training Samples', data.deployedModel.training_samples.toLocaleString()],
                        ['Version', `v${data.deployedModel.version}`],
                        ['Model Path', data.deployedModel.model_path.split('/').pop() || '—'],
                        ['Deployed', new Date(data.deployedModel.created_at).toLocaleDateString()],
                      ].map(([k, v]) => (
                        <div key={k}>
                          <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{k}</p>
                          <p style={{ fontSize: '0.82rem', fontWeight: 600 }}>{v}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                  No model deployed yet. Submit feedback to begin training.
                </p>
              )}
            </div>

            {/* ── Row 2: Retraining Status + Feedback Stats ──────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>

              {/* Retraining Status */}
              <div className="glass-panel" style={{ padding: '1.5rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '1rem' }}>
                  ♻️ Retraining Status
                </h3>

                {/* Progress bar to threshold */}
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.3rem' }}>
                    <span>Pending samples</span>
                    <span>{data.retrainStatus.pendingSamples} / {data.retrainStatus.threshold}</span>
                  </div>
                  <div style={{
                    height: 8, borderRadius: 4,
                    background: 'var(--color-border)',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min(100, (data.retrainStatus.pendingSamples / data.retrainStatus.threshold) * 100)}%`,
                      background: data.retrainStatus.canRetrain ? '#22c55e' : 'var(--color-primary)',
                      borderRadius: 4,
                      transition: 'width 0.5s',
                    }} />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.82rem' }}>
                  <div>
                    <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Can Retrain</p>
                    <p style={{ fontWeight: 600, color: data.retrainStatus.canRetrain ? '#22c55e' : 'var(--color-text-muted)' }}>
                      {data.retrainStatus.canRetrain ? '✅ Ready' : '⏳ Collecting'}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Last Trained</p>
                    <p style={{ fontWeight: 600 }}>
                      {data.retrainStatus.lastTrainedAt
                        ? new Date(data.retrainStatus.lastTrainedAt).toLocaleDateString()
                        : '—'}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Last AUC</p>
                    <p style={{ fontWeight: 600, color: 'var(--color-primary)' }}>
                      {data.retrainStatus.lastAuc ? `${(data.retrainStatus.lastAuc * 100).toFixed(1)}%` : '—'}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Total Feedback</p>
                    <p style={{ fontWeight: 600 }}>{data.retrainStatus.feedbackCount}</p>
                  </div>
                </div>

                {data.retrainStatus.canRetrain && data.deployMode === 'cloud' && (
                  <button
                    className="btn btn-primary"
                    style={{ width: '100%', marginTop: '1rem', fontSize: '0.85rem' }}
                    onClick={triggerRetrain}
                    disabled={triggering}
                  >
                    {triggering ? 'Triggering…' : '🚀 Trigger Retraining Now'}
                  </button>
                )}
              </div>

              {/* Feedback Stats */}
              <div className="glass-panel" style={{ padding: '1.5rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '1rem' }}>
                  📊 Feedback Statistics
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {[
                    { label: 'Total Feedback', value: data.feedbackStats.total, icon: '📝', color: 'var(--color-primary)' },
                    { label: 'Used in Training', value: data.feedbackStats.used, icon: '✅', color: '#22c55e' },
                    { label: 'Corrections', value: data.feedbackStats.corrections, icon: '🔧', color: '#ffd700' },
                    { label: 'Accuracy Rate', value: data.feedbackStats.total > 0 ? `${((1 - data.feedbackStats.corrections / data.feedbackStats.total) * 100).toFixed(1)}%` : '—', icon: '🎯', color: 'var(--color-primary)' },
                  ].map(s => (
                    <div key={s.label} style={{
                      display: 'flex', alignItems: 'center', gap: '0.75rem',
                      padding: '0.6rem 0.75rem',
                      background: 'rgba(255,255,255,0.02)',
                      borderRadius: 8,
                    }}>
                      <span style={{ fontSize: '1.1rem' }}>{s.icon}</span>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{s.label}</p>
                        <p style={{ fontSize: '1rem', fontWeight: 700, color: s.color }}>{s.value}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Row 3: Model Version History ──────────────────────────────── */}
            {data.modelHistory.length > 0 && (
              <div className="glass-panel" style={{ padding: '1.5rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '1rem' }}>
                  📈 Model Version History
                </h3>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr>
                        {['Version', 'AUC', 'Accuracy', 'F1', 'Samples', 'Date', 'Status'].map(h => (
                          <th key={h} style={{
                            textAlign: h === 'Version' ? 'left' : 'center',
                            padding: '0.6rem 0.75rem',
                            color: 'var(--color-text-muted)',
                            fontSize: '0.72rem',
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            borderBottom: '1px solid var(--color-border)',
                          }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.modelHistory.map((model) => (
                        <tr key={model.id} style={{
                          borderBottom: '1px solid rgba(255,255,255,0.03)',
                          background: model.deployed ? 'rgba(0,229,255,0.04)' : 'transparent',
                        }}>
                          <td style={{ padding: '0.6rem 0.75rem', fontWeight: 600 }}>
                            v{model.version}
                            {model.deployed && (
                              <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: '#22c55e' }}>● LIVE</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'center', padding: '0.6rem 0.75rem', color: 'var(--color-primary)', fontWeight: 600 }}>
                            {(model.auc * 100).toFixed(1)}%
                          </td>
                          <td style={{ textAlign: 'center', padding: '0.6rem 0.75rem' }}>
                            {(model.accuracy * 100).toFixed(1)}%
                          </td>
                          <td style={{ textAlign: 'center', padding: '0.6rem 0.75rem' }}>
                            {(model.f1 * 100).toFixed(1)}%
                          </td>
                          <td style={{ textAlign: 'center', padding: '0.6rem 0.75rem' }}>
                            {model.training_samples.toLocaleString()}
                          </td>
                          <td style={{ textAlign: 'center', padding: '0.6rem 0.75rem', color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>
                            {new Date(model.created_at).toLocaleDateString()}
                          </td>
                          <td style={{ textAlign: 'center', padding: '0.6rem 0.75rem' }}>
                            <StatusBadge status={model.deployed ? 'deployed' : 'completed'} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Row 4: Training Jobs ──────────────────────────────────────── */}
            {(data.trainingJobs as TrainingJob[]).length > 0 && (
              <div className="glass-panel" style={{ padding: '1.5rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '1rem' }}>
                  🔬 Training Jobs
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  {(data.trainingJobs as TrainingJob[]).map((job) => (
                    <div key={job.id} style={{
                      display: 'flex', alignItems: 'center', gap: '1rem',
                      padding: '0.75rem 1rem',
                      background: 'rgba(255,255,255,0.02)',
                      borderRadius: 8,
                      borderLeft: `3px solid ${
                        job.status === 'deployed' ? '#22c55e'
                        : job.status === 'completed' ? 'var(--color-primary)'
                        : job.status === 'failed' ? '#ff4d4d'
                        : '#ffd700'
                      }`,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          fontSize: '0.82rem', fontWeight: 600,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {job.job_name}
                        </p>
                        <p style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                          {job.feedback_count} samples · {new Date(job.created_at).toLocaleString()}
                        </p>
                      </div>

                      {job.metrics_auc && (
                        <span style={{ fontSize: '0.78rem', color: 'var(--color-primary)', fontWeight: 600 }}>
                          AUC: {(job.metrics_auc * 100).toFixed(1)}%
                        </span>
                      )}

                      <StatusBadge status={job.status} />

                      {job.error_message && (
                        <span style={{ fontSize: '0.72rem', color: '#ff4d4d', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {job.error_message}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Architecture Info ─────────────────────────────────────────── */}
            <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', border: '1px solid rgba(0,229,255,0.15)' }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                🧠 <strong style={{ color: 'var(--color-primary)' }}>Continuous Learning Architecture</strong> —
                User feedback flows into the training pipeline via SageMaker. When {data.retrainStatus.threshold} new samples accumulate,
                the system automatically triggers a retraining job. New models are deployed only if they exceed the current model&apos;s AUC.
                Rollback protection prevents regressions.
              </p>
            </div>

          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </main>
  )
}
