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
    cyan:    '#00cfff',
}

function rgb(hex) {
    const n = parseInt(hex.replace('#',''), 16)
    return [(n>>16)&255, (n>>8)&255, n&255]
}

// Page dimensions: A4 landscape
const W = 841.89
const H = 595.28
const FOOTER_Y = H - 28   // 567pt — safe zone for footer text
const SAFE_BOTTOM = H - 50 // 545pt — no content should go below this

const doc = new PDFDocument({ size: [W, H], margin: 0, autoFirstPage: false })
const out = path.join(__dirname, '..', 'public', 'deep-check-visual-deck.pdf')
doc.pipe(fs.createWriteStream(out))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fill(hex)   { const [r,g,b] = rgb(hex); doc.fillColor([r,g,b]); return doc }
function stroke(hex) { const [r,g,b] = rgb(hex); doc.strokeColor([r,g,b]); return doc }

function page(bg = C.bg) {
    doc.addPage({ size: [W, H], margin: 0 })
    fill(bg)
    doc.rect(0, 0, W, H).fill()
}

function gradBar(y, h) {
    const grad = doc.linearGradient(0, y, W, y)
    grad.stop(0,   rgb(C.primary))
    grad.stop(0.5, rgb(C.purple))
    grad.stop(1,   rgb(C.cyan))
    doc.rect(0, y, W, h).fill(grad)
}

function accentLine() { gradBar(0, 4) }

function tag(text, x, y, color = C.primary) {
    fill(color)
    doc.font('Helvetica-Bold').fontSize(9).text(text.toUpperCase(), x, y, { characterSpacing: 2 })
}

function h1(text, x, y, w, color = C.white, size = 38) {
    fill(color)
    doc.font('Helvetica-Bold').fontSize(size).text(text, x, y, { width: w, lineGap: 5 })
}

function body(text, x, y, w, color = C.muted, size = 13) {
    fill(color)
    doc.font('Helvetica').fontSize(size).text(text, x, y, { width: w, lineGap: 6 })
}

function card(x, y, w, h, bg = C.card, borderColor = C.border) {
    fill(bg)
    doc.roundedRect(x, y, w, h, 8).fill()
    stroke(borderColor)
    doc.roundedRect(x, y, w, h, 8).stroke()
}

function colorBar(x, y, w, h, color1, color2) {
    const grad = doc.linearGradient(x, y, x + w, y)
    grad.stop(0, rgb(color1))
    grad.stop(1, rgb(color2 || C.bg))
    doc.rect(x, y, w, h).fill(grad)
}

function metric(value, label, x, y, w, color = C.primary) {
    const mh = 88
    card(x, y, w, mh)
    fill(color)
    doc.font('Helvetica-Bold').fontSize(30).text(value, x, y + 12, { width: w, align: 'center' })
    fill(C.muted)
    doc.font('Helvetica').fontSize(9).text(label, x + 4, y + 52, { width: w - 8, align: 'center', lineGap: 3 })
}

function pgNum(n, total) {
    fill(C.dim)
    doc.font('Helvetica').fontSize(9).text(`${n} / ${total}`, W - 60, FOOTER_Y)
}

function footer() {
    fill(C.dim)
    doc.font('Helvetica').fontSize(9)
        .text('© 2026 Hium Solutions · pablo@hiumsolutions.com · Confidencial', 60, FOOTER_Y)
}

// ─── Slide 1: COVER ───────────────────────────────────────────────────────────
page()
accentLine()

// Background glow blobs (low opacity via rect trick with surface color overlay)
fill(C.cyan)
doc.circle(W * 0.73, H * 0.28, 200).fillOpacity(0.04).fill()
fill(C.purple)
doc.circle(W * 0.80, H * 0.72, 150).fillOpacity(0.05).fill()
fill(C.primary)
doc.circle(W * 0.14, H * 0.82, 110).fillOpacity(0.04).fill()
doc.fillOpacity(1)

const LW = W * 0.56   // left panel width
const RX = LW + 28    // right panel start x
const CW = W - RX - 36 // right panel card width

// Left panel
tag('Auditoría Forense · Detección de Fraude Visual', 60, 50)

fill(C.white)
doc.font('Helvetica-Bold').fontSize(56).text('Deep-Check.', 60, 84, { width: LW - 60 })

// Gradient subtitle
const subGrad = doc.linearGradient(60, 160, 430, 160)
subGrad.stop(0, rgb(C.primary))
subGrad.stop(1, rgb(C.cyan))
doc.font('Helvetica-Bold').fontSize(16).fillColor(subGrad)
    .text('INTEGRIDAD VISUAL EN LA ERA SINTÉTICA', 60, 162, { width: LW - 60, characterSpacing: 0.5 })
doc.fillOpacity(1)

fill(C.muted)
doc.font('Helvetica').fontSize(13).text(
    'La IA especializada en detectar manipulaciones visuales y certificar la autenticidad de imagen y vídeo. El estándar técnico para empresas que no pueden permitirse el fraude visual.',
    60, 196, { width: LW - 80, lineGap: 6 }
)

// Date pill — positioned after body text leaves room
fill(C.surface)
doc.roundedRect(60, 302, 150, 30, 15).fill()
stroke(C.border)
doc.roundedRect(60, 302, 150, 30, 15).stroke()
fill(C.muted)
doc.font('Helvetica').fontSize(11).text('Febrero 2026', 60, 311, { width: 150, align: 'center' })

// Right panel — 4 metrics, spaced to fit within H
// metric height = 88, total = 4*88 + 3*gap. If gap=12: 352+36=388. Start at 52, end 440. Fine.
;[
    { v: '99.7%',  l: 'Precisión\ndetección deepfakes', c: C.primary },
    { v: '<500ms', l: 'Análisis forense\npor archivo',  c: C.cyan    },
    { v: '4',      l: 'Sectores críticos\nprotegidos',  c: C.gold    },
    { v: '0',      l: 'Falsos negativos\nen piloto',    c: C.purple  },
].forEach((s, i) => {
    metric(s.v, s.l, RX, 50 + i * 110, CW, s.c)
})

footer()
pgNum(1, 6)

// ─── Slide 2: RESUMEN EJECUTIVO ───────────────────────────────────────────────
page()
accentLine()

tag('Resumen Ejecutivo', 60, 50)
h1('Restauramos la Confianza\nen el Ecosistema Digital.', 60, 74, W - 120, C.white, 34)

// h1 at 74, size=34, 2 lines: 74 + 2*(34+5) = 74+78 = 152. Body at 168.
fill(C.muted)
doc.font('Helvetica').fontSize(13).text(
    'Nuestra IA se especializa en la detección de manipulaciones visuales y la certificación de la autenticidad de archivos de imagen y vídeo.',
    60, 168, { width: W - 120, lineGap: 5 }
)

// Body ~2 lines at 13pt: 168 + 2*19 = 206. Cards start at 222.
// Pillar cards: y=222, height=210, end=432. 3 cards across W-96.
const PILLAR_Y  = 222
const PILLAR_H  = 210
const PILLAR_W  = (W - 96 - 32) / 3  // 3 cards, 16pt gap between them
const execPillars = [
    {
        icon: '🔬', title: 'Detección', color: C.primary,
        desc: 'Identificamos manipulaciones generadas por GANs y modelos de difusión. Detectamos face-swapping y artefactos de síntesis invisibles al ojo humano.',
    },
    {
        icon: '📜', title: 'Certificación', color: C.gold,
        desc: 'Emitimos informes de confianza técnica con validez pericial que acreditan la autenticidad o adulteración de cualquier archivo visual.',
    },
    {
        icon: '🔌', title: 'Integración', color: C.purple,
        desc: 'Software propietario vía API que se conecta a cualquier plataforma preexistente sin cambiar flujos de trabajo ni requerir instalaciones.',
    },
]

execPillars.forEach((p, i) => {
    const px = 48 + i * (PILLAR_W + 16)
    card(px, PILLAR_Y, PILLAR_W, PILLAR_H, C.card, C.border)
    colorBar(px, PILLAR_Y, PILLAR_W, 4, p.color)

    fill(p.color)
    doc.font('Helvetica-Bold').fontSize(30).text(p.icon, px + 14, PILLAR_Y + 18)
    fill(C.white)
    doc.font('Helvetica-Bold').fontSize(18).text(p.title, px + 54, PILLAR_Y + 22, { width: PILLAR_W - 68 })
    fill(C.muted)
    doc.font('Helvetica').fontSize(11).text(p.desc, px + 14, PILLAR_Y + 78, { width: PILLAR_W - 28, lineGap: 5 })
})
// Cards end at 222+210=432.

// Bottom highlight bar: y=450, height=46, ends at 496. Footer at 567. Gap 71pt. ✓
card(48, 452, W - 96, 46, '#0c1a0e', C.primary)
fill(C.primary)
doc.font('Helvetica-Bold').fontSize(11).text('Ventaja clave:', 68, 469)
fill(C.white)
doc.font('Helvetica').fontSize(11).text(
    'Al centrarnos exclusivamente en el ámbito visual, alcanzamos tasas de precisión superiores a todas las soluciones generalistas.',
    186, 469, { width: W - 262, lineGap: 0 }
)

footer()
pgNum(2, 6)

// ─── Slide 3: EL DESAFÍO ──────────────────────────────────────────────────────
page()
accentLine()

tag('El Desafío · 2026', 60, 50)
h1('El Colapso de la\nVerdad Visual.', 60, 74, 420, C.white, 36)
// h1 ends at 74 + 2*(36+5) = 74+82 = 156. Body at 170.

fill(C.muted)
doc.font('Helvetica').fontSize(12).text(
    'En 2026, la tecnología de generación de imágenes ha alcanzado el "hiperrealismo absoluto". Vulnerabilidades críticas en sectores que dependen de la autenticidad visual.',
    60, 170, { width: 400, lineGap: 5 }
)
// Body ~2 lines at 12pt: 170 + 2*17 = 204. Challenge cards start at 224.

// Right threat card: y=60, height=172, ends at 232. x=W-228 (right panel).
card(W - 236, 60, 192, 172, '#1a0808', '#ff4d4d')
fill(C.red)
doc.font('Helvetica-Bold').fontSize(10).text('AMENAZA EN AUGE', W - 222, 78, { width: 164, align: 'center', characterSpacing: 1 })
fill(C.white)
doc.font('Helvetica-Bold').fontSize(36).text('3.900%', W - 222, 98, { width: 164, align: 'center' })
fill(C.red)
doc.font('Helvetica-Bold').fontSize(9).text('AUMENTO DE DEEPFAKES', W - 222, 148, { width: 164, align: 'center', characterSpacing: 0.5 })
fill(C.muted)
doc.font('Helvetica').fontSize(9).text('en circulación desde 2022\n(Deeptrace / Sensity AI)', W - 222, 164, { width: 164, align: 'center', lineGap: 3 })

// 3 challenge cards: height=86 each, gap=10. Total=86*3+10*2=278. Start=224, end=502. Footer=567. ✓
const CHAL_H   = 86
const CHAL_GAP = 10
const CHAL_Y0  = 224
const challenges = [
    {
        n: '01', color: C.red,
        title: 'Fraude de Identidad 3.0',
        desc: 'Face-swapping y máscaras digitales permiten suplantar identidades en altas bancarias, contratos y exámenes remotos. Indetectable para el ojo humano.',
    },
    {
        n: '02', color: C.gold,
        title: 'Falsificación Documental Avanzada',
        desc: 'Documentos de identidad y pruebas físicas son alterados píxel a píxel por modelos de difusión. Las herramientas forenses tradicionales no los detectan.',
    },
    {
        n: '03', color: C.purple,
        title: 'Inseguridad Jurídica',
        desc: 'Validar si un vídeo es real o un deepfake pone en jaque al sistema legal, los medios de comunicación y cualquier proceso que requiera evidencia visual.',
    },
]

challenges.forEach((ch, i) => {
    const cy = CHAL_Y0 + i * (CHAL_H + CHAL_GAP)
    card(48, cy, W - 96, CHAL_H, C.card, C.border)
    fill(ch.color)
    doc.rect(48, cy, 5, CHAL_H).fill()

    fill(ch.color)
    doc.font('Helvetica-Bold').fontSize(20).text(ch.n, 68, cy + 14, { width: 32 })
    fill(C.white)
    doc.font('Helvetica-Bold').fontSize(13).text(ch.title, 110, cy + 10, { width: 240 })
    fill(C.muted)
    // Width = W - 96 - 62 - 16 = W - 174
    doc.font('Helvetica').fontSize(10).text(ch.desc, 110, cy + 30, { width: W - 200, lineGap: 3 })
})

footer()
pgNum(3, 6)

// ─── Slide 4: SOLUCIONES POR SECTOR ──────────────────────────────────────────
page()
accentLine()

tag('Soluciones y Aplicaciones', 60, 50)
h1('Cuatro Sectores.\nUna Solución Crítica.', 60, 74, 430, C.white, 34)
// h1 ends at 74 + 2*(34+5) = 152. No body text — go straight to cards at 164.

// 4 sector cards: 2 columns × 2 rows
// Col width: (W - 96 - 16) / 2 = 365. Card height=158.
// Row 0: y=164, ends=322. Row 1: y=334, ends=492. Footer=567. Gap=75pt. ✓
const SEC_Y0  = 164
const SEC_H   = 158
const SEC_W   = (W - 96 - 16) / 2   // ~364
const SEC_GAP = 16

const sectors = [
    {
        letter: 'A', icon: '🏦', name: 'Financiero & Fintech', color: C.primary,
        prob: 'Suplantación de identidad en procesos KYC con inyecciones de vídeo sintético.',
        sol:  'Análisis de coherencia de luz y textura de piel para detectar vídeo sintético en tiempo real.',
    },
    {
        letter: 'B', icon: '🛡️', name: 'Seguros (Insurtech)', color: C.gold,
        prob: 'Fraude en declaración de siniestros con fotografías de daños manipuladas digitalmente.',
        sol:  'Análisis forense del ruido del sensor y coherencia geométrica para validar evidencias reales.',
    },
    {
        letter: 'C', icon: '🎓', name: 'Educación & Universidades', color: C.purple,
        prob: 'Fraude en exámenes online y entrega de proyectos generados con IA sin declarar.',
        sol:  'Certificación de autoría visual: integridad de cámara y originalidad de archivos entregados.',
    },
    {
        letter: 'D', icon: '⚖️', name: 'Legal & Administración', color: C.cyan,
        prob: 'Pruebas visuales cuya veracidad es cuestionada en procedimientos judiciales.',
        sol:  'Informes de confianza técnica con validez pericial, detallando ausencia de artefactos GAN.',
    },
]

sectors.forEach((s, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const sx = 48 + col * (SEC_W + SEC_GAP)
    const sy = SEC_Y0 + row * (SEC_H + SEC_GAP)

    card(sx, sy, SEC_W, SEC_H, C.card, C.border)
    fill(s.color)
    doc.rect(sx, sy, 5, SEC_H).fill()  // left color bar

    // Header row: letter badge + icon + name
    fill(s.color)
    doc.font('Helvetica-Bold').fontSize(12).text(`${s.letter}.`, sx + 14, sy + 12, { width: 22 })
    doc.font('Helvetica-Bold').fontSize(20).text(s.icon, sx + 38, sy + 8, { width: 28 })
    fill(C.white)
    doc.font('Helvetica-Bold').fontSize(13).text(s.name, sx + 70, sy + 12, { width: SEC_W - 80 })

    // Separator line
    stroke(C.border)
    doc.moveTo(sx + 14, sy + 40).lineTo(sx + SEC_W - 14, sy + 40).stroke()

    // Problema
    fill(C.red)
    doc.font('Helvetica-Bold').fontSize(8).text('PROBLEMA:', sx + 14, sy + 50, { characterSpacing: 1 })
    fill(C.muted)
    doc.font('Helvetica').fontSize(10).text(s.prob, sx + 14, sy + 62, { width: SEC_W - 28, lineGap: 3 })

    // Solución — starts at sy+104 to leave room for 2 lines above
    fill(s.color)
    doc.font('Helvetica-Bold').fontSize(8).text('SOLUCIÓN:', sx + 14, sy + 104, { characterSpacing: 1 })
    fill(C.white)
    doc.font('Helvetica').fontSize(10).text(s.sol, sx + 14, sy + 116, { width: SEC_W - 28, lineGap: 3 })
    // Solution text max 2 lines * 14pt = 28pt. Ends at sy+144. Card ends at sy+158. Gap=14pt. ✓
})

footer()
pgNum(4, 6)

// ─── Slide 5: VALOR DIFERENCIAL ───────────────────────────────────────────────
page()
accentLine()

tag('Valor Diferencial · La Ciencia del Píxel', 60, 50)
h1('Precisión Quirúrgica,\nNo Detección Genérica.', 60, 74, 480, C.white, 34)
// h1 ends at 74 + 2*(34+5) = 152. Body at 166.

fill(C.muted)
doc.font('Helvetica').fontSize(12).text(
    'Deep-Check no es un detector de uso general. Es una herramienta especializada en el dominio visual con cuatro ventajas técnicas únicas en el mercado.',
    60, 166, { width: W - 120, lineGap: 5 }
)
// Body ~1-2 lines at 12pt: 166 + 2*17 = 200. Diff cards start at 212.

// 4 diff cards: 2 cols × 2 rows. height=124, gap=12.
// Row 0: y=212, ends=336. Row 1: y=348, ends=472. Footer=567. Gap=95pt. ✓
const DIFF_Y0  = 212
const DIFF_H   = 124
const DIFF_W   = (W - 96 - 16) / 2
const DIFF_GAP = 12

const diffs = [
    {
        n: '01', icon: '🔬', title: 'Análisis de Micro-artefactos', color: C.primary,
        desc: 'Detecta rastros de algoritmos GAN y Difusión invisibles para otros sistemas. Cada modelo generativo deja una firma estadística única en los píxeles.',
    },
    {
        n: '02', icon: '☁️', title: 'Eficiencia en la Nube', color: C.cyan,
        desc: 'Arquitectura optimizada para millones de análisis mensuales. Sin hardware dedicado, pago por uso, SLA del 99.9%. Escala sin fricción operativa.',
    },
    {
        n: '03', icon: '🔌', title: 'Independencia Tecnológica', color: C.gold,
        desc: 'Software propietario integrable vía API en cualquier plataforma. Compatible con cualquier stack sin modificar flujos de trabajo actuales.',
    },
    {
        n: '04', icon: '🎯', title: 'Especialización = Mayor Precisión', color: C.purple,
        desc: 'Al centrarnos en el ámbito visual alcanzamos precisión superior a soluciones generalistas. Un sistema especializado siempre supera al generalista.',
    },
]

diffs.forEach((d, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const dx = 48 + col * (DIFF_W + DIFF_GAP)
    const dy = DIFF_Y0 + row * (DIFF_H + DIFF_GAP)

    card(dx, dy, DIFF_W, DIFF_H, C.card, C.border)
    colorBar(dx, dy, DIFF_W, 4, d.color)

    // Header: number badge + icon + title on same row
    fill(d.color)
    doc.font('Helvetica-Bold').fontSize(10).text(d.n, dx + 12, dy + 14, { width: 24 })
    doc.font('Helvetica-Bold').fontSize(22).text(d.icon, dx + 38, dy + 10, { width: 28 })
    fill(C.white)
    doc.font('Helvetica-Bold').fontSize(13).text(d.title, dx + 72, dy + 13, { width: DIFF_W - 84 })

    // Separator
    stroke(C.border)
    doc.moveTo(dx + 12, dy + 42).lineTo(dx + DIFF_W - 12, dy + 42).stroke()

    fill(C.muted)
    doc.font('Helvetica').fontSize(10).text(d.desc, dx + 12, dy + 52, { width: DIFF_W - 24, lineGap: 4 })
    // Max 3 lines * 14pt = 42pt. Ends at dy+94. Card ends at dy+124. Gap=30pt. ✓
})

footer()
pgNum(5, 6)

// ─── Slide 6: CTA ─────────────────────────────────────────────────────────────
page()

const bgGrad = doc.linearGradient(0, 0, W, H)
bgGrad.stop(0,   rgb('#050a10'))
bgGrad.stop(0.5, rgb('#0a0a0c'))
bgGrad.stop(1,   rgb('#050810'))
doc.rect(0, 0, W, H).fill(bgGrad)
gradBar(0, 4)

// Glow blobs
fill(C.primary)
doc.circle(90, H / 2, 200).fillOpacity(0.04).fill()
fill(C.cyan)
doc.circle(W - 90, H * 0.35, 170).fillOpacity(0.04).fill()
fill(C.purple)
doc.circle(W * 0.5, H * 0.9, 150).fillOpacity(0.04).fill()
doc.fillOpacity(1)

tag('Hablemos', W / 2 - 55, 58, C.primary)

fill(C.white)
doc.font('Helvetica-Bold').fontSize(44).text(
    'Tu Contenido Visual\nMerece un Estándar Real.',
    0, 84, { width: W, align: 'center', lineGap: 8 }
)
// h1 ends at 84 + 2*(44+8) = 188.

fill(C.muted)
doc.font('Helvetica').fontSize(13).text(
    'Solicita una demo técnica o una auditoría de prueba gratuita sobre tus propios archivos.',
    0, 198, { width: W, align: 'center' }
)
// body ends at ~215.

// CTA buttons — y=234
const BTN_Y = 234
const btn1Grad = doc.linearGradient(W/2 - 216, BTN_Y, W/2 - 16, BTN_Y)
btn1Grad.stop(0, rgb(C.primary))
btn1Grad.stop(1, rgb(C.cyan))
doc.roundedRect(W/2 - 216, BTN_Y, 200, 48, 24).fill(btn1Grad)
fill(C.bg)
doc.font('Helvetica-Bold').fontSize(13).text('Solicitar Demo', W/2 - 216, BTN_Y + 17, { width: 200, align: 'center' })

stroke(C.primary)
doc.roundedRect(W/2 + 16, BTN_Y, 200, 48, 24).stroke()
fill(C.primary)
doc.font('Helvetica-Bold').fontSize(13).text('Auditoría Gratuita', W/2 + 16, BTN_Y + 17, { width: 200, align: 'center' })
// Buttons end at BTN_Y + 48 = 282.

// Contact cards — y=302, height=70, end=372. Footer=567. Gap=195pt. ✓
const CONTACT_Y = 302
const contacts = [
    { icon: '✉️', label: 'Email directo',    value: 'pablo@hiumsolutions.com' },
    { icon: '🔒', label: 'Confidencialidad', value: 'NDA disponible · Demo en 48h' },
    { icon: '🌐', label: 'Empresa',           value: 'Hium Solutions · 2026' },
]

contacts.forEach((c, i) => {
    const ccx = W/2 - 316 + i * 218
    card(ccx, CONTACT_Y, 200, 68, C.surface, C.border)
    fill(C.primary)
    doc.font('Helvetica-Bold').fontSize(18).text(c.icon, ccx + 14, CONTACT_Y + 14, { width: 24 })
    fill(C.muted)
    doc.font('Helvetica-Bold').fontSize(8).text(c.label.toUpperCase(), ccx + 46, CONTACT_Y + 14, { characterSpacing: 1 })
    fill(C.white)
    doc.font('Helvetica').fontSize(11).text(c.value, ccx + 46, CONTACT_Y + 28, { width: 144, lineGap: 3 })
})
// Contact cards end at 302+68=370.

// Trust badges — y=402, well above footer 567. ✓
const badges = [
    '🔬 Micro-artefactos GAN/Difusión',
    '⚡ Resultado en < 500ms',
    '📋 Informe pericial incluido',
    '🔌 API REST · Integración en días',
]
badges.forEach((b, i) => {
    const bx = W/2 - 386 + i * 200
    card(bx, 390, 192, 36, C.surface, C.border)
    fill(C.muted)
    doc.font('Helvetica').fontSize(10).text(b, bx, 402, { width: 192, align: 'center' })
})

pgNum(6, 6)

// ─── Finalize ─────────────────────────────────────────────────────────────────
doc.end()
console.log('✅ PDF generado en:', out)
