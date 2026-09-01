import type { PoolClient } from 'pg';
import pool from './db';

/**
 * Client wallet.
 *
 * Bookings created manually from the dashboard and paid by Cash or QR never go
 * through a payment gateway — `bookings.payment_id` is NULL, so the Razorpay
 * refund branch in /api/cancel-booking skips them entirely. By policy we do not
 * refund them. Instead the amount is held as wallet credit and redeemed against
 * a future dashboard-created booking.
 *
 * DESIGN NOTE — the ledger is the only source of truth.
 *
 * There is no cached balance column. Balance is always derived as
 * SUM(CREDIT) - SUM(DEBIT) over wallet_transactions. A cached balance is a
 * second source of truth that can drift from the history it summarises, and
 * every bug in that class is a money bug that surfaces as "the client says they
 * had 1,500". Deriving it makes disagreement impossible by construction, and at
 * this data volume the aggregate is an indexed scan of a handful of rows.
 */

export type WalletReason =
  | 'CANCELLATION_CREDIT'
  | 'BOOKING_SETTLEMENT'
  | 'REFUND_OUT'
  | 'MANUAL_ADJUSTMENT'
  // CREDIT: the client moved to a therapist who charges less, and the
  // difference came back. Deliberately NOT filed as BOOKING_SETTLEMENT — that
  // reason is inside uq_wallet_txn_booking_reason, so a credit under it would
  // collide with the settlement DEBIT for the same booking and be dropped by
  // ON CONFLICT DO NOTHING, silently. See migrations/add_transfer_wizard.sql.
  | 'TRANSFER_ADJUSTMENT';

export interface WalletTxn {
  txn_id: number;
  client_key: string;
  client_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  direction: 'CREDIT' | 'DEBIT';
  reason: WalletReason;
  amount: string;
  currency: string;
  source_booking_id: string | null;
  source_payment_mode: string | null;
  notes: string | null;
  created_at: Date;
}

interface ClientIdentity {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

interface MovementOpts extends ClientIdentity {
  amount: number;
  reason: WalletReason;
  currency?: string | null;
  bookingId?: string | null;
  sourcePaymentMode?: string | null;
  notes?: string | null;
  userId?: number | null;
  userName?: string | null;
}

/** Thrown by debitWallet when the ledger cannot cover the requested amount. */
export class InsufficientWalletBalance extends Error {
  availableBalance: number;
  constructor(availableBalance: number) {
    super('INSUFFICIENT_BALANCE');
    this.name = 'InsufficientWalletBalance';
    this.availableBalance = availableBalance;
  }
}

/**
 * Wallet identity key.
 *
 * `bookings` has no stable client id — GET /api/clients groups clients at read
 * time by normalised phone with email as fallback. This MUST use the same rule,
 * otherwise a client's wallet detaches from the profile the admin is looking at.
 * If that grouping ever changes, change this with it.
 *
 * Known limitation, inherited deliberately: the dashboard writes phones with a
 * country code (+919876543210 -> 919876543210) while some older organic
 * bookings hold a bare 10-digit number, which keys differently. /api/clients
 * already behaves this way, and a wallet that disagrees with the client list
 * would be worse than one that is consistently imperfect.
 */
export function buildClientKey(phone?: string | null, email?: string | null): string | null {
  const p = (phone || '').replace(/[\s\-\(\)\+]/g, '').trim();
  if (p) return p;
  const e = (email || '').toLowerCase().trim();
  return e ? `email:${e}` : null;
}

/**
 * Whether cancelling this booking should credit the client's wallet.
 *
 * Gateway and status are lowercased because casing is inconsistent across this
 * codebase (dashboard stats compare exact-case, per-therapist revenue uses
 * LOWER()). A booking already settled from the wallet is eligible too —
 * otherwise cancelling a wallet-paid session would destroy the client's money.
 */
export function isWalletEligible(booking: any): boolean {
  const gw = String(booking?.invitee_payment_gateway || '').toLowerCase().trim();
  const paid = String(booking?.payment_status || '').toLowerCase().trim() === 'paid';
  const amount = Number(booking?.invitee_payment_amount) || 0;
  const eligibleGateway = gw === 'cash' || gw === 'qr' || gw.startsWith('wallet');
  return paid && amount > 0 && eligibleGateway;
}

/** Current balance for a client. Pass `tx` to read inside an open transaction. */
export async function getBalance(clientKey: string, tx?: PoolClient): Promise<number> {
  const q = tx || pool;
  const { rows } = await q.query(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END), 0) AS balance
     FROM wallet_transactions
     WHERE client_key = $1`,
    [clientKey]
  );
  return Number(rows[0]?.balance || 0);
}

/** Balance looked up by raw contact details. Returns 0 when there is no identity. */
export async function getBalanceForClient(phone?: string | null, email?: string | null): Promise<number> {
  const key = buildClientKey(phone, email);
  return key ? getBalance(key) : 0;
}

const INSERT_COLUMNS = `
  client_key, client_name, client_phone, client_email, direction, reason,
  amount, currency, source_booking_id, source_payment_mode, notes,
  created_by_user_id, created_by_name`;

function insertValues(clientKey: string, direction: 'CREDIT' | 'DEBIT', opts: MovementOpts) {
  return [
    clientKey,
    opts.name || null,
    opts.phone || null,
    opts.email || null,
    direction,
    opts.reason,
    opts.amount,
    opts.currency || 'INR',
    opts.bookingId || null,
    opts.sourcePaymentMode || null,
    opts.notes || null,
    opts.userId ?? null,
    opts.userName || null,
  ];
}

/**
 * Add credit. No lock is needed — adding money cannot overdraw.
 *
 * Returns null when this booking was already credited for this reason, which is
 * a normal outcome (a retried request, or Cancel double-clicked), not an error.
 */
export async function creditWallet(opts: MovementOpts): Promise<WalletTxn | null> {
  const clientKey = buildClientKey(opts.phone, opts.email);
  if (!clientKey) {
    console.warn('[wallet] Skipping credit: no phone or email to key the wallet on');
    return null;
  }
  if (!(Number(opts.amount) > 0)) return null;

  const { rows } = await pool.query(
    `INSERT INTO wallet_transactions (${INSERT_COLUMNS})
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     -- uq_wallet_txn_booking_reason is a PARTIAL index, so the inference clause
     -- has to restate its predicate verbatim. Without the WHERE this fails with
     -- "no unique or exclusion constraint matching the ON CONFLICT specification".
     ON CONFLICT (source_booking_id, reason)
       WHERE source_booking_id IS NOT NULL
         AND reason IN ('CANCELLATION_CREDIT','BOOKING_SETTLEMENT')
     DO NOTHING
     RETURNING *`,
    insertValues(clientKey, 'CREDIT', opts)
  );
  return rows[0] || null;
}

/**
 * Spend credit.
 *
 * Runs in a transaction with an advisory lock on the client key. There is no
 * wallet row to SELECT ... FOR UPDATE, so the lock is what stops two admins
 * settling the same client's balance concurrently and overdrawing it. It is
 * released automatically on COMMIT/ROLLBACK, and different clients never
 * contend with each other.
 *
 * Keep this transaction short — never wrap a calendar or email call in it, the
 * pool only has 10 connections.
 */
export async function debitWallet(opts: MovementOpts): Promise<WalletTxn> {
  const clientKey = buildClientKey(opts.phone, opts.email);
  if (!clientKey) throw new Error('Cannot debit wallet: no client identity');
  if (!(Number(opts.amount) > 0)) throw new Error('Cannot debit wallet: amount must be positive');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [clientKey]);

    const balance = await getBalance(clientKey, client);
    if (balance < Number(opts.amount)) {
      await client.query('ROLLBACK');
      throw new InsufficientWalletBalance(balance);
    }

    const { rows } = await client.query(
      `INSERT INTO wallet_transactions (${INSERT_COLUMNS})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (source_booking_id, reason)
         WHERE source_booking_id IS NOT NULL
           AND reason IN ('CANCELLATION_CREDIT','BOOKING_SETTLEMENT')
       DO NOTHING
       RETURNING *`,
      insertValues(clientKey, 'DEBIT', opts)
    );

    if (!rows[0]) {
      // Already settled against this booking. Not an error, but the caller must
      // not be told a fresh debit happened.
      await client.query('ROLLBACK');
      throw new Error('WALLET_ALREADY_SETTLED');
    }

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Statement rows, newest first, with the running balance carried on each row.
 *
 * The running balance is computed with a window function rather than stored, so
 * there is still exactly one source of truth. The LEFT JOIN carries the related
 * booking's session name and time: the ledger only records a booking id, and a
 * statement that reads "Cancelled session · 483920" tells the reader nothing
 * about which session the money came from.
 */
export async function getTransactions(
  clientKey: string,
  limit = 50,
  offset = 0
): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT
       s.*,
       b.booking_resource_name  AS booking_session_name,
       b.booking_invitee_time   AS booking_session_time,
       b.booking_start_at       AS booking_start_at,
       b.booking_status         AS booking_status,
       b.booking_host_name      AS booking_therapist_name
     FROM (
       SELECT
         t.*,
         SUM(CASE WHEN t.direction = 'CREDIT' THEN t.amount ELSE -t.amount END)
           OVER (ORDER BY t.txn_id) AS balance_after
       FROM wallet_transactions t
       WHERE t.client_key = $1
     ) s
     LEFT JOIN bookings b ON b.booking_id = s.source_booking_id
     ORDER BY s.txn_id DESC
     LIMIT $2 OFFSET $3`,
    [clientKey, limit, offset]
  );
  return rows;
}

/**
 * Follow a client's wallet when their contact details change.
 *
 * reconcileClientContact() rewrites invitee_phone/invitee_email across all of a
 * client's bookings whenever a new one is created, which can move the wallet key
 * out from under an existing balance. Without this the credit orphans and the
 * client is told they have nothing.
 */
export async function remapClientKey(
  oldPhone: string | null | undefined,
  oldEmail: string | null | undefined,
  newPhone: string | null | undefined,
  newEmail: string | null | undefined
): Promise<void> {
  const oldKey = buildClientKey(oldPhone, oldEmail);
  const newKey = buildClientKey(newPhone, newEmail);
  if (!oldKey || !newKey || oldKey === newKey) return;

  // Takes the SAME advisory locks debitWallet() takes, for the same reason.
  // This moves rows out from under a key; a debit that had already computed a
  // balance from those rows would otherwise commit against a set that no longer
  // exists, and overdraw the destination. Both keys are locked, and always in
  // sorted order — two remaps running in opposite directions would deadlock if
  // each grabbed its own "first" key.
  const [lockA, lockB] = [oldKey, newKey].sort();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockA]);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockB]);

    const { rowCount } = await client.query(
      `UPDATE wallet_transactions
       SET client_key = $1, client_phone = $2, client_email = $3
       WHERE client_key = $4`,
      [newKey, newPhone || null, newEmail || null, oldKey]
    );
    await client.query('COMMIT');
    if (rowCount) {
      console.log(`[wallet] Remapped ${rowCount} ledger row(s) from ${oldKey} to ${newKey}`);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Pull any credit sitting under a client's OLD phone number onto their current
 * key, and return that key.
 *
 * Why this is needed: the wallet is keyed on the normalised phone, but
 * reconcileClientContact() only rewrites contact details AFTER a booking is
 * created. So when an admin books an existing client with a newly-changed phone
 * number, a straight lookup on the new number returns zero and the balance is
 * never offered — the credit is stranded until the next booking.
 *
 * Historical keys are found via the shared email, which is the only link back to
 * the client's earlier bookings. Idempotent and self-healing: once consolidated,
 * subsequent calls find nothing to move.
 */
export async function consolidateWallet(
  phone?: string | null,
  email?: string | null
): Promise<string | null> {
  const currentKey = buildClientKey(phone, email);
  const e = (email || '').trim();
  if (!currentKey || !e) return currentKey;

  // Any other key this client's ledger might be sitting under: the email-only
  // key, plus every distinct phone previously recorded against this email.
  const { rows } = await pool.query(
    `SELECT DISTINCT invitee_phone FROM bookings
     WHERE LOWER(invitee_email) = LOWER($1)
       AND COALESCE(invitee_phone, '') <> ''`,
    [e]
  );

  const candidateKeys = new Set<string>();
  candidateKeys.add(`email:${e.toLowerCase()}`);
  for (const row of rows) {
    const k = buildClientKey(row.invitee_phone, null);
    if (k) candidateKeys.add(k);
  }
  candidateKeys.delete(currentKey);
  if (candidateKeys.size === 0) return currentKey;

  // Locked on the destination key, matching debitWallet(). Consolidation only
  // ever ADDS rows to currentKey, so an unlocked run could not overdraw it —
  // but it could make a concurrent debit read a balance that was mid-move and
  // reject a payment the client could afford. Locking makes the two serialise.
  //
  // Only the destination is locked, not every source: the sources are keys this
  // client has abandoned, nothing else writes to them, and locking an unbounded
  // set in a loop is how deadlocks get introduced.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [currentKey]);

    const { rowCount } = await client.query(
      `UPDATE wallet_transactions
       SET client_key = $1, client_phone = $2, client_email = $3
       WHERE client_key = ANY($4::varchar[])`,
      [currentKey, phone || null, e, Array.from(candidateKeys)]
    );
    await client.query('COMMIT');
    if (rowCount) {
      console.log(`[wallet] Consolidated ${rowCount} ledger row(s) onto ${currentKey}`);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return currentKey;
}

/** Every client currently holding credit. For the admin wallets view. */
export async function listWallets(minBalance = 0.01): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT
       client_key,
       MAX(client_name)  AS client_name,
       MAX(client_phone) AS client_phone,
       MAX(client_email) AS client_email,
       MAX(currency)     AS currency,
       SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END) AS balance,
       MAX(created_at)   AS last_activity_at
     FROM wallet_transactions
     GROUP BY client_key
     HAVING SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END) >= $1
     ORDER BY balance DESC`,
    [minBalance]
  );
  return rows;
}

/** Total outstanding liability across all clients. */
export async function getTotalLiability(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END), 0) AS total
     FROM wallet_transactions`
  );
  return Number(rows[0]?.total || 0);
}
