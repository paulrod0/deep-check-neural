/**
 * Deep-Check JavaScript/TypeScript SDK
 * =====================================
 * AI-powered identity verification: deepfake detection, document forensics,
 * keystroke biometrics. Privacy-first, on-premise ready.
 *
 * @example
 * ```typescript
 * import { DeepCheck } from "@deep-check/sdk";
 *
 * const dc = new DeepCheck({ apiUrl: "http://localhost:8001" });
 *
 * // Deepfake detection
 * const result = await dc.detectDeepfake(imageFile);
 * console.log(result.verdict);  // "real" | "fake"
 *
 * // Document verification
 * const doc = await dc.verifyDocument(scanFile, { fullAnalysis: true });
 * console.log(doc.ocrText, doc.explanation);
 *
 * // Keystroke biometrics
 * const ks = await dc.verifyKeystroke(keystrokes);
 * console.log(ks.isBot, ks.similarity);
 * ```
 */

import type {
  DeepCheckConfig,
  DeepfakeResult,
  DeepfakeOptions,
  DocumentResult,
  DocumentOptions,
  MrzResult,
  KeystrokeEntry,
  KeystrokeResult,
  EnrollResult,
  HealthStatus,
  ModelsStatus,
  ExplainOptions,
} from "./types";

/** Supported image input types */
export type ImageInput = File | Blob | ArrayBuffer | Uint8Array | string;

export class DeepCheckError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown
  ) {
    super(message);
    this.name = "DeepCheckError";
  }
}

export class DeepCheck {
  private apiUrl: string;
  private apiKey?: string;
  private timeout: number;

  constructor(config: DeepCheckConfig = {}) {
    this.apiUrl = (config.apiUrl ?? "http://localhost:8001").replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 30_000;
  }

  // ── Deepfake Detection ──

  /**
   * Detect if an image is AI-generated or manipulated.
   *
   * Uses V9 DINOv3 (GPU) with V3 EfficientNet (CPU) fallback.
   * Ensemble mode combines both models with TTA for maximum accuracy.
   *
   * @param image - File, Blob, ArrayBuffer, Uint8Array, base64 string, or data URL
   * @param options - Detection options (TTA, etc.)
   * @returns DeepfakeResult with verdict, probability, and confidence
   */
  async detectDeepfake(image: ImageInput, options: DeepfakeOptions = {}): Promise<DeepfakeResult> {
    const { useTta = true } = options;
    const form = await this.buildImageForm(image);
    form.append("use_tta", String(useTta));

    const json = await this.post("/detect/deepfake", form);

    return {
      pFake: json.p_fake ?? 0.5,
      authenticityScore: json.authenticity_score ?? 50,
      verdict: json.verdict ?? "unknown",
      confidence: json.confidence ?? "low",
      model: json.model ?? "",
      ttaPasses: json.tta_passes ?? 1,
      processingMs: json.processing_ms,
      raw: json,
    };
  }

  // ── Document Verification ──

  /**
   * Verify document authenticity with forensics + AI analysis.
   *
   * Pipeline: DINOv2 forensics + ICAO classification + Gemma 4 OCR/explanation.
   * Supports 195 countries, ICAO 9303 compliant (TD1, TD2, TD3).
   *
   * @param image - Document scan (File, Blob, base64, etc.)
   * @param options - Analysis options
   * @returns DocumentResult with verdict, OCR text, fields, and explanation
   */
  async verifyDocument(image: ImageInput, options: DocumentOptions = {}): Promise<DocumentResult> {
    const { fullAnalysis = true } = options;
    const endpoint = fullAnalysis ? "/analyze/document" : "/detect/document";
    const form = await this.buildImageForm(image);

    const json = await this.post(endpoint, form, this.timeout * 2);

    const forensics = json.forensics ?? json;
    const analysis = json.analysis ?? {};

    return {
      pTampered: forensics.p_tampered ?? forensics.p_fake ?? 0.5,
      verdict: forensics.verdict ?? "unknown",
      ocrText: analysis.ocr_text ?? "",
      fields: analysis.fields ?? {},
      coherenceIssues: analysis.coherence_issues ?? "",
      explanation: analysis.explanation ?? "",
      docType: analysis.doc_type ?? "",
      processingMs: json.processing_ms,
      raw: json,
    };
  }

  /**
   * Extract and parse MRZ (Machine Readable Zone) from a document image.
   *
   * Uses Gemma 4 for accurate OCR of MRZ lines, then validates
   * check digits per ICAO 9303 standard.
   *
   * @param image - Document image containing MRZ
   * @returns Parsed MRZ fields (name, DOB, document number, etc.)
   */
  async readMrz(image: ImageInput): Promise<MrzResult> {
    const form = await this.buildImageForm(image);
    const json = await this.post("/analyze/mrz", form, this.timeout * 2);

    return {
      mrzLines: json.mrz_lines ?? [],
      docType: json.doc_type ?? "",
      country: json.country ?? "",
      surname: json.surname ?? "",
      givenNames: json.given_names ?? "",
      documentNumber: json.document_number ?? "",
      nationality: json.nationality ?? "",
      dateOfBirth: json.date_of_birth ?? "",
      sex: json.sex ?? "",
      expiryDate: json.expiry_date ?? "",
      checksValid: json.checks_valid ?? false,
      raw: json,
    };
  }

  // ── Keystroke Biometrics ──

  /**
   * Verify user identity and detect bots via typing patterns.
   *
   * Analyzes hold times and flight times between keystrokes using
   * a Transformer encoder (3.3M params). Returns bot detection score
   * and optional similarity to enrolled user profile.
   *
   * @param keystrokes - Array of keystroke timing data (min 10 entries)
   * @param userId - Optional user ID to compare against enrolled profile
   * @returns KeystrokeResult with bot score and identity similarity
   */
  async verifyKeystroke(keystrokes: KeystrokeEntry[], userId?: string): Promise<KeystrokeResult> {
    if (keystrokes.length < 10) {
      throw new DeepCheckError("Need at least 10 keystrokes", 400);
    }

    const payload = {
      keystrokes: keystrokes.map((ks) => ({
        hold_time: ks.holdTimeMs,
        flight_time: ks.flightTimeMs,
        key_category: ks.keyCategory ?? 0,
      })),
      user_id: userId ?? null,
    };

    const json = await this.postJson("/verify/keystroke", payload);

    return {
      isBot: json.is_bot ?? false,
      botScore: json.bot_score ?? 0,
      similarity: json.similarity ?? 0,
      embedding: json.embedding,
      raw: json,
    };
  }

  /**
   * Enroll a user's typing pattern for future verification.
   *
   * Requires at least 20 keystrokes for reliable enrollment.
   * The resulting profile is stored server-side and used for
   * identity comparison in verifyKeystroke().
   *
   * @param keystrokes - Array of keystroke timing data (min 20 entries)
   * @param userId - Unique user identifier
   * @returns Enrollment confirmation
   */
  async enrollKeystroke(keystrokes: KeystrokeEntry[], userId: string): Promise<EnrollResult> {
    if (keystrokes.length < 20) {
      throw new DeepCheckError("Need at least 20 keystrokes for enrollment", 400);
    }

    const payload = {
      keystrokes: keystrokes.map((ks) => ({
        hold_time: ks.holdTimeMs,
        flight_time: ks.flightTimeMs,
        key_category: ks.keyCategory ?? 0,
      })),
      user_id: userId,
    };

    const json = await this.postJson("/enroll/keystroke", payload);

    return {
      success: json.success ?? true,
      userId: json.user_id ?? userId,
      samplesStored: json.samples_stored ?? 0,
      raw: json,
    };
  }

  // ── Explanation ──

  /**
   * Get a human-readable explanation of any detection result.
   *
   * Uses Gemma 4 to generate natural language explanations of
   * why an image was flagged as fake/tampered.
   *
   * @param image - The analyzed image
   * @param options - Explanation options (type, score, details)
   * @returns Natural language explanation string
   */
  async explain(image: ImageInput, options: ExplainOptions = {}): Promise<string> {
    const { detectionType = "deepfake", score = 50, details = "" } = options;
    const form = await this.buildImageForm(image);
    form.append("detection_type", detectionType);
    form.append("score", String(score));
    form.append("details", details);

    const json = await this.post("/explain", form, this.timeout * 2);
    return json.explanation ?? "";
  }

  // ── Health & Models ──

  /** Check API health and engine status. */
  async health(): Promise<HealthStatus> {
    return this.get("/health");
  }

  /** Get status of all loaded models (versions, metrics, device). */
  async modelsStatus(): Promise<ModelsStatus> {
    return this.get("/models/status");
  }

  // ── Batch helpers ──

  /**
   * Detect deepfakes in multiple images concurrently.
   *
   * @param images - Array of images to analyze
   * @param options - Detection options applied to all images
   * @param concurrency - Max concurrent requests (default: 3)
   * @returns Array of results (in same order as inputs)
   */
  async detectDeepfakeBatch(
    images: ImageInput[],
    options: DeepfakeOptions = {},
    concurrency = 3
  ): Promise<DeepfakeResult[]> {
    return this.runBatch(images, (img) => this.detectDeepfake(img, options), concurrency);
  }

  /**
   * Verify multiple documents concurrently.
   *
   * @param images - Array of document images
   * @param options - Document options applied to all
   * @param concurrency - Max concurrent requests (default: 2)
   * @returns Array of results (in same order as inputs)
   */
  async verifyDocumentBatch(
    images: ImageInput[],
    options: DocumentOptions = {},
    concurrency = 2
  ): Promise<DocumentResult[]> {
    return this.runBatch(images, (img) => this.verifyDocument(img, options), concurrency);
  }

  // ── Internal ──

  private async buildImageForm(image: ImageInput): Promise<FormData> {
    const form = new FormData();

    if (typeof image === "string") {
      // base64 string or data URL
      if (image.startsWith("data:") || image.length > 1000) {
        form.append("frameBase64", image);
      } else {
        // Might be a file path in Node.js — try to read it
        if (typeof globalThis.process !== "undefined") {
          const fs = await import("fs");
          const buffer = fs.readFileSync(image);
          form.append("image", new Blob([buffer]), "image.jpg");
        } else {
          form.append("frameBase64", image);
        }
      }
    } else if (image instanceof Blob || image instanceof File) {
      form.append("image", image, (image as File).name ?? "image.jpg");
    } else if (image instanceof ArrayBuffer || image instanceof Uint8Array) {
      const bytes = image instanceof ArrayBuffer ? new Uint8Array(image) : image;
      form.append("image", new Blob([bytes]), "image.jpg");
    } else {
      throw new DeepCheckError("Unsupported image type. Use File, Blob, ArrayBuffer, Uint8Array, or base64 string.", 400);
    }

    return form;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  private async get(path: string): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(`${this.apiUrl}${path}`, {
        headers: this.headers(),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new DeepCheckError(`HTTP ${res.status}: ${body}`, res.status, body);
      }
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  private async post(path: string, form: FormData, timeout?: number): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout ?? this.timeout);

    try {
      const res = await fetch(`${this.apiUrl}${path}`, {
        method: "POST",
        headers: this.headers(),
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new DeepCheckError(`HTTP ${res.status}: ${body}`, res.status, body);
      }
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  private async postJson(path: string, body: unknown): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(`${this.apiUrl}${path}`, {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new DeepCheckError(`HTTP ${res.status}: ${text}`, res.status, text);
      }
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  private async runBatch<T>(
    items: ImageInput[],
    fn: (item: ImageInput) => Promise<T>,
    concurrency: number
  ): Promise<T[]> {
    const results: T[] = new Array(items.length);
    let idx = 0;

    const worker = async () => {
      while (idx < items.length) {
        const i = idx++;
        results[i] = await fn(items[i]);
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
    return results;
  }
}
