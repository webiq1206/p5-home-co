-- Dedicated private credential cache, not exposed by settings/admin projections.
CREATE TABLE IF NOT EXISTS meta_page_token (
  token_context TEXT NOT NULL,
  page_id TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (token_context, page_id)
);
