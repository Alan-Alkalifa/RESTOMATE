import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { messages } from "@/messages";
import { formatDate, formatMoney, formatNumber } from "./format";
import { intlTag, resolveLocale } from "./locale";
import { createTranslate } from "./translate";

const en = Object.keys(messages.en).sort();
const id = Object.keys(messages.id).sort();

describe("messages", () => {
  it("English and Bahasa Indonesia have the same keys", () => expect(id).toEqual(en));
  it("no text is empty and placeholders match", () => {
    for (const key of en) {
      const a = messages.en[key as keyof typeof messages.en];
      const b = messages.id[key as keyof typeof messages.id];
      expect(a.trim(), key).not.toBe("");
      expect(b.trim(), key).not.toBe("");
      const slots = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(slots(b), key).toEqual(slots(a));
    }
  });

  it("covers every message key and error code in docs/contracts and the action code list", () => {
    const dir = join(import.meta.dirname, "../../../../docs/contracts");
    const keys = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      const text = readFileSync(join(dir, file), "utf8");
      for (const m of text.matchAll(/`((?:auth|org|staff|roles)\.[a-z_.0-9]+)`/g)) keys.add(m[1]!);
    }
    expect(keys.size).toBeGreaterThan(30);
    expect([...keys].filter((k) => !(k in messages.en))).toEqual([]);

    const result = readFileSync(join(import.meta.dirname, "../../lib/auth/result.ts"), "utf8");
    const codes = [...result.matchAll(/\|\s+"([a-z_]+)"/g)].map((m) => m[1]!);
    expect(codes).toContain("validation");
    expect(codes.filter((c) => !(`error.${c}` in messages.en))).toEqual([]);
  });
});

describe("translate", () => {
  const t = createTranslate("id");
  it("translates, fills params and picks plural forms", () => {
    expect(t("common.close")).toBe("Tutup");
    expect(createTranslate("en")("count.items", { count: 1 })).toBe("1 item");
    expect(createTranslate("en")("count.items", { count: 3 })).toBe("3 items");
    expect(t("count.items", { count: 3 })).toBe("3 item");
  });
  it("falls back to the key, never blank", () => expect(t("nope.missing")).toBe("nope.missing"));
});

describe("locale", () => {
  it("cookie, then Accept-Language, then English", () => {
    expect(resolveLocale("id", "en")).toBe("id");
    expect(resolveLocale("fr", "id-ID,id;q=0.9")).toBe("id");
    expect(resolveLocale(undefined, "fr, en-US;q=0.8")).toBe("en");
    expect(resolveLocale(undefined, null)).toBe("en");
  });
  it("uses distinct Intl tags", () => expect(intlTag("id")).toBe("id-ID"));
});

describe("format", () => {
  it("money is Rp with dots in both languages", () =>
    expect(formatMoney(125000)).toBe("Rp 125.000"));
  it("numbers follow the language", () => {
    expect(formatNumber(1234567, "id")).toBe("1.234.567");
    expect(formatNumber(1234567, "en")).toBe("1,234,567");
  });
  it("dates use the location's time zone, not the device's", () => {
    const at = "2026-11-24T20:30:00Z"; // 03:30 next day in Jakarta, 12:30 in Los Angeles
    expect(formatDate(at, "en", "Asia/Jakarta", "time")).toBe("03:30");
    expect(formatDate(at, "en", "America/Los_Angeles", "time")).toBe("12:30");
    expect(formatDate(at, "en", "Asia/Jakarta", "date")).toContain("25");
  });
});
