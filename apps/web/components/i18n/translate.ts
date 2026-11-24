import type { MessageKey, Messages } from "@/messages";
import { messages } from "@/messages";
import { DEFAULT_LOCALE, type Locale } from "./locale";

export type Params = Record<string, string | number>;
export type Translate = (key: MessageKey | (string & {}), params?: Params) => string;

/**
 * `t("staff.member.self")`, `t("count.items", { count: 3 })`. With a `count`, `<key>.one` or `<key>.other`
 * is used when it exists. A missing key falls back to English, then to the key itself (never blank).
 * Params fill `{name}`; nothing a user typed belongs in a message key.
 */
export function createTranslate(
  locale: Locale,
  dictionary: Messages = messages[locale],
): Translate {
  const lookup = (key: string): string | undefined =>
    (dictionary as Record<string, string>)[key] ??
    (messages[DEFAULT_LOCALE] as Record<string, string>)[key];
  const rules = new Intl.PluralRules(locale);

  return (key, params) => {
    let text: string | undefined;
    if (params && typeof params.count === "number") {
      const form = rules.select(params.count) === "one" ? "one" : "other";
      text = lookup(`${key}.${form}`);
    }
    text ??= lookup(key) ?? key;
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in params ? String(params[name]) : whole,
    );
  };
}
