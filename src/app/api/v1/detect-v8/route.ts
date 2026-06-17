export const dynamic = 'force-dynamic'

// Worker base URL from env (fail-closed — no hardcoded IP in source). Set
// V8_API_URL to your worker base, e.g. https://worker.example.com:8080 or a
// private Tailscale address. Biometric images transit here, so use HTTPS or a
// private/encrypted network. Optional V8_API_KEY is sent as X-API-Key.
const V8_API_BASE = (process.env.V8_API_URL || '').replace(/\/$/, '')
const V8_API_KEY = process.env.V8_API_KEY || ''
const v8Headers = V8_API_KEY ? { 'x-api-key': V8_API_KEY } : undefined

export async function POST(req: Request) {
  if (!V8_API_BASE) {
    return Response.json({ error: 'V8 backend not configured (set V8_API_URL)', status: 'offline' }, { status: 503 })
  }
  try {
    const formData = await req.formData()
    const image = formData.get('image') as File | null

    if (!image) {
      return Response.json({ error: 'No image provided' }, { status: 400 })
    }

    // Forward to V8 API
    const ec2Form = new FormData()
    ec2Form.append('image', image)

    const res = await fetch(`${V8_API_BASE}/api/detect`, {
      method: 'POST',
      body: ec2Form,
      headers: v8Headers,
      signal: AbortSignal.timeout(30000),
    })

    const data = await res.json()
    return Response.json(data)
  } catch {
    return Response.json({ error: 'V8 model unavailable', model: 'V8-DINOv3', status: 'offline' }, { status: 503 })
  }
}

export async function GET() {
  if (!V8_API_BASE) {
    return Response.json({ status: 'offline', model: 'V8-DINOv3', note: 'V8_API_URL not set' })
  }
  try {
    const res = await fetch(`${V8_API_BASE}/health`, { headers: v8Headers, signal: AbortSignal.timeout(5000) })
    const data = await res.json()
    return Response.json(data)
  } catch {
    return Response.json({ status: 'offline', model: 'V8-DINOv3' })
  }
}
