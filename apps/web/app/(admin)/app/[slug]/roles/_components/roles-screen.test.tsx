// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/components/i18n/provider";
import { MotionProvider } from "@/components/motion/provider";
import { messages } from "@/messages";

const actions = vi.hoisted(() => ({
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
}));
const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("@/lib/actions/roles/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import type { RoleView } from "../_lib/groups";
import { RolesScreen } from "./roles-screen";

const owner: RoleView = {
  id: "r1",
  name: "Owner",
  description: null,
  isSystem: true,
  systemKey: "owner",
  permissions: ["menu.manage", "staff.manage"],
  memberCount: 1,
};
const custom: RoleView = {
  id: "r2",
  name: "Supervisor",
  description: null,
  isSystem: false,
  systemKey: null,
  permissions: ["menu.manage"],
  memberCount: 2,
};

const show = (canCustomize: boolean, held = ["menu.manage", "staff.manage", "pos.use"]) =>
  render(
    <MotionProvider>
      <I18nProvider locale="en" messages={messages.en}>
        <RolesScreen
          orgId="o1"
          slug="demo"
          roles={[owner, custom]}
          held={held}
          canCustomize={canCustomize}
        />
      </I18nProvider>
    </MotionProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no <dialog> methods.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

describe("roles screen", () => {
  it("locks create and edit when the package lacks custom roles, but keeps delete", () => {
    show(false);
    expect(
      (screen.getByRole("button", { name: "Create role" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(messages.en["roles.screen.locked.title"])).toBeTruthy();
    const row = screen.getByText("Supervisor").closest("tr")!;
    expect(within(row).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(
      (within(row).getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("never offers edit or delete for a built-in role", () => {
    show(true);
    const row = screen.getByText("Owner").closest("tr")!;
    expect(within(row).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(within(row).getByRole("button", { name: "View" })).toBeTruthy();
  });

  it("creates a role with the ticked permissions and the clear-all marker", async () => {
    actions.createRole.mockResolvedValue({ ok: true, data: { roleId: "r3" } });
    show(true);
    await userEvent.click(screen.getByRole("button", { name: "Create role" }));
    await userEvent.type(screen.getByLabelText(/role name/i), "Floor lead");
    await userEvent.click(screen.getByLabelText("Use the POS"));
    // A permission the caller doesn't hold can't be ticked.
    expect((screen.getByLabelText("Manage billing") as HTMLInputElement).disabled).toBe(true);
    await userEvent.click(screen.getAllByRole("button", { name: "Create role" }).at(-1)!);
    expect(actions.createRole).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "o1",
        name: "Floor lead",
        permissions: ["pos.use"],
        permissions_submitted: "1",
      }),
    );
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("shows the server's message when a name is taken", async () => {
    actions.createRole.mockResolvedValue({
      ok: false,
      error: { code: "conflict", fieldErrors: { name: ["roles.name.taken"] } },
    });
    show(true);
    await userEvent.click(screen.getByRole("button", { name: "Create role" }));
    await userEvent.type(screen.getByLabelText(/role name/i), "Supervisor");
    await userEvent.click(screen.getAllByRole("button", { name: "Create role" }).at(-1)!);
    expect(await screen.findByText(messages.en["roles.name.taken"])).toBeTruthy();
  });
});
