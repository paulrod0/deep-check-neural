import { createClient } from '@insforge/sdk'

const supabase = createClient({
  baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  anonKey: process.env.INSFORGE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  isServerMode: true,
})

// ─── Plan definitions ────────────────────────────────────────────────────────

export const PLAN_LIMITS: Record<string, { sessions: number; docs: number; api: boolean }> = {
  free:       { sessions: 10,       docs: 5,        api: false },
  starter:    { sessions: 50,       docs: 20,       api: false },
  pro:        { sessions: Infinity, docs: Infinity,  api: true  },
  enterprise: { sessions: Infinity, docs: Infinity,  api: true  },
}

export const PLAN_LABELS: Record<string, string> = {
  free:       'Free',
  starter:    'Starter',
  pro:        'Pro',
  enterprise: 'Enterprise',
}

export type PlanTier = 'free' | 'starter' | 'pro' | 'enterprise'

export interface Organization {
  id:                 string
  name:               string
  owner_email:        string
  plan:               PlanTier
  plan_status:        string
  ls_customer_id:     string | null
  ls_subscription_id: string | null
  paddle_customer_id:     string | null
  paddle_subscription_id: string | null
  paddle_price_id:        string | null
  sessions_used:      number
  docs_used:          number
  period_reset:       string
  created_at:         string
}

// ─── Usage helpers ────────────────────────────────────────────────────────────

/** Returns true if usage is within plan limits for sessions */
export async function checkSessionLimit(
  orgId: string
): Promise<{ allowed: boolean; used: number; limit: number; plan: PlanTier }> {
  const { data: org } = await supabase.database
    .from('dc_organizations')
    .select('plan, sessions_used, period_reset, plan_status')
    .eq('id', orgId)
    .single()

  if (!org) return { allowed: false, used: 0, limit: 0, plan: 'free' }

  // Auto-reset if period has passed
  if (new Date(org.period_reset) < new Date()) {
    await supabase.database
      .from('dc_organizations')
      .update({
        sessions_used: 0,
        docs_used: 0,
        period_reset: new Date(
          new Date().getFullYear(),
          new Date().getMonth() + 1,
          1
        ).toISOString(),
      })
      .eq('id', orgId)
    org.sessions_used = 0
  }

  const plan  = (org.plan || 'free') as PlanTier
  const limit = PLAN_LIMITS[plan]?.sessions ?? 10
  const used  = org.sessions_used ?? 0

  return { allowed: used < limit, used, limit, plan }
}

/** Returns true if usage is within plan limits for document analyses */
export async function checkDocLimit(
  orgId: string
): Promise<{ allowed: boolean; used: number; limit: number; plan: PlanTier }> {
  const { data: org } = await supabase.database
    .from('dc_organizations')
    .select('plan, docs_used, period_reset')
    .eq('id', orgId)
    .single()

  if (!org) return { allowed: false, used: 0, limit: 0, plan: 'free' }

  const plan  = (org.plan || 'free') as PlanTier
  const limit = PLAN_LIMITS[plan]?.docs ?? 5
  const used  = org.docs_used ?? 0

  return { allowed: used < limit, used, limit, plan }
}

/** Increments session usage counter */
export async function incrementSessionUsage(orgId: string): Promise<void> {
  await supabase.database.rpc('dc_increment_sessions', { org_id: orgId })
}

/** Increments document analysis usage counter */
export async function incrementDocUsage(orgId: string): Promise<void> {
  await supabase.database.rpc('dc_increment_docs', { org_id: orgId })
}

/** Get org by API key (for API v1 endpoints) */
export async function getOrgByApiKey(
  key: string
): Promise<Organization | null> {
  const { data: apiKey } = await supabase.database
    .from('dc_api_keys')
    .select('org_id, is_active')
    .eq('key', key)
    .single()

  if (!apiKey?.is_active || !apiKey.org_id) return null

  const { data: org } = await supabase.database
    .from('dc_organizations')
    .select('*')
    .eq('id', apiKey.org_id)
    .single()

  return org ?? null
}

/** Get plan usage summary for display in dashboard */
export async function getPlanUsage(orgId: string): Promise<{
  plan: PlanTier
  planLabel: string
  sessionsUsed: number
  sessionsLimit: number
  docsUsed: number
  docsLimit: number
  periodReset: string
  hasApi: boolean
  upgradeNeeded: boolean
} | null> {
  const { data: org } = await supabase.database
    .from('dc_organizations')
    .select('plan, sessions_used, docs_used, period_reset')
    .eq('id', orgId)
    .single()

  if (!org) return null

  const plan   = (org.plan || 'free') as PlanTier
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free

  return {
    plan,
    planLabel:     PLAN_LABELS[plan] ?? 'Free',
    sessionsUsed:  org.sessions_used ?? 0,
    sessionsLimit: limits.sessions === Infinity ? -1 : limits.sessions,
    docsUsed:      org.docs_used ?? 0,
    docsLimit:     limits.docs === Infinity ? -1 : limits.docs,
    periodReset:   org.period_reset,
    hasApi:        limits.api,
    upgradeNeeded: plan === 'free',
  }
}
