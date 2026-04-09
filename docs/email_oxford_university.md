# Email: Oxford University — Deep-Check Meeting Proposal

**To:** admissions@admin.ox.ac.uk
**Subject:** AI-Powered Identity & Document Verification for Higher Education — Meeting Request

---

Dear Oxford University Admissions & Security Team,

My name is Pablo Lopez Rodriguez, founder of Deep-Check — an AI-powered identity verification platform built for institutions that cannot afford to get document fraud wrong.

I'm reaching out because universities like Oxford face a growing set of challenges that our technology directly addresses:

**THE PROBLEM**

- **Fraudulent documents in admissions:** fake transcripts, manipulated diplomas, and forged IDs submitted by applicants — increasingly difficult to detect as AI generation tools improve.
- **Remote exam integrity:** students using AI-generated faces or deepfakes to impersonate others during online proctored assessments.
- **International student verification:** validating passports, visas, and national IDs from 195 countries with different formats and security features.
- **Bot activity in online assessments:** automated scripts completing coursework or exams on behalf of students.
- **AI-generated content in research:** manipulated images appearing in academic submissions.

**WHAT DEEP-CHECK DOES**

We combine multiple AI verification layers into a single platform:

1. **Document Forensics** — DINOv2-based pixel-level tampering detection (AUC 0.998) that catches manipulations invisible to the human eye, across document types from 195 countries (ICAO 9303 compliant).

2. **Deepfake Detection** — Multi-model ensemble (DINOv3 + EfficientNet with Test-Time Augmentation) that detects AI-generated faces from all major generators (Stable Diffusion, MidJourney, DALL-E, FaceSwap).

3. **Keystroke Biometrics** — Transformer-based typing pattern analysis that verifies student identity and detects bot activity during online exams, without requiring additional hardware.

4. **Intelligent OCR + MRZ** — Automated extraction and cross-validation of document fields (name, DOB, document number) with coherence checking powered by Gemma 4.

**KEY DIFFERENTIATORS**

- **Privacy-first:** core biometric processing runs client-side in the browser. Zero biometric data sent to servers — fully GDPR compliant by design.
- **On-premise deployment:** Docker-based, runs entirely within your infrastructure if required.
- **SDK integration:** JavaScript and Python SDKs for direct integration into existing admissions portals, exam platforms, or student management systems.
- **Published research:** peer-reviewed paper with industrial benchmarks following ISO 30107-3 standards.

**USE CASE: ADMISSIONS WORKFLOW**

```
Applicant uploads passport + transcript
        ↓
Deep-Check Document Forensics → authentic / tampered
        ↓
MRZ extraction + field cross-validation → data consistency check
        ↓
Deepfake detection on photo → real / AI-generated
        ↓
Result: verified ✓ or flagged for manual review ⚠
```

I would welcome the opportunity to schedule a **20-minute call** to discuss how Deep-Check could support Oxford's verification workflows — whether in admissions, examination, or research integrity.

Would any time during the **week of 14 April** work for a brief introduction? I'm happy to prepare a live demo tailored to your specific needs.

Kind regards,

**Pablo Lopez Rodriguez**
Founder, Deep-Check | Hium Solutions
pablo@hiumsolutions.com
https://deep-check-two.vercel.app

---

## Notes for Pablo

**Best contacts at Oxford to target:**
- `admissions@admin.ox.ac.uk` — Central admissions office
- `it.security@ox.ac.uk` — IT Security team (for on-prem deployment angle)
- LinkedIn: Search "Head of Admissions Oxford University" or "Director of IT Security Oxford"
- Oxford's Examination Schools may have separate contact for exam integrity

**Talking points for the call:**
1. Start with the admissions fraud problem — it's their biggest pain point with 25,000+ international applications/year
2. Emphasize GDPR compliance and privacy-first — UK universities are very sensitive to data protection post-Brexit
3. On-premise Docker deployment is key — Oxford won't want biometric data leaving their infrastructure
4. Mention the SDK — they'll want to integrate into their existing SITS/Banner student management system
5. The keystroke biometrics angle is novel for exam proctoring — most competitors don't have this
6. Be ready to discuss pricing: probably Enterprise tier (custom), suggest pilot with one department first

**Competitors they may already use:**
- Turnitin (plagiarism, not document verification)
- ProctorU / Examity (remote proctoring, basic face matching)
- Onfido / Jumio (identity verification, but expensive and not privacy-first)

**Our advantages over competitors:**
- Browser-side inference = no biometric data leaves their network
- Document forensics at pixel level (not just OCR matching)
- Keystroke biometrics (unique, no additional hardware)
- On-premise option (competitors are cloud-only)
- Multi-layer ensemble (not single-model)
