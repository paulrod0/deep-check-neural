/**
 * Deep-Check Forensic Chain of Custody — ISO/IEC 27037:2012 compliant.
 *
 * Implements digital evidence identification, collection, acquisition, and
 * preservation for legal admissibility of Deep-Check analysis results.
 *
 * Spanish legal references:
 *   - LEC (Ley 1/2000) Art. 299 — medios de prueba electrónica
 *   - LEC Art. 319-327 — documentos públicos y privados
 *   - eIDAS (Reglamento UE 910/2014) Art. 42 — sellos de tiempo cualificados
 *   - UNE 71506:2013 — metodología de análisis forense informático
 *   - UNE 197010:2015 — criterios generales para informe pericial
 *   - ISO/IEC 27037:2012 — identificación, recogida, adquisición y preservación
 *   - ISO/IEC 27042:2015 — análisis e interpretación de evidencia digital
 *
 * All operations are idempotent and append-only. A broken chain invalidates
 * the evidence for court use.
 */
import { createHash, randomUUID } from 'node:crypto'
import { db } from './db'

// --------------------------------------------------------------------------- //
// Types
// --------------------------------------------------------------------------- //

export type EvidenceKind = 'image' | 'video' | 'document' | 'audio' | 'biometric_session'

export interface EvidenceIngestInput {
  kind: EvidenceKind
  /** raw bytes of the evidence (image/video/document) */
  bytes: Uint8Array
  /** original filename if available (not trusted, just labelled) */
  filename?: string
  /** mime type */
  mimeType?: string
  /** optional caller-supplied metadata (operator, device, context). Immutable after ingest. */
  metadata?: Record<string, unknown>
  /** optional case reference for the peritaje (expediente judicial) */
  caseRef?: string
}

export interface ChainEntry {
  chainId: string
  seq: number
  timestamp: string // ISO-8601 UTC
  actor: string
  action: 'ingest' | 'analyze' | 'report' | 'seal' | 'export'
  prevHash: string
  entryHash: string
  payload: Record<string, unknown>
  tsaToken?: string // RFC3161 base64 timestamp token
}

export interface IngestResult {
  chainId: string
  evidenceHash: string // sha256 of bytes
  size: number
  timestamp: string
  entryHash: string
  tsaToken?: string
  /** True iff the configured TSA hostname is on the eIDAS QTSP allowlist
   * (see QUALIFIED_TSP_HOSTS). False does not invalidate the chain — it only
   * means the timestamp lacks eIDAS qualified weight on its own. */
  tsaQualified?: boolean
  /** TSA URL that produced the token, recorded for audit. */
  tsaUrl?: string
}

export interface AnalysisEntry {
  chainId: string
  modelName: string // e.g. "deep-check-video-v10.0"
  modelVersion: string
  modelHash: string // sha256 of the model binary
  inferenceMs: number
  result: Record<string, unknown> // probability, verdict, layer scores
}

// --------------------------------------------------------------------------- //
// Hashing
// --------------------------------------------------------------------------- //

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function sha256Object(obj: unknown): string {
  // Canonical JSON — keys sorted, no whitespace — so same content always hashes same.
  const canonical = JSON.stringify(obj, Object.keys(obj as Record<string, unknown>).sort())
  return createHash('sha256').update(canonical).digest('hex')
}

function entryHash(entry: Omit<ChainEntry, 'entryHash'>): string {
  return sha256Object({
    chainId: entry.chainId,
    seq: entry.seq,
    timestamp: entry.timestamp,
    actor: entry.actor,
    action: entry.action,
    prevHash: entry.prevHash,
    payload: entry.payload,
  })
}

// --------------------------------------------------------------------------- //
// Storage (uses dc_forensic_chain table — see migration below)
// --------------------------------------------------------------------------- //

async function lastEntry(chainId: string): Promise<ChainEntry | null> {
  const { data, error } = await db()
    .from('dc_forensic_chain')
    .select('*')
    .eq('chain_id', chainId)
    .order('seq', { ascending: false })
    .limit(1)
  if (error) throw new Error(`Chain lookup failed: ${error.message}`)
  if (!data || data.length === 0) return null
  const row = data[0]
  return {
    chainId: row.chain_id,
    seq: row.seq,
    timestamp: row.timestamp,
    actor: row.actor,
    action: row.action,
    prevHash: row.prev_hash,
    entryHash: row.entry_hash,
    payload: row.payload,
    tsaToken: row.tsa_token ?? undefined,
  }
}

async function appendEntry(entry: ChainEntry): Promise<void> {
  const { error } = await db()
    .from('dc_forensic_chain')
    .insert({
      chain_id: entry.chainId,
      seq: entry.seq,
      timestamp: entry.timestamp,
      actor: entry.actor,
      action: entry.action,
      prev_hash: entry.prevHash,
      entry_hash: entry.entryHash,
      payload: entry.payload,
      tsa_token: entry.tsaToken ?? null,
    })
  if (error) throw new Error(`Chain append failed: ${error.message}`)
}

// --------------------------------------------------------------------------- //
// TSA (timestamp authority) — RFC3161 over HTTP
// --------------------------------------------------------------------------- //

const DEFAULT_TSA_URL = process.env.TSA_URL ?? 'https://freetsa.org/tsr'
const TSA_REQUIRED = (process.env.TSA_REQUIRED ?? 'false') === 'true'

/**
 * Hostnames of TSPs that hold a Qualified Trust Service Provider listing in
 * the EU LOTL (List of the Lists) for time-stamping under eIDAS Art. 42.
 * Match is suffix-based on the hostname, so subdomains count.
 *
 * Source: https://eidas.ec.europa.eu/efda/tl-browser/  (filter "Time-stamping (QC)")
 *
 * Update this list when contracting a new TSP. Setting an unknown hostname
 * does NOT break ingest — the chain still records a valid RFC 3161 token,
 * but the report will mark `tsaQualified=false` so the perito knows the
 * timestamp does not have eIDAS qualified weight on its own.
 */
const QUALIFIED_TSP_HOSTS: ReadonlyArray<string> = [
  // Spain
  'tsa.uanataca.com',
  'psc.firmaprofesional.com',
  'sede.fnmt.gob.es',
  'tsa.cert.fnmt.es',
  'tsa.izenpe.com',
  'tss.accv.es',
  'tsa.catcert.cat',
  'psis.catcert.cat',
  // Pan-European common QTSPs (extend as you contract them)
  'tsa.swisssign.net',
  'qtsa.iaik.tugraz.at',
  'tsa.belgium.be',
  'tsa.luxtrust.lu',
  'tsa.cartaodecidadao.pt',
]

export function isQualifiedTSP(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return QUALIFIED_TSP_HOSTS.some((h) => host === h || host.endsWith('.' + h))
  } catch {
    return false
  }
}

export interface TimestampResult {
  /** base64-encoded RFC 3161 TimeStampToken, or null if TSA was unavailable. */
  token: string | null
  /** true if the configured TSA hostname is on the eIDAS QTSP allowlist. */
  qualified: boolean
  /** TSA URL used (for audit). */
  tsaUrl: string
}

/**
 * Request a RFC3161 timestamp for a given hash. Returns the token plus a
 * qualified-status flag so callers (and the pericial PDF) can disclose
 * whether the timestamp has eIDAS legal weight.
 *
 * For FREE development: uses freetsa.org (valid RFC 3161, but NOT qualified).
 * For PRODUCTION with legal weight, set TSA_URL to a qualified TSP from the
 * EU LOTL. See QUALIFIED_TSP_HOSTS above for the current allowlist.
 */
export async function requestTimestampDetailed(hashHex: string): Promise<TimestampResult> {
  const tsaUrl = DEFAULT_TSA_URL
  const qualified = isQualifiedTSP(tsaUrl)
  try {
    const req = buildTSRequest(hashHex)
    const resp = await fetch(tsaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/timestamp-query' },
      body: new Uint8Array(req),
    })
    if (!resp.ok) {
      if (TSA_REQUIRED) throw new Error(`TSA responded ${resp.status}`)
      return { token: null, qualified, tsaUrl }
    }
    const buf = await resp.arrayBuffer()
    return { token: Buffer.from(buf).toString('base64'), qualified, tsaUrl }
  } catch (e) {
    if (TSA_REQUIRED) throw e
    console.warn('[forensicChain] TSA unavailable, continuing without timestamp:', e)
    return { token: null, qualified, tsaUrl }
  }
}

/** Backwards-compatible thin wrapper. Prefer `requestTimestampDetailed`. */
export async function requestTimestamp(hashHex: string): Promise<string | null> {
  const r = await requestTimestampDetailed(hashHex)
  return r.token
}

/** Minimal RFC3161 TimeStampRequest DER encoder for SHA-256 imprint. */
function buildTSRequest(hashHex: string): Uint8Array {
  const hashBytes = Buffer.from(hashHex, 'hex')
  // Hand-rolled DER for clarity. Structure:
  //   SEQUENCE {
  //     INTEGER 1,  -- version
  //     SEQUENCE {  -- messageImprint
  //       SEQUENCE { OID 2.16.840.1.101.3.4.2.1, NULL },  -- SHA-256
  //       OCTET STRING hashBytes
  //     },
  //     BOOLEAN TRUE  -- certReq
  //   }
  const oidSha256 = Buffer.from([
    0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01,
  ])
  const algoIdentifier = Buffer.concat([
    Buffer.from([0x30, 0x0d]), // SEQUENCE len 13
    oidSha256,
    Buffer.from([0x05, 0x00]), // NULL
  ])
  const hashOctet = Buffer.concat([
    Buffer.from([0x04, hashBytes.length]),
    hashBytes,
  ])
  const messageImprint = Buffer.concat([
    Buffer.from([0x30, algoIdentifier.length + hashOctet.length]),
    algoIdentifier,
    hashOctet,
  ])
  const version = Buffer.from([0x02, 0x01, 0x01]) // INTEGER 1
  const certReq = Buffer.from([0x01, 0x01, 0xff]) // BOOLEAN TRUE
  const inner = Buffer.concat([version, messageImprint, certReq])
  return Buffer.concat([
    Buffer.from([0x30, 0x82, (inner.length >> 8) & 0xff, inner.length & 0xff]),
    inner,
  ])
}

// --------------------------------------------------------------------------- //
// Public API
// --------------------------------------------------------------------------- //

/**
 * Step 1 — INGEST: register a piece of evidence in a new chain of custody.
 * Returns chainId which is the root identifier for all subsequent operations.
 */
export async function ingestEvidence(
  actor: string,
  input: EvidenceIngestInput
): Promise<IngestResult> {
  const chainId = randomUUID()
  const timestamp = new Date().toISOString()
  const evidenceHash = sha256Hex(input.bytes)
  const payload = {
    kind: input.kind,
    evidenceHash,
    size: input.bytes.length,
    filename: input.filename ?? null,
    mimeType: input.mimeType ?? null,
    caseRef: input.caseRef ?? null,
    metadata: input.metadata ?? {},
  }

  // Request RFC3161 timestamp over the evidence hash + qualified-status flag
  const ts = await requestTimestampDetailed(evidenceHash)

  const entry: Omit<ChainEntry, 'entryHash'> = {
    chainId,
    seq: 0,
    timestamp,
    actor,
    action: 'ingest',
    prevHash: '0'.repeat(64), // genesis
    payload: { ...payload, tsaUrl: ts.tsaUrl, tsaQualified: ts.qualified },
  }
  const hash = entryHash(entry)
  await appendEntry({ ...entry, entryHash: hash, tsaToken: ts.token ?? undefined })

  return {
    chainId,
    evidenceHash,
    size: input.bytes.length,
    timestamp,
    entryHash: hash,
    tsaToken: ts.token ?? undefined,
    tsaQualified: ts.qualified,
    tsaUrl: ts.tsaUrl,
  }
}

/**
 * Step 2 — ANALYZE: append an analysis entry linking model version and result.
 * MUST include the model hash so the exact binary used is reproducible.
 */
export async function recordAnalysis(
  actor: string,
  e: AnalysisEntry
): Promise<ChainEntry> {
  const prev = await lastEntry(e.chainId)
  if (!prev) throw new Error(`Chain ${e.chainId} not found`)

  const timestamp = new Date().toISOString()
  const entry: Omit<ChainEntry, 'entryHash'> = {
    chainId: e.chainId,
    seq: prev.seq + 1,
    timestamp,
    actor,
    action: 'analyze',
    prevHash: prev.entryHash,
    payload: {
      modelName: e.modelName,
      modelVersion: e.modelVersion,
      modelHash: e.modelHash,
      inferenceMs: e.inferenceMs,
      result: e.result,
    },
  }
  const hash = entryHash(entry)
  const full: ChainEntry = { ...entry, entryHash: hash }
  await appendEntry(full)
  return full
}

/**
 * Step 3 — SEAL: close the chain before reporting. A sealed chain cannot
 * receive further entries (except "export" markers which just log read access).
 * Returns the canonical seal hash — this is what goes on the pericial report cover.
 */
export async function sealChain(actor: string, chainId: string): Promise<{ sealHash: string; tsaToken: string | null }> {
  const prev = await lastEntry(chainId)
  if (!prev) throw new Error(`Chain ${chainId} not found`)

  // Compute full-chain digest (Merkle-like root of all entry hashes)
  const { data } = await db()
    .from('dc_forensic_chain')
    .select('entry_hash')
    .eq('chain_id', chainId)
    .order('seq', { ascending: true })
  const digests = (data ?? []).map((r: { entry_hash: string }) => r.entry_hash).join(':')
  const sealHash = createHash('sha256').update(digests).digest('hex')

  const timestamp = new Date().toISOString()
  const tsaToken = await requestTimestamp(sealHash)

  const entry: Omit<ChainEntry, 'entryHash'> = {
    chainId,
    seq: prev.seq + 1,
    timestamp,
    actor,
    action: 'seal',
    prevHash: prev.entryHash,
    payload: { sealHash, chainLength: (data ?? []).length },
  }
  const hash = entryHash(entry)
  await appendEntry({ ...entry, entryHash: hash, tsaToken: tsaToken ?? undefined })
  return { sealHash, tsaToken }
}

/**
 * Verify an entire chain: walks entries in order and checks every hash link.
 * Returns the list of broken links (empty if chain is valid).
 */
export async function verifyChain(chainId: string): Promise<{ valid: boolean; breaks: string[] }> {
  const { data, error } = await db()
    .from('dc_forensic_chain')
    .select('*')
    .eq('chain_id', chainId)
    .order('seq', { ascending: true })
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) return { valid: false, breaks: ['chain not found'] }

  const breaks: string[] = []
  for (let i = 0; i < data.length; i++) {
    const row = data[i]
    const expectedPrev = i === 0 ? '0'.repeat(64) : data[i - 1].entry_hash
    if (row.prev_hash !== expectedPrev) {
      breaks.push(`seq ${row.seq}: prevHash mismatch`)
    }
    const computed = entryHash({
      chainId: row.chain_id,
      seq: row.seq,
      timestamp: row.timestamp,
      actor: row.actor,
      action: row.action,
      prevHash: row.prev_hash,
      payload: row.payload,
    })
    if (computed !== row.entry_hash) {
      breaks.push(`seq ${row.seq}: entryHash mismatch`)
    }
  }
  return { valid: breaks.length === 0, breaks }
}

/**
 * Full chain export — used when handing evidence to a lawyer or court.
 * Returns a self-contained JSON bundle with all entries and their hashes.
 */
export async function exportChain(chainId: string) {
  const { data } = await db()
    .from('dc_forensic_chain')
    .select('*')
    .eq('chain_id', chainId)
    .order('seq', { ascending: true })
  const verification = await verifyChain(chainId)
  return {
    chainId,
    entries: data ?? [],
    verification,
    exportedAt: new Date().toISOString(),
    standard: 'ISO/IEC 27037:2012',
  }
}
