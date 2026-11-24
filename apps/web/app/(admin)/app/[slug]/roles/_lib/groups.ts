import type { PermissionKey } from "@/lib/auth/keys";
import type { MessageKey } from "@/messages";

/**
 * How the permission checklist is grouped. The server only knows the keys (roles.md); the groups and
 * the labels are the screen's. Every key must be in exactly one group (tested), so a new key in the
 * catalog cannot be forgotten here.
 */
export const PERMISSION_GROUPS: { id: string; labelKey: MessageKey; keys: PermissionKey[] }[] = [
  { id: "menu", labelKey: "roles.group.menu", keys: ["menu.manage"] },
  {
    id: "orders",
    labelKey: "roles.group.orders",
    keys: ["orders.view", "orders.create", "orders.void", "pos.use", "pos.discount"],
  },
  { id: "kitchen", labelKey: "roles.group.kitchen", keys: ["kitchen.view", "kitchen.update"] },
  {
    id: "tables",
    labelKey: "roles.group.tables",
    keys: ["tables.view", "tables.manage", "reservations.view", "reservations.manage"],
  },
  {
    id: "payments",
    labelKey: "roles.group.payments",
    keys: ["bills.print", "payments.view", "payments.take", "payments.refund"],
  },
  {
    id: "customers",
    labelKey: "roles.group.customers",
    keys: ["customers.view", "customers.manage", "reports.view"],
  },
  {
    id: "settings",
    labelKey: "roles.group.settings",
    keys: [
      "staff.manage",
      "locations.manage",
      "settings.manage",
      "settings.branding",
      "billing.manage",
    ],
  },
];

export const permissionLabelKey = (key: string) => `roles.perm.${key}`;

export type RoleView = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  systemKey: string | null;
  permissions: string[];
  /** Active members holding the role. */
  memberCount: number;
};

/** The caller may change or delete a role only when they hold every permission it has (roles.md). */
export function holdsAll(held: ReadonlySet<string>, role: Pick<RoleView, "permissions">): boolean {
  return role.permissions.every((p) => held.has(p));
}
