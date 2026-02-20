'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function VerifyLandingPage() {
    const router = useRouter()
    const [sessionId, setSessionId] = useState('')
    const [hash, setHash] = useState('')
    const [error, setError] = useState('')

    function handleVerify() {
        const id = sessionId.trim()
        if (!id) { setError('Introduce el ID de sesión del certificado.'); return }
        setError('')
        const hashParam = hash.trim() ? `?hash=${encodeURIComponent(hash.trim())}` : ''
        router.push(`/verify/${encodeURIComponent(id)}${hashParam}`)
    }

    return (
        <div style={{ minHeight: '100vh', background: 'var(--color-bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>

            {/* Nav */}
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, padding: '16px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)', background: 'rgba(10,12,18,0.85)', backdropFilter: 'blur(12px)', zIndex: 10 }}>
                <Link href="/" style={{ textDecoration: 'none', fontWeight: 700, fontSize: '1rem', color: 'var(--color-text)' }}>
                    Deep-Check<span style={{ color: 'var(--color-primary)' }}>.</span>
                </Link>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', fontSize: '0.85rem' }}>
                    <Link href="/enroll" style={{ color: 'var(--color-text-muted)', textDecoration: 'none' }}>Enrollment</Link>
                    <Link href="/docs" style={{ color: 'var(--color-text-muted)', textDecoration: 'none' }}>API</Link>
                    <Link href="/dashboard" className="btn btn-primary" style={{ padding: '7px 16px', fontSize: '0.82rem' }}>Dashboard</Link>
                </div>
            </div>

            <div style={{ width: '100%', maxWidth: '560px', marginTop: '60px' }}>

                {/* Header */}
                <div style={{ textAlign: 'center', marginBottom: '40px' }}>
                    <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.18em', color: 'var(--color-primary)', marginBottom: '12px' }}>
                        Verificación Pública
                    </div>
                    <h1 style={{ fontSize: '2.2rem', marginBottom: '12px', lineHeight: 1.2 }}>
                        Verifica la autenticidad<br />de un certificado
                    </h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                        Comprueba que un certificado de Deep-Check es genuino y que sus datos no han sido alterados desde su emisión.
                    </p>
                </div>

                {/* Form card */}
                <div style={{ background: 'var(--color-surface)', borderRadius: '20px', border: '1px solid var(--color-border)', padding: '36px 40px', marginBottom: '24px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '7px' }}>
                                ID de sesión <span style={{ color: '#ff4d4d' }}>*</span>
                            </label>
                            <input
                                value={sessionId}
                                onChange={e => { setSessionId(e.target.value); setError('') }}
                                onKeyDown={e => e.key === 'Enter' && handleVerify()}
                                placeholder="Ej. abc123xyz"
                                style={{ width: '100%', padding: '11px 14px', background: 'rgba(255,255,255,0.05)', border: `1px solid ${error ? '#ff4d4d' : 'var(--color-border)'}`, borderRadius: '10px', color: 'var(--color-text)', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace' }}
                            />
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '5px' }}>
                                Aparece en el certificado PDF junto a "Session:" o "ID:"
                            </div>
                        </div>

                        <div>
                            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '7px' }}>
                                Hash SHA-256 del certificado <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>(opcional, para verificación criptográfica)</span>
                            </label>
                            <input
                                value={hash}
                                onChange={e => setHash(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleVerify()}
                                placeholder="64 caracteres hexadecimales del certificado PDF..."
                                style={{ width: '100%', padding: '11px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--color-border)', borderRadius: '10px', color: 'var(--color-text)', fontSize: '0.78rem', outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace' }}
                            />
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '5px' }}>
                                Si introduces el hash, se comprueba que el certificado no ha sido manipulado.
                            </div>
                        </div>

                        {error && (
                            <div style={{ color: '#ff4d4d', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span>⚠</span> {error}
                            </div>
                        )}

                        <button
                            className="btn btn-primary"
                            onClick={handleVerify}
                            disabled={!sessionId.trim()}
                            style={{ width: '100%', padding: '12px', fontSize: '0.95rem', opacity: sessionId.trim() ? 1 : 0.5 }}
                        >
                            Verificar certificado →
                        </button>
                    </div>
                </div>

                {/* How it works */}
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '14px', border: '1px solid var(--color-border)', padding: '24px 28px' }}>
                    <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-text-muted)', marginBottom: '14px' }}>Cómo funciona</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {[
                            ['🔑', 'ID de sesión', 'Identifica de forma única cada sesión monitorizada por Deep-Check.'],
                            ['🔒', 'Hash SHA-256', 'Huella criptográfica calculada sobre los metadatos de la sesión. Si cualquier dato es alterado, el hash cambia completamente.'],
                            ['✓', 'Verificación en tiempo real', 'El sistema recalcula el hash al momento y lo compara con el almacenado para detectar manipulaciones.'],
                        ].map(([icon, title, desc]) => (
                            <div key={title} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                                <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: '1px' }}>{icon}</span>
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '2px' }}>{title}</div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{desc}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* API note */}
                <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                    También disponible como API:{' '}
                    <code style={{ fontFamily: 'monospace', color: 'var(--color-primary)', fontSize: '0.75rem' }}>
                        GET /api/verify?id=SESSION_ID
                    </code>
                </div>
            </div>
        </div>
    )
}
