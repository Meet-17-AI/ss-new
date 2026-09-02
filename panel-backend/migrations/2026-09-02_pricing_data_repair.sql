-- ===========================================================================
--  Pricing data repair — companion to 2026-09-02_prod_schema_sync.sql
-- ===========================================================================
--
--  WHY THIS EXISTS
--    The schema sync created the pricing tables and added bookings.service_id,
--    but shipped no data for either. That is fine for the booking flow, which
--    falls back to therapy_services.charges — and NOT fine for the admin Pricing
--    tab, which reads both directly. On production it rendered as:
--
--      * every therapy showing a current price of 0
--      * every client reported as "new", with no history and no price
--
--    Neither was a code fault. Both were empty tables the screen depends on.
--
--  ALREADY APPLIED to safestories_prod_v2 on 2026-09-02. Recorded here so the
--  repair is repeatable on any database that gets the schema sync, and so the
--  reasoning is not lost with the throwaway script that first ran it.
--
--  SAFE TO RE-RUN. Both statements skip rows that already have a value, so a
--  second run is a no-op. Neither reads the clone; every value is derived from
--  production's own rows.
-- ===========================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ---------------------------------------------------------------------------
--  1. Backfill bookings.service_id
-- ---------------------------------------------------------------------------
--
-- Mirrors resolveServiceIdFromLabel() in lib/pricing.ts exactly: derive a
-- category from the booking's resource label, match it against services
-- belonging to the SAME therapist, and accept the answer only when exactly one
-- service matches. An ambiguous or unrecognised label is left NULL rather than
-- guessed — a wrong service_id would misprice a real client.
--
-- Validated before first use by running this logic against ss_clone_db_v2,
-- where 839 rows were already mapped by the original pricing migration: 837
-- agreed, 0 cases where this produced NULL for a row the original had mapped,
-- and 2 disagreed. Both of those turned out to be STALE IN THE CLONE — the
-- bookings had been moved to another therapist by the transfer flow, which does
-- not update service_id, so their stored value still pointed at the previous
-- therapist's service. This statement produced the new therapist's service for
-- both, which is the correct answer.
--
-- (That transfer-flow gap is a real bug and is not fixed here.)
UPDATE bookings b
   SET service_id = (
     SELECT CASE WHEN COUNT(*) = 1 THEN MIN(s.id) END
       FROM therapy_services s
      WHERE s.therapist_id = b.therapist_id
        AND CASE
              WHEN s.title ILIKE '%free consultation%' THEN 'free'
              WHEN s.title ILIKE '%adolescent%'        THEN 'adolescent'
              WHEN s.title ILIKE '%couple%'            THEN 'couples'
              WHEN s.title ILIKE '%individual%'        THEN 'individual'
              ELSE NULL
            END =
            CASE
              WHEN LOWER(b.booking_resource_name) LIKE '%free consultation%' THEN 'free'
              WHEN LOWER(b.booking_resource_name) LIKE '%adolescent%'        THEN 'adolescent'
              WHEN LOWER(b.booking_resource_name) LIKE '%couple%'            THEN 'couples'
              WHEN LOWER(b.booking_resource_name) LIKE '%individual%'        THEN 'individual'
              ELSE NULL
            END)
 WHERE b.service_id IS NULL;

-- ---------------------------------------------------------------------------
--  2. Seed the price schedule baseline
-- ---------------------------------------------------------------------------
--
-- One row per therapy, effective from 2000-01-01, carrying that therapy's
-- CURRENT charge. The amount is parsed with the same rule the application uses
-- — strip everything that is not a digit or a dot — so the resolved price is
-- identical before and after. Only price_source changes, from 'legacy' to
-- 'schedule'.
--
-- This is the section the schema sync left commented out as optional. Optional
-- was right for the booking flow and wrong for the Pricing tab, which reads the
-- schedule directly and renders an empty table as 0.
INSERT INTO therapy_price_schedule
       (service_id, amount, currency, effective_from, grandfather_existing, note, created_by)
SELECT ts.id,
       COALESCE(NULLIF(regexp_replace(COALESCE(ts.charges, ''), '[^0-9.]', '', 'g'), ''), '0')::numeric(10,2),
       'INR',
       TIMESTAMPTZ '2000-01-01 00:00:00+05:30',
       true,
       'baseline imported from therapy_services.charges',
       'pricing-repair:2026-09-02'
  FROM therapy_services ts
 WHERE NOT EXISTS (
   SELECT 1 FROM therapy_price_schedule s
    WHERE s.service_id = ts.id AND s.revoked_at IS NULL);

-- ---------------------------------------------------------------------------
--  3. Refuse to commit if a seeded price would move a real charge
-- ---------------------------------------------------------------------------
DO $$
DECLARE moved INTEGER;
BEGIN
  SELECT count(*) INTO moved
    FROM therapy_services ts
    JOIN therapy_price_schedule s ON s.service_id = ts.id AND s.revoked_at IS NULL
   WHERE COALESCE(NULLIF(regexp_replace(COALESCE(ts.charges,''), '[^0-9.]', '', 'g'), ''), '0')::numeric(10,2)
         <> s.amount;
  IF moved > 0 THEN
    RAISE EXCEPTION 'Refusing to commit: % therapy price(s) would change', moved;
  END IF;
  RAISE NOTICE 'Verified: every scheduled amount equals the current legacy charge.';
END $$;

COMMIT;

-- ===========================================================================
--  NOT DONE HERE, and worth a decision
-- ===========================================================================
--
--  client_price_lock is left EMPTY. A lock is what holds a returning client at
--  the rate they first paid, and it is written on their next booking — so while
--  prices are unchanged, an empty table costs nothing. The first price RISE is
--  when it matters: without locks, existing clients are not grandfathered and
--  simply pay the new amount.
--
--  Backfilling locks from booking history is possible but is a judgement about
--  who is owed which historical rate, not a mechanical migration. Decide it
--  before the next increase, not after.
--
--  Roughly 230 bookings remain unmapped after section 1 — the same count as in
--  the clone. Their resource label matches no category, or their therapist has
--  no single matching service. They are deliberately left NULL.
-- ===========================================================================
