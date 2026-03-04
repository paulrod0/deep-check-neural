import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { Organization } from './planLimits'

// ─── Server-side Supabase client (uses service role if available) ─────────────

export function createServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// ─── Get org from Supabase Auth session (server component / route handler) ────

export async function getOrgFromSession(
  req?: Request
): Promise<Organization | null> {
  try {
    const supabase = createServerClient()

    // Extract bearer token from Authorization header (API use)
    const authHeader = req?.headers?.get('Authorization') ?? ''
    let userId: string | null = null

    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const { data: { user } } = await supabase.auth.getUser(token)
      userId = user?.id ?? null
    }

    // Fall back to cookie-based session (dashboard web use)
    if (!userId) {
      const cookieStore = await cookies()
      const accessToken = cookieStore.get('sb-access-token')?.value
      if (accessToken) {
        const { data: { user } } = await supabase.auth.getUser(accessToken)
        userId = user?.id ?? null
      }
    }

    if (!userId) return null

    // Get org via membership
    const { data: membership } = await supabase
      .from('dc_org_members')
      .select('org_id')
      .eq('user_id', userId)
      .single()

    if (!membership?.org_id) return null

    const { data: org } = await supabase
      .from('dc_organizations')
      .select('*')
      .eq('id', membership.org_id)
      .single()

    return (org as Organization) ?? null
  } catch {
    return null
  }
}

// ─── Get or create org for a newly registered user ───────────────────────────

export async function getOrCreateOrg(
  userId: string,
  email: string
): Promise<Organization | null> {
  const supabase = createServerClient()

  // Check if user already has a membership
  const { data: existing } = await supabase
    .from('dc_org_members')
    .select('org_id')
    .eq('user_id', userId)
    .single()

  if (existing?.org_id) {
    const { data: org } = await supabase
      .from('dc_organizations')
      .select('*')
      .eq('id', existing.org_id)
      .single()
    return (org as Organization) ?? null
  }

  // Check if org already exists for this email (e.g. created by webhook before login)
  const { data: existingOrg } = await supabase
    .from('dc_organizations')
    .select('*')
    .eq('owner_email', email)
    .single()

  if (existingOrg) {
    // Link user to existing org
    await supabase.from('dc_org_members').insert({
      org_id:  existingOrg.id,
      user_id: userId,
      role:    'owner',
    })
    return existingOrg as Organization
  }

  // Create new free org
  const { data: newOrg } = await supabase
    .from('dc_organizations')
    .insert({ owner_email: email, name: email.split('@')[0], plan: 'free' })
    .select()
    .single()

  if (!newOrg) return null

  await supabase.from('dc_org_members').insert({
    org_id:  newOrg.id,
    user_id: userId,
    role:    'owner',
  })

  return newOrg as Organization
}

// ─── Validate legacy admin session (backwards compat for existing cookie) ────

export async function validateLegacyAdmin(): Promise<boolean> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('dc_admin_session')?.value
    if (!token) return false

    const supabase = createServerClient()
    const { data } = await supabase
      .from('dc_admin_sessions')
      .select('token, expires_at')
      .eq('token', token)
      .single()

    if (!data) return false
    return new Date(data.expires_at) > new Date()
  } catch {
    return false
  }
}
