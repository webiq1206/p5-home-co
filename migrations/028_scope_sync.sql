-- Scope platform: deleting projects, property records, and file sync.
--
-- deleted_at hides a project everywhere without destroying its history.
-- property holds the public record found for the address. hubspot_contact_id
-- remembers which HubSpot contact the project's files belong on.
-- scope_asset_sync records each file sent to QuickBooks or HubSpot, so a file
-- is sent once and a failure is retried rather than repeated. Additive only.
ALTER TABLE scope_project ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE scope_project ADD COLUMN IF NOT EXISTS deleted_by BIGINT;
ALTER TABLE scope_project ADD COLUMN IF NOT EXISTS delete_note TEXT;
ALTER TABLE scope_project ADD COLUMN IF NOT EXISTS property JSONB;
ALTER TABLE scope_project ADD COLUMN IF NOT EXISTS property_checked_for TEXT;
ALTER TABLE scope_project ADD COLUMN IF NOT EXISTS hubspot_contact_id TEXT;

CREATE TABLE IF NOT EXISTS scope_asset_sync (
  asset_id    BIGINT NOT NULL REFERENCES scope_asset(id),
  target      TEXT NOT NULL CHECK (target IN ('quickbooks', 'hubspot')),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped', 'removed')),
  remote_id   TEXT,
  parent_id   TEXT,
  error       TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, target)
);
