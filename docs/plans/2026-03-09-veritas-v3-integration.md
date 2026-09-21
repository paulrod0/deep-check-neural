# Veritas Engine v3 — Full Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate the Veritas Engine v3 (6 forensic signals + Bayesian combiner) end-to-end: DB → API → UI report → UI analysis → Whitepaper.

**Architecture:** The engine already runs client-side and returns a `ForensicsReport` with v3 fields (`dctScore`, `chromaScore`, `edgeScore`, `manipulationProb`, `confidenceLevel`, `signalsAboveThresh`). We need to (1) persist them to Supabase, (2) display them in the report page, (3) send them from the analysis page, and (4) update the whitepaper.

**Tech Stack:** Next.js 15 App Router, Supabase (project `afsmlmpijjapkzdlrhhd`), TypeScript, CSS Modules.

---

## Task 1: DB Migration — add 6 v3 columns

**Files:**
- No file changes — executed via Supabase MCP

**Step 1: Run migration via Supabase MCP**

```sql
ALTER TABLE dc_document_analyses
  ADD COLUMN IF NOT EXISTS dct_score          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chroma_score       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS edge_score         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manipulation_prob  REAL    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confidence_level   REAL    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS signals_above_thresh INTEGER NOT NULL DEFAULT 0;
```

**Step 2: Verify**

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'dc_document_analyses'
  AND column_name IN ('dct_score','chroma_score','edge_score','manipulation_prob','confidence_level','signals_above_thresh');
```

Expected: 6 rows returned.

---

## Task 2: API — accept and persist v3 fields

**Files:**
- Modify: `src/app/api/documents/route.ts`

**Step 1: Expand destructuring** (after `noiseScore` line ~42)

Replace:
```ts
const {
    filename, fileSize, mimeType,
    riskScore, riskLevel,
    elaScore, exifScore, noiseScore,
    alerts, exifData, findings,
    thumbnailUrl, elaImageUrl,
    caseRef, submittedBy, notes,
} = body
```

With:
```ts
const {
    filename, fileSize, mimeType,
    riskScore, riskLevel,
    elaScore, exifScore, noiseScore,
    dctScore, chromaScore, edgeScore,
    manipulationProb, confidenceLevel, signalsAboveThresh,
    alerts, exifData, findings,
    thumbnailUrl, elaImageUrl,
    caseRef, submittedBy, notes,
} = body
```

**Step 2: Expand the Supabase INSERT** (inside `.insert({...})`)

Add after `noise_score: noiseScore ?? 0,`:
```ts
dct_score:             dctScore             ?? 0,
chroma_score:          chromaScore          ?? 0,
edge_score:            edgeScore            ?? 0,
manipulation_prob:     manipulationProb     ?? 0,
confidence_level:      confidenceLevel      ?? 0,
signals_above_thresh:  signalsAboveThresh   ?? 0,
```

**Step 3: Commit**
```bash
git add src/app/api/documents/route.ts
git commit -m "feat(api): persist Veritas v3 signals to DB"
```

---

## Task 3: Report page — types, query, UI

**Files:**
- Modify: `src/app/documents/[id]/page.tsx`

### Step 1: Expand `DocumentAnalysis` interface

After `noise_score: number` add:
```ts
dct_score:              number
chroma_score:           number
edge_score:             number
manipulation_prob:      number
confidence_level:       number
signals_above_thresh:   number
```

### Step 2: Update `ScoreMeter` to accept optional icon prop

Replace the `ScoreMeter` function with:
```tsx
function ScoreMeter({ label, score, detail, icon }: { label: string; score: number; detail: string; icon?: string }) {
    const color = score >= 60 ? '#ff4444' : score >= 30 ? '#ffaa00' : '#00ff9d'
    return (
        <div className={styles.meter}>
            <div className={styles.meterHeader}>
                <span className={styles.meterLabel}>{icon && <span style={{ marginRight: 6 }}>{icon}</span>}{label}</span>
                <span className={styles.meterScore} style={{ color }}>{score}</span>
            </div>
            <div className={styles.meterBar}>
                <div className={styles.meterFill} style={{ width: `${score}%`, background: color }} />
            </div>
            <p className={styles.meterDetail}>{detail}</p>
        </div>
    )
}
```

### Step 3: Add `BayesianBanner` component (after ScoreMeter, before DocumentReportPage)

```tsx
function BayesianBanner({ prob, confidence, signals }: { prob: number; confidence: number; signals: number }) {
    const pct = Math.round(prob * 100)
    const confPct = Math.round(confidence * 100)
    const color = pct >= 60 ? '#ff4444' : pct >= 30 ? '#ffaa00' : '#00ff9d'
    return (
        <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12,
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12, padding: '16px 20px', marginBottom: 16,
        }}>
            <div style={{ textAlign: 'center' }}>
                <p style={{ margin: 0, fontSize: 11, color: '#888', letterSpacing: 1, textTransform: 'uppercase' }}>Prob. Manipulación</p>
                <p style={{ margin: '4px 0 0', fontSize: 28, fontWeight: 700, color }}>{pct}%</p>
                <p style={{ margin: 0, fontSize: 10, color: '#666' }}>Bayesian posterior</p>
            </div>
            <div style={{ textAlign: 'center', borderLeft: '1px solid rgba(255,255,255,0.08)', borderRight: '1px solid rgba(255,255,255,0.08)' }}>
                <p style={{ margin: 0, fontSize: 11, color: '#888', letterSpacing: 1, textTransform: 'uppercase' }}>Confianza</p>
                <p style={{ margin: '4px 0 0', fontSize: 28, fontWeight: 700, color: '#e0e0e0' }}>{confPct}%</p>
                <p style={{ margin: 0, fontSize: 10, color: '#666' }}>acuerdo de señales</p>
            </div>
            <div style={{ textAlign: 'center' }}>
                <p style={{ margin: 0, fontSize: 11, color: '#888', letterSpacing: 1, textTransform: 'uppercase' }}>Señales activas</p>
                <p style={{ margin: '4px 0 0', fontSize: 28, fontWeight: 700, color: signals >= 2 ? color : '#e0e0e0' }}>{signals}<span style={{ fontSize: 16, fontWeight: 400, color: '#666' }}>/6</span></p>
                <p style={{ margin: 0, fontSize: 10, color: '#666' }}>superan umbral</p>
            </div>
        </div>
    )
}
```

### Step 4: Replace score breakdown section in JSX

Find the `{/* Score breakdown */}` section and replace the inner content:

```tsx
{/* Score breakdown */}
<div className={styles.section}>
    <h2 className={styles.sectionTitle}>Desglose de señales — Veritas Engine v3</h2>
    <BayesianBanner
        prob={doc.manipulation_prob}
        confidence={doc.confidence_level}
        signals={doc.signals_above_thresh}
    />
    <div className={styles.metersGrid}>
        <ScoreMeter
            icon="🔬"
            label="ELA — Análisis de nivel de error"
            score={doc.ela_score}
            detail={
                doc.findings?.ela
                    ? `${doc.findings.ela.suspiciousRegions} bloques sospechosos · diferencia media: ${doc.findings.ela.meanDiff.toFixed(1)}`
                    : 'Análisis de artefactos de compresión JPEG'
            }
        />
        <ScoreMeter
            icon="🏷️"
            label="EXIF — Anomalías en metadatos"
            score={doc.exif_score}
            detail={
                doc.findings?.exif?.flags?.length
                    ? `Indicadores: ${doc.findings.exif.flags.join(', ')}`
                    : 'Sin anomalías en metadatos'
            }
        />
        <ScoreMeter
            icon="📡"
            label="PRNU — Firma de ruido del sensor"
            score={doc.noise_score}
            detail={
                doc.findings?.noise
                    ? `Uniformidad: ${(doc.findings.noise.uniformityScore * 100).toFixed(0)}% · Varianza Laplaciana: ${doc.findings.noise.laplacianVariance.toFixed(1)}`
                    : 'Análisis de distribución de ruido'
            }
        />
        <ScoreMeter
            icon="📐"
            label="DCT — Detección de doble JPEG"
            score={doc.dct_score}
            detail="Analiza periodicidad en coeficientes DCT — indica recompresión de regiones editadas"
        />
        <ScoreMeter
            icon="✂️"
            label="Edge — Estadísticas de contornos"
            score={doc.edge_score}
            detail="Divergencia KL de distribución de ángulos Sobel por región — detecta inconsistencias de bordes"
        />
        <ScoreMeter
            icon="🎨"
            label="Chroma — Análisis cromático"
            score={doc.chroma_score}
            detail="Correlación RGB, kurtosis y entropía de saturación — detecta paletas sintéticas"
        />
    </div>
</div>
```

### Step 5: Update `cleanBanner` text

Replace:
```tsx
<p className={styles.cleanDetail}>ELA, EXIF y análisis de ruido no detectaron anomalías significativas.</p>
```
With:
```tsx
<p className={styles.cleanDetail}>Las 6 señales del Veritas Engine v3 (ELA, EXIF, PRNU, DCT, Edge, Chroma) no detectaron anomalías. Probabilidad de manipulación Bayesiana: {Math.round(doc.manipulation_prob * 100)}%.</p>
```

### Step 6: Add v3 XAI entries in the XAI section

After the existing ELA XAI block, add before the closing `</div>` of the XAI grid:

```tsx
{/* DCT XAI */}
{doc.dct_score > 0 && (
    <div style={{ padding: '12px 16px', background: doc.dct_score >= 60 ? 'rgba(255,68,68,0.07)' : 'rgba(255,255,255,0.03)', border: `1px solid ${doc.dct_score >= 60 ? 'rgba(255,68,68,0.3)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 8 }}>
        <p style={{ margin: 0, fontSize: 12, color: doc.dct_score >= 60 ? '#ff4444' : '#888', fontWeight: 700, letterSpacing: 1 }}>ANÁLISIS DCT — DOBLE JPEG</p>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#c0c0c0' }}>
            {doc.dct_score >= 60
                ? `Puntuación alta (${doc.dct_score}/100): se detectó periodicidad anómala en los coeficientes DCT. Las regiones editadas en un editor externo y re-guardadas como JPEG generan una "firma fantasma" de la cuantización previa, visible en el espectro de frecuencias.`
                : `Puntuación baja (${doc.dct_score}/100): el espectro DCT es consistente con una sola pasada de compresión JPEG.`}
        </p>
    </div>
)}

{/* Edge XAI */}
{doc.edge_score > 0 && (
    <div style={{ padding: '12px 16px', background: doc.edge_score >= 60 ? 'rgba(255,68,68,0.07)' : 'rgba(255,255,255,0.03)', border: `1px solid ${doc.edge_score >= 60 ? 'rgba(255,68,68,0.3)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 8 }}>
        <p style={{ margin: 0, fontSize: 12, color: doc.edge_score >= 60 ? '#ff4444' : '#888', fontWeight: 700, letterSpacing: 1 }}>ANÁLISIS DE CONTORNOS (EDGE)</p>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#c0c0c0' }}>
            {doc.edge_score >= 60
                ? `Puntuación alta (${doc.edge_score}/100): divergencia KL elevada entre la distribución de ángulos de contorno de distintas regiones. En imágenes auténticas los bordes siguen patrones estadísticos coherentes; las zonas pegadas presentan firmas angulares distintas.`
                : `Puntuación baja (${doc.edge_score}/100): la distribución de ángulos de contorno es homogénea en toda la imagen.`}
        </p>
    </div>
)}

{/* Chroma XAI */}
{doc.chroma_score > 0 && (
    <div style={{ padding: '12px 16px', background: doc.chroma_score >= 60 ? 'rgba(255,68,68,0.07)' : 'rgba(255,255,255,0.03)', border: `1px solid ${doc.chroma_score >= 60 ? 'rgba(255,68,68,0.3)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 8 }}>
        <p style={{ margin: 0, fontSize: 12, color: doc.chroma_score >= 60 ? '#ff4444' : '#888', fontWeight: 700, letterSpacing: 1 }}>ANÁLISIS CROMÁTICO (CHROMA)</p>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#c0c0c0' }}>
            {doc.chroma_score >= 60
                ? `Puntuación alta (${doc.chroma_score}/100): anomalías en la correlación entre canales RGB, kurtosis elevada o entropía de saturación inusual. Las imágenes generadas por IA o con regiones sintéticas muestran paletas de color estadísticamente distintas a las fotografías reales.`
                : `Puntuación baja (${doc.chroma_score}/100): la distribución cromática es consistente con una imagen fotográfica auténtica.`}
        </p>
    </div>
)}
```

### Step 7: Commit
```bash
git add src/app/documents/[id]/page.tsx
git commit -m "feat(ui): Veritas v3 — 6-signal grid + Bayesian banner + v3 XAI"
```

---

## Task 4: Analysis client page — expand POST body + progress bar

**Files:**
- Modify: `src/app/documents/page.tsx`

### Step 1: Update progress bar steps

Find:
```ts
const steps = ['ELA', 'EXIF', 'Ruido', 'Tipo', 'Clonado', 'Score']
```
Replace with:
```ts
const steps = ['ELA', 'EXIF', 'PRNU', 'DCT', 'Chroma', 'Tipo', 'Clonado', 'Score']
```

### Step 2: Add DCT + Chroma progress steps in `handleAnalysis`

Find in the analysis flow:
```ts
setAnalysisStep('Ruido')
await new Promise(r => setTimeout(r, 150))

setAnalysisStep('Tipo')
```
Replace with:
```ts
setAnalysisStep('PRNU')
await new Promise(r => setTimeout(r, 150))

setAnalysisStep('DCT')
await new Promise(r => setTimeout(r, 100))

setAnalysisStep('Chroma')
await new Promise(r => setTimeout(r, 100))

setAnalysisStep('Tipo')
```

### Step 3: Expand `handleSave` POST body

Find in `handleSave`:
```ts
body: JSON.stringify({
    filename:     file.name,
    fileSize:     file.size,
    mimeType:     file.type,
    riskScore:    report.riskScore,
    riskLevel:    report.riskLevel,
    elaScore:     report.elaScore,
    exifScore:    report.exifScore,
    noiseScore:   report.noiseScore,
    alerts:       report.alerts,
```
Replace with:
```ts
body: JSON.stringify({
    filename:             file.name,
    fileSize:             file.size,
    mimeType:             file.type,
    riskScore:            report.riskScore,
    riskLevel:            report.riskLevel,
    elaScore:             report.elaScore,
    exifScore:            report.exifScore,
    noiseScore:           report.noiseScore,
    dctScore:             report.dctScore             ?? 0,
    chromaScore:          report.chromaScore          ?? 0,
    edgeScore:            report.edgeScore            ?? 0,
    manipulationProb:     report.manipulationProb     ?? 0,
    confidenceLevel:      report.confidenceLevel      ?? 0,
    signalsAboveThresh:   report.signalsAboveThresh   ?? 0,
    alerts:               report.alerts,
```

### Step 4: Commit
```bash
git add src/app/documents/page.tsx
git commit -m "feat(ui): send Veritas v3 fields in analysis POST + 8-step progress"
```

---

## Task 5: Whitepaper — update scoring methodology to v3

**Files:**
- Modify: `src/app/whitepaper/page.tsx`

### Step 1: Replace the section starting at "4.3 Noise Uniformity" through "4.4 Aggregate Risk Score"

Find:
```tsx
<h3>4.3 Noise Uniformity Analysis (AI Image Detection)</h3>
<p>
    Images generated by diffusion models (Stable Diffusion, DALL-E, Midjourney) and
    GAN architectures exhibit characteristically uniform noise distributions. Real
    photographs contain heterogeneous noise from sensor shot noise, JPEG quantisation,
    and scene variation. Deep-Check computes:
</p>
<ul>
    <li><strong>Laplacian variance</strong> — Measures high-frequency content. Low values indicate unnaturally smooth images.</li>
    <li><strong>Block variance coefficient of variation</strong> — Standard deviation of per-16×16-block variance, divided by mean block variance. Real photos: high CV. AI images: low CV (uniform).</li>
</ul>
<div className={wpStyles.formula}>
    <code>noise_score = 0.65 × uniformity_score + 0.35 × laplacian_flag</code>
</div>

<h3>4.4 Aggregate Risk Score</h3>
<div className={wpStyles.formula}>
    <code>risk_score = 0.50 × ela_score + 0.30 × exif_score + 0.20 × noise_score</code>
</div>
<p>Risk levels: 0–29 = Clean · 30–59 = Suspicious · 60–100 = High Risk</p>
```

Replace with:
```tsx
<h3>4.3 PRNU / Noise Residual (AI Image Detection)</h3>
<p>
    Images generated by diffusion models (Stable Diffusion, DALL-E, Midjourney) and
    GAN architectures exhibit characteristically uniform noise distributions. Real
    photographs contain heterogeneous noise from sensor shot noise, JPEG quantisation,
    and scene variation. Deep-Check computes:
</p>
<ul>
    <li><strong>Laplacian variance</strong> — Measures high-frequency content. Low values indicate unnaturally smooth images.</li>
    <li><strong>Residual correlation (PRNU proxy)</strong> — Inter-region Pearson correlation of the Gaussian denoising residual. Authentic images show low cross-region correlation; synthetic images exhibit a spatially uniform residual signature.</li>
    <li><strong>Haar wavelet consistency</strong> — Variance ratio across wavelet sub-bands. Inconsistent ratios indicate patchwork composition.</li>
</ul>
<div className={wpStyles.formula}>
    <code>prnu_score = 0.50 × uniformity + 0.30 × residual_correlation + 0.20 × wavelet_inconsistency</code>
</div>

<h3>4.4 DCT Statistics — Double-JPEG Detection</h3>
<p>
    When a JPEG image is edited and re-saved, the regions that were modified undergo a second round of DCT quantisation.
    This leaves a characteristic periodicity in the DCT coefficient histograms — the so-called "double compression ghost".
    Deep-Check computes the 8×8 block DCT for each luma block and analyses the coefficient variance across blocks,
    flagging anomalous periodicity patterns.
</p>

<h3>4.5 Edge Statistics</h3>
<p>
    Real photographs exhibit statistically consistent edge orientations across similar regions of the scene.
    When a region from a different source image is composited in, its edge angle distribution diverges
    from the surrounding content. Deep-Check computes Sobel gradients per 64×64 region and measures
    KL-divergence between regional angle histograms.
</p>

<h3>4.6 Chroma Analysis</h3>
<p>
    AI-generated images and composited regions exhibit characteristic chromatic anomalies: abnormally high
    RGB inter-channel correlation (colour channels are not independent), elevated saturation kurtosis,
    and reduced saturation entropy. Deep-Check extracts per-channel statistics and combines them into a chroma score.
</p>

<h3>4.7 Bayesian Combiner (Veritas Engine v3)</h3>
<p>
    The six signal scores are combined using a Bayesian framework rather than a fixed weighted sum.
    Each signal <em>s</em> is modelled with Gaussian likelihood under the authentic (H₀) and manipulated (H₁) hypotheses.
    The log-likelihood ratio (LLR) per signal is accumulated, and the posterior probability of manipulation is computed from a conservative prior P(manipulated) = 0.05:
</p>
<div className={wpStyles.formula}>
    <code>LLR = Σ log[ P(s_i | H₁) / P(s_i | H₀) ]</code>
</div>
<div className={wpStyles.formula}>
    <code>P(manipulated | signals) = sigmoid( LLR + log(0.05/0.95) )</code>
</div>
<p>
    A false-positive gate requires at least 2 signals to exceed their respective thresholds before
    the posterior can exceed 50%. This prevents single-signal noise from triggering a high-risk verdict.
    Risk levels: 0–29 = Clean · 30–59 = Suspicious · 60–100 = High Risk.
</p>
```

### Step 2: Commit
```bash
git add src/app/whitepaper/page.tsx
git commit -m "docs(whitepaper): update to Veritas Engine v3 — 6 signals + Bayesian combiner"
```

---

## Task 6: Build verification

**Step 1: Run TypeScript check**
```bash
npm run build 2>&1 | tail -30
```
Expected: `✓ Compiled successfully` — zero type errors.

**Step 2: Manual smoke test**
1. Open `http://localhost:3000/documents`
2. Drop a JPEG → verify progress bar shows 8 steps (ELA, EXIF, PRNU, DCT, Chroma, Tipo, Clonado, Score)
3. Save the analysis → verify no 400/500 errors in console
4. Open the saved report → verify 6-signal grid and Bayesian banner render correctly
5. Open `http://localhost:3000/whitepaper` → verify v3 methodology sections appear

**Step 3: Final commit**
```bash
git add -A
git commit -m "chore: Veritas Engine v3 — full integration complete"
```
