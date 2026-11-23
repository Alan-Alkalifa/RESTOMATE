import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EmailMessage } from "./message";
import {
  createSender,
  type Transport,
  type TransportRequest,
  type TransportResult,
} from "./sender";

// Dummy values. None may reach a log line.
const SEEDS = {
  to: "siti.rahayu@example.com",
  name: "Rahayu",
  phone: "6281234567890",
  token: "Zm9vYmFyLWludml0ZS10b2tlbg",
  link: "https://app.restomate.test/invite/",
  subject: "Warung Kusuma invited you",
  apiKey: "re_dummy_secret_key",
  from: "no-reply@mail.restomate.test",
  key: "invite-key-7f3a9c",
};

const message: EmailMessage = {
  kind: "staff_invitation",
  referenceId: "44444444-4444-4444-8444-444444444444",
  idempotencyKey: SEEDS.key,
  to: SEEDS.to,
  subject: SEEDS.subject,
  html: `<p>${SEEDS.name} ${SEEDS.phone} <a href="${SEEDS.link}${SEEDS.token}">Join</a></p>`,
  text: `${SEEDS.name} ${SEEDS.phone} ${SEEDS.link}${SEEDS.token}`,
};

let logs: unknown[][];

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("EMAIL_DELIVERY", "resend");
  vi.stubEnv("EMAIL_FROM", `Restomate <${SEEDS.from}>`);
  vi.stubEnv("RESEND_API_KEY", SEEDS.apiKey);
  // The sender must never reach the network by itself.
  vi.stubGlobal("fetch", () => {
    throw new Error("network used");
  });
  logs = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args));
  }
});

afterEach(() => {
  const written = JSON.stringify(logs);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [name, value] of Object.entries(SEEDS)) {
    expect(written.includes(value), `${name} was logged`).toBe(false);
  }
});

/** Plays the given results in order and records what it was asked to send. */
function stub(...results: (TransportResult | (() => Promise<TransportResult>))[]) {
  const requests: Omit<TransportRequest, "signal">[] = [];
  const transport: Transport = async ({ signal, ...request }) => {
    void signal;
    requests.push(structuredClone(request));
    const next = results.shift() ?? { ok: true, id: "email_1", httpStatus: 200 };
    return typeof next === "function" ? next() : next;
  };
  return { send: createSender(transport), requests };
}

const lines = () => logs.map(([line]) => JSON.parse(line as string));
const throws = () => Promise.reject(new TypeError(`failed ${SEEDS.to} ${SEEDS.apiKey}`));

describe("retry", () => {
  it.each([
    ["timeout", { ok: false, error: "timeout" }],
    ["network_error", throws],
    ["rate_limited", { ok: false, error: "rate_limited", httpStatus: 429 }],
    ["provider_error", { ok: false, error: "provider_error", httpStatus: 503 }],
    ["key_in_progress", { ok: false, error: "key_in_progress" }],
  ] as const)("%s is retryable, with the same key and payload", async (error, first) => {
    const { send, requests } = stub(first);

    expect(await send(message)).toEqual({ ok: false, error, retryable: true });
    expect(await send({ ...message })).toEqual({ ok: true, delivery: "resend", id: "email_1" });

    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1])).toBe(JSON.stringify(requests[0]));
    expect(requests[0].idempotencyKey).toBe(SEEDS.key);
  });

  it("sends one email when the first answer was lost", async () => {
    const delivered = new Map<string, string>();
    let calls = 0;
    const send = createSender(async ({ idempotencyKey, email }) => {
      if (!delivered.has(idempotencyKey)) delivered.set(idempotencyKey, JSON.stringify(email));
      if (++calls === 1) throw new Error("connection reset");
      return { ok: true, id: "email_1" };
    });

    expect(await send(message)).toMatchObject({ ok: false, retryable: true });
    expect(await send(message)).toMatchObject({ ok: true });
    expect(delivered.size).toBe(1);
  });

  it("builds the same payload whatever the order of the caller's fields", async () => {
    const { send, requests } = stub();
    await send(message);
    await send(Object.fromEntries(Object.entries(message).reverse()) as EmailMessage);
    expect(JSON.stringify(requests[1])).toBe(JSON.stringify(requests[0]));
  });

  it.each(["key_conflict", "rejected"] as const)("%s is not retryable", async (error) => {
    const { send } = stub({ ok: false, error });
    expect(await send(message)).toEqual({ ok: false, error, retryable: false });
  });

  it("makes one attempt per call", async () => {
    const { send, requests } = stub({ ok: false, error: "provider_error" });
    await send(message);
    expect(requests).toHaveLength(1);
  });
});

describe("timeout", () => {
  it("gives up after 10 seconds even if the transport ignores the signal", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const send = createSender((request) => {
      signal = request.signal;
      return new Promise(() => undefined);
    });

    let result: unknown;
    void send(message).then((value) => (result = value));
    await vi.advanceTimersByTimeAsync(9999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toEqual({ ok: false, error: "timeout", retryable: true });
    expect(signal?.aborted).toBe(true);
  });

  it("is a timeout, not a network error, when the transport rejects on abort", async () => {
    vi.useFakeTimers();
    const send = createSender(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const result = send(message);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toMatchObject({ error: "timeout" });
  });

  it("leaves no timer behind", async () => {
    vi.useFakeTimers();
    await stub().send(message);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("no send", () => {
  it.each([
    ["two recipients", [SEEDS.to, "b@example.com"]],
    ["a list", `${SEEDS.to},b@example.com`],
  ])("rejects %s", async (_, to) => {
    const { send, requests } = stub();
    expect(await send({ ...message, to: to as string })).toEqual({
      ok: false,
      error: "invalid_message",
      retryable: false,
      field: "to",
    });
    expect(requests).toHaveLength(0);
  });

  it("log mode sends nothing", async () => {
    vi.stubEnv("EMAIL_DELIVERY", "log");
    const { send, requests } = stub();
    expect(await send(message)).toEqual({ ok: true, delivery: "log" });
    expect(requests).toHaveLength(0);
    expect(lines()).toEqual([
      {
        event: "email",
        kind: "staff_invitation",
        referenceId: message.referenceId,
        outcome: "logged",
      },
    ]);
  });

  it("production never uses log mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_DELIVERY", "log");
    const { send, requests } = stub();
    expect(await send(message)).toEqual({ ok: false, error: "not_configured", retryable: true });
    expect(requests).toHaveLength(0);
  });

  it("survives hostile input", async () => {
    const { send, requests } = stub();
    const hostile = new Proxy(message, {
      get() {
        throw new Error(SEEDS.to);
      },
    });
    for (const input of [null, undefined, SEEDS.to, hostile]) {
      expect(await send(input as never)).toMatchObject({ ok: false, error: "invalid_message" });
    }
    expect(requests).toHaveLength(0);
  });
});

describe("log", () => {
  it("has one line per attempt, with kind, ID, code and status only", async () => {
    const { send } = stub({ ok: false, error: "rate_limited", httpStatus: 429 });
    await send(message);
    await send(message);

    const base = { event: "email", kind: "staff_invitation", referenceId: message.referenceId };
    expect(lines()).toEqual([
      { ...base, outcome: "failed", error: "rate_limited", httpStatus: 429 },
      { ...base, outcome: "sent", httpStatus: 200 },
    ]);
  });

  it("doesn't echo personal values put in kind or ID", async () => {
    await stub().send({ ...message, kind: SEEDS.to, referenceId: SEEDS.phone } as never);
    expect(lines()).toEqual([
      { event: "email", kind: "unknown", outcome: "failed", error: "invalid_message" },
    ]);
  });
});
