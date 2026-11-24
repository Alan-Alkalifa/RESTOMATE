// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lenis = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));
vi.mock("lenis/dist/lenis.css", () => ({}));
vi.mock("lenis/react", async () => {
  const React = await import("react");
  return {
    ReactLenis: ({ children }: { children: React.ReactNode }) => {
      React.useEffect(() => {
        lenis.mounts += 1;
        return () => {
          lenis.unmounts += 1;
        };
      }, []);
      return <div data-testid="lenis">{children}</div>;
    },
    useLenis: () => undefined,
  };
});
vi.mock("gsap", () => ({
  gsap: {
    registerPlugin: vi.fn(),
    ticker: { add: vi.fn(), remove: vi.fn(), lagSmoothing: vi.fn() },
  },
}));
vi.mock("gsap/ScrollTrigger", () => ({ ScrollTrigger: { update: vi.fn() } }));

import { SmoothScroll } from "./smooth-scroll";

/** A matchMedia whose "no-preference" answer can change while the page is open. */
function mockMotion(initiallyAllowed: boolean) {
  let allowed = initiallyAllowed;
  const listeners = new Set<() => void>();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes("no-preference") ? allowed : !allowed;
    },
    media: query,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  })) as unknown as typeof window.matchMedia;
  return (next: boolean) => {
    allowed = next;
    act(() => listeners.forEach((fn) => fn()));
  };
}

beforeEach(() => {
  lenis.mounts = 0;
  lenis.unmounts = 0;
});
afterEach(() => vi.restoreAllMocks());

describe("SmoothScroll", () => {
  it("mounts Lenis when motion is allowed", () => {
    mockMotion(true);
    render(<SmoothScroll />);
    expect(screen.getByTestId("lenis")).toBeTruthy();
    expect(lenis.mounts).toBe(1);
  });

  it("does not mount Lenis at all with reduced motion", () => {
    mockMotion(false);
    render(<SmoothScroll />);
    expect(screen.queryByTestId("lenis")).toBeNull();
    expect(lenis.mounts).toBe(0);
  });

  it("follows the setting while the page is open", () => {
    const setAllowed = mockMotion(true);
    render(<SmoothScroll />);
    setAllowed(false);
    expect(screen.queryByTestId("lenis")).toBeNull();
    expect(lenis.unmounts).toBe(1);
    setAllowed(true);
    expect(screen.getByTestId("lenis")).toBeTruthy();
    expect(lenis.mounts).toBe(2);
  });
});
