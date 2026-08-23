-- ---------------------------------------------------------------------------
-- QuickBooks data-quality monitor (S214).
--
-- Findings themselves are NOT stored here. They go into attention_item, which
-- already dedupes by (kind, subject_key), auto-resolves when a condition stops,
-- and feeds the Today page and the daily email. A second parallel queue would
-- mean two lists of problems and two places to forget to look.
--
-- What this migration adds is the one fact the rules need and had nowhere to
-- live, plus a record of when the inspection last ran.
-- ---------------------------------------------------------------------------

-- The tax classification printed on the vendor's W-9.
--
-- This is what decides whether a vendor gets a 1099, and it is the reason the
-- decision is never a guess: sole proprietors and partnerships are reportable,
-- corporations are not. Without the classification on file, the only honest
-- state for the 1099 flag is "not yet decided" - which the scanner reports.
ALTER TABLE vendor_profile
  ADD COLUMN IF NOT EXISTS w9_tax_classification TEXT
    CHECK (w9_tax_classification IS NULL OR w9_tax_classification IN (
      'Individual / sole proprietor',
      'Partnership',
      'LLC - taxed as sole proprietor',
      'LLC - taxed as partnership',
      'LLC - taxed as C corporation',
      'LLC - taxed as S corporation',
      'C Corporation',
      'S Corporation',
      'Trust / estate',
      'Other'));

-- When the last data-quality inspection ran, and what it found. One row per
-- run, so a sudden jump in findings is visible as a trend rather than as a
-- single alarming number with no history behind it.
CREATE TABLE IF NOT EXISTS qbo_audit_run (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','succeeded','failed')),
  trigger       TEXT NOT NULL DEFAULT 'manual'
                CHECK (trigger IN ('manual','daily')),
  -- Counts by severity, so the trend is queryable without re-reading findings.
  critical_count INTEGER NOT NULL DEFAULT 0,
  urgent_count   INTEGER NOT NULL DEFAULT 0,
  warning_count  INTEGER NOT NULL DEFAULT 0,
  info_count     INTEGER NOT NULL DEFAULT 0,
  -- How many were newly opened by this run, which is what an alert is worth
  -- sending about. A steady count of known problems is not news.
  opened_count   INTEGER NOT NULL DEFAULT 0,
  resolved_count INTEGER NOT NULL DEFAULT 0,
  error         TEXT
);

CREATE INDEX IF NOT EXISTS qbo_audit_run_recent_idx
  ON qbo_audit_run (started_at DESC);
