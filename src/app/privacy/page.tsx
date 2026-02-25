import Link from 'next/link'
import styles from './page.module.css'

export const metadata = {
  title: 'Privacy Policy — Deep-Check',
  description: 'How Deep-Check processes biometric and personal data in compliance with GDPR and the EU AI Act.',
}

export default function PrivacyPage() {
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.header}>
          <Link href="/" className={styles.back}>← Deep-Check</Link>
          <div className={styles.meta}>
            <span className={styles.version}>Version 1.0</span>
            <span className={styles.date}>Effective: 25 February 2026</span>
          </div>
        </div>

        <h1 className={styles.title}>Privacy Policy</h1>
        <p className={styles.subtitle}>
          Deep-Check processes special-category biometric data. We are committed to full
          transparency about what we collect, why, and how we protect it.
        </p>

        <div className={styles.alert}>
          <strong>GDPR Article 9 Notice</strong> — Biometric data used for the purpose of uniquely
          identifying a natural person is a special category of personal data under EU Regulation
          2016/679 (GDPR). Processing such data requires explicit consent or another lawful basis.
          Deep-Check only processes biometric data with the explicit, informed consent of the data subject.
        </div>

        <Section title="1. Data Controller">
          <p>Deep-Check Inc. (&ldquo;Deep-Check&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is the data controller for
          personal data processed through this platform.</p>
          <p>Contact: <a href="mailto:privacy@deep-check.io">privacy@deep-check.io</a></p>
          <p>Data Protection Officer (DPO): <a href="mailto:dpo@deep-check.io">dpo@deep-check.io</a></p>
        </Section>

        <Section title="2. Data We Collect">
          <h3>2.1 Biometric Data (Special Category — Art. 9 GDPR)</h3>
          <Table rows={[
            ['Keystroke dynamics', 'Flight times (inter-key intervals), hold times, typing rhythm patterns', 'Identity verification sessions and enrollment'],
            ['Facial landmarks', '68-point facial landmark vectors derived from camera feed', 'Liveness detection during active sessions only'],
            ['Eye gaze vectors', 'Horizontal/vertical gaze ratio history', 'Anti-deepfake analysis during active sessions'],
            ['Blink patterns', 'EAR (Eye Aspect Ratio) measurements, blink frequency', 'Liveness scoring during active sessions'],
          ]} headers={['Data Type', 'Description', 'Purpose']} />
          <p className={styles.note}>
            ⚠ Raw video or images are <strong>never</strong> stored. Only derived numerical vectors
            are processed. Raw biometric signals exist only in browser memory during an active
            session and are discarded immediately after.
          </p>

          <h3>2.2 Document Forensics Data</h3>
          <Table rows={[
            ['Image thumbnails', 'Low-resolution (320px) JPEG representation of uploaded images', 'Case reference and audit trail'],
            ['ELA heatmap', 'Error Level Analysis visualization of uploaded image', 'Forensic evidence for the analysis report'],
            ['EXIF metadata', 'Camera make/model, software, timestamps extracted from uploaded images', 'Anomaly detection'],
            ['Forensic scores', 'Numerical risk scores (0–100) per analytical module', 'Fraud detection output'],
          ]} headers={['Data Type', 'Description', 'Purpose']} />

          <h3>2.3 Standard Personal Data</h3>
          <Table rows={[
            ['Candidate name', 'Text field, provided by the operator', 'Session identification'],
            ['Email address', 'Optional, provided during enrollment', 'Profile linking across sessions'],
            ['Session metadata', 'Timestamps, session duration, alert counts', 'Audit and compliance'],
          ]} headers={['Data Type', 'Description', 'Purpose']} />
        </Section>

        <Section title="3. Legal Basis for Processing">
          <Table rows={[
            ['Biometric data (keystroke, facial)', 'Explicit consent (Art. 6(1)(a) + Art. 9(2)(a) GDPR)', 'Withdrawn at any time via account deletion request'],
            ['Session metadata', 'Legitimate interest (Art. 6(1)(f)) / Contract (Art. 6(1)(b))', 'Fraud prevention and service delivery'],
            ['Document forensic data', 'Consent of the operator + data subject where applicable', 'Fraud detection in document workflows'],
          ]} headers={['Category', 'Legal Basis', 'Notes']} />
        </Section>

        <Section title="4. Privacy by Design Architecture">
          <p>Deep-Check is architected to minimise biometric data exposure:</p>
          <ul>
            <li><strong>Client-side processing</strong> — All biometric signal extraction (face detection, keystroke analysis) runs entirely in the user&apos;s browser using WebAssembly (ONNX Runtime Web) and the Canvas API. Raw video frames and keystroke events never leave the device.</li>
            <li><strong>Vector-only transmission</strong> — Only derived numerical feature vectors (18 floating-point values) are sent to our servers for ML inference. These vectors cannot be used to reconstruct the original biometric signal.</li>
            <li><strong>No persistent raw biometrics</strong> — We do not store video recordings, audio, raw images, or keystroke sequences. Enrollment profiles store statistical aggregates (mean, standard deviation) only.</li>
            <li><strong>Automatic expiry</strong> — Enrollment profiles expire after 90 days and are permanently deleted.</li>
            <li><strong>Pseudonymisation</strong> — Sessions are identified by UUIDs with no direct link to personal identity unless explicitly provided by the operator.</li>
          </ul>
        </Section>

        <Section title="5. Data Retention">
          <Table rows={[
            ['Enrollment biometric profiles', '90 days from creation', 'Automatic deletion on expiry'],
            ['Session assessments', '12 months', 'Operator may request earlier deletion'],
            ['Document forensic analyses', '24 months', 'Required for audit trail integrity'],
            ['API keys', 'Until revoked by operator', 'Active key management required'],
            ['Server logs', '30 days', 'Security and debugging only'],
          ]} headers={['Data Type', 'Retention Period', 'Notes']} />
        </Section>

        <Section title="6. Data Transfers">
          <p>Data is stored in Supabase infrastructure hosted in the EU (eu-west-1, Ireland).
          No personal data is transferred to third countries outside the EEA without appropriate
          safeguards (Standard Contractual Clauses or adequacy decision).</p>
          <p>Sub-processors:</p>
          <ul>
            <li><strong>Supabase Inc.</strong> — Database and storage (DPA in place, EU hosting)</li>
            <li><strong>Vercel Inc.</strong> — Application hosting (DPA in place, EU edge nodes available)</li>
          </ul>
        </Section>

        <Section title="7. Your Rights (GDPR Articles 15–22)">
          <Table rows={[
            ['Access (Art. 15)', 'Request a copy of all personal data we hold about you'],
            ['Rectification (Art. 16)', 'Correct inaccurate data'],
            ['Erasure (Art. 17)', 'Request deletion of your data ("right to be forgotten")'],
            ['Portability (Art. 20)', 'Receive your data in a machine-readable format'],
            ['Object (Art. 21)', 'Object to processing based on legitimate interest'],
            ['Withdraw consent (Art. 7(3))', 'Withdraw consent for biometric processing at any time — without affecting prior lawful processing'],
            ['Lodge a complaint', 'Contact your national supervisory authority (Spain: AEPD — www.aepd.es)'],
          ]} headers={['Right', 'Description']} />
          <p>To exercise any right: <a href="mailto:privacy@deep-check.io">privacy@deep-check.io</a> — we respond within 30 days.</p>
        </Section>

        <Section title="8. Cookies">
          <p>Deep-Check uses only technically necessary cookies (session state, authentication tokens).
          We do not use advertising, tracking, or analytics cookies without your consent.
          A consent banner is shown on first visit for any non-essential cookies.</p>
        </Section>

        <Section title="9. EU AI Act Compliance">
          <p>Deep-Check operates identity verification systems that may fall under the EU AI Act
          (Regulation 2024/1689) as high-risk AI systems in the context of employment and
          education access (Annex III). We are committed to:</p>
          <ul>
            <li>Maintaining a technical documentation file per Article 11</li>
            <li>Implementing human oversight mechanisms per Article 14</li>
            <li>Ensuring transparency toward affected persons per Article 13</li>
            <li>Conducting conformity assessments prior to deployment in regulated contexts</li>
          </ul>
          <p>Contact <a href="mailto:compliance@deep-check.io">compliance@deep-check.io</a> for
          AI Act compliance documentation requests.</p>
        </Section>

        <Section title="10. Changes to This Policy">
          <p>We will notify operators of material changes 30 days in advance via email.
          The current version is always available at this URL. Previous versions are
          available on request.</p>
        </Section>

        <div className={styles.footer}>
          <Link href="/terms">Terms of Service</Link>
          <Link href="/security">Security Policy</Link>
          <Link href="/whitepaper">Technical Whitepaper</Link>
          <a href="mailto:privacy@deep-check.io">privacy@deep-check.io</a>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  )
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>{headers.map(h => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
