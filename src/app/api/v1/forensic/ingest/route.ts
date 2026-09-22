/**
 * POST /api/v1/forensic/ingest
 *
 * Register a piece of evidence in the chain of custody (ISO/IEC 27037 Step 1).
 *
 * Content-Type: multipart/form-data
 *   - file: the evidence blob (image/video/document/audio)
 *   - kind: 'image' | 'video' | 'document' | 'audio' | 'biometric_session'
 *   - caseRef (optional): case reference
 *   - metadata (optional): JSON string with contextual metadata
 *
 * Returns: { chainId, evidenceHash, size, timestamp, entryHash, tsaToken }
 */
import { NextRequest, NextResponse } from 'next/server'
import { ingestEvidence, type EvidenceKind } from '@/lib/forensicChain'
import { requireApiKey, ForensicAuthError } from '@/lib/forensicAuth'

const VALID_KINDS: EvidenceKind[] = ['image', 'video', 'document', 'audio', 'biometric_session']

export async function POST(req: NextRequest) {
  try {
    // 1) Auth — must precede any file work so we don't burn memory on unauthorized requests.
    const auth = await requireApiKey(req)

    const form = await req.formData()
    const file = form.get('file') as File | null
    const kindRaw = form.get('kind')?.toString() ?? ''
    const caseRef = form.get('caseRef')?.toString() || undefined
    const metadataRaw = form.get('metadata')?.toString() || '{}'

    if (!file) {
      return NextResponse.json({ error: 'missing_file' }, { status: 400 })
    }
    if (!VALID_KINDS.includes(kindRaw as EvidenceKind)) {
      return NextResponse.json(
        { error: 'invalid_kind', message: `kind must be one of ${VALID_KINDS.join(', ')}` },
        { status: 400 }
      )
    }
    const kind = kindRaw as EvidenceKind

    let metadata: Record<string, unknown>
    try {
      metadata = JSON.parse(metadataRaw)
    } catch {
      return NextResponse.json({ error: 'invalid_metadata', message: 'metadata must be valid JSON' }, { status: 400 })
    }

    // Size limit: 500MB (raise in production, need streaming for bigger)
    if (file.size > 500 * 1024 * 1024) {
      return NextResponse.json({ error: 'too_large', message: 'max 500MB' }, { status: 413 })
    }

    const buf = new Uint8Array(await file.arrayBuffer())

    const result = await ingestEvidence(auth.actor, {
      kind,
      bytes: buf,
      filename: file.name,
      mimeType: file.type,
      metadata,
      caseRef,
    })

    return NextResponse.json({
      ok: true,
      chainId: result.chainId,
      evidenceHash: result.evidenceHash,
      size: result.size,
      timestamp: result.timestamp,
      entryHash: result.entryHash,
      tsaToken: result.tsaToken ?? null,
      // Distinguish "I got an RFC 3161 token" (tsaPresent) from
      // "the token is from an eIDAS Qualified TSP" (tsaQualified).
      // Reports MUST surface tsaQualified=false honestly; otherwise we lie.
      tsaPresent: !!result.tsaToken,
      tsaQualified: result.tsaQualified ?? false,
      tsaUrl: result.tsaUrl ?? null,
    })
  } catch (e) {
    if (e instanceof ForensicAuthError) {
      return NextResponse.json({ error: 'unauthorized', message: e.message }, { status: e.status })
    }
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'ingest_failed', message: msg }, { status: 500 })
  }
}

export const runtime = 'nodejs'
export const maxDuration = 60
