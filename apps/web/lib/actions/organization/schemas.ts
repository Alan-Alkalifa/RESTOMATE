import { z } from "zod";

/**
 * The one set of Zod schemas for creating a restaurant, shared by the form and the Server Action
 * (no server-only import, no secret). The rules are the database's own (`is_slug_available`,
 * `create_organization` and the table checks), so the form and the database never disagree.
 * Messages are stable keys, never text, and never echo what the user typed.
 */

export const SLUG_MIN = 3;
export const SLUG_MAX = 40;
/** As in the database: a-z, 0-9 and hyphens; starts and ends with a letter or digit. */
export const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])$/;
export const NAME_MAX = 120; // organizations.name, locations.name
export const ADDRESS_MAX = 500; // locations.address
export const BPS_MAX = 10_000; // 100.00%
export const DEFAULT_TIMEZONE = "Asia/Jakarta";

/** The reasons `is_slug_available` and `create_organization` give for a slug. */
export const SLUG_REASONS = ["SLUG_INVALID", "SLUG_RESERVED", "SLUG_TAKEN"] as const;
export type SlugReason = (typeof SLUG_REASONS)[number];

/**
 * The database's own normalization: `lower(btrim(slug))`. `btrim` strips spaces only, so a tab or
 * a line break stays in the slug and makes it invalid, exactly as `is_slug_available` answers.
 */
export function normalizeSlug(raw: string): string {
  return raw.replace(/^ +| +$/g, "").toLowerCase();
}

/** Whether a slug (already normalized with `normalizeSlug`) follows the database's rules. */
export function isValidSlug(slug: string): boolean {
  return (
    slug.length >= SLUG_MIN &&
    slug.length <= SLUG_MAX &&
    SLUG_PATTERN.test(slug) &&
    !slug.includes("--")
  );
}

/**
 * The database accepts `UTC` and canonical area names (`Asia/Jakarta`), and refuses aliases and
 * POSIX strings (`US/Eastern`, `UTC+7`, `Etc/GMT-7`). The area check mirrors its pattern; the
 * runtime check makes sure the name is a real zone.
 */
const TZ_AREAS =
  /^(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z0-9_+/-]+$/;
export function isValidTimezone(tz: string): boolean {
  if (tz !== "UTC" && !TZ_AREAS.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const blankToUndefined = (v: unknown) =>
  v === null || (typeof v === "string" && v.trim() === "") ? undefined : v;

/** Normalized as the database does before it checks (`normalizeSlug`). */
export const slugSchema = z
  .string({ error: "org.slug.invalid" })
  .transform(normalizeSlug)
  .refine(isValidSlug, { error: "org.slug.invalid" });

const bps = z.preprocess(
  blankToUndefined,
  z.coerce
    .number({ error: "org.bps.invalid" })
    .int({ error: "org.bps.invalid" })
    .min(0, { error: "org.bps.invalid" })
    .max(BPS_MAX, { error: "org.bps.invalid" })
    .default(0),
);

/** A checkbox sends "on" (or nothing); a JSON caller sends a boolean. */
const checkbox = z.preprocess(
  (v) =>
    v === "on" || v === "true" ? true : v === "false" || v === undefined || v === "" ? false : v,
  z.boolean({ error: "org.field.invalid" }),
);

export const createOrganizationSchema = z.object({
  name: z
    .string({ error: "org.field.required" })
    .trim()
    .min(1, { error: "org.field.required" })
    .max(NAME_MAX, { error: "org.name.too_long" }),
  slug: slugSchema,
  timezone: z.preprocess(
    blankToUndefined,
    z
      .string({ error: "org.timezone.invalid" })
      .trim()
      .refine(isValidTimezone, { error: "org.timezone.invalid" })
      .default(DEFAULT_TIMEZONE),
  ),
  /** The first location. Blank means "use the restaurant's name". */
  locationName: z.preprocess(
    blankToUndefined,
    z.string().trim().max(NAME_MAX, { error: "org.location_name.too_long" }).optional(),
  ),
  address: z.preprocess(
    blankToUndefined,
    z.string().trim().max(ADDRESS_MAX, { error: "org.address.too_long" }).optional(),
  ),
  taxBps: bps,
  serviceChargeBps: bps,
  taxOnService: checkbox,
});
export type CreateOrganizationInput = z.input<typeof createOrganizationSchema>;

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
    const key = issue.message.startsWith("org.") ? issue.message : "org.field.invalid";
    const list = (out[field] ??= []);
    if (!list.includes(key)) list.push(key);
  }
  return out;
}
