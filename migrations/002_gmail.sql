-- Gmail: knowing who spoke last.
--
-- The lead manager already measures our first response to a new lead. It has
-- no idea whether a customer replied afterwards and was left waiting, which is
-- a different and quieter failure: the deal has an owner, a stage and a future
-- next action, so the board shows nothing wrong while the customer sits there.
--
-- Answering that needs one fact per message: which way it went.

ALTER TABLE activity
  ADD COLUMN IF NOT EXISTS direction TEXT
    CHECK (direction IN ('inbound', 'outbound'));

COMMENT ON COLUMN activity.direction IS
  'inbound = the customer wrote to us; outbound = we wrote to them. Null for '
  'notes, calls logged without a direction, and system entries.';

-- Finding the newest message on a deal is the hot path for the rules engine.
CREATE INDEX IF NOT EXISTS activity_direction_idx
  ON activity (deal_id, occurred_at DESC)
  WHERE direction IS NOT NULL;

-- Gmail threads are how a reply is matched back to a deal, so the lookup has
-- to be quick and the same message must never be recorded twice.
CREATE INDEX IF NOT EXISTS activity_gmail_thread_idx
  ON activity (gmail_thread_id) WHERE gmail_thread_id IS NOT NULL;

-- Where the mailbox poller got to, so each pass reads only what is new.
CREATE TABLE IF NOT EXISTS integration_cursor (
  name        TEXT PRIMARY KEY,
  cursor      TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- OAuth refresh tokens for integrations that need offline access.
-- Kept out of settings so a settings dump never carries a credential.
CREATE TABLE IF NOT EXISTS integration_credential (
  name          TEXT PRIMARY KEY,
  account_email TEXT,
  refresh_token TEXT NOT NULL,
  scopes        TEXT,
  connected_by  BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  connected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error    TEXT
);
