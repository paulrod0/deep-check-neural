#!/usr/bin/env python3
"""
Deep-Check — Company & Product Overview Deck (NO FUNDING ASK)

Variation of generate_pitch_deck.py with the funding round removed:
  - cover: no "Pre-Seed Round / 150.000 EUR" headline
  - no slide_round (the ask is fully omitted)
  - closing footer: no mention of the round
  - intent: send to anyone (potential clients, partners, advisors,
    soft VC intros) without putting them in "should I invest?" mode.

The body content (problem → solution → market → business model →
traction → competition → team → closing) is identical to the master
pitch deck, so any update there should be ported here.

Dark theme (#0a0a0c) with green accents (#00ff9d).
"""

import os
from reportlab.lib.pagesizes import landscape, A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, Color
from reportlab.pdfgen import canvas

# ── Colors ──────────────────────────────────────────────────────────
BG          = HexColor("#0a0a0c")
GREEN       = HexColor("#00ff9d")
GREEN_DIM   = HexColor("#00cc7d")
GREEN_DARK  = HexColor("#00994e")
WHITE       = HexColor("#ffffff")
GRAY_LIGHT  = HexColor("#b0b0b8")
GRAY_MID    = HexColor("#6a6a78")
GRAY_DARK   = HexColor("#2a2a32")
CARD_BG     = HexColor("#111118")
RED_ACCENT  = HexColor("#ff4d6a")
BLUE_ACCENT = HexColor("#4d9fff")

# ── Page setup ──────────────────────────────────────────────────────
W, H = landscape(A4)  # 297mm x 210mm
MARGIN = 25 * mm

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH = os.path.join(OUTPUT_DIR, "deep_check_overview_deck.pdf")


def draw_bg(c):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, fill=True, stroke=False)


def draw_top_bar(c, accent_color=GREEN):
    c.setFillColor(accent_color)
    c.rect(0, H - 3, W, 3, fill=True, stroke=False)


def draw_bottom_bar(c, text="deep-check.ai", page_num=None, total=9):
    c.setFillColor(GRAY_DARK)
    c.rect(0, 0, W, 18, fill=True, stroke=False)
    c.setFont("Helvetica", 7)
    c.setFillColor(GRAY_MID)
    c.drawString(MARGIN, 6, text)
    if page_num is not None:
        c.drawRightString(W - MARGIN, 6, f"{page_num} / {total}")


def draw_card(c, x, y, w, h, bg=CARD_BG, radius=8):
    c.setFillColor(bg)
    c.roundRect(x, y, w, h, radius, fill=True, stroke=False)


# ═══════════════════════════════════════════════════════════════════
# SLIDES
# ═══════════════════════════════════════════════════════════════════

def slide_cover(c):
    """Page 1: Cover slide."""
    draw_bg(c)

    # Subtle green glow
    for i in range(5):
        alpha = 0.02 - i * 0.003
        if alpha > 0:
            glow = Color(0, 1, 0.616, alpha)
            c.setFillColor(glow)
            c.circle(W / 2, H / 2 + 20, 180 + i * 40, fill=True, stroke=False)

    # Top accent line
    c.setFillColor(GREEN)
    c.rect(MARGIN, H - 50, 60, 3, fill=True, stroke=False)

    # Company name
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 52)
    c.drawString(MARGIN, H - 110, "Deep-Check.")

    # Tagline
    c.setFillColor(GREEN)
    c.setFont("Helvetica", 18)
    c.drawString(MARGIN, H - 145, "AI-Powered Continuous Identity Verification Platform")

    # Divider
    c.setStrokeColor(GRAY_DARK)
    c.setLineWidth(0.5)
    c.line(MARGIN, H - 165, W / 2 + 40, H - 165)

    # Document type (replaces the funding round headline)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 20)
    c.drawString(MARGIN, H - 200, "Company & Product Overview")

    c.setFillColor(GREEN)
    c.setFont("Helvetica", 14)
    c.drawString(MARGIN, H - 232,
                 "Forensic AI against deepfakes, fake identities and document fraud")

    # Three highlight chips so the cover does not feel empty
    chip_y = H - 285
    chips = [
        ("PRODUCTO LIVE", "Marzo 2026"),
        ("STACK 100% PROPIO", "9 modelos · 213k LOC"),
        ("INFRA 100% UE", "AWS Irlanda + Vercel UE"),
    ]
    chip_w = 175
    for i, (label, value) in enumerate(chips):
        cx = MARGIN + i * (chip_w + 12)
        draw_card(c, cx, chip_y, chip_w, 44, bg=CARD_BG)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(cx + 12, chip_y + 28, label)
        c.setFillColor(WHITE)
        c.setFont("Helvetica", 11)
        c.drawString(cx + 12, chip_y + 11, value)

    # Bottom info
    c.setFillColor(GRAY_MID)
    c.setFont("Helvetica", 11)
    c.drawString(MARGIN, 55, "Confidencial  |  Abril 2026")
    c.drawString(MARGIN, 38, "Pablo Lopez Rodriguez  |  Madrid, Spain")

    # URL on right
    c.setFillColor(GREEN_DIM)
    c.setFont("Helvetica", 10)
    c.drawRightString(W - MARGIN, 55, "deep-check-two.vercel.app")

    # Version badge — kept; refers to the deployed model, not a funding round
    draw_card(c, W - MARGIN - 120, H - 110, 120, 32, bg=CARD_BG)
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 10)
    c.drawCentredString(W - MARGIN - 60, H - 100, "V7 MODEL  |  AUC 0.988")


def slide_problem(c):
    """Page 2: El Problema."""
    draw_bg(c)
    draw_top_bar(c, RED_ACCENT)
    draw_bottom_bar(c, page_num=2)

    # Section label
    c.setFillColor(RED_ACCENT)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(MARGIN, H - 40, "01")
    c.setFont("Helvetica", 10)
    c.drawString(MARGIN + 20, H - 40, "EL PROBLEMA")

    # Title
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 34)
    c.drawString(MARGIN, H - 80, "La verificacion de identidad")
    c.drawString(MARGIN, H - 118, "esta rota.")

    # Stat cards
    card_w = 170
    card_h = 90
    gap = 20
    start_x = MARGIN
    y_cards = H - 240

    stats = [
        ("$43B", "Fraude de identidad\nglobal (2023)", RED_ACCENT),
        ("+97%", "Aumento deepfakes\nen 12 meses", RED_ACCENT),
        ("85%", "Deepfakes no detectados\npor herramientas actuales", RED_ACCENT),
    ]

    for i, (val, label, color) in enumerate(stats):
        x = start_x + i * (card_w + gap)
        draw_card(c, x, y_cards, card_w, card_h)
        c.setFillColor(color)
        c.setFont("Helvetica-Bold", 30)
        c.drawCentredString(x + card_w / 2, y_cards + card_h - 35, val)
        c.setFillColor(GRAY_LIGHT)
        c.setFont("Helvetica", 9)
        lines = label.split("\n")
        for j, line in enumerate(lines):
            c.drawCentredString(x + card_w / 2, y_cards + 20 - j * 12, line)

    # Key insight box
    insight_y = 50
    draw_card(c, MARGIN, insight_y, W - 2 * MARGIN, 55, bg=HexColor("#1a0a0a"))
    c.setFillColor(RED_ACCENT)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(MARGIN + 15, insight_y + 38, "PROBLEMA CLAVE")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(MARGIN + 15, insight_y + 14, "La verificacion puntual no es suficiente.")
    c.setFillColor(GRAY_LIGHT)
    c.setFont("Helvetica", 11)
    c.drawString(MARGIN + 380, insight_y + 14,
                 "Un atacante puede sustituir al usuario despues del check inicial.")


def slide_solution(c):
    """Page 3: La Solucion."""
    draw_bg(c)
    draw_top_bar(c)
    draw_bottom_bar(c, page_num=3)

    # Section label
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(MARGIN, H - 40, "02")
    c.setFont("Helvetica", 10)
    c.drawString(MARGIN + 20, H - 40, "LA SOLUCION")

    # Title
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 32)
    c.drawString(MARGIN, H - 80, "Verificacion continua durante")
    c.drawString(MARGIN, H - 116, "toda la sesion.")

    # 6 layers as cards in 2 rows of 3 (full width, evenly spaced)
    layers = [
        ("rPPG", "Flujo sanguineo\nfacial en tiempo real", "30%"),
        ("FACS", "Micro-expresiones\nfaciales (Action Units)", "26%"),
        ("Pixel CNN", "EfficientNet-B4 +\nanalisis de frecuencia", "22%"),
        ("Blendshape", "CNN v2 deteccion\nde morphing", "10%"),
        ("Keystroke", "Patron de escritura\nbiometrico", "12%"),
        ("DINOv2", "V7 cross-source\ndeteccion (AUC 0.988)", "NEW"),
    ]

    card_h = 75
    gap_x = 20
    gap_y = 14
    card_w = (W - 2 * MARGIN - 2 * gap_x) / 3   # ≈ 220 — fills full width
    start_x = MARGIN
    start_y = H - 215

    for i, (name, desc, weight) in enumerate(layers):
        col = i % 3
        row = i // 3
        x = start_x + col * (card_w + gap_x)
        y = start_y - row * (card_h + gap_y)
        draw_card(c, x, y, card_w, card_h)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 13)
        c.drawString(x + 12, y + card_h - 22, name)
        c.setFillColor(GREEN_DARK if weight != "NEW" else HexColor("#ff9d00"))
        c.setFont("Helvetica-Bold", 10)
        c.drawRightString(x + card_w - 12, y + card_h - 22, weight)
        c.setFillColor(GRAY_LIGHT)
        c.setFont("Helvetica", 9)
        for j, line in enumerate(desc.split("\n")):
            c.drawString(x + 12, y + card_h - 42 - j * 12, line)

    # Key differentiators as a horizontal strip BELOW the cards
    # (used to be on the right column, which overlapped with the right-most
    # card column — moved here to avoid collisions and fully use the page).
    diffs = [
        ("100% Client-Side",
         "Procesamiento en navegador\nvia WebAssembly. Cero datos al servidor."),
        ("GDPR Native",
         "Privacy-by-design.\nSin almacenamiento biometrico."),
        ("6 Capas Independientes",
         "Fusion bayesiana en logit.\nCada capa vota independiente."),
        ("Solo Navegador",
         "Sin apps. Sin SDKs pesados.\nCualquier navegador moderno."),
    ]

    diff_gap = 16
    diff_w = (W - 2 * MARGIN - 3 * diff_gap) / 4   # ≈ 163 — full-width strip
    diff_h = 75
    diff_y = 55   # sits comfortably above the page footer

    for i, (title, desc) in enumerate(diffs):
        x = MARGIN + i * (diff_w + diff_gap)
        draw_card(c, x, diff_y, diff_w, diff_h)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(x + 12, diff_y + diff_h - 22, title)
        c.setFillColor(GRAY_LIGHT)
        c.setFont("Helvetica", 8)
        for j, line in enumerate(desc.split("\n")):
            c.drawString(x + 12, diff_y + diff_h - 40 - j * 11, line)


def slide_market(c):
    """Page 4: Mercado."""
    draw_bg(c)
    draw_top_bar(c)
    draw_bottom_bar(c, page_num=4)

    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(MARGIN, H - 40, "03")
    c.setFont("Helvetica", 10)
    c.drawString(MARGIN + 20, H - 40, "MERCADO")

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 28)
    c.drawString(MARGIN, H - 78, "Mercado en crecimiento exponencial")

    # TAM / SAM / SOM concentric circles
    cx = MARGIN + 160
    cy = H / 2 - 25

    # TAM
    c.setFillColor(Color(0, 1, 0.616, 0.08))
    c.circle(cx, cy, 110, fill=True, stroke=False)
    c.setStrokeColor(Color(0, 1, 0.616, 0.3))
    c.setLineWidth(1)
    c.circle(cx, cy, 110, fill=False, stroke=True)

    # SAM
    c.setFillColor(Color(0, 1, 0.616, 0.15))
    c.circle(cx, cy, 75, fill=True, stroke=False)
    c.setStrokeColor(Color(0, 1, 0.616, 0.5))
    c.circle(cx, cy, 75, fill=False, stroke=True)

    # SOM
    c.setFillColor(Color(0, 1, 0.616, 0.3))
    c.circle(cx, cy, 38, fill=True, stroke=False)
    c.setStrokeColor(GREEN)
    c.setLineWidth(1.5)
    c.circle(cx, cy, 38, fill=False, stroke=True)

    # Labels on circles
    c.setFillColor(GREEN_DIM)
    c.setFont("Helvetica", 8)
    c.drawCentredString(cx, cy + 100, "TAM")
    c.drawCentredString(cx, cy + 65, "SAM")
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 8)
    c.drawCentredString(cx, cy + 28, "SOM")

    # Detail cards
    detail_x = cx + 160
    detail_w = W - detail_x - MARGIN

    market_data = [
        ("TAM", "$16.7B", "Verificacion de identidad global", "CAGR 15.4% (2024-2030)"),
        ("SAM", "$4.2B", "Verificacion biometrica EU + US", "Regulacion eIDAS 2.0 + deepfake laws"),
        ("SOM", "$120M", "Entrevistas remotas + examenes online", "Objetivo Year 3, mercados iniciales"),
    ]

    for i, (tag, val, desc, note) in enumerate(market_data):
        y = H - 175 - i * 90   # moved down so the title has clear breathing room
        draw_card(c, detail_x, y, detail_w, 75, bg=CARD_BG)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(detail_x + 12, y + 55, tag)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 26)
        c.drawString(detail_x + 55, y + 45, val)
        c.setFillColor(GRAY_LIGHT)
        c.setFont("Helvetica", 10)
        c.drawString(detail_x + 12, y + 24, desc)
        c.setFillColor(GRAY_MID)
        c.setFont("Helvetica", 8)
        c.drawString(detail_x + 12, y + 8, note)


def slide_business_model(c):
    """Page 5: Modelo de Negocio."""
    draw_bg(c)
    draw_top_bar(c)
    draw_bottom_bar(c, page_num=5)

    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(MARGIN, H - 40, "04")
    c.setFont("Helvetica", 10)
    c.drawString(MARGIN + 20, H - 40, "MODELO DE NEGOCIO")

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 32)
    c.drawString(MARGIN, H - 78, "SaaS con multiples canales de ingreso")

    # Pricing tier cards
    tiers = [
        ("Free", "0 EUR", "10 sesiones/mes",
         ["Detector basico", "1 producto", "Marca Deep-Check"], GRAY_MID),
        ("Starter", "29 EUR/mo", "50 sesiones/mes",
         ["6 capas verificacion", "3 productos", "Email soporte"], GREEN_DIM),
        ("Pro", "79 EUR/mo", "Ilimitado",
         ["6 capas + API", "Todos productos", "Soporte prioritario"], GREEN),
        ("Enterprise", "Custom", "Custom",
         ["On-premise opcion", "SLA dedicado", "Integracion custom"], BLUE_ACCENT),
    ]

    tier_w = 145
    tier_h = 155
    tier_gap = 16
    tier_start_x = MARGIN
    tier_y = H - 260

    for i, (name, price, sessions, features, accent) in enumerate(tiers):
        x = tier_start_x + i * (tier_w + tier_gap)
        draw_card(c, x, tier_y, tier_w, tier_h)
        c.setFillColor(accent)
        c.rect(x, tier_y + tier_h - 3, tier_w, 3, fill=True, stroke=False)
        c.setFont("Helvetica-Bold", 13)
        c.drawString(x + 12, tier_y + tier_h - 24, name)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 18)
        c.drawString(x + 12, tier_y + tier_h - 48, price)
        c.setFillColor(GRAY_MID)
        c.setFont("Helvetica", 8)
        c.drawString(x + 12, tier_y + tier_h - 62, sessions)
        c.setFillColor(GRAY_LIGHT)
        c.setFont("Helvetica", 8)
        for j, feat in enumerate(features):
            c.drawString(x + 12, tier_y + tier_h - 82 - j * 14, f"\u2713  {feat}")

    # Revenue split bar
    rev_y = 42
    rev_h = 70
    draw_card(c, MARGIN, rev_y, W - 2 * MARGIN, rev_h)

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(MARGIN + 15, rev_y + rev_h - 22, "Distribucion de Ingresos (Objetivo Year 3)")

    splits = [
        ("Subscripciones", "40%", 0.40, GREEN),
        ("API Pay-per-use", "25%", 0.25, GREEN_DIM),
        ("Enterprise", "30%", 0.30, BLUE_ACCENT),
        ("Chrome Ext.", "5%", 0.05, GRAY_MID),
    ]

    bar_x = MARGIN + 15
    bar_y = rev_y + 12
    bar_w = W - 2 * MARGIN - 30
    bar_h = 18

    offset = 0
    for label, pct_str, pct, color in splits:
        seg_w = bar_w * pct
        c.setFillColor(color)
        c.rect(bar_x + offset, bar_y, seg_w, bar_h, fill=True, stroke=False)
        c.setFillColor(BG if color != GRAY_MID else WHITE)
        c.setFont("Helvetica-Bold", 8)
        if seg_w > 50:
            c.drawCentredString(bar_x + offset + seg_w / 2, bar_y + 5, f"{label} {pct_str}")
        offset += seg_w


def slide_traction(c):
    """Page 6: Traccion."""
    draw_bg(c)
    draw_top_bar(c)
    draw_bottom_bar(c, page_num=6)

    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(MARGIN, H - 40, "05")
    c.setFont("Helvetica", 10)
    c.drawString(MARGIN + 20, H - 40, "TRACCION")

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 32)
    c.drawString(MARGIN, H - 78, "7 meses, un fundador, resultados reales")

    # Two columns
    col1_x = MARGIN
    col2_x = W / 2 + 15

    # Left: Product
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(col1_x, H - 115, "Producto")

    milestones_left = [
        "8 productos de consumo en produccion",
        "REST API v1 operativa",
        "Extension Chrome publicada",
        "Motor Veritas Ensemble (6 capas, fusion bayesiana)",
        "100% client-side via WebAssembly",
    ]

    y = H - 140
    for item in milestones_left:
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(col1_x, y, "\u25b8")
        c.setFillColor(GRAY_LIGHT)
        c.setFont("Helvetica", 10)
        c.drawString(col1_x + 14, y, item)
        y -= 22

    # Right: Research
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(col2_x, H - 115, "Investigacion y Validacion")

    milestones_right = [
        "Paper publicado en Zenodo con DOI",
        "NIST FATE/PAD submission en progreso",
        "Modelo V7 con DINOv2: AUC 0.988 cross-source",
        "Benchmark ISO 30107-3 completado",
        "Conversaciones con universidades y bufetes para pilotos",
    ]

    y = H - 140
    for item in milestones_right:
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(col2_x, y, "\u25b8")
        c.setFillColor(GRAY_LIGHT)
        c.setFont("Helvetica", 10)
        c.drawString(col2_x + 14, y, item)
        y -= 22

    # Stat cards at bottom
    stat_y = 38
    stat_h = 70
    stat_w = 130
    stat_gap = 18
    stats_data = [
        ("8", "Productos\nen produccion"),
        ("6", "Capas de\ndeteccion"),
        ("0.988", "AUC V7\ncross-source"),
        ("0", "Datos biometricos\nal servidor"),
        ("1", "Fundador\ntodo el stack"),
    ]

    total_w = len(stats_data) * stat_w + (len(stats_data) - 1) * stat_gap
    start_x = (W - total_w) / 2

    for i, (val, label) in enumerate(stats_data):
        x = start_x + i * (stat_w + stat_gap)
        draw_card(c, x, stat_y, stat_w, stat_h)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 24)
        c.drawCentredString(x + stat_w / 2, stat_y + stat_h - 30, val)
        c.setFillColor(GRAY_LIGHT)
        c.setFont("Helvetica", 8)
        lines = label.split("\n")
        for j, line in enumerate(lines):
            c.drawCentredString(x + stat_w / 2, stat_y + 18 - j * 11, line)

    # Waitlist banner
    banner_y = stat_y + stat_h + 10
    draw_card(c, MARGIN, banner_y, W - 2 * MARGIN, 28, bg=HexColor("#0a1a12"))
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 10)
    c.drawCentredString(W / 2, banner_y + 9,
                        "Enterprise waitlist live at deep-check-two.vercel.app")


def slide_competition(c):
    """Page 7: Competencia."""
    draw_bg(c)
    draw_top_bar(c)
    draw_bottom_bar(c, page_num=7)

    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(MARGIN, H - 40, "06")
    c.setFont("Helvetica", 10)
    c.drawString(MARGIN + 20, H - 40, "COMPETENCIA")

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 32)
    c.drawString(MARGIN, H - 78, "Ventaja competitiva diferenciada")

    # Comparison table
    headers = ["", "Deep-Check", "FacePhi", "iProov", "Smowl"]
    feature_rows = [
        ("Verificacion continua", [True, False, False, False]),
        ("Client-side (privacidad)", [True, False, False, False]),
        ("Multi-capa (6 capas)", [True, False, False, False]),
        ("Solo navegador", [True, False, True, False]),
        ("Freemium", [True, False, False, False]),
        ("Deteccion deepfakes", [True, True, True, False]),
        ("API disponible", [True, True, True, True]),
    ]

    table_x = MARGIN
    table_y = H - 110
    col_widths = [170, 110, 90, 90, 90]
    row_h = 25

    # Header
    hx = table_x
    for i, header in enumerate(headers):
        if i == 1:
            c.setFillColor(GREEN)
            c.setFont("Helvetica-Bold", 11)
        elif i == 0:
            c.setFillColor(GRAY_MID)
            c.setFont("Helvetica-Bold", 10)
        else:
            c.setFillColor(GRAY_LIGHT)
            c.setFont("Helvetica-Bold", 10)
        c.drawString(hx + 8, table_y, header)
        hx += col_widths[i]

    # Divider
    c.setStrokeColor(GRAY_DARK)
    c.setLineWidth(0.5)
    c.line(table_x, table_y - 8, table_x + sum(col_widths), table_y - 8)

    # Rows
    for j, (feature, checks) in enumerate(feature_rows):
        ry = table_y - 18 - j * row_h
        if j % 2 == 0:
            c.setFillColor(Color(1, 1, 1, 0.02))
            c.rect(table_x, ry - 6, sum(col_widths), row_h, fill=True, stroke=False)

        fx = table_x
        c.setFillColor(GRAY_LIGHT)
        c.setFont("Helvetica", 10)
        c.drawString(fx + 8, ry, feature)
        fx += col_widths[0]

        for k, check in enumerate(checks):
            cx_pos = fx + col_widths[k + 1] / 2 - 5
            if check:
                c.setFillColor(GREEN if k == 0 else GRAY_MID)
                c.setFont("Helvetica-Bold", 14)
                c.drawString(cx_pos, ry - 2, "\u2713")
            else:
                c.setFillColor(HexColor("#442222"))
                c.setFont("Helvetica", 14)
                c.drawString(cx_pos, ry - 2, "\u2212")
            fx += col_widths[k + 1]

    # Key differentiator callout
    callout_y = 38
    draw_card(c, MARGIN, callout_y, W - 2 * MARGIN, 50, bg=HexColor("#0a1a12"))
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(MARGIN + 15, callout_y + 30, "DIFERENCIADOR CLAVE")
    c.setFillColor(WHITE)
    c.setFont("Helvetica", 11)
    c.drawString(MARGIN + 15, callout_y + 10,
                 "Deep-Check es la unica solucion que combina verificacion continua + "
                 "client-side + 6 capas + solo navegador + freemium.")


def slide_team(c):
    """Page 8: Equipo."""
    draw_bg(c)
    draw_top_bar(c)
    draw_bottom_bar(c, page_num=8)

    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(MARGIN, H - 40, "07")
    c.setFont("Helvetica", 10)
    c.drawString(MARGIN + 20, H - 40, "EQUIPO")

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 32)
    c.drawString(MARGIN, H - 78, "Fundador tecnico, equipo en expansion")

    # Founder card
    founder_x = MARGIN
    founder_y = H - 280
    founder_w = W / 2 - MARGIN - 10
    founder_h = 170
    draw_card(c, founder_x, founder_y, founder_w, founder_h)

    c.setFillColor(GREEN)
    c.rect(founder_x, founder_y + founder_h - 4, founder_w, 4, fill=True, stroke=False)

    # Avatar
    avatar_cx = founder_x + 45
    avatar_cy = founder_y + founder_h - 50
    c.setFillColor(GREEN_DARK)
    c.circle(avatar_cx, avatar_cy, 25, fill=True, stroke=False)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 18)
    c.drawCentredString(avatar_cx, avatar_cy - 6, "PL")

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(founder_x + 80, founder_y + founder_h - 40, "Pablo Lopez Rodriguez")
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(founder_x + 80, founder_y + founder_h - 58, "CEO & Founder")

    skills = [
        "Fundador tecnico solo: frontend, backend, ML, infraestructura",
        "Desarrollo completo de la plataforma en 7 meses",
        "Entrenamiento de modelos deep learning (PyTorch, ONNX)",
        "Despliegue AWS (EC2 GPU, S3, CI/CD)",
        "Publicacion cientifica (Zenodo DOI)",
    ]

    y = founder_y + founder_h - 85
    for skill in skills:
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(founder_x + 15, y, "\u25b8")
        c.setFillColor(GRAY_LIGHT)
        c.setFont("Helvetica", 9)
        c.drawString(founder_x + 28, y, skill)
        y -= 16

    # Hiring plan
    hire_x = W / 2 + 15
    hire_w = W / 2 - MARGIN - 15

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(hire_x, H - 120, "Plan de Contratacion")

    hires = [
        ("Q2 2026", "CTO / ML Lead", "Liderazgo tecnico, arquitectura ML"),
        ("Q3 2026", "Head of Sales", "Enterprise sales, partnerships"),
        ("Q3-Q4 2026", "2 Engineers", "Frontend + ML engineers"),
    ]

    y = H - 155
    for quarter, role, desc in hires:
        draw_card(c, hire_x, y, hire_w, 50, bg=CARD_BG)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(hire_x + 12, y + 32, quarter)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(hire_x + 100, y + 32, role)
        c.setFillColor(GRAY_LIGHT)
        c.setFont("Helvetica", 9)
        c.drawString(hire_x + 12, y + 10, desc)
        y -= 58


# NOTE: slide_round() intentionally removed for the overview deck.
# This deck does NOT include any funding ask. If a recipient asks
# about the round, they will get the financial information by email
# or in a follow-up conversation, not in the deck itself.


def slide_closing(c):
    """Page 9 (overview): Cierre — sin menciones a la ronda."""
    draw_bg(c)

    # Subtle green glow
    for i in range(5):
        alpha = 0.015 - i * 0.002
        if alpha > 0:
            glow = Color(0, 1, 0.616, alpha)
            c.setFillColor(glow)
            c.circle(W / 2, H / 2, 160 + i * 40, fill=True, stroke=False)

    # Top accent
    c.setFillColor(GREEN)
    c.rect(W / 2 - 30, H - 60, 60, 3, fill=True, stroke=False)

    # Quote
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 15)
    c.drawCentredString(W / 2, H - 110, "\"La identidad verificada al inicio")
    c.drawCentredString(W / 2, H - 132, "no garantiza la identidad durante la sesion.")
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 17)
    c.drawCentredString(W / 2, H - 162, "Deep-Check lo soluciona.\"")

    # Divider
    c.setStrokeColor(GRAY_DARK)
    c.setLineWidth(0.5)
    c.line(W / 2 - 100, H - 185, W / 2 + 100, H - 185)

    # Brand
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 36)
    c.drawCentredString(W / 2, H - 230, "Deep-Check.")

    # Contact
    c.setFillColor(GRAY_LIGHT)
    c.setFont("Helvetica", 12)
    c.drawCentredString(W / 2, H - 270, "Pablo Lopez Rodriguez")
    c.drawCentredString(W / 2, H - 288, "CEO & Founder")

    c.setFillColor(GREEN)
    c.setFont("Helvetica", 11)
    c.drawCentredString(W / 2, H - 320, "deep-check-two.vercel.app")

    c.setFillColor(GRAY_MID)
    c.setFont("Helvetica", 10)
    c.drawCentredString(W / 2, H - 345, "Madrid, Spain")

    # Footer (no funding mentions)
    c.setFillColor(GRAY_DARK)
    c.setFont("Helvetica", 8)
    c.drawCentredString(W / 2, 30,
                        "Confidencial  |  Abril 2026  |  Company & Product Overview")


# ═══════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════

def main():
    c = canvas.Canvas(OUTPUT_PATH, pagesize=landscape(A4))
    c.setTitle("Deep-Check · Company & Product Overview · April 2026")
    c.setAuthor("Pablo Lopez Rodriguez")
    c.setSubject("Deep-Check overview — no funding ask")

    # 9 slides instead of 10: slide_round is omitted on purpose.
    slides = [
        slide_cover,
        slide_problem,
        slide_solution,
        slide_market,
        slide_business_model,
        slide_traction,
        slide_competition,
        slide_team,
        slide_closing,
    ]

    for i, slide_fn in enumerate(slides):
        slide_fn(c)
        if i < len(slides) - 1:
            c.showPage()

    c.save()
    print(f"Pitch deck generated: {OUTPUT_PATH}")
    print(f"Pages: {len(slides)}")


if __name__ == "__main__":
    main()
