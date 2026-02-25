import Link from 'next/link'
import styles from '../privacy/page.module.css'

export const metadata = {
  title: 'Terms of Service — Deep-Check',
  description: 'Terms governing use of the Deep-Check identity verification and document forensics platform.',
}

export default function TermsPage() {
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

        <h1 className={styles.title}>Terms of Service</h1>
        <p className={styles.subtitle}>
          These terms govern access to and use of the Deep-Check platform by operators
          and their end users. Please read carefully before use.
        </p>

        <S title="1. Definitions">
          <p><strong>&ldquo;Deep-Check&rdquo;</strong> — the platform, software, APIs, and related services provided by Deep-Check Inc.</p>
          <p><strong>&ldquo;Operator&rdquo;</strong> — any business or organisation that integrates Deep-Check into their workflow via the web platform or API.</p>
          <p><strong>&ldquo;Candidate / Data Subject&rdquo;</strong> — any individual whose biometric data is processed through Deep-Check at the direction of an Operator.</p>
          <p><strong>&ldquo;Session&rdquo;</strong> — a single continuous verification event (interview, exam, document analysis).</p>
        </S>

        <S title="2. Acceptable Use">
          <p>Deep-Check may only be used for lawful purposes. Permitted uses include:</p>
          <ul>
            <li>Remote technical interview verification</li>
            <li>Online examination and certification proctoring</li>
            <li>Document authenticity verification for administrative processes</li>
            <li>Identity verification in regulated financial or legal workflows</li>
          </ul>
          <p>Prohibited uses include:</p>
          <ul>
            <li>Mass surveillance or population monitoring</li>
            <li>Verification of minors under 16 without explicit parental consent</li>
            <li>Any use that violates applicable anti-discrimination law</li>
            <li>Processing in jurisdictions where biometric processing is prohibited</li>
            <li>Using Deep-Check output as the <em>sole</em> automated decision basis without human oversight</li>
          </ul>
        </S>

        <S title="3. Operator Responsibilities">
          <p>Operators are responsible for:</p>
          <ul>
            <li>Obtaining valid, explicit consent from Candidates before initiating biometric processing</li>
            <li>Providing Candidates with this Privacy Policy and a clear explanation of how Deep-Check is used</li>
            <li>Ensuring their use of Deep-Check complies with applicable local law, including GDPR, the EU AI Act, and sector-specific regulation</li>
            <li>Implementing appropriate human review processes — Deep-Check scores are advisory, not determinative</li>
            <li>Maintaining a Data Processing Agreement (DPA) with Deep-Check Inc. before processing personal data (available on request)</li>
          </ul>
        </S>

        <S title="4. Human Oversight Requirement">
          <div className={styles.alert}>
            <strong>Important — AI Act Article 14 Compliance</strong><br />
            Deep-Check is an AI-assisted decision-support tool. Its outputs (trust scores, risk levels,
            forensic alerts) must be reviewed by a qualified human before being used to make decisions
            that affect individuals. Operators must not use Deep-Check output as the sole basis for
            rejection, disqualification, or adverse action against a Candidate.
          </div>
        </S>

        <S title="5. Accuracy and Limitations">
          <p>Deep-Check&apos;s detection capabilities are based on statistical models trained on synthetic and
          real-world data. No biometric or forensic system achieves 100% accuracy. Operators acknowledge:</p>
          <ul>
            <li>False positives (legitimate users flagged) and false negatives (fraud missed) will occur</li>
            <li>System performance may vary across device types, lighting conditions, and user populations</li>
            <li>Forensic document analysis is indicative, not legally conclusive, without additional expert validation</li>
            <li>Model performance metrics are provided in the Technical Whitepaper and are subject to revision</li>
          </ul>
        </S>

        <S title="6. Data Processing Agreement">
          <p>For operators processing personal data of EU residents, a Data Processing Agreement (DPA)
          compliant with GDPR Article 28 is available. Contact
          <a href="mailto:legal@deep-check.io"> legal@deep-check.io</a> to execute a DPA before
          live deployment.</p>
        </S>

        <S title="7. Service Availability">
          <p>Deep-Check is provided &ldquo;as-is&rdquo; during the beta period. We target 99.5% uptime but
          make no formal SLA guarantee until enterprise contracts are in place. Planned maintenance
          will be communicated 48 hours in advance.</p>
        </S>

        <S title="8. Intellectual Property">
          <p>All Deep-Check software, models, algorithms, and documentation are the intellectual
          property of Deep-Check Inc. Operators receive a limited, non-exclusive, non-transferable
          licence to use the platform for their permitted purposes.</p>
        </S>

        <S title="9. Limitation of Liability">
          <p>To the maximum extent permitted by law, Deep-Check shall not be liable for indirect,
          incidental, or consequential damages arising from use of the platform. Total liability
          in any 12-month period shall not exceed fees paid by the Operator in that period.</p>
        </S>

        <S title="10. Governing Law">
          <p>These terms are governed by the laws of Spain. Any dispute shall be subject to the
          exclusive jurisdiction of the courts of Madrid, Spain, without prejudice to mandatory
          consumer protection rights under EU law.</p>
        </S>

        <S title="11. Contact">
          <p>Legal: <a href="mailto:legal@deep-check.io">legal@deep-check.io</a><br />
          DPA requests: <a href="mailto:legal@deep-check.io">legal@deep-check.io</a><br />
          Compliance: <a href="mailto:compliance@deep-check.io">compliance@deep-check.io</a></p>
        </S>

        <div className={styles.footer}>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/security">Security Policy</Link>
          <Link href="/whitepaper">Technical Whitepaper</Link>
          <a href="mailto:legal@deep-check.io">legal@deep-check.io</a>
        </div>
      </div>
    </div>
  )
}

function S({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  )
}
