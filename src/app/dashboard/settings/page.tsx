'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import styles from '../page.module.css'

interface ApiKey {
    key: string
    name: string
    createdAt: string
    lastUsed?: string
    active: boolean
    permissions: string[]
    webhookUrl?: string
}

interface BillingData {
    org: {
        id: string
        name: string
        email: string
        plan: string
        planLabel: string
        planStatus: string
        hasApi: boolean
        createdAt: string
    }
    usage: {
        sessionsUsed: number
        sessionsLimit: number
        docsUsed: number
        docsLimit: number
        periodReset: string
    } | null
    billing: {
        hasSubscription: boolean
        customerId: string | null
        subscriptionId: string | null
        billingPortalUrl: string | null
        manageSubscriptionUrl: string | null
    }
    upgradeUrl: string
}

export default function SettingsPage() {
    const router = useRouter()
    const [apiKeys, setApiKeys]         = useState<ApiKey[]>([])
    const [loadingKeys, setLoadingKeys] = useState(false)
    const [newKeyName, setNewKeyName]   = useState('')
    const [newKeyWebhook, setNewKeyWebhook] = useState('')
    const [createdKey, setCreatedKey]   = useState<string | null>(null)
    const [creating, setCreating]       = useState(false)
    const [error, setError]             = useState('')
    const [billing, setBilling]         = useState<BillingData | null>(null)
    const [loadingBilling, setLoadingBilling] = useState(true)
    const [signingOut, setSigningOut]    = useState(false)

    const loadKeys = useCallback(async () => {
        setLoadingKeys(true)
        try {
            const res = await fetch('/api/v1/keys')
            const json = await res.json()
            if (json.success) setApiKeys(json.data)
        } finally {
            setLoadingKeys(false)
        }
    }, [])

    const loadBilling = useCallback(async () => {
        try {
            const res = await fetch('/api/org/billing')
            if (res.ok) {
                const json = await res.json()
                if (json.success) setBilling(json.data)
            }
        } catch {
            // Billing info not available
        } finally {
            setLoadingBilling(false)
        }
    }, [])

    useEffect(() => {
        loadKeys()
        loadBilling()
    }, [loadKeys, loadBilling])

    async function handleCreateKey() {
        if (!newKeyName.trim()) return
        setCreating(true)
        setError('')
        setCreatedKey(null)
        try {
            const res = await fetch('/api/v1/keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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

    async function handleSignOut() {
        setSigningOut(true)
        try {
            await fetch('/api/auth/logout', { method: 'POST' })
            router.push('/auth/login')
        } catch {
            setSigningOut(false)
        }
    }

    const planColors: Record<string, { bg: string; border: string; text: string }> = {
        free:       { bg: 'rgba(161,161,170,0.12)', border: 'rgba(161,161,170,0.25)', text: 'var(--color-text-muted)' },
        starter:    { bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.25)', text: '#60a5fa' },
        pro:        { bg: 'rgba(0,212,127,0.12)', border: 'rgba(0,212,127,0.25)', text: 'var(--color-primary)' },
        enterprise: { bg: 'rgba(255,215,0,0.12)', border: 'rgba(255,215,0,0.25)', text: '#ffd700' },
    }

    return (
        <div className={styles.content}>
            <header className={styles.header}>
                <h1>Settings & <span className="text-gradient">Billing</span></h1>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <Link href="/docs" className="btn btn-outline" style={{ fontSize: '0.85rem', padding: '8px 16px' }}>
                        API Docs
                    </Link>
                    <button
                        onClick={handleSignOut}
                        disabled={signingOut}
                        className="btn btn-outline"
                        style={{ fontSize: '0.85rem', padding: '8px 16px', color: '#ff4d4d', borderColor: 'rgba(255,77,77,0.3)' }}
                    >
                        {signingOut ? 'Signing out...' : 'Sign Out'}
                    </button>
                </div>
            </header>

            {/* Billing & Plan Section */}
            <section className={styles.tableSection} style={{ padding: '32px', marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                    <div>
                        <h3 style={{ marginBottom: '4px' }}>Subscription & Billing</h3>
                        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', margin: 0 }}>
                            Manage your plan, usage, and billing information.
                        </p>
                    </div>
                    {billing && billing.org.plan !== 'enterprise' && (
                        <Link href="/pricing" className="btn btn-primary" style={{ fontSize: '0.85rem', padding: '8px 20px' }}>
                            {billing.org.plan === 'free' ? 'Upgrade' : 'Change Plan'}
                        </Link>
                    )}
                </div>

                {loadingBilling ? (
                    <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>Loading billing info...</div>
                ) : billing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        {/* Plan info cards */}
                        <div style={{
                            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                            gap: '16px',
                        }}>
                            <div style={{
                                padding: '20px', borderRadius: '12px',
                                background: planColors[billing.org.plan]?.bg ?? 'rgba(255,255,255,0.03)',
                                border: `1px solid ${planColors[billing.org.plan]?.border ?? 'var(--color-border)'}`,
                            }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '6px' }}>Current Plan</div>
                                <div style={{
                                    fontSize: '1.3rem', fontWeight: 700,
                                    color: planColors[billing.org.plan]?.text ?? '#fff',
                                }}>
                                    {billing.org.planLabel}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                                    Status: <span style={{
                                        color: billing.org.planStatus === 'active' ? 'var(--color-primary)' : '#ff4d4d',
                                        fontWeight: 600,
                                    }}>{billing.org.planStatus.toUpperCase()}</span>
                                </div>
                            </div>

                            {billing.usage && (
                                <>
                                    <div style={{
                                        padding: '20px', borderRadius: '12px',
                                        background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border)',
                                    }}>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '6px' }}>Sessions This Month</div>
                                        <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>
                                            {billing.usage.sessionsUsed}
                                            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>
                                                {billing.usage.sessionsLimit > 0 ? ` / ${billing.usage.sessionsLimit}` : ' / Unlimited'}
                                            </span>
                                        </div>
                                        {billing.usage.sessionsLimit > 0 && (
                                            <div style={{ marginTop: '8px', height: '4px', background: 'var(--color-border)', borderRadius: '2px', overflow: 'hidden' }}>
                                                <div style={{
                                                    height: '100%', borderRadius: '2px',
                                                    width: `${Math.min(100, (billing.usage.sessionsUsed / billing.usage.sessionsLimit) * 100)}%`,
                                                    background: billing.usage.sessionsUsed >= billing.usage.sessionsLimit ? '#ff4d4d' : 'var(--color-primary)',
                                                }} />
                                            </div>
                                        )}
                                    </div>

                                    <div style={{
                                        padding: '20px', borderRadius: '12px',
                                        background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border)',
                                    }}>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '6px' }}>Document Analyses</div>
                                        <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>
                                            {billing.usage.docsUsed}
                                            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>
                                                {billing.usage.docsLimit > 0 ? ` / ${billing.usage.docsLimit}` : ' / Unlimited'}
                                            </span>
                                        </div>
                                        {billing.usage.docsLimit > 0 && (
                                            <div style={{ marginTop: '8px', height: '4px', background: 'var(--color-border)', borderRadius: '2px', overflow: 'hidden' }}>
                                                <div style={{
                                                    height: '100%', borderRadius: '2px',
                                                    width: `${Math.min(100, (billing.usage.docsUsed / billing.usage.docsLimit) * 100)}%`,
                                                    background: billing.usage.docsUsed >= billing.usage.docsLimit ? '#ff4d4d' : 'var(--color-primary)',
                                                }} />
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Billing actions */}
                        {billing.billing.hasSubscription && (
                            <div style={{
                                padding: '16px 20px', borderRadius: '10px',
                                background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border)',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px',
                            }}>
                                <div>
                                    <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '2px' }}>Subscription Management</div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                                        Update payment method, download invoices, or cancel subscription.
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    {billing.billing.manageSubscriptionUrl && (
                                        <a
                                            href={billing.billing.manageSubscriptionUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="btn btn-outline"
                                            style={{ fontSize: '0.82rem', padding: '8px 16px', textDecoration: 'none' }}
                                        >
                                            Manage Subscription
                                        </a>
                                    )}
                                    {billing.billing.billingPortalUrl && (
                                        <a
                                            href={billing.billing.billingPortalUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="btn btn-outline"
                                            style={{ fontSize: '0.82rem', padding: '8px 16px', textDecoration: 'none' }}
                                        >
                                            Billing Portal
                                        </a>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Usage reset */}
                        {billing.usage?.periodReset && (
                            <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                                Usage resets on {new Date(billing.usage.periodReset).toLocaleDateString('en-US', {
                                    year: 'numeric', month: 'long', day: 'numeric'
                                })}
                            </div>
                        )}
                    </div>
                ) : (
                    <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                        No billing information available. <Link href="/pricing" style={{ color: 'var(--color-primary)' }}>View pricing</Link>
                    </div>
                )}
            </section>

            {/* API Keys section */}
            <section className={styles.tableSection} style={{ padding: '32px', marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                    <div>
                        <h3 style={{ marginBottom: '4px' }}>API Keys</h3>
                        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', margin: 0 }}>
                            Connect external platforms (Moodle, Canvas, ATS) to Deep-Check via REST API.
                        </p>
                    </div>
                    <Link href="/docs" style={{ fontSize: '0.8rem', color: 'var(--color-primary)', textDecoration: 'none' }}>Documentation</Link>
                </div>

                {/* Create new key */}
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '20px', marginBottom: '24px' }}>
                    <h4 style={{ marginBottom: '16px', fontSize: '0.9rem' }}>New API Key</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: '6px' }}>Name (e.g. &quot;Moodle - University XYZ&quot;)</label>
                            <input
                                value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
                                placeholder="Integration name"
                                style={{ width: '100%', padding: '10px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '8px', color: 'white', fontSize: '0.88rem', boxSizing: 'border-box' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: '6px' }}>Webhook URL (optional)</label>
                            <input
                                value={newKeyWebhook} onChange={e => setNewKeyWebhook(e.target.value)}
                                placeholder="https://your-platform.com/webhook"
                                style={{ width: '100%', padding: '10px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '8px', color: 'white', fontSize: '0.88rem', boxSizing: 'border-box' }}
                            />
                        </div>
                    </div>
                    <button
                        className="btn btn-primary" onClick={handleCreateKey}
                        disabled={!newKeyName.trim() || creating}
                        style={{ fontSize: '0.85rem', padding: '8px 20px' }}
                    >
                        {creating ? 'Creating...' : '+ Create Key'}
                    </button>
                    {error && <p style={{ color: '#ff4d4d', fontSize: '0.82rem', marginTop: '8px' }}>{error}</p>}
                </div>

                {/* New key revealed */}
                {createdKey && (
                    <div style={{ background: 'rgba(0,212,127,0.08)', border: '1px solid rgba(0,212,127,0.25)', borderRadius: '12px', padding: '16px 20px', marginBottom: '24px' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-primary)', fontWeight: 700, marginBottom: '8px' }}>
                            API Key created — save it now, it won&apos;t be shown again
                        </div>
                        <code style={{ fontFamily: 'monospace', fontSize: '0.82rem', wordBreak: 'break-all', color: 'var(--color-text)', background: 'rgba(255,255,255,0.06)', padding: '10px 14px', borderRadius: '8px', display: 'block' }}>
                            {createdKey}
                        </code>
                        <button
                            onClick={() => { navigator.clipboard.writeText(createdKey) }}
                            style={{ marginTop: '10px', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '6px', padding: '5px 12px', fontSize: '0.78rem', color: 'var(--color-text-muted)', cursor: 'pointer' }}
                        >
                            Copy
                        </button>
                    </div>
                )}

                {/* Keys list */}
                {loadingKeys ? (
                    <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>Loading keys...</div>
                ) : apiKeys.length === 0 ? (
                    <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>No API keys yet. Create one to get started.</div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {apiKeys.map((k, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', border: '1px solid var(--color-border)' }}>
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: '3px' }}>{k.name}</div>
                                    <code style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>{k.key}</code>
                                    {k.webhookUrl && (
                                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '3px' }}>Webhook: {k.webhookUrl}</div>
                                    )}
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
                                        {k.permissions.map(p => (
                                            <span key={p} style={{ fontSize: '0.68rem', padding: '2px 8px', background: 'rgba(0,212,127,0.1)', borderRadius: '20px', color: 'var(--color-primary)', border: '1px solid rgba(0,212,127,0.2)' }}>{p}</span>
                                        ))}
                                    </div>
                                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                                        {k.lastUsed ? `Last used: ${new Date(k.lastUsed).toLocaleDateString()}` : 'Not used yet'}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Verification Settings */}
            <section className={styles.tableSection} style={{ padding: '32px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                    <div>
                        <h3 style={{ marginBottom: '12px' }}>Verification Thresholds</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '8px' }}>Min. &quot;Passed&quot; Score</label>
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
                            <input
                                type="text" placeholder="Organization Name"
                                defaultValue={billing?.org.name ?? 'Deep-Check'}
                                style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', padding: '10px', borderRadius: '8px', color: 'white' }}
                            />
                            <input
                                type="email" placeholder="Admin Email"
                                defaultValue={billing?.org.email ?? ''}
                                style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', padding: '10px', borderRadius: '8px', color: 'white' }}
                            />
                        </div>
                    </div>

                    <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>Save Changes</button>
                </div>
            </section>
        </div>
    )
}
