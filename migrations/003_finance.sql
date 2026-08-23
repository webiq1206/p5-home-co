-- P5 Financial Operating System: core schema.
--
-- Ownership model (master spec S8). QuickBooks Online remains authoritative for
-- the general ledger, AR, AP, balances and posted transactions. Every qbo_*
-- table here is a READ MODEL: a cache of QBO data pulled by the sync engine so
-- dashboards can compute without hammering the API. P5 Admin is authoritative
-- only for operational state QBO does not own: workflow status, compliance,
-- registries, reserves policy, attention items and audit history. Nothing in
-- this schema is a second ledger (spec S212-41).

-- --------------------------------------------------------------------------
-- QuickBooks connection + sync bookkeeping (S155, S201)
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS qbo_connection (
  id             SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  realm_id       TEXT NOT NULL,
  -- AES-256-GCM ciphertext (base64url) produced by app/lib/finance/crypto.ts.
  -- Raw OAuth tokens are never stored in plaintext (S171, S201).
  access_cipher  TEXT NOT NULL,
  refresh_cipher TEXT NOT NULL,
  access_expires_at  TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ NOT NULL,
  connected_by   BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  connected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per sync run; the daily reconciliation and any on-demand pull.
CREATE TABLE IF NOT EXISTS qbo_sync_run (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','succeeded','failed')),
  trigger       TEXT NOT NULL DEFAULT 'manual'
                CHECK (trigger IN ('manual','daily','webhook')),
  entities      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- per-entity counts
  error         TEXT
);

-- --------------------------------------------------------------------------
-- QBO read model. Raw entity JSON plus the columns the engines filter on.
-- Idempotent upserts keyed by QBO id; retries can never duplicate (S155).
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS qbo_account (
  qbo_id       TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  acct_num     TEXT,
  account_type TEXT NOT NULL,
  sub_type     TEXT,
  classification TEXT,           -- Asset|Liability|Equity|Revenue|Expense
  current_balance NUMERIC(14,2),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  raw          JSONB NOT NULL,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qbo_class (
  qbo_id    TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  active    BOOLEAN NOT NULL DEFAULT TRUE,
  raw       JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Customers AND their project sub-customers (QBO models projects as customers
-- with a parent ref + IsProject). parent_qbo_id distinguishes them.
CREATE TABLE IF NOT EXISTS qbo_customer (
  qbo_id        TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  parent_qbo_id TEXT,
  is_project    BOOLEAN NOT NULL DEFAULT FALSE,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  balance       NUMERIC(14,2),
  raw           JSONB NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qbo_vendor (
  qbo_id       TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  balance      NUMERIC(14,2),
  vendor_1099  BOOLEAN,
  raw          JSONB NOT NULL,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One table for all transaction headers the engines need. Line detail stays in
-- raw JSONB; engines that need lines read them there rather than exploding
-- rows we would then have to keep consistent.
CREATE TABLE IF NOT EXISTS qbo_txn (
  qbo_id       TEXT NOT NULL,
  txn_type     TEXT NOT NULL CHECK (txn_type IN (
                 'Invoice','Payment','Bill','BillPayment','PurchaseOrder',
                 'Estimate','CreditMemo','VendorCredit','Purchase','Deposit',
                 'JournalEntry','Transfer')),
  txn_date     DATE,
  due_date     DATE,
  total        NUMERIC(14,2),
  balance      NUMERIC(14,2),          -- open balance where QBO provides it
  customer_qbo_id TEXT,                -- project/customer ref where present
  vendor_qbo_id   TEXT,
  doc_number   TEXT,
  po_status    TEXT,                   -- PurchaseOrder only: Open|Closed
  raw          JSONB NOT NULL,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (txn_type, qbo_id)
);
CREATE INDEX IF NOT EXISTS qbo_txn_customer_idx ON qbo_txn (customer_qbo_id);
CREATE INDEX IF NOT EXISTS qbo_txn_vendor_idx   ON qbo_txn (vendor_qbo_id);
CREATE INDEX IF NOT EXISTS qbo_txn_date_idx     ON qbo_txn (txn_type, txn_date);

-- --------------------------------------------------------------------------
-- P5 project registry (S11, S12, S14, S150). Operational fields QBO lacks.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS p5_project (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  p5_id          TEXT NOT NULL UNIQUE,          -- P5-YYYY-#### (S11); never reused
  name           TEXT NOT NULL,
  qbo_customer_id TEXT,                         -- stable id map (S154)
  division       TEXT NOT NULL CHECK (division IN (
                   'P5 Corporate / Shared','Boise Construction Co','Boise Remodeling Co',
                   'Boise ADU Co','Boise Handyman Co','Boise Cabinet Co')),
  project_type   TEXT NOT NULL,
  contract_type  TEXT NOT NULL CHECK (contract_type IN (
                   'Fixed Price','Cost Plus','Time and Materials',
                   'Service / Work Order','Design / Preconstruction','Other Approved')),
  status         TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN (
                   'Draft','Proposal','Contract Pending','Deposit Pending','Ready to Start',
                   'Active','On Hold','Substantial Completion','Closeout','Warranty',
                   'Closed','Cancelled')),
  status_reason  TEXT,                           -- required for On Hold/Cancelled/Reopen (S14)
  property_address TEXT,
  residential    BOOLEAN NOT NULL DEFAULT TRUE,  -- drives Idaho disclosure gates (S78)
  funding_source TEXT NOT NULL DEFAULT 'Cash' CHECK (funding_source IN
                   ('Cash','Construction loan','Mixed','Other')),
  contract_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,   -- original (immutable by policy)
  approved_change_orders NUMERIC(14,2) NOT NULL DEFAULT 0,
  original_budget     NUMERIC(14,2) NOT NULL DEFAULT 0,   -- never overwritten (S46)
  current_budget      NUMERIC(14,2) NOT NULL DEFAULT 0,
  target_gp_pct       NUMERIC(5,2)  NOT NULL DEFAULT 45,
  funding_buffer      NUMERIC(14,2) NOT NULL DEFAULT 0,   -- desired post-draw buffer (S56)
  contingency_original NUMERIC(14,2) NOT NULL DEFAULT 0,  -- budget reserve, never an expense (S28, S70)
  contingency_used     NUMERIC(14,2) NOT NULL DEFAULT 0,
  etc_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,        -- estimate-to-complete beyond commitments (S48)
  etc_updated_at TIMESTAMPTZ,                             -- forecast freshness (S49)
  retainage_pct  NUMERIC(5,2) NOT NULL DEFAULT 0,
  idaho_initial_disclosure_at TIMESTAMPTZ,                -- S79 gate evidence
  idaho_final_disclosure_at   TIMESTAMPTZ,                -- S80 gate evidence
  closed_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Budget revisions are append-only; original budget stays intact (S46).
CREATE TABLE IF NOT EXISTS budget_revision (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  BIGINT NOT NULL REFERENCES p5_project(id) ON DELETE CASCADE,
  amount      NUMERIC(14,2) NOT NULL,
  category    TEXT NOT NULL,
  reason      TEXT NOT NULL,
  requested_by BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  approved_by  BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Contingency draws: actual cost posts to the real phase in QBO; this table
-- only decrements the reserve and records why (S28, S70).
CREATE TABLE IF NOT EXISTS contingency_use (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  BIGINT NOT NULL REFERENCES p5_project(id) ON DELETE CASCADE,
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  phase       TEXT NOT NULL,
  reason      TEXT NOT NULL,
  requested_by BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  approved_by  BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- Cost code taxonomy, versioned (S15-S34, S32). Seeded from the locked CSVs.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cost_code_version (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,        -- e.g. 'P5 Cost Structure v1 - 2025 Source'
  effective_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cost_code (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version_id  BIGINT NOT NULL REFERENCES cost_code_version(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  source_description TEXT NOT NULL,
  user_label  TEXT NOT NULL,
  level       TEXT NOT NULL CHECK (level IN
                ('PARENT','CHILD','CABINET','DETAIL','RESERVE','ESTIMATING-ROLLUP','ESTIMATING-FEE')),
  postable    BOOLEAN NOT NULL,           -- parents/reserves/L-*/F-* are FALSE (S26-S28)
  default_cost_group TEXT,
  notes       TEXT,
  UNIQUE (version_id, code)
);

-- --------------------------------------------------------------------------
-- Vendor compliance (S81-S93). The vendor row is P5's operational master;
-- qbo_vendor_id maps to accounting (S154).
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vendor_profile (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  qbo_vendor_id TEXT UNIQUE,
  display_name  TEXT NOT NULL,
  vendor_type   TEXT NOT NULL DEFAULT 'Trade Subcontractor' CHECK (vendor_type IN (
                  'Trade Subcontractor','Material Supplier','Professional Service',
                  'Independent Contractor','Foreign Contractor','Equipment Rental',
                  'Utility','Government / Permit Agency','Other')),
  primary_trade TEXT,
  default_phase TEXT,                     -- intelligent coding defaults (S24)
  default_cost_group TEXT,
  compliance_status TEXT NOT NULL DEFAULT 'Onboarding Required' CHECK (compliance_status IN (
                  'Onboarding Required','Compliance Review','Compliant',
                  'Expiring Soon','Payment Hold','Inactive')),
  payment_hold  BOOLEAN NOT NULL DEFAULT FALSE,
  payment_hold_reason TEXT,               -- always say WHY (S104-S105)
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every dated compliance document a vendor must keep current (S87-S89).
-- W-9 status lives here as doc_type 'W-9' with no expiry; TIN itself is NEVER
-- stored in this database (S171) - only whether a valid W-9 is on file and
-- where the restricted document lives.
CREATE TABLE IF NOT EXISTS vendor_document (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vendor_id   BIGINT NOT NULL REFERENCES vendor_profile(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL CHECK (doc_type IN (
                'W-9','W-8','Idaho Registration','Trade License','General Liability',
                'Workers Comp','Commercial Auto','Umbrella','Professional Liability',
                'Additional Insured Endorsement','Master Subcontractor Agreement',
                'Payment Setup','Other')),
  required    BOOLEAN NOT NULL DEFAULT TRUE,
  status      TEXT NOT NULL DEFAULT 'missing' CHECK (status IN
                ('missing','requested','received','verified','expired','waived')),
  expires_on  DATE,
  drive_ref   TEXT,                        -- restricted Drive link, not the file (S173)
  notes       TEXT,
  updated_by  BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, doc_type)
);

-- --------------------------------------------------------------------------
-- Lien waivers (S94-S98). Attorney-approved P5 templates; Idaho prescribes no
-- statutory form. Full lifecycle record per waiver.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lien_waiver (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vendor_id    BIGINT NOT NULL REFERENCES vendor_profile(id) ON DELETE CASCADE,
  project_id   BIGINT NOT NULL REFERENCES p5_project(id) ON DELETE CASCADE,
  waiver_type  TEXT NOT NULL CHECK (waiver_type IN (
                 'Conditional Progress','Unconditional Progress',
                 'Conditional Final','Unconditional Final')),
  status       TEXT NOT NULL DEFAULT 'required' CHECK (status IN (
                 'required','requested','received','signed','reviewed','accepted','rejected')),
  through_date DATE,
  amount       NUMERIC(14,2),
  qbo_bill_id  TEXT,                       -- ties the waiver to the bill it clears (S95)
  qbo_payment_id TEXT,
  template_version TEXT,
  drive_ref    TEXT,
  requested_at TIMESTAMPTZ,
  received_at  TIMESTAMPTZ,
  reviewed_by  BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lien_waiver_open_idx
  ON lien_waiver (status) WHERE status NOT IN ('accepted','rejected');

-- --------------------------------------------------------------------------
-- Registries: subscriptions (S127), insurance (S130), corporate compliance
-- (S135). Deadlines feed Needs Your Attention automatically (S129/S130/S135).
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS subscription_registry (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vendor_name    TEXT NOT NULL,
  product        TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'Other Software',
  amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  cadence        TEXT NOT NULL DEFAULT 'monthly' CHECK (cadence IN ('monthly','annual','quarterly','other')),
  next_renewal   DATE,
  cancellation_deadline DATE,
  auto_renew     BOOLEAN NOT NULL DEFAULT TRUE,
  seats          INTEGER,
  owner_user_id  BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  purpose        TEXT,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  last_reviewed  DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS insurance_policy (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  policy_type  TEXT NOT NULL,
  carrier      TEXT NOT NULL,
  broker       TEXT,
  policy_number TEXT,
  effective_on DATE,
  expires_on   DATE NOT NULL,
  premium      NUMERIC(12,2),
  cadence      TEXT NOT NULL DEFAULT 'annual',
  drive_ref    TEXT,
  owner_user_id BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS corporate_obligation (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'Other' ,
  due_on      DATE NOT NULL,
  recurrence  TEXT NOT NULL DEFAULT 'annual' CHECK (recurrence IN ('one_time','monthly','quarterly','annual')),
  responsible BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS corporate_obligation_open_idx
  ON corporate_obligation (due_on) WHERE completed_at IS NULL;

-- --------------------------------------------------------------------------
-- Owners (S112, S117-S123). Effective-dated; history never overwritten.
-- Compensation amounts are settings the owner controls, not code constants.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS owner_record (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label           TEXT NOT NULL,                -- 'Owner 1' until real names arrive
  user_id         BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  ownership_pct   NUMERIC(6,3) NOT NULL DEFAULT 0,
  distribution_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
  voting_pct      NUMERIC(6,3) NOT NULL DEFAULT 0,
  weekly_compensation NUMERIC(12,2) NOT NULL DEFAULT 0,
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to    DATE,                          -- null = current row
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS owner_reimbursement (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    BIGINT NOT NULL REFERENCES owner_record(id) ON DELETE CASCADE,
  vendor_name TEXT NOT NULL,
  spent_on    DATE NOT NULL,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  business_purpose TEXT NOT NULL,
  project_id  BIGINT REFERENCES p5_project(id) ON DELETE SET NULL,
  phase       TEXT,
  cost_group  TEXT,
  receipt_ref TEXT,                              -- missing receipt => hold (S117)
  status      TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN (
                'submitted','hold_missing_receipt','approved','recorded','paid','rejected')),
  qbo_txn_id  TEXT,                              -- journal/bill once recorded in QBO (S118)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- Needs Your Attention (S149). One open row per (kind, subject). Resolution
-- keeps the row for audit; reminders stop automatically when resolved (S200).
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS attention_item (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        TEXT NOT NULL,                     -- machine key, e.g. 'coi_expiring'
  subject_key TEXT NOT NULL,                     -- dedupe key, e.g. 'vendor:12:General Liability'
  severity    TEXT NOT NULL CHECK (severity IN ('info','warning','urgent','critical')),
  title       TEXT NOT NULL,                     -- what happened
  detail      TEXT NOT NULL,                     -- why it matters
  amount      NUMERIC(14,2),
  entity_url  TEXT,                              -- deep link (drill-down, S157)
  due_on      DATE,
  recommended_action TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  resolution  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS attention_open_unique
  ON attention_item (kind, subject_key) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS attention_open_idx
  ON attention_item (severity) WHERE resolved_at IS NULL;

-- --------------------------------------------------------------------------
-- Weekly Money Run snapshots (S139-S143) and trend snapshots (S195).
-- Snapshots are reporting history only - never a second ledger (S195).
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS money_run (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_kind    TEXT NOT NULL CHECK (run_kind IN ('preliminary','final','adhoc')),
  covers_date DATE NOT NULL,
  payload     JSONB NOT NULL,                   -- full computed MoneyRun object
  safe_cash   NUMERIC(14,2) NOT NULL,
  required_total NUMERIC(14,2) NOT NULL,
  created_by  BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_kind, covers_date)
);

CREATE TABLE IF NOT EXISTS finance_snapshot (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  covers_date DATE NOT NULL UNIQUE,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- Finance audit log (S174). Append-only.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS finance_audit (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  object_kind TEXT NOT NULL,
  object_id   TEXT NOT NULL,
  previous    JSONB,
  next        JSONB,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS finance_audit_object_idx ON finance_audit (object_kind, object_id);
