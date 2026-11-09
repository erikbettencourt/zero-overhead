import type { ExpenseCategory } from "../shared/types";

/** "2026-11-04" -> "Nov 4, 2026" */
export function niceDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", opts);
}

/** "2026-11-01" -> "November 2026" */
export function monthName(iso: string) {
  return niceDate(iso, { month: "long", year: "numeric" });
}

/** A period that is exactly one calendar month reads as the month; anything else as a range. */
export function periodLabel(from: string, to: string) {
  const [y, m] = from.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  if (from.endsWith("-01") && to === `${from.slice(0, 8)}${String(last).padStart(2, "0")}`) return monthName(from);
  return `${niceDate(from)} to ${niceDate(to)}`;
}

/** "Office expense, line 18". Health insurance is deducted outside Schedule C, so it has no line. */
export function categoryLabel(c: ExpenseCategory) {
  return c.scheduleCLine ? `${c.name}, line ${c.scheduleCLine}` : c.name;
}
