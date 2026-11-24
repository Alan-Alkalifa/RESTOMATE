import { formatMoney } from "@/lib/money";
import { intlTag, type Locale } from "./locale";

/**
 * Number and date formats. Money is `Rp 25.000` in both languages (IDR exponent 0) and always comes
 * from `lib/money`. Dates are shown in the **location's** time zone (an IANA name), never the device's.
 */
export { formatMoney };

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(intlTag(locale)).format(value);
}

export type DateStyle = "date" | "time" | "dateTime";

const OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  date: { day: "numeric", month: "short", year: "numeric" },
  time: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  dateTime: {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  },
};

export function formatDate(
  value: Date | string | number,
  locale: Locale,
  timeZone: string,
  style: DateStyle = "date",
): string {
  return new Intl.DateTimeFormat(intlTag(locale), { ...OPTIONS[style], timeZone }).format(
    new Date(value),
  );
}
