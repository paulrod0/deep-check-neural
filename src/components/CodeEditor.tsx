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
    fingerGroup?: FingerGroup
}

// Approximate finger groups by key position (QWERTY layout)
type FingerGroup = 'left_pinky' | 'left_ring' | 'left_middle' | 'left_index' | 'thumbs' | 'right_index' | 'right_middle' | 'right_ring' | 'right_pinky'

interface BiometricBaseline {
    mean: number
    stdDev: number
    digramMap: Map<string, { mean: number; stdDev: number; count: number }>
    // Key-specific profiles
    keyProfiles: Map<string, { holdMean: number; holdStd: number; count: number }>
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
    type: 'keystroke' | 'paste' | 'burst' | 'inconsistency' | 'long_pause' | 'rhythm_shift'
        | 'ai_score_update' | 'content_injection' | 'drag_drop'
        | 'fatigue_detected' | 'backspace_anomaly' | 'fft_periodicity'
    holdTime?: number
    flightTime?: number
    key?: string
    zScore?: number
    length?: number
    aiScore?: number
    rhythmDelta?: number
    timestamp?: number
    detail?: string
    // Advanced fields
    skewness?: number
    kurtosis?: number
    velocityGradient?: number
    backspaceLatency?: number
    periodicityScore?: number
    fatigueRate?: number
    keyFingerGroup?: FingerGroup
}

// ─── Keys to IGNORE in biometric analysis ────────────────────────────────────
const IGNORED_KEYS = new Set([
    'Control', 'Meta', 'Alt', 'Shift', 'CapsLock',
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'Home', 'End', 'PageUp', 'PageDown',
    'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
    'Escape', 'Tab', 'ContextMenu',
    'Insert', 'PrintScreen', 'Pause', 'ScrollLock', 'NumLock',
    'Dead',
])

// Keys that are NOT counted in the burst character window.
// Enter causes Monaco to auto-insert indentation (false content injection) and
// is naturally repeated when navigating across lines — it should not count toward
// the "inhuman burst" threshold, which is designed to detect copy-injection.
const BURST_EXCLUDED_KEYS = new Set([
    'Enter', 'Backspace', 'Delete', 'Tab',
])

const isCommandKeystroke = (e: KeyboardEvent): boolean =>
    e.ctrlKey || e.metaKey || e.altKey

// ─── Finger group mapping (QWERTY) ───────────────────────────────────────────
// Maps keys to approximate finger used — different fingers have different biomechanics

const FINGER_MAP: Record<string, FingerGroup> = {
    // Left pinky
    'q':'left_pinky','a':'left_pinky','z':'left_pinky','1':'left_pinky','`':'left_pinky',
    // Left ring
    'w':'left_ring','s':'left_ring','x':'left_ring','2':'left_ring',
    // Left middle
    'e':'left_middle','d':'left_middle','c':'left_middle','3':'left_middle',
    // Left index
    'r':'left_index','f':'left_index','v':'left_index','4':'left_index',
    't':'left_index','g':'left_index','b':'left_index','5':'left_index',
    // Thumbs (space, enter)
    ' ':'thumbs','Enter':'thumbs',
    // Right index
    'y':'right_index','h':'right_index','n':'right_index','6':'right_index',
    'u':'right_index','j':'right_index','m':'right_index','7':'right_index',
    // Right middle
    'i':'right_middle','k':'right_middle',',':'right_middle','8':'right_middle',
    // Right ring
    'o':'right_ring','l':'right_ring','.':'right_ring','9':'right_ring',
    // Right pinky
    'p':'right_pinky',';':'right_pinky','/':'right_pinky','0':'right_pinky',
    '[':'right_pinky',']':'right_pinky','\\':'right_pinky','\'':'right_pinky',
    '-':'right_pinky','=':'right_pinky','Backspace':'right_pinky',
}

function getFingerGroup(key: string): FingerGroup | undefined {
    return FINGER_MAP[key.toLowerCase()] ?? FINGER_MAP[key]
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

// ─── Skewness & Kurtosis ──────────────────────────────────────────────────────
// Human flight time distributions are right-skewed (long tail of pauses).
// Robotic input has near-zero skewness (symmetric around mean).
// Excess kurtosis > 3: leptokurtic (bot-like peaks); < 3: platykurtic (human).

function computeSkewness(values: number[]): number {
    if (values.length < 3) return 0
    const { mean, stdDev } = computeStats(values)
    const n = values.length
    const m3 = values.reduce((s, v) => s + ((v - mean) / stdDev) ** 3, 0) / n
    return (n / ((n - 1) * (n - 2))) * m3 * n  // Fisher skewness (bias-corrected)
}

function computeKurtosis(values: number[]): number {
    if (values.length < 4) return 0
    const { mean, stdDev } = computeStats(values)
    const n = values.length
    const m4 = values.reduce((s, v) => s + ((v - mean) / stdDev) ** 4, 0) / n
    return m4 - 3  // excess kurtosis (0 = normal, >0 = heavy tails like bot peaks)
}

// ─── Shannon entropy ──────────────────────────────────────────────────────────
// Human: HIGH entropy (natural variation). Robot: LOW entropy (one pace).

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

// ─── FFT periodicity detection ────────────────────────────────────────────────
// A bot typing at constant intervals produces a strong periodic signal.
// We compute a simplified DFT magnitude spectrum and look for dominant peaks.
// If the dominant frequency accounts for > 60% of total spectral power → periodic.
//
// Reference: Shen et al. 2013 "User authentication through typing biometrics"

function computePeriodicityScore(flights: number[]): number {
    const n = flights.length
    if (n < 16) return 0

    // Normalize to zero-mean
    const { mean } = computeStats(flights)
    const signal = flights.map(f => f - mean)

    // DFT: compute magnitudes for frequencies k=1..n/2
    let maxMag = 0
    let totalPower = 0
    const magnitudes: number[] = []

    for (let k = 1; k <= Math.floor(n / 2); k++) {
        let re = 0, im = 0
        for (let t = 0; t < n; t++) {
            const angle = (2 * Math.PI * k * t) / n
            re += signal[t] * Math.cos(angle)
            im -= signal[t] * Math.sin(angle)
        }
        const mag = Math.sqrt(re * re + im * im)
        magnitudes.push(mag)
        totalPower += mag
        if (mag > maxMag) maxMag = mag
    }

    if (totalPower === 0) return 0
    // Periodicity = how dominant the strongest frequency is
    return Math.round((maxMag / totalPower) * 100)
}

// ─── Velocity gradient (acceleration pattern) ─────────────────────────────────
// Humans accelerate at start of a typing burst and decelerate at end.
// Bots maintain constant velocity.
// Returns: positive = accelerating, negative = decelerating, ~0 = constant.

function computeVelocityGradient(flights: number[]): number {
    if (flights.length < 6) return 0
    const half = Math.floor(flights.length / 2)
    const { mean: firstHalf } = computeStats(flights.slice(0, half))
    const { mean: secondHalf } = computeStats(flights.slice(half))
    // Positive = slowing down (human fatigue), negative = speeding up
    return (secondHalf - firstHalf) / (firstHalf || 1)
}

// ─── Fatigue modeling ─────────────────────────────────────────────────────────
// Humans slow down progressively over time. This computes the linear regression
// slope of flight times over the session (ms increase per keystroke).
// Bots have slope ~0. Humans typically +0.5 to +2ms per keystroke over long sessions.

function computeFatigueRate(allFlights: number[]): number {
    if (allFlights.length < 30) return 0
    // Compute linear regression slope
    const n = allFlights.length
    const xs = allFlights.map((_, i) => i)
    const meanX = (n - 1) / 2
    const { mean: meanY } = computeStats(allFlights)
    const numerator   = xs.reduce((s, x, i) => s + (x - meanX) * (allFlights[i] - meanY), 0)
    const denominator = xs.reduce((s, x) => s + (x - meanX) ** 2, 0)
    return denominator === 0 ? 0 : numerator / denominator
}

// ─── Backspace correction analysis ───────────────────────────────────────────
// Humans make typos and correct them. After a typo they press Backspace.
// The latency distribution of [error_key → Backspace] is characteristic.
// Bots either never use Backspace, or use it with inhuman uniformity.

interface BackspaceRecord {
    prevKey: string
    latency: number   // ms between prev key release and Backspace press
}

// ─── AI Score (enhanced — 9 signals) ─────────────────────────────────────────
// Now includes skewness, kurtosis, periodicity, gradient, backspace patterns.

function estimateAIScore(
    flights: number[],
    holds: number[],
    backspaceLatencies: number[],
    allFlights: number[]
): number {
    if (flights.length < 20) return 0

    const { mean: flightMean, stdDev: flightStd } = computeStats(flights)
    const { stdDev: holdStd } = computeStats(holds)
    const entropy     = shannonEntropy(flights)
    const skewness    = computeSkewness(flights)
    const kurtosis    = computeKurtosis(flights)
    const periodicity = computePeriodicityScore(flights)
    const gradient    = computeVelocityGradient(flights)
    const fatigue     = computeFatigueRate(allFlights)

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
    if (entropy < 1.5) score += 20
    else if (entropy < 2.0) score += 8

    // Signal 5: Autocomplete pattern — very slow mean with low variance
    if (flightMean > 600 && flightStd < 25) score += 15

    // Signal 6: Skewness anomaly
    // Human right-skewed: skewness 0.5–2.5. Near-zero or negative = suspicious.
    if (Math.abs(skewness) < 0.15) score += 18     // perfectly symmetric = bot
    else if (skewness < 0) score += 10              // left-skewed = very unusual for humans

    // Signal 7: Kurtosis anomaly
    // Bots produce leptokurtic distributions (spike at one speed).
    // Excess kurtosis > 5 with low stdDev is a strong bot signature.
    if (kurtosis > 5 && flightStd < 20) score += 15
    else if (kurtosis > 3 && flightStd < 15) score += 8

    // Signal 8: FFT periodicity — dominant frequency > 55% of spectral power
    if (periodicity > 55) score += 20
    else if (periodicity > 40) score += 10

    // Signal 9: No velocity gradient (bots don't accelerate or decelerate)
    // Humans always have |gradient| > 0.05 in natural typing (they warm up or tire)
    if (Math.abs(gradient) < 0.03) score += 10

    // Signal 10: No fatigue (bots have slope ≈ 0 over entire session)
    if (allFlights.length >= 50 && Math.abs(fatigue) < 0.1) score += 8

    // Signal 11: Backspace patterns
    if (backspaceLatencies.length > 0) {
        const { stdDev: bsStd } = computeStats(backspaceLatencies)
        // Zero backspaces in long session is suspicious (unless perfect typist)
        if (allFlights.length > 80 && backspaceLatencies.length === 0) score += 10
        // Inhuman uniformity in Backspace corrections
        if (backspaceLatencies.length >= 3 && bsStd < 10) score += 12
    } else if (allFlights.length > 80) {
        // No corrections in 80+ keystrokes — unusual for humans
        score += 8
    }

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
        skewness: 0, kurtosis: 0, periodicity: 0, fatigue: 0,
    })

    const lastReleaseTimeRef   = useRef<number>(0)
    const lastKeyRef           = useRef<string>('')
    const activeKeysRef        = useRef<Map<string, number>>(new Map())
    const calibrationPoolRef   = useRef<number[]>([])
    const charWindowRef        = useRef<number[]>([])
    const recentFlightsRef     = useRef<number[]>([])
    const allFlightsRef        = useRef<number[]>([])    // full session — for fatigue
    const allHoldsRef          = useRef<number[]>([])    // full session holds
    const baselineRef          = useRef<BiometricBaseline | null>(null)
    const isCalibratinRef      = useRef(true)
    const lastBurstRef         = useRef<number>(0)
    const lastContentLenRef    = useRef<number>(0)
    const lastKeystrokeTimeRef = useRef<number>(0)
    // Track last Enter press time to suppress auto-indentation false positives
    const lastEnterTimeRef     = useRef<number>(0)
    // Backspace correction tracking
    const backspaceRecordsRef  = useRef<BackspaceRecord[]>([])
    const lastCharKeyRef       = useRef<{ key: string; releaseTime: number } | null>(null)
    // Periodicity / FFT — fire at most every 5s
    const lastPeriodicityCheckRef = useRef<number>(0)
    // Fatigue — fire at most every 10s
    const lastFatigueCheckRef  = useRef<number>(0)

    useEffect(() => { baselineRef.current = baseline }, [baseline])
    useEffect(() => { isCalibratinRef.current = isCalibrating }, [isCalibrating])

    const handleEditorMount: OnMount = useCallback((editor) => {
        const domNode = editor.getDomNode()
        if (!domNode) return

        // ── Content injection detection ───────────────────────────────────────
        // Grace period logic:
        //   - Normal typing: 1500ms since last keyup before flagging
        //   - After Enter: 3000ms grace, because Monaco auto-inserts newline +
        //     indentation characters (e.g. "    " for a function body) AFTER the
        //     keyup event fires. This is NOT external injection.
        //   - Minimum delta to flag: > 10 chars (small deltas = normal auto-indent)
        const contentPollInterval = setInterval(() => {
            const model = editor.getModel()
            if (!model) return
            const now          = performance.now()
            const currentLen   = model.getValueLength()
            const prevLen      = lastContentLenRef.current
            const timeSinceKey = now - lastKeystrokeTimeRef.current
            const timeSinceEnter = now - lastEnterTimeRef.current

            // Suppress if Enter was pressed recently (auto-indent grace window)
            const enterGrace = timeSinceEnter < 3000
            // Suppress if any key was pressed recently
            const keyGrace   = timeSinceKey < 1500

            if (!enterGrace && !keyGrace && currentLen > prevLen + 10) {
                const injected = currentLen - prevLen
                onBiometricEvent?.({
                    type: 'content_injection',
                    length: injected,
                    detail: `+${injected} chars without typing`,
                    timestamp: now
                })
            }
            lastContentLenRef.current = currentLen
        }, 800)

        // ── keydown ───────────────────────────────────────────────────────────
        domNode.addEventListener('keydown', (e: KeyboardEvent) => {
            const now = performance.now()
            if (activeKeysRef.current.has(e.key)) return
            activeKeysRef.current.set(e.key, now)
        }, { capture: true })

        // ── keyup ─────────────────────────────────────────────────────────────
        domNode.addEventListener('keyup', (e: KeyboardEvent) => {
            const now = performance.now()
            const pressTime = activeKeysRef.current.get(e.key)
            if (pressTime === undefined) return
            activeKeysRef.current.delete(e.key)

            if (IGNORED_KEYS.has(e.key)) return
            if (isCommandKeystroke(e)) return

            const holdTime   = now - pressTime
            lastKeystrokeTimeRef.current = now

            // Track Enter for auto-indentation grace window in content injection detector
            if (e.key === 'Enter') {
                lastEnterTimeRef.current = now
            }

            const flightTime = lastReleaseTimeRef.current > 0
                ? pressTime - lastReleaseTimeRef.current
                : 0
            const digramKey  = lastKeyRef.current + '→' + e.key
            const fingerGroup = getFingerGroup(e.key)

            // ── Backspace correction analysis ─────────────────────────────────
            // When we see a Backspace, compute latency from the LAST char key release
            if (e.key === 'Backspace' && lastCharKeyRef.current) {
                const bsLatency = pressTime - lastCharKeyRef.current.releaseTime
                if (bsLatency > 0 && bsLatency < 5000) {   // reasonable correction window
                    const record: BackspaceRecord = { prevKey: lastCharKeyRef.current.key, latency: bsLatency }
                    backspaceRecordsRef.current.push(record)

                    // Check for anomalies in backspace timing
                    if (backspaceRecordsRef.current.length >= 3) {
                        const latencies = backspaceRecordsRef.current.slice(-10).map(r => r.latency)
                        const { stdDev: bsStd, mean: bsMean } = computeStats(latencies)
                        // Inhuman uniformity: all corrections at exact same latency
                        if (bsStd < 8 && latencies.length >= 3) {
                            onBiometricEvent?.({
                                type: 'backspace_anomaly',
                                backspaceLatency: bsMean,
                                detail: `Backspace stdDev ${bsStd.toFixed(1)}ms (inhuman uniformity)`,
                                timestamp: now
                            })
                        }
                    }
                }
            }

            const event: KeystrokeEvent = {
                key: e.key, pressTime, releaseTime: now, holdTime, flightTime, digramKey, fingerGroup
            }

            lastReleaseTimeRef.current = now

            // Update lastCharKey only for non-Backspace typing
            if (e.key !== 'Backspace') {
                lastCharKeyRef.current = { key: e.key, releaseTime: now }
                lastKeyRef.current = e.key
            }

            // ── Store holds ───────────────────────────────────────────────────
            allHoldsRef.current.push(holdTime)
            if (flightTime > 0) {
                allFlightsRef.current.push(flightTime)
            }

            // ── Burst window — printable character keys only ──────────────────
            // Enter, Backspace, Delete, Tab are excluded:
            //   - Enter causes Monaco to auto-insert indentation (false +N chars)
            //   - Backspace/Delete are editing operations, not injection bursts
            //   - Tab in code editors jumps indent levels, not text injection
            if (!BURST_EXCLUDED_KEYS.has(e.key)) {
                charWindowRef.current.push(now)
                charWindowRef.current = charWindowRef.current.filter(t => now - t < 300)
            }

            // ── Flight sliding window (last 60) ───────────────────────────────
            if (flightTime > 0) {
                recentFlightsRef.current.push(flightTime)
                if (recentFlightsRef.current.length > 60) recentFlightsRef.current.shift()
            }

            // ── Calibration ───────────────────────────────────────────────────
            if (isCalibratinRef.current) {
                if (flightTime > 10 && flightTime < 2000) {
                    calibrationPoolRef.current.push(flightTime)
                }
                setDisplayMetrics(prev => ({ ...prev, calibrationCount: calibrationPoolRef.current.length }))

                if (calibrationPoolRef.current.length >= 30) {
                    const stats = computeStats(calibrationPoolRef.current)
                    setBaseline({
                        mean: stats.mean,
                        stdDev: stats.stdDev,
                        digramMap: new Map(),
                        keyProfiles: new Map()
                    })
                    setIsCalibrating(false)
                }
            } else if (baselineRef.current) {
                const bl = baselineRef.current

                // ── Z-Score anomaly ───────────────────────────────────────────
                if (flightTime > 0) {
                    const z = zScore(flightTime, bl.mean, bl.stdDev)
                    if (z > 3.5) {
                        onBiometricEvent?.({ type: 'inconsistency', zScore: z, key: e.key, keyFingerGroup: fingerGroup, timestamp: now })
                        setRollingStats(prev => ({ ...prev, inconsistencyCount: prev.inconsistencyCount + 1 }))
                    }
                }

                // ── Key-specific hold time profiles ───────────────────────────
                // Each key/finger has its own hold distribution; check against it
                if (bl.keyProfiles.has(e.key)) {
                    const kp = bl.keyProfiles.get(e.key)!
                    if (kp.count >= 5) {
                        const kz = zScore(holdTime, kp.holdMean, kp.holdStd)
                        if (kz > 4.0) {
                            onBiometricEvent?.({
                                type: 'inconsistency',
                                zScore: kz,
                                key: e.key,
                                keyFingerGroup: fingerGroup,
                                detail: `Key-specific hold anomaly (${e.key})`,
                                timestamp: now
                            })
                        }
                    }
                    // Online update of key profile (Welford's algorithm)
                    const kp2 = bl.keyProfiles.get(e.key)!
                    const nc = kp2.count + 1
                    const delta = holdTime - kp2.holdMean
                    const nm = kp2.holdMean + delta / nc
                    const nm2 = (kp2.holdStd ** 2) * kp2.count + delta * (holdTime - nm)
                    bl.keyProfiles.set(e.key, { holdMean: nm, holdStd: Math.sqrt(nm2 / nc) || 1, count: nc })
                } else {
                    bl.keyProfiles.set(e.key, { holdMean: holdTime, holdStd: 1, count: 1 })
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

                // ── Advanced analysis (every 10+ keystrokes) ──────────────────
                if (recentFlightsRef.current.length >= 10) {
                    const recent = recentFlightsRef.current
                    const recentStats = computeStats(recent)
                    const rhythmDelta = Math.abs(recentStats.mean - bl.mean) / bl.mean
                    if (rhythmDelta > 1.5) {
                        onBiometricEvent?.({ type: 'rhythm_shift', rhythmDelta, timestamp: now })
                    }

                    const stability   = Math.max(0, Math.round(100 - rhythmDelta * 60))
                    const entropy     = shannonEntropy(recent)
                    const skewness    = computeSkewness(recent)
                    const kurtosis    = computeKurtosis(recent)
                    const gradient    = computeVelocityGradient(recent)

                    // ── FFT periodicity check (every 5s) ──────────────────────
                    let periodicity = 0
                    if (recent.length >= 16 && now - lastPeriodicityCheckRef.current > 5000) {
                        lastPeriodicityCheckRef.current = now
                        periodicity = computePeriodicityScore(recent)
                        if (periodicity > 55) {
                            onBiometricEvent?.({
                                type: 'fft_periodicity',
                                periodicityScore: periodicity,
                                detail: `Dominant frequency = ${periodicity}% spectral power (bot-like rhythm)`,
                                timestamp: now
                            })
                        }
                    }

                    // ── Fatigue check (every 10s, after 50+ keystrokes) ───────
                    let fatigue = 0
                    if (allFlightsRef.current.length >= 50 && now - lastFatigueCheckRef.current > 10000) {
                        lastFatigueCheckRef.current = now
                        fatigue = computeFatigueRate(allFlightsRef.current)
                        // If slope is extremely flat over long session → suspicious
                        if (allFlightsRef.current.length >= 80 && Math.abs(fatigue) < 0.05) {
                            onBiometricEvent?.({
                                type: 'fatigue_detected',
                                fatigueRate: fatigue,
                                detail: `No natural fatigue slope after ${allFlightsRef.current.length} keystrokes`,
                                timestamp: now
                            })
                        }
                    }

                    const holds   = allHoldsRef.current.slice(-20)
                    const aiScore = estimateAIScore(
                        recent,
                        holds,
                        backspaceRecordsRef.current.map(r => r.latency),
                        allFlightsRef.current
                    )

                    setDisplayMetrics(prev => ({
                        ...prev,
                        avgFlight: recentStats.mean,
                        entropy,
                        rhythmStability: stability,
                        skewness,
                        kurtosis,
                        periodicity,
                        fatigue,
                    }))

                    setRollingStats(prev => {
                        if (Math.abs(prev.aiScore - aiScore) > 5) {
                            onBiometricEvent?.({ type: 'ai_score_update', aiScore, timestamp: now })
                        }
                        return { ...prev, aiScore }
                    })
                }
            }

            // ── Burst: > 12 CHAR keystrokes in 300ms ─────────────────────────
            if (charWindowRef.current.length > 12) {
                const sinceLast = now - lastBurstRef.current
                if (sinceLast > 2000) {
                    lastBurstRef.current = now
                    onBiometricEvent?.({ type: 'burst', timestamp: now, detail: `${charWindowRef.current.length} chars/300ms` })
                    setRollingStats(prev => ({ ...prev, burstCount: prev.burstCount + 1 }))
                }
            }

            // ── Physically impossible gap (< 12ms between char keys) ─────────
            // Only flag for printable characters — Enter/Backspace/Delete are
            // editing actions that can legitimately follow each other very quickly
            // (e.g. pressing Enter twice rapidly for paragraph breaks).
            if (flightTime > 0 && flightTime < 12 && !BURST_EXCLUDED_KEYS.has(e.key)) {
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

            onBiometricEvent?.({
                type: 'keystroke',
                holdTime,
                flightTime,
                key: e.key,
                keyFingerGroup: fingerGroup,
                timestamp: now
            })

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
            lastKeystrokeTimeRef.current = performance.now()
            lastContentLenRef.current += text.length
            onBiometricEvent?.({ type: 'paste', length: text.length, timestamp: performance.now() })
            setRollingStats(prev => ({ ...prev, pasteCount: prev.pasteCount + 1 }))
        })

        // ── Drag & drop text ──────────────────────────────────────────────────
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

    const aiColor        = rollingStats.aiScore > 60 ? '#ff4d4d' : rollingStats.aiScore > 30 ? '#ffd700' : 'var(--color-primary)'
    const stabilityColor = displayMetrics.rhythmStability > 70 ? 'var(--color-primary)' : displayMetrics.rhythmStability > 40 ? '#ffd700' : '#ff4d4d'
    const skewnessColor  = Math.abs(displayMetrics.skewness) < 0.2 ? '#ff4d4d' : 'var(--color-primary)'
    const periodicityColor = displayMetrics.periodicity > 40 ? '#ff4d4d' : 'var(--color-primary)'

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
                    <span>Skewness</span>
                    <span style={{ color: skewnessColor }}>{displayMetrics.skewness.toFixed(2)}</span>
                </div>
                <div className={styles.metric}>
                    <span>Kurtosis</span>
                    <span style={{ color: displayMetrics.kurtosis > 3 ? '#ffd700' : 'var(--color-primary)' }}>
                        {displayMetrics.kurtosis.toFixed(2)}
                    </span>
                </div>
                <div className={styles.metric}>
                    <span>Periodicity</span>
                    <span style={{ color: periodicityColor }}>{displayMetrics.periodicity}%</span>
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
