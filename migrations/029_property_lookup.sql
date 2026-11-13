-- Building records fetched from a property-data service, kept so each
-- address is asked for once and the monthly free allowance is never passed.
-- One row per lookup that reached the service, found or not.
--
-- Additive only.

CREATE TABLE IF NOT EXISTS property_lookup (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider    TEXT NOT NULL,
  -- The address as typed, lowercased with punctuation and spacing removed.
  address_key TEXT NOT NULL,
  -- The facts returned, or null when the service had no record.
  facts       JSONB,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS property_lookup_key ON property_lookup (provider, address_key);
CREATE INDEX IF NOT EXISTS property_lookup_month ON property_lookup (provider, fetched_at);
