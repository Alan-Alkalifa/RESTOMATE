import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendEmail, type EmailMessage } from "./index";

// Dummy values. None may reach a log line or an error result.
const SEEDS = {
  to: "budi.santoso@example.com",
  token: "aW52aXRlLXRva2VuLWR1bW15",
  link: "https://app.restomate.test/invite/",
  subject: "Warung Kusuma invited you",
  apiKey: "re_dummy_secret_key",
  from: "no-reply@mail.restomate.test",
  key: "staff_invitation/55555555-5555-4555-8555-555555555555/1",
  providerMessage: `Invalid \`to\` field: budi.santoso@example.com`,
};

const message: EmailMessage = {
  kind: "staff_invitation",
  referenceId: "55555555-5555-4555-8555-555555555555",
  idempotencyKey: SEEDS.key,
  to: SEEDS.to,
  subject: SEEDS.subject,
  html: `<a href="${SEEDS.link}${SEEDS.token}">Join</a>`,
  text: `${SEEDS.link}${SEEDS.token}`,
};

type Call = { url: string; method?: string; headers: Record<string, string>; body: string };
let calls: Call[];
let answers: (() => Promise<Response>)[];
let logs: unknown[][];
let results: unknown[];

const json = (status: number, body: unknown) => () =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
const error = (status: number, name: string) =>
  json(status, { statusCode: status, name, message: SEEDS.providerMessage });
const sent = json(200, { id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" });

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("EMAIL_DELIVERY", "resend");
  vi.stubEnv("EMAIL_FROM", `Restomate <${SEEDS.from}>`);
  vi.stubEnv("RESEND_API_KEY", SEEDS.apiKey);
  calls = [];
  answers = [];
  results = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method,
      headers: { ...(init.headers as Record<string, string>) },
      body: init.body as string,
    });
    const next = answers.shift() ?? sent;
    return new Promise<Response>((resolve, reject) => {
      init.signal?.addEventListener("abort", () =>
        reject(new DOMException(`aborted ${SEEDS.to}`, "AbortError")),
      );
      next().then(resolve, reject);
    });
  });
  logs = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args));
  }
});

afterEach(() => {
  const written = JSON.stringify([logs, results]);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [name, value] of Object.entries(SEEDS)) {
    if (name === "key") continue;
    expect(written.includes(value), `${name} was logged or returned`).toBe(false);
  }
  expect(JSON.stringify(logs).includes(SEEDS.key), "key was logged").toBe(false);
});

async function send(input: EmailMessage = message) {
  const result = await sendEmail(input);
  results.push(result);
  return result;
}

describe("request", () => {
  it("posts one recipient with the key in the Idempotency-Key header", async () => {
    expect(await send()).toEqual({
      ok: true,
      delivery: "resend",
      id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794",
    });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe("https://api.resend.com/emails");
    expect(call.method).toBe("POST");
    expect(call.headers).toEqual({
      Authorization: `Bearer ${SEEDS.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": SEEDS.key,
    });
    expect(JSON.parse(call.body)).toEqual({
      from: `Restomate <${SEEDS.from}>`,
      to: [SEEDS.to],
      subject: SEEDS.subject,
      html: message.html,
      text: message.text,
    });
  });

  it("counts a 2xx without a readable body as sent", async () => {
    answers.push(() => Promise.resolve(new Response("not json", { status: 200 })));
    expect(await send()).toEqual({ ok: true, delivery: "resend" });
  });
});

describe("retry without a duplicate", () => {
  it.each([
    ["timeout", "timeout", () => new Promise<Response>(() => undefined)],
    [
      "network error",
      "network_error",
      () => Promise.reject(new TypeError(`fetch failed ${SEEDS.to}`)),
    ],
    ["429", "rate_limited", error(429, "rate_limit_exceeded")],
    ["quota 429", "rate_limited", error(429, "daily_quota_exceeded")],
    ["500", "provider_error", error(500, "application_error")],
    ["503", "provider_error", error(503, "service_unavailable")],
    [
      "502 without JSON",
      "provider_error",
      () => Promise.resolve(new Response("<html>", { status: 502 })),
    ],
    ["409 key in progress", "key_in_progress", error(409, "concurrent_idempotent_requests")],
    ["unknown 409", "provider_error", error(409, "resource_locked")],
  ] as const)("%s: retryable, same key and payload", async (_, code, first) => {
    vi.useFakeTimers();
    answers.push(first);

    const pending = send();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ ok: false, error: code, retryable: true });

    expect(await send({ ...message })).toMatchObject({ ok: true, delivery: "resend" });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[1].headers["Idempotency-Key"]).toBe(SEEDS.key);
  });

  it("a conflicting-key response is not retryable and is never resent", async () => {
    answers.push(error(409, "invalid_idempotent_request"));
    expect(await send()).toEqual({ ok: false, error: "key_conflict", retryable: false });
    expect(calls).toHaveLength(1);
  });

  it("a payload changed under the same key is refused by the stub as Resend would", async () => {
    // Plays Resend: the first body seen for a key wins, a different body is a conflict.
    const seen = new Map<string, string>();
    let delivered = 0;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const key = (init.headers as Record<string, string>)["Idempotency-Key"];
      const body = init.body as string;
      if (!seen.has(key)) {
        seen.set(key, body);
        delivered++;
        throw new TypeError("socket hang up");
      }
      if (seen.get(key) !== body) return error(409, "invalid_idempotent_request")();
      return sent();
    });

    expect(await send()).toMatchObject({ ok: false, retryable: true });
    expect(await send({ ...message, subject: "Changed" })).toMatchObject({
      error: "key_conflict",
      retryable: false,
    });
    expect(await send()).toMatchObject({ ok: true });
    expect(delivered).toBe(1);
  });
});

describe("rejected", () => {
  it.each([
    [400, "validation_error"],
    [401, "missing_api_key"],
    [403, "validation_error"],
    [422, "missing_required_field"],
  ])("%i %s is not retryable", async (status, name) => {
    answers.push(error(status, name));
    expect(await send()).toEqual({ ok: false, error: "rejected", retryable: false });
  });

  it("logs the status and our code, not the provider's text", async () => {
    answers.push(error(422, "validation_error"));
    await send();
    expect(logs.map(([line]) => JSON.parse(line as string))).toEqual([
      {
        event: "email",
        kind: "staff_invitation",
        referenceId: message.referenceId,
        outcome: "failed",
        error: "rejected",
        httpStatus: 422,
      },
    ]);
  });
});

describe("log mode", () => {
  it("never calls Resend", async () => {
    vi.stubEnv("EMAIL_DELIVERY", "log");
    expect(await send()).toEqual({ ok: true, delivery: "log" });
    expect(calls).toHaveLength(0);
  });
});
