import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the theme (DESIGN.md §2 and §10): every token exists, colours flow palette -> theme map ->
 * semantic tokens in one direction only, and the verified contrast pairs of §2.4 still hold. If a
 * theme change breaks a pair, this fails: recheck §2.4 before changing the number here.
 */

const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const palette = stripComments(read("palette.css"));
const themeMap = stripComments(read("theme-map.css"));
const globals = stripComments(read("../../app/globals.css"));

/** Every `--name: value;` of a file (a name with `*`, like `--color-*: initial`, is not a token). */
function declarations(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of css.matchAll(/(?<![\w-])--([\w-]+):\s*([^;{}]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

const paletteTokens = declarations(palette);
const mapTokens = declarations(themeMap);
const globalTokens = declarations(globals);
const allTokens = new Map([...paletteTokens, ...mapTokens, ...globalTokens]);

/** Follow `var(--x)` chains down to a hex value. */
function resolve(name: string): string {
  const seen = new Set<string>();
  let value = allTokens.get(name);
  while (value !== undefined) {
    const ref = /^var\(--([\w-]+)\)$/.exec(value);
    if (!ref) break;
    if (seen.has(ref[1])) throw new Error(`token loop at ${ref[1]}`);
    seen.add(ref[1]);
    value = allTokens.get(ref[1]);
  }
  if (!value || !/^#[0-9a-f]{6}$/i.test(value))
    throw new Error(`--${name} does not resolve to a hex colour`);
  return value;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(resolve(fg)), luminance(resolve(bg))];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const SEMANTIC_COLOURS = [
  "bg",
  "surface",
  "surface-muted",
  "border",
  "border-control",
  "text",
  "text-secondary",
  "text-muted",
  "primary",
  "primary-hover",
  "primary-pressed",
  "primary-soft",
  "on-primary",
  "accent",
  "accent-hover",
  "accent-pressed",
  "on-accent",
  "focus",
  "focus-inverse",
  "nav-bg",
  "nav-text",
  "nav-muted",
  "nav-active",
];

const ROLE_COLOURS = [
  ...["0", "50", "100", "200", "300", "400", "500", "600", "700", "900"].map(
    (n) => `dominant-${n}`,
  ),
  ...["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"].map(
    (n) => `secondary-${n}`,
  ),
  "on-secondary",
  ...["100", "200", "300", "400", "500", "700"].map((n) => `accent-${n}`),
  "on-accent-fill",
];

const PALETTE_COLOURS = [
  ...["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"].map(
    (n) => `cobalt-${n}`,
  ),
  ...["0", "50", "100", "200", "300", "400", "500", "600", "700"].map((n) => `snow-${n}`),
  "ink",
  ...["100", "200", "300", "400", "500", "700"].map((n) => `lime-${n}`),
  "success-50",
  "success-600",
  "success-700",
  "warning-50",
  "warning-500",
  "warning-700",
  "danger-50",
  "danger-600",
  "danger-700",
  "white",
  "black",
];

describe("tokens exist (DESIGN.md §10)", () => {
  it("has the whole palette", () => {
    for (const name of PALETTE_COLOURS) expect(paletteTokens.has(`color-${name}`), name).toBe(true);
  });

  it("has every role colour in the theme map, and nothing else", () => {
    for (const name of ROLE_COLOURS) expect(mapTokens.has(`color-${name}`), name).toBe(true);
    expect([...mapTokens.keys()].sort()).toEqual(ROLE_COLOURS.map((n) => `color-${n}`).sort());
  });

  it("has every semantic colour", () => {
    for (const name of SEMANTIC_COLOURS) expect(globalTokens.has(`color-${name}`), name).toBe(true);
  });

  it("has the storefront brand tokens", () => {
    for (const name of ["brand-primary", "on-brand-primary", "brand-accent", "on-brand-accent"])
      expect(globalTokens.has(`color-${name}`), name).toBe(true);
  });

  it("has the type scale, with size, line height and weight", () => {
    const scale = [
      "display-xl",
      "display",
      "h1",
      "h2",
      "h3",
      "h4",
      "body-lg",
      "body",
      "body-sm",
      "caption",
    ];
    for (const name of scale) {
      expect(globalTokens.has(`text-${name}`), name).toBe(true);
      expect(globalTokens.has(`text-${name}--line-height`), name).toBe(true);
      expect(globalTokens.has(`text-${name}--font-weight`), name).toBe(true);
    }
    expect(globalTokens.get("font-sans")).toContain("var(--font-jakarta)");
  });

  it("has radius, shadow, space, touch-target and motion tokens", () => {
    const names = [
      ...["sm", "md", "lg", "xl", "full"].map((n) => `radius-${n}`),
      ...["xs", "sm", "md", "lg"].map((n) => `shadow-${n}`),
      ...[
        "card",
        "card-compact",
        "card-marketing",
        "field",
        "label",
        "page",
        "page-md",
        "page-lg",
      ].map((n) => `spacing-${n}`),
      ...["touch", "touch-pos", "touch-gap-pos", "tile-w", "tile-h"].map((n) => `spacing-${n}`),
      ...["fast", "base", "slow"].map((n) => `duration-${n}`),
      ...["enter", "leave"].map((n) => `ease-${n}`),
      "press-scale",
      "motion-distance",
    ];
    for (const name of names) expect(globalTokens.has(name), name).toBe(true);
  });

  it("matches the sizes in DESIGN.md", () => {
    expect(globalTokens.get("radius-md")).toBe("12px");
    expect(globalTokens.get("radius-full")).toBe("9999px");
    expect(globalTokens.get("spacing-touch")).toBe("44px");
    expect(globalTokens.get("spacing-touch-pos")).toBe("48px");
    expect(globalTokens.get("spacing-tile-w")).toBe("120px");
    expect(globalTokens.get("spacing-tile-h")).toBe("96px");
    expect(globalTokens.get("duration-fast")).toBe("150ms");
  });
});

describe("colours flow one way: palette -> theme map -> semantic tokens", () => {
  it("only the theme map names a palette colour", () => {
    const palettePattern = /var\(--color-(cobalt|snow|lime|ink|success|warning|danger)\b/;
    for (const [name, value] of globalTokens) expect(value, name).not.toMatch(palettePattern);
    for (const [name, value] of mapTokens) {
      const ref = /^var\(--color-([\w-]+)\)$/.exec(value);
      expect(ref, `${name} must point at one palette colour`).not.toBeNull();
      expect(paletteTokens.has(`color-${ref![1]}`), `${name} -> ${value}`).toBe(true);
    }
  });

  it("semantic tokens point at roles or at other semantic tokens, never at a hex value", () => {
    for (const name of SEMANTIC_COLOURS) {
      const value = globalTokens.get(`color-${name}`)!;
      expect(value, name).toMatch(/^var\(--color-[\w-]+\)$/);
    }
  });

  it("has no hex colour outside the palette", () => {
    expect(themeMap).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(globals).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("keeps the lightness order of every role (low numbers light, high numbers dark)", () => {
    for (const role of ["dominant", "secondary"]) {
      const steps = [...mapTokens.keys()]
        .filter((n) => n.startsWith(`color-${role}-`))
        .map((n) => ({ n: Number(n.split("-").pop()), l: luminance(resolve(n)) }))
        .sort((a, b) => a.n - b.n);
      for (let i = 1; i < steps.length; i++)
        expect(steps[i].l, `${role}-${steps[i].n}`).toBeLessThanOrEqual(steps[i - 1].l);
    }
  });
});

/** The verified pairs of DESIGN.md §2.4. `min` is 7 where the doc says AAA, 4.5 for text, 3 for UI. */
const PAIRS: [fg: string, bg: string, min: number, label: string][] = [
  ["color-text", "color-surface", 7, "text on surface"],
  ["color-text", "color-bg", 7, "text on page"],
  ["color-text-secondary", "color-bg", 4.5, "secondary text on page"],
  ["color-text-muted", "color-surface", 4.5, "muted text on surface"],
  ["color-text-muted", "color-bg", 4.5, "muted text on page"],
  ["color-text-muted", "color-surface-muted", 4.5, "muted text on muted surface"],
  ["color-on-primary", "color-primary", 7, "primary button"],
  ["color-primary", "color-bg", 7, "link on page"],
  ["color-secondary-700", "color-secondary-50", 7, "text on soft panel"],
  ["color-on-accent", "color-accent", 7, "spotlight button"],
  ["color-accent", "color-nav-bg", 7, "sidebar indicator and text"],
  ["color-nav-text", "color-nav-bg", 7, "sidebar text"],
  ["color-nav-muted", "color-nav-bg", 7, "sidebar muted text"],
  ["color-accent-700", "color-accent-100", 4.5, "text on soft highlight"],
  ["color-success-700", "color-success-50", 4.5, "success badge"],
  ["color-warning-700", "color-warning-50", 4.5, "warning badge"],
  ["color-danger-700", "color-danger-50", 4.5, "danger badge"],
  ["color-white", "color-danger-600", 4.5, "danger button"],
  ["color-white", "color-success-600", 4.5, "white on success"],
  ["color-border-control", "color-surface", 3, "input border on white (UI)"],
];

describe("contrast stays at the verified WCAG 2.1 AA pairs (DESIGN.md §2.4)", () => {
  for (const [fg, bg, min, label] of PAIRS) {
    it(`${label}: ${fg} on ${bg} is at least ${min}:1`, () => {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
    });
  }

  it("keeps accent clearly apart from success, warning and danger", () => {
    const accent = resolve("color-accent-400");
    for (const status of ["success-600", "warning-500", "danger-600"]) {
      const other = resolve(`color-${status}`);
      const dist = [1, 3, 5].reduce(
        (sum, i) =>
          sum +
          Math.abs(parseInt(accent.slice(i, i + 2), 16) - parseInt(other.slice(i, i + 2), 16)),
        0,
      );
      expect(dist, status).toBeGreaterThan(150);
    }
  });
});

describe("motion", () => {
  it("removes movement with reduced motion and keeps only opacity", () => {
    const block = /@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\n}\n/.exec(globals);
    expect(block, "a prefers-reduced-motion block").not.toBeNull();
    expect(block![1]).toContain("--motion-distance: 0px");
    expect(block![1]).toContain("--press-scale: 1");
    expect(block![1]).toContain("--animate-shimmer: none");
    // The slides move by the distance token, so with 0 they are opacity fades.
    expect(globals).toContain("translateY(var(--motion-distance))");
  });
});
