'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import styles from '../page.module.css'

const ADMIN_SECRET = 'dev-admin-secret'   // In production: read from env/UI input

interface ApiKey {
    key: string
    name: string
    createdAt: string
    lastUsed?: string
    active: boolean
    permissions: string[]
    webhookUrl?: string
}

export default function SettingsPage() {
    const [apiKeys, setApiKeys]         = useState<ApiKey[]>([])
    const [loadingKeys, setLoadingKeys] = useState(false)
    const [newKeyName, setNewKeyName]   = useState('')
    const [newKeyWebhook, setNewKeyWebhook] = useState('')
    const [createdKey, setCreatedKey]   = useState<string | null>(null)
    const [creating, setCreating]       = useState(false)
    const [error, setError]             = useState('')

    async function loadKeys() {
        setLoadingKeys(true)
        try {
            const res = await fetch('/api/v1/keys', { headers: { 'X-Admin-Secret': ADMIN_SECRET } })
            const json = await res.json()
            if (json.success) setApiKeys(json.data)
        } finally {
            setLoadingKeys(false)
        }
    }

    useEffect(() => { loadKeys() }, [])

    async function handleCreateKey() {
        if (!newKeyName.trim()) return
        setCreating(true)
        setError('')
        setCreatedKey(null)
        try {
            const res = await fetch('/api/v1/keys', {
                method: 'POST',
                headers: { 'X-Admin-Secret': ADMIN_SECRET, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newKeyName,
                    permissions: ['read', 'write'],
                    webhookUrl: newKeyWebhook || undefined,
                }),
            })
            const json = await res.json()
            if (json.success) {
                setCreatedKey(json.data.key)
                setNewKeyName('')
                setNewKeyWebhook('')
                loadKeys()
            } else {
                setError(json.error)
            }
        } catch {
            setError('Network error')
        } finally {
            setCreating(false)
        }
    }

    return (
        <div className={styles.content}>
            <header className={styles.header}>
                <h1>Settings & <span className="text-gradient">API Integration</span></h1>
                <Link href="/docs" className="btn btn-outline" style={{ fontSize: '0.85rem', padding: '8px 16px' }}>
                    API Docs →
                </Link>
            </header>

            {/* API Keys section */}
            <section className={styles.tableSection} style={{ padding: '32px', marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                    <div>
                        <h3 style={{ marginBottom: '4px' }}>API Keys</h3>
                        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', margin: 0 }}>
                            Conecta plataformas externas (Moodle, Canvas, ATS) a Deep-Check via REST API.
                        </p>
                    </div>
                    <Link href="/docs" style={{ fontSize: '0.8rem', color: 'var(--color-primary)', textDecoration: 'none' }}>Ver documentación →</Link>
                </div>

                {/* Create new key */}
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '20px', marginBottom: '24px' }}>
                    <h4 style={{ marginBottom: '16px', fontSize: '0.9rem' }}>Nueva API Key</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: '6px' }}>Nombre (ej. "Moodle - Universidad XYZ")</label>
                            <input
                                value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
                                placeholder="Nombre de la integración"
                                style={{ width: '100%', padding: '10px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '8px', color: 'white', fontSize: '0.88rem', boxSizing: 'border-box' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: '6px' }}>Webhook URL (opcional)</label>
                            <input
                                value={newKeyWebhook} onChange={e => setNewKeyWebhook(e.target.value)}
                                placeholder="https://tu-plataforma.com/webhook"
                                style={{ width: '100%', padding: '10px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '8px', color: 'white', fontSize: '0.88rem', boxSizing: 'border-box' }}
                            />
                        </div>
                    </div>
                    <button
                        className="btn btn-primary" onClick={handleCreateKey}
                        disabled={!newKeyName.trim() || creating}
                        style={{ fontSize: '0.85rem', padding: '8px 20px' }}
                    >
                        {creating ? 'Creando...' : '+ Crear Key'}
                    </button>
                    {error && <p style={{ color: '#ff4d4d', fontSize: '0.82rem', marginTop: '8px' }}>{error}</p>}
                </div>

                {/* New key revealed — show once */}
                {createdKey && (
                    <div style={{ background: 'rgba(0,212,127,0.08)', border: '1px solid rgba(0,212,127,0.25)', borderRadius: '12px', padding: '16px 20px', marginBottom: '24px' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-primary)', fontWeight: 700, marginBottom: '8px' }}>
                            ✓ API Key creada — guárdala ahora, no se mostrará de nuevo
                        </div>
                        <code style={{ fontFamily: 'monospace', fontSize: '0.82rem', wordBreak: 'break-all', color: 'var(--color-text)', background: 'rgba(255,255,255,0.06)', padding: '10px 14px', borderRadius: '8px', display: 'block' }}>
                            {createdKey}
                        </code>
                        <button
                            onClick={() => { navigator.clipboard.writeText(createdKey) }}
                            style={{ marginTop: '10px', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '6px', padding: '5px 12px', fontSize: '0.78rem', color: 'var(--color-text-muted)', cursor: 'pointer' }}
                        >
                            Copiar
                        </button>
                    </div>
                )}

                {/* Keys list */}
                {loadingKeys ? (
                    <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>Cargando keys...</div>
                ) : apiKeys.length === 0 ? (
                    <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>No hay API keys. Crea una para empezar.</div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {apiKeys.map((k, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', border: '1px solid var(--color-border)' }}>
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: '3px' }}>{k.name}</div>
                                    <code style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>{k.key}</code>
                                    {k.webhookUrl && (
                                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '3px' }}>↗ {k.webhookUrl}</div>
                                    )}
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
                                        {k.permissions.map(p => (
                                            <span key={p} style={{ fontSize: '0.68rem', padding: '2px 8px', background: 'rgba(0,212,127,0.1)', borderRadius: '20px', color: 'var(--color-primary)', border: '1px solid rgba(0,212,127,0.2)' }}>{p}</span>
                                        ))}
                                    </div>
                                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                                        {k.lastUsed ? `Último uso: ${new Date(k.lastUsed).toLocaleDateString()}` : 'No usada aún'}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Existing settings */}
            <section className={styles.tableSection} style={{ padding: '32px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                    <div>
                        <h3 style={{ marginBottom: '12px' }}>Verification Thresholds</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '8px' }}>Min. "Passed" Score</label>
                                <input type="number" defaultValue={85} style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', padding: '10px', borderRadius: '8px', color: 'white', width: '100%' }} />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '8px' }}>Flagging Sensitivity</label>
                                <select style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', padding: '10px', borderRadius: '8px', color: 'white', width: '100%' }}>
                                    <option>High (Strict)</option>
                                    <option>Standard</option>
                                    <option>Low (Lax)</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div>
                        <h3 style={{ marginBottom: '12px' }}>Organization Details</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <input type="text" placeholder="Organization Name" defaultValue="Deep-Check" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', padding: '10px', borderRadius: '8px', color: 'white' }} />
                            <input type="email" placeholder="Admin Email" defaultValue="admin@deep-check.io" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', padding: '10px', borderRadius: '8px', color: 'white' }} />
                        </div>
                    </div>

                    <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>Save Changes</button>
                </div>
            </section>
        </div>
    )
}
