"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/provider";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { checkSlug, createOrganization } from "@/lib/actions/organization/actions";
import {
  DEFAULT_TIMEZONE,
  createOrganizationSchema,
  isValidSlug,
  isValidTimezone,
  normalizeSlug,
  type SlugReason,
} from "@/lib/actions/organization/schemas";

const AFTER_CREATE = "/app";
const SLUG_DEBOUNCE_MS = 400;
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN;

/** Indonesian zones first (the contract's order), then the rest. */
const INDONESIA = [
  ["Asia/Jakarta", "onboarding.tz.wib"],
  ["Asia/Makassar", "onboarding.tz.wita"],
  ["Asia/Jayapura", "onboarding.tz.wit"],
] as const;

let otherZones: string[] | null = null;
function readOtherZones(): string[] {
  if (otherZones) return otherZones;
  const first = new Set<string>(INDONESIA.map(([zone]) => zone));
  const all =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  otherZones = ["UTC", ...all].filter((zone) => !first.has(zone) && isValidTimezone(zone));
  return otherZones;
}
const noSubscribe = () => () => {};
const NO_ZONES: string[] = [];
/** The browser's list, after hydration (server and browser ICU lists can differ). */
function useOtherZones(): string[] {
  return useSyncExternalStore(noSubscribe, readOtherZones, () => NO_ZONES);
}

/** "Nasi Kita & Co" becomes "nasi-kita-co". Only a suggestion; the user can change it. */
function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** "11" or "11,5" (a percentage) to basis points as text. Anything else goes to the server as typed. */
function percentToBps(raw: string): string {
  const text = raw.trim().replace(",", ".");
  if (text === "") return "";
  return /^\d+(\.\d{1,2})?$/.test(text) ? String(Math.round(Number(text) * 100)) : raw.trim();
}

type SlugState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available" }
  | { status: "unavailable"; reason: SlugReason }
  | { status: "unchecked" };

const SLUG_MESSAGE: Record<SlugReason, string> = {
  SLUG_INVALID: "org.slug.invalid",
  SLUG_RESERVED: "org.slug.reserved",
  SLUG_TAKEN: "org.slug.taken",
};

type Values = {
  name: string;
  slug: string;
  timezone: string;
  locationName: string;
  address: string;
  taxPercent: string;
  servicePercent: string;
  taxOnService: boolean;
};

type FormError = { code: string; fieldErrors?: Record<string, string[]> };

export function CreateRestaurantForm() {
  const { t } = useI18n();
  const router = useRouter();
  const [values, setValues] = useState<Values>({
    name: "",
    slug: "",
    timezone: DEFAULT_TIMEZONE,
    locationName: "",
    address: "",
    taxPercent: "11",
    servicePercent: "0",
    taxOnService: false,
  });
  const [slugEdited, setSlugEdited] = useState(false);
  const [slugState, setSlugState] = useState<SlugState>({ status: "idle" });
  const [error, setError] = useState<FormError | null>(null);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const otherTimezones = useOtherZones();

  const slug = normalizeSlug(values.slug);

  // Live check: a local check first (no request for an obviously bad address), then the server's answer.
  useEffect(() => {
    if (slug === "" || !isValidSlug(slug)) return;
    let current = true;
    const timer = setTimeout(async () => {
      setSlugState({ status: "checking" });
      try {
        const result = await checkSlug(slug);
        if (!current) return;
        if (!result.ok) setSlugState({ status: "unchecked" });
        else if (result.data.available) setSlugState({ status: "available" });
        else setSlugState({ status: "unavailable", reason: result.data.reason ?? "SLUG_INVALID" });
      } catch {
        if (current) setSlugState({ status: "unchecked" });
      }
    }, SLUG_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [slug]);

  function set<K extends keyof Values>(name: K, value: Values[K]) {
    setValues((all) => ({ ...all, [name]: value }));
    setError((current) => {
      if (!current?.fieldErrors) return current;
      const rest = { ...current.fieldErrors };
      delete rest[
        name === "taxPercent" ? "taxBps" : name === "servicePercent" ? "serviceChargeBps" : name
      ];
      return { ...current, fieldErrors: rest };
    });
  }

  function onName(name: string) {
    setValues((all) => ({ ...all, name, slug: slugEdited ? all.slug : slugify(name) }));
    setSlugState({ status: "idle" });
  }

  function onSlug(raw: string) {
    setSlugEdited(true);
    set("slug", raw);
    setSlugState({ status: "idle" });
  }

  function payload() {
    return {
      name: values.name,
      slug: values.slug,
      timezone: values.timezone,
      locationName: values.locationName,
      address: values.address,
      taxBps: percentToBps(values.taxPercent),
      serviceChargeBps: percentToBps(values.servicePercent),
      taxOnService: values.taxOnService,
    };
  }

  function submit() {
    if (pending || done) return;
    const input = payload();
    const parsed = createOrganizationSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        (fieldErrors[String(issue.path[0] ?? "form")] ??= []).push(issue.message);
      }
      setError({ code: "validation", fieldErrors });
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await createOrganization(input);
        if (result.ok) {
          setDone(true); // keep the button busy until the page changes
          router.push(AFTER_CREATE);
        } else setError(result.error);
      } catch {
        setError({ code: "unavailable" });
      }
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  const fieldError = (name: string): string | undefined => {
    const key = error?.fieldErrors?.[name]?.[0];
    return key ? t(key) : undefined;
  };

  // A message under the address: the server's refusal, else the live check, else a hint.
  const slugMessage = (() => {
    const own = fieldError("slug");
    if (own) return { error: own };
    if (slug !== "" && !isValidSlug(slug)) return { error: t("org.slug.invalid") };
    if (slugState.status === "unavailable") return { error: t(SLUG_MESSAGE[slugState.reason]) };
    return {};
  })();
  const slugHelper =
    slugState.status === "checking"
      ? t("onboarding.slug.checking")
      : slugState.status === "available"
        ? t("onboarding.slug.available")
        : slugState.status === "unchecked"
          ? t("onboarding.slug.unchecked")
          : t("onboarding.field.slug_helper");

  const formKey = error?.fieldErrors?.form?.[0];
  const bannerCode = error && error.code !== "validation" ? error.code : null;
  const showBanner = formKey || bannerCode;
  const retryable = bannerCode === "unavailable" || bannerCode === "unknown";

  return (
    <Card className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-h2 text-text">{t("onboarding.title")}</h1>
        <p className="text-body text-text-secondary">{t("onboarding.subtitle")}</p>
      </div>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 text-h3 text-text">{t("onboarding.section.restaurant")}</legend>
          <Field label={t("onboarding.field.name")} error={fieldError("name")} required>
            <Input
              name="name"
              autoComplete="organization"
              autoFocus
              value={values.name}
              onChange={(event) => onName(event.target.value)}
            />
          </Field>
          <Field
            label={t("onboarding.field.slug")}
            helper={slugHelper}
            error={slugMessage.error}
            required
          >
            <Input
              name="slug"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              suffix={ROOT_DOMAIN ? `.${ROOT_DOMAIN}` : undefined}
              value={values.slug}
              onChange={(event) => onSlug(event.target.value)}
            />
          </Field>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 text-h3 text-text">{t("onboarding.section.location")}</legend>
          <Field
            label={t("onboarding.field.location_name")}
            helper={t("onboarding.field.location_name_helper")}
            error={fieldError("locationName")}
          >
            <Input
              name="locationName"
              value={values.locationName}
              onChange={(event) => set("locationName", event.target.value)}
            />
          </Field>
          <Field
            label={`${t("onboarding.field.address")} (${t("onboarding.field.optional")})`}
            error={fieldError("address")}
          >
            <Textarea
              name="address"
              autoComplete="street-address"
              rows={3}
              value={values.address}
              onChange={(event) => set("address", event.target.value)}
            />
          </Field>
          <Field label={t("onboarding.field.timezone")} error={fieldError("timezone")}>
            <Select
              name="timezone"
              value={values.timezone}
              onChange={(event) => set("timezone", event.target.value)}
            >
              {INDONESIA.map(([zone, key]) => (
                <option key={zone} value={zone}>
                  {t(key)}
                </option>
              ))}
              {otherTimezones.length > 0 ? (
                <optgroup label={t("onboarding.field.timezone_other")}>
                  {otherTimezones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          </Field>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 text-h3 text-text">{t("onboarding.section.tax")}</legend>
          <Field
            label={t("onboarding.field.tax")}
            helper={t("onboarding.field.tax_helper")}
            error={fieldError("taxBps")}
          >
            <Input
              name="tax"
              inputMode="decimal"
              numeric
              suffix="%"
              value={values.taxPercent}
              onChange={(event) => set("taxPercent", event.target.value)}
            />
          </Field>
          <Field
            label={t("onboarding.field.service")}
            helper={t("onboarding.field.service_helper")}
            error={fieldError("serviceChargeBps")}
          >
            <Input
              name="service"
              inputMode="decimal"
              numeric
              suffix="%"
              value={values.servicePercent}
              onChange={(event) => set("servicePercent", event.target.value)}
            />
          </Field>
          <Checkbox
            name="taxOnService"
            label={t("onboarding.field.tax_on_service")}
            checked={values.taxOnService}
            onChange={(event) => set("taxOnService", event.target.checked)}
          />
        </fieldset>

        {showBanner ? (
          <ErrorState
            title={formKey ? t(formKey) : t(`error.${bannerCode}`)}
            retryLabel={retryable ? t("common.retry") : undefined}
            onRetry={retryable ? submit : undefined}
            retrying={pending}
          />
        ) : null}
        <Button type="submit" size="lg" loading={pending || done} className="w-full">
          {t("onboarding.submit")}
        </Button>
      </form>
    </Card>
  );
}
