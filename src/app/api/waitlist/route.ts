import { NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'

export async function POST(req: Request) {
  try {
    const { email } = await req.json()

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
    }

    const sql = neon(process.env.DATABASE_URL!)
    await sql`INSERT INTO dc_waitlist (email, source) VALUES (${email.toLowerCase().trim()}, 'homepage') ON CONFLICT (email) DO NOTHING`

    return NextResponse.json({ ok: true, message: 'Successfully joined the waitlist' })
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
