'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { BiometricEvent } from '@/components/CodeEditor'
import type { KeystrokeProfile, EnrollmentContext } from '@/lib/db'

const CodeEditorDynamic = dynamic(() => import('@/components/CodeEditor'), {
    ssr: false,
    loading: () => (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
            Inicializando Editor...
        </div>
    )
})

// ─── Enrollment Contexts ──────────────────────────────────────────────────────

// ─── Quality tiers ────────────────────────────────────────────────────────────
// How many bigram pairs with ≥5 samples we want for each tier.
// Prose typing at 60 WPM × 5 min = ~1800 keystrokes → ~150 distinct bigrams × 12 samples.
// Code typing is slower but more symbol-rich.

type QualityTier = 'iniciando' | 'basico' | 'estandar' | 'avanzado' | 'experto'

function computeEnrollmentQuality(
    flightTimes: number[],
    digramAcc: Record<string, number[]>,
): { score: number; tier: QualityTier; label: string; color: string; next: string } {
    const n     = flightTimes.length
    const bigrams5 = Object.values(digramAcc).filter(v => v.length >= 5).length

    // Sample size: 40 pts max (saturates at 600 flight times)
    const ptsSample  = Math.min(40, (n / 600) * 40)
    // Bigram coverage: 35 pts max (saturates at 60 distinct bigrams with ≥5 samples)
    const ptsBigram  = Math.min(35, (bigrams5 / 60) * 35)
    // Variance quality: 25 pts — human CV (stdDev/mean) should be 0.15–0.9
    let ptsVariance = 0
    if (n >= 20) {
        const mean   = flightTimes.reduce((a, b) => a + b, 0) / n
        const stdDev = Math.sqrt(flightTimes.reduce((a, b) => a + (b - mean) ** 2, 0) / n)
        const cv     = stdDev / (mean || 1)
        if (cv >= 0.15 && cv <= 0.9) ptsVariance = 25
        else if (cv >= 0.1)          ptsVariance = 12
    }

    const score = Math.round(ptsSample + ptsBigram + ptsVariance)
    if (score >= 88) return { score, tier: 'experto',   label: 'Experto',   color: '#00ff9d', next: 'Perfil óptimo' }
    if (score >= 68) return { score, tier: 'avanzado',  label: 'Avanzado',  color: '#00cfff', next: 'Escribe un poco más para llegar a Experto' }
    if (score >= 46) return { score, tier: 'estandar',  label: 'Estándar',  color: '#ffd700', next: 'Más texto dará un perfil más fiable' }
    if (score >= 24) return { score, tier: 'basico',    label: 'Básico',    color: '#ff7f50', next: 'Sigue escribiendo para mejorar la precisión' }
    return               { score, tier: 'iniciando', label: 'Iniciando', color: '#555',    next: 'Escribe el texto del prompt para comenzar' }
}

const CONTEXTS: Record<EnrollmentContext, {
    label: string
    description: string
    prompt: string
    language: string
    minKeys: number       // minimum to unlock "Submit" button
    recommendedKeys: number  // target for a reliable profile
}> = {
    prose_es: {
        label: 'Texto en Español',
        description: 'Para exámenes universitarios, ensayos, contratos y documentos legales en español.',
        language: 'plaintext',
        minKeys: 300,
        recommendedKeys: 500,
        prompt: `Escribe el siguiente texto tal como aparece (no copies y pegues, escríbelo manualmente):

"La verificación biométrica de pulsaciones de teclado analiza patrones únicos de escritura que son tan personales como una huella dactilar. Cada persona tiene su propio ritmo, cadencia y velocidad al escribir. Estos patrones son difíciles de imitar y sirven como una firma digital continua que confirma la identidad del usuario durante toda la sesión de trabajo."

Continúa escribiendo libremente sobre el tema que prefieras hasta que el indicador de progreso llegue al 100%.`,
    },
    prose_en: {
        label: 'English Prose',
        description: 'For English-language exams, certifications, journalism, and legal documents.',
        language: 'plaintext',
        minKeys: 300,
        recommendedKeys: 500,
        prompt: `Type the following text manually (do not copy-paste):

"Keystroke biometric verification analyzes unique typing patterns that are as personal as a fingerprint. Every person has their own rhythm, cadence, and speed when typing. These patterns are difficult to replicate and serve as a continuous digital signature confirming user identity throughout the entire work session."

Then continue writing freely on any topic until the progress bar reaches 100%.`,
    },
    code_python: {
        label: 'Código Python',
        description: 'Para entrevistas técnicas, exámenes de programación y certificaciones Python.',
        language: 'python',
        prompt: `# Escribe este código manualmente (no copies y pegues)

def fibonacci(n: int) -> list[int]:
    """Genera la secuencia de Fibonacci hasta n términos."""
    if n <= 0:
        return []
    elif n == 1:
        return [0]

    sequence = [0, 1]
    while len(sequence) < n:
        sequence.append(sequence[-1] + sequence[-2])
    return sequence


def is_prime(num: int) -> bool:
    """Verifica si un número es primo."""
    if num < 2:
        return False
    for i in range(2, int(num ** 0.5) + 1):
        if num % i == 0:
            return False
    return True


def merge_sort(arr: list) -> list:
    """Ordenación por mezcla recursiva."""
    if len(arr) <= 1:
        return arr
    mid = len(arr) // 2
    left  = merge_sort(arr[:mid])
    right = merge_sort(arr[mid:])
    result = []
    i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            result.append(left[i]); i += 1
        else:
            result.append(right[j]); j += 1
    return result + left[i:] + right[j:]


# Continúa con tu propia implementación hasta completar el perfil
`,
        minKeys: 200,
        recommendedKeys: 350,
    },
    code_js: {
        label: 'Código JavaScript/TypeScript',
        description: 'Para entrevistas frontend, Node.js y desarrollo web.',
        language: 'typescript',
        prompt: `// Escribe este código manualmente (no copies y pegues)

interface User {
  id: string
  name: string
  email: string
  createdAt: Date
}

async function fetchUser(id: string): Promise<User | null> {
  try {
    const response = await fetch(\`/api/users/\${id}\`)
    if (!response.ok) return null
    const data = await response.json()
    return { id: data.id, name: data.name, email: data.email, createdAt: new Date(data.createdAt) }
  } catch (error) {
    console.error('Error fetching user:', error)
    return null
  }
}

function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>
  return ((...args: unknown[]) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }) as T
}

function groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = String(item[key])
    if (!acc[k]) acc[k] = []
    acc[k].push(item)
    return acc
  }, {} as Record<string, T[]>)
}

// Continúa con tu propia implementación
`,
        minKeys: 200,
        recommendedKeys: 350,
    },
    code_general: {
        label: 'Código General',
        description: 'Agnóstico de lenguaje. Para perfiles mixtos o cuando el lenguaje no está fijado.',
        language: 'plaintext',
        prompt: `Escribe cualquier fragmento de código en el lenguaje de tu elección.
El sistema analizará tu ritmo de escritura independientemente del lenguaje.

Incluye funciones, condiciones, bucles y operadores para un perfil más rico.
Cuanto más variado sea el texto, mejor será el perfil biométrico resultante.

Empieza a escribir aquí:
`,
        minKeys: 200,
        recommendedKeys: 350,
    },
}

// ─── Progress ring ────────────────────────────────────────────────────────────

function ProgressRing({ pct, size = 80 }: { pct: number; size?: number }) {
    const r = (size - 8) / 2
    const circ = 2 * Math.PI * r
    const offset = circ * (1 - Math.min(1, pct / 100))
    const color = pct >= 100 ? 'var(--color-primary)' : pct > 60 ? '#ffd700' : '#555'
    return (
        <svg width={size} height={size}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={8} />
            <circle
                cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={color} strokeWidth={8}
                strokeDasharray={circ} strokeDashoffset={offset}
                strokeLinecap="round"
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                style={{ transition: 'stroke-dashoffset 0.4s ease, stroke 0.4s ease' }}
            />
            <text x={size / 2} y={size / 2 + 6} textAnchor="middle" fill={color} fontSize={15} fontWeight={700}>
                {Math.min(100, Math.round(pct))}%
            </text>
        </svg>
    )
}

// ─── Purpose presets ─────────────────────────────────────────────────────────
// Maps a use-case type to the best enrollment context + label

const PURPOSE_PRESETS: {
    id: string
    icon: string
    title: string
    subtitle: string
    suggestedContext: EnrollmentContext
    badge?: string
}[] = [
    {
        id: 'university_exam',
        icon: '🎓',
        title: 'Examen universitario',
        subtitle: 'TFG, tesis, ensayo académico o prueba de evaluación continua.',
        suggestedContext: 'prose_es',
        badge: 'Educación',
    },
    {
        id: 'certification_en',
        icon: '📜',
        title: 'Certificación profesional',
        subtitle: 'AWS, Microsoft, CFA, PMP u otras certificaciones en inglés.',
        suggestedContext: 'prose_en',
        badge: 'Profesional',
    },
    {
        id: 'tech_interview',
        icon: '💻',
        title: 'Entrevista técnica de programación',
        subtitle: 'Live coding, resolución de algoritmos o prueba técnica de empresa.',
        suggestedContext: 'code_js',
        badge: 'Tech',
    },
    {
        id: 'legal_doc',
        icon: '⚖️',
        title: 'Firma de documento legal',
        subtitle: 'Contratos, testamentos, poderes notariales u operaciones bancarias.',
        suggestedContext: 'prose_es',
        badge: 'LegalTech',
    },
    {
        id: 'journalism',
        icon: '📰',
        title: 'Artículo o contenido periodístico',
        subtitle: 'Certifica que el artículo fue redactado manualmente por un humano.',
        suggestedContext: 'prose_es',
        badge: 'Periodismo',
    },
    {
        id: 'custom',
        icon: '⚙️',
        title: 'Personalizado',
        subtitle: 'Elige manualmente el contexto de escritura que mejor se adapte.',
        suggestedContext: 'prose_es',
    },
]

// ─── Main component ───────────────────────────────────────────────────────────

export default function EnrollPage() {
    const [step, setStep]             = useState<'purpose' | 'info' | 'context' | 'typing' | 'done'>('purpose')
    const [purposeId, setPurposeId]   = useState('')
    const [name, setName]             = useState('')
    const [email, setEmail]           = useState('')
    const [context, setContext]       = useState<EnrollmentContext>('prose_es')
    const [keystrokeCount, setKeystrokeCount] = useState(0)
    const [saving, setSaving]         = useState(false)
    const [profileId, setProfileId]   = useState('')
    const [enrollmentHash, setEnrollmentHash] = useState('')
    const [expiresAt, setExpiresAt]   = useState('')
    const [error, setError]           = useState('')

    // Live biometric accumulator
    const flightTimesRef   = useRef<number[]>([])
    const holdTimesRef     = useRef<number[]>([])
    // Proper bigram (digram) accumulator: keyed by "prevKey→currKey"
    const digramAccRef     = useRef<Record<string, number[]>>({})
    // Track previous key to form bigrams
    const prevKeyRef       = useRef<string>('')
    // Track enrollment start time for WPM calculation
    const enrollStartRef   = useRef<number>(0)
    // Live quality indicator
    const [quality, setQuality] = useState(() => computeEnrollmentQuality([], {}))

    const ctx = CONTEXTS[context]
    const minKeys         = ctx.minKeys
    const recommendedKeys = ctx.recommendedKeys
    const progress        = Math.min(100, (keystrokeCount / minKeys) * 100)
    // Show a secondary "recommended" progress once past minKeys
    const qualityProgress = Math.min(100, (keystrokeCount / recommendedKeys) * 100)
    const ready = keystrokeCount >= minKeys

    // ── Accumulate biometric data from CodeEditor events ─────────────────────
    const SKIP_BIGRAM = new Set(['Backspace', 'Delete', 'Enter', 'Tab', 'Shift', 'Control', 'Alt', 'Meta'])

    const handleBiometricEvent = useCallback((event: BiometricEvent) => {
        if (event.type !== 'keystroke') return

        setKeystrokeCount(prev => prev + 1)

        // Start timer on first real keystroke
        if (enrollStartRef.current === 0) enrollStartRef.current = Date.now()

        const currentKey = event.key ?? ''
        const ft = event.flightTime

        if (ft && ft > 10 && ft < 2000) {
            flightTimesRef.current.push(ft)

            // ── Bigram (digram) collection ──────────────────────────────
            // Key: "prevKey→currKey". Only track pairs where both keys are
            // printable (letters, digits, symbols) — skip modifiers, Backspace, etc.
            // This captures the real inter-key transition timing, which is what
            // distinguishes one person's typing from another's.
            if (prevKeyRef.current && !SKIP_BIGRAM.has(currentKey) && !SKIP_BIGRAM.has(prevKeyRef.current)) {
                const bigram = `${prevKeyRef.current}→${currentKey}`
                if (!digramAccRef.current[bigram]) digramAccRef.current[bigram] = []
                digramAccRef.current[bigram].push(ft)
            }
        }

        if (event.holdTime && event.holdTime > 10 && event.holdTime < 500) {
            holdTimesRef.current.push(event.holdTime)
        }

        // Advance previous key (skip non-character keys so we don't create
        // spurious "Backspace→a" bigrams — those reflect correction, not rhythm)
        if (!SKIP_BIGRAM.has(currentKey)) {
            prevKeyRef.current = currentKey
        }

        // Recompute quality score every 10 keystrokes
        if (flightTimesRef.current.length % 10 === 0) {
            setQuality(computeEnrollmentQuality(flightTimesRef.current, digramAccRef.current))
        }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Build keystroke profile from accumulated data ─────────────────────────
    function buildProfile(): KeystrokeProfile {
        const flights = flightTimesRef.current
        const holds   = holdTimesRef.current

        function stats(arr: number[]) {
            if (arr.length === 0) return { mean: 0, std: 0 }
            const mean = arr.reduce((a, b) => a + b, 0) / arr.length
            const std  = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length)
            return { mean, std }
        }

        function entropy(arr: number[]): number {
            if (arr.length === 0) return 0
            const min = Math.min(...arr), max = Math.max(...arr)
            const buckets = 10
            const bucketSize = (max - min) / buckets || 1
            const counts = new Array(buckets).fill(0)
            arr.forEach(v => {
                const idx = Math.min(buckets - 1, Math.floor((v - min) / bucketSize))
                counts[idx]++
            })
            return counts.reduce((e, c) => {
                if (c === 0) return e
                const p = c / arr.length
                return e - p * Math.log2(p)
            }, 0)
        }

        const fStats = stats(flights)
        const hStats = stats(holds)

        // ── Bigram map: only include pairs with ≥5 samples ──────────────
        // At <5 samples the per-digram stdDev is too noisy to be useful.
        // At ≥5 samples we have a meaningful mean and enough variance info.
        const digrams: KeystrokeProfile['digrams'] = {}
        Object.entries(digramAccRef.current).forEach(([bigram, vals]) => {
            if (vals.length >= 5) {
                const s = stats(vals)
                digrams[bigram] = { mean: Math.round(s.mean), std: Math.round(s.std), count: vals.length }
            }
        })

        // ── WPM calculation ──────────────────────────────────────────────
        // Based on elapsed time since first keystroke and total keystrokes.
        // Early portion (first 20% of session) may be slower due to reading
        // the prompt — we compute both an early and a late WPM to get a range.
        const elapsedMs  = enrollStartRef.current > 0 ? Date.now() - enrollStartRef.current : 0
        const elapsedMin = Math.max(0.1, elapsedMs / 60000)
        const totalWpm   = Math.round((keystrokeCount / 5) / elapsedMin)

        // Compute WPM for the second half of the session (steadier typing)
        const halfFlights = flights.slice(Math.floor(flights.length / 2))
        const halfMs      = halfFlights.reduce((s, f) => s + f, 0)
        const halfMin     = Math.max(0.01, halfMs / 60000)
        const halfWpm     = halfFlights.length > 20
            ? Math.round((halfFlights.length / 5) / halfMin)
            : totalWpm

        const wpmMin = Math.max(10, Math.min(totalWpm, halfWpm) - 10)
        const wpmMax = Math.max(wpmMin + 5, Math.max(totalWpm, halfWpm) + 10)

        return {
            flightMean: Math.round(fStats.mean),
            flightStd:  Math.round(fStats.std),
            holdMean:   Math.round(hStats.mean),
            holdStd:    Math.round(hStats.std),
            entropy:    parseFloat(entropy(flights).toFixed(2)),
            digrams,
            wpmMin,
            wpmMax,
            sampleSize: keystrokeCount,
        }
    }

    // ── Submit enrollment ─────────────────────────────────────────────────────
    async function handleFinishEnrollment() {
        if (!ready) return
        setSaving(true)
        setError('')

        const profile = buildProfile()

        try {
            const res = await fetch('/api/enrollment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ candidateName: name, candidateEmail: email, context, profile }),
            })
            const json = await res.json()
            if (!json.success) {
                setError(json.error ?? 'Error al guardar el perfil')
                setSaving(false)
                return
            }
            setProfileId(json.profileId)
            setEnrollmentHash(json.enrollmentHash)
            setExpiresAt(json.expiresAt)
            setStep('done')
        } catch {
            setError('Error de red. Inténtalo de nuevo.')
        } finally {
            setSaving(false)
        }
    }

    // ── Render: Step 0 — Purpose ─────────────────────────────────────────────
    if (step === 'purpose') return (
        <div style={{ minHeight: '100vh', background: 'var(--color-bg)', padding: '40px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {/* Top nav */}
            <div style={{ width: '100%', maxWidth: '700px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '48px' }}>
                <Link href="/" style={{ textDecoration: 'none', fontWeight: 700, color: 'var(--color-text)' }}>
                    Deep-Check<span style={{ color: 'var(--color-primary)' }}>.</span>
                </Link>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Paso 1 de 4</div>
            </div>

            <div style={{ width: '100%', maxWidth: '700px' }}>
                <div style={{ marginBottom: '8px', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--color-primary)' }}>Enrollment Biométrico</div>
                <h1 style={{ fontSize: '1.9rem', marginBottom: '10px' }}>¿Para qué vas a usar Deep-Check?</h1>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem', lineHeight: 1.6, marginBottom: '32px', maxWidth: '520px' }}>
                    Selecciona el tipo de prueba. El sistema elegirá automáticamente el contexto de escritura más adecuado para construir tu perfil biométrico.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '36px' }}>
                    {PURPOSE_PRESETS.map(p => (
                        <button
                            key={p.id}
                            onClick={() => setPurposeId(p.id)}
                            style={{
                                display: 'flex', alignItems: 'flex-start', gap: '14px', padding: '18px 20px',
                                background: purposeId === p.id ? 'rgba(0,212,127,0.08)' : 'rgba(255,255,255,0.03)',
                                border: `1.5px solid ${purposeId === p.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                borderRadius: '14px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                            }}
                        >
                            <span style={{ fontSize: '1.6rem', flexShrink: 0, lineHeight: 1 }}>{p.icon}</span>
                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{p.title}</span>
                                    {p.badge && (
                                        <span style={{ fontSize: '0.62rem', padding: '2px 7px', borderRadius: '20px', background: purposeId === p.id ? 'rgba(0,212,127,0.15)' : 'rgba(255,255,255,0.07)', color: purposeId === p.id ? 'var(--color-primary)' : 'var(--color-text-muted)', border: `1px solid ${purposeId === p.id ? 'rgba(0,212,127,0.25)' : 'var(--color-border)'}` }}>
                                            {p.badge}
                                        </span>
                                    )}
                                </div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{p.subtitle}</div>
                                <div style={{ marginTop: '8px', fontSize: '0.7rem', color: purposeId === p.id ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
                                    Contexto: <strong>{p.suggestedContext}</strong>
                                </div>
                            </div>
                        </button>
                    ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                        className="btn btn-primary"
                        disabled={!purposeId}
                        onClick={() => {
                            const preset = PURPOSE_PRESETS.find(p => p.id === purposeId)!
                            setContext(preset.suggestedContext)
                            setStep('info')
                        }}
                        style={{ opacity: purposeId ? 1 : 0.4, padding: '11px 28px' }}
                    >
                        Continuar →
                    </button>
                </div>
            </div>
        </div>
    )

    // ── Render: Step 1 — Info ─────────────────────────────────────────────────
    if (step === 'info') return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', background: 'var(--color-bg)' }}>
            <div style={{ width: '100%', maxWidth: '520px', background: 'var(--color-surface)', borderRadius: '24px', border: '1px solid var(--color-border)', padding: '48px 44px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--color-primary)' }}>Deep-Check · Paso 2 de 4</div>
                    <button onClick={() => setStep('purpose')} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.8rem' }}>← Cambiar tipo</button>
                </div>
                {purposeId && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '5px 12px', background: 'rgba(0,212,127,0.08)', border: '1px solid rgba(0,212,127,0.2)', borderRadius: '20px', marginBottom: '12px' }}>
                        <span>{PURPOSE_PRESETS.find(p => p.id === purposeId)?.icon}</span>
                        <span style={{ fontSize: '0.78rem', color: 'var(--color-primary)' }}>{PURPOSE_PRESETS.find(p => p.id === purposeId)?.title}</span>
                    </div>
                )}
                <h1 style={{ fontSize: '1.8rem', marginBottom: '10px' }}>Tus datos</h1>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '32px' }}>
                    Tu <strong style={{ color: 'var(--color-text)' }}>firma de teclado</strong> quedará asociada a estos datos.
                    El sistema usará el perfil para verificar que eres tú quien escribe en cada sesión futura.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '32px' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '6px' }}>Nombre completo</label>
                        <input
                            value={name} onChange={e => setName(e.target.value)}
                            placeholder="Ej. Pablo Rodríguez"
                            style={{ width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--color-border)', borderRadius: '10px', color: 'var(--color-text)', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '6px' }}>Email institucional o profesional</label>
                        <input
                            type="email" value={email} onChange={e => setEmail(e.target.value)}
                            placeholder="pablo@empresa.com"
                            style={{ width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--color-border)', borderRadius: '10px', color: 'var(--color-text)', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
                        />
                    </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '16px', marginBottom: '28px', fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                    🔒 <strong style={{ color: 'var(--color-text)' }}>Privacidad:</strong> Tu perfil biométrico se almacena encriptado. Solo se guardan estadísticas de tiempo (milisegundos entre pulsaciones), nunca el contenido de lo que escribas. El perfil caduca a los 90 días.
                </div>

                <button
                    className="btn btn-primary"
                    style={{ width: '100%' }}
                    onClick={() => setStep('context')}
                    disabled={!name.trim() || !email.includes('@')}
                >
                    Continuar →
                </button>
            </div>
        </div>
    )

    // ── Render: Step 2 — Context selection ───────────────────────────────────
    if (step === 'context') return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', background: 'var(--color-bg)' }}>
            <div style={{ width: '100%', maxWidth: '600px', background: 'var(--color-surface)', borderRadius: '24px', border: '1px solid var(--color-border)', padding: '48px 44px' }}>
                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--color-primary)', marginBottom: '8px' }}>Paso 3 de 4</div>
                <h2 style={{ fontSize: '1.5rem', marginBottom: '8px' }}>Confirma el contexto de escritura</h2>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem', marginBottom: '28px' }}>
                    Basado en tu selección anterior hemos preseleccionado el contexto. Puedes cambiarlo si lo necesitas.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '32px' }}>
                    {(Object.entries(CONTEXTS) as [EnrollmentContext, typeof CONTEXTS[EnrollmentContext]][]).map(([key, val]) => (
                        <button
                            key={key}
                            onClick={() => setContext(key)}
                            style={{
                                display: 'flex', alignItems: 'flex-start', gap: '16px',
                                padding: '16px 20px', borderRadius: '12px', cursor: 'pointer', textAlign: 'left',
                                background: context === key ? 'rgba(0, 212, 127, 0.08)' : 'rgba(255,255,255,0.03)',
                                border: `1.5px solid ${context === key ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                transition: 'all 0.2s',
                            }}
                        >
                            <div style={{
                                width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0, marginTop: '2px',
                                border: `2px solid ${context === key ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                background: context === key ? 'var(--color-primary)' : 'transparent',
                            }} />
                            <div>
                                <div style={{ fontWeight: 600, marginBottom: '3px' }}>{val.label}</div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{val.description}</div>
                            </div>
                        </button>
                    ))}
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                    <button className="btn btn-outline" onClick={() => setStep('info')}>← Atrás</button>
                    <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setStep('typing')}>
                        Empezar Enrollment →
                    </button>
                </div>
            </div>
        </div>
    )

    // ── Render: Step 3 — Typing ───────────────────────────────────────────────
    if (step === 'typing') return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)' }}>
            {/* Header */}
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 28px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                <div>
                    <div style={{ fontWeight: 700, fontSize: '1rem' }}>Deep-Check <span style={{ color: 'var(--color-primary)' }}>Enrollment</span> <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginLeft: '6px' }}>Paso 4 de 4</span></div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{name} · {ctx.label}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <ProgressRing pct={progress} size={72} />
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Pulsaciones</div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 700, color: ready ? 'var(--color-primary)' : 'var(--color-text)' }}>
                            {keystrokeCount} / {minKeys}
                        </div>
                        {/* Quality badge */}
                        <div style={{ fontSize: '0.7rem', marginTop: '3px', color: quality.color, fontWeight: 600 }}>
                            ● {quality.label}
                        </div>
                    </div>
                    <button
                        className="btn btn-primary"
                        onClick={handleFinishEnrollment}
                        disabled={!ready || saving}
                        style={{ opacity: ready ? 1 : 0.4, cursor: ready ? 'pointer' : 'not-allowed' }}
                    >
                        {saving ? 'Guardando...' : ready ? '✓ Completar' : `Faltan ${minKeys - keystrokeCount}`}
                    </button>
                </div>
            </header>

            {/* Prompt + Editor */}
            <div style={{ display: 'flex', flex: 1, gap: '0', overflow: 'hidden' }}>
                {/* Prompt panel */}
                <div style={{ width: '320px', flexShrink: 0, padding: '24px 20px', borderRight: '1px solid var(--color-border)', background: 'rgba(255,255,255,0.01)', overflowY: 'auto' }}>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-primary)', marginBottom: '12px' }}>Instrucciones</div>
                    <div style={{ fontSize: '0.83rem', color: 'var(--color-text-muted)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                        {ctx.prompt}
                    </div>
                    {error && (
                        <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(255,77,77,0.1)', border: '1px solid rgba(255,77,77,0.3)', borderRadius: '8px', fontSize: '0.82rem', color: '#ff4d4d' }}>
                            {error}
                        </div>
                    )}

                    {/* Live quality panel */}
                    {keystrokeCount > 10 && (
                        <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '0' }}>
                            {/* Quality score block */}
                            <div style={{ padding: '14px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${quality.color}33`, borderRadius: '10px', marginBottom: '12px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                    <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-text-muted)' }}>Calidad del perfil</span>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: quality.color }}>{quality.label}</span>
                                </div>
                                {/* Quality bar */}
                                <div style={{ height: '5px', background: 'rgba(255,255,255,0.07)', borderRadius: '3px', overflow: 'hidden', marginBottom: '8px' }}>
                                    <div style={{ height: '100%', width: `${quality.score}%`, background: quality.color, borderRadius: '3px', transition: 'width 0.5s ease' }} />
                                </div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{quality.next}</div>
                            </div>

                            {/* Recommended target bar (shown only once past minKeys) */}
                            {ready && (
                                <div style={{ marginBottom: '12px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                        <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Hacia perfil recomendado</span>
                                        <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{keystrokeCount}/{recommendedKeys}</span>
                                    </div>
                                    <div style={{ height: '4px', background: 'rgba(255,255,255,0.07)', borderRadius: '2px', overflow: 'hidden' }}>
                                        <div style={{ height: '100%', width: `${qualityProgress}%`, background: 'var(--color-primary)', borderRadius: '2px', transition: 'width 0.3s' }} />
                                    </div>
                                </div>
                            )}

                            {/* Signal breakdown */}
                            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-text-muted)', marginBottom: '8px' }}>Señales captadas</div>
                            {[
                                { label: 'Tiempos de vuelo', value: flightTimesRef.current.length, target: 300, unit: '' },
                                {
                                    label: 'Bigrams únicos (≥5 muestras)',
                                    value: Object.values(digramAccRef.current).filter(v => v.length >= 5).length,
                                    target: 50,
                                    unit: '',
                                },
                                { label: 'Pulsaciones (hold)', value: holdTimesRef.current.length, target: 200, unit: '' },
                            ].map(s => (
                                <div key={s.label} style={{ marginBottom: '8px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{s.label}</span>
                                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: s.value >= s.target ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
                                            {s.value}{s.value >= s.target ? ' ✓' : ` / ${s.target}`}
                                        </span>
                                    </div>
                                    <div style={{ height: '3px', background: 'rgba(255,255,255,0.07)', borderRadius: '2px', overflow: 'hidden' }}>
                                        <div style={{ height: '100%', width: `${Math.min(100, (s.value / s.target) * 100)}%`, background: s.value >= s.target ? 'var(--color-primary)' : '#ffd700', borderRadius: '2px', transition: 'width 0.3s' }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Editor */}
                <div style={{ flex: 1, overflow: 'hidden' }}>
                    <CodeEditorDynamic
                        onBiometricEvent={handleBiometricEvent}
                        language={ctx.language}
                    />
                </div>
            </div>

            {/* Progress bar */}
            <div style={{ height: '4px', background: 'rgba(255,255,255,0.06)' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: ready ? 'var(--color-primary)' : '#ffd700', transition: 'width 0.3s ease, background 0.4s ease' }} />
            </div>
        </div>
    )

    // ── Render: Step 4 — Done ─────────────────────────────────────────────────
    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', background: 'var(--color-bg)' }}>
            <div style={{ width: '100%', maxWidth: '560px', background: 'var(--color-surface)', borderRadius: '24px', border: '1px solid var(--color-border)', padding: '48px 44px' }}>
                <div style={{ textAlign: 'center', marginBottom: '36px' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '12px' }}>🎉</div>
                    <h2 style={{ fontSize: '1.8rem', marginBottom: '8px' }}>Enrollment Completado</h2>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                        Tu firma biométrica de teclado ha sido registrada correctamente.
                    </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '32px' }}>
                    <InfoRow label="Candidato" value={name} />
                    <InfoRow label="Email" value={email} />
                    <InfoRow label="Contexto" value={ctx.label} />
                    <InfoRow label="Profile ID" value={profileId} mono />
                    <InfoRow label="Válido hasta" value={new Date(expiresAt).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })} />
                </div>

                {/* Hash fingerprint */}
                <div style={{ background: 'rgba(0,212,127,0.06)', border: '1px solid rgba(0,212,127,0.2)', borderRadius: '12px', padding: '16px 20px', marginBottom: '28px' }}>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-primary)', marginBottom: '8px' }}>
                        Fingerprint del perfil (SHA-256)
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', wordBreak: 'break-all', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                        {enrollmentHash}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '8px' }}>
                        Este hash certifica que el perfil no ha sido manipulado. Guárdalo como referencia.
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                    <Link href="/interview" className="btn btn-primary" style={{ flex: 1, textAlign: 'center' }}>
                        Ir a la Sesión →
                    </Link>
                    <Link href="/dashboard" className="btn btn-outline">
                        Dashboard
                    </Link>
                </div>
            </div>
        </div>
    )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>{label}</span>
            <span style={{ fontSize: mono ? '0.72rem' : '0.88rem', fontFamily: mono ? 'monospace' : 'inherit', fontWeight: 600, maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
        </div>
    )
}
