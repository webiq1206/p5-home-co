-- SOURCE ONLY: never imported by startup or documentSchemaStatements.
-- Requires explicit review/application after permitted authoritative accounting.
-- Leaves the original $2 allowance, run, calls, history and unknown holds intact.
CREATE TABLE IF NOT EXISTS p5ds_qa_research_admission (
 run_id text PRIMARY KEY REFERENCES p5ds_qa_runs(run_id) CHECK(run_id='p5-acceptance-20261004'),
 request_hash text NOT NULL UNIQUE REFERENCES p5ds_qa_intents(request_hash),
 identity jsonb NOT NULL,
 accounting_epoch text NOT NULL CHECK(accounting_epoch ~ '^[a-f0-9]{64}$'),
 evidence_hash text NOT NULL CHECK(evidence_hash ~ '^[a-f0-9]{64}$'),
 external_microusd bigint NOT NULL CHECK(external_microusd>=7190000 AND external_microusd<=10000000),
 observed_at_ms bigint NOT NULL CHECK(observed_at_ms>=0),
 expires_at_ms bigint NOT NULL CHECK(expires_at_ms>observed_at_ms AND expires_at_ms-observed_at_ms<=120000),
 created_at timestamptz NOT NULL DEFAULT now()
);
