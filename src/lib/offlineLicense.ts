/**
 * Deep-Check INTEL — Offline License Validation
 *
 * License key format:
 *   BASE64URL(JSON payload) + "." + HMAC-SHA256(BASE64URL(payload), MASTER_LICENSE_SECRET)
 *
 * Payload fields:
 *   orgId, orgName, plan, features[], expiresAt, issuedAt, maxUsers, version
 *
 * Features: 'video' | 'osint' | 'maltego' | 'airgap' | 'batch'
 *
 * No network calls are ever made. Validation is fully offline using the
 * MASTER_LICENSE_SECRET baked into the server environment at deploy time.
 */

import { createHmac } from 'crypto'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LicensePayload {
  orgId: string
  orgName: string
  plan: 'intel' | 'enterprise'
  features: string[]
  expiresAt: string   // ISO 8601 date string
  issuedAt: string    // ISO 8601 date string
  maxUsers: number
  version: string
}

export interface LicenseValidation {
  valid: boolean
  payload?: LicensePayload
  error?: string
  daysRemaining?: number
  expired?: boolean
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const LICENSE_VERSION = '1'
const MS_PER_DAY = 1000 * 60 * 60 * 24

/**
 * Encode a Buffer or string to URL-safe Base64 (no padding).
 */
function toBase64Url(data: string | Buffer): string {
  const b64 = Buffer.isBuffer(data)
    ? data.toString('base64')
    : Buffer.from(data).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/**
 * Decode a URL-safe Base64 string to a UTF-8 string.
 */
function fromBase64Url(input: string): string {
  // Restore standard Base64 padding
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    input.length + (4 - (input.length % 4)) % 4,
    '='
  )
  return Buffer.from(padded, 'base64').toString('utf8')
}

/**
 * Compute HMAC-SHA256 of a message using the given secret.
 * Returns a hex string.
 */
function hmacSha256(message: string, secret: string): string {
  return createHmac('sha256', secret).update(message).digest('hex')
}

/**
 * Resolve the master license secret from the environment.
 * Throws if not set (required for generation only; validation also needs it).
 */
function getMasterSecret(): string {
  const secret = process.env.MASTER_LICENSE_SECRET
  if (!secret || secret.trim().length === 0) {
    throw new Error(
      'MASTER_LICENSE_SECRET environment variable is not set. ' +
      'This is required on the license-issuing server. ' +
      'For validation only, it must be set on the deployment server.'
    )
  }
  return secret
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Validate a license key without any network call.
 *
 * Returns a LicenseValidation object. If MASTER_LICENSE_SECRET is not set
 * in the environment the function returns { valid: false, error: '...' }
 * rather than throwing, so it is safe to call in request handlers.
 */
export function validateLicense(licenseKey: string): LicenseValidation {
  if (!licenseKey || typeof licenseKey !== 'string') {
    return { valid: false, error: 'License key is missing or not a string.' }
  }

  const parts = licenseKey.trim().split('.')
  if (parts.length !== 2) {
    return {
      valid: false,
      error: 'Malformed license key: expected <payload>.<signature>.',
    }
  }

  const [encodedPayload, signature] = parts

  // Decode payload
  let payload: LicensePayload
  try {
    payload = JSON.parse(fromBase64Url(encodedPayload)) as LicensePayload
  } catch {
    return { valid: false, error: 'License payload could not be decoded.' }
  }

  // Verify required fields
  const requiredFields: (keyof LicensePayload)[] = [
    'orgId', 'orgName', 'plan', 'features',
    'expiresAt', 'issuedAt', 'maxUsers', 'version',
  ]
  for (const field of requiredFields) {
    if (payload[field] === undefined || payload[field] === null) {
      return { valid: false, error: `License payload missing required field: ${field}.` }
    }
  }

  // Validate plan value
  if (!['intel', 'enterprise'].includes(payload.plan)) {
    return { valid: false, error: `Unknown license plan: "${payload.plan}".` }
  }

  // Verify HMAC signature
  let masterSecret: string
  try {
    masterSecret = getMasterSecret()
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'MASTER_LICENSE_SECRET not configured.',
    }
  }

  const expectedSig = hmacSha256(encodedPayload, masterSecret)
  if (signature !== expectedSig) {
    return { valid: false, error: 'License signature is invalid.' }
  }

  // Check expiry
  const now = new Date()
  const expiresAt = new Date(payload.expiresAt)

  if (isNaN(expiresAt.getTime())) {
    return { valid: false, error: 'License expiresAt is not a valid date.' }
  }

  const daysRemaining = Math.floor((expiresAt.getTime() - now.getTime()) / MS_PER_DAY)
  const expired = now > expiresAt

  if (expired) {
    return {
      valid: false,
      payload,
      error: `License expired on ${payload.expiresAt}.`,
      daysRemaining: 0,
      expired: true,
    }
  }

  return {
    valid: true,
    payload,
    daysRemaining,
    expired: false,
  }
}

/**
 * Check whether a specific feature is enabled in the license.
 * Returns false for any invalid/expired license.
 *
 * @param licenseKey  The full license key string.
 * @param feature     e.g. 'video', 'osint', 'maltego', 'airgap', 'batch'
 */
export function hasFeature(licenseKey: string, feature: string): boolean {
  const result = validateLicense(licenseKey)
  if (!result.valid || !result.payload) return false
  return result.payload.features.includes(feature)
}

/**
 * Generate a new signed license key.
 *
 * IMPORTANT: This function requires MASTER_LICENSE_SECRET to be set in the
 * environment. It should only be called on the admin/issuing workstation,
 * never inside the deployed application container.
 *
 * @param payload  License data (issuedAt and version are set automatically).
 * @returns        A signed license key string ready to distribute.
 */
export async function generateLicense(
  payload: Omit<LicensePayload, 'issuedAt' | 'version'>
): Promise<string> {
  const masterSecret = getMasterSecret()  // throws if not set

  const fullPayload: LicensePayload = {
    ...payload,
    issuedAt: new Date().toISOString(),
    version: LICENSE_VERSION,
  }

  const encodedPayload = toBase64Url(JSON.stringify(fullPayload))
  const signature = hmacSha256(encodedPayload, masterSecret)

  return `${encodedPayload}.${signature}`
}

/**
 * Read the license key from the environment variable DEEP_CHECK_LICENSE_KEY
 * or from ./license/license.key on disk.
 *
 * Returns null if no license is found. Does not validate.
 */
export function readLicense(): string | null {
  // 1. Environment variable takes priority
  const envKey = process.env.DEEP_CHECK_LICENSE_KEY || process.env.LICENSE_KEY
  if (envKey && envKey.trim().length > 0) {
    return envKey.trim()
  }

  // 2. File on disk — only available in Node.js environments
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      // Dynamic require to avoid breaking browser/edge bundling
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs') as typeof import('fs')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('path') as typeof import('path')

      const candidates = [
        path.join(process.cwd(), 'license', 'license.key'),
        '/app/license/license.key',
        path.join(process.cwd(), 'license.key'),
      ]

      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          const content = fs.readFileSync(candidate, 'utf8').trim()
          if (content.length > 0) return content
        }
      }
    } catch {
      // fs not available (browser environment) — ignore
    }
  }

  return null
}
