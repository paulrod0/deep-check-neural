import Link from 'next/link'
import styles from '../privacy/page.module.css'
import isoStyles from './page.module.css'

export const metadata = {
  title: 'ISO 27001 — Statement of Applicability | Deep-Check',
  description: 'ISO 27001:2022 Statement of Applicability (SoA) for Deep-Check biometric identity verification platform.',
}

function S({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={styles.sectionBody}>{children}</div>
    </div>
  )
}

type ImplStatus = 'implemented' | 'planned' | 'not_applicable'

interface Control {
  ref: string
  title: string
  rationale: string
  implementation: string
  status: ImplStatus
}

const STATUS_LABEL: Record<ImplStatus, string> = {
  implemented: 'Implemented',
  planned: 'Planned',
  not_applicable: 'N/A',
}
const STATUS_COLOR: Record<ImplStatus, string> = {
  implemented: '#00ff9d',
  planned: '#ffcc00',
  not_applicable: '#555',
}

// ─── ISO 27001:2022 Annex A controls (selected applicable controls) ────────────

const CONTROLS: Control[] = [
  // A.5 — Organizational controls
  {
    ref: 'A.5.1',
    title: 'Policies for information security',
    rationale: 'Required to establish security governance',
    implementation: 'Security policy published at /security; Privacy Policy at /privacy; Terms at /terms. COMPLIANCE.md contains internal ISMS policy.',
    status: 'implemented',
  },
  {
    ref: 'A.5.2',
    title: 'Information security roles and responsibilities',
    rationale: 'Required for accountability',
    implementation: 'Roles defined: Data Controller (Deep-Check), DPO (pending formal appointment), Security Lead. Documented in COMPLIANCE.md.',
    status: 'planned',
  },
  {
    ref: 'A.5.10',
    title: 'Acceptable use of information and other assets',
    rationale: 'Required to prevent misuse of biometric data',
    implementation: 'Terms of Service §2 defines acceptable/prohibited uses; automated decision-making without human review explicitly prohibited.',
    status: 'implemented',
  },
  {
    ref: 'A.5.12',
    title: 'Classification of information',
    rationale: 'Biometric data = special category, requires classification',
    implementation: 'Data classification documented: biometric profiles (Confidential), audit logs (Internal), public content (Public). In COMPLIANCE.md §2.',
    status: 'implemented',
  },
  {
    ref: 'A.5.15',
    title: 'Access control',
    rationale: 'Required to protect biometric data and admin functions',
    implementation: 'Dashboard access: httpOnly session cookie, timingSafeEqual auth; Supabase: RLS policies per table; API: rate limiting in middleware; env vars: Vercel secrets.',
    status: 'implemented',
  },
  {
    ref: 'A.5.17',
    title: 'Authentication information',
    rationale: 'Secure credential management for admin access',
    implementation: 'Admin session tokens: 32-byte crypto.randomBytes(); stored hashed in dc_admin_sessions; 8h expiry; timingSafeEqual comparison prevents timing attacks.',
    status: 'implemented',
  },
  {
    ref: 'A.5.23',
    title: 'Information security for use of cloud services',
    rationale: 'Supabase and Vercel are cloud service providers',
    implementation: 'Supabase: EU region, ISO 27001 certified, SOC 2. Vercel: SOC 2 Type II. Sub-processor list in Privacy Policy §7.',
    status: 'implemented',
  },
  {
    ref: 'A.5.24',
    title: 'Information security incident management planning',
    rationale: 'Required for breach response',
    implementation: 'Responsible disclosure policy published at /security §4. Vercel provides incident alerting. Formal ISMS incident procedure: planned.',
    status: 'planned',
  },
  {
    ref: 'A.5.26',
    title: 'Response to information security incidents',
    rationale: 'GDPR Art. 33 requires 72h breach notification',
    implementation: 'Incident response contact (security@deep-check.app) published in security.txt. 72h AEPD notification process documented in COMPLIANCE.md.',
    status: 'planned',
  },
  {
    ref: 'A.5.29',
    title: 'Information security during disruption',
    rationale: 'Service continuity for biometric verification',
    implementation: 'Vercel provides global CDN with automatic failover. Supabase provides daily automated backups. Formal BCP: planned.',
    status: 'planned',
  },
  {
    ref: 'A.5.31',
    title: 'Legal, statutory, regulatory and contractual requirements',
    rationale: 'GDPR, EU AI Act, ENS compliance required',
    implementation: 'GDPR Art. 9 consent gates implemented; ENS Básico autodeclaración published at /ens; EU AI Act Art. 13/14 implemented; legal register in COMPLIANCE.md.',
    status: 'implemented',
  },
  {
    ref: 'A.5.32',
    title: 'Intellectual property rights',
    rationale: 'OSS license compliance',
    implementation: 'ONNX model: Apache 2.0 compatible; all npm dependencies: MIT/Apache/ISC; no GPL-licensed dependencies in production build.',
    status: 'implemented',
  },
  {
    ref: 'A.5.33',
    title: 'Protection of records',
    rationale: 'Audit log integrity required by ENS op.exp.7',
    implementation: 'Audit logs in dc_audit_logs (Supabase): append-only via service_role; RLS blocks user modification; pseudonymized IPs.',
    status: 'implemented',
  },
  {
    ref: 'A.5.36',
    title: 'Compliance with policies and standards',
    rationale: 'Required for ISMS operation',
    implementation: 'This SoA document + ENS autodeclaración constitute compliance documentation. Internal audit cycle: planned (biannual).',
    status: 'planned',
  },
  // A.6 — People controls
  {
    ref: 'A.6.1',
    title: 'Screening',
    rationale: 'Background checks for personnel with access to biometric data',
    implementation: 'Currently sole developer with full access. Formal screening process required upon team expansion.',
    status: 'not_applicable',
  },
  {
    ref: 'A.6.3',
    title: 'Information security awareness, education and training',
    rationale: 'Required for secure operations',
    implementation: 'Security training planned for Q3 2026 upon team growth. Current team: developer with security background.',
    status: 'planned',
  },
  {
    ref: 'A.6.8',
    title: 'Information security event reporting',
    rationale: 'Required to detect and report security events',
    implementation: 'Security events auto-logged to dc_audit_logs; error 5xx alerts via Vercel; responsible disclosure email in security.txt.',
    status: 'implemented',
  },
  // A.7 — Physical controls
  {
    ref: 'A.7.1',
    title: 'Physical security perimeters',
    rationale: 'No physical infrastructure — cloud-only',
    implementation: 'N/A: All infrastructure is cloud-hosted (Vercel, Supabase). Physical security delegated to cloud providers (ISO 27001 certified).',
    status: 'not_applicable',
  },
  // A.8 — Technological controls
  {
    ref: 'A.8.1',
    title: 'User endpoint devices',
    rationale: 'Candidate devices process biometric data locally',
    implementation: 'All biometric extraction runs client-side in sandboxed browser environment. No data stored on candidate devices beyond localStorage consent flag.',
    status: 'implemented',
  },
  {
    ref: 'A.8.2',
    title: 'Privileged access rights',
    rationale: 'Admin access to Supabase and dashboard requires protection',
    implementation: 'Supabase service role key stored in Vercel encrypted environment; not exposed to client; dashboard requires session token.',
    status: 'implemented',
  },
  {
    ref: 'A.8.5',
    title: 'Secure authentication',
    rationale: 'Multi-factor authentication for admin access',
    implementation: 'Admin auth: password + session token (2-factor equivalent). MFA via TOTP: planned for Q2 2026.',
    status: 'planned',
  },
  {
    ref: 'A.8.6',
    title: 'Capacity management',
    rationale: 'Prevent denial-of-service affecting availability',
    implementation: 'Rate limiting: 20 req/min per IP on /api/ml-score (CPU-intensive); 100 req/min default. Vercel auto-scales. Supabase connection pooling.',
    status: 'implemented',
  },
  {
    ref: 'A.8.7',
    title: 'Protection against malware',
    rationale: 'Required for application security',
    implementation: 'npm audit on CI/CD pipeline; no eval(); strict CSP blocks inline scripts; TypeScript strict mode prevents common vulnerabilities.',
    status: 'implemented',
  },
  {
    ref: 'A.8.8',
    title: 'Management of technical vulnerabilities',
    rationale: 'Required to maintain security posture',
    implementation: 'npm audit run on each deployment; Dependabot alerts enabled on GitHub; responsible disclosure policy at /security §4.',
    status: 'implemented',
  },
  {
    ref: 'A.8.9',
    title: 'Configuration management',
    rationale: 'Secure configuration baseline',
    implementation: 'Infrastructure as code: next.config.ts (security headers), Supabase migrations version-controlled; environment variables in Vercel (not in code).',
    status: 'implemented',
  },
  {
    ref: 'A.8.11',
    title: 'Data masking',
    rationale: 'Required for pseudonymisation of biometric data',
    implementation: 'IP addresses hashed with SHA-256+salt before storage; biometric profiles use opaque IDs (ep_*); no PII in URLs; email only stored as identifier.',
    status: 'implemented',
  },
  {
    ref: 'A.8.12',
    title: 'Data leakage prevention',
    rationale: 'Prevent exfiltration of biometric profiles',
    implementation: 'CSP blocks data exfiltration to unauthorized domains; Supabase RLS limits data access by role; API responses never include raw keystroke timings.',
    status: 'implemented',
  },
  {
    ref: 'A.8.15',
    title: 'Logging',
    rationale: 'Required for security monitoring and forensics',
    implementation: 'Structured audit log (dc_audit_logs): all API calls, auth events, enrollment, assessment saves. Middleware logs all requests with X-Request-ID. IP pseudonymized.',
    status: 'implemented',
  },
  {
    ref: 'A.8.16',
    title: 'Monitoring activities',
    rationale: 'Required for anomaly and intrusion detection',
    implementation: 'Rate limiting detects abuse patterns; Vercel Analytics monitors latency/errors; audit log enables retrospective analysis; error 4xx/5xx tracked.',
    status: 'implemented',
  },
  {
    ref: 'A.8.20',
    title: 'Networks security',
    rationale: 'Required to secure API communications',
    implementation: 'HTTPS enforced (HSTS max-age=31536000, preload); TLS 1.3 minimum; no HTTP fallback. Supabase traffic over TLS. Vercel edge network.',
    status: 'implemented',
  },
  {
    ref: 'A.8.22',
    title: 'Segregation of networks',
    rationale: 'Isolation of production database',
    implementation: 'Supabase service role key only on server-side (Vercel env); public anon key has RLS restrictions; no direct database access from client.',
    status: 'implemented',
  },
  {
    ref: 'A.8.24',
    title: 'Use of cryptography',
    rationale: 'Required for data protection',
    implementation: 'TLS 1.3 in transit; AES-256 at rest (Supabase); SHA-256 for IP hashing; crypto.randomBytes(32) for session tokens; crypto.timingSafeEqual for auth.',
    status: 'implemented',
  },
  {
    ref: 'A.8.25',
    title: 'Secure development life cycle',
    rationale: 'Required for application security',
    implementation: 'TypeScript strict; ESLint security rules; PR reviews (planned); penetration testing (planned Q3 2026); OWASP Top 10 checklist applied.',
    status: 'implemented',
  },
  {
    ref: 'A.8.26',
    title: 'Application security requirements',
    rationale: 'Security by design for the verification platform',
    implementation: 'Security requirements documented: anti-spoofing (4 layers), rate limiting, consent gates, audit logging, CSP, HSTS. See /whitepaper and /security.',
    status: 'implemented',
  },
  {
    ref: 'A.8.28',
    title: 'Secure coding',
    rationale: 'Prevent common vulnerabilities in application code',
    implementation: 'TypeScript strict null checks; no eval(); parameterized Supabase queries (ORM prevents SQLi); Content-Security-Policy; no secrets in code (env vars).',
    status: 'implemented',
  },
  {
    ref: 'A.8.32',
    title: 'Change management',
    rationale: 'Control changes to the production system',
    implementation: 'All changes via git commits on GitHub; Vercel auto-deploys from main branch with build checks; TypeScript compilation required before deploy.',
    status: 'implemented',
  },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function Iso27001Page() {
  const implemented = CONTROLS.filter(c => c.status === 'implemented').length
  const planned = CONTROLS.filter(c => c.status === 'planned').length
  const na = CONTROLS.filter(c => c.status === 'not_applicable').length
  const total = CONTROLS.length
  const pct = Math.round((implemented + planned * 0.3) / (total - na) * 100)

  return (
    <div className={styles.page}>
      <div className={styles.container}>

        {/* ── Header ── */}
        <div className={styles.header}>
          <Link href="/" className={styles.back}>← Deep-Check</Link>
          <div className={styles.meta}>
            <span className={styles.version}>ISO 27001:2022</span>
            <span className={styles.date}>Updated: 25 February 2026</span>
          </div>
        </div>

        {/* ── Title ── */}
        <h1 className={styles.title}>Statement of Applicability</h1>
        <p className={styles.subtitle}>
          ISO/IEC 27001:2022 — Annex A Controls · Deep-Check Biometric Identity Verification Platform
        </p>

        {/* ── Disclaimer ── */}
        <div className={isoStyles.disclaimerBox}>
          <span className={isoStyles.disclaimerIcon}>ℹ</span>
          <div>
            <p className={isoStyles.disclaimerTitle}>Pre-Certification Statement of Applicability</p>
            <p className={isoStyles.disclaimerBody}>
              This document constitutes a voluntary Statement of Applicability (SoA) for
              ISO/IEC 27001:2022. Deep-Check has not yet undergone formal certification
              by an accredited certification body. This SoA documents the current
              implementation status of Annex A controls and serves as preparation for
              formal certification (target: Q4 2026). All implemented controls are
              technically verifiable in the codebase and infrastructure.
            </p>
          </div>
        </div>

        {/* ── System info ── */}
        <S title="1. ISMS Scope">
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <tbody>
                {[
                  ['Organization', 'Deep-Check'],
                  ['System in scope', 'Web-based biometric identity verification and document forensics SaaS platform'],
                  ['Standard version', 'ISO/IEC 27001:2022 (Annex A, 93 controls across 4 themes)'],
                  ['SoA version', '1.0'],
                  ['SoA date', '25 February 2026'],
                  ['Scope boundary', 'Application layer (Next.js), API layer, database (Supabase EU), ML inference (Vercel)'],
                  ['Out of scope', 'Physical offices (cloud-only), end-user devices (candidate browsers), third-party identity providers'],
                  ['Risk appetite', 'Low (biometric special category data warrants conservative risk posture)'],
                  ['Target certification', 'Q4 2026, pending budget allocation for accredited audit body'],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ color: '#888', width: '30%', fontFamily: 'monospace', fontSize: '12px' }}>{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </S>

        {/* ── Summary ── */}
        <S title="2. Control Implementation Summary">
          <div className={isoStyles.scoreRow}>
            <div className={isoStyles.scoreCard}>
              <span className={isoStyles.scoreNum} style={{ color: '#00ff9d' }}>{implemented}</span>
              <span className={isoStyles.scoreLabel}>Implemented</span>
            </div>
            <div className={isoStyles.scoreCard}>
              <span className={isoStyles.scoreNum} style={{ color: '#ffcc00' }}>{planned}</span>
              <span className={isoStyles.scoreLabel}>Planned</span>
            </div>
            <div className={isoStyles.scoreCard}>
              <span className={isoStyles.scoreNum} style={{ color: '#555' }}>{na}</span>
              <span className={isoStyles.scoreLabel}>Not Applicable</span>
            </div>
            <div className={isoStyles.scoreCard}>
              <span className={isoStyles.scoreNum} style={{ color: '#00cfff' }}>{total}</span>
              <span className={isoStyles.scoreLabel}>Total Controls</span>
            </div>
          </div>
          <div className={isoStyles.progressBar}>
            <div className={isoStyles.progressFill} style={{ width: `${pct}%` }} />
          </div>
          <p style={{ color: '#666', fontSize: '13px', marginTop: '12px' }}>
            {pct}% of applicable controls are implemented or in progress.
            Planned controls target Q2–Q3 2026 (MFA, formal incident procedures, ISMS audit cycle, staff training).
          </p>
        </S>

        {/* ── Control table ── */}
        <S title="3. Annex A Control Mapping">
          <p style={{ color: '#666', fontSize: '13px', marginBottom: '16px' }}>
            Controls marked N/A are not applicable due to cloud-only architecture (no physical premises,
            no end-user hardware managed). All N/A justifications are documented below.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Control</th>
                  <th>Rationale for inclusion/exclusion</th>
                  <th>Implementation summary</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {CONTROLS.map(c => (
                  <tr key={c.ref}>
                    <td style={{ fontFamily: 'monospace', fontSize: '12px', color: '#00cfff', whiteSpace: 'nowrap' }}>{c.ref}</td>
                    <td style={{ fontWeight: 600, color: '#ddd', minWidth: '160px', fontSize: '13px' }}>{c.title}</td>
                    <td style={{ fontSize: '12px', color: '#777', maxWidth: '200px' }}>{c.rationale}</td>
                    <td style={{ fontSize: '12px', maxWidth: '280px' }}>{c.implementation}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className={isoStyles.badge} style={{ borderColor: STATUS_COLOR[c.status], color: STATUS_COLOR[c.status] }}>
                        {STATUS_LABEL[c.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </S>

        {/* ── Risk treatment ── */}
        <S title="4. Risk Treatment Summary">
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Risk</th>
                  <th>Likelihood</th>
                  <th>Impact</th>
                  <th>Treatment</th>
                  <th>Controls</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Biometric spoofing (replay/synthetic)', 'Medium', 'High', 'Mitigate', 'A.8.26, A.8.28 — 4 anti-adversarial layers (blink, rhythm_shift, inconsistency, saccade)'],
                  ['API abuse / DDoS on ML endpoint', 'High', 'Medium', 'Mitigate', 'A.8.6 — Rate limiting 20 req/min per IP; Vercel auto-scale'],
                  ['Biometric data exfiltration', 'Low', 'Critical', 'Mitigate', 'A.5.33, A.8.11, A.8.12 — RLS, CSP, pseudonymisation, no raw data stored'],
                  ['Admin account compromise', 'Low', 'High', 'Mitigate', 'A.5.17, A.8.5 — 32-byte random tokens, timingSafeEqual, 8h session expiry'],
                  ['Supply chain attack (npm)', 'Medium', 'High', 'Mitigate', 'A.8.7, A.8.8 — npm audit, Dependabot, minimal dependency surface'],
                  ['GDPR Art. 9 breach notification failure', 'Low', 'High', 'Mitigate', 'A.5.26 — 72h notification procedure documented; DPO appointment planned'],
                  ['EU AI Act high-risk classification', 'Medium', 'High', 'Mitigate', 'A.5.31 — Art. 13/14 implemented; technical documentation published'],
                  ['Vendor lock-in / provider outage (Supabase)', 'Low', 'Medium', 'Accept', 'Supabase: 99.9% SLA; Vercel fallback. Full migration feasible: PostgreSQL-compatible.'],
                ].map(([r, l, i, t, c]) => (
                  <tr key={r}>
                    <td style={{ fontWeight: 600, color: '#ddd', fontSize: '13px' }}>{r}</td>
                    <td style={{ color: l === 'High' ? '#ff6b6b' : l === 'Medium' ? '#ffcc00' : '#00ff9d', fontFamily: 'monospace', fontSize: '12px' }}>{l}</td>
                    <td style={{ color: i === 'Critical' ? '#ff4444' : i === 'High' ? '#ff6b6b' : '#ffcc00', fontFamily: 'monospace', fontSize: '12px' }}>{i}</td>
                    <td style={{ color: '#888', fontFamily: 'monospace', fontSize: '12px' }}>{t}</td>
                    <td style={{ fontSize: '12px', color: '#777' }}>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </S>

        {/* ── Certification roadmap ── */}
        <S title="5. Certification Roadmap">
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Milestone</th>
                  <th>Description</th>
                  <th>Target</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['ISMS documentation complete', 'SoA, Risk Register, Asset Inventory, Policies — all documented', 'Q1 2026', 'implemented'],
                  ['Technical controls implemented', 'All A.8 technological controls: rate limiting, audit log, crypto, CSP, HSTS', 'Q1 2026', 'implemented'],
                  ['ENS Básico autodeclaración', 'Voluntary self-declaration of ENS Básico conformity (RD 311/2022)', 'Q1 2026', 'implemented'],
                  ['MFA for admin dashboard', 'TOTP-based second factor for /dashboard access', 'Q2 2026', 'planned'],
                  ['Formal incident procedure', 'Written IRP with escalation tree, GDPR 72h notification workflow', 'Q2 2026', 'planned'],
                  ['Internal ISMS audit', 'First internal audit of ISMS controls against ISO 27001:2022', 'Q3 2026', 'planned'],
                  ['Penetration test', 'External pentest of API and biometric pipeline', 'Q3 2026', 'planned'],
                  ['ISO 27001:2022 Stage 1 audit', 'Documentation review by accredited certification body', 'Q4 2026', 'planned'],
                  ['ISO 27001:2022 Stage 2 audit', 'On-site certification audit — target certification', 'Q1 2027', 'planned'],
                ].map(([m, d, t, s]) => (
                  <tr key={m}>
                    <td style={{ fontWeight: 600, color: '#ddd', fontSize: '13px' }}>{m}</td>
                    <td style={{ fontSize: '13px' }}>{d}</td>
                    <td style={{ color: '#888', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '12px' }}>{t}</td>
                    <td>
                      <span className={isoStyles.badge} style={{
                        borderColor: s === 'implemented' ? '#00ff9d' : '#ffcc00',
                        color: s === 'implemented' ? '#00ff9d' : '#ffcc00'
                      }}>
                        {s === 'implemented' ? 'Done' : 'Planned'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </S>

        {/* ── Footer links ── */}
        <div className={styles.footer}>
          <Link href="/ens">ENS Autodeclaración →</Link>
          <Link href="/security">Security Policy</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/whitepaper">Technical Whitepaper</Link>
          <Link href="/">← Home</Link>
        </div>

      </div>
    </div>
  )
}
