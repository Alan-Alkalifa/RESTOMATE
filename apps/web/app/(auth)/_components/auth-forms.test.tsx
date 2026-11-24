// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/components/i18n/provider";
import { messages } from "@/messages";

const actions = vi.hoisted(() => ({
  login: vi.fn(),
  signup: vi.fn(),
  requestPasswordReset: vi.fn(),
  resendConfirmation: vi.fn(),
  resetPassword: vi.fn(),
}));
vi.mock("@/lib/actions/auth/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

import { ForgotForm } from "./forgot-form";
import { LoginForm } from "./login-form";
import { ResetForm } from "./reset-form";
import { SignupForm } from "./signup-form";

const wrap = (ui: ReactNode, locale: "en" | "id" = "en") =>
  render(
    <I18nProvider locale={locale} messages={messages[locale]}>
      {ui}
    </I18nProvider>,
  );

beforeEach(() => vi.clearAllMocks());

describe("login", () => {
  it("keeps what the user typed when the server refuses, and shows translated text", async () => {
    actions.login.mockResolvedValue({ ok: false, error: { code: "invalid_credentials" } });
    wrap(<LoginForm next="/app/orders" />);
    await userEvent.type(screen.getByLabelText(/email/i), "Sari@Example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "secret-pass");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText(messages.en["error.invalid_credentials"])).toBeTruthy();
    expect((screen.getByLabelText(/email/i) as HTMLInputElement).value).toBe("Sari@Example.com");
    expect((screen.getByLabelText(/password/i) as HTMLInputElement).value).toBe("secret-pass");
    // `next` goes to the action as given.
    expect(actions.login).toHaveBeenCalledWith(
      expect.objectContaining({ email: "Sari@Example.com", next: "/app/orders" }),
    );
  });

  it("validates on the client with the shared schema and does not call the action", async () => {
    wrap(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "not-an-email");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByText(messages.en["auth.email.invalid"])).toBeTruthy();
    expect(screen.getByText(messages.en["auth.field.required"])).toBeTruthy(); // the empty password
    expect(actions.login).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/email/i) as HTMLInputElement).value).toBe("not-an-email");
  });

  it("offers a new confirmation link when the email is not confirmed", async () => {
    actions.login.mockResolvedValue({ ok: false, error: { code: "email_not_confirmed" } });
    wrap(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.co");
    await userEvent.type(screen.getByLabelText(/password/i), "x");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    await userEvent.click(await screen.findByRole("button", { name: "Send a new link" }));
    expect(actions.resendConfirmation).toHaveBeenCalledWith({ email: "a@b.co" });
  });

  it("shows the invalid-link notice, in Bahasa Indonesia too", () => {
    wrap(<LoginForm linkError="invalid_link" />, "id");
    expect(screen.getByText(messages.id["auth.screen.invalid_link.title"])).toBeTruthy();
  });
});

describe("signup", () => {
  it("keeps input on a refusal, then shows check-your-email on success", async () => {
    actions.signup.mockResolvedValueOnce({
      ok: false,
      error: { code: "validation", fieldErrors: { password: ["auth.password.weak"] } },
    });
    wrap(<SignupForm />);
    await userEvent.type(screen.getByLabelText(/your name/i), "Sari");
    await userEvent.type(screen.getByLabelText(/email/i), "sari@example.com");
    await userEvent.type(screen.getByLabelText(/^password/i), "password123");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText(messages.en["auth.password.weak"])).toBeTruthy();
    expect((screen.getByLabelText(/your name/i) as HTMLInputElement).value).toBe("Sari");
    expect((screen.getByLabelText(/email/i) as HTMLInputElement).value).toBe("sari@example.com");

    actions.signup.mockResolvedValueOnce({ ok: true, data: { status: "confirmation_sent" } });
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Check your email" })).toBeTruthy(),
    );
    // The page never says whether the address already has an account.
    expect(screen.queryByText(/already/i)).toBeNull();
  });

  it("sends the chosen language", async () => {
    actions.signup.mockResolvedValue({ ok: true, data: { status: "confirmation_sent" } });
    wrap(<SignupForm />, "id");
    await userEvent.type(screen.getByLabelText(/email/i), "sari@example.com");
    await userEvent.type(screen.getByLabelText(/^kata sandi/i), "password123");
    await userEvent.click(screen.getByRole("button", { name: "Buat akun" }));
    await waitFor(() =>
      expect(actions.signup).toHaveBeenCalledWith(expect.objectContaining({ locale: "id" })),
    );
  });
});

describe("forgot and reset", () => {
  it("forgot always ends on check-your-email", async () => {
    actions.requestPasswordReset.mockResolvedValue({ ok: true, data: undefined });
    wrap(<ForgotForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "x@y.co");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText(messages.en["auth.screen.check.reset"])).toBeTruthy();
  });

  it("reset keeps both passwords when they do not match", async () => {
    wrap(<ResetForm />);
    await userEvent.type(screen.getByLabelText(/^new password/i), "longenough1");
    await userEvent.type(screen.getByLabelText(/confirm new password/i), "different1");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByText(messages.en["auth.password.mismatch"])).toBeTruthy();
    expect((screen.getByLabelText(/^new password/i) as HTMLInputElement).value).toBe("longenough1");
    expect(actions.resetPassword).not.toHaveBeenCalled();
  });
});
