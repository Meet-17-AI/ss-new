-- Dashboard access grants.
--
-- Holds only the EXTRA dashboards a user has been given. The one that comes with
-- their role is implicit and never stored, which is what makes this table safe to
-- create on a live system: with zero rows every existing user keeps exactly the
-- access they have today, and no backfill is needed.
--
-- It also makes lockout impossible. A table that stored the complete set could be
-- saved empty, leaving someone with no dashboard at all; here the base scope is
-- computed from users.role and cannot be deleted.

CREATE TABLE IF NOT EXISTS user_access_grants (
  user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope       TEXT        NOT NULL CHECK (scope IN ('admin_dashboard', 'therapist_dashboard', 'crm')),
  -- Who granted it, kept for the audit question this table exists to answer.
  -- Not a foreign key: the Fluidadmin login is hardcoded with a dummy id that has
  -- no users row, and a constraint here would reject its writes at runtime.
  granted_by  INTEGER,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope)
);

COMMENT ON TABLE user_access_grants IS
  'Extra dashboards granted to a user beyond the one implied by users.role. Absence of a row means no extra access, never no access.';

-- Every request resolves a caller''s scopes by user_id, so that lookup is the one
-- that has to stay cheap. The primary key already covers it.
