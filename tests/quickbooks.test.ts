import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { handleApi } from "../worker/api";
import { wipeAll } from "./reset";
import type { BankTransaction, QbImportRequest, QbImportResult, QbImportRow, TaxPayment, TaxSummary } from "../shared/types";

let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;

async function call<T = unknown>(method: string, path: string, body?: unknown) {
  const req = new Request("https://admin.example.com" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await handleApi(req, db, "owner@example.com");
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
}

let checking = 0;
let card = 0;
const cat: Record<string, number> = {};
const ids: Record<string, number> = {};

beforeAll(async () => {
  proxy = await getPlatformProxy<{ DB: D1Database }>({ persist: { path: ".wrangler/test-state/v3" } });
  db = proxy.env.DB;
  await wipeAll(db);
  const account = async (name: string, type: string) =>
    (await db.prepare("INSERT INTO bank_accounts (institution_name, name, type) VALUES ('Example Bank', ?, ?) RETURNING id").bind(name, type).first<{ id: number }>())!.id;
  checking = await account("Everyday Checking", "depository");
  card = await account("Rewards Visa", "credit");
  for (const r of (await db.prepare("SELECT id, name FROM expense_categories").all<{ id: number; name: string }>()).results) cat[r.name] = r.id;
  const rule = await db.prepare("INSERT INTO bank_rules (match_text, kind) VALUES ('amazon', 'personal') RETURNING id").first<{ id: number }>();
  const t = async (key: string, account: number, date: string, name: string, cents: number, extra: { kind?: string; category?: number; rule?: number } = {}) => {
    const row = await db
      .prepare("INSERT INTO bank_transactions (account_id, plaid_transaction_id, date, name, amount_cents, kind, category_id, rule_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(account, `p-${key}`, date, name, cents, extra.kind ?? null, extra.category ?? null, extra.rule ?? null)
      .first<{ id: number }>();
    ids[key] = row!.id;
  };
  await t("slack1", card, "2026-01-01", "SLACK T0XXX", -1200);
  await t("slack2", card, "2026-02-02", "SLACK T0XXX", -1200);
  await t("claude", card, "2026-10-08", "DESIGNTOOL PRO", -2500);
  await t("paypal", checking, "2026-10-19", "PAYPAL INST XFER", -2000);
  await t("irs", checking, "2026-09-16", "IRS USATAXPYMT", -5_000_00);
  await t("phone", checking, "2026-03-02", "PHONE CO", -7500, { kind: "business", category: cat["Utilities"] });
  await t("amazon", card, "2026-05-05", "AMAZON MKTPLACE", -5000, { kind: "personal", rule: rule!.id });
});
afterAll(async () => {
  await wipeAll(db);
  await proxy?.dispose();
});

const office = () => ({ kind: "business" as const, categoryId: cat["Office expense"] });
const row = (key: string, accountKey: string, date: string, description: string, amountCents: number, target: QbImportRow["target"], extra: Partial<QbImportRow> = {}): QbImportRow => ({
  key,
  date,
  accountKey,
  description,
  amountCents,
  target,
  ...extra,
});

function request(commit: boolean): QbImportRequest {
  return {
    commit,
    addMissing: true,
    accounts: {
      "Example Bank · Rewards Visa": { mode: "account", accountId: card },
      "Example Bank · Everyday Checking": { mode: "account", accountId: checking },
      "PayPal · Business PayPal": { mode: "via", accountId: checking, match: "paypal" },
      "Example Bank · Savings": { mode: "skip" },
      "Cash Account · Cash": { mode: "skip" },
    },
    rows: [
      row("k1", "Example Bank · Rewards Visa", "2026-01-01", "Slack", -1200, office()),
      row("k2", "Example Bank · Rewards Visa", "2026-02-01", "Slack", -1200, office()),
      // Not in the download.
      row("k3", "Example Bank · Rewards Visa", "2026-09-01", "Slack", -1200, office()),
      // Filed under health insurance in QuickBooks, fixed to office expense.
      row("k4", "Example Bank · Rewards Visa", "2026-10-08", "DesignTool Pro", -2500, office()),
      row("k5", "PayPal · Business PayPal", "2026-10-17", "Domain Registrar", -2000, office()),
      row("k6", "Example Bank · Everyday Checking", "2026-09-16", "Internal Revenue Service", -5_000_00, { kind: "tax", jurisdiction: "federal" }, { taxYear: 2026, quarter: 3 }),
      // Sorted by hand here as business: kept.
      row("k7", "Example Bank · Everyday Checking", "2026-03-02", "Phone Co", -7500, { kind: "personal" }),
      // Sorted by a rule here: QuickBooks wins.
      row("k8", "Example Bank · Rewards Visa", "2026-05-06", "Amazon", -5000, { kind: "business", categoryId: cat["Supplies"] }),
      row("k9", "Example Bank · Rewards Visa", "2026-06-01", "Groceries", -4000, { kind: "personal" }),
      row("k10", "Example Bank · Savings", "2026-06-15", "Online Scheduled Transfer", 100000, { kind: "personal" }),
      row("k11", "Cash Account · Cash", "2026-04-04", "2025 refund applied to 2026", -1_000_00, { kind: "tax", jurisdiction: "federal" }, { taxYear: 2026, quarter: 1, appliedRefund: true }),
    ],
  };
}

const txn = async (key: string) => (await db.prepare("SELECT * FROM bank_transactions WHERE id = ?").bind(ids[key]).first<Record<string, unknown>>())!;

describe("QuickBooks import", () => {
  it("previews without changing anything", async () => {
    const r = await call<QbImportResult>("POST", "/api/import/quickbooks", request(false));
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({
      committed: false,
      matched: 7,
      sorted: 6,
      keptYours: 1,
      missingPersonal: 1,
      skipped: 1,
      taxPayments: { added: 2, alreadyRecorded: 0 },
    });
    expect(r.data.missingBusiness).toEqual([{ date: "2026-09-01", accountKey: "Example Bank · Rewards Visa", description: "Slack", amountCents: -1200, added: true }]);
    expect((await txn("slack1")).kind).toBeNull();
    expect((await db.prepare("SELECT count(*) AS n FROM tax_payments").first<{ n: number }>())!.n).toBe(0);
  });

  it("sorts matching transactions, keeps yours, adds what's missing and records tax payments", async () => {
    const r = await call<QbImportResult>("POST", "/api/import/quickbooks", request(true));
    expect(r.data).toMatchObject({ committed: true, matched: 7, sorted: 6, keptYours: 1 });

    expect(await txn("slack1")).toMatchObject({ kind: "business", category_id: cat["Office expense"], rule_id: null });
    expect(await txn("slack2")).toMatchObject({ kind: "business", category_id: cat["Office expense"] });
    expect(await txn("claude")).toMatchObject({ kind: "business", category_id: cat["Office expense"] });
    expect(await txn("paypal")).toMatchObject({ kind: "business", category_id: cat["Office expense"], note: "PayPal: Domain Registrar" });
    expect(await txn("irs")).toMatchObject({ kind: "personal", category_id: null, note: "Federal estimated tax, 2026 Q3" });
    expect(await txn("phone")).toMatchObject({ kind: "business", category_id: cat["Utilities"] });
    expect(await txn("amazon")).toMatchObject({ kind: "business", category_id: cat["Supplies"], rule_id: null });

    // The missing September Slack charge is added, so searching finds every month.
    const slack = (await call<BankTransaction[]>("GET", "/api/transactions?view=all&from=2026-01-01&to=2026-12-31&q=slack")).data;
    expect(slack.map((t) => t.date)).toEqual(["2026-09-01", "2026-02-02", "2026-01-01"]);
    expect(slack[0]).toMatchObject({ kind: "business", note: "Added from QuickBooks", accountId: card });
    // The PayPal merchant is searchable through its note.
    expect((await call<BankTransaction[]>("GET", "/api/transactions?view=all&from=2026-01-01&to=2026-12-31&q=domain%20registrar")).data).toHaveLength(1);

    const taxes = (await call<TaxSummary>("GET", "/api/taxes/2026?today=2026-11-09")).data;
    expect(taxes.payments.map((p: TaxPayment) => [p.quarter, p.amountCents, p.appliedRefund])).toEqual([
      [1, 1_000_00, true],
      [3, 5_000_00, false],
    ]);
  });

  it("changes nothing more when the same file is imported again", async () => {
    const r = await call<QbImportResult>("POST", "/api/import/quickbooks", request(true));
    expect(r.data).toMatchObject({ matched: 8, sorted: 0, keptYours: 1, missingBusiness: [], taxPayments: { added: 0, alreadyRecorded: 2 } });
    expect((await db.prepare("SELECT count(*) AS n FROM bank_transactions").first<{ n: number }>())!.n).toBe(8);
  });

  it("refuses accounts and categories that don't exist", async () => {
    const bad = request(false);
    bad.accounts["Example Bank · Everyday Checking"] = { mode: "account", accountId: 999999 };
    expect((await call("POST", "/api/import/quickbooks", bad)).status).toBe(400);
    const badCat = request(false);
    badCat.rows[0].target = { kind: "business", categoryId: 999999 };
    expect((await call("POST", "/api/import/quickbooks", badCat)).status).toBe(400);
    const badTax = request(false);
    delete badTax.rows[5].quarter;
    expect((await call("POST", "/api/import/quickbooks", badTax)).status).toBe(400);
  });
});
