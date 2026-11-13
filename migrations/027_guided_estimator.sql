-- Guided online estimator (customer-facing, every P5 family site).
--
-- One row per estimate a customer completed. The priced estimate is frozen
-- here exactly as the customer saw it (customer_view) and as the team sees it
-- (internal_report), with the cost book and rules versions that produced it,
-- so an estimate stays accurate and auditable after the cost book changes.
-- The same scope is saved as a scope platform project (scope_project_id) where
-- the team reviews it and creates or revises the QuickBooks estimate.
--
-- Additive only. Nothing here is deleted by the application.

CREATE TABLE IF NOT EXISTS guided_estimate (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Unguessable handle for the customer's own link. Never the numeric id.
  token              TEXT NOT NULL UNIQUE,
  brand              TEXT NOT NULL,
  -- Browser-generated, so a retry or double tap is one estimate.
  client_key         TEXT NOT NULL,
  project            TEXT NOT NULL,
  tier               TEXT NOT NULL,
  answers            JSONB NOT NULL,
  address            TEXT,
  property           JSONB,
  first_name         TEXT NOT NULL,
  last_name          TEXT NOT NULL,
  email              TEXT NOT NULL,
  phone              TEXT NOT NULL,
  marketing_consent  BOOLEAN NOT NULL DEFAULT false,
  attribution        JSONB,
  elapsed_ms         INTEGER,
  estimate_class     TEXT NOT NULL,
  total              NUMERIC(14,2) NOT NULL,
  total_cost         NUMERIC(14,2),
  margin             NUMERIC(7,4),
  price_withheld     BOOLEAN NOT NULL DEFAULT false,
  review             JSONB NOT NULL DEFAULT '[]'::jsonb,
  customer_view      JSONB NOT NULL,
  internal_report    JSONB NOT NULL,
  rules_version      TEXT NOT NULL,
  cost_book_version  TEXT NOT NULL,
  scope_project_id   BIGINT REFERENCES scope_project(id),
  scope_version_id   BIGINT,
  lead_deal_id       BIGINT,
  -- Each delivery step records when it finished or why it failed, so a retry
  -- repeats only what is missing.
  delivery           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brand, client_key)
);
CREATE INDEX IF NOT EXISTS guided_estimate_created_idx ON guided_estimate (created_at DESC);
CREATE INDEX IF NOT EXISTS guided_estimate_email_idx ON guided_estimate (lower(email));
CREATE INDEX IF NOT EXISTS guided_estimate_scope_idx ON guided_estimate (scope_project_id);

-- Funnel events. No names, emails, phone numbers or addresses: a session id
-- the browser made up, the brand, the project and what happened.
CREATE TABLE IF NOT EXISTS guided_estimate_event (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session     TEXT NOT NULL,
  brand       TEXT NOT NULL,
  project     TEXT,
  name        TEXT NOT NULL,
  step        TEXT,
  attribution JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guided_estimate_event_idx ON guided_estimate_event (brand, name, created_at DESC);
