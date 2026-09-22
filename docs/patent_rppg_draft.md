# Patent draft — rPPG Temporal Consistency for Deepfake Detection

**Applicant:** Pablo Lopez Rodriguez
**Country of first filing:** Spain (OEPM)
**Proposed cost:** €600 filing + €400 exam = **€1000**
**Duration:** 20 years from filing
**Target filing date:** 2026-05-01

---

## 1. Title

**"Method and System for Detecting Synthetic Audiovisual Content through Multi-Region Photoplethysmographic Temporal Consistency Analysis"**

(Spanish: "Metodo y sistema para la deteccion de contenido audiovisual sintetico mediante analisis de consistencia temporal fotopletismografica multi-region")

---

## 2. Abstract (150 words)

A method and system for detecting synthetic audiovisual content (deepfakes) by
analyzing the temporal consistency of remote photoplethysmographic (rPPG)
signals extracted from multiple facial regions of interest. The invention
extracts blood-flow signals via the CHROM algorithm from the forehead, left
cheek and right cheek regions, applies a bandpass filter in the physiological
cardiac band (0.7-3.5 Hz), and computes a 18-dimensional feature vector
combining peak frequency, spectral signal-to-noise ratio, cross-region
coherence and temporal stability. A lightweight neural classifier operates on
these features to produce a probability score. The method is robust to
compression, resolution, and illumination variations, and detects deepfakes
regardless of the generator (GAN, diffusion, VAE) because synthetic content
does not reproduce physiologically coherent blood-flow signals across facial
regions. The invention is suitable for real-time deployment in identity
verification and forensic analysis systems.

---

## 3. Technical field

Computer vision, biometric authentication, digital forensics, presentation
attack detection (PAD).

International Patent Classification:
- G06V 40/40 (Spoof detection)
- G06V 10/82 (Neural networks)
- A61B 5/0205 (Physiological sensing)

---

## 4. Background of the invention

### 4.1 State of the art

Deepfake detection methods can be grouped into:

1. **Pixel-based forensic methods** — analyze image artifacts (JPEG, ELA, frequency domain). Fragile against compression and upscaling.

2. **Neural network classifiers** — train CNNs on deepfake datasets. Overfit to specific generators; performance drops dramatically on unseen generators.

3. **Temporal inconsistency methods** — detect temporal artifacts in video (optical flow anomalies, blink patterns). Require good video quality.

4. **Single-region rPPG methods** — e.g., Intel FakeCatcher, which extracts rPPG from one facial region. Problem: single-region signals have low SNR, easy to fool with adversarial training.

### 4.2 Problems with prior art

- Pixel methods fail on modern generators (Sora 2, Veo 3, Flux)
- Neural classifiers don't generalize across generators
- Single-region rPPG has false positive rate >10% in challenging lighting
- None of the above combine physiological coherence with modern deep learning

---

## 5. Summary of the invention

The invention solves these problems by:

1. **Extracting rPPG signals from THREE independent facial regions** (forehead, left cheek, right cheek) instead of one
2. **Computing cross-region coherence** — real faces have correlated signals across regions (same heartbeat); deepfakes have uncorrelated noise
3. **Computing temporal stability of SNR** — real signals have stable SNR across time windows; deepfakes have erratic SNR
4. **Combining these with pixel-based and deep-learning scores** via Bayesian logit-space fusion

### Key novelty over prior art

| Feature | Prior art (e.g. Intel FakeCatcher) | This invention |
|---------|-----------------------------------|----------------|
| Number of ROIs | 1 | 3 |
| Cross-region coherence metric | No | **Yes (novel)** |
| Temporal SNR stability | No | **Yes (novel)** |
| Integration with deep learning | Separate pipeline | **Fused via learned weights** |
| Robustness to single-ROI obstruction | Low | **High (2 of 3 regions sufficient)** |
| Feature dimensionality | N/A | **18-dim (novel combination)** |

---

## 6. Detailed description of the invention

### 6.1 System architecture

```
INPUT: Video clip (>=5 seconds, frame rate >=10 fps, containing a visible face)
          |
          v
[Face detection + alignment]  (e.g. MediaPipe, Haar, FAN)
          |
          v
[ROI extraction from 3 regions: forehead, left cheek, right cheek]
          |
          v
[RGB mean signal per ROI per frame]   -> 3 signals of shape [T, 3]
          |
          v
[CHROM algorithm per ROI]
   (de Haan 2013: X_c = 3R - 2G, Y_c = 1.5R + G - 1.5B, S = X_c - alpha*Y_c)
          |
          v
[Bandpass filter 0.7 to 3.5 Hz per ROI]  (cardiac frequency band)
          |
          v
[Feature extraction per ROI (5 features x 3 ROIs = 15) plus cross-ROI (3) = 18 total]
          |
          v
[MLP classifier: 18 -> 64 -> 32 -> 1]
          |
          v
OUTPUT: Probability of deepfake in [0, 1]
```

### 6.2 The 18-dimensional feature vector (claim-critical)

Per ROI (forehead, left cheek, right cheek), compute:
1. Peak frequency in cardiac band (Hz)
2. SNR in decibels (peak vs band noise)
3. Band power (sum of cardiac-band spectral power)
4. Band-to-total power ratio
5. Spectral flatness

Cross-region (novel):
16. Mean coherence: average of Pearson correlations between the three ROI
    signals. Real faces: ~0.85+, deepfakes: ~0.1-0.3.
17. SNR standard deviation across 4 temporal windows. Real faces: low
    (stable); deepfakes: high (erratic).
18. Number of frames with face detection. Quality gate.

### 6.3 Bayesian logit-space fusion (novel)

The rPPG score is combined with a pixel-based deepfake score and an
audio-visual sync score via:

```
logit_fused = w_pixel * logit_pixel + w_av * logit_av + w_rppg * logit_rppg + b
```

where weights are learned via optimization on a validation set to minimize
Negative Log Likelihood, constrained to softmax normalization (sum = 1). A
temperature parameter further calibrates the output probability.

### 6.4 Embodiments

**Embodiment 1:** Software implementation in a browser using ONNX Runtime
and WebAssembly for client-side inference preserving user privacy (no video
data transmitted to servers).

**Embodiment 2:** Server-side implementation in a Docker container with
NVIDIA GPU acceleration for high-throughput batch processing.

**Embodiment 3:** Hardware implementation in an ASIC for real-time video
call authentication (10+ fps on low-power device).

**Embodiment 4:** Integration in a video conferencing platform as a
real-time authentication layer.

---

## 7. Claims

### Main claim (independent)

**1. A computer-implemented method for detecting synthetic audiovisual content
in a video containing at least one human face, the method comprising:**

(a) detecting a face in a plurality of frames of said video;
(b) extracting, for each face, at least three spatially-separated regions of
    interest corresponding to forehead, left cheek and right cheek;
(c) computing, for each region of interest, a per-frame mean RGB signal
    yielding three time-series of at least 10 seconds;
(d) applying the CHROM algorithm to each RGB time-series to produce three
    one-dimensional blood-flow signals;
(e) bandpass filtering each blood-flow signal in the frequency band 0.7 to
    3.5 Hz;
(f) computing an 18-dimensional feature vector comprising, for each of the
    three regions, the peak frequency, signal-to-noise ratio, band power,
    band-to-total power ratio, and spectral flatness; and additionally a
    cross-region mean coherence, a temporal SNR standard deviation, and a
    frame count;
(g) feeding said 18-dimensional feature vector to a neural network classifier
    to produce a probability score in [0, 1] indicating the likelihood that
    said video is synthetic.

### Dependent claims

**2.** The method of claim 1, wherein the cross-region mean coherence is
computed as the average of Pearson correlation coefficients between all
pairs of the three bandpass-filtered signals.

**3.** The method of claim 1, further comprising fusing said probability
score with at least one additional deepfake probability score via a
learned weighted logit combination with softmax-normalized weights.

**4.** The method of claim 3, wherein the additional scores comprise a
pixel-based neural network score and an audio-visual lip-sync distance
score.

**5.** The method of claim 1, wherein the CHROM algorithm uses normalized
RGB channels where each channel is divided by its temporal mean prior to
combination.

**6.** A system comprising a processor and memory configured to execute
the method of any of claims 1-5.

**7.** A non-transitory computer-readable medium storing instructions
that, when executed by a processor, cause the processor to perform the
method of any of claims 1-5.

---

## 8. Priority and filing strategy

### Step 1: Spanish priority filing (OEPM)
- **When:** ASAP after internal review (2-3 weeks)
- **Cost:** €600 filing + €400 exam = €1000
- **Benefit:** Priority date locked for PCT extension

### Step 2 (optional): PCT international (Patent Cooperation Treaty)
- **When:** Within 12 months of Spanish filing
- **Cost:** €3000-5000 (WIPO fees + attorney)
- **Benefit:** 30 months to decide national phases

### Step 3 (optional): National phases
- **Where:** EU (EPO), USA, Israel (for Rafael sales), Japan
- **Cost:** €5-15K per country
- **Benefit:** Full patent protection

### Recommended minimal path
Spain only (€1000). Sufficient to:
- License in Spain
- Claim priority in later PCT extension if market demands
- Deter local competitors

---

## 9. Evidence of non-obviousness

For the priority application, document the following in the technical description:

1. **Experimental results** proving cross-region coherence beats single-region rPPG
   - Deep-Check V10.5 benchmark results (generated by `benchmark.py`)
   - Comparison against FakeCatcher single-region baseline

2. **Dataset diversity** showing method works on unseen generators
   - Results on Sora 2, Veo 3, Flux, MidJourney v7 (generators unseen in training)

3. **Public disclosure timeline** (keep internal until filing)
   - DO NOT publish benchmarks publicly before filing
   - DO NOT demo in conferences before filing
   - After filing: free to publish, demo, license

---

## 10. Action items

- [ ] Internal review of claims with at least one patent attorney (free 30-min consult)
- [ ] Draft detailed figures (architecture diagram, feature extraction flow)
- [ ] Benchmark results on deepfake datasets (use results from V10 training)
- [ ] File via OEPM e-filing: https://tramites.oepm.es
- [ ] After filing: public Zenodo paper with DOI
- [ ] After filing: offer license to Rafael, Indra, FacePhi

---

*This draft is a non-legal-advice working document. A patent attorney should review before filing.*
