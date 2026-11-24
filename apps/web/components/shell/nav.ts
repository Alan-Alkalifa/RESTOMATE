import type { MessageKey } from "@/messages";

/**
 * The restaurant admin navigation. The server filters it by the member's permissions and passes
 * only the visible items to the client, so a role never receives a link it may not use. Hiding is
 * a convenience: every page and action still checks the permission itself.
 *
 * Add an entry here in the task that builds its page, never before: a link to a page that does not
 * exist is a dead end. `permission: null` means any active member.
 */
export type NavIcon = "dashboard" | "staff" | "roles";

export type NavEntry = {
  id: string;
  /** Path under `/app/<slug>`, with a leading slash; "" is the dashboard. */
  path: string;
  labelKey: MessageKey;
  icon: NavIcon;
  permission: string | null;
};

export type NavSection = { id: string; titleKey: MessageKey | null; entries: NavEntry[] };

export const ADMIN_NAV: NavSection[] = [
  {
    id: "main",
    titleKey: null,
    entries: [
      {
        id: "dashboard",
        path: "",
        labelKey: "admin.nav.dashboard",
        icon: "dashboard",
        permission: null,
      },
    ],
  },
  {
    id: "team",
    titleKey: "admin.nav.section.team",
    entries: [
      {
        id: "staff",
        path: "/staff",
        labelKey: "admin.nav.staff",
        icon: "staff",
        permission: "staff.manage",
      },
      {
        id: "roles",
        path: "/roles",
        labelKey: "admin.nav.roles",
        icon: "roles",
        permission: "staff.manage",
      },
    ],
  },
];

export type VisibleNavEntry = Omit<NavEntry, "permission"> & { href: string };
export type VisibleNavSection = Omit<NavSection, "entries"> & { entries: VisibleNavEntry[] };

/** The navigation this member may see. Sections left empty are dropped. */
export function visibleNav(
  slug: string,
  has: (permission: string) => boolean,
  nav: NavSection[] = ADMIN_NAV,
): VisibleNavSection[] {
  const base = `/app/${encodeURIComponent(slug)}`;
  return nav
    .map((section) => ({
      ...section,
      entries: section.entries
        .filter((e) => e.permission === null || has(e.permission))
        .map((e) => ({
          id: e.id,
          path: e.path,
          labelKey: e.labelKey,
          icon: e.icon,
          href: `${base}${e.path}`,
        })),
    }))
    .filter((section) => section.entries.length > 0);
}
