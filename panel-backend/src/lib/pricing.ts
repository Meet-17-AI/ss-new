/**
 * Server-side price resolution.
 *
 * This module is the ONLY place in the application that decides what a client
 * pays. Every path that quotes, charges, or records a price goes through
 * resolvePrice() — the public booking page, the Razorpay order, the pending
 * booking, the slot-fetch quote, and the admin booking form's prefill.
 *
 * The rule that made this necessary: before it existed, POST /api/razorpay/create-order
 * took `amount` straight from the request body and created the Razorpay order
 * for whatever number arrived, and verify-payment checked only the HMAC
 * signature — never the amount. A modified request could book a ₹3000 session
 * for ₹1 and it confirmed cleanly. Any pricing feature layered on a
 * client-supplied amount is decorative, so resolution had to move here first.
 *
 * See migrations/2026-08-06_pricing_engine.sql for the schema and the reasoning
 * behind each table.
 */

// Accepts either the pool or an open transaction client — both expose .query,
// and the lock write needs to join the caller's transaction.
type Queryable = { query: (text: string, params?: any[]) => Promise<any> };

export type PriceSource = 'free' | 'override' | 'lock' | 'schedule' | 'legacy';

export interface ResolvedPrice {
  amount: number;
  currency: string;
  /** Which rule won. Stored on the booking and in price_resolution_log. */
  source: PriceSource;
  /** Primary key of the winning rule row, where one exists. */
  ruleId: number | null;
  /** True when the client is paying less than list because of a lock. */
  isGrandfathered: boolean;
  /** What a brand-new client would pay right now. */
  listAmount: number;
  serviceId: number | null;
}

/* ------------------------------------------------------------------ *
 * Identity normalisation
 * ------------------------------------------------------------------ */

export const normalizeEmail = (email?: string | null): string | null => {
  const e = (email || '').trim().toLowerCase();
  return e || null;
};

/**
 * Last 10 digits only.
 *
 * Stored numbers are inconsistent — '+91 9764328147', '+919876543210', and
 * bare 10-digit forms all appear in bookings.invitee_phone. The last 10 digits
 * are the only form that compares reliably across them. This mirrors the
 * matching already done in /api/public/client-history.
 */
export const normalizePhoneDigits = (phone?: string | null): string | null => {
  const digits = (phone || '').replace(/[^0-9]/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
};

/**
 * Parse the legacy therapy_services.charges VARCHAR ('₹3000', '₹', '0', '1,200').
 * Returns 0 for anything that does not yield a number — id 17 stores the bare
 * string '₹', and 0 is the right reading for a free consultation.
 */
export const parseCharges = (raw?: string | number | null): number => {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  const cleaned = String(raw ?? '').replace(/[^0-9.]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
};

/** Convert an admin's calendar date (IST) to the instant it begins. */
export const istDateToTimestamp = (dateStr: string): string => `${dateStr}T00:00:00+05:30`;

/* ------------------------------------------------------------------ *
 * Resolution
 * ------------------------------------------------------------------ */

export interface ResolvePriceOptions {
  serviceId?: number | null;
  /** Public booking slug, when the caller only has that. */
  slug?: string | null;
  clientEmail?: string | null;
  clientPhone?: string | null;
  /** Defaults to now. The booking/payment moment, not the session date. */
  at?: Date | null;
}

/**
 * Resolve what this client pays for this therapy at this moment.
 *
 * Priority (first match wins):
 *   0. payment disabled on the service        -> free
 *   1. client_price_override, service-specific -> then all-therapies override
 *   2. client_price_lock                       -> grandfathered rate
 *   3. therapy_price_schedule                  -> list price in force
 *   4. therapy_services.charges                -> legacy fallback
 *
 * Never throws. A failure anywhere falls back to the legacy column rather than
 * blocking a booking, and the caller sees source='legacy'.
 */
export async function resolvePrice(
  db: Queryable,
  opts: ResolvePriceOptions
): Promise<ResolvedPrice> {
  const email = normalizeEmail(opts.clientEmail);
  const phone = normalizePhoneDigits(opts.clientPhone);
  const at = opts.at ?? new Date();

  const svcRes = await db.query(
    `SELECT id, charges, is_payment_enabled, title
       FROM therapy_services
      WHERE ($1::int IS NOT NULL AND id = $1::int)
         OR ($1::int IS NULL AND $2::text IS NOT NULL AND slug = $2::text)
      LIMIT 1`,
    [opts.serviceId ?? null, opts.slug ? (opts.slug.startsWith('/') ? opts.slug : `/${opts.slug}`) : null]
  );

  if (svcRes.rows.length === 0) {
    return { amount: 0, currency: 'INR', source: 'legacy', ruleId: null, isGrandfathered: false, listAmount: 0, serviceId: null };
  }

  const service = svcRes.rows[0];
  const serviceId: number = service.id;
  const legacyAmount = parseCharges(service.charges);

  // 0. A free consultation must short-circuit before any rule runs. Without
  //    this, a stale all-therapies override could put a price on a free slot.
  if (service.is_payment_enabled === false) {
    return { amount: 0, currency: 'INR', source: 'free', ruleId: null, isGrandfathered: false, listAmount: 0, serviceId };
  }

  // ---- list price (needed regardless, for the isGrandfathered comparison) ----
  let listAmount = legacyAmount;
  let listRuleId: number | null = null;
  let listSource: PriceSource = 'legacy';
  try {
    const sched = await db.query(
      `SELECT id, amount FROM therapy_price_schedule
        WHERE service_id = $1 AND revoked_at IS NULL AND effective_from <= $2
        ORDER BY effective_from DESC, id DESC
        LIMIT 1`,
      [serviceId, at]
    );
    if (sched.rows.length > 0) {
      listAmount = Number(sched.rows[0].amount);
      listRuleId = sched.rows[0].id;
      listSource = 'schedule';
    }
  } catch (err) {
    console.error('[pricing] schedule lookup failed, falling back to charges:', err);
  }

  const listResult: ResolvedPrice = {
    amount: listAmount, currency: 'INR', source: listSource,
    ruleId: listRuleId, isGrandfathered: false, listAmount, serviceId,
  };

  // An anonymous visitor (step 1 of the booking page) has no identity yet, so
  // only the list price is knowable. The page re-resolves once they enter an
  // email.
  if (!email && !phone) return listResult;

  // ---- 1. client-specific override ----
  // Ordered so a therapy-specific rule beats an all-therapies rule, and a newer
  // rule beats an older one.
  try {
    const ovr = await db.query(
      `SELECT id, amount FROM client_price_override
        WHERE revoked_at IS NULL
          AND effective_from <= $2
          AND (effective_until IS NULL OR effective_until > $2)
          AND (service_id = $1 OR service_id IS NULL)
          AND ( ($3::text IS NOT NULL AND client_email = $3::text)
             OR ($4::text IS NOT NULL AND client_phone_digits = $4::text) )
        ORDER BY (service_id IS NOT NULL) DESC, effective_from DESC, id DESC
        LIMIT 1`,
      [serviceId, at, email, phone]
    );
    if (ovr.rows.length > 0) {
      const amount = Number(ovr.rows[0].amount);
      return {
        amount, currency: 'INR', source: 'override', ruleId: ovr.rows[0].id,
        isGrandfathered: amount < listAmount, listAmount, serviceId,
      };
    }
  } catch (err) {
    console.error('[pricing] override lookup failed:', err);
  }

  // ---- 2. grandfather lock ----
  try {
    const lock = await db.query(
      `SELECT id, locked_amount, locked_at FROM client_price_lock
        WHERE service_id = $1
          AND released_at IS NULL
          AND ( ($2::text IS NOT NULL AND client_email = $2::text)
             OR ($3::text IS NOT NULL AND client_phone_digits = $3::text) )
        ORDER BY (client_email IS NOT NULL AND client_email = $2::text) DESC NULLS LAST, locked_at ASC
        LIMIT 1`,
      [serviceId, email, phone]
    );

    if (lock.rows.length > 0) {
      const row = lock.rows[0];

      // A lock only survives while every price change since it was taken out
      // was marked "grandfather existing clients". One change with that toggle
      // off is an explicit decision to move everyone, and voids the lock.
      //
      // The comparison is against created_at, NOT effective_from. An admin can
      // backdate a change, and a change dated before the lock but *authored*
      // after it is still a decision to move everyone — testing effective_from
      // let exactly that case slip through and keep the client on the old rate.
      const voided = await db.query(
        `SELECT 1 FROM therapy_price_schedule
          WHERE service_id = $1 AND revoked_at IS NULL
            AND grandfather_existing = FALSE
            AND created_at > $2
            AND effective_from <= $3
          LIMIT 1`,
        [serviceId, row.locked_at, at]
      );

      if (voided.rows.length === 0) {
        // A lock protects the client from an INCREASE. It is not a floor.
        //
        // Taking locked_amount unconditionally meant that when a therapy's price
        // was cut, everyone holding a lock kept paying the old higher rate — and
        // isGrandfathered, computed as `!==`, reported them as being on a
        // discount while they were overpaying. Nobody audits the clients who are
        // supposedly getting a deal, so it stayed invisible.
        //
        // `Math.min` is the whole fix: a lock never costs more than a new client
        // would pay today. The flag is now `<`, matching the override branch
        // above and the documented meaning on ResolvedPrice.
        const amount = Math.min(Number(row.locked_amount), listAmount);
        return {
          amount, currency: 'INR', source: 'lock', ruleId: row.id,
          isGrandfathered: amount < listAmount, listAmount, serviceId,
        };
      }
    }
  } catch (err) {
    console.error('[pricing] lock lookup failed:', err);
  }

  // ---- 3/4. list price ----
  return listResult;
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/**
 * Record a client's entitlement to the rate they just booked at.
 *
 * Called once, from processConfirmedBooking, inside that function's existing
 * transaction. ON CONFLICT DO NOTHING makes it idempotent, which matters
 * because the webhook, the browser verify-payment call, and the pending-payment
 * cron all race to confirm the same booking.
 *
 * Deliberately swallows errors: a booking that is already paid for must never
 * fail to confirm because a pricing bookkeeping row could not be written.
 */
export async function recordPriceLock(
  db: Queryable,
  args: {
    serviceId?: number | null;
    clientEmail?: string | null;
    clientPhone?: string | null;
    amount: number;
    bookingId?: string | null;
    source?: string;
    /**
     * Which rule produced `amount`. Only a client who paid LIST price earns a
     * refreshed lock — see below.
     */
    resolvedFrom?: PriceSource;
  }
): Promise<void> {
  const email = normalizeEmail(args.clientEmail);
  const phone = normalizePhoneDigits(args.clientPhone);
  if (!args.serviceId || (!email && !phone) || !(args.amount > 0)) return;

  try {
    // When a client pays list price despite having a lock on file, that lock
    // was voided by a "applies to everyone" price change. Retire it, so the
    // rate they just actually agreed to becomes their new entitlement. Without
    // this the stale lock blocks the insert below (ON CONFLICT DO NOTHING) and
    // they would be re-quoted list price forever, never settling anywhere.
    //
    // Restricted to list-price payments on purpose. A client paying an
    // override rate must NOT have it frozen into a lock — revoking the
    // override would otherwise leave them on that price permanently.
    if (args.resolvedFrom === 'schedule' || args.resolvedFrom === 'legacy') {
      await db.query(
        `UPDATE client_price_lock
            SET released_at = NOW(), released_by = 'price-change-reset'
          WHERE service_id = $1
            AND released_at IS NULL
            AND locked_amount <> $2
            AND ( ($3::text IS NOT NULL AND client_email = $3::text)
               OR ($4::text IS NOT NULL AND client_phone_digits = $4::text) )`,
        [args.serviceId, args.amount, email, phone]
      );
    }

    // Two partial unique indexes back this ON CONFLICT, not one:
    //   uq_client_price_lock_email      ... WHERE client_email IS NOT NULL
    //   uq_client_price_lock_phone_only ... WHERE client_email IS NULL
    //
    // Only the first existed before. A client with no email on file therefore
    // matched no unique index, nothing could conflict, and this wrote a fresh
    // lock row on every single confirmed booking — unbounded growth, and a
    // release-and-reset above that then retired all of them at once. The second
    // index closes exactly that gap while leaving the documented
    // many-phones-per-one-email case free to insert.
    await db.query(
      `INSERT INTO client_price_lock (
         client_email, client_phone_digits, service_id, locked_amount,
         currency, source, first_booking_id
       ) VALUES ($1, $2, $3, $4, 'INR', $5, $6)
       ON CONFLICT DO NOTHING`,
      [email, phone, args.serviceId, args.amount, args.source || 'first_booking', args.bookingId || null]
    );
  } catch (err) {
    console.error('[pricing] failed to record price lock (non-fatal):', err);
  }
}

/**
 * Point therapy_services.charges at whatever price is now in force.
 *
 * That column is no longer authoritative, but the Therapies tab and the therapy
 * details modal still display it, so letting it drift shows admins a price no
 * client is actually charged. Revoking a change that had already taken effect
 * did exactly that — the resolver correctly fell back to the previous row while
 * the column kept the revoked figure.
 *
 * Call after any write to therapy_price_schedule.
 */
export async function syncLegacyCharges(db: Queryable, serviceId: number): Promise<void> {
  try {
    const price = await resolvePrice(db, { serviceId });
    await db.query('UPDATE therapy_services SET charges = $1 WHERE id = $2', [`₹${price.listAmount}`, serviceId]);
  } catch (err) {
    console.error('[pricing] failed to sync legacy charges (non-fatal):', err);
  }
}

/**
 * Audit trail for a single resolution. Fire-and-forget — never block a booking
 * on the log write.
 */
export async function logPriceResolution(
  db: Queryable,
  price: ResolvedPrice,
  ctx: {
    context: 'quote' | 'order' | 'booking';
    bookingId?: string | null;
    clientEmail?: string | null;
    clientPhone?: string | null;
  }
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO price_resolution_log (
         booking_id, service_id, client_email, client_phone_digits,
         resolved_amount, list_amount, price_source, rule_id,
         is_grandfathered, context
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        ctx.bookingId || null, price.serviceId,
        normalizeEmail(ctx.clientEmail), normalizePhoneDigits(ctx.clientPhone),
        price.amount, price.listAmount, price.source, price.ruleId,
        price.isGrandfathered, ctx.context,
      ]
    );
  } catch (err) {
    console.error('[pricing] failed to write resolution log (non-fatal):', err);
  }
}

/**
 * Best-effort service_id for a booking that only carries a therapist and a
 * resource label. Mirrors the category matching used by the migration backfill,
 * and is equally conservative: an ambiguous label resolves to null rather than
 * being guessed at, because a wrong service_id grandfathers a client onto the
 * wrong therapy's price.
 */
export async function resolveServiceIdFromLabel(
  db: Queryable,
  therapistId?: string | null,
  resourceName?: string | null
): Promise<number | null> {
  if (!therapistId || !resourceName) return null;
  const label = resourceName.toLowerCase();
  const category =
    label.includes('free consultation') ? 'free' :
    label.includes('adolescent')        ? 'adolescent' :
    label.includes('couple')            ? 'couples' :
    label.includes('individual')        ? 'individual' : null;
  if (!category) return null;

  try {
    const res = await db.query(
      `SELECT id FROM therapy_services
        WHERE therapist_id = $1
          AND CASE
                WHEN title ILIKE '%free consultation%' THEN 'free'
                WHEN title ILIKE '%adolescent%'        THEN 'adolescent'
                WHEN title ILIKE '%couple%'            THEN 'couples'
                WHEN title ILIKE '%individual%'        THEN 'individual'
                ELSE NULL
              END = $2`,
      [therapistId, category]
    );
    return res.rows.length === 1 ? res.rows[0].id : null;
  } catch (err) {
    console.error('[pricing] resolveServiceIdFromLabel failed:', err);
    return null;
  }
}
