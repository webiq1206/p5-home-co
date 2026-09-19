-- Declare the estimator's own tables.
--
-- Every p5_estimator_* table was created only at runtime, by the
-- CREATE TABLE IF NOT EXISTS statements in lib/p5/store.ts, manualReview.ts,
-- referenceEndpoint.ts and events.ts. They therefore existed in production
-- while appearing nowhere in the declared schema, and Replit's publish step
-- compares the declared schema against production: it read them as orphans and
-- generated destructive migrations. On 2026-09-15 a publish of Boise
-- Remodeling Co proposed DROP TABLE "p5_estimator_events" CASCADE, with the
-- 14 rows of provider telemetry in it, and a publish that is not approved at
-- that prompt does not promote - which is why 2026-09-14.3 never reached any
-- site. p5_estimator_drafts (every saved project, scope and contact) and
-- p5_estimator_outbox (estimates not yet delivered) were exposed to the same
-- diff.
--
-- The statements below match the runtime DDL exactly, so on an existing
-- database every one is a no-op. Their only job is to make these tables part
-- of the declared schema. Keep this file and the runtime DDL in step: the
-- runtime path still runs first on a cold database.
CREATE TABLE IF NOT EXISTS p5_estimator_drafts (id uuid PRIMARY KEY, key_hash text NOT NULL, brand text NOT NULL, revision integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'draft', payload jsonb NOT NULL DEFAULT '{}', internal_estimate jsonb, customer_estimate jsonb, submitted_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS p5_estimator_files (id uuid PRIMARY KEY, draft_id uuid NOT NULL REFERENCES p5_estimator_drafts(id), name text NOT NULL, mime_type text NOT NULL, size_bytes integer NOT NULL, sha256 text NOT NULL, data_base64 text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(draft_id, sha256));
ALTER TABLE p5_estimator_files ADD COLUMN IF NOT EXISTS storage_bucket text;
ALTER TABLE p5_estimator_files ADD COLUMN IF NOT EXISTS storage_key text;
CREATE TABLE IF NOT EXISTS p5_estimator_outbox (id uuid PRIMARY KEY, draft_id uuid NOT NULL REFERENCES p5_estimator_drafts(id), revision integer NOT NULL, destination text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, provider_id text, last_error text, locked_until timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, UNIQUE(draft_id, revision, destination));
CREATE INDEX IF NOT EXISTS p5_estimator_outbox_due ON p5_estimator_outbox(status,next_attempt_at);
CREATE TABLE IF NOT EXISTS p5_estimator_work (draft_id uuid NOT NULL REFERENCES p5_estimator_drafts(id), work_key text NOT NULL, payload jsonb NOT NULL DEFAULT '{}', lease_token text, lease_until timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(draft_id,work_key));
CREATE TABLE IF NOT EXISTS p5_estimator_events (id bigserial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), draft_id uuid, brand text NOT NULL, estimator text, kind text NOT NULL, stage text NOT NULL, file text, provider text, model text, status integer, code text, message text, duration_ms integer, attempt integer, fallback boolean NOT NULL DEFAULT false, outcome text NOT NULL, meta jsonb);
CREATE INDEX IF NOT EXISTS p5_estimator_events_draft ON p5_estimator_events(draft_id,created_at);
CREATE TABLE IF NOT EXISTS p5_estimator_policy (id text PRIMARY KEY, version integer NOT NULL DEFAULT 1, payload jsonb NOT NULL, updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS p5_estimator_reference_sets(version integer PRIMARY KEY,records jsonb NOT NULL,actor_id text NOT NULL,notes text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS p5_estimator_reference_checks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),draft_id uuid NOT NULL,review_id text NOT NULL,reference_version integer NOT NULL,selection jsonb NOT NULL,result jsonb NOT NULL,actor_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS p5_estimator_reviews (id text PRIMARY KEY,draft_id uuid NOT NULL REFERENCES p5_estimator_drafts(id),source_revision integer NOT NULL,input jsonb NOT NULL,finance jsonb NOT NULL,notes text NOT NULL,actor_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS p5_estimator_approvals(id uuid PRIMARY KEY,revision text NOT NULL,owner text NOT NULL,actor_id text NOT NULL,reason text NOT NULL,approved_at timestamptz NOT NULL DEFAULT now(),UNIQUE(revision,owner));
CREATE TABLE IF NOT EXISTS p5_estimator_history(draft_id uuid NOT NULL REFERENCES p5_estimator_drafts(id),revision integer NOT NULL,record jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(draft_id,revision));
CREATE TABLE IF NOT EXISTS p5_estimator_delivery_reviews(id uuid PRIMARY KEY,delivery_id uuid NOT NULL REFERENCES p5_estimator_outbox(id),actor_id text NOT NULL,decision text NOT NULL,evidence text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS p5_pricing_ledger (fingerprint text PRIMARY KEY, provider text NOT NULL, amount numeric(12,6) NOT NULL, state text NOT NULL, provider_id text, last_error text, active_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE p5_pricing_ledger ADD COLUMN IF NOT EXISTS active_until timestamptz;
CREATE TABLE IF NOT EXISTS p5_pricing_ledger_requests (fingerprint text NOT NULL REFERENCES p5_pricing_ledger(fingerprint), sequence integer NOT NULL, state text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(fingerprint,sequence));
