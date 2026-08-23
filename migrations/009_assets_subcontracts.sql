-- ---------------------------------------------------------------------------
-- Subcontracts, fixed assets, vehicles and debt (S91-S98, S131-S138).
--
-- These are the records the operating system had nowhere to put. Each exists
-- because getting it wrong has a specific financial consequence:
--
--   * A subcontract is the commitment a vendor's bills draw against. Without
--     it, "is this invoice within scope?" has no answer.
--   * A financed asset booked wholly as an expense overstates costs and
--     understates the balance sheet. Principal and interest must separate.
--   * A vehicle's registration and insurance expiring is an operational
--     failure that only surfaces if something is watching the date.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS subcontract (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id      BIGINT NOT NULL REFERENCES p5_project(id) ON DELETE CASCADE,
  vendor_id       BIGINT NOT NULL REFERENCES vendor_profile(id) ON DELETE RESTRICT,

  -- P5's own reference, unique per project so a vendor can hold more than one
  -- trade package on the same job without ambiguity.
  reference       TEXT NOT NULL,
  scope           TEXT NOT NULL,

  original_amount NUMERIC(14,2) NOT NULL CHECK (original_amount >= 0),
  -- Approved changes are tracked separately from the original so the original
  -- commitment is never quietly rewritten (S46 applied to the buy side).
  approved_changes NUMERIC(14,2) NOT NULL DEFAULT 0,
  retainage_pct   NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (retainage_pct BETWEEN 0 AND 100),

  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN
                    ('draft','issued','executed','in_progress','complete','closed','terminated')),
  issued_on       DATE,
  executed_on     DATE,
  completed_on    DATE,

  -- The commitment this subcontract created in QuickBooks, when one exists.
  qbo_purchase_order_id TEXT,
  drive_ref       TEXT,                    -- restricted link, never the file (S173)

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, reference)
);

CREATE INDEX IF NOT EXISTS subcontract_vendor_idx ON subcontract (vendor_id);
CREATE INDEX IF NOT EXISTS subcontract_open_idx
  ON subcontract (project_id) WHERE status NOT IN ('closed','terminated');

-- ---------------------------------------------------------------------------
-- Fixed assets, including vehicles
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fixed_asset (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN
                    ('vehicle','equipment','tool','computer','furniture','other')),

  acquired_on     DATE,
  cost            NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  -- Depreciation is a CPA determination; P5 records the facts and leaves the
  -- method blank until told, rather than assuming a convention.
  depreciation_method TEXT,
  useful_life_years   NUMERIC(5,2),

  -- Vehicle specifics. Null for everything else.
  vin             TEXT,
  plate           TEXT,
  registration_expires DATE,

  -- Where the asset lives on the books, so this never becomes a second ledger.
  qbo_account_id  TEXT,
  insurance_policy_id BIGINT REFERENCES insurance_policy(id) ON DELETE SET NULL,

  disposed_on     DATE,
  disposal_note   TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fixed_asset_active_idx ON fixed_asset (category) WHERE active;
CREATE INDEX IF NOT EXISTS fixed_asset_registration_idx
  ON fixed_asset (registration_expires) WHERE active AND registration_expires IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Debt
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS debt_instrument (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lender          TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN
                    ('loan','line_of_credit','equipment_finance','vehicle_finance','card','other')),
  account_ref     TEXT,

  original_principal NUMERIC(14,2) NOT NULL DEFAULT 0,
  current_balance    NUMERIC(14,2) NOT NULL DEFAULT 0,
  interest_rate      NUMERIC(6,3),
  -- The scheduled payment, and the split. Booking the whole payment as expense
  -- overstates cost and never reduces the liability, which is the error this
  -- table exists to prevent.
  scheduled_payment  NUMERIC(14,2),
  payment_cadence    TEXT,
  next_payment_on    DATE,
  maturity_on        DATE,

  secured_by_asset_id BIGINT REFERENCES fixed_asset(id) ON DELETE SET NULL,
  qbo_account_id     TEXT,

  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS debt_next_payment_idx
  ON debt_instrument (next_payment_on) WHERE active;
