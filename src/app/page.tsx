import Link from 'next/link'
import styles from './page.module.css'

export default function Home() {
  return (
    <main className={styles.main}>
      {/* Navigation */}
      <nav className={styles.nav}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className={styles.logo}>Deep-Check<span style={{ color: 'var(--color-primary)' }}>.</span></div>
          <a href="#demo" className="btn btn-primary">Book Demo</a>
        </div>
      </nav>

      {/* Hero Section */}
      <section className={styles.hero}>
        <div className="container">
          <div className={styles.heroContent}>
            <div className={styles.badge}>Trust Architecture 2026</div>
            <h1 className={styles.title}>
              The <span className="text-gradient">End of Remote Fraud.</span><br />
              Continuous Identity Verification.
            </h1>
            <p className={styles.subtitle}>
              Hiring a remote senior dev costs <strong>$30,000 USD</strong> in risk if they use AI to fake the interview.
              Deep-Check validates identity continuously, not just at login.
            </p>
            <div className={styles.ctaGroup}>
              <Link href="/interview" className="btn btn-primary">Start Verification Loop</Link>
              <a href="#how" className="btn btn-outline">How it Works</a>
            </div>
          </div>
        </div>

        {/* Background Effects */}
        <div className={styles.glow} style={{ top: '-20%', left: '20%', background: 'var(--color-secondary)' }}></div>
        <div className={styles.glow} style={{ top: '40%', right: '10%', background: 'var(--color-primary)' }}></div>
      </section>

      {/* The Risk / Stats */}
      <section className={styles.stats}>
        <div className="container">
          <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center' }}>
            <h2 className="section-title">The Crisis of Trust</h2>
            <div className={styles.grid}>
              <div className={styles.statItem}>
                <h3>$30k+</h3>
                <p>Avg. Loss per Bad Hire</p>
              </div>
              <div className={styles.statItem}>
                <h3>97%</h3>
                <p>Remote Identity Fraud Increase</p>
              </div>
              <div className={styles.statItem}>
                <h3>0%</h3>
                <p>Confidence in Current Tools</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* The Moat (Features) */}
      <section id="how" className={styles.features}>
        <div className="container">
          <h2 className="section-title">The Deep-Check <span className="text-gradient">Moat</span></h2>
          <div className={styles.grid}>
            <div className={styles.card}>
              <div className={styles.icon}>🧬</div>
              <h3>Behavioral Biometrics</h3>
              <p>We analyze keystroke dynamics (flight time, hold time). The way they type is as unique as a fingerprint.</p>
            </div>
            <div className={styles.card}>
              <div className={styles.icon}>👁️</div>
              <h3>Liveness Detection</h3>
              <p>Anti-Deepfake technology monitors micro-expressions and lighting reflections in real-time.</p>
            </div>
            <div className={styles.card}>
              <div className={styles.icon}>🤖</div>
              <h3>Code Forensics</h3>
              <p>Detects if code "appears" instantly (LLM Copy/Paste) or evolves naturally. Calculates Perplexity Scores.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Document Forensics — Product B */}
      <section className={styles.forensicsSection}>
        <div className="container">
          <div className={styles.forensicsInner}>
            <div className={styles.forensicsText}>
              <div className={styles.badge} style={{ marginBottom: '1rem' }}>Nuevo Producto</div>
              <h2 className="section-title" style={{ textAlign: 'left' }}>
                Forensia <span className="text-gradient">Documental</span>
              </h2>
              <p style={{ color: 'var(--color-text-dim)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                Deep-Check detecta imágenes manipuladas, deepfakes en documentos y metadatos falsificados
                en solicitudes de ayudas, expedientes y procesos de verificación documental.
              </p>
              <div className={styles.forensicsPills}>
                <span className={styles.pill}>ELA — Error Level Analysis</span>
                <span className={styles.pill}>EXIF Anomaly Detection</span>
                <span className={styles.pill}>AI Image Signature</span>
                <span className={styles.pill}>Noise Forensics</span>
              </div>
              <Link href="/documents" className="btn btn-primary" style={{ marginTop: '1.5rem', display: 'inline-block' }}>
                Analizar documento →
              </Link>
            </div>
            <div className={styles.forensicsCards}>
              <div className={styles.forensicsCard}>
                <span className={styles.forensicsCardIcon}>🔬</span>
                <h4>ELA</h4>
                <p>Detecta regiones editadas comparando artefactos de compresión JPEG</p>
              </div>
              <div className={styles.forensicsCard}>
                <span className={styles.forensicsCardIcon}>📋</span>
                <h4>EXIF</h4>
                <p>Identifica software de edición (Photoshop, GIMP, Canva) en metadatos</p>
              </div>
              <div className={styles.forensicsCard}>
                <span className={styles.forensicsCardIcon}>🤖</span>
                <h4>AI Detection</h4>
                <p>Distingue fotografías reales de imágenes generadas por IA (Midjourney, DALL-E, SD)</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer / CTA */}
      <footer className={styles.footer}>
        <div className="container">
          <h2>Standardize Trust.</h2>
          <p>Join the waitlist for the Enterprise Beta.</p>
          <form className={styles.form}>
            <input type="email" placeholder="enter@enterprise.com" className={styles.input} />
            <button className="btn btn-primary">Get Early Access</button>
          </form>

          {/* Trust badges */}
          <div className={styles.trustBadges}>
            <div className={styles.trustBadge} title="GDPR Compliant — biometric data processed client-side, explicit consent required">
              <span className={styles.trustIcon}>🔒</span>
              <span>GDPR Compliant</span>
            </div>
            <div className={styles.trustBadge} title="EU AI Act — human oversight mechanisms implemented">
              <span className={styles.trustIcon}>🤖</span>
              <span>EU AI Act Ready</span>
            </div>
            <div className={styles.trustBadge} title="Privacy by Design — no raw biometric storage">
              <span className={styles.trustIcon}>🛡️</span>
              <span>Privacy by Design</span>
            </div>
            <div className={styles.trustBadge} title="Client-side processing — data never leaves your device">
              <span className={styles.trustIcon}>⚡</span>
              <span>Client-Side Processing</span>
            </div>
          </div>

          <div className={styles.footerLinks}>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
            <Link href="/security">Security</Link>
            <Link href="/whitepaper">Whitepaper</Link>
            <a href="/.well-known/security.txt">security.txt</a>
          </div>

          <div className={styles.footerNote}>
            © 2026 Deep-Check Inc. All rights reserved. · <a href="mailto:hello@deep-check.io" style={{ color: 'inherit' }}>hello@deep-check.io</a>
          </div>
        </div>
      </footer>
    </main>
  )
}
