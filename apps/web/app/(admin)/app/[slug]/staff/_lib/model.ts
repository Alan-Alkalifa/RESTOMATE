import type { ActionError } from "@/lib/auth/result";
import { messages } from "@/messages";

/** A role the pickers offer. The server still checks every grant (no escalation). */
export type RoleOption = { id: string; name: string };
export type LocationOption = { id: string; name: string };

/** Roles that reach every location, so their locations are not edited (staff.md). */
export const ALL_LOCATION_ROLE_KEYS = ["owner", "manager"] as const;

export function reachesAllLocations(roleKey: string | null): boolean {
  return roleKey !== null && (ALL_LOCATION_ROLE_KEYS as readonly string[]).includes(roleKey);
}

/**
 * "x of y seats": active members plus open invitations (an expired one no longer holds a slot).
 * `max` is null for an unlimited plan, and 0 when the org has no package.
 */
export function seatsUsed(
  members: { status: "active" | "deactivated" }[],
  invitations: { status: "open" | "expired" | "accepted" | "revoked" }[],
): number {
  return (
    members.filter((m) => m.status === "active").length +
    invitations.filter((i) => i.status === "open").length
  );
}

const hasMessage = (key: string) => key in messages.en;

/**
 * The message key to show for a failed action. A field-level or form-level key from the server wins
 * (they are all translated), then the code's own text. Never a raw code and never server text.
 */
export function errorMessageKey(error: ActionError): string {
  const keys = Object.values(error.fieldErrors ?? {}).flat();
  const form = error.fieldErrors?.form?.[0];
  const specific = form ?? keys[0];
  if (specific && hasMessage(specific)) return specific;
  const byCode = `error.${error.code}`;
  return hasMessage(byCode) ? byCode : "error.unknown";
}

/** The key for one field's first error, if it is a known message. */
export function fieldMessageKey(error: ActionError, field: string): string | undefined {
  const key = error.fieldErrors?.[field]?.[0];
  return key && hasMessage(key) ? key : undefined;
}
