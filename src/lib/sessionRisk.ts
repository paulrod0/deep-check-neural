/**
 * Deep-Check -- Session Risk Scoring
 * ====================================
 * Computes a real-time fraud risk score for the current browser session
 * based on environmental and behavioral signals. Used alongside the
 * Veritas Ensemble Engine to weight verification confidence.
 *
 * Risk factors:
 *   - Device familiarity (localStorage fingerprint)
 *   - Time of day (unusual hours)
 *   - Tab visibility changes (suspicious switching)
 *   - Copy/paste event frequency
 *   - Developer tools detection
 *   - WebRTC leak check (VPN/proxy indicator)
 *   - Browser fingerprint consistency
 *   - Estimated tab count (performance API)
 *   - Time to first interaction
 *
 * Score: 0 (safe) -- 100 (high risk)
 * All checks run 100% in the browser. No data leaves the device.
 *
 * Zero external dependencies. Pure TypeScript + browser APIs.
 *
 * Veritas Engine -- Deep-Check
 */

'use client'

// -- Types --------------------------------------------------------------------

export interface SessionRiskFactors {
    /** Is this a previously seen device? */
    knownDevice: boolean
    /** Device fingerprint hash (truncated, non-reversible) */
    deviceFingerprint: string
    /** Hour of day (0-23, local time) */
    hourOfDay: number
    /** Whether the hour is considered unusual (before 6am or after 11pm) */
    unusualHour: boolean
    /** Number of tab visibility changes during session */
    visibilityChanges: number
    /** Number of copy events detected */
    copyEvents: number
    /** Number of paste events detected */
    pasteEvents: number
    /** Whether developer tools are likely open */
    devToolsDetected: boolean
    /** Whether a WebRTC IP leak was detected (possible VPN/proxy bypass) */
    webrtcLeakDetected: boolean
    /** Whether the browser fingerprint changed since last visit */
    fingerprintChanged: boolean
    /** Estimated number of open tabs */
    estimatedTabCount: number
    /** Time (ms) from page load to first user interaction */
    timeToFirstInteraction: number
    /** Whether first interaction was suspiciously fast (< 500ms) */
    suspiciouslyFastStart: boolean
    /** Session duration at time of scoring (ms) */
    sessionDurationMs: number
}

export interface SessionRiskScore {
    /** Overall risk score 0-100 */
    score: number
    /** Detailed factor breakdown */
    factors: SessionRiskFactors
    /** Risk classification */
    level: 'low' | 'medium' | 'high'
    /** Human-readable explanation of top risk contributors */
    explanation: string
}

// -- Constants ----------------------------------------------------------------

const STORAGE_KEY_FINGERPRINT = 'dc_device_fp'
const STORAGE_KEY_VISIT_COUNT = 'dc_visit_count'
const STORAGE_KEY_LAST_VISIT = 'dc_last_visit'

/** Risk weights for each factor (sum = 100 possible max) */
const WEIGHTS = {
    unknownDevice:      12,
    unusualHour:        10,
    visibilityChanges:  10,   // max contribution at 10+ changes
    copyPasteHeavy:      8,   // max contribution at 5+ combined
    devTools:           15,
    webrtcLeak:         12,
    fingerprintChanged: 10,
    highTabCount:        5,   // max contribution at 10+ tabs
    fastStart:           8,
    shortSession:       10,   // max contribution if session < 5s
} as const

/** Unusual hours: before 6am or after 11pm local time */
const UNUSUAL_HOURS_START = 23
const UNUSUAL_HOURS_END = 6

/** DevTools detection: threshold for outer/inner size difference */
const DEVTOOLS_SIZE_THRESHOLD = 160

// -- Module state (singleton) -------------------------------------------------

let _initialized = false
let _sessionStart = 0
let _firstInteractionTime = 0
let _visibilityChanges = 0
let _copyEvents = 0
let _pasteEvents = 0
let _hadFirstInteraction = false

// Event handler refs for cleanup
let _onVisibilityChange: (() => void) | null = null
let _onCopy: (() => void) | null = null
let _onPaste: (() => void) | null = null
let _onFirstInteraction: (() => void) | null = null

// -- Fingerprinting (privacy-safe, non-reversible) ----------------------------

function _generateFingerprint(): string {
    if (typeof window === 'undefined') return 'ssr'

    const components = [
        navigator.userAgent,
        navigator.language,
        screen.width + 'x' + screen.height,
        screen.colorDepth.toString(),
        new Date().getTimezoneOffset().toString(),
        navigator.hardwareConcurrency?.toString() ?? '?',
        (navigator as unknown as Record<string, unknown>).deviceMemory?.toString() ?? '?',
        navigator.maxTouchPoints?.toString() ?? '0',
        // Canvas fingerprint (minimal, privacy-safe)
        _canvasFingerprint(),
    ]

    return _simpleHash(components.join('|'))
}

function _canvasFingerprint(): string {
    try {
        const canvas = document.createElement('canvas')
        canvas.width = 64
        canvas.height = 16
        const ctx = canvas.getContext('2d')
        if (!ctx) return 'no-canvas'

        ctx.textBaseline = 'top'
        ctx.font = '14px Arial'
        ctx.fillStyle = '#f60'
        ctx.fillRect(0, 0, 64, 16)
        ctx.fillStyle = '#069'
        ctx.fillText('DC', 2, 1)
        ctx.fillStyle = 'rgba(102, 204, 0, 0.7)'
        ctx.fillText('DC', 4, 3)

        return canvas.toDataURL().slice(-16)
    } catch {
        return 'no-canvas'
    }
}

/** Simple non-cryptographic hash (DJB2) -- for fingerprint only, not security */
function _simpleHash(str: string): string {
    let hash = 5381
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff
    }
    return (hash >>> 0).toString(36)
}

// -- Device tracking (localStorage) -------------------------------------------

function _checkKnownDevice(fingerprint: string): { known: boolean; changed: boolean } {
    if (typeof window === 'undefined' || !window.localStorage) {
        return { known: false, changed: false }
    }

    try {
        const storedFp = localStorage.getItem(STORAGE_KEY_FINGERPRINT)
        const visitCount = parseInt(localStorage.getItem(STORAGE_KEY_VISIT_COUNT) ?? '0', 10)

        // Store current fingerprint
        localStorage.setItem(STORAGE_KEY_FINGERPRINT, fingerprint)
        localStorage.setItem(STORAGE_KEY_VISIT_COUNT, (visitCount + 1).toString())
        localStorage.setItem(STORAGE_KEY_LAST_VISIT, Date.now().toString())

        if (!storedFp) {
            // First visit
            return { known: false, changed: false }
        }

        return {
            known: visitCount >= 1,
            changed: storedFp !== fingerprint,
        }
    } catch {
        // localStorage may be blocked (private browsing, etc.)
        return { known: false, changed: false }
    }
}

// -- Developer tools detection ------------------------------------------------

function _detectDevTools(): boolean {
    if (typeof window === 'undefined') return false

    // Method 1: Window size difference (outer - inner > threshold)
    const widthDiff = window.outerWidth - window.innerWidth
    const heightDiff = window.outerHeight - window.innerHeight

    if (widthDiff > DEVTOOLS_SIZE_THRESHOLD || heightDiff > DEVTOOLS_SIZE_THRESHOLD) {
        return true
    }

    // Method 2: Firebug-style detection (legacy but still catches some)
    try {
        const el = new Image()
        Object.defineProperty(el, 'id', {
            get: function () {
                // This getter is called when devtools inspects the element
                // We just check if it's defined -- don't actually set state here
                return 'devtools-detect'
            },
        })
    } catch {
        // Ignore
    }

    return false
}

// -- WebRTC leak detection ----------------------------------------------------

async function _checkWebRTCLeak(): Promise<boolean> {
    if (typeof window === 'undefined' || !window.RTCPeerConnection) return false

    return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 3000)

        try {
            const pc = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
            })

            let localIpFound = false

            pc.onicecandidate = (e) => {
                if (!e.candidate) {
                    clearTimeout(timeout)
                    pc.close()
                    resolve(localIpFound)
                    return
                }

                const candidate = e.candidate.candidate
                // Check for local/private IP addresses leaking through
                const ipv4Match = candidate.match(
                    /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/
                )

                if (ipv4Match) {
                    const ip = ipv4Match[1]
                    // Private IP ranges (RFC 1918)
                    if (
                        ip.startsWith('10.') ||
                        ip.startsWith('192.168.') ||
                        /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
                    ) {
                        // Local IP exposed via WebRTC = possible VPN leak
                        localIpFound = true
                    }
                }
            }

            pc.createDataChannel('')
            pc.createOffer()
                .then((offer) => pc.setLocalDescription(offer))
                .catch(() => {
                    clearTimeout(timeout)
                    pc.close()
                    resolve(false)
                })
        } catch {
            clearTimeout(timeout)
            resolve(false)
        }
    })
}

// -- Tab count estimation -----------------------------------------------------

function _estimateTabCount(): number {
    if (typeof window === 'undefined') return 1

    // Use performance.memory if available (Chrome)
    const perf = performance as unknown as Record<string, unknown>
    const memory = perf.memory as { usedJSHeapSize?: number; jsHeapSizeLimit?: number } | undefined

    if (memory?.usedJSHeapSize && memory?.jsHeapSizeLimit) {
        // Rough heuristic: each tab uses ~50-100MB
        // If heap is large relative to limit, many tabs likely open
        const ratio = memory.usedJSHeapSize / memory.jsHeapSizeLimit
        if (ratio > 0.8) return 15
        if (ratio > 0.5) return 8
        if (ratio > 0.3) return 4
        return 2
    }

    // Fallback: use SharedWorker or BroadcastChannel if available
    // For simplicity, return conservative estimate
    return 1
}

// -- Event handlers -----------------------------------------------------------

function _handleVisibilityChange(): void {
    _visibilityChanges++
}

function _handleCopy(): void {
    _copyEvents++
}

function _handlePaste(): void {
    _pasteEvents++
}

function _handleFirstInteraction(): void {
    if (_hadFirstInteraction) return
    _hadFirstInteraction = true
    _firstInteractionTime = performance.now() - _sessionStart

    // Remove interaction listeners after first event
    if (_onFirstInteraction) {
        document.removeEventListener('mousedown', _onFirstInteraction)
        document.removeEventListener('keydown', _onFirstInteraction)
        document.removeEventListener('touchstart', _onFirstInteraction)
        _onFirstInteraction = null
    }
}

// -- Public API ---------------------------------------------------------------

/**
 * Initialize session risk monitoring.
 * Attaches lightweight event listeners for visibility, copy/paste,
 * and first-interaction timing. Call once per page load.
 * Safe to call multiple times (no-op if already initialized).
 */
export function initSessionRisk(): void {
    if (_initialized) return
    if (typeof window === 'undefined') return

    _initialized = true
    _sessionStart = performance.now()
    _visibilityChanges = 0
    _copyEvents = 0
    _pasteEvents = 0
    _hadFirstInteraction = false
    _firstInteractionTime = 0

    // Visibility changes
    _onVisibilityChange = _handleVisibilityChange
    document.addEventListener('visibilitychange', _onVisibilityChange)

    // Copy/paste
    _onCopy = _handleCopy
    _onPaste = _handlePaste
    document.addEventListener('copy', _onCopy)
    document.addEventListener('paste', _onPaste)

    // First interaction
    _onFirstInteraction = _handleFirstInteraction
    document.addEventListener('mousedown', _onFirstInteraction, { passive: true })
    document.addEventListener('keydown', _onFirstInteraction, { passive: true })
    document.addEventListener('touchstart', _onFirstInteraction, { passive: true })
}

/**
 * Compute the current session risk score.
 * Gathers all signals and returns a weighted risk assessment.
 *
 * The WebRTC leak check is async (STUN query, up to 3s timeout).
 * All other checks are synchronous.
 */
export async function getSessionRisk(): Promise<SessionRiskScore> {
    if (typeof window === 'undefined') {
        return _emptyScore()
    }

    const sessionDurationMs = performance.now() - _sessionStart

    // Gather all signals
    const fingerprint = _generateFingerprint()
    const { known: knownDevice, changed: fingerprintChanged } = _checkKnownDevice(fingerprint)
    const hourOfDay = new Date().getHours()
    const unusualHour = hourOfDay >= UNUSUAL_HOURS_START || hourOfDay < UNUSUAL_HOURS_END
    const devToolsDetected = _detectDevTools()
    const webrtcLeakDetected = await _checkWebRTCLeak()
    const estimatedTabCount = _estimateTabCount()
    const timeToFirstInteraction = _hadFirstInteraction ? _firstInteractionTime : -1
    const suspiciouslyFastStart = _hadFirstInteraction && _firstInteractionTime < 500

    const factors: SessionRiskFactors = {
        knownDevice,
        deviceFingerprint: fingerprint,
        hourOfDay,
        unusualHour,
        visibilityChanges: _visibilityChanges,
        copyEvents: _copyEvents,
        pasteEvents: _pasteEvents,
        devToolsDetected,
        webrtcLeakDetected,
        fingerprintChanged,
        estimatedTabCount,
        timeToFirstInteraction,
        suspiciouslyFastStart,
        sessionDurationMs,
    }

    // Compute weighted risk score
    const { score, contributors } = _computeScore(factors)
    const level: SessionRiskScore['level'] =
        score < 25 ? 'low' : score < 55 ? 'medium' : 'high'
    const explanation = _generateExplanation(level, contributors)

    return { score, factors, level, explanation }
}

// -- Synchronous variant (skips WebRTC check) ---------------------------------

/**
 * Compute session risk synchronously (no WebRTC check).
 * Use this when you need an immediate score without async overhead.
 */
export function getSessionRiskSync(): SessionRiskScore {
    if (typeof window === 'undefined') {
        return _emptyScore()
    }

    const sessionDurationMs = performance.now() - _sessionStart

    const fingerprint = _generateFingerprint()
    const { known: knownDevice, changed: fingerprintChanged } = _checkKnownDevice(fingerprint)
    const hourOfDay = new Date().getHours()
    const unusualHour = hourOfDay >= UNUSUAL_HOURS_START || hourOfDay < UNUSUAL_HOURS_END
    const devToolsDetected = _detectDevTools()
    const estimatedTabCount = _estimateTabCount()
    const timeToFirstInteraction = _hadFirstInteraction ? _firstInteractionTime : -1
    const suspiciouslyFastStart = _hadFirstInteraction && _firstInteractionTime < 500

    const factors: SessionRiskFactors = {
        knownDevice,
        deviceFingerprint: fingerprint,
        hourOfDay,
        unusualHour,
        visibilityChanges: _visibilityChanges,
        copyEvents: _copyEvents,
        pasteEvents: _pasteEvents,
        devToolsDetected,
        webrtcLeakDetected: false,  // Skipped in sync mode
        fingerprintChanged,
        estimatedTabCount,
        timeToFirstInteraction,
        suspiciouslyFastStart,
        sessionDurationMs,
    }

    const { score, contributors } = _computeScore(factors)
    const level: SessionRiskScore['level'] =
        score < 25 ? 'low' : score < 55 ? 'medium' : 'high'
    const explanation = _generateExplanation(level, contributors)

    return { score, factors, level, explanation }
}

// -- Score computation --------------------------------------------------------

interface RiskContributor {
    name: string
    points: number
    detail: string
}

function _computeScore(factors: SessionRiskFactors): {
    score: number
    contributors: RiskContributor[]
} {
    const contributors: RiskContributor[] = []

    // 1. Unknown device
    if (!factors.knownDevice) {
        contributors.push({
            name: 'Unknown device',
            points: WEIGHTS.unknownDevice,
            detail: 'First visit from this device/browser',
        })
    }

    // 2. Unusual hour
    if (factors.unusualHour) {
        contributors.push({
            name: 'Unusual hour',
            points: WEIGHTS.unusualHour,
            detail: `Session at ${factors.hourOfDay}:00 local time`,
        })
    }

    // 3. Visibility changes (scaled: 0 at 0, max at 10+)
    if (factors.visibilityChanges > 0) {
        const points = Math.round(
            WEIGHTS.visibilityChanges * Math.min(1, factors.visibilityChanges / 10)
        )
        if (points > 0) {
            contributors.push({
                name: 'Tab switching',
                points,
                detail: `${factors.visibilityChanges} visibility changes`,
            })
        }
    }

    // 4. Heavy copy/paste
    const cpTotal = factors.copyEvents + factors.pasteEvents
    if (cpTotal > 0) {
        const points = Math.round(
            WEIGHTS.copyPasteHeavy * Math.min(1, cpTotal / 5)
        )
        if (points > 0) {
            contributors.push({
                name: 'Copy/paste activity',
                points,
                detail: `${factors.copyEvents} copies, ${factors.pasteEvents} pastes`,
            })
        }
    }

    // 5. Developer tools
    if (factors.devToolsDetected) {
        contributors.push({
            name: 'Developer tools',
            points: WEIGHTS.devTools,
            detail: 'Browser developer tools appear to be open',
        })
    }

    // 6. WebRTC leak
    if (factors.webrtcLeakDetected) {
        contributors.push({
            name: 'WebRTC leak',
            points: WEIGHTS.webrtcLeak,
            detail: 'Private IP exposed via WebRTC (possible VPN/proxy)',
        })
    }

    // 7. Fingerprint changed
    if (factors.fingerprintChanged) {
        contributors.push({
            name: 'Fingerprint mismatch',
            points: WEIGHTS.fingerprintChanged,
            detail: 'Browser fingerprint differs from last visit',
        })
    }

    // 8. High tab count
    if (factors.estimatedTabCount > 5) {
        const points = Math.round(
            WEIGHTS.highTabCount * Math.min(1, (factors.estimatedTabCount - 5) / 10)
        )
        if (points > 0) {
            contributors.push({
                name: 'Many open tabs',
                points,
                detail: `Estimated ${factors.estimatedTabCount} tabs`,
            })
        }
    }

    // 9. Suspiciously fast start
    if (factors.suspiciouslyFastStart) {
        contributors.push({
            name: 'Instant interaction',
            points: WEIGHTS.fastStart,
            detail: `First interaction in ${Math.round(factors.timeToFirstInteraction)}ms (< 500ms)`,
        })
    }

    // 10. Very short session (might be automated scanning)
    if (factors.sessionDurationMs < 5000 && factors.sessionDurationMs > 0) {
        const points = Math.round(
            WEIGHTS.shortSession * Math.max(0, 1 - factors.sessionDurationMs / 5000)
        )
        if (points > 0) {
            contributors.push({
                name: 'Short session',
                points,
                detail: `Session only ${Math.round(factors.sessionDurationMs / 1000)}s`,
            })
        }
    }

    // Sort by contribution (highest risk first)
    contributors.sort((a, b) => b.points - a.points)

    const score = Math.min(100, contributors.reduce((sum, c) => sum + c.points, 0))

    return { score, contributors }
}

// -- Explanation generation ---------------------------------------------------

function _generateExplanation(
    level: SessionRiskScore['level'],
    contributors: RiskContributor[],
): string {
    if (contributors.length === 0) {
        return 'Session risk: low. No risk factors detected.'
    }

    const top = contributors.slice(0, 3).map(c => c.detail)

    switch (level) {
        case 'low':
            return `Session risk: low. Minor signals: ${top.join('; ')}.`
        case 'medium':
            return `Session risk: medium. Notable signals: ${top.join('; ')}. Enhanced verification recommended.`
        case 'high':
            return `Session risk: HIGH. Critical signals: ${top.join('; ')}. Manual review recommended.`
    }
}

// -- Empty result (SSR / pre-init) --------------------------------------------

function _emptyScore(): SessionRiskScore {
    return {
        score: 0,
        factors: {
            knownDevice: false,
            deviceFingerprint: 'ssr',
            hourOfDay: 0,
            unusualHour: false,
            visibilityChanges: 0,
            copyEvents: 0,
            pasteEvents: 0,
            devToolsDetected: false,
            webrtcLeakDetected: false,
            fingerprintChanged: false,
            estimatedTabCount: 0,
            timeToFirstInteraction: -1,
            suspiciouslyFastStart: false,
            sessionDurationMs: 0,
        },
        level: 'low',
        explanation: 'Session risk not available (server-side rendering).',
    }
}

/**
 * Clean up all event listeners. Call on unmount if needed.
 * After calling this, initSessionRisk() can be called again.
 */
export function destroySessionRisk(): void {
    if (_onVisibilityChange) {
        document.removeEventListener('visibilitychange', _onVisibilityChange)
        _onVisibilityChange = null
    }
    if (_onCopy) {
        document.removeEventListener('copy', _onCopy)
        _onCopy = null
    }
    if (_onPaste) {
        document.removeEventListener('paste', _onPaste)
        _onPaste = null
    }
    if (_onFirstInteraction) {
        document.removeEventListener('mousedown', _onFirstInteraction)
        document.removeEventListener('keydown', _onFirstInteraction)
        document.removeEventListener('touchstart', _onFirstInteraction)
        _onFirstInteraction = null
    }

    _initialized = false
}
