import { getEmailConfig } from "./config";
import { logAttempt } from "./log";
import { parseMessage, type EmailMessage, type InvalidField } from "./message";

/**
 * Our own failure codes, each with whether a retry with the same key and message is safe. They
 * are not the provider's codes: the transport maps those to these.
 */
const RETRYABLE = {
  invalid_message: false,
  // Nothing was sent, so it is safe once the configuration is fixed.
  not_configured: true,
  // The outcome is unknown. The key is what stops a second email.
  timeout: true,
  network_error: true,
  rate_limited: true,
  provider_error: true,
  // An attempt with this key is still running.
  key_in_progress: true,
  // This key was used for a different message.
  key_conflict: false,
  rejected: false,
} as const;

export type SendError = keyof typeof RETRYABLE;

export type SendResult =
  | { ok: true; delivery: "log" }
  | { ok: true; delivery: "resend"; id?: string }
  | { ok: false; error: SendError; retryable: boolean; field?: InvalidField };

export type TransportRequest = {
  apiKey: string;
  idempotencyKey: string;
  email: { from: string; to: string; subject: string; html: string; text: string };
  signal: AbortSignal;
};

export type TransportResult =
  | { ok: true; id?: string; httpStatus?: number }
  | {
      ok: false;
      error: Exclude<SendError, "invalid_message" | "not_configured">;
      httpStatus?: number;
    };

/** Makes one attempt. A throw counts as a network error, with an unknown outcome. */
export type Transport = (request: TransportRequest) => Promise<TransportResult>;

const TIMEOUT_MS = 10_000;

/** The deadline holds even if the transport ignores the signal, for example while reading a body. */
async function attempt(
  transport: Transport,
  request: Omit<TransportRequest, "signal">,
): Promise<TransportResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<TransportResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({ ok: false, error: "timeout" });
      controller.abort();
    }, TIMEOUT_MS);
  });
  try {
    return await Promise.race([transport({ ...request, signal: controller.signal }), deadline]);
  } catch {
    // The exception is never read: its message can hold the request.
    return { ok: false, error: "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

function parse(input: unknown): ReturnType<typeof parseMessage> {
  try {
    return parseMessage(input);
  } catch {
    return { ok: false, field: "message" };
  }
}

function read(input: unknown, key: keyof EmailMessage): unknown {
  try {
    return (input as Record<string, unknown> | null | undefined)?.[key];
  } catch {
    return undefined;
  }
}

/**
 * Sends one email and never throws. There is no retry loop: the caller retries a `retryable`
 * failure by calling again with the same message and key.
 */
export function createSender(transport: Transport) {
  return async function send(input: EmailMessage): Promise<SendResult> {
    const about = { kind: read(input, "kind"), referenceId: read(input, "referenceId") };

    const fail = (error: SendError, httpStatus?: number, field?: InvalidField): SendResult => {
      logAttempt({ ...about, outcome: "failed", error, httpStatus });
      return { ok: false, error, retryable: RETRYABLE[error], ...(field && { field }) };
    };

    const parsed = parse(input);
    if (!parsed.ok) return fail("invalid_message", undefined, parsed.field);

    const config = getEmailConfig();
    if (!config) return fail("not_configured");
    if (config.delivery === "log") {
      logAttempt({ ...about, outcome: "logged" });
      return { ok: true, delivery: "log" };
    }

    const { idempotencyKey, to, subject, html, text } = parsed.message;
    const result = await attempt(transport, {
      apiKey: config.apiKey,
      idempotencyKey,
      email: { from: config.from, to, subject, html, text },
    });
    if (!result.ok) return fail(result.error, result.httpStatus);

    logAttempt({ ...about, outcome: "sent", httpStatus: result.httpStatus });
    return { ok: true, delivery: "resend", id: result.id };
  };
}
