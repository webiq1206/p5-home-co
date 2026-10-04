-- Additive snapshot of services/document-service/src/database-schema.mjs.
-- Tests require exact statement parity. No rows, budgets, bindings or permits.
CREATE TABLE IF NOT EXISTS p5ds_documents (
 id text PRIMARY KEY,tenant text NOT NULL,project text NOT NULL,digest text NOT NULL,name text NOT NULL,
 bytes bytea NOT NULL,size_bytes bigint NOT NULL,state text NOT NULL DEFAULT 'queued',page_count integer,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),error_code text
);
CREATE TABLE IF NOT EXISTS p5ds_pages (
 document_id text NOT NULL REFERENCES p5ds_documents(id) ON DELETE CASCADE,page integer NOT NULL,
 native jsonb NOT NULL,image bytea NOT NULL,evidence jsonb,PRIMARY KEY(document_id,page)
);
CREATE TABLE IF NOT EXISTS p5ds_jobs (
 id text PRIMARY KEY,tenant text NOT NULL,project text NOT NULL,kind text NOT NULL,document_id text REFERENCES p5ds_documents(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'queued',priority integer NOT NULL DEFAULT 5,payload jsonb NOT NULL,progress jsonb NOT NULL DEFAULT '{}',result jsonb,
 attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,lease_token text,error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS p5ds_jobs_ready ON p5ds_jobs(state,available_at,lease_until);
CREATE TABLE IF NOT EXISTS p5ds_nonces(tenant text NOT NULL,nonce text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant,nonce));
CREATE TABLE IF NOT EXISTS p5ds_capacity(
 name text PRIMARY KEY,window_at timestamptz NOT NULL,requests integer NOT NULL,tokens bigint NOT NULL,cooldown_until timestamptz
);
CREATE TABLE IF NOT EXISTS p5ds_provider_leases(token text PRIMARY KEY,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS p5ds_metrics(id bigserial PRIMARY KEY,job_id text NOT NULL,stage text NOT NULL,duration_ms integer NOT NULL,detail jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS p5ds_qa_runs (
 run_id text PRIMARY KEY CHECK(run_id='p5-acceptance-20261004'),
 historical_microusd bigint NOT NULL CHECK(historical_microusd=3250000),
 historical_unknown_microusd bigint NOT NULL CHECK(historical_unknown_microusd=390000),
 allowance_microusd bigint NOT NULL CHECK(allowance_microusd=2000000),
 liability_microusd bigint NOT NULL DEFAULT 0 CHECK(liability_microusd>=0),
 blocked boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS p5ds_qa_projects (
 tenant text NOT NULL,project text NOT NULL,run_id text NOT NULL REFERENCES p5ds_qa_runs(run_id),
 lot29 boolean NOT NULL DEFAULT false,PRIMARY KEY(tenant,project)
);
CREATE TABLE IF NOT EXISTS p5ds_qa_intents (
 request_hash text PRIMARY KEY,run_id text NOT NULL REFERENCES p5ds_qa_runs(run_id),
 tenant text NOT NULL,project text NOT NULL,boundary text NOT NULL,request jsonb NOT NULL,
 maximum_microusd bigint NOT NULL CHECK(maximum_microusd>0),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS p5ds_qa_calls (
 slot text PRIMARY KEY,run_id text NOT NULL REFERENCES p5ds_qa_runs(run_id),
 request_hash text NOT NULL UNIQUE REFERENCES p5ds_qa_intents(request_hash),
 review_note text NOT NULL,status text NOT NULL CHECK(status IN ('permitted','in_flight','settled','unknown')),
 reserved_microusd bigint NOT NULL CHECK(reserved_microusd>0),actual_microusd bigint,
 response jsonb,provider_request_id text,boundary_token text,created_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz,settled_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS p5ds_qa_one_active ON p5ds_qa_calls(run_id)
 WHERE status IN ('permitted','in_flight');
