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

type Init = { method?: string; body?: unknown; signal?: AbortSignal };

// JSON in and out. A FormData body is sent as multipart instead (receipts, D36).
export async function api<T>(path: string, init: Init = {}): Promise<T> {
  const res = await send(path, init);
  // A cancelled request can also fail while the body is being read: that must
  // still reject as an abort, not look like a successful empty response.
  const data =
    res.status === 204
      ? null
      : await res.json().catch((err: Error) => {
          if (err.name === "AbortError") throw err;
          return null;
        });
  if (!res.ok) throw failure(res, data);
  return data as T;
}

// A file behind the API's auth, e.g. a receipt: it can't be a plain link,
// since the token travels in a header.
export async function apiBlob(path: string, init: Init = {}): Promise<Blob> {
  const res = await send(path, init);
  if (!res.ok) throw failure(res, await res.json().catch(() => null));
  return res.blob();
}

async function send(path: string, init: Init) {
  const token = tokenStore.get();
  const form = init.body instanceof FormData;
  try {
    return await fetch(`/api${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(init.body !== undefined && !form && { "content-type": "application/json" }),
        ...(token && { authorization: `Bearer ${token}` }),
      },
      body: form ? (init.body as FormData) : init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
}

function failure(res: Response, data: { error?: string; issues?: { path: string; message: string }[] } | null) {
  if (res.status === 401 && tokenStore.get()) onUnauthorized();
  const fields: Record<string, string> = {};
  for (const issue of data?.issues ?? []) fields[issue.path] ??= issue.message;
  return new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, fields);
}

// Turns any thrown value into a sentence for the UI.
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Something went wrong. Please try again.";
}
