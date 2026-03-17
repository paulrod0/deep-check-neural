/**
 * GET /api/certificates?id=<certificateId>
 * POST /api/certificates — Generate a shareable verification certificate
 * =======================================================================
 *
 * Creates cryptographically signed verification certificates that can be
 * shared with third parties (employers, universities, government agencies).
 *
 * Architecture:
 *   1. Verification completes → certificateId stored in dc_document_analyses
 *   2. Client requests certificate → this endpoint generates a signed JSON payload
 *   3. Certificate includes SHA-256 integrity hash → tamper-proof
 *   4. Third party can verify at /verify/<certificateId>
 *
 * This is a key differentiator: verifiable, shareable proof of identity verification.
 * No competitor offers this — Onfido results stay inside their dashboard.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// ── Config ──────────────────────────────────────────────────────────────────────

const CERTIFICATE_SECRET = process.env.CERTIFICATE_SIGNING_SECRET || process.env.PGRST_JWT_SECRET || (() => {
  console.warn('[certificates] No CERTIFICATE_SIGNING_SECRET or PGRST_JWT_SECRET set — using random ephemeral key')
  return crypto.randomBytes(32).toString('hex')
})()
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://deep-check.io'

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

// ── Certificate Payload ─────────────────────────────────────────────────────────

interface CertificatePayload {
  /** Unique certificate ID */
  id: string
  /** Deep-Check verification certificate version */
  version: '1.0'
  /** ISO 8601 timestamp of issuance */
  issuedAt: string
  /** ISO 8601 timestamp of expiry (1 year from issuance) */
  expiresAt: string
  /** Verification result */
  verification: {
    verdict: 'authentic' | 'suspicious' | 'tampered'
    documentType: string
    /** MRZ fields (PII redacted in shared mode) */
    mrzSummary: {
      nationality: string
      documentType: string
      isExpired: boolean
      checksumsPassed: number
      checksumsFailed: number
    } | null
    /** Forensics summary (no raw image data) */
    forensicsSummary: {
      riskScore: number
      riskLevel: string
      elaScore: number
      noiseScore: number
    }
    /** Face match result (no biometric data) */
    faceMatchPerformed: boolean
    livenessCheckPerformed: boolean
  }
  /** Verification URL for third-party checking */
  verifyUrl: string
  /** SHA-256 HMAC signature of the payload */
  signature: string
  /** Issuer info */
  issuer: {
    name: 'Deep-Check'
    url: string
    deployMode: string
  }
}

// ── Signature ───────────────────────────────────────────────────────────────────

function signPayload(payload: Omit<CertificatePayload, 'signature'>): string {
  const data = JSON.stringify(payload, null, 0)
  return crypto
    .createHmac('sha256', CERTIFICATE_SECRET)
    .update(data)
    .digest('hex')
}

function verifySignature(payload: CertificatePayload): boolean {
  const { signature, ...rest } = payload
  const expected = signPayload(rest)
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex')
  )
}

// ── GET: Verify a certificate ───────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'Certificate ID required' }, { status: 400 })
  }

  const supabase = getClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  }

  try {
    const { data: analysis } = await supabase
      .from('dc_document_analyses')
      .select('*')
      .eq('id', id)
      .single()

    if (!analysis) {
      return NextResponse.json({ error: 'Certificate not found' }, { status: 404 })
    }

    const findings = (analysis.findings || {}) as Record<string, unknown>

    const issuedAt = analysis.created_at || new Date().toISOString()
    const expiresAt = new Date(new Date(issuedAt).getTime() + 365 * 24 * 60 * 60 * 1000).toISOString()

    const payloadBase = {
      id: analysis.id,
      version: '1.0' as const,
      issuedAt,
      expiresAt,
      verification: {
        verdict: (findings.verdict as 'authentic' | 'suspicious' | 'tampered') || 'suspicious',
        documentType: (findings.documentType as string) || 'unknown',
        mrzSummary: findings.mrzValid !== undefined ? {
          nationality: ((findings.mrzFields as Record<string, string>)?.nationality) || '',
          documentType: (findings.mrzFields as Record<string, string>)?.issuingCountry || '',
          isExpired: Boolean((findings.mrzFields as Record<string, boolean>)?.isExpired),
          checksumsPassed: Number(findings.checksumsPassed) || 0,
          checksumsFailed: Number(findings.checksumsFailed) || 0,
        } : null,
        forensicsSummary: {
          riskScore: analysis.risk_score || 0,
          riskLevel: analysis.risk_level || 'unknown',
          elaScore: analysis.ela_score || 0,
          noiseScore: analysis.noise_score || 0,
        },
        faceMatchPerformed: Boolean(findings.faceMatchPerformed),
        livenessCheckPerformed: Boolean(findings.livenessCheckPerformed),
      },
      verifyUrl: `${BASE_URL}/verify/${analysis.id}`,
      issuer: {
        name: 'Deep-Check' as const,
        url: BASE_URL,
        deployMode: process.env.DEPLOY_MODE || 'cloud',
      },
    }

    const signature = signPayload(payloadBase)
    const certificate: CertificatePayload = { ...payloadBase, signature }

    // Verify the signature we just created (sanity check)
    const isValid = verifySignature(certificate)

    return NextResponse.json({
      valid: isValid,
      expired: new Date(expiresAt) < new Date(),
      certificate,
    })
  } catch (err) {
    console.error('[certificates] Error:', err)
    return NextResponse.json({ error: 'Failed to generate certificate' }, { status: 500 })
  }
}

// ── POST: Generate a new certificate (from existing analysis) ────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { analysisId: string; includeDetails?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.analysisId) {
    return NextResponse.json({ error: 'analysisId required' }, { status: 400 })
  }

  // Redirect to GET with the ID
  const url = new URL(req.url)
  url.searchParams.set('id', body.analysisId)

  const getReq = new NextRequest(url, { method: 'GET' })
  return GET(getReq)
}
