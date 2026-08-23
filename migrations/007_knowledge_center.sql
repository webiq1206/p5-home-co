-- Knowledge Center state and the daily financial report (idempotent).
--
-- The Knowledge Center's articles live in code (versioned, reviewable).
-- The database holds only what changes at runtime: per-article verification
-- state, the configuration baselines drift is measured against, and the
-- daily report history used for "what changed since yesterday".

-- Per-article verification state. Articles are flagged (never silently
-- rewritten) when the live configuration stops matching what they document.
CREATE TABLE IF NOT EXISTS kb_article_state (
  slug         TEXT PRIMARY KEY,
  last_verified_on DATE,
  flagged      BOOLEAN NOT NULL DEFAULT FALSE,
  flag_reason  TEXT,
  flagged_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Configuration baselines: a snapshot of live configuration (for example the
-- QuickBooks chart of accounts) that drift checks diff against. Accepting a
-- change re-captures the baseline; history stays in finance_audit.
CREATE TABLE IF NOT EXISTS kb_config_baseline (
  key          TEXT PRIMARY KEY,
  payload      JSONB NOT NULL,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_by  BIGINT REFERENCES app_user(id) ON DELETE SET NULL
);

-- One row per calendar day. payload is the full assembled report, kept so the
-- next day's report can say what changed without re-deriving history.
CREATE TABLE IF NOT EXISTS daily_report (
  covers_date  DATE PRIMARY KEY,
  payload      JSONB NOT NULL,
  emailed_to   TEXT[],
  email_status TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
