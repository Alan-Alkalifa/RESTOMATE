"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/provider";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { inviteStaff } from "@/lib/actions/staff/actions";
import { inviteSchema } from "@/lib/actions/staff/schemas";
import { messages } from "@/messages";
import {
  errorMessageKey,
  fieldMessageKey,
  type LocationOption,
  type RoleOption,
} from "../_lib/model";
import { LocationsPicker } from "./locations-picker";

const FORM_ID = "invite-staff-form";

export function InviteDialog({
  open,
  onClose,
  orgId,
  roles,
  locations,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  roles: RoleOption[];
  locations: LocationOption[];
  onDone: (emailSent: boolean) => void;
}) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [allLocations, setAllLocations] = useState(false);
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const input = {
      orgId,
      email,
      roleId,
      allLocations,
      locationIds: allLocations ? [] : locationIds,
    };
    // The same schema the server runs: catch what we can before the round trip.
    const parsed = inviteSchema.safeParse(input);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "form");
        if (!next[field] && issue.message in messages.en) next[field] = t(issue.message);
      }
      setErrors(next);
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await inviteStaff(input);
      if (result.ok) {
        onDone(result.data.emailSent);
        return;
      }
      const next: Record<string, string> = {};
      for (const field of ["email", "roleId", "locationIds"]) {
        const key = fieldMessageKey(result.error, field);
        if (key) next[field] = t(key);
      }
      setErrors(next);
      if (Object.keys(next).length === 0) setFormError(t(errorMessageKey(result.error)));
      else if (result.error.fieldErrors?.form) setFormError(t(errorMessageKey(result.error)));
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t("common.close")}
      dismissOnBackdrop={false}
      title={t("staff.screen.invite")}
      description={t("staff.screen.invite.description")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={FORM_ID} loading={pending}>
            {t("staff.screen.invite.submit")}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} noValidate className="flex flex-col gap-4">
        {formError && (
          <p role="alert" className="rounded-md bg-danger-50 p-3 text-body-sm text-danger-700">
            {formError}
          </p>
        )}
        <Field label={t("staff.screen.col.email")} required error={errors.email}>
          <Input
            type="email"
            autoComplete="off"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label={t("staff.screen.col.role")} required error={errors.roleId}>
          <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="" disabled>
              {t("staff.screen.role.choose")}
            </option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox
          label={t("staff.screen.locations.all")}
          checked={allLocations}
          onChange={(e) => setAllLocations(e.target.checked)}
        />
        <LocationsPicker
          locations={locations}
          selected={locationIds}
          onChange={setLocationIds}
          disabled={allLocations}
          error={errors.locationIds}
        />
      </form>
    </Modal>
  );
}
