"""Gemma 4 E4B Document Intelligence Engine.

Combines DINOv2 forensic detection with Gemma 4 language understanding:
- OCR: reads all text fields from document images
- MRZ: parses machine-readable zones (TD1/TD2/TD3)
- Coherence: validates dates, formats, field consistency
- Explanation: generates human-readable analysis of why a document is flagged

Usage: called AFTER doc_engine.py detects manipulation. Gemma explains WHAT and WHY.
"""
import os, io, logging, base64
from pathlib import Path

logger = logging.getLogger(__name__)
MODEL_ID = "google/gemma-4-E4B-it"


class GemmaDocEngine:
    def __init__(self):
        self.model = None
        self.processor = None
        self.available = False
        self._load()

    def _load(self):
        try:
            from transformers import AutoProcessor, AutoModelForMultimodalLM
            import torch

            logger.info(f"Loading Gemma 4 E4B from {MODEL_ID}...")
            self.processor = AutoProcessor.from_pretrained(MODEL_ID)
            self.model = AutoModelForMultimodalLM.from_pretrained(
                MODEL_ID, dtype="auto", device_map="auto"
            )
            self.available = True
            logger.info("Gemma 4 E4B loaded")
        except Exception as e:
            logger.warning(f"Gemma 4 load failed: {e}")
            self.available = False

    def reload(self):
        self._load()

    def analyze_document(self, image_bytes, forensic_result=None):
        """Full document analysis: OCR + coherence + explanation.

        Args:
            image_bytes: raw image bytes
            forensic_result: dict from DocForensicsEngine with p_tampered, verdict etc.

        Returns:
            dict with ocr_text, fields, coherence_issues, explanation
        """
        if not self.available:
            return {"error": "Gemma 4 not available", "ocr_text": "", "fields": {}}

        from PIL import Image
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # Step 1: OCR - extract all text
        ocr = self._ask(img, "Extract ALL text visible in this document image. Include every field, label, number, date, and text you can see. Output as structured text with field names and values.")

        # Step 2: Field extraction
        fields = self._ask(img, "This is an identity document or official document. Extract these specific fields if present: Full Name, Date of Birth, Document Number, Expiry Date, Nationality, Address, MRZ (machine readable zone). Output as JSON with field names as keys.")

        # Step 3: Coherence check
        coherence = self._ask(img, "Analyze this document for any inconsistencies or errors: invalid dates (like Feb 30), mismatched formats, unusual fonts, text alignment issues, missing required fields for this document type. List each issue found.")

        # Step 4: Forensic explanation (if we have detection results)
        explanation = ""
        if forensic_result and forensic_result.get("p_tampered", 0) > 0.3:
            p = forensic_result.get("p_tampered", 0)
            explanation = self._ask(img, f"A forensic analysis engine detected this document has a {p*100:.0f}% probability of being tampered/manipulated. Analyze the image and explain what specific regions or elements might have been altered. Look for: inconsistent lighting, different compression levels, misaligned text, font changes, splicing boundaries, or any visual anomalies.")
        elif forensic_result:
            explanation = "Document passed forensic analysis. No manipulation detected."

        return {
            "ocr_text": ocr,
            "fields": fields,
            "coherence_issues": coherence,
            "explanation": explanation,
            "gemma_model": MODEL_ID,
        }

    def extract_mrz(self, image_bytes):
        """Extract and parse MRZ from document image."""
        if not self.available:
            return {"error": "Gemma 4 not available"}

        from PIL import Image
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        mrz = self._ask(img, "Find the Machine Readable Zone (MRZ) in this document. The MRZ consists of 2 or 3 lines of uppercase letters, numbers, and < symbols at the bottom of the document. Extract the exact MRZ text, then parse it into: document type (TD1/TD2/TD3), issuing country, surname, given names, document number, nationality, date of birth, sex, expiry date, and check digits. Output as JSON.")

        return {"mrz_analysis": mrz, "model": MODEL_ID}

    def explain_detection(self, image_bytes, detection_type, score, details=""):
        """Generate human-readable explanation of a detection result."""
        if not self.available:
            return {"explanation": f"Detection score: {score}"}

        from PIL import Image
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        prompt = f"""An AI verification system analyzed this image and produced the following result:
- Detection type: {detection_type}
- Score: {score}/100 (higher = more authentic)
- Technical details: {details}

Based on the image and these results, provide a clear 2-3 sentence explanation for a non-technical user about what was found and why the image received this score. Be specific about visual elements."""

        explanation = self._ask(img, prompt)
        return {"explanation": explanation, "model": MODEL_ID}

    def _ask(self, pil_image, question):
        """Send image + question to Gemma 4 and get text response."""
        try:
            messages = [
                {"role": "user", "content": [
                    {"type": "image", "image": pil_image},
                    {"type": "text", "text": question}
                ]}
            ]

            inputs = self.processor.apply_chat_template(
                messages, tokenize=True, return_dict=True,
                return_tensors="pt", add_generation_prompt=True
            ).to(self.model.device)

            input_len = inputs["input_ids"].shape[-1]

            import torch
            with torch.no_grad():
                outputs = self.model.generate(
                    **inputs, max_new_tokens=1024,
                    temperature=0.3, top_p=0.95, top_k=40
                )

            response = self.processor.decode(outputs[0][input_len:], skip_special_tokens=True)
            return response.strip()
        except Exception as e:
            logger.error(f"Gemma inference error: {e}")
            return f"Error: {str(e)}"

    def status(self):
        return {
            "engine": "gemma-doc",
            "model": MODEL_ID,
            "available": self.available,
            "capabilities": ["ocr", "mrz", "coherence", "explanation"],
        }
