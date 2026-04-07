"""
Ollama-based document intelligence engine.
Uses locally running Ollama (Gemma 3 4B or similar) for:
- Document OCR and field extraction
- Natural language explanations of forensic results
- Coherence analysis

Lighter and faster than Gemma 4 E4B for on-premise deployments.
Connects to Ollama API at OLLAMA_URL (default: host.docker.internal:11434).
"""
import os, io, base64, logging, json
from PIL import Image

logger = logging.getLogger(__name__)

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://host.docker.internal:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma3:4b")


def _image_to_base64(image_bytes):
    """Convert image bytes to base64 string for Ollama vision."""
    return base64.b64encode(image_bytes).decode("utf-8")


def _ollama_generate(prompt, image_bytes=None, max_tokens=500):
    """Call Ollama API with optional image."""
    import requests

    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"num_predict": max_tokens, "temperature": 0.1},
    }

    if image_bytes:
        payload["images"] = [_image_to_base64(image_bytes)]

    try:
        resp = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json=payload,
            timeout=120,
        )
        if resp.status_code == 200:
            return resp.json().get("response", "")
        logger.warning(f"Ollama returned {resp.status_code}: {resp.text[:200]}")
        return ""
    except Exception as e:
        logger.warning(f"Ollama request failed: {e}")
        return ""


class OllamaDocEngine:
    """Document intelligence via Ollama (local LLM)."""

    def __init__(self):
        self.available = False
        self.model = OLLAMA_MODEL
        try:
            import requests
            resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
            if resp.status_code == 200:
                models = [m["name"] for m in resp.json().get("models", [])]
                self.available = OLLAMA_MODEL in models or any(OLLAMA_MODEL.split(":")[0] in m for m in models)
                if self.available:
                    logger.info(f"OllamaDoc: connected, model={OLLAMA_MODEL}")
                else:
                    logger.warning(f"OllamaDoc: connected but model {OLLAMA_MODEL} not found. Available: {models}")
            else:
                logger.warning(f"OllamaDoc: cannot reach Ollama at {OLLAMA_URL}")
        except Exception as e:
            logger.warning(f"OllamaDoc: init failed: {e}")

    def analyze_document(self, image_bytes, forensic_result=None):
        """Full document analysis using Ollama vision model."""
        if not self.available:
            return {"error": "Ollama not available"}

        forensic_context = ""
        if forensic_result:
            forensic_context = (
                f"\nForensic analysis result: verdict={forensic_result.get('verdict', 'unknown')}, "
                f"p_tampered={forensic_result.get('p_tampered', 0):.4f}"
            )

        prompt = f"""Analyze this document image. Extract all visible text and fields.

Respond in this exact JSON format:
{{
  "doc_type": "DNI|passport|invoice|diploma|unknown",
  "ocr_text": "all visible text",
  "fields": {{
    "surname": "...",
    "given_names": "...",
    "document_number": "...",
    "date_of_birth": "...",
    "expiry_date": "...",
    "nationality": "...",
    "sex": "..."
  }},
  "coherence_issues": ["list of any issues found"],
  "explanation": "Brief analysis of the document authenticity"
}}
{forensic_context}
Return ONLY valid JSON, no markdown."""

        raw = _ollama_generate(prompt, image_bytes, max_tokens=800)

        try:
            # Try to parse JSON from response
            json_start = raw.find("{")
            json_end = raw.rfind("}") + 1
            if json_start >= 0 and json_end > json_start:
                return json.loads(raw[json_start:json_end])
        except json.JSONDecodeError:
            pass

        return {
            "ocr_text": raw,
            "fields": {},
            "coherence_issues": [],
            "explanation": raw[:500] if raw else "Analysis unavailable",
            "doc_type": "unknown",
        }

    def explain_detection(self, image_bytes, detection_type, score, details=""):
        """Generate human-readable explanation."""
        if not self.available:
            return {"explanation": "Ollama not available"}

        prompt = f"""You are a document forensics expert. A {detection_type} detection system
analyzed this image and returned a score of {score}/100 (higher = more likely fake/tampered).
{details}

Provide a brief, professional explanation (2-3 sentences) of what this means
and what artifacts might have been detected. Be specific but accessible."""

        explanation = _ollama_generate(prompt, image_bytes, max_tokens=300)
        return {"explanation": explanation}

    def extract_mrz(self, image_bytes):
        """Extract MRZ text from document image."""
        if not self.available:
            return {"error": "Ollama not available"}

        prompt = """Look at this document image. If there is a Machine Readable Zone (MRZ) at the bottom,
extract the exact MRZ text lines. MRZ lines contain only uppercase letters, digits, and < characters.

Return ONLY the MRZ lines, one per line. If no MRZ found, respond with "NO_MRZ"."""

        raw = _ollama_generate(prompt, image_bytes, max_tokens=200)
        if "NO_MRZ" in raw:
            return {"error": "No MRZ found"}

        lines = [line.strip() for line in raw.split("\n") if len(line.strip()) >= 28]
        return {"mrz_lines": lines, "raw": raw}

    def status(self):
        return {
            "engine": "ollama-doc",
            "model": self.model,
            "url": OLLAMA_URL,
            "available": self.available,
            "capabilities": ["ocr", "mrz", "coherence", "explanation"] if self.available else [],
        }
