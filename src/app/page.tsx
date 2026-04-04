'use client'

import { useState, FormEvent } from 'react'
import Link from 'next/link'
import { useLanguage, LanguageToggle } from '@/lib/i18n'
import styles from './page.module.css'

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://deep-check-two.vercel.app/#organization',
      name: 'Deep-Check',
      url: 'https://deep-check-two.vercel.app',
      logo: {
        '@type': 'ImageObject',
        url: 'https://deep-check-two.vercel.app/icons/icon-512.png',
        width: 512,
        height: 512,
      },
      description: 'AI-powered identity verification and deepfake detection platform. Privacy-first: all biometric processing runs client-side in the browser.',
      foundingDate: '2024',
      founders: [{ '@type': 'Person', name: 'Pablo Lopez Rodriguez' }],
      address: {
        '@type': 'PostalAddress',
        addressRegion: 'Andalucia',
        addressCountry: 'ES',
      },
      contactPoint: {
        '@type': 'ContactPoint',
        email: 'hello@deep-check.io',
        contactType: 'customer support',
      },
      sameAs: [],
    },
    {
      '@type': 'SoftwareApplication',
      '@id': 'https://deep-check-two.vercel.app/#software',
      name: 'Deep-Check',
      applicationCategory: 'SecurityApplication',
      operatingSystem: 'Web',
      url: 'https://deep-check-two.vercel.app',
      description: 'Continuous identity verification with 6-layer deepfake detection. Runs entirely in the browser using ONNX Runtime WebAssembly. Privacy-first, GDPR compliant.',
      offers: [
        { '@type': 'Offer', price: '0', priceCurrency: 'USD', name: 'Free', description: '10 verification sessions per month' },
        { '@type': 'Offer', price: '29', priceCurrency: 'USD', name: 'Starter', description: '50 verification sessions per month' },
        { '@type': 'Offer', price: '79', priceCurrency: 'USD', name: 'Pro', description: 'Unlimited verification sessions' },
      ],
      featureList: [
        '6-Layer Deepfake Detection',
        'Behavioral Biometrics (Keystroke Dynamics)',
        'Document Forensics (ELA, EXIF, AI Detection)',
        'Browser-Side Inference (Zero Server Data)',
        'rPPG Heartbeat Signal Analysis',
        'GDPR & EU AI Act Compliant',
      ],
      screenshot: 'https://deep-check-two.vercel.app/icons/icon-512.png',
      provider: { '@id': 'https://deep-check-two.vercel.app/#organization' },
    },
    {
      '@type': 'WebSite',
      '@id': 'https://deep-check-two.vercel.app/#website',
      url: 'https://deep-check-two.vercel.app',
      name: 'Deep-Check',
      description: 'AI-Powered Identity Verification & Deepfake Detection',
      publisher: { '@id': 'https://deep-check-two.vercel.app/#organization' },
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: 'https://deep-check-two.vercel.app/?q={search_term_string}' },
        'query-input': 'required name=search_term_string',
      },
    },
  ],
}


export default function Home() {
  const { t } = useLanguage()
  const [email, setEmail] = useState('')
  const [waitlistStatus, setWaitlistStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [waitlistMsg, setWaitlistMsg] = useState('')

  const marqueeItemsT = [
    t('marquee.iso'), t('marquee.auc'), t('marquee.eer'), t('marquee.gdpr'),
    t('marquee.euAiAct'), t('marquee.clientSide'), t('marquee.zeroStorage'),
    t('marquee.sixLayers'), t('marquee.countries'), t('marquee.onnx'),
    t('marquee.privacy'), t('marquee.continuous'),
  ]

  const comparisonRowsT: [string, string, string, 'check' | 'cross' | 'warn', 'check' | 'cross' | 'warn'][] = [
    [t('comparison.row01cap'), t('comparison.row01dc'), t('comparison.row01onf'), 'check', 'check'],
    [t('comparison.row02cap'), t('comparison.row02dc'), t('comparison.row02onf'), 'check', 'cross'],
    [t('comparison.row03cap'), t('comparison.row03dc'), t('comparison.row03onf'), 'check', 'warn'],
    [t('comparison.row04cap'), t('comparison.row04dc'), t('comparison.row04onf'), 'check', 'cross'],
    [t('comparison.row05cap'), t('comparison.row05dc'), t('comparison.row05onf'), 'check', 'cross'],
    [t('comparison.row06cap'), t('comparison.row06dc'), t('comparison.row06onf'), 'check', 'cross'],
    [t('comparison.row07cap'), t('comparison.row07dc'), t('comparison.row07onf'), 'check', 'warn'],
    [t('comparison.row08cap'), t('comparison.row08dc'), t('comparison.row08onf'), 'check', 'cross'],
    [t('comparison.row09cap'), t('comparison.row09dc'), t('comparison.row09onf'), 'check', 'cross'],
    [t('comparison.row10cap'), t('comparison.row10dc'), t('comparison.row10onf'), 'check', 'cross'],
    [t('comparison.row11cap'), t('comparison.row11dc'), t('comparison.row11onf'), 'check', 'warn'],
  ]

  async function handleWaitlist(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setWaitlistStatus('loading')
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        setWaitlistStatus('success')
        setWaitlistMsg(data.message || t('waitlist.fallbackSuccess'))
        setEmail('')
      } else {
        setWaitlistStatus('error')
        setWaitlistMsg(data.error || t('waitlist.fallbackError'))
      }
    } catch {
      setWaitlistStatus('error')
      setWaitlistMsg(t('waitlist.networkError'))
    }
  }

  const markClass = (t: 'check' | 'cross' | 'warn') =>
    t === 'check' ? styles.checkMark : t === 'warn' ? styles.warnMark : styles.crossMark

  return (
    <main className={styles.main}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* ═══ Navigation ═══ */}
      <nav className={styles.nav}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className={styles.logo}>Deep-Check<span style={{ color: 'var(--color-primary)' }}>.</span></div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div className="dropdown" style={{ position: 'relative' }}>
              <button style={{
                background: 'none', border: '1px solid rgba(255,255,255,0.1)',
                color: 'var(--color-text-muted)', fontSize: '0.85rem', padding: '7px 14px',
                borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem',
                transition: 'border-color 0.2s',
              }}>
                {t('nav.products')} <span style={{ fontSize: '0.6rem', opacity: 0.5 }}>&#9662;</span>
              </button>
              <div className="dropdown-menu" style={{
                position: 'absolute', top: '100%', right: 0, marginTop: '0.5rem',
                background: '#111114', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '14px', padding: '6px', minWidth: '240px',
                opacity: 0, pointerEvents: 'none', transform: 'translateY(-8px)',
                transition: 'all 0.2s ease', zIndex: 100,
                boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
              }}>
                <div style={{ padding: '6px 12px 4px', fontSize: '0.62rem', fontWeight: 700, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('nav.verification')}</div>
                <Link href="/interview" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '8px 12px', color: '#fff', textDecoration: 'none', borderRadius: '8px', fontSize: '0.82rem', transition: 'background 0.15s' }}>
                  <span style={{ width: 20, height: 20, borderRadius: 6, background: 'rgba(0,255,157,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', color: 'var(--color-primary)' }}>V</span>
                  {t('nav.liveVerification')}
                </Link>
                <Link href="/amireal" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '8px 12px', color: '#fff', textDecoration: 'none', borderRadius: '8px', fontSize: '0.82rem', transition: 'background 0.15s' }}>
                  <span style={{ width: 20, height: 20, borderRadius: 6, background: 'rgba(0,255,157,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', color: 'var(--color-primary)' }}>R</span>
                  {t('nav.amIReal')}
                </Link>
                <Link href="/trustmyprofile" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '8px 12px', color: '#fff', textDecoration: 'none', borderRadius: '8px', fontSize: '0.82rem', transition: 'background 0.15s' }}>
                  <span style={{ width: 20, height: 20, borderRadius: 6, background: 'rgba(0,255,157,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', color: 'var(--color-primary)' }}>T</span>
                  {t('nav.trustMyProfile')}
                </Link>

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', margin: '4px 0' }} />
                <div style={{ padding: '6px 12px 4px', fontSize: '0.62rem', fontWeight: 700, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('nav.safety')}</div>
                <Link href="/datesafe" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '8px 12px', color: '#fff', textDecoration: 'none', borderRadius: '8px', fontSize: '0.82rem', transition: 'background 0.15s' }}>
                  <span style={{ width: 20, height: 20, borderRadius: 6, background: 'rgba(255,100,150,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', color: '#ff6496' }}>D</span>
                  {t('nav.dateSafe')}
                </Link>
                <Link href="/resumeguard" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '8px 12px', color: '#fff', textDecoration: 'none', borderRadius: '8px', fontSize: '0.82rem', transition: 'background 0.15s' }}>
                  <span style={{ width: 20, height: 20, borderRadius: 6, background: 'rgba(100,150,255,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', color: '#6496ff' }}>R</span>
                  {t('nav.resumeGuard')}
                </Link>
                <Link href="/listingcheck" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '8px 12px', color: '#fff', textDecoration: 'none', borderRadius: '8px', fontSize: '0.82rem', transition: 'background 0.15s' }}>
                  <span style={{ width: 20, height: 20, borderRadius: 6, background: 'rgba(255,200,50,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', color: '#ffc832' }}>L</span>
                  {t('nav.listingCheck')}
                </Link>

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', margin: '4px 0' }} />
                <div style={{ padding: '6px 12px 4px', fontSize: '0.62rem', fontWeight: 700, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('nav.documents')}</div>
                <Link href="/docsafe" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '8px 12px', color: '#fff', textDecoration: 'none', borderRadius: '8px', fontSize: '0.82rem', transition: 'background 0.15s' }}>
                  <span style={{ width: 20, height: 20, borderRadius: 6, background: 'rgba(0,207,255,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', color: '#00cfff' }}>D</span>
                  {t('nav.docSafe')}
                </Link>
                <Link href="/proofshot" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '8px 12px', color: '#fff', textDecoration: 'none', borderRadius: '8px', fontSize: '0.82rem', transition: 'background 0.15s' }}>
                  <span style={{ width: 20, height: 20, borderRadius: 6, background: 'rgba(0,207,255,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', color: '#00cfff' }}>P</span>
                  {t('nav.proofShot')}
                </Link>

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', margin: '4px 0' }} />
                <div style={{ padding: '6px 12px 4px', fontSize: '0.62rem', fontWeight: 700, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('nav.developer')}</div>
                <Link href="/docs" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '8px 12px', color: 'var(--color-text-muted)', textDecoration: 'none', borderRadius: '8px', fontSize: '0.78rem', transition: 'background 0.15s' }}>
                  <span style={{ width: 20, height: 20, borderRadius: 6, background: 'rgba(255,255,255,0.05)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)' }}>/</span>
                  {t('nav.apiDocs')}
                </Link>
                <Link href="/enroll" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '8px 12px', color: 'var(--color-text-muted)', textDecoration: 'none', borderRadius: '8px', fontSize: '0.78rem', transition: 'background 0.15s' }}>
                  <span style={{ width: 20, height: 20, borderRadius: 6, background: 'rgba(255,255,255,0.05)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)' }}>B</span>
                  {t('nav.biometricEnrollment')}
                </Link>
              </div>
              <style>{`
                .dropdown:hover .dropdown-menu,
                .dropdown:focus-within .dropdown-menu {
                  opacity: 1 !important;
                  pointer-events: auto !important;
                  transform: translateY(0) !important;
                }
                .dropdown-menu a:hover {
                  background: rgba(255, 255, 255, 0.04) !important;
                }
              `}</style>
            </div>
            <a href="#vs-onfido" style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', textDecoration: 'none' }}>{t('nav.vsOnfido')}</a>
            <LanguageToggle />
            <Link href="/pricing" className="btn btn-primary" style={{ padding: '8px 18px', fontSize: '0.85rem' }}>{t('nav.seePlans')}</Link>
          </div>
        </div>
      </nav>

      {/* ═══ Hero ═══ */}
      <section className={styles.hero}>
        <div className="container">
          <div className={styles.heroGrid}>
            <div className={styles.heroContent}>
              <div className={styles.badge}>
                <span className={styles.badgeDot} />
                {t('hero.badge')}
              </div>
              <h1 className={styles.title}>
                {t('hero.titleLine1')}<br />
                <span className="text-gradient">{t('hero.titleLine2')}</span>
                <span className={styles.titleThin}>
                  {t('hero.titleThin')}
                </span>
              </h1>
              <p className={styles.subtitle} dangerouslySetInnerHTML={{
                __html: t('hero.subtitle').replace(
                  '<highlight>',
                  `<span class="${styles.subtitleHighlight}">`
                ).replace('</highlight>', '</span>')
              }} />
              <div className={styles.ctaGroup}>
                <Link href="/interview" className="btn btn-primary">{t('hero.tryDemo')}</Link>
                <Link href="/pricing" className="btn btn-outline">{t('hero.seePricing')}</Link>
              </div>
              <p className={styles.ctaNote}>{t('hero.ctaNote')}</p>
            </div>

            <div className={styles.heroVisual}>
              <div className={styles.scannerRing} />
              <div className={styles.scannerRing} />
              <div className={styles.scannerRing} />
              <div className={styles.scannerFrame}>
                <div className={styles.scannerCorner} />
                <div className={styles.scannerCorner} />
                <div className={styles.scannerCorner} />
                <div className={styles.scannerCorner} />
                <div className={styles.scanLine} />
                <div className={styles.scannerLayers}>
                  <div className={styles.scannerLayerRow}><span className={styles.layerDot} /> {t('scanner.rppg')}</div>
                  <div className={styles.scannerLayerRow}><span className={styles.layerDot} /> {t('scanner.facs')}</div>
                  <div className={styles.scannerLayerRow}><span className={styles.layerDot} /> {t('scanner.efficientNet')}</div>
                  <div className={styles.scannerLayerRow}><span className={styles.layerDot} /> {t('scanner.cnn')}</div>
                  <div className={styles.scannerLayerRow}><span className={styles.layerDot} /> {t('scanner.keystroke')}</div>
                  <div className={styles.scannerLayerRow}><span className={styles.layerDot} /> {t('scanner.session')}</div>
                </div>
                <div className={styles.scannerLabel}>{t('scanner.label')}</div>
              </div>
            </div>
          </div>
        </div>
        <div className={styles.glow} style={{ top: '-15%', left: '10%', background: 'var(--color-secondary)' }} />
        <div className={styles.glow} style={{ top: '50%', right: '5%', background: 'var(--color-primary)' }} />
      </section>

      {/* ═══ Trust Marquee ═══ */}
      <section className={styles.marqueeSection}>
        <div className={`${styles.marqueeFade} ${styles.marqueeFadeLeft}`} />
        <div className={`${styles.marqueeFade} ${styles.marqueeFadeRight}`} />
        <div className={styles.marqueeTrack}>
          {[...marqueeItemsT, ...marqueeItemsT].map((item, i) => (
            <span key={i} className={styles.marqueeItem}>
              <span className={styles.marqueeDivider}>&#9670;</span>
              {item}
            </span>
          ))}
        </div>
      </section>

      {/* ═══ Metrics ═══ */}
      <section className={styles.metricsSection}>
        <div className="container">
          <div className={styles.metricsRow}>
            <div className={styles.metricItem}>
              <div className={styles.metricValue}>{t('metrics.eerValue')}</div>
              <div className={styles.metricLabel}>{t('metrics.eerLabel')}</div>
              <div className={styles.metricSubLabel}>{t('metrics.eerSub')}</div>
            </div>
            <div className={styles.metricItem}>
              <div className={styles.metricValue}>{t('metrics.aucValue')}</div>
              <div className={styles.metricLabel}>{t('metrics.aucLabel')}</div>
              <div className={styles.metricSubLabel}>{t('metrics.aucSub')}</div>
            </div>
            <div className={styles.metricItem}>
              <div className={styles.metricValue}>{t('metrics.layersValue')}</div>
              <div className={styles.metricLabel}>{t('metrics.layersLabel')}</div>
              <div className={styles.metricSubLabel}>{t('metrics.layersSub')}</div>
            </div>
            <div className={styles.metricItem}>
              <div className={styles.metricValue}>{t('metrics.dataValue')}</div>
              <div className={styles.metricLabel}>{t('metrics.dataLabel')}</div>
              <div className={styles.metricSubLabel}>{t('metrics.dataSub')}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ How It Works ═══ */}
      <section className={styles.howSection}>
        <div className="container">
          <div className={styles.howHeader}>
            <div className={styles.sectionEyebrow}>{t('howItWorks.eyebrow')}</div>
            <h2 className={styles.sectionHeading} dangerouslySetInnerHTML={{ __html: t('howItWorks.heading') }} />
            <p className={styles.sectionSubhead}>
              {t('howItWorks.subhead')}
            </p>
          </div>
          <div className={styles.stepsGrid}>
            <div className={styles.stepItem}>
              <div className={styles.stepNumber}><span className={styles.stepNumberLine} /> {t('howItWorks.step01')}</div>
              <h3 className={styles.stepTitle}>{t('howItWorks.step01Title')}</h3>
              <p className={styles.stepDesc}>{t('howItWorks.step01Desc')}</p>
            </div>
            <div className={styles.stepItem}>
              <div className={styles.stepNumber}><span className={styles.stepNumberLine} /> {t('howItWorks.step02')}</div>
              <h3 className={styles.stepTitle}>{t('howItWorks.step02Title')}</h3>
              <p className={styles.stepDesc}>{t('howItWorks.step02Desc')}</p>
            </div>
            <div className={styles.stepItem}>
              <div className={styles.stepNumber}><span className={styles.stepNumberLine} /> {t('howItWorks.step03')}</div>
              <h3 className={styles.stepTitle}>{t('howItWorks.step03Title')}</h3>
              <p className={styles.stepDesc}>{t('howItWorks.step03Desc')}</p>
            </div>
            <div className={styles.stepItem}>
              <div className={styles.stepNumber}><span className={styles.stepNumberLine} /> {t('howItWorks.step04')}</div>
              <h3 className={styles.stepTitle}>{t('howItWorks.step04Title')}</h3>
              <p className={styles.stepDesc}>{t('howItWorks.step04Desc')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Feature Showcase (Bento Grid) ═══ */}
      <section id="how" className={styles.features}>
        <div className="container">
          <div className={styles.howHeader}>
            <div className={styles.sectionEyebrow}>{t('detectionStack.eyebrow')}</div>
            <h2 className={styles.sectionHeading}>{t('detectionStack.heading')}</h2>
            <p className={styles.sectionSubhead}>{t('detectionStack.subhead')}</p>
          </div>

          <div className={styles.featureShowcase}>
            <div className={styles.featureRow}>
              <div className={`${styles.featureCell} ${styles.featureCellWide}`}>
                <div className={styles.featureAccent} />
                <div className={styles.featureIcon}>rP</div>
                <h3 className={styles.featureCellTitle}>{t('detectionStack.rppgTitle')}</h3>
                <p className={styles.featureCellDesc}>{t('detectionStack.rppgDesc')}</p>
              </div>
              <div className={styles.featureCell}>
                <div className={styles.featureAccent} />
                <div className={styles.featureIcon}>Bk</div>
                <h3 className={styles.featureCellTitle}>{t('detectionStack.keystrokeTitle')}</h3>
                <p className={styles.featureCellDesc}>{t('detectionStack.keystrokeDesc')}</p>
              </div>
            </div>
            <div className={styles.featureRow}>
              <div className={styles.featureCell}>
                <div className={styles.featureAccent} />
                <div className={styles.featureIcon}>FA</div>
                <h3 className={styles.featureCellTitle}>{t('detectionStack.facsTitle')}</h3>
                <p className={styles.featureCellDesc}>{t('detectionStack.facsDesc')}</p>
              </div>
              <div className={`${styles.featureCell} ${styles.featureCellWide}`}>
                <div className={styles.featureAccent} />
                <div className={styles.featureIcon}>B4</div>
                <h3 className={styles.featureCellTitle}>{t('detectionStack.efficientNetTitle')}</h3>
                <p className={styles.featureCellDesc}>{t('detectionStack.efficientNetDesc')}</p>
              </div>
            </div>
            <div className={styles.featureRow}>
              <div className={styles.featureCell}>
                <div className={styles.featureAccent} />
                <div className={styles.featureIcon}>Cv</div>
                <h3 className={styles.featureCellTitle}>{t('detectionStack.cnnTitle')}</h3>
                <p className={styles.featureCellDesc}>{t('detectionStack.cnnDesc')}</p>
              </div>
              <div className={styles.featureCell}>
                <div className={styles.featureAccent} />
                <div className={styles.featureIcon}>Cd</div>
                <h3 className={styles.featureCellTitle}>{t('detectionStack.codeTitle')}</h3>
                <p className={styles.featureCellDesc}>{t('detectionStack.codeDesc')}</p>
              </div>
              <div className={styles.featureCell}>
                <div className={styles.featureAccent} />
                <div className={styles.featureIcon}>Sc</div>
                <h3 className={styles.featureCellTitle}>{t('detectionStack.sessionTitle')}</h3>
                <p className={styles.featureCellDesc}>{t('detectionStack.sessionDesc')}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ vs Onfido ═══ */}
      <section id="vs-onfido" className={styles.comparisonSection}>
        <div className="container">
          <div className={styles.comparisonLayout}>
            <div className={styles.comparisonIntro}>
              <div className={styles.sectionEyebrow}>{t('comparison.eyebrow')}</div>
              <h2 className={styles.sectionHeading}>{t('comparison.heading')}</h2>
              <p className={styles.sectionSubhead}>{t('comparison.subhead')}</p>
              <div style={{ marginTop: '2rem', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <Link href="/interview" className="btn btn-primary" style={{ fontSize: '0.85rem', padding: '10px 20px' }}>{t('comparison.tryDemo')}</Link>
                <Link href="/pricing" className="btn btn-outline" style={{ fontSize: '0.85rem', padding: '10px 20px' }}>{t('comparison.seePricing')}</Link>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className={styles.comparisonTable}>
                <thead>
                  <tr>
                    <th>{t('comparison.capability')}</th>
                    <th>{t('comparison.deepCheck')}</th>
                    <th>{t('comparison.onfido')}</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonRowsT.map(([cap, dc, onf, dcType, onfType], i) => (
                    <tr key={i}>
                      <td style={{ color: 'var(--color-text-muted)' }}>{cap}</td>
                      <td>
                        {i === 7 ? (
                          <Link href="/onpremise" className={styles.checkMark} style={{ textDecoration: 'none' }}>
                            {dc} &#8594;
                          </Link>
                        ) : (
                          <span className={markClass(dcType)}>{dc}</span>
                        )}
                      </td>
                      <td>
                        <span className={markClass(onfType)}>{onf}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Document Forensics ═══ */}
      <section className={styles.forensicsSection}>
        <div className="container">
          <div className={styles.forensicsInner}>
            <div className={styles.forensicsText}>
              <div className={styles.sectionEyebrow}>{t('docForensics.eyebrow')}</div>
              <h2 className={styles.sectionHeading} style={{ textAlign: 'left' }}>{t('docForensics.heading')}</h2>
              <p style={{ color: 'var(--color-text-muted)', lineHeight: 1.65, marginBottom: '1.5rem', fontSize: '0.95rem' }}>
                {t('docForensics.desc')}
              </p>
              <div className={styles.forensicsPills}>
                <span className={styles.pill}>{t('docForensics.ela')}</span>
                <span className={styles.pill}>{t('docForensics.exif')}</span>
                <span className={styles.pill}>{t('docForensics.aiSig')}</span>
                <span className={styles.pill}>{t('docForensics.noise')}</span>
              </div>
              <Link href="/documents" className="btn btn-primary" style={{ marginTop: '1.5rem', display: 'inline-flex', fontSize: '0.88rem' }}>
                {t('docForensics.analyzeBtn')}
              </Link>
            </div>
            <div className={styles.forensicsCards}>
              <div className={styles.forensicsCard}>
                <div className={styles.forensicsCardIcon}>EL</div>
                <div>
                  <h4>{t('docForensics.elaTitle')}</h4>
                  <p>{t('docForensics.elaDesc')}</p>
                </div>
              </div>
              <div className={styles.forensicsCard}>
                <div className={styles.forensicsCardIcon}>EX</div>
                <div>
                  <h4>{t('docForensics.exifTitle')}</h4>
                  <p>{t('docForensics.exifDesc')}</p>
                </div>
              </div>
              <div className={styles.forensicsCard}>
                <div className={styles.forensicsCardIcon}>AI</div>
                <div>
                  <h4>{t('docForensics.aiTitle')}</h4>
                  <p>{t('docForensics.aiDesc')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Enterprise Waitlist ═══ */}
      <section className={styles.waitlistSection}>
        <div className="container">
          <div className={styles.waitlistInner}>
            <div className={styles.sectionEyebrow}>{t('waitlist.eyebrow')}</div>
            <h2 className={styles.sectionHeading} style={{ fontSize: '2.2rem', marginBottom: '0.75rem' }}>
              {t('waitlist.heading')}
            </h2>
            <p style={{ color: 'var(--color-text-muted)', maxWidth: '460px', margin: '0 auto 2rem', lineHeight: 1.6, fontSize: '0.95rem' }}>
              {t('waitlist.desc')}
            </p>
            {waitlistStatus === 'success' ? (
              <div className={styles.waitlistSuccess}>
                <span style={{ fontSize: '1.5rem', marginBottom: '0.5rem', display: 'block', color: 'var(--color-primary)' }}>&#10003;</span>
                <p style={{ color: 'var(--color-primary)', fontWeight: 600, fontSize: '1.05rem', margin: 0 }}>{waitlistMsg}</p>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem', marginTop: '0.5rem' }}>{t('waitlist.successMsg')}</p>
              </div>
            ) : (
              <form onSubmit={handleWaitlist} className={styles.waitlistForm}>
                <input
                  type="email"
                  placeholder={t('waitlist.placeholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className={styles.waitlistInput}
                  disabled={waitlistStatus === 'loading'}
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={waitlistStatus === 'loading'}
                  style={{ whiteSpace: 'nowrap', minWidth: '140px', fontSize: '0.88rem' }}
                >
                  {waitlistStatus === 'loading' ? t('waitlist.joining') : t('waitlist.joinBtn')}
                </button>
              </form>
            )}
            {waitlistStatus === 'error' && (
              <p style={{ color: '#ef4444', fontSize: '0.82rem', marginTop: '0.75rem' }}>{waitlistMsg}</p>
            )}
            <p style={{ color: 'rgba(255,255,255,0.15)', fontSize: '0.72rem', marginTop: '1rem' }}>
              {t('waitlist.noSpam')}
            </p>
          </div>
        </div>
      </section>

      {/* ═══ Footer ═══ */}
      <footer className={styles.footer}>
        <div className="container">
          <h2>{t('footer.ctaHeading')}</h2>
          <p>{t('footer.ctaDesc')}</p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/pricing" className="btn btn-primary" style={{ fontSize: '0.88rem' }}>{t('footer.seePlans')}</Link>
            <Link href="/auth/login" className="btn btn-outline" style={{ fontSize: '0.88rem' }}>{t('footer.signIn')}</Link>
          </div>
          <div className={styles.trustBadges}>
            <div className={styles.trustBadge}>
              <span className={styles.trustIcon}>&#9679;</span>
              <span>{t('footer.gdpr')}</span>
            </div>
            <div className={styles.trustBadge}>
              <span className={styles.trustIcon}>&#9679;</span>
              <span>{t('footer.euAiAct')}</span>
            </div>
            <div className={styles.trustBadge}>
              <span className={styles.trustIcon}>&#9679;</span>
              <span>{t('footer.privacyByDesign')}</span>
            </div>
            <div className={styles.trustBadge}>
              <span className={styles.trustIcon}>&#9679;</span>
              <span>{t('footer.clientSide')}</span>
            </div>
          </div>
          <div className={styles.footerLinks}>
            <Link href="/privacy">{t('footer.privacyPolicy')}</Link>
            <Link href="/terms">{t('footer.terms')}</Link>
            <Link href="/security">{t('footer.security')}</Link>
            <Link href="/whitepaper">{t('footer.whitepaper')}</Link>
            <Link href="/ens">{t('footer.ens')}</Link>
            <Link href="/iso27001">{t('footer.iso')}</Link>
            <Link href="/dpia">{t('footer.dpia')}</Link>
            <a href="/.well-known/security.txt">security.txt</a>
          </div>
          <div className={styles.footerNote}>
            {t('footer.copyright')} &middot; <a href="mailto:hello@deep-check.io" style={{ color: 'inherit' }}>hello@deep-check.io</a>
          </div>
        </div>
      </footer>
    </main>
  )
}
