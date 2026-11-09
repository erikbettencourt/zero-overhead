import type { QbAccountPlan, QbImportRequest, QbImportResult, QbImportRow, QbTarget } from "../shared/types";
import { addDays, isIsoDate } from "../shared/time";
import { type Route, type Row, all, badRequest, json, readJson } from "./http";
import { STATES } from "../shared/states";
import { getProfile } from "./taxes";

/**
 * Bring QuickBooks Self-Employed's sorting over. Each QuickBooks row is found among the
 * transactions downloaded from your bank (same account and amount, within a few days) and
 * sorted the same way. Transactions you've already sorted differently here are left alone.
 * Tax payments go on the Taxes page. Importing the same file twice changes nothing more.
 */

const MATCH_DAYS = 3;
/** A PayPal purchase reaches the bank a few days later as a plain "PayPal" line. */
const VIA_DAYS_BEFORE = 2;
const VIA_DAYS_AFTER = 6;


function readTarget(t: unknown): QbTarget {
  const v = t as QbTarget;
  if (v?.kind === "personal") return { kind: "personal" };
  if (v?.kind === "business" && (v.categoryId === null || (Number.isInteger(v.categoryId) && v.categoryId > 0))) return { kind: "business", categoryId: v.categoryId };
  if (v?.kind === "tax" && (v.jurisdiction === "federal" || v.jurisdiction === "state")) return { kind: "tax", jurisdiction: v.jurisdiction };
  throw badRequest("Each row needs a type: personal, business or a tax payment.");
}

function readRequest(b: Record<string, unknown>): QbImportRequest {
  if (!Array.isArray(b.rows) || b.rows.length > 20000) throw badRequest("rows must be a list of up to 20,000 transactions.");
  const rows: QbImportRow[] = b.rows.map((raw) => {
    const r = raw as QbImportRow;
    if (typeof r.key !== "string" || r.key.length > 500) throw badRequest("Each row needs a key.");
    if (!isIsoDate(r.date)) throw badRequest("Each row needs a date.");
    if (!Number.isInteger(r.amountCents) || r.amountCents === 0) throw badRequest("Each row needs an amount.");
    const target = readTarget(r.target);
    const row: QbImportRow = {
      key: r.key,
      date: r.date,
      accountKey: String(r.accountKey ?? "").slice(0, 300),
      description: String(r.description ?? "").slice(0, 300),
      amountCents: r.amountCents,
      target,
    };
    if (target.kind === "tax") {
      if (!Number.isInteger(r.taxYear) || r.taxYear! < 2000 || r.taxYear! > 2100) throw badRequest("A tax payment needs its tax year.");
      if (![1, 2, 3, 4].includes(r.quarter as number)) throw badRequest("A tax payment needs its quarter.");
      Object.assign(row, { taxYear: r.taxYear, quarter: r.quarter, appliedRefund: !!r.appliedRefund });
    }
    return row;
  });
  const accounts: Record<string, QbAccountPlan> = {};
  for (const [key, plan] of Object.entries((b.accounts ?? {}) as Record<string, QbAccountPlan>)) {
    if (plan?.mode === "skip") accounts[key] = { mode: "skip" };
    else if (plan?.mode === "account" && Number.isInteger(plan.accountId)) accounts[key] = { mode: "account", accountId: plan.accountId };
    else if (plan?.mode === "via" && Number.isInteger(plan.accountId) && typeof plan.match === "string" && plan.match.trim().length >= 3) {
      accounts[key] = { mode: "via", accountId: plan.accountId, match: plan.match.trim().toLowerCase().slice(0, 50) };
    } else throw badRequest(`Choose where "${key}" transactions are.`);
  }
  return { rows, accounts, addMissing: !!b.addMissing, commit: !!b.commit };
}

const daysApart = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);

export async function importQuickBooks(db: D1Database, req: QbImportRequest): Promise<QbImportResult> {
  const result: QbImportResult = {
    committed: req.commit,
    matched: 0,
    sorted: 0,
    keptYours: 0,
    missingBusiness: [],
    missingPersonal: 0,
    skipped: 0,
    taxPayments: { added: 0, alreadyRecorded: 0 },
  };
  if (req.rows.length === 0) return result;

  // Every account named must exist.
  const accountIds = [...new Set(Object.values(req.accounts).flatMap((p) => (p.mode === "skip" ? [] : [p.accountId])))];
  if (accountIds.length) {
    const found = await all(db, `SELECT id FROM bank_accounts WHERE id IN (${accountIds.map(() => "?").join(",")})`, ...accountIds);
    if (found.length !== accountIds.length) throw badRequest("One of the chosen accounts no longer exists.");
  }
  const categoryIds = [...new Set(req.rows.flatMap((r) => (r.target.kind === "business" && r.target.categoryId ? [r.target.categoryId] : [])))];
  if (categoryIds.length) {
    const found = await all(db, `SELECT id FROM expense_categories WHERE id IN (${categoryIds.map(() => "?").join(",")})`, ...categoryIds);
    if (found.length !== categoryIds.length) throw badRequest("One of the chosen categories no longer exists.");
  }

  // Everything downloaded around the file's dates, by account.
  const dates = req.rows.map((r) => r.date).sort();
  const from = addDays(dates[0], -10);
  const to = addDays(dates.at(-1)!, 10);
  const byAccount = new Map<number, Row[]>();
  if (accountIds.length) {
    const txns = await all(
      db,
      `SELECT id, account_id, date, name, merchant_name, amount_cents, kind, category_id, rule_id, note, import_key,
              EXISTS (SELECT 1 FROM invoices i WHERE i.deposit_id = bank_transactions.id) AS pays_invoice
       FROM bank_transactions WHERE date BETWEEN ? AND ? AND account_id IN (${accountIds.map(() => "?").join(",")}) ORDER BY date, id`,
      from,
      to,
      ...accountIds,
    );
    for (const t of txns) {
      const list = byAccount.get(t.account_id as number) ?? [];
      list.push(t);
      byAccount.set(t.account_id as number, list);
    }
  }
  // Tax payment notes name the state from the Tax profile.
  const stateCode = (await getProfile(db)).state;
  const jurisdictionLabel = { federal: "Federal", state: STATES[stateCode]?.name ?? "State" };
  const used = new Set<number>();
  const statements: D1PreparedStatement[] = [];

  // Earlier rows first, so a run of identical monthly charges pairs up month by month.
  const rows = [...req.rows].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  for (const row of rows) {
    const plan = req.accounts[row.accountKey] ?? { mode: "skip" };
    if (plan.mode === "skip") {
      if (row.target.kind !== "tax") result.skipped++;
      continue;
    }
    // Find the closest unused transaction for the same amount.
    let best: Row | null = null;
    let bestGap = Infinity;
    for (const t of byAccount.get(plan.accountId) ?? []) {
      if (used.has(t.id as number) || t.amount_cents !== row.amountCents) continue;
      const gap = daysApart(t.date as string, row.date);
      if (plan.mode === "account" && Math.abs(gap) > MATCH_DAYS) continue;
      if (plan.mode === "via") {
        if (gap < -VIA_DAYS_BEFORE || gap > VIA_DAYS_AFTER) continue;
        const text = `${t.name} ${t.merchant_name ?? ""}`.toLowerCase();
        if (!text.includes(plan.match)) continue;
      }
      if (Math.abs(gap) < bestGap) {
        best = t;
        bestGap = Math.abs(gap);
      }
    }

    if (!best) {
      if (row.target.kind === "personal") result.missingPersonal++;
      else if (row.target.kind === "business") {
        const add = req.addMissing && plan.mode === "account";
        result.missingBusiness.push({ date: row.date, accountKey: row.accountKey, description: row.description, amountCents: row.amountCents, added: add });
        if (add) {
          statements.push(
            db
              .prepare(
                `INSERT INTO bank_transactions (account_id, date, name, amount_cents, kind, category_id, note, import_key)
                 VALUES (?, ?, ?, ?, 'business', ?, 'Added from QuickBooks', ?) ON CONFLICT (import_key) DO NOTHING`,
              )
              .bind(plan.accountId, row.date, row.description || "QuickBooks transaction", row.amountCents, row.target.categoryId, row.key),
          );
        }
      }
      continue;
    }

    used.add(best.id as number);
    result.matched++;
    const kind = row.target.kind === "business" ? "business" : "personal";
    const categoryId = row.target.kind === "business" ? row.target.categoryId : null;
    let note = (best.note as string) ?? null;
    if (row.target.kind === "tax") note = `${jurisdictionLabel[row.target.jurisdiction]} estimated tax, ${row.taxYear} Q${row.quarter}`;
    else if (plan.mode === "via" && row.description) note = `${plan.match === "paypal" ? "PayPal" : plan.match}: ${row.description}`;

    // A deposit that paid an invoice stays as it is.
    if (best.pays_invoice) continue;
    const handSorted = best.kind != null && best.rule_id == null;
    const same = best.kind === kind && (best.category_id ?? null) === (categoryId ?? null);
    if (handSorted && !same) {
      result.keptYours++;
      if (note !== best.note) statements.push(db.prepare("UPDATE bank_transactions SET note = ? WHERE id = ?").bind(note, best.id));
      continue;
    }
    if (same && note === (best.note ?? null)) continue;
    if (!same) result.sorted++;
    statements.push(db.prepare("UPDATE bank_transactions SET kind = ?, category_id = ?, rule_id = NULL, note = ? WHERE id = ?").bind(kind, categoryId, note, best.id));
  }

  // Tax payments, unless already recorded with the same date and amount.
  const taxRows = rows.filter((r) => r.target.kind === "tax");
  if (taxRows.length) {
    const existing = await all(db, "SELECT jurisdiction, paid_on, amount_cents FROM tax_payments");
    const have = new Set(existing.map((p) => `${p.jurisdiction}|${p.paid_on}|${p.amount_cents}`));
    for (const r of taxRows) {
      const jurisdiction = (r.target as { jurisdiction: string }).jurisdiction;
      const amount = Math.abs(r.amountCents);
      const key = `${jurisdiction}|${r.date}|${amount}`;
      if (have.has(key)) {
        result.taxPayments.alreadyRecorded++;
        continue;
      }
      have.add(key);
      result.taxPayments.added++;
      statements.push(
        db
          .prepare("INSERT INTO tax_payments (tax_year, jurisdiction, quarter, paid_on, amount_cents, applied_refund, note) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(r.taxYear, jurisdiction, r.quarter, r.date, amount, r.appliedRefund ? 1 : 0, "From QuickBooks"),
      );
    }
  }

  if (req.commit) for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
  return result;
}

export const quickbooksRoutes: Route[] = [
  ["POST", /^\/api\/import\/quickbooks$/, async ({ req, db }) => json(await importQuickBooks(db, readRequest(await readJson(req))))],
];
