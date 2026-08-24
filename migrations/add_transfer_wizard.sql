-- ─────────────────────────────────────────────────────────────────────────────
-- Client transfer wizard
--
-- client_transfer_history already recorded WHO was transferred and WHY. It
-- recorded nothing about WHAT HAPPENED, which is the half that matters when a
-- transfer half-fails.
--
-- A transfer spans Postgres AND Google Calendar, and those two cannot be
-- committed together. So the design does not pretend the operation is atomic —
-- it makes every outcome recoverable instead:
--
--   * idempotency_key stops a retry or a double-click transferring twice
--   * booking_ids says exactly which sessions moved, so the row can be checked
--     against the bookings themselves
--   * calendar_status makes a failed event re-create discoverable rather than
--     silent — the failure mode that would otherwise strand a session on the
--     old therapist's calendar forever
--
-- Additive and re-runnable. Nothing existing is altered or dropped.
-- ─────────────────────────────────────────────────────────────────────────────

-- The table predates this migration on deployed environments but not on fresh
-- ones, so create it first and let the ALTERs below bring both to the same shape.
CREATE TABLE IF NOT EXISTS client_transfer_history (
  transfer_id               SERIAL PRIMARY KEY,
  client_name               VARCHAR(255) NOT NULL,
  client_email              VARCHAR(255),
  client_phone              VARCHAR(50),
  from_therapist_id         VARCHAR(50),
  from_therapist_name       VARCHAR(255),
  to_therapist_id           VARCHAR(50) NOT NULL,
  to_therapist_name         VARCHAR(255) NOT NULL,
  transferred_by_admin_id   INTEGER,
  transferred_by_admin_name VARCHAR(255),
  transfer_date             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reason                    TEXT,
  notes                     TEXT
);

ALTER TABLE client_transfer_history
  -- Generated in the browser when the wizard opens and sent with the final
  -- confirm. See the unique index below for what it actually buys.
  ADD COLUMN IF NOT EXISTS idempotency_key   VARCHAR(64),

  -- Which bookings moved, as a JSON array of booking_id strings. The transfer
  -- is only auditable if it names its own effects; a count alone cannot be
  -- checked against anything.
  ADD COLUMN IF NOT EXISTS booking_ids       JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS bookings_moved    INTEGER NOT NULL DEFAULT 0,

  -- The cancel-and-settle branch. Money that moved because of a transfer must
  -- be legible from the transfer record, not only from the wallet ledger.
  ADD COLUMN IF NOT EXISTS sessions_cancelled INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wallet_credited   NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- 'ok'       — every event was moved to the new therapist's calendar
  -- 'partial'  — at least one event could not be re-created; needs repair
  -- 'skipped'  — nothing to move, or the new therapist has no connected calendar
  -- 'none'     — pre-wizard rows, written before this column existed
  ADD COLUMN IF NOT EXISTS calendar_status   VARCHAR(20) NOT NULL DEFAULT 'none',

  -- Per-booking outcome detail, so a 'partial' says which booking and why.
  ADD COLUMN IF NOT EXISTS outcome           JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── The most important line in this migration ────────────────────────────────
-- A transfer deletes and re-creates Google Calendar events, which cannot be
-- rolled back. Running one twice orphans an event on the old therapist's
-- calendar and creates a duplicate on the new one, and no database constraint
-- elsewhere would catch it. Partial so that historic rows, which have no key,
-- do not all collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_transfer_idempotency
  ON client_transfer_history (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- The client profile reads this table to show a transfer that produced no
-- booking on the new therapist — the case booking-derived history cannot see.
CREATE INDEX IF NOT EXISTS idx_transfer_client
  ON client_transfer_history (client_phone, client_email, transfer_date DESC);

CREATE INDEX IF NOT EXISTS idx_transfer_therapists
  ON client_transfer_history (to_therapist_id, from_therapist_id);

COMMENT ON TABLE client_transfer_history IS
  'One row per completed client transfer. Also the ONLY record of a transfer that moved no bookings (client had no upcoming session, or every session was cancelled-and-settled) — the client profile derives therapist history from bookings, which cannot see those.';

COMMENT ON COLUMN client_transfer_history.calendar_status IS
  'ok | partial | skipped | none. A "partial" means at least one session is still on the OLD therapist calendar and needs manual repair; see the outcome column for which.';

-- ─────────────────────────────────────────────────────────────────────────────
-- A wallet reason for transfer price adjustments
--
-- Transferring a client to a therapist who charges less refunds the difference.
-- That movement needs its OWN reason, and the requirement is structural rather
-- than cosmetic.
--
-- uq_wallet_txn_booking_reason is UNIQUE on (source_booking_id, reason) and does
-- NOT include direction. So a CREDIT filed under BOOKING_SETTLEMENT collides
-- with the DEBIT that reason exists for — the one written when a booking is paid
-- from wallet credit. The collision resolves as ON CONFLICT DO NOTHING, which
-- means the refund silently does not happen: no row, no error, nothing in the
-- outcome report, and a client who is owed money and never told.
--
-- TRANSFER_ADJUSTMENT sits outside that index's predicate, so it cannot collide
-- with a settlement, and it keeps "wallet spent on a booking" reportable as a
-- number that is not quietly netted against refunds.
--
-- Written as DROP + ADD because a CHECK constraint cannot be extended in place.
-- Re-runnable: the DROP is IF EXISTS and the ADD is guarded on the catalog.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_reason_check;

ALTER TABLE wallet_transactions
  ADD CONSTRAINT wallet_transactions_reason_check
  CHECK (reason IN (
    'CANCELLATION_CREDIT',   -- CREDIT: cash/QR booking cancelled
    'BOOKING_SETTLEMENT',    -- DEBIT:  applied to a new booking
    'REFUND_OUT',            -- DEBIT:  handed back outside the app
    'MANUAL_ADJUSTMENT',     -- either: admin correction
    'TRANSFER_ADJUSTMENT'    -- CREDIT: price difference refunded on transfer
  ));
