import Link from 'next/link'
import styles from '../privacy/page.module.css'
import secStyles from './page.module.css'

export const metadata = {
  title: 'Security Policy — Deep-Check',
  description: 'Deep-Check security practices, responsible disclosure policy, and architecture overview.',
}

export default function SecurityPage() {
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.header}>
          <Link href="/" className={styles.back}>← Deep-Check</Link>
          <div className={styles.meta}>
            <span className={styles.version}>Version 1.0</span>
            <span className={styles.date}>Updated: 25 February 2026</span>
          </div>
        </div>

        <h1 className={styles.title}>Security Policy</h1>
        <p className={styles.subtitle}>
          Our approach to securing biometric data, defending against adversarial attacks,
          and handling vulnerability reports.
        </p>

        <S title="1. Security Architecture">
          <div className={secStyles.pillGrid}>
            {[
              { icon: '🧬', label: 'Client-side Processing', detail: 'All biometric extraction runs in-browser via WASM — raw signals never leave the device' },
              { icon: '🔒', label: 'Transport Security', detail: 'TLS 1.3 enforced. HSTS with preload. All API routes are HTTPS-only' },
              { icon: '🛡️', label: 'Content Security Policy', detail: 'Strict CSP headers on all routes — blocks XSS, clickjacking, and content injection' },
              { icon: '🔑', label: 'API Authentication', detail: 'Enterprise API keys use 48-byte cryptographic random tokens with per-key permission scopes' },
              { icon: '🗄️', label: 'Database Security', detail: 'Supabase with Row-Level Security (RLS) enabled on all tables. Service role key server-side only' },
              { icon: '⏱️', label: 'Data Minimisation', detail: 'Enrollment profiles expire after 90 days and are hard-deleted. No raw biometric storage' },
            ].map(item => (
              <div key={item.label} className={secStyles.pill}>
                <span className={secStyles.pillIcon}>{item.icon}</span>
                <div>
                  <p className={secStyles.pillLabel}>{item.label}</p>
                  <p className={secStyles.pillDetail}>{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </S>

        <S title="2. Anti-Adversarial Hardening">
          <p>Deep-Check&apos;s biometric engine includes four layers of adversarial hardening:</p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Layer</th><th>Technique</th><th>Threat Mitigated</th></tr></thead>
              <tbody>
                <tr><td>Algorithm obfuscation</td><td>Feature names and thresholds are hashed / indirected in production builds</td><td>Reverse engineering detection thresholds to craft bypass inputs</td></tr>
                <tr><td>Timing noise injection</td><td>Randomised ±0–3ms jitter added to event processing timestamps</td><td>Timing side-channel attacks that probe threshold boundaries</td></tr>
                <tr><td>Replay protection</td><td>Session IDs include timestamp; replayed biometric streams are rejected via temporal consistency checks</td><td>Replay attacks using pre-recorded genuine session data</td></tr>
                <tr><td>Hash integrity</td><td>Session payloads are SHA-256 hashed client-side; server verifies hash on receipt</td><td>Man-in-the-middle tampering with biometric scores in transit</td></tr>
              </tbody>
            </table>
          </div>
        </S>

        <S title="3. Penetration Testing & Audits">
          <p>Deep-Check has not yet undergone a formal third-party penetration test. This is on our roadmap for Q3 2026 prior to enterprise deployment in regulated sectors.</p>
          <p>Internal security reviews are conducted:</p>
          <ul>
            <li>On every major feature release</li>
            <li>After any dependency update flagged by automated vulnerability scanning (GitHub Dependabot)</li>
            <li>In response to any reported vulnerability</li>
          </ul>
        </S>

        <S title="4. Responsible Disclosure Policy">
          <div className={styles.alert}>
            <strong>We welcome responsible security research.</strong><br />
            If you discover a vulnerability in Deep-Check, please report it privately before
            public disclosure. We commit to acknowledging receipt within 48 hours and providing
            a remediation timeline within 7 business days.
          </div>
          <p><strong>How to report:</strong></p>
          <ul>
            <li>Email: <a href="mailto:security@deep-check.io">security@deep-check.io</a></li>
            <li>PGP key: available on request</li>
            <li>Standard: <a href="/.well-known/security.txt">/.well-known/security.txt</a></li>
          </ul>
          <p><strong>Scope (in-scope for reports):</strong></p>
          <ul>
            <li>Authentication bypass or privilege escalation</li>
            <li>Biometric data exfiltration or exposure</li>
            <li>Injection vulnerabilities (SQLi, XSS, etc.)</li>
            <li>Algorithm bypass that reliably defeats biometric detection</li>
            <li>Sensitive data exposure in API responses</li>
          </ul>
          <p><strong>Out of scope:</strong></p>
          <ul>
            <li>Social engineering attacks against Deep-Check staff</li>
            <li>Denial of service attacks</li>
            <li>Issues in third-party dependencies already tracked by their maintainers</li>
          </ul>
          <p>We do not currently offer a paid bug bounty programme but will publicly acknowledge
          researchers who report valid, responsibly disclosed vulnerabilities (with their consent).</p>
        </S>

        <S title="5. Acknowledgments" id="acknowledgments">
          <p>No vulnerabilities have been publicly disclosed to date. This section will list
          researchers who have responsibly disclosed security issues once our programme is active.</p>
        </S>

        <S title="6. Compliance Roadmap">
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Certification</th><th>Status</th><th>Target</th></tr></thead>
              <tbody>
                <tr><td>GDPR / RGPD</td><td>🟡 In progress — DPIA pending</td><td>Q2 2026</td></tr>
                <tr><td>EU AI Act (High-Risk)</td><td>🟡 Architecture review complete — documentation in progress</td><td>Q3 2026</td></tr>
                <tr><td>ISO 27001</td><td>⚪ Planned</td><td>Q1 2027</td></tr>
                <tr><td>ENS (Esquema Nacional de Seguridad)</td><td>⚪ Planned — required for Spanish public sector</td><td>Q2 2027</td></tr>
                <tr><td>Independent algorithm audit</td><td>⚪ Planned — partner selection in progress</td><td>Q3 2026</td></tr>
              </tbody>
            </table>
          </div>
        </S>

        <div className={styles.footer}>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
          <Link href="/whitepaper">Technical Whitepaper</Link>
          <a href="mailto:security@deep-check.io">security@deep-check.io</a>
        </div>
      </div>
    </div>
  )
}

function S({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section className={styles.section} id={id}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  )
}
