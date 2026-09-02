-- ===========================================================================
--  Schema sync:  ss_clone_db_v2  ->  safestories_db_v2
--  Generated 2026-09-02 by diffing the two live catalogs.
-- ===========================================================================
--
--  WHAT THIS DOES
--    Brings production's SCHEMA up to what the current panel/CRM code expects.
--    It carries NO rows out of the test database. Every value written here is
--    derived from production's own data (or is a constant default).
--
--  WHY IT IS SAFE TO RUN ON A LIVE DATABASE
--    * Purely additive. There is not one DROP, one type change, or one column
--      rename in this file. The catalog diff found no prod-only object missing
--      from test, so nothing has to be removed to converge.
--    * Idempotent. Every statement is IF NOT EXISTS or guarded by a DO block,
--      and the two backfills in Section D have WHERE clauses that make a second
--      run a no-op. Re-running after a partial failure is fine.
--    * Transactional. Postgres does DDL inside transactions, so the whole file
--      commits or none of it does. Do not add COMMIT statements in the middle.
--
--  LOCKING / DOWNTIME
--    ALTER TABLE ... ADD COLUMN with a constant default is metadata-only from
--    PG11 on, so it does not rewrite the table. The real cost is Section D,
--    which UPDATEs every booking row (~1,226) and holds a ROW EXCLUSIVE lock on
--    `bookings` for the duration. On a 4 MB table that is well under a second.
--    Expect a brief write pause on bookings, not an outage.
--
--  ORDER OF OPERATIONS AGAINST THE DEPLOY
--    Run this BEFORE the new code is released. The new build reads
--    bookings.public_token on its public confirmation route; the old build
--    never looks at any of these objects, so the gap between migrating and
--    deploying is safe in that direction and only in that direction.
--
--  VERIFIED PRECONDITIONS (read-only probes against safestories_db_v2)
--    * PostgreSQL 18.1 — gen_random_uuid() is built in, no pgcrypto needed.
--    * Every booking carries a check-in URL — 1,226 of 1,226 when last measured,
--      all on the single origin https://panel.safestories.in, all ending in their
--      own booking_id, zero duplicates. Section D's rewrite is therefore total and
--      unambiguous. The count moves as production keeps trading; the property that
--      matters (every row has one, none is shared) is what Section D re-checks.
--    * users.id is integer and therapy_services.id is integer, so the two
--      foreign keys below line up.
--    * None of the nine new tables already exist in production.
-- ===========================================================================

BEGIN;

-- Fail loudly rather than half-applying if the database is not an intended one.
--
-- TWO names are accepted, and the second is the point of the rehearsal:
--   safestories_prod_v2  — the byte-exact copy of production. Run here FIRST.
--   safestories_db_v2    — production itself. Run here once the copy checks out.
--
-- The clone (ss_clone_db_v2) is deliberately absent: it already has every one of
-- these objects, and re-running this against it would prove nothing.
DO $$
BEGIN
  IF current_database() NOT IN ('safestories_db_v2', 'safestories_prod_v2') THEN
    RAISE EXCEPTION
      'Refusing to run: expected safestories_db_v2 or safestories_prod_v2, got %',
      current_database();
  END IF;
END $$;

-- A slow lock is a queue of stalled user requests. Give up instead of blocking.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';


-- ===========================================================================
--  SECTION A — NEW TABLES
-- ===========================================================================

-- A1. Pricing engine -------------------------------------------------------
--
-- These four are the pricing engine's whole storage. None exist in production
-- today, and none are created at application boot, so this file is the only
-- thing that puts them there. Until they hold rows the engine resolves through
-- its legacy path (therapy_services.charges), which is exactly today's
-- behaviour — so creating them empty changes no price.

-- The list price in force for a therapy, as a dated series rather than a single
-- mutable number, so a price change cannot silently rewrite history.
CREATE TABLE IF NOT EXISTS therapy_price_schedule (
  id                   SERIAL PRIMARY KEY,
  service_id           INTEGER NOT NULL REFERENCES therapy_services(id) ON DELETE CASCADE,
  amount               NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  currency             VARCHAR(3) NOT NULL DEFAULT 'INR',
  effective_from       TIMESTAMPTZ NOT NULL,
  -- When true, clients who already booked keep the older price (see client_price_lock).
  grandfather_existing BOOLEAN NOT NULL DEFAULT true,
  note                 TEXT,
  created_by           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at           TIMESTAMPTZ,
  revoked_by           TEXT
);

-- A hand-set price for one client, overriding the schedule. service_id NULL
-- means "all therapies"; resolution prefers a therapy-specific row.
CREATE TABLE IF NOT EXISTS client_price_override (
  id                   SERIAL PRIMARY KEY,
  client_email         TEXT,
  client_phone_digits  TEXT,
  client_name          TEXT,
  service_id           INTEGER REFERENCES therapy_services(id) ON DELETE CASCADE,
  amount               NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  currency             VARCHAR(3) NOT NULL DEFAULT 'INR',
  effective_from       TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_until      TIMESTAMPTZ,
  reason               TEXT,
  created_by           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at           TIMESTAMPTZ,
  revoked_by           TEXT,
  -- A rule with no way to identify its client can never match anything.
  CONSTRAINT client_price_override_identity
    CHECK (client_email IS NOT NULL OR client_phone_digits IS NOT NULL)
);

-- The grandfather record: the price a returning client keeps paying after a
-- rise. Written on their first paid booking, read on every one after.
CREATE TABLE IF NOT EXISTS client_price_lock (
  id                   SERIAL PRIMARY KEY,
  client_email         TEXT,
  client_phone_digits  TEXT,
  service_id           INTEGER NOT NULL REFERENCES therapy_services(id) ON DELETE CASCADE,
  locked_amount        NUMERIC(10,2) NOT NULL CHECK (locked_amount >= 0),
  currency             VARCHAR(3) NOT NULL DEFAULT 'INR',
  source               TEXT NOT NULL DEFAULT 'first_booking',
  first_booking_id     TEXT,
  locked_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at          TIMESTAMPTZ,
  released_by          TEXT,
  CONSTRAINT client_price_lock_identity
    CHECK (client_email IS NOT NULL OR client_phone_digits IS NOT NULL)
);

-- Append-only audit of every price the engine resolved, and why. This is what
-- answers "why was this client charged that?" months later.
CREATE TABLE IF NOT EXISTS price_resolution_log (
  id                   BIGSERIAL PRIMARY KEY,
  booking_id           TEXT,
  service_id           INTEGER,
  client_email         TEXT,
  client_phone_digits  TEXT,
  resolved_amount      NUMERIC(10,2),
  list_amount          NUMERIC(10,2),
  price_source         TEXT NOT NULL,
  rule_id              INTEGER,
  is_grandfathered     BOOLEAN NOT NULL DEFAULT false,
  context              TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A2. Client wallet --------------------------------------------------------
--
-- The wallet balance is not stored as a number anywhere; it is the sum of this
-- ledger. Amount is always positive and `direction` carries the sign, so a
-- credit can never be booked as a negative debit by accident.
CREATE TABLE IF NOT EXISTS wallet_transactions (
  txn_id               SERIAL PRIMARY KEY,
  -- Normalised client identity (email or phone) the balance is summed over.
  client_key           VARCHAR(120) NOT NULL,
  client_name          VARCHAR(255),
  client_phone         VARCHAR(50),
  client_email         VARCHAR(255),
  direction            VARCHAR(10) NOT NULL CHECK (direction IN ('CREDIT','DEBIT')),
  reason               VARCHAR(40) NOT NULL CHECK (reason IN (
                         'CANCELLATION_CREDIT','BOOKING_SETTLEMENT','REFUND_OUT',
                         'MANUAL_ADJUSTMENT','TRANSFER_ADJUSTMENT')),
  amount               NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency             VARCHAR(10) NOT NULL DEFAULT 'INR',
  source_booking_id    TEXT,
  source_payment_mode  VARCHAR(20),
  notes                TEXT,
  created_by_user_id   INTEGER,
  created_by_name      VARCHAR(255),
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A3. Access control -------------------------------------------------------
--
-- These three ARE created at application boot as well. They are repeated here
-- so the migration leaves a complete schema even if the new build has not
-- started yet, and so the definitions are reviewable in one place. CREATE TABLE
-- IF NOT EXISTS makes the overlap harmless in either order.

-- Extra scopes granted to a user on top of the ones their role implies. Role
-- stays immutable; this is the additive half.
CREATE TABLE IF NOT EXISTS user_access_grants (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL CHECK (scope IN ('admin_dashboard','therapist_dashboard','crm','superadmin')),
  granted_by  INTEGER,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope)
);

-- Short-lived single-use tokens for the panel -> CRM login handoff.
CREATE TABLE IF NOT EXISTS auth_handoff_tokens (
  jti         TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  scope       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What the scope gate WOULD have blocked while it runs in shadow mode. This is
-- a table and not an in-memory counter precisely so a restart cannot erase the
-- evidence you are meant to read before switching the gate to enforcing.
CREATE TABLE IF NOT EXISTS access_shadow_denials (
  service   TEXT NOT NULL,
  route     TEXT NOT NULL,
  role      TEXT NOT NULL,
  scope     TEXT NOT NULL,
  count     BIGINT NOT NULL DEFAULT 1,
  first_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (service, route, role)
);

-- NOT MIGRATED, deliberately: therapy_services_desc_backup_20260807.
-- That table is a dated one-off snapshot someone took in the test database
-- before editing service descriptions. It is a backup artifact, not part of
-- the schema, and nothing in the codebase reads it.


-- ===========================================================================
--  SECTION B — NEW COLUMNS ON EXISTING TABLES
-- ===========================================================================

-- B1. bookings -------------------------------------------------------------

-- The capability that replaced booking_id on the public confirmation route.
-- booking_id is a six-digit number, so the old public lookup could be walked
-- end to end — every client's name, therapist, therapy and joining link for the
-- cost of 900k requests. Backfilled in Section D; NOT NULL is deliberately not
-- asserted so this column can be added without a table rewrite.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS public_token TEXT;

-- Which therapy_services row priced this booking, captured at booking time.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_id INTEGER;

-- The pricing engine's verdict, frozen onto the booking: which rule won, and
-- what it quoted. Kept here as well as in price_resolution_log so reading a
-- booking never needs a join.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS price_source    TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS quoted_amount   NUMERIC(10,2);

-- How much of the charge was settled from wallet balance rather than a payment.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS wallet_amount_applied NUMERIC(12,2) NOT NULL DEFAULT 0;

-- What the admin chose to do about money when cancelling, and who chose it.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancellation_action    TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancellation_action_by TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancellation_action_at TIMESTAMPTZ;

-- B2. client_transfer_history ---------------------------------------------
--
-- The transfer wizard records not just that a transfer happened but exactly
-- what it moved, so a partially-completed transfer is diagnosable afterwards.

-- Makes a retried transfer request land once instead of twice.
ALTER TABLE client_transfer_history ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64);
ALTER TABLE client_transfer_history ADD COLUMN IF NOT EXISTS booking_ids       JSONB   NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE client_transfer_history ADD COLUMN IF NOT EXISTS bookings_moved    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE client_transfer_history ADD COLUMN IF NOT EXISTS sessions_cancelled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE client_transfer_history ADD COLUMN IF NOT EXISTS wallet_credited   NUMERIC(12,2) NOT NULL DEFAULT 0;
-- Whether the Google Calendar side of the transfer succeeded, partially applied, or was skipped.
ALTER TABLE client_transfer_history ADD COLUMN IF NOT EXISTS calendar_status   VARCHAR(20) NOT NULL DEFAULT 'none';
ALTER TABLE client_transfer_history ADD COLUMN IF NOT EXISTS outcome           JSONB   NOT NULL DEFAULT '{}'::jsonb;

-- B3. password_reset_tokens ------------------------------------------------
--
-- Without this counter the OTP endpoint accepted unlimited guesses at a
-- six-digit code, which is minutes of work. The reset flow now keys on email
-- and refuses a record after five failures.
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;


-- ===========================================================================
--  SECTION C — INDEXES AND TABLE CONSTRAINTS
-- ===========================================================================

-- C1. Pricing lookups ------------------------------------------------------

-- One live schedule row per therapy per effective date. Partial on revoked_at
-- so superseding a price does not collide with the row it replaces.
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_schedule_service_effective
  ON therapy_price_schedule (service_id, effective_from) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_price_schedule_lookup
  ON therapy_price_schedule (service_id, effective_from DESC) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_client_price_override_email
  ON client_price_override (client_email, service_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_client_price_override_phone
  ON client_price_override (client_phone_digits, service_id) WHERE revoked_at IS NULL;

-- Two unique indexes, not one, and the split is load-bearing.
--
-- A client identified by email gets uq_..._email. A client with only a phone
-- number has client_email NULL, and NULLs are all distinct to a unique index —
-- so a single index over (email, service_id) would have let the same
-- phone-only client accumulate a fresh lock on every booking. The second index
-- covers exactly that case, and its WHERE client_email IS NULL keeps the two
-- from ever both applying to the same row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_price_lock_email
  ON client_price_lock (client_email, service_id)
  WHERE released_at IS NULL AND client_email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_price_lock_phone_only
  ON client_price_lock (client_phone_digits, service_id)
  WHERE released_at IS NULL AND client_email IS NULL AND client_phone_digits IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_client_price_lock_phone
  ON client_price_lock (client_phone_digits, service_id) WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_price_resolution_log_booking ON price_resolution_log (booking_id);
CREATE INDEX IF NOT EXISTS idx_price_resolution_log_created ON price_resolution_log (created_at DESC);

-- C2. Wallet ---------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_wallet_txn_client  ON wallet_transactions (client_key, txn_id);
CREATE INDEX IF NOT EXISTS idx_wallet_txn_booking ON wallet_transactions (source_booking_id);

-- Stops one cancellation being credited to a wallet twice. Scoped to the two
-- automatic reasons only: manual adjustments are legitimately repeatable, so
-- including them would block an admin from making the same correction twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_txn_booking_reason
  ON wallet_transactions (source_booking_id, reason)
  WHERE source_booking_id IS NOT NULL
    AND reason IN ('CANCELLATION_CREDIT','BOOKING_SETTLEMENT');

-- C3. bookings -------------------------------------------------------------

-- Created here but populated in Section D. A unique index over a column that is
-- still all-NULL is legal (NULLs do not conflict), but it is created AFTER the
-- backfill below to avoid maintaining it during the bulk UPDATE.

CREATE INDEX IF NOT EXISTS idx_bookings_service_id ON bookings (service_id);
CREATE INDEX IF NOT EXISTS idx_bookings_cancellation_action
  ON bookings (cancellation_action) WHERE cancellation_action IS NOT NULL;
-- Client lookups compare emails case-insensitively; without this the predicate
-- cannot use an index and every client-history read is a sequential scan.
CREATE INDEX IF NOT EXISTS idx_bookings_invitee_email_lower ON bookings (lower(invitee_email));

-- Restricts cancellation_action to the three the UI can actually produce.
-- ADD CONSTRAINT has no IF NOT EXISTS, hence the guard.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_cancellation_action_chk') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_cancellation_action_chk
      CHECK (cancellation_action IS NULL
             OR cancellation_action IN ('no_refund','wallet_credit','offline_refund'));
  END IF;
END $$;

-- C4. client_transfer_history ---------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS uq_transfer_idempotency
  ON client_transfer_history (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transfer_client
  ON client_transfer_history (client_phone, client_email, transfer_date DESC);
CREATE INDEX IF NOT EXISTS idx_transfer_therapists
  ON client_transfer_history (to_therapist_id, from_therapist_id);

-- C5. auth_handoff_tokens --------------------------------------------------

CREATE INDEX IF NOT EXISTS auth_handoff_expires_idx ON auth_handoff_tokens (expires_at);


-- ===========================================================================
--  SECTION D — DATA BACKFILL  (production's own rows only)
-- ===========================================================================
--
-- Nothing here copies a value from the test database. D1 generates fresh
-- randomness; D2 rewrites production strings in place.

-- D1. Give every existing booking a public token.
--
-- Two UUIDs with the dashes stripped is 64 hex characters / 256 bits, far past
-- anything enumerable. gen_random_uuid() is core in PG13+ so no extension is
-- required. The WHERE clause makes a second run a no-op and, more importantly,
-- means a re-run can never re-roll a token that is already out in a client's
-- inbox.
UPDATE bookings
   SET public_token = replace(gen_random_uuid()::text, '-', '')
                   || replace(gen_random_uuid()::text, '-', '')
 WHERE public_token IS NULL;

-- Uniqueness asserted after the fill, so the index is built once over final
-- data rather than maintained row by row through the UPDATE.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_public_token ON bookings (public_token);

-- D2. Repoint the stored check-in URLs at the token.
--
-- This is the step that must not be skipped. Every production row holds
-- "https://panel.safestories.in/booking-confirmation/<booking_id>", and once the
-- new code is live that URL 404s. The reschedule flow sends this exact string
-- to clients over WhatsApp and email, so skipping this breaks the link in every
-- message about an existing booking.
--
-- Only the last path segment is swapped; the origin is preserved rather than
-- hardcoded, so the statement stays correct if any row ever carries a different
-- host. The final NOT LIKE makes the whole statement a no-op on re-run.
UPDATE bookings
   SET public_booking_checkin_url =
         regexp_replace(public_booking_checkin_url,
                        '/booking-confirmation/[^/]*$',
                        '/booking-confirmation/' || public_token)
 WHERE public_token IS NOT NULL
   AND public_booking_checkin_url LIKE '%/booking-confirmation/%'
   AND public_booking_checkin_url NOT LIKE '%' || public_token;

-- D3. Refuse to commit if either backfill left work undone.
DO $$
DECLARE missing_token INTEGER; stale_url INTEGER;
BEGIN
  SELECT count(*) INTO missing_token FROM bookings WHERE public_token IS NULL;
  SELECT count(*) INTO stale_url FROM bookings
    WHERE public_booking_checkin_url LIKE '%/booking-confirmation/%'
      AND public_booking_checkin_url NOT LIKE '%' || public_token;
  IF missing_token > 0 OR stale_url > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % without token, % stale URL(s)', missing_token, stale_url;
  END IF;
  RAISE NOTICE 'Backfill verified: every booking has a token and a matching check-in URL.';
END $$;

COMMIT;


-- ===========================================================================
--  SECTION E — OPTIONAL price baseline  (NOT run by default)
-- ===========================================================================
--
-- Leaving therapy_price_schedule empty is a valid end state: the engine falls
-- back to therapy_services.charges and resolves every price with
-- source='legacy', which is bit-for-bit today's behaviour. Prices do not move.
--
-- What you lose by leaving it empty is the admin pricing screen, which reads
-- the schedule and will show nothing to edit until a baseline exists. Seeding
-- imports each therapy's CURRENT charge as a row effective 2000-01-01, so the
-- resolved amount is identical before and after — only `price_source` changes
-- from 'legacy' to 'schedule'.
--
-- The amount is parsed from production's own therapy_services.charges with the
-- same rule the application uses (strip everything that is not a digit or a
-- dot). It does not read the test database.
--
-- Run this ONLY once you have eyeballed the SELECT and agree with every number.
--
--   -- 1. Preview first. Nothing is written by this.
--   SELECT id AS service_id, therapy_type, charges AS raw,
--          COALESCE(NULLIF(regexp_replace(COALESCE(charges,''), '[^0-9.]', '', 'g'), ''), '0')::numeric(10,2)
--            AS seeded_amount
--     FROM therapy_services ORDER BY id;
--
--   -- 2. Then, if it looks right:
--   -- BEGIN;
--   -- INSERT INTO therapy_price_schedule
--   --        (service_id, amount, currency, effective_from, grandfather_existing, note, created_by)
--   -- SELECT id,
--   --        COALESCE(NULLIF(regexp_replace(COALESCE(charges,''), '[^0-9.]', '', 'g'), ''), '0')::numeric(10,2),
--   --        'INR',
--   --        TIMESTAMPTZ '2000-01-01 00:00:00+05:30',
--   --        true,
--   --        'baseline imported from therapy_services.charges',
--   --        'migration:2026-09-02'
--   --   FROM therapy_services
--   --  WHERE NOT EXISTS (SELECT 1 FROM therapy_price_schedule s
--   --                     WHERE s.service_id = therapy_services.id AND s.revoked_at IS NULL);
--   -- COMMIT;
--
-- user_access_grants is intentionally NOT seeded. The two rows in the test
-- database grant a therapist the admin dashboard and the CRM, which is test
-- scaffolding and would be a privilege escalation in production. Production's
-- 7 therapists / 3 admins / 1 sales user all get their access from the role
-- mapping already (therapist -> therapist_dashboard, admin -> admin_dashboard,
-- sales -> crm), so an empty grants table is the correct starting state.
-- ===========================================================================
