import type { Transport, TransportResult } from "./sender";

// https://resend.com/docs/api-reference/emails/send-email
const ENDPOINT = "https://api.resend.com/emails";

/** Resend's error names on a 409. Every other status is mapped by its number alone. */
const CONFLICTS: Record<string, Extract<TransportResult, { ok: false }>["error"]> = {
  // Another request with this key is still running.
  concurrent_idempotent_requests: "key_in_progress",
  // This key was used with a different body in the last 24 hours.
  invalid_idempotent_request: "key_conflict",
};

/** Only the error name and the email ID are read. Message text can echo the request. */
async function readBody(response: Response): Promise<{ id?: unknown; name?: unknown }> {
  try {
    const body: unknown = await response.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

/**
 * One `POST /emails` with the `Idempotency-Key` header. The body is built from the same fields
 * in the same order on every attempt, so a retry is the same request to Resend.
 */
export const resendTransport: Transport = async ({ apiKey, idempotencyKey, email, signal }) => {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from: email.from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
      signal,
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: signal.aborted ? "timeout" : "network_error" };
  }

  const httpStatus = response.status;
  const body = await readBody(response);

  if (response.ok) {
    return { ok: true, httpStatus, ...(typeof body.id === "string" && { id: body.id }) };
  }
  if (httpStatus === 409) {
    const error = typeof body.name === "string" ? CONFLICTS[body.name] : undefined;
    // An unknown conflict is retried with the same key, which can't send twice.
    return { ok: false, error: error ?? "provider_error", httpStatus };
  }
  if (httpStatus === 429) return { ok: false, error: "rate_limited", httpStatus };
  if (httpStatus >= 500) return { ok: false, error: "provider_error", httpStatus };
  // 400, 401, 403, 404, 422: the request or the account is wrong. The same request fails again.
  return { ok: false, error: "rejected", httpStatus };
};
