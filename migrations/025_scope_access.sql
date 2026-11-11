-- Scopes-only accounts.
--
-- A person with scopes_only = true can sign in to the scope platform at
-- /scopes and nothing else: the admin panel treats the account as not signed
-- in. This is how contractors are given access without seeing leads, finance
-- or the knowledge center. Additive only; every existing account keeps false.
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS scopes_only BOOLEAN NOT NULL DEFAULT false;
