-- ─────────────────────────────────────────────────────────────────────────────
-- Deep-Check INTEL — Extended PostgreSQL Schema (Air-Gap / Intel Mode)
--
-- This file extends the base schema in 01-init.sql with tables required for
-- air-gap operation. It is loaded as 02-intel-init.sql after the base schema.
--
-- Run manually:
--   docker compose -f docker-compose.intel.yml exec db \
--     psql -U deepcheck_intel -d deepcheck_intel \
--     -f /docker-entrypoint-initdb.d/02-intel-init.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Ensure extensions exist (idempotent — base schema may have already run) ──

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── dc_local_users ───────────────────────────────────────────────────────────
-- Local user accounts for air-gap authentication (no Supabase Auth).
-- Passwords are stored as PBKDF2-SHA256 hashes (format: pbkdf2$iters$salt$hash).

CREATE TABLE IF NOT EXISTS dc_local_users (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    username      TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    role          TEXT        NOT NULL DEFAULT 'analyst'
                              CHECK (role IN ('admin', 'analyst', 'viewer')),
    org_id        TEXT        NOT NULL DEFAULT 'local',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_local_users_username   ON dc_local_users (username);
CREATE INDEX IF NOT EXISTS idx_local_users_org_id     ON dc_local_users (org_id);
CREATE INDEX IF NOT EXISTS idx_local_users_created_at ON dc_local_users (created_at DESC);

-- Row-level security: users can only see their own row; admins can see all.
ALTER TABLE dc_local_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY local_users_self_select ON dc_local_users
    FOR SELECT
    USING (
        username = current_setting('app.current_user', true)
        OR current_setting('app.current_role', true) = 'admin'
    );

CREATE POLICY local_users_admin_all ON dc_local_users
    FOR ALL
    USING (current_setting('app.current_role', true) = 'admin');

GRANT SELECT, INSERT, UPDATE ON dc_local_users TO deepcheck_anon;

-- ─── dc_video_analyses ────────────────────────────────────────────────────────
-- Results from the local ONNX video deepfake detection pipeline.

CREATE TABLE IF NOT EXISTS dc_video_analyses (
    id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    filename             TEXT        NOT NULL,
    duration             NUMERIC(10,3),                  -- seconds
    total_frames         INTEGER,
    frames_analyzed      INTEGER,
    overall_risk_score   INTEGER     NOT NULL DEFAULT 0
                                     CHECK (overall_risk_score BETWEEN 0 AND 100),
    risk_level           TEXT        NOT NULL DEFAULT 'clean'
                                     CHECK (risk_level IN ('clean', 'suspicious', 'high_risk')),
    deepfake_score       NUMERIC(5,4),                   -- 0.0 – 1.0
    splicing_detected    BOOLEAN     NOT NULL DEFAULT FALSE,
    suspicious_segments  JSONB       NOT NULL DEFAULT '[]',
    -- Each element: { startSec, endSec, score, type }
    frame_results        JSONB       NOT NULL DEFAULT '[]',
    -- Each element: { frameIndex, timestamp, score, anomalyType }
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    org_id               TEXT        NOT NULL DEFAULT 'local'
);

CREATE INDEX IF NOT EXISTS idx_video_analyses_created_at  ON dc_video_analyses (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_analyses_org_id      ON dc_video_analyses (org_id);
CREATE INDEX IF NOT EXISTS idx_video_analyses_risk_level  ON dc_video_analyses (risk_level);

GRANT SELECT, INSERT, UPDATE, DELETE ON dc_video_analyses TO deepcheck_anon;

-- ─── dc_osint_requests ────────────────────────────────────────────────────────
-- OSINT enrichment requests processed offline via local threat-intelligence feeds.

CREATE TABLE IF NOT EXISTS dc_osint_requests (
    id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_url       TEXT        NOT NULL,
    source_type      TEXT        NOT NULL DEFAULT 'url'
                                  CHECK (source_type IN ('url', 'ip', 'domain', 'hash', 'email', 'phone')),
    analysis_result  JSONB       NOT NULL DEFAULT '{}',
    -- Structured findings: { indicators[], threats[], iocs[], verdict }
    stix_bundle      JSONB       NOT NULL DEFAULT '{}',
    -- STIX 2.1 bundle for Maltego / other tools
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    analyst_id       UUID        REFERENCES dc_local_users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_osint_requests_created_at  ON dc_osint_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_osint_requests_analyst_id  ON dc_osint_requests (analyst_id);
CREATE INDEX IF NOT EXISTS idx_osint_requests_source_type ON dc_osint_requests (source_type);

GRANT SELECT, INSERT, UPDATE, DELETE ON dc_osint_requests TO deepcheck_anon;

-- ─── dc_licenses ─────────────────────────────────────────────────────────────
-- Activated license records. Only one active license per deployment expected.

CREATE TABLE IF NOT EXISTS dc_licenses (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    license_key  TEXT        NOT NULL UNIQUE,
    org_name     TEXT        NOT NULL,
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL,
    features     JSONB       NOT NULL DEFAULT '[]'
    -- Array of feature strings: ["video","osint","maltego","airgap","batch"]
);

CREATE INDEX IF NOT EXISTS idx_licenses_expires_at ON dc_licenses (expires_at);
CREATE INDEX IF NOT EXISTS idx_licenses_org_name   ON dc_licenses (org_name);

-- Only admins may read or modify license records
ALTER TABLE dc_licenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY licenses_admin_only ON dc_licenses
    FOR ALL
    USING (current_setting('app.current_role', true) = 'admin');

GRANT SELECT, INSERT, UPDATE ON dc_licenses TO deepcheck_anon;

-- ─── Helper: update last_login timestamp ─────────────────────────────────────

CREATE OR REPLACE FUNCTION dc_update_last_login(p_username TEXT) RETURNS void AS $$
BEGIN
    UPDATE dc_local_users
    SET last_login = NOW()
    WHERE username = p_username;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Done ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
    RAISE NOTICE 'Deep-Check INTEL schema (02-intel-init.sql) initialised successfully.';
END $$;
