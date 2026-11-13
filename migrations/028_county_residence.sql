-- County assessor building records, copied from the county's own free
-- download so an address can be looked up by parcel number.
--
-- Ada County publishes its residential characteristics twice a month
-- (app/lib/estimator/county-records.ts). The file holds no owner names.
-- This is a copy of a public record, refreshed in place; it is not customer
-- data and nothing else in the application refers to its rows.
--
-- Additive only.

CREATE TABLE IF NOT EXISTS county_residence (
  county                    TEXT NOT NULL,
  parcel                    TEXT NOT NULL,
  -- Residential records the county holds for this parcel. More than one
  -- means two dwellings on one lot, and the estimator then reports nothing.
  records                   INTEGER NOT NULL DEFAULT 1,
  year_built                INTEGER,
  bedrooms                  INTEGER,
  bathrooms                 NUMERIC(5,2),
  ground_sqft               INTEGER NOT NULL DEFAULT 0,
  upper_sqft                INTEGER NOT NULL DEFAULT 0,
  lower_finished_sqft       INTEGER NOT NULL DEFAULT 0,
  lower_unfinished_sqft     INTEGER NOT NULL DEFAULT 0,
  basement_finished_sqft    INTEGER NOT NULL DEFAULT 0,
  basement_unfinished_sqft  INTEGER NOT NULL DEFAULT 0,
  attic_finished_sqft       INTEGER NOT NULL DEFAULT 0,
  garage_sqft               INTEGER NOT NULL DEFAULT 0,
  design                    INTEGER,
  imported_at               TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (county, parcel)
);

CREATE TABLE IF NOT EXISTS county_residence_import (
  county       TEXT PRIMARY KEY,
  imported_at  TIMESTAMPTZ NOT NULL,
  row_count    INTEGER NOT NULL,
  source       TEXT NOT NULL
);
