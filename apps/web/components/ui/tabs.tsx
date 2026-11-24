"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";

/**
 * Tabs (DESIGN.md §6.5): underline style, the active tab has secondary-600 text and a 3 px underline with
 * rounded ends. Keyboard (WAI-ARIA tabs, automatic activation): Left and Right move between tabs and wrap,
 * Home and End jump to the first and last, and only the active tab is in the Tab order. The panel is
 * focusable so a keyboard user can scroll it. Disabled tabs are skipped.
 *
 * Filters and tabs are kept in the URL on the pages that use them (DESIGN.md §1.2): use the controlled
 * `value` and `onValueChange` for that.
 */

export type TabItem = {
  id: string;
  label: ReactNode;
  panel: ReactNode;
  disabled?: boolean;
};

export type TabsProps = {
  tabs: TabItem[];
  /** Names the tab list for a screen reader ("Order status"). From the caller's translations. */
  label: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  className?: string;
};

export function Tabs({ tabs, label, value, defaultValue, onValueChange, className }: TabsProps) {
  const base = useId();
  const firstEnabled = tabs.find((t) => !t.disabled)?.id ?? tabs[0]?.id;
  const [inner, setInner] = useState(defaultValue ?? firstEnabled);
  const current = value ?? inner;
  const refs = useRef(new Map<string, HTMLButtonElement>());

  function select(id: string, focus: boolean) {
    if (value === undefined) setInner(id);
    onValueChange?.(id);
    if (focus) refs.current.get(id)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const enabled = tabs.filter((t) => !t.disabled);
    if (enabled.length === 0) return;
    const index = enabled.findIndex((t) => t.id === current);
    let next: TabItem | undefined;
    switch (event.key) {
      case "ArrowRight":
        next = enabled[(index + 1) % enabled.length];
        break;
      case "ArrowLeft":
        next = enabled[(index - 1 + enabled.length) % enabled.length];
        break;
      case "Home":
        next = enabled[0];
        break;
      case "End":
        next = enabled[enabled.length - 1];
        break;
      default:
        return;
    }
    event.preventDefault();
    select(next.id, true);
  }

  const active = tabs.find((t) => t.id === current) ?? tabs[0];

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {tabs.map((tab) => {
          const selected = tab.id === active?.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) refs.current.set(tab.id, el);
                else refs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => select(tab.id, false)}
              className={cn(
                "relative inline-flex min-h-touch shrink-0 items-center whitespace-nowrap px-4 text-body-sm font-semibold transition-colors duration-fast ease-enter",
                "after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:rounded-full after:transition-colors after:duration-fast after:content-['']",
                selected
                  ? "text-primary after:bg-primary"
                  : "text-text-secondary hover:text-text hover:after:bg-dominant-300",
                "disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:after:bg-transparent",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {active ? (
        <div
          role="tabpanel"
          id={`${base}-panel-${active.id}`}
          aria-labelledby={`${base}-tab-${active.id}`}
          tabIndex={0}
          className="pt-4"
        >
          {active.panel}
        </div>
      ) : null}
    </div>
  );
}
