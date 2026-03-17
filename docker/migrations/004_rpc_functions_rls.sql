-- ============================================================================
-- Migration 004: RPC Functions + Row Level Security
-- ============================================================================
-- Adds atomic increment functions for usage counters and RLS policies
-- to prevent cross-tenant data access.

-- ── RPC: Atomic session counter increment ──────────────────────────────────
-- Called by planLimits.ts → incrementSessionUsage()
CREATE OR REPLACE FUNCTION dc_increment_sessions(p_org_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE dc_organizations
  SET sessions_used = sessions_used + 1,
      updated_at = now()
  WHERE id = p_org_id;
END;
$$;

-- ── RPC: Atomic document counter increment ─────────────────────────────────
-- Called by planLimits.ts → incrementDocUsage()
CREATE OR REPLACE FUNCTION dc_increment_docs(p_org_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE dc_organizations
  SET docs_used = docs_used + 1,
      updated_at = now()
  WHERE id = p_org_id;
END;
$$;

-- ── RPC: Reset monthly usage counters ──────────────────────────────────────
-- Can be called by cron or on-demand
CREATE OR REPLACE FUNCTION dc_reset_monthly_usage()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  affected INT;
BEGIN
  UPDATE dc_organizations
  SET sessions_used = 0,
      docs_used = 0,
      period_reset = date_trunc('month', now()) + interval '1 month',
      updated_at = now()
  WHERE period_reset < now();

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- ── RPC: Get org usage summary ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION dc_get_org_usage(p_org_id TEXT)
RETURNS TABLE(
  plan TEXT,
  sessions_used INT,
  docs_used INT,
  period_reset TIMESTAMPTZ,
  plan_status TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT plan, sessions_used, docs_used, period_reset, plan_status
  FROM dc_organizations
  WHERE id = p_org_id;
$$;

-- ── Enable Row Level Security ──────────────────────────────────────────────

-- Organizations: users can only see their own org
ALTER TABLE dc_organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY dc_org_select_own ON dc_organizations
  FOR SELECT USING (
    id IN (
      SELECT org_id FROM dc_org_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY dc_org_update_own ON dc_organizations
  FOR UPDATE USING (
    id IN (
      SELECT org_id FROM dc_org_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Org members: users can only see members of their own org
ALTER TABLE dc_org_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY dc_members_select_own ON dc_org_members
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM dc_org_members AS m
      WHERE m.user_id = auth.uid()
    )
  );

CREATE POLICY dc_members_insert_owner ON dc_org_members
  FOR INSERT WITH CHECK (
    org_id IN (
      SELECT org_id FROM dc_org_members AS m
      WHERE m.user_id = auth.uid() AND m.role = 'owner'
    )
  );

CREATE POLICY dc_members_delete_owner ON dc_org_members
  FOR DELETE USING (
    org_id IN (
      SELECT org_id FROM dc_org_members AS m
      WHERE m.user_id = auth.uid() AND m.role = 'owner'
    )
    AND user_id != auth.uid()  -- can't remove yourself
  );

-- Assessments: users can only access their org's assessments
ALTER TABLE dc_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY dc_assessments_select_org ON dc_assessments
  FOR SELECT USING (
    org_id IS NULL  -- legacy unassigned data visible to all
    OR org_id IN (
      SELECT org_id FROM dc_org_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY dc_assessments_insert_org ON dc_assessments
  FOR INSERT WITH CHECK (
    org_id IN (
      SELECT org_id FROM dc_org_members
      WHERE user_id = auth.uid()
    )
  );

-- Document analyses: users can only access their org's analyses
ALTER TABLE dc_document_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY dc_doc_analyses_select_org ON dc_document_analyses
  FOR SELECT USING (
    org_id IS NULL
    OR org_id IN (
      SELECT org_id FROM dc_org_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY dc_doc_analyses_insert_org ON dc_document_analyses
  FOR INSERT WITH CHECK (
    org_id IN (
      SELECT org_id FROM dc_org_members
      WHERE user_id = auth.uid()
    )
  );

-- API keys: users can only manage their org's API keys
ALTER TABLE dc_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY dc_api_keys_select_org ON dc_api_keys
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM dc_org_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY dc_api_keys_insert_org ON dc_api_keys
  FOR INSERT WITH CHECK (
    org_id IN (
      SELECT org_id FROM dc_org_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'member')
    )
  );

CREATE POLICY dc_api_keys_delete_owner ON dc_api_keys
  FOR DELETE USING (
    org_id IN (
      SELECT org_id FROM dc_org_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- ML feedback: users can see their org's feedback
ALTER TABLE dc_ml_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY dc_ml_feedback_select_org ON dc_ml_feedback
  FOR SELECT USING (
    org_id = 'global'
    OR org_id IN (
      SELECT org_id FROM dc_org_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY dc_ml_feedback_insert_org ON dc_ml_feedback
  FOR INSERT WITH CHECK (true);  -- anyone can submit feedback

-- ML models: readable by all (global models)
ALTER TABLE dc_ml_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY dc_ml_models_select_all ON dc_ml_models
  FOR SELECT USING (true);

-- ML training jobs: readable by all
ALTER TABLE dc_ml_training_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY dc_ml_jobs_select_all ON dc_ml_training_jobs
  FOR SELECT USING (true);

-- ── Service role bypass ────────────────────────────────────────────────────
-- Service role key (used by server-side API routes) bypasses RLS by default
-- in Supabase. This is the expected behavior — server routes use service role
-- for admin operations, while client-side uses anon key with RLS enforced.

-- ── Grant execute on RPC functions ─────────────────────────────────────────
GRANT EXECUTE ON FUNCTION dc_increment_sessions(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION dc_increment_docs(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION dc_reset_monthly_usage() TO service_role;
GRANT EXECUTE ON FUNCTION dc_get_org_usage(TEXT) TO authenticated, service_role;

-- ── Add starter plan to check constraint ───────────────────────────────────
-- Migration 002 only allowed free|pro|enterprise. Add starter.
ALTER TABLE dc_organizations DROP CONSTRAINT IF EXISTS dc_organizations_plan_check;
ALTER TABLE dc_organizations ADD CONSTRAINT dc_organizations_plan_check
  CHECK (plan IN ('free', 'starter', 'pro', 'enterprise'));
