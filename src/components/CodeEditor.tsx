'use client'

import React, { useRef, useState, useEffect, useCallback } from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import styles from './CodeEditor.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

interface KeystrokeEvent {
    key: string
    pressTime: number
    releaseTime: number
    holdTime: number
    flightTime: number   // time from previous key-release to this key-press (inter-key latency)
    digramKey?: string   // previous key, for digram-pair analysis
}

interface BiometricBaseline {
    mean: number
    stdDev: number
    digramMap: Map<string, { mean: number; stdDev: number; count: number }>
}

interface RollingStats {
    burstCount: number          // keystrokes in last 300ms
    longPauseCount: number      // pauses > 2s between strokes
    pasteCount: number
    inconsistencyCount: number
    aiScore: number             // 0–100, probability of AI-assisted input
}

interface CodeEditorProps {
    onBiometricEvent?: (metrics: BiometricEvent) => void
}

export interface BiometricEvent {
    type: 'keystroke' | 'paste' | 'burst' | 'inconsistency' | 'long_pause' | 'rhythm_shift' | 'ai_score_update'
    holdTime?: number
    flightTime?: number
    key?: string
    zScore?: number
    length?: number          // paste length
    aiScore?: number         // 0–100 estimated AI probability
    rhythmDelta?: number     // how much rhythm shifted
    timestamp?: number
}

// ─── Statistical helpers ──────────────────────────────────────────────────────

function computeStats(values: number[]): { mean: number; stdDev: number } {
    if (values.length === 0) return { mean: 0, stdDev: 1 }
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
    return { mean, stdDev: Math.sqrt(variance) || 1 }
}

function zScore(value: number, mean: number, stdDev: number): number {
    return Math.abs((value - mean) / (stdDev || 1))
}

// Entropy of a distribution — high entropy = too uniform, suggests synthetic input
function shannonEntropy(values: number[]): number {
    if (values.length < 2) return 0
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1
    const bins = 10
    const buckets = new Array(bins).fill(0)
    values.forEach(v => {
        const idx = Math.min(bins - 1, Math.floor(((v - min) / range) * bins))
        buckets[idx]++
    })
    return buckets.reduce((entropy, count) => {
        if (count === 0) return entropy
        const p = count / values.length
        return entropy - p * Math.log2(p)
    }, 0)
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CodeEditor({ onBiometricEvent }: CodeEditorProps) {
    const [keystrokes, setKeystrokes] = useState<KeystrokeEvent[]>([])
    const [baseline, setBaseline] = useState<BiometricBaseline | null>(null)
    const [isCalibrating, setIsCalibrating] = useState(true)
    const [rollingStats, setRollingStats] = useState<RollingStats>({
        burstCount: 0, longPauseCount: 0, pasteCount: 0, inconsistencyCount: 0, aiScore: 0
    })
    const [displayMetrics, setDisplayMetrics] = useState({
        avgHold: 0, avgFlight: 0, entropy: 0, rhythmStability: 100, calibrationCount: 0,
    })

    const lastReleaseTimeRef = useRef<number>(0)
    const lastKeyRef = useRef<string>('')
    const activeKeysRef = useRef<Map<string, number>>(new Map())
    const calibrationPoolRef = useRef<number[]>([])
    const recentWindowRef = useRef<number[]>([])     // timestamps in last 300ms for burst detection
    const recentFlightsRef = useRef<number[]>([])    // sliding window for rhythm tracking
    const baselineRef = useRef<BiometricBaseline | null>(null)
    const isCalibratinRef = useRef(true)

    // Keep refs in sync so event listeners have fresh values
    useEffect(() => { baselineRef.current = baseline }, [baseline])
    useEffect(() => { isCalibratinRef.current = isCalibrating }, [isCalibrating])

    // ── AI Score Estimation (called periodically) ──────────────────────────
    const estimateAIScore = useCallback((flights: number[], holds: number[]): number => {
        if (flights.length < 10) return 0
        const { stdDev: flightStd } = computeStats(flights)
        const { stdDev: holdStd } = computeStats(holds)
        const entropy = shannonEntropy(flights)

        // AI-generated text tends to have extremely low inter-key latency variance
        // and suspicious uniformity. Human typing has natural variation.
        const lowVariancePenalty = flightStd < 20 ? 40 : flightStd < 50 ? 15 : 0
        const lowHoldVariancePenalty = holdStd < 5 ? 20 : 0
        const highEntropyPenalty = entropy > 3.2 ? 20 : 0   // unnaturally uniform
        const burstPenalty = flights.filter(f => f < 8 && f > 0).length / flights.length * 40

        return Math.min(100, Math.round(lowVariancePenalty + lowHoldVariancePenalty + highEntropyPenalty + burstPenalty))
    }, [])

    const handleEditorMount: OnMount = useCallback((editor) => {
        const domNode = editor.getDomNode()
        if (!domNode) return

        // ── keydown ──────────────────────────────────────────────────────────
        domNode.addEventListener('keydown', (e: KeyboardEvent) => {
            const now = performance.now()
            if (activeKeysRef.current.has(e.key)) return   // ignore key-repeat
            activeKeysRef.current.set(e.key, now)
        }, { capture: true })

        // ── keyup ────────────────────────────────────────────────────────────
        domNode.addEventListener('keyup', (e: KeyboardEvent) => {
            const now = performance.now()
            const pressTime = activeKeysRef.current.get(e.key)
            if (pressTime === undefined) return

            const holdTime = now - pressTime
            const flightTime = lastReleaseTimeRef.current > 0
                ? pressTime - lastReleaseTimeRef.current
                : 0
            const digramKey = lastKeyRef.current + '→' + e.key

            const event: KeystrokeEvent = {
                key: e.key, pressTime, releaseTime: now, holdTime, flightTime, digramKey
            }

            activeKeysRef.current.delete(e.key)
            lastReleaseTimeRef.current = now
            lastKeyRef.current = e.key

            // ── Sliding windows ──────────────────────────────────────────────
            recentWindowRef.current.push(now)
            recentWindowRef.current = recentWindowRef.current.filter(t => now - t < 300)

            recentFlightsRef.current.push(flightTime)
            if (recentFlightsRef.current.length > 50) recentFlightsRef.current.shift()

            // ── Calibration (first 30 keystrokes) ───────────────────────────
            if (isCalibratinRef.current) {
                if (flightTime > 0) calibrationPoolRef.current.push(flightTime)

                setDisplayMetrics(prev => ({ ...prev, calibrationCount: calibrationPoolRef.current.length }))

                if (calibrationPoolRef.current.length >= 30) {
                    const stats = computeStats(calibrationPoolRef.current)
                    const baseline: BiometricBaseline = {
                        mean: stats.mean,
                        stdDev: stats.stdDev,
                        digramMap: new Map()
                    }
                    setBaseline(baseline)
                    setIsCalibrating(false)
                }
            } else if (baselineRef.current) {
                const bl = baselineRef.current

                // ── Z-Score anomaly on flight time ───────────────────────────
                if (flightTime > 0) {
                    const z = zScore(flightTime, bl.mean, bl.stdDev)
                    if (z > 3.5) {
                        onBiometricEvent?.({ type: 'inconsistency', zScore: z, key: e.key, timestamp: now })
                        setRollingStats(prev => ({ ...prev, inconsistencyCount: prev.inconsistencyCount + 1 }))
                    }
                }

                // ── Digram-pair learning & anomaly ───────────────────────────
                if (flightTime > 0 && digramKey) {
                    const entry = bl.digramMap.get(digramKey)
                    if (entry && entry.count >= 5) {
                        const dz = zScore(flightTime, entry.mean, entry.stdDev)
                        if (dz > 4.0) {
                            onBiometricEvent?.({ type: 'rhythm_shift', zScore: dz, key: digramKey, timestamp: now })
                        }
                    }
                    if (entry) {
                        // Welford online update
                        const newCount = entry.count + 1
                        const delta = flightTime - entry.mean
                        const newMean = entry.mean + delta / newCount
                        const delta2 = flightTime - newMean
                        const newM2 = (entry.stdDev ** 2) * (entry.count) + delta * delta2
                        bl.digramMap.set(digramKey, { mean: newMean, stdDev: Math.sqrt(newM2 / newCount) || 1, count: newCount })
                    } else {
                        bl.digramMap.set(digramKey, { mean: flightTime, stdDev: 1, count: 1 })
                    }
                }

                // ── Rhythm shift: compare last 10 vs baseline ────────────────
                if (recentFlightsRef.current.length >= 10) {
                    const recentStats = computeStats(recentFlightsRef.current.slice(-10))
                    const rhythmDelta = Math.abs(recentStats.mean - bl.mean) / bl.mean
                    if (rhythmDelta > 0.6) {
                        onBiometricEvent?.({ type: 'rhythm_shift', rhythmDelta, timestamp: now })
                    }
                    const stability = Math.max(0, Math.round(100 - rhythmDelta * 60))
                    const entropy = shannonEntropy(recentFlightsRef.current)
                    const holds = keystrokes.slice(-20).map(k => k.holdTime)
                    const aiScore = estimateAIScore(recentFlightsRef.current, holds)

                    setDisplayMetrics(prev => ({ ...prev, avgFlight: recentStats.mean, entropy, rhythmStability: stability }))
                    setRollingStats(prev => {
                        if (Math.abs(prev.aiScore - aiScore) > 5) {
                            onBiometricEvent?.({ type: 'ai_score_update', aiScore, timestamp: now })
                        }
                        return { ...prev, aiScore }
                    })
                }
            }

            // ── Burst detection: > 8 keystrokes in 300ms ────────────────────
            if (recentWindowRef.current.length > 8) {
                onBiometricEvent?.({ type: 'burst', timestamp: now })
                setRollingStats(prev => ({ ...prev, burstCount: prev.burstCount + 1 }))
            }

            // ── Ultra-fast consecutive keys (< 8ms apart, inhuman) ───────────
            if (flightTime > 0 && flightTime < 8) {
                onBiometricEvent?.({ type: 'burst', timestamp: now })
            }

            // ── Long pause between keystrokes (> 3s — attention shift?) ─────
            if (flightTime > 3000) {
                onBiometricEvent?.({ type: 'long_pause', flightTime, timestamp: now })
                setRollingStats(prev => ({ ...prev, longPauseCount: prev.longPauseCount + 1 }))
            }

            // ── Always emit keystroke metrics ────────────────────────────────
            onBiometricEvent?.({ type: 'keystroke', holdTime, flightTime, key: e.key, timestamp: now })

            setKeystrokes(prev => {
                const next = [...prev.slice(-99), event]
                const allHolds = next.map(k => k.holdTime)
                const { mean: avgHold } = computeStats(allHolds)
                setDisplayMetrics(prev2 => ({ ...prev2, avgHold }))
                return next
            })
        }, { capture: true })

        // ── Paste ─────────────────────────────────────────────────────────────
        domNode.addEventListener('paste', (e: ClipboardEvent) => {
            const text = e.clipboardData?.getData('text') || ''
            onBiometricEvent?.({ type: 'paste', length: text.length, timestamp: performance.now() })
            setRollingStats(prev => ({ ...prev, pasteCount: prev.pasteCount + 1 }))
        })
    }, [onBiometricEvent, estimateAIScore])

    // ── AI score color ────────────────────────────────────────────────────────
    const aiColor = rollingStats.aiScore > 60 ? '#ff4d4d' : rollingStats.aiScore > 30 ? '#ffd700' : 'var(--color-primary)'
    const stabilityColor = displayMetrics.rhythmStability > 70 ? 'var(--color-primary)' : displayMetrics.rhythmStability > 40 ? '#ffd700' : '#ff4d4d'

    return (
        <div className={styles.container}>
            <div className={styles.editorWrapper}>
                <Editor
                    height="100%"
                    defaultLanguage="typescript"
                    defaultValue={`// Deep-Check Live Assessment\n// Start typing — your keystroke biometrics are being analyzed in real time.\n\nfunction solution(nums: number[], target: number): number[] {\n  \n}\n`}
                    theme="vs-dark"
                    options={{
                        minimap: { enabled: false },
                        fontSize: 14,
                        lineNumbers: 'on',
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        wordWrap: 'on',
                        suggestOnTriggerCharacters: false,
                        quickSuggestions: false,   // disable autocomplete — we want raw typing
                    }}
                    onMount={handleEditorMount}
                />
            </div>

            {/* Real-time Biometric Monitor */}
            <div className={styles.monitor}>
                <div className={styles.monitorHeader}>
                    <span className={styles.pulse}></span> Live Biometric Feed
                </div>

                <div className={styles.metric}>
                    <span>Hold Time</span>
                    <span>{displayMetrics.avgHold.toFixed(1)}ms</span>
                </div>
                <div className={styles.metric}>
                    <span>Flight Time</span>
                    <span>{displayMetrics.avgFlight.toFixed(1)}ms</span>
                </div>
                <div className={styles.metric}>
                    <span>Entropy</span>
                    <span>{displayMetrics.entropy.toFixed(2)} bits</span>
                </div>
                <div className={styles.metric}>
                    <span>Rhythm</span>
                    <span style={{ color: stabilityColor }}>{displayMetrics.rhythmStability}%</span>
                </div>
                <div className={styles.metric}>
                    <span>AI Risk</span>
                    <span style={{ color: aiColor, fontWeight: 700 }}>{rollingStats.aiScore}%</span>
                </div>
                <div className={styles.metric}>
                    <span>Baseline</span>
                    <span style={{ color: isCalibrating ? '#ffd700' : 'var(--color-primary)' }}>
                        {isCalibrating ? `${displayMetrics.calibrationCount}/30` : '✓ Set'}
                    </span>
                </div>
                <div className={styles.metric}>
                    <span>Pastes</span>
                    <span style={{ color: rollingStats.pasteCount > 0 ? '#ff4d4d' : 'inherit' }}>
                        {rollingStats.pasteCount}
                    </span>
                </div>
                <div className={styles.metric}>
                    <span>Anomalies</span>
                    <span style={{ color: rollingStats.inconsistencyCount > 2 ? '#ff4d4d' : 'inherit' }}>
                        {rollingStats.inconsistencyCount}
                    </span>
                </div>

                <div className={styles.history}>
                    {keystrokes.slice(-30).map((k, i, arr) => {
                        const isAnomaly = baseline
                            ? zScore(k.flightTime, baseline.mean, baseline.stdDev) > 3.5
                            : false
                        return (
                            <div
                                key={i}
                                className={styles.keyDot}
                                style={{
                                    opacity: Math.max(0.15, (i + 1) / arr.length),
                                    background: isAnomaly ? '#ff4d4d' : 'var(--color-primary)',
                                    width: isAnomaly ? '8px' : '5px',
                                    height: isAnomaly ? '8px' : '5px',
                                }}
                            />
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
