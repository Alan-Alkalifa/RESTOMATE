/**
 * Permission and feature keys, and the cache tags. Tags and keys hold IDs only: a user ID and an
 * org ID, never an email, a name or a slug.
 */

export const PERMISSION_KEYS = [
  "menu.manage",
  "orders.view",
  "orders.create",
  "orders.void",
  "pos.use",
  "pos.discount",
  "kitchen.view",
  "kitchen.update",
  "tables.view",
  "tables.manage",
  "reservations.view",
  "reservations.manage",
  "bills.print",
  "payments.view",
  "payments.take",
  "payments.refund",
  "customers.view",
  "customers.manage",
  "reports.view",
  "staff.manage",
  "locations.manage",
  "settings.manage",
  "settings.branding",
  "billing.manage",
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/** Keys of `get_org_package().features`. */
export const FEATURE_KEYS = [
  "online_payments",
  "reservations",
  "customers",
  "custom_roles",
  "staff_schedules",
  "advanced_reports",
  "csv_export",
  "theme_customization",
  "custom_domain",
  "loyalty",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One user's memberships across orgs. Refresh when any of that user's memberships change. */
export const userMembershipsTag = (userId: string) => `user:${userId}:memberships`;
/** One member in one org: role, status, permissions. Refresh when staff or roles change. */
export const memberTag = (orgId: string, userId: string) => `org:${orgId}:member:${userId}`;
/** An org's package and subscription. Refresh when the plan changes. */
export const packageTag = (orgId: string) => `org:${orgId}:package`;
