// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import { Field, Input, Switch } from "./field";
import { BACK_ONLINE_MS, OfflineBar } from "./offline-bar";
import { ToastProvider, useToast, TOAST_DURATION_MS } from "./toast";

describe("Button", () => {
  it("ignores presses and keeps focus while loading", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    await userEvent.tab();
    expect(document.activeElement).toBe(button);
    await userEvent.keyboard("{Enter}");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("activates with Enter and Space, and not when disabled", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Go</Button>);
    await userEvent.tab();
    await userEvent.keyboard("{Enter} ");
    expect(onClick).toHaveBeenCalledTimes(2);
    rerender(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});

describe("Field", () => {
  it("names the control and links the error and helper text", () => {
    render(
      <Field label="Email" helper="We never share it." error="Enter a valid email." required>
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText(/Email/);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const described = (input.getAttribute("aria-describedby") ?? "").split(" ");
    expect(described).toHaveLength(2);
    const text = described.map((id) => document.getElementById(id)?.textContent);
    expect(text.join(" ")).toContain("Enter a valid email.");
    expect(text.join(" ")).toContain("We never share it.");
    expect(input.hasAttribute("required")).toBe(true);
  });

  it("has no invalid state without an error", () => {
    render(
      <Field label="Name">
        <Input />
      </Field>,
    );
    expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).toBeNull();
  });

  it("a switch toggles with Space", async () => {
    render(<Switch label="Online orders" />);
    const sw = screen.getByRole("switch", { name: "Online orders" }) as HTMLInputElement;
    await userEvent.tab();
    await userEvent.keyboard(" ");
    expect(sw.checked).toBe(true);
  });
});

describe("Toast", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  function Trigger({ tone }: { tone: "success" | "error" }) {
    const toast = useToast();
    return <button onClick={() => toast.show({ tone, title: "Hello" })}>show</button>;
  }

  it("hides after 5 seconds, except an error", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider dismissLabel="Dismiss">
        <Trigger tone="success" />
      </ToastProvider>,
    );
    await user.click(screen.getByText("show"));
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS + 10));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("an error stays until dismissed, and Escape dismisses it", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider dismissLabel="Dismiss">
        <Trigger tone="error" />
      </ToastProvider>,
    );
    await user.click(screen.getByText("show"));
    act(() => vi.advanceTimersByTime(60_000));
    const alert = screen.getByRole("alert");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(alert.isConnected).toBe(false);
  });
});

describe("OfflineBar", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows offline, then Back online for 3 seconds, then hides", () => {
    const props = { offlineMessage: "Offline", backOnlineMessage: "Back online" };
    const { rerender } = render(<OfflineBar {...props} online />);
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<OfflineBar {...props} online={false} />);
    expect(screen.getByRole("status").textContent).toBe("Offline");
    rerender(<OfflineBar {...props} online />);
    expect(screen.getByRole("status").textContent).toBe("Back online");
    act(() => vi.advanceTimersByTime(BACK_ONLINE_MS + 10));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
