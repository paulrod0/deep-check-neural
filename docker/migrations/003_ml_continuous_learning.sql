-- ============================================================================
-- Migration 003: ML Continuous Learning Tables
-- ============================================================================
-- Stores user feedback and model versions for the continuous learning system.
-- The model improves with every document verification.

-- ── ML Feedback Table ──────────────────────────────────────────────────────
-- Stores labeled feedback from users to improve the ML model.
CREATE TABLE IF NOT EXISTS dc_ml_feedback (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id          TEXT NOT NULL,
  analysis_id     TEXT NOT NULL,
  predicted_label TEXT NOT NULL,    -- 'genuine', 'suspicious', 'tampered'
  predicted_score REAL DEFAULT 0,   -- Model's raw score [0-100]
  actual_label    TEXT NOT NULL,    -- 'genuine' or 'tampered' (user correction)
  document_type   TEXT DEFAULT 'unknown',
  image_hash      TEXT DEFAULT '',  -- For deduplication
  notes           TEXT DEFAULT '',
  used_in_training BOOLEAN DEFAULT FALSE,
  training_job    TEXT,             -- SageMaker job name (if used)
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ml_feedback_org ON dc_ml_feedback(org_id);
CREATE INDEX IF NOT EXISTS idx_ml_feedback_unused ON dc_ml_feedback(org_id, used_in_training)
  WHERE used_in_training = FALSE;

-- ── ML Model Versions ──────────────────────────────────────────────────────
-- Tracks every model version trained, with metrics for comparison.
CREATE TABLE IF NOT EXISTS dc_ml_models (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id          TEXT NOT NULL,
  training_job    TEXT,              -- SageMaker job name
  auc             REAL NOT NULL,
  accuracy        REAL NOT NULL,
  f1              REAL NOT NULL,
  training_samples INT DEFAULT 0,
  model_path      TEXT NOT NULL,     -- S3 path or local path
  deployed        BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ml_models_org ON dc_ml_models(org_id);
CREATE INDEX IF NOT EXISTS idx_ml_models_deployed ON dc_ml_models(org_id, deployed)
  WHERE deployed = TRUE;

-- ── ML Training Jobs ───────────────────────────────────────────────────────
-- Tracks SageMaker training jobs for audit and monitoring.
CREATE TABLE IF NOT EXISTS dc_ml_training_jobs (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id          TEXT NOT NULL,
  job_name        TEXT UNIQUE NOT NULL,
  status          TEXT DEFAULT 'pending',  -- pending, running, completed, failed, deployed
  feedback_count  INT DEFAULT 0,
  metrics_auc     REAL,
  metrics_f1      REAL,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ml_jobs_org ON dc_ml_training_jobs(org_id);

-- ── Insert default global model ────────────────────────────────────────────
-- The base model trained from HuggingFace datasets.
INSERT INTO dc_ml_models (org_id, training_job, auc, accuracy, f1, training_samples,
                          model_path, deployed)
VALUES ('global', 'initial-training', 0.8535, 0.842, 0.8987, 1960,
        'public/models/efficientnet_doc_fraud.onnx', TRUE)
ON CONFLICT DO NOTHING;
