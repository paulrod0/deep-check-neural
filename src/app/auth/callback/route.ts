import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@insforge/sdk'
import { getOrCreateOrg } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url)
  const code  = searchParams.get('code')
  const next  = searchParams.get('next') ?? '/dashboard'

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/login?error=missing_code`)
  }

  const supabase = createClient({
    baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    isServerMode: true,
  })

  const { data, error } = await supabase.auth.exchangeOAuthCode(code)

  if (error || !data) {
    console.error('[auth/callback] error:', error?.message)
    return NextResponse.redirect(`${origin}/auth/login?error=invalid_link`)
  }

  const access_token = data.accessToken ?? ''
  const refresh_token = data.refreshToken ?? ''
  const user = data.user

  if (!user) {
    return NextResponse.redirect(`${origin}/auth/login?error=no_user`)
  }

  // Ensure org exists for this user
  await getOrCreateOrg(user.id, user.email!)

  // Build response with auth cookies
  const response = NextResponse.redirect(`${origin}${next}`)

  response.cookies.set('sb-access-token', access_token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   60 * 60 * 24 * 7, // 7 days
    path:     '/',
  })

  response.cookies.set('sb-refresh-token', refresh_token!, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   60 * 60 * 24 * 30, // 30 days
    path:     '/',
  })

  return response
}
