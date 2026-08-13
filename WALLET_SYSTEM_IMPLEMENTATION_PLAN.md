# Client Wallet — Implementation Plan

**Scope (confirmed):**
- Applies **only** to bookings created manually from the dashboard with payment method **Cash** or **QR**.
- These bookings are never refunded through a gateway. On cancellation the amount is credited to the client's wallet.
- The balance is redeemable **only** when an admin creates the next booking for that client from the dashboard.
- Razorpay / payment-link / organic / free-consultation bookings are untouched.

**Design rule:** one new table, one new column. Nothing existing is altered.

---

## 1. Recommended approach: a ledger, and nothing else

The instinct is to build a `client_wallets` table holding a `balance`, plus a transaction log. **Don't.**
A cached balance alongside a ledger means two sources of truth that can drift, and every bug in that
class is a money bug that surfaces as "the client says they had ₹1,500".

Instead: **store only the ledger and derive the balance.**

```
balance(client) = SUM(credits) − SUM(debits)   -- over wallet_transactions
```

At your scale this is a single indexed aggregate over a few thousand rows — sub-millisecond, and it
**cannot** disagree with the transaction history, because it *is* the transaction history.

What this buys you concretely:

| | Ledger + cached balance | **Ledger only (recommended)** |
|---|---|---|
| Sources of truth | 2 (can drift) | 1 |
| Cache-invalidation bugs | possible | impossible by construction |
| Client changes phone | update 2 tables | update 1 table |
| Code to write | ~2× | ~1× |
| Balance read cost | index lookup | indexed aggregate (negligible here) |

The only thing the cache would have bought is read speed you don't need. Revisit it if you ever hit
six figures of transactions.

---

## 2. Database changes

One migration file, additive and re-runnable. Follows the existing convention
([migrations/add_is_active_to_users.sql](migrations/add_is_active_to_users.sql)) — there is no
migration framework in this repo, so it is applied by hand.

**`migrations/add_client_wallet.sql`**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Client wallet: credit held for a client after a manually-created Cash/QR
-- booking is cancelled. Redeemable against a future dashboard-created booking.
-- The ledger is the ONLY source of truth; balance is always derived from it.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wallet_transactions (
  txn_id              SERIAL PRIMARY KEY,

  -- Client identity. Normalised phone (digits only) when available, else
  -- 'email:<lowercased address>'. MUST match the grouping rule used by
  -- GET /api/clients (index.ts:3428-3441) or a client's wallet will detach
  -- from the profile the admin is looking at. See §6.
  client_key          VARCHAR(120) NOT NULL,
  client_name         VARCHAR(255),
  client_phone        VARCHAR(50),
  client_email        VARCHAR(255),

  direction           VARCHAR(10) NOT NULL CHECK (direction IN ('CREDIT','DEBIT')),

  -- Why the money moved, kept separate from direction so reporting can tell
  -- "cancelled into wallet" from "admin correction" from "paid back in cash".
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

-- Balance lookups and statement rendering.
CREATE INDEX IF NOT EXISTS idx_wallet_txn_client
  ON wallet_transactions (client_key, txn_id);

CREATE INDEX IF NOT EXISTS idx_wallet_txn_booking
  ON wallet_transactions (source_booking_id);

-- ── The most important line in this migration ────────────────────────────────
-- /api/cancel-booking is reachable from three UIs (admin Appointments, admin
-- Dashboard, and the PUBLIC BookingConfirmation page) and has no re-entry guard.
-- Without this index a double-click credits the wallet twice. One booking can
-- produce at most one automatic credit and one settlement debit, ever.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_txn_booking_reason
  ON wallet_transactions (source_booking_id, reason)
  WHERE source_booking_id IS NOT NULL
    AND reason IN ('CANCELLATION_CREDIT','BOOKING_SETTLEMENT');

-- ── One new column on bookings ───────────────────────────────────────────────
-- NOT NULL DEFAULT 0 means every existing row and every non-wallet code path
-- reads 0 with no change, which is what keeps the reporting in §5 valid across
-- all historic data.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS wallet_amount_applied NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN bookings.wallet_amount_applied IS
  'Portion of invitee_payment_amount settled from wallet credit. 0 for normal bookings. invitee_payment_amount always stays the FULL session price so revenue queries need no change.';
```

Deliberately **not** included:
- No `balance` column anywhere — derived (§1).
- No `balance_after` column — the statement view computes a running balance with a window function.
- No `wallet_txn_id` on `bookings` — already derivable via `source_booking_id`.

---

## 3. Backend

New module **`panel-backend/src/lib/wallet.ts`**. Keeping it out of the 11,500-line `index.ts` keeps
the diff to existing endpoints to a few lines each.

### 3.1 Identity and eligibility

```ts
/**
 * Wallet identity key. MUST stay in sync with the client-grouping rule in
 * GET /api/clients (index.ts:3428-3441): phone primary, email fallback.
 */
export function buildClientKey(phone?: string | null, email?: string | null): string | null {
  const p = (phone || '').replace(/[\s\-\(\)\+]/g, '').trim();
  if (p) return p;
  const e = (email || '').toLowerCase().trim();
  return e ? `email:${e}` : null;
}

/**
 * Only manually-created Cash/QR bookings earn wallet credit. Lowercased because
 * booking_status/gateway casing is inconsistent across this codebase.
 * A wallet-settled booking is eligible too — otherwise cancelling a session that
 * was paid from wallet would destroy the client's money.
 */
export function isWalletEligible(booking: any): boolean {
  const gw   = String(booking.invitee_payment_gateway || '').toLowerCase().trim();
  const paid = String(booking.payment_status || '').toLowerCase().trim() === 'paid';
  const amt  = Number(booking.invitee_payment_amount) || 0;
  return paid && amt > 0 && (gw === 'cash' || gw === 'qr' || gw.startsWith('wallet'));
}
```

### 3.2 Balance

```ts
export async function getBalance(clientKey: string, tx?: PoolClient): Promise<number> {
  const q = tx || pool;
  const { rows } = await q.query(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END), 0) AS balance
     FROM wallet_transactions WHERE client_key = $1`,
    [clientKey]
  );
  return Number(rows[0].balance);
}
```

### 3.3 Credit — no lock needed

Adding money cannot overdraw, so a credit is a bare insert. The unique index handles retries.

```ts
export async function creditWallet(opts: CreditOpts): Promise<WalletTxn | null> {
  const clientKey = buildClientKey(opts.phone, opts.email);
  if (!clientKey) return null;          // no identity → cannot hold credit

  const { rows: [txn] } = await pool.query(
    `INSERT INTO wallet_transactions
       (client_key, client_name, client_phone, client_email, direction, reason,
        amount, currency, source_booking_id, source_payment_mode, notes,
        created_by_user_id, created_by_name)
     VALUES ($1,$2,$3,$4,'CREDIT',$5,$6,$7,$8,$9,$10,$11,$12)
     -- The index in §2 is PARTIAL, so Postgres only matches it if the inference
     -- clause restates the predicate verbatim. Omitting the WHERE fails with
     -- "no unique or exclusion constraint matching the ON CONFLICT specification".
     ON CONFLICT (source_booking_id, reason)
       WHERE source_booking_id IS NOT NULL
         AND reason IN ('CANCELLATION_CREDIT','BOOKING_SETTLEMENT')
     DO NOTHING
     RETURNING *`,
    [clientKey, opts.name, opts.phone, opts.email, opts.reason, opts.amount,
     opts.currency || 'INR', opts.bookingId, opts.sourcePaymentMode, opts.notes,
     opts.userId, opts.userName]
  );
  return txn || null;                   // null = already credited, not an error
}
```

### 3.4 Debit — transactional, with an advisory lock

```ts
export async function debitWallet(opts: DebitOpts): Promise<WalletTxn> {
  const clientKey = buildClientKey(opts.phone, opts.email);
  if (!clientKey) throw new Error('Cannot debit wallet: no client identity');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Serialises concurrent settlements for the SAME client without locking a
    // row (there is no wallet row to lock). Released automatically on COMMIT
    // or ROLLBACK. Different clients never contend.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [clientKey]);

    const balance = await getBalance(clientKey, client);
    if (balance < opts.amount) {
      await client.query('ROLLBACK');
      throw Object.assign(new Error('INSUFFICIENT_BALANCE'), { availableBalance: balance });
    }

    const { rows: [txn] } = await client.query(
      `INSERT INTO wallet_transactions (...) VALUES (...,'DEBIT',...) RETURNING *`,
      [/* ... */]
    );

    await client.query('COMMIT');
    return txn;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
```

The `pool.connect()` + `BEGIN` pattern is already used at
[index.ts:1379](panel-backend/src/index.ts#L1379),
[7415](panel-backend/src/index.ts#L7415) and
[11096](panel-backend/src/index.ts#L11096), against a `max: 10` pool
([lib/db.ts:21](panel-backend/src/lib/db.ts#L21)). Keep the transaction short — never wrap a Google
Calendar or email call in it.

### 3.5 Credit on cancellation

`POST /api/cancel-booking` — [index.ts:3791](panel-backend/src/index.ts#L3791). This is the endpoint
every caller uses: [Appointments.tsx:487](components/Appointments.tsx#L487),
[Dashboard.tsx:1034](components/Dashboard.tsx#L1034), and
[BookingConfirmation.tsx:85](components/BookingConfirmation.tsx#L85).

Insert **after** the Razorpay block ends (after [line 3891](panel-backend/src/index.ts#L3891)),
before the notification block:

```ts
// 5b. Cash/QR bookings have payment_id = NULL, so step 5 above skipped them
// entirely — there is no gateway refund for these and by policy we do not issue
// one. Credit the amount to the client's wallet for use on a future booking.
// Best-effort: a wallet failure must never block the cancellation itself.
let walletCredit: { amount: number; balance: number } | null = null;
if (!isRefundInitiated && isWalletEligible(bookingDetails)) {
  try {
    const txn = await creditWallet({
      name:  bookingDetails.invitee_name,
      phone: bookingDetails.invitee_phone,
      email: bookingDetails.invitee_email,
      bookingId: booking_id,
      amount: Number(bookingDetails.invitee_payment_amount),
      currency: bookingDetails.invitee_payment_currency || 'INR',
      reason: 'CANCELLATION_CREDIT',
      sourcePaymentMode: bookingDetails.invitee_payment_gateway,
      notes: reason || null,
    });
    if (txn) {
      walletCredit = {
        amount: Number(txn.amount),
        balance: await getBalance(buildClientKey(bookingDetails.invitee_phone, bookingDetails.invitee_email)!),
      };
    }
  } catch (walletErr: any) {
    console.error('[Cancel Booking] Wallet credit failed (non-fatal):', walletErr?.message || walletErr);
  }
}
```

Why exactly here:
- `!isRefundInitiated` means a Razorpay booking that got a real refund can never also get wallet
  credit. The two are mutually exclusive.
- It runs after the status update and calendar delete, so a wallet bug cannot leave a booking
  half-cancelled.
- `try/catch` non-fatal matches the surrounding style — the calendar, WhatsApp and email blocks in
  this handler are all best-effort.

**No 24-hour rule.** You confirmed manual bookings are never refunded, so the amount always goes to
the wallet regardless of when it is cancelled. The `isWithin24Hours` check
([index.ts:3851](panel-backend/src/index.ts#L3851)) stays exactly as it is and keeps governing
Razorpay refunds only.

Return `walletCredit` on the JSON response so the cancel modal can confirm it.

Apply the same block to `POST /api/bookings/cancel`
([index.ts:6187](panel-backend/src/index.ts#L6187)) — it has no caller today, but leaving it
divergent is how the two paths silently drift apart later.

### 3.6 Spend on booking creation

`POST /api/create-booking` — [index.ts:8102](panel-backend/src/index.ts#L8102). Frontend adds
`useWallet: boolean` and `walletAmount: number`.

**a) Validate server-side, before the insert.** Never trust the browser's amount:

```ts
let walletApplied = 0;
if (payload.useWallet && !payload.isFreeConsultation) {
  const clientKey = buildClientKey(payload.clientWhatsApp, payload.clientEmail);
  const balance   = clientKey ? await getBalance(clientKey) : 0;
  const price     = Number(payload.amount) || 0;
  const requested = Number(payload.walletAmount) || 0;

  // A wallet can never over-pay a session, and never pay more than it holds.
  walletApplied = Math.min(requested, balance, price);

  if (requested > walletApplied) {
    // Another admin settled this client's wallet since the form loaded.
    return res.status(409).json({
      error: 'Wallet balance changed. Please review and try again.',
      availableBalance: balance,
    });
  }
}
```

**b) `invitee_payment_amount` stays the FULL session price.** Leave
[line 8329](panel-backend/src/index.ts#L8329) untouched. This is the single decision that keeps all
31 usages of that column — and every revenue query — correct with no edits. See §5.

**c) Gateway label** at [line 8341](panel-backend/src/index.ts#L8341):

```ts
walletApplied > 0
  ? (walletApplied >= paymentAmount
      ? 'Wallet'
      : `Wallet+${payload.paymentMode === 'qr' ? 'QR' : 'Cash'}`)
  : /* ...existing expression, unchanged... */
```

**d) Debit only after the booking row exists**, so a failed insert cannot burn the balance:

```ts
if (walletApplied > 0) {
  await debitWallet({ /* client fields */, bookingId: booking_id,
                      amount: walletApplied, reason: 'BOOKING_SETTLEMENT' });
  await pool.query(
    'UPDATE bookings SET wallet_amount_applied = $1 WHERE booking_id = $2',
    [walletApplied, booking_id]
  );
}
```

**e) `payments` row** ([line 8348](panel-backend/src/index.ts#L8348)) — widen the condition to fire
when `walletApplied > 0`, recording `payment_gateway_name` as `'Wallet'` / `'Wallet+Cash'` /
`'Wallet+QR'`.

**f) Gateway label map** — add `wallet: 'Wallet'` to `gatewayLabels`
([index.ts:6312](panel-backend/src/index.ts#L6312)) so the refunds/cancellations table renders it.

### 3.7 Endpoints

```
GET  /api/wallet?phone=&email=                 → { balance, currency, transactions: [...] }
                                                  balance 0 + empty array when none (never 404 —
                                                  the booking form calls this for every client)
GET  /api/wallet/transactions?phone=&email=    → paginated statement, running balance via
                                    &clientKey=  SUM(...) OVER (ORDER BY txn_id)
GET  /api/wallets?minBalance=1                 → admin view: clients holding credit + total liability
POST /api/wallet/adjust                        → MANUAL_ADJUSTMENT / REFUND_OUT
```

`GET /api/wallets` and `POST /api/wallet/adjust` carry
`requireRole(['admin','superadmin','fluidadmin'])` ([index.ts:292](panel-backend/src/index.ts#L292)) —
the latter mints money. Many endpoints in this file are unauthenticated; do not follow that
precedent here.

### 3.8 Redemption must be re-authenticated (not obvious, easy to miss)

`POST /api/create-booking` is on the **public** route allowlist
([index.ts:200](panel-backend/src/index.ts#L200)) because it also serves the client-facing `/book/*`
flow. The global auth gate calls `next()` for allowlisted paths **without populating `req.user`**, so
the handler has no identity to check — and `payload.isAdmin` is client-supplied and worthless as a
guard.

Left unhandled, anyone who knew a client's phone and email could spend that client's balance.

The fix is `getOptionalUser(req)` ([index.ts:296](panel-backend/src/index.ts#L296)): it verifies the
bearer token when one is present and returns `null` otherwise, letting a public route protect one
privileged branch inside itself. Wallet redemption requires the decoded role to be in
`WALLET_REDEEM_ROLES`, else 403.

This works end-to-end because [lib/authFetch.ts](lib/authFetch.ts) patches `window.fetch` to attach
the token to every same-origin `/api` request — so the dashboard call carries the admin's token
automatically, and the public booking flow, having no token, is refused.

---

## 4. Frontend

### 4.1 `components/CreateBooking.tsx` — the settle-up prompt

Fetch the balance on the effect that already loads `clientBookingHistory`, so no new trigger logic is
needed. Render between the Payment Method dropdown and the Amount field
([CreateBooking.tsx:1085-1140](components/CreateBooking.tsx#L1085-L1140)), only when
`balance > 0 && !isFreeConsultation`. Match the amber advisory box already at
[line 1066](components/CreateBooking.tsx#L1066) so it doesn't look bolted on.

```
┌──────────────────────────────────────────────────────────────┐
│ 💰  Wallet credit available                                   │
│                                                              │
│ Ananya has ₹1,500 credit from a cancelled session            │
│ (Individual Therapy, 12 Aug 2026 — QR).                      │
│                                                              │
│ ☑ Apply wallet credit to this booking                        │
│                                                              │
│   Apply  [ ₹ 1500 ]  of ₹1,500 available                     │
│                                                              │
│   Session total          ₹2,000                              │
│   From wallet          – ₹1,500                              │
│   ────────────────────────────                               │
│   To collect via QR      ₹  500                              │
└──────────────────────────────────────────────────────────────┘
```

Rules:
- Default `walletAmount = min(balance, sessionPrice)`; editable down, clamped up.
- Fully covered → Payment Method becomes optional, button reads **"Create Booking (Paid from Wallet)"**.
- Partly covered → Payment Method stays required for the remainder; update
  `isPaymentLinkEnabled()` ([line 722](components/CreateBooking.tsx#L722)).
- **Disable the wallet checkbox when `paymentMode === 'link'`** (tooltip: "not available with payment
  links"). A Razorpay link is generated for a fixed amount by a separate endpoint; mixing the two
  needs its own design and is out of the confirmed scope.
- Handle the new **409** next to the existing 409 slot-conflict handler at
  [line 702](components/CreateBooking.tsx#L702).

### 4.2 Cancellation confirmation
Read `walletCredit` off the response in
[Appointments.tsx:487](components/Appointments.tsx#L487) and
[Dashboard.tsx:1034](components/Dashboard.tsx#L1034) →
*"Booking cancelled. ₹1,500 credited to Ananya's wallet."*

For the **public** page ([BookingConfirmation.tsx:85](components/BookingConfirmation.tsx#L85)),
decide with the business whether clients should see the credit at all before wording it. Since the
redemption is admin-only, the safest v1 is to say nothing there and let the admin communicate it.

### 4.3 Client profile — Wallet tab
Date, description, credit, debit, running balance. One query.

### 4.4 Admin wallets view — **built**
A **Wallets** tab on [components/RefundsCancellations.tsx](components/RefundsCancellations.tsx),
alongside the existing payment and refund tabs.

- Three summary cards: total outstanding liability, number of clients holding credit, and a short
  explainer of where the money comes from.
- Table: client, balance, last activity, and per-row **Statement** / **Adjust** actions.
- **Statement modal** — full ledger for one client with a running balance, showing the booking id
  and payment mode behind every movement.
- **Adjust modal** (`WalletAdjustModal`) — three options that map onto two ledger reasons:
  "Paid back to the client" (`REFUND_OUT`), and corrections up or down (`MANUAL_ADJUSTMENT`).
  A note is mandatory so the ledger stays auditable, and outgoing amounts are capped at the balance.
- Search and Excel export work on this tab like the others.

Implementation note: the wallets tab renders its **own** table rather than threading a third mode
through the existing `isPaymentTab` ternaries. `isPaymentTab` stays `false` for it and every existing
payment/refund branch is untouched, which is why adding this tab cannot regress the other seven.

---

## 5. Revenue

Trace a full cycle against the **unmodified** query at
[index.ts:2965](panel-backend/src/index.ts#L2965):

| Step | `booking_status` | `invitee_payment_amount` | Revenue | Wallet |
|---|---|---|---|---|
| 1. Booking A, QR ₹1,500 | `confirmed` | 1500 | **+1500** | 0 |
| 2. A cancelled | `cancelled` | 1500 | **−1500** (excluded by the existing `NOT IN`) | **+1500** |
| 3. Booking B, ₹1,500, from wallet | `confirmed` | **1500** | **+1500** | 0 |
| 4. B cancelled too | `cancelled` | 1500 | **−1500** | **+1500** |

Net after step 3: **₹1,500, counted exactly once**, recognised against whichever session actually
happened. **No revenue query changes.** This works only because of §3.6(b) — store ₹0 on the
wallet-settled booking instead and revenue loses the ₹1,500 permanently at step 2.

Per-therapist revenue ([index.ts:4818](panel-backend/src/index.ts#L4818)) needs no change either.
One caveat to raise with whoever runs payouts: if A was with Therapist X and the credit is later
spent on a session with Therapist Y, the revenue moves from X to Y. Defensible (Y delivered the
session), but confirm it if payouts are computed from these numbers.

### 5.1 New reporting the wallet makes possible

```sql
-- New cash actually collected in a period. Differs from revenue because a
-- wallet-settled booking books revenue without new cash arriving.
-- Returns exactly today's revenue figure for all historic rows, because
-- wallet_amount_applied is NOT NULL DEFAULT 0.
SELECT COALESCE(SUM(invitee_payment_amount - wallet_amount_applied), 0) AS cash_collected
FROM bookings
WHERE booking_status NOT IN ('cancelled','canceled','payment_pending','payment_failed')
  AND booking_start_at BETWEEN $1 AND $2;

-- Outstanding wallet liability: cash received for a service not yet delivered.
-- This is a LIABILITY, not revenue.
SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END), 0) AS wallet_liability
FROM wallet_transactions;
```

Add these as **new keys** on the stats response
([index.ts:3138](panel-backend/src/index.ts#L3138)). Do not touch the existing `revenue` key or you
break the dashboard cards reading it.

| Concept | Where it lives |
|---|---|
| Revenue (accrual) | `bookings.invitee_payment_amount`, non-cancelled — unchanged |
| Cash collected | `invitee_payment_amount − wallet_amount_applied` |
| Money held for clients | `SUM(credits) − SUM(debits)` |
| Audit trail | `wallet_transactions` |

---

## 6. The one thing that will actually cause problems

Everything above is mechanical. **Client identity is not.**

`bookings` has no stable client id. `GET /api/clients`
([index.ts:3386](panel-backend/src/index.ts#L3386)) groups clients at *read time* by normalised
phone, email fallback. The wallet has to use the same rule, which inherits the same weaknesses:

1. **`reconcileClientContact` rewrites contact details across bookings.**
   [index.ts:7375](panel-backend/src/index.ts#L7375) actively `UPDATE`s `invitee_phone` and
   `invitee_email` on *all* of a client's bookings every time a new one is created. So the key can
   move between the cancel and the rebook.

   Handled in **two** places, because one is not enough:

   - **`remapClientKey`**, called from `reconcileClientContact` itself. It captures the phone
     numbers *before* they are overwritten and moves the ledger onto the new key.
   - **`consolidateWallet`**, called by `GET /api/wallet` and by the redemption check in
     `/api/create-booking`. This is the part that is easy to miss: `reconcileClientContact` runs
     **after** the booking is created, so on the very first booking following a phone change the
     balance lookup would still read the old key and return zero — the credit would be invisible
     exactly when the admin needs it. `consolidateWallet` looks up the client's historical phone
     numbers via their shared email and pulls any stranded credit onto the current key *before*
     reading the balance. Idempotent and self-healing.

   Together these are the single highest-risk area in the build. Without them you get "where did my
   balance go" reports.

2. **Country-code inconsistency.** The dashboard writes phone as `` `${countryCode}${whatsApp}` `` →
   `+919876543210` → normalises to `919876543210`. An older organic booking may hold `9876543210`,
   which normalises differently and is therefore a *different wallet*. `/api/clients` already has
   this bug, so the wallet will merely be consistent with what the admin sees. Matching the existing
   rule is the right call — being cleverer than `/api/clients` would make the wallet disagree with
   the client list, which is worse. Flag it, don't fix it here.

3. **Shared phone numbers (family)** already collapse into one client in `/api/clients`. They will
   share one wallet. Pre-existing behaviour, but worth knowing before someone reports it as a wallet
   bug.

---

## 7. Edge cases

| # | Case | Handling |
|---|---|---|
| 1 | Cancel double-clicked / retried | Partial unique index + `ON CONFLICT DO NOTHING`; returns `null`, no second credit. |
| 2 | Razorpay booking cancelled | `isWalletEligible` false (gateway `razorpay`) **and** `!isRefundInitiated` guard. Path untouched. |
| 3 | Free consultation cancelled | `amount > 0` fails. No credit. |
| 4 | Wallet-paid booking cancelled | `gw.startsWith('wallet')` → full amount re-credited. Money never destroyed. |
| 5 | Part-wallet booking (₹1,500 wallet + ₹500 QR) cancelled | Full ₹2,000 credited back to wallet. **Confirm this is the policy** — the alternative is ₹1,500 to wallet + ₹500 handed back, needing a manual `REFUND_OUT`. |
| 6 | Two admins settle the same client at once | `pg_advisory_xact_lock` serialises; the second gets the 409. |
| 7 | Client has no phone, only email | Key falls back to `email:<addr>`, matching `/api/clients`. |
| 8 | Client has neither | `buildClientKey` returns `null`; credit is skipped and logged. Cannot happen from the dashboard form (both fields are required). |
| 9 | Wallet exceeds session price | `Math.min(...)` clamps; remainder stays in the wallet. |
| 10 | Stale balance in browser | Server re-reads and returns 409 with `availableBalance`. |
| 11 | Client wants cash back | `POST /api/wallet/adjust` with `reason: 'REFUND_OUT'`; paid outside the app, ledger keeps the record. |
| 12 | Expiry | Not in v1. The `reason` enum has room for it; decide the policy before launch since it must be disclosed to clients. |
| 13 | Unauthenticated caller sends `useWallet` | 403. `/api/create-booking` is public, so redemption re-verifies the bearer token itself — see §3.8. |
| 14 | Debit fails after the booking row is inserted | The booking is already created and the slot held, so the request is not failed. The wallet portion is logged loudly as **not** deducted and the booking is reset to its non-wallet payment state (`Pending` when no cash/QR mode was chosen), so it surfaces as unpaid rather than silently free. |

---

## 8. Build order

Steps 1–5 are strictly additive — wallets only fill up, nothing spends them. If the credit logic is
wrong you correct it with a manual ledger adjustment and nobody downstream noticed.

| # | Step | Risk |
|---|---|---|
| 1 | Run the migration on staging, verify with `\d wallet_transactions` | none |
| 2 | `lib/wallet.ts` — `buildClientKey`, `isWalletEligible`, `getBalance`, `creditWallet`, `debitWallet` | none (nothing calls it) |
| 3 | Read endpoints (`GET /api/wallet`, statement, `/api/wallets`) | none (return zeros) |
| 4 | **Credit on cancel** (§3.5) | low — additive, non-fatal |
| 5 | `reconcileClientContact` key sync (§6.1) | low, but **required** |
| 6 | — **let steps 4–5 bake in production for ~2 weeks** — reconcile the ledger against your cash book | — |
| 7 | **Spend on booking** (§3.6 + §4.1) | **highest** — first user-visible behaviour change |
| 8 | `POST /api/wallet/adjust` with `requireRole` | low |
| 9 | Dashboard KPIs (§5.1), admin wallets view, client Wallet tab | low |

Step 6 is not padding. Until credits have accumulated against real cancellations and been eyeballed
against actual cash, you do not know the identity key is holding — and step 7 is the point where a
client is first told a number.

---

## 9. Test checklist — run by hand before step 7

**There is no automated test suite in this repo.** The `test_*.ts` / `test-*.cjs` files at the root
are one-off diagnostic scripts, not assertions. Nothing will catch a regression in an 11,500-line
`index.ts` except this list, so make it a signed-off QA sheet.

- [ ] Cash booking → cancel → credit appears, one ledger row, booking cancels cleanly
- [ ] QR booking → cancel → same
- [ ] **Razorpay booking → cancel → wallet untouched, Razorpay refund still initiates**
- [ ] **Free consultation → cancel → no ledger row**
- [ ] Double-click Cancel → exactly one credit row
- [ ] Cancel from the public `BookingConfirmation` page → credit applied
- [ ] Booking fully covered by wallet → `wallet_amount_applied` = price, balance 0, gateway `Wallet`
- [ ] Booking partly covered → correct split, gateway `Wallet+QR`
- [ ] Tamper with `walletAmount` in the request body → server clamps or 409s
- [ ] Client changes phone number → wallet follows (§6.1)
- [ ] **Dashboard revenue before vs. after a full cancel→rebook cycle: net unchanged**
- [ ] **All existing dashboard KPIs identical on a database with zero ledger rows**

The four bolded items are the regression guards — they are what prove the feature did not disturb
anything that already worked.
