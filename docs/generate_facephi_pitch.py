#!/usr/bin/env python3
"""Generate Deep-Check pitch PDF for FacePhi — dark theme, green accents."""

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
import os

# Colors (all opaque — alpha handled via setFillAlpha/setStrokeAlpha)
BG_DARK = HexColor('#0a0a0c')
BG_CARD = HexColor('#1a1a20')
GREEN = HexColor('#00ff9d')
TEXT_WHITE = HexColor('#ffffff')
TEXT_MUTED = HexColor('#a1a1aa')
TEXT_DIM = HexColor('#71717a')
PURPLE = HexColor('#8b5cf6')

W, H = A4
OUTPUT = os.path.join(os.path.dirname(__file__), 'deep_check_pitch_facephi.pdf')


def bg(c):
    c.setFillColor(BG_DARK)
    c.rect(0, 0, W, H, fill=1, stroke=0)


def grid(c):
    c.saveState()
    c.setStrokeColor(TEXT_DIM)
    c.setStrokeAlpha(0.08)
    c.setLineWidth(0.3)
    for x in range(0, int(W), 40):
        c.line(x, 0, x, H)
    for y in range(0, int(H), 40):
        c.line(0, y, W, y)
    c.restoreState()


def card(c, x, y, w, h, color=BG_CARD, alpha=1.0):
    c.saveState()
    c.setFillColor(color)
    c.setFillAlpha(alpha)
    c.roundRect(x, y, w, h, 8, fill=1, stroke=0)
    c.restoreState()


def badge(c, x, y, w, text):
    c.saveState()
    c.setFillColor(GREEN)
    c.setFillAlpha(0.12)
    c.roundRect(x, y - 5, w, 24, 12, fill=1, stroke=0)
    c.restoreState()
    c.setFillColor(GREEN)
    c.setFont("Helvetica", 9)
    c.drawString(x + 12, y, text)


def green_bar(c):
    c.setFillColor(GREEN)
    c.rect(0, 0, W, 3, fill=1, stroke=0)


def page_num(c, n):
    c.setFillColor(TEXT_DIM)
    c.setFont("Helvetica", 8)
    c.drawRightString(W - 40, 30, f"0{n}")


def metric_card(c, x, y, w, h, value, label):
    card(c, x, y, w, h)
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 22)
    c.drawCentredString(x + w/2, y + h - 35, value)
    c.setFillColor(TEXT_MUTED)
    c.setFont("Helvetica", 8.5)
    for i, line in enumerate(label.split('\n')):
        c.drawCentredString(x + w/2, y + 15 - i*11, line)


# ── PAGE 1: Cover ────────────────────────────────────────────────────────────

def page_cover(c):
    bg(c)
    grid(c)

    # Subtle glow
    c.saveState()
    c.setFillColor(GREEN)
    c.setFillAlpha(0.03)
    c.circle(W/2, H/2 + 80, 200, fill=1, stroke=0)
    c.setFillAlpha(0.05)
    c.circle(W/2, H/2 + 80, 140, fill=1, stroke=0)
    c.restoreState()

    y = H - 180
    badge(c, W/2 - 55, y, 110, "CONFIDENCIAL")

    y = H - 280
    c.setFont("Helvetica-Bold", 48)
    full_w = c.stringWidth("Deep-Check.", "Helvetica-Bold", 48)
    text_x = (W - full_w) / 2
    c.setFillColor(TEXT_WHITE)
    c.drawString(text_x, y, "Deep-Check")
    dot_x = text_x + c.stringWidth("Deep-Check", "Helvetica-Bold", 48)
    c.setFillColor(GREEN)
    c.drawString(dot_x, y, ".")

    y -= 50
    c.setFillColor(GREEN)
    c.setFont("Helvetica", 16)
    c.drawCentredString(W/2, y, "Verificacion Continua de Identidad")
    y -= 22
    c.drawCentredString(W/2, y, "para la Era de la IA")

    y -= 30
    c.setStrokeColor(GREEN)
    c.setLineWidth(2)
    c.line(W/2 - 40, y, W/2 + 40, y)

    y -= 40
    c.setFillColor(TEXT_MUTED)
    c.setFont("Helvetica", 12)
    c.drawCentredString(W/2, y, "Propuesta de Colaboracion Tecnologica")
    y -= 20
    c.setFillColor(TEXT_DIM)
    c.setFont("Helvetica", 11)
    c.drawCentredString(W/2, y, "Para: FacePhi Biometrics")

    c.setFillColor(TEXT_DIM)
    c.setFont("Helvetica", 9)
    c.drawCentredString(W/2, 100, "HIUM Solutions SL  |  Andalucia, Espana")
    c.drawCentredString(W/2, 85, "https://deep-check-two.vercel.app")
    c.drawCentredString(W/2, 70, "Marzo 2026")

    green_bar(c)


# ── PAGE 2: El Problema ──────────────────────────────────────────────────────

def page_problem(c):
    bg(c)
    page_num(c, 2)

    y = H - 80
    badge(c, 40, y, 100, "EL PROBLEMA")

    y -= 55
    c.setFillColor(TEXT_WHITE)
    c.setFont("Helvetica-Bold", 32)
    c.drawString(40, y, "La verificacion puntual")
    y -= 38
    c.drawString(40, y, "ya no es suficiente.")

    y -= 40
    c.setFillColor(TEXT_MUTED)
    c.setFont("Helvetica", 11)
    for line in [
        "Los deepfakes han evolucionado hasta el punto de ser indistinguibles",
        "del video real en tiempo real. Las soluciones de verificacion que validan",
        "la identidad solo al inicio de una sesion dejan una ventana de",
        "vulnerabilidad durante todo el resto de la interaccion.",
    ]:
        c.drawString(40, y, line)
        y -= 18

    y -= 30
    cw = (W - 100) / 3
    for i, (val, lab) in enumerate([
        ("+97%", "Aumento fraude de\nidentidad remota (2024)"),
        ("$30K+", "Perdida media por\ncontratacion fraudulenta"),
        ("85%", "Deepfakes indetectables\npor humanos"),
    ]):
        metric_card(c, 40 + i*(cw+10), y - 70, cw, 90, val, lab)

    y -= 120
    c.setFillColor(TEXT_WHITE)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(40, y, "Escenarios de riesgo actuales:")

    y -= 30
    for b in [
        "Suplantacion durante entrevistas de trabajo remotas",
        "Uso de deepfakes en videoconferencias bancarias post-KYC",
        "Examenes online con identidad verificada solo al inicio",
        "Consultas de telemedicina con pacientes no verificados",
        "Sesiones de soporte con acceso a datos sensibles",
    ]:
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(50, y, ">")
        c.setFillColor(TEXT_MUTED)
        c.setFont("Helvetica", 11)
        c.drawString(68, y, b)
        y -= 22

    y -= 30
    card(c, 40, y - 40, W - 80, 50, GREEN, 0.08)
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Oblique", 10)
    c.drawCentredString(W/2, y - 18, '"La identidad verificada al inicio no garantiza la identidad durante la sesion."')

    green_bar(c)


# ── PAGE 3: Nuestra Solucion ─────────────────────────────────────────────────

def page_solution(c):
    bg(c)
    page_num(c, 3)

    y = H - 80
    badge(c, 40, y, 145, "NUESTRA SOLUCION")

    y -= 55
    c.setFillColor(TEXT_WHITE)
    c.setFont("Helvetica-Bold", 30)
    c.drawString(40, y, "Verificacion continua.")
    y -= 36
    c.drawString(40, y, "Privacidad absoluta.")

    y -= 35
    c.setFillColor(TEXT_MUTED)
    c.setFont("Helvetica", 11)
    for line in [
        "Deep-Check es una plataforma de verificacion biometrica continua",
        "que opera integramente en el navegador del usuario. Ningun dato",
        "biometrico abandona el dispositivo.",
    ]:
        c.drawString(40, y, line)
        y -= 17

    # 4 capability cards
    y -= 25
    cw = (W - 100) / 2
    ch = 105
    caps = [
        ("Senales Vitales", "Deteccion de pulso cardiaco\nmediante analisis de video.\nImposible de falsificar con\ndeepfakes o fotos estaticas."),
        ("Biometria Conductual", "Patrones unicos de tecleo,\ndinamica del raton y ritmo\nde interaccion. Tan unico\ncomo una huella dactilar."),
        ("Forensic AI", "Multiples capas de inteligencia\nartificial analizan cada frame\nen busca de artefactos de\ngeneracion sintetica."),
        ("Micro-expresiones", "Analisis de biomecanica facial\nen tiempo real. Detecta\ninconsistencias imposibles\nen rostros generados por IA."),
    ]
    for i, (title, desc) in enumerate(caps):
        col, row = i % 2, i // 2
        cx = 40 + col * (cw + 20)
        cy = y - row * (ch + 15)
        card(c, cx, cy - ch, cw, ch)
        c.setFillColor(GREEN)
        c.circle(cx + 18, cy - 18, 4, fill=1, stroke=0)
        c.setFont("Helvetica-Bold", 12)
        c.drawString(cx + 30, cy - 22, title)
        c.setFillColor(TEXT_MUTED)
        c.setFont("Helvetica", 8.5)
        for j, dl in enumerate(desc.split('\n')):
            c.drawString(cx + 15, cy - 42 - j*13, dl)

    # Privacy section
    y = y - 2*(ch+15) - 30
    card(c, 40, y - 80, W - 80, 90, GREEN, 0.06)
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(60, y - 20, "Privacy by Design")
    c.setFillColor(TEXT_MUTED)
    c.setFont("Helvetica", 10)
    for i, pl in enumerate([
        "Todo el procesamiento biometrico se ejecuta en el navegador (WebAssembly).",
        "Cero datos biometricos transmitidos a servidores. GDPR nativo.",
        "Sin SDK, sin instalacion. Funciona en cualquier navegador moderno.",
    ]):
        c.setFillColor(GREEN)
        c.drawString(60, y - 40 - i*16, "+")
        c.setFillColor(TEXT_MUTED)
        c.drawString(75, y - 40 - i*16, pl)

    green_bar(c)


# ── PAGE 4: FacePhi + Deep-Check ─────────────────────────────────────────────

def page_partnership(c):
    bg(c)
    page_num(c, 4)

    y = H - 80
    badge(c, 40, y, 100, "SINERGIA")

    y -= 55
    c.setFillColor(TEXT_WHITE)
    c.setFont("Helvetica-Bold", 28)
    c.drawString(40, y, "FacePhi + Deep-Check")
    y -= 35
    c.setFillColor(GREEN)
    c.setFont("Helvetica", 14)
    c.drawString(40, y, "Identidad end-to-end. Del onboarding a la sesion.")

    # Flow diagram
    y -= 50
    bw, bh = 140, 55

    # FacePhi box
    card(c, 40, y - bh, bw, bh, PURPLE, 0.15)
    c.setFillColor(PURPLE)
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(40 + bw/2, y - 20, "FacePhi")
    c.setFillColor(TEXT_MUTED)
    c.setFont("Helvetica", 8)
    c.drawCentredString(40 + bw/2, y - 35, "KYC / Onboarding")
    c.drawCentredString(40 + bw/2, y - 46, "Verificacion inicial")

    # Arrow
    ax = 40 + bw + 15
    ay = y - bh/2
    c.setStrokeColor(GREEN)
    c.setLineWidth(2)
    c.line(ax, ay, ax + 60, ay)
    c.line(ax + 50, ay + 6, ax + 60, ay)
    c.line(ax + 50, ay - 6, ax + 60, ay)

    # Deep-Check box
    dx = ax + 75
    card(c, dx, y - bh, bw, bh, GREEN, 0.12)
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(dx + bw/2, y - 20, "Deep-Check")
    c.setFillColor(TEXT_MUTED)
    c.setFont("Helvetica", 8)
    c.drawCentredString(dx + bw/2, y - 35, "Verificacion continua")
    c.drawCentredString(dx + bw/2, y - 46, "Durante toda la sesion")

    # Result
    rx = dx + bw + 15
    c.setStrokeColor(GREEN)
    c.line(rx, ay, rx + 30, ay)
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(rx + 35, ay + 6, "= Confianza")
    c.drawString(rx + 35, ay - 8, "   Total")

    # Use cases
    y -= bh + 40
    c.setFillColor(TEXT_WHITE)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(40, y, "Casos de uso conjuntos")

    y -= 10
    ucw = (W - 100) / 2
    uch = 95
    use_cases = [
        ("Banca Digital", "Cliente verificado por FacePhi en onboarding.\nDeep-Check monitoriza la sesion bancaria completa,\ndetectando si otro usuario toma el control."),
        ("Contratacion Remota", "Candidato verificado al inicio de entrevista.\nDeep-Check confirma que la misma persona\nresponde durante toda la sesion sin IA."),
        ("Examenes Online", "Estudiante identificado por biometria facial.\nDeep-Check supervisa continuamente que no hay\nsuplantacion ni uso de herramientas de IA."),
        ("Telemedicina", "Paciente verificado al inicio de consulta.\nDeep-Check garantiza la identidad durante\ntoda la interaccion medica remota."),
    ]
    for i, (title, desc) in enumerate(use_cases):
        col, row = i % 2, i // 2
        cx = 40 + col * (ucw + 20)
        cy = y - 15 - row * (uch + 12)
        card(c, cx, cy - uch, ucw, uch)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(cx + 15, cy - 18, title)
        c.setFillColor(TEXT_MUTED)
        c.setFont("Helvetica", 8.5)
        for j, dl in enumerate(desc.split('\n')):
            c.drawString(cx + 15, cy - 36 - j*13, dl)

    # Bottom value prop
    y = y - 2*(uch+12) - 50
    card(c, 40, y - 50, W - 80, 60, GREEN, 0.06)
    c.setFillColor(TEXT_WHITE)
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(W/2, y - 15, "FacePhi responde: 'Es quien dice ser?'")
    c.setFillColor(GREEN)
    c.drawCentredString(W/2, y - 33, "Deep-Check responde: 'Sigue siendo esa persona? Es real?'")

    green_bar(c)


# ── PAGE 5: Metricas ─────────────────────────────────────────────────────────

def page_metrics(c):
    bg(c)
    page_num(c, 5)

    y = H - 80
    badge(c, 40, y, 140, "METRICAS CLAVE")

    y -= 55
    c.setFillColor(TEXT_WHITE)
    c.setFont("Helvetica-Bold", 30)
    c.drawString(40, y, "Rendimiento validado.")

    y -= 25
    c.setFillColor(TEXT_MUTED)
    c.setFont("Helvetica", 11)
    c.drawString(40, y, "Resultados sobre datasets industriales estandar.")

    y -= 40
    mw = (W - 110) / 3
    mh = 75
    metrics = [
        ("AUC > 0.999", "Area bajo la curva ROC"),
        ("EER < 0.5%", "Equal Error Rate"),
        ("< 500ms", "Tiempo de inferencia"),
        ("0 bytes", "Datos biometricos\ntransmitidos"),
        ("6 capas", "Motor de deteccion\nindependientes"),
        ("24/7", "Verificacion continua\ndurante toda la sesion"),
    ]
    for i, (val, lab) in enumerate(metrics):
        col, row = i % 3, i // 3
        metric_card(c, 40 + col*(mw+15), y - mh - row*(mh+12), mw, mh, val, lab)

    # Standards
    y = y - 2*(mh+12) - 30
    c.setFillColor(TEXT_WHITE)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(40, y, "Alineacion con Estandares")

    y -= 25
    for name, desc in [
        ("ISO 30107-3", "Presentation Attack Detection - protocolo de evaluacion"),
        ("NIST FATE/PAD", "Submission en proceso al programa Face Analysis Technology"),
        ("GDPR Art. 25", "Privacy by Design - procesamiento integramente local"),
        ("ISO 27001", "Controles de seguridad de la informacion implementados"),
    ]:
        card(c, 40, y - 30, W - 80, 35)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(55, y - 18, name)
        c.setFillColor(TEXT_MUTED)
        c.setFont("Helvetica", 9)
        c.drawString(200, y - 18, desc)
        y -= 42

    y -= 15
    card(c, 40, y - 55, W - 80, 65, GREEN, 0.06)
    c.setFillColor(TEXT_WHITE)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(55, y - 15, "Robustez probada")
    c.setFillColor(TEXT_MUTED)
    c.setFont("Helvetica", 9)
    c.drawString(55, y - 32, "Evaluado contra: compresion JPEG agresiva, escala de grises, desenfoque,")
    c.drawString(55, y - 44, "redimensionado, condiciones de baja iluminacion. AUC > 0.98 en todos los casos.")

    green_bar(c)


# ── PAGE 6: Proximos Pasos ───────────────────────────────────────────────────

def page_next_steps(c):
    bg(c)
    grid(c)
    page_num(c, 6)

    # Subtle glow
    c.saveState()
    c.setFillColor(GREEN)
    c.setFillAlpha(0.03)
    c.circle(W/2, H/2 + 50, 180, fill=1, stroke=0)
    c.restoreState()

    y = H - 120
    badge(c, W/2 - 65, y, 130, "PROXIMOS PASOS")

    y -= 60
    c.setFillColor(TEXT_WHITE)
    c.setFont("Helvetica-Bold", 30)
    c.drawCentredString(W/2, y, "Construyamos juntos")
    y -= 36
    c.drawCentredString(W/2, y, "la confianza del futuro.")

    y -= 30
    c.setStrokeColor(GREEN)
    c.setLineWidth(2)
    c.line(W/2 - 30, y, W/2 + 30, y)

    y -= 50
    for num, desc in [
        ("01", "Demo tecnica personalizada para el equipo de FacePhi"),
        ("02", "Definicion conjunta de casos de uso prioritarios"),
        ("03", "Proof of Concept con integracion FacePhi + Deep-Check"),
        ("04", "Piloto con cliente real en entorno controlado"),
    ]:
        card(c, 80, y - 35, W - 160, 40)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 14)
        c.drawString(95, y - 22, num)
        c.setFillColor(TEXT_WHITE)
        c.setFont("Helvetica", 11)
        c.drawString(130, y - 22, desc)
        y -= 50

    y -= 30
    card(c, 80, y - 110, W - 160, 120, GREEN, 0.07)
    c.setFillColor(TEXT_WHITE)
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(W/2, y - 20, "Pablo Lopez Rodriguez")
    c.setFillColor(TEXT_MUTED)
    c.setFont("Helvetica", 11)
    c.drawCentredString(W/2, y - 40, "CEO & Founder")
    c.drawCentredString(W/2, y - 58, "HIUM Solutions SL")
    c.setFillColor(GREEN)
    c.setFont("Helvetica", 10)
    c.drawCentredString(W/2, y - 80, "https://deep-check-two.vercel.app")
    c.setFillColor(TEXT_DIM)
    c.setFont("Helvetica", 9)
    c.drawCentredString(W/2, y - 96, "Andalucia, Espana")

    c.setFillColor(TEXT_DIM)
    c.setFont("Helvetica", 8)
    c.drawCentredString(W/2, 60, "Documento confidencial. HIUM Solutions SL. Marzo 2026.")

    green_bar(c)


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    c = canvas.Canvas(OUTPUT, pagesize=A4)
    c.setTitle("Deep-Check - Propuesta FacePhi")
    c.setAuthor("HIUM Solutions SL")

    for page_fn in [page_cover, page_problem, page_solution, page_partnership, page_metrics, page_next_steps]:
        page_fn(c)
        c.showPage()

    c.save()
    print(f"PDF: {OUTPUT} ({os.path.getsize(OUTPUT)/1024:.0f} KB)")


if __name__ == '__main__':
    main()
