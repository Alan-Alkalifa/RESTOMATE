"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId } from "react";
import { useI18n } from "@/components/i18n/provider";

export const LOCATION_PARAM = "location";

export type ShellLocation = { id: string; name: string };

/**
 * Which location the pages show. The choice is the `location` query parameter, so a link keeps it and
 * nothing is stored on the device. "All locations" (no parameter) is for the roles that can reach several.
 * The server still decides what the person may see: this only picks among the locations it returned.
 */
export function LocationSwitcher({ locations }: { locations: ShellLocation[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectId = useId();

  if (locations.length === 0) return null;
  const current = params.get(LOCATION_PARAM) ?? "";
  const known = locations.some((l) => l.id === current);
  const canPickAll = locations.length > 1;

  function change(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(LOCATION_PARAM, value);
    else next.delete(LOCATION_PARAM);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  // One location: nothing to switch, but say where the pages are.
  if (!canPickAll) {
    return (
      <p className="flex min-h-11 items-center gap-2 px-3 text-body-sm text-nav-muted">
        <span className="sr-only">{t("admin.location.label")}: </span>
        {locations[0].name}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={selectId} className="px-3 text-caption uppercase text-nav-muted">
        {t("admin.location.label")}
      </label>
      <select
        id={selectId}
        value={known ? current : ""}
        onChange={(e) => change(e.target.value)}
        className="min-h-11 w-full rounded-md border border-secondary-600 bg-secondary-700 px-3 text-body-sm text-nav-text"
      >
        <option value="">{t("admin.location.all")}</option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </div>
  );
}
