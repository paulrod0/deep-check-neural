-- ============================================================
-- Deep-Check — Migration 008: org_id scoping backfill
-- ============================================================
--
-- PURPOSE
--   Group A (IDOR cross-tenant) hardening. The application now scopes every
--   tenant-owned read/write by org_id (see src/lib/db.ts, the v1 sessions
--   endpoints and /api/osint/stix). Any pre-existing row whose org_id is still
--   NULL would become INVISIBLE to its legitimate tenant once scoping is live
--   (queries fail-closed: no org -> no rows).
--
--   This migration backfills org_id on the tenant-owned tables so historical
--   data keeps belonging to a real organization after the scoping deploys.
--
--   >>> THIS MIGRATION MUST RUN *BEFORE* DEPLOYING THE org_id SCOPING CODE. <<<
--   >>> If you deploy the code first, scoped queries will return EMPTY for   <<<
--   >>> every row that still has org_id IS NULL.                            <<<
--
-- TABLES TOUCHED (org_id column added in migration 002 unless noted):
--   dc_assessments          (org_id added in 002)
--   dc_document_analyses    (org_id added in 002) -- the table behind STIX export
--   dc_api_keys             (org_id added in 002)
--   dc_enrollment_profiles  (org_id added HERE — was missing) -- "dc_profiles"
--
-- BACKFILL STRATEGY (ASSUMPTION — see risks):
--   There is no explicit "default organization" flag in the schema. We assign
--   every orphaned (org_id IS NULL) row to the OLDEST organization
--   (MIN(created_at) in dc_organizations), i.e. the primary/owner account.
--   This is the conservative single-tenant assumption: most existing
--   installs have exactly one org (the account owner). If you run multiple
--   orgs and need a different mapping, adjust the SELECT below before running.
--
-- IDEMPOTENT: every statement is guarded (IF EXISTS / IF NOT EXISTS /
--             WHERE org_id IS NULL). Safe to run multiple times.
-- ============================================================

DO $$
DECLARE
  default_org_id TEXT;
BEGIN
  -- Resolve the default org (oldest organization = primary account owner).
  SELECT id INTO default_org_id
  FROM dc_organizations
  ORDER BY created_at ASC, id ASC
  LIMIT 1;

  -- No organizations exist yet -> nothing to backfill against. Bail safely.
  IF default_org_id IS NULL THEN
    RAISE NOTICE '[008] No organizations found — skipping org_id backfill.';
    RETURN;
  END IF;

  RAISE NOTICE '[008] Backfilling NULL org_id rows to default org %', default_org_id;

  -- ── dc_enrollment_profiles: add org_id column if missing, then backfill ──
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'dc_enrollment_profiles'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'dc_enrollment_profiles' AND column_name = 'org_id'
    ) THEN
      ALTER TABLE dc_enrollment_profiles
        ADD COLUMN org_id TEXT REFERENCES dc_organizations(id);
      RAISE NOTICE '[008] Added org_id column to dc_enrollment_profiles.';
    END IF;

    UPDATE dc_enrollment_profiles
      SET org_id = default_org_id
      WHERE org_id IS NULL;
  END IF;

  -- ── dc_assessments ──
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dc_assessments' AND column_name = 'org_id'
  ) THEN
    UPDATE dc_assessments
      SET org_id = default_org_id
      WHERE org_id IS NULL;
  END IF;

  -- ── dc_document_analyses (source table for /api/osint/stix exports) ──
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dc_document_analyses' AND column_name = 'org_id'
  ) THEN
    UPDATE dc_document_analyses
      SET org_id = default_org_id
      WHERE org_id IS NULL;
  END IF;

  -- ── dc_api_keys ──
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dc_api_keys' AND column_name = 'org_id'
  ) THEN
    UPDATE dc_api_keys
      SET org_id = default_org_id
      WHERE org_id IS NULL;
  END IF;

  -- ── dc_document_analyses: score_source (server vs client-reported forensics) ──
  -- Used by POST /api/documents to flag whether the risk score was recomputed
  -- server-side or self-reported by the client.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'dc_document_analyses'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dc_document_analyses' AND column_name = 'score_source'
  ) THEN
    ALTER TABLE dc_document_analyses ADD COLUMN score_source TEXT;
    RAISE NOTICE '[008] Added score_source column to dc_document_analyses.';
  END IF;

  -- ── dc_deepfake_audit: org_id (audit-chain scoping; column missing in 006) ──
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'dc_deepfake_audit'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'dc_deepfake_audit' AND column_name = 'org_id'
    ) THEN
      ALTER TABLE dc_deepfake_audit ADD COLUMN org_id TEXT REFERENCES dc_organizations(id);
      RAISE NOTICE '[008] Added org_id column to dc_deepfake_audit.';
    END IF;
    UPDATE dc_deepfake_audit
      SET org_id = default_org_id
      WHERE org_id IS NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dc_deepfake_audit_org
  ON dc_deepfake_audit (org_id);

-- Index for the enrollment-profiles scope lookup (created_at + org filter path).
CREATE INDEX IF NOT EXISTS idx_dc_enrollment_profiles_org
  ON dc_enrollment_profiles (org_id);
