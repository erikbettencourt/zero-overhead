/**
 * Time and money helpers shared by the Worker and the app.
 * Time is stored as whole minutes and money as whole cents.
 */

/** Parse what someone types in an hours cell: "1.5", "1:30", "90m", "2h", "1h 15m", "" (zero). */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (s === "") return 0;

  let m = /^(\d+):([0-5]?\d)$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);

  m = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/.exec(s);
  if (m && (m[1] || m[2])) {
    return Math.round(Number(m[1] ?? 0) * 60) + Number(m[2] ?? 0);
  }

  m = /^(\d*\.?\d+)$/.exec(s);
  if (m) return Math.round(Number(m[1]) * 60);

  return null;
}

/** 90 -> "1:30", 0 -> "" (blank cells stay blank). */
export function formatDuration(minutes: number, { blankZero = true } = {}): string {
  if (minutes === 0 && blankZero) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** 15000 -> "$150.00" */
export function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** "150" or "$150.50" -> 15050. Empty -> null. */
export function parseMoney(input: string): number | null | undefined {
  const s = input.trim().replace(/[$,\s]/g, "");
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  return Math.round(Number(s) * 100);
}

/** Most specific rate wins: project + task, then project, then client. */
/** One rate per project: its own, or else the client's. */
export function resolveRateCents(projectRate: number | null | undefined, clientRate: number | null | undefined): number | null {
  return projectRate ?? clientRate ?? null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Local calendar date as YYYY-MM-DD (not UTC). */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return toIsoDate(new Date(y, m - 1, d + days));
}

/** Monday of the week containing `iso`. */
export function startOfWeek(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const offset = (date.getDay() + 6) % 7;
  return addDays(iso, -offset);
}

/**
 * Invoice math, matching how Harvest bills: hours are rounded to two decimals first,
 * then multiplied by the hourly rate and rounded to the cent.
 */
export function billableHundredths(minutes: number): number {
  return Math.round((minutes * 100) / 60);
}

export function lineAmountCents(minutes: number, rateCents: number): number {
  return Math.round((billableHundredths(minutes) * rateCents) / 100);
}

/** 450 minutes -> "7.50" */
export function formatHours(minutes: number): string {
  return (billableHundredths(minutes) / 100).toFixed(2);
}

/** "1042" -> "1043", "EB-0099" -> "EB-0100", "INV" -> "INV-2". */
export function nextInvoiceNumber(current: string): string {
  const m = /^(.*?)(\d+)$/.exec(current);
  if (!m) return `${current}-2`;
  const next = String(Number(m[2]) + 1).padStart(m[2].length, "0");
  return m[1] + next;
}

/** First and last day of the month containing `iso`. */
export function monthRange(iso: string): { from: string; to: string } {
  const [y, m] = iso.split("-").map(Number);
  return { from: toIsoDate(new Date(y, m - 1, 1)), to: toIsoDate(new Date(y, m, 0)) };
}
