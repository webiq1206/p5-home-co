-- Privacy-preserving rate limit for the public lead endpoint. The hash is
-- never reversible in application code and expires with its short window.
CREATE TABLE IF NOT EXISTS lead_intake_rate_limit (
  client_hash TEXT NOT NULL,
  bucket BIGINT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (client_hash, bucket)
);
CREATE INDEX IF NOT EXISTS lead_intake_rate_limit_expiry_idx
  ON lead_intake_rate_limit (expires_at);