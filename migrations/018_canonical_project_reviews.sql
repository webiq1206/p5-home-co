-- Additive receipt ledger. Pending operations are held, never automatically replayed.
CREATE TABLE IF NOT EXISTS p5_canonical_review_projects (
 external_lead_id text PRIMARY KEY,
 source text NOT NULL,
 origin_site text NOT NULL,
 owner_id text,
 deal_id text,
 latest_revision integer NOT NULL DEFAULT 0,
 pending_operation text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS p5_canonical_review_operations (
 operation_key text PRIMARY KEY,
 external_lead_id text NOT NULL REFERENCES p5_canonical_review_projects(external_lead_id),
 source text NOT NULL,
 revision integer NOT NULL,
 snapshot_digest text NOT NULL,
 body_digest text NOT NULL,
 request jsonb NOT NULL,
 receipt jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(external_lead_id, source, revision)
);
