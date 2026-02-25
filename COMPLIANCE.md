# Deep-Check — Compliance & Certification Roadmap

This document tracks Deep-Check's compliance status and roadmap across regulatory frameworks
relevant to biometric data processing and AI-assisted identity verification.

---

## Current Status

| Framework | Status | Notes |
|---|---|---|
| GDPR / RGPD | 🟡 In Progress | Privacy policy live, consent gates implemented, DPIA pending |
| EU AI Act (2024/1689) | 🟡 Architecture Review | Client-side processing + human oversight implemented. Technical docs in progress |
| eIDAS 2.0 | ⚪ Evaluating | Relevant for digital identity use cases |
| ISO 27001 | ⚪ Planned Q1 2027 | Requires ~12-18 months and external auditor |
| ENS (Esquema Nacional de Seguridad) | ⚪ Planned Q2 2027 | Required for Spanish public sector contracts |
| SOC 2 Type II | ⚪ Planned | Required for US enterprise |
| Independent Algorithm Audit | ⚪ Planned Q3 2026 | NCC Group / equivalent |

---

## GDPR Compliance Checklist

### Completed ✅
- [x] Privacy Policy published at `/privacy` (GDPR Article 13/14 compliant)
- [x] Terms of Service at `/terms` with explicit human oversight requirement
- [x] Cookie consent banner with granular choice (necessary only / decline optional)
- [x] Explicit biometric consent gate before interview sessions (Art. 9(2)(a))
- [x] Explicit biometric consent checkbox in enrollment flow
- [x] Data retention policy defined (profiles: 90 days, assessments: 12 months)
- [x] Privacy by design: all raw biometric signals processed client-side
- [x] Sub-processor list documented (Supabase, Vercel)
- [x] Data subject rights documented (access, erasure, portability, objection)
- [x] Security headers: CSP, HSTS, X-Frame-Options, Permissions-Policy

### In Progress 🟡
- [ ] DPIA (Data Protection Impact Assessment) — Article 35 GDPR
  - Required before large-scale biometric processing
  - Estimated cost with external legal support: €1,500–2,500
  - Timeline: 4–6 weeks with legal partner
- [ ] Formal DPO appointment (can be external, ~€500/month)
- [ ] Data Processing Agreement (DPA) template for operators — Article 28
- [ ] Records of processing activities (ROPA) — Article 30

### Planned ⚪
- [ ] DPIA review cycle (annual or on significant change)
- [ ] Formal data breach response procedure
- [ ] Cross-border transfer impact assessment

---

## EU AI Act Compliance

Deep-Check's identity verification system may qualify as a **high-risk AI system** under
Annex III of the EU AI Act (employment and education access decisions).

### Completed ✅
- [x] Human oversight mechanism: scores are advisory, not automated decisions (Art. 14)
- [x] Transparency notice to users before biometric processing (Art. 13)
- [x] Technical whitepaper documenting methodology, limitations, and performance (Art. 11)
- [x] Privacy by design architecture documented

### In Progress 🟡
- [ ] Technical documentation file per Article 11 (formal)
- [ ] Conformity assessment pathway identified
- [ ] Fundamental rights impact assessment

### Planned ⚪
- [ ] CE marking / EU declaration of conformity (if high-risk classification confirmed)
- [ ] Registration in EU AI Act database (if required)
- [ ] Post-market monitoring plan

---

## Security Certifications

### Completed ✅
- [x] Security Policy published at `/security`
- [x] Responsible disclosure policy (`/.well-known/security.txt`)
- [x] Content Security Policy (CSP) headers
- [x] HSTS with preload
- [x] Anti-adversarial hardening: obfuscation, timing noise, replay protection, hash integrity
- [x] Row-Level Security (RLS) on all Supabase tables
- [x] API key management with per-key permission scopes

### Planned ⚪
- [ ] Third-party penetration test (NCC Group or equivalent) — Q3 2026
  - Estimated cost: €15,000–25,000
  - Scope: API, biometric engine, web application, Supabase configuration
- [ ] ISO 27001 — Q1 2027
  - Estimated cost: €20,000–40,000 (consulting + certification body + audit)
  - Recommended partner: BSI Group, Bureau Veritas, or similar
- [ ] Bug bounty program (HackerOne / Intigriti) — Q4 2026
  - Free tier available on Intigriti for early-stage startups

---

## ENS (Esquema Nacional de Seguridad)

Required for contracts with Spanish public administration, universities, and judiciary.

| Level | Applicable When | Status |
|---|---|---|
| Básico | Low-impact systems | ⚪ Planned |
| Medio | Document forensics for public administration | ⚪ Q2 2027 |
| Alto | Critical infrastructure / justice | ⚪ Future |

**Free resources:**
- CCN-STIC guides: https://www.ccn-cert.cni.es/series-ccn-stic
- INES self-assessment tool: https://ines.ccn.cni.es/ (free)
- Start with INES self-assessment to identify gaps before hiring consultancy

---

## Scientific Validation

### Planned ⚪
- [ ] Independent algorithm validation study (real-world diverse population)
- [ ] Technical paper submission (target: IEEE S&P or USENIX Security)
- [ ] Academic collaboration for dataset validation (UPM / UPC / UAM)
- [ ] Public benchmark results page

**Note on current accuracy claims:** Model performance metrics in the whitepaper are
derived from internal synthetic-data evaluation. Until an independent validation study
is completed, accuracy claims should be stated as "internally evaluated" when
presenting to regulated-sector clients.

---

## Advisory Board (Needed for "Camino Serio")

| Role | Purpose | Typical Equity |
|---|---|---|
| Legal / AI regulation | EU AI Act compliance, DPA negotiations | 0.1–0.25% |
| Technical / Computer Vision | Algorithm credibility, paper co-authorship | 0.1–0.25% |
| Industry / Financial sector | Bank/insurance introductions, CISO credibility | 0.1–0.25% |

**Free path to find advisors:**
- Spanish AI Association (AEIAS)
- RedEmprendia (Ibero-American university network)
- Wayra (Telefónica accelerator — free access to mentor network)
- CDTI contacts (grants can fund advisory relationships)

---

## Free Funding Opportunities (Spain / EU)

| Programme | Amount | What For |
|---|---|---|
| CDTI Neotec | Up to €250,000 | R&D startup funding |
| Horizonte Europa (SME Instrument) | €50k–€2.5M | Tech innovation |
| Next Generation EU / PERTE | Variable | AI/digitisation projects |
| ENISA (European Union Agency for Cybersecurity) | N/A | Free certification guidance |
| Incibe-Cert | Free | Security advisory for Spanish companies |

---

## Free Tools & Resources

| Tool | Purpose | Cost |
|---|---|---|
| AEPD GDD tool | GDPR gap assessment | Free |
| CCN INES | ENS self-assessment | Free |
| NIST AI RMF | AI risk framework | Free |
| OneTrust (free tier) | Consent management, DPIA templates | Free |
| Cookiebot (free tier) | Cookie compliance scanning | Free (up to 100 pages) |
| GitHub Dependabot | Vulnerability scanning | Free |
| OWASP ZAP | Basic penetration testing | Free |

---

*Last updated: February 2026 · Deep-Check Inc.*
*This document is for internal tracking. Do not share publicly without redacting planned timelines.*
