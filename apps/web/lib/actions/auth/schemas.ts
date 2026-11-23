import { z } from "zod";
import { safeNextPath } from "../../auth/next";

/**
 * The one set of Zod schemas for the auth forms. The client form and the Server Action import
 * the same ones (this file has no server-only import and no secret). Every message is a stable
 * KEY, never text: the UI turns a key into English or Bahasa Indonesia, and no user value is ever
 * echoed back.
 */

export const EMAIL_MAX = 254;
export const PASSWORD_MIN = 8; // the same as `minimum_password_length` in supabase/config.toml
export const PASSWORD_MAX_BYTES = 72; // bcrypt ignores everything past 72 bytes
export const FULL_NAME_MAX = 120; // the `profiles.full_name` check
export const LOCALES = ["en", "id"] as const;

const required = { error: "auth.field.required" };

/** Trimmed, lower-cased, a single valid address. A blank value is "required", not "invalid". */
const email = z
  .string(required)
  .trim()
  .toLowerCase()
  .min(1, required)
  .max(EMAIL_MAX, { error: "auth.email.invalid" })
  .pipe(z.email({ error: "auth.email.invalid" }));

/** A password a user is choosing (signup, reset): the policy applies. */
const newPassword = z
  .string(required)
  .min(1, required)
  .min(PASSWORD_MIN, { error: "auth.password.too_short" })
  .refine((v) => new TextEncoder().encode(v).length <= PASSWORD_MAX_BYTES, {
    error: "auth.password.too_long",
  });

/** A password being checked (login): never judged by the policy, only bounded. */
const existingPassword = z
  .string(required)
  .min(1, required)
  .max(1024, { error: "auth.password.too_long" });

/** `next` is user input. It is always reduced to a same-site path (`safeNextPath`), never rejected. */
const next = z
  .unknown()
  .transform((value) => safeNextPath(value))
  .optional();

export const loginSchema = z.object({ email, password: existingPassword, next });
export type LoginInput = z.input<typeof loginSchema>;

export const signupSchema = z.object({
  email,
  password: newPassword,
  // Optional and never required: an empty or missing name is simply no name.
  fullName: z
    .string()
    .trim()
    .max(FULL_NAME_MAX, { error: "auth.full_name.too_long" })
    .optional()
    .transform((v) => (v ? v : undefined)),
  locale: z.enum(LOCALES).optional().catch(undefined),
  next,
});
export type SignupInput = z.input<typeof signupSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({ password: newPassword, confirmPassword: z.string(required) })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    error: "auth.password.mismatch",
  });
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;

/** Query of `/auth/confirm`, from the email link. */
export const CONFIRM_TYPES = ["signup", "email", "recovery", "email_change"] as const;
export const confirmQuerySchema = z.object({
  token_hash: z.string().min(8).max(512),
  type: z.enum(CONFIRM_TYPES),
  next,
});

/** Whatever the form sent (`FormData` or a plain object) as a plain object of its string fields. */
export function readInput(raw: unknown): Record<string, unknown> {
  if (raw instanceof FormData) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of raw.entries()) if (typeof value === "string") out[key] = value;
    return out;
  }
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/** Field name -> message keys. An unexpected Zod message becomes a generic key: no text, no value. */
export function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    const key = issue.message.startsWith("auth.") ? issue.message : "auth.field.invalid";
    const list = (out[field] ??= []);
    if (!list.includes(key)) list.push(key);
  }
  return out;
}
