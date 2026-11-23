import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_REFRESH_DEADLINE_MS, updateSession } from "./session";

const REF = "abcdefgh";
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
// An expired session: reading it makes supabase-js call Auth to refresh it.
const expired = JSON.stringify({
  access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u", exp: 1, aud: "authenticated", role: "authenticated" })}.sig`,
  refresh_token: "refresh-token-not-real",
  expires_in: 3600,
  expires_at: 1,
  token_type: "bearer",
  user: { id: "u", aud: "authenticated" },
});

const makeRequest = () =>
  new NextRequest("https://app.restomate.app/app", {
    headers: { cookie: `sb-${REF}-auth-token=${encodeURIComponent(expired)}` },
  });

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${REF}.supabase.co`);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key-not-real");
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function expectUnchanged(res: Response, request: NextRequest) {
  expect(res.status).toBe(200);
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(request.cookies.get(`sb-${REF}-auth-token`)?.value).toBe(expired);
}

function expectQuietLogs(code: string) {
  const lines = [...warn.mock.calls, ...error.mock.calls].map((c) => c.map(String).join(" "));
  expect(lines).toEqual([JSON.stringify({ event: "session", code })]);
  for (const text of lines) {
    expect(text).not.toMatch(
      /AuthRetryableFetchError|\n\s+at |refresh-token|publishable|supabase\.co/,
    );
  }
}

describe("updateSession deadline", () => {
  it("returns within the deadline when Auth never answers, and stops the call", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const fetchMock = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = makeRequest();
    let done = false;
    const pending = updateSession(request, new Headers()).then((r) => {
      done = true;
      return r;
    });

    await vi.advanceTimersByTimeAsync(SESSION_REFRESH_DEADLINE_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;

    expect(done).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
    expect(aborted).toBe(true);
    expectUnchanged(res, request);
    expectQuietLogs("session_refresh_timeout");
  });

  it("still returns at the deadline when the fetch ignores the abort signal", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    const request = makeRequest();
    const pending = updateSession(request, new Headers());
    await vi.advanceTimersByTimeAsync(SESSION_REFRESH_DEADLINE_MS);
    expectUnchanged(await pending, request);
    expectQuietLogs("session_refresh_timeout");
  });

  it("returns at once when Auth is unreachable, without waiting out the back-off", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
    vi.stubGlobal("fetch", fetchMock);
    const request = makeRequest();
    let done = false;
    const pending = updateSession(request, new Headers()).then((r) => {
      done = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectUnchanged(await pending, request);
    // The retries supabase-js still has queued run out later and change nothing.
    await vi.advanceTimersByTimeAsync(60_000);
    expectUnchanged(await pending, request);
    expectQuietLogs("session_refresh_error");
  });

  it("does not touch the network without an auth cookie", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await updateSession(
      new NextRequest("https://app.restomate.app/app"),
      new Headers(),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
