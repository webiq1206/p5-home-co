-- Google Voice texts and voicemails, already mirrored as EMAIL records by the
-- inbox sync, also logged as the native HubSpot engagement: a COMMUNICATION
-- (SMS) or a NOTE for a text, a CALL for a voicemail. Additive only. Same
-- durable create-intent rule as p5_voice_activity: an attempt is saved before
-- any HubSpot POST, and an uncertain response goes to review, never a repost.
CREATE TABLE IF NOT EXISTS p5_voice_message_activity (
  mailbox        text NOT NULL,
  source_id      text NOT NULL,
  contact_id     text,
  kind           text NOT NULL CHECK (kind IN ('sms','voicemail')),
  state          text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','processing','complete','review')),
  attempted_at   timestamptz,
  object_type    text,
  object_id      text,
  lease_token    text,
  lease_until    timestamptz,
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mailbox,source_id),
  FOREIGN KEY (mailbox,source_id) REFERENCES p5_inbox_message(mailbox,source_id)
);
CREATE INDEX IF NOT EXISTS p5_voice_message_activity_due ON p5_voice_message_activity(state,lease_until);
