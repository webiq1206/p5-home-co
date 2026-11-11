-- Scope and estimate platform (internal, employee only).
--
-- One project row holds client facts and the three separately tracked
-- statuses (scope, QuickBooks estimate, QuickBooks project). Everything the
-- project collects (recordings, transcripts, files, scope versions, wizard
-- answers, estimates and every QuickBooks snapshot) hangs off it and is never
-- deleted by the application: archive hides a project from the active list,
-- it does not remove anything. Additive only.

CREATE TABLE IF NOT EXISTS scope_project (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title              TEXT NOT NULL DEFAULT '',
  client_first_name  TEXT,
  client_last_name   TEXT,
  client_email       TEXT,
  client_phone       TEXT,
  project_address    TEXT,
  billing_address    TEXT,
  service            TEXT NOT NULL DEFAULT 'remodel',
  finish_tier        TEXT NOT NULL DEFAULT 'mid',
  scope_status       TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (scope_status IN ('in_progress','needs_information','ready')),
  current_version_id BIGINT,
  pending_proposal   JSONB,
  processing_state   TEXT NOT NULL DEFAULT 'idle',
  processing_note    TEXT,
  processing_started_at TIMESTAMPTZ,
  qbo_customer_id    TEXT,
  qbo_customer_name  TEXT,
  qbo_project_id     TEXT,
  qbo_project_name   TEXT,
  qbo_project_linked_at TIMESTAMPTZ,
  qbo_project_linked_by BIGINT REFERENCES app_user(id),
  archived_at        TIMESTAMPTZ,
  created_by         BIGINT REFERENCES app_user(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scope_project_active_idx ON scope_project (archived_at, updated_at DESC);

-- Recordings (one row per independently decodable segment), dictated notes,
-- documents, plans, photos and trade quotes. client_key makes every upload
-- idempotent: a retried or duplicated upload of the same segment returns the
-- row it already created.
CREATE TABLE IF NOT EXISTS scope_asset (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id      BIGINT NOT NULL REFERENCES scope_project(id),
  client_key      TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('recording','note','document','photo','quote','text')),
  label           TEXT NOT NULL DEFAULT '',
  file_name       TEXT,
  mime_type       TEXT,
  size_bytes      BIGINT,
  sha256          TEXT,
  storage_bucket  TEXT,
  storage_key     TEXT,
  data            BYTEA,
  recording_id    TEXT,
  segment_index   INTEGER,
  offset_seconds  NUMERIC(10,2) NOT NULL DEFAULT 0,
  duration_seconds NUMERIC(10,2),
  body_text       TEXT,
  transcript      JSONB,
  state           TEXT NOT NULL DEFAULT 'stored'
    CHECK (state IN ('stored','transcribing','ready','failed')),
  error           TEXT,
  used_in_version BIGINT,
  created_by      BIGINT REFERENCES app_user(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, client_key)
);
CREATE INDEX IF NOT EXISTS scope_asset_project_idx ON scope_asset (project_id, created_at);

-- Every scope and pricing state that was ever current. Never updated in place.
CREATE TABLE IF NOT EXISTS scope_version (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id   BIGINT NOT NULL REFERENCES scope_project(id),
  version_no   INTEGER NOT NULL,
  source       TEXT NOT NULL,
  note         TEXT,
  doc          JSONB NOT NULL,
  pricing      JSONB,
  created_by   BIGINT REFERENCES app_user(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, version_no)
);

-- Wizard answers, keyed by the stable question key so a re-derived question
-- finds its earlier answer instead of being asked again.
CREATE TABLE IF NOT EXISTS scope_answer (
  project_id   BIGINT NOT NULL REFERENCES scope_project(id),
  question_key TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('answered','deferred')),
  answer       JSONB,
  asset_id     BIGINT REFERENCES scope_asset(id),
  answered_by  BIGINT REFERENCES app_user(id),
  answered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, question_key)
);

-- The QuickBooks estimate linked to a project, with the exact scope version
-- and the exact lines that were sent.
CREATE TABLE IF NOT EXISTS scope_estimate (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id      BIGINT NOT NULL REFERENCES scope_project(id),
  version_id      BIGINT NOT NULL REFERENCES scope_version(id),
  qbo_estimate_id TEXT,
  doc_number      TEXT,
  sync_token      TEXT,
  txn_status      TEXT,
  email_status    TEXT,
  accepted_by     TEXT,
  accepted_date   TEXT,
  linked_invoice  TEXT,
  total           NUMERIC(14,2),
  sent_payload    JSONB NOT NULL,
  qbo_snapshot    JSONB,
  drift           JSONB,
  status_error    TEXT,
  last_synced_at  TIMESTAMPTZ,
  created_by      BIGINT REFERENCES app_user(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scope_estimate_project_idx ON scope_estimate (project_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS scope_estimate_qbo_idx ON scope_estimate (qbo_estimate_id);

-- Every distinct state of the estimate seen in QuickBooks, so a change made
-- directly in QuickBooks can be compared against what was sent.
CREATE TABLE IF NOT EXISTS scope_estimate_snapshot (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  estimate_id  BIGINT NOT NULL REFERENCES scope_estimate(id),
  sync_token   TEXT,
  source       TEXT NOT NULL,
  raw          JSONB NOT NULL,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (estimate_id, sync_token)
);

-- QuickBooks products and services, mirrored so estimate lines can be mapped
-- to real items and the setup check can show what exists.
CREATE TABLE IF NOT EXISTS qbo_item (
  qbo_id      TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  fully_qualified_name TEXT,
  item_type   TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  taxable     BOOLEAN,
  parent_qbo_id TEXT,
  raw         JSONB NOT NULL,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One settings row for the platform: labor rate and its treatment, item map.
CREATE TABLE IF NOT EXISTS scope_settings (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  value       JSONB NOT NULL,
  updated_by  BIGINT REFERENCES app_user(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scope_event (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  BIGINT NOT NULL REFERENCES scope_project(id),
  kind        TEXT NOT NULL,
  detail      JSONB,
  actor       BIGINT REFERENCES app_user(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scope_event_project_idx ON scope_event (project_id, created_at DESC);
