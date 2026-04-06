/**
 * @deep-check/sdk
 *
 * AI-powered identity verification SDK.
 * Deepfake detection, document forensics, keystroke biometrics.
 *
 * @example
 * ```typescript
 * import { DeepCheck } from "@deep-check/sdk";
 *
 * const dc = new DeepCheck({
 *   apiUrl: "https://your-instance.com:8001",
 *   apiKey: "your-api-key",
 * });
 *
 * // Deepfake detection
 * const df = await dc.detectDeepfake(file);
 * console.log(df.verdict, df.pFake);
 *
 * // Document verification with full AI analysis
 * const doc = await dc.verifyDocument(scan, { fullAnalysis: true });
 * console.log(doc.verdict, doc.ocrText, doc.explanation);
 *
 * // MRZ extraction
 * const mrz = await dc.readMrz(passportScan);
 * console.log(mrz.surname, mrz.documentNumber);
 *
 * // Keystroke biometrics
 * const ks = await dc.verifyKeystroke(keystrokes, "user-123");
 * console.log(ks.isBot, ks.similarity);
 *
 * // Batch processing
 * const results = await dc.detectDeepfakeBatch(images, {}, 5);
 * ```
 *
 * @packageDocumentation
 */

export { DeepCheck, DeepCheckError } from "./client";
export type { ImageInput } from "./client";
export { KeystrokeCollector } from "./keystroke-collector";

export type {
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
  EngineStatus,
  ModelsStatus,
  ExplainOptions,
} from "./types";
