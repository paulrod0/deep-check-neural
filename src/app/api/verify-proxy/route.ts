import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BACKENDS: Record<string, { url: string; analyzeEndpoint: string }> = {
  xeon: {
    url: process.env.XEON_ML_URL || 'http://100.116.188.12:8001',
    analyzeEndpoint: '/analyze/document',
  },
  aws: {
    url: process.env.AWS_GEMMA_URL || 'http://54.229.204.211:8002',
    analyzeEndpoint: '/analyze',
  },
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const backend = formData.get('backend') as string || 'aws'
    const config = BACKENDS[backend]

    if (!config) {
      return NextResponse.json({ error: `Unknown backend: ${backend}` }, { status: 400 })
    }

    // Forward the image to the backend
    const image = formData.get('image') as File
    if (!image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 })
    }

    const proxyForm = new FormData()
    proxyForm.append('image', image)

    const t0 = Date.now()
    const res = await fetch(`${config.url}${config.analyzeEndpoint}`, {
      method: 'POST',
      body: proxyForm,
    })

    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json(
        { error: `Backend returned ${res.status}`, details: text },
        { status: res.status }
      )
    }

    const data = await res.json()
    data._proxy = { backend, url: config.url, proxyMs: Date.now() - t0 }

    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Proxy failed', message: e.message },
      { status: 502 }
    )
  }
}

export async function GET() {
  // Health check both backends
  const results: Record<string, any> = {}

  for (const [name, config] of Object.entries(BACKENDS)) {
    try {
      const res = await fetch(`${config.url}/health`, { signal: AbortSignal.timeout(5000) })
      results[name] = { status: 'online', ...(await res.json()) }
    } catch {
      results[name] = { status: 'offline' }
    }
  }

  return NextResponse.json({ backends: results })
}
