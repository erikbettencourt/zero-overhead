import type { ExpenseCategory, QbImportRow, QbTarget } from "../shared/types";
import { addDays, isIsoDate } from "../shared/time";
import { dueDates } from "../shared/tax";
import { parseCsv } from "./harvest";

/** One row of a QuickBooks Self-Employed transactions export. */
export interface QbRow {
  line: number;
  date: string;
  bank: string;
  account: string;
  /** "Bank · Account", how accounts are told apart. */
  accountKey: string;
  description: string;
  amountCents: number;
  type: "business" | "personal";
  category: string;
}

export interface ParsedQuickBooks {
  rows: QbRow[];
  problems: string[];
}

const REQUIRED = ["Date", "Bank", "Account", "Description", "Amount", "Type", "Category"];

/** QuickBooks exports dates as M/D/YY. */
function toIso(raw: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(raw.trim());
  if (!m) return isIsoDate(raw.trim()) ? raw.trim() : null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  const iso = `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}

function toCents(raw: string): number | null {
  const s = raw.trim().replace(/[$,]/g, "");
  const negative = /^\(.*\)$/.test(s);
  const n = Number(negative ? s.slice(1, -1) : s);
  if (!s || !Number.isFinite(n)) return null;
  return Math.round((negative ? -n : n) * 100);
}

/** Read a QuickBooks Self-Employed "Transactions" CSV export. Money out is negative, as in the export. */
export function parseQuickBooks(text: string): ParsedQuickBooks {
  const table = parseCsv(text);
  const header = (table[0] ?? []).map((h) => h.trim());
  const missing = REQUIRED.filter((h) => !header.includes(h));
  if (missing.length) return { rows: [], problems: [`This doesn't look like a QuickBooks transactions export. Missing columns: ${missing.join(", ")}.`] };
  const col = (name: string) => header.indexOf(name);
  const rows: QbRow[] = [];
  const problems: string[] = [];
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (name: string) => (cells[col(name)] ?? "").trim();
    const date = toIso(get("Date"));
    const amountCents = toCents(get("Amount"));
    if (!date || amountCents === null) {
      problems.push(`Line ${line}: couldn't read the date or amount.`);
      return;
    }
    // A $0 line (like a rewards notice) has nothing to sort.
    if (amountCents === 0) return;
    const bank = get("Bank");
    const account = get("Account");
    rows.push({
      line,
      date,
      bank,
      account,
      accountKey: `${bank} · ${account}`,
      description: get("Description"),
      amountCents,
      type: get("Type").toLowerCase() === "business" ? "business" : "personal",
      category: get("Category"),
    });
  });
  if (rows.length === 0 && problems.length === 0) problems.push("The file has no transactions in it. Export a date range with transactions.");
  return { rows, problems };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** QuickBooks category words, in the order to check them, and the Schedule C category each becomes. */
const CATEGORY_HINTS: [RegExp, string | "income" | "federal" | "state"][] = [
  [/\bfederal\b.*\btax/, "federal"],
  [/\bestimated tax/, "federal"],
  [/\bstate\b.*\btax/, "state"],
  [/\bhealth insurance/, "Health insurance premiums"],
  [/\bincome\b|\bsales\b|\brevenue\b/, "income"],
  [/\badvertis|\bmarketing\b/, "Advertising"],
  [/\bcar\b|\btruck\b|\bvehicle\b|\bauto\b|\bmileage\b|\bgas\b/, "Car and truck expenses"],
  [/\bcommission/, "Commissions and fees"],
  [/\bcontract/, "Contract labor"],
  [/\bdepreciation\b|\bequipment\b/, "Depreciation and section 179"],
  [/\binsurance\b/, "Insurance (other than health)"],
  [/\binterest\b/, "Interest"],
  [/\blegal\b|\bprofessional\b/, "Legal and professional services"],
  [/\boffice\b|\bsoftware\b|\bapps?\b|\bweb services\b|\bsubscriptions?\b/, "Office expense"],
  [/\brent\b|\blease\b/, "Rent or lease"],
  [/\brepair/, "Repairs and maintenance"],
  [/\bsupplies\b/, "Supplies"],
  [/\btaxes and licenses\b|\blicens/, "Taxes and licenses"],
  [/\btravel\b/, "Travel"],
  [/\bmeals?\b|\bentertainment\b/, "Deductible meals"],
  [/\butilities\b|\bphone\b|\binternet\b/, "Utilities"],
  [/\bother\b|\bbank\b|\bfees?\b|\beducation\b/, "Other expenses"],
];

/** The best guess for a QuickBooks category. Null when it needs you to choose. */
export function suggestTarget(category: string, type: QbRow["type"], categories: ExpenseCategory[]): QbTarget | null {
  const n = norm(category);
  // Tax payments are filed under Business in QuickBooks, but are payments, not spending.
  if (type === "personal" && !/\btax/.test(n)) return { kind: "personal" };
  if (n.startsWith("personal")) return { kind: "personal" };
  for (const [re, to] of CATEGORY_HINTS) {
    if (!re.test(n)) continue;
    if (to === "income") return { kind: "business", categoryId: null };
    if (to === "federal" || to === "state") return { kind: "tax", jurisdiction: to };
    const c = categories.find((x) => x.name === to);
    return c ? { kind: "business", categoryId: c.id } : null;
  }
  return null;
}

// Words in health insurance charges: carriers, marketplaces and plan wording.
const INSURANCE = /health|insur|blue ?cross|bcbs|aetna|cigna|united ?health|kaiser|humana|anthem|oscar|ambetter|molina|centene|marketplace|healthcare\.gov|premium|dental|vision/i;
const TRAVEL =
  /\b(uber|lyft|bolt|jetblue|delta|united airlines|american air|southwest|alaska air|spirit air|frontier|hilton|marriott|hyatt|sheraton|westin|airbnb|vrbo|hotel|motel|airport|airline|airways|turnpike|toll|e-?z ?pass|sunpass|fastrak|amtrak|enterprise rent|hertz|avis|budget rent|national car|parking|taxi)/i;

/** A category that looks wrong for this charge, with why. */
export function suggestFix(description: string, target: QbTarget | null, categories: ExpenseCategory[]): { categoryId: number; reason: string } | null {
  if (target?.kind !== "business" || target.categoryId === null) return null;
  const current = categories.find((c) => c.id === target.categoryId);
  const byName = (name: string) => categories.find((c) => c.name === name);
  if (current?.deduction === "health_insurance" && !INSURANCE.test(description)) {
    const office = byName("Office expense");
    return office ? { categoryId: office.id, reason: "Doesn't look like health insurance" } : null;
  }
  const travel = byName("Travel");
  if (travel && current && current.id !== travel.id && current.deduction === "schedule_c" && TRAVEL.test(description)) {
    return { categoryId: travel.id, reason: "Looks like travel" };
  }
  return null;
}

/**
 * Which estimated payment a tax payment was for. A payment counts toward the quarter it was due
 * in, up to a month late, so a January payment is last year's fourth quarter.
 */
export function taxQuarter(date: string): { taxYear: number; quarter: 1 | 2 | 3 | 4 } {
  const year = Number(date.slice(0, 4));
  const last = dueDates(year - 1)[3];
  if (date <= addDays(last, 30)) return { taxYear: year - 1, quarter: 4 };
  const due = dueDates(year);
  for (let q = 0; q < 3; q++) if (date <= addDays(due[q], 30)) return { taxYear: year, quarter: (q + 1) as 1 | 2 | 3 };
  return { taxYear: year, quarter: 4 };
}

/**
 * Guess which connected account a QuickBooks account is: at least two words in common, or the
 * same bank when that bank has only one account here.
 */
export function guessAccount(row: Pick<QbRow, "bank" | "account">, accounts: { id: number; name: string; institutionName: string; type: string | null }[]) {
  const words = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length > 2 && !["the", "and", "card", "credit", "bank", "account"].includes(w)));
  const mine = words(`${row.bank} ${row.account}`);
  let best: { id: number; shared: number } | null = null;
  for (const a of accounts) {
    const theirs = words(`${a.institutionName} ${a.name}`);
    const shared = [...mine].filter((w) => theirs.has(w)).length;
    if (shared > (best?.shared ?? 0)) best = { id: a.id, shared };
  }
  if (best && best.shared >= 2) return best.id;
  const sameBank = accounts.filter((a) => {
    const inst = norm(a.institutionName);
    return inst.length > 2 && norm(row.bank).includes(inst);
  });
  return sameBank.length === 1 ? sameBank[0].id : null;
}

/** Stable keys, so importing the same file twice adds nothing new. */
export function withImportKeys(rows: QbRow[]): (QbRow & { key: string })[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = `${r.date}|${r.accountKey}|${r.description}|${r.amountCents}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...r, key: `qb:${base}#${n}` };
  });
}

export type { QbImportRow };
