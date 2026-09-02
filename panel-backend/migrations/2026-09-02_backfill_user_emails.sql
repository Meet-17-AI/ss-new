-- ===========================================================================
--  Copy each therapist's email onto their LOGIN account
-- ===========================================================================
--
--  WHY
--    Password reset finds the account by users.email:
--
--      SELECT id ... FROM users WHERE LOWER(email) = LOWER($1)
--
--    Every therapist has that column empty, while their real address sits on
--    therapists.contact_info. The addresses exist; the reset flow just does not
--    look where they are.
--
--    The failure is worse than a plain "unknown email", because send-otp has a
--    deliberate escape hatch that accepts ANY address and stores the request
--    with user_id = NULL. So a therapist receives a genuine code, enters it, it
--    verifies — and only the final step fails, on
--    `UPDATE users SET password = $1 WHERE id = NULL` matching no rows,
--    reporting "User not found" after they have done everything right.
--
--  WHAT THIS DOES NOT DO
--    It does not invent an address, overwrite one, or touch therapists. It
--    copies a value that is already in the database into the column that reads
--    it, and only where that column is empty.
--
--  SAFE TO RE-RUN. The WHERE clause skips any account that already has an
--  email, so a second run changes nothing.
--
--  VERIFIED BEFORE FIRST USE (safestories_prod_v2)
--    * 5 accounts to fill: Aastha, Ambika, Anjali, Indrayani, Muskan.
--    * All 5 source values are syntactically valid addresses.
--    * No duplicate emails exist in users, and none of the 5 collides with an
--      address already held — which matters because the reset lookup matches on
--      email alone and two accounts sharing one would be ambiguous.
--
--  NOT COVERED, deliberately
--    * Sales (id 19) and Ishika (id 3) have no address anywhere, so there is
--      nothing to copy. Ishika is deactivated; Sales needs one entered by hand
--      before that account can ever reset its own password.
--    * The 'SafeStories' therapists row (therapy@safestories.in) has no login
--      account at all — it is the platform's calendar host, not a person.
-- ===========================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

UPDATE users u
   SET email = TRIM(t.contact_info)
  FROM therapists t
 WHERE t.therapist_id = u.therapist_id
   -- Only fill a genuinely empty column; never overwrite a set address.
   AND NULLIF(TRIM(u.email), '') IS NULL
   -- Only copy something that is actually an address.
   AND NULLIF(TRIM(t.contact_info), '') IS NOT NULL
   AND TRIM(t.contact_info) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   -- Never create a second account holding the same address: the reset lookup
   -- matches on email alone and could not tell them apart.
   AND NOT EXISTS (
     SELECT 1 FROM users other
      WHERE other.id <> u.id
        AND LOWER(NULLIF(TRIM(other.email), '')) = LOWER(TRIM(t.contact_info)));

-- Refuse to commit if the result would be ambiguous for the reset lookup.
DO $$
DECLARE dupes INTEGER;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT LOWER(TRIM(email)) FROM users
     WHERE NULLIF(TRIM(email), '') IS NOT NULL
     GROUP BY 1 HAVING count(*) > 1) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION 'Refusing to commit: % duplicate email(s) in users', dupes;
  END IF;
  RAISE NOTICE 'Verified: every users.email is unique.';
END $$;

COMMIT;
