/**
 * A deadline for Supabase network calls. supabase-js retries a failed Auth call with back-off for
 * about 30 seconds and the admin and server clients have no timeout at all, so one Supabase outage
 * would stall every request that touches it. This gives a client a short, shared deadline and ends
 * the retries.
 *
 * A guard belongs to ONE client (create the client and its guard together, per request). It:
 *  - sends every call with an abort signal, and aborts a call that takes longer than the deadline;
 *  - on the first timeout or network failure aborts everything else on that client, so supabase-js
 *    retries fail at once instead of backing off;
 *  - `run()` also bounds a whole operation (for example `auth.getClaims()` with its refresh) and
 *    says which way it ended, without waiting for a retry loop to finish.
 *
 * No error text or value is logged or kept here; the caller logs a code if it wants one.
 */

export const SUPABASE_DEADLINE_MS = 2500;

export type GuardOutcome<T> = { status: "done"; value: T } | { status: "timeout" | "failed" };

export type DeadlineGuard = {
  /** Pass as `global.fetch` to a Supabase client. */
  fetch: typeof fetch;
  run<T>(operation: () => Promise<T>): Promise<GuardOutcome<T>>;
};

export function createDeadlineGuard(deadlineMs: number = SUPABASE_DEADLINE_MS): DeadlineGuard {
  const controller = new AbortController();
  let timedOut = false;
  let markFailed: () => void = () => {};
  const failed = new Promise<void>((resolve) => {
    markFailed = resolve;
  });
  const stop = () => {
    timedOut = true;
    controller.abort();
  };

  const guardedFetch: typeof fetch = async (input, init) => {
    const timer = setTimeout(stop, deadlineMs);
    try {
      return await fetch(input, {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([init.signal, controller.signal])
          : controller.signal,
      });
    } catch (error) {
      // A network failure or an abort: nothing else on this client may retry or wait.
      controller.abort();
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
        stop();
        resolve({ status: "timeout" });
      }, deadlineMs);
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
