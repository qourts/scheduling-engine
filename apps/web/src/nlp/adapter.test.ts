import { describe, expect, it, vi } from "vitest";
import { aiStatus } from "./adapter.js";

describe("AI interpreter status", () => {
  it("makes no request at all and reports unavailable when switched off for the static hosted build", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await aiStatus(fetchImpl, true)).toEqual({ available: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats a missing backend (404 page from static hosting) as unavailable", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>Not found</html>", { status: 404 })) as unknown as typeof fetch;
    expect(await aiStatus(fetchImpl, false)).toEqual({ available: false });
  });

  it("treats a network failure or a non-JSON answer as unavailable, never as an error", async () => {
    expect(await aiStatus((async () => { throw new Error("offline"); }) as unknown as typeof fetch, false)).toEqual({ available: false });
    expect(await aiStatus((async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch, false)).toEqual({ available: false });
  });

  it("is available only when the backend says so explicitly", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ available: true }), { status: 200 })) as unknown as typeof fetch;
    expect(await aiStatus(ok, false)).toEqual({ available: true });
  });
});
