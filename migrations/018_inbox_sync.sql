-- Additive, isolated email receipts. No operational lead/project side effects.
CREATE TABLE IF NOT EXISTS p5_inbox_cursor (
  mailbox text NOT NULL, folder text NOT NULL, uid_validity text NOT NULL,
  last_uid bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mailbox, folder, uid_validity)
);
CREATE TABLE IF NOT EXISTS p5_inbox_message (
  mailbox text NOT NULL, source_id text NOT NULL, rfc_id text,
  payload jsonb NOT NULL, labels jsonb NOT NULL, locations jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','processing','retry','uncertain','synced','existing','review','ignored')),
  reason text NOT NULL, identity jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0,
  lease_token text, lease_until timestamptz, create_attempted_at timestamptz,
  hubspot_email_id text, hubspot_contact_id text, last_error text,
  hubspot_email_origin text CHECK (hubspot_email_origin IN ('existing','created')),
  PRIMARY KEY (mailbox, source_id)
);
CREATE INDEX IF NOT EXISTS p5_inbox_message_due ON p5_inbox_message(status,next_attempt_at);
CREATE UNIQUE INDEX IF NOT EXISTS p5_inbox_message_rfc ON p5_inbox_message(mailbox,rfc_id) WHERE rfc_id IS NOT NULL;
