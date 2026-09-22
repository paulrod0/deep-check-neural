# Deep-Check — Free Legal Actions Checklist

Action items that cost ZERO or near-zero money but unlock legal standing.
Prioritized by impact / effort ratio.

---

## 1. This week (~0 euro, 4 hours total)

### 1.1 Register as perito judicial in TSJ Madrid

- [ ] Go to https://www.poderjudicial.es
- [ ] Search "Listas de peritos TSJ Madrid Informatica"
- [ ] Download form DL-4 (Designacion de Peritos)
- [ ] Fill: nombre, DNI, titulacion (CS50 Harvard counts as formacion complementaria;
      main titulacion must be an official Spanish degree)
- [ ] **BLOCKER:** colegiacion first (see 1.2)

**Outcome:** Once colegiado + registered, you appear in the official list
that judges choose from. Average paid peritaje: €600-1500 each.

### 1.2 Colegiacion ingeniero informatico (FIRST unblocker)

Pablo — **this is the single most important step**. Without it you cannot
file peritajes legally.

- [ ] Email **secretaria@cpiim.es** (Colegio Prof. Ing. Informatica Madrid):
  - Subject: "Solicitud de colegiacion ingeniero informatico"
  - Adjuntar: titulo universitario, DNI, CV
  - Cost: €240/year

- [ ] Alternatively, **ANTPJI** (Asociacion Nacional Tasadores Peritos Jud. Inform.)
  - Website: https://www.antpji.com
  - Cost: €180/year
  - Easier admission but less prestige

**Outcome:** Can sign informes periciales legally in Spain.

### 1.3 Zenodo publication of methodology

- [ ] Create Zenodo account (free): https://zenodo.org/signup
- [ ] Publish a 6-8 page whitepaper: "Deep-Check: Multi-Layer Forensic Methodology for AI-Generated Content Detection"
  - Include: ISO/IEC 27037/27042 alignment, UNE compliance, chain of custody architecture
  - Gets a DOI (free)
  - **Important:** do NOT include rPPG details until patent is filed

**Outcome:** Public reference that validates the methodology. Peers can
review. Ammunition against plagiarism. Cites in future papers.

### 1.4 Trademark Deep-Check (EU)

Not free but cheap. €850 gives EU-wide trademark for 10 years.
- [ ] EUIPO: https://euipo.europa.eu (fast-track application)

---

## 2. Next 2-4 weeks (~0 euro, 10-20 hours)

### 2.1 OpenCERT self-declaration for ENS

- [ ] Download ENS self-assessment form: https://www.ccn-cert.cni.es/
- [ ] Fill out (covers 75+ controls)
- [ ] Self-publish on website: `/security/ens-declaration.pdf`

**Why free:** Self-declaration is legally valid for low-level public contracts.
Full ENS certification costs money; self-declaration doesn't.

### 2.2 ISO/IEC 27001 self-declaration (Appendix A gap analysis)

- [ ] Fill out Annex A checklist (114 controls)
- [ ] Publish statement: "Deep-Check operates an ISMS aligned with ISO/IEC 27001:2022"
- [ ] Detail what's implemented vs what's pending
- [ ] Include on `/trust` page of website

**Why this matters:** Many tenders accept self-declaration as MVP until
certification is obtained.

### 2.3 SOC 2 Type I readiness

- [ ] Use free tool: https://www.vanta.com/soc2 (7-day trial)
- [ ] Run automated gap analysis on Deep-Check infrastructure
- [ ] Document results in `/docs/soc2_gap.md`

### 2.4 GDPR DPIA (Data Protection Impact Assessment)

- [ ] Draft DPIA document (template from AEPD website)
- [ ] Cover: biometric data handling (rPPG is sensitive), video processing,
      retention, cross-border transfers, DSAR workflow
- [ ] Publish redacted version on website

**Outcome:** Required by GDPR Art. 35 for biometric processing. Having
this public is a competitive differentiator.

---

## 3. Next 1-3 months (~€1000 max)

### 3.1 Patent rPPG method (Spanish OEPM)

- [ ] Use draft in `docs/patent_rppg_draft.md`
- [ ] One 30-min consult with patent attorney (many offer free first consult)
- [ ] File via https://tramites.oepm.es
- [ ] Cost: €600 filing + €400 exam = €1000 total over 18 months
- [ ] **CRITICAL:** do NOT publicly discuss rPPG details before filing

### 3.2 CCN-CERT catalog application (free)

- [ ] Apply for CCN-STIC-105 listing: https://www.ccn-cert.cni.es/
- [ ] Submit Deep-Check as "producto IA forense" candidate
- [ ] Free evaluation (12-18 month queue though)

### 3.3 NIST CVE disclosure policy

- [ ] Publish `security.txt` (already exists!) with PGP key
- [ ] Register as CNA (CVE Numbering Authority) — free
- [ ] Shows security maturity

### 3.4 OWASP ASVS Level 2 verification

- [ ] Run ASVS checklist (self-performed): https://owasp.org/asvs
- [ ] Publish results on trust page

### 3.5 Bug bounty program on Hackrone / Intigriti

- [ ] Free to register (pay only for bounties awarded)
- [ ] Shows mature security posture
- [ ] €0 if no bugs found

### 3.6 Scientific publications

- [ ] Submit paper to ArXiv (free): deepfake detection methodology
- [ ] Target venues (if journal submission): Forensic Science International:
      Digital Investigation (Elsevier, open access optional)
- [ ] Conferences (free for poster): NIST FATE workshop, BIOSIG, ACM WIFS

---

## 4. Reputation + distribution (free)

### 4.1 Apply to join official consortiums

- [ ] **GAIA-X** (EU data sovereignty) - https://gaia-x.eu
- [ ] **European AI Alliance** - https://ec.europa.eu
- [ ] **CEN/CENELEC JTC 21** (AI standards body)
- [ ] **ISO/IEC JTC 1/SC 37** (biometrics standardization) — observer status free

### 4.2 Press + analyst briefings (free)

- [ ] Brief Gartner/Forrester analyst in "Identity Verification" track
- [ ] Brief tech journalists: El Pais Tecnologia, Xataka, TechCrunch Spain
- [ ] Pitch to Deloitte Future of Trust report

### 4.3 Government programs (grant eligibility unlocked)

- [ ] Register in CDTI ("Centro Desarrollo Tecnologico Industrial") - free
- [ ] Apply to CDTI NEOTEC grants (up to €250K for AI R&D)
- [ ] Apply to Red.es programs for AI cybersecurity
- [ ] Horizon Europe cluster 3 (civil security for society) - grants up to €10M

**Outcome:** €100K-500K in grants possible. 3-6 month cycles.

---

## 5. Legal checkpoints (consult free with bar association)

### 5.1 Colegio de Abogados free legal consultation

- [ ] ICAM (Madrid): https://www.icam.es offers free 30-min consultations
- [ ] Ask:
  1. "Can Deep-Check output be admitted as pericial if chain verified?"
  2. "What disclaimer text should the report include?"
  3. "Liability exposure if AI gives wrong verdict?"

### 5.2 AEPD consultation (data protection)

- [ ] Free written consultations: https://www.aepd.es
- [ ] Ask: "Is Deep-Check rPPG processing biometric data per Art. 9 GDPR?"
- [ ] Get written response — use in privacy policy

### 5.3 CNIL (France) equivalent consultation

Free for EU-wide scope. Useful if selling beyond Spain.

---

## 6. Distribution in expert networks (free)

- [ ] List Deep-Check on **Red Peritos** (peritos.org): free profile
- [ ] List on **ANTPJI** directory after membership
- [ ] Contribute code to **OSF (Open Science Framework)** — free, prestige
- [ ] Get listed on **NIST CVP** (cryptographic validation program) if crypto components

---

## Prioritized TODAY list

If you only do 3 things this week:

1. [ ] **Email CPIIM for colegiacion** (unblocks everything downstream)
2. [ ] **Publish trust page with ISO 27001 / ENS self-declarations**
3. [ ] **Draft the Zenodo paper** (4-6 hours) — builds public credibility

Cost of doing these 3: **~€240** (CPIIM) + your time.

---

## Total "free tier" investment

| Item | Cost | Time |
|------|------|------|
| Colegiacion CPIIM | €240/year | 2h application |
| Registro perito judicial | €0 | 2h form |
| Zenodo paper | €0 | 6h writing |
| ENS self-declaration | €0 | 4h |
| ISO 27001 self-assessment | €0 | 8h |
| GDPR DPIA | €0 | 6h |
| CVE CNA registration | €0 | 1h |
| OWASP ASVS self-check | €0 | 4h |
| Patent rPPG (OEPM) | €1000 | 20h |
| EU Trademark (EUIPO) | €850 | 2h |
| **TOTAL FIRST YEAR** | **€2090** | **55h** |

For about €2K + 1.5 work weeks spread over 3 months, you can have:
- Colegiacion active (legal peritaje)
- Patent filed (rPPG protected)
- EU trademark (brand protected)
- Published methodology (academic credibility)
- Self-declarations for ISO 27001 + ENS (tender eligibility)
- CCN-CERT application in queue (defense pipeline opens)
- GDPR + CVE + ASVS published (enterprise checklist passed)

**This is enough to start selling legally-admissible forensic reports in
Spain and win low-to-mid tender competitions.**
