"use client";

import { useState, useTransition, type FormEvent } from "react";
import type { ZodType } from "zod";
import type { ActionErrorCode, ActionResult } from "@/lib/auth";
import { useI18n } from "@/components/i18n/provider";

/**
 * The state of one auth form. Values live in React state, not in the DOM, so a refused submit keeps
 * everything the user typed (React resets uncontrolled fields after a form action). The same Zod
 * schema the server uses runs first; then the Server Action runs, and its answer is shown by code and
 * field message keys: the server sends no text.
 */

export type FormError = { code: ActionErrorCode; fieldErrors?: Record<string, string[]> };

type Options<V extends Record<string, string>, D> = {
  initial: V;
  schema: ZodType;
  /** Fixed extras sent with the values (`next`, `locale`). Never shown. */
  extra?: Record<string, unknown>;
  /** Calls the Server Action. It resolves to nothing when the action redirects. */
  submit: (input: Record<string, unknown>) => Promise<ActionResult<D> | void>;
  onSuccess?: (data: D, values: V) => void;
};

export function useAuthForm<V extends Record<string, string>, D = void>({
  initial,
  schema,
  extra,
  submit,
  onSuccess,
}: Options<V, D>) {
  const { t } = useI18n();
  const [values, setValues] = useState<V>(initial);
  const [error, setError] = useState<FormError | null>(null);
  const [pending, startTransition] = useTransition();

  function setValue<K extends keyof V>(name: K, value: V[K]) {
    setValues((all) => ({ ...all, [name]: value }));
    // Typing again clears that field's message, nothing else.
    setError((current) => {
      if (!current?.fieldErrors?.[name as string]) return current;
      const rest = { ...current.fieldErrors };
      delete rest[name as string];
      return { ...current, fieldErrors: rest };
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run();
  }

  /** Validates, then calls the action. Also used by the "Try again" button. */
  function run() {
    if (pending) return;
    const payload = { ...values, ...extra };
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const name = String(issue.path[0] ?? "form");
        (fieldErrors[name] ??= []).push(issue.message);
      }
      setError({ code: "validation", fieldErrors });
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await submit(payload);
        if (!result) return; // the action redirected
        if (result.ok) onSuccess?.(result.data, values);
        else setError(result.error);
      } catch {
        setError({ code: "unavailable" });
      }
    });
  }

  /** The first message of a field, translated, or undefined. */
  function fieldError(name: keyof V & string): string | undefined {
    const key = error?.fieldErrors?.[name]?.[0];
    return key ? t(key) : undefined;
  }

  return { values, setValue, error, setError, pending, onSubmit, run, fieldError };
}
