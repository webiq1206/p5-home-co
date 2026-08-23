-- Vendor and client portals (S151, S152).
--
-- External people are not app_users. A portal_contact belongs to exactly one
-- vendor OR one project, and every portal query is scoped through that link -
-- a vendor must never see other vendors or P5 margin (S151), and a client
-- sees only their own project's revenue-side records (S152).
--
-- Authentication is passwordless: a one-time emailed link (15 minutes, single
-- use) exchanges for a longer-lived portal session. Only SHA-256 hashes of
-- tokens are stored, mirroring the admin session model.

CREATE TABLE IF NOT EXISTS portal_contact (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('vendor','client')),
  vendor_id   BIGINT REFERENCES vendor_profile(id) ON DELETE CASCADE,
  project_id  BIGINT REFERENCES p5_project(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  full_name   TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  invited_by  BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  last_login_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The scope link must match the kind: vendors get vendor_id, clients get
  -- project_id, and never both.
  CONSTRAINT portal_contact_scope CHECK (
    (kind = 'vendor' AND vendor_id IS NOT NULL AND project_id IS NULL) OR
    (kind = 'client' AND project_id IS NOT NULL AND vendor_id IS NULL)
  ),
  UNIQUE (kind, email, vendor_id, project_id)
);
CREATE INDEX IF NOT EXISTS portal_contact_email_idx ON portal_contact (lower(email));

CREATE TABLE IF NOT EXISTS portal_login_token (
  id          TEXT PRIMARY KEY,               -- SHA-256 of the emailed token
  contact_id  BIGINT NOT NULL REFERENCES portal_contact(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_login_token_contact_idx ON portal_login_token (contact_id);

CREATE TABLE IF NOT EXISTS portal_session (
  id          TEXT PRIMARY KEY,               -- SHA-256 of the cookie token
  contact_id  BIGINT NOT NULL REFERENCES portal_contact(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent  TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS portal_session_contact_idx ON portal_session (contact_id);
CREATE INDEX IF NOT EXISTS portal_session_expiry_idx ON portal_session (expires_at);

-- Vendor-submitted messages: invoice references, waiver confirmations, and
-- questions. Files themselves go to the AP intake email (S100); the portal
-- records the submission so nothing lives only in an inbox (S99).
CREATE TABLE IF NOT EXISTS portal_submission (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contact_id  BIGINT NOT NULL REFERENCES portal_contact(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('invoice_reference','waiver_confirmation','message')),
  reference   TEXT,                            -- invoice number, waiver id, etc.
  body        TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ,
  reviewed_by BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_submission_open_idx
  ON portal_submission (created_at) WHERE reviewed_at IS NULL;
