'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

interface VerifyResult {
    valid: boolean
    verified: boolean | null
    hashMatch: boolean | null
    integrity: {
        storedHash: string | null
        expectedHash: string
        tampered: boolean
    }
    session: {
        id: string
        candidateName: string
        role: string
        date: string
        score: number
        status: 'passed' | 'review' | 'flagged'
        livenessScore: number | null
        aiRisk: number | null
        keystrokeCount: number | null
        tabSwitchCount: number | null
        gazeEventCount: number | null
        identityMatchScore: number | null
        alertCount: number
        evidenceCount: number
        certificateIssued: boolean
        autoFlagged: boolean
    }
    verdict: string
    error?: string
}

// ─── Small components ─────────────────────────────────────────────────────────

function MetricCell({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
    const color = ok === undefined ? 'var(--color-text-muted)' : ok ? 'var(--color-primary)' : '#ff4d4d'
    return (
        <div style={{ padding: '14px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', border: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-text-muted)', marginBottom: '6px' }}>{label}</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color }}>{value}</div>
        </div>
    )
}

// ─── Manual hash verifier ─────────────────────────────────────────────────────

function HashVerifier({ storedHash, expectedHash }: { storedHash: string | null; expectedHash: string }) {
    const [inputHash, setInputHash] = useState('')
    const [result, setResult]       = useState<'idle' | 'match' | 'mismatch'>('idle')

    function verify() {
        if (!inputHash.trim()) return
        const clean = inputHash.trim().toLowerCase()
        setResult(clean === expectedHash.toLowerCase() ? 'match' : 'mismatch')
    }

    return (
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '20px' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '12px' }}>Verificar hash manualmente</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '12px', lineHeight: 1.6 }}>
                Pega el hash SHA-256 que aparece en el certificado PDF para comprobar que no ha sido alterado.
            </div>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                <input
                    value={inputHash}
                    onChange={e => { setInputHash(e.target.value); setResult('idle') }}
                    placeholder="Pega el hash SHA-256 del certificado aquí..."
                    style={{ flex: 1, padding: '10px 14px', background: 'var(--color-bg)', border: `1px solid ${result === 'match' ? 'var(--color-primary)' : result === 'mismatch' ? '#ff4d4d' : 'var(--color-border)'}`, borderRadius: '8px', color: 'var(--color-text)', fontFamily: 'monospace', fontSize: '0.78rem', outline: 'none' }}
                    onKeyDown={e => e.key === 'Enter' && verify()}
                />
                <button className="btn btn-primary" onClick={verify} style={{ padding: '10px 20px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                    Verificar
                </button>
            </div>

            {result === 'match' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: 'rgba(0,212,127,0.1)', border: '1px solid rgba(0,212,127,0.3)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '1.2rem' }}>✓</span>
                    <div>
                        <div style={{ color: 'var(--color-primary)', fontWeight: 700, fontSize: '0.88rem' }}>Hash coincide — certificado auténtico</div>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem', marginTop: '2px' }}>Los datos del certificado no han sido modificados desde su emisión.</div>
                    </div>
                </div>
            )}

            {result === 'mismatch' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: 'rgba(255,77,77,0.1)', border: '1px solid rgba(255,77,77,0.3)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '1.2rem' }}>✗</span>
                    <div>
                        <div style={{ color: '#ff4d4d', fontWeight: 700, fontSize: '0.88rem' }}>Hash NO coincide — posible alteración</div>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem', marginTop: '2px' }}>El hash proporcionado no corresponde a esta sesión. El certificado puede haber sido modificado.</div>
                    </div>
                </div>
            )}

            {storedHash && result === 'idle' && (
                <div style={{ marginTop: '12px' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Hash almacenado en el sistema:</div>
                    <code style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: 'var(--color-text-muted)', wordBreak: 'break-all', lineHeight: 1.5 }}>{storedHash}</code>
                </div>
            )}
        </div>
    )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
    const [id, setId] = useState<string>('')
    const [result, setResult]   = useState<VerifyResult | null>(null)
    const [loading, setLoading] = useState(true)
    const [manualHash, setManualHash] = useState('')

    useEffect(() => {
        params.then(p => {
            setId(p.id)
            // Read hash from URL query param if present
            const urlHash = new URLSearchParams(window.location.search).get('hash')
            if (urlHash) setManualHash(urlHash)
            verify(p.id, urlHash ?? undefined)
        })
    }, [])

    const verify = useCallback(async (sessionId: string, hash?: string) => {
        setLoading(true)
        try {
            const url = `/api/verify?id=${encodeURIComponent(sessionId)}${hash ? `&hash=${encodeURIComponent(hash)}` : ''}`
            const res = await fetch(url)
            const data = await res.json()
            setResult(data)
        } catch {
            setResult({ valid: false, verified: null, hashMatch: null, integrity: { storedHash: null, expectedHash: '', tampered: false }, session: null as any, verdict: '', error: 'Error de red al verificar el certificado.' })
        } finally {
            setLoading(false)
        }
    }, [])

    // ── Loading ───────────────────────────────────────────────────────────────
    if (loading) return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
            <div style={{ textAlign: 'center' }}>
                <div style={{ width: '48px', height: '48px', border: '3px solid rgba(0,212,127,0.2)', borderTop: '3px solid var(--color-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
                <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>Verificando certificado...</div>
            </div>
        </div>
    )

    // ── Not found ─────────────────────────────────────────────────────────────
    if (!result?.valid || !result.session) return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)', padding: '40px 20px' }}>
            <div style={{ width: '100%', maxWidth: '480px', textAlign: 'center' }}>
                <div style={{ fontSize: '4rem', marginBottom: '16px' }}>⚠</div>
                <h1 style={{ fontSize: '1.6rem', marginBottom: '10px' }}>Certificado no encontrado</h1>
                <p style={{ color: 'var(--color-text-muted)', marginBottom: '28px', lineHeight: 1.6, fontSize: '0.9rem' }}>
                    {result?.error ?? 'No existe ninguna sesión con el ID proporcionado, o el certificado ha expirado.'}
                </p>
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                    <Link href="/" className="btn btn-outline">Ir al inicio</Link>
                    <Link href="/verify" className="btn btn-primary">Verificar otro</Link>
                </div>
            </div>
        </div>
    )

    const { session, integrity, verdict } = result
    const statusColor = session.status === 'passed' ? 'var(--color-primary)' : session.status === 'flagged' ? '#ff4d4d' : '#ffd700'
    const statusIcon  = session.status === 'passed' ? '✓' : session.status === 'flagged' ? '✗' : '⚠'
    const statusLabel = session.status === 'passed' ? 'APROBADO' : session.status === 'flagged' ? 'RECHAZADO' : 'EN REVISIÓN'
    const integrityOk = integrity.tampered === false && result.hashMatch !== false

    return (
        <div style={{ minHeight: '100vh', background: 'var(--color-bg)', padding: '40px 20px' }}>
            <div style={{ maxWidth: '720px', margin: '0 auto' }}>

                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '32px' }}>
                    <Link href="/" style={{ textDecoration: 'none', fontWeight: 700, fontSize: '1.1rem', color: 'var(--color-text)' }}>
                        Deep-Check<span style={{ color: 'var(--color-primary)' }}>.</span>
                    </Link>
                    <span style={{ color: 'var(--color-border)' }}>/</span>
                    <span style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem' }}>Verificación de Certificado</span>
                </div>

                {/* Main card */}
                <div style={{ background: 'var(--color-surface)', borderRadius: '20px', border: '1px solid var(--color-border)', padding: '40px', marginBottom: '24px' }}>

                    {/* Status banner */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '16px',
                        padding: '20px 24px', borderRadius: '14px', marginBottom: '32px',
                        background: session.status === 'passed' ? 'rgba(0,212,127,0.08)' : session.status === 'flagged' ? 'rgba(255,77,77,0.08)' : 'rgba(255,215,0,0.08)',
                        border: `1px solid ${session.status === 'passed' ? 'rgba(0,212,127,0.3)' : session.status === 'flagged' ? 'rgba(255,77,77,0.3)' : 'rgba(255,215,0,0.3)'}`,
                    }}>
                        <div style={{ fontSize: '2.4rem', lineHeight: 1 }}>{statusIcon}</div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 800, fontSize: '1.1rem', color: statusColor, letterSpacing: '0.05em' }}>{statusLabel}</div>
                            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: '3px' }}>{verdict}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '2.4rem', fontWeight: 800, color: statusColor, lineHeight: 1 }}>{session.score}%</div>
                            <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-text-muted)', marginTop: '2px' }}>Trust Score</div>
                        </div>
                    </div>

                    {/* Candidate info */}
                    <div style={{ marginBottom: '28px' }}>
                        <h2 style={{ fontSize: '1.4rem', marginBottom: '4px' }}>{session.candidateName}</h2>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem' }}>{session.role} · {session.date}</div>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem', marginTop: '4px', fontFamily: 'monospace' }}>ID: {session.id}</div>
                    </div>

                    {/* Integrity check banner */}
                    <div style={{
                        display: 'flex', alignItems: 'flex-start', gap: '14px',
                        padding: '16px 20px', borderRadius: '12px', marginBottom: '28px',
                        background: integrityOk ? 'rgba(0,212,127,0.07)' : result.hashMatch === null ? 'rgba(255,255,255,0.04)' : 'rgba(255,77,77,0.07)',
                        border: `1px solid ${integrityOk ? 'rgba(0,212,127,0.25)' : result.hashMatch === null ? 'var(--color-border)' : 'rgba(255,77,77,0.25)'}`,
                    }}>
                        <div style={{ fontSize: '1.3rem', flexShrink: 0, marginTop: '1px' }}>
                            {integrityOk ? '🔒' : result.hashMatch === null ? '🔓' : '🔴'}
                        </div>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: '0.88rem', color: integrityOk ? 'var(--color-primary)' : result.hashMatch === null ? 'var(--color-text-muted)' : '#ff4d4d', marginBottom: '4px' }}>
                                {integrityOk
                                    ? 'Integridad verificada — datos auténticos'
                                    : result.hashMatch === null
                                        ? 'Integridad sin verificar — sin hash proporcionado'
                                        : 'ADVERTENCIA: Hash no coincide — posible alteración'}
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                                {integrityOk
                                    ? 'El certificado digital coincide con los datos almacenados en el sistema Deep-Check. No ha sido modificado.'
                                    : result.hashMatch === null
                                        ? 'Para verificar la integridad criptográfica, introduce el hash SHA-256 del certificado PDF en el campo de abajo.'
                                        : 'El hash del certificado no coincide con el calculado por el sistema. Los datos del certificado pueden haber sido modificados.'}
                            </div>
                        </div>
                    </div>

                    {/* Metrics grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '28px' }}>
                        <MetricCell label="Liveness" value={session.livenessScore !== null ? `${session.livenessScore}%` : '—'} ok={(session.livenessScore ?? 0) > 70} />
                        <MetricCell label="AI Risk" value={session.aiRisk !== null ? `${session.aiRisk}%` : '—'} ok={(session.aiRisk ?? 0) < 30} />
                        <MetricCell label="Pulsaciones" value={session.keystrokeCount !== null ? `${session.keystrokeCount}` : '—'} />
                        <MetricCell label="Tab Switches" value={`${session.tabSwitchCount ?? 0}`} ok={(session.tabSwitchCount ?? 0) < 2} />
                        <MetricCell label="Gaze Events" value={`${session.gazeEventCount ?? 0}`} ok={(session.gazeEventCount ?? 0) < 5} />
                        <MetricCell label="Incidentes" value={`${session.alertCount}`} ok={session.alertCount < 3} />
                        {session.identityMatchScore !== null && (
                            <MetricCell label="Identity Match" value={`${session.identityMatchScore}%`} ok={(session.identityMatchScore ?? 0) > 70} />
                        )}
                        <MetricCell label="Certificado" value={session.certificateIssued ? 'Emitido' : 'No emitido'} ok={session.certificateIssued} />
                        <MetricCell label="Auto-Flagged" value={session.autoFlagged ? 'Sí' : 'No'} ok={!session.autoFlagged} />
                    </div>

                    {/* Hash verifier */}
                    <HashVerifier
                        storedHash={integrity.storedHash}
                        expectedHash={integrity.expectedHash}
                    />
                </div>

                {/* Cryptographic details */}
                <div style={{ background: 'var(--color-surface)', borderRadius: '16px', border: '1px solid var(--color-border)', padding: '28px', marginBottom: '24px' }}>
                    <h3 style={{ fontSize: '0.9rem', marginBottom: '16px', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                        Detalles criptográficos
                    </h3>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <div>
                            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-text-muted)', marginBottom: '6px' }}>Hash esperado (recalculado ahora)</div>
                            <code style={{ fontFamily: 'monospace', fontSize: '0.72rem', wordBreak: 'break-all', color: 'var(--color-primary)', lineHeight: 1.6, display: 'block', background: 'rgba(0,212,127,0.06)', padding: '10px 14px', borderRadius: '8px' }}>
                                {integrity.expectedHash}
                            </code>
                        </div>

                        {integrity.storedHash && (
                            <div>
                                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-text-muted)', marginBottom: '6px' }}>Hash almacenado en el sistema</div>
                                <code style={{ fontFamily: 'monospace', fontSize: '0.72rem', wordBreak: 'break-all', color: integrity.storedHash === integrity.expectedHash ? 'var(--color-primary)' : '#ff4d4d', lineHeight: 1.6, display: 'block', background: 'rgba(255,255,255,0.04)', padding: '10px 14px', borderRadius: '8px' }}>
                                    {integrity.storedHash}
                                </code>
                                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '6px' }}>
                                    {integrity.storedHash === integrity.expectedHash
                                        ? '✓ Los hashes coinciden — datos íntegros'
                                        : '✗ Los hashes no coinciden — datos pueden haber sido alterados'}
                                </div>
                            </div>
                        )}

                        <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', lineHeight: 1.6, padding: '12px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                            <strong style={{ color: 'var(--color-text)' }}>¿Cómo funciona la verificación?</strong><br />
                            El hash SHA-256 se calcula sobre los metadatos clave de la sesión (ID, nombre, puntuación, estado, métricas biométricas). Si cualquier dato es modificado, el hash cambia completamente. Esta página recalcula el hash en tiempo real y lo compara con el almacenado para detectar cualquier alteración.
                        </div>
                    </div>
                </div>

                {/* Footer links */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Link href="/verify" style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', textDecoration: 'none' }}>
                        ← Verificar otro certificado
                    </Link>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        Emitido por Deep-Check · deep-check-two.vercel.app
                    </div>
                </div>
            </div>
        </div>
    )
}
