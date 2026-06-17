/**
 * /api/org/members — Team Member Management
 * ===========================================
 *
 * GET:    List members of the current user's organization
 * POST:   Invite a new member (by email)
 * DELETE: Remove a member (owner only, can't remove self)
 *
 * Requires authenticated session (Supabase Auth cookie).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, getOrgFromSession } from '@/lib/auth'

// ── GET: List org members ─────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const org = await getOrgFromSession(req)
  if (!org) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()

  const { data: members, error } = await supabase.database
    .from('dc_org_members')
    .select('id, user_id, role, created_at')
    .eq('org_id', org.id)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Enrich with user emails from dc_org_members join or user profile table
  // Note: InsForge does not expose auth.admin.getUserById — look up email from org/profile data
  const enriched = await Promise.all(
    (members || []).map(async (m) => {
      let email = 'unknown'
      try {
        const { data: profile } = await supabase.database
          .from('dc_user_profiles')
          .select('email')
          .eq('user_id', m.user_id)
          .single()
        email = profile?.email ?? 'unknown'
      } catch {
        // Non-fatal — profile might not exist yet
      }
      return {
        id: m.id,
        userId: m.user_id,
        email,
        role: m.role,
        joinedAt: m.created_at,
      }
    })
  )

  return NextResponse.json({
    success: true,
    data: {
      orgId: org.id,
      orgName: org.name,
      plan: org.plan,
      members: enriched,
    },
  })
}

// ── POST: Invite a member ─────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const org = await getOrgFromSession(req)
  if (!org) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { email: string; role?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.email?.trim()) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  const role = body.role === 'viewer' ? 'viewer' : 'member'

  // Only pro/enterprise plans can have team members
  if (org.plan === 'free' || org.plan === 'starter') {
    return NextResponse.json(
      { error: 'Team members require Pro or Enterprise plan. Upgrade at /pricing' },
      { status: 403 }
    )
  }

  const supabase = createServerClient()

  // Look up user by email in dc_user_profiles
  // Note: InsForge does not expose auth.admin.listUsers/inviteUserByEmail
  const { data: targetProfile } = await supabase.database
    .from('dc_user_profiles')
    .select('user_id, email')
    .eq('email', body.email.trim().toLowerCase())
    .single()

  if (!targetProfile) {
    // TODO: Implement InsForge invite flow (magic link via auth API)
    // For now, user must sign up first before being added to an org
    return NextResponse.json({
      success: false,
      message: `No account found for ${body.email}. The user must sign up first, then you can add them.`,
      pending: true,
    }, { status: 404 })
  }

  // Check if already a member
  const { data: existing } = await supabase.database
    .from('dc_org_members')
    .select('id')
    .eq('org_id', org.id)
    .eq('user_id', targetProfile.user_id)
    .single()

  if (existing) {
    return NextResponse.json(
      { error: 'User is already a member of this organization' },
      { status: 409 }
    )
  }

  // Remove from any previous org (users can only be in one org)
  await supabase.database
    .from('dc_org_members')
    .delete()
    .eq('user_id', targetProfile.user_id)

  // Add to org
  const { error: insertErr } = await supabase.database
    .from('dc_org_members')
    .insert({
      org_id: org.id,
      user_id: targetProfile.user_id,
      role,
    })

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    message: `${body.email} added as ${role}`,
    member: {
      userId: targetProfile.user_id,
      email: body.email,
      role,
    },
  })
}

// ── DELETE: Remove a member ───────────────────────────────────────────────────

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const org = await getOrgFromSession(req)
  if (!org) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const memberId = req.nextUrl.searchParams.get('id')
  if (!memberId) {
    return NextResponse.json({ error: 'Member ID required' }, { status: 400 })
  }

  const supabase = createServerClient()

  // Get the member to be removed
  const { data: member } = await supabase.database
    .from('dc_org_members')
    .select('id, user_id, role, org_id')
    .eq('id', memberId)
    .single()

  if (!member || member.org_id !== org.id) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  // Can't remove the owner
  if (member.role === 'owner') {
    return NextResponse.json(
      { error: 'Cannot remove the organization owner' },
      { status: 403 }
    )
  }

  const { error: deleteErr } = await supabase.database
    .from('dc_org_members')
    .delete()
    .eq('id', memberId)

  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, message: 'Member removed' })
}
