/**
 * Deep-Check — SHA-256 Tamper-Evident Audit Chain
 * ================================================
 * A block chain of forensic evidence for each verification session.
 * Each block records a Veritas Engine detection event with:
 *   - SHA-256 hash of its own content + previous block's hash
 *   - This makes any tampering detectable (hash mismatch on verify)
 *
 * Design:
 *   genesis block: index=0, prevHash="0000...0000"
 *   block N: hash = SHA-256(N | timestamp | layer | payload | prevHash)
 *
 * Usage:
 *   const chain = new AuditChain()
 *   chain.addBlock('rppg', { pFake: 0.8, fStat: 4.2 })
 *   chain.addBlock('facs', { violations: ['duchenne', 'bilateral'] })
 *   chain.addBlock('ensemble', { pFake: 0.75, verdict: 'fake' })
 *   const { valid } = chain.verify()
 *   await saveChainToAPI(chain.export(), assessmentId)
 *
 * Veritas Engine v2 — Deep-Check
 */

// No 'use client' — this module works in both browser and Node.js (Supabase Edge)

// ─── Types ─────────────────────────────────────────────────────────────────────

export type AuditLayer =
    | 'rppg'
    | 'facs'
    | 'cnn_v1'
    | 'cnn_v2'
    | 'efficientnet'
    | 'keystroke'
    | 'ensemble'
    | 'session_start'
    | 'session_end'

export interface AuditBlock {
    index: number
    timestamp: number
    layer: AuditLayer
    payload: Record<string, unknown>
    prevHash: string
    hash: string
}

export interface ChainVerification {
    valid: boolean
    blockCount: number
    /** Index of first tampered block (undefined if valid) */
    tamperIndex?: number
    /** Reason for invalidity */
    reason?: string
    /** Final hash of the chain (can be stored as chain fingerprint) */
    chainFingerprint: string
}

// ─── AuditChain class ─────────────────────────────────────────────────────────

export class AuditChain {
    private blocks: AuditBlock[] = []

    /** Number of blocks in the chain */
    get length(): number {
        return this.blocks.length
    }

    /**
     * Add a new block to the chain.
     * @param layer    Which detection layer produced this event
     * @param payload  Arbitrary forensic data (scores, flags, metadata)
     */
    async addBlock(layer: AuditLayer, payload: Record<string, unknown>): Promise<AuditBlock> {
        const index     = this.blocks.length
        const timestamp = Date.now()
        const prevHash  = this.blocks.length > 0
            ? this.blocks[this.blocks.length - 1].hash
            : '0000000000000000000000000000000000000000000000000000000000000000'

        const hash = await computeBlockHash(index, timestamp, layer, payload, prevHash)

        const block: AuditBlock = { index, timestamp, layer, payload, prevHash, hash }
        this.blocks.push(block)
        return block
    }

    /**
     * Verify the integrity of the entire chain.
     * Recomputes every block's hash and checks prevHash linkage.
     */
    async verify(): Promise<ChainVerification> {
        const n = this.blocks.length

        if (n === 0) {
            return { valid: true, blockCount: 0, chainFingerprint: '' }
        }

        for (let i = 0; i < n; i++) {
            const block = this.blocks[i]

            // Verify block's own hash
            const expected = await computeBlockHash(
                block.index, block.timestamp, block.layer, block.payload, block.prevHash,
            )
            if (expected !== block.hash) {
                return {
                    valid: false,
                    blockCount: n,
                    tamperIndex: i,
                    reason: `Block ${i} hash mismatch (expected ${expected.slice(0, 8)}... got ${block.hash.slice(0, 8)}...)`,
                    chainFingerprint: '',
                }
            }

            // Verify linkage to previous block
            if (i > 0 && block.prevHash !== this.blocks[i - 1].hash) {
                return {
                    valid: false,
                    blockCount: n,
                    tamperIndex: i,
                    reason: `Block ${i} prevHash mismatch — chain broken`,
                    chainFingerprint: '',
                }
            }
        }

        const chainFingerprint = this.blocks[n - 1].hash

        return { valid: true, blockCount: n, chainFingerprint }
    }

    /**
     * Export all blocks for storage / API submission.
     */
    export(): AuditBlock[] {
        return this.blocks.map(b => ({ ...b }))
    }

    /**
     * Get the current chain tip hash (last block's hash).
     * Returns empty string if chain is empty.
     */
    get tipHash(): string {
        return this.blocks.length > 0 ? this.blocks[this.blocks.length - 1].hash : ''
    }

    /** Clear all blocks (new session) */
    reset(): void {
        this.blocks = []
    }

    /** Import a previously exported chain (e.g. for cross-session verification) */
    static async fromBlocks(blocks: AuditBlock[]): Promise<AuditChain> {
        const chain = new AuditChain()
        chain.blocks = blocks.map(b => ({ ...b }))
        return chain
    }
}

// ─── SHA-256 implementation ────────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of a block's canonical representation.
 * Works in both browser (Web Crypto API) and Node.js (crypto module).
 */
async function computeBlockHash(
    index: number,
    timestamp: number,
    layer: string,
    payload: Record<string, unknown>,
    prevHash: string,
): Promise<string> {
    // Canonical serialization (deterministic key order)
    const data = `${index}|${timestamp}|${layer}|${canonicalJSON(payload)}|${prevHash}`
    return sha256(data)
}

/** Deterministic JSON (sorted keys, no whitespace) */
function canonicalJSON(obj: unknown): string {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj)
    if (Array.isArray(obj)) return `[${obj.map(canonicalJSON).join(',')}]`
    const sorted = Object.keys(obj as Record<string, unknown>).sort()
    const pairs  = sorted.map(k => `${JSON.stringify(k)}:${canonicalJSON((obj as Record<string, unknown>)[k])}`)
    return `{${pairs.join(',')}}`
}

/**
 * SHA-256 using Web Crypto API (browser) or Node.js crypto (server).
 * Returns lowercase hex string.
 */
async function sha256(data: string): Promise<string> {
    const encoded = new TextEncoder().encode(data)

    if (typeof crypto !== 'undefined' && crypto.subtle) {
        // Browser / Edge runtime
        const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
        const hashArray  = Array.from(new Uint8Array(hashBuffer))
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    } else {
        // Node.js (Docker / server)
        const { createHash } = await import('crypto')
        return createHash('sha256').update(encoded).digest('hex')
    }
}

// ─── API helpers ──────────────────────────────────────────────────────────────

/**
 * Save an AuditChain to the /api/audit-chain endpoint.
 * Call this at session end to persist the forensic record.
 */
export async function saveChainToAPI(
    blocks: AuditBlock[],
    assessmentId: string,
): Promise<{ saved: boolean; chainHash: string; error?: string }> {
    try {
        const res = await fetch('/api/audit-chain', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ assessmentId, blocks }),
        })
        if (!res.ok) {
            const text = await res.text().catch(() => 'unknown error')
            return { saved: false, chainHash: '', error: text }
        }
        const data = await res.json() as { chainHash?: string }
        return { saved: true, chainHash: data.chainHash ?? '' }
    } catch (err) {
        return { saved: false, chainHash: '', error: String(err) }
    }
}
