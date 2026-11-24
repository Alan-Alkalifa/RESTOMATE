// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/components/i18n/provider";
import { messages } from "@/messages";

const actions = vi.hoisted(() => ({ checkSlug: vi.fn(), createOrganization: vi.fn() }));
const push = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/organization/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import { CreateRestaurantForm } from "./create-restaurant-form";

const show = () =>
  render(
    <I18nProvider locale="en" messages={messages.en}>
      <CreateRestaurantForm />
    </I18nProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  actions.checkSlug.mockResolvedValue({ ok: true, data: { available: true, reason: null } });
});

describe("create restaurant", () => {
  it("suggests an address from the name and checks it live", async () => {
    show();
    await userEvent.type(screen.getByLabelText(/restaurant name/i), "Warung Sari & Co");
    expect((screen.getByLabelText(/customer site address/i) as HTMLInputElement).value).toBe(
      "warung-sari-co",
    );
    await waitFor(() => expect(actions.checkSlug).toHaveBeenCalledWith("warung-sari-co"));
    expect(await screen.findByText(messages.en["onboarding.slug.available"])).toBeTruthy();
  });

  it("does not ask the server about an address that is invalid locally", async () => {
    show();
    await userEvent.type(screen.getByLabelText(/customer site address/i), "ab");
    expect(await screen.findByText(messages.en["org.slug.invalid"])).toBeTruthy();
    await new Promise((r) => setTimeout(r, 600));
    expect(actions.checkSlug).not.toHaveBeenCalled();
  });

  it("says when the address is taken", async () => {
    actions.checkSlug.mockResolvedValue({
      ok: true,
      data: { available: false, reason: "SLUG_TAKEN" },
    });
    show();
    await userEvent.type(screen.getByLabelText(/customer site address/i), "taken-one");
    expect(await screen.findByText(messages.en["org.slug.taken"])).toBeTruthy();
  });

  it("sends rates as basis points and ends on the dashboard", async () => {
    actions.createOrganization.mockResolvedValue({
      ok: true,
      data: { orgId: "o", slug: "warung" },
    });
    show();
    await userEvent.type(screen.getByLabelText(/restaurant name/i), "Warung");
    const service = screen.getByLabelText(/^service charge/i);
    await userEvent.clear(service);
    await userEvent.type(service, "5,5");
    await userEvent.click(screen.getByRole("button", { name: "Create restaurant" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app"));
    expect(actions.createOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Warung",
        slug: "warung",
        taxBps: "1100",
        serviceChargeBps: "550",
      }),
    );
  });

  it("keeps everything typed when the server refuses", async () => {
    actions.createOrganization.mockResolvedValue({
      ok: false,
      error: { code: "conflict", fieldErrors: { slug: ["org.slug.taken"] } },
    });
    show();
    await userEvent.type(screen.getByLabelText(/restaurant name/i), "Warung");
    await userEvent.type(screen.getByLabelText(/^address/i), "Jl. Merdeka 1");
    await userEvent.click(screen.getByRole("button", { name: "Create restaurant" }));
    expect(await screen.findByText(messages.en["org.slug.taken"])).toBeTruthy();
    expect((screen.getByLabelText(/restaurant name/i) as HTMLInputElement).value).toBe("Warung");
    expect((screen.getByLabelText(/^address/i) as HTMLTextAreaElement).value).toBe("Jl. Merdeka 1");
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the cap message from the server", async () => {
    actions.createOrganization.mockResolvedValue({
      ok: false,
      error: { code: "forbidden", fieldErrors: { form: ["org.cap_reached"] } },
    });
    show();
    await userEvent.type(screen.getByLabelText(/restaurant name/i), "Warung");
    await userEvent.click(screen.getByRole("button", { name: "Create restaurant" }));
    expect(await screen.findByText(messages.en["org.cap_reached"])).toBeTruthy();
  });

  it("rejects a bad rate on the client", async () => {
    show();
    await userEvent.type(screen.getByLabelText(/restaurant name/i), "Warung");
    const tax = screen.getByLabelText(/^tax/i);
    await userEvent.clear(tax);
    await userEvent.type(tax, "abc");
    await userEvent.click(screen.getByRole("button", { name: "Create restaurant" }));
    expect(await screen.findByText(messages.en["org.bps.invalid"])).toBeTruthy();
    expect(actions.createOrganization).not.toHaveBeenCalled();
  });
});
