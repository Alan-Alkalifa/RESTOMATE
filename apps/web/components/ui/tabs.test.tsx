// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Tabs } from "./tabs";

const tabs = [
  { id: "a", label: "A", panel: <p>panel a</p> },
  { id: "b", label: "B", panel: <p>panel b</p>, disabled: true },
  { id: "c", label: "C", panel: <p>panel c</p> },
  { id: "d", label: "D", panel: <p>panel d</p> },
];

describe("Tabs keyboard", () => {
  it("only the active tab is in the Tab order", () => {
    render(<Tabs label="t" tabs={tabs} />);
    expect(screen.getByRole("tab", { name: "A" }).tabIndex).toBe(0);
    expect(screen.getByRole("tab", { name: "C" }).tabIndex).toBe(-1);
  });

  it("arrow keys move and activate, skip disabled tabs and wrap", async () => {
    render(<Tabs label="t" tabs={tabs} />);
    screen.getByRole("tab", { name: "A" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "C" }));
    expect(screen.getByText("panel c")).toBeTruthy();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "A" }));
    await userEvent.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "D" }));
  });

  it("Home and End jump to the first and last enabled tab", async () => {
    render(<Tabs label="t" tabs={tabs} defaultValue="c" />);
    screen.getByRole("tab", { name: "C" }).focus();
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "D", selected: true })).toBeTruthy();
    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "A", selected: true })).toBeTruthy();
  });

  it("links tab and panel", () => {
    render(<Tabs label="t" tabs={tabs} />);
    const tab = screen.getByRole("tab", { name: "A" });
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tab.id);
  });
});
