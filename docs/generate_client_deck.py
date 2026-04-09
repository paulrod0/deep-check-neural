#!/usr/bin/env python3
"""
Deep-Check Client Pitch Deck Generator
Generates a professional 8-page client-facing PDF.
Dark theme (#0a0a0c) with green accents (#00ff9d).
"""

import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas

# ── Colours ──────────────────────────────────────────────────────────────
BG        = HexColor("#0a0a0c")
GREEN     = HexColor("#00ff9d")
GREEN_DIM = HexColor("#00cc7d")
WHITE     = HexColor("#ffffff")
GRAY      = HexColor("#a0a0a0")
GRAY_DARK = HexColor("#555555")
CARD_BG   = HexColor("#131317")
CARD_BG2  = HexColor("#1a1a20")
RED_SOFT  = HexColor("#ff4d6a")
BLUE_SOFT = HexColor("#4da6ff")
YELLOW    = HexColor("#ffd700")

W, H = A4  # 595.28 x 841.89 pt

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PDF = os.path.join(OUTPUT_DIR, "deep_check_client_deck.pdf")


def draw_bg(c):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, fill=1, stroke=0)


def draw_top_bar(c, height=6*mm):
    c.setFillColor(GREEN)
    c.rect(0, H - height, W, height, fill=1, stroke=0)


def draw_footer(c, page_num, total=8):
    y = 18*mm
    c.setStrokeColor(GRAY_DARK)
    c.setLineWidth(0.5)
    c.line(30*mm, y, W - 30*mm, y)
    c.setFillColor(GRAY)
    c.setFont("Helvetica", 7)
    c.drawString(30*mm, y - 12, "deep-check.com  |  Confidencial")
    c.drawRightString(W - 30*mm, y - 12, f"{page_num} / {total}")


def draw_card(c, x, y, w, h, bg=CARD_BG, radius=8):
    c.setFillColor(bg)
    c.roundRect(x, y, w, h, radius, fill=1, stroke=0)


def draw_green_dot(c, x, y, r=3):
    c.setFillColor(GREEN)
    c.circle(x, y, r, fill=1, stroke=0)


# ═══════════════════════════════════════════════════════════════════════════
# PAGE 1 — Cover
# ═══════════════════════════════════════════════════════════════════════════
def page_cover(c):
    draw_bg(c)
    c.setFillColor(GREEN)
    c.rect(0, H - 6*mm, W, 6*mm, fill=1, stroke=0)

    # Decorative grid dots
    c.setFillColor(HexColor("#1a1a20"))
    for gx in range(8):
        for gy in range(12):
            c.circle(40*mm + gx*18*mm, 100*mm + gy*18*mm, 1.5, fill=1, stroke=0)

    y_title = H - 90*mm
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 52)
    c.drawString(40*mm, y_title, "Deep-Check.")

    c.setFont("Helvetica", 16)
    c.setFillColor(GREEN)
    c.drawString(40*mm, y_title - 30, "Continuous Identity Verification Platform")

    c.setStrokeColor(GREEN)
    c.setLineWidth(2)
    c.line(40*mm, y_title - 50, 160*mm, y_title - 50)

    c.setFillColor(WHITE)
    c.setFont("Helvetica", 13)
    y_tag = y_title - 80
    c.drawString(40*mm, y_tag, u"Verificaci\u00f3n continua.")
    c.drawString(40*mm, y_tag - 22, "Privacidad absoluta.")
    c.setFillColor(GREEN)
    c.drawString(40*mm, y_tag - 44, u"Detecci\u00f3n de deepfakes en tiempo real.")

    # Bottom info bar
    c.setFillColor(CARD_BG)
    c.rect(0, 0, W, 40*mm, fill=1, stroke=0)
    c.setFillColor(GRAY)
    c.setFont("Helvetica", 9)
    draw_green_dot(c, 34*mm, 25*mm, 3)
    c.drawString(40*mm, 24*mm, "https://deep-check-two.vercel.app")
    draw_green_dot(c, 34*mm, 15*mm, 3)
    c.drawString(40*mm, 14*mm, "Madrid, Spain  |  2026")


# ═══════════════════════════════════════════════════════════════════════════
# PAGE 2 — El Problema
# ═══════════════════════════════════════════════════════════════════════════
def page_problem(c):
    draw_bg(c)
    draw_top_bar(c)
    draw_footer(c, 2)

    y = H - 30*mm
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(30*mm, y, "01")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 32)
    c.drawString(48*mm, y - 2, "El Problema")

    # Big stat cards
    y_cards = y - 55*mm
    card_w = 75*mm
    card_h = 52*mm
    gap = 10*mm
    x_start = 30*mm

    stats = [
        ("$43B", "Fraude de identidad\nglobal (2024)", RED_SOFT),
        ("+97%", "Aumento deepfakes\nen 12 meses", RED_SOFT),
    ]
    for i, (big, desc, accent) in enumerate(stats):
        x = x_start + i * (card_w + gap)
        draw_card(c, x, y_cards, card_w, card_h)
        c.setFillColor(accent)
        c.setFont("Helvetica-Bold", 36)
        c.drawString(x + 10*mm, y_cards + card_h - 22*mm, big)
        c.setFillColor(GRAY)
        c.setFont("Helvetica", 9)
        lines = desc.split("\n")
        for li, line in enumerate(lines):
            c.drawString(x + 10*mm, y_cards + 12*mm - li*12, line)

    # Main problem statement
    y_prob = y_cards - 20*mm
    c.setFillColor(WHITE)
    c.setFont("Helvetica", 13)
    c.drawString(30*mm, y_prob, u"La verificaci\u00f3n de identidad tradicional se realiza una sola vez.")
    c.setFillColor(GRAY)
    c.setFont("Helvetica", 11)
    c.drawString(30*mm, y_prob - 20, u"Despu\u00e9s del check inicial, la sesi\u00f3n queda completamente desprotegida.")
    c.drawString(30*mm, y_prob - 36, "Cualquier persona puede sustituir al usuario verificado.")

    # Affected sectors
    y_sec = y_prob - 70*mm
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(30*mm, y_sec, "Sectores afectados")

    sectors = [
        (u"Contrataci\u00f3n remota", u"Suplantaci\u00f3n en entrevistas de trabajo"),
        ("Banca digital", u"Fraude post-KYC en sesiones activas"),
        (u"Educaci\u00f3n online", u"Suplantaci\u00f3n en ex\u00e1menes y evaluaciones"),
        ("Telemedicina", u"Suplantaci\u00f3n de identidad del paciente"),
        ("Marketplaces", u"Fotos falsas en listados de productos"),
        ("Dating & Social", "Perfiles falsos y catfishing"),
    ]
    for i, (title, desc) in enumerate(sectors):
        row = i // 2
        col = i % 2
        x = 30*mm + col * 82*mm
        yy = y_sec - 22*mm - row * 34*mm
        draw_green_dot(c, x + 3, yy + 5, 3)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(x + 10*mm, yy + 2, title)
        c.setFillColor(GRAY)
        c.setFont("Helvetica", 8.5)
        c.drawString(x + 10*mm, yy - 10, desc)


# ═══════════════════════════════════════════════════════════════════════════
# PAGE 3 — La Solucion
# ═══════════════════════════════════════════════════════════════════════════
def page_solution(c):
    draw_bg(c)
    draw_top_bar(c)
    draw_footer(c, 3)

    y = H - 30*mm
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(30*mm, y, "02")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 32)
    c.drawString(48*mm, y - 2, u"La Soluci\u00f3n")

    c.setFillColor(GREEN)
    c.setFont("Helvetica", 13)
    c.drawString(30*mm, y - 30, "6 capas independientes. 100% en el navegador. Cero datos al servidor.")

    layers = [
        ("Signos Vitales (rPPG)", u"An\u00e1lisis de flujo sangu\u00edneo facial\nmediante variaciones de color en video"),
        ("Micro-expresiones (FACS)", u"Detecci\u00f3n de unidades de acci\u00f3n facial\ninvoluntarias a 30 fps"),
        (u"Biometr\u00eda de Comportamiento", u"Patrones de escritura, movimiento\ndel rat\u00f3n y din\u00e1mica de interacci\u00f3n"),
        (u"IA Forense de P\u00edxeles", u"EfficientNet-B4 + DINOv2 analiza\nartefactos a nivel de p\u00edxel"),
        (u"An\u00e1lisis de Frecuencia", u"Ramas de frecuencia multi-escala\ndetectan manipulaciones invisibles"),
        (u"Din\u00e1mica de Interacci\u00f3n", u"An\u00e1lisis de patrones temporales\ny consistencia de comportamiento"),
    ]

    card_w = 75*mm
    card_h = 55*mm
    gap_x = 10*mm
    gap_y = 8*mm
    x_start = 30*mm
    y_start = y - 60*mm

    for i, (title, desc) in enumerate(layers):
        row = i // 2
        col = i % 2
        x = x_start + col * (card_w + gap_x)
        yy = y_start - row * (card_h + gap_y)

        draw_card(c, x, yy, card_w, card_h)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 18)
        c.drawString(x + 8*mm, yy + card_h - 16*mm, f"0{i+1}")
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(x + 8*mm, yy + card_h - 28*mm, title)
        c.setFillColor(GRAY)
        c.setFont("Helvetica", 8)
        for li, line in enumerate(desc.split("\n")):
            c.drawString(x + 8*mm, yy + card_h - 38*mm - li*11, line)

    # Bottom callout
    y_call = y_start - 3*(card_h + gap_y) - 5*mm
    draw_card(c, 30*mm, y_call, W - 60*mm, 28*mm, bg=HexColor("#0d1f15"))
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(W/2, y_call + 16*mm, u"PRIVACIDAD POR DISE\u00d1O")
    c.setFillColor(WHITE)
    c.setFont("Helvetica", 9)
    c.drawCentredString(W/2, y_call + 5*mm, u"Todos los datos biom\u00e9tricos se procesan localmente en el navegador. 0 bytes transmitidos.")


# ═══════════════════════════════════════════════════════════════════════════
# PAGE 4 — Productos
# ═══════════════════════════════════════════════════════════════════════════
def page_products(c):
    draw_bg(c)
    draw_top_bar(c)
    draw_footer(c, 4)

    y = H - 30*mm
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(30*mm, y, "03")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 32)
    c.drawString(48*mm, y - 2, "Productos")

    products = [
        ("DateSafe", u"Detecci\u00f3n de catfishing", u"Verificaci\u00f3n de identidad en tiempo real\npara plataformas de dating y redes sociales.", GREEN),
        ("ProofShot", u"Certificado fotogr\u00e1fico", u"Genera certificados criptogr\u00e1ficos que\nprueban que una foto es real y no manipulada.", BLUE_SOFT),
        ("DocSafe", u"Verificaci\u00f3n documental", u"An\u00e1lisis forense de documentos de identidad,\ndetectando manipulaciones y falsificaciones.", YELLOW),
        ("ListingCheck", u"Fotos de listados", u"Verificaci\u00f3n de autenticidad de fotos\nen marketplaces y listados inmobiliarios.", GREEN_DIM),
        ("ResumeGuard", u"Fotos de CV", u"Detecta fotos generadas por IA\nen curr\u00edculums y perfiles profesionales.", RED_SOFT),
        ("FakeCheck Ext.", u"Extensi\u00f3n Chrome", u"Detecci\u00f3n de deepfakes integrada\ndirectamente en el navegador.", WHITE),
        ("REST API v1", u"Integraci\u00f3n directa", u"API RESTful para integrar Deep-Check\nen cualquier aplicaci\u00f3n o plataforma.", GREEN),
    ]

    card_w = 75*mm
    card_h = 44*mm
    gap_x = 10*mm
    gap_y = 7*mm
    x_start = 30*mm
    y_start = y - 48*mm

    for i, (name, sub, desc, accent) in enumerate(products):
        row = i // 2
        col = i % 2
        x = x_start + col * (card_w + gap_x)
        yy = y_start - row * (card_h + gap_y)

        draw_card(c, x, yy, card_w, card_h)
        # accent line left
        c.setFillColor(accent)
        c.rect(x, yy, 3, card_h, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(x + 8*mm, yy + card_h - 12*mm, name)
        c.setFillColor(accent)
        c.setFont("Helvetica", 7.5)
        c.drawString(x + 8*mm, yy + card_h - 20*mm, sub)
        c.setFillColor(GRAY)
        c.setFont("Helvetica", 7.5)
        for li, line in enumerate(desc.split("\n")):
            c.drawString(x + 8*mm, yy + card_h - 30*mm - li*10, line)


# ═══════════════════════════════════════════════════════════════════════════
# PAGE 5 — Rendimiento
# ═══════════════════════════════════════════════════════════════════════════
def page_performance(c):
    draw_bg(c)
    draw_top_bar(c)
    draw_footer(c, 5)

    y = H - 30*mm
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(30*mm, y, "04")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 32)
    c.drawString(48*mm, y - 2, "Rendimiento")

    # Key metrics
    metrics = [
        ("AUC > 0.98", u"Validaci\u00f3n\ncross-source"),
        ("EER < 3%", "Equal Error\nRate"),
        ("< 500ms", "Tiempo de\ninferencia"),
        ("0 bytes", u"Datos biom\u00e9tricos\ntransmitidos"),
    ]
    y_met = y - 50*mm
    met_w = 33*mm
    x_start = 30*mm
    gap = (W - 60*mm - 4*met_w) / 3

    for i, (big, label) in enumerate(metrics):
        x = x_start + i * (met_w + gap)
        draw_card(c, x, y_met, met_w, 40*mm)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 16)
        c.drawCentredString(x + met_w/2, y_met + 26*mm, big)
        c.setFillColor(GRAY)
        c.setFont("Helvetica", 7)
        for li, line in enumerate(label.split("\n")):
            c.drawCentredString(x + met_w/2, y_met + 10*mm - li*10, line)

    # Model detail
    y_detail = y_met - 25*mm
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(30*mm, y_detail, "Modelo V7 — Cross-Source Validation")
    c.setFillColor(GRAY)
    c.setFont("Helvetica", 9)
    c.drawString(30*mm, y_detail - 16, u"AUC 0.988 en validaci\u00f3n cruzada entre fuentes.")
    c.drawString(30*mm, y_detail - 30, u"Entrenado con 1M+ im\u00e1genes de 13+ generadores distintos.")
    c.drawString(30*mm, y_detail - 44, u"Anti-leak verificado: train \u2229 test = 0.")

    # Robustness table
    y_rob = y_detail - 72*mm
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(30*mm, y_rob, "Robustez")

    rob_data = [
        ("Original",    "AUC 1.0000", "EER 0.00%"),
        ("JPEG Q10",    "AUC 0.9986", "EER 2.20%"),
        ("Blur r=5",    "AUC 0.9853", "EER 6.90%"),
        ("Grayscale",   "AUC 0.9801", "EER 7.20%"),
        ("Resize 25%",  "AUC 0.9995", "EER 0.10%"),
    ]
    y_table = y_rob - 18*mm
    c.setFillColor(GRAY_DARK)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(30*mm, y_table, u"CONDICI\u00d3N")
    c.drawString(85*mm, y_table, "AUC")
    c.drawString(125*mm, y_table, "EER")

    for i, (cond, auc, eer) in enumerate(rob_data):
        yy = y_table - 14 - i*14
        c.setFillColor(WHITE)
        c.setFont("Helvetica", 9)
        c.drawString(30*mm, yy, cond)
        c.setFillColor(GREEN)
        c.drawString(85*mm, yy, auc)
        c.drawString(125*mm, yy, eer)

    # Standards
    y_std = y_table - 14 - len(rob_data)*14 - 20*mm
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(30*mm, y_std, u"Est\u00e1ndares")
    standards = [
        "ISO 30107-3 (Presentation Attack Detection)",
        "NIST FATE/PAD Submission",
        u"GDPR Art. 25 (Protecci\u00f3n de datos por dise\u00f1o)",
    ]
    for i, std in enumerate(standards):
        yy = y_std - 16 - i*16
        draw_green_dot(c, 33*mm, yy + 3, 2.5)
        c.setFillColor(WHITE)
        c.setFont("Helvetica", 9)
        c.drawString(40*mm, yy, std)


# ═══════════════════════════════════════════════════════════════════════════
# PAGE 6 — Tecnologia
# ═══════════════════════════════════════════════════════════════════════════
def page_technology(c):
    draw_bg(c)
    draw_top_bar(c)
    draw_footer(c, 6)

    y = H - 30*mm
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(30*mm, y, "05")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 32)
    c.drawString(48*mm, y - 2, u"Tecnolog\u00eda")

    stack = [
        ("Frontend", "Next.js + TypeScript + Tailwind", u"Aplicaci\u00f3n web moderna con App Router\ny renderizado server-side."),
        ("AI Runtime", "ONNX Runtime WebAssembly", u"Inferencia de modelos de IA directamente\nen el navegador del usuario."),
        ("Modelos", "DINOv2 + EfficientNet-B4", u"Ensemble con an\u00e1lisis multi-escala\nde frecuencias y visi\u00f3n auto-supervisada."),
        ("Backend", "Supabase Auth + PostgreSQL", u"Autenticaci\u00f3n y base de datos serverless.\nRow Level Security para aislamiento."),
        ("Hosting", "Vercel Edge Network", u"Distribuci\u00f3n global con CDN, SSL\nautom\u00e1tico y deploys at\u00f3micos."),
        ("Licencia", "Business Source License", u"C\u00f3digo visible con protecci\u00f3n de IP.\nConversi\u00f3n a open source futura."),
    ]

    y_start = y - 48*mm
    card_w = W - 60*mm
    card_h = 36*mm
    gap = 6*mm

    for i, (cat, tech, desc) in enumerate(stack):
        col = i // 3
        row = i % 3
        cw = (card_w - gap) / 2
        x = 30*mm + col * (cw + gap)
        yy = y_start - row * (card_h + gap)

        draw_card(c, x, yy, cw, card_h)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(x + 8*mm, yy + card_h - 11*mm, cat.upper())
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(x + 8*mm, yy + card_h - 20*mm, tech)
        c.setFillColor(GRAY)
        c.setFont("Helvetica", 7)
        for li, line in enumerate(desc.split("\n")):
            c.drawString(x + 8*mm, yy + card_h - 28*mm - li*9, line)

    # Architecture diagram
    y_arch = y_start - 3*(card_h + gap) - 10*mm
    draw_card(c, 30*mm, y_arch, card_w, 55*mm, bg=HexColor("#0d1f15"))
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(W/2, y_arch + 44*mm, "ARQUITECTURA: PROCESAMIENTO 100% CLIENT-SIDE")

    flow_items = [
        (50*mm,  "Navegador"),
        (95*mm,  "MediaPipe"),
        (140*mm, "ONNX Runtime"),
    ]
    y_flow = y_arch + 26*mm
    for x_f, label in flow_items:
        c.setStrokeColor(GREEN)
        c.setLineWidth(1)
        c.setFillColor(HexColor("#0a0a0c"))
        c.roundRect(x_f - 18*mm, y_flow - 6*mm, 36*mm, 14*mm, 4, fill=1, stroke=1)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 8)
        c.drawCentredString(x_f, y_flow, label)

    c.setStrokeColor(GREEN)
    c.setLineWidth(1.5)
    c.line(50*mm + 18*mm, y_flow, 95*mm - 18*mm, y_flow)
    c.line(95*mm + 18*mm, y_flow, 140*mm - 18*mm, y_flow)

    x_res = 140*mm + 28*mm
    c.setStrokeColor(GREEN)
    c.setFillColor(HexColor("#0a0a0c"))
    c.roundRect(x_res - 14*mm, y_flow - 6*mm, 30*mm, 14*mm, 4, fill=1, stroke=1)
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 8)
    c.drawCentredString(x_res + 1*mm, y_flow, "Resultado")
    c.line(140*mm + 18*mm, y_flow, x_res - 14*mm, y_flow)

    c.setFillColor(GRAY)
    c.setFont("Helvetica", 8)
    c.drawCentredString(W/2, y_arch + 6*mm, u"Datos biom\u00e9tricos nunca salen del dispositivo del usuario. GDPR Art. 25 nativo.")


# ═══════════════════════════════════════════════════════════════════════════
# PAGE 7 — Casos de Uso
# ═══════════════════════════════════════════════════════════════════════════
def page_use_cases(c):
    draw_bg(c)
    draw_top_bar(c)
    draw_footer(c, 7)

    y = H - 30*mm
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(30*mm, y, "06")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 32)
    c.drawString(48*mm, y - 2, "Casos de Uso")

    use_cases = [
        (
            u"Contrataci\u00f3n Remota",
            u"Verificaci\u00f3n continua del candidato",
            u"Durante toda la entrevista, Deep-Check verifica que\n"
            u"el candidato es quien se identific\u00f3.\n"
            u"Detecta sustituciones y deepfakes en tiempo real.",
            GREEN,
        ),
        (
            u"Ex\u00e1menes Online",
            u"Supervisi\u00f3n biom\u00e9trica continua",
            u"Monitoriza la identidad del estudiante durante\n"
            u"todo el examen sin proctors humanos.\n"
            u"6 capas de detecci\u00f3n simult\u00e1neas.",
            BLUE_SOFT,
        ),
        (
            "Banca Digital",
            u"Protecci\u00f3n post-KYC de sesi\u00f3n",
            u"Tras la verificaci\u00f3n KYC inicial, Deep-Check\n"
            u"protege la sesi\u00f3n activa contra suplantaci\u00f3n.\n"
            u"Cumplimiento normativo autom\u00e1tico.",
            YELLOW,
        ),
        (
            "Telemedicina",
            "Identidad del paciente verificada",
            u"Garantiza que el paciente en la consulta virtual\n"
            u"es quien dice ser durante toda la sesi\u00f3n.\n"
            u"Privacidad total: procesamiento local.",
            RED_SOFT,
        ),
        (
            "Marketplaces",
            u"Verificaci\u00f3n de fotos de listados",
            u"Detecta fotos generadas por IA o manipuladas\n"
            u"en listados de productos e inmuebles.\n"
            u"Aumenta la confianza del comprador.",
            GREEN_DIM,
        ),
        (
            "Dating & Social",
            u"Detecci\u00f3n de catfishing",
            u"Verifica que las fotos de perfil corresponden\n"
            u"a una persona real y no a una IA generativa.\n"
            u"Protecci\u00f3n contra estafas rom\u00e1nticas.",
            HexColor("#ff8c00"),
        ),
    ]

    card_w = 75*mm
    card_h = 60*mm
    gap_x = 10*mm
    gap_y = 8*mm
    x_start = 30*mm
    y_start = y - 48*mm

    for i, (title, sub, desc, accent) in enumerate(use_cases):
        row = i // 2
        col = i % 2
        x = x_start + col * (card_w + gap_x)
        yy = y_start - row * (card_h + gap_y)

        draw_card(c, x, yy, card_w, card_h)
        c.setFillColor(accent)
        c.rect(x + 8*mm, yy + card_h - 3, 20*mm, 2.5, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(x + 8*mm, yy + card_h - 16*mm, title)
        c.setFillColor(accent)
        c.setFont("Helvetica", 8)
        c.drawString(x + 8*mm, yy + card_h - 24*mm, sub)
        c.setFillColor(GRAY)
        c.setFont("Helvetica", 7.5)
        for li, line in enumerate(desc.split("\n")):
            c.drawString(x + 8*mm, yy + card_h - 33*mm - li*10, line)


# ═══════════════════════════════════════════════════════════════════════════
# PAGE 8 — Cierre
# ═══════════════════════════════════════════════════════════════════════════
def page_closing(c):
    draw_bg(c)
    draw_top_bar(c)
    draw_footer(c, 8)

    y = H - 30*mm
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(30*mm, y, "07")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 32)
    c.drawString(48*mm, y - 2, "Empieza Hoy")

    # Big CTA
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 18)
    c.drawCentredString(W/2, y - 45*mm, u"No necesitas tarjeta de cr\u00e9dito.")
    c.setFillColor(WHITE)
    c.setFont("Helvetica", 12)
    c.drawCentredString(W/2, y - 60*mm, u"Prueba Deep-Check gratis y verifica la identidad de tus usuarios en minutos.")

    # Pricing cards
    plans = [
        ("Free", u"0 \u20ac/mes", "10 sesiones/mes", "Ideal para probar"),
        ("Starter", u"29 \u20ac/mes", "50 sesiones/mes", "Equipos en crecimiento"),
        ("Pro", u"79 \u20ac/mes", "Sesiones ilimitadas", "Uso profesional"),
        ("Enterprise", "Personalizado", "Volumen ilimitado", "SLA + soporte dedicado"),
    ]

    card_w = 33*mm
    card_h = 72*mm
    gap_p = 6*mm
    total_w = 4*card_w + 3*gap_p
    x_start = (W - total_w) / 2
    y_cards = y - 90*mm

    for i, (name, price, sessions, desc) in enumerate(plans):
        x = x_start + i * (card_w + gap_p)
        is_pro = (name == "Pro")
        bg = HexColor("#0d1f15") if is_pro else CARD_BG
        draw_card(c, x, y_cards - card_h, card_w, card_h, bg=bg)

        if is_pro:
            c.setStrokeColor(GREEN)
            c.setLineWidth(1.5)
            c.roundRect(x, y_cards - card_h, card_w, card_h, 8, fill=0, stroke=1)
            c.setFillColor(GREEN)
            c.setFont("Helvetica-Bold", 6)
            c.drawCentredString(x + card_w/2, y_cards - 4*mm, "POPULAR")

        c.setFillColor(GREEN if is_pro else WHITE)
        c.setFont("Helvetica-Bold", 12)
        c.drawCentredString(x + card_w/2, y_cards - 18*mm, name)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 14)
        c.drawCentredString(x + card_w/2, y_cards - 32*mm, price)
        c.setFillColor(GRAY)
        c.setFont("Helvetica", 7.5)
        c.drawCentredString(x + card_w/2, y_cards - 44*mm, sessions)
        c.setFont("Helvetica", 7)
        c.drawCentredString(x + card_w/2, y_cards - 56*mm, desc)

    # Contact section
    y_contact = y_cards - card_h - 30*mm
    draw_card(c, 30*mm, y_contact - 50*mm, W - 60*mm, 48*mm, bg=CARD_BG2)

    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(W/2, y_contact - 12*mm, "Contacto")

    c.setFillColor(WHITE)
    c.setFont("Helvetica", 11)
    c.drawCentredString(W/2, y_contact - 26*mm, "Pablo Lopez Rodriguez")

    c.setFillColor(GRAY)
    c.setFont("Helvetica", 10)
    c.drawCentredString(W/2, y_contact - 38*mm, "Madrid, Spain")

    c.setFillColor(GREEN)
    c.setFont("Helvetica", 10)
    c.drawCentredString(W/2, y_contact - 50*mm + 6*mm, "https://deep-check-two.vercel.app")

    # Final tagline
    y_final = y_contact - 50*mm - 25*mm
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 20)
    c.drawCentredString(W/2, y_final, "Deep-Check.")
    c.setFillColor(GREEN)
    c.setFont("Helvetica", 10)
    c.drawCentredString(W/2, y_final - 18, "Continuous Identity Verification")


# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════
def main():
    c = canvas.Canvas(OUTPUT_PDF, pagesize=A4)
    c.setTitle("Deep-Check — Client Deck 2026")
    c.setAuthor("Deep-Check")
    c.setSubject("Continuous Identity Verification Platform")

    pages = [
        page_cover,
        page_problem,
        page_solution,
        page_products,
        page_performance,
        page_technology,
        page_use_cases,
        page_closing,
    ]

    for i, page_fn in enumerate(pages):
        page_fn(c)
        if i < len(pages) - 1:
            c.showPage()

    c.save()
    print(f"Client deck generated: {OUTPUT_PDF}")
    print(f"Pages: {len(pages)}")


if __name__ == "__main__":
    main()
