-- Add-only. There is deliberately no automatically activated initial release.
-- The application repository exposes INSERT/SELECT only for both audit tables.
CREATE TABLE IF NOT EXISTS p5_pricing_release (
  version text PRIMARY KEY,
  digest char(64) NOT NULL,
  schema_version smallint NOT NULL CHECK (schema_version = 1),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  source_workbook text NOT NULL,
  source_revision text NOT NULL,
  staged_by bigint NOT NULL REFERENCES app_user(id),
  staged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version, digest)
);

CREATE TABLE IF NOT EXISTS p5_pricing_release_activation (
  generation bigint PRIMARY KEY CHECK (generation > 0),
  version text NOT NULL,
  digest char(64) NOT NULL,
  previous_version text REFERENCES p5_pricing_release(version),
  action text NOT NULL CHECK (action IN ('publish', 'rollback')),
  activated_by bigint NOT NULL REFERENCES app_user(id),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 8 AND 1000),
  verification_reference text NOT NULL CHECK (char_length(verification_reference) BETWEEN 3 AND 500),
  activated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (version, digest) REFERENCES p5_pricing_release(version, digest)
);

CREATE INDEX IF NOT EXISTS p5_pricing_release_activation_version_idx
  ON p5_pricing_release_activation(version, generation DESC);
