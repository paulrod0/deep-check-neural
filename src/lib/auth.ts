import { createClient } from '@insforge/sdk'
import { cookies } from 'next/headers'
import type { Organization } from './planLimits'

// ─── Server-side InsForge client ─────────────────────────────────────────────

let _client: ReturnType<typeof createClient> | null = null

export function createServerClient() {
  if (_client) return _client
  const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL
    ?? process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.INSFORGE_SERVICE_KEY
    ?? process.env.SUPABASE_SERVICE_ROLE_KEY
    ?? process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  _client = createClient({ baseUrl, anonKey, isServerMode: true })
  return _client
}

// ─── Get org from InsForge Auth session (server component / route handler) ───

export async function getOrgFromSession(
  req?: Request
): Promise<Organization | null> {
  try {
    // 1. Resolve the user's access token: Authorization header first,
    //    then cookies (sb-access-token set in auth/callback, insforge fallback).
    const authHeader = req?.headers?.get('Authorization') ?? ''
    let token: string | null = null

    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.slice('Bearer '.length).trim() || null
    }

    if (!token) {
      const cookieStore = await cookies()
      token = cookieStore.get('sb-access-token')?.value
        ?? cookieStore.get('insforge-access-token')?.value
        ?? null
    }

    // 2. No token -> not authenticated.
    if (!token) return null

    // 3. Validate identity with a PER-REQUEST client bound to the user's token
    //    (NOT the service-role singleton, which would always resolve to null).
    const userClient = createClient({
      baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL
        ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
      edgeFunctionToken: token,
      isServerMode: true,
    })

    let userId: string | null = null
    try {
      const { data: currentUser } = await userClient.auth.getCurrentUser()
      userId = currentUser?.user?.id ?? null
    } catch { /* token invalid */ }

    // 4. Identity could not be validated -> reject.
    if (!userId) return null

    // 5. Read the user's org with the trusted server client, strictly scoped
    //    to the already-validated userId (service-role is only used to read
    //    the user's own org AFTER identity is proven via their token).
    const client = createServerClient()

    const { data: membership } = await client.database
      .from('dc_org_members')
      .select('org_id')
      .eq('user_id', userId)
      .single()

    if (!membership?.org_id) return null

    const { data: org } = await client.database
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
  const client = createServerClient()
  const db = client.database

  // Check if user already has a membership
  const { data: existing } = await db
    .from('dc_org_members')
    .select('org_id')
    .eq('user_id', userId)
    .single()

  if (existing?.org_id) {
    const { data: org } = await db
      .from('dc_organizations')
      .select('*')
      .eq('id', existing.org_id)
      .single()
    return (org as Organization) ?? null
  }

  // Check if org already exists for this email (e.g. created by webhook before login)
  const { data: existingOrg } = await db
    .from('dc_organizations')
    .select('*')
    .eq('owner_email', email)
    .single()

  if (existingOrg) {
    // Link user to existing org
    await db.from('dc_org_members').insert({
      org_id:  existingOrg.id,
      user_id: userId,
      role:    'owner',
    })
    return existingOrg as Organization
  }

  // Create new free org
  const { data: newOrg } = await db
    .from('dc_organizations')
    .insert({ owner_email: email, name: email.split('@')[0], plan: 'free' })
    .select()
    .single()

  if (!newOrg) return null

  await db.from('dc_org_members').insert({
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

    const client = createServerClient()
    const { data } = await client.database
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
