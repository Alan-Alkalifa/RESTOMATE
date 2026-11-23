import "server-only";
import { redirect } from "next/navigation";
import { protectAuth, type AuthPreset } from "../../arcjet/auth";
import { UNAVAILABLE, fail, getCurrentUser, isAuthOutage } from "../../auth";
import { createDeadlineGuard, type DeadlineGuard } from "../../supabase/fetch";
import { createClient } from "../../supabase/server";
import { createStatelessAuthClient } from "../../supabase/stateless";
import { fieldErrorsOf } from "./schemas";
import type { z } from "zod";

/** Parse with the shared schema first. A failure is `validation` with message keys per field. */
export function parseInput<S extends z.ZodType>(
  schema: S,
  raw: unknown,
): { ok: true; data: z.output<S> } | { ok: false; result: ReturnType<typeof fail> } {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, result: fail("validation", fieldErrorsOf(parsed.error)) };
}

/**
 * Abuse protection, before any Supabase call. `email` must already be a parsed string (or absent),
 * never raw input. Arcjet's refusals become result codes; nothing but the code is returned.
 */
export async function protect(
  preset: AuthPreset,
  email?: string,
): Promise<ReturnType<typeof fail> | null> {
  const verdict = await protectAuth(preset, email === undefined ? {} : { email });
  if (verdict.allowed) return null;
  switch (verdict.reason) {
    case "rate_limited":
      return fail("rate_limited");
    case "email_rejected":
      return fail("validation", { email: ["auth.email.rejected"] });
    default:
      return fail("forbidden"); // blocked as a bot or an attack
  }
}

/** Signed-in users skip the auth pages: send them where they were going. Outage: carry on. */
export async function skipIfSignedIn(destination: string): Promise<void> {
  const user = await getCurrentUser();
  if (user && user !== UNAVAILABLE) redirect(destination);
}

/** One Supabase Auth client with one deadline for the whole operation. */
export async function authClient(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  guard: DeadlineGuard;
}> {
  const guard = createDeadlineGuard();
  return { supabase: await createClient(guard), guard };
}

/**
 * `guard.run`, but a call that throws (instead of returning an error, as supabase-js normally
 * does) is a failure too, never an unhandled error.
 */
export async function runAuth<T>(guard: DeadlineGuard, operation: () => Promise<T>) {
  try {
    return await guard.run(operation);
  } catch {
    return { status: "failed" } as const;
  }
}

/**
 * A cookie-free Auth client (`createStatelessAuthClient`) with its own deadline, for signup and the
 * reset request: no Set-Cookie differs between a new and an existing address.
 */
export function statelessAuthClient() {
  const guard = createDeadlineGuard();
  return { supabase: createStatelessAuthClient(guard), guard };
}

type AuthErrorLike = { code?: unknown; name?: unknown; status?: unknown };

/**
 * A Supabase Auth error as an action result: a stable code and message keys, never the library's
 * text. Login never says which half of the credentials was wrong.
 */
export function authErrorResult(error: unknown): ReturnType<typeof fail> {
  if (isAuthOutage(error)) return fail("unavailable");
  const { code, name } = (error ?? {}) as AuthErrorLike;
  switch (code) {
    case "invalid_credentials":
      return fail("invalid_credentials");
    case "email_not_confirmed":
      return fail("email_not_confirmed");
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
    case "over_sms_send_rate_limit":
      return fail("rate_limited");
    case "weak_password":
      return fail("validation", { password: ["auth.password.weak"] });
    case "same_password":
      return fail("validation", { password: ["auth.password.same_as_old"] });
    case "email_address_invalid":
    case "validation_failed":
      return fail("validation", { email: ["auth.email.invalid"] });
    case "otp_expired":
    case "flow_state_not_found":
    case "flow_state_expired":
      return fail("invalid_token");
    case "session_not_found":
    case "refresh_token_not_found":
    case "no_authorization":
    case "bad_jwt":
      return fail("unauthenticated");
    case "user_banned":
    case "signup_disabled":
    case "email_provider_disabled":
      return fail("forbidden");
  }
  if (name === "AuthSessionMissingError") return fail("unauthenticated");
  return fail("unknown");
}
