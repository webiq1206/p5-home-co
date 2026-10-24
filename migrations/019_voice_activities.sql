-- Additive, durable record for native HubSpot call and note activities.
-- This is separate from the original Gmail-to-HubSpot EMAIL receipt.
CREATE TABLE IF NOT EXISTS p5_voice_activity (
  mailbox text NOT NULL,
  source_id text NOT NULL,
  contact_id text,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','processing','complete','review')),
  note_attempted_at timestamptz,
  note_id text,
  call_attempted_at timestamptz,
  call_id text,
  lease_token text,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mailbox,source_id),
  FOREIGN KEY (mailbox,source_id) REFERENCES p5_inbox_message(mailbox,source_id)
);
CREATE INDEX IF NOT EXISTS p5_voice_activity_due ON p5_voice_activity(state,lease_until);
