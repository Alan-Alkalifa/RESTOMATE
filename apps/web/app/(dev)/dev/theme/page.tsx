import type { Metadata } from "next";
import { notFound } from "next/navigation";

/**
 * Dev-only review page: renders every design token (DESIGN.md §2 to §4). It answers 404 in production,
 * so it never ships. Open it on `next dev` at /dev/theme. Not a product screen.
 * Class names are written out in full on purpose: Tailwind finds classes by scanning the source.
 */

export const metadata: Metadata = {
  title: "Theme tokens",
  robots: { index: false, follow: false },
};

const dominant = [
  ["dominant-0", "bg-dominant-0"],
  ["dominant-50", "bg-dominant-50"],
  ["dominant-100", "bg-dominant-100"],
  ["dominant-200", "bg-dominant-200"],
  ["dominant-300", "bg-dominant-300"],
  ["dominant-400", "bg-dominant-400"],
  ["dominant-500", "bg-dominant-500"],
  ["dominant-600", "bg-dominant-600"],
  ["dominant-700", "bg-dominant-700"],
  ["dominant-900", "bg-dominant-900"],
];

const secondary = [
  ["secondary-50", "bg-secondary-50"],
  ["secondary-100", "bg-secondary-100"],
  ["secondary-200", "bg-secondary-200"],
  ["secondary-300", "bg-secondary-300"],
  ["secondary-400", "bg-secondary-400"],
  ["secondary-500", "bg-secondary-500"],
  ["secondary-600", "bg-secondary-600"],
  ["secondary-700", "bg-secondary-700"],
  ["secondary-800", "bg-secondary-800"],
  ["secondary-900", "bg-secondary-900"],
];

const accent = [
  ["accent-100", "bg-accent-100"],
  ["accent-200", "bg-accent-200"],
  ["accent-300", "bg-accent-300"],
  ["accent-400", "bg-accent-400"],
  ["accent-500", "bg-accent-500"],
  ["accent-700", "bg-accent-700"],
];

const status = [
  ["success-50", "bg-success-50"],
  ["success-600", "bg-success-600"],
  ["success-700", "bg-success-700"],
  ["warning-50", "bg-warning-50"],
  ["warning-500", "bg-warning-500"],
  ["warning-700", "bg-warning-700"],
  ["danger-50", "bg-danger-50"],
  ["danger-600", "bg-danger-600"],
  ["danger-700", "bg-danger-700"],
];

/** Semantic pairs: a fill, the text on it, and the token names. */
const semantic = [
  ["bg", "bg-bg text-text border border-border"],
  ["surface", "bg-surface text-text border border-border"],
  ["surface-muted", "bg-surface-muted text-text-muted"],
  ["border / border-control", "bg-surface text-text border-2 border-border-control"],
  ["text-secondary", "bg-surface text-text-secondary border border-border"],
  ["text-muted", "bg-surface text-text-muted border border-border"],
  ["primary / on-primary", "bg-primary text-on-primary"],
  ["primary-hover", "bg-primary-hover text-on-primary"],
  ["primary-pressed", "bg-primary-pressed text-on-primary"],
  ["primary-soft", "bg-primary-soft text-secondary-700"],
  ["accent / on-accent", "bg-accent text-on-accent"],
  ["accent-hover", "bg-accent-hover text-on-accent"],
  ["accent-pressed", "bg-accent-pressed text-on-accent"],
  ["nav-bg / nav-text", "bg-nav-bg text-nav-text"],
  ["nav-muted", "bg-nav-bg text-nav-muted"],
  ["nav-active", "bg-nav-bg text-nav-active"],
];

const type = [
  ["display-xl 56/60 800", "text-display-xl"],
  ["display 44/52 800", "text-display"],
  ["h1 32/40 700", "text-h1"],
  ["h2 24/32 700", "text-h2"],
  ["h3 20/28 600", "text-h3"],
  ["h4 18/26 600", "text-h4"],
  ["body-lg 18/28 400", "text-body-lg"],
  ["body 16/24 400", "text-body"],
  ["body-sm 14/20 400", "text-body-sm"],
  ["caption 12/16 500", "text-caption uppercase tracking-caption"],
];

const radius = [
  ["radius-sm 8", "rounded-sm"],
  ["radius-md 12", "rounded-md"],
  ["radius-lg 16", "rounded-lg"],
  ["radius-xl 24", "rounded-xl"],
  ["radius-full", "rounded-full"],
];

const shadow = [
  ["shadow-xs", "shadow-xs"],
  ["shadow-sm", "shadow-sm"],
  ["shadow-md", "shadow-md"],
  ["shadow-lg", "shadow-lg"],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-gap-admin">
      <h2 className="text-h2 text-text">{title}</h2>
      {children}
    </section>
  );
}

function Swatches({ items, label }: { items: string[][]; label: string }) {
  return (
    <div>
      <h3 className="mb-2 text-h4 text-text-secondary">{label}</h3>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {items.map(([name, cls]) => (
          <li key={name} className="flex flex-col gap-1">
            <span className={`${cls} h-12 rounded-md border border-border`} />
            <span className="text-caption text-text-secondary">{name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ThemeTokensPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 p-page md:p-page-md lg:p-page-lg">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1 text-text">Theme tokens</h1>
        <p className="text-body text-text-secondary">
          Every token of DESIGN.md §2 to §4. Swap the preset in{" "}
          <code>components/theme/theme-map.css</code> and this page re-themes with no component
          edit. Dev only: 404 in production.
        </p>
      </header>

      <Section title="Colour roles (the theme map)">
        <Swatches items={dominant} label="Dominant, 60%" />
        <Swatches items={secondary} label="Secondary, 30%" />
        <Swatches
          items={accent}
          label="Accent, 10% (a filled shape with on-accent content, never text on light)"
        />
        <Swatches items={status} label="Status (outside the 60-30-10)" />
      </Section>

      <Section title="Semantic tokens">
        <ul className="grid gap-2 sm:grid-cols-2">
          {semantic.map(([name, cls]) => (
            <li key={name} className={`${cls} rounded-md px-4 py-3 text-body-sm font-semibold`}>
              {name}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Type: Plus Jakarta Sans">
        <ul className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-card shadow-sm">
          {type.map(([name, cls]) => (
            <li key={name} className="flex flex-col">
              <span className="text-caption text-text-muted">{name}</span>
              <span className={`${cls} text-text`}>Nasi goreng spesial, Rp 25.000</span>
            </li>
          ))}
          <li className="flex gap-6 text-h4 text-text">
            <span className="tabular-nums">Rp 111.111</span>
            <span className="tabular-nums">Rp 888.888</span>
            <span className="text-caption text-text-muted">
              tabular-nums: columns of prices line up
            </span>
          </li>
        </ul>
      </Section>

      <Section title="Shape and depth">
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {radius.map(([name, cls]) => (
            <li key={name} className="flex flex-col gap-1">
              <span className={`${cls} h-16 border-2 border-secondary-600 bg-primary-soft`} />
              <span className="text-caption text-text-secondary">{name}</span>
            </li>
          ))}
        </ul>
        <ul className="grid grid-cols-2 gap-4 rounded-lg bg-bg p-4 sm:grid-cols-4">
          {shadow.map(([name, cls]) => (
            <li key={name} className="flex flex-col gap-1">
              <span
                className={`${cls} flex h-16 items-center justify-center rounded-lg bg-surface text-caption text-text-secondary`}
              >
                {name}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Space and touch targets">
        <div className="flex flex-wrap items-end gap-4">
          <span className="flex size-touch items-center justify-center rounded-md bg-primary text-caption text-on-primary">
            44
          </span>
          <span className="flex size-touch-pos items-center justify-center rounded-md bg-primary text-caption text-on-primary">
            48
          </span>
          <span className="flex h-tile-h w-tile-w items-center justify-center rounded-md bg-primary-soft text-caption text-secondary-700">
            tile 120 x 96
          </span>
          <span className="flex h-control-sm items-center rounded-md bg-surface-muted px-3 text-caption">
            control sm 36
          </span>
          <span className="flex h-control-md items-center rounded-md bg-surface-muted px-3 text-caption">
            md 40
          </span>
          <span className="flex h-control-lg items-center rounded-md bg-surface-muted px-3 text-caption">
            lg 48
          </span>
        </div>
        <div className="flex flex-wrap gap-4">
          <span className="rounded-lg border border-border bg-surface p-card text-caption">
            card 20
          </span>
          <span className="rounded-lg border border-border bg-surface p-card-compact text-caption">
            compact 16
          </span>
          <span className="rounded-lg border border-border bg-surface p-card-marketing text-caption">
            marketing 32
          </span>
        </div>
      </Section>

      <Section title="Motion and focus">
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            className="pressable inline-flex h-control-md items-center rounded-md bg-primary px-4 text-body-sm font-semibold text-on-primary shadow-xs hover:bg-primary-hover"
          >
            Press me (150 ms, scale 0.98)
          </button>
          <span className="animate-fade-in rounded-md bg-surface-muted px-3 py-2 text-caption">
            fade-in 200 ms
          </span>
          <span className="animate-slide-up rounded-md bg-surface-muted px-3 py-2 text-caption">
            slide-up 250 ms (an opacity fade with reduced motion)
          </span>
          <span className="skeleton block h-6 w-40 rounded-md" aria-hidden />
          <span className="rounded-md bg-nav-bg p-2">
            <a
              href="#top"
              className="focus-inverse rounded-sm px-2 py-1 text-body-sm text-nav-text"
            >
              Focus ring on a dark surface
            </a>
          </span>
        </div>
        <p className="text-body-sm text-text-secondary">
          Tab to a control: a 2 px focus ring with 2 px offset. Turn on reduced motion in the OS:
          nothing moves and the skeleton stops.
        </p>
      </Section>
    </main>
  );
}
