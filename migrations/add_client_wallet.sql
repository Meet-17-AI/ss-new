-- ─────────────────────────────────────────────────────────────────────────────
-- Client wallet
--
-- Credit held for a client after a manually-created Cash/QR booking is
-- cancelled. Those bookings never went through a gateway (payment_id is NULL),
-- so there is no refund to issue — by policy the amount is held as credit and
-- redeemed against a future dashboard-created booking.
--
-- The ledger is the ONLY source of truth. There is deliberately no cached
-- balance column anywhere: a cached balance is a second source of truth that
-- can drift, and every bug in that class is a money bug. Balance is always
-- SUM(credits) - SUM(debits) over this table.
--
-- Additive and re-runnable. Nothing existing is altered.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wallet_transactions (
  txn_id              SERIAL PRIMARY KEY,

  -- Client identity. Normalised phone (digits only) when available, else
  -- 'email:<lowercased address>'. MUST match the grouping rule used by
  -- GET /api/clients, or a client's wallet detaches from the profile the admin
  -- is looking at. Kept in sync by buildClientKey() in lib/wallet.ts.
  client_key          VARCHAR(120) NOT NULL,
  client_name         VARCHAR(255),
  client_phone        VARCHAR(50),
  client_email        VARCHAR(255),

  direction           VARCHAR(10) NOT NULL CHECK (direction IN ('CREDIT','DEBIT')),

  -- Why the money moved, kept separate from direction so reporting can tell
  -- "cancelled into wallet" from "admin correction" from "handed back in cash".
  reason              VARCHAR(40) NOT NULL CHECK (reason IN (
                        'CANCELLATION_CREDIT',  -- CREDIT: cash/QR booking cancelled
                        'BOOKING_SETTLEMENT',   -- DEBIT:  applied to a new booking
                        'REFUND_OUT',           -- DEBIT:  handed back outside the app
                        'MANUAL_ADJUSTMENT'     -- either: admin correction
                      )),

  amount              NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency            VARCHAR(10) NOT NULL DEFAULT 'INR',

  -- The cancelled booking for a CREDIT; the new booking for a DEBIT.
  source_booking_id   TEXT,
  source_payment_mode VARCHAR(20),          -- 'Cash' / 'QR', for cash-book reconciliation

  notes               TEXT,
  created_by_user_id  INTEGER,
  created_by_name     VARCHAR(255),
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Balance lookups and statement rendering (ordered by txn_id).
CREATE INDEX IF NOT EXISTS idx_wallet_txn_client
  ON wallet_transactions (client_key, txn_id);

CREATE INDEX IF NOT EXISTS idx_wallet_txn_booking
  ON wallet_transactions (source_booking_id);

-- ── The most important line in this migration ────────────────────────────────
-- /api/cancel-booking is reachable from three UIs (admin Appointments, admin
-- Dashboard, and the PUBLIC BookingConfirmation page) and has no re-entry
-- guard. Without this index a double-click credits the wallet twice. One
-- booking can produce at most one automatic credit and one settlement debit.
--
-- NOTE: this is a PARTIAL index, so any ON CONFLICT targeting it must restate
-- the WHERE predicate verbatim or Postgres will not match it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_txn_booking_reason
  ON wallet_transactions (source_booking_id, reason)
  WHERE source_booking_id IS NOT NULL
    AND reason IN ('CANCELLATION_CREDIT','BOOKING_SETTLEMENT');

COMMENT ON TABLE wallet_transactions IS
  'Append-only client wallet ledger. Balance is derived: SUM(CREDIT) - SUM(DEBIT) per client_key. Never store a cached balance.';

-- ── One new column on bookings ───────────────────────────────────────────────
-- NOT NULL DEFAULT 0 means every existing row and every non-wallet code path
-- reads 0 with no change, which keeps the cash-collected reporting valid across
-- all historic data.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS wallet_amount_applied NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN bookings.wallet_amount_applied IS
  'Portion of invitee_payment_amount settled from wallet credit. 0 for normal bookings. invitee_payment_amount always stays the FULL session price so revenue queries need no change.';
