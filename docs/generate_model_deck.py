#!/usr/bin/env python3
"""Deep-Check Model Performance Deck — V3 benchmarks + V5 training progress."""

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
RED = HexColor('#ef4444')
YELLOW = HexColor('#eab308')
BLUE = HexColor('#3b82f6')
PURPLE = HexColor('#8b5cf6')

W, H = A4
OUT = os.path.join(os.path.dirname(__file__), 'deep_check_model_deck.pdf')


def bg(c):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, fill=1, stroke=0)

def card(c, x, y, w, h, color=CARD, alpha=1.0):
    c.saveState()
    c.setFillColor(color)
    c.setFillAlpha(alpha)
    c.roundRect(x, y, w, h, 8, fill=1, stroke=0)
    c.restoreState()

def badge(c, x, y, w, text):
    c.saveState()
    c.setFillColor(GREEN)
    c.setFillAlpha(0.12)
    c.roundRect(x, y-5, w, 24, 12, fill=1, stroke=0)
    c.restoreState()
    c.setFillColor(GREEN)
    c.setFont("Helvetica", 9)
    c.drawString(x+12, y, text)

def bar(c):
    c.setFillColor(GREEN)
    c.rect(0, 0, W, 3, fill=1, stroke=0)

def pn(c, n):
    c.setFillColor(DIM)
    c.setFont("Helvetica", 8)
    c.drawRightString(W-40, 30, f"0{n}")


# ── PAGE 1: Cover ────────────────────────────────────────────────────────────

def page_cover(c):
    bg(c)
    c.saveState()
    c.setFillColor(GREEN)
    c.setFillAlpha(0.03)
    c.circle(W/2, H/2+60, 180, fill=1, stroke=0)
    c.restoreState()

    y = H - 200
    badge(c, W/2-80, y, 160, "MODELO DEEP-CHECK")

    y -= 70
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 40)
    c.drawCentredString(W/2, y, "Rendimiento del")
    y -= 46
    c.drawCentredString(W/2, y, "Motor de Deteccion")

    y -= 40
    c.setFillColor(GREEN)
    c.setFont("Helvetica", 16)
    c.drawCentredString(W/2, y, "V3 (Produccion) + V5 (En Entrenamiento)")

    y -= 40
    c.setStrokeColor(GREEN)
    c.setLineWidth(2)
    c.line(W/2-40, y, W/2+40, y)

    y -= 40
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 11)
    c.drawCentredString(W/2, y, "EfficientNet-B4 + FrequencyBranchV2")
    y -= 18
    c.drawCentredString(W/2, y, "18.6M parametros | ONNX Runtime | Inferencia < 500ms")

    c.setFillColor(DIM)
    c.setFont("Helvetica", 9)
    c.drawCentredString(W/2, 80, "HIUM Solutions SL | Marzo 2026")
    c.drawCentredString(W/2, 65, "Documento interno - Datos de benchmarks reales")
    bar(c)


# ── PAGE 2: V3 Architecture ─────────────────────────────────────────────────

def page_architecture(c):
    bg(c)
    pn(c, 2)
    y = H - 80
    badge(c, 40, y, 130, "ARQUITECTURA V3")

    y -= 55
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 28)
    c.drawString(40, y, "6-Layer Veritas Ensemble")

    y -= 30
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 11)
    c.drawString(40, y, "Fusion Bayesiana en espacio de logits de 6 capas independientes")

    # Layer cards
    y -= 40
    layers = [
        ("rPPG", "Senales vitales", "0.30", GREEN),
        ("FACS", "Micro-expresiones", "0.26", BLUE),
        ("EfficientNet-B4", "Pixel forensics", "0.22", PURPLE),
        ("Keystroke", "Biometria conductual", "0.12", YELLOW),
        ("CNN v2", "Blendshape", "0.10", RED),
    ]
    cw = (W - 100) / 2
    for i, (name, desc, weight, color) in enumerate(layers):
        col, row = i % 2, i // 2
        cx = 40 + col * (cw + 20)
        cy = y - row * 62
        card(c, cx, cy - 50, cw, 52)
        c.setFillColor(color)
        c.circle(cx+16, cy-20, 4, fill=1, stroke=0)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(cx+28, cy-24, name)
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 9)
        c.drawString(cx+28, cy-38, desc)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 12)
        c.drawRightString(cx+cw-12, cy-28, f"w={weight}")

    # Model specs
    y = y - 3*62 - 30
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(40, y, "Especificaciones del Modelo Pixel (V3)")

    y -= 25
    specs = [
        ("Arquitectura", "EfficientNet-B4 + FrequencyBranchV2 (multi-scale Laplacian)"),
        ("Parametros", "18.6M"),
        ("Tamano ONNX", "70MB"),
        ("Input", "[1, 3, 224, 224] float32 (ImageNet normalized)"),
        ("Output", "[1] logit -> sigmoid -> P(fake)"),
        ("Opset", "17"),
        ("Runtime", "ONNX Runtime Web (WASM) + Node.js server-side"),
    ]
    for label, val in specs:
        card(c, 40, y-22, W-80, 25)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(55, y-15, label)
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 9)
        c.drawString(180, y-15, val)
        y -= 30

    bar(c)


# ── PAGE 3: V3 Benchmark Results ────────────────────────────────────────────

def page_v3_results(c):
    bg(c)
    pn(c, 3)
    y = H - 80
    badge(c, 40, y, 160, "BENCHMARK V3")

    y -= 55
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 28)
    c.drawString(40, y, "Resultados Industriales")

    y -= 25
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 11)
    c.drawString(40, y, "ISO 30107-3 aligned | 7 datasets Kaggle | 155K imagenes")

    # Main metrics
    y -= 45
    mw = (W - 110) / 3
    mh = 80
    main_metrics = [
        ("0.999998", "AUC", "[95% CI: 0.999991-1.000000]"),
        ("0.10%", "EER", "[95% CI: 0.00%-0.30%]"),
        ("0.005", "ECE", "Calibracion excelente"),
    ]
    for i, (val, label, sub) in enumerate(main_metrics):
        cx = 40 + i*(mw+15)
        card(c, cx, y-mh, mw, mh)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 22)
        c.drawCentredString(cx+mw/2, y-30, val)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 10)
        c.drawCentredString(cx+mw/2, y-48, label)
        c.setFillColor(DIM)
        c.setFont("Helvetica", 7)
        c.drawCentredString(cx+mw/2, y-63, sub)

    # Secondary metrics
    y -= mh + 20
    sec = [("APCER", "0.10%"), ("BPCER", "0.10%"), ("Precision", "99.9%"), ("F1-Score", "0.999")]
    sw = (W - 100) / 4
    for i, (label, val) in enumerate(sec):
        cx = 40 + i*(sw+10)
        card(c, cx, y-50, sw, 50)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 16)
        c.drawCentredString(cx+sw/2, y-22, val)
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 8)
        c.drawCentredString(cx+sw/2, y-38, label)

    # Robustness table
    y -= 80
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(40, y, "Robustez bajo Perturbaciones")

    y -= 25
    robustness = [
        ("Original", "1.0000", "0.00%", GREEN),
        ("JPEG Q10", "0.9986", "2.20%", GREEN),
        ("Blur r=5", "0.9853", "6.90%", YELLOW),
        ("Grayscale", "0.9801", "7.20%", YELLOW),
        ("Resize 25%", "0.9995", "0.10%", GREEN),
    ]

    # Header
    card(c, 40, y-22, W-80, 25, GREEN, 0.08)
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(60, y-15, "Perturbacion")
    c.drawString(250, y-15, "AUC")
    c.drawString(370, y-15, "EER")
    c.drawString(460, y-15, "Estado")
    y -= 30

    for name, auc, eer, color in robustness:
        card(c, 40, y-22, W-80, 25)
        c.setFillColor(WHITE)
        c.setFont("Helvetica", 9)
        c.drawString(60, y-15, name)
        c.setFillColor(MUTED)
        c.drawString(250, y-15, auc)
        c.drawString(370, y-15, eer)
        c.setFillColor(color)
        c.circle(475, y-12, 4, fill=1, stroke=0)
        y -= 28

    # Anti-leak note
    y -= 15
    card(c, 40, y-35, W-80, 40, GREEN, 0.06)
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(55, y-15, "Anti-leak verificado")
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 9)
    c.drawString(55, y-28, "Train / test = 0 overlap | Hash dedup | 155K imagenes | Splits originales")

    bar(c)


# ── PAGE 4: Domain Gap Problem ───────────────────────────────────────────────

def page_domain_gap(c):
    bg(c)
    pn(c, 4)
    y = H - 80
    badge(c, 40, y, 140, "LIMITACION V3")

    y -= 55
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 28)
    c.drawString(40, y, "Domain Gap: El Reto Real")

    y -= 30
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 11)
    lines = [
        "V3 logra AUC 0.9999 en datasets de test (misma distribucion que training).",
        "Sin embargo, en fotos reales de movil/webcam/redes sociales, el modelo",
        "genera falsos positivos: clasifica fotos reales como AI-generadas.",
    ]
    for l in lines:
        c.drawString(40, y, l)
        y -= 17

    # Comparison
    y -= 20
    cw = (W - 100) / 2

    # Dataset performance
    card(c, 40, y-100, cw, 105, GREEN, 0.06)
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(55, y-20, "En Datasets (Kaggle)")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 28)
    c.drawString(55, y-55, "AUC 0.9999")
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 9)
    c.drawString(55, y-75, "FFHQ vs StyleGAN2")
    c.drawString(55, y-88, "Imagenes limpias y alineadas")

    # Real world
    card(c, 40+cw+20, y-100, cw, 105, RED, 0.08)
    c.setFillColor(RED)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(55+cw+20, y-20, "En Mundo Real")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 28)
    c.drawString(55+cw+20, y-55, "~84% falso+")
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 9)
    c.drawString(55+cw+20, y-75, "Fotos movil, webcam, RRSS")
    c.drawString(55+cw+20, y-88, "Compresion, iluminacion variable")

    # Why
    y -= 130
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(40, y, "Causa raiz:")

    y -= 25
    reasons = [
        "V3 entrenado con FFHQ (fotos Flickr procesadas) como clase 'real'",
        "FFHQ no representa fotos de movil: diferente compresion, ruido, balance de blancos",
        "El modelo aprendio 'FFHQ vs StyleGAN2', no 'real vs fake' generalizado",
        "Calibracion aplicada en produccion compensa parcialmente pero no resuelve",
    ]
    for r in reasons:
        c.setFillColor(RED)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(50, y, "!")
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 10)
        c.drawString(65, y, r)
        y -= 20

    # Solution arrow
    y -= 25
    card(c, 40, y-45, W-80, 50, GREEN, 0.08)
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(W/2, y-18, "Solucion: V5 con 1M+ imagenes de fuentes diversas")
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 9)
    c.drawCentredString(W/2, y-34, "CelebA + LFW + FaceForensics + CIFAKE + 140K-faces + Gravex-200K + mas")

    bar(c)


# ── PAGE 5: V5 Training Progress ────────────────────────────────────────────

def page_v5_progress(c):
    bg(c)
    pn(c, 5)
    y = H - 80
    badge(c, 40, y, 170, "V5 EN ENTRENAMIENTO")

    y -= 55
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 28)
    c.drawString(40, y, "V5: Datos Reales Diversos")

    y -= 30
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 11)
    c.drawString(40, y, "Entrenando en AWS g5.xlarge (NVIDIA A10G 24GB)")

    # Training config
    y -= 35
    cw = (W - 100) / 2
    config = [
        ("Arquitectura", "EfficientNet-B4 + FreqBranchV2"),
        ("Datasets", "13 fuentes, 1,055,407 imagenes"),
        ("Epochs", "150 (con early stopping)"),
        ("Batch size", "12 (A10G 24GB)"),
        ("Optimizer", "AdamW, lr=1e-4, cosine annealing"),
        ("Loss", "Focal Loss + Label Smoothing 0.05"),
        ("Augmentation", "JPEG Q60-85, blur, noise, color jitter"),
        ("Hardware", "NVIDIA A10G 24GB, eu-west-1"),
    ]
    for i, (k, v) in enumerate(config):
        col, row = i % 2, i // 2
        cx = 40 + col * (cw + 20)
        cy = y - row * 28
        card(c, cx, cy-20, cw, 24)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(cx+10, cy-14, k)
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 8)
        c.drawString(cx+100, cy-14, v)

    # Datasets breakdown
    y = y - 4*28 - 30
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(40, y, "Datasets (Reales + Fakes)")

    y -= 20
    datasets = [
        ("140K-faces", "140,000", "Real", GREEN),
        ("CelebA-HQ", "202,599", "Real", GREEN),
        ("FFHQ", "70,000", "Real", GREEN),
        ("Gravex-200K", "200,000", "Real", GREEN),
        ("LFW", "13,233", "Real", GREEN),
        ("Human-faces", "7,201", "Real", GREEN),
        ("FaceForensics", "182,246", "Fake", RED),
        ("Deepfake-faces", "95,634", "Fake", RED),
        ("CIFAKE", "120,000", "Mixed", YELLOW),
        ("StyleGAN-faces", "12,890", "Fake", RED),
        ("Real-and-fake", "4,082", "Mixed", YELLOW),
        ("AI-faces-HQ", "3,203", "Fake", RED),
        ("Landscape-real", "4,319", "Real", GREEN),
    ]
    col_w = (W - 100) / 3
    for i, (name, count, typ, color) in enumerate(datasets):
        col, row = i % 3, i // 3
        cx = 40 + col * (col_w + 10)
        cy = y - row * 20
        c.setFillColor(color)
        c.circle(cx+5, cy-4, 3, fill=1, stroke=0)
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 7.5)
        c.drawString(cx+14, cy-7, f"{name} ({count})")

    # Current progress
    y = y - 5*20 - 25
    card(c, 40, y-60, W-80, 65, GREEN, 0.06)
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(55, y-18, "Progreso actual (26 Mar 2026)")
    c.setFillColor(WHITE)
    c.setFont("Helvetica", 10)
    c.drawString(55, y-35, "Epoch 9/150 | AUC: 0.5467 | EER: 47.22% | GPU: 100% | 54C")
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 9)
    c.drawString(55, y-50, "AUC subiendo cada epoch. ETA: ~30 horas para completar entrenamiento.")

    bar(c)


# ── PAGE 6: Roadmap ──────────────────────────────────────────────────────────

def page_roadmap(c):
    bg(c)
    pn(c, 6)
    y = H - 80
    badge(c, 40, y, 100, "ROADMAP")

    y -= 55
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 28)
    c.drawString(40, y, "Proximo: V5 + API")

    y -= 40
    steps = [
        ("AHORA", "V5 entrenando en A10G con 1M+ imagenes diversas", GREEN),
        ("27-28 MAR", "V5 completado. Validar con fotos reales de movil/webcam", BLUE),
        ("28-29 MAR", "Si AUC real-world > 0.95: desplegar V5 en API + browser", PURPLE),
        ("ABRIL", "Certificacion iBeta Level 1 para liveness detection", YELLOW),
        ("ABRIL", "SDK nativo iOS/Android con ONNX Runtime Mobile", YELLOW),
        ("MAYO", "Dashboard empresarial: analytics, audit logs, API keys", MUTED),
        ("Q2 2026", "NIST FATE/PAD submission con resultados V5", DIM),
    ]

    for date, desc, color in steps:
        card(c, 40, y-35, W-80, 38)
        c.setFillColor(color)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(55, y-18, date)
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 9)
        c.drawString(155, y-18, desc)
        y -= 45

    # Key message
    y -= 20
    card(c, 40, y-50, W-80, 55, GREEN, 0.08)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 12)
    c.drawCentredString(W/2, y-18, "El modelo V3 tiene AUC 0.9999 en benchmarks.")
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 12)
    c.drawCentredString(W/2, y-36, "V5 lo tendra tambien en el mundo real.")

    c.setFillColor(DIM)
    c.setFont("Helvetica", 8)
    c.drawCentredString(W/2, 60, "Deep-Check | HIUM Solutions SL | Marzo 2026")
    bar(c)


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    c = canvas.Canvas(OUT, pagesize=A4)
    c.setTitle("Deep-Check Model Performance")
    c.setAuthor("HIUM Solutions SL")

    for fn in [page_cover, page_architecture, page_v3_results, page_domain_gap, page_v5_progress, page_roadmap]:
        fn(c)
        c.showPage()

    c.save()
    print(f"PDF: {OUT} ({os.path.getsize(OUT)/1024:.0f} KB)")

if __name__ == '__main__':
    main()
