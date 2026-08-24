-- Subcontractor document reminder log (S89).
--
-- The attention scanner already surfaces missing/expiring vendor documents to
-- the internal queue. This table is the send-once ledger for the OUTBOUND
-- reminder emailed to the subcontractor, so the daily job can email a sub the
-- moment a document enters a reminder band without re-emailing the same band
-- every morning.
--
-- One row per (vendor, document, band, cycle). "cycle_token" is the document's
-- current expiry date (or 'missing'/'none'), so renewing a certificate starts a
-- fresh cycle and the ladder can fire again; nothing is emailed twice for the
-- same certificate. No PII lives here: only the document TYPE and the band.

CREATE TABLE IF NOT EXISTS vendor_document_reminder (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vendor_id    BIGINT NOT NULL REFERENCES vendor_profile(id) ON DELETE CASCADE,
  doc_type     TEXT NOT NULL,
  -- Which rung of the ladder this send covered: 'missing', 'expired', or a
  -- 't<days>' band such as 't30' / 't14' / 't7' / 't0'.
  stage        TEXT NOT NULL,
  -- The document's expiry (ISO date) at send time, or 'missing' / 'none'. A new
  -- expiry means a new cycle, which is what lets the ladder legitimately repeat.
  cycle_token  TEXT NOT NULL,
  sent_to      TEXT NOT NULL,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, doc_type, stage, cycle_token)
);

CREATE INDEX IF NOT EXISTS vendor_document_reminder_vendor_idx
  ON vendor_document_reminder (vendor_id, doc_type);
