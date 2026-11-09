import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { handleApi } from "../worker/api";
import { wipeAll } from "./reset";
import { estimateTax, TAX_FIGURES } from "../shared/tax";
import { STATES } from "../shared/states";
import type { TaxPayment, TaxProfile, TaxSummary, YearEndSummary } from "../shared/types";

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

const summary = async (today = "2026-11-08") => (await call<TaxSummary>("GET", `/api/taxes/2026?today=${today}`)).data;

beforeAll(async () => {
  proxy = await getPlatformProxy<{ DB: D1Database }>({ persist: { path: ".wrangler/test-state/v3" } });
  db = proxy.env.DB;
  await wipeAll(db);

  // $80,000 received in 2026 from two paid invoices, one more paid in January 2027,
  // and $5,000 of business spending including $400 of meals (half deductible).
  const client = await db.prepare("INSERT INTO clients (name) VALUES ('Tax Test Co') RETURNING id").first<{ id: number }>();
  const inv = (n: string, total: number, paidOn: string) =>
    db
      .prepare(
        "INSERT INTO invoices (number, client_id, period_start, period_end, issued_on, status, total_cents, paid_on) VALUES (?, ?, '2026-01-01', '2026-01-31', '2026-02-01', 'paid', ?, ?)",
      )
      .bind(n, client!.id, total, paidOn);
  await db.batch([inv("TT-1", 50_000_00, "2026-03-10"), inv("TT-2", 30_000_00, "2026-09-02"), inv("TT-3", 20_000_00, "2027-01-12")]);
  const account = await db.prepare("INSERT INTO bank_accounts (institution_name, name) VALUES ('Test', 'Card') RETURNING id").first<{ id: number }>();
  const cat = async (name: string) => (await db.prepare("SELECT id FROM expense_categories WHERE name = ?").bind(name).first<{ id: number }>())!.id;
  const [software, meals] = [await cat("Office expense"), await cat("Deductible meals")];
  const t = (date: string, cents: number, kind: string, categoryId: number | null) =>
    db.prepare("INSERT INTO bank_transactions (account_id, date, name, amount_cents, kind, category_id) VALUES (?, ?, 'x', ?, ?, ?)").bind(account!.id, date, cents, kind, categoryId);
  await db.batch([
    t("2026-02-01", -4_600_00, "business", software),
    t("2026-05-01", -400_00, "business", meals),
    t("2026-05-02", -900_00, "personal", null),
    t("2025-12-30", -1_000_00, "business", software),
  ]);
});
afterAll(async () => {
  await wipeAll(db);
  await proxy?.dispose();
});

describe("tax profile", () => {
  it("defaults to single with no other income, and no state until you choose one", async () => {
    const p = (await call<TaxProfile>("GET", "/api/tax-profile")).data;
    expect(p).toMatchObject({ filingStatus: "single", w2WagesCents: 0, otherIncomeCents: 0, state: "", localTaxRateBps: 0 });
    const s = await summary();
    expect(s.state).toMatchObject({ chosen: false, name: "Your state" });
    expect(s.breakdown.stateTotalCents).toBe(0);
  });

  it("estimates the chosen state, or none where there's no income tax", async () => {
    expect((await call("PUT", "/api/tax-profile", { state: "ZZ" })).status).toBe(400);
    expect((await call("PUT", "/api/tax-profile", { localTaxRateBps: 5000 })).status).toBe(400);
    await call("PUT", "/api/tax-profile", { state: "TX" });
    let s = await summary();
    expect(s.state).toMatchObject({ code: "TX", name: "Texas", chosen: true, noIncomeTax: true });
    expect(s.breakdown.stateTotalCents).toBe(0);
    await call("PUT", "/api/tax-profile", { state: "MA" });
    s = await summary();
    expect(s.state).toMatchObject({ name: "Massachusetts", noIncomeTax: false });
    expect(s.breakdown.stateTotalCents).toBeGreaterThan(0);
    expect(s.pendingFigures).toEqual([]);
    // 2027 uses Massachusetts's 2026 rates until its 2027 figures are added, and says so.
    expect((await call<TaxSummary>("GET", "/api/taxes/2027?today=2026-11-08")).data.pendingFigures).toContain("Massachusetts's 2027 rates (using 2026's)");
  });

  it("saves changes and refuses bad ones", async () => {
    expect((await call("PUT", "/api/tax-profile", { filingStatus: "separate" })).status).toBe(400);
    expect((await call("PUT", "/api/tax-profile", { w2WagesCents: -1 })).status).toBe(400);
    const p = await call<TaxProfile>("PUT", "/api/tax-profile", { otherIncomeCents: 500_00 });
    expect(p.data).toMatchObject({ filingStatus: "single", otherIncomeCents: 500_00 });
    await call("PUT", "/api/tax-profile", { otherIncomeCents: 0 });
  });
});

describe("tax summary", () => {
  it("counts money received in the year, less deductible business spending", async () => {
    const s = await summary();
    // January 2027's payment belongs to 2027, December 2025's spending to 2025, personal spending to nobody.
    expect(s.breakdown).toMatchObject({ receivedCents: 80_000_00, businessSpendingCents: 5_000_00, deductibleSpendingCents: 4_800_00, profitCents: 75_200_00 });
  });

  it("projects the year from the year so far", async () => {
    const s = await summary();
    // Nov 8 is day 312 of 365.
    expect(s.breakdown.projection).toBe("projected");
    expect(s.breakdown.projectedProfitCents).toBe(Math.round((75_200_00 * 365) / 312));
    const expected = estimateTax({ filingStatus: "single", profitCents: s.breakdown.projectedProfitCents, w2WagesCents: 0, otherIncomeCents: 0 }, TAX_FIGURES[2026], STATES.MA.years[2026]);
    expect(s.breakdown.federalTotalCents).toBe(expected.federalTotalCents);
    expect(s.estimatedCents).toBe(expected.federalTotalCents + expected.stateTotalCents);
  });

  it("uses your own forecast when you give one", async () => {
    await call("PUT", "/api/tax-profile", { expectedProfitCents: 100_000_00 });
    const s = await summary();
    expect(s.breakdown).toMatchObject({ projection: "expected", projectedProfitCents: 100_000_00 });
    await call("PUT", "/api/tax-profile", { expectedProfitCents: 0 });
  });

  it("spreads the year over four due dates and tracks what's paid", async () => {
    const s0 = await summary();
    const quarterFed = Math.round(s0.breakdown.federalTotalCents / 4);
    // Q1 covered by last year's refund applied, Q2 paid, Q3 missed.
    const pay = (jurisdiction: string, quarter: number, paidOn: string, amountCents: number, appliedRefund = false) =>
      call<TaxPayment>("POST", "/api/tax-payments", { taxYear: 2026, jurisdiction, quarter, paidOn, amountCents, appliedRefund });
    const refund = await pay("federal", 1, "2026-04-15", quarterFed, true);
    expect(refund.data).toMatchObject({ appliedRefund: true, quarter: 1 });
    await pay("state", 1, "2026-04-14", Math.round(s0.breakdown.stateTotalCents / 4));
    await pay("federal", 2, "2026-06-12", quarterFed);
    await pay("state", 2, "2026-06-12", Math.round(s0.breakdown.stateTotalCents / 4));
    expect((await call("POST", "/api/tax-payments", { taxYear: 2026, jurisdiction: "city", quarter: 1, paidOn: "2026-04-15", amountCents: 1 })).status).toBe(400);

    const s = await summary();
    expect(s.quarters.map((q) => q.status)).toEqual(["paid", "paid", "past due", "due"]);
    expect(s.quarters.map((q) => q.dueOn)).toEqual(["2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"]);
    // The missed Q3 rolls into what Q4 needs, so the year still adds up.
    expect(s.next).toMatchObject({ quarter: 4, dueOn: "2027-01-15" });
    expect(s.next!.federalCents).toBe(s.breakdown.federalTotalCents - 2 * quarterFed);
    // Each quarter shows its even share; the missed one is the catch-up.
    expect(Math.abs(s.quarters[2].federal.estimateCents - s.quarters[3].federal.estimateCents)).toBeLessThanOrEqual(1);
    expect(s.next!.catchUpCents).toBe(s.quarters[2].federal.estimateCents + s.quarters[2].state.estimateCents);
    expect(s.paidCents).toBe(s.payments.reduce((a, p) => a + p.amountCents, 0));
  });

  it("subtracts job withholding and shows the safe harbor", async () => {
    await call("PUT", "/api/tax-profile", { w2FederalWithheldCents: 1_000_00, priorYearFederalTaxCents: 20_000_00, priorYearStateTaxCents: 4_000_00, priorYearAgiCents: 160_000_00 });
    const s = await summary();
    expect(s.estimatedCents).toBe(s.breakdown.federalTotalCents - 1_000_00 + s.breakdown.stateTotalCents);
    // Over $150,000 last year: 110% of last year's federal tax, less withholding, in four.
    expect(s.safeHarbor).toEqual({ federalPerQuarterCents: Math.round((22_000_00 - 1_000_00) / 4), statePerQuarterCents: 1_000_00 });
  });

  it("deletes a payment", async () => {
    const s = await summary();
    expect((await call("DELETE", `/api/tax-payments/${s.payments[0].id}`)).status).toBe(204);
    expect((await summary()).payments).toHaveLength(s.payments.length - 1);
  });

  it("deducts health insurance premiums separately from business spending", async () => {
    const before = await summary();
    const health = (await db.prepare("SELECT id FROM expense_categories WHERE name = 'Health insurance premiums'").first<{ id: number }>())!.id;
    const account = (await db.prepare("SELECT id FROM bank_accounts LIMIT 1").first<{ id: number }>())!.id;
    const row = await db
      .prepare("INSERT INTO bank_transactions (account_id, date, name, amount_cents, kind, category_id) VALUES (?, '2026-03-24', 'HEALTH PLAN PREMIUM', -6_000_00, 'business', ?) RETURNING id")
      .bind(account, health)
      .first<{ id: number }>();
    const s = await summary();
    // Not business spending, so profit and self-employment tax don't change.
    expect(s.breakdown).toMatchObject({ businessSpendingCents: before.breakdown.businessSpendingCents, profitCents: before.breakdown.profitCents, healthInsuranceCents: 6_000_00 });
    expect(s.breakdown.selfEmploymentTaxCents).toBe(before.breakdown.selfEmploymentTaxCents);
    // Premiums so far, scaled to the year like the profit, lower income tax.
    expect(s.breakdown.projectedHealthInsuranceCents).toBe(Math.round((6_000_00 * 365) / 312));
    expect(s.breakdown.healthInsuranceDeductionCents).toBe(s.breakdown.projectedHealthInsuranceCents);
    expect(s.breakdown.federalIncomeTaxCents).toBeLessThan(before.breakdown.federalIncomeTaxCents);
    expect(s.breakdown.stateTotalCents).toBeLessThan(before.breakdown.stateTotalCents);
    await db.prepare("DELETE FROM bank_transactions WHERE id = ?").bind(row!.id).run();
  });
});

describe("year-end summary", () => {
  it("lays out the year by Schedule C line, the same as the estimate", async () => {
    const client = (await db.prepare("SELECT id FROM clients LIMIT 1").first<{ id: number }>())!.id;
    const account = (await db.prepare("SELECT id FROM bank_accounts LIMIT 1").first<{ id: number }>())!.id;
    // December 2025's invoice paid in January counts in 2026. An open 2026 invoice doesn't.
    await db.batch([
      db
        .prepare(
          "INSERT INTO invoices (number, client_id, period_start, period_end, issued_on, status, total_cents, paid_on) VALUES ('YE-1', ?, '2025-12-01', '2025-12-31', '2025-12-31', 'paid', 500000, '2026-01-05')",
        )
        .bind(client),
      db
        .prepare("INSERT INTO invoices (number, client_id, period_start, period_end, issued_on, status, total_cents) VALUES ('YE-2', ?, '2026-12-01', '2026-12-31', '2026-12-31', 'unpaid', 300000)")
        .bind(client),
      // One still to review and one business charge without a category.
      db.prepare("INSERT INTO bank_transactions (account_id, date, name, amount_cents) VALUES (?, '2026-07-01', 'OPEN', -1000)").bind(account),
      db.prepare("INSERT INTO bank_transactions (account_id, date, name, amount_cents, kind) VALUES (?, '2026-07-02', 'NO CATEGORY', -2500, 'business')").bind(account),
    ]);

    const y = (await call<YearEndSummary>("GET", "/api/taxes/2026/year-end?today=2026-11-08")).data;
    const estimate = await summary();
    expect(y.grossReceiptsCents).toBe(85_000_00);
    expect(y.grossReceiptsCents).toBe(estimate.breakdown.receivedCents);
    expect(y.fromEarlierYears).toEqual({ cents: 5_000_00, count: 1 });
    // TT-3 was sent in 2026 and paid in 2027; YE-2 isn't paid yet.
    expect(y.notPaidInYear).toEqual({ cents: 20_000_00 + 3_000_00, count: 2 });
    expect(y.expenses).toEqual([
      { line: "18", name: "Office expense", deductiblePercent: 100, spentCents: 4_600_00, deductibleCents: 4_600_00 },
      { line: "24b", name: "Deductible meals", deductiblePercent: 50, spentCents: 400_00, deductibleCents: 200_00 },
      { line: null, name: "Uncategorized", deductiblePercent: 100, spentCents: 25_00, deductibleCents: 25_00 },
    ]);
    expect(y.totalDeductibleCents).toBe(estimate.breakdown.deductibleSpendingCents);
    expect(y.netProfitCents).toBe(estimate.breakdown.profitCents);
    expect(y.stateName).toBe("Massachusetts");
    expect(y.checks).toEqual({
      toReview: 1,
      uncategorized: 1,
      missingQuarters: [
        { quarter: 3, dueOn: "2026-09-15" },
        { quarter: 4, dueOn: "2027-01-15" },
      ],
    });
    expect(y.payments.every((p) => p.taxYear === 2026)).toBe(true);

    await db.prepare("DELETE FROM invoices WHERE number LIKE 'YE-%'").run();
    await db.prepare("DELETE FROM bank_transactions WHERE name IN ('OPEN', 'NO CATEGORY')").run();
  });
});
