-- An operational directory extension. Finance/compliance continue using vendor_profile.
CREATE TABLE IF NOT EXISTS contractor_directory_profile (
  vendor_id bigint PRIMARY KEY REFERENCES vendor_profile(id),
  company text NOT NULL,
  contact text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  service_area text NOT NULL DEFAULT '',
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(capabilities) = 'array'),
  history text NOT NULL DEFAULT '',
  pricing_notes text NOT NULL DEFAULT '',
  hubspot_company_id text UNIQUE,
  hubspot_contact_id text UNIQUE,
  updated_by bigint REFERENCES app_user(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contractor_outreach_event (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES scope_project(id),
  contractor_id bigint NOT NULL REFERENCES vendor_profile(id),
  scope_version_id bigint,
  actor_id bigint NOT NULL REFERENCES app_user(id),
  status text NOT NULL CHECK (status IN ('not_contacted','contacted','bidding','follow_up','declined','awarded')),
  note text NOT NULL DEFAULT '',
  follow_up_at timestamptz,
  items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contractor_outreach_event_project_id_idx ON contractor_outreach_event(project_id,id DESC);
