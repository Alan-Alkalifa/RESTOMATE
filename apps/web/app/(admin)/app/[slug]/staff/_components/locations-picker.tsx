"use client";

import { useI18n } from "@/components/i18n/provider";
import { Checkbox } from "@/components/ui/field";
import type { LocationOption } from "../_lib/model";

/** A checklist of the locations the caller can reach. Names are text, ids are the values sent. */
export function LocationsPicker({
  locations,
  selected,
  onChange,
  disabled = false,
  error,
}: {
  locations: LocationOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  error?: string;
}) {
  const { t } = useI18n();
  if (locations.length === 0) {
    return <p className="text-body-sm text-text-secondary">{t("staff.screen.locations.empty")}</p>;
  }
  return (
    <fieldset className="flex flex-col" disabled={disabled}>
      <legend className="text-body-sm font-medium text-text">
        {t("staff.screen.col.locations")}
      </legend>
      {locations.map((l) => (
        <Checkbox
          key={l.id}
          label={l.name}
          checked={selected.includes(l.id)}
          onChange={(e) =>
            onChange(e.target.checked ? [...selected, l.id] : selected.filter((x) => x !== l.id))
          }
        />
      ))}
      {error && (
        <p role="alert" className="text-body-sm text-danger-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}
