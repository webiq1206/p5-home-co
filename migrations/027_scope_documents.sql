-- Large uploads and sheet-by-sheet reading for the scope platform.
--
-- scope_upload_part holds the pieces of a file too large to send in one
-- request; they are joined into one scope_asset and removed. scope_sheet holds
-- what was read from each page of a long PDF (a plan set or a long scope), so
-- reading can continue across requests and is never repeated. Additive only.
CREATE TABLE IF NOT EXISTS scope_upload_part (
  project_id  BIGINT NOT NULL REFERENCES scope_project(id),
  upload_key  TEXT NOT NULL,
  part        INTEGER NOT NULL CHECK (part >= 0),
  data        BYTEA NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, upload_key, part)
);

CREATE TABLE IF NOT EXISTS scope_sheet (
  asset_id   BIGINT NOT NULL REFERENCES scope_asset(id),
  page       INTEGER NOT NULL CHECK (page >= 1),
  notes      TEXT,
  error      TEXT,
  read_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, page)
);
