/**
 * Deadlines for Supabase network calls. supabase-js retries a failed Auth call with back-off for
 * about 30 seconds, and the server and admin clients had no timeout at all, so one outage would
 * stall every request that touches Supabase. The two kinds of call need different rules:
 *
 *  - Auth (`/auth/v1/...`): short, `SUPABASE_DEADLINE_MS` (2.5 s). The first timeout or network
 *    failure aborts every other Auth call on that client, which ends supabase-js's retries so they
 *    fail at once instead of backing off. `run()` also bounds a whole Auth operation (for example
 *    `auth.getClaims()` with its refresh) and says which way it ended.
 *  - Everything else (`/rest/v1`, `/storage/v1`, `/functions/v1`): a per-call timeout only,
 *    `DATA_DEADLINE_MS` (10 s, overridable per guard). A slow report or export is not an outage:
 *    nothing else on the client is aborted, and a call under the limit is never cut short.
 *
 * A guard belongs to ONE client (create the client and its guard together, per request).
 * No error text or value is logged or kept here; the caller logs a code if it wants one.
 */

export const SUPABASE_DEADLINE_MS = 2500;
export const DATA_DEADLINE_MS = 10_000;

export type GuardOutcome<T> = { status: "done"; value: T } | { status: "timeout" | "failed" };

export type DeadlineGuard = {
  /** Pass as `global.fetch` to a Supabase client. */
  fetch: typeof fetch;
  run<T>(operation: () => Promise<T>): Promise<GuardOutcome<T>>;
};

export type GuardOptions = {
  /** Auth call and `run()` deadline. Default `SUPABASE_DEADLINE_MS`. */
  authMs?: number;
  /** Per-call deadline for database, storage and function calls. Default `DATA_DEADLINE_MS`. */
  dataMs?: number;
};

const isAuthCall = (input: Parameters<typeof fetch>[0]): boolean => {
  try {
    const raw = typeof input === "string" || input instanceof URL ? input : input.url;
    return new URL(raw).pathname.startsWith("/auth/v1/");
  } catch {
    return false; // not a URL we can read: treated as data, which never aborts anything else
  }
};

export function createDeadlineGuard(options: GuardOptions = {}): DeadlineGuard {
  const authMs = options.authMs ?? SUPABASE_DEADLINE_MS;
  const dataMs = options.dataMs ?? DATA_DEADLINE_MS;
  const authController = new AbortController(); // ends every Auth call on this client
  let timedOut = false;
  let markFailed: () => void = () => {};
  const failed = new Promise<void>((resolve) => {
    markFailed = resolve;
  });
  const stopAuth = () => {
    timedOut = true;
    authController.abort();
  };

  const guardedFetch: typeof fetch = async (input, init) => {
    if (!isAuthCall(input)) {
      // Data: this call only. A timeout or failure here says nothing about the rest.
      const call = new AbortController();
      const timer = setTimeout(() => call.abort(), dataMs);
      try {
        return await fetch(input, {
          ...init,
          signal: init?.signal ? AbortSignal.any([init.signal, call.signal]) : call.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    }

    const timer = setTimeout(stopAuth, authMs);
    try {
      return await fetch(input, {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([init.signal, authController.signal])
          : authController.signal,
      });
    } catch (error) {
      // A network failure or an abort: no other Auth call on this client may retry or wait.
      authController.abort();
      markFailed();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  async function run<T>(operation: () => Promise<T>): Promise<GuardOutcome<T>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The deadline timer is set first, so a call that times out at the same moment reads as
    // a timeout and not as a network failure.
    const deadline = new Promise<GuardOutcome<T>>((resolve) => {
      timer = setTimeout(() => {
        stopAuth();
        resolve({ status: "timeout" });
      }, authMs);
    });
    const attempt = operation().then((value): GuardOutcome<T> => ({ status: "done", value }));
    attempt.catch(() => {}); // If the race is lost, a later rejection is not unhandled.
    try {
      return await Promise.race([
        attempt,
        deadline,
        failed.then((): GuardOutcome<T> => ({ status: timedOut ? "timeout" : "failed" })),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  return { fetch: guardedFetch, run };
}
