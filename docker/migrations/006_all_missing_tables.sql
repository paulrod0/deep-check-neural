-- ─────────────────────────────────────────────────────────────────────────────
-- 006_all_missing_tables.sql — Complete set of dc_* tables
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates all dc_* tables referenced in code. Uses IF NOT EXISTS so it's
-- safe to run multiple times. Also enables RLS + adds indexes.
--
-- Tables created:
--   1. dc_webhook_deliveries  — Reliable webhook delivery + retry tracking
--   2. dc_audit_log           — Hash-chain tamper-evident audit trail
--   3. dc_ml_feedback         — ML continuous learning feedback collection
--   4. dc_ml_models           — Model version tracking
--   5. dc_ml_training_jobs    — SageMaker training job tracking
--   6. dc_video_analyses      — Deepfake video analysis storage
--   7. dc_deepfake_audit      — Hash-chain deepfake audit blocks
--   8. dc_gdpr_requests       — GDPR data access/erasure requests
--   9. dc_osint_webhooks      — OSINT webhook registrations
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. dc_webhook_deliveries
CREATE TABLE IF NOT EXISTS dc_webhook_deliveries (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  org_id        TEXT REFERENCES dc_organizations(id) ON DELETE SET NULL,
  api_key_id    TEXT,
  webhook_url   TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  payload       JSONB DEFAULT '{}'::JSONB,
  status        TEXT NOT NULL DEFAULT 'pending',
  attempts      INT DEFAULT 0,
  max_attempts  INT DEFAULT 5,
  response_code INT,
  response_body TEXT,
  error_message TEXT,
  next_retry_at TIMESTAMPTZ,
  delivered_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wh_deliveries_org ON dc_webhook_deliveries (org_id);
CREATE INDEX IF NOT EXISTS idx_wh_deliveries_status ON dc_webhook_deliveries (status);
CREATE INDEX IF NOT EXISTS idx_wh_deliveries_created ON dc_webhook_deliveries (created_at DESC);

-- 2. dc_audit_log (hash-chain)
CREATE TABLE IF NOT EXISTS dc_audit_log (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        TEXT REFERENCES dc_organizations(id) ON DELETE SET NULL,
  actor_id      TEXT,
  actor_email   TEXT,
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  details       JSONB DEFAULT '{}'::JSONB,
  ip_address    TEXT,
  user_agent    TEXT,
  prev_hash     TEXT NOT NULL DEFAULT 'genesis',
  entry_hash    TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_org ON dc_audit_log (org_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON dc_audit_log (action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON dc_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_hash ON dc_audit_log (entry_hash);

-- 3. dc_ml_feedback
CREATE TABLE IF NOT EXISTS dc_ml_feedback (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  org_id           TEXT REFERENCES dc_organizations(id) ON DELETE SET NULL,
  analysis_id      TEXT,
  predicted_label  TEXT NOT NULL,
  predicted_score  NUMERIC DEFAULT 0,
  actual_label     TEXT NOT NULL,
  document_type    TEXT DEFAULT 'unknown',
  image_hash       TEXT DEFAULT '',
  notes            TEXT DEFAULT '',
  used_in_training BOOLEAN DEFAULT FALSE,
  training_job     TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ml_feedback_org ON dc_ml_feedback (org_id);
CREATE INDEX IF NOT EXISTS idx_ml_feedback_unused ON dc_ml_feedback (org_id, used_in_training) WHERE used_in_training = FALSE;
CREATE INDEX IF NOT EXISTS idx_ml_feedback_created ON dc_ml_feedback (created_at DESC);

-- 4. dc_ml_models
CREATE TABLE IF NOT EXISTS dc_ml_models (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  org_id       TEXT REFERENCES dc_organizations(id) ON DELETE SET NULL,
  version      INT DEFAULT 1,
  model_uri    TEXT,
  auc          NUMERIC,
  f1_score     NUMERIC,
  status       TEXT DEFAULT 'active',
  training_job TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ml_models_org ON dc_ml_models (org_id);
CREATE INDEX IF NOT EXISTS idx_ml_models_active ON dc_ml_models (org_id, status) WHERE status = 'active';

-- 5. dc_ml_training_jobs
CREATE TABLE IF NOT EXISTS dc_ml_training_jobs (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  org_id          TEXT REFERENCES dc_organizations(id) ON DELETE SET NULL,
  job_name        TEXT NOT NULL,
  status          TEXT DEFAULT 'pending',
  feedback_count  INT DEFAULT 0,
  metrics         JSONB DEFAULT '{}'::JSONB,
  error_message   TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ml_jobs_org ON dc_ml_training_jobs (org_id);
CREATE INDEX IF NOT EXISTS idx_ml_jobs_status ON dc_ml_training_jobs (status);

-- 6. dc_video_analyses
CREATE TABLE IF NOT EXISTS dc_video_analyses (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  filename            TEXT,
  duration            NUMERIC,
  total_frames        INT,
  frames_analyzed     INT,
  overall_risk_score  NUMERIC,
  risk_level          TEXT,
  deepfake_score      NUMERIC,
  splicing_detected   BOOLEAN DEFAULT FALSE,
  suspicious_segments JSONB DEFAULT '[]'::JSONB,
  codec               TEXT,
  width               INT,
  height              INT,
  fps                 NUMERIC,
  summary             TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_video_analyses_risk ON dc_video_analyses (risk_level);
CREATE INDEX IF NOT EXISTS idx_video_analyses_created ON dc_video_analyses (created_at DESC);

-- 7. dc_deepfake_audit
CREATE TABLE IF NOT EXISTS dc_deepfake_audit (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  assessment_id TEXT NOT NULL,
  block_index   INT NOT NULL,
  block_hash    TEXT NOT NULL,
  prev_hash     TEXT DEFAULT 'genesis',
  payload       JSONB DEFAULT '{}'::JSONB,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(assessment_id, block_index)
);
CREATE INDEX IF NOT EXISTS idx_deepfake_audit_assessment ON dc_deepfake_audit (assessment_id);

-- 8. dc_gdpr_requests
CREATE TABLE IF NOT EXISTS dc_gdpr_requests (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  org_id           TEXT REFERENCES dc_organizations(id) ON DELETE SET NULL,
  requester_email  TEXT NOT NULL,
  request_type     TEXT NOT NULL,
  status           TEXT DEFAULT 'pending',
  data_url         TEXT,
  completed_at     TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gdpr_requests_org ON dc_gdpr_requests (org_id);
CREATE INDEX IF NOT EXISTS idx_gdpr_requests_status ON dc_gdpr_requests (status);

-- 9. dc_osint_webhooks
CREATE TABLE IF NOT EXISTS dc_osint_webhooks (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  org_id      TEXT REFERENCES dc_organizations(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  events      TEXT[] DEFAULT ARRAY['osint.complete'],
  secret      TEXT,
  active      BOOLEAN DEFAULT TRUE,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_osint_webhooks_org ON dc_osint_webhooks (org_id);
CREATE INDEX IF NOT EXISTS idx_osint_webhooks_active ON dc_osint_webhooks (active) WHERE active = TRUE;

-- ── Enable RLS on all tables ─────────────────────────────────────────────────
ALTER TABLE dc_webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE dc_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE dc_ml_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE dc_ml_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE dc_ml_training_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dc_video_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE dc_deepfake_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE dc_gdpr_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE dc_osint_webhooks ENABLE ROW LEVEL SECURITY;

-- Also enable RLS on legacy tables that were missing it
ALTER TABLE dc_org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE dc_enrollment_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE dc_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE dc_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE dc_organizations ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies (service role full access) ──────────────────────────────────
CREATE POLICY "service_all_webhook_deliveries" ON dc_webhook_deliveries FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_all_audit_log" ON dc_audit_log FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_all_ml_feedback" ON dc_ml_feedback FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_all_ml_models" ON dc_ml_models FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_all_ml_training_jobs" ON dc_ml_training_jobs FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_all_video_analyses" ON dc_video_analyses FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_all_deepfake_audit" ON dc_deepfake_audit FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_all_gdpr_requests" ON dc_gdpr_requests FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_all_osint_webhooks" ON dc_osint_webhooks FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_all_org_members" ON dc_org_members FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_all_enrollment_profiles" ON dc_enrollment_profiles FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_all_assessments" ON dc_assessments FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_all_api_keys" ON dc_api_keys FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_all_organizations" ON dc_organizations FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ── Missing FK indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_api_keys_org_id ON dc_api_keys (org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON dc_org_members (org_id);
