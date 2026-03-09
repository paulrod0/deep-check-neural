'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import styles from './page.module.css'

export default function InvestmentDeck() {
    const [activeSlide, setActiveSlide] = useState(0)

    useEffect(() => {
        const handleScroll = (e: Event) => {
            const slideHeight = window.innerHeight
            const index = Math.round(e.target.scrollTop / slideHeight)
            setActiveSlide(index)
        }

        const container = document.getElementById('deck-container')
        container?.addEventListener('scroll', handleScroll)
        return () => container?.removeEventListener('scroll', handleScroll)
    }, [])

    return (
        <main id="deck-container" className={styles.container}>
            {/* Slide 1: Cover */}
            <section className={styles.slide}>
                <div className={styles.content}>
                    <span className={styles.tag}>Series Seed // 2026</span>
                    <h1 className={styles.title}>Deep-Check<span className="text-gradient">.</span></h1>
                    <p className={styles.subtitle}>Restoring the Architecture of Trust in a World of Generative AI and Remote Fraud.</p>
                    <div style={{ display: 'flex', gap: '16px', marginTop: '40px' }}>
                        <a href="#problem" className="btn btn-primary">The Vision</a>
                        <Link href="/" className="btn btn-outline">Exit Pitch</Link>
                    </div>
                </div>
            </section>

            {/* Slide 2: The Problem */}
            <section id="problem" className={styles.slide}>
                <div className={styles.content}>
                    <span className={styles.tag}>The Problem</span>
                    <h2 className={styles.title} style={{ fontSize: '3.5rem' }}>Remote Hiring is <span style={{ color: '#ff4d4d' }}>Broken.</span></h2>
                    <div className={styles.grid}>
                        <div className={styles.card}>
                            <div className={styles.bigStat}>17%</div>
                            <div className={styles.statLabel}>Of hiring managers reported encountering deepfake proxy candidates in 2024.</div>
                        </div>
                        <div className={styles.card}>
                            <div className={styles.bigStat}>1,300%</div>
                            <div className={styles.statLabel}>Year-over-year increase in Deepfake-powered fraud attempts (2024).</div>
                        </div>
                        <div className={styles.card}>
                            <div className={styles.bigStat}>25%</div>
                            <div className={styles.statLabel}>Of all candidate profiles will be fake by 2028 per Gartner projections.</div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Slide 3: The Solution */}
            <section className={styles.slide} style={{ background: '#050505' }}>
                <div className={styles.content}>
                    <span className={styles.tag}>The Solution</span>
                    <h2 className={styles.title} style={{ fontSize: '3.5rem' }}>Continuous <span className="text-gradient">Verification.</span></h2>
                    <p className={styles.subtitle}>Deep-Check doesn&apos;t just verify at the gates. We monitor behavior, biometrics, and code integrity throughout the entire lifecycle.</p>
                    <div className={styles.grid}>
                        <div className={styles.card}>
                            <h3>Liveness Signature</h3>
                            <p style={{ opacity: 0.6 }}>Continuous facial landmark analysis to eliminate deepfakes.</p>
                        </div>
                        <div className={styles.card}>
                            <h3>Typing DNA</h3>
                            <p style={{ opacity: 0.6 }}>Keystroke forensics to detect external proxy coders.</p>
                        </div>
                        <div className={styles.card}>
                            <h3>Forensic Proof</h3>
                            <p style={{ opacity: 0.6 }}>Automated evidence capture for undeniable audit trails.</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Slide 4: Behavioral Biometrics */}
            <section className={styles.slide}>
                <div className={styles.content}>
                    <span className={styles.tag}>Technology</span>
                    <h2 className={styles.title} style={{ fontSize: '3.5rem' }}>Behavioral <span className="text-gradient">Biometrics.</span></h2>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '60px', alignItems: 'center' }}>
                        <div>
                            <p className={styles.subtitle}>Our proprietary Z-Score algorithm monitors the unique rhythm of a candidate&apos;s interaction.</p>
                            <ul style={{ listStyle: 'none', padding: 0, marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <li style={{ display: 'flex', gap: '12px' }}>
                                    <span style={{ color: 'var(--color-primary)' }}>✓</span> Flight-time consistency analysis
                                </li>
                                <li style={{ display: 'flex', gap: '12px' }}>
                                    <span style={{ color: 'var(--color-primary)' }}>✓</span> Gaze divergence tracking
                                </li>
                                <li style={{ display: 'flex', gap: '12px' }}>
                                    <span style={{ color: 'var(--color-primary)' }}>✓</span> Multi-screen heuristic detection
                                </li>
                            </ul>
                        </div>
                        <div className={styles.card} style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: '0.8rem', opacity: 0.5, marginBottom: '20px' }}>LIVE BIOMETRIC FEED</div>
                                <div style={{ display: 'flex', gap: '4px', height: '100px', alignItems: 'flex-end' }}>
                                    {[0.4, 0.7, 0.2, 0.9, 0.5, 0.8, 0.3, 0.6, 0.4, 0.7].map((h, i) => (
                                        <div key={i} style={{ width: '8px', height: `${h * 100}%`, background: 'var(--color-primary)', borderRadius: '4px', opacity: 0.3 + (i * 0.07) }}></div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Slide 5: The Market */}
            <section className={styles.slide}>
                <div className={styles.content}>
                    <span className={styles.tag}>The Market</span>
                    <h2 className={styles.title}>$200B+ <br /> <span className="text-gradient">Total Addressable.</span></h2>
                    <p className={styles.subtitle}>Direct integration into the USD 200B global tech recruitment engine. Projected to reach $416B by 2035.</p>
                    <div className={styles.grid}>
                        <div className={styles.card}>
                            <h3>41%</h3>
                            <p style={{ opacity: 0.6 }}>Of all code written in 2024 was AI-generated, creating an &quot;Engineered Trust&quot; vacuum.</p>
                        </div>
                        <div className={styles.card}>
                            <h3>$16.6B</h3>
                            <p style={{ opacity: 0.6 }}>Record fraud losses reported to FBI IC3 in 2024, driving urgent demand for security.</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Slide 6: Roadmap */}
            <section className={styles.slide} style={{ background: '#050505' }}>
                <div className={styles.content}>
                    <span className={styles.tag}>Roadmap</span>
                    <h2 className={styles.title} style={{ fontSize: '3.5rem' }}>scaling the <span className="text-gradient">Future.</span></h2>
                    <div className={styles.grid}>
                        <div className={styles.card}>
                            <h4 style={{ color: 'var(--color-primary)' }}>Q1 2026</h4>
                            <p>MVP Launch + Forensic evidence system.</p>
                        </div>
                        <div className={styles.card}>
                            <h4 style={{ color: 'var(--color-primary)' }}>Q2 2026</h4>
                            <p>Edge Biometrics + Multi-monitor hardware guard.</p>
                        </div>
                        <div className={styles.card}>
                            <h4 style={{ color: 'var(--color-primary)' }}>Q3 2026</h4>
                            <p>ATS Integrations (Greenhouse, Lever) + Scaling.</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Slide 7: Contact */}
            <section className={styles.slide}>
                <div className={styles.content} style={{ textAlign: 'center', alignItems: 'center' }}>
                    <span className={styles.tag}>Get in touch</span>
                    <h2 className={styles.title}>Secure the <br /> <span className="text-gradient">Next Hire.</span></h2>
                    <p className={styles.subtitle}>Join us in rebuilding trust. We are now opening our Seed round to strategic partners.</p>
                    <div style={{ marginTop: '40px' }}>
                        <a href="mailto:pablo@hiumsolutions.com" className="btn btn-primary">pablo@hiumsolutions.com</a>
                    </div>
                </div>
            </section>

            {/* Deck Controls */}
            <div className={styles.footer}>
                <div className={styles.dots}>
                    {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                        <div key={i} className={`${styles.dot} ${activeSlide === i ? styles.activeDot : ''}`}></div>
                    ))}
                </div>
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                    Deep-Check // Confidential IP 2026
                </div>
            </div>
        </main>
    )
}
