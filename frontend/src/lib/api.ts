// Thin fetch wrapper for the backend API. Requests go to /api on the same
// origin (the Vite dev server proxies it, D20), with the Bearer token when
// logged in (D14).

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    // Per-field messages from a 400 validation error, keyed by field path.
    public readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

const TOKEN_KEY = "esep.token";

// localStorage can throw (private windows, blocked storage); the app still
// works, you just have to log in again next time.
export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

// Called when an authenticated request gets 401 (expired or revoked token).
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(init.body !== undefined && { "content-type": "application/json" }),
        ...(token && { authorization: `Bearer ${token}` }),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    const fields: Record<string, string> = {};
    for (const issue of data?.issues ?? []) fields[issue.path] ??= issue.message;
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, fields);
  }
  return data as T;
}

// Turns any thrown value into a sentence for the UI.
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Something went wrong. Please try again.";
}
