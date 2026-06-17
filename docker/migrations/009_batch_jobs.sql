-- ============================================================
-- Deep-Check — Migration 009: durable batch jobs (dc_batch_jobs)
-- ============================================================
--
-- PURPOSE
--   Group D (durable batch). The /api/v1/batch endpoint previously kept job
--   state in an in-process Map (jobStore). On Vercel serverless that Map is
--   NOT shared across lambda invocations: the POST that creates a job and the
--   GET that polls it routinely land on different instances, so polling almost
--   always returned 404 ("job not found"). The fire-and-forget background work
--   also got frozen once the response was sent, and the setTimeout cleanup
--   never ran.
--
--   This table persists batch-job state so any invocation can read/advance it,
--   and the background processing uses next/server `after()` to survive past
--   the HTTP response.
--
--   >>> THIS MIGRATION MUST RUN *BEFORE* DEPLOYING THE durable batch code.  <<<
--   >>> If you deploy the code first, POST/GET will fail to read/write the   <<<
--   >>> dc_batch_jobs table (relation does not exist).                       <<<
--
-- IDOR SCOPING
--   org_id is mandatory tenant scope: POST stores keyRecord.orgId, GET filters
--   by org_id so one tenant can never poll another tenant's job.
--
-- IDEMPOTENT: CREATE TABLE / INDEX IF NOT EXISTS. Safe to run multiple times.
--
-- CLEANUP: rows are intentionally retained (no TTL here). Pruning completed
--          jobs by age is a separate cron/TTL task.
-- ============================================================

CREATE TABLE IF NOT EXISTS dc_batch_jobs (
  job_id              TEXT PRIMARY KEY,
  org_id              TEXT REFERENCES dc_organizations(id),
  status              TEXT NOT NULL DEFAULT 'processing',
  total_documents     INT  NOT NULL DEFAULT 0,
  processed_documents INT  NOT NULL DEFAULT 0,
  verdicts            JSONB,
  results             JSONB,
  webhook_url         TEXT,
  external_ref        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ
);

-- Tenant-scoped polling path: GET filters .eq('org_id', keyRecord.orgId).
CREATE INDEX IF NOT EXISTS idx_dc_batch_jobs_org
  ON dc_batch_jobs (org_id);

COMMENT ON TABLE dc_batch_jobs IS
  'Durable async batch-verification jobs for /api/v1/batch. Replaces the in-memory jobStore Map so Vercel serverless invocations share job state. org_id scopes polling per tenant.';
