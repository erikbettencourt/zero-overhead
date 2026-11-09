import type { StatementColumns, StatementRow } from "../shared/types";
import { isIsoDate } from "../shared/time";
import { parseCsv } from "./harvest";

/** A bank's CSV export, split into its heading row and the rows under it. */
export interface StatementFile {
  header: string[];
  rows: string[][];
}

/** 11/09/2026, 11/9/26, 2026-11-09 or 11-09-2026. US month-first, as US banks export. */
export function toIsoDate(raw: string): string | null {
  const s = raw.trim();
  if (isIsoDate(s)) return s;
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  const iso = `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}

/** "$1,234.56", "-12.00", "(12.00)" -> cents. Blank is null. */
export function toCents(raw: string | undefined): number | null {
  const s = (raw ?? "").trim().replace(/[$,\s]/g, "");
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s);
  const n = Number(negative ? s.slice(1, -1) : s);
  if (!Number.isFinite(n)) return null;
  return Math.round((negative ? -n : n) * 100);
}

/**
 * Read the file. Some banks put a few summary lines above the headings, so the heading row
 * is the last row before the first one that starts with a date.
 */
export function readStatement(text: string): StatementFile | null {
  const table = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  const firstData = table.findIndex((r) => r.some((c) => toIsoDate(c) !== null));
  if (firstData < 1) return null;
  const header = table[firstData - 1].map((h) => h.trim());
  if (header.filter(Boolean).length < 2) return null;
  return { header, rows: table.slice(firstData) };
}

const find = (header: string[], ...patterns: RegExp[]) => {
  for (const p of patterns) {
    const h = header.find((x) => p.test(x));
    if (h) return h;
  }
  return undefined;
};

/** A first guess at the columns, from the headings and the numbers under them. */
export function guessColumns(file: StatementFile): StatementColumns {
  const h = file.header;
  const date = find(h, /^(transaction|trans\.?|post(ed|ing)?) date$/i, /date/i) ?? h[0];
  const description = find(h, /^description$/i, /description|payee|merchant|details|memo|name/i) ?? h[1];
  const amount = find(h, /^amount$/i, /amount/i);
  const debit = find(h, /debit|withdrawal|money out|^charges?$/i);
  const credit = find(h, /credit|deposit|money in|^payments?$/i);
  if (!amount && debit && credit) return { date, description, debit, credit, moneyOut: "negative" };
  const col = h.indexOf(amount ?? h[2]);
  // Most of a statement is money going out. If most amounts are positive, positive means out.
  const amounts = file.rows.map((r) => toCents(r[col])).filter((n): n is number => n !== null && n !== 0);
  const positive = amounts.filter((n) => n > 0).length;
  return { date, description, amount: amount ?? h[2], moneyOut: amounts.length > 0 && positive / amounts.length > 0.6 ? "positive" : "negative" };
}

/** The rows, money out negative. Rows without a date (totals, footers) are left out. */
export function statementRows(file: StatementFile, columns: StatementColumns): { rows: StatementRow[]; skipped: number } {
  const at = (name: string | undefined) => (name ? file.header.indexOf(name) : -1);
  const [d, desc, amt, deb, cred] = [at(columns.date), at(columns.description), at(columns.amount), at(columns.debit), at(columns.credit)];
  const seen = new Map<string, number>();
  const rows: StatementRow[] = [];
  let skipped = 0;
  for (const r of file.rows) {
    const date = toIsoDate(r[d] ?? "");
    let cents: number | null;
    if (columns.amount) {
      const n = toCents(r[amt]);
      cents = n === null ? null : columns.moneyOut === "positive" ? -n : n;
    } else {
      const out = toCents(r[deb]);
      const inn = toCents(r[cred]);
      cents = out === null && inn === null ? null : (inn ?? 0) - Math.abs(out ?? 0);
    }
    if (!date || !cents) {
      skipped++;
      continue;
    }
    const description = (r[desc] ?? "").trim().replace(/\s+/g, " ");
    const base = `${date}|${description}|${cents}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    rows.push({ date, description, amountCents: cents, key: `${base}#${n}` });
  }
  return { rows, skipped };
}

/** Whether saved columns still fit this file's headings. */
export function columnsFit(file: StatementFile, c: StatementColumns | null): c is StatementColumns {
  if (!c) return false;
  return [c.date, c.description, c.amount, c.debit, c.credit].every((n) => n === undefined || file.header.includes(n));
}
