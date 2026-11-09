-- Lead pipeline: immediate HubSpot sync, a durable copy of every submitted
-- field, activity pushes and Meta Instant Form leads (docs/meta-leadgen-setup.md,
-- docs/lead-intake-contract.md). Additive only: new nullable columns and new
-- side tables. Nothing existing is changed, renamed or removed, and the startup
-- migrator may run it on a live database at any time.

-- State and ZIP as the visitor sent them, so the HubSpot contact gets its own
-- address fields. property_address keeps the street (ZIP appended, as before).
ALTER TABLE deal ADD COLUMN IF NOT EXISTS property_state TEXT;
ALTER TABLE deal ADD COLUMN IF NOT EXISTS property_zip TEXT;

-- A short lease so the inline sync after intake and the watchdog never push
-- the same deal at the same moment (two creates would make two deals).
ALTER TABLE deal ADD COLUMN IF NOT EXISTS hubspot_sync_lease_until TIMESTAMPTZ;

-- Every field a submission carried, as label/value pairs in the order sent.
-- One HubSpot note per distinct submission (fingerprint), on the contact and
-- the deal, so nothing a visitor typed is lost even when it has no property.
CREATE TABLE IF NOT EXISTS lead_intake_submission (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deal_id             BIGINT NOT NULL REFERENCES deal(id) ON DELETE CASCADE,
  fingerprint         TEXT NOT NULL,
  channel             TEXT NOT NULL,
  fields              JSONB NOT NULL,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  hubspot_note_state  TEXT NOT NULL DEFAULT 'pending',
  hubspot_note_id     TEXT,
  UNIQUE (deal_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS lead_intake_submission_deal_idx ON lead_intake_submission (deal_id, received_at);

-- Calls, texts and notes logged in the P5 admin, pushed to HubSpot as the
-- matching engagement. NULL state means "not a push candidate" (history from
-- before this release is never backfilled). hubspot_activity_id already exists.
ALTER TABLE activity ADD COLUMN IF NOT EXISTS hubspot_sync_state TEXT;
ALTER TABLE activity ADD COLUMN IF NOT EXISTS hubspot_object_type TEXT;
ALTER TABLE activity ADD COLUMN IF NOT EXISTS hubspot_attempted_at TIMESTAMPTZ;
ALTER TABLE activity ADD COLUMN IF NOT EXISTS hubspot_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE activity ADD COLUMN IF NOT EXISTS hubspot_last_error TEXT;
CREATE INDEX IF NOT EXISTS activity_hubspot_sync_idx ON activity (hubspot_sync_state, id) WHERE hubspot_sync_state IS NOT NULL;

-- Meta Instant Form (leadgen) webhook deliveries. Saved BEFORE Meta gets its
-- 200, so a Graph API or HubSpot outage never loses a lead: the watchdog
-- retries anything still pending. leadgen_id is the dedupe key.
CREATE TABLE IF NOT EXISTS meta_leadgen_event (
  leadgen_id    TEXT PRIMARY KEY,
  page_id       TEXT,
  form_id       TEXT,
  ad_id         TEXT,
  payload       JSONB NOT NULL,
  state         TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','ingested','rejected','failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  deal_id       BIGINT REFERENCES deal(id) ON DELETE SET NULL,
  lead          JSONB,
  lease_until   TIMESTAMPTZ,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meta_leadgen_event_due_idx ON meta_leadgen_event (state, received_at);
