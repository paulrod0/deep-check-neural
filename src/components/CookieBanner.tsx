'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import styles from './CookieBanner.module.css'

const STORAGE_KEY = 'dc_cookie_consent_v1'

export type ConsentChoice = 'accepted' | 'declined' | null

export default function CookieBanner() {
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (!stored) setVisible(true)
    }, [])

    const handleChoice = (choice: 'accepted' | 'declined') => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ choice, ts: Date.now() }))
        setVisible(false)
    }

    if (!visible) return null

    return (
        <div className={styles.banner} role="dialog" aria-label="Cookie consent">
            <div className={styles.content}>
                <div className={styles.text}>
                    <p className={styles.title}>Cookies &amp; Privacy</p>
                    <p className={styles.desc}>
                        We use only technically necessary cookies (session state). No tracking
                        or advertising cookies. Biometric data is processed locally in your
                        browser and is never sold.{' '}
                        <Link href="/privacy" className={styles.link}>Privacy Policy</Link>
                    </p>
                </div>
                <div className={styles.actions}>
                    <button
                        className={styles.btnDecline}
                        onClick={() => handleChoice('declined')}
                    >
                        Decline optional
                    </button>
                    <button
                        className={styles.btnAccept}
                        onClick={() => handleChoice('accepted')}
                    >
                        Accept necessary
                    </button>
                </div>
            </div>
        </div>
    )
}
