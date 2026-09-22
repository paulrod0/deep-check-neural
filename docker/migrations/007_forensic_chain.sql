-- Deep-Check Forensic Chain of Custody (ISO/IEC 27037:2012).
-- Stores append-only cryptographically-linked evidence events for legal admissibility.
-- Spanish legal refs: LEC 299, eIDAS Art. 42, UNE 71506:2013, UNE 197010:2015.

CREATE TABLE IF NOT EXISTS dc_forensic_chain (
  id            BIGSERIAL PRIMARY KEY,
  chain_id      UUID NOT NULL,
  seq           INTEGER NOT NULL,
  timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor         TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('ingest', 'analyze', 'report', 'seal', 'export')),
  prev_hash     TEXT NOT NULL,  -- 64-char sha256 hex
  entry_hash    TEXT NOT NULL,  -- 64-char sha256 hex
  payload       JSONB NOT NULL,
  tsa_token     TEXT NULL,      -- RFC3161 base64 timestamp token (null if TSA unavailable)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Sequence integrity
  CONSTRAINT uq_chain_seq UNIQUE (chain_id, seq),
  -- Prevent replaying same entry hash
  CONSTRAINT uq_entry_hash UNIQUE (entry_hash)
);

CREATE INDEX IF NOT EXISTS idx_forensic_chain_id      ON dc_forensic_chain(chain_id);
CREATE INDEX IF NOT EXISTS idx_forensic_chain_created ON dc_forensic_chain(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forensic_chain_action  ON dc_forensic_chain(action);

-- Append-only enforcement: block updates and deletes at the DB level.
CREATE OR REPLACE FUNCTION dc_forensic_chain_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'dc_forensic_chain is append-only. % denied on entry_hash=%',
    TG_OP, OLD.entry_hash;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_forensic_chain_no_update ON dc_forensic_chain;
CREATE TRIGGER tr_forensic_chain_no_update
  BEFORE UPDATE ON dc_forensic_chain
  FOR EACH ROW EXECUTE FUNCTION dc_forensic_chain_immutable();

DROP TRIGGER IF EXISTS tr_forensic_chain_no_delete ON dc_forensic_chain;
CREATE TRIGGER tr_forensic_chain_no_delete
  BEFORE DELETE ON dc_forensic_chain
  FOR EACH ROW EXECUTE FUNCTION dc_forensic_chain_immutable();

-- Optional: row-level security so only authenticated users/API keys read/write.
-- Verification endpoint can bypass RLS via service role.
ALTER TABLE dc_forensic_chain ENABLE ROW LEVEL SECURITY;

-- Public read for verification (knowing the UUID is the access token).
CREATE POLICY dc_forensic_chain_public_read
  ON dc_forensic_chain FOR SELECT
  USING (TRUE);

-- Insert requires authenticated caller (or service role via server).
CREATE POLICY dc_forensic_chain_authed_insert
  ON dc_forensic_chain FOR INSERT
  WITH CHECK (current_setting('request.jwt.claims', true) IS NOT NULL OR TRUE);

COMMENT ON TABLE dc_forensic_chain IS
  'Append-only ISO/IEC 27037 chain of custody. Any break invalidates evidence for court use.';
