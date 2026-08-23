-- QuickBooks webhook events (S155).
--
-- One PENDING row per (entity, id): a burst of updates to the same record
-- coalesces into a single refetch. Processed rows are kept for audit, so the
-- uniqueness is a partial index over the unprocessed set only.

CREATE TABLE IF NOT EXISTS qbo_webhook_event (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  realm_id     TEXT NOT NULL,
  entity_name  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  operation    TEXT NOT NULL,
  event_time   TEXT,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  error        TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS qbo_webhook_event_pending_unique
  ON qbo_webhook_event (entity_name, entity_id) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS qbo_webhook_event_pending_idx
  ON qbo_webhook_event (received_at) WHERE processed_at IS NULL;
