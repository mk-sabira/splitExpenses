import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

type Result<T> =
  | { status: "loading"; data?: undefined; error?: undefined }
  | { status: "ok"; data: T; error?: undefined }
  | { status: "error"; data?: undefined; error: unknown };

// Loads `path` on mount and whenever it changes. `reload()` fetches again
// while keeping the current data on screen; `set` replaces it locally.
export function useApi<T>(path: string | null) {
  const [result, setResult] = useState<Result<T>>({ status: "loading" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) return;
    const ctrl = new AbortController();
    api<T>(path, { signal: ctrl.signal })
      .then((data) => setResult({ status: "ok", data }))
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setResult({ status: "error", error });
      });
    return () => ctrl.abort();
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const set = useCallback((data: T) => setResult({ status: "ok", data }), []);
  return { ...result, reload, set };
}
