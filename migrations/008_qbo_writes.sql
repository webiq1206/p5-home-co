-- ---------------------------------------------------------------------------
-- Writing back to QuickBooks (S212-41 reversed by owner decision 2026-08-23).
--
-- Until now the integration was read-only: QuickBooks held the posted truth and
-- P5 Admin only mirrored it. Writing changes that, and the danger is not a
-- failed write - it is a SUCCEEDED write we did not realise succeeded, retried,
-- and thereby duplicated. A duplicated bill is a duplicated payment.
--
-- So every write goes through this ledger first. The unique idempotency_key is
-- the guard: the same logical intent can be attempted any number of times and
-- can only ever produce one QuickBooks record. A retry finds the existing row
-- and returns the qbo_id it already earned instead of posting again.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS qbo_write_intent (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Deterministic from (entity, operation, natural key of the thing being
  -- written). Deliberately NOT random: a retry after a timeout must compute
  -- the same key, or the guard is worthless.
  idempotency_key TEXT NOT NULL UNIQUE,

  entity          TEXT NOT NULL,
  operation       TEXT NOT NULL CHECK (operation IN ('create','update')),
  payload         JSONB NOT NULL,

  -- 'pending' is also the in-flight state. A row stuck pending means we do not
  -- know whether QuickBooks accepted it; that is a conflict for a human, not
  -- something to silently retry into a duplicate.
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','succeeded','failed','needs_review')),

  qbo_id          TEXT,          -- the record we created; proof it happened
  sync_token      TEXT,          -- QBO optimistic-concurrency token for updates
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,

  requested_by    BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

-- Anything not yet resolved is operational work: either in flight or stuck.
CREATE INDEX IF NOT EXISTS qbo_write_intent_open_idx
  ON qbo_write_intent (created_at) WHERE status IN ('pending','needs_review');

CREATE INDEX IF NOT EXISTS qbo_write_intent_entity_idx
  ON qbo_write_intent (entity, qbo_id);
