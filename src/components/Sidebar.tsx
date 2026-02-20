'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './Sidebar.module.css'

export default function Sidebar() {
    const pathname = usePathname()

    const navItems = [
        { label: 'Overview', href: '/dashboard' },
        { label: 'Assessments', href: '/dashboard/assessments' },
        { label: 'Global Benchmarks', href: '/dashboard/benchmarks' },
        { label: 'Account Settings', href: '/dashboard/settings' },
        { label: '──────────', href: '#', disabled: true },
        { label: '⬡ Enrollment', href: '/enroll' },
        { label: '⬡ API Docs', href: '/docs' },
    ]

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
                            {(item as any).disabled ? (
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
                <div className={styles.status}>System Active</div>
                <div className={styles.version}>v2.6.4-prod</div>
            </div>
        </nav>
    )
}
