import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ML_URL = process.env.XEON_ML_URL || 'http://100.116.188.12:8001'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const front = formData.get('front') as File
    const back = formData.get('back') as File

    if (!front || !back) {
      return NextResponse.json({ error: 'Both front and back images required' }, { status: 400 })
    }

    const proxyForm = new FormData()
    proxyForm.append('front', front)
    proxyForm.append('back', back)

    const res = await fetch(`${ML_URL}/verify/identity`, {
      method: 'POST',
      body: proxyForm,
    })

    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: `Backend returned ${res.status}`, details: text }, { status: res.status })
    }

    return NextResponse.json(await res.json())
  } catch (e: any) {
    return NextResponse.json({ error: 'Proxy failed', message: e.message }, { status: 502 })
  }
}
