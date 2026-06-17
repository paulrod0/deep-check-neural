/**
 * Deep-Check · Server-side document forensics helper
 * ===================================================
 *
 * Thin client around the ML worker (DINOv2 + ELA) document-manipulation
 * endpoint. Extracted verbatim (behaviour-identical) from the inline copy
 * that lives in src/app/api/v1/verify/route.ts so it can be reused across
 * API routes (verify, batch, ...).
 *
 * Fail-safe by design: if no ML worker is configured, or the call fails for
 * any reason, runDocForensics returns null. Callers MUST treat null as
 * "not checked" — never fabricate a score.
 */

// ML worker for server-side document forensics (DINOv2 + ELA). Optional:
// if no worker is configured, forensics is skipped and behavior is identical
// to before — zero change where no worker exists.
const ML_WORKER_URL = process.env.ML_WORKER_URL || process.env.XEON_ML_URL || ''
const ML_WORKER_API_KEY = process.env.ML_WORKER_API_KEY || ''

/**
 * Run server-side document forensics via the ML worker (/detect/document).
 * Returns p_tampered in [0,1], or null if no worker is configured or the
 * call fails (non-fatal — verification continues without forensics).
 */
export async function runDocForensics(documentBase64: string): Promise<number | null> {
  if (!ML_WORKER_URL) return null
  try {
    const form = new FormData()
    form.append('frameBase64', documentBase64)
    const res = await fetch(`${ML_WORKER_URL}/detect/document`, {
      method: 'POST',
      body: form,
      headers: ML_WORKER_API_KEY ? { 'x-api-key': ML_WORKER_API_KEY } : undefined,
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return null
    const data = await res.json()
    const p = typeof data?.p_tampered === 'number' ? data.p_tampered : null
    if (p === null || Number.isNaN(p)) return null
    return Math.min(1, Math.max(0, p))
  } catch {
    return null
  }
}
