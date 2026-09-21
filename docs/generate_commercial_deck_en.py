#!/usr/bin/env python3
"""Deep-Check Commercial Deck — English version. No exact metrics."""

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
OUT = os.path.join(os.path.dirname(__file__), 'deep_check_commercial_en.pdf')

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


def page_cover(c):
    bg(c)
    c.saveState(); c.setFillColor(GREEN); c.setFillAlpha(0.03)
    c.circle(W/2,H/2+60,180,fill=1,stroke=0); c.restoreState()
    y = H-250
    # Center "Deep-Check." as one unit
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
    c.drawCentredString(W/2, y, "AI-Powered Identity")
    y -= 24
    c.drawCentredString(W/2, y, "Verification Platform")
    y -= 40
    c.setStrokeColor(GREEN); c.setLineWidth(2); c.line(W/2-40,y,W/2+40,y)
    y -= 35
    c.setFillColor(MUTED); c.setFont("Helvetica",12)
    c.drawCentredString(W/2, y, "Continuous verification. Absolute privacy.")
    y -= 20
    c.drawCentredString(W/2, y, "Real-time deepfake detection.")
    c.setFillColor(DIM); c.setFont("Helvetica",9)
    c.drawCentredString(W/2, 100, "HIUM Solutions SL | Andalusia, Spain")
    c.drawCentredString(W/2, 85, "https://deep-check-two.vercel.app")
    c.drawCentredString(W/2, 70, "2026")
    bar(c)


def page_what(c):
    bg(c); pn(c,2)
    y = H-80
    badge(c,40,y,160,"WHAT IS DEEP-CHECK")
    y -= 55
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold",28)
    c.drawString(40,y,"Identity verified")
    y -= 34
    c.drawString(40,y,"throughout the entire session.")
    y -= 35
    c.setFillColor(MUTED); c.setFont("Helvetica",11)
    for l in [
        "Deep-Check is an AI-powered identity verification platform that",
        "runs entirely on the user's device.",
        "",
        "Unlike traditional solutions that verify identity only at the start,",
        "Deep-Check continuously monitors throughout the entire session,",
        "detecting deepfakes, impersonation and anomalies in real time.",
    ]:
        c.drawString(40,y,l); y -= 16 if l else 8

    y -= 25
    diffs = [
        (GREEN, "Zero biometrics to server", "All processing happens in the user's browser (WebAssembly). No biometric data ever leaves the device. GDPR native by design."),
        (BLUE, "Continuous verification", "Not just at login. 6 independent detection layers monitor every second of the session. Impossible to evade."),
        (PURPLE, "Zero installation", "Works in any modern browser. No SDK, no apps, no plugins. The user only needs a webcam."),
        (CYAN, "Deepfake detection", "AI engine trained on over one million images detects AI-generated faces, GANs and manipulation tools in real time."),
    ]
    for color, title, desc in diffs:
        card(c,40,y-58,W-80,62)
        c.setFillColor(color); c.circle(56,y-14,5,fill=1,stroke=0)
        c.setFont("Helvetica-Bold",11); c.drawString(68,y-18,title)
        c.setFillColor(MUTED); c.setFont("Helvetica",8.5)
        words = desc.split(); line, lines = "", []
        for w in words:
            test = f"{line} {w}".strip()
            if len(test) > 85: lines.append(line); line = w
            else: line = test
        if line: lines.append(line)
        for i,l in enumerate(lines[:2]): c.drawString(56, y-34-i*12, l)
        y -= 70
    bar(c)


def page_layers(c):
    bg(c); pn(c,3)
    y = H-80
    badge(c,40,y,160,"DETECTION ENGINE")
    y -= 55
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold",28)
    c.drawString(40,y,"6 Independent Layers")
    y -= 25
    c.setFillColor(MUTED); c.setFont("Helvetica",11)
    c.drawString(40,y,"Bayesian logit-space fusion — each layer votes independently")
    y -= 40
    layers = [
        (GREEN, "Vital Signs (rPPG)", "Detects the cardiac pulse through micro color variations in the face. A deepfake or photo has no pulse. Impossible to fake."),
        (BLUE, "Micro-expressions (FACS)", "Analyzes facial biomechanics in real time. AI-generated faces fail to correctly replicate human muscular patterns."),
        (PURPLE, "Forensic AI (Pixel)", "Neural network trained on 1M+ images analyzes each frame for synthetic generation artifacts at pixel level."),
        (CYAN, "Frequency Analysis", "Detects patterns in the frequency domain (DCT, Laplacian) invisible to the human eye but that reveal digital manipulation."),
        (YELLOW, "Keystroke Biometrics", "Unique typing speed, rhythm and pressure patterns. As unique as a fingerprint. Detects if the user changes."),
        (MUTED, "Interaction Dynamics", "Mouse movement, scroll patterns and interaction rhythm. Detects bots, automation and operator changes."),
    ]
    cw = (W-100)/2
    for i,(color,title,desc) in enumerate(layers):
        col,row = i%2,i//2
        cx = 40 + col*(cw+20); cy = y - row*105
        card(c,cx,cy-95,cw,98)
        c.setFillColor(color); c.circle(cx+14,cy-16,4,fill=1,stroke=0)
        c.setFont("Helvetica-Bold",10); c.drawString(cx+26,cy-20,title)
        c.setFillColor(MUTED); c.setFont("Helvetica",8)
        words = desc.split(); line, lines = "", []
        for w in words:
            test = f"{line} {w}".strip()
            if len(test) > 42: lines.append(line); line = w
            else: line = test
        if line: lines.append(line)
        for j,l in enumerate(lines[:4]): c.drawString(cx+14, cy-38-j*12, l)
    bar(c)


def page_products(c):
    bg(c); pn(c,4)
    y = H-80
    badge(c,40,y,110,"PRODUCTS")
    y -= 55
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold",28)
    c.drawString(40,y,"Product Suite")
    y -= 25
    c.setFillColor(MUTED); c.setFont("Helvetica",11)
    c.drawString(40,y,"Each product uses the same detection engine adapted to the use case")
    y -= 35
    products = [
        (GREEN, "Am I Real?", "Live webcam verification. User confirms they are a real human, not a deepfake or AI avatar."),
        (BLUE, "DateSafe", "Catfish detector for dating apps. Upload the profile photo and verify authenticity instantly."),
        (PURPLE, "ProofShot", "Verifiable authenticity certificate for photos. GPS + timestamp + AI analysis included."),
        (YELLOW, "DocSafe", "Document verification. ELA analysis + AI to detect manipulation of photos or PDF documents."),
        (CYAN, "ListingCheck", "Photo verification for real estate and marketplace listings against AI-generated images."),
        (MUTED, "ResumeGuard", "Photo verification in CVs and professional profiles. Batch mode up to 10 photos."),
        (GREEN, "FakeCheck Extension", "Chrome extension. Right-click any web image to verify its authenticity instantly."),
        (BLUE, "REST API v1", "Programmatic integration. Single + batch + webhooks. For enterprises and developers."),
    ]
    cw = (W-100)/2; ch = 68
    for i,(color,title,desc) in enumerate(products):
        col,row = i%2,i//2
        cx = 40+col*(cw+20); cy = y - row*(ch+8)
        card(c,cx,cy-ch,cw,ch)
        c.setFillColor(color); c.circle(cx+14,cy-16,4,fill=1,stroke=0)
        c.setFont("Helvetica-Bold",10); c.drawString(cx+26,cy-20,title)
        c.setFillColor(MUTED); c.setFont("Helvetica",8)
        words = desc.split(); line, lines = "", []
        for w in words:
            test = f"{line} {w}".strip()
            if len(test) > 42: lines.append(line); line = w
            else: line = test
        if line: lines.append(line)
        for j,l in enumerate(lines[:2]): c.drawString(cx+14,cy-36-j*12,l)
    bar(c)


def page_performance(c):
    bg(c); pn(c,5)
    y = H-80
    badge(c,40,y,130,"PERFORMANCE")
    y -= 55
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold",28)
    c.drawString(40,y,"Reference Metrics")
    y -= 25
    c.setFillColor(MUTED); c.setFont("Helvetica",11)
    c.drawString(40,y,"Evaluated under ISO 30107-3 protocol with industrial datasets")
    y -= 45
    mw = (W-110)/3; mh = 75
    metrics = [
        ("AUC > 0.99", "Area Under ROC Curve"),
        ("EER < 1%", "Equal Error Rate"),
        ("< 500ms", "Browser inference time"),
        ("0 bytes", "Biometric data\nto server"),
        ("6 layers", "Independent\ndetection"),
        ("1M+", "Training\nimages"),
    ]
    for i,(val,lab) in enumerate(metrics):
        col,row = i%3,i//3
        cx = 40+col*(mw+15); cy = y - mh - row*(mh+12)
        card(c,cx,cy,mw,mh)
        c.setFillColor(GREEN); c.setFont("Helvetica-Bold",20)
        c.drawCentredString(cx+mw/2,cy+mh-30,val)
        c.setFillColor(MUTED); c.setFont("Helvetica",8)
        for j,l in enumerate(lab.split('\n')):
            c.drawCentredString(cx+mw/2,cy+15-j*11,l)

    y = y - 2*(mh+12) - 25
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold",14)
    c.drawString(40,y,"Proven Robustness")
    y -= 22
    for r in [
        "Aggressive JPEG compression (quality 10-85)",
        "Low lighting and backlight conditions",
        "Grayscale and color filters",
        "Image resizing and cropping",
        "Camera blur and mobile noise",
    ]:
        c.setFillColor(GREEN); c.setFont("Helvetica",10); c.drawString(50,y,"+")
        c.setFillColor(MUTED); c.drawString(65,y,r); y -= 18

    y -= 20
    card(c,40,y-55,W-80,60,GREEN,0.06)
    c.setFillColor(GREEN); c.setFont("Helvetica-Bold",10)
    c.drawString(55,y-18,"Standards Alignment")
    c.setFillColor(MUTED); c.setFont("Helvetica",9)
    c.drawString(55,y-34,"ISO 30107-3 (PAD) | NIST FATE/PAD (in progress) | GDPR Art. 25 | Anti-leak verified")
    bar(c)


def page_tech(c):
    bg(c); pn(c,6)
    y = H-80
    badge(c,40,y,120,"TECHNOLOGY")
    y -= 55
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold",28)
    c.drawString(40,y,"Technology Stack")
    y -= 35
    sections = [
        ("Frontend", [
            "Next.js (App Router) + TypeScript + Tailwind CSS",
            "In-browser AI inference via ONNX Runtime WebAssembly",
            "MediaPipe for real-time face detection",
            "Zero install — works on Chrome, Safari, Firefox, Edge",
        ]),
        ("AI / ML", [
            "Architecture: EfficientNet-B4 + Frequency Branch (multi-scale Laplacian)",
            "Trained on 1M+ images from 13 diverse sources",
            "Bayesian fusion of 6 independent detection layers",
            "Anti-leak verified: zero overlap between train and test",
        ]),
        ("Backend", [
            "Supabase (PostgreSQL) for authentication and session data",
            "Vercel for hosting and serverless functions",
            "REST API v1 with API key authentication",
            "Webhooks for asynchronous integration",
        ]),
        ("Security", [
            "100% client-side processing — zero biometric data to server",
            "Content Security Policy (CSP) configured",
            "CORS and rate limiting on API",
            "BSL License — code visible, IP protected",
        ]),
    ]
    for title, items in sections:
        c.setFillColor(GREEN); c.setFont("Helvetica-Bold",13); c.drawString(40,y,title); y -= 18
        for item in items:
            c.setFillColor(DIM); c.setFont("Helvetica",9); c.drawString(50,y,">")
            c.setFillColor(MUTED); c.drawString(62,y,item); y -= 15
        y -= 10
    bar(c)


def page_usecases(c):
    bg(c); pn(c,7)
    y = H-80
    badge(c,40,y,110,"USE CASES")
    y -= 55
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold",28)
    c.drawString(40,y,"Where It Applies")
    y -= 35
    cases = [
        (GREEN, "Remote Interviews", "Continuous candidate verification throughout the entire interview. Detects impersonation, deepfake usage or unauthorized remote assistance.", "Sector: HR, Recruitment"),
        (BLUE, "Online Exams", "Biometric supervision during university exams and certifications. Detects person switching, AI tools and anomalies.", "Sector: Education, Certifications"),
        (PURPLE, "Digital Banking", "KYC extension during banking sessions. Ensures the verified user remains the same throughout the entire operation.", "Sector: Fintech, Banking"),
        (CYAN, "Telemedicine", "Patient identity verification during remote consultations. Healthcare regulatory compliance.", "Sector: Healthcare, Insurance"),
        (YELLOW, "Marketplaces", "Photo verification in listings, profiles and ads. Detects AI-generated images to prevent fraud.", "Sector: Real Estate, E-commerce"),
        (MUTED, "Social Media / Dating", "Profile photo authenticity verification. Protection against catfishing and fake profiles.", "Sector: Dating, Social Media"),
    ]
    cw = (W-100)/2; ch = 90
    for i,(color,title,desc,sector) in enumerate(cases):
        col,row = i%2,i//2
        cx = 40+col*(cw+20); cy = y - row*(ch+10)
        card(c,cx,cy-ch,cw,ch)
        c.setFillColor(color); c.circle(cx+14,cy-16,4,fill=1,stroke=0)
        c.setFont("Helvetica-Bold",11); c.drawString(cx+26,cy-20,title)
        c.setFillColor(MUTED); c.setFont("Helvetica",8)
        words = desc.split(); line, lines = "", []
        for w in words:
            test = f"{line} {w}".strip()
            if len(test) > 42: lines.append(line); line = w
            else: line = test
        if line: lines.append(line)
        for j,l in enumerate(lines[:3]): c.drawString(cx+14,cy-38-j*11,l)
        c.setFillColor(color); c.setFont("Helvetica-Oblique",7)
        c.drawString(cx+14,cy-ch+12,sector)
    bar(c)


def page_pricing(c):
    bg(c); pn(c,8)
    y = H-80
    badge(c,40,y,100,"PRICING")
    y -= 55
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold",28)
    c.drawString(40,y,"Plans")
    y -= 35
    plans = [
        ("Free", "0", "10 sessions/mo", ["All web tools","Browser verification","No API access"]),
        ("Starter", "29/mo", "50 sessions/mo", ["Everything in Free","REST API (1,000 calls)","Email support"]),
        ("Pro", "79/mo", "Unlimited", ["Everything in Starter","Unlimited API","Webhooks","Priority support"]),
        ("Enterprise", "Custom", "Custom", ["Everything in Pro","Guaranteed SLA","On-premise available","Dedicated integration"]),
    ]
    pw = (W-100)/4
    for i,(name,price,sessions,features) in enumerate(plans):
        cx = 40+i*(pw+8)
        card(c,cx,y-220,pw,225)
        c.setFillColor(GREEN if i==2 else WHITE)
        c.setFont("Helvetica-Bold",14); c.drawCentredString(cx+pw/2,y-18,name)
        c.setFillColor(GREEN); c.setFont("Helvetica-Bold",18)
        c.drawCentredString(cx+pw/2,y-42,price)
        c.setFillColor(DIM); c.setFont("Helvetica",7)
        c.drawCentredString(cx+pw/2,y-56,sessions)
        c.setFillColor(MUTED); c.setFont("Helvetica",7.5)
        for j,f in enumerate(features): c.drawString(cx+10,y-78-j*14,f"+ {f}")

    y = y - 250
    card(c,80,y-100,W-160,110,GREEN,0.07)
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold",16)
    c.drawCentredString(W/2,y-22,"Pablo Lopez Rodriguez")
    c.setFillColor(MUTED); c.setFont("Helvetica",11)
    c.drawCentredString(W/2,y-42,"CEO & Founder | HIUM Solutions SL")
    c.setFillColor(GREEN); c.setFont("Helvetica",10)
    c.drawCentredString(W/2,y-62,"https://deep-check-two.vercel.app")
    c.setFillColor(DIM); c.setFont("Helvetica",9)
    c.drawCentredString(W/2,y-80,"Andalusia, Spain")
    c.setFillColor(DIM); c.setFont("Helvetica",8)
    c.drawCentredString(W/2,55,"Deep-Check | HIUM Solutions SL | 2026")
    bar(c)


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    c = canvas.Canvas(OUT, pagesize=A4)
    c.setTitle("Deep-Check — AI-Powered Identity Verification Platform")
    c.setAuthor("HIUM Solutions SL")
    for fn in [page_cover,page_what,page_layers,page_products,page_performance,page_tech,page_usecases,page_pricing]:
        fn(c); c.showPage()
    c.save()
    print(f"PDF: {OUT} ({os.path.getsize(OUT)/1024:.0f} KB)")

if __name__ == '__main__':
    main()
