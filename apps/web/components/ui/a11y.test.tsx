// @vitest-environment jsdom
import { render } from "@testing-library/react";
import axe from "axe-core";
import { beforeAll, describe, expect, it } from "vitest";
import { DevGallery } from "../../app/(dev)/dev/gallery";

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

describe("/dev page", () => {
  it("has no axe violations", async () => {
    const { container } = render(<DevGallery />);
    const results = await axe.run(container, {
      // jsdom has no layout or computed colour: contrast is checked on the theme pairs (theme.test.ts).
      rules: { "color-contrast": { enabled: false } },
    });
    const summary = results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`,
    );
    expect(summary).toEqual([]);
  });
});
