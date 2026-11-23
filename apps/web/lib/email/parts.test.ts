import { afterEach, describe, expect, it, vi } from "vitest";

import { getEmailConfig } from "./config";
import { logAttempt } from "./log";
import { LOCAL_PART_MAX, parseMessage } from "./message";
import { createSender } from "./sender";

const valid = {
  kind: "staff_invitation",
  referenceId: "44444444-4444-4444-8444-444444444444",
  idempotencyKey: "staff_invitation/44444444-4444-4444-8444-444444444444/1",
  to: "siti.rahayu@example.com",
  subject: "You're invited",
  html: "<p>Join</p>",
  text: "Join",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("parseMessage", () => {
  it("accepts one bare address", () => {
    expect(parseMessage(valid)).toEqual({ ok: true, message: valid });
  });

  it("drops fields it doesn't know, like cc and bcc", () => {
    const input = {
      ...valid,
      cc: "b@example.com",
      bcc: "c@example.com",
      reply_to: "d@example.com",
    };
    expect(parseMessage(input)).toEqual({ ok: true, message: valid });
  });

  it.each([
    ["an array of one", ["a@example.com"]],
    ["an array of two", ["a@example.com", "b@example.com"]],
    ["a comma", "a@example.com,b@example.com"],
    ["a comma and space", "a@example.com, b@example.com"],
    ["a semicolon", "a@example.com;b@example.com"],
    ["a space", "a@example.com b@example.com"],
    ["a line break", "a@example.com\nb@example.com"],
    ["a header", "a@example.com\r\nBcc: b@example.com"],
    ["a trailing line break", "a@example.com\n"],
    ["a display name", "Siti <a@example.com>"],
    ["two in brackets", "<a@example.com><b@example.com>"],
    ["nothing", ""],
    ["too long", `${"a".repeat(250)}@example.com`],
  ])("rejects a recipient with %s", (_, to) => {
    expect(parseMessage({ ...valid, to })).toEqual({ ok: false, field: "to" });
  });

  it("caps the local part at 64 characters (RFC 5321)", () => {
    const at64 = `${"a".repeat(LOCAL_PART_MAX)}@example.com`;
    expect(parseMessage({ ...valid, to: at64 })).toEqual({
      ok: true,
      message: { ...valid, to: at64 },
    });
    for (const to of [
      `${"a".repeat(LOCAL_PART_MAX + 1)}@example.com`,
      `${"é".repeat(33)}@example.com`,
    ]) {
      expect(parseMessage({ ...valid, to })).toEqual({ ok: false, field: "to" });
    }
  });

  it("refuses a 65-character local part as invalid_message before any transport call", async () => {
    vi.stubEnv("EMAIL_FROM", "Restomate <noreply@example.com>");
    vi.stubEnv("EMAIL_DELIVERY", "resend");
    vi.stubEnv("RESEND_API_KEY", "re_not_real");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const transport = vi.fn();
    const send = createSender(transport);
    const result = await send({
      ...valid,
      kind: "staff_invitation",
      to: `${"a".repeat(65)}@example.com`,
    });
    expect(result).toMatchObject({
      ok: false,
      error: "invalid_message",
      retryable: false,
      field: "to",
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    ["kind", "newsletter"],
    ["referenceId", "siti.rahayu@example.com"],
    ["idempotencyKey", ""],
    ["idempotencyKey", "k".repeat(257)],
    ["idempotencyKey", "key\r\nX-Injected: 1"],
    ["idempotencyKey", "kunci–1"],
    ["subject", ""],
    ["subject", "Hi\r\nBcc: b@example.com"],
    ["subject", "Hi\u2028there"],
    ["html", ""],
    ["text", undefined],
  ])("rejects a bad %s: %j", (field, value) => {
    expect(parseMessage({ ...valid, [field]: value })).toEqual({ ok: false, field });
  });

  it.each([null, undefined, "text", 5])("rejects %j as a message", (input) => {
    expect(parseMessage(input)).toEqual({ ok: false, field: "message" });
  });

  it.each(["to", "subject", "idempotencyKey", "referenceId"])("is fast on a huge %s", (field) => {
    const value = `${"a.".repeat(250_000)}!\n`;
    const started = performance.now();
    expect(parseMessage({ ...valid, [field]: value })).toEqual({ ok: false, field });
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("logAttempt", () => {
  it("keeps kind, ID, outcome, code and status only", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logAttempt({ ...valid, outcome: "sent", httpStatus: 200 } as never);
    expect(JSON.parse(info.mock.calls[0][0])).toEqual({
      event: "email",
      kind: "staff_invitation",
      referenceId: valid.referenceId,
      outcome: "sent",
      httpStatus: 200,
    });
  });

  it("doesn't echo a bad kind or ID", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logAttempt({ kind: valid.to, referenceId: valid.to, outcome: "failed", error: "invalid" });
    expect(JSON.parse(error.mock.calls[0][0])).toEqual({
      event: "email",
      kind: "unknown",
      outcome: "failed",
      error: "invalid",
    });
  });
});

describe("getEmailConfig", () => {
  const env = (mode: string, node = "test", key = "re_dummy") => {
    vi.stubEnv("NODE_ENV", node);
    vi.stubEnv("EMAIL_DELIVERY", mode);
    vi.stubEnv("EMAIL_FROM", "Restomate <no-reply@mail.restomate.test>");
    vi.stubEnv("RESEND_API_KEY", key);
  };

  it.each(["development", "test"])("allows log mode in %s", (node) => {
    env("log", node);
    expect(getEmailConfig()).toEqual({ delivery: "log" });
  });

  it("never allows log mode in production", () => {
    env("log", "production");
    expect(getEmailConfig()).toBeUndefined();
  });

  it("gives the key and sender in resend mode", () => {
    env("resend", "production");
    expect(getEmailConfig()).toEqual({
      delivery: "resend",
      apiKey: "re_dummy",
      from: "Restomate <no-reply@mail.restomate.test>",
    });
  });

  it.each([
    ["no mode", "", "re_dummy"],
    ["a bad mode", "smtp", "re_dummy"],
    ["no key", "resend", ""],
  ])("is not configured with %s", (_, mode, key) => {
    env(mode, "development", key);
    expect(getEmailConfig()).toBeUndefined();
  });
});
