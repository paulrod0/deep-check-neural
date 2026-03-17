-- ============================================================================
-- Migration 005: Audit Trail + Webhook Delivery
-- ============================================================================
-- Enterprise-grade audit logging with hash chain integrity
-- and reliable webhook delivery with exponential backoff retry.

-- ── Audit Trail ────────────────────────────────────────────────────────────
-- Immutable append-only log. Each entry includes a hash of the previous
-- entry, creating a tamper-evident chain similar to blockchain.

CREATE TABLE IF NOT EXISTS dc_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  org_id          TEXT NOT NULL,
  actor_id        TEXT,              -- user_id or 'system' or API key prefix
  actor_email     TEXT,
  action          TEXT NOT NULL,     -- e.g. 'document.analyze', 'session.create', 'member.invite'
  resource_type   TEXT,              -- 'document', 'session', 'member', 'api_key', 'org', etc.
  resource_id     TEXT,
  details         JSONB DEFAULT '{}',-- action-specific metadata
  ip_address      TEXT,
  user_agent      TEXT,
  prev_hash       TEXT,              -- SHA-256 hash of previous entry (chain integrity)
  entry_hash      TEXT NOT NULL,     -- SHA-256 hash of this entry
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_audit_log_org       ON dc_audit_log(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor     ON dc_audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action    ON dc_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource  ON dc_audit_log(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created   ON dc_audit_log(created_at);

-- RLS: users can only read their org's audit log
ALTER TABLE dc_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY dc_audit_log_select_org ON dc_audit_log
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM dc_org_members
      WHERE user_id = auth.uid()
    )
  );

-- Insert is service_role only (server-side routes)
CREATE POLICY dc_audit_log_insert_service ON dc_audit_log
  FOR INSERT WITH CHECK (true);

-- ── Webhook Deliveries ─────────────────────────────────────────────────────
-- Tracks every webhook delivery attempt with retry logic.

CREATE TABLE IF NOT EXISTS dc_webhook_deliveries (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id          TEXT NOT NULL,
  api_key_id      TEXT,              -- which API key's webhook URL
  webhook_url     TEXT NOT NULL,
  event_type      TEXT NOT NULL,     -- 'verification.completed', 'session.flagged', etc.
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'delivered', 'failed', 'retrying')),
  attempts        INT NOT NULL DEFAULT 0,
  max_attempts    INT NOT NULL DEFAULT 5,
  last_attempt_at TIMESTAMPTZ,
  next_retry_at   TIMESTAMPTZ,
  response_status INT,               -- HTTP status code of last attempt
  response_body   TEXT,               -- truncated response body
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhook_org       ON dc_webhook_deliveries(org_id);
CREATE INDEX IF NOT EXISTS idx_webhook_status    ON dc_webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_webhook_retry     ON dc_webhook_deliveries(status, next_retry_at)
  WHERE status IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_webhook_created   ON dc_webhook_deliveries(created_at);

-- RLS: org-scoped reads
ALTER TABLE dc_webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY dc_webhook_select_org ON dc_webhook_deliveries
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM dc_org_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY dc_webhook_insert_service ON dc_webhook_deliveries
  FOR INSERT WITH CHECK (true);

CREATE POLICY dc_webhook_update_service ON dc_webhook_deliveries
  FOR UPDATE USING (true);

-- ── GDPR Data Requests ─────────────────────────────────────────────────────
-- Tracks data export and deletion requests for GDPR compliance.

CREATE TABLE IF NOT EXISTS dc_gdpr_requests (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id          TEXT NOT NULL,
  requester_email TEXT NOT NULL,
  request_type    TEXT NOT NULL CHECK (request_type IN ('export', 'deletion')),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  data_url        TEXT,              -- S3/local URL for export downloads
  completed_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,       -- export download link expiry
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gdpr_org ON dc_gdpr_requests(org_id);
CREATE INDEX IF NOT EXISTS idx_gdpr_status ON dc_gdpr_requests(status);

ALTER TABLE dc_gdpr_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY dc_gdpr_select_org ON dc_gdpr_requests
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM dc_org_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

CREATE POLICY dc_gdpr_insert_service ON dc_gdpr_requests
  FOR INSERT WITH CHECK (true);

CREATE POLICY dc_gdpr_update_service ON dc_gdpr_requests
  FOR UPDATE USING (true);
