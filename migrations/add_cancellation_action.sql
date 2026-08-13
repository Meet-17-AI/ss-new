-- Cancellation actions for Cash/QR bookings
--
-- When an admin cancels a booking that was collected in Cash or by QR, there is
-- no gateway payment to reverse, so what happens to the money is a decision
-- rather than a consequence. This records that decision.
--
--   no_refund       money is kept. The session did not happen, but the amount
--                   was collected and is not being returned, so it STAYS in net
--                   revenue -- see the dashboard-stats revenue query, which
--                   otherwise drops every cancelled booking.
--   wallet_credit   amount is credited to the client's wallet (wallet_transactions)
--                   and leaves net revenue. It re-enters revenue when the credit
--                   is redeemed against a future session.
--   offline_refund  cash handed back outside any gateway. Leaves net revenue.
--                   Requires OTP confirmation before it can be recorded.
--
-- NULL means "cancelled without an explicit action" -- every row that existed
-- before this migration, plus client-initiated cancellations. Those keep their
-- existing behaviour exactly: out of revenue, wallet credited automatically.
--
-- Additive only. No existing column, index or row is altered.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS cancellation_action    TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_action_by TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_action_at TIMESTAMPTZ;

COMMENT ON COLUMN bookings.cancellation_action IS
  'How the money was handled when an admin cancelled a Cash/QR booking: no_refund | wallet_credit | offline_refund. NULL = cancelled with no explicit action (legacy or client-initiated).';

COMMENT ON COLUMN bookings.cancellation_action_by IS
  'Name of the admin who chose the cancellation action. NULL for client-initiated cancellations.';

-- Guards the value set, so a typo in application code cannot quietly write a
-- status the revenue query and the Payments page do not understand.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_cancellation_action_chk'
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_cancellation_action_chk
      CHECK (cancellation_action IS NULL
             OR cancellation_action IN ('no_refund', 'wallet_credit', 'offline_refund'));
  END IF;
END $$;

-- Net revenue reads this column for every cancelled booking, and the Payments
-- page filters cancellations by it. Partial: only cancelled rows carry a value.
CREATE INDEX IF NOT EXISTS idx_bookings_cancellation_action
  ON bookings (cancellation_action)
  WHERE cancellation_action IS NOT NULL;
