// ── Deep-Check SDK Types ──

export interface DeepCheckConfig {
  /** API base URL (default: http://localhost:8001) */
  apiUrl?: string;
  /** API key for authenticated requests */
  apiKey?: string;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

// ── Deepfake Detection ──

export interface DeepfakeResult {
  /** Probability of being fake (0.0 = real, 1.0 = fake) */
  pFake: number;
  /** Authenticity score (0-100, higher = more authentic) */
  authenticityScore: number;
  /** Human-readable verdict */
  verdict: "real" | "suspicious" | "likely_fake" | "fake";
  /** Confidence level */
  confidence: "high" | "medium" | "low";
  /** Model used for detection */
  model: string;
  /** Number of TTA passes */
  ttaPasses: number;
  /** Processing time in ms */
  processingMs?: number;
  /** Raw API response */
  raw: Record<string, unknown>;
}

export interface DeepfakeOptions {
  /** Use Test-Time Augmentation (5 passes, more accurate but slower) */
  useTta?: boolean;
}

// ── Document Verification ──

export interface DocumentResult {
  /** Probability of tampering (0.0 = authentic, 1.0 = tampered) */
  pTampered: number;
  /** Human-readable verdict */
  verdict: "authentic" | "suspicious" | "tampered" | "unknown";
  /** Extracted text via OCR */
  ocrText: string;
  /** Parsed document fields (name, DOB, document number, etc.) */
  fields: Record<string, string>;
  /** Detected coherence issues */
  coherenceIssues: string;
  /** Human-readable explanation from Gemma 4 */
  explanation: string;
  /** Detected document type (DNI, passport, etc.) */
  docType: string;
  /** Processing time in ms */
  processingMs?: number;
  /** Raw API response */
  raw: Record<string, unknown>;
}

export interface DocumentOptions {
  /** Include full Gemma 4 analysis (OCR + explanation). Slower but richer. */
  fullAnalysis?: boolean;
}

// ── MRZ ──

export interface MrzResult {
  /** MRZ raw lines */
  mrzLines: string[];
  /** Document type (TD1, TD2, TD3, MRV-A, MRV-B) */
  docType: string;
  /** Issuing country (ISO 3166-1 alpha-3) */
  country: string;
  /** Holder's surname */
  surname: string;
  /** Holder's given names */
  givenNames: string;
  /** Document number */
  documentNumber: string;
  /** Nationality (ISO 3166-1 alpha-3) */
  nationality: string;
  /** Date of birth (YYMMDD) */
  dateOfBirth: string;
  /** Sex (M/F/<) */
  sex: string;
  /** Expiry date (YYMMDD) */
  expiryDate: string;
  /** Check digit validations */
  checksValid: boolean;
  /** Raw API response */
  raw: Record<string, unknown>;
}

// ── Keystroke Biometrics ──

export interface KeystrokeEntry {
  /** Key identifier */
  key?: string;
  /** Key hold duration in ms */
  holdTimeMs: number;
  /** Time between key releases and next press in ms */
  flightTimeMs: number;
  /** Key category (0=letter, 1=digit, 2=special, 3=space, etc.) */
  keyCategory?: number;
}

export interface KeystrokeResult {
  /** Whether the typing pattern indicates a bot */
  isBot: boolean;
  /** Bot probability score (0.0 = human, 1.0 = bot) */
  botScore: number;
  /** Similarity to enrolled user profile (0.0-1.0) */
  similarity: number;
  /** User embedding vector (128D) */
  embedding?: number[];
  /** Raw API response */
  raw: Record<string, unknown>;
}

export interface EnrollResult {
  /** Whether enrollment was successful */
  success: boolean;
  /** User ID enrolled */
  userId: string;
  /** Number of keystroke samples stored */
  samplesStored: number;
  /** Raw API response */
  raw: Record<string, unknown>;
}

// ── Health & Models ──

export interface HealthStatus {
  status: string;
  engines: Record<string, EngineStatus>;
}

export interface EngineStatus {
  loaded: boolean;
  model: string;
  version?: string;
  device?: string;
  auc?: number;
  eer?: number;
}

export interface ModelsStatus {
  models: Record<string, unknown>;
  engines: Record<string, EngineStatus>;
}

// ── Explanation ──

export interface ExplainOptions {
  /** Type of detection to explain */
  detectionType?: "deepfake" | "document";
  /** Detection score (0-100) */
  score?: number;
  /** Additional details to include */
  details?: string;
}
