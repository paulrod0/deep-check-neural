import Link from 'next/link'
import styles from './page.module.css'

export default function Home() {
  return (
    <main className={styles.main}>
      {/* Navigation */}
      <nav className={styles.nav}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className={styles.logo}>Deep-Check<span style={{ color: 'var(--color-primary)' }}>.</span></div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <a href="#vs-onfido" style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', textDecoration: 'none' }}>vs Onfido</a>
            <Link href="/pricing" className="btn btn-primary">See Plans</Link>
          </div>
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
              Deep-Check validates identity continuously — not just at login.
            </p>
            <div className={styles.ctaGroup}>
              <Link href="/interview" className="btn btn-primary">Try Live Demo →</Link>
              <a href="#vs-onfido" className="btn btn-outline">vs Onfido</a>
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
                <p>Remote Identity Fraud Increase (2024)</p>
              </div>
              <div className={styles.statItem}>
                <h3>6-layer</h3>
                <p>Deepfake Detection Stack</p>
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
              <p>Keystroke dynamics (flight time, hold time, rhythm). The way they type is as unique as a fingerprint — impossible to fake in real-time.</p>
            </div>
            <div className={styles.card}>
              <div className={styles.icon}>👁️</div>
              <h3>6-Layer Liveness Detection</h3>
              <p>Heartbeat signal, facial biomechanics, CNN deepfake classifier, micro-saccades, blink physics, and lighting reflex — all running simultaneously.</p>
            </div>
            <div className={styles.card}>
              <div className={styles.icon}>🤖</div>
              <h3>Code Forensics</h3>
              <p>Detects AI-generated code (LLM copy-paste vs. natural typing evolution). Calculates perplexity scores and code velocity anomalies.</p>
            </div>
          </div>
        </div>
      </section>

      {/* vs Onfido Comparison */}
      <section id="vs-onfido" className={styles.features} style={{ background: 'rgba(0,0,0,0.3)' }}>
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <div className={styles.badge} style={{ marginBottom: '1rem' }}>Competitive Analysis</div>
            <h2 className="section-title">
              Deep-Check vs <span className="text-gradient">Onfido</span>
            </h2>
            <p style={{ color: 'var(--color-text-muted)', maxWidth: '560px', margin: '0 auto' }}>
              Onfido verifies who someone is once, at login. Deep-Check verifies who someone is continuously, during the entire session.
            </p>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '14px 20px', color: 'var(--color-text-muted)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--color-border)', width: '35%' }}>
                    Capability
                  </th>
                  <th style={{ textAlign: 'center', padding: '14px 20px', borderBottom: '1px solid var(--color-border)', width: '32.5%' }}>
                    <div style={{ color: 'var(--color-primary)', fontWeight: 700 }}>Deep-Check</div>
                  </th>
                  <th style={{ textAlign: 'center', padding: '14px 20px', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)', width: '32.5%' }}>
                    Onfido
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Identity Check at Login',       '✅ Yes',            '✅ Yes'],
                  ['Continuous Session Monitoring',  '✅ Real-time',       '❌ One-time only'],
                  ['Deepfake Detection',             '✅ 6-layer stack',   '⚠️ Basic liveness'],
                  ['Heartbeat Signal Analysis',      '✅ rPPG coupling',   '❌ Not available'],
                  ['Behavioral Biometrics',          '✅ Keystroke DNA',   '❌ Not available'],
                  ['AI-Generated Code Detection',    '✅ For interviews',  '❌ N/A'],
                  ['Document Forensics (ELA/EXIF)',  '✅ Built-in',       '⚠️ Add-on'],
                  ['On-Premise Deployment',          '✅ Enterprise plan', '❌ Cloud only'],
                  ['Privacy — No Biometric Storage', '✅ Client-side',    '❌ Sends to servers'],
                  ['Starting Price',                 '✅ Free tier',      '❌ €1,500+/month'],
                  ['GDPR + EU AI Act Ready',         '✅ Full compliance', '⚠️ Partial'],
                ].map(([cap, dc, onf], i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent' }}>
                    <td style={{ padding: '14px 20px', color: 'var(--color-text-muted)' }}>{cap}</td>
                    <td style={{ padding: '14px 20px', textAlign: 'center', color: dc.startsWith('✅') ? 'var(--color-primary)' : '#ffd700', fontWeight: 600 }}>{dc}</td>
                    <td style={{ padding: '14px 20px', textAlign: 'center', color: onf.startsWith('❌') ? '#ff4d4d' : onf.startsWith('⚠️') ? '#ffd700' : 'var(--color-primary)', opacity: 0.85 }}>{onf}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ textAlign: 'center', marginTop: '2.5rem', display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/interview" className="btn btn-primary">Try Live Demo →</Link>
            <Link href="/pricing" className="btn btn-outline">See Pricing</Link>
          </div>
        </div>
      </section>

      {/* Document Forensics — Product B */}
      <section className={styles.forensicsSection}>
        <div className="container">
          <div className={styles.forensicsInner}>
            <div className={styles.forensicsText}>
              <div className={styles.badge} style={{ marginBottom: '1rem' }}>Product Module</div>
              <h2 className="section-title" style={{ textAlign: 'left' }}>
                Document <span className="text-gradient">Forensics</span>
              </h2>
              <p style={{ color: 'var(--color-text-dim)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                Deep-Check detects manipulated images, deepfakes in documents, and falsified metadata
                in grant applications, dossiers, and document verification workflows.
              </p>
              <div className={styles.forensicsPills}>
                <span className={styles.pill}>ELA — Error Level Analysis</span>
                <span className={styles.pill}>EXIF Anomaly Detection</span>
                <span className={styles.pill}>AI Image Signature</span>
                <span className={styles.pill}>Noise Forensics</span>
              </div>
              <Link href="/documents" className="btn btn-primary" style={{ marginTop: '1.5rem', display: 'inline-block' }}>
                Analyze a document →
              </Link>
            </div>
            <div className={styles.forensicsCards}>
              <div className={styles.forensicsCard}>
                <span className={styles.forensicsCardIcon}>🔬</span>
                <h4>ELA</h4>
                <p>Detects edited regions by comparing JPEG compression artifacts</p>
              </div>
              <div className={styles.forensicsCard}>
                <span className={styles.forensicsCardIcon}>📋</span>
                <h4>EXIF</h4>
                <p>Identifies editing software (Photoshop, GIMP, Canva) in metadata</p>
              </div>
              <div className={styles.forensicsCard}>
                <span className={styles.forensicsCardIcon}>🤖</span>
                <h4>AI Detection</h4>
                <p>Distinguishes real photos from AI-generated images (Midjourney, DALL-E, Stable Diffusion)</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer / CTA */}
      <footer className={styles.footer}>
        <div className="container">
          <h2>Start today. No credit card required.</h2>
          <p>Verify identities and analyze documents in minutes. Free plan available.</p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '1.5rem' }}>
            <Link href="/pricing" className="btn btn-primary">See Plans &amp; Pricing →</Link>
            <Link href="/auth/login" className="btn btn-outline">Sign in</Link>
          </div>

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
            <Link href="/ens">ENS Básico</Link>
            <Link href="/iso27001">ISO 27001 SoA</Link>
            <Link href="/dpia">DPIA</Link>
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
