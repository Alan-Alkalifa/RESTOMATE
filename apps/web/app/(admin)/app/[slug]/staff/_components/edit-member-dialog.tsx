"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/provider";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { changeMemberRole, setMemberLocations, type MemberRow } from "@/lib/actions/staff/actions";
import {
  errorMessageKey,
  reachesAllLocations,
  type LocationOption,
  type RoleOption,
} from "../_lib/model";
import { LocationsPicker } from "./locations-picker";

const FORM_ID = "edit-member-form";

/** Change a member's role and, for roles that don't reach every location, where they work. */
export function EditMemberDialog({
  member,
  orgId,
  roles,
  locations,
  onClose,
  onDone,
}: {
  member: MemberRow;
  orgId: string;
  roles: RoleOption[];
  locations: LocationOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [roleId, setRoleId] = useState(member.roleId);
  const [locationIds, setLocationIds] = useState(member.locationIds);
  const [error, setError] = useState<string | null>(null);

  // Whether a different role reaches every location is the server's rule; only the current role is known here.
  const allReach = reachesAllLocations(roleId === member.roleId ? member.roleKey : null);

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      if (roleId !== member.roleId) {
        const result = await changeMemberRole({ orgId, memberId: member.memberId, roleId });
        if (!result.ok) return setError(t(errorMessageKey(result.error)));
      }
      const before = [...member.locationIds].sort().join(",");
      const after = [...locationIds].sort().join(",");
      if (!allReach && before !== after) {
        const result = await setMemberLocations({ orgId, memberId: member.memberId, locationIds });
        if (!result.ok) return setError(t(errorMessageKey(result.error)));
      }
      onDone();
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      closeLabel={t("common.close")}
      dismissOnBackdrop={false}
      title={t("staff.screen.edit.title", {
        name: member.fullName ?? member.email ?? t("staff.screen.unnamed"),
      })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={FORM_ID} loading={pending}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="rounded-md bg-danger-50 p-3 text-body-sm text-danger-700">
            {error}
          </p>
        )}
        <Field label={t("staff.screen.col.role")} helper={t("staff.screen.edit.role_helper")}>
          <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        {allReach ? (
          <p className="text-body-sm text-text-secondary">{t("staff.screen.edit.all_reach")}</p>
        ) : (
          <LocationsPicker locations={locations} selected={locationIds} onChange={setLocationIds} />
        )}
      </form>
    </Modal>
  );
}
