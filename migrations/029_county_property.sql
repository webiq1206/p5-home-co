-- County assessor property records, loaded from each county's own free public
-- data files. One row per parcel with a building on it; the project address is
-- matched to a row by its street address. Additive only.
CREATE TABLE IF NOT EXISTS county_property (
  county       TEXT NOT NULL,
  parcel       TEXT NOT NULL,
  address_key  TEXT NOT NULL,
  street_no    TEXT NOT NULL DEFAULT '',
  street_name  TEXT NOT NULL DEFAULT '',
  city         TEXT NOT NULL DEFAULT '',
  record       JSONB NOT NULL,
  loaded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (county, parcel)
);
CREATE INDEX IF NOT EXISTS county_property_address_idx ON county_property (address_key);
CREATE INDEX IF NOT EXISTS county_property_street_idx ON county_property (street_no, street_name);

CREATE TABLE IF NOT EXISTS county_property_load (
  county       TEXT PRIMARY KEY,
  homes        INTEGER NOT NULL DEFAULT 0,
  source_date  TEXT,
  started_at   TIMESTAMPTZ,
  loaded_at    TIMESTAMPTZ,
  error        TEXT
);
