// Client helper for the session-notes autosave failsafe. Every call is best-effort:
// a failure here must never disrupt filling or submitting the form. Drafts are stored
// in an isolated table (session_notes_drafts) and never affect any other system.
const API = '/api/session-notes-draft';

// True when the therapist has actually entered something worth keeping.
// Keys that are auto-populated on mount (wizard step, auto-selected session type,
// today's signature date) don't count — otherwise merely OPENING a form would create
// a draft row and show a "draft in progress" card for a form nobody typed in.
export function hasDraftContent(formData: any, ignoreKeys: string[] = []): boolean {
  if (!formData || typeof formData !== 'object') return false;
  return Object.entries(formData).some(([key, v]) => {
    if (ignoreKeys.includes(key)) return false;
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') return v.trim() !== '';
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'boolean') return true;   // an explicit Yes/No choice is content
    if (typeof v === 'number') return true;
    return false;
  });
}

// Load a previously autosaved draft's form_data (or null if none / on any error).
export async function loadDraft(bookingId: string): Promise<any | null> {
  try {
    const r = await fetch(`${API}?booking_id=${encodeURIComponent(bookingId)}`);
    if (!r.ok) return null;
    const d = await r.json();
    return d?.draft?.form_data ?? null;
  } catch {
    return null;
  }
}

// Persist the current form state (debounce at the call site). Best-effort.
export async function saveDraft(bookingId: string, formType: string, formData: any): Promise<void> {
  try {
    await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id: bookingId, form_type: formType, form_data: formData }),
    });
  } catch {
    /* best-effort */
  }
}

// Fire-and-forget save that survives page unload (tab close / navigate away).
export function saveDraftBeacon(bookingId: string, formType: string, formData: any): void {
  try {
    const blob = new Blob(
      [JSON.stringify({ booking_id: bookingId, form_type: formType, form_data: formData })],
      { type: 'application/json' }
    );
    navigator.sendBeacon(API, blob);
  } catch {
    /* best-effort */
  }
}

// Remove the draft (called after a successful submit; the server also deletes it).
export async function deleteDraft(bookingId: string): Promise<void> {
  try {
    await fetch(`${API}?booking_id=${encodeURIComponent(bookingId)}`, { method: 'DELETE' });
  } catch {
    /* best-effort */
  }
}
