#!/usr/bin/env node
'use strict'

const PDFDocument = require('pdfkit')
const fs          = require('fs')
const path        = require('path')

// ─── Brand palette ────────────────────────────────────────────────────────────
const C = {
    bg:      '#0a0a0c',
    surface: '#121216',
    card:    '#17171d',
    border:  '#27272a',
    primary: '#00ff9d',
    purple:  '#7000ff',
    gold:    '#ffd700',
    red:     '#ff4d4d',
    white:   '#ffffff',
    muted:   '#a1a1aa',
    dim:     '#52525b',
}

// hex → rgb array
function rgb(hex) {
    const n = parseInt(hex.replace('#',''), 16)
    return [(n>>16)&255, (n>>8)&255, n&255]
}

// ─── Document setup ───────────────────────────────────────────────────────────
const W = 841.89  // A4 landscape width  (pt)
const H = 595.28  // A4 landscape height (pt)

const doc = new PDFDocument({ size: [W, H], margin: 0, autoFirstPage: false })
const out = path.join(__dirname, '..', 'public', 'deep-check-deck.pdf')
doc.pipe(fs.createWriteStream(out))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fill(hex)   { const [r,g,b] = rgb(hex); doc.fillColor([r,g,b]); return doc }
function stroke(hex) { const [r,g,b] = rgb(hex); doc.strokeColor([r,g,b]); return doc }

function page(bg = C.bg) {
    doc.addPage({ size: [W, H], margin: 0 })
    fill(bg)
    doc.rect(0, 0, W, H).fill()
}

// Full-width horizontal gradient bar
function gradBar(y, h) {
    const grad = doc.linearGradient(0, y, W, y)
    grad.stop(0, rgb(C.primary))
    grad.stop(1, rgb(C.purple))
    doc.rect(0, y, W, h).fill(grad)
}

// Thin top accent line
function accentLine() {
    gradBar(0, 4)
}

// Section title (small cap label)
function tag(text, x, y, color = C.primary) {
    fill(color)
    doc.font('Helvetica-Bold').fontSize(9).text(text.toUpperCase(), x, y, { characterSpacing: 2 })
}

// Big headline
function h1(text, x, y, w, color = C.white, size = 42) {
    fill(color)
    doc.font('Helvetica-Bold').fontSize(size).text(text, x, y, { width: w, lineGap: 4 })
}

// Body paragraph
function body(text, x, y, w, color = C.muted, size = 13) {
    fill(color)
    doc.font('Helvetica').fontSize(size).text(text, x, y, { width: w, lineGap: 5 })
}

// Card (rounded rect background)
function card(x, y, w, h, bg = C.card, borderColor = C.border) {
    fill(bg)
    doc.roundedRect(x, y, w, h, 10).fill()
    stroke(borderColor)
    doc.roundedRect(x, y, w, h, 10).stroke()
}

// Metric big number
function metric(value, label, x, y, w, color = C.primary) {
    card(x, y, w, 90)
    fill(color)
    doc.font('Helvetica-Bold').fontSize(34).text(value, x, y + 14, { width: w, align: 'center' })
    fill(C.muted)
    doc.font('Helvetica').fontSize(10).text(label, x, y + 56, { width: w, align: 'center', characterSpacing: 1 })
}

// Icon bullet row
function bullet(icon, title, desc, x, y, w) {
    fill(C.primary)
    doc.font('Helvetica-Bold').fontSize(18).text(icon, x, y - 3, { width: 28 })
    fill(C.white)
    doc.font('Helvetica-Bold').fontSize(13).text(title, x + 34, y, { width: w - 34 })
    fill(C.muted)
    doc.font('Helvetica').fontSize(11).text(desc, x + 34, y + 18, { width: w - 34, lineGap: 3 })
}

// Page number
function pgNum(n, total) {
    fill(C.dim)
    doc.font('Helvetica').fontSize(9).text(`${n} / ${total}`, W - 60, H - 24)
}

// Vertical divider line
function vline(x, y1, y2, color = C.border) {
    stroke(color)
    doc.moveTo(x, y1).lineTo(x, y2).stroke()
}

// ─── Slide 1: Cover ───────────────────────────────────────────────────────────
page()
accentLine()

// Background glow blobs
fill(C.primary)
doc.circle(W * 0.72, H * 0.3, 180).fillOpacity(0.04).fill()
fill(C.purple)
doc.circle(W * 0.78, H * 0.75, 130).fillOpacity(0.06).fill()
doc.fillOpacity(1)

// Left panel
const LW = W * 0.55
tag('Continuous Identity Verification Platform', 60, 52)

fill(C.white)
doc.font('Helvetica-Bold').fontSize(72).text('Deep-Check.', 60, 110, { width: LW - 60 })

fill(C.muted)
doc.font('Helvetica').fontSize(16).text(
    'Detección en tiempo real de suplantación de identidad, asistencia de IA y fraude en procesos remotos — sin interrumpir al candidato.',
    60, 225, { width: LW - 80, lineGap: 7 }
)

// CTA pill
const grad1 = doc.linearGradient(60, 308, 240, 308)
grad1.stop(0, rgb(C.primary))
grad1.stop(1, rgb(C.purple))
doc.roundedRect(60, 300, 200, 46, 23).fill(grad1)
fill(C.bg)
doc.font('Helvetica-Bold').fontSize(13).text('Verificación Continua', 60, 316, { width: 200, align: 'center' })

// Right illustration panel — vertical stat cards
const RX = LW + 30
const CW  = W - RX - 40

;[
    { v: '99.4%',  l: 'Detección de deepfakes',  c: C.primary },
    { v: '<200ms', l: 'Latencia de análisis',      c: C.gold   },
    { v: '18',     l: 'Señales biométricas',       c: C.purple  },
    { v: '0',      l: 'Interrupciones al candidato', c: C.primary },
].forEach((s, i) => {
    metric(s.v, s.l, RX, 60 + i * 118, CW, s.c)
})

// Footer
fill(C.dim)
doc.font('Helvetica').fontSize(9)
    .text('© 2026 Hium Solutions · pablo@hiumsolutions.com · deep-check-two.vercel.app', 60, H - 24)

pgNum(1, 10)

// ─── Slide 2: El Problema ─────────────────────────────────────────────────────
page()
accentLine()

tag('El Problema', 60, 52)
h1('La Contratación Remota\nEstá Rota.', 60, 78, 420, C.white, 40)

fill(C.muted)
doc.font('Helvetica').fontSize(13).text(
    'La IA generativa ha eliminado todas las barreras para falsificar una entrevista de trabajo. Los equipos de RRHH no tienen herramientas para detectarlo.',
    60, 202, { width: 380, lineGap: 6 }
)

// 3 stat cards
const cards = [
    { n: '17%',     d: 'de los responsables de contratación han detectado candidatos suplantados con deepfake en 2024', c: C.red },
    { n: '1.300%',  d: 'de aumento interanual en intentos de fraude con deepfake en entrevistas remotas (2024)', c: C.gold },
    { n: '25%',     d: 'de los perfiles de candidatos serán falsos o generados por IA en 2028 (Gartner)', c: C.purple },
]
cards.forEach((s, i) => {
    const cx = 60 + i * 263
    card(cx, 300, 245, 210)
    fill(s.c)
    doc.font('Helvetica-Bold').fontSize(44).text(s.n, cx, 318, { width: 245, align: 'center' })
    fill(C.muted)
    doc.font('Helvetica').fontSize(11).text(s.d, cx + 14, 378, { width: 218, align: 'center', lineGap: 5 })
})

// Right: cost highlight
card(W - 240, 68, 198, 200, '#1a0a0a', '#ff4d4d')
fill(C.red)
doc.font('Helvetica-Bold').fontSize(13).text('COSTE MEDIO DE UNA', W - 226, 86, { width: 170 })
fill(C.white)
doc.font('Helvetica-Bold').fontSize(40).text('$30K', W - 226, 110, { width: 170, align: 'center' })
fill(C.red)
doc.font('Helvetica-Bold').fontSize(13).text('MALA CONTRATACIÓN REMOTA', W - 226, 162, { width: 170 })
fill(C.muted)
doc.font('Helvetica').fontSize(10).text('Incluyendo tiempo perdido, reputación y procesos repetidos', W - 226, 190, { width: 170, lineGap: 4 })

pgNum(2, 10)

// ─── Slide 3: La Solución ─────────────────────────────────────────────────────
page()
accentLine()

tag('La Solución', 60, 52)
h1('Verificación Continua,\nNo Solo al Inicio.', 60, 78, W - 120, C.white, 40)

body(
    'Deep-Check monitoriza al candidato durante TODA la prueba — cara, ojos, parpadeos, forma de escribir — sin que tenga que hacer nada diferente a contestar las preguntas.',
    60, 200, W - 120
)

// 3 pillar cards
const pillars = [
    {
        icon: '👁️',
        title: 'Firma Visual',
        color: C.primary,
        points: [
            'Detección facial continua con IA',
            'Análisis de parpadeos y micro-movimientos',
            'Reto fotométrico: el destello de pantalla detecta deepfakes',
            'Dirección de mirada y sincronía ojo-cursor',
        ],
    },
    {
        icon: '⌨️',
        title: 'ADN de Escritura',
        color: C.gold,
        points: [
            'Tiempo entre teclas (flight time) único por persona',
            'Patrón de ritmo, fatiga y distribución estadística',
            'Detección de asistencia de IA (burst, periodicidad)',
            'Comparación con perfil biométrico previo (enrollment)',
        ],
    },
    {
        icon: '🔒',
        title: 'Prueba Forense',
        color: C.purple,
        points: [
            'Capturas automáticas con cada evento sospechoso',
            'Trail de auditoría con hash SHA-256 inalterable',
            'Score de confianza en tiempo real (0–100%)',
            'Certificado PDF verificable públicamente',
        ],
    },
]

pillars.forEach((p, i) => {
    const cx = 60 + i * 265
    card(cx, 268, 248, 270, C.card, C.border)
    // Color top bar
    const pGrad = doc.linearGradient(cx, 268, cx + 248, 268)
    pGrad.stop(0, rgb(p.color))
    pGrad.stop(1, rgb(C.bg))
    doc.rect(cx, 268, 248, 4).fill(pGrad)

    fill(p.color)
    doc.font('Helvetica-Bold').fontSize(22).text(p.icon, cx + 14, 284)
    fill(C.white)
    doc.font('Helvetica-Bold').fontSize(16).text(p.title, cx + 48, 288, { width: 190 })

    p.points.forEach((pt, j) => {
        fill(p.color)
        doc.font('Helvetica-Bold').fontSize(11).text('›', cx + 14, 326 + j * 44)
        fill(C.muted)
        doc.font('Helvetica').fontSize(10).text(pt, cx + 28, 326 + j * 44, { width: 210, lineGap: 3 })
    })
})

pgNum(3, 10)

// ─── Slide 4: Cómo Funciona ───────────────────────────────────────────────────
page()
accentLine()

tag('Cómo Funciona · Para No Técnicos', 60, 52)
h1('Tan Simple Como\nHacer una Videollamada.', 60, 78, 500, C.white, 38)

// Flow diagram — horizontal steps
const steps = [
    { n: '1', title: 'El candidato\nabre el enlace', desc: 'Sin instalar nada. Solo navegador y cámara web.', icon: '🔗' },
    { n: '2', title: 'Autoriza cámara\ny empieza a escribir', desc: 'La IA analiza en segundo plano. No interrumpe.', icon: '💻' },
    { n: '3', title: 'Sistema monitoriza\nen tiempo real', desc: '18 señales biométricas activas simultáneamente.', icon: '📡' },
    { n: '4', title: 'RRHH recibe\nel informe', desc: 'Score de confianza + evidencias + certificado.', icon: '📊' },
]

steps.forEach((s, i) => {
    const sx = 48 + i * 200
    card(sx, 240, 180, 240, C.card, C.border)

    // Step number circle
    const grad = doc.linearGradient(sx + 14, 256, sx + 50, 256)
    grad.stop(0, rgb(C.primary))
    grad.stop(1, rgb(C.purple))
    doc.circle(sx + 32, 272, 20).fill(grad)
    fill(C.bg)
    doc.font('Helvetica-Bold').fontSize(16).text(s.n, sx + 22, 264, { width: 20, align: 'center' })

    fill(C.white)
    doc.font('Helvetica-Bold').fontSize(26).text(s.icon, sx + 58, 258)

    fill(C.white)
    doc.font('Helvetica-Bold').fontSize(13).text(s.title, sx + 14, 308, { width: 155, lineGap: 4 })
    fill(C.muted)
    doc.font('Helvetica').fontSize(10).text(s.desc, sx + 14, 352, { width: 155, lineGap: 4 })

    // Arrow
    if (i < 3) {
        fill(C.dim)
        doc.font('Helvetica-Bold').fontSize(20).text('→', sx + 185, 348)
    }
})

// Bottom note
card(48, 508, W - 96, 56, '#0d1a12', C.primary)
fill(C.primary)
doc.font('Helvetica-Bold').fontSize(12).text('⚡  Sin fricción para el candidato:', 68, 526)
fill(C.white)
doc.font('Helvetica').fontSize(12).text('No descarga apps. No instala plugins. No hace nada diferente. El análisis es 100% invisible.', 260, 526, { width: W - 340 })

pgNum(4, 10)

// ─── Slide 5: Segmentos de mercado ────────────────────────────────────────────
page()
accentLine()

tag('Segmentos de Mercado', 60, 52)
h1('Una Solución,\nMúltiples Industrias.', 60, 78, 420, C.white, 38)

const segments = [
    { icon: '🏢', name: 'RRHH & Talent Acquisition', color: C.primary,
      prob: 'Candidatos que envían CVs falsos o usan IA en pruebas técnicas',
      sol:  'Sesión de entrevista con verificación continua + informe de confianza al reclutador' },
    { icon: '🎓', name: 'Educación & Certificaciones', color: C.gold,
      prob: 'Suplantación de identidad en exámenes online o certificaciones profesionales',
      sol:  'Examen proctorizado sin agente instalado, con evidencia forense válida legalmente' },
    { icon: '⚖️', name: 'LegalTech & Notaría Digital', color: C.purple,
      prob: 'Firma de documentos por personas que no son quienes dicen ser',
      sol:  'Verificación de identidad biométrica en el momento de la firma + certificado inmutable' },
    { icon: '🏦', name: 'Fintech & Banca', color: '#00bfff',
      prob: 'KYC fraudulento y onboarding con identidades robadas o sintéticas',
      sol:  'Capa de verificación continua en videoconferencias de onboarding' },
    { icon: '📰', name: 'Medios & Periodismo', color: '#ff7f50',
      prob: 'Fuentes que falsean su identidad o entrevistas con deepfakes',
      sol:  'Verificación de autenticidad del interlocutado durante la entrevista' },
    { icon: '🔐', name: 'Ciberseguridad Corporativa', color: '#da70d6',
      prob: 'Acceso a sistemas críticos por personas no autorizadas en remoto',
      sol:  'Verificación de identidad continua para sesiones de trabajo remoto de alto riesgo' },
]

segments.forEach((s, i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    const sx = 48 + col * 272
    const sy = 220 + row * 158
    card(sx, sy, 255, 140, C.card, C.border)

    // Left color bar
    fill(s.color)
    doc.rect(sx, sy, 4, 140).fill()

    fill(s.color)
    doc.font('Helvetica-Bold').fontSize(18).text(s.icon, sx + 16, sy + 12)
    fill(C.white)
    doc.font('Helvetica-Bold').fontSize(12).text(s.name, sx + 46, sy + 14, { width: 200 })

    fill(C.red).opacity(0.8)
    doc.font('Helvetica-Bold').fontSize(9).text('PROBLEMA:', sx + 16, sy + 48, { characterSpacing: 1 })
    doc.fillOpacity(1)
    fill(C.muted)
    doc.font('Helvetica').fontSize(10).text(s.prob, sx + 16, sy + 60, { width: 230, lineGap: 3 })

    fill(C.primary).opacity(0.8)
    doc.font('Helvetica-Bold').fontSize(9).text('SOLUCIÓN:', sx + 16, sy + 94, { characterSpacing: 1 })
    doc.fillOpacity(1)
    fill(C.white)
    doc.font('Helvetica').fontSize(10).text(s.sol, sx + 16, sy + 106, { width: 230, lineGap: 3 })
})

pgNum(5, 10)

// ─── Slide 6: Tecnología ──────────────────────────────────────────────────────
page()
accentLine()

tag('Tecnología · Explicada Simple', 60, 52)
h1('IA que Piensa Como\nun Detective Forense.', 60, 78, 460, C.white, 38)

body('Deep-Check combina tres capas de análisis que ningún sistema individual puede replicar:', 60, 200, W - 120)

// Tech layers — 3 row cards with signal count badges
const techs = [
    {
        layer: 'Capa 1 · Liveness Visual',
        color: C.primary,
        signals: '7 señales',
        items: [
            'Detección facial con TinyFaceDetector (modelo IA local, sin enviar video al servidor)',
            'Análisis de ratio de apertura ocular (EAR) cada 450ms · Detección de parpadeos naturales vs sintéticos',
            'Reto fotométrico: destello de pantalla → reflejo pupilar humano · Los deepfakes no responden',
            'Micro-movimientos de cabeza: una foto fija no tiembla · Dirección de mirada en tiempo real',
        ],
    },
    {
        layer: 'Capa 2 · ADN de Escritura',
        color: C.gold,
        signals: '8 señales',
        items: [
            'Flight time: tiempo entre teclas con precisión de milisegundos · Único como una huella dactilar',
            'Distribución estadística (entropía, asimetría, curtosis) · Los bots producen patrones perfectamente uniformes',
            'Detección de bursts imposibles: >15 teclas en 500ms · Físicamente imposible para humanos',
            'Análisis de fatiga: los humanos ralentizan al escribir · Los bots mantienen velocidad constante',
        ],
    },
    {
        layer: 'Capa 3 · Correlación Multimodal',
        color: C.purple,
        signals: '3 señales',
        items: [
            'Sync-Check: ¿la mirada precede o sigue al texto escrito? El autor mira antes de teclear, el espectador después',
            'Oculo-manual sync: escritura activa con gaze congelado = señal de cámara virtual o pantalla compartida',
            'Reto de iluminación: durante el destello, ¿congela la mirada? Deepfake = sí. Persona real = no',
        ],
    },
]

techs.forEach((t, i) => {
    const ty = 248 + i * 102
    card(48, ty, W - 96, 88)

    // Left color bar
    fill(t.color)
    doc.rect(48, ty, 4, 88).fill()

    // Layer header
    fill(t.color)
    doc.font('Helvetica-Bold').fontSize(12).text(t.layer, 66, ty + 10, { width: 240 })

    // Badge
    card(W - 155, ty + 8, 100, 28, t.color, t.color)
    fill(C.bg)
    doc.font('Helvetica-Bold').fontSize(11).text(t.signals, W - 155, ty + 15, { width: 100, align: 'center' })

    // Items — 2 per row
    t.items.forEach((item, j) => {
        const col = j % 2
        const row = Math.floor(j / 2)
        const ix = 66 + col * 370
        const iy = ty + 34 + row * 24
        fill(t.color)
        doc.font('Helvetica-Bold').fontSize(10).text('·', ix, iy)
        fill(C.muted)
        doc.font('Helvetica').fontSize(10).text(item, ix + 12, iy, { width: 350 })
    })
})

pgNum(6, 10)

// ─── Slide 7: Flujo de integración ────────────────────────────────────────────
page()
accentLine()

tag('Integración · API + No-Code', 60, 52)
h1('Conecta en Minutos,\nNo en Meses.', 60, 78, 420, C.white, 38)

body('Deep-Check se integra con tu stack actual mediante una API REST o un simple enlace de sesión. Sin instalaciones, sin SDK nativo, sin cambiar tu proceso.', 60, 200, 480)

// Left: integration options
const integrations = [
    { icon: '🔗', title: 'Enlace Directo (Zero-code)',
      desc: 'Genera un enlace y envíaselo al candidato. RRHH recibe el informe automáticamente cuando termina.' },
    { icon: '🔌', title: 'API REST (Técnico)',
      desc: 'POST /api/v1/sessions para crear sesiones, recibe webhook cuando completa. Compatible con Greenhouse, Lever, cualquier ATS.' },
    { icon: '📋', title: 'Enrollment Biométrico',
      desc: 'Inscribe al candidato antes de la prueba para comparar su perfil de escritura contra la sesión real. Doble verificación.' },
    { icon: '📄', title: 'Certificado Verificable',
      desc: 'Cada sesión genera un PDF con hash SHA-256 que cualquier tercero puede verificar en /verify sin acceder al sistema.' },
]

integrations.forEach((it, i) => {
    const iy = 260 + i * 72
    card(48, iy, 430, 62)
    fill(C.primary)
    doc.font('Helvetica-Bold').fontSize(22).text(it.icon, 66, iy + 10)
    fill(C.white)
    doc.font('Helvetica-Bold').fontSize(13).text(it.title, 106, iy + 10, { width: 360 })
    fill(C.muted)
    doc.font('Helvetica').fontSize(10).text(it.desc, 106, iy + 28, { width: 356, lineGap: 3 })
})

// Right: code snippet style card
card(498, 240, W - 558, 300, '#0d0f14', C.border)
fill(C.dim)
doc.font('Helvetica-Bold').fontSize(9).text('EJEMPLO DE INTEGRACIÓN', 516, 256, { characterSpacing: 1 })

const codeLines = [
    { t: '// 1. Crear sesión', c: C.dim },
    { t: "POST /api/v1/sessions", c: C.primary },
    { t: '{', c: C.white },
    { t: '  "candidateEmail": "ana@empresa.com",', c: C.muted },
    { t: '  "role": "Senior Backend Engineer",', c: C.muted },
    { t: '  "externalRef": "JOB-2026-042"', c: C.muted },
    { t: '}', c: C.white },
    { t: '', c: C.white },
    { t: '// 2. Webhook al completar', c: C.dim },
    { t: 'POST tu-endpoint.com/webhook', c: C.purple },
    { t: '{', c: C.white },
    { t: '  "score": 94,', c: C.primary },
    { t: '  "status": "passed",', c: C.primary },
    { t: '  "aiRisk": 8,', c: C.white },
    { t: '  "identityMatch": 91', c: C.white },
    { t: '}', c: C.white },
]

codeLines.forEach((line, i) => {
    fill(line.c)
    doc.font('Courier').fontSize(9.5).text(line.t, 516, 280 + i * 15, { width: W - 580 })
})

pgNum(7, 10)

// ─── Slide 8: Mercado & Números ───────────────────────────────────────────────
page()
accentLine()

tag('Mercado & Oportunidad', 60, 52)
h1('El Fraude Digital\nEs el Nuevo Blanqueo.', 60, 78, 430, C.white, 38)

body('El mercado de verificación de identidad digital está en explosión. La IA generativa creó el problema — ahora hay que crear la solución.', 60, 200, 480)

// Market stats
const mstats = [
    { v: '$200B+', l: 'TAM actual verificación\nde identidad digital', c: C.primary },
    { v: '$416B',  l: 'Proyección mercado\npara 2035', c: C.gold },
    { v: '41%',    l: 'Del código producido en\n2024 fue generado por IA', c: C.purple },
    { v: '$16.6B', l: 'Pérdidas por fraude\ndigital (FBI IC3 2024)', c: C.red },
]

mstats.forEach((s, i) => {
    const mx = 48 + i * 200
    card(mx, 258, 184, 100, C.card, C.border)
    fill(s.c)
    doc.font('Helvetica-Bold').fontSize(30).text(s.v, mx, 270, { width: 184, align: 'center' })
    fill(C.muted)
    doc.font('Helvetica').fontSize(10).text(s.l, mx, 312, { width: 184, align: 'center', lineGap: 3 })
})

// ICP
card(48, 380, W - 96, 160)
fill(C.primary)
doc.font('Helvetica-Bold').fontSize(13).text('Cliente Ideal (ICP)', 68, 396, { characterSpacing: 0.5 })
vline(68, 416, 524)

const icps = [
    { seg: '🏢 Empresa tecnológica', desc: 'Contrata developers senior en remoto · Procesos técnicos con entrevistas de código · Alta exposición a IA-assisted cheating' },
    { seg: '🎓 Institución educativa', desc: 'Certificaciones profesionales online · Exámenes de acceso o habilitación · Necesita validez legal del resultado' },
    { seg: '💼 Consultoría RRHH', desc: 'Gestiona procesos de selección para terceros · Necesita diferenciarse con tecnología · Revende el servicio como capa de confianza' },
]

icps.forEach((ic, i) => {
    const iy = 420 + i * 36
    fill(C.white)
    doc.font('Helvetica-Bold').fontSize(11).text(ic.seg, 68, iy, { width: 220 })
    fill(C.muted)
    doc.font('Helvetica').fontSize(10).text('· ' + ic.desc, 300, iy, { width: W - 380, lineGap: 3 })
})

pgNum(8, 10)

// ─── Slide 9: Por qué Deep-Check ─────────────────────────────────────────────
page()
accentLine()

tag('Ventaja Competitiva', 60, 52)
h1('Por Qué Deep-Check\nGana.', 60, 78, 420, C.white, 38)

// Comparison table
const cols = ['Característica', 'Deep-Check', 'Proctoring\nTradicional', 'Solo\nLogin MFA']
const rows = [
    ['Verificación continua (todo el examen)',  '✅', '⚠️ Parcial', '❌'],
    ['Sin instalar software',                   '✅', '❌',          '✅'],
    ['Detección de IA generativa/deepfake',     '✅', '❌',          '❌'],
    ['ADN de escritura biométrico',             '✅', '❌',          '❌'],
    ['Certificado verificable públicamente',    '✅', '❌',          '❌'],
    ['API + webhooks para integración',         '✅', '⚠️ Limitado', '✅'],
    ['Sin fricción para el candidato',          '✅', '❌ Invasivo',  '✅'],
    ['Coste por sesión',                        '💲', '💲💲💲',       '💲'],
]

const colW = [260, 120, 140, 120]
const tableX = 48
let ty = 220

// Header row
card(tableX, ty, W - 96, 36, C.surface, C.border)
let cx2 = tableX + 14
cols.forEach((c, i) => {
    fill(i === 1 ? C.primary : C.muted)
    doc.font('Helvetica-Bold').fontSize(10).text(c, cx2, ty + 10, { width: colW[i], align: i === 0 ? 'left' : 'center', lineGap: 2 })
    cx2 += colW[i]
})
ty += 36

rows.forEach((row, ri) => {
    const bg = ri % 2 === 0 ? C.card : C.surface
    card(tableX, ty, W - 96, 32, bg, C.border)
    let rx = tableX + 14
    row.forEach((cell, ci) => {
        const isCheck = cell === '✅'
        const isCross = cell === '❌'
        const color = isCheck ? C.primary : isCross ? C.red : ci === 0 ? C.white : C.muted
        fill(color)
        doc.font(ci === 0 ? 'Helvetica' : 'Helvetica-Bold').fontSize(10)
            .text(cell, rx, ty + 10, { width: colW[ci], align: ci === 0 ? 'left' : 'center' })
        rx += colW[ci]
    })
    ty += 32
})

// Right quote
card(W - 220, 220, 178, 178, '#0d150f', C.primary)
fill(C.primary)
doc.font('Helvetica-Bold').fontSize(40).text('"', W - 208, 228)
fill(C.white)
doc.font('Helvetica').fontSize(12).text(
    'La única plataforma que detecta si el candidato es quien dice ser Y si está usando IA — simultáneamente.',
    W - 208, 262, { width: 152, lineGap: 5 }
)

pgNum(9, 10)

// ─── Slide 10: CTA & Contacto ─────────────────────────────────────────────────
page()

// Full gradient background
const bgGrad = doc.linearGradient(0, 0, W, H)
bgGrad.stop(0, rgb('#050810'))
bgGrad.stop(0.5, rgb('#0a0a0c'))
bgGrad.stop(1, rgb('#0a0508'))
doc.rect(0, 0, W, H).fill(bgGrad)

// Accent line
gradBar(0, 4)

// Glow circles
fill(C.primary)
doc.circle(140, H / 2, 200).fillOpacity(0.05).fill()
fill(C.purple)
doc.circle(W - 140, H / 2, 200).fillOpacity(0.06).fill()
doc.fillOpacity(1)

tag('Empieza Hoy', W / 2 - 100, 70, C.primary)
fill(C.white)
doc.font('Helvetica-Bold').fontSize(52).text('Asegura el Próximo\nCandidat@ Ahora.', 0, 100, { width: W, align: 'center', lineGap: 8 })

fill(C.muted)
doc.font('Helvetica').fontSize(15).text(
    'Solicita una demo gratuita o integra Deep-Check en tu proceso esta misma semana.',
    0, 228, { width: W, align: 'center' }
)

// CTA buttons
const btn1Grad = doc.linearGradient(W/2 - 220, 280, W/2 - 20, 280)
btn1Grad.stop(0, rgb(C.primary))
btn1Grad.stop(1, rgb(C.purple))
doc.roundedRect(W/2 - 220, 272, 200, 50, 25).fill(btn1Grad)
fill(C.bg)
doc.font('Helvetica-Bold').fontSize(14).text('Solicitar Demo', W/2 - 220, 291, { width: 200, align: 'center' })

stroke(C.primary)
doc.roundedRect(W/2 + 20, 272, 200, 50, 25).stroke()
fill(C.primary)
doc.font('Helvetica-Bold').fontSize(14).text('Ver Documentación', W/2 + 20, 291, { width: 200, align: 'center' })

// Contact info cards
const contacts = [
    { icon: '✉️', label: 'Email', value: 'pablo@hiumsolutions.com' },
    { icon: '🌐', label: 'Plataforma', value: 'deep-check-two.vercel.app' },
    { icon: '📋', label: 'API Docs', value: '/docs · Autenticación Bearer' },
]

contacts.forEach((c, i) => {
    const ccx = W/2 - 320 + i * 220
    card(ccx, 354, 200, 72, C.surface, C.border)
    fill(C.primary)
    doc.font('Helvetica-Bold').fontSize(20).text(c.icon, ccx + 14, 368)
    fill(C.muted)
    doc.font('Helvetica-Bold').fontSize(9).text(c.label.toUpperCase(), ccx + 48, 368, { characterSpacing: 1 })
    fill(C.white)
    doc.font('Helvetica').fontSize(11).text(c.value, ccx + 48, 382, { width: 142, lineGap: 3 })
})

// Trust badges bottom
const badges = ['🔒 Datos 100% en tu navegador', '⚡ Sin instalar nada', '📋 API REST lista', '🌍 Verificable públicamente']
badges.forEach((b, i) => {
    const bx = W/2 - 380 + i * 198
    fill(C.dim)
    doc.font('Helvetica').fontSize(11).text(b, bx, H - 44, { width: 190, align: 'center' })
})

pgNum(10, 10)

// ─── Finalize ─────────────────────────────────────────────────────────────────
doc.end()
console.log('✅ PDF generado en:', out)
