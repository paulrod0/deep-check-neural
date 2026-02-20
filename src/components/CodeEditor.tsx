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
    flightTime: number
    digramKey?: string
}

interface BiometricBaseline {
    mean: number
    stdDev: number
    digramMap: Map<string, { mean: number; stdDev: number; count: number }>
}

interface RollingStats {
    burstCount: number
    longPauseCount: number
    pasteCount: number
    inconsistencyCount: number
    aiScore: number
}

interface CodeEditorProps {
    onBiometricEvent?: (metrics: BiometricEvent) => void
    language?: string   // Monaco language id: 'typescript' | 'python' | 'plaintext' etc.
}

export interface BiometricEvent {
    type: 'keystroke' | 'paste' | 'burst' | 'inconsistency' | 'long_pause' | 'rhythm_shift' | 'ai_score_update' | 'content_injection' | 'drag_drop'
    holdTime?: number
    flightTime?: number
    key?: string
    zScore?: number
    length?: number
    aiScore?: number
    rhythmDelta?: number
    timestamp?: number
    detail?: string
}

// ─── Keys to IGNORE in biometric analysis ────────────────────────────────────
// Modifier keys, navigation, function keys — these are NOT typing chars and
// pollute flight-time windows. Pressing Ctrl while navigating looks like burst.

const IGNORED_KEYS = new Set([
    'Control', 'Meta', 'Alt', 'Shift', 'CapsLock',
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'Home', 'End', 'PageUp', 'PageDown',
    'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
    'Escape', 'Tab', 'ContextMenu',
    'Insert', 'PrintScreen', 'Pause', 'ScrollLock', 'NumLock',
    'Dead',  // dead keys (accent compositions)
])

// Keys that, when held WITH modifier, indicate a clipboard/selection action
// We still record them as keystrokes but tag them as "command" (not text input)
const isCommandKeystroke = (e: KeyboardEvent): boolean =>
    e.ctrlKey || e.metaKey || e.altKey

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

// Shannon entropy on a binned distribution.
// For AI detection: human typing = HIGH entropy (natural variation).
// Robotic input = LOW entropy (everything in 1-2 bins).
// (Note: this is the OPPOSITE of the intuition of "too uniform" —
//  uniform = all bins equal = MAX entropy. We want to flag LOW entropy =
//  everything clustered in one bin = macro-like regularity at same speed.)
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

// ─── AI Score ─────────────────────────────────────────────────────────────────
// Only flags physically impossible or statistically inhuman patterns.
// Reference: Banerjee & Woodard 2012, Mondal & Bours 2013.
// Human range: flight stdDev 40–120ms, hold stdDev 15–50ms.

function estimateAIScore(flights: number[], holds: number[]): number {
    if (flights.length < 20) return 0

    const { mean: flightMean, stdDev: flightStd } = computeStats(flights)
    const { stdDev: holdStd } = computeStats(holds)
    const entropy = shannonEntropy(flights)

    let score = 0

    // Signal 1: Physically impossible gaps < 12ms (neuro-motor minimum ~15ms)
    const impossiblyFast = flights.filter(f => f > 0 && f < 12).length / flights.length
    if (impossiblyFast > 0.10) score += Math.round(impossiblyFast * 60)

    // Signal 2: Robotically uniform flight time (stdDev < 8ms is inhuman)
    if (flightStd < 8)  score += 40
    else if (flightStd < 14) score += 18

    // Signal 3: Hold time too uniform (stdDev < 5ms)
    if (holdStd < 5)  score += 25
    else if (holdStd < 10) score += 10

    // Signal 4: LOW entropy = all keystrokes at the same pace (macro-like)
    // Human entropy on 10 bins is typically 2.5–3.3. Below 1.5 = very suspicious.
    if (entropy < 1.5) score += 20
    else if (entropy < 2.0) score += 8

    // Signal 5: Autocomplete pattern — very slow mean with low variance
    // (long thinking pause, then sudden uniform burst)
    if (flightMean > 600 && flightStd < 25) score += 15

    return Math.min(100, score)
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CodeEditor({ onBiometricEvent, language = 'typescript' }: CodeEditorProps) {
    const [keystrokes, setKeystrokes]   = useState<KeystrokeEvent[]>([])
    const [baseline, setBaseline]       = useState<BiometricBaseline | null>(null)
    const [isCalibrating, setIsCalibrating] = useState(true)
    const [rollingStats, setRollingStats] = useState<RollingStats>({
        burstCount: 0, longPauseCount: 0, pasteCount: 0, inconsistencyCount: 0, aiScore: 0
    })
    const [displayMetrics, setDisplayMetrics] = useState({
        avgHold: 0, avgFlight: 0, entropy: 0, rhythmStability: 100, calibrationCount: 0,
    })

    const lastReleaseTimeRef  = useRef<number>(0)
    const lastKeyRef          = useRef<string>('')
    const activeKeysRef       = useRef<Map<string, number>>(new Map())
    const calibrationPoolRef  = useRef<number[]>([])
    // Only character-key timestamps (no modifiers) for burst window
    const charWindowRef       = useRef<number[]>([])
    const recentFlightsRef    = useRef<number[]>([])
    const baselineRef         = useRef<BiometricBaseline | null>(null)
    const isCalibratinRef     = useRef(true)
    // Burst debounce — don't fire burst more than once per 2s
    const lastBurstRef        = useRef<number>(0)
    // Content injection sentinel — snapshot of editor value per frame
    const lastContentLenRef   = useRef<number>(0)
    const lastKeystrokeTimeRef= useRef<number>(0)

    useEffect(() => { baselineRef.current = baseline }, [baseline])
    useEffect(() => { isCalibratinRef.current = isCalibrating }, [isCalibrating])

    const handleEditorMount: OnMount = useCallback((editor) => {
        const domNode = editor.getDomNode()
        if (!domNode) return

        // ── Content injection detection ───────────────────────────────────────
        // Polls editor content every 800ms. If content grew by more than 1 char
        // without a recent keystroke or paste event, it was injected programmatically
        // (autotyper script, IDE plugin, AI autocomplete accepted via mouse, etc.)
        const contentPollInterval = setInterval(() => {
            const model = editor.getModel()
            if (!model) return
            const currentLen  = model.getValueLength()
            const prevLen     = lastContentLenRef.current
            const timeSinceKey = performance.now() - lastKeystrokeTimeRef.current

            // If content grew by >2 chars and last keystroke was >1.5s ago → injection
            if (currentLen > prevLen + 2 && timeSinceKey > 1500) {
                const injected = currentLen - prevLen
                onBiometricEvent?.({
                    type: 'content_injection',
                    length: injected,
                    detail: `+${injected} chars without typing`,
                    timestamp: performance.now()
                })
            }
            lastContentLenRef.current = currentLen
        }, 800)

        // ── keydown ───────────────────────────────────────────────────────────
        domNode.addEventListener('keydown', (e: KeyboardEvent) => {
            const now = performance.now()
            if (activeKeysRef.current.has(e.key)) return   // ignore key-repeat
            activeKeysRef.current.set(e.key, now)
        }, { capture: true })

        // ── keyup ─────────────────────────────────────────────────────────────
        domNode.addEventListener('keyup', (e: KeyboardEvent) => {
            const now = performance.now()
            const pressTime = activeKeysRef.current.get(e.key)
            if (pressTime === undefined) return
            activeKeysRef.current.delete(e.key)

            // ── Skip modifier / navigation keys entirely ──────────────────────
            if (IGNORED_KEYS.has(e.key)) return

            // ── Skip command keystrokes (Ctrl+C, Ctrl+Z, etc.) ───────────────
            // These are handled by paste/input events, not here
            if (isCommandKeystroke(e)) return

            const holdTime   = now - pressTime
            lastKeystrokeTimeRef.current = now

            // Flight time: only from previous *character* key release
            const flightTime = lastReleaseTimeRef.current > 0
                ? pressTime - lastReleaseTimeRef.current
                : 0
            const digramKey  = lastKeyRef.current + '→' + e.key

            const event: KeystrokeEvent = {
                key: e.key, pressTime, releaseTime: now, holdTime, flightTime, digramKey
            }

            lastReleaseTimeRef.current = now
            lastKeyRef.current = e.key

            // ── Burst window — CHARACTER keys only ────────────────────────────
            charWindowRef.current.push(now)
            charWindowRef.current = charWindowRef.current.filter(t => now - t < 300)

            // ── Flight sliding window ─────────────────────────────────────────
            if (flightTime > 0) {
                recentFlightsRef.current.push(flightTime)
                if (recentFlightsRef.current.length > 60) recentFlightsRef.current.shift()
            }

            // ── Calibration ───────────────────────────────────────────────────
            if (isCalibratinRef.current) {
                if (flightTime > 10 && flightTime < 2000) {   // exclude outliers during calibration
                    calibrationPoolRef.current.push(flightTime)
                }
                setDisplayMetrics(prev => ({ ...prev, calibrationCount: calibrationPoolRef.current.length }))

                if (calibrationPoolRef.current.length >= 30) {
                    const stats = computeStats(calibrationPoolRef.current)
                    setBaseline({ mean: stats.mean, stdDev: stats.stdDev, digramMap: new Map() })
                    setIsCalibrating(false)
                }
            } else if (baselineRef.current) {
                const bl = baselineRef.current

                // ── Z-Score anomaly ───────────────────────────────────────────
                if (flightTime > 0) {
                    const z = zScore(flightTime, bl.mean, bl.stdDev)
                    if (z > 3.5) {
                        onBiometricEvent?.({ type: 'inconsistency', zScore: z, key: e.key, timestamp: now })
                        setRollingStats(prev => ({ ...prev, inconsistencyCount: prev.inconsistencyCount + 1 }))
                    }
                }

                // ── Digram-pair analysis ──────────────────────────────────────
                if (flightTime > 0) {
                    const entry = bl.digramMap.get(digramKey)
                    if (entry && entry.count >= 5) {
                        const dz = zScore(flightTime, entry.mean, entry.stdDev)
                        if (dz > 4.0) {
                            onBiometricEvent?.({ type: 'rhythm_shift', zScore: dz, key: digramKey, timestamp: now })
                        }
                    }
                    if (entry) {
                        const nc    = entry.count + 1
                        const delta = flightTime - entry.mean
                        const nm    = entry.mean + delta / nc
                        const nm2   = (entry.stdDev ** 2) * entry.count + delta * (flightTime - nm)
                        bl.digramMap.set(digramKey, { mean: nm, stdDev: Math.sqrt(nm2 / nc) || 1, count: nc })
                    } else {
                        bl.digramMap.set(digramKey, { mean: flightTime, stdDev: 1, count: 1 })
                    }
                }

                // ── Rhythm shift ──────────────────────────────────────────────
                if (recentFlightsRef.current.length >= 10) {
                    const recentStats = computeStats(recentFlightsRef.current.slice(-10))
                    const rhythmDelta = Math.abs(recentStats.mean - bl.mean) / bl.mean
                    if (rhythmDelta > 1.5) {
                        onBiometricEvent?.({ type: 'rhythm_shift', rhythmDelta, timestamp: now })
                    }
                    const stability = Math.max(0, Math.round(100 - rhythmDelta * 60))
                    const entropy   = shannonEntropy(recentFlightsRef.current)
                    const holds     = keystrokes.slice(-20).map(k => k.holdTime)
                    const aiScore   = estimateAIScore(recentFlightsRef.current, holds)

                    setDisplayMetrics(prev => ({ ...prev, avgFlight: recentStats.mean, entropy, rhythmStability: stability }))
                    setRollingStats(prev => {
                        if (Math.abs(prev.aiScore - aiScore) > 5) {
                            onBiometricEvent?.({ type: 'ai_score_update', aiScore, timestamp: now })
                        }
                        return { ...prev, aiScore }
                    })
                }
            }

            // ── Burst: > 12 CHAR keystrokes in 300ms ─────────────────────────
            // (modifier-free — we only count character keys)
            // Debounced: max 1 burst alert per 2s to avoid spam
            if (charWindowRef.current.length > 12) {
                const sinceLast = now - lastBurstRef.current
                if (sinceLast > 2000) {
                    lastBurstRef.current = now
                    onBiometricEvent?.({ type: 'burst', timestamp: now, detail: `${charWindowRef.current.length} chars/300ms` })
                    setRollingStats(prev => ({ ...prev, burstCount: prev.burstCount + 1 }))
                }
            }

            // ── Physically impossible gap (< 12ms between char keys) ─────────
            // Only flag once every 2s (same debounce as burst)
            if (flightTime > 0 && flightTime < 12) {
                const sinceLast = now - lastBurstRef.current
                if (sinceLast > 2000) {
                    lastBurstRef.current = now
                    onBiometricEvent?.({ type: 'burst', timestamp: now, detail: `${flightTime.toFixed(1)}ms gap (inhuman)` })
                }
            }

            // ── Long pause ────────────────────────────────────────────────────
            if (flightTime > 3000) {
                onBiometricEvent?.({ type: 'long_pause', flightTime, timestamp: now })
                setRollingStats(prev => ({ ...prev, longPauseCount: prev.longPauseCount + 1 }))
            }

            onBiometricEvent?.({ type: 'keystroke', holdTime, flightTime, key: e.key, timestamp: now })

            setKeystrokes(prev => {
                const next = [...prev.slice(-99), event]
                const { mean: avgHold } = computeStats(next.map(k => k.holdTime))
                setDisplayMetrics(prev2 => ({ ...prev2, avgHold }))
                return next
            })
        }, { capture: true })

        // ── Paste via clipboard event ─────────────────────────────────────────
        domNode.addEventListener('paste', (e: ClipboardEvent) => {
            const text = e.clipboardData?.getData('text') || ''
            lastKeystrokeTimeRef.current = performance.now()    // reset injection detector
            lastContentLenRef.current += text.length
            onBiometricEvent?.({ type: 'paste', length: text.length, timestamp: performance.now() })
            setRollingStats(prev => ({ ...prev, pasteCount: prev.pasteCount + 1 }))
        })

        // ── Drag & drop text (bypasses paste event) ───────────────────────────
        domNode.addEventListener('drop', (e: DragEvent) => {
            const text = e.dataTransfer?.getData('text/plain') || ''
            if (text.length > 0) {
                lastContentLenRef.current += text.length
                onBiometricEvent?.({ type: 'content_injection', length: text.length, detail: 'Drag & drop text detected', timestamp: performance.now() })
                setRollingStats(prev => ({ ...prev, pasteCount: prev.pasteCount + 1 }))
            }
        })

        return () => clearInterval(contentPollInterval)
    }, [onBiometricEvent])

    const aiColor       = rollingStats.aiScore > 60 ? '#ff4d4d' : rollingStats.aiScore > 30 ? '#ffd700' : 'var(--color-primary)'
    const stabilityColor= displayMetrics.rhythmStability > 70 ? 'var(--color-primary)' : displayMetrics.rhythmStability > 40 ? '#ffd700' : '#ff4d4d'

    return (
        <div className={styles.container}>
            <div className={styles.editorWrapper}>
                <Editor
                    height="100%"
                    defaultLanguage={language}
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
                        quickSuggestions: false,
                        // Disable drag & drop at Monaco level too (belt + suspenders)
                        dragAndDrop: false,
                    }}
                    onMount={handleEditorMount}
                />
            </div>

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
                        const isAnomaly = baseline ? zScore(k.flightTime, baseline.mean, baseline.stdDev) > 3.5 : false
                        return (
                            <div key={i} className={styles.keyDot} style={{
                                opacity: Math.max(0.15, (i + 1) / arr.length),
                                background: isAnomaly ? '#ff4d4d' : 'var(--color-primary)',
                                width: isAnomaly ? '8px' : '5px',
                                height: isAnomaly ? '8px' : '5px',
                            }} />
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
