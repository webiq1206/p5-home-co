-- Evidence-only review holds. Never modify or discard local business records.
CREATE TABLE IF NOT EXISTS hubspot_archive_review (
  object_type TEXT NOT NULL CHECK (object_type IN ('tasks','deals')),
  remote_id TEXT NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_check_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '24 hours',
  restored_at TIMESTAMPTZ,
  PRIMARY KEY (object_type,remote_id)
);
