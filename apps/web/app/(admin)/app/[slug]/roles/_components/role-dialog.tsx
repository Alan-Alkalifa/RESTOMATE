"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/provider";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { createRole, updateRole } from "@/lib/actions/roles/actions";
import { PERMISSIONS_SUBMITTED } from "@/lib/actions/roles/schemas";
import { messages } from "@/messages";
import { PERMISSION_GROUPS, permissionLabelKey, type RoleView } from "../_lib/groups";

const FORM_ID = "role-form";

function messageKeyFor(error: { code: string; fieldErrors?: Record<string, string[]> }): string {
  const specific = Object.values(error.fieldErrors ?? {}).flat()[0];
  if (specific && specific in messages.en) return specific;
  const byCode = `error.${error.code}`;
  return byCode in messages.en ? byCode : "error.unknown";
}

/**
 * Create, edit or view a role. A built-in role is always read-only (the checklist is shown, ticked
 * and disabled). Permissions the caller doesn't hold are disabled too: nobody can hand out more than
 * they have. This is a convenience; the server and the database check it again.
 */
export function RoleDialog({
  mode,
  role,
  orgId,
  held,
  onClose,
  onDone,
}: {
  mode: "create" | "edit" | "view";
  role?: RoleView;
  orgId: string;
  /** The permission keys the caller holds. */
  held: string[];
  onClose: () => void;
  onDone: (kind: "created" | "updated") => void;
}) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [permissions, setPermissions] = useState<string[]>(role?.permissions ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const readOnly = mode === "view";

  function toggle(key: string, on: boolean) {
    setPermissions((cur) => (on ? [...cur, key] : cur.filter((k) => k !== key)));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      // `permissions_submitted` makes "uncheck the last box and save" clear the list (roles.md).
      const input = {
        orgId,
        ...(mode === "edit" && role ? { roleId: role.id } : {}),
        name,
        description,
        permissions,
        [PERMISSIONS_SUBMITTED]: "1",
      };
      const result = mode === "edit" ? await updateRole(input) : await createRole(input);
      if (result.ok) return onDone(mode === "edit" ? "updated" : "created");

      const next: Record<string, string> = {};
      for (const field of ["name", "description", "permissions"]) {
        const key = result.error.fieldErrors?.[field]?.[0];
        if (key && key in messages.en) next[field] = t(key);
      }
      setErrors(next);
      // Anything not tied to a field (plan, escalation on the whole form, a system role).
      if (!next.name && !next.description && !next.permissions) {
        setFormError(t(messageKeyFor(result.error)));
      }
    });
  }

  const title =
    mode === "create"
      ? t("roles.screen.create")
      : mode === "edit"
        ? t("roles.screen.edit.title", { name: role?.name ?? "" })
        : (role?.name ?? "");

  return (
    <Modal
      open
      size="wide"
      onClose={onClose}
      closeLabel={t("common.close")}
      dismissOnBackdrop={readOnly}
      title={title}
      description={readOnly ? t("roles.screen.view.description") : undefined}
      footer={
        readOnly ? (
          <Button variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" form={FORM_ID} loading={pending}>
              {mode === "create" ? t("roles.screen.create.submit") : t("common.save")}
            </Button>
          </>
        )
      }
    >
      <form id={FORM_ID} onSubmit={submit} noValidate className="flex flex-col gap-5">
        {formError && (
          <p role="alert" className="rounded-md bg-danger-50 p-3 text-body-sm text-danger-700">
            {formError}
          </p>
        )}
        {!readOnly && (
          <>
            <Field label={t("roles.screen.name")} required error={errors.name}>
              <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t("roles.screen.description")} error={errors.description}>
              <Textarea
                rows={2}
                maxLength={300}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
          </>
        )}
        {role?.description && readOnly && (
          <p className="text-body text-text-secondary">{role.description}</p>
        )}
        <div className="flex flex-col gap-4">
          <h3 className="text-h3 text-text">{t("roles.screen.permissions")}</h3>
          {!readOnly && (
            <p className="text-body-sm text-text-secondary">
              {t("roles.screen.permissions.helper")}
            </p>
          )}
          {errors.permissions && (
            <p role="alert" className="text-body-sm text-danger-700">
              {errors.permissions}
            </p>
          )}
          {PERMISSION_GROUPS.map((group) => (
            <fieldset key={group.id} className="flex flex-col" disabled={readOnly}>
              <legend className="mb-1 text-body-sm font-semibold text-text">
                {t(group.labelKey)}
              </legend>
              {group.keys.map((key) => {
                const checked = permissions.includes(key);
                // Can't give what you don't hold. A permission the role already has stays visible.
                const notHeld = !readOnly && !held.includes(key);
                return (
                  <Checkbox
                    key={key}
                    label={t(permissionLabelKey(key))}
                    helper={notHeld ? t("roles.screen.not_held") : undefined}
                    checked={checked}
                    disabled={readOnly || notHeld}
                    onChange={(e) => toggle(key, e.target.checked)}
                  />
                );
              })}
            </fieldset>
          ))}
        </div>
      </form>
    </Modal>
  );
}
