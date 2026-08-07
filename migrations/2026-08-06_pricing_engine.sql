-- =====================================================================
-- Pricing engine: scheduled price changes, grandfathering, client overrides
-- Date: 2026-08-06
-- =====================================================================
--
-- WHY THIS EXISTS
-- ---------------
-- Before this migration the price of a therapy was a single loosely-typed
-- column: therapy_services.charges, a VARCHAR holding values like '₹3000',
-- '₹', '0'. It had no history and no effective date, so editing it changed
-- the price for everyone instantly and left no record of the previous value.
--
-- This migration replaces "price is a column" with "price is a value resolved
-- from a rule set". Resolution happens exclusively server-side in
-- panel-backend/src/lib/pricing.ts, in this priority order:
--
--   0. therapy_services.is_payment_enabled = false      -> free, short-circuit
--   1. client_price_override   (this client, this therapy, then all therapies)
--   2. client_price_lock       (grandfathered rate for an existing client)
--   3. therapy_price_schedule  (the list price in force at that moment)
--   4. therapy_services.charges parsed  (legacy fallback, never break)
--
-- therapy_services.charges is DELIBERATELY LEFT IN PLACE. It stays as the
-- display fallback and is still written by the Therapies tab editor, so an
-- older build of the app keeps working. It is no longer authoritative.
--
--
-- SAFE TO RE-RUN. Every statement is idempotent.
--
--
-- PRODUCTION DEPLOYMENT
-- ---------------------
-- Run this file inside a single transaction (BEGIN; \i <file>; COMMIT;) and
-- verify with the queries at the bottom before committing.
--
-- Ordering matters — deploy the SCHEMA FIRST, then the application code:
--
--   1. Run this migration.
--   2. Deploy the backend. It reads the new tables through
--      panel-backend/src/lib/pricing.ts.
--   3. Deploy the frontend.
--
-- Running it the other way round leaves the backend querying tables that do
-- not exist; resolvePrice() swallows those errors and falls back to
-- therapy_services.charges, so bookings keep working at the old price rather
-- than failing — but the window should still be kept short.
--
-- BREAKING API CHANGE in the same deploy: POST /api/razorpay/create-order no
-- longer accepts `amount`. It now takes { slug | serviceId, email, phone } or
-- { bookingId }. Any client still posting `amount` gets a 400. The only callers
-- are components/BookingPage.tsx and components/PaymentCheckoutPage.tsx, both
-- shipped together with this change.
--
-- Applied to ss_clone_db_v2 on 2026-08-06. Results there:
--   833 of 1063 bookings mapped to a service_id
--   218 grandfather locks created across 9 therapies
--   15 baseline schedule rows (one per therapy)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Give bookings a real link to the therapy that was booked.
-- ---------------------------------------------------------------------
-- Until now the only connection between a booking and therapy_services was
-- booking_resource_name — free text, and deliberately flattened by
-- canonicalTherapyLabel() into three generic buckets before being stored.
-- The live data had drifted into variants ('...with Ambika' vs
-- '...with Ambika Vaidya') plus 85 rows of bare 'Individual Therapy Session'.
--
-- Grandfathering asks "has this client booked THIS therapy before?", which
-- that text cannot answer reliably. service_id makes it answerable.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_id INTEGER;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS price_source TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS quoted_amount NUMERIC(10,2);

CREATE INDEX IF NOT EXISTS idx_bookings_service_id ON bookings (service_id);

-- Client-identity lookups run on every price resolution, on the public
-- booking page, on a debounce. They need to be cheap.
CREATE INDEX IF NOT EXISTS idx_bookings_invitee_email_lower
  ON bookings (LOWER(invitee_email));


-- ---------------------------------------------------------------------
-- 2. therapy_price_schedule — the price timeline
-- ---------------------------------------------------------------------
-- One row per "from date D, this therapy costs X". The price in force is the
-- newest non-revoked row whose effective_from <= now(). Rows with a future
-- effective_from are scheduled changes; they are visible in the admin and can
-- be revoked before they land. Nothing is ever destroyed, so price history
-- stays available for audit and refund disputes.
--
-- effective_from is TIMESTAMPTZ, not DATE, on purpose. This platform is
-- IST-only (every date parse in index.ts uses GMT+0530) and booking_start_at
-- already carries several inconsistent timezone conventions. The API converts
-- the admin's chosen calendar date to IST midnight before storing, so
-- comparisons against now() cannot drift with server locale.

CREATE TABLE IF NOT EXISTS therapy_price_schedule (
  id                   SERIAL PRIMARY KEY,
  service_id           INTEGER NOT NULL REFERENCES therapy_services(id) ON DELETE CASCADE,
  amount               NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  currency             VARCHAR(3) NOT NULL DEFAULT 'INR',
  effective_from       TIMESTAMPTZ NOT NULL,

  -- When true (the default), clients who already booked this therapy keep
  -- their existing rate and only brand-new clients pay this amount. When
  -- false, this change applies to everyone and voids any grandfather lock
  -- taken out before it.
  grandfather_existing BOOLEAN NOT NULL DEFAULT TRUE,

  note                 TEXT,
  created_by           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at           TIMESTAMPTZ,
  revoked_by           TEXT
);

-- Two price changes for the same therapy on the same instant would make
-- "the price in force" ambiguous. Revoked rows are exempt so a mistaken
-- change can be revoked and re-entered at the same date.
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_schedule_service_effective
  ON therapy_price_schedule (service_id, effective_from)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_price_schedule_lookup
  ON therapy_price_schedule (service_id, effective_from DESC)
  WHERE revoked_at IS NULL;


-- ---------------------------------------------------------------------
-- 3. client_price_lock — the grandfathering ledger
-- ---------------------------------------------------------------------
-- Written ONCE, when a client's first paid booking for a therapy confirms.
--
-- This is the piece that makes grandfathering trustworthy. The alternative —
-- inferring "is this an existing client of this therapy" at resolution time by
-- matching booking_resource_name — depends on text that has already drifted
-- and will drift again. Recording the entitlement as a stored fact means it is
-- decided once, with the data available at that moment, and never re-derived.
--
-- client_phone_digits stores the LAST 10 DIGITS only. Stored phone numbers are
-- inconsistent ('+91 9764328147', '+919876543210', bare 10-digit), so the last
-- 10 digits are the only reliably comparable form.

CREATE TABLE IF NOT EXISTS client_price_lock (
  id                  SERIAL PRIMARY KEY,
  client_email        TEXT,
  client_phone_digits TEXT,
  service_id          INTEGER NOT NULL REFERENCES therapy_services(id) ON DELETE CASCADE,
  locked_amount       NUMERIC(10,2) NOT NULL CHECK (locked_amount >= 0),
  currency            VARCHAR(3) NOT NULL DEFAULT 'INR',

  -- first_booking = written live at confirmation
  -- backfill      = written by section 7 below for pre-existing clients
  -- admin         = created by hand from the Pricing tab
  source              TEXT NOT NULL DEFAULT 'first_booking',

  first_booking_id    TEXT,
  locked_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at         TIMESTAMPTZ,
  released_by         TEXT,

  CONSTRAINT client_price_lock_identity
    CHECK (client_email IS NOT NULL OR client_phone_digits IS NOT NULL)
);

-- Email is the primary identity, so it gets the uniqueness guarantee that
-- makes the live "insert on first confirmed booking" an idempotent
-- ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_price_lock_email
  ON client_price_lock (client_email, service_id)
  WHERE released_at IS NULL AND client_email IS NOT NULL;

-- Phone is a secondary matcher only. It is NOT unique: in the live data 338
-- distinct emails map to 376 distinct phones, so the two disagree and a
-- unique constraint here would reject legitimate rows.
CREATE INDEX IF NOT EXISTS idx_client_price_lock_phone
  ON client_price_lock (client_phone_digits, service_id)
  WHERE released_at IS NULL;


-- ---------------------------------------------------------------------
-- 4. client_price_override — admin-set price for specific clients
-- ---------------------------------------------------------------------
-- Highest priority rule; beats both the schedule and any grandfather lock.
-- service_id NULL means "every therapy for this client".
-- Setting a price for multiple clients at once is N rows in one transaction.

CREATE TABLE IF NOT EXISTS client_price_override (
  id                  SERIAL PRIMARY KEY,
  client_email        TEXT,
  client_phone_digits TEXT,
  client_name         TEXT,
  service_id          INTEGER REFERENCES therapy_services(id) ON DELETE CASCADE,
  amount              NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  currency            VARCHAR(3) NOT NULL DEFAULT 'INR',
  effective_from      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_until     TIMESTAMPTZ,
  reason              TEXT,
  created_by          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at          TIMESTAMPTZ,
  revoked_by          TEXT,

  CONSTRAINT client_price_override_identity
    CHECK (client_email IS NOT NULL OR client_phone_digits IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_client_price_override_email
  ON client_price_override (client_email, service_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_client_price_override_phone
  ON client_price_override (client_phone_digits, service_id)
  WHERE revoked_at IS NULL;


-- ---------------------------------------------------------------------
-- 5. price_resolution_log — why did this client pay that amount?
-- ---------------------------------------------------------------------
-- Real money moves through this engine and refunds are issued against it.
-- Without this table, "why was this client charged ₹1200 instead of ₹1700?"
-- is a forensic exercise across four tables and a deploy history. With it,
-- it is one query.
--
-- context: 'quote'   — price shown on the public booking page
--          'order'   — amount the Razorpay order was created for
--          'booking' — amount pinned onto the booking row

CREATE TABLE IF NOT EXISTS price_resolution_log (
  id                  BIGSERIAL PRIMARY KEY,
  booking_id          TEXT,
  service_id          INTEGER,
  client_email        TEXT,
  client_phone_digits TEXT,
  resolved_amount     NUMERIC(10,2),
  list_amount         NUMERIC(10,2),
  price_source        TEXT NOT NULL,
  rule_id             INTEGER,
  is_grandfathered    BOOLEAN NOT NULL DEFAULT FALSE,
  context             TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_resolution_log_booking
  ON price_resolution_log (booking_id);
CREATE INDEX IF NOT EXISTS idx_price_resolution_log_created
  ON price_resolution_log (created_at DESC);


-- ---------------------------------------------------------------------
-- 6. Seed the schedule from today's prices
-- ---------------------------------------------------------------------
-- Every therapy gets a baseline row dated in the past, so the resolver always
-- finds a schedule row and never has to fall through to parsing the legacy
-- VARCHAR. Amounts are stripped of '₹' and any separators; therapies whose
-- charges do not parse to a number (id 17 holds the literal string '₹') seed
-- at 0, which is correct for a free consultation.

INSERT INTO therapy_price_schedule (service_id, amount, currency, effective_from, grandfather_existing, note, created_by)
SELECT
  s.id,
  COALESCE(NULLIF(REGEXP_REPLACE(COALESCE(s.charges, '0'), '[^0-9.]', '', 'g'), '')::NUMERIC, 0),
  'INR',
  TIMESTAMPTZ '2000-01-01 00:00:00+05:30',
  TRUE,
  'Baseline seeded from therapy_services.charges at pricing-engine migration',
  'migration'
FROM therapy_services s
WHERE NOT EXISTS (
  SELECT 1 FROM therapy_price_schedule p WHERE p.service_id = s.id
);


-- ---------------------------------------------------------------------
-- 7. Backfill bookings.service_id
-- ---------------------------------------------------------------------
-- Matches on therapist_id plus therapy CATEGORY, because canonicalTherapyLabel()
-- has already destroyed the exact title on the booking side. Category is derived
-- identically from both sides, so '...with Ambika' and '...with Ambika Vaidya'
-- both resolve to the same service.
--
-- Deliberately conservative: it only writes where exactly ONE service matches.
-- An ambiguous booking is left NULL rather than guessed at, because a wrong
-- service_id would grandfather a client onto the wrong therapy's price.

WITH categorised_services AS (
  SELECT
    id,
    therapist_id,
    CASE
      WHEN title ILIKE '%free consultation%' THEN 'free'
      WHEN title ILIKE '%adolescent%'        THEN 'adolescent'
      WHEN title ILIKE '%couple%'            THEN 'couples'
      WHEN title ILIKE '%individual%'        THEN 'individual'
      ELSE NULL
    END AS category
  FROM therapy_services
),
unambiguous AS (
  SELECT therapist_id, category, MIN(id) AS service_id
  FROM categorised_services
  WHERE category IS NOT NULL AND therapist_id IS NOT NULL
  GROUP BY therapist_id, category
  HAVING COUNT(*) = 1
)
UPDATE bookings b
SET service_id = u.service_id
FROM unambiguous u
WHERE b.service_id IS NULL
  AND b.therapist_id = u.therapist_id
  AND u.category = CASE
      WHEN b.booking_resource_name ILIKE '%free consultation%' THEN 'free'
      WHEN b.booking_resource_name ILIKE '%adolescent%'        THEN 'adolescent'
      WHEN b.booking_resource_name ILIKE '%couple%'            THEN 'couples'
      WHEN b.booking_resource_name ILIKE '%individual%'        THEN 'individual'
      ELSE NULL
    END;


-- ---------------------------------------------------------------------
-- 8. Backfill client_price_lock for every existing client
-- ---------------------------------------------------------------------
-- Locks each existing client at TODAY'S price for each therapy they have
-- already booked — NOT at the amount they historically paid.
--
-- This distinction matters. Sourcing locked_amount from bookings.invitee_payment_amount
-- would permanently freeze anyone who once got a ₹100 promo rate at ₹100. The
-- intent of grandfathering is "a price rise does not reach existing clients",
-- so the correct baseline is the price in force at the moment the engine goes
-- live. From here on, live locks written at first booking capture whatever that
-- client actually agreed to.
--
-- Cancelled and failed bookings do not earn a lock.

INSERT INTO client_price_lock (
  client_email, client_phone_digits, service_id, locked_amount, currency,
  source, first_booking_id, locked_at
)
SELECT DISTINCT ON (LOWER(b.invitee_email), b.service_id)
  LOWER(TRIM(b.invitee_email)),
  NULLIF(RIGHT(REGEXP_REPLACE(COALESCE(b.invitee_phone, ''), '[^0-9]', '', 'g'), 10), ''),
  b.service_id,
  sched.amount,
  'INR',
  'backfill',
  b.booking_id,
  NOW()
FROM bookings b
JOIN LATERAL (
  SELECT p.amount
  FROM therapy_price_schedule p
  WHERE p.service_id = b.service_id
    AND p.revoked_at IS NULL
    AND p.effective_from <= NOW()
  ORDER BY p.effective_from DESC
  LIMIT 1
) sched ON TRUE
WHERE b.service_id IS NOT NULL
  AND b.invitee_email IS NOT NULL
  AND TRIM(b.invitee_email) <> ''
  AND b.booking_status NOT IN ('cancelled', 'canceled', 'payment_failed', 'payment_pending')
  AND sched.amount > 0
ORDER BY LOWER(b.invitee_email), b.service_id, b.invitee_created_at ASC NULLS LAST
ON CONFLICT DO NOTHING;


-- ---------------------------------------------------------------------
-- POST-MIGRATION VERIFICATION (run by hand, read-only)
-- ---------------------------------------------------------------------
-- Coverage of the service_id backfill:
--   SELECT COUNT(*) FILTER (WHERE service_id IS NOT NULL) AS matched,
--          COUNT(*) FILTER (WHERE service_id IS NULL)     AS unmatched
--   FROM bookings;
--
-- Which bookings did not map, and why:
--   SELECT booking_resource_name, booking_host_name, COUNT(*)
--   FROM bookings WHERE service_id IS NULL
--   GROUP BY 1,2 ORDER BY 3 DESC;
--
-- Expect a residue. Known unmappable groups in the current data:
--   * 'Individual Therapy Session with Ishika Mahajan' — no Individual service
--     row exists for that therapist, only Adolescent and Couples.
--   * bare 'Individual Therapy Session' rows with no therapist_id.
-- These clients simply have no lock and will pay list price. If any of them
-- should be grandfathered, add a lock by hand from the Pricing tab (which
-- writes source='admin') rather than loosening the match above.
