/**
 * Start the Google Calendar consent flow.
 *
 * Two hops on purpose. The URL is FETCHED first — so lib/authFetch.ts can attach
 * the bearer token and the endpoint can stay authenticated — and only the last
 * hop, to accounts.google.com, is a page navigation.
 *
 * Pointing a Connect button straight at the API instead (`href="/api/auth/google"`)
 * is what used to break: a navigation carries no Authorization header, so it was
 * answered with 401 "Missing authentication token" and the browser rendered that
 * JSON in place of the app.
 *
 * Throws when the URL cannot be obtained, so the caller can say so in its own
 * idiom rather than leaving the button looking dead.
 */
export async function startGoogleCalendarConnect(
  therapistId: string,
  opts: { adminRedirect?: boolean } = {}
): Promise<void> {
  const params = new URLSearchParams({ therapistId: String(therapistId) });
  if (opts.adminRedirect) params.set('adminRedirect', 'true');

  // Where Google should drop the browser when it is finished. Sent explicitly
  // because this fetch is SAME-ORIGIN, and browsers omit the Origin header on
  // same-origin GETs — relying on that header left the server with nothing, so
  // consent completed and then bounced the user to the configured production
  // frontend instead of back to where they started. The server re-checks this
  // value against its allowlist, so naming an origin here grants nothing.
  params.set('returnTo', window.location.origin);

  const res = await fetch(`/api/auth/google/url?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Could not start Google sign-in (HTTP ${res.status})`);
  }

  const { authUrl } = await res.json();
  if (!authUrl) throw new Error('Google sign-in URL was missing from the response.');

  window.location.href = authUrl;
}
