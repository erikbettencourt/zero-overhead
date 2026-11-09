import type { BillingPeriod } from "../shared/types";
import { addDays, startOfWeek, toIsoDate } from "../shared/time";

/** Date ranges for reports and invoices. Every date is an ISO day, YYYY-MM-DD. */

export type RangeMode = "week" | "month" | "quarter" | "year" | "custom";
export type Range = { from: string; to: string };

const parts = (iso: string) => iso.split("-").map(Number) as [number, number, number];
const day = (y: number, m: number, d: number) => toIsoDate(new Date(y, m, d));

/** Monday to Sunday, like the timesheet. */
export function weekOf(iso: string): Range {
  const from = startOfWeek(iso);
  return { from, to: addDays(from, 6) };
}
export function monthOf(iso: string): Range {
  const [y, m] = parts(iso);
  return { from: day(y, m - 1, 1), to: day(y, m, 0) };
}
export function quarterOf(iso: string): Range {
  const [y, m] = parts(iso);
  const q = Math.floor((m - 1) / 3) * 3;
  return { from: day(y, q, 1), to: day(y, q + 3, 0) };
}
export function yearOf(iso: string): Range {
  const [y] = parts(iso);
  return { from: day(y, 0, 1), to: day(y, 11, 31) };
}

const OF: Record<Exclude<RangeMode, "custom">, (iso: string) => Range> = { week: weekOf, month: monthOf, quarter: quarterOf, year: yearOf };

export function rangeFor(mode: RangeMode, anchor: string): Range {
  return mode === "custom" ? { from: anchor, to: anchor } : OF[mode](anchor);
}

/** Which preset a range is, if any. */
export function modeOf({ from, to }: Range): RangeMode {
  for (const m of ["week", "month", "quarter", "year"] as const) {
    const r = OF[m](from);
    if (r.from === from && r.to === to) return m;
  }
  return "custom";
}

/** The same kind of range, one step earlier or later. Custom ranges move by their own length. */
export function shiftRange(range: Range, by: number): Range {
  const mode = modeOf(range);
  const [y, m] = parts(range.from);
  if (mode === "week") return weekOf(addDays(range.from, 7 * by));
  if (mode === "month") return monthOf(day(y, m - 1 + by, 1));
  if (mode === "quarter") return quarterOf(day(y, m - 1 + 3 * by, 1));
  if (mode === "year") return yearOf(day(y + by, 0, 1));
  const len = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, len * by), to: addDays(range.to, len * by) };
}

export function daysBetween(a: string, b: string) {
  const t = (iso: string) => Date.UTC(...(parts(iso).map((n, i) => (i === 1 ? n - 1 : n)) as [number, number, number]));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => {
  const [y, m, d] = parts(iso);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", o);
};

export function rangeLabel(range: Range): string {
  const mode = modeOf(range);
  if (mode === "week") return `Week of ${fmt(range.from, { month: "short", day: "numeric", year: "numeric" })}`;
  if (mode === "month") return fmt(range.from, { month: "long", year: "numeric" });
  if (mode === "quarter") return `Q${Math.floor((parts(range.from)[1] - 1) / 3) + 1} ${parts(range.from)[0]}`;
  if (mode === "year") return String(parts(range.from)[0]);
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  return `${fmt(range.from, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })} to ${fmt(range.to, { month: "short", day: "numeric", year: "numeric" })}`;
}

/* Billing periods: the window an invoice covers. */

export const BILLING_LABEL: Record<BillingPeriod, string> = { monthly: "Monthly", biweekly: "Every two weeks", quarterly: "Quarterly" };

/** The most recent finished billing period before today: last month, last quarter, or the two weeks before this one. */
export function lastBillingPeriod(period: BillingPeriod, today = toIsoDate(new Date())): Range {
  if (period === "monthly") return shiftRange(monthOf(today), -1);
  if (period === "quarterly") return shiftRange(quarterOf(today), -1);
  const thisWeek = startOfWeek(today);
  return { from: addDays(thisWeek, -14), to: addDays(thisWeek, -1) };
}

/** One billing period earlier or later. Two-week periods step by 14 days. */
export function shiftBilling(period: BillingPeriod | "custom", range: Range, by: number): Range {
  if (period === "biweekly") return { from: addDays(range.from, 14 * by), to: addDays(range.to, 14 * by) };
  return shiftRange(range, by);
}
