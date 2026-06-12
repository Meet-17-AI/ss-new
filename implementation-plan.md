# SafeStories Panel — Bug Fix Implementation Plan

> Status: **ANALYSIS ONLY — no code changed yet.** This document explains what I understood for each reported issue, the root cause I found in the code, and the exact fix I propose. After you approve, I will implement these in order.

**Key files referenced**
- Backend API: [panel-backend/src/index.ts](panel-backend/src/index.ts) (~8,740 lines)
- Admin shell + routing: [App.tsx](App.tsx), [components/Dashboard.tsx](components/Dashboard.tsx)
- Admin create booking: [components/CreateBooking.tsx](components/CreateBooking.tsx)
- Public booking: [components/BookingPage.tsx](components/BookingPage.tsx), [components/PublicBookingContainer.tsx](components/PublicBookingContainer.tsx), [components/BookingConfirmation.tsx](components/BookingConfirmation.tsx)
- Therapist app: [components/TherapistDashboard.tsx](components/TherapistDashboard.tsx)
- Schedule editor: [components/ScheduleCalendarGrid.tsx](components/ScheduleCalendarGrid.tsx)
- Session notes: [components/SessionNotesForm.tsx](components/SessionNotesForm.tsx), [components/SessionNotesPage.tsx](components/SessionNotesPage.tsx)

---

## 1. Session mode ("In-person" / "Google Meet") consistency across the platform

**Understood:** Mode should be a real two-way choice everywhere — public booking, calendar events, and the admin **Create New Booking** form — using the same two values: **In-person** and **Google Meet (online)**.

**Current state / root cause:**
- The vocabulary is inconsistent. Different layers use different strings:
  - DayschedulemModes: `google_meet` / `physical` ([CreateBooking.tsx:354-372](components/CreateBooking.tsx#L354-L372))
  - Internal app value: `online` / `in-person` ([CreateBooking.tsx:20](components/CreateBooking.tsx#L20))
  - DB `booking_mode` column stores display text: `'Online Video Call'` / `'In Person (Pune)'` ([panel-backend/src/index.ts:6655](panel-backend/src/index.ts#L6655))
- In Create Booking, the In-person/Online radios are **disabled** unless the therapy's `availableModes` includes them, and Online is auto-selected when only one mode exists ([CreateBooking.tsx:377, 721-739](components/CreateBooking.tsx#L721-L739)). If `availableModes` is mis-parsed, the admin loses the ability to pick mode.

**Fix:**
- Define one canonical enum used end-to-end: `online` (label "Google Meet") and `in-person` (label "In-person").
- Add an explicit **Session Mode** selector in the admin Create New Booking form that is always enabled when the therapy supports both modes (currently it only works correctly when modes parse cleanly). Validate that a mode is selected before submit.
- Normalize on write in [create-booking](panel-backend/src/index.ts#L6486): store a canonical `booking_mode` plus keep the human label, and branch the Google Calendar event on `sessionMode === 'online'` (already done at [6575](panel-backend/src/index.ts#L6575)) — verified the online path adds a Meet conference and in-person adds the office location.
- Audit the calendar/booking views to render mode from the canonical value, mapping to "Google Meet" / "In-person".

---

## 2. Mobile view for the check-in URL and the public booking calendar

**Understood:** The public check-in page (`/booking-confirmation/...`) and the public booking calendar (`/book/...`) must be usable on mobile.

**Root cause:** [App.tsx:71-95](App.tsx#L71-L95) renders a global "Desktop View Required" screen for **every** route when `window.innerWidth < 768`. This blocks public/customer-facing routes (`/book/*`, `/booking-confirmation/*`, `/pay/*`, `/session-notes/*`) on phones, not just the admin dashboard.

**Fix:**
- Move the `isMobile` gate so it only applies to the **authenticated internal** routes (`/admin`, `/therapist`, `/crm`, `/automation-logs`).
- Let public routes render normally on mobile and ensure their layouts are responsive ([BookingPage.tsx](components/BookingPage.tsx), [BookingConfirmation.tsx](components/BookingConfirmation.tsx)) — verify/add responsive classes (stack columns, full-width buttons).

---

## 3. Double booking from "Create New Booking" / booking link (double-click + calendar conflict)

**Understood:** Clicking **Book/Confirm** twice creates two bookings. Also: a new booking should not be created if the slot already conflicts in Google Calendar or the system bookings table.

**Root cause:**
- Frontend has a client-side guard (`if (isSubmitting) return; setIsSubmitting(true)` at [CreateBooking.tsx:413-414](components/CreateBooking.tsx#L413-L414)) and disables the button, but this is per-tab only and does not prevent a rapid double request / network retry.
- Backend [create-booking](panel-backend/src/index.ts#L6486) and [create-pending-booking](panel-backend/src/index.ts#L6752) have **no idempotency key and no conflict check** — each call generates a fresh random `booking_id` and inserts unconditionally. No query checks for an existing active booking for the same therapist + overlapping time, and no check against Google Calendar busy times.

**Fix (backend, the durable fix):**
- Add a **slot conflict check** before insert: query `bookings` for the same `therapist_id` where status in (`confirmed`,`payment_pending`) and `[booking_start_at, booking_end_at)` overlaps the requested slot → return `409 Conflict` instead of inserting.
- Add Google Calendar busy check via `freebusy.query` (or list events in the window) for therapists with a connected calendar; reject if busy.
- Add **idempotency**: accept a client-generated `idempotencyKey` (or derive one from therapist+slot+email) and use `INSERT ... ON CONFLICT DO NOTHING` / a unique partial index so a duplicate submit returns the existing booking instead of creating a second.
- Apply the same guards to `create-pending-booking` and `send-booking-link`.

**Fix (frontend hardening):** keep the `isSubmitting` guard, disable the button immediately, and treat a `409` as "slot already taken" with a clear toast.

---

## 4. Client profile opens but sidebar highlights "All Therapists" instead of "All Clients"

**Understood:** From the Bookings page, clicking a client name opens the client profile, but the yellow sidebar highlight lands on **All Therapists**.

**Root cause:** The client profile is rendered by reusing the `/admin/therapists` route ([Dashboard.tsx:557, 567, 749](components/Dashboard.tsx#L557)). The active sidebar item is derived from the URL path segment: `activeView = location.pathname.split('/')[2]` → `'therapists'` ([Dashboard.tsx:38](components/Dashboard.tsx#L38)). It is only overridden to `clients`/`appointments` when `?source=` is one of those two ([Dashboard.tsx:39-41](components/Dashboard.tsx#L39-L41)). The dashboard recent-bookings link uses `source=dashboard` ([Dashboard.tsx:749](components/Dashboard.tsx#L749)), which is unhandled, so the highlight stays on "therapists". Even with `source=appointments`, the requirement is for the **All Clients** tab to be highlighted while viewing a client.

**Fix:** When a `clientId` query param is present (i.e., we are viewing a client profile, not the therapist list), force `activeView = 'clients'` so the **All Clients** item is highlighted, regardless of `source`. (Optionally move client profile onto its own `/admin/clients/:id` route for clarity.)

---

## 6. Session mode not shown on the public check-in URL

**Understood:** The public check-in page should display the mode the booking was created with (Google Meet / In-person).

**Root cause:** The public booking endpoint [GET /api/public/booking/:booking_id](panel-backend/src/index.ts#L3450) does **not** select `booking_mode`, so [BookingConfirmation.tsx](components/BookingConfirmation.tsx) has no mode to render.

**Fix:**
- Add `booking_mode` (and the canonical mode value from #1) to the SELECT in `/api/public/booking/:booking_id`.
- Render a "Session mode: Google Meet / In-person" line in [BookingConfirmation.tsx](components/BookingConfirmation.tsx), and for in-person show the office location, for online show the join link.

---

## 7. Adding a date override makes the dragged weekly availability disappear

**Understood:** In the therapist schedule, adding a single-day override should affect **only that date**; it must not wipe the weekly availability set by dragging the calendar.

**Root cause:** Weekly availability and date overrides are conflated. The slot generator reads weekly rules from `availability` and per-date rules from `date_overrides` ([panel-backend/src/index.ts:5750-5797](panel-backend/src/index.ts#L5750-L5797)). The grid editor stores weekly entries keyed by weekday name and tries to "preserve" overrides by filtering entries whose `day` looks like a date ([ScheduleCalendarGrid.tsx:80-82](components/ScheduleCalendarGrid.tsx#L80-L82)). When an override is added, it is written into the **same `availability` array** (or the save path replaces `availability` wholesale via [PUT /api/dayschedule/schedules/:id](panel-backend/src/index.ts#L3080)), so the weekly rules get clobbered → every other day reads as unavailable.

**Fix:**
- Keep weekly availability and overrides in **separate stores**: weekly rules in `availability` (weekday-keyed), per-date entries in `date_overrides` only.
- When saving an override, send only the `date_overrides` array and leave `availability` untouched (merge-on-save in the PUT handler instead of overwrite).
- Verify slot generation already prefers an override for the matching date and falls back to weekly otherwise (it does, [5783-5797](panel-backend/src/index.ts#L5783-L5797)) — the remaining fix is purely on the write/merge side and the editor.

---

## 8. Phone / email conflict — keep the latest contact info

**Understood:** If a returning client books with the same email but a new phone (or same phone but a new email), the database should be **updated to the latest** value and the new value shown on the admin dashboard — not the stale one.

**Root cause:** [create-booking](panel-backend/src/index.ts#L6627) and the public booking path just `INSERT` a new `bookings` row with whatever was submitted. There is no "client" reconciliation: contact info lives per-booking, so old bookings keep old numbers/emails and the dashboard may surface an older record.

**Fix:**
- On booking create, **reconcile by identity**: match an existing client by email OR phone.
  - Same email, new phone → update phone on the client/prior records.
  - Same phone, new email → update email.
- Implement via a lightweight `clients` reconciliation table or an UPDATE that propagates the newest contact info, and have the admin client list/profile read the canonical latest value.
- Decide tie-breaking (latest booking wins) and apply consistently in both booking paths.

---

## 9. Missing payment-card data (payment id, timestamps, amount, order id) from Razorpay

**Understood:** When a booking is created (public page **and** admin "Create New Booking" link), the Razorpay `payment_id`, `order_id`, `amount`, and timestamps must be fetched and stored.

**Root cause:** The booking insert stores `payment_id`/`payment_status`/`amount` only if the client passes them in the payload ([panel-backend/src/index.ts:6649, 6659-6661](panel-backend/src/index.ts#L6659-L6661)); `razorpay_order_id`, payment timestamps, and the verified amount from Razorpay are not consistently captured. The payments view reads `razorpay_order_id`, `payment_id`, etc. ([5250-5266](panel-backend/src/index.ts#L5250-L5266)) but those fields are often null because they're never persisted at verify time.

**Fix:**
- In [verify-payment](panel-backend/src/index.ts#L6314) (and the Razorpay webhook [6248](panel-backend/src/index.ts#L6248)), fetch the authoritative payment object from Razorpay and persist `payment_id`, `order_id`, captured `amount`, `payment_mode`, and timestamps into `bookings` + `payments`.
- For the admin "generate payment link" flow ([generate-payment-link](panel-backend/src/index.ts#L8164)), ensure the order id is stored when the order is created and reconciled on payment success.
- Backfill these fields in the booking record so the payment card renders complete data.

---

## 10. Payments page must show all statuses (completed / pending / failed / refunded / refund failed)

**Understood:** The Payments view should list every payment state.

**Root cause:** [GET /api/payments](panel-backend/src/index.ts#L5224) only builds rows for `completed`, `pending`, and `expired` (failed) ([5271, 5295, 5308](panel-backend/src/index.ts#L5271-L5308)). **Refunded** and **refund failed** are served by a separate [/api/refunds](panel-backend/src/index.ts#L5147) endpoint and never merged into the Payments page tabs.

**Fix:**
- Extend `/api/payments` to add `refunded` and `refund_failed` branches (read `refund_status IN ('processed','refunded')` and `('failed')` from `bookings`).
- Add the corresponding tabs/filters in the Payments UI ([components/RefundsCancellations.tsx](components/RefundsCancellations.tsx)) so all five states are visible in one place, including an "all" view.

---

## 11. Session notes submission fails with HTTP 500

**Understood:** Submitting session notes returns 500.

**Root cause:** [POST /api/session-notes](panel-backend/src/index.ts#L5073) inserts into `client_session_notes (booking_id, therapist_id, notes)` and updates `updated_at`, then writes an `audit_logs` row. A 500 here is almost always a **DB schema mismatch** — a missing/NOT-NULL column (e.g., `updated_at`, `note_id`, `therapist_id` type), or the `audit_logs` insert failing on a constraint. The generic `catch` returns 500 ([5110-5113](panel-backend/src/index.ts#L5110-L5113)).

**Fix:**
- Reproduce and read the server log line `Error saving session notes:` to get the exact Postgres error, then align the SQL to the actual `client_session_notes` schema (add `updated_at` default / correct column names / cast `therapist_id`).
- Make the `audit_logs` write non-fatal (wrap in its own try/catch) so logging failures don't 500 the note save.
- Confirm the frontend ([SessionNotesForm.tsx](components/SessionNotesForm.tsx)) sends all required fields (`booking_id`, `therapist_id`, `notes`).

> Needs one live run against the DB to capture the exact error before finalizing the column fix.

---

## 12. "View session notes" button broken; client name click in therapist dashboard

**Understood:** In the therapist dashboard, the **View session notes** button does nothing, and clicking a client's name from **My Bookings** does not open the client profile.

**Root cause (two parts):**
- Client-name click handler in [TherapistDashboard.tsx](components/TherapistDashboard.tsx) is tied to the same client-search rendering that throws on null fields (see **#15**) — when the list/search state errors, the click handlers don't wire up. Also the profile open likely depends on `client_email`/`client_name` which can be null.
- "View session notes" handler either points at a route/modal that isn't mounted or calls [GET /api/session-notes](panel-backend/src/index.ts#L4915) / [/api/session-notes-info](panel-backend/src/index.ts#L4968) without the expected params.

**Fix:**
- Null-guard the client fields (shared with #15) so the list and its click handlers render.
- Wire the View-notes button to the existing notes fetch + modal/page ([SessionNotesPage.tsx](components/SessionNotesPage.tsx)), passing the correct `booking_id`/`therapist_id`, and verify the GET endpoint returns data.

> Will confirm the exact handler wiring while implementing #15, since they share the same component state.

---

## 13. Enable masked email end-to-end

**Understood:** Every Google Calendar event must use a **masked** email; automation emails go to the **real** email; admin dashboard shows the **real** email; masked↔real mapping stored in `masked_emails`, real email stored in `bookings`.

**Current state:** The plumbing largely exists:
- `INSERT INTO masked_emails (real_email) ... RETURNING id, masked_email` then the calendar event attendee + description use `maskedEmail` ([panel-backend/src/index.ts:6494-6501, 6579, 6589](panel-backend/src/index.ts#L6494-L6501)); confirmation email goes to the real `payload.clientEmail` ([6667](panel-backend/src/index.ts#L6667)); `mask_id` and real `invitee_email` are stored on the booking ([6641, 6657](panel-backend/src/index.ts#L6641)).

**Root cause / risk:** The INSERT supplies only `real_email` and relies on `masked_email` being auto-generated by the DB (default/trigger/generated column). If that generator is missing, `masked_email` is `null`, so the calendar attendee becomes null and "masking" silently no-ops. The `ON CONFLICT (real_email)` path also returns the existing masked value — fine, but only if generation works.

**Fix:**
- Verify the `masked_emails` table actually generates a unique masked alias (e.g., `xxxx@mask.safestories.in`). If not, generate it in app code at insert time and store it.
- Assert masked email is non-null before creating the calendar event; fall back safely and log if masking fails.
- Confirm admin dashboard reads real `invitee_email` (it does) and that no admin view leaks the masked alias.
- Apply the same masking in the **pending-booking** path ([6759](panel-backend/src/index.ts#L6759)) and any other calendar-event creation site.

---

## 14. Cancellation email + WhatsApp not triggered for admin-created bookings

**Understood:** Cancelling a booking created from the admin "Create New Booking" flow doesn't fire the email/WhatsApp notifications.

**Root cause:** There are **two** cancel endpoints:
- [POST /api/cancel-booking](panel-backend/src/index.ts#L3126) — full flow: deletes the Google event, initiates refund, **and sends WhatsApp/email** when `notify !== false` ([3229-3245](panel-backend/src/index.ts#L3229-L3245)).
- [POST /api/bookings/cancel](panel-backend/src/index.ts#L5117) — only flips `booking_status` to cancelled and writes an audit log; **no email/WhatsApp, no calendar delete, no refund.**

Admin UI cancels call `/api/cancel-booking` ([Dashboard.tsx:1079](components/Dashboard.tsx#L1079), [Appointments.tsx:376](components/Appointments.tsx#L376)), which *should* notify. So the failure is one of:
1. The admin path passes `notify: false`, suppressing messages, or
2. Admin-created bookings lack the fields the notification helpers need (e.g., real email is fine, but WhatsApp needs a valid `invitee_phone`/template params), causing the send to throw and be swallowed.

**Fix:**
- Confirm which endpoint the admin cancel actually hits and that `notify` is not false.
- Ensure admin-created bookings store the data the cancel notifications require (phone in correct format, real email, session time).
- Make `/api/bookings/cancel` either delegate to the same notification logic or be retired in favor of `/api/cancel-booking` so cancellation behavior is consistent.
- Log send results to `automation_logs` (as create-booking already does) to make failures visible.

> Will confirm the exact admin cancel call + payload during implementation.

---

## 15. Crash: "Cannot read properties of null (reading 'toLowerCase')" in therapist dashboard client search

**Understood:** Clicking the **All Clients** search bar in the therapist dashboard crashes the whole app.

**Root cause (confirmed):** [TherapistDashboard.tsx:1370-1375](components/TherapistDashboard.tsx#L1370-L1375):
```js
client.client_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
client.client_email.toLowerCase().includes(searchTerm.toLowerCase()) ||
client.client_phone.includes(searchTerm)
```
When any client has a `null` `client_name`, `client_email`, or `client_phone`, `.toLowerCase()/.includes()` throws, and because it's in render, the ErrorBoundary shows the "Application Crashed" screen. The same unsafe access pattern repeats at lines 2024-2026, 2212-2214.

**Fix:**
- Null-guard every field access: `(client.client_name || '').toLowerCase()`, same for email/phone, and at the other search sites (2024-2026, 2212-2214).
- This single fix also unblocks the client list rendering needed for **#12** (client-name click + view notes).

---

## Suggested implementation order

1. **#15** (crash) + **#12** (shared component) — unblocks the therapist dashboard.
2. **#4** (sidebar highlight) — small, isolated.
3. **#2** (mobile gating) — isolated routing change.
4. **#6** + **#1** (mode plumbing) — related; do together.
5. **#11** (session-notes 500) — needs a live DB error capture.
6. **#3** (double booking + conflict) — backend idempotency/conflict check.
7. **#9** + **#10** (payment data + payment statuses) — related payments work.
8. **#13** (masked email verification).
9. **#8** (contact reconciliation).
10. **#14** (cancellation notifications).

## Items needing a live run / DB inspection before final code
- **#11**: exact Postgres error for `client_session_notes` insert.
- **#13**: whether `masked_emails.masked_email` is auto-generated.
- **#14**: the precise admin cancel call + payload / `notify` flag.

> Note: there was no item **#5** in the original report; numbering is kept to match your list.
