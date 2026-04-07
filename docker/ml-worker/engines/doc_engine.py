"""
Document forensics engine: DINOv2 + ELA (pixel) + PDF structural analysis.
Combined pipeline for both images and PDFs.
"""
import os, io, logging, cv2, json
from pathlib import Path
from datetime import datetime
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)
MODEL_DIR = Path(os.getenv("MODEL_DIR", "/app/models"))
IMG_SIZE = 224
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

# Suspicious PDF producers (image editors, not document tools)
SUSPICIOUS_PRODUCERS = {"photoshop", "gimp", "paint", "canva", "pixlr", "affinity", "corel"}
# Legitimate document producers
LEGIT_PRODUCERS = {"microsoft", "word", "libreoffice", "openoffice", "latex", "pdflatex",
                   "chrome", "firefox", "safari", "wkhtmltopdf", "reportlab", "itext",
                   "acrobat", "adobe", "cups", "quartz", "preview", "scanner", "epson", "hp"}


def compute_ela(img_bgr, quality=90):
    _, buf = cv2.imencode(".jpg", img_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    resaved = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    return np.clip(cv2.absdiff(img_bgr, resaved).astype(np.float32) * 15, 0, 255).astype(np.uint8)


# ── PDF Structural Analysis ──

def analyze_pdf_structure(pdf_bytes):
    """Analyze PDF internal structure for signs of manipulation.
    Returns structural forensics result with risk indicators."""
    try:
        import fitz
    except ImportError:
        return None

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:
        logger.warning(f"PDF parse failed: {e}")
        return None

    result = {
        "is_pdf": True,
        "pages": len(doc),
        "metadata": {},
        "text_extracted": "",
        "fields_from_text": {},
        "fonts": [],
        "images_count": 0,
        "has_annotations": False,
        "has_layers": False,
        "risk_indicators": [],
        "structural_score": 0.0,  # 0 = clean, 1 = highly suspicious
    }

    # 1. Metadata analysis
    meta = doc.metadata or {}
    result["metadata"] = {
        "producer": meta.get("producer", ""),
        "creator": meta.get("creator", ""),
        "creation_date": meta.get("creationDate", ""),
        "mod_date": meta.get("modDate", ""),
        "title": meta.get("title", ""),
        "author": meta.get("author", ""),
    }

    # Check producer for suspicious software
    producer_lower = (meta.get("producer", "") + " " + meta.get("creator", "")).lower()
    if any(s in producer_lower for s in SUSPICIOUS_PRODUCERS):
        result["risk_indicators"].append(f"Created with image editing software: {meta.get('producer', meta.get('creator', ''))}")
        result["structural_score"] += 0.4

    # Check modification date vs creation date
    creation = meta.get("creationDate", "")
    modification = meta.get("modDate", "")
    if creation and modification and creation != modification:
        result["risk_indicators"].append("Document was modified after creation")
        result["structural_score"] += 0.1

    # 2. Extract text from ALL pages (native text, not OCR — instant and perfect)
    all_text = []
    for page in doc:
        text = page.get_text("text")
        if text.strip():
            all_text.append(text.strip())
    result["text_extracted"] = "\n---PAGE---\n".join(all_text)

    # If document has no native text, it's likely a scanned image
    if not any(all_text):
        result["risk_indicators"].append("No native text — document is image-only (scanned)")
        result["structural_score"] += 0.05

    # 3. Extract fields from text (DNI, passport, etc.)
    result["fields_from_text"] = extract_fields_from_text(result["text_extracted"])

    # 4. Font analysis
    all_fonts = set()
    font_per_page = {}
    for i, page in enumerate(doc):
        page_fonts = set()
        for font in page.get_fonts():
            font_name = font[3] if len(font) > 3 else str(font)
            all_fonts.add(font_name)
            page_fonts.add(font_name)
        font_per_page[i] = page_fonts

    result["fonts"] = list(all_fonts)

    # Check for unusual font count (too many = possible editing)
    if len(all_fonts) > 10:
        result["risk_indicators"].append(f"Unusual number of fonts: {len(all_fonts)} (possible editing)")
        result["structural_score"] += 0.15

    # 5. Image analysis
    total_images = 0
    for page in doc:
        images = page.get_images(full=True)
        total_images += len(images)
    result["images_count"] = total_images

    # 6. Annotations (edits, highlights, etc.)
    for page in doc:
        annots = list(page.annots() or [])
        if annots:
            result["has_annotations"] = True
            result["risk_indicators"].append(f"Document has {len(annots)} annotations/edits")
            result["structural_score"] += 0.2
            break

    # 7. Check for optional content groups (layers)
    try:
        oc = doc.get_page_labels()
        # Check for OCGs in catalog
        catalog = doc.pdf_catalog()
        if catalog:
            xref = doc.xref_object(catalog)
            if "OCProperties" in xref:
                result["has_layers"] = True
                result["risk_indicators"].append("Document has layers (possible editing)")
                result["structural_score"] += 0.3
    except Exception:
        pass

    # Clamp score
    result["structural_score"] = min(1.0, result["structural_score"])

    doc.close()
    return result


def extract_fields_from_text(text):
    """Extract document fields from native PDF text using patterns."""
    import re
    fields = {}
    text_upper = text.upper()

    # Spanish DNI patterns
    dni_match = re.search(r'\b(\d{8}[A-Z])\b', text_upper)
    if dni_match:
        fields["document_number"] = dni_match.group(1)

    # Name patterns
    for label in ["APELLIDOS", "SURNAME", "APELLIDO"]:
        idx = text_upper.find(label)
        if idx >= 0:
            after = text[idx + len(label):].strip().split("\n")[0].strip()
            after = after.lstrip(":").strip()
            if after and len(after) > 1:
                fields["surname"] = after

    for label in ["NOMBRE", "GIVEN NAME", "NAME"]:
        idx = text_upper.find(label)
        if idx >= 0:
            after = text[idx + len(label):].strip().split("\n")[0].strip()
            after = after.lstrip(":").strip()
            if after and len(after) > 1 and after.upper() not in ("APELLIDOS", "SURNAME"):
                fields["given_names"] = after

    # Date patterns (DD/MM/YYYY or DD MM YYYY or DD-MM-YYYY)
    dates = re.findall(r'\b(\d{1,2}[\s/\-\.]\d{1,2}[\s/\-\.]\d{4})\b', text)
    if dates:
        if len(dates) >= 1:
            fields["date_1"] = dates[0]
        if len(dates) >= 2:
            fields["date_2"] = dates[1]
        if len(dates) >= 3:
            fields["date_3"] = dates[2]

    # Nationality
    for label in ["NACIONALIDAD", "NATIONALITY"]:
        idx = text_upper.find(label)
        if idx >= 0:
            after = text[idx + len(label):].strip().split("\n")[0].strip()
            after = after.lstrip(":").strip()
            if after and len(after) <= 5:
                fields["nationality"] = after

    # Sex
    for label in ["SEXO", "SEX"]:
        idx = text_upper.find(label)
        if idx >= 0:
            after = text_upper[idx + len(label):].strip().split("\n")[0].strip()
            after = after.lstrip(":").strip()
            if after and after[0] in "MFX":
                fields["sex"] = after[0]

    # MRZ detection
    mrz_lines = re.findall(r'[A-Z0-9<]{30,44}', text_upper)
    if mrz_lines:
        fields["mrz_detected"] = True
        fields["mrz_lines"] = mrz_lines[:3]

    return fields


# ── Main Engine ──

class DocForensicsEngine:
    def __init__(self):
        self.model = None
        self.active_model = None
        self.model_version = None
        self.device = "cpu"
        self._load_model()

    def _load_model(self):
        for name in ["best_doc.pt", "best_doc_v2b.pt", "best_doc_restart.pt"]:
            path = MODEL_DIR / "doc_forensics" / name
            if not path.exists():
                continue
            try:
                import torch, timm, torch.nn as nn
                device = "cuda" if torch.cuda.is_available() else "cpu"
                ckpt = torch.load(path, map_location=device, weights_only=False)
                bb = timm.create_model("vit_large_patch14_dinov2.lvd142m", pretrained=False, num_classes=0, dynamic_img_size=True, img_size=224)
                old_pe = bb.patch_embed.proj
                new_pe = nn.Conv2d(6, old_pe.out_channels, old_pe.kernel_size, stride=old_pe.stride, padding=old_pe.padding)
                bb.patch_embed.proj = new_pe
                fd = bb.num_features
                hd = nn.Sequential(nn.LayerNorm(fd), nn.Linear(fd, 512), nn.GELU(), nn.Dropout(0.2), nn.Linear(512, 1))

                class M(nn.Module):
                    def __init__(s, b, h):
                        super().__init__()
                        s.backbone = b
                        s.head = h
                    def forward(s, x):
                        return s.head(s.backbone(x)).squeeze(-1)

                model = M(bb, hd).to(device)
                state = ckpt.get("model_state_dict", ckpt.get("model_state", {}))
                model.load_state_dict(state, strict=False)
                model.eval()
                self.model = model
                self.device = device
                self.active_model = "doc-dinov2-ela"
                self.model_version = ckpt.get("config", {}).get("version", "v2b")
                logger.info(f"Doc Forensics loaded from {name} on {device}")
                return
            except Exception as e:
                logger.warning(f"Doc load failed ({name}): {e}")
        logger.warning("No doc forensics model found")

    def reload(self):
        self.model = None
        self.active_model = None
        self._load_model()

    def detect(self, image_bytes, raw_pdf_bytes=None):
        """Full document detection: pixel forensics + PDF structural (if PDF).

        Args:
            image_bytes: JPEG/PNG image bytes (page 1 for PDFs)
            raw_pdf_bytes: Original PDF bytes (for structural analysis)

        Returns combined result with pixel + structural scores.
        """
        # Pixel forensics (DINOv2 + ELA)
        if self.model is not None:
            pixel_result = self._detect_model(image_bytes)
        else:
            pixel_result = self._detect_heuristic(image_bytes)

        # PDF structural analysis (if PDF provided)
        pdf_result = None
        if raw_pdf_bytes:
            pdf_result = analyze_pdf_structure(raw_pdf_bytes)

        # Combine scores
        if pdf_result:
            p_pixel = pixel_result["p_tampered"]
            p_struct = pdf_result["structural_score"]
            has_native_text = bool(pdf_result.get("text_extracted", "").strip())

            # For PDFs with native text: structural analysis is MORE reliable than pixel
            # (pixel forensics sees PDF conversion artifacts, not real manipulation)
            if has_native_text:
                # Trust structural more: 30% pixel, 70% structural
                combined_p = p_pixel * 0.3 + p_struct * 0.7
            else:
                # Scanned PDF (image-only): pixel is more relevant
                combined_p = p_pixel * 0.6 + p_struct * 0.4

            if combined_p < 0.20:
                combined_verdict = "authentic"
            elif combined_p < 0.45:
                combined_verdict = "likely_authentic"
            elif combined_p < 0.65:
                combined_verdict = "suspicious"
            else:
                combined_verdict = "tampered"

            return {
                "p_tampered": round(combined_p, 4),
                "verdict": combined_verdict,
                "model": self.active_model or "ela-heuristic",
                "version": self.model_version,
                "pixel_forensics": {
                    "p_tampered": round(p_pixel, 4),
                    "verdict": pixel_result["verdict"],
                },
                "pdf_structural": {
                    "p_tampered": round(p_struct, 4),
                    "risk_indicators": pdf_result.get("risk_indicators", []),
                    "producer": pdf_result["metadata"].get("producer", ""),
                    "creator": pdf_result["metadata"].get("creator", ""),
                    "fonts_count": len(pdf_result.get("fonts", [])),
                    "images_count": pdf_result.get("images_count", 0),
                    "has_annotations": pdf_result.get("has_annotations", False),
                    "has_layers": pdf_result.get("has_layers", False),
                    "has_native_text": has_native_text,
                    "pages": pdf_result.get("pages", 0),
                },
                "text_extracted": pdf_result.get("text_extracted", ""),
                "fields_from_pdf": pdf_result.get("fields_from_text", {}),
            }

        # Image only (no PDF structural)
        return {
            **pixel_result,
            "pixel_forensics": {
                "p_tampered": round(pixel_result["p_tampered"], 4),
                "verdict": pixel_result["verdict"],
            },
        }

    def _detect_model(self, image_bytes):
        import torch
        arr = np.array(Image.open(io.BytesIO(image_bytes)).convert("RGB"))
        bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        ela = compute_ela(bgr)
        ela_rgb = cv2.cvtColor(ela, cv2.COLOR_BGR2RGB)
        rgb = cv2.resize(arr, (IMG_SIZE, IMG_SIZE)).astype(np.float32) / 255.0
        ela_r = cv2.resize(ela_rgb, (IMG_SIZE, IMG_SIZE)).astype(np.float32) / 255.0
        combined = np.concatenate([(rgb - MEAN) / STD, (ela_r - MEAN) / STD], axis=2).transpose(2, 0, 1)[np.newaxis]
        with torch.no_grad():
            p = float(torch.sigmoid(self.model(torch.from_numpy(combined).float().to(self.device))).cpu().item())
        v = "authentic" if p < 0.3 else "suspicious" if p < 0.6 else "tampered"
        return {"p_tampered": round(p, 4), "verdict": v, "model": self.active_model, "version": self.model_version}

    def _detect_heuristic(self, image_bytes):
        arr = np.array(Image.open(io.BytesIO(image_bytes)).convert("RGB"))
        ela = compute_ela(cv2.cvtColor(arr, cv2.COLOR_RGB2BGR))
        score = float(ela.mean()) / 255.0
        v = "authentic" if score < 0.15 else "suspicious" if score < 0.3 else "tampered"
        return {"p_tampered": round(score, 4), "verdict": v, "model": "ela-heuristic", "version": "fallback"}

    def status(self):
        return {
            "engine": "doc_forensics",
            "active_model": self.active_model or "ela-heuristic",
            "version": self.model_version,
            "gpu": self.device != "cpu",
            "capabilities": ["pixel_forensics", "ela", "pdf_structural", "text_extraction", "field_extraction"],
        }
