import { z } from "zod";

/** Every kind of email the app sends. A module adds its own kind here. */
export const EMAIL_KINDS = ["staff_invitation"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export type EmailMessage = {
  kind: EmailKind;
  /** The row this email is about, such as the invitation. It is logged: an ID, never a token. */
  referenceId: string;
  /** The same for every attempt of one email, and new for a deliberate resend. Never logged. */
  idempotencyKey: string;
  /** One bare address. */
  to: string;
  subject: string;
  html: string;
  text: string;
};

/** RFC 5321: the local part (before the last "@") is at most 64 octets. Resend refuses longer. */
export const LOCAL_PART_MAX = 64;

// The length limits come first: Zod's email pattern backtracks, and Zod stops at a failed
// `abort` check. The local part is checked in bytes, so a non-ASCII address can't slip past.
const address = z
  .string()
  .max(254, { abort: true })
  .refine(
    (v) =>
      new TextEncoder().encode(v.slice(0, Math.max(0, v.lastIndexOf("@")))).length <=
      LOCAL_PART_MAX,
    {
      abort: true,
    },
  )
  .pipe(z.email());

const schema = z.object({
  kind: z.enum(EMAIL_KINDS),
  referenceId: z.guid(),
  // Printable ASCII without spaces, because it travels in a header.
  idempotencyKey: z
    .string()
    .min(1)
    .max(256, { abort: true })
    .regex(/^[!-~]+$/),
  to: address,
  // A line break in a subject could add headers.
  subject: z
    .string()
    .min(1)
    .max(998, { abort: true })
    .regex(/^[^\p{Cc}\u2028\u2029]+$/u),
  html: z.string().min(1),
  text: z.string().min(1),
});

export type InvalidField = keyof EmailMessage | "message";

/** Returns a copy with known fields only, or the name of the first bad field. Never its value. */
export function parseMessage(
  input: unknown,
): { ok: true; message: EmailMessage } | { ok: false; field: InvalidField } {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, message: parsed.data };
  const field = parsed.error.issues[0]?.path[0] as InvalidField | undefined;
  return { ok: false, field: field ?? "message" };
}
