// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/components/i18n/provider";
import { messages } from "@/messages";

const actions = vi.hoisted(() => ({ acceptInvitation: vi.fn() }));
const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/actions/staff/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

import { AcceptCard } from "./join-card";

const show = () =>
  render(
    <I18nProvider locale="en" messages={messages.en}>
      <AcceptCard token={"a".repeat(43)} orgName="Warung Sedap" roleName="Cashier" />
    </I18nProvider>,
  );
const invalidTitle = messages.en["staff.invite_page.invalid.title"];
const accept = () => userEvent.click(screen.getByRole("button", { name: /accept invitation/i }));

beforeEach(() => vi.clearAllMocks());

describe("accept invitation", () => {
  it("shows the names and goes into the restaurant on success", async () => {
    actions.acceptInvitation.mockResolvedValue({ ok: true, data: { orgId: "o", slug: "sedap" } });
    show();
    expect(screen.getByText("Join Warung Sedap")).toBeTruthy();
    await accept();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/app/sedap"));
  });

  it.each([
    ["invalid_token", undefined],
    ["forbidden", { form: ["staff.invitation.email_mismatch"] }],
    ["validation", undefined],
  ])("shows the same generic page for %s", async (code, fieldErrors) => {
    actions.acceptInvitation.mockResolvedValue({ ok: false, error: { code, fieldErrors } });
    show();
    await accept();
    expect(await screen.findByText(invalidTitle)).toBeTruthy();
    // Nothing says which reason it was.
    expect(screen.queryByText(/different email/i)).toBeNull();
  });

  it("offers a retry, not the generic page, when the service is down", async () => {
    actions.acceptInvitation.mockResolvedValue({ ok: false, error: { code: "unavailable" } });
    show();
    await accept();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText(invalidTitle)).toBeNull();
  });
});
