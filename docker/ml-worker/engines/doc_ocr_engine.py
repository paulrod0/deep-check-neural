"""
Base document intelligence engine: OCR + MRZ + Coherence.
Always available — no LLM dependency. Fast and deterministic.

For production: this runs always.
Gemma 4 adds premium explanation layer on top.
"""
import io, re, logging
from datetime import datetime
from PIL import Image

logger = logging.getLogger(__name__)


# ── MRZ Parsing (ICAO 9303: TD1, TD2, TD3) ──

MRZ_LINE_PATTERN = re.compile(r"[A-Z0-9<]{30,44}")

CHECK_DIGIT_WEIGHTS = [7, 3, 1]

def mrz_check_digit(s):
    """Compute ICAO 9303 check digit."""
    total = 0
    for i, ch in enumerate(s):
        if ch == "<":
            val = 0
        elif ch.isdigit():
            val = int(ch)
        elif ch.isalpha():
            val = ord(ch) - 55  # A=10, B=11, ...
        else:
            val = 0
        total += val * CHECK_DIGIT_WEIGHTS[i % 3]
    return str(total % 10)


def parse_mrz_td3(lines):
    """Parse TD3 (passport) MRZ — 2 lines of 44 chars."""
    if len(lines) < 2 or len(lines[0]) < 44 or len(lines[1]) < 44:
        return None
    l1, l2 = lines[0][:44], lines[1][:44]

    doc_type = l1[0:2].replace("<", "")
    country = l1[2:5].replace("<", "")
    names = l1[5:44].split("<<", 1)
    surname = names[0].replace("<", " ").strip()
    given = names[1].replace("<", " ").strip() if len(names) > 1 else ""

    doc_num = l2[0:9].replace("<", "")
    doc_check = l2[9]
    nationality = l2[10:13].replace("<", "")
    dob = l2[13:19]
    dob_check = l2[19]
    sex = l2[20]
    expiry = l2[21:27]
    expiry_check = l2[27]

    checks = {
        "doc_number": mrz_check_digit(l2[0:9]) == doc_check,
        "dob": mrz_check_digit(dob) == dob_check,
        "expiry": mrz_check_digit(expiry) == expiry_check,
    }

    return {
        "format": "TD3",
        "doc_type": doc_type,
        "country": country,
        "surname": surname,
        "given_names": given,
        "document_number": doc_num,
        "nationality": nationality,
        "date_of_birth": format_date(dob),
        "sex": sex.replace("<", ""),
        "expiry_date": format_date(expiry),
        "mrz_lines": [l1, l2],
        "check_digits_valid": all(checks.values()),
        "checks": checks,
    }


def parse_mrz_td1(lines):
    """Parse TD1 (ID card / DNI) MRZ — 3 lines of 30 chars."""
    if len(lines) < 3 or len(lines[0]) < 30:
        return None
    l1, l2, l3 = lines[0][:30], lines[1][:30], lines[2][:30]

    doc_type = l1[0:2].replace("<", "")
    country = l1[2:5].replace("<", "")
    doc_num = l1[5:14].replace("<", "")
    doc_check = l1[14]

    dob = l2[0:6]
    dob_check = l2[6]
    sex = l2[7]
    expiry = l2[8:14]
    expiry_check = l2[14]
    nationality = l2[15:18].replace("<", "")

    names = l3.split("<<", 1)
    surname = names[0].replace("<", " ").strip()
    given = names[1].replace("<", " ").strip() if len(names) > 1 else ""

    checks = {
        "doc_number": mrz_check_digit(l1[5:14]) == doc_check,
        "dob": mrz_check_digit(dob) == dob_check,
        "expiry": mrz_check_digit(expiry) == expiry_check,
    }

    return {
        "format": "TD1",
        "doc_type": doc_type,
        "country": country,
        "surname": surname,
        "given_names": given,
        "document_number": doc_num,
        "nationality": nationality,
        "date_of_birth": format_date(dob),
        "sex": sex.replace("<", ""),
        "expiry_date": format_date(expiry),
        "mrz_lines": [l1, l2, l3],
        "check_digits_valid": all(checks.values()),
        "checks": checks,
    }


def format_date(yymmdd):
    """Convert YYMMDD to readable date."""
    if len(yymmdd) != 6:
        return yymmdd
    yy, mm, dd = int(yymmdd[0:2]), yymmdd[2:4], yymmdd[4:6]
    century = 19 if yy > 50 else 20
    return f"{dd}/{mm}/{century}{yy:02d}"


def detect_mrz_lines(text):
    """Find MRZ lines in OCR text."""
    lines = text.upper().split("\n")
    mrz_lines = []
    for line in lines:
        clean = line.strip().replace(" ", "")
        if MRZ_LINE_PATTERN.match(clean) and len(clean) >= 30:
            mrz_lines.append(clean)
    return mrz_lines


def parse_mrz(mrz_lines):
    """Auto-detect MRZ format and parse."""
    if not mrz_lines:
        return None
    line_len = len(mrz_lines[0])
    if line_len >= 44 and len(mrz_lines) >= 2:
        return parse_mrz_td3(mrz_lines)
    elif line_len >= 30 and len(mrz_lines) >= 3:
        return parse_mrz_td1(mrz_lines)
    return None


# ── OCR (Tesseract or fallback) ──

def ocr_extract(image_bytes):
    """Extract text from document image."""
    try:
        import pytesseract
        img = Image.open(io.BytesIO(image_bytes))
        text = pytesseract.image_to_string(img, lang="eng+spa")
        return text.strip()
    except ImportError:
        logger.warning("pytesseract not installed, OCR disabled")
        return ""
    except Exception as e:
        logger.warning(f"OCR failed: {e}")
        return ""


# ── Spanish DNI Check Digit ──

DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE"

def validate_dni_number(dni_str):
    """Validate Spanish DNI number + letter. Returns (valid, expected_letter)."""
    import re
    match = re.match(r'^(\d{8})([A-Z])$', dni_str.upper().strip())
    if not match:
        return None, None
    number = int(match.group(1))
    letter = match.group(2)
    expected = DNI_LETTERS[number % 23]
    return letter == expected, expected


# ── Cross-Validation ──

def cross_validate_front_back(front_fields, back_fields):
    """Cross-validate fields between front and back of document."""
    issues = []

    # Compare document numbers
    front_num = front_fields.get("document_number", "")
    back_num = back_fields.get("document_number", "")
    if front_num and back_num and front_num != back_num:
        issues.append(f"CRITICAL: Document number mismatch — front: {front_num}, back: {back_num}")

    # Compare names
    for field in ["surname", "given_names"]:
        f = front_fields.get(field, "")
        b = back_fields.get(field, "")
        if f and b and f.upper().strip() != b.upper().strip():
            issues.append(f"Name mismatch ({field}) — front: {f}, back: {b}")

    # Compare DOB
    front_dob = front_fields.get("date_of_birth", "")
    back_dob = back_fields.get("date_of_birth", "")
    if front_dob and back_dob and front_dob != back_dob:
        issues.append(f"CRITICAL: Date of birth mismatch — front: {front_dob}, back: {back_dob}")

    return issues


def cross_validate_mrz_vs_visual(mrz_fields, visual_fields):
    """Cross-validate MRZ data against visually extracted fields."""
    issues = []

    # Document number
    mrz_num = mrz_fields.get("document_number", "")
    vis_num = visual_fields.get("document_number", "")
    if mrz_num and vis_num and mrz_num != vis_num:
        issues.append(f"CRITICAL: MRZ document number ({mrz_num}) does not match visual ({vis_num})")

    # Name
    mrz_name = (mrz_fields.get("surname", "") + " " + mrz_fields.get("given_names", "")).strip()
    vis_name = (visual_fields.get("surname", "") + " " + visual_fields.get("given_names", "")).strip()
    if mrz_name and vis_name and mrz_name.upper() != vis_name.upper():
        issues.append(f"MRZ name ({mrz_name}) differs from visual ({vis_name})")

    # DOB
    mrz_dob = mrz_fields.get("date_of_birth", "")
    vis_dob = visual_fields.get("date_of_birth", "")
    if mrz_dob and vis_dob and mrz_dob != vis_dob:
        issues.append(f"CRITICAL: MRZ DOB ({mrz_dob}) does not match visual ({vis_dob})")

    return issues


# ── Coherence Checks ──

def check_coherence(fields):
    """Run deterministic coherence checks on extracted fields."""
    issues = []

    # Spanish DNI check digit validation
    doc_num = fields.get("document_number", "")
    if doc_num and len(doc_num) == 9 and doc_num[:-1].isdigit() and doc_num[-1].isalpha():
        valid, expected = validate_dni_number(doc_num)
        if valid is not None and not valid:
            issues.append(f"CRITICAL: DNI check digit invalid — {doc_num} should end in '{expected}', not '{doc_num[-1]}'")

    # MRZ vs visual cross-validation (if MRZ was parsed)
    if fields.get("mrz_detected") and fields.get("mrz_lines"):
        mrz_parsed = parse_mrz(fields["mrz_lines"])
        if mrz_parsed:
            mrz_issues = cross_validate_mrz_vs_visual(mrz_parsed, fields)
            issues.extend(mrz_issues)

    # Check expiry not in the past
    if fields.get("expiry_date"):
        try:
            parts = fields["expiry_date"].split("/")
            if len(parts) == 3:
                exp = datetime(int(parts[2]), int(parts[1]), int(parts[0]))
                if exp < datetime.now():
                    issues.append("Document has expired")
        except (ValueError, IndexError):
            pass

    # Check DOB is reasonable (age 0-120)
    if fields.get("date_of_birth"):
        try:
            parts = fields["date_of_birth"].split("/")
            if len(parts) == 3:
                birth = datetime(int(parts[2]), int(parts[1]), int(parts[0]))
                age = (datetime.now() - birth).days / 365.25
                if age < 0 or age > 120:
                    issues.append(f"Implausible age: {age:.0f} years")
                if age < 14:
                    issues.append(f"Holder appears to be a minor ({age:.0f} years)")
        except (ValueError, IndexError):
            pass

    # MRZ check digit validation
    if fields.get("check_digits_valid") is False:
        failed = [k for k, v in fields.get("checks", {}).items() if not v]
        issues.append(f"MRZ check digit(s) failed: {', '.join(failed)}")

    # Country code validation
    country = fields.get("country", "")
    if country and len(country) != 3:
        issues.append(f"Invalid country code: {country}")

    # Sex field
    sex = fields.get("sex", "")
    if sex and sex not in ("M", "F", ""):
        issues.append(f"Invalid sex field: {sex}")

    return issues


# ── Main Engine ──

class DocOcrEngine:
    """
    Base document intelligence: OCR + MRZ + coherence.
    Always available, no LLM dependency.
    """

    def __init__(self):
        self.ocr_available = False
        try:
            import pytesseract
            pytesseract.get_tesseract_version()
            self.ocr_available = True
            logger.info("DocOCR: Tesseract available")
        except Exception:
            logger.warning("DocOCR: Tesseract not available, MRZ-only mode")

    def analyze(self, image_bytes):
        """Full base analysis: OCR + MRZ + coherence."""
        result = {
            "ocr_text": "",
            "mrz": None,
            "fields": {},
            "coherence_issues": [],
            "doc_type": "unknown",
        }

        # OCR
        ocr_text = ocr_extract(image_bytes)
        result["ocr_text"] = ocr_text

        # MRZ detection and parsing
        mrz_lines = detect_mrz_lines(ocr_text)
        if mrz_lines:
            parsed = parse_mrz(mrz_lines)
            if parsed:
                result["mrz"] = parsed
                result["doc_type"] = parsed.get("format", "unknown")
                result["fields"] = {
                    "surname": parsed.get("surname", ""),
                    "given_names": parsed.get("given_names", ""),
                    "document_number": parsed.get("document_number", ""),
                    "nationality": parsed.get("nationality", ""),
                    "date_of_birth": parsed.get("date_of_birth", ""),
                    "sex": parsed.get("sex", ""),
                    "expiry_date": parsed.get("expiry_date", ""),
                    "country": parsed.get("country", ""),
                }
                result["coherence_issues"] = check_coherence(parsed)

        return result

    def extract_mrz(self, image_bytes):
        """MRZ-only extraction."""
        ocr_text = ocr_extract(image_bytes)
        mrz_lines = detect_mrz_lines(ocr_text)
        if mrz_lines:
            parsed = parse_mrz(mrz_lines)
            if parsed:
                return parsed
        return {"error": "No MRZ found", "mrz_lines": mrz_lines}

    def status(self):
        return {
            "engine": "doc-ocr",
            "ocr_available": self.ocr_available,
            "capabilities": ["mrz_parse", "coherence_check"] + (["ocr"] if self.ocr_available else []),
        }
