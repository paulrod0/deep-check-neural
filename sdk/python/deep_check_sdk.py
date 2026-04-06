"""
Deep-Check Python SDK
======================
Integra verificacion de documentos y deteccion de deepfakes en cualquier aplicacion.

Uso:
    from deep_check_sdk import DeepCheck

    dc = DeepCheck(api_url="http://localhost:8001")

    # Verificar documento
    result = dc.verify_document("dni_scan.jpg")
    print(result.verdict)        # "authentic" o "tampered"
    print(result.ocr_text)       # Texto extraido
    print(result.explanation)    # Explicacion en lenguaje natural

    # Detectar deepfake
    result = dc.detect_deepfake("selfie.jpg")
    print(result.p_fake)         # 0.0-1.0
    print(result.verdict)        # "real", "suspicious", "likely_fake", "fake"

    # Verificar keystroke
    result = dc.verify_keystroke(keystrokes)
    print(result.is_bot)         # True/False
    print(result.similarity)     # 0.0-1.0 vs perfil guardado
"""

import requests
import base64
import json
from pathlib import Path
from dataclasses import dataclass
from typing import Optional, List, Dict, Any


@dataclass
class DeepfakeResult:
    p_fake: float
    authenticity_score: int
    verdict: str
    confidence: str
    model: str
    tta_passes: int = 1
    raw: dict = None

@dataclass
class DocumentResult:
    p_tampered: float
    verdict: str
    ocr_text: str
    fields: dict
    coherence_issues: str
    explanation: str
    doc_type: str = ""
    mrz: dict = None
    processing_ms: float = 0
    raw: dict = None

@dataclass
class KeystrokeResult:
    is_bot: bool
    bot_score: float
    similarity: float
    embedding: list = None
    raw: dict = None


class DeepCheck:
    """Deep-Check verification SDK."""

    def __init__(self, api_url: str = "http://localhost:8001", api_key: str = None, timeout: int = 30):
        self.api_url = api_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self._session = requests.Session()
        if api_key:
            self._session.headers["Authorization"] = f"Bearer {api_key}"

    def health(self) -> dict:
        """Check API health and model status."""
        r = self._session.get(f"{self.api_url}/health", timeout=self.timeout)
        r.raise_for_status()
        return r.json()

    # ── Deepfake Detection ──

    def detect_deepfake(self, image, use_tta: bool = True) -> DeepfakeResult:
        """Detect if image is AI-generated or manipulated.

        Args:
            image: file path (str/Path), bytes, or base64 string
            use_tta: use Test-Time Augmentation (5 passes, more accurate)

        Returns:
            DeepfakeResult with p_fake, verdict, confidence
        """
        data = self._prepare_image(image)
        r = self._session.post(
            f"{self.api_url}/detect/deepfake",
            files={"image": ("image.jpg", data, "image/jpeg")} if isinstance(data, bytes) else None,
            data={"frameBase64": data, "use_tta": str(use_tta).lower()} if isinstance(data, str) else {"use_tta": str(use_tta).lower()},
            timeout=self.timeout
        )
        r.raise_for_status()
        j = r.json()
        return DeepfakeResult(
            p_fake=j.get("p_fake", 0.5),
            authenticity_score=j.get("authenticity_score", 50),
            verdict=j.get("verdict", "unknown"),
            confidence=j.get("confidence", "low"),
            model=j.get("model", ""),
            tta_passes=j.get("tta_passes", 1),
            raw=j
        )

    # ── Document Verification ──

    def verify_document(self, image, full_analysis: bool = True) -> DocumentResult:
        """Verify document authenticity with forensics + AI analysis.

        Combines: DINOv2 forensics + ICAO classification + Gemma 4 OCR/explanation.

        Args:
            image: file path, bytes, or base64
            full_analysis: include Gemma 4 OCR + explanation (slower but richer)

        Returns:
            DocumentResult with verdict, OCR, fields, explanation
        """
        data = self._prepare_image(image)
        endpoint = "/analyze/document" if full_analysis else "/detect/document"
        r = self._session.post(
            f"{self.api_url}{endpoint}",
            files={"image": ("doc.jpg", data, "image/jpeg")} if isinstance(data, bytes) else None,
            data={"frameBase64": data} if isinstance(data, str) else None,
            timeout=self.timeout * 2  # Gemma takes longer
        )
        r.raise_for_status()
        j = r.json()

        forensics = j.get("forensics", j)
        analysis = j.get("analysis", {})

        return DocumentResult(
            p_tampered=forensics.get("p_tampered", forensics.get("p_fake", 0.5)),
            verdict=forensics.get("verdict", "unknown"),
            ocr_text=analysis.get("ocr_text", ""),
            fields=analysis.get("fields", {}),
            coherence_issues=analysis.get("coherence_issues", ""),
            explanation=analysis.get("explanation", ""),
            processing_ms=j.get("processing_ms", 0),
            raw=j
        )

    def read_mrz(self, image) -> dict:
        """Extract and parse MRZ from document image.

        Returns parsed MRZ fields: doc_type, country, name, doc_number, etc.
        """
        data = self._prepare_image(image)
        r = self._session.post(
            f"{self.api_url}/analyze/mrz",
            files={"image": ("doc.jpg", data, "image/jpeg")} if isinstance(data, bytes) else None,
            data={"frameBase64": data} if isinstance(data, str) else None,
            timeout=self.timeout * 2
        )
        r.raise_for_status()
        return r.json()

    # ── Keystroke Biometrics ──

    def verify_keystroke(self, keystrokes: List[Dict], user_id: str = None) -> KeystrokeResult:
        """Verify user identity and detect bots via typing patterns.

        Args:
            keystrokes: list of {key, hold_time_ms, flight_time_ms}
            user_id: optional user ID to compare against enrolled profile

        Returns:
            KeystrokeResult with bot detection and identity similarity
        """
        r = self._session.post(
            f"{self.api_url}/verify/keystroke",
            json={"keystrokes": keystrokes, "user_id": user_id},
            timeout=self.timeout
        )
        r.raise_for_status()
        j = r.json()
        return KeystrokeResult(
            is_bot=j.get("is_bot", False),
            bot_score=j.get("bot_score", 0),
            similarity=j.get("similarity", 0),
            embedding=j.get("embedding"),
            raw=j
        )

    def enroll_keystroke(self, keystrokes: List[Dict], user_id: str) -> dict:
        """Enroll user typing pattern for future verification."""
        r = self._session.post(
            f"{self.api_url}/enroll/keystroke",
            json={"keystrokes": keystrokes, "user_id": user_id},
            timeout=self.timeout
        )
        r.raise_for_status()
        return r.json()

    # ── Explain ──

    def explain(self, image, detection_type: str = "deepfake", score: int = 50, details: str = "") -> str:
        """Get human-readable explanation of any detection result."""
        data = self._prepare_image(image)
        r = self._session.post(
            f"{self.api_url}/explain",
            files={"image": ("img.jpg", data, "image/jpeg")} if isinstance(data, bytes) else None,
            data={
                "frameBase64": data if isinstance(data, str) else None,
                "detection_type": detection_type,
                "score": str(score),
                "details": details
            },
            timeout=self.timeout * 2
        )
        r.raise_for_status()
        return r.json().get("explanation", "")

    # ── Models ──

    def models_status(self) -> dict:
        """Get status of all loaded models."""
        r = self._session.get(f"{self.api_url}/models/status", timeout=self.timeout)
        r.raise_for_status()
        return r.json()

    # ── Internal ──

    def _prepare_image(self, image):
        if isinstance(image, (str, Path)):
            path = Path(image)
            if path.exists():
                return path.read_bytes()
            elif image.startswith("data:") or len(image) > 1000:
                return image  # base64
            else:
                raise FileNotFoundError(f"Image not found: {image}")
        elif isinstance(image, bytes):
            return image
        else:
            raise TypeError(f"Expected str, Path, or bytes, got {type(image)}")
