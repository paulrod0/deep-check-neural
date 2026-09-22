#!/usr/bin/env python3
"""
SBC Labs — Dossier de Servicios: Turismo y Hosteleria (hoteles + tour operadores).

Genera SBC_Labs_Dossier_Turismo.pdf a partir del contenido estructurado aqui
(espejo de dossier_sbc_labs_turismo.md). A4 vertical, layout profesional sobre
fondo claro con acento azul/teal, pensado para enviar a clientes del sector.

Uso: python3 docs/generate_dossier_sbc_turismo.py
"""

import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table,
    TableStyle, HRFlowable, CondPageBreak,
)

# Colors
ACCENT = HexColor("#0f766e")        # teal
ACCENT_DARK = HexColor("#0b544e")
INK = HexColor("#16181d")
GRAY = HexColor("#5a606b")
LINE = HexColor("#d8dce2")
CARD_HEAD = HexColor("#0b3a36")
ROW_ALT = HexColor("#eef5f4")
NOTE_BG = HexColor("#edf5f4")

OUT = os.path.join(os.path.dirname(__file__), "SBC_Labs_Dossier_Turismo.pdf")
MARGIN = 20 * mm

styles = getSampleStyleSheet()


def S(name, **kw):
    base = kw.pop("parent", styles["Normal"])
    return ParagraphStyle(name, parent=base, **kw)


body = S("body", fontName="Helvetica", fontSize=9.5, leading=14,
         textColor=INK, spaceAfter=6, alignment=TA_LEFT)
h1 = S("h1", fontName="Helvetica-Bold", fontSize=15, leading=18,
       textColor=ACCENT_DARK, spaceBefore=16, spaceAfter=6)
h2 = S("h2", fontName="Helvetica-Bold", fontSize=11, leading=14,
       textColor=INK, spaceBefore=10, spaceAfter=3)
bullet = S("bullet", parent=body, leftIndent=12, bulletIndent=2, spaceAfter=3)
note = S("note", parent=body, textColor=ACCENT_DARK, fontName="Helvetica-Oblique",
         leftIndent=8, rightIndent=8, spaceBefore=4, spaceAfter=4)
cell = S("cell", fontName="Helvetica", fontSize=8.4, leading=11, textColor=INK)
cell_head = S("cell_head", fontName="Helvetica-Bold", fontSize=8.4,
              leading=11, textColor=HexColor("#ffffff"))
oneliner = S("oneliner", fontName="Helvetica-Bold", fontSize=12, leading=18,
             textColor=INK, spaceAfter=4)


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, 15 * mm, A4[0] - MARGIN, 15 * mm)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(GRAY)
    canvas.drawString(MARGIN, 10 * mm, "SBC Labs  |  Dossier Turismo y Hosteleria  |  Junio 2026")
    canvas.drawRightString(A4[0] - MARGIN, 10 * mm, "Pag. %d" % doc.page)
    canvas.restoreState()


def para(text, style=body):
    return Paragraph(text, style)


def bullets(items):
    return [Paragraph("•&nbsp;&nbsp;" + t, bullet) for t in items]


def make_table(rows, col_widths, header=True):
    data = []
    for r, row in enumerate(rows):
        styled = []
        for c in row:
            st = cell_head if (header and r == 0) else cell
            styled.append(Paragraph(c, st))
        data.append(styled)
    t = Table(data, colWidths=col_widths, repeatRows=1 if header else 0)
    ts = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
        ("BOX", (0, 0), (-1, -1), 0.4, LINE),
    ]
    if header:
        ts += [("BACKGROUND", (0, 0), (-1, 0), CARD_HEAD)]
        for r in range(2, len(rows), 2):
            ts.append(("BACKGROUND", (0, r), (-1, r), ROW_ALT))
    t.setStyle(TableStyle(ts))
    return t


def rule():
    return HRFlowable(width="100%", thickness=0.6, color=LINE,
                      spaceBefore=8, spaceAfter=4)


def build():
    doc = BaseDocTemplate(
        OUT, pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=22 * mm, bottomMargin=22 * mm,
        title="SBC Labs — Dossier Turismo", author="SBC Labs",
    )
    frame = Frame(MARGIN, 18 * mm, A4[0] - 2 * MARGIN,
                  A4[1] - 40 * mm, id="main")
    doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=footer)])

    e = []

    # Cover
    e.append(Spacer(1, 6))
    e.append(Paragraph("SBC LABS", S("cover", fontName="Helvetica-Bold",
             fontSize=26, textColor=ACCENT_DARK, leading=30)))
    e.append(Paragraph("para Hoteles y Tour Operadores", S("cover2",
             fontName="Helvetica", fontSize=15, textColor=INK, leading=20,
             spaceAfter=8)))
    e.append(HRFlowable(width="38%", thickness=2.5, color=ACCENT,
             spaceBefore=2, spaceAfter=10, hAlign="LEFT"))
    e.append(Paragraph("Dossier de Servicios — Turismo y Hosteleria", S("subt",
             fontName="Helvetica-Bold", fontSize=10, textColor=GRAY)))
    e.append(Paragraph("Junio 2026", S("date", fontName="Helvetica",
             fontSize=10, textColor=GRAY, spaceAfter=14)))

    # En una frase
    e.append(rule())
    e.append(para("EN UNA FRASE", S("kicker", fontName="Helvetica-Bold",
             fontSize=8.5, textColor=ACCENT, spaceAfter=4)))
    e.append(para(
        "SBC Labs ayuda a hoteles y tour operadores a vender mas en directo, "
        "trabajar con menos esfuerzo y decidir con datos: disenamos su web y "
        "motor de reservas, automatizamos la operativa con inteligencia "
        "artificial, convertimos sus datos en decisiones de revenue y atraemos "
        "clientes con marketing digital, todo conectado entre si.", oneliner))

    # 1. Por que ahora
    e.append(para("1. Por que ahora", h1))
    e += bullets([
        "<b>Demasiada dependencia de las OTAs.</b> Cada reserva por Booking, "
        "Expedia o Airbnb se lleva un 15-25 % de comision. Recuperar venta "
        "directa es la palanca de margen mas rapida.",
        "<b>Operativa manual y dispersa.</b> Check-ins, correos, resenas, "
        "tarifas y reporting se gestionan a mano y en sistemas que no se "
        "hablan entre si.",
        "<b>La IA ya es accesible.</b> Lo que hace dos anos era caro hoy se "
        "implementa en semanas: atencion 24/7 multiidioma, conexion de "
        "sistemas y analisis predictivo.",
    ])
    e.append(para("SBC Labs une las cuatro piezas (web y reservas, "
                  "automatizacion e IA, datos y revenue, marketing) en un unico "
                  "proveedor, evitando el puzzle de cinco herramientas que no "
                  "encajan.", body))

    # 2. Que hacemos
    e.append(para("2. Que hacemos por hoteles y tour operadores", h1))

    e.append(para("2.1 Web y reserva directa", h2))
    e += bullets([
        "<b>Webs rapidas y orientadas a conversion</b>: diseno moderno, multiidioma, movil y velocidad.",
        "<b>Motor de reservas propio</b>: reserva directa sin comision de OTA, integrado en la web.",
        "<b>Integracion con PMS y channel manager</b> (Cloudbeds, Mews, Apaleo, SiteMinder).",
        "<b>Pasarela de pago y upselling</b>: cobro seguro y venta de extras en el flujo de reserva.",
    ])

    e.append(para("2.2 Automatizacion e inteligencia artificial", h2))
    e += bullets([
        "<b>Chatbot / asistente IA 24/7</b> en varios idiomas, en web y WhatsApp.",
        "<b>Automatizacion de la operativa</b>: check-in/out online, correos de pre y post estancia, encuestas.",
        "<b>Gestion automatica de resenas</b>: recogida, respuesta asistida y alertas de reputacion.",
        "<b>Conexion entre sistemas</b>: PMS, CRM, email, pagos y hojas de calculo, sin trabajo manual.",
    ])

    e.append(para("2.3 Datos y revenue", h2))
    e += bullets([
        "<b>Dashboards en tiempo real</b>: ocupacion, ADR, RevPAR, ingresos por canal y segmento.",
        "<b>Pricing dinamico</b>: recomendaciones de tarifa segun demanda, temporada y competencia.",
        "<b>Reporting automatico</b>: informes periodicos enviados solos a direccion.",
        "<b>Analisis de canales</b>: cuanto cuesta cada reserva por canal y donde recuperar margen.",
    ])

    e.append(para("2.4 Marketing digital", h2))
    e += bullets([
        "<b>SEO local y de destino</b>: aparecer cuando el viajero busca el destino.",
        "<b>Campanas de captacion</b>: Google y redes orientadas a reserva directa y remarketing.",
        "<b>Contenido y redes sociales</b>: foto, video y publicaciones que refuerzan la marca.",
        "<b>Email marketing</b>: campanas a la base propia para repetir estancia.",
    ])

    # 3. Como trabajamos
    e.append(CondPageBreak(55 * mm))
    e.append(para("3. Como trabajamos", h1))
    e += bullets([
        "<b>1. Diagnostico</b>: analizamos sistemas, canales, comisiones y fricciones. Sin compromiso.",
        "<b>2. Propuesta</b>: alcance, prioridades y retorno esperado (mas directa, menos horas manuales).",
        "<b>3. Implementacion por fases</b>: entregas rapidas y medibles; primero lo de mayor impacto.",
        "<b>4. Integracion</b>: todo conectado al PMS y sistemas existentes, sin rehacer lo que funciona.",
        "<b>5. Soporte y mejora continua</b>: mantenimiento, metricas y nuevas automatizaciones.",
    ])

    # 4. Modelo de servicio
    e.append(para("4. Modelo de servicio", h1))
    e.append(make_table([
        ["Modalidad", "Para quien", "Que incluye"],
        ["Proyecto puntual", "Web, reservas o una automatizacion concreta", "Alcance cerrado, entrega y formacion"],
        ["Pack digitalizacion", "Hotel que arranca de cero", "Web + reservas + automatizaciones base + analitica"],
        ["Retainer mensual", "Quien quiere mejora continua", "Soporte, nuevas automatizaciones, marketing y reporting"],
        ["Consultoria a medida", "Cadenas y tour operadores", "Proyectos especificos de automatizacion y digitalizacion"],
    ], col_widths=[42 * mm, 56 * mm, 72 * mm]))
    e.append(Spacer(1, 4))
    e.append(para("Modelo flexible: se puede empezar por un proyecto pequeno y "
                  "de alto impacto (recuperar venta directa) y crecer desde ahi.", note))

    # 5. Por que SBC Labs
    e.append(para("5. Por que SBC Labs", h1))
    e += bullets([
        "<b>Un solo proveedor, todo conectado</b>: web, automatizacion, datos y marketing pensados para funcionar juntos.",
        "<b>IA aplicada de verdad</b>: automatizaciones que ahorran horas reales y atienden al cliente solas.",
        "<b>Enfoque en margen</b>: cada propuesta se mide en venta directa ganada y horas ahorradas.",
        "<b>Rapidez</b>: entregas por fases, con resultados visibles en semanas.",
        "<b>Sin lock-in innecesario</b>: integramos con lo que el cliente ya tiene; la web y el dato son suyos.",
    ])

    # 6. Casos por cliente
    e.append(CondPageBreak(50 * mm))
    e.append(para("6. Casos por tipo de cliente", h1))
    e += bullets([
        "<b>Hotel independiente</b>: web + reservas + check-in online y chatbot; recuperar directa y aliviar recepcion.",
        "<b>Hotel boutique</b>: marca, contenido y experiencia digital premium con upselling automatizado.",
        "<b>Cadena / grupo</b>: dashboards consolidados multi-propiedad, pricing y automatizacion a escala.",
        "<b>Tour operador</b>: automatizacion de cotizaciones y paquetes, web de reservas, CRM y captacion.",
        "<b>Apartamentos / casas rurales</b>: gestion multicanal, check-in remoto y comunicaciones automatizadas.",
    ])

    # 7. Siguientes pasos
    e.append(para("7. Siguientes pasos", h1))
    e += bullets([
        "<b>Diagnostico gratuito</b>: revisamos web, canales y operativa e identificamos las 3 mejoras de mayor impacto.",
        "<b>Propuesta a medida</b>: alcance, fases y retorno esperado.",
        "<b>Arranque por fases</b>: empezamos por lo que mas margen recupera.",
    ])
    e.append(Spacer(1, 6))
    e.append(para("Contacto: SBC Labs — [anadir email / telefono / web]",
             S("contact", fontName="Helvetica-Bold", fontSize=10,
               textColor=ACCENT_DARK)))

    doc.build(e)
    print("OK ->", OUT)


if __name__ == "__main__":
    build()
