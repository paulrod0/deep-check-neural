# Veritas Engine v3 — Full Integration Design
**Date:** 2026-03-09
**Scope:** DB → API → UI → Whitepaper

## Context

Veritas Engine v3 was implemented in `src/lib/imageForensics.ts` + `src/lib/forensicsCore.ts` (commit `d704274`). It introduces 6 forensic signals and a Bayesian combiner, but none of the new fields are persisted or displayed — the rest of the product still uses the v2 (3-signal weighted-sum) model.

## Changes Required

### 1. DB Migration
Add 6 columns to `dc_document_analyses`:
- `dct_score INTEGER DEFAULT 0` — double-JPEG / DCT periodicity
- `chroma_score INTEGER DEFAULT 0` — RGB correlation, kurtosis, saturation entropy
- `edge_score INTEGER DEFAULT 0` — Sobel regional analysis, KL-divergence
- `manipulation_prob REAL DEFAULT 0` — Bayesian posterior P(manipulated) 0–1
- `confidence_level REAL DEFAULT 0` — signal agreement ratio 0–1
- `signals_above_thresh INTEGER DEFAULT 0` — count of signals exceeding threshold

### 2. API `/api/documents` POST
Accept new fields from body (`dctScore`, `chromaScore`, `edgeScore`, `manipulationProb`, `confidenceLevel`, `signalsAboveThresh`) and persist to DB.

### 3. `documents/[id]/page.tsx` — server component (report view)
- `getAnalysis()` SELECT expanded with new columns
- Score grid: 3 → 6 meters (add DCT, Edge, Chroma)
- New Bayesian banner block (above grid): manipulation probability %, confidence level, signals N/6
- XAI section: explanations for DCT, Edge, Chroma
- `cleanBanner`: updated copy mentioning all 6 signals

### 4. `documents/page.tsx` — client component (analysis + save)
- POST body expanded: add `dctScore`, `chromaScore`, `edgeScore`, `manipulationProb`, `confidenceLevel`, `signalsAboveThresh` from `ForensicsReport`
- Progress bar: 6 steps → 7 steps (ELA, EXIF, Ruido, DCT, Edge, Chroma, Score)

### 5. Whitepaper (`src/app/whitepaper/page.tsx`)
Replace v2 linear formula with Bayesian combiner description:
- Log-likelihood ratio per signal (Gaussian model)
- Conservative prior P(manipulated) = 0.05
- False-positive gate: ≥2 signals must exceed threshold

## Success Criteria
- New analyses save all 6 v3 signals to DB
- Report page displays 6-signal grid + Bayesian banner
- Existing analyses (missing new columns) degrade gracefully (show 0 / "N/A")
- Whitepaper reflects v3 methodology
