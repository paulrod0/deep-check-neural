/**
 * Deep-Check — Certificate Generator
 *
 * Genera un PDF de certificado de autenticidad de sesión con:
 * - Score de integridad
 * - Hash SHA-256 de sesión (verificable externamente)
 * - Resumen de métricas biométricas
 * - Firma visual del sistema
 *
 * Usa jsPDF (client-side only, no servidor)
 */

export interface CertificateData {
    id: string
    candidateName: string
    role: string
    date: string
    score: number
    status: 'passed' | 'review' | 'flagged'
    sessionHash: string
    livenessScore?: number
    aiRisk?: number
    keystrokeCount?: number
    tabSwitchCount?: number
    gazeEventCount?: number
    identityMatchScore?: number
    alertCount: number
    evidenceCount: number
    enrollmentProfileId?: string
}

export async function generateCertificatePDF(data: CertificateData): Promise<void> {
    // Dynamic import — jsPDF is client-side only
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

    const W = 210
    const H = 297
    const PL = 24  // padding left
    const PR = W - 24  // padding right

    // ── Background ───────────────────────────────────────────────────────────
    doc.setFillColor(10, 12, 18)
    doc.rect(0, 0, W, H, 'F')

    // ── Top accent bar ────────────────────────────────────────────────────────
    const statusColor = data.status === 'passed' ? [0, 212, 127] as [number,number,number]
                      : data.status === 'review'  ? [255, 215, 0] as [number,number,number]
                      : [255, 77, 77] as [number,number,number]
    doc.setFillColor(...statusColor)
    doc.rect(0, 0, W, 3, 'F')

    // ── Header ────────────────────────────────────────────────────────────────
    doc.setFontSize(9)
    doc.setTextColor(100, 110, 130)
    doc.text('DEEP-CHECK VERIFICATION SYSTEM', PL, 20)

    doc.setFontSize(26)
    doc.setTextColor(240, 242, 248)
    doc.setFont('helvetica', 'bold')
    doc.text('Certificate of Authenticity', PL, 34)

    doc.setFontSize(9)
    doc.setTextColor(100, 110, 130)
    doc.setFont('helvetica', 'normal')
    doc.text('Behavioral Biometric Session Report', PL, 41)

    // Score circle (right side)
    const scoreColor = data.score > 85 ? statusColor : data.score > 60 ? [255, 215, 0] as [number,number,number] : [255, 77, 77] as [number,number,number]
    doc.setFillColor(20, 24, 36)
    doc.circle(PR - 16, 28, 16, 'F')
    doc.setDrawColor(...scoreColor)
    doc.setLineWidth(1.5)
    doc.circle(PR - 16, 28, 16, 'S')
    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...scoreColor)
    doc.text(`${data.score}%`, PR - 16, 31, { align: 'center' })
    doc.setFontSize(6)
    doc.setTextColor(100, 110, 130)
    doc.text('TRUST SCORE', PR - 16, 37, { align: 'center' })

    // Status badge
    doc.setFillColor(...statusColor)
    doc.roundedRect(PR - 38, 46, 28, 7, 2, 2, 'F')
    doc.setFontSize(7)
    doc.setTextColor(10, 12, 18)
    doc.setFont('helvetica', 'bold')
    const statusText = data.status === 'passed' ? 'PASSED' : data.status === 'review' ? 'REVIEW' : 'FLAGGED'
    doc.text(statusText, PR - 24, 51, { align: 'center' })

    // ── Divider ───────────────────────────────────────────────────────────────
    doc.setDrawColor(40, 45, 60)
    doc.setLineWidth(0.3)
    doc.line(PL, 58, PR, 58)

    // ── Candidate info ────────────────────────────────────────────────────────
    let y = 70

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(240, 242, 248)
    doc.text(data.candidateName, PL, y)

    y += 7
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(150, 160, 180)
    doc.text(`${data.role}  ·  ${data.date}  ·  Session: ${data.id}`, PL, y)

    // ── Metrics grid ─────────────────────────────────────────────────────────
    y += 14
    const metrics = [
        { label: 'Liveness Score',     value: `${data.livenessScore ?? '—'}%`,          ok: (data.livenessScore ?? 0) > 70 },
        { label: 'AI Risk',            value: `${data.aiRisk ?? 0}%`,                   ok: (data.aiRisk ?? 0) < 30 },
        { label: 'Keystrokes',         value: `${data.keystrokeCount ?? 0}`,             ok: true },
        { label: 'Tab Switches',       value: `${data.tabSwitchCount ?? 0}`,             ok: (data.tabSwitchCount ?? 0) < 2 },
        { label: 'Gaze Events',        value: `${data.gazeEventCount ?? 0}`,             ok: (data.gazeEventCount ?? 0) < 5 },
        { label: 'Security Incidents', value: `${data.alertCount}`,                      ok: data.alertCount < 3 },
        { label: 'Evidence Captures',  value: `${data.evidenceCount}`,                   ok: data.evidenceCount < 3 },
        ...(data.identityMatchScore !== undefined ? [{
            label: 'Identity Match',
            value: `${data.identityMatchScore}%`,
            ok: data.identityMatchScore > 70,
        }] : []),
    ]

    const cols = 4
    const colW = (PR - PL) / cols
    const rowH = 18

    metrics.forEach((m, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        const x   = PL + col * colW
        const ry  = y + row * rowH

        doc.setFillColor(18, 22, 32)
        doc.roundedRect(x + 1, ry - 6, colW - 2, rowH - 2, 2, 2, 'F')

        doc.setFontSize(7)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(100, 110, 130)
        doc.text(m.label.toUpperCase(), x + 5, ry + 1)

        const valColor: [number, number, number] = m.ok ? [0, 212, 127] : [255, 77, 77]
        doc.setFontSize(11)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(...valColor)
        doc.text(m.value, x + 5, ry + 9)
    })

    const gridRows = Math.ceil(metrics.length / cols)
    y += gridRows * rowH + 8

    // ── Session hash ──────────────────────────────────────────────────────────
    doc.setDrawColor(40, 45, 60)
    doc.setLineWidth(0.3)
    doc.line(PL, y, PR, y)
    y += 10

    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(0, 212, 127)
    doc.text('SESSION INTEGRITY HASH  (SHA-256)', PL, y)

    y += 6
    doc.setFontSize(7.5)
    doc.setFont('courier', 'normal')
    doc.setTextColor(180, 190, 210)

    // Split hash into two lines of 32 chars each
    const hash = data.sessionHash
    doc.text(hash.slice(0, 32), PL, y)
    doc.text(hash.slice(32), PL, y + 5)

    y += 14
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(80, 90, 110)
    doc.text(
        'This hash is a SHA-256 digest of the session metadata. It can be independently verified by recalculating',
        PL, y
    )
    y += 4.5
    doc.text(
        'the hash from the raw session JSON and comparing it against this value.',
        PL, y
    )

    // ── Behavioral summary ────────────────────────────────────────────────────
    y += 12
    doc.setFillColor(18, 22, 32)
    doc.roundedRect(PL, y - 4, PR - PL, 32, 3, 3, 'F')

    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(150, 160, 180)
    doc.text('BEHAVIORAL FORENSICS SUMMARY', PL + 5, y + 3)

    const summaryLines = [
        `Liveness Verification: ${(data.livenessScore ?? 0) > 70 ? 'Confirmed — face and movement detected throughout session' : 'Partial — low liveness confidence detected'}`,
        `Keystroke Dynamics: ${(data.aiRisk ?? 0) < 30 ? 'Human typing pattern — no automation signatures detected' : `AI-assist risk elevated to ${data.aiRisk}%`}`,
        `Session Integrity: ${data.alertCount === 0 ? 'Clean — no security incidents recorded' : `${data.alertCount} incident(s) recorded — see full report for details`}`,
    ]
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    summaryLines.forEach((line, i) => {
        doc.setTextColor(140, 150, 170)
        doc.text('·', PL + 5, y + 10 + i * 6)
        doc.setTextColor(200, 210, 230)
        doc.text(line, PL + 9, y + 10 + i * 6)
    })

    y += 38

    // ── Verification URL ──────────────────────────────────────────────────────
    doc.setDrawColor(40, 45, 60)
    doc.setLineWidth(0.3)
    doc.line(PL, y, PR, y)
    y += 8

    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(80, 90, 110)
    doc.text('Verify this certificate at:', PL, y)
    doc.setTextColor(0, 212, 127)
    // Include hash in URL so verifier can auto-check integrity
    const verifyUrl = `deep-check-two.vercel.app/verify/${data.id}?hash=${data.sessionHash}`
    doc.text(verifyUrl.slice(0, 80), PL + 38, y)
    if (verifyUrl.length > 80) {
        doc.text(verifyUrl.slice(80), PL + 38, y + 4)
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    doc.setFillColor(0, 212, 127)
    doc.rect(0, H - 2, W, 2, 'F')

    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(60, 70, 90)
    doc.text(
        `Generated by Deep-Check Verification System  ·  ${new Date().toISOString()}  ·  deep-check-two.vercel.app`,
        W / 2, H - 6,
        { align: 'center' }
    )

    // ── Save ──────────────────────────────────────────────────────────────────
    const filename = `deepcheck-certificate-${data.id}-${data.date}.pdf`
    doc.save(filename)
}
