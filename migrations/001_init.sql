-- P5 Home Co always-on lead manager: initial schema.
--
-- Ownership model. This database holds operational state that no external
-- system owns: internal users, assignment, SLA timers, escalation state, audit
-- history, job health, and settings. Contact and deal rows carry external id
-- columns so HubSpot can become the CRM system of record without a rewrite.
-- Handoff and QuickBooks columns exist but stay null and unverified until their
-- feature flags are turned on.

CREATE TABLE IF NOT EXISTS schema_migration (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- People who use the admin panel
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app_user (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN (
                  'administrator','lead_coordinator','manager','sales_rep','project_manager')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  -- Optional backup owner used by escalation when the assignee is unavailable.
  backup_user_id BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  hubspot_owner_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_session (
  id          TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent  TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS user_session_user_idx ON user_session (user_id);
CREATE INDEX IF NOT EXISTS user_session_expiry_idx ON user_session (expires_at);

-- --------------------------------------------------------------------------
-- Administrator-configurable settings. Nothing the admin should control is
-- hardcoded at a call site; the rules engine reads everything from here.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS setting (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT REFERENCES app_user(id) ON DELETE SET NULL
);

-- --------------------------------------------------------------------------
-- Contacts and deals
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS contact (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- "email:jane@example.com" or "phone:+12084771169". Unique, so a repeat
  -- inquiry attaches to the existing person instead of creating a duplicate.
  identity_key  TEXT NOT NULL UNIQUE,
  first_name    TEXT,
  last_name     TEXT,
  email         TEXT,
  phone         TEXT,
  hubspot_contact_id TEXT UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_email_idx ON contact (email);
CREATE INDEX IF NOT EXISTS contact_phone_idx ON contact (phone);

CREATE TABLE IF NOT EXISTS deal (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contact_id      BIGINT NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  brand           TEXT NOT NULL,
  project_type    TEXT,
  stage           TEXT NOT NULL DEFAULT 'New Lead',
  lead_source     TEXT NOT NULL,
  lead_source_detail TEXT,

  property_address TEXT,
  property_city    TEXT,
  service_area     TEXT,
  summary          TEXT,
  estimated_value  NUMERIC(12,2),

  owner_user_id   BIGINT REFERENCES app_user(id) ON DELETE SET NULL,

  -- SLA and response tracking. Both clocks are tracked separately because
  -- "we tried to call" and "we actually spoke" are different promises.
  received_at         TIMESTAMPTZ NOT NULL,
  sla_deadline        TIMESTAMPTZ,
  first_attempt_at    TIMESTAMPTZ,
  first_two_way_at    TIMESTAMPTZ,
  sla_status          TEXT NOT NULL DEFAULT 'on_track',
  escalation_tier     TEXT NOT NULL DEFAULT 'none',

  next_action       TEXT,
  next_action_at    TIMESTAMPTZ,
  appointment_at    TIMESTAMPTZ,

  snoozed_until     TIMESTAMPTZ,
  snooze_reason     TEXT,

  closed_lost_reason TEXT,
  closed_at          TIMESTAMPTZ,

  -- Duplicate prevention. dedup_key is the normalized identity of the
  -- opportunity; external_lead_id is the originating system's own id and is
  -- the idempotency key for Facebook and webhook retries.
  dedup_key         TEXT,
  external_lead_id  TEXT,
  original_form     TEXT,
  original_campaign TEXT,
  facebook_lead_id  TEXT,
  utm               JSONB,

  hubspot_deal_id   TEXT UNIQUE,
  integration_sync_status TEXT NOT NULL DEFAULT 'pending',
  last_integration_error  TEXT,

  -- Manual and unverified until handoffIntegrationEnabled is turned on.
  handoff_client_id    TEXT,
  handoff_project_id   TEXT,
  handoff_project_url  TEXT,
  handoff_status       TEXT,
  proposal_status      TEXT,
  proposal_sent_at     TIMESTAMPTZ,
  proposal_approved_at TIMESTAMPTZ,
  estimate_amount      NUMERIC(12,2),
  handoff_values_are_manual BOOLEAN NOT NULL DEFAULT TRUE,

  -- Reserved for quickBooksIntegrationEnabled. Never written while off.
  quickbooks_customer_id TEXT,
  quickbooks_estimate_id TEXT,
  quickbooks_invoice_id  TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A given external lead is imported at most once, which makes Facebook and
-- webhook delivery idempotent without an application-level lock.
CREATE UNIQUE INDEX IF NOT EXISTS deal_external_lead_id_key
  ON deal (external_lead_id) WHERE external_lead_id IS NOT NULL;

-- At most one OPEN deal per normalized opportunity. A closed deal does not
-- block a genuine new project for the same person, brand, and address later.
CREATE UNIQUE INDEX IF NOT EXISTS deal_open_dedup_key
  ON deal (dedup_key)
  WHERE dedup_key IS NOT NULL AND stage NOT IN ('Closed Won','Closed Lost');

CREATE INDEX IF NOT EXISTS deal_owner_idx ON deal (owner_user_id);
CREATE INDEX IF NOT EXISTS deal_stage_idx ON deal (stage);
CREATE INDEX IF NOT EXISTS deal_brand_idx ON deal (brand);
CREATE INDEX IF NOT EXISTS deal_sla_idx ON deal (sla_status, sla_deadline);
CREATE INDEX IF NOT EXISTS deal_next_action_idx ON deal (next_action_at);
CREATE INDEX IF NOT EXISTS deal_contact_idx ON deal (contact_id);

-- --------------------------------------------------------------------------
-- Activity, tasks, alerts
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS activity (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deal_id     BIGINT NOT NULL REFERENCES deal(id) ON DELETE CASCADE,
  user_id     BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL CHECK (kind IN
                ('call','email','text','note','form','system','appointment')),
  outcome     TEXT,
  body        TEXT,
  -- TRUE only for a real person reaching out. An automatic acknowledgment is
  -- FALSE, which is what stops an auto-reply satisfying the response SLA.
  is_human_attempt BOOLEAN NOT NULL DEFAULT FALSE,
  is_two_way       BOOLEAN NOT NULL DEFAULT FALSE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  gmail_thread_id  TEXT,
  gmail_message_id TEXT UNIQUE,
  hubspot_activity_id TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_deal_idx ON activity (deal_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS task (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deal_id      BIGINT NOT NULL REFERENCES deal(id) ON DELETE CASCADE,
  assigned_to  BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  due_at       TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  hubspot_task_id TEXT UNIQUE,
  -- Stable key so a repeated rules-engine pass reuses the open task instead of
  -- stacking duplicates on the same deal.
  rule_key     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS task_open_rule_key
  ON task (deal_id, rule_key) WHERE completed_at IS NULL AND rule_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS task_due_idx ON task (due_at) WHERE completed_at IS NULL;

CREATE TABLE IF NOT EXISTS alert (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deal_id      BIGINT REFERENCES deal(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  tier         TEXT NOT NULL DEFAULT 'none',
  reason       TEXT NOT NULL,
  raised_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Suppresses re-notification while the same condition persists.
  last_notified_at TIMESTAMPTZ,
  acknowledged_at  TIMESTAMPTZ,
  acknowledged_by  BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  -- Set automatically when the underlying condition clears.
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One open alert per deal per kind per tier: the watchdog runs every five
-- minutes and must not manufacture a new alert on each pass.
CREATE UNIQUE INDEX IF NOT EXISTS alert_open_unique
  ON alert (deal_id, kind, tier) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS alert_open_idx ON alert (resolved_at) WHERE resolved_at IS NULL;

-- --------------------------------------------------------------------------
-- Audit, jobs, integration health
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  record_type   TEXT NOT NULL,
  record_id     TEXT,
  action        TEXT NOT NULL,
  previous_value JSONB,
  new_value      JSONB,
  -- 'admin_ui' | 'rules_engine' | 'intake' | 'job' | 'integration'
  action_source     TEXT NOT NULL,
  integration_source TEXT,
  succeeded     BOOLEAN NOT NULL DEFAULT TRUE,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS audit_log_record_idx ON audit_log (record_type, record_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_time_idx ON audit_log (occurred_at DESC);

CREATE TABLE IF NOT EXISTS job_run (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_name      TEXT NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  -- 'running' | 'succeeded' | 'failed'. A job that merely ran is not a
  -- success; these counters are what make that judgement possible.
  status        TEXT NOT NULL DEFAULT 'running',
  records_processed  INTEGER NOT NULL DEFAULT 0,
  records_skipped    INTEGER NOT NULL DEFAULT 0,
  duplicates_prevented INTEGER NOT NULL DEFAULT 0,
  alerts_raised      INTEGER NOT NULL DEFAULT 0,
  alerts_resolved    INTEGER NOT NULL DEFAULT 0,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS job_run_name_idx ON job_run (job_name, started_at DESC);

-- Advisory-style lock rows so two overlapping watchdog invocations cannot
-- both process the same tick.
CREATE TABLE IF NOT EXISTS job_lock (
  job_name    TEXT PRIMARY KEY,
  locked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_health (
  name              TEXT PRIMARY KEY,
  -- 'connected'|'degraded'|'failed'|'planned'|'not_connected'.
  -- Handoff and QuickBooks sit at 'planned' and must never raise alerts.
  state             TEXT NOT NULL DEFAULT 'not_connected',
  last_success_at   TIMESTAMPTZ,
  last_attempt_at   TIMESTAMPTZ,
  last_error        TEXT,
  records_processed INTEGER NOT NULL DEFAULT 0,
  cursor            TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS management_review (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('morning','afternoon','end_of_day','weekly')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Local date the review covers, so a retried job replaces rather than repeats.
  covers_date TEXT NOT NULL,
  payload     JSONB NOT NULL,
  summary     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS management_review_unique
  ON management_review (kind, covers_date);

-- Messages that arrived but could not be confidently classified. Uncertain
-- classification always goes to a human rather than starting a lead workflow.
CREATE TABLE IF NOT EXISTS review_queue (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source        TEXT NOT NULL,
  reason        TEXT NOT NULL,
  payload       JSONB NOT NULL,
  gmail_message_id TEXT UNIQUE,
  resolved_at   TIMESTAMPTZ,
  resolved_by   BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  resolution    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_queue_open_idx ON review_queue (resolved_at) WHERE resolved_at IS NULL;
