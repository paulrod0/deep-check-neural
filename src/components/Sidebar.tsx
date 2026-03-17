'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import styles from './Sidebar.module.css'

export default function Sidebar() {
    const pathname = usePathname()
    const router = useRouter()
    const [signingOut, setSigningOut] = useState(false)

    const navItems: Array<{ label: string; href: string; disabled?: boolean }> = [
        { label: 'Overview', href: '/dashboard' },
        { label: 'Assessments', href: '/dashboard/assessments' },
        { label: 'ML Dashboard', href: '/dashboard/ml' },
        { label: 'Global Benchmarks', href: '/dashboard/benchmarks' },
        { label: '──────────', href: '#', disabled: true },
        { label: 'Team Members', href: '/dashboard/team' },
        { label: 'Settings & Billing', href: '/dashboard/settings' },
        { label: '──────────', href: '#2', disabled: true },
        { label: 'KYC Verification', href: '/documents/verify' },
        { label: 'Document Forensics', href: '/documents' },
        { label: 'Live Interview', href: '/interview' },
        { label: '──────────', href: '#3', disabled: true },
        { label: 'Enrollment', href: '/enroll' },
        { label: 'Verify Certificate', href: '/verify' },
        { label: 'API Docs', href: '/docs' },
        { label: '──────────', href: '#4', disabled: true },
        { label: 'ENS Compliance', href: '/ens' },
        { label: 'ISO 27001 SoA', href: '/iso27001' },
        { label: 'DPIA', href: '/dpia' },
    ]

    async function handleSignOut() {
        setSigningOut(true)
        try {
            await fetch('/api/auth/logout', { method: 'POST' })
            router.push('/auth/login')
        } catch {
            setSigningOut(false)
        }
    }

    return (
        <nav className={styles.sidebar}>
            <div className={styles.logo}>
                <Link href="/">
                    Deep-Check<span style={{ color: 'var(--color-primary)' }}>.</span>
                </Link>
            </div>
            <ul className={styles.navList}>
                {navItems.map((item) => {
                    const isActive = pathname === item.href
                    return (
                        <li key={item.href}>
                            {item.disabled ? (
                                <span className={styles.navItem} style={{ opacity: 0.2, cursor: 'default', fontSize: '0.6rem', letterSpacing: '0.1em' }}>
                                    {item.label}
                                </span>
                            ) : (
                                <Link
                                    href={item.href}
                                    className={`${styles.navItem} ${isActive ? styles.active : ''}`}
                                >
                                    {item.label}
                                </Link>
                            )}
                        </li>
                    )
                })}
            </ul>
            <div className={styles.footer}>
                <button
                    onClick={handleSignOut}
                    disabled={signingOut}
                    style={{
                        background: 'rgba(255,77,77,0.08)',
                        border: '1px solid rgba(255,77,77,0.2)',
                        borderRadius: '6px',
                        padding: '6px 12px',
                        fontSize: '0.78rem',
                        color: '#ff4d4d',
                        cursor: signingOut ? 'wait' : 'pointer',
                        width: '100%',
                        marginBottom: '8px',
                    }}
                >
                    {signingOut ? 'Signing out...' : 'Sign Out'}
                </button>
                <div className={styles.status}>System Active</div>
                <div className={styles.version}>v2.7.0-prod</div>
            </div>
        </nav>
    )
}
