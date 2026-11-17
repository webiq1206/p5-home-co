-- Site estimates into QuickBooks (owner decision, 13 and 17 November 2026).
--
-- A request form's planning range and the document estimator now become a
-- scope project with a QuickBooks estimate, as the guided estimator's already
-- do. A guided estimate is linked to its lead through guided_estimate; these
-- have no guided_estimate row, so the scope project carries the lead itself.
-- Additive only: one nullable column and its index. Existing rows stay NULL.
ALTER TABLE scope_project ADD COLUMN IF NOT EXISTS lead_deal_id BIGINT;
CREATE INDEX IF NOT EXISTS scope_project_lead_deal_idx ON scope_project (lead_deal_id);
