/**
 * Attaches the auth token to every same-origin /api request.
 *
 * The app makes several hundred bare `fetch('/api/...')` calls across components.
 * Patching fetch once here means none of them need to change, and any new call
 * site is covered automatically rather than silently unauthenticated.
 */

const TOKEN_KEY = 'authToken';

export const getToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const setToken = (token: string): void => {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable (private mode) — requests will 401 and bounce to login */
  }
};

export const clearToken = (): void => {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
};

/** True for requests aimed at our own API, which are the only ones we may attach a token to. */
const isOwnApiRequest = (url: string): boolean => {
  if (url.startsWith('/api/')) return true;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/');
  } catch {
    return false;
  }
};

let installed = false;

export function installAuthFetch(): void {
  if (installed) return;
  installed = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input
      : input instanceof URL ? input.toString()
      : input.url;

    // Never leak the token to third-party hosts (Razorpay, MinIO, AiSensy…).
    if (!isOwnApiRequest(url)) return nativeFetch(input as any, init);

    const token = getToken();
    if (token) {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      // Don't clobber a caller that set its own Authorization header.
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
      init = { ...init, headers };
    }

    const response = await nativeFetch(input as any, init);

    // An expired or invalid token means the stored session is dead. Clear it and
    // send the user to login rather than letting the UI render empty error states.
    if (response.status === 401) {
      clearToken();
      try {
        localStorage.removeItem('user');
        localStorage.removeItem('isLoggedIn');
      } catch {
        /* ignore */
      }
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign('/login');
      }
    }

    return response;
  };
}
