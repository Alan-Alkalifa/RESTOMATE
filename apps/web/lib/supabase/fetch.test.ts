import { afterEach, describe, expect, it, vi } from "vitest";
import { SUPABASE_DEADLINE_MS, createDeadlineGuard } from "./fetch";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("deadline guard", () => {
  it("aborts a call that never answers at the deadline", async () => {
    vi.useFakeTimers();
    let aborted = false;
    vi.stubGlobal(
      "fetch",
      (_u: unknown, init?: RequestInit) =>
        new Promise((_res, rej) =>
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            rej(new DOMException("aborted", "AbortError"));
          }),
        ),
    );
    const { fetch: guarded } = createDeadlineGuard();
    const result = guarded("https://x.test/").catch((e: Error) => e.name);
    await vi.advanceTimersByTimeAsync(SUPABASE_DEADLINE_MS - 1);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(aborted).toBe(true);
    expect(await result).toBe("AbortError");
  });

  it("passes a normal response straight through", async () => {
    vi.stubGlobal("fetch", async () => new Response("ok"));
    const guard = createDeadlineGuard();
    expect(await (await guard.fetch("https://x.test/")).text()).toBe("ok");
    expect(await guard.run(async () => 5)).toEqual({ status: "done", value: 5 });
  });

  it("after one failure, every later call on the client fails at once (ends retries)", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", async (u: string, init: RequestInit) => {
      if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return fetchMock(u, init);
    });
    const guard = createDeadlineGuard();
    await expect(guard.fetch("https://x.test/")).rejects.toThrow("fetch failed");
    await expect(guard.fetch("https://x.test/")).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("run() reports timeout and failed distinctly, and does not wait for the operation", async () => {
    vi.useFakeTimers();
    const g1 = createDeadlineGuard();
    const slow = g1.run(() => new Promise<never>(() => {}));
    await vi.advanceTimersByTimeAsync(SUPABASE_DEADLINE_MS);
    expect(await slow).toEqual({ status: "timeout" });

    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    const g2 = createDeadlineGuard();
    const failing = g2.run(() => g2.fetch("https://x.test/"));
    await vi.advanceTimersByTimeAsync(0);
    expect(await failing).toEqual({ status: "failed" });
  });

  it("run() does not leave an unhandled rejection when the operation fails after the deadline", async () => {
    vi.useFakeTimers();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const guard = createDeadlineGuard();
    let reject!: (e: Error) => void;
    const run = guard.run(() => new Promise<never>((_r, rej) => (reject = rej)));
    await vi.advanceTimersByTimeAsync(SUPABASE_DEADLINE_MS);
    expect((await run).status).toBe("timeout");
    reject(new Error("late"));
    await vi.advanceTimersByTimeAsync(10);
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe("admin and server clients use it", () => {
  it("the admin client gives up on a hung Supabase within the deadline", async () => {
    vi.mock("server-only", () => ({}));
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefgh.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key-not-real");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key-not-real");
    vi.stubGlobal(
      "fetch",
      (_u: unknown, init?: RequestInit) =>
        new Promise((_res, rej) =>
          init?.signal?.addEventListener("abort", () =>
            rej(new DOMException("aborted", "AbortError")),
          ),
        ),
    );
    const { createAdminClient } = await import("./admin");
    let done = false;
    const query = createAdminClient()
      .from("platform_admins")
      .select("user_id")
      .maybeSingle()
      .then((r) => ((done = true), r));
    await vi.advanceTimersByTimeAsync(SUPABASE_DEADLINE_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const r = await query;
    expect(r.data).toBeNull();
    expect(r.error).not.toBeNull();
    vi.unstubAllEnvs();
  });
});
