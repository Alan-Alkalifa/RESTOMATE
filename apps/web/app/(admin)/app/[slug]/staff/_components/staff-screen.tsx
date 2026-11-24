"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useI18n } from "@/components/i18n/provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { Table, TBody, TD, THead, TH, TR } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { ToastProvider, useToast } from "@/components/ui/toast";
import {
  deactivateMember,
  reactivateMember,
  resendInvitation,
  revokeInvitation,
  type InvitationRow,
  type MemberRow,
} from "@/lib/actions/staff/actions";
import {
  errorMessageKey,
  reachesAllLocations,
  type LocationOption,
  type RoleOption,
} from "../_lib/model";
import { seatsUsed } from "../_lib/model";
import { InviteDialog } from "./invite-dialog";
import { EditMemberDialog } from "./edit-member-dialog";

export type StaffScreenProps = {
  orgId: string;
  members: MemberRow[];
  invitations: InvitationRow[];
  roles: RoleOption[];
  locations: LocationOption[];
  /** `null` = unlimited. */
  maxStaff: number | null;
  timeZone: string;
};

export function StaffScreen(props: StaffScreenProps) {
  const { t } = useI18n();
  return (
    <ToastProvider dismissLabel={t("common.dismiss")}>
      <StaffContent {...props} />
    </ToastProvider>
  );
}

type Confirm =
  { kind: "deactivate"; member: MemberRow } | { kind: "revoke"; invitation: InvitationRow } | null;

function StaffContent({
  orgId,
  members,
  invitations,
  roles,
  locations,
  maxStaff,
  timeZone,
}: StaffScreenProps) {
  const { t, date, number } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const used = seatsUsed(members, invitations);
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name;

  function run(
    id: string,
    action: () => Promise<
      { ok: true; data?: unknown } | { ok: false; error: Parameters<typeof errorMessageKey>[0] }
    >,
    successKey: string,
  ) {
    setBusyId(id);
    startTransition(async () => {
      const result = await action();
      setBusyId(null);
      if (!result.ok) {
        toast.show({ tone: "error", title: t(errorMessageKey(result.error)) });
        // The data may have moved on (already closed, already active): show what is true now.
        router.refresh();
        return;
      }
      const data = result.data as { emailSent?: boolean } | undefined;
      if (data && data.emailSent === false) {
        toast.show({ tone: "warning", title: t("staff.screen.email_failed") });
      } else {
        toast.show({ tone: "success", title: t(successKey) });
      }
      setConfirm(null);
      router.refresh();
    });
  }

  function locationsText(m: MemberRow): string {
    if (reachesAllLocations(m.roleKey)) return t("staff.screen.locations.all");
    const names = m.locationIds.map(locationName).filter(Boolean);
    return names.length ? names.join(", ") : t("staff.screen.locations.none");
  }

  function inviteLocationsText(i: InvitationRow): string {
    if (i.allLocations) return t("staff.screen.locations.all");
    const names = i.locationIds.map(locationName).filter(Boolean);
    return names.length ? names.join(", ") : t("staff.screen.locations.none");
  }

  const membersPanel =
    members.length === 0 ? (
      <EmptyState
        title={t("staff.screen.members.empty.title")}
        description={t("staff.screen.members.empty.description")}
      />
    ) : (
      <Table caption={t("staff.screen.members.caption")}>
        <THead>
          <TR className="max-md:hidden">
            <TH>{t("staff.screen.col.person")}</TH>
            <TH>{t("staff.screen.col.role")}</TH>
            <TH>{t("staff.screen.col.locations")}</TH>
            <TH>{t("staff.screen.col.status")}</TH>
            <TH>
              <span className="sr-only">{t("staff.screen.col.actions")}</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {members.map((m) => {
            const name = m.fullName ?? m.email ?? t("staff.screen.unnamed");
            return (
              <TR key={m.memberId}>
                <TD label={t("staff.screen.col.person")}>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-text">
                      {name}
                      {m.isSelf && (
                        <span className="ml-2 text-caption text-text-muted">
                          {t("staff.screen.you")}
                        </span>
                      )}
                    </span>
                    {m.fullName && m.email && (
                      <span className="truncate text-text-secondary">{m.email}</span>
                    )}
                  </div>
                </TD>
                <TD label={t("staff.screen.col.role")}>{m.roleName}</TD>
                <TD label={t("staff.screen.col.locations")}>{locationsText(m)}</TD>
                <TD label={t("staff.screen.col.status")}>
                  <Badge tone={m.status === "active" ? "success" : "neutral-muted"}>
                    {t(`staff.screen.status.${m.status}`)}
                  </Badge>
                </TD>
                <TD className="md:text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    {/* Your own row is read-only: changing your own role or status is refused. */}
                    {m.status === "active" ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={m.isSelf}
                          title={m.isSelf ? t("staff.member.self") : undefined}
                          onClick={() => setEditing(m)}
                        >
                          {t("staff.screen.edit")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={m.isSelf}
                          title={m.isSelf ? t("staff.member.self") : undefined}
                          onClick={() => setConfirm({ kind: "deactivate", member: m })}
                        >
                          {t("staff.screen.deactivate")}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={m.isSelf}
                        loading={pending && busyId === m.memberId}
                        onClick={() =>
                          run(
                            m.memberId,
                            () => reactivateMember({ orgId, memberId: m.memberId }),
                            "staff.screen.reactivated",
                          )
                        }
                      >
                        {t("staff.screen.reactivate")}
                      </Button>
                    )}
                  </div>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    );

  const invitationsPanel =
    invitations.length === 0 ? (
      <EmptyState
        title={t("staff.screen.invites.empty.title")}
        description={t("staff.screen.invites.empty.description")}
        action={<Button onClick={() => setInviting(true)}>{t("staff.screen.invite")}</Button>}
      />
    ) : (
      <Table caption={t("staff.screen.invites.caption")}>
        <THead>
          <TR className="max-md:hidden">
            <TH>{t("staff.screen.col.email")}</TH>
            <TH>{t("staff.screen.col.role")}</TH>
            <TH>{t("staff.screen.col.locations")}</TH>
            <TH>{t("staff.screen.col.status")}</TH>
            <TH>{t("staff.screen.col.expires")}</TH>
            <TH>
              <span className="sr-only">{t("staff.screen.col.actions")}</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {invitations.map((i) => {
            const resendable = i.status === "open" || i.status === "expired";
            return (
              <TR key={i.id}>
                <TD label={t("staff.screen.col.email")}>
                  <span className="truncate font-medium text-text">{i.email}</span>
                </TD>
                <TD label={t("staff.screen.col.role")}>
                  {i.roleName ?? t("staff.screen.role_deleted")}
                </TD>
                <TD label={t("staff.screen.col.locations")}>{inviteLocationsText(i)}</TD>
                <TD label={t("staff.screen.col.status")}>
                  <Badge
                    tone={
                      i.status === "open"
                        ? "info"
                        : i.status === "accepted"
                          ? "success"
                          : i.status === "expired"
                            ? "warning"
                            : "neutral-muted"
                    }
                  >
                    {t(`staff.screen.invite_status.${i.status}`)}
                  </Badge>
                </TD>
                <TD label={t("staff.screen.col.expires")}>{date(i.expiresAt, timeZone, "date")}</TD>
                <TD className="md:text-right">
                  {resendable && (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        loading={pending && busyId === i.id}
                        onClick={() =>
                          run(
                            i.id,
                            () => resendInvitation({ orgId, invitationId: i.id }),
                            "staff.screen.resent",
                          )
                        }
                      >
                        {t("staff.screen.resend")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirm({ kind: "revoke", invitation: i })}
                      >
                        {t("staff.screen.revoke")}
                      </Button>
                    </div>
                  )}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    );

  const confirming = confirm;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1 text-text">{t("staff.screen.title")}</h1>
          <p className="text-body text-text-secondary">
            {maxStaff === null
              ? t("staff.screen.seats.unlimited", { used: number(used) })
              : t("staff.screen.seats", { used: number(used), max: number(maxStaff) })}
          </p>
        </div>
        <Button onClick={() => setInviting(true)}>{t("staff.screen.invite")}</Button>
      </header>

      {maxStaff !== null && used >= maxStaff && (
        <Card role="status" className="border-warning-700/30 bg-warning-50">
          <p className="text-body text-warning-700">{t("staff.plan_limit.staff")}</p>
        </Card>
      )}

      <Tabs
        label={t("staff.screen.tabs")}
        tabs={[
          {
            id: "members",
            label: t("staff.screen.tab.members", { count: members.length }),
            panel: membersPanel,
          },
          {
            id: "invitations",
            label: t("staff.screen.tab.invitations", { count: invitations.length }),
            panel: invitationsPanel,
          },
        ]}
      />

      <InviteDialog
        key={inviting ? "open" : "closed"}
        open={inviting}
        onClose={() => setInviting(false)}
        orgId={orgId}
        roles={roles}
        locations={locations}
        onDone={(emailSent) => {
          setInviting(false);
          toast.show(
            emailSent
              ? { tone: "success", title: t("staff.screen.invited") }
              : { tone: "warning", title: t("staff.screen.email_failed") },
          );
          router.refresh();
        }}
      />
      {editing && (
        <EditMemberDialog
          key={editing.memberId}
          member={editing}
          orgId={orgId}
          roles={roles}
          locations={locations}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            toast.show({ tone: "success", title: t("staff.screen.saved") });
            router.refresh();
          }}
        />
      )}

      <Modal
        open={confirming !== null}
        onClose={() => setConfirm(null)}
        closeLabel={t("common.close")}
        title={
          confirming?.kind === "deactivate"
            ? t("staff.screen.deactivate.title", {
                name:
                  confirming.member.fullName ??
                  confirming.member.email ??
                  t("staff.screen.unnamed"),
              })
            : confirming?.kind === "revoke"
              ? t("staff.screen.revoke.title", { email: confirming.invitation.email })
              : ""
        }
        description={
          confirming?.kind === "deactivate"
            ? t("staff.screen.deactivate.description")
            : t("staff.screen.revoke.description")
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() => {
                if (!confirming) return;
                if (confirming.kind === "deactivate") {
                  run(
                    confirming.member.memberId,
                    () => deactivateMember({ orgId, memberId: confirming.member.memberId }),
                    "staff.screen.deactivated",
                  );
                } else {
                  run(
                    confirming.invitation.id,
                    () => revokeInvitation({ orgId, invitationId: confirming.invitation.id }),
                    "staff.screen.revoked",
                  );
                }
              }}
            >
              {confirming?.kind === "deactivate"
                ? t("staff.screen.deactivate")
                : t("staff.screen.revoke")}
            </Button>
          </>
        }
      >
        <span className="sr-only">{t("staff.screen.confirm")}</span>
      </Modal>
    </div>
  );
}
