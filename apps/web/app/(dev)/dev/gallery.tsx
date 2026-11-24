"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Checkbox, Field, Input, Radio, Select, Switch, Textarea } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { OfflineBar } from "@/components/ui/offline-bar";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton, SkeletonGroup, SkeletonText } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { ToastProvider, useToast } from "@/components/ui/toast";

// Sample text for review only. Product screens get their strings from the translations (M0-FE-03).
const BUTTON_VARIANTS = ["primary", "spotlight", "soft", "outline", "ghost", "danger"] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`s-${title}`} className="flex flex-col gap-4">
      <h2 id={`s-${title}`} className="text-h2">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Overlays() {
  const [modal, setModal] = useState(false);
  const [sheet, setSheet] = useState(false);
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-3">
      <Button variant="soft" onClick={() => setModal(true)}>
        Open modal
      </Button>
      <Button variant="soft" onClick={() => setSheet(true)}>
        Open sheet
      </Button>
      <Button variant="outline" onClick={() => toast.show({ tone: "success", title: "Saved" })}>
        Success toast
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast.show({
            tone: "error",
            title: "Could not save",
            description: "Check your connection and try again.",
          })
        }
      >
        Error toast
      </Button>
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Void 2 × Nasi Goreng?"
        description="This cannot be undone."
        closeLabel="Close"
        footer={
          <>
            <Button variant="outline" onClick={() => setModal(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => setModal(false)}>
              Void order
            </Button>
          </>
        }
      >
        <p className="text-body">The order goes back to the kitchen as cancelled.</p>
      </Modal>
      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="Edit item"
        closeLabel="Close"
        footer={<Button onClick={() => setSheet(false)}>Save</Button>}
      >
        <Field label="Name">
          <Input defaultValue="Nasi Goreng" />
        </Field>
      </Sheet>
    </div>
  );
}

export function DevGallery() {
  const [loading, setLoading] = useState(false);
  return (
    <ToastProvider dismissLabel="Dismiss">
      <OfflineBar
        online={false}
        offlineMessage="Offline. Your cart is saved on this device and will sync when you're back online."
        backOnlineMessage="Back online"
      />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 p-page md:p-page-md">
        <h1 className="text-h1">Base components</h1>

        <Section title="Buttons">
          {(["sm", "md", "lg"] as const).map((size) => (
            <div key={size} className="flex flex-wrap items-center gap-3">
              {BUTTON_VARIANTS.map((variant) => (
                <Button key={variant} variant={variant} size={size}>
                  {variant}
                </Button>
              ))}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled>Disabled</Button>
            <Button
              loading={loading}
              onClick={() => {
                setLoading(true);
                setTimeout(() => setLoading(false), 1500);
              }}
            >
              Save changes
            </Button>
            <Button variant="soft" icon={<Icon name="check" />}>
              With icon
            </Button>
            <IconButton label="Close" icon={<Icon name="close" />} />
          </div>
        </Section>

        <Section title="Fields">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Restaurant name" helper="Shown on your customer site." required>
              <Input placeholder="Warung Sari" />
            </Field>
            <Field label="Email" error="Enter a valid email address.">
              <Input defaultValue="not-an-email" />
            </Field>
            <Field label="Price">
              <Input prefix="Rp" numeric defaultValue="25000" inputMode="numeric" />
            </Field>
            <Field label="Disabled">
              <Input disabled defaultValue="Locked" />
            </Field>
            <Field label="Category">
              <Select defaultValue="main">
                <option value="main">Main course</option>
                <option value="drink">Drinks</option>
              </Select>
            </Field>
            <Field label="Notes">
              <Textarea />
            </Field>
          </div>
          <div className="flex flex-wrap gap-6">
            <Checkbox label="Dine-in" defaultChecked />
            <Checkbox label="Takeaway" />
            <Radio name="size" label="Small" defaultChecked />
            <Radio name="size" label="Large" />
            <Switch label="Accept online orders" defaultChecked />
          </div>
        </Section>

        <Section title="Cards and badges">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardTitle>Default</CardTitle>
              <p className="text-body-sm text-text-secondary">White surface, border, shadow.</p>
            </Card>
            <Card interactive>
              <CardTitle>Interactive</CardTitle>
              <p className="text-body-sm text-text-secondary">Lifts on hover.</p>
            </Card>
            <Card selected>
              <CardTitle>Selected</CardTitle>
              <p className="text-body-sm text-text-secondary">Secondary border and tint.</p>
            </Card>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="info">Placed</Badge>
            <Badge tone="warning">Preparing</Badge>
            <Badge tone="success" icon={<Icon name="check" size={14} />}>
              Ready
            </Badge>
            <Badge tone="neutral">Served</Badge>
            <Badge tone="neutral-muted">Completed</Badge>
            <Badge tone="danger">Cancelled</Badge>
            <Badge tone="accent">New</Badge>
          </div>
        </Section>

        <Section title="Tabs">
          <Tabs
            label="Order status"
            tabs={[
              { id: "open", label: "Open", panel: <p>Open orders</p> },
              { id: "done", label: "Done", panel: <p>Finished orders</p> },
              { id: "off", label: "Archived", panel: <p>Archive</p>, disabled: true },
            ]}
          />
        </Section>

        <Section title="Table">
          <Table caption="Orders">
            <THead>
              <TR>
                <TH>Order</TH>
                <TH>Status</TH>
                <TH numeric>Total</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD label="Order">#1042</TD>
                <TD label="Status">
                  <Badge tone="success">Ready</Badge>
                </TD>
                <TD numeric label="Total">
                  Rp 125.000
                </TD>
              </TR>
              <TR selected>
                <TD label="Order">#1043</TD>
                <TD label="Status">
                  <Badge tone="warning">Preparing</Badge>
                </TD>
                <TD numeric label="Total">
                  Rp 48.000
                </TD>
              </TR>
            </TBody>
          </Table>
        </Section>

        <Section title="Overlays">
          <Overlays />
        </Section>

        <Section title="States">
          <SkeletonGroup label="Loading orders" className="flex flex-col gap-3">
            <Skeleton className="h-8 w-1/3" />
            <SkeletonText lines={3} />
          </SkeletonGroup>
          <Card padding="none">
            <EmptyState
              title="No tables yet"
              description="Add your first area to start your floor plan."
              action={<Button>Add area</Button>}
            />
          </Card>
          <ErrorState
            title="We could not load orders"
            description="Check your connection, then try again."
            retryLabel="Try again"
            onRetry={() => {}}
          />
        </Section>
      </main>
    </ToastProvider>
  );
}
