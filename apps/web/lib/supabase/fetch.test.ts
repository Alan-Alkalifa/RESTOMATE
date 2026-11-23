import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DATA_DEADLINE_MS, SUPABASE_DEADLINE_MS, createDeadlineGuard } from "./fetch";

const AUTH = "https://abcdefgh.supabase.co/auth/v1/token?grant_type=refresh_token";
const DATA = "https://abcdefgh.supabase.co/rest/v1/orders?select=id";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** A fetch that answers after `ms`, or never, and rejects when its signal aborts. */
function stubFetch(answerAfter: (url: string) => number | null) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const ms = answerAfter(url);
    return new Promise<Response>((resolve, reject) => {
      const abort = () => reject(new DOMException("aborted", "AbortError"));
      if (init?.signal?.aborted) return abort();
      init?.signal?.addEventListener("abort", abort);
      if (ms !== null) setTimeout(() => resolve(new Response(url)), ms);
    });
  });
  return calls;
}

describe("Auth calls: short deadline, and one failure ends the rest", () => {
  it("aborts a call that never answers at 2.5 s", async () => {
    vi.useFakeTimers();
    stubFetch(() => null);
    const result = createDeadlineGuard()
      .fetch(AUTH)
      .catch((e: Error) => e.name);
    await vi.advanceTimersByTimeAsync(SUPABASE_DEADLINE_MS - 1);
    let settled = false;
    void result.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe("AbortError");
  });

  it("after one Auth failure every later Auth call fails at once (ends retries), data calls do not", async () => {
    vi.useFakeTimers();
    const calls = stubFetch((url) => (url.includes("/rest/") ? 100 : null));
    const guard = createDeadlineGuard();
    const first = guard.fetch(AUTH).catch((e: Error) => e.name);
    await vi.advanceTimersByTimeAsync(SUPABASE_DEADLINE_MS);
    expect(await first).toBe("AbortError");

    await expect(guard.fetch(AUTH)).rejects.toMatchObject({ name: "AbortError" });
    const data = guard.fetch(DATA).then((r) => r.status);
    await vi.advanceTimersByTimeAsync(100);
    expect(await data).toBe(200);
    expect(calls.filter((u) => u.includes("/rest/"))).toHaveLength(1);
  });

  it("a network failure on Auth is reported by run() as failed, at once", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    const guard = createDeadlineGuard();
    const failing = guard.run(() => guard.fetch(AUTH));
    await vi.advanceTimersByTimeAsync(0);
    expect(await failing).toEqual({ status: "failed" });
  });

  it("run() reports a timeout without waiting for the operation, and a normal result as done", async () => {
    vi.useFakeTimers();
    const g1 = createDeadlineGuard();
    const slow = g1.run(() => new Promise<never>(() => {}));
    await vi.advanceTimersByTimeAsync(SUPABASE_DEADLINE_MS);
    expect(await slow).toEqual({ status: "timeout" });
    expect(await createDeadlineGuard().run(async () => 5)).toEqual({ status: "done", value: 5 });
  });

  it("leaves no unhandled rejection when the operation fails after the deadline", async () => {
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

describe("data calls: a long limit, and never abort anything else", () => {
  it("lets a 4 s query succeed", async () => {
    vi.useFakeTimers();
    stubFetch(() => 4000);
    const result = createDeadlineGuard()
      .fetch(DATA)
      .then((r) => r.status);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await result).toBe(200);
  });

  it("fails a hung query at 10 s and leaves a parallel one alone", async () => {
    vi.useFakeTimers();
    // The parallel query starts at 5 s and takes 6 s, so it is still running when the hung
    // one is aborted at 10 s, and finishes inside its own 10 s limit.
    stubFetch((url) => (url.includes("hung") ? null : 6000));
    const guard = createDeadlineGuard();
    const hung = guard.fetch(`${DATA}&hung=1`).catch((e: Error) => e.name);
    await vi.advanceTimersByTimeAsync(5000);
    const parallel = guard.fetch(`${DATA}&ok=1`).then((r) => r.status);

    await vi.advanceTimersByTimeAsync(DATA_DEADLINE_MS - 5000 - 1);
    let hungSettled = false;
    void hung.then(() => (hungSettled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(hungSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await hung).toBe("AbortError");

    await vi.advanceTimersByTimeAsync(1000); // t = 11 s: the parallel query answers
    expect(await parallel).toBe(200);
  });

  it("a data timeout does not touch Auth, and later data calls still work", async () => {
    vi.useFakeTimers();
    stubFetch((url) => (url.includes("hung") ? null : 10));
    const guard = createDeadlineGuard();
    const hung = guard.fetch(`${DATA}&hung=1`).catch((e: Error) => e.name);
    await vi.advanceTimersByTimeAsync(DATA_DEADLINE_MS);
    expect(await hung).toBe("AbortError");

    const auth = guard.fetch(AUTH).then((r) => r.status);
    const data = guard.fetch(DATA).then((r) => r.status);
    await vi.advanceTimersByTimeAsync(10);
    expect(await auth).toBe(200);
    expect(await data).toBe(200);
  });

  it("the data limit is overridable per guard", async () => {
    vi.useFakeTimers();
    stubFetch(() => null);
    const result = createDeadlineGuard({ dataMs: 30_000 })
      .fetch(DATA)
      .catch((e: Error) => e.name);
    await vi.advanceTimersByTimeAsync(29_999);
    let settled = false;
    void result.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe("AbortError");
  });

  it("treats storage and function calls as data", async () => {
    vi.useFakeTimers();
    stubFetch(() => 5000);
    const guard = createDeadlineGuard();
    const a = guard.fetch("https://abcdefgh.supabase.co/storage/v1/object/x").then((r) => r.status);
    const b = guard.fetch("https://abcdefgh.supabase.co/functions/v1/fn").then((r) => r.status);
    await vi.advanceTimersByTimeAsync(5000);
    expect([await a, await b]).toEqual([200, 200]);
  });
});

describe("the admin client gets the same split", () => {
  async function admin() {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefgh.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key-not-real");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key-not-real");
    const { createAdminClient } = await import("./admin");
    return createAdminClient();
  }
  const rows = () =>
    new Response("[]", { status: 200, headers: { "content-type": "application/json" } });

  it("a 4 s write succeeds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", () => new Promise<Response>((r) => setTimeout(() => r(rows()), 4000)));
    const query = (await admin())
      .from("platform_admins")
      .select("user_id")
      .then((r) => r);
    await vi.advanceTimersByTimeAsync(4000);
    const r = await query;
    expect(r.error).toBeNull();
  });

  it("a hung query errors at 10 s, not before", async () => {
    vi.useFakeTimers();
    stubFetch(() => null);
    let done = false;
    const query = (await admin())
      .from("platform_admins")
      .select("user_id")
      .maybeSingle()
      .then((r) => ((done = true), r));
    await vi.advanceTimersByTimeAsync(DATA_DEADLINE_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const r = await query;
    expect(r.data).toBeNull();
    expect(r.error).not.toBeNull();
  });
});
