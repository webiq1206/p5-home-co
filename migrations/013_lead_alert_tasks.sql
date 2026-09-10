-- One durable incident per current actionable condition, independent of tier.
-- Completion acknowledges the incident; it does not fabricate a contact attempt.
CREATE TABLE IF NOT EXISTS lead_alert_incident (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deal_id BIGINT NOT NULL REFERENCES deal(id) ON DELETE CASCADE,
  family TEXT NOT NULL,
  anchor TEXT NOT NULL,
  title TEXT NOT NULL,
  reason TEXT NOT NULL,
  tier TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  acknowledgement_source TEXT,
  hubspot_task_id TEXT UNIQUE,
  task_subject TEXT,
  create_attempted_at TIMESTAMPTZ,
  task_completed_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  last_error TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS lead_alert_incident_open_unique
  ON lead_alert_incident (deal_id, family) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS lead_alert_incident_sync_idx
  ON lead_alert_incident (last_checked_at NULLS FIRST, id)
  WHERE task_completed_at IS NULL;
ALTER TABLE alert ADD COLUMN IF NOT EXISTS incident_id BIGINT
  REFERENCES lead_alert_incident(id) ON DELETE SET NULL;
ALTER TABLE deal ADD COLUMN IF NOT EXISTS last_hubspot_read_at TIMESTAMPTZ;
