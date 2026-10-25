-- Photos, plans, and other files sent with a short website request.
-- Additive only. The estimator draft tables are a separate store.

CREATE TABLE IF NOT EXISTS lead_request_file (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deal_id     BIGINT NOT NULL REFERENCES deal(id) ON DELETE CASCADE,
  file_name   TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  sha256      TEXT NOT NULL,
  data        BYTEA NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_request_file_deal_idx ON lead_request_file (deal_id, created_at DESC);
