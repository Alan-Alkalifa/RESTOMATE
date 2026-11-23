import { z } from "zod";
import { TOKEN_PATTERN } from "./tokens";

/**
 * Shared Zod schemas for the staff forms (client and server). Messages are stable keys only.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (key: string) => z.string({ error: key }).regex(UUID, { error: key });

/** The same rule as the `staff_invitations.email` check: trimmed, lower-cased, one address. */
const email = z
  .string({ error: "staff.field.required" })
  .trim()
  .toLowerCase()
  .min(1, { error: "staff.field.required" })
  .max(254, { abort: true, error: "staff.email.invalid" })
  .refine((v) => (v.split("@")[0] ?? "").length <= 64, {
    abort: true,
    error: "staff.email.invalid",
  })
  .pipe(z.email({ error: "staff.email.invalid" }));

/** A checkbox sends "on" (or nothing); a JSON caller sends a boolean. */
const checkbox = z.preprocess(
  (v) =>
    v === "on" || v === "true" ? true : v === "false" || v === undefined || v === "" ? false : v,
  z.boolean({ error: "staff.field.invalid" }),
);

/** A list of location IDs: an array, or FormData's repeated `locationIds` fields. */
const locationIds = z.array(id("staff.locations.invalid")).max(200).default([]);

export const orgIdSchema = id("staff.org.invalid");

export const inviteSchema = z
  .object({
    orgId: orgIdSchema,
    email,
    roleId: id("staff.role.invalid"),
    allLocations: checkbox,
    locationIds,
  })
  .refine((v) => v.allLocations || v.locationIds.length > 0, {
    path: ["locationIds"],
    error: "staff.locations.required",
  })
  .refine((v) => !(v.allLocations && v.locationIds.length > 0), {
    path: ["locationIds"],
    error: "staff.locations.invalid",
  });

export const invitationRefSchema = z.object({
  orgId: orgIdSchema,
  invitationId: id("staff.invitation.invalid"),
});
export const memberRefSchema = z.object({
  orgId: orgIdSchema,
  memberId: id("staff.member.invalid"),
});
export const changeRoleSchema = memberRefSchema.extend({ roleId: id("staff.role.invalid") });
export const setLocationsSchema = memberRefSchema.extend({ locationIds });
export const acceptSchema = z.object({
  token: z
    .string({ error: "staff.invitation.invalid" })
    .regex(TOKEN_PATTERN, { error: "staff.invitation.invalid" }),
});

/** FormData or a plain object as a plain object. `locationIds` keeps every repeated value. */
export function readInput(raw: unknown): Record<string, unknown> {
  if (raw instanceof FormData) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of raw.entries()) {
      if (typeof value !== "string") continue;
      if (key !== "locationIds") {
        out[key] = value;
        continue;
      }
      const list = (out.locationIds as string[] | undefined) ?? [];
      list.push(value);
      out.locationIds = list;
    }
    return out;
  }
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

export function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    const key = issue.message.startsWith("staff.") ? issue.message : "staff.field.invalid";
    const list = (out[field] ??= []);
    if (!list.includes(key)) list.push(key);
  }
  return out;
}
