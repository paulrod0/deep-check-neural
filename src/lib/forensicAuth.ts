/**
 * API-key authentication helper for the public forensic endpoints.
 *
 * - Write actions (ingest, report, seal) MUST present a valid API key
 *   (`Authorization: Bearer dc_live_...` or `X-API-Key: dc_live_...`).
 * - Read actions (verify, export) remain public — knowing the chainId IS
 *   the access token, which is intentional so a court / opposing counsel
 *   can audit a chain without an account.
 *
 * Optional dev escape hatch: setting FORENSIC_AUTH_DISABLED=true bypasses
 * the check (used in tests and demos). MUST stay false in production.
 */

import type { NextRequest } from 'next/server'
import { validateApiKey, type ApiKey } from './db'

export interface ForensicAuthContext {
  /** Resolved API key record, or null when auth is bypassed via env. */
  apiKey: ApiKey | null
  /** Actor string to record in the chain entry (api key name, or "anonymous-demo"). */
  actor: string
}

export class ForensicAuthError extends Error {
  constructor(public status: 401 | 403, message: string) {
    super(message)
    this.name = 'ForensicAuthError'
  }
}

function extractKey(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') ?? ''
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim() || null
  const xKey = req.headers.get('x-api-key')
  if (xKey) return xKey.trim() || null
  return null
}

/**
 * Require a valid Deep-Check API key. Throws ForensicAuthError on failure.
 *
 * Returns the resolved actor string the chain should record. We prefer the
 * key NAME (e.g. "ie-admissions-pilot") over the key value so the audit
 * trail stays human-readable without leaking secrets.
 */
export async function requireApiKey(req: NextRequest): Promise<ForensicAuthContext> {
  // Dev bypass — keep at the very top so it's obvious during code review.
  if (process.env.FORENSIC_AUTH_DISABLED === 'true') {
    return { apiKey: null, actor: 'anonymous-demo' }
  }

  const key = extractKey(req)
  if (!key) {
    throw new ForensicAuthError(
      401,
      'Missing API key. Send "Authorization: Bearer <key>" or "X-API-Key: <key>".'
    )
  }
  const apiKey = await validateApiKey(key)
  if (!apiKey) {
    throw new ForensicAuthError(401, 'Invalid or revoked API key.')
  }
  if (!apiKey.permissions?.includes('write')) {
    throw new ForensicAuthError(403, 'API key lacks "write" permission for forensic endpoints.')
  }
  // Allow the caller to override the actor label per request only with the
  // X-Forensic-Actor header AND only if the key explicitly lets them.
  // Otherwise the chain records the key's own name to keep the audit trail tight.
  const overrideActor = req.headers.get('x-forensic-actor')?.trim()
  const actor = overrideActor && overrideActor.length <= 64
    ? `${apiKey.name}:${overrideActor}`
    : apiKey.name
  return { apiKey, actor }
}
