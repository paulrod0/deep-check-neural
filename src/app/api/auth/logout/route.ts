/**
 * POST /api/auth/logout — Sign Out
 * =================================
 *
 * Clears all authentication cookies (Supabase + legacy admin)
 * and signs out from Supabase Auth server-side.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function POST(): Promise<NextResponse> {
  try {
    const cookieStore = await cookies()
    const accessToken = cookieStore.get('sb-access-token')?.value

    // Sign out from Supabase Auth server-side
    if (accessToken) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
      await supabase.auth.admin.signOut(accessToken).catch(() => {
        // Non-fatal — token might already be expired
      })
    }
  } catch {
    // Continue with cookie cleanup even if Supabase call fails
  }

  // Clear all auth cookies
  const response = NextResponse.json({ success: true, message: 'Signed out' })

  // Supabase session cookies
  response.cookies.set('sb-access-token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  response.cookies.set('sb-refresh-token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })

  // Legacy admin session cookie
  response.cookies.set('dc_admin_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })

  // Admin session cookie (old format)
  response.cookies.set('admin_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })

  return response
}
