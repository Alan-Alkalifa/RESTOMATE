// @vitest-environment jsdom
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";
import { Modal } from "./modal";
import { Sheet } from "./sheet";

// jsdom has no top layer; give <dialog> the open/close behaviour the components rely on.
beforeAll(() => {
  // jsdom has no matchMedia (the Sheet reads it to pick its direction).
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

function Harness({ Overlay }: { Overlay: typeof Modal | typeof Sheet }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>opener</button>
      <Overlay open={open} onClose={() => setOpen(false)} title="Title" closeLabel="Close">
        <input aria-label="inside" />
      </Overlay>
    </>
  );
}

describe.each([
  ["Modal", Modal],
  ["Sheet", Sheet],
])("%s keyboard", (_name, Overlay) => {
  it("opens as a named dialog with an h2 title", async () => {
    render(<Harness Overlay={Overlay} />);
    await userEvent.click(screen.getByText("opener"));
    expect(screen.getByRole("dialog", { name: "Title" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Title" })).toBeTruthy();
  });

  it("closes on Escape and returns focus to the opener", async () => {
    render(<Harness Overlay={Overlay} />);
    const opener = screen.getByText("opener");
    opener.focus();
    await userEvent.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog");
    // The browser fires `cancel` on the dialog for Escape; jsdom does not, so fire it.
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it("closes with the close button", async () => {
    render(<Harness Overlay={Overlay} />);
    await userEvent.click(screen.getByText("opener"));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes on a click on the backdrop, not on the content", async () => {
    render(<Harness Overlay={Overlay} />);
    await userEvent.click(screen.getByText("opener"));
    await userEvent.click(screen.getByLabelText("inside"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await userEvent.click(document.querySelector("dialog")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
