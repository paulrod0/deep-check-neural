'use client'

import { useEffect, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'

const LineChart = dynamic(() => import('recharts').then(m => m.LineChart), { ssr: false })
const Line = dynamic(() => import('recharts').then(m => m.Line), { ssr: false })
const XAxis = dynamic(() => import('recharts').then(m => m.XAxis), { ssr: false })
const YAxis = dynamic(() => import('recharts').then(m => m.YAxis), { ssr: false })
const Tooltip = dynamic(() => import('recharts').then(m => m.Tooltip), { ssr: false })
const Legend = dynamic(() => import('recharts').then(m => m.Legend), { ssr: false })
const ResponsiveContainer = dynamic(() => import('recharts').then(m => m.ResponsiveContainer), { ssr: false })
const CartesianGrid = dynamic(() => import('recharts').then(m => m.CartesianGrid), { ssr: false })

const POLL_MS = 10000

interface EpochMetric {
  epoch: number
  train_loss: number
  train_acc: number
  val_loss: number
  val_acc: number
  auc: number
  eer: number
  lr: number
  time: number
}

interface ModelData {
  name: string
  architecture: string
  status: string
  epochs: EpochMetric[]
  bestAuc: number
  bestEer: number
  lastEpoch: number
  totalEpochs: number
}

interface ApiResponse {
  models: ModelData[]
  logs: Record<string, string[]>
  updatedAt: string
  error?: string
}

const COLORS: Record<string, string> = {
  'V3': '#8b5cf6',
  'V7-DINOv2': '#ef4444',
  'V8-DINOv3': '#3b82f6',
  'Doc-Forensics': '#06b6d4',
}

const STATUS_COLORS: Record<string, string> = {
  deployed: '#00ff9d',
  training: '#3b82f6',
  stopped: '#71717a',
  error: '#ef4444',
}

function fmt(n: number, d = 4) { return n.toFixed(d) }
function pct(n: number) { return (n * 100).toFixed(1) + '%' }

export default function TrainingDashboard() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [connected, setConnected] = useState(false)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState('')

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch('/api/training/metrics')
      const d = await r.json()
      setData(d)
      setConnected(true)
      setLastUpdate(new Date().toLocaleTimeString())
    } catch {
      setConnected(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, POLL_MS)
    return () => clearInterval(id)
  }, [fetchData])

  // Deduplicate by model name: keep the entry with the most epochs
  const dedup = (arr: ModelData[]): ModelData[] => {
    const map = new Map<string, ModelData>()
    for (const m of arr) {
      const existing = map.get(m.name)
      if (!existing || m.epochs.length > existing.epochs.length) {
        map.set(m.name, m)
      }
    }
    return Array.from(map.values())
  }

  const allModels = dedup(data?.models ?? [])
  const activeModels = allModels.filter(m => m.epochs.length > 0)

  // Build merged chart data (all models on same x-axis)
  const mergedAucData: Record<number, Record<string, number>>[] = []
  if (activeModels.length > 0) {
    const maxEpoch = Math.max(...activeModels.map(m => m.lastEpoch))
    for (let e = 1; e <= maxEpoch; e++) {
      const point: Record<string, number> = { epoch: e }
      for (const model of activeModels) {
        const ep = model.epochs.find(x => x.epoch === e)
        if (ep) {
          point[`${model.name}_auc`] = ep.auc
          point[`${model.name}_eer`] = ep.eer
          point[`${model.name}_tl`] = ep.train_loss
          point[`${model.name}_vl`] = ep.val_loss
          point[`${model.name}_ta`] = ep.train_acc
          point[`${model.name}_va`] = ep.val_acc
        }
      }
      mergedAucData.push(point as any)
    }
  }

  const detail = selectedModel ? allModels.find(m => m.name === selectedModel) : null

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0c', color: '#fff', fontFamily: 'system-ui' }}>
      {/* Header */}
      <div style={{ padding: '24px 32px', borderBottom: '1px solid #1a1a20', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>
            Deep-Check<span style={{ color: '#00ff9d' }}>.</span> Training Dashboard
          </h1>
          <p style={{ color: '#71717a', margin: '4px 0 0', fontSize: 14 }}>
            Real-time multi-model training monitor
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: connected ? '#00ff9d' : '#ef4444',
            boxShadow: connected ? '0 0 8px #00ff9d' : '0 0 8px #ef4444',
          }} />
          <span style={{ color: '#71717a', fontSize: 12 }}>
            {connected ? `Live (${lastUpdate})` : 'Disconnected'}
          </span>
        </div>
      </div>

      <div style={{ padding: '24px 32px' }}>
        {/* Model Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginBottom: 32 }}>
          {allModels.map(model => (
            <div
              key={model.name}
              onClick={() => setSelectedModel(selectedModel === model.name ? null : model.name)}
              style={{
                background: selectedModel === model.name ? '#1a1a30' : '#1a1a20',
                borderRadius: 12,
                padding: 20,
                cursor: 'pointer',
                border: selectedModel === model.name ? '1px solid #3b82f6' : '1px solid transparent',
                transition: 'all 0.2s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontWeight: 700, fontSize: 16, color: COLORS[model.name] || '#fff' }}>
                  {model.name}
                </span>
                <span style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 8,
                  background: `${STATUS_COLORS[model.status] || '#71717a'}20`,
                  color: STATUS_COLORS[model.status] || '#71717a',
                  fontWeight: 600,
                }}>
                  {model.status}
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#71717a', marginBottom: 8 }}>{model.architecture}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: '#71717a' }}>Best AUC</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#00ff9d' }}>{fmt(model.bestAuc, 4)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#71717a' }}>Best EER</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#3b82f6' }}>{pct(model.bestEer)}</div>
                </div>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: '#71717a' }}>
                Epoch {model.lastEpoch}/{model.totalEpochs}
              </div>
              {model.status === 'training' && (
                <div style={{ marginTop: 8, height: 4, background: '#1a1a30', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 2,
                    background: `linear-gradient(90deg, ${COLORS[model.name] || '#00ff9d'}, ${COLORS[model.name] || '#00ff9d'}80)`,
                    width: `${(model.lastEpoch / model.totalEpochs) * 100}%`,
                    transition: 'width 0.5s',
                  }} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Charts Section */}
        {activeModels.length > 0 && mergedAucData.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 32 }}>
            {/* AUC Chart */}
            <div style={{ background: '#1a1a20', borderRadius: 12, padding: 20 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 14, color: '#a1a1aa' }}>AUC (Area Under Curve)</h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={mergedAucData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                  <XAxis dataKey="epoch" stroke="#555" fontSize={11} />
                  <YAxis domain={[0.5, 1]} stroke="#555" fontSize={11} />
                  <Tooltip
                    contentStyle={{ background: '#1a1a20', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#a1a1aa' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {activeModels.map(m => (
                    <Line
                      key={m.name}
                      type="monotone"
                      dataKey={`${m.name}_auc`}
                      name={m.name}
                      stroke={COLORS[m.name] || '#fff'}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* EER Chart */}
            <div style={{ background: '#1a1a20', borderRadius: 12, padding: 20 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 14, color: '#a1a1aa' }}>EER (Equal Error Rate)</h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={mergedAucData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                  <XAxis dataKey="epoch" stroke="#555" fontSize={11} />
                  <YAxis domain={[0, 0.5]} stroke="#555" fontSize={11} />
                  <Tooltip
                    contentStyle={{ background: '#1a1a20', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#a1a1aa' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {activeModels.map(m => (
                    <Line
                      key={m.name}
                      type="monotone"
                      dataKey={`${m.name}_eer`}
                      name={m.name}
                      stroke={COLORS[m.name] || '#fff'}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Train Loss */}
            <div style={{ background: '#1a1a20', borderRadius: 12, padding: 20 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 14, color: '#a1a1aa' }}>Train Loss</h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={mergedAucData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                  <XAxis dataKey="epoch" stroke="#555" fontSize={11} />
                  <YAxis stroke="#555" fontSize={11} />
                  <Tooltip
                    contentStyle={{ background: '#1a1a20', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#a1a1aa' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {activeModels.map(m => (
                    <Line
                      key={m.name}
                      type="monotone"
                      dataKey={`${m.name}_tl`}
                      name={m.name}
                      stroke={COLORS[m.name] || '#fff'}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Val Loss */}
            <div style={{ background: '#1a1a20', borderRadius: 12, padding: 20 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 14, color: '#a1a1aa' }}>Validation Loss</h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={mergedAucData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                  <XAxis dataKey="epoch" stroke="#555" fontSize={11} />
                  <YAxis stroke="#555" fontSize={11} />
                  <Tooltip
                    contentStyle={{ background: '#1a1a20', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#a1a1aa' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {activeModels.map(m => (
                    <Line
                      key={m.name}
                      type="monotone"
                      dataKey={`${m.name}_vl`}
                      name={m.name}
                      stroke={COLORS[m.name] || '#fff'}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Detail Panel */}
        {detail && detail.epochs.length > 0 && (
          <div style={{ background: '#1a1a20', borderRadius: 12, padding: 20, marginBottom: 32 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: COLORS[detail.name] || '#fff' }}>
              {detail.name} — Epoch History
            </h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #333', color: '#71717a' }}>
                    <th style={{ padding: '8px', textAlign: 'left' }}>Epoch</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>Train Loss</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>Train Acc</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>Val Loss</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>Val Acc</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>AUC</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>EER</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>LR</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.epochs.map(ep => {
                    const isBest = ep.auc === detail.bestAuc
                    return (
                      <tr key={ep.epoch} style={{
                        borderBottom: '1px solid #1a1a2a',
                        background: isBest ? '#00ff9d10' : 'transparent',
                      }}>
                        <td style={{ padding: '6px 8px' }}>{ep.epoch}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(ep.train_loss)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{pct(ep.train_acc)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(ep.val_loss)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{pct(ep.val_acc)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: isBest ? '#00ff9d' : '#fff', fontWeight: isBest ? 700 : 400 }}>
                          {fmt(ep.auc, 6)}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{pct(ep.eer)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: '#71717a' }}>{ep.lr.toExponential(1)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: '#71717a' }}>{Math.round(ep.time)}s</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Live Logs */}
        {data?.logs && Object.keys(data.logs).length > 0 && (
          <div style={{ background: '#1a1a20', borderRadius: 12, padding: 20 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 14, color: '#a1a1aa' }}>Live Logs</h3>
            {Object.entries(data.logs).map(([key, lines]) => (
              <div key={key} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: '#71717a', marginBottom: 4 }}>{key}</div>
                <pre style={{
                  background: '#0a0a0c', padding: 12, borderRadius: 8,
                  fontSize: 11, lineHeight: 1.5, overflowX: 'auto',
                  color: '#a1a1aa', maxHeight: 200, overflowY: 'auto',
                  margin: 0,
                }}>
                  {lines.join('\n')}
                </pre>
              </div>
            ))}
          </div>
        )}

        {/* No data state */}
        {(!data || allModels.length === 0) && (
          <div style={{ textAlign: 'center', padding: 80, color: '#71717a' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>...</div>
            <p>Connecting to training metrics...</p>
          </div>
        )}
      </div>
    </div>
  )
}
