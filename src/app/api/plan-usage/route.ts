import { NextRequest, NextResponse } from 'next/server'
import { getOrgFromSession, validateLegacyAdmin } from '@/lib/auth'
import { getPlanUsage } from '@/lib/planLimits'
import { createClient } from '@insforge/sdk'
import { cookies } from 'next/headers'

export async function GET(req: NextRequest) {
  // Try Supabase Auth session first
  const org = await getOrgFromSession(req)
  if (org) {
    const usage = await getPlanUsage(org.id)
    if (!usage) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(usage)
  }

  // Fall back to legacy admin: return a mock "unlimited" usage for the admin dashboard
  const isAdmin = await validateLegacyAdmin()
  if (isAdmin) {
    return NextResponse.json({
      plan:          'enterprise',
      planLabel:     'Enterprise',
      sessionsUsed:  0,
      sessionsLimit: -1,
      docsUsed:      0,
      docsLimit:     -1,
      periodReset:   new Date(Date.now() + 30 * 86400000).toISOString(),
      hasApi:        true,
      upgradeNeeded: false,
    })
  }

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
