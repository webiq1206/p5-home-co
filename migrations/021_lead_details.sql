-- Two-step quote forms and the brand intake contract (docs/lead-intake-contract.md).
-- Additive only: new nullable columns and new side tables. Nothing existing is
-- changed, renamed or removed, and the startup migrator may run it on a live
-- database at any time.

-- "quote" or "callback"; how the visitor wants to be reached; when to call.
ALTER TABLE deal ADD COLUMN IF NOT EXISTS request_kind TEXT;
ALTER TABLE deal ADD COLUMN IF NOT EXISTS contact_preference TEXT;
ALTER TABLE deal ADD COLUMN IF NOT EXISTS best_time TEXT;
-- Soon / 1 to 3 months / 3 to 6 months / Just planning, as the visitor chose it.
ALTER TABLE deal ADD COLUMN IF NOT EXISTS timeline TEXT;

-- The brand site's own request id (external_id), stable across its Step 1 and
-- Step 2 posts and scoped by brand, so two brand sites can never collide. A side
-- table rather than a deal column: when a repeat request attaches to an open
-- deal, its id must still find that deal for its own Step 2.
CREATE TABLE IF NOT EXISTS lead_external_ref (
  brand        TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  deal_id      BIGINT NOT NULL REFERENCES deal(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (brand, external_id)
);
CREATE INDEX IF NOT EXISTS lead_external_ref_deal_idx ON lead_external_ref (deal_id);

-- Links to files a brand site stored itself (photos, plans). P5 keeps the link,
-- never a copy. Files sent to P5's own form stay in lead_request_file.
CREATE TABLE IF NOT EXISTS lead_file_link (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deal_id       BIGINT NOT NULL REFERENCES deal(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  content_type  TEXT,
  size_bytes    BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deal_id, url)
);

-- One row per distinct "details added" submission. The fingerprint makes a
-- repeated post a no-op, and the HubSpot columns let the sync add exactly one
-- note per submission.
CREATE TABLE IF NOT EXISTS lead_details_event (
  deal_id             BIGINT NOT NULL REFERENCES deal(id) ON DELETE CASCADE,
  fingerprint         TEXT NOT NULL,
  details             JSONB NOT NULL,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  hubspot_note_state  TEXT NOT NULL DEFAULT 'pending',
  hubspot_note_id     TEXT,
  PRIMARY KEY (deal_id, fingerprint)
);

-- A brand's Step 2 can arrive before its Step 1 (the Step 1 forward is slow or
-- retried). Details that cannot reach anyone on their own wait here, keyed by
-- brand + external_id, and merge the moment Step 1 creates or finds the deal.
CREATE TABLE IF NOT EXISTS lead_pending_details (
  brand        TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  fingerprint  TEXT NOT NULL,
  details      JSONB NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (brand, external_id, fingerprint)
);
