# Deep-Check · Pre-seed Pitch Deck

**Fuente de texto para el deck — 10 slides.**
Formato verbal: claro, sin jerga innecesaria, números concretos.

---

## Slide 1 — Cover

**DEEP-CHECK**
Forensic AI against deepfakes, fake identities and document fraud

Pre-seed round · Q2 2026
Pablo López Rodríguez · Founder & CEO
pablo.lprdz@gmail.com · +34 690 906 834
https://deep-check-two.vercel.app

---

## Slide 2 — Problem

**Digital identity fraud is exploding — nobody is prepared**

- **£20M stolen** from Arup in Feb 2024 through deepfake video calls
- **+30% year-on-year** growth in synthetic identity fraud across EU banking
- **10-15% of insurance claims** include manipulated photos (average across European insurers)
- **1 in 5 LinkedIn profiles** contains some fabricated credential
- **Generative AI tools** (Sora 2, Flux, Midjourney) produce imagery indistinguishable from real to the human eye

Traditional KYC, forensic experts and compliance teams are overwhelmed. The tools they use were designed before generative AI existed.

**Manual verification does not scale. Adversarial generators evolve monthly. Regulation demands automated detection.**

---

## Slide 3 — Solution

**Deep-Check is the forensic layer for the AI-fraud era**

One platform that verifies authenticity across four vectors:

1. **Video** — detects deepfakes, face-swaps, AI-synthesized faces (even in live video calls)
2. **Image** — detects AI-generated content from SDXL, Flux, Sora, Midjourney, DALL-E
3. **Documents** — detects splicing, copy-move, inpainting, MRZ alteration, tampered amounts/signatures
4. **Behavioural identity** — keystroke dynamics identify whether an operator is the legitimate person, a bot, or an impersonator

Each verification is accompanied by a **cryptographically signed forensic report** (ISO/IEC 27037, eIDAS RFC 3161 timestamping) admissible as legal evidence.

Privacy-by-design: biometric analysis runs **in-browser** via WebAssembly ONNX. Biometric data never leaves the user's device.

---

## Slide 4 — Product

**Live product, not a slide deck**

🌐 https://deep-check-two.vercel.app

Architecture overview:

```
                        [ Frontend Next.js · Vercel EU ]
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          ▼                         ▼                         ▼
[ Video Pipeline ]        [ Document Pipeline ]    [ Identity Pipeline ]
V10 VideoMAE-L 304M       DINOv2 + ELA 305M        Keystroke Transformer
AUC 0.98 · 98ms p95       AUC 0.958 · 16ms         128-D embeddings
                                                   + Qwen 2.5 3B semantic
          │                         │                         │
          └─────────────────────────┼─────────────────────────┘
                                    ▼
              [ Append-only cryptographic chain of custody ]
                      ISO/IEC 27037 + RFC 3161 TSA
```

**Deployed in production on AWS eu-west-1 and Vercel EU. 213,000 lines of code. 197 commits since Feb 2026. No external ML model dependencies — all models trained in-house.**

---

## Slide 5 — Traction

**Real revenue and validated pipeline**

| Metric | Value |
|---|---|
| Product live since | March 2026 |
| Monthly revenue (3-month avg) | 3,200 € · growing at +50 % MoM |
| Signed annual contract | Yes, recurring client |
| Code base | 213 k LOC, 197 commits, 9 branches |
| Trained models (production) | 9 (video, image, document, keystroke, semantic) |

**Pipeline in negotiation (verified, not signed):**

- **IE University** — institutional license under internal evaluation (100 k€ ticket potential, pilot 6-15 k€). Email trail with academic committee, 4 stakeholders CC'd.
- **Corporate Enterprise client (Zeus, sector confidential)** — technical POC advanced phase, 8-40 k€ ticket.
- **EUS Energía** — tailored identity-verification app project under discussion, 10-30 k€ project or recurring subscription.

---

## Slide 6 — Market

**Explosive market driven by AI proliferation and regulation**

- **Deepfake detection market**: 1.5 B$ in 2025 → 15 B$ in 2030 (MarketsandMarkets, CAGR 42%)
- **Identity verification market**: 11 B$ in 2025 → 30 B$ in 2030
- **Document fraud detection**: segment within above, ~4 B$ by 2028

**Regulatory tailwind (EU AI Act, Art. 50)**: From August 2026 onwards, companies are required to detect and label synthetic content. Non-compliance penalties up to **3% of global turnover**.

**Addressable segments in Europe (Year 1-3 focus)**:
- Insurance companies (claim fraud, ID onboarding)
- Banking and fintech (KYC, AML)
- Business schools / universities (curriculum, research)
- Media publishers (fact-checking)
- Forensic laboratories (expert-witness reports)
- Cybersecurity consultancies (resold as embedded capability)

**Total SOM for Spain Y1-Y2**: ~50 M€. We target **0.1% = 500 k€**.

---

## Slide 7 — Business Model

**Multi-tier SaaS + Enterprise licences + regulated services**

| Product | Price | Target |
|---------|------|--------|
| **SaaS Starter** | 29 €/month | Freelance perito, small consultancies |
| **SaaS Pro** | 79 €/month | Mid-size newsrooms, compliance teams |
| **API Enterprise** | 2 000-15 000 €/year | Banks, insurers, integrations |
| **Institutional License** | 20 000-100 000 €/year | Universities, business schools |
| **Forensic Reports** | 200-500 € per report | Court-bound peritaje cases |
| **Workshops (AI Act / Deepfake Detection)** | 1 500-3 000 € per session | Corporate training |

**Gross margin**: ~75% (ML inference on reserved GPU instances, amortized over volume).
**Net margin target Y3**: 35-45%.
**Revenue split Y1 projected**: 20% SaaS + 40% Enterprise + 25% Institutional + 15% services.

---

## Slide 8 — Competition

| Solution | Limitation vs Deep-Check |
|----------|--------------------------|
| **Microsoft Video Authenticator** | Image-only. No video. No documents. No traceability. |
| **Sensity AI** | Face deepfakes only. No document forensics. No EU-compliant infra. |
| **Truepic** | Capture-time authentication (requires their camera). Cannot analyse existing content. |
| **Reality Defender** | Cloud-only API. No on-prem. No native EU privacy stance. |
| **FacePhi** | Biometric identity only. Not forensic, not multi-modal. |

**Deep-Check's defensible moat**:

1. **Multi-vector coverage** in a single platform (video + image + document + behavioural + semantic)
2. **Cryptographic traceability** natively — nobody else ships forensic reports that a judge can sign off on
3. **Privacy-by-design**: biometric inference in-browser (GDPR + AI Act aligned by default)
4. **EU-native infrastructure** (AWS eu-west-1 + Vercel EU). Clients don't need to worry about transatlantic data transfers.
5. **Own models, not reseller**: 9 trained models, 213 k LOC of custom code. No vendor lock-in upstream.

---

## Slide 9 — Team & Execution

**Pablo López Rodríguez**, Founder & CEO
- Data / ML Engineer, 6+ years full-stack including production ML pipelines
- Solo-built Deep-Check product + infrastructure + models in 15 months
- Based in Madrid, full-time dedicated to Deep-Check

**Key execution facts**:
- 197 commits pushed as sole contributor
- 9 ML models trained end-to-end
- 2 certification processes in progress (ISO/IEC 27001, ENS-Media)
- Active fundraising pipeline + sales pipeline + product roadmap simultaneously

**Advisors / supporters identified (pending formalization)**:
- Fundación Don Bosco (emprendimiento, mentoring)
- Madrid Emprende (business development)
- Academic contact at IE University (product validation)

**Next key hire (month 3 post-funding)**: 1× ML engineer (part-time) focused on iterating models against new generative adversaries.

---

## Slide 10 — The Ask

**Raising 120 000 € pre-seed · 12% equity · 18-month runway**

**Post-money valuation**: 1.0 M€ (defensible given real MRR + pipeline + IP)

**Use of funds**:

| Concept | Amount | Why it matters |
|---------|-------:|----------------|
| ISO/IEC 27001 + ENS-Media certifications | 25 000 € | Unlocks banking / public sector sales |
| Marketing B2B (insurance, banking) | 20 000 € | Targeted content + paid ads + events |
| Part-time ML engineer (12 months) | 35 000 € | Double model-iteration velocity |
| Infrastructure AWS / Vercel (18 months) | 12 000 € | Reserved GPU instances, scale with clients |
| Legal (DPIA, terms, enterprise contracts) | 8 000 € | Frictionless enterprise onboarding |
| Salary founder (below-market, 12 months) | 18 000 € | Sustainable dedication without distraction |
| Buffer / operations | 2 000 € | — |

**Milestones with this round**:
- **Month 6**: 5+ paying enterprise clients, 15 000 €+ MRR
- **Month 12**: ISO/ENS certifications closed, 30 000 €+ MRR, AI Act enforcement live in EU
- **Month 18**: Ready for seed Series A (500 k-1 M€) with 50 000 €+ MRR and certified client base

**Contact**: pablo.lprdz@gmail.com · +34 690 906 834
