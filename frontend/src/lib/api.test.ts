import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

// A 200 response whose body fails to read with the given error.
function respondWith(bodyError: Error) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: () => Promise.reject(bodyError) }) as unknown as Response),
  );
}

describe("api()", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects as an abort when the request is cancelled while the body is being read", async () => {
    // Used to resolve with null, which useApi then stored as a successful result.
    respondWith(new DOMException("The operation was aborted.", "AbortError"));
    await expect(api("/anything")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("still treats an unreadable body on success as empty", async () => {
    respondWith(new SyntaxError("Unexpected end of JSON input"));
    await expect(api("/anything")).resolves.toBeNull();
  });
});
