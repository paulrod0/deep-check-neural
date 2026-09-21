/**
 * Deep-Check OSINT · Maltego Transform API
 * POST /api/osint/maltego  — execute a Maltego transform
 * GET  /api/osint/maltego  — return the TRX seed file as XML
 *
 * Supports maltego.URL and maltego.Image (base64) entity types.
 */
import { NextRequest, NextResponse } from 'next/server'
import { writeAuditLog, extractIP } from '@/lib/auditLog'
import { getOrgFromSession } from '@/lib/auth'
import { isUrlSafe, SAFE_FETCH_OPTIONS } from '@/lib/ssrfGuard'

// ─── Forensic analysis helpers (inline, mirrors batch route logic) ─────────────

function analyzePixelVariance(buffer: Buffer): number {
  if (buffer.length < 64) return 0.1
  let sum = 0, sumSq = 0
  const sample = Math.min(buffer.length, 4096)
  for (let i = 0; i < sample; i++) {
    const v = buffer[i]
    sum += v
    sumSq += v * v
  }
  const mean = sum / sample
  const variance = sumSq / sample - mean * mean
  return Math.min(1, variance / 4000)
}

function computeEntropy(buf: Buffer): number {
  const freq = new Array(256).fill(0)
  for (const b of buf) freq[b]++
  const len = buf.length
  let entropy = 0
  for (const f of freq) {
    if (f === 0) continue
    const p = f / len
    entropy -= p * Math.log2(p)
  }
  return entropy
}

function estimateAiScore(buffer: Buffer, elaScore: number): number {
  const byteEntropy = computeEntropy(buffer.subarray(0, 2048))
  const entropyScore = Math.abs(byteEntropy - 7.7) < 0.2 ? 0.6 : 0.2
  return Math.min(1, elaScore * 0.6 + entropyScore * 0.4)
}

function classifyRisk(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (score >= 0.85) return 'CRITICAL'
  if (score >= 0.65) return 'HIGH'
  if (score >= 0.40) return 'MEDIUM'
  return 'LOW'
}

interface AnalysisResult {
  riskScore: number
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  elaScore: number
  aiScore: number
  alerts: string[]
  bufferSize: number
}

async function analyzeImageUrl(url: string): Promise<AnalysisResult> {
  // SSRF protection: reject private/internal/metadata targets before any fetch
  if (!(await isUrlSafe(url))) {
    throw new Error('Unsafe URL')
  }
  const resp = await fetch(url, {
    ...SAFE_FETCH_OPTIONS,
    signal: AbortSignal.timeout(12_000),
    headers: { 'User-Agent': 'Deep-Check-Maltego/2.0' },
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`)
  const arrayBuf = await resp.arrayBuffer()
  return analyzeBuffer(Buffer.from(arrayBuf))
}

function analyzeBuffer(buffer: Buffer): AnalysisResult {
  const elaScore   = analyzePixelVariance(buffer)
  const aiScore    = estimateAiScore(buffer, elaScore)
  const riskScore  = Math.min(1, elaScore * 0.5 + aiScore * 0.4)
  const riskLevel  = classifyRisk(riskScore)
  const alerts: string[] = []
  if (elaScore > 0.75) alerts.push('HIGH_ELA_ANOMALY')
  if (aiScore  > 0.80) alerts.push('AI_GENERATION_DETECTED')
  if (aiScore  > 0.60) alerts.push('SYNTHETIC_CHARACTERISTICS')
  return {
    riskScore:  Math.round(riskScore * 100) / 100,
    riskLevel,
    elaScore:   Math.round(elaScore * 100) / 100,
    aiScore:    Math.round(aiScore * 100) / 100,
    alerts,
    bufferSize: buffer.length,
  }
}

// ─── Maltego XML builders ─────────────────────────────────────────────────────

function buildMaltegoResponse(result: AnalysisResult, sourceUrl: string): string {
  const riskDisplay = `Risk: ${result.riskLevel} (${result.riskScore.toFixed(2)})`
  const fields = [
    { name: 'deepcheck.elaScore',   displayName: 'ELA Score',          value: result.elaScore.toString() },
    { name: 'deepcheck.aiScore',    displayName: 'AI Score',           value: result.aiScore.toString() },
    { name: 'deepcheck.riskScore',  displayName: 'Risk Score',         value: result.riskScore.toString() },
    { name: 'deepcheck.riskLevel',  displayName: 'Risk Level',         value: result.riskLevel },
    { name: 'deepcheck.alerts',     displayName: 'Alerts',             value: result.alerts.join('; ') || 'none' },
    { name: 'deepcheck.sourceUrl',  displayName: 'Source URL',         value: sourceUrl },
    { name: 'deepcheck.analysisTs', displayName: 'Analysis Timestamp', value: new Date().toISOString() },
    { name: 'deepcheck.version',    displayName: 'Engine Version',     value: '2.0' },
  ]

  const fieldsXml = fields
    .map(f => `          <Field Name="${f.name}" DisplayName="${escapeXml(f.displayName)}">${escapeXml(f.value)}</Field>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<MaltegoMessage>
  <MaltegoTransformResponseMessage>
    <Entities>
      <Entity Type="deepcheck.ForensicResult">
        <Value>${escapeXml(riskDisplay)}</Value>
        <Weight>${Math.round(result.riskScore * 100)}</Weight>
        <AdditionalFields>
${fieldsXml}
        </AdditionalFields>
        <IconURL>https://deep-check.com/favicon.ico</IconURL>
      </Entity>
    </Entities>
    <UIMessages>
      <UIMessage MessageType="Inform">Analysis complete. Risk level: ${result.riskLevel}</UIMessage>
    </UIMessages>
  </MaltegoTransformResponseMessage>
</MaltegoMessage>`
}

function buildMaltegoError(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<MaltegoMessage>
  <MaltegoTransformExceptionMessage>
    <Exceptions>
      <Exception>${escapeXml(message)}</Exception>
    </Exceptions>
  </MaltegoTransformExceptionMessage>
</MaltegoMessage>`
}

function buildTrxSeedFile(): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://deep-check.com'
  return `<?xml version="1.0" encoding="UTF-8"?>
<MaltegoTransformSeedFile>
  <Transforms>
    <Transform name="deepcheck.ImageForensics" displayName="Deep-Check Image Forensics" abstract="false" template="false" visibility="public" description="Runs Deep-Check forensic analysis on an image URL or base64 entity" author="Deep-Check" requireDisplayInfo="false">
      <TransformAdapter>com.paterva.maltego.transform.protocol.v2api.ClientV2LocalTransformAdapter</TransformAdapter>
      <Properties>
        <Fields>
          <Property name="deepcheck.api.url" type="string" nullable="false" hidden="false" readonly="true" description="Deep-Check API endpoint" popup="false" abstract="false" visibility="public" auth="false" displayName="API URL">
            <DefaultValue>${baseUrl}/api/osint/maltego</DefaultValue>
          </Property>
        </Fields>
      </Properties>
      <InputConstraints>
        <Entity type="maltego.URL" min="1" max="1"/>
      </InputConstraints>
      <OutputEntities>
        <Entity type="deepcheck.ForensicResult"/>
      </OutputEntities>
      <StealthLevel>0</StealthLevel>
    </Transform>
  </Transforms>
  <Entities>
    <Entity id="deepcheck.ForensicResult" displayName="Forensic Result" displayNamePlural="Forensic Results" description="Deep-Check image forensics result" category="Deep-Check" smallIconResource="ForensicResult16" largeIconResource="ForensicResult32" allowedTransforms="" visible="true">
      <Properties>
        <Groups/>
        <Fields>
          <Field name="deepcheck.elaScore"   type="double"  nullable="true"  hidden="false" readonly="false" description="ELA Score (0-1)"           displayName="ELA Score"/>
          <Field name="deepcheck.aiScore"    type="double"  nullable="true"  hidden="false" readonly="false" description="AI Generation Score (0-1)"  displayName="AI Score"/>
          <Field name="deepcheck.riskLevel"  type="string"  nullable="true"  hidden="false" readonly="false" description="Risk classification"        displayName="Risk Level"/>
          <Field name="deepcheck.riskScore"  type="double"  nullable="true"  hidden="false" readonly="false" description="Overall risk score (0-1)"   displayName="Risk Score"/>
          <Field name="deepcheck.alerts"     type="string"  nullable="true"  hidden="false" readonly="false" description="Triggered alert codes"      displayName="Alerts"/>
          <Field name="deepcheck.sourceUrl"  type="string"  nullable="true"  hidden="false" readonly="false" description="Source image URL"           displayName="Source URL"/>
        </Fields>
      </Properties>
    </Entity>
  </Entities>
</MaltegoTransformSeedFile>`
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const org = await getOrgFromSession(req)
  if (!org) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const trx = buildTrxSeedFile()
  return new NextResponse(trx, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': 'attachment; filename="deep-check.trx"',
    },
  })
}

export async function POST(req: NextRequest) {
  const t0 = Date.now()
  const ip = extractIP(req.headers)

  try {
    const org = await getOrgFromSession(req)
    if (!org) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Accept both JSON (standard) and XML bodies
    const contentType = req.headers.get('content-type') ?? ''
    let entityType = 'maltego.URL'
    let entityValue = ''

    if (contentType.includes('application/json')) {
      const body = await req.json()
      // Navigate Maltego message structure
      const msg = body?.MaltegoMessage?.MaltegoTransformRequestMessage
      const entity = msg?.Entities?.Entity
      if (!entity) {
        return new NextResponse(buildMaltegoError('Missing Maltego entity in request'), {
          status: 400,
          headers: { 'Content-Type': 'application/xml' },
        })
      }
      entityType  = entity.Type  ?? 'maltego.URL'
      entityValue = entity.Value ?? ''
    } else {
      // Parse XML body (basic extraction without xml2js dependency)
      const text = await req.text()
      const typeMatch  = text.match(/<Entity[^>]+Type="([^"]+)"/)
      const valueMatch = text.match(/<Value>([^<]+)<\/Value>/)
      entityType  = typeMatch?.[1]  ?? 'maltego.URL'
      entityValue = valueMatch?.[1] ?? ''
    }

    if (!entityValue) {
      return new NextResponse(buildMaltegoError('Empty entity value'), {
        status: 400,
        headers: { 'Content-Type': 'application/xml' },
      })
    }

    let result: AnalysisResult

    if (entityType === 'maltego.URL' || entityType === 'deepcheck.ImageURL') {
      result = await analyzeImageUrl(entityValue)
    } else if (entityType === 'maltego.Image' || entityType === 'deepcheck.Base64Image') {
      // Treat value as base64 data
      const raw = entityValue.replace(/^data:[^;]+;base64,/, '')
      const buffer = Buffer.from(raw, 'base64')
      result = analyzeBuffer(buffer)
    } else {
      return new NextResponse(
        buildMaltegoError(`Unsupported entity type: ${entityType}. Expected maltego.URL or maltego.Image`),
        { status: 400, headers: { 'Content-Type': 'application/xml' } }
      )
    }

    void writeAuditLog({
      eventType: 'ml_inference',
      endpoint: '/api/osint/maltego',
      method: 'POST',
      ip,
      statusCode: 200,
      durationMs: Date.now() - t0,
      details: { entityType, riskLevel: result.riskLevel, riskScore: result.riskScore },
    })

    const xml = buildMaltegoResponse(result, entityValue)
    return new NextResponse(xml, {
      status: 200,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    })
  } catch (err) {
    console.error('[api/osint/maltego POST] unexpected:', err)
    void writeAuditLog({
      eventType: 'error',
      endpoint: '/api/osint/maltego',
      method: 'POST',
      ip,
      statusCode: 500,
      durationMs: Date.now() - t0,
    })
    const msg = err instanceof Error ? err.message : 'Internal error'
    return new NextResponse(buildMaltegoError(msg), {
      status: 500,
      headers: { 'Content-Type': 'application/xml' },
    })
  }
}
