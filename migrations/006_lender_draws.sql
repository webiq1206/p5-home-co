-- Construction lender draws (S77).
--
-- One lender configuration per project (funding_source includes a lender),
-- and a numbered sequence of draws, each with its lifecycle timestamps and an
-- immutable package snapshot captured at submission - the record of exactly
-- what the lender was sent, whatever the live data does afterwards.

CREATE TABLE IF NOT EXISTS project_lender (
  project_id   BIGINT PRIMARY KEY REFERENCES p5_project(id) ON DELETE CASCADE,
  lender_name  TEXT NOT NULL,
  loan_number  TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  approved_loan_budget NUMERIC(14,2),
  -- What this lender demands with every draw (S77: requirements vary).
  requires_inspection   BOOLEAN NOT NULL DEFAULT TRUE,
  requires_lien_waivers BOOLEAN NOT NULL DEFAULT TRUE,
  requires_invoices     BOOLEAN NOT NULL DEFAULT TRUE,
  requires_photos       BOOLEAN NOT NULL DEFAULT FALSE,
  notes        TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lender_draw (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id   BIGINT NOT NULL REFERENCES p5_project(id) ON DELETE CASCADE,
  draw_number  INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN
                 ('draft','submitted','approved','funded','rejected')),
  amount_requested NUMERIC(14,2) NOT NULL CHECK (amount_requested > 0),
  amount_approved  NUMERIC(14,2),
  amount_funded    NUMERIC(14,2),
  inspection_status TEXT NOT NULL DEFAULT 'not_required' CHECK (inspection_status IN
                 ('not_required','pending','scheduled','passed','failed')),
  photos_ref   TEXT,                          -- Drive link to photo evidence
  notes        TEXT,
  -- Immutable snapshot of the generated package at submission time.
  package      JSONB,
  created_by   BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  approved_at  TIMESTAMPTZ,
  funded_at    TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, draw_number)
);
CREATE INDEX IF NOT EXISTS lender_draw_open_idx
  ON lender_draw (project_id) WHERE status NOT IN ('funded','rejected');
