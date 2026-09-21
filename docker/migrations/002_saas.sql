-- ============================================================
-- Deep-Check SaaS Layer — Migration 002
-- Adds: dc_organizations, dc_org_members
-- Alters: dc_assessments, dc_document_analyses, dc_api_keys
-- ============================================================

-- Organizations (one per customer account)
CREATE TABLE IF NOT EXISTS dc_organizations (
  id                 TEXT PRIMARY KEY DEFAULT 'org_' || replace(gen_random_uuid()::text, '-', ''),
  name               TEXT NOT NULL DEFAULT 'My Organization',
  owner_email        TEXT NOT NULL UNIQUE,
  plan               TEXT NOT NULL DEFAULT 'free'
                     CHECK (plan IN ('free', 'pro', 'enterprise')),
  ls_customer_id     TEXT,
  ls_subscription_id TEXT,
  ls_variant_id      TEXT,
  plan_status        TEXT NOT NULL DEFAULT 'active'
                     CHECK (plan_status IN ('active', 'paused', 'cancelled', 'expired')),
  sessions_used      INT  NOT NULL DEFAULT 0,
  docs_used          INT  NOT NULL DEFAULT 0,
  period_reset       TIMESTAMPTZ NOT NULL DEFAULT
                       date_trunc('month', now()) + interval '1 month',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Members of an organization (owner + future team members)
CREATE TABLE IF NOT EXISTS dc_org_members (
  id         TEXT        PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
  org_id     TEXT        NOT NULL REFERENCES dc_organizations(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL,  -- Supabase auth.users.id
  role       TEXT        NOT NULL DEFAULT 'owner'
             CHECK (role IN ('owner', 'member', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

-- Link existing tables to organizations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='dc_assessments' AND column_name='org_id'
  ) THEN
    ALTER TABLE dc_assessments ADD COLUMN org_id TEXT REFERENCES dc_organizations(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='dc_document_analyses' AND column_name='org_id'
  ) THEN
    ALTER TABLE dc_document_analyses ADD COLUMN org_id TEXT REFERENCES dc_organizations(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='dc_api_keys' AND column_name='org_id'
  ) THEN
    ALTER TABLE dc_api_keys ADD COLUMN org_id TEXT REFERENCES dc_organizations(id);
  END IF;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_dc_orgs_owner_email     ON dc_organizations(owner_email);
CREATE INDEX IF NOT EXISTS idx_dc_orgs_ls_sub          ON dc_organizations(ls_subscription_id);
CREATE INDEX IF NOT EXISTS idx_dc_org_members_user     ON dc_org_members(user_id);
CREATE INDEX IF NOT EXISTS idx_dc_assessments_org      ON dc_assessments(org_id);
CREATE INDEX IF NOT EXISTS idx_dc_doc_analyses_org     ON dc_document_analyses(org_id);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION dc_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS dc_organizations_updated_at ON dc_organizations;
CREATE TRIGGER dc_organizations_updated_at
  BEFORE UPDATE ON dc_organizations
  FOR EACH ROW EXECUTE FUNCTION dc_set_updated_at();
