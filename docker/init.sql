-- ─────────────────────────────────────────────────────────────────────────────
-- Deep-Check · On-Premise PostgreSQL Schema
-- Compatible with the Supabase-hosted version (same table names and structure)
-- Run once: docker compose exec db psql -U deepcheck -d deepcheck < docker/init.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Roles for PostgREST (Supabase-compatible)
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'deepcheck_anon') THEN
        CREATE ROLE deepcheck_anon NOLOGIN;
    END IF;
END $$;

GRANT USAGE ON SCHEMA public TO deepcheck_anon;

-- ─── dc_assessments ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dc_assessments (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    candidate_name       TEXT NOT NULL,
    role                 TEXT,
    date                 TEXT,
    score                INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
    status               TEXT NOT NULL CHECK (status IN ('passed', 'review', 'flagged')),
    alerts               JSONB NOT NULL DEFAULT '[]',
    evidence             JSONB NOT NULL DEFAULT '[]',
    liveness_score       NUMERIC(5,2),
    ai_risk              NUMERIC(5,2),
    keystroke_count      INTEGER,
    tab_switch_count     INTEGER,
    gaze_event_count     INTEGER,
    identity_match_score NUMERIC(5,2),
    session_hash         TEXT,
    certificate_issued   BOOLEAN DEFAULT FALSE,
    submitted_by         TEXT,
    api_key_id           UUID
);

CREATE INDEX IF NOT EXISTS idx_assessments_created  ON dc_assessments (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessments_status   ON dc_assessments (status);
CREATE INDEX IF NOT EXISTS idx_assessments_candidate ON dc_assessments (candidate_name);

GRANT SELECT, INSERT, UPDATE ON dc_assessments TO deepcheck_anon;

-- ─── dc_enrollment_profiles ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dc_enrollment_profiles (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at       TIMESTAMPTZ NOT NULL,
    candidate_name   TEXT NOT NULL,
    candidate_email  TEXT,
    context          TEXT,
    profile          JSONB NOT NULL,
    enrollment_hash  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_enrollment_hash  ON dc_enrollment_profiles (enrollment_hash);
CREATE INDEX IF NOT EXISTS idx_enrollment_email ON dc_enrollment_profiles (candidate_email);

GRANT SELECT, INSERT, UPDATE ON dc_enrollment_profiles TO deepcheck_anon;

-- ─── dc_api_keys ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dc_api_keys (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    key         TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    last_used   TIMESTAMPTZ,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    permissions JSONB NOT NULL DEFAULT '["read","write"]',
    webhook_url TEXT
);

GRANT SELECT, INSERT, UPDATE ON dc_api_keys TO deepcheck_anon;

-- ─── dc_admin_sessions ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dc_admin_sessions (
    token       TEXT PRIMARY KEY,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL,
    ip_hash     TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON dc_admin_sessions (expires_at);

GRANT SELECT, INSERT, DELETE ON dc_admin_sessions TO deepcheck_anon;

-- ─── dc_audit_logs ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dc_audit_logs (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type   TEXT NOT NULL,
    endpoint     TEXT,
    method       TEXT,
    ip_hash      TEXT,
    status_code  INTEGER,
    duration_ms  INTEGER,
    details      JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_audit_created    ON dc_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_event_type ON dc_audit_logs (event_type);

GRANT INSERT ON dc_audit_logs TO deepcheck_anon;

-- ─── dc_document_analyses ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dc_document_analyses (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    filename      TEXT NOT NULL,
    file_size     BIGINT,
    mime_type     TEXT,
    risk_score    INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
    risk_level    TEXT NOT NULL CHECK (risk_level IN ('clean', 'suspicious', 'high_risk')),
    ela_score     INTEGER DEFAULT 0,
    exif_score    INTEGER DEFAULT 0,
    noise_score   INTEGER DEFAULT 0,
    alerts        JSONB NOT NULL DEFAULT '[]',
    exif_data     JSONB NOT NULL DEFAULT '{}',
    findings      JSONB NOT NULL DEFAULT '{}',
    thumbnail_url TEXT,
    ela_image_url TEXT,
    case_ref      TEXT,
    submitted_by  TEXT,
    notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_docs_created   ON dc_document_analyses (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_docs_risk      ON dc_document_analyses (risk_level);
CREATE INDEX IF NOT EXISTS idx_docs_case_ref  ON dc_document_analyses (case_ref);

GRANT SELECT, INSERT, UPDATE, DELETE ON dc_document_analyses TO deepcheck_anon;

-- ─── dc_deepfake_audit ────────────────────────────────────────────────────────
-- Veritas Engine v2 — tamper-evident SHA-256 block chain of forensic evidence

CREATE TABLE IF NOT EXISTS dc_deepfake_audit (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assessment_id UUID REFERENCES dc_assessments(id) ON DELETE CASCADE,
    block_index   INTEGER NOT NULL,
    block_hash    TEXT NOT NULL,
    prev_hash     TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
    timestamp     BIGINT NOT NULL,
    layer         TEXT NOT NULL CHECK (layer IN ('rppg','facs','cnn_v1','cnn_v2','efficientnet','keystroke','ensemble','session_start','session_end')),
    payload       JSONB NOT NULL DEFAULT '{}',
    chain_valid   BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_deepfake_audit_assessment ON dc_deepfake_audit (assessment_id, block_index);
CREATE INDEX IF NOT EXISTS idx_deepfake_audit_layer      ON dc_deepfake_audit (layer);

GRANT SELECT, INSERT ON dc_deepfake_audit TO deepcheck_anon;

-- ─── Cleanup expired sessions (cron-like, call periodically) ─────────────────

CREATE OR REPLACE FUNCTION dc_cleanup_expired_sessions() RETURNS void AS $$
BEGIN
    DELETE FROM dc_admin_sessions WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- ─── Row-level security (optional, enable for multi-tenant) ──────────────────

-- ALTER TABLE dc_assessments ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY tenant_isolation ON dc_assessments USING (submitted_by = current_setting('app.tenant_id'));

-- ─── Done ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
    RAISE NOTICE 'Deep-Check schema initialised successfully.';
END $$;
