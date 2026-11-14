-- Durable, evidence-backed delivery review; never delete lead/contact references.
CREATE TABLE IF NOT EXISTS hubspot_lead_review (
  deal_id BIGINT PRIMARY KEY REFERENCES deal(id),
  reason TEXT NOT NULL CHECK(reason IN ('invalid_email','archived_contact')),
  input_fingerprint TEXT,
  remote_contact_id TEXT,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_check_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ
);
