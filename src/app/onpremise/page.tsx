import Link from 'next/link'
import styles from '../page.module.css'
import CopyButton from './CopyButton'

export default function OnPremisePage() {
  const installCmd = `curl -fsSL https://deep-check.io/install.sh | bash`

  return (
    <main className={styles.main}>

      {/* Nav */}
      <nav className={styles.nav}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link href="/" style={{ textDecoration: 'none' }}>
            <div className={styles.logo}>Deep-Check<span style={{ color: 'var(--color-primary)' }}>.</span></div>
          </Link>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <Link href="/pricing" style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', textDecoration: 'none' }}>Pricing</Link>
            <a href="mailto:pablo@hiumsolutions.com?subject=Enterprise+On-Premise" className="btn btn-primary">
              Contact Enterprise
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className={styles.hero}>
        <div className="container">
          <div className={styles.heroContent}>
            <div className={styles.badge}>Enterprise · Self-Hosted</div>
            <h1 className={styles.title}>
              Full <span className="text-gradient">Data Sovereignty.</span><br />
              5-Minute Deploy.
            </h1>
            <p className={styles.subtitle}>
              Run Deep-Check entirely on your own infrastructure. Your biometric data, your documents, your employees&apos;
              faces — none of it ever leaves your network. Not even in encrypted form.
            </p>
            <div className={styles.ctaGroup}>
              <a href="#install" className="btn btn-primary">Deploy Now →</a>
              <a href="mailto:pablo@hiumsolutions.com?subject=Enterprise+On-Premise" className="btn btn-outline">
                Talk to Enterprise Sales
              </a>
            </div>
          </div>
        </div>
        <div className={styles.glow} style={{ top: '-20%', left: '20%', background: 'var(--color-secondary)' }} />
        <div className={styles.glow} style={{ top: '40%', right: '10%', background: 'var(--color-primary)' }} />
      </section>

      {/* Architecture */}
      <section className={styles.features}>
        <div className="container">
          <h2 className="section-title" style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
            Architecture: <span className="text-gradient">Zero Trust Boundary</span>
          </h2>

          <div className="glass-panel" style={{ padding: '2rem', fontFamily: 'monospace', fontSize: '0.88rem' }}>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem', fontFamily: 'inherit' }}>
              Your Server (Docker Compose) — nothing crosses this boundary:
            </p>
            <pre style={{
              color: 'var(--color-primary)', lineHeight: 1.7, overflowX: 'auto',
              background: 'rgba(0,0,0,0.3)', padding: '1.25rem', borderRadius: 8,
            }}>{`
  ┌──────────────────────────────────────────────────────────────┐
  │                   YOUR SERVER (Docker Compose)               │
  │                                                              │
  │   ┌─────────────────┐      ┌──────────────────────────────┐ │
  │   │   nginx (TLS)   │ ───▶ │     Next.js App (port 3000)  │ │
  │   │   port 80/443   │      │                              │ │
  │   └─────────────────┘      │  • Deepfake CNN (ONNX/WASM)  │ │
  │                            │  • ELA/EXIF forensics        │ │
  │                            │  • MRZ parser (offline)      │ │
  │                            │  • Face match (MediaPipe)    │ │
  │                            └──────────┬───────────────────┘ │
  │                                       │ PostgREST API        │
  │                            ┌──────────▼───────────────────┐ │
  │                            │   PostgreSQL 16               │ │
  │                            │   (audit logs, assessments,  │ │
  │                            │    document analyses)        │ │
  │                            └──────────────────────────────┘ │
  │                                                              │
  │   ┌──────────────────────────────────────────────────────┐  │
  │   │  ML Worker — EfficientNet (Python, port 8001)        │  │
  │   │  Server-side pixel forensics (ONNX)                  │  │
  │   └──────────────────────────────────────────────────────┘  │
  │                                                              │
  │              ↕  Zero data leaves this box  ↕                │
  └──────────────────────────────────────────────────────────────┘
            `.trim()}</pre>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginTop: '1.5rem' }}>
              {[
                ['Face match', 'Browser (MediaPipe WASM)'],
                ['Deepfake CNN', 'Browser (ONNX Runtime)'],
                ['Document ELA/EXIF', 'Browser (Canvas API)'],
                ['MRZ parsing', 'Server (offline regex)'],
                ['Audit logs', 'Your PostgreSQL'],
                ['ML inference', 'Your ML Worker container'],
              ].map(([what, where]) => (
                <div key={what} style={{ background: 'rgba(0,229,255,0.05)', borderRadius: 8, padding: '0.75rem 1rem' }}>
                  <p style={{ color: 'var(--color-primary)', fontSize: '0.78rem', fontFamily: 'sans-serif', fontWeight: 600, marginBottom: '0.2rem' }}>{what}</p>
                  <p style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem', fontFamily: 'sans-serif' }}>{where}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How to deploy */}
      <section id="install" className={styles.features} style={{ background: 'rgba(0,0,0,0.2)' }}>
        <div className="container">
          <h2 className="section-title" style={{ textAlign: 'center', marginBottom: '0.75rem' }}>
            Deploy in <span className="text-gradient">3 Steps</span>
          </h2>
          <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', marginBottom: '3rem' }}>
            From zero to production-ready in under 5 minutes. Requires Docker Engine 24+.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 680, margin: '0 auto' }}>

            {/* Step 1 */}
            <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
              <div style={{
                minWidth: 40, height: 40, borderRadius: '50%',
                background: 'var(--color-primary)', color: '#000',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: '1rem',
              }}>1</div>
              <div style={{ flex: 1 }}>
                <h3 style={{ marginBottom: '0.5rem' }}>Run the one-line installer</h3>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Generates all secrets automatically and starts the Docker stack.
                </p>
                <div style={{
                  background: 'rgba(0,0,0,0.5)', borderRadius: 8,
                  padding: '0.9rem 1rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
                  border: '1px solid var(--color-border)',
                }}>
                  <code style={{ color: 'var(--color-primary)', fontSize: '0.82rem', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    {installCmd}
                  </code>
                  <CopyButton text={installCmd} />
                </div>
                <p style={{ color: 'var(--color-text-dim)', fontSize: '0.78rem', marginTop: '0.6rem' }}>
                  Or: <code style={{ fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>git clone https://github.com/deepcheck/deepcheck && bash install.sh</code>
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
              <div style={{
                minWidth: 40, height: 40, borderRadius: '50%',
                background: 'var(--color-secondary)', color: '#000',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: '1rem',
              }}>2</div>
              <div>
                <h3 style={{ marginBottom: '0.5rem' }}>Wait ~2 minutes</h3>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                  Docker pulls the images, builds the app container, and starts the database.
                  The installer waits for all health checks to pass before printing your credentials.
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
              <div style={{
                minWidth: 40, height: 40, borderRadius: '50%',
                background: 'var(--color-primary)', color: '#000',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: '1rem',
              }}>3</div>
              <div>
                <h3 style={{ marginBottom: '0.5rem' }}>Open your dashboard</h3>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                  Navigate to <code style={{ color: 'var(--color-primary)', fontFamily: 'monospace' }}>http://your-server/dashboard</code> and
                  log in with the generated admin password. Change it immediately in Settings.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Global Coverage */}
      <section className={styles.features}>
        <div className="container">
          <h2 className="section-title" style={{ textAlign: 'center', marginBottom: '0.75rem' }}>
            <span className="text-gradient">195 Countries</span> · Universal Coverage
          </h2>
          <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', marginBottom: '2.5rem', maxWidth: 620, margin: '0 auto 2.5rem' }}>
            ICAO 9303 MRZ verification for every passport-issuing nation.
            Country-specific document validators with algorithmic check-digit validation.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            {[
              ['🌐', '195', 'Countries'],
              ['🔐', '22', 'Tier 1 (check-digit)'],
              ['📋', '40+', 'Tier 2 (format)'],
              ['📶', '120+', 'ePassport NFC'],
              ['🪪', 'TD1/TD2/TD3', 'MRZ formats'],
              ['⚡', 'Offline', 'No cloud required'],
            ].map(([icon, num, label]) => (
              <div key={label} className="glass-panel" style={{ padding: '1rem', textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>{icon}</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--color-primary)' }}>{num}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>{label}</div>
              </div>
            ))}
          </div>

          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '0.95rem', marginBottom: '1rem', color: 'var(--color-text)' }}>
              Tier 1 Countries — Full Algorithmic Validation
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {[
                '🇪🇸 Spain (NIF/NIE)', '🇮🇹 Italy (Codice Fiscale)', '🇧🇷 Brazil (CPF)',
                '🇨🇱 Chile (RUN)', '🇲🇽 Mexico (CURP)', '🇹🇷 Turkey (TC Kimlik)',
                '🇮🇳 India (Aadhaar)', '🇿🇦 South Africa (ID)', '🇦🇷 Argentina (DNI)',
                '🇨🇴 Colombia (Cédula)', '🇵🇹 Portugal (CC)', '🇩🇪 Germany (Personalausweis)',
                '🇸🇬 Singapore (NRIC/FIN)', '🇰🇷 South Korea (RRN)', '🇯🇵 Japan (My Number)',
                '🇵🇱 Poland (PESEL)', '🇷🇴 Romania (CNP)', '🇨🇿 Czech Rep. (Rodné číslo)',
                '🇳🇱 Netherlands (BSN)', '🇧🇪 Belgium (NN)', '🇨🇳 China (身份证)', '🇪🇨 Ecuador (Cédula)',
              ].map(c => (
                <span key={c} style={{
                  display: 'inline-block', padding: '0.3rem 0.65rem', fontSize: '0.76rem',
                  background: 'rgba(0,229,255,0.08)', border: '1px solid rgba(0,229,255,0.15)',
                  borderRadius: 6, color: 'var(--color-text)', whiteSpace: 'nowrap',
                }}>
                  {c}
                </span>
              ))}
            </div>
            <p style={{ color: 'var(--color-text-dim)', fontSize: '0.78rem', marginTop: '1rem' }}>
              + 40+ countries with format validation · All 195 countries supported via universal MRZ + passport number verification.
            </p>
          </div>
        </div>
      </section>

      {/* Security features */}
      <section className={styles.features}>
        <div className="container">
          <h2 className="section-title" style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
            Built for <span className="text-gradient">Regulated Environments</span>
          </h2>

          <div className={styles.grid}>
            {[
              {
                icon: '🔐',
                title: 'Air-Gap Compatible',
                desc: 'All ML models are bundled in the Docker image. The platform runs with zero outbound internet connections after setup.',
              },
              {
                icon: '🛡️',
                title: 'GDPR Article 25',
                desc: 'Privacy by Design and by Default. No biometric templates stored. No face embeddings persisted. Processing happens in the browser.',
              },
              {
                icon: '🔗',
                title: 'Tamper-Evident Audit Chain',
                desc: 'Every session event is hashed into a SHA-256 chain. Any modification to audit logs is cryptographically detectable.',
              },
              {
                icon: '🧬',
                title: 'No Biometric Storage',
                desc: 'Face match runs entirely in the browser via MediaPipe WASM. The server never processes or stores face embeddings.',
              },
              {
                icon: '📋',
                title: 'EU AI Act Ready',
                desc: 'Human oversight mechanisms, confidence scores with explanations, and full XAI breakdowns on every decision.',
              },
              {
                icon: '🔑',
                title: 'Source Code Access',
                desc: 'Enterprise customers receive the full source code. Audit it, modify it, and integrate it into your compliance workflow.',
              },
            ].map(f => (
              <div key={f.title} className={styles.card}>
                <div className={styles.icon}>{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* vs Cloud comparison */}
      <section className={styles.features} style={{ background: 'rgba(0,0,0,0.25)' }}>
        <div className="container">
          <h2 className="section-title" style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
            On-Premise vs <span className="text-gradient">Cloud SaaS</span>
          </h2>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '14px 20px', color: 'var(--color-text-muted)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--color-border)', width: '40%' }}>
                    Capability
                  </th>
                  <th style={{ textAlign: 'center', padding: '14px 20px', borderBottom: '1px solid var(--color-border)', width: '30%' }}>
                    <div style={{ color: 'var(--color-primary)', fontWeight: 700 }}>On-Premise</div>
                  </th>
                  <th style={{ textAlign: 'center', padding: '14px 20px', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)', width: '30%' }}>
                    Cloud SaaS
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Data stays on your network',     '✅ Always',       '❌ Cloud-hosted'],
                  ['Biometric data transmission',    '✅ None',         '⚠️ Encrypted'],
                  ['Air-gap / offline operation',    '✅ Full support',  '❌ Requires internet'],
                  ['GDPR Art. 25 compliance',        '✅ Guaranteed',    '⚠️ Depends on config'],
                  ['Custom ML model integration',    '✅ Full access',   '❌ Locked'],
                  ['Source code audit',              '✅ Included',      '❌ Not available'],
                  ['SSO / LDAP / Active Directory',  '✅ Configurable',  '❌ Not included'],
                  ['SLA with dedicated support',     '✅ Enterprise SLA','⚠️ Standard SLA'],
                  ['Database backup control',        '✅ You own it',    '⚠️ Provider backup'],
                  ['Cost at scale',                  '✅ Fixed infra',   '❌ Per-use pricing'],
                ].map(([cap, onprem, cloud], i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent' }}>
                    <td style={{ padding: '13px 20px', color: 'var(--color-text-muted)' }}>{cap}</td>
                    <td style={{ padding: '13px 20px', textAlign: 'center', color: 'var(--color-primary)', fontWeight: 600 }}>{onprem}</td>
                    <td style={{ padding: '13px 20px', textAlign: 'center', color: cloud.startsWith('❌') ? '#ff4d4d' : cloud.startsWith('⚠️') ? '#ffd700' : 'var(--color-primary)', opacity: 0.85 }}>{cloud}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* System requirements */}
      <section className={styles.features}>
        <div className="container" style={{ maxWidth: 740 }}>
          <h2 className="section-title" style={{ textAlign: 'center', marginBottom: '2rem' }}>
            System <span className="text-gradient">Requirements</span>
          </h2>
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
              <div>
                <h4 style={{ color: 'var(--color-primary)', marginBottom: '1rem', fontSize: '0.9rem' }}>Minimum</h4>
                {[
                  ['CPU', '4 cores (x86_64 or arm64)'],
                  ['RAM', '8 GB'],
                  ['Disk', '20 GB SSD'],
                  ['OS', 'Ubuntu 22.04+ / Debian 12 / RHEL 9+'],
                  ['Docker', 'Engine 24+ with Compose v2'],
                  ['Ports', '80, 443 available'],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', padding: '0.6rem 0', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>
              <div>
                <h4 style={{ color: 'var(--color-secondary)', marginBottom: '1rem', fontSize: '0.9rem' }}>Recommended (Production)</h4>
                {[
                  ['CPU', '8 cores'],
                  ['RAM', '16 GB'],
                  ['Disk', '100 GB SSD (NVMe)'],
                  ['GPU', 'Optional (NVIDIA L4 for ML Worker)'],
                  ['Network', 'Isolated VLAN'],
                  ['TLS', 'Certificate in docker/certs/'],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', padding: '0.6rem 0', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className={styles.features} style={{ background: 'rgba(0,0,0,0.3)', textAlign: 'center' }}>
        <div className="container">
          <h2 className="section-title" style={{ marginBottom: '1rem' }}>
            Ready to deploy on your <span className="text-gradient">own infrastructure?</span>
          </h2>
          <p style={{ color: 'var(--color-text-muted)', maxWidth: 520, margin: '0 auto 2rem' }}>
            Enterprise plan includes on-premise Docker package, dedicated onboarding call, SLA, and source code access.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a
              href="mailto:pablo@hiumsolutions.com?subject=Enterprise+On-Premise+Inquiry"
              className="btn btn-primary"
            >
              📧 Contact Enterprise Sales →
            </a>
            <Link href="/pricing" className="btn btn-outline">View Pricing</Link>
          </div>
          <p style={{ color: 'var(--color-text-dim)', fontSize: '0.8rem', marginTop: '1.5rem' }}>
            Response within 24 hours · Custom pricing based on seats and deployment size
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className="container">
          <div className={styles.footerLinks}>
            <Link href="/">Home</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/documents">Document Analysis</Link>
            <Link href="/interview">Live Demo</Link>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/whitepaper">Whitepaper</Link>
          </div>
          <div className={styles.footerNote}>
            © 2026 Deep-Check Inc. · <a href="mailto:pablo@hiumsolutions.com" style={{ color: 'inherit' }}>pablo@hiumsolutions.com</a>
          </div>
        </div>
      </footer>

    </main>
  )
}

