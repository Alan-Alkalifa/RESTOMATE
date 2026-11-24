"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useI18n } from "@/components/i18n/provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Table, TBody, TD, THead, TH, TR } from "@/components/ui/table";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { deleteRole } from "@/lib/actions/roles/actions";
import { messages } from "@/messages";
import { holdsAll, type RoleView } from "../_lib/groups";
import { RoleDialog } from "./role-dialog";

export type RolesScreenProps = {
  orgId: string;
  slug: string;
  roles: RoleView[];
  /** Permission keys the caller holds. */
  held: string[];
  /** The package includes custom roles. Without it create and edit are locked; delete stays. */
  canCustomize: boolean;
};

export function RolesScreen(props: RolesScreenProps) {
  const { t } = useI18n();
  return (
    <ToastProvider dismissLabel={t("common.dismiss")}>
      <RolesContent {...props} />
    </ToastProvider>
  );
}

type Dialog =
  | { mode: "create" }
  | { mode: "edit" | "view"; role: RoleView }
  | { mode: "delete"; role: RoleView }
  | null;

function RolesContent({ orgId, slug, roles, held, canCustomize }: RolesScreenProps) {
  const { t, number } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pending, startTransition] = useTransition();
  const heldSet = new Set(held);

  function remove(role: RoleView) {
    startTransition(async () => {
      const result = await deleteRole({ orgId, roleId: role.id });
      if (!result.ok) {
        const key =
          Object.values(result.error.fieldErrors ?? {}).flat()[0] ?? `error.${result.error.code}`;
        toast.show({ tone: "error", title: t(key in messages.en ? key : "error.unknown") });
        setDialog(null);
        return;
      }
      setDialog(null);
      toast.show({ tone: "success", title: t("roles.screen.deleted") });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1 text-text">{t("roles.screen.title")}</h1>
          <p className="text-body text-text-secondary">{t("roles.screen.subtitle")}</p>
        </div>
        <Button disabled={!canCustomize} onClick={() => setDialog({ mode: "create" })}>
          {t("roles.screen.create")}
        </Button>
      </header>

      {!canCustomize && (
        <Card role="status" className="flex flex-col gap-2 bg-primary-soft">
          <h2 className="text-h3 text-text">{t("roles.screen.locked.title")}</h2>
          <p className="text-body text-text-secondary">{t("roles.feature_unavailable")}</p>
          <p className="text-body-sm text-text-secondary">{t("roles.screen.locked.description")}</p>
        </Card>
      )}

      {
        <p className="text-body-sm text-text-secondary">
          {t("roles.screen.assign_hint")}{" "}
          <Link
            href={`/app/${encodeURIComponent(slug)}/staff`}
            className="font-medium text-secondary-600 underline"
          >
            {t("roles.screen.assign_link")}
          </Link>
        </p>
      }

      <Table caption={t("roles.screen.caption")}>
        <THead>
          <TR className="max-md:hidden">
            <TH>{t("roles.screen.name")}</TH>
            <TH>{t("roles.screen.col.type")}</TH>
            <TH numeric>{t("roles.screen.col.permissions")}</TH>
            <TH numeric>{t("roles.screen.col.members")}</TH>
            <TH>
              <span className="sr-only">{t("staff.screen.col.actions")}</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {roles.map((role) => {
            const reach = holdsAll(heldSet, role);
            const editable = !role.isSystem && canCustomize && reach;
            return (
              <TR key={role.id}>
                <TD label={t("roles.screen.name")}>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-text">{role.name}</span>
                    {role.description && (
                      <span className="truncate text-text-secondary">{role.description}</span>
                    )}
                  </div>
                </TD>
                <TD label={t("roles.screen.col.type")}>
                  <Badge tone={role.isSystem ? "neutral" : "info"}>
                    {role.isSystem ? t("roles.screen.type.system") : t("roles.screen.type.custom")}
                  </Badge>
                </TD>
                <TD numeric label={t("roles.screen.col.permissions")}>
                  {number(role.permissions.length)}
                </TD>
                <TD numeric label={t("roles.screen.col.members")}>
                  {number(role.memberCount)}
                </TD>
                <TD className="md:text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    {editable ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDialog({ mode: "edit", role })}
                      >
                        {t("staff.screen.edit")}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDialog({ mode: "view", role })}
                      >
                        {t("roles.screen.view")}
                      </Button>
                    )}
                    {!role.isSystem && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!reach}
                        title={!reach ? t("roles.permissions.not_held") : undefined}
                        onClick={() => setDialog({ mode: "delete", role })}
                      >
                        {t("roles.screen.delete")}
                      </Button>
                    )}
                  </div>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>

      {dialog && (dialog.mode === "create" || dialog.mode === "edit" || dialog.mode === "view") && (
        <RoleDialog
          key={dialog.mode === "create" ? "new" : dialog.role.id}
          mode={dialog.mode}
          role={dialog.mode === "create" ? undefined : dialog.role}
          orgId={orgId}
          held={held}
          onClose={() => setDialog(null)}
          onDone={(kind) => {
            setDialog(null);
            toast.show({
              tone: "success",
              title: t(kind === "created" ? "roles.screen.created" : "roles.screen.updated"),
            });
            router.refresh();
          }}
        />
      )}

      <Modal
        open={dialog?.mode === "delete"}
        onClose={() => setDialog(null)}
        closeLabel={t("common.close")}
        title={
          dialog?.mode === "delete"
            ? t("roles.screen.delete.title", { name: dialog.role.name })
            : ""
        }
        description={t("roles.screen.delete.description")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() => dialog?.mode === "delete" && remove(dialog.role)}
            >
              {t("roles.screen.delete")}
            </Button>
          </>
        }
      >
        <span className="sr-only">{t("staff.screen.confirm")}</span>
      </Modal>
    </div>
  );
}
