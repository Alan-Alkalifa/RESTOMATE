import { z } from "zod";
import { PERMISSION_KEYS, UUID } from "../../auth/keys";

/**
 * The one set of Zod schemas for custom roles (M0-BE-23), shared by the form and the Server
 * Actions (no server-only import, no secret). Messages are stable keys, never text, and never echo
 * what the user typed.
 *
 * Role names are cleaned before they are checked or saved, so the database's unique-name rule
 * (`lower(name)` per org) sees the same name the user sees: NFKC-normalise, remove invisible
 * format characters (\p{Cf}: ZWJ/ZWNJ, word joiner U+2060, soft hyphen U+00AD, U+180E, ...), turn
 * every whitespace run into one space, trim, then 1 to 60 characters. So `Owner` + U+2060 and
 * `Owner  ` are both `Owner`, and `A  B` is `A B`.
 */

export const ROLE_NAME_MAX = 60; // roles.name
export const ROLE_DESCRIPTION_MAX = 300; // roles.description

/** Characters, not UTF-16 units: the database counts code points. */
const length = (s: string) => [...s].length;

/** The cleaned form of a role name. Does not check the length. */
export function normalizeRoleName(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Control characters and lone surrogates are never part of a name or a description. */
const HAS_BAD_CHARS = /[\p{Cc}\p{Cs}]/u;

export const roleNameSchema = z
  .string({ error: "roles.name.required" })
  .transform(normalizeRoleName)
  .pipe(
    z
      .string()
      .refine((n) => n.length > 0, { error: "roles.name.required" })
      .refine((n) => length(n) <= ROLE_NAME_MAX, { error: "roles.name.too_long" })
      .refine((n) => !HAS_BAD_CHARS.test(n), { error: "roles.name.invalid" }),
  );

/** A description is trimmed; a blank one means "none". Whitespace inside is kept as typed. */
const descriptionText = z
  .string({ error: "roles.description.invalid" })
  .transform((d) => d.trim())
  .pipe(
    z
      .string()
      .refine((d) => length(d) <= ROLE_DESCRIPTION_MAX, { error: "roles.description.too_long" })
      .refine((d) => !/[\p{Cc}\p{Cs}]/u.test(d.replace(/[\n\r\t]/g, " ")), {
        error: "roles.description.invalid",
      }),
  );

const permissionKey = z.enum(PERMISSION_KEYS, { error: "roles.permissions.invalid" });
/** Distinct permission keys from the catalog. An empty list is a role that grants nothing. */
export const permissionsSchema = z
  .array(permissionKey, { error: "roles.permissions.invalid" })
  .transform((keys) => [...new Set(keys)]);

const keepOnNull = (v: unknown) => (v === null ? undefined : v);

const uuid = (error: string) => z.string({ error }).regex(UUID, { error });

/**
 * Which organization. The page knows it by its address (`orgSlug`) or by its ID (`orgId`); exactly
 * one of them is sent. Access is decided from the signed-in user's membership, never from this.
 */
const orgRef = {
  orgId: uuid("roles.org.invalid").optional(),
  orgSlug: z.string({ error: "roles.org.invalid" }).trim().min(1).max(64).optional(),
};
const exactlyOneOrg = (v: { orgId?: string; orgSlug?: string }) =>
  (v.orgId === undefined) !== (v.orgSlug === undefined);

export const createRoleSchema = z
  .object({
    ...orgRef,
    name: roleNameSchema,
    // Blank means none: there is nothing to clear on a new role.
    description: z.preprocess(
      (v) => (v === null ? undefined : v),
      descriptionText.optional().transform((d) => d || undefined),
    ),
    permissions: permissionsSchema.default([]),
  })
  .refine(exactlyOneOrg, { error: "roles.org.invalid", path: ["orgId"] });
export type CreateRoleInput = z.input<typeof createRoleSchema>;

/**
 * Update: an absent or null field keeps what the role has (the database's rule: null keeps). The
 * one exception: an empty description (`""`) clears it, and `permissions: []` removes them all.
 */
export const updateRoleSchema = z
  .object({
    ...orgRef,
    roleId: uuid("roles.role.invalid"),
    // null is the same as not sent: it keeps what the role has.
    name: z.preprocess(keepOnNull, roleNameSchema.optional()),
    description: z.preprocess(keepOnNull, descriptionText.optional()),
    permissions: z.preprocess(keepOnNull, permissionsSchema.optional()),
  })
  .refine(exactlyOneOrg, { error: "roles.org.invalid", path: ["orgId"] });
export type UpdateRoleInput = z.input<typeof updateRoleSchema>;

export const deleteRoleSchema = z
  .object({ ...orgRef, roleId: uuid("roles.role.invalid") })
  .refine(exactlyOneOrg, { error: "roles.org.invalid", path: ["orgId"] });
export type DeleteRoleInput = z.input<typeof deleteRoleSchema>;

/** The hidden field a role form adds, so "no box checked" can be told from "no list sent". */
export const PERMISSIONS_SUBMITTED = "permissions_submitted";

/**
 * Whatever the form sent (`FormData` or a plain object) as a plain object. Only fields that were
 * sent are present, so an absent field means "keep" on update.
 *
 * `permissions` from a form is every value of that field name (one checkbox each). A browser sends
 * nothing for unchecked boxes, so a form that cleared every box has no `permissions` field at all,
 * which would read as "keep". A form therefore adds a hidden `permissions_submitted` field: when
 * it is present, the permissions are exactly the checked values (`[]` when none are checked).
 * Without it, an absent `permissions` keeps (as before). Plain objects are unchanged: `[]` clears,
 * absent or null keeps.
 */
export function readRoleInput(raw: unknown): Record<string, unknown> {
  if (raw instanceof FormData) {
    const out: Record<string, unknown> = {};
    for (const key of new Set(raw.keys())) {
      const values = raw.getAll(key).filter((v): v is string => typeof v === "string");
      if (key === "permissions") out[key] = values;
      else if (key !== PERMISSIONS_SUBMITTED && values.length > 0)
        out[key] = values[values.length - 1];
    }
    if (raw.has(PERMISSIONS_SUBMITTED)) {
      out.permissions = raw.getAll("permissions").filter((v): v is string => typeof v === "string");
    }
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
    const key = issue.message.startsWith("roles.") ? issue.message : "roles.field.invalid";
    const list = (out[field] ??= []);
    if (!list.includes(key)) list.push(key);
  }
  return out;
}
