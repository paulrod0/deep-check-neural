export const dynamic = 'force-dynamic'

const EC2_API = 'http://52.215.31.248:8080/api/detect'

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const image = formData.get('image') as File | null

    if (!image) {
      return Response.json({ error: 'No image provided' }, { status: 400 })
    }

    // Forward to EC2 V8 API
    const ec2Form = new FormData()
    ec2Form.append('image', image)

    const res = await fetch(EC2_API, {
      method: 'POST',
      body: ec2Form,
      signal: AbortSignal.timeout(30000),
    })

    const data = await res.json()
    return Response.json(data)
  } catch {
    return Response.json({ error: 'V8 model unavailable', model: 'V8-DINOv3', status: 'offline' }, { status: 503 })
  }
}

export async function GET() {
  try {
    const res = await fetch('http://52.215.31.248:8080/health', { signal: AbortSignal.timeout(5000) })
    const data = await res.json()
    return Response.json(data)
  } catch {
    return Response.json({ status: 'offline', model: 'V8-DINOv3' })
  }
}
