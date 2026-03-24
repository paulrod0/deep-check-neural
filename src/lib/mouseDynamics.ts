/**
 * Deep-Check -- Mouse Dynamics Behavioral Biometrics
 * ===================================================
 * Captures and analyzes mouse movement patterns for continuous user
 * authentication and bot detection. Part of the Veritas behavioral
 * biometrics layer.
 *
 * Tracked signals:
 *   - Movement velocity and acceleration profiles
 *   - Directional angle histograms (8 bins, 0-360)
 *   - Click rhythm and spatial patterns
 *   - Scroll cadence and direction
 *   - Pause frequency and duration distribution
 *   - Movement straightness (path efficiency)
 *   - Micro-movement tremor analysis (jitter)
 *
 * Privacy:
 *   - Raw (x, y) coordinates are NEVER stored or exported
 *   - Only derived statistical features are retained
 *   - All processing runs 100% in the browser
 *   - Circular buffer caps memory at ~10K events
 *
 * Enrollment: 60s of mouse activity -> compact ~50-dim feature vector
 * Verification: cosine similarity against enrolled baseline
 * Bot detection: absence of jitter + constant velocity = flag
 *
 * Zero external dependencies. Pure TypeScript + browser APIs.
 *
 * Veritas Engine -- Deep-Check
 */

'use client'

// -- Types --------------------------------------------------------------------

export interface MouseProfile {
    /** Normalized feature vector (~50 dimensions) */
    features: Float32Array
    /** Feature names in order (for debugging / XAI) */
    featureNames: string[]
    /** Timestamp of enrollment */
    enrolledAt: number
    /** Duration of enrollment data collection (ms) */
    enrollmentDurationMs: number
    /** Number of raw events used to build profile */
    eventCount: number
}

export interface MouseMetrics {
    /** Velocity stats (px/ms) */
    velocityMean: number
    velocityStd: number
    velocitySkewness: number
    velocityKurtosis: number
    /** Acceleration stats (px/ms^2) */
    accelerationMean: number
    accelerationStd: number
    accelerationSkewness: number
    accelerationKurtosis: number
    /** Directional histogram (8 bins, normalized to sum=1) */
    angleHistogram: number[]
    /** Click rhythm */
    clickIntervalMean: number
    clickIntervalStd: number
    clickCount: number
    /** Scroll rhythm */
    scrollSpeedMean: number
    scrollSpeedStd: number
    scrollCount: number
    scrollUpRatio: number
    /** Pause analysis (gaps > 200ms between movements) */
    pauseFrequency: number
    pauseDurationMean: number
    pauseDurationStd: number
    /** Movement efficiency (euclidean / actual path length) */
    straightnessMean: number
    straightnessStd: number
    /** Tremor / jitter (high-frequency micro-movements) */
    jitterMagnitude: number
    jitterFrequency: number
    /** Movement speed entropy (regularity measure) */
    velocityEntropy: number
    /** Total tracking duration (ms) */
    trackingDurationMs: number
    /** Total distance travelled (px) */
    totalDistance: number
    /** Events captured */
    moveEventCount: number
}

export interface MouseVerification {
    /** Similarity score 0-100 (100 = same person) */
    score: number
    /** Whether the behavior looks automated */
    isBot: boolean
    /** Per-feature similarity breakdown (top contributors) */
    breakdown: { feature: string; similarity: number }[]
}

// -- Internal types -----------------------------------------------------------

interface RawMoveEvent {
    x: number
    y: number
    t: number
}

interface ClickEvent {
    t: number
    x: number
    y: number
}

interface ScrollEvent {
    t: number
    deltaY: number
}

interface MovementSegment {
    velocity: number
    acceleration: number
    angle: number
    distance: number
    dt: number
}

// -- Constants ----------------------------------------------------------------

const MAX_EVENTS = 10_000
const THROTTLE_MS = 1000 / 60             // ~16.67ms (60 events/sec max)
const PAUSE_THRESHOLD_MS = 200            // Gap > 200ms = pause
const ENROLLMENT_DURATION_MS = 60_000     // 60s enrollment window
const ANGLE_BINS = 8
const JITTER_WINDOW = 10                  // frames for tremor analysis
const MIN_EVENTS_FOR_METRICS = 50         // minimum moves to compute features

// -- Module state (singleton, client-side) ------------------------------------

let _moveBuffer: RawMoveEvent[] = []
let _clicks: ClickEvent[] = []
let _scrolls: ScrollEvent[] = []
let _segments: MovementSegment[] = []
let _tracking = false
let _startTime = 0
let _lastMoveTime = 0
let _lastThrottleTime = 0
let _bufferIndex = 0

// Event handler refs for cleanup
let _onMouseMove: ((e: MouseEvent) => void) | null = null
let _onClick: ((e: MouseEvent) => void) | null = null
let _onScroll: ((e: WheelEvent) => void) | null = null

// -- Stats helpers (matching biometricFeatures.ts style) ----------------------

function mean(arr: number[]): number {
    if (arr.length === 0) return 0
    return arr.reduce((a, b) => a + b, 0) / arr.length
}

function std(arr: number[], m?: number): number {
    if (arr.length < 2) return 0
    const mu = m ?? mean(arr)
    return Math.sqrt(arr.reduce((a, b) => a + (b - mu) ** 2, 0) / arr.length)
}

function skewness(arr: number[]): number {
    if (arr.length < 3) return 0
    const mu = mean(arr)
    const s = std(arr, mu)
    if (s === 0) return 0
    const n = arr.length
    return arr.reduce((a, b) => a + ((b - mu) / s) ** 3, 0) / n
}

function kurtosisExcess(arr: number[]): number {
    if (arr.length < 4) return 0
    const mu = mean(arr)
    const s = std(arr, mu)
    if (s === 0) return 0
    const n = arr.length
    return arr.reduce((a, b) => a + ((b - mu) / s) ** 4, 0) / n - 3
}

function shannonEntropy(arr: number[], bins = 10): number {
    if (arr.length === 0) return 0
    const min = Math.min(...arr)
    const max = Math.max(...arr)
    const bw = (max - min) / bins || 1
    const counts = new Array(bins).fill(0)
    arr.forEach(v => {
        const i = Math.min(bins - 1, Math.floor((v - min) / bw))
        counts[i]++
    })
    return counts.reduce((e, c) => {
        if (c === 0) return e
        const p = c / arr.length
        return e - p * Math.log2(p)
    }, 0)
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v))
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length || a.length === 0) return 0
    let dot = 0, magA = 0, magB = 0
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]
        magA += a[i] * a[i]
        magB += b[i] * b[i]
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB)
    return denom === 0 ? 0 : dot / denom
}

// -- Circular buffer helpers --------------------------------------------------

function pushEvent(event: RawMoveEvent): void {
    if (_moveBuffer.length < MAX_EVENTS) {
        _moveBuffer.push(event)
    } else {
        _moveBuffer[_bufferIndex % MAX_EVENTS] = event
    }
    _bufferIndex++
}

function getOrderedEvents(): RawMoveEvent[] {
    if (_moveBuffer.length < MAX_EVENTS) return _moveBuffer
    // Circular buffer: re-order from oldest to newest
    const start = _bufferIndex % MAX_EVENTS
    return [..._moveBuffer.slice(start), ..._moveBuffer.slice(0, start)]
}

// -- Segment computation ------------------------------------------------------

function computeSegments(events: RawMoveEvent[]): MovementSegment[] {
    const segments: MovementSegment[] = []
    let prevVelocity = 0

    for (let i = 1; i < events.length; i++) {
        const dx = events[i].x - events[i - 1].x
        const dy = events[i].y - events[i - 1].y
        const dt = events[i].t - events[i - 1].t

        if (dt <= 0 || dt > 2000) continue  // Skip invalid or large gaps

        const distance = Math.sqrt(dx * dx + dy * dy)
        const velocity = distance / dt
        const acceleration = (velocity - prevVelocity) / dt
        const angle = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360

        segments.push({ velocity, acceleration, angle, distance, dt })
        prevVelocity = velocity
    }
    return segments
}

// -- Tremor / jitter analysis -------------------------------------------------

function computeJitter(events: RawMoveEvent[]): { magnitude: number; frequency: number } {
    if (events.length < JITTER_WINDOW * 2) return { magnitude: 0, frequency: 0 }

    const deviations: number[] = []
    let jitterEvents = 0

    for (let i = JITTER_WINDOW; i < events.length - JITTER_WINDOW; i++) {
        // Local linear trend (simple moving average direction)
        let avgX = 0, avgY = 0
        for (let j = i - JITTER_WINDOW; j <= i + JITTER_WINDOW; j++) {
            avgX += events[j].x
            avgY += events[j].y
        }
        avgX /= (JITTER_WINDOW * 2 + 1)
        avgY /= (JITTER_WINDOW * 2 + 1)

        // Deviation from smooth path
        const dev = Math.sqrt(
            (events[i].x - avgX) ** 2 + (events[i].y - avgY) ** 2
        )
        deviations.push(dev)

        // Count high-frequency direction changes
        if (i > 0 && i < events.length - 1) {
            const dx1 = events[i].x - events[i - 1].x
            const dy1 = events[i].y - events[i - 1].y
            const dx2 = events[i + 1].x - events[i].x
            const dy2 = events[i + 1].y - events[i].y
            // Direction reversal
            if (dx1 * dx2 < 0 || dy1 * dy2 < 0) {
                jitterEvents++
            }
        }
    }

    const magnitude = mean(deviations)
    const frequency = events.length > 0
        ? jitterEvents / events.length
        : 0

    return { magnitude, frequency }
}

// -- Straightness analysis ----------------------------------------------------

function computeStraightness(events: RawMoveEvent[]): number[] {
    const ratios: number[] = []
    const segmentSize = 20  // Analyze in windows of 20 events

    for (let i = 0; i + segmentSize <= events.length; i += segmentSize) {
        const window = events.slice(i, i + segmentSize)
        const first = window[0]
        const last = window[window.length - 1]

        // Euclidean distance (start to end)
        const euclidean = Math.sqrt(
            (last.x - first.x) ** 2 + (last.y - first.y) ** 2
        )

        // Actual path length
        let pathLength = 0
        for (let j = 1; j < window.length; j++) {
            const dx = window[j].x - window[j - 1].x
            const dy = window[j].y - window[j - 1].y
            pathLength += Math.sqrt(dx * dx + dy * dy)
        }

        if (pathLength > 0) {
            ratios.push(euclidean / pathLength)
        }
    }

    return ratios
}

// -- Angle histogram ----------------------------------------------------------

function computeAngleHistogram(segments: MovementSegment[]): number[] {
    const bins = new Array(ANGLE_BINS).fill(0)
    const binWidth = 360 / ANGLE_BINS

    for (const seg of segments) {
        const bin = Math.min(ANGLE_BINS - 1, Math.floor(seg.angle / binWidth))
        bins[bin]++
    }

    // Normalize to sum = 1
    const total = bins.reduce((a: number, b: number) => a + b, 0)
    if (total > 0) {
        for (let i = 0; i < bins.length; i++) bins[i] /= total
    }

    return bins
}

// -- Pause analysis -----------------------------------------------------------

function computePauses(events: RawMoveEvent[]): number[] {
    const pauses: number[] = []

    for (let i = 1; i < events.length; i++) {
        const gap = events[i].t - events[i - 1].t
        if (gap > PAUSE_THRESHOLD_MS) {
            pauses.push(gap)
        }
    }

    return pauses
}

// -- Event handlers -----------------------------------------------------------

function handleMouseMove(e: MouseEvent): void {
    if (!_tracking) return

    const now = performance.now()

    // Throttle to ~60 events/sec
    if (now - _lastThrottleTime < THROTTLE_MS) return
    _lastThrottleTime = now

    pushEvent({ x: e.clientX, y: e.clientY, t: now })
    _lastMoveTime = now
}

function handleClick(e: MouseEvent): void {
    if (!_tracking) return
    if (_clicks.length >= MAX_EVENTS) return
    _clicks.push({ t: performance.now(), x: e.clientX, y: e.clientY })
}

function handleScroll(e: WheelEvent): void {
    if (!_tracking) return
    if (_scrolls.length >= MAX_EVENTS) return
    _scrolls.push({ t: performance.now(), deltaY: e.deltaY })
}

// -- Public API ---------------------------------------------------------------

/**
 * Start capturing mouse dynamics.
 * Attaches listeners to document for mousemove, click, and wheel events.
 * Safe to call multiple times (no-op if already tracking).
 */
export function startMouseTracking(): void {
    if (_tracking) return
    if (typeof window === 'undefined') return

    // Reset state
    _moveBuffer = []
    _clicks = []
    _scrolls = []
    _segments = []
    _bufferIndex = 0
    _lastThrottleTime = 0
    _lastMoveTime = 0
    _startTime = performance.now()
    _tracking = true

    _onMouseMove = handleMouseMove
    _onClick = handleClick
    _onScroll = handleScroll

    document.addEventListener('mousemove', _onMouseMove, { passive: true })
    document.addEventListener('click', _onClick, { passive: true })
    document.addEventListener('wheel', _onScroll, { passive: true })
}

/**
 * Stop capturing and return computed metrics.
 * Removes all event listeners. Raw coordinates are discarded after
 * feature extraction -- only derived statistics are returned.
 */
export function stopMouseTracking(): MouseMetrics {
    _tracking = false

    if (_onMouseMove) document.removeEventListener('mousemove', _onMouseMove)
    if (_onClick) document.removeEventListener('click', _onClick)
    if (_onScroll) document.removeEventListener('wheel', _onScroll)
    _onMouseMove = null
    _onClick = null
    _onScroll = null

    const trackingDurationMs = performance.now() - _startTime
    const events = getOrderedEvents()

    // Compute movement segments
    _segments = computeSegments(events)

    const metrics = _computeMetrics(events, _segments, trackingDurationMs)

    // Privacy: discard raw coordinates
    _moveBuffer = []
    _clicks = []
    _scrolls = []
    _segments = []
    _bufferIndex = 0

    return metrics
}

/**
 * Enroll a mouse behavior profile from collected metrics.
 * Produces a compact, normalized feature vector (~50 dimensions).
 */
export function enrollMouseProfile(metrics: MouseMetrics): MouseProfile {
    const { features, names } = _extractFeatureVector(metrics)

    // Normalize: z-score each feature (self-normalize for single enrollment)
    const normalized = new Float32Array(features.length)
    const fMean = mean(Array.from(features))
    const fStd = std(Array.from(features), fMean) || 1

    for (let i = 0; i < features.length; i++) {
        normalized[i] = (features[i] - fMean) / fStd
    }

    return {
        features: normalized,
        featureNames: names,
        enrolledAt: Date.now(),
        enrollmentDurationMs: metrics.trackingDurationMs,
        eventCount: metrics.moveEventCount,
    }
}

/**
 * Compare live mouse behavior against an enrolled baseline.
 *
 * Returns:
 *   - score: 0-100 (100 = strong match, same user)
 *   - isBot: true if movement looks automated
 *   - breakdown: per-feature similarity for top contributors
 */
export function verifyMouseBehavior(
    live: MouseMetrics,
    enrolled: MouseProfile,
): MouseVerification {
    const { features: liveRaw, names } = _extractFeatureVector(live)

    // Normalize live features with same strategy
    const liveMean = mean(Array.from(liveRaw))
    const liveStd = std(Array.from(liveRaw), liveMean) || 1
    const liveNorm = new Float32Array(liveRaw.length)
    for (let i = 0; i < liveRaw.length; i++) {
        liveNorm[i] = (liveRaw[i] - liveMean) / liveStd
    }

    // Cosine similarity (global)
    const similarity = cosineSimilarity(liveNorm, enrolled.features)
    const score = Math.round(clamp((similarity + 1) / 2 * 100, 0, 100))

    // Per-feature similarity breakdown
    const breakdown: { feature: string; similarity: number }[] = []
    for (let i = 0; i < names.length; i++) {
        const diff = Math.abs(liveNorm[i] - enrolled.features[i])
        const sim = Math.max(0, 1 - diff / 3)  // Rough per-feature similarity
        breakdown.push({ feature: names[i], similarity: Math.round(sim * 100) })
    }
    breakdown.sort((a, b) => a.similarity - b.similarity)

    // Bot detection heuristics
    const isBot = _detectBot(live)

    return { score, isBot, breakdown: breakdown.slice(0, 10) }
}

// -- Feature extraction -------------------------------------------------------

/** Feature names for the ~50-dim vector */
const FEATURE_NAMES = [
    // Velocity (4)
    'velocity_mean', 'velocity_std', 'velocity_skewness', 'velocity_kurtosis',
    // Acceleration (4)
    'accel_mean', 'accel_std', 'accel_skewness', 'accel_kurtosis',
    // Angle histogram (8)
    'angle_bin_0', 'angle_bin_1', 'angle_bin_2', 'angle_bin_3',
    'angle_bin_4', 'angle_bin_5', 'angle_bin_6', 'angle_bin_7',
    // Click rhythm (3)
    'click_interval_mean', 'click_interval_std', 'click_count_norm',
    // Scroll rhythm (4)
    'scroll_speed_mean', 'scroll_speed_std', 'scroll_count_norm', 'scroll_up_ratio',
    // Pauses (3)
    'pause_frequency', 'pause_duration_mean', 'pause_duration_std',
    // Straightness (2)
    'straightness_mean', 'straightness_std',
    // Jitter (2)
    'jitter_magnitude', 'jitter_frequency',
    // Entropy (1)
    'velocity_entropy',
    // Global (3)
    'total_distance_norm', 'events_per_second', 'active_ratio',
    // Velocity percentiles (5)
    'velocity_p10', 'velocity_p25', 'velocity_p50', 'velocity_p75', 'velocity_p90',
    // Acceleration percentiles (5)
    'accel_p10', 'accel_p25', 'accel_p50', 'accel_p75', 'accel_p90',
    // Angle entropy (1)
    'angle_entropy',
    // Curvature (2)
    'curvature_mean', 'curvature_std',
    // Click spatial spread (1)
    'click_spatial_spread',
] as const

function percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0
    const sorted = [...arr].sort((a, b) => a - b)
    const idx = (p / 100) * (sorted.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    if (lo === hi) return sorted[lo]
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

function computeCurvature(segments: MovementSegment[]): number[] {
    const curvatures: number[] = []
    for (let i = 1; i < segments.length; i++) {
        const dAngle = Math.abs(segments[i].angle - segments[i - 1].angle)
        const normalized = dAngle > 180 ? 360 - dAngle : dAngle
        const ds = segments[i].distance + segments[i - 1].distance
        if (ds > 0) {
            curvatures.push(normalized / ds)
        }
    }
    return curvatures
}

function _extractFeatureVector(metrics: MouseMetrics): { features: Float32Array; names: string[] } {
    const names = [...FEATURE_NAMES] as string[]
    const f = new Float32Array(names.length)

    let idx = 0

    // Velocity (4)
    f[idx++] = metrics.velocityMean
    f[idx++] = metrics.velocityStd
    f[idx++] = metrics.velocitySkewness
    f[idx++] = metrics.velocityKurtosis

    // Acceleration (4)
    f[idx++] = metrics.accelerationMean
    f[idx++] = metrics.accelerationStd
    f[idx++] = metrics.accelerationSkewness
    f[idx++] = metrics.accelerationKurtosis

    // Angle histogram (8)
    for (let i = 0; i < ANGLE_BINS; i++) {
        f[idx++] = metrics.angleHistogram[i] ?? 0
    }

    // Click rhythm (3)
    f[idx++] = metrics.clickIntervalMean
    f[idx++] = metrics.clickIntervalStd
    // Normalize click count by duration (clicks per second)
    f[idx++] = metrics.trackingDurationMs > 0
        ? (metrics.clickCount / metrics.trackingDurationMs) * 1000
        : 0

    // Scroll rhythm (4)
    f[idx++] = metrics.scrollSpeedMean
    f[idx++] = metrics.scrollSpeedStd
    f[idx++] = metrics.trackingDurationMs > 0
        ? (metrics.scrollCount / metrics.trackingDurationMs) * 1000
        : 0
    f[idx++] = metrics.scrollUpRatio

    // Pauses (3)
    f[idx++] = metrics.pauseFrequency
    f[idx++] = metrics.pauseDurationMean
    f[idx++] = metrics.pauseDurationStd

    // Straightness (2)
    f[idx++] = metrics.straightnessMean
    f[idx++] = metrics.straightnessStd

    // Jitter (2)
    f[idx++] = metrics.jitterMagnitude
    f[idx++] = metrics.jitterFrequency

    // Entropy (1)
    f[idx++] = metrics.velocityEntropy

    // Global (3)
    f[idx++] = metrics.trackingDurationMs > 0
        ? metrics.totalDistance / (metrics.trackingDurationMs / 1000)
        : 0
    f[idx++] = metrics.trackingDurationMs > 0
        ? (metrics.moveEventCount / metrics.trackingDurationMs) * 1000
        : 0
    // Active ratio: fraction of time with movement (not paused)
    const totalPauseTime = metrics.pauseDurationMean * metrics.pauseFrequency *
        (metrics.trackingDurationMs / 1000)
    f[idx++] = metrics.trackingDurationMs > 0
        ? clamp(1 - totalPauseTime / metrics.trackingDurationMs, 0, 1)
        : 0

    // Velocity percentiles (5) -- stored in raw segments, approximate from stats
    // Using normal approximation: p = mean + z * std
    const zScores = [-1.28, -0.67, 0, 0.67, 1.28]  // p10, p25, p50, p75, p90
    for (const z of zScores) {
        f[idx++] = Math.max(0, metrics.velocityMean + z * metrics.velocityStd)
    }

    // Acceleration percentiles (5)
    for (const z of zScores) {
        f[idx++] = metrics.accelerationMean + z * metrics.accelerationStd
    }

    // Angle entropy (1)
    const nonZeroAngles = metrics.angleHistogram.filter(v => v > 0)
    f[idx++] = nonZeroAngles.length > 0
        ? -nonZeroAngles.reduce((e, p) => e + (p > 0 ? p * Math.log2(p) : 0), 0)
        : 0

    // Curvature (2) -- approximate from angle std and straightness
    f[idx++] = 1 - metrics.straightnessMean  // Higher curvature = less straight
    f[idx++] = metrics.straightnessStd

    // Click spatial spread (1) -- approximate from click count
    f[idx++] = metrics.clickCount > 1 ? metrics.clickIntervalStd : 0

    return { features: f, names }
}

// -- Metrics computation (from raw events) ------------------------------------

function _computeMetrics(
    events: RawMoveEvent[],
    segments: MovementSegment[],
    trackingDurationMs: number,
): MouseMetrics {
    // Velocities and accelerations from segments
    const velocities = segments.map(s => s.velocity)
    const accelerations = segments.map(s => s.acceleration)

    // Angle histogram
    const angleHistogram = computeAngleHistogram(segments)

    // Click intervals
    const clickIntervals: number[] = []
    for (let i = 1; i < _clicks.length; i++) {
        clickIntervals.push(_clicks[i].t - _clicks[i - 1].t)
    }

    // Scroll speeds
    const scrollSpeeds: number[] = []
    let scrollUpCount = 0
    for (let i = 1; i < _scrolls.length; i++) {
        const dt = _scrolls[i].t - _scrolls[i - 1].t
        if (dt > 0) {
            scrollSpeeds.push(Math.abs(_scrolls[i].deltaY) / dt)
        }
        if (_scrolls[i].deltaY < 0) scrollUpCount++
    }

    // Pauses
    const pauses = computePauses(events)
    const pauseFrequency = trackingDurationMs > 0
        ? (pauses.length / trackingDurationMs) * 1000
        : 0

    // Straightness
    const straightnessRatios = computeStraightness(events)

    // Jitter
    const jitter = computeJitter(events)

    // Total distance
    const totalDistance = segments.reduce((sum, s) => sum + s.distance, 0)

    // Velocity entropy
    const velEntropy = shannonEntropy(velocities)

    return {
        velocityMean: mean(velocities),
        velocityStd: std(velocities),
        velocitySkewness: skewness(velocities),
        velocityKurtosis: kurtosisExcess(velocities),
        accelerationMean: mean(accelerations),
        accelerationStd: std(accelerations),
        accelerationSkewness: skewness(accelerations),
        accelerationKurtosis: kurtosisExcess(accelerations),
        angleHistogram,
        clickIntervalMean: mean(clickIntervals),
        clickIntervalStd: std(clickIntervals),
        clickCount: _clicks.length,
        scrollSpeedMean: mean(scrollSpeeds),
        scrollSpeedStd: std(scrollSpeeds),
        scrollCount: _scrolls.length,
        scrollUpRatio: _scrolls.length > 0 ? scrollUpCount / _scrolls.length : 0.5,
        pauseFrequency,
        pauseDurationMean: mean(pauses),
        pauseDurationStd: std(pauses),
        straightnessMean: mean(straightnessRatios),
        straightnessStd: std(straightnessRatios),
        jitterMagnitude: jitter.magnitude,
        jitterFrequency: jitter.frequency,
        velocityEntropy: velEntropy,
        trackingDurationMs,
        totalDistance,
        moveEventCount: events.length,
    }
}

// -- Bot detection heuristics -------------------------------------------------

function _detectBot(metrics: MouseMetrics): boolean {
    let botSignals = 0

    // 1. No jitter at all (humans always have micro-tremor)
    if (metrics.jitterMagnitude < 0.05 && metrics.moveEventCount > MIN_EVENTS_FOR_METRICS) {
        botSignals += 2
    }

    // 2. Near-zero velocity variance (constant speed = robotic)
    if (metrics.velocityStd < 0.001 && metrics.velocityMean > 0) {
        botSignals += 2
    }

    // 3. Perfect straightness (humans never move in perfect lines)
    if (metrics.straightnessMean > 0.99 && metrics.moveEventCount > MIN_EVENTS_FOR_METRICS) {
        botSignals += 2
    }

    // 4. Uniform angle distribution (bots often sweep uniformly)
    const angleStd = std(metrics.angleHistogram)
    if (angleStd < 0.01 && metrics.moveEventCount > MIN_EVENTS_FOR_METRICS) {
        botSignals += 1
    }

    // 5. Zero pauses (humans pause frequently)
    if (metrics.pauseFrequency === 0 && metrics.trackingDurationMs > 5000) {
        botSignals += 1
    }

    // 6. Velocity kurtosis near zero (no speed bursts = mechanical)
    if (Math.abs(metrics.velocityKurtosis) < 0.01 && metrics.moveEventCount > MIN_EVENTS_FOR_METRICS) {
        botSignals += 1
    }

    // 7. No clicks at all during extended tracking
    if (metrics.clickCount === 0 && metrics.trackingDurationMs > 30_000) {
        botSignals += 1
    }

    // Threshold: 3+ signals = bot
    return botSignals >= 3
}
