-- Additive operational state only. Routing uses the existing setting table.
CREATE TABLE IF NOT EXISTS lead_hubspot_retry (
  deal_id BIGINT PRIMARY KEY REFERENCES deal(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_category TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_hubspot_retry_due_idx ON lead_hubspot_retry (next_attempt_at);
CREATE TABLE IF NOT EXISTS meta_subscription_run (
  run_key TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  pages_checked INTEGER NOT NULL DEFAULT 0,
  pages_subscribed INTEGER NOT NULL DEFAULT 0,
  last_category TEXT
);
