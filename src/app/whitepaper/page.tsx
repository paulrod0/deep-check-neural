import Link from 'next/link'
import styles from '../privacy/page.module.css'
import wpStyles from './page.module.css'

export const metadata = {
  title: 'Technical Whitepaper — Deep-Check',
  description: 'Technical methodology behind Deep-Check continuous identity verification and document forensics platform.',
}

export default function WhitepaperPage() {
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.header}>
          <Link href="/" className={styles.back}>← Deep-Check</Link>
          <div className={styles.meta}>
            <span className={styles.version}>Whitepaper v1.0</span>
            <span className={styles.date}>February 2026</span>
          </div>
        </div>

        <div className={wpStyles.titleBlock}>
          <div className={wpStyles.label}>Technical Whitepaper</div>
          <h1 className={wpStyles.title}>Deep-Check: Continuous Identity Verification and Document Forensics for the Synthetic Era</h1>
          <p className={wpStyles.authors}>Deep-Check Research Team · February 2026</p>
        </div>

        <div className={wpStyles.abstract}>
          <h2>Abstract</h2>
          <p>
            We present Deep-Check, a multi-modal continuous identity verification platform that
            combines keystroke dynamics biometrics, facial liveness detection, and document forensics
            to detect fraud in remote sessions and document submission workflows. The system operates
            entirely client-side for biometric signal extraction, transmitting only derived feature
            vectors for server-side ML inference. We describe the architecture of three analytical
            modules — behavioral biometrics, anti-deepfake liveness, and image forensics — and
            report performance characteristics under controlled evaluation conditions. The platform
            is designed to comply with GDPR, the EU AI Act, and best practices for privacy-by-design
            in biometric systems.
          </p>
        </div>

        <S title="1. Introduction">
          <p>
            The proliferation of generative AI tools (large language models, image synthesis, voice
            cloning, and deepfake video generation) has fundamentally altered the threat landscape
            for remote identity verification. A remote candidate can now pass a technical interview
            using LLM-generated code, present a synthetic face via a virtual camera, and submit
            AI-generated supporting documents — all while appearing entirely legitimate to a human
            reviewer.
          </p>
          <p>
            Existing point-in-time identity verification solutions (document scanning at login,
            facial recognition at session start) are insufficient because they verify identity
            once and assume continuity. Deep-Check addresses this by continuously verifying
            behavioural consistency throughout a session, not just at its inception.
          </p>
          <p>
            This whitepaper describes the technical design of three integrated modules:
          </p>
          <ul>
            <li><strong>Module 1 — Keystroke Biometrics:</strong> Continuous typing pattern analysis for identity continuity and AI-assisted input detection</li>
            <li><strong>Module 2 — Facial Liveness:</strong> Real-time detection of deepfakes, virtual cameras, and pre-recorded video spoofs</li>
            <li><strong>Module 3 — Document Forensics:</strong> Analysis of submitted images for manipulation, AI generation, and metadata falsification</li>
          </ul>
        </S>

        <S title="2. Module 1 — Keystroke Biometrics">
          <h3>2.1 Signal Capture</h3>
          <p>
            Keystroke dynamics are captured at the DOM event level via <code>keydown</code> and
            <code>keyup</code> listeners on a Monaco editor instance. Two primary timing signals
            are extracted:
          </p>
          <ul>
            <li><strong>Flight time</strong> (inter-key interval): Time in milliseconds between <code>keyup</code> of key N and <code>keydown</code> of key N+1. Human neuromotor minimum is approximately 15ms; values below this threshold indicate synthetic input.</li>
            <li><strong>Hold time</strong> (key duration): Time between <code>keydown</code> and <code>keyup</code> for a single key. Typically 40–120ms in natural typing.</li>
          </ul>
          <p>
            In addition to single-key timing, bigram timing (digrams) is collected: the flight
            time for specific key-pair transitions (e.g., &ldquo;t→h&rdquo;, &ldquo;i→o&rdquo;). These transition
            times are highly stable within an individual and vary significantly across individuals,
            making them useful for identity matching beyond aggregate statistics.
          </p>

          <h3>2.2 Feature Extraction (high-dimensional vector)</h3>
          <p>
            A proprietary multi-dimensional feature vector is computed from a rolling window of
            keystroke events and submitted to the ML inference endpoint. The vector spans four
            families of biometric signals:
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Family</th><th>Signal Type</th><th>Description</th></tr></thead>
              <tbody>
                {[
                  ['Temporal dynamics', 'Flight &amp; hold statistics', 'Mean, standard deviation, skewness, and kurtosis of inter-key intervals and key-hold durations. Captures the stochastic variability unique to human motor execution.'],
                  ['Entropic structure', 'Shannon entropy (multi-channel)', 'Information-theoretic measure of distributional regularity applied independently to flight and hold histograms. Synthetic input exhibits characteristically low entropy.'],
                  ['Rhythmic periodicity', 'Spectral analysis (FFT)', 'Dominant-frequency amplitude computed via Fast Fourier Transform over the keystroke time series. Automated tools produce detectable periodic patterns absent in human typing.'],
                  ['Temporal evolution', 'Velocity &amp; fatigue signals', 'Linear trend and regression slope of typing speed over the session. Human typists exhibit measurable fatigue drift; programmatic input does not.'],
                  ['Micro-correction behaviour', 'Correction keystroke analysis', 'Statistical properties of correction keystrokes (timing, frequency, reaction latency) that reflect genuine cognitive load and error-correction cycles.'],
                  ['Bigram biometrics', 'Digraph pair consistency', 'Pair-wise inter-key interval variability across all observed character combinations. Each person exhibits a stable, unique bigram profile that is computationally expensive to replicate.'],
                  ['Burst injection detection', 'Sub-100ms key cluster rate', 'Rate of implausibly fast multi-key clusters per session volume. Paste injection, clipboard automation, and LLM-assisted input produce anomalous burst patterns.'],
                  ['Session throughput', 'Effective typing velocity', 'Derived words-per-minute with outlier sensitivity for both extremes of the human plausible range.'],
                ].map(([family, signal, desc]) => (
                  <tr key={family}><td><strong>{family}</strong></td><td>{signal}</td><td dangerouslySetInnerHTML={{__html: desc}} /></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{fontSize: '0.85em', color: '#666', marginTop: 12}}>
            Exact feature definitions, internal identifiers, and weighting coefficients are proprietary
            and withheld to prevent adversarial calibration. The full specification is available to
            authorised partners under NDA.
          </p>

          <h3>2.3 ML Model</h3>
          <p>
            The classification layer uses a <strong>dual-model ensemble</strong> architecture
            combining a supervised gradient-boosted classifier with an unsupervised anomaly
            detection layer trained exclusively on genuine human sessions. The ensemble design
            requires an adversary to simultaneously fool two independent statistical models —
            one optimised for class separation, one for novelty detection — substantially
            raising the cost of evasion attacks compared to single-model systems.
          </p>
          <p>
            Models are exported to ONNX format for server-side inference using <code>onnxruntime-node</code>,
            ensuring deterministic, version-controlled inference independent of client device
            capabilities. Model artifacts are stored outside the public HTTP path and are not
            directly accessible to clients.
          </p>
          <p>
            Internal architecture details (tree count, feature weights, decision thresholds,
            and training data distributions) are withheld to prevent adversarial calibration.
          </p>

          <h3>2.4 Adaptive Baseline (Identity Matching)</h3>
          <p>
            When an enrollment profile exists for the session candidate, a Mahalanobis distance
            comparison is performed between the live session&apos;s feature distribution and the
            enrollment baseline. The identity match score is computed as:
          </p>
          <div className={wpStyles.formula}>
            <code>match_score = 100 × exp(−λ × √Σ((xᵢ − μᵢ)² / σᵢ²))</code>
          </div>
          <p style={{fontSize: '0.85em', color: '#666', marginTop: 8}}>
            The decay constant λ is calibrated from enrollment validation data and withheld.
          </p>
          <p>
            The Welford online algorithm is used to update the adaptive baseline during a session,
            allowing the system to account for fatigue and context-switching without being locked
            to initial typing conditions.
          </p>
        </S>

        <S title="3. Module 2 — Facial Liveness Detection">
          <h3>3.1 Architecture</h3>
          <p>
            Liveness detection runs entirely client-side using face-api.js with the
            TinyFaceDetector (SSD MobileNetV1-derived, ~190KB) and the 68-point
            FaceLandmark68Net models, both loaded from <code>/public/models/</code>.
            No video data is transmitted to the server.
          </p>

          <h3>3.2 Detection Signals</h3>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Signal</th><th>Method</th><th>Deepfake/Spoof Indicator</th></tr></thead>
              <tbody>
                {[
                  ['Blink detection', 'Eye Aspect Ratio (EAR) via landmarks 36–41, 42–47', 'Blink rate <2/min (photo) or >50/min (artifact). GAN deepfakes often blink at unnatural rates'],
                  ['Micro-saccades', 'Variance of horizontal gaze ratio across 60-frame history', 'Real eyes have micro-jerk movements; deepfake video is unnaturally smooth (score <10 = suspicious)'],
                  ['Lighting challenge', 'Screen flashes white (500ms); EAR measured during flash', 'Real pupils constrict and gaze changes; pre-recorded video shows no response'],
                  ['Blink edge trajectory', 'Eyelid closure speed symmetry analysis', 'AI renderers often show unnatural snap-close without the natural asymmetric trajectory'],
                  ['Oculo-manual desync', 'Cross-correlation between cursor movement and gaze direction', 'Virtual camera: cursor active but gaze frozen on fixed point'],
                  ['Micro-movements', 'Nose tip position variance over time', 'Photo: zero variance. Deepfake: artificially periodic. Human: stochastic'],
                ].map(([sig, method, ind]) => (
                  <tr key={sig}><td>{sig}</td><td>{method}</td><td>{ind}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>3.3 False Positive Mitigation</h3>
          <p>
            Conservative thresholds, multi-frame consensus requirements, and 60-second cooldowns
            between alerts prevent alert flooding from normal user behaviour (reading pauses,
            natural gaze variation, corrective blinking). All camera-based alerts require
            a 7-second startup grace period to account for camera initialisation artefacts.
          </p>
        </S>

        <S title="4. Module 3 — Document Forensics">
          <h3>4.1 Error Level Analysis (ELA)</h3>
          <p>
            ELA exploits the lossy compression model of JPEG encoding. When a JPEG image
            is re-saved at a known quality level (Q=75), regions that have already been
            compressed at that quality show minimal change, while regions that were edited
            and re-saved at a different quality show larger discrepancies. This differential
            is amplified (×12) and rendered as a heatmap.
          </p>
          <p>
            The ELA score is derived from the mean heatmap brightness (normalised to 255)
            and the fraction of 8×8 blocks with mean brightness above a 40-point threshold:
          </p>
          <div className={wpStyles.formula}>
            <code>ela_score = 0.60 × (mean_diff / 255 × 100) + 0.40 × (suspicious_blocks / total_blocks × 100)</code>
          </div>
          <p>
            AI-generated images that have never been JPEG-compressed score anomalously low on ELA
            (absence of compression artefacts is itself a signal). This is captured by the noise module.
          </p>

          <h3>4.2 EXIF Metadata Analysis</h3>
          <p>
            EXIF metadata is extracted using <code>exifr</code> (client-side, no server upload).
            Anomaly signals include:
          </p>
          <ul>
            <li>Presence of known editing software strings (Photoshop, GIMP, Affinity, Canva, Stable Diffusion, Midjourney, DALL-E) in the <code>Software</code> or <code>CreatorTool</code> fields</li>
            <li>Discrepancy between <code>DateTimeOriginal</code> and <code>DateTime</code> exceeding 60 seconds</li>
            <li>Absence of <code>Make</code> and <code>Model</code> fields (camera metadata always present in genuine device captures)</li>
            <li>Complete absence of EXIF data (common in screenshots and synthetic images)</li>
          </ul>

          <h3>4.3 Noise Uniformity Analysis (AI Image Detection)</h3>
          <p>
            Images generated by diffusion models (Stable Diffusion, DALL-E, Midjourney) and
            GAN architectures exhibit characteristically uniform noise distributions. Real
            photographs contain heterogeneous noise from sensor shot noise, JPEG quantisation,
            and scene variation. Deep-Check computes:
          </p>
          <ul>
            <li><strong>Laplacian variance</strong> — Measures high-frequency content. Low values indicate unnaturally smooth images.</li>
            <li><strong>Block variance coefficient of variation</strong> — Standard deviation of per-16×16-block variance, divided by mean block variance. Real photos: high CV. AI images: low CV (uniform).</li>
          </ul>
          <div className={wpStyles.formula}>
            <code>noise_score = 0.65 × uniformity_score + 0.35 × laplacian_flag</code>
          </div>

          <h3>4.4 Aggregate Risk Score</h3>
          <div className={wpStyles.formula}>
            <code>risk_score = 0.50 × ela_score + 0.30 × exif_score + 0.20 × noise_score</code>
          </div>
          <p>Risk levels: 0–29 = Clean · 30–59 = Suspicious · 60–100 = High Risk</p>
        </S>

        <S title="5. Privacy Architecture">
          <p>Deep-Check is built privacy-first:</p>
          <ul>
            <li>All signal extraction runs client-side in the browser. Raw video, audio, and keystroke sequences never leave the user&apos;s device.</li>
            <li>Only derived numerical feature vectors (18 floats for keystroke, statistical aggregates for enrollment) are transmitted over HTTPS.</li>
            <li>Document forensic analysis (ELA, EXIF, noise) is fully client-side. Only the final scores and metadata are persisted — not the original image.</li>
            <li>Enrollment profiles store only mean, standard deviation, and bigram statistics — not reconstructable biometric signals.</li>
            <li>All biometric profiles expire after 90 days and are hard-deleted from the database.</li>
          </ul>
        </S>

        <S title="6. Known Limitations">
          <ul>
            <li><strong>Training data:</strong> The keystroke ML model is trained on synthetic data. Performance on real-world diverse user populations has not been formally evaluated. A validation study with a representative sample is planned.</li>
            <li><strong>Device variation:</strong> Keystroke timing is affected by keyboard type (mechanical, membrane, touchscreen). The adaptive baseline partially compensates for this but does not fully normalise cross-device variation.</li>
            <li><strong>ELA limitations:</strong> ELA is ineffective on PNG files (lossless compression) and on images that have been upscaled, screenshotted, or processed through a lossless pipeline before JPEG compression.</li>
            <li><strong>AI image detection:</strong> As generative models evolve, their noise characteristics change. The current noise analysis is based on known model families as of early 2026.</li>
            <li><strong>No 100% guarantee:</strong> No biometric or forensic system achieves perfect accuracy. Deep-Check outputs are probabilistic and should always be combined with human review.</li>
          </ul>
        </S>

        <S title="7. Roadmap">
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Item</th><th>Target</th></tr></thead>
              <tbody>
                {[
                  ['Independent algorithm audit by external cybersecurity firm', 'Q3 2026'],
                  ['Validation study on real-world diverse keystroke population', 'Q3 2026'],
                  ['DPIA (Data Protection Impact Assessment) completion', 'Q2 2026'],
                  ['EU AI Act technical documentation (Article 11)', 'Q3 2026'],
                  ['ISO 27001 certification process initiation', 'Q1 2027'],
                  ['ENS (Esquema Nacional de Seguridad) certification', 'Q2 2027'],
                  ['Publication of peer-reviewed technical paper', 'Q4 2026'],
                  ['Video deepfake detection via temporal consistency analysis', 'Q4 2026'],
                  ['PDF document forensics (embedded image ELA, font analysis)', 'Q3 2026'],
                ].map(([item, target]) => (
                  <tr key={item}><td>{item}</td><td style={{ whiteSpace: 'nowrap' }}>{target}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </S>

        <S title="8. Contact & Citations">
          <p>For technical questions, partnership inquiries, or to request a Data Processing Agreement:</p>
          <ul>
            <li>Technical: <a href="mailto:research@deep-check.io">research@deep-check.io</a></li>
            <li>Compliance: <a href="mailto:compliance@deep-check.io">compliance@deep-check.io</a></li>
            <li>Legal / DPA: <a href="mailto:legal@deep-check.io">legal@deep-check.io</a></li>
          </ul>
          <p className={wpStyles.cite}>
            Deep-Check Technical Whitepaper v1.0 · February 2026 · Deep-Check Inc.<br />
            This document is provided for informational purposes. Performance metrics are
            derived from internal evaluation and are subject to revision following independent audit.
          </p>
        </S>

        <div className={styles.footer}>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
          <Link href="/security">Security Policy</Link>
          <a href="mailto:research@deep-check.io">research@deep-check.io</a>
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
