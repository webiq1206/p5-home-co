-- SHA-256 hashes of normalized emails and E.164 phones. Raw values are not stored.
CREATE TABLE IF NOT EXISTS enhanced_conversion_suppression (
  kind TEXT NOT NULL,
  value_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, value_hash)
);
COMMENT ON TABLE enhanced_conversion_suppression IS 'SHA-256 hashes only. Raw email addresses and phone numbers are not stored.';
