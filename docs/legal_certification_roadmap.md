# Deep-Check Legal Certification Roadmap

**Version:** 1.0 — 2026-04-15
**Purpose:** Complete roadmap to make Deep-Check legally admissible (Spain, EU, USA, NATO).

---

## Executive summary

Deep-Check needs to pass **two independent gauntlets**:

1. **Evidence admissibility** — individual reports must be accepted as expert testimony in court.
2. **Software homologation** — the tool itself needs official certifications to sell to defense, banks, and government.

**What's already implemented (free, in-code)** as of V1:
- ISO/IEC 27037 chain of custody (`src/lib/forensicChain.ts`)
- RFC 3161 timestamp integration (FreeTSA + swappable to qualified TSP)
- UNE 197010 pericial report generator (`src/lib/pericialReport.ts`)
- Public API: `/api/v1/forensic/{ingest,verify,report,export}`
- Append-only SQL table (migration 007) with DB-level immutability triggers

**What costs money** — see §4.

---

## 1. Admissibility (Spain, EU)

### Legal basis
- **LEC Art. 299.2 & 326.3** — medios de prueba electronica; autenticacion por peritaje
- **LEC Art. 335.2** — declaracion de imparcialidad del perito (included in our report generator)
- **eIDAS Regulation (UE) 910/2014 Art. 42** — qualified electronic timestamps
- **LOPD/GDPR** — compliant evidence handling
- **Ley de Firma Electronica 6/2020** — firma electronica cualificada
- **Codigo Penal Art. 459** — delitos contra la administracion de justicia (false peritaje)

### Standards implemented
| Standard | Purpose | Deep-Check implementation |
|----------|---------|---------------------------|
| ISO/IEC 27037:2012 | Identification, collection, acquisition, preservation | `forensicChain.ts` ingest/seal |
| ISO/IEC 27042:2015 | Analysis and interpretation | Documented in `pericialReport.ts` section 3 |
| UNE 71506:2013 | Metodologia de analisis forense | Referenced in report template |
| UNE 197010:2015 | Formato del informe pericial | `generatePericialPDF()` |
| RFC 3161 | Timestamp protocol | `requestTimestamp()` in forensicChain.ts |

### Free actions remaining for admissibility
1. **Register as perito judicial** (individual, free):
   - Submit application to TSJ of your CCAA (Tribunal Superior de Justicia) every January
   - Requires ingeniero informatico colegiado in Colegio Oficial
   - Typical CCAA quota: 50-150 peritos informaticos
   - See: https://www.poderjudicial.es (each TSJ has own form)

2. **Colegiacion** (individual, €150-300/year NOT free but cheapest step):
   - Colegio Profesional de Ingeniera en Informatica de Madrid (CPIIM): €240/year
   - Asociacion Nacional de Tasadores y Peritos Judiciales Informaticos (ANTPJI): €180/year

3. **Publish methodology** (free):
   - Write a paper documenting the Deep-Check forensic methodology
   - Submit to Zenodo for DOI (free)
   - Deposit in HAL / ResearchGate
   - This builds a public record that the tool has a peer-reviewable method

---

## 2. Software Homologation

### Certification ladder (cheapest to most expensive)

#### Tier 1 — Self-declaration + patents (€600 — €3K)
- [ ] **Patent rPPG temporal method** (Spanish OEPM: €600 filing + €400 exam)
- [ ] **Trademark Deep-Check** (EU trademark: €850)
- [ ] **UNE 71506/197010 self-declaration** (free, just state compliance)
- [ ] **OWASP ASVS Level 2 self-assessment** (free)

#### Tier 2 — Basic compliance (€8K — €20K)
- [ ] **ISO/IEC 27001** (SGSI) — €10-20K initial + €3K/year
  - Required for banking, defense, AAPP contracts
  - Providers: AENOR (Spain), BSI, TUV
- [ ] **Esquema Nacional de Seguridad (ENS) nivel alto** — €8-15K
  - Required for Spanish public admin contracts
  - Via certified empresa auditora

#### Tier 3 — Biometric / PAD (€15K — €40K)
- [ ] **iBeta PAD Level 1** — ~€15K
  - Industry standard for presentation attack detection
  - 6-8 week turnaround
- [ ] **iBeta PAD Level 2** — ~€25K
  - Apple Face ID / Samsung Pass level
- [ ] **NIST FATE PAD submission** — €0 + SDK work (~2 months dev)
  - Free submission but months of SDK preparation
  - Gold standard for facial biometric software
  - Already in V10 roadmap

#### Tier 4 — Accredited lab (€15K — €30K + €5K/year)
- [ ] **ISO/IEC 17025** via ENAC — €15-30K initial + €5K/year
  - Makes Deep-Check a "laboratorio de ensayo oficial"
  - Results become legally official without further validation
  - 8-12 month process

#### Tier 5 — Defense/NATO (€40K — €150K)
- [ ] **CCN-STIC (CCN-CERT)** — free but 12-18 months of work
  - Spanish defense/intelligence homologation
- [ ] **Common Criteria EAL4+** — €40-80K
  - EU+NATO military/government gold standard
  - Opens defense export market
- [ ] **FIPS 140-3** (if cryptographic module) — €30-60K
  - US federal government requirement

---

## 3. Recommended sequencing (12 months)

### Months 1-2: Foundation (free + €600)
- [x] Implement chain of custody module
- [x] Implement UNE 197010 report generator
- [x] Implement forensic API endpoints
- [ ] File patent on rPPG temporal method (€600 Spain)
- [ ] Register as perito judicial in TSJ Madrid (free)
- [ ] Join CPIIM colegio (€240)
- [ ] Publish methodology paper on Zenodo (free)

**Outcome:** Can start charging for forensic reports in Spain.

### Months 3-6: Credibility (€15K)
- [ ] Start ISO/IEC 27001 engagement (€15K)
- [ ] Apply for ENS Alto certification
- [ ] Begin NIST FATE PAD SDK preparation

**Outcome:** Credible for mid-market enterprise sales.

### Months 6-9: Biometric gold standard (€15K + €25K)
- [ ] iBeta PAD Level 1 test (€15K)
- [ ] Submit to NIST FATE PAD (free)
- [ ] Start ENAC ISO/IEC 17025 (€15K initial)

**Outcome:** Credible for banking KYC, major enterprise.

### Months 9-12: Defense-ready (€50K-100K)
- [ ] iBeta PAD Level 2 (€25K)
- [ ] Complete ENAC 17025 (€10K remaining + €5K/year)
- [ ] Begin Common Criteria EAL4+ preparation (€40-80K)
- [ ] CCN-STIC submission (free, long)

**Outcome:** Can sell to Rafael, Airbus Defence, Indra defense division.

---

## 4. Total financial investment

| Phase | Months | Cash out | Time commitment |
|-------|--------|----------|-----------------|
| Free foundation | 1-2 | €600 (patent) + €240 (colegio) = **€840** | 40-80h |
| Credibility | 3-6 | **€15,000** | 60-100h |
| Biometric | 6-9 | **€40,000** | 80-120h |
| Defense | 9-12 | **€55,000 — €105,000** | 100-150h |
| **Year 1 total** | 12 | **€111K — €161K** | 280-450h |
| **Year 2+ maintenance** | annual | **€13K/year** (recertifications) | 20-40h/year |

### Minimum viable legal posture (€840)

If budget is tight, the free+patent tier is enough to:
- Start facturing peritajes judiciales
- Use Deep-Check reports in Spanish courts
- License the patent to competitors
- Build brand credibility

Everything above that tier is for sales expansion, not legal admissibility.

---

## 5. How an informe pericial flows through Deep-Check

```
        Client (lawyer, judge, enterprise)
                    |
                    v
   POST /api/v1/forensic/ingest   (upload evidence)
                    |  chainId generated
                    v
   POST /api/v1/detect            (run ML analysis)
                    |  chain entry appended
                    v
   POST /api/v1/forensic/report   (perito fills interpretation, chain sealed)
                    |
                    v
        Signed PDF (UNE 197010 format)
                    |
                    +----->  Court (original)
                    |
                    +----->  Opposing counsel / auditor
                            |
                            v
          GET /api/v1/forensic/verify?chainId=XXX
                            |
                            v
                 Independent cryptographic validation
                 of every chain link (free, public)
```

---

## 6. Contact checklist (who to call, what to ask)

Reference calls to make when starting:

1. **CPIIM (Colegio Oficial de Ingenieros Informaticos Madrid)**
   - Email: secretaria@cpiim.es
   - Ask: "Quiero colegiarme como ingeniero informatico para ejercer peritaje judicial"
   - Cost: €240/year

2. **TSJ Madrid — Peritos judiciales**
   - Website: https://www.poderjudicial.es (find "listas de peritos")
   - Ask: Next enrollment window (usually November-January)
   - Cost: free

3. **AENOR (ISO 27001 certification)**
   - https://www.aenor.com
   - Ask: "Presupuesto para certificacion ISO/IEC 27001 de empresa SaaS con 1 producto"
   - Cost: €10-20K

4. **ENAC (ISO 17025 lab accreditation)**
   - https://www.enac.es
   - Ask: "Proceso para acreditar laboratorio de ensayo de analisis forense informatico"
   - Cost: €15-30K + annual €5K

5. **CCN-CERT (defense homologation)**
   - ccn-cert@cni.es
   - Ask: "Procedimiento para inclusion en catalogo CCN-STIC de producto IA forense"
   - Cost: free but 12-18 months

6. **iBeta Quality Assurance (biometric PAD)**
   - https://ibeta.com
   - Ask: "PAD Level 1 testing quote for video deepfake detection"
   - Cost: €15K

7. **Spanish Patent Office (OEPM)**
   - https://www.oepm.es
   - Apply: rPPG temporal method invention
   - Cost: €600 filing + €400 exam

8. **Qualified TSP providers (for eIDAS-qualified timestamps)**
   - Uanataca: https://www.uanataca.com
   - Firmaprofesional: https://www.firmaprofesional.com
   - FNMT-RCM: https://www.sede.fnmt.gob.es
   - Cost: ~€100-500/year flat, or €0.05-0.10 per timestamp

---

## 7. What Deep-Check cannot do and never should

To protect admissibility and avoid legal liability:

- Deep-Check does **not** produce a final judgement, only evidence. The perito (human expert) must interpret.
- Deep-Check does **not** certify cadena de custodia for evidence it did not ingest. Chain must start at `/ingest`.
- Deep-Check does **not** replace colegiacion — a report is only pericial if signed by a colegiado.
- Deep-Check does **not** bypass TSA — if `TSA_REQUIRED=true` and TSA fails, ingest must error.
- Deep-Check does **not** decrypt encrypted evidence — only works with plaintext media.

---

*This roadmap is a living document. Update after each certification milestone.*
