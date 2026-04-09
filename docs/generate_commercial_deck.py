#!/usr/bin/env python3
"""Deep-Check Commercial Deck — General capabilities, no exact metrics."""

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
import os

BG = HexColor('#0a0a0c')
CARD = HexColor('#1a1a20')
GREEN = HexColor('#00ff9d')
WHITE = HexColor('#ffffff')
MUTED = HexColor('#a1a1aa')
DIM = HexColor('#71717a')
BLUE = HexColor('#3b82f6')
PURPLE = HexColor('#8b5cf6')
YELLOW = HexColor('#eab308')
CYAN = HexColor('#06b6d4')

W, H = A4
OUT = os.path.join(os.path.dirname(__file__), 'deep_check_commercial.pdf')

def bg(c): c.setFillColor(BG); c.rect(0,0,W,H,fill=1,stroke=0)
def card(c,x,y,w,h,color=CARD,alpha=1.0):
    c.saveState(); c.setFillColor(color); c.setFillAlpha(alpha)
    c.roundRect(x,y,w,h,8,fill=1,stroke=0); c.restoreState()
def badge(c,x,y,w,text):
    c.saveState(); c.setFillColor(GREEN); c.setFillAlpha(0.12)
    c.roundRect(x,y-5,w,24,12,fill=1,stroke=0); c.restoreState()
    c.setFillColor(GREEN); c.setFont("Helvetica",9); c.drawString(x+12,y,text)
def bar(c): c.setFillColor(GREEN); c.rect(0,0,W,3,fill=1,stroke=0)
def pn(c,n): c.setFillColor(DIM); c.setFont("Helvetica",8); c.drawRightString(W-40,30,f"0{n}")


# ── PAGE 1: Cover ────────────────────────────────────────────────────────────

def page_cover(c):
    bg(c)
    c.saveState(); c.setFillColor(GREEN); c.setFillAlpha(0.03)
    c.circle(W/2,H/2+60,180,fill=1,stroke=0); c.restoreState()

    y = H-250
    c.setFont("Helvetica-Bold",48)
    full_w = c.stringWidth("Deep-Check.", "Helvetica-Bold", 48)
    text_x = (W - full_w) / 2
    c.setFillColor(WHITE)
    c.drawString(text_x, y, "Deep-Check")
    dot_x = text_x + c.stringWidth("Deep-Check", "Helvetica-Bold", 48)
    c.setFillColor(GREEN)
    c.drawString(dot_x, y, ".")

    y -= 50
    c.setFillColor(GREEN); c.setFont("Helvetica",18)
    c.drawCentredString(W/2, y, "Plataforma de Verificacion")
    y -= 24
    c.drawCentredString(W/2, y, "de Identidad con IA")

    y -= 40
    c.setStrokeColor(GREEN); c.setLineWidth(2)
    c.line(W/2-40,y,W/2+40,y)

    y -= 35
    c.setFillColor(MUTED); c.setFont("Helvetica",12)
    c.drawCentredString(W/2, y, "Verificacion continua. Privacidad absoluta.")
    y -= 20
    c.drawCentredString(W/2, y, "Deteccion de deepfakes en tiempo real.")

    c.setFillColor(DIM); c.setFont("Helvetica",9)
    c.drawCentredString(W/2, 100, "HIUM Solutions SL | Andalucia, Espana")
    c.drawCentredString(W/2, 85, "https://deep-check-two.vercel.app")
    c.drawCentredString(W/2, 70, "2026")
    bar(c)


# ── PAGE 2: Que es Deep-Check ────────────────────────────────────────────────

def page_what(c):
    bg(c); pn(c,2)
    y = H-80
    badge(c,40,y,140,"QUE ES DEEP-CHECK")

    y -= 55
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold",28)
    c.drawString(40,y,"La identidad verificada")
    y -= 34
    c.drawString(40,y,"durante toda la sesion.")

    y -= 35
    c.setFillColor(MUTED); c.setFont("Helvetica",11)
    for l in [
        "Deep-Check es una plataforma de verificacion de identidad basada en",
        "inteligencia artificial que opera integramente en el dispositivo del usuario.",
        "",
        "A diferencia de las soluciones tradicionales que verifican la identidad",
        "solo al inicio, Deep-Check monitoriza continuamente durante toda la sesion,",
        "detectando deepfakes, suplantaciones y anomalias en tiempo real.",
    ]:
        c.drawString(40,y,l)
        y -= 16 if l else 8

    # Key differentiators
    y -= 25
    diffs = [
        (GREEN, "Zero biometria al servidor", "Todo el procesamiento ocurre en el navegador del usuario (WebAssembly). Ningun dato biometrico abandona el dispositivo. GDPR nativo."),
        (BLUE, "Verificacion continua", "No solo al inicio. 6 capas de deteccion independientes monitorizan cada segundo de la sesion, imposible de evadir."),
        (PURPLE, "Sin instalacion", "Funciona en cualquier navegador moderno. Sin SDK, sin apps, sin plugins. El usuario solo necesita una webcam."),
        (CYAN, "Deteccion de deepfakes", "Motor de IA entrenado con mas de un millon de imagenes detecta rostros generados por IA, GAN y herramientas de manipulacion."),
    ]
    for color, title, desc in diffs:
        card(c,40,y-58,W-80,62)
        c.setFillColor(color); c.circle(56,y-14,5,fill=1,stroke=0)
        c.setFont("Helvetica-Bold",11); c.drawString(68,y-18,title)
        c.setFillColor(MUTED); c.setFont("Helvetica",8.5)
        # Wrap desc
        words = desc.split()
        line, lines = "", []
        for w in words:
            test = f"{line} {w}".strip()
            if len(test) > 85:
                lines.append(line); line = w
            else:
                line = test
        if line: lines.append(line)
        for i,l in enumerate(lines[:2]):
            c.drawString(56, y-34-i*12, l)
        y -= 70

    bar(c)


# ── PAGE 3: 6 Capas ─────────────────────────────────────────────────────────

def page_layers(c):
    bg(c); pn(c,3)
    y = H-80
    badge(c,40,y,160,"MOTOR DE DETECCION")

    y -= 55
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold",28)
    c.drawString(40,y,"6 Capas Independientes")

    y -= 25
    c.setFillColor(MUTED); c.setFont("Helvetica",11)
    c.drawString(40,y,"Fusion Bayesiana en espacio de logits — cada capa vota de forma independiente")

    y -= 40
    layers = [
        (GREEN, "Senales Vitales (rPPG)", "Detecta el pulso cardiaco a traves de micro-variaciones de color en el rostro. Un deepfake o foto no tiene pulso. Imposible de falsificar."),
        (BLUE, "Micro-expresiones (FACS)", "Analiza la biomecanica facial en tiempo real. Los rostros generados por IA no replican correctamente los patrones musculares humanos."),
        (PURPLE, "Forensic AI (Pixel)", "Red neuronal entrenada con mas de 1M de imagenes analiza cada frame buscando artefactos de generacion sintetica a nivel de pixel."),
        (CYAN, "Analisis de Frecuencia", "Detecta patrones en el dominio de frecuencia (DCT, Laplacian) que son invisibles al ojo humano pero delatan manipulacion digital."),
        (YELLOW, "Biometria de Tecleo", "Patrones unicos de velocidad, ritmo y presion al teclear. Tan unico como una huella dactilar. Detecta si cambia el usuario."),
        (MUTED, "Dinamica de Interaccion", "Movimiento del raton, patrones de scroll y ritmo de interaccion. Detecta bots, automatizaciones y cambios de operador."),
    ]
    cw = (W-100)/2
    for i,(color,title,desc) in enumerate(layers):
        col,row = i%2,i//2
        cx = 40 + col*(cw+20)
        cy = y - row*105
        card(c,cx,cy-95,cw,98)
        c.setFillColor(color); c.circle(cx+14,cy-16,4,fill=1,stroke=0)
        c.setFont("Helvetica-Bold",10); c.drawString(cx+26,cy-20,title)
        c.setFillColor(MUTED); c.setFont("Helvetica",8)
        words = desc.split()
        line, lines = "", []
        for w in words:
            test = f"{line} {w}".strip()
            if len(test) > 42: lines.append(line); line = w
            else: line = test
        if line: lines.append(line)
        for j,l in enumerate(lines[:4]):
            c.drawString(cx+14, cy-38-j*12, l)

    bar(c)


# ── PAGE 4: Productos ────────────────────────────────────────────────────────

def page_products(c):
    bg(c); pn(c,4)
    y = H-80
    badge(c,40,y,120,"PRODUCTOS")

    y -= 55
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold",28)
    c.drawString(40,y,"Suite de Productos")

    y -= 25
    c.setFillColor(MUTED); c.setFont("Helvetica",11)
    c.drawString(40,y,"Cada producto usa el mismo motor de deteccion adaptado al caso de uso")

    y -= 35
    products = [
        (GREEN, "Am I Real?", "Verificacion en directo con webcam. El usuario confirma que es humano real, no un deepfake."),
        (BLUE, "DateSafe", "Detector de catfish para apps de citas. Sube la foto del perfil y verifica autenticidad."),
        (PURPLE, "ProofShot", "Certificado verificable de autenticidad para fotos. GPS + timestamp + analisis AI."),
        (YELLOW, "DocSafe", "Verificacion de documentos. Analisis ELA + IA para detectar manipulacion de fotos o PDFs."),
        (CYAN, "ListingCheck", "Verificacion de fotos de anuncios inmobiliarios y marketplace contra imagenes AI."),
        (MUTED, "ResumeGuard", "Verificacion de fotos en CVs y perfiles profesionales. Batch mode hasta 10 fotos."),
        (GREEN, "FakeCheck Extension", "Extension de Chrome. Click derecho en cualquier imagen web para verificar autenticidad."),
        (BLUE, "API REST v1", "Integracion programatica. Single + batch + webhooks. Para empresas y desarrolladores."),
    ]
    cw = (W-100)/2
    ch = 68
    for i,(color,title,desc) in enumerate(products):
        col,row = i%2,i//2
        cx = 40+col*(cw+20)
        cy = y - row*(ch+8)
        card(c,cx,cy-ch,cw,ch)
        c.setFillColor(color); c.circle(cx+14,cy-16,4,fill=1,stroke=0)
        c.setFont("Helvetica-Bold",10); c.drawString(cx+26,cy-20,title)
        c.setFillColor(MUTED); c.setFont("Helvetica",8)
        words = desc.split()
        line, lines = "", []
        for w in words:
            test = f"{line} {w}".strip()
            if len(test) > 42: lines.append(line); line = w
            else: line = test
        if line: lines.append(line)
        for j,l in enumerate(lines[:2]):
            c.drawString(cx+14,cy-36-j*12,l)

    bar(c)


# ── PAGE 5: Rendimiento ─────────────────────────────────────────────────────

def page_performance(c):
    bg(c); pn(c,5)
    y = H-80
    badge(c,40,y,130,"RENDIMIENTO")

    y -= 55
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold",28)
    c.drawString(40,y,"Metricas de Referencia")

    y -= 25
    c.setFillColor(MUTED); c.setFont("Helvetica",11)
    c.drawString(40,y,"Evaluado bajo protocolo ISO 30107-3 con datasets industriales")

    # Metrics - approximate
    y -= 45
    mw = (W-110)/3
    mh = 75
    metrics = [
        ("AUC > 0.99", "Area bajo curva ROC"),
        ("EER < 1%", "Equal Error Rate"),
        ("< 500ms", "Inferencia en navegador"),
        ("0 bytes", "Datos biometricos\nal servidor"),
        ("6 capas", "Deteccion\nindependiente"),
        ("1M+", "Imagenes de\nentrenamiento"),
    ]
    for i,(val,lab) in enumerate(metrics):
        col,row = i%3,i//3
        cx = 40+col*(mw+15)
        cy = y - mh - row*(mh+12)
        card(c,cx,cy,mw,mh)
        c.setFillColor(GREEN); c.setFont("Helvetica-Bold",20)
        c.drawCentredString(cx+mw/2,cy+mh-30,val)
        c.setFillColor(MUTED); c.setFont("Helvetica",8)
        for j,l in enumerate(lab.split('\n')):
            c.drawCentredString(cx+mw/2,cy+15-j*11,l)

    # Robustness
    y = y - 2*(mh+12) - 25
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold",14)
    c.drawString(40,y,"Robustez Probada")

    y -= 22
    robustness = [
        "Compresion JPEG agresiva (calidad 10-85)",
        "Condiciones de baja iluminacion y contraluz",
        "Escala de grises y filtros de color",
        "Redimensionado y recorte de imagenes",
        "Desenfoque y ruido de camara movil",
    ]
    for r in robustness:
        c.setFillColor(GREEN); c.setFont("Helvetica",10)
        c.drawString(50,y,"+")
        c.setFillColor(MUTED); c.drawString(65,y,r)
        y -= 18

    # Standards
    y -= 20
    card(c,40,y-55,W-80,60,GREEN,0.06)
    c.setFillColor(GREEN); c.setFont("Helvetica-Bold",10)
    c.drawString(55,y-18,"Alineacion con Estandares")
    c.setFillColor(MUTED); c.setFont("Helvetica",9)
    c.drawString(55,y-34,"ISO 30107-3 (PAD) | NIST FATE/PAD (en proceso) | GDPR Art. 25 | Anti-leak verificado")

    bar(c)


# ── PAGE 6: Tecnologia ───────────────────────────────────────────────────────

def page_tech(c):
    bg(c); pn(c,6)
    y = H-80
    badge(c,40,y,120,"TECNOLOGIA")

    y -= 55
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold",28)
    c.drawString(40,y,"Stack Tecnologico")

    y -= 35
    sections = [
        ("Frontend", [
            "Next.js (App Router) + TypeScript + Tailwind CSS",
            "Inferencia AI en browser via ONNX Runtime WebAssembly",
            "MediaPipe para deteccion facial en tiempo real",
            "Zero instalacion — funciona en Chrome, Safari, Firefox, Edge",
        ]),
        ("AI / ML", [
            "Arquitectura: EfficientNet-B4 + Frequency Branch (multi-scale Laplacian)",
            "Entrenado con 1M+ imagenes de 13 fuentes diversas",
            "Fusion Bayesiana de 6 capas de deteccion independientes",
            "Anti-leak verificado: cero overlap entre train y test",
        ]),
        ("Backend", [
            "Supabase (PostgreSQL) para autenticacion y datos de sesion",
            "Vercel para hosting y serverless functions",
            "API REST v1 con autenticacion por API key",
            "Webhooks para integracion asincrona",
        ]),
        ("Seguridad", [
            "Procesamiento 100% client-side — ningun dato biometrico al servidor",
            "Content Security Policy (CSP) configurado",
            "CORS y rate limiting en API",
            "Licencia BSL — codigo visible, IP protegida",
        ]),
    ]

    for title, items in sections:
        c.setFillColor(GREEN); c.setFont("Helvetica-Bold",13)
        c.drawString(40,y,title)
        y -= 18
        for item in items:
            c.setFillColor(DIM); c.setFont("Helvetica",9)
            c.drawString(50,y,">")
            c.setFillColor(MUTED); c.drawString(62,y,item)
            y -= 15
        y -= 10

    bar(c)


# ── PAGE 7: Casos de uso ────────────────────────────────────────────────────

def page_usecases(c):
    bg(c); pn(c,7)
    y = H-80
    badge(c,40,y,130,"CASOS DE USO")

    y -= 55
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold",28)
    c.drawString(40,y,"Donde se Aplica")

    y -= 35
    cases = [
        (GREEN, "Entrevistas Remotas", "Verificacion continua del candidato durante toda la entrevista. Detecta suplantacion, uso de deepfakes o asistencia remota no autorizada.", "Sector: RRHH, Recruitment"),
        (BLUE, "Examenes Online", "Supervision biometrica durante examenes universitarios y certificaciones. Detecta cambio de persona, herramientas AI y anomalias.", "Sector: Educacion, Certificaciones"),
        (PURPLE, "Banca Digital", "Extension de KYC durante sesiones bancarias. Garantiza que el usuario verificado sigue siendo el mismo durante toda la operacion.", "Sector: Fintech, Banca"),
        (CYAN, "Telemedicina", "Verificacion de identidad del paciente durante consultas remotas. Cumplimiento normativo sanitario.", "Sector: Salud, Seguros"),
        (YELLOW, "Marketplaces", "Verificacion de fotos en anuncios, perfiles y listados. Detecta imagenes generadas por IA para prevenir fraude.", "Sector: Inmobiliario, E-commerce"),
        (MUTED, "Redes Sociales / Citas", "Verificacion de autenticidad de fotos de perfil. Proteccion contra catfishing y perfiles falsos.", "Sector: Dating, Social Media"),
    ]
    cw = (W-100)/2
    ch = 90
    for i,(color,title,desc,sector) in enumerate(cases):
        col,row = i%2,i//2
        cx = 40+col*(cw+20)
        cy = y - row*(ch+10)
        card(c,cx,cy-ch,cw,ch)
        c.setFillColor(color); c.circle(cx+14,cy-16,4,fill=1,stroke=0)
        c.setFont("Helvetica-Bold",11); c.drawString(cx+26,cy-20,title)
        c.setFillColor(MUTED); c.setFont("Helvetica",8)
        words = desc.split()
        line, lines = "", []
        for w in words:
            test = f"{line} {w}".strip()
            if len(test) > 42: lines.append(line); line = w
            else: line = test
        if line: lines.append(line)
        for j,l in enumerate(lines[:3]):
            c.drawString(cx+14,cy-38-j*11,l)
        c.setFillColor(color); c.setFont("Helvetica-Oblique",7)
        c.drawString(cx+14,cy-ch+12,sector)

    bar(c)


# ── PAGE 8: Pricing + Contact ────────────────────────────────────────────────

def page_pricing(c):
    bg(c); pn(c,8)
    y = H-80
    badge(c,40,y,100,"PRECIOS")

    y -= 55
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold",28)
    c.drawString(40,y,"Planes")

    y -= 35
    plans = [
        ("Free", "0", "10 sesiones/mes", ["Todas las herramientas web","Verificacion en navegador","Sin API"]),
        ("Starter", "29/mes", "50 sesiones/mes", ["Todo en Free","API REST (1,000 calls)","Soporte email"]),
        ("Pro", "79/mes", "Ilimitado", ["Todo en Starter","API ilimitada","Webhooks","Soporte prioritario"]),
        ("Enterprise", "Custom", "Custom", ["Todo en Pro","SLA garantizado","On-premise disponible","Integracion dedicada"]),
    ]
    pw = (W-100)/4
    for i,(name,price,sessions,features) in enumerate(plans):
        cx = 40+i*(pw+8)
        card(c,cx,y-220,pw,225)
        c.setFillColor(GREEN if i==2 else WHITE)
        c.setFont("Helvetica-Bold",14)
        c.drawCentredString(cx+pw/2,y-18,name)
        c.setFillColor(GREEN); c.setFont("Helvetica-Bold",18)
        c.drawCentredString(cx+pw/2,y-42,price)
        c.setFillColor(DIM); c.setFont("Helvetica",7)
        c.drawCentredString(cx+pw/2,y-56,sessions)
        c.setFillColor(MUTED); c.setFont("Helvetica",7.5)
        for j,f in enumerate(features):
            c.drawString(cx+10,y-78-j*14,f"+ {f}")

    # Contact
    y = y - 250
    card(c,80,y-100,W-160,110,GREEN,0.07)
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold",16)
    c.drawCentredString(W/2,y-22,"Pablo Lopez Rodriguez")
    c.setFillColor(MUTED); c.setFont("Helvetica",11)
    c.drawCentredString(W/2,y-42,"CEO & Founder | HIUM Solutions SL")
    c.setFillColor(GREEN); c.setFont("Helvetica",10)
    c.drawCentredString(W/2,y-62,"https://deep-check-two.vercel.app")
    c.setFillColor(DIM); c.setFont("Helvetica",9)
    c.drawCentredString(W/2,y-80,"Andalucia, Espana")

    c.setFillColor(DIM); c.setFont("Helvetica",8)
    c.drawCentredString(W/2,55,"Deep-Check | HIUM Solutions SL | 2026")
    bar(c)


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    c = canvas.Canvas(OUT, pagesize=A4)
    c.setTitle("Deep-Check — Plataforma de Verificacion de Identidad")
    c.setAuthor("HIUM Solutions SL")
    for fn in [page_cover,page_what,page_layers,page_products,page_performance,page_tech,page_usecases,page_pricing]:
        fn(c); c.showPage()
    c.save()
    print(f"PDF: {OUT} ({os.path.getsize(OUT)/1024:.0f} KB)")

if __name__ == '__main__':
    main()
