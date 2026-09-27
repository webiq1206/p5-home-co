-- Durable customer follow-up requests. Never drop or recreate this table.
CREATE TABLE IF NOT EXISTS p5_estimator_review_requests (
  draft_id uuid NOT NULL,
  revision integer NOT NULL,
  contact jsonb NOT NULL,
  scope jsonb NOT NULL,
  status text NOT NULL DEFAULT 'saved',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(draft_id, revision)
);
