import type { Jurisdiction, TaxBreakdown, TaxPayment, TaxProfile, TaxQuarter, TaxSummary, YearEndSummary } from "../shared/types";
import { dueDates, estimateTax, figuresFor } from "../shared/tax";
import { CUSTOM_STATE, STATES, stateFor } from "../shared/states";
import { isIsoDate } from "../shared/time";
import { type Route, type Row, all, badRequest, idFrom, int, json, notFound, optStr, readJson } from "./http";
import { paysInvoice } from "./bank";
import { getBusiness } from "./invoices";

const PROFILE_KEY = "tax.profile";

export const DEFAULT_PROFILE: TaxProfile = {
  filingStatus: "single",
  state: "",
  customStateRateBps: 0,
  customStateDeductionCents: 0,
  localTaxRateBps: 0,
  w2WagesCents: 0,
  w2FederalWithheldCents: 0,
  w2StateWithheldCents: 0,
  otherIncomeCents: 0,
  priorYearFederalTaxCents: 0,
  priorYearStateTaxCents: 0,
  priorYearAgiCents: 0,
  expectedProfitCents: 0,
};

const RATE_FIELDS = ["customStateRateBps", "localTaxRateBps"] as const;
const MONEY_FIELDS = Object.keys(DEFAULT_PROFILE).filter((k) => k !== "filingStatus" && k !== "state" && !(RATE_FIELDS as readonly string[]).includes(k)) as (keyof Omit<
  TaxProfile,
  "filingStatus" | "state" | (typeof RATE_FIELDS)[number]
>)[];
const MAX_CENTS = 100_000_000_00;

export async function getProfile(db: D1Database): Promise<TaxProfile> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(PROFILE_KEY).first<{ value: string }>();
  if (!row) return { ...DEFAULT_PROFILE };
  try {
    return { ...DEFAULT_PROFILE, ...(JSON.parse(row.value) as Partial<TaxProfile>) };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

function readProfile(b: Record<string, unknown>, current: TaxProfile): TaxProfile {
  const next = { ...current };
  if (b.filingStatus !== undefined) {
    if (b.filingStatus !== "single" && b.filingStatus !== "joint") throw badRequest("filingStatus must be single or joint.");
    next.filingStatus = b.filingStatus;
  }
  if (b.state !== undefined) {
    if (typeof b.state !== "string" || (b.state !== "" && b.state !== CUSTOM_STATE && !STATES[b.state])) throw badRequest("state must be a two-letter state code or custom.");
    next.state = b.state;
  }
  // Rates in basis points: up to 20% for a state, 10% for a city or county.
  if (b.customStateRateBps !== undefined) next.customStateRateBps = int(b, "customStateRateBps", { min: 0, max: 2000 });
  if (b.localTaxRateBps !== undefined) next.localTaxRateBps = int(b, "localTaxRateBps", { min: 0, max: 1000 });
  for (const k of MONEY_FIELDS) if (b[k] !== undefined) next[k] = int(b, k, { min: 0, max: MAX_CENTS });
  return next;
}

const toPayment = (r: Row): TaxPayment => ({
  id: r.id as number,
  taxYear: r.tax_year as number,
  jurisdiction: r.jurisdiction as Jurisdiction,
  quarter: r.quarter as TaxPayment["quarter"],
  paidOn: r.paid_on as string,
  amountCents: r.amount_cents as number,
  appliedRefund: !!r.applied_refund,
  note: (r.note as string) ?? null,
});

const dayOfYear = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
};
const daysInYear = (y: number) => (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 366 : 365);

/** Cash basis: money received in the year, less business spending dated in the year. */
async function yearMoney(db: D1Database, year: number) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const [invoices, deposits, spending, health] = await Promise.all([
    db.prepare("SELECT coalesce(sum(total_cents), 0) AS n FROM invoices WHERE status = 'paid' AND paid_on BETWEEN ? AND ?").bind(from, to).first<{ n: number }>(),
    db
      .prepare(
        `SELECT coalesce(sum(amount_cents), 0) AS n FROM bank_transactions WHERE kind = 'business' AND amount_cents > 0
           AND NOT ${paysInvoice("bank_transactions")} AND category_id IS NULL AND date BETWEEN ? AND ?`,
      )
      .bind(from, to)
      .first<{ n: number }>(),
    // Spending net of refunds, with each category's deductible share (half of meals).
    db
      .prepare(
        `SELECT coalesce(-sum(t.amount_cents), 0) AS spent,
                coalesce(-sum(t.amount_cents * coalesce(c.deductible_percent, 100) / 100.0), 0) AS deductible
         FROM bank_transactions t LEFT JOIN expense_categories c ON c.id = t.category_id
         WHERE t.kind = 'business' AND NOT ${paysInvoice("t")} AND (t.amount_cents < 0 OR t.category_id IS NOT NULL)
           AND coalesce(c.deduction, 'schedule_c') = 'schedule_c' AND t.date BETWEEN ? AND ?`,
      )
      .bind(from, to)
      .first<{ spent: number; deductible: number }>(),
    // Health insurance premiums aren't business spending; they're deducted from income separately.
    db
      .prepare(
        `SELECT coalesce(-sum(t.amount_cents), 0) AS n FROM bank_transactions t JOIN expense_categories c ON c.id = t.category_id
         WHERE t.kind = 'business' AND c.deduction = 'health_insurance' AND t.date BETWEEN ? AND ?`,
      )
      .bind(from, to)
      .first<{ n: number }>(),
  ]);
  return {
    received: (invoices?.n ?? 0) + (deposits?.n ?? 0),
    spent: spending?.spent ?? 0,
    deductible: Math.round(spending?.deductible ?? 0),
    health: Math.max(0, health?.n ?? 0),
  };
}

export async function taxSummary(db: D1Database, year: number, today: string): Promise<TaxSummary> {
  const [profile, money, paymentRows] = await Promise.all([
    getProfile(db),
    yearMoney(db, year),
    all(db, "SELECT * FROM tax_payments WHERE tax_year = ? ORDER BY paid_on, id", year),
  ]);
  const { figuresYear, figures } = figuresFor(year);
  const currentYear = Number(today.slice(0, 4));
  const profit = money.received - money.deductible;

  // A past year uses what happened. This year scales the year so far up to twelve months,
  // unless you've entered your own forecast.
  let projection: TaxBreakdown["projection"] = "actual";
  let projected = profit;
  let projectedHealth = money.health;
  if (year === currentYear) {
    // Premiums so far, scaled up to the full year like the profit.
    projectedHealth = Math.round((money.health * daysInYear(year)) / dayOfYear(today));
    if (profile.expectedProfitCents > 0) {
      projection = "expected";
      projected = profile.expectedProfitCents;
    } else {
      projection = "projected";
      projected = Math.round((profit * daysInYear(year)) / dayOfYear(today));
    }
  } else if (year > currentYear) {
    projection = profile.expectedProfitCents > 0 ? "expected" : "projected";
    projected = profile.expectedProfitCents;
  }

  const state = stateFor(profile.state, year, { rateBps: profile.customStateRateBps, deductionCents: profile.customStateDeductionCents });
  const tax = estimateTax(
    {
      filingStatus: profile.filingStatus,
      profitCents: projected,
      w2WagesCents: profile.w2WagesCents,
      otherIncomeCents: profile.otherIncomeCents,
      healthInsuranceCents: projectedHealth,
      localRate: profile.localTaxRateBps / 10_000,
    },
    figures,
    state.figures,
  );
  const pending = [...(figures.pending ?? [])];
  if (state.figuresYear !== null && state.figuresYear < year) pending.push(`${state.name}'s ${year} rates (using ${state.figuresYear}'s)`);
  const breakdown: TaxBreakdown = {
    receivedCents: money.received,
    businessSpendingCents: money.spent,
    deductibleSpendingCents: money.deductible,
    profitCents: profit,
    projectedProfitCents: projected,
    projection,
    healthInsuranceCents: money.health,
    projectedHealthInsuranceCents: projectedHealth,
    ...tax,
  };

  // What's left after withholding from a job is what the four estimated payments cover.
  const owed = {
    federal: Math.max(0, tax.federalTotalCents - profile.w2FederalWithheldCents),
    state: Math.max(0, tax.stateTotalCents - profile.w2StateWithheldCents),
  };
  const payments = paymentRows.map(toPayment);
  const paidIn = (j: Jurisdiction, q: number) => payments.filter((p) => p.jurisdiction === j && p.quarter === q).reduce((s, p) => s + p.amountCents, 0);
  const dates = dueDates(year);

  // Each due date carries an even quarter of the year. A shortfall in an earlier quarter
  // shows on that quarter and is added to the next payment, so the year still adds up.
  const quarters: TaxQuarter[] = [];
  for (let q = 1; q <= 4; q++) {
    const quarter = q as TaxQuarter["quarter"];
    const share = (j: Jurisdiction) => Math.round((owed[j] * q) / 4) - Math.round((owed[j] * (q - 1)) / 4);
    const federal = { estimateCents: share("federal"), paidCents: paidIn("federal", q) };
    const state = { estimateCents: share("state"), paidCents: paidIn("state", q) };
    // Within a dollar counts as covered.
    const covered = federal.paidCents >= federal.estimateCents - 100 && state.paidCents >= state.estimateCents - 100;
    let status: TaxQuarter["status"];
    if (covered && (federal.paidCents + state.paidCents > 0 || federal.estimateCents + state.estimateCents === 0)) status = "paid";
    else if (dates[q - 1] < today) status = "past due";
    else if (!quarters.some((x) => x.status === "due")) status = "due";
    else status = "upcoming";
    quarters.push({ quarter, dueOn: dates[q - 1], federal, state, status });
  }

  // The next payment brings the year's total up to date through its quarter.
  const nextQ = quarters.find((q) => q.dueOn >= today && q.status !== "paid");
  const caughtUp = (j: Jurisdiction, through: number) =>
    Math.max(0, Math.round((owed[j] * through) / 4) - payments.filter((p) => p.jurisdiction === j && p.quarter <= through).reduce((a, p) => a + p.amountCents, 0));
  const next = nextQ
    ? (() => {
        const federalCents = caughtUp("federal", nextQ.quarter);
        const stateCents = caughtUp("state", nextQ.quarter);
        const own = Math.max(0, nextQ.federal.estimateCents - nextQ.federal.paidCents) + Math.max(0, nextQ.state.estimateCents - nextQ.state.paidCents);
        return { quarter: nextQ.quarter, dueOn: nextQ.dueOn, federalCents, stateCents, catchUpCents: Math.max(0, federalCents + stateCents - own) };
      })()
    : null;

  // Safe harbor: 100% of last year's tax, or 110% federally above $150,000 of income, spread over four payments.
  let safeHarbor: TaxSummary["safeHarbor"] = null;
  if (profile.priorYearFederalTaxCents > 0 || profile.priorYearStateTaxCents > 0) {
    const highIncome = profile.priorYearAgiCents > 150_000_00;
    const fedTarget = Math.max(0, Math.round(profile.priorYearFederalTaxCents * (highIncome ? 1.1 : 1)) - profile.w2FederalWithheldCents);
    const stateTarget = Math.max(0, profile.priorYearStateTaxCents - profile.w2StateWithheldCents);
    safeHarbor = { federalPerQuarterCents: Math.round(fedTarget / 4), statePerQuarterCents: Math.round(stateTarget / 4) };
  }

  return {
    year,
    figuresYear,
    pendingFigures: pending,
    state: {
      code: state.code,
      name: state.name,
      chosen: profile.state !== "",
      noIncomeTax: !!STATES[profile.state]?.noIncomeTax,
      localTaxes: profile.state === CUSTOM_STATE || !!STATES[profile.state]?.localTaxes,
    },
    profile,
    breakdown,
    quarters,
    payments,
    next,
    paidCents: payments.reduce((s, p) => s + p.amountCents, 0),
    estimatedCents: owed.federal + owed.state,
    safeHarbor,
  };
}

/** The year laid out for an accountant: the same numbers as the tax estimate, by line. */
export async function yearEndSummary(db: D1Database, year: number, today: string): Promise<YearEndSummary> {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const sent = "coalesce(issued_on, period_end)";
  const [estimate, business, cats, earlier, notPaid, review, uncategorized] = await Promise.all([
    taxSummary(db, year, today),
    getBusiness(db),
    // Spending net of refunds by category, like the estimate. Health insurance is deducted elsewhere.
    all(
      db,
      `SELECT c.name, c.schedule_c_line, coalesce(c.deductible_percent, 100) AS pct, -sum(t.amount_cents) AS spent
       FROM bank_transactions t LEFT JOIN expense_categories c ON c.id = t.category_id
       WHERE t.kind = 'business' AND NOT ${paysInvoice("t")} AND (t.amount_cents < 0 OR t.category_id IS NOT NULL)
         AND coalesce(c.deduction, 'schedule_c') = 'schedule_c' AND t.date BETWEEN ? AND ?
       GROUP BY t.category_id
       ORDER BY c.schedule_c_line IS NULL, CAST(c.schedule_c_line AS INTEGER), c.schedule_c_line, c.name`,
      from,
      to,
    ),
    db
      .prepare(`SELECT count(*) AS n, coalesce(sum(total_cents), 0) AS cents FROM invoices WHERE status = 'paid' AND paid_on BETWEEN ? AND ? AND ${sent} < ?`)
      .bind(from, to, from)
      .first<{ n: number; cents: number }>(),
    db
      .prepare(
        `SELECT count(*) AS n, coalesce(sum(total_cents), 0) AS cents FROM invoices
         WHERE ${sent} BETWEEN ? AND ? AND (status = 'unpaid' OR paid_on > ?)`,
      )
      .bind(from, to, to)
      .first<{ n: number; cents: number }>(),
    db.prepare("SELECT count(*) AS n FROM bank_transactions WHERE kind IS NULL AND date BETWEEN ? AND ?").bind(from, to).first<{ n: number }>(),
    db
      .prepare("SELECT count(*) AS n FROM bank_transactions WHERE kind = 'business' AND amount_cents < 0 AND category_id IS NULL AND date BETWEEN ? AND ?")
      .bind(from, to)
      .first<{ n: number }>(),
  ]);

  const expenses = cats.map((c) => ({
    line: (c.schedule_c_line as string) ?? null,
    name: (c.name as string) ?? "Uncategorized",
    deductiblePercent: c.pct as number,
    spentCents: c.spent as number,
    deductibleCents: Math.round(((c.spent as number) * (c.pct as number)) / 100),
  }));
  const totalDeductible = expenses.reduce((s, e) => s + e.deductibleCents, 0);
  const received = estimate.breakdown.receivedCents;
  // A quarter with an estimate and nothing recorded against it.
  const missingQuarters = estimate.quarters
    .filter((q) => q.federal.estimateCents + q.state.estimateCents > 0 && q.federal.paidCents + q.state.paidCents === 0)
    .map((q) => ({ quarter: q.quarter, dueOn: q.dueOn }));

  return {
    year,
    businessName: business.name,
    stateName: estimate.state.chosen ? estimate.state.name : null,
    grossReceiptsCents: received,
    fromEarlierYears: { cents: earlier?.cents ?? 0, count: earlier?.n ?? 0 },
    notPaidInYear: { cents: notPaid?.cents ?? 0, count: notPaid?.n ?? 0 },
    expenses,
    totalSpentCents: expenses.reduce((s, e) => s + e.spentCents, 0),
    totalDeductibleCents: totalDeductible,
    netProfitCents: received - totalDeductible,
    healthInsuranceCents: estimate.breakdown.healthInsuranceCents,
    payments: estimate.payments,
    checks: { toReview: review?.n ?? 0, uncategorized: uncategorized?.n ?? 0, missingQuarters },
  };
}

const today = () => new Date().toISOString().slice(0, 10);

export const taxRoutes: Route[] = [
  [
    "GET",
    /^\/api\/taxes\/(\d{4})$/,
    async ({ db, params, url }) => {
      const asOf = url.searchParams.get("today");
      return json(await taxSummary(db, Number(params[0]), isIsoDate(asOf) ? asOf : today()));
    },
  ],
  [
    "GET",
    /^\/api\/taxes\/(\d{4})\/year-end$/,
    async ({ db, params, url }) => {
      const asOf = url.searchParams.get("today");
      return json(await yearEndSummary(db, Number(params[0]), isIsoDate(asOf) ? asOf : today()));
    },
  ],
  ["GET", /^\/api\/tax-profile$/, async ({ db }) => json(await getProfile(db))],
  [
    "PUT",
    /^\/api\/tax-profile$/,
    async ({ req, db }) => {
      const profile = readProfile(await readJson(req), await getProfile(db));
      await db
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
        .bind(PROFILE_KEY, JSON.stringify(profile))
        .run();
      return json(profile);
    },
  ],
  [
    "POST",
    /^\/api\/tax-payments$/,
    async ({ req, db }) => {
      const b = await readJson(req);
      const taxYear = int(b, "taxYear", { min: 2000, max: 2100 });
      if (b.jurisdiction !== "federal" && b.jurisdiction !== "state") throw badRequest("jurisdiction must be federal or state.");
      const quarter = int(b, "quarter", { min: 1, max: 4 });
      if (!isIsoDate(b.paidOn)) throw badRequest("paidOn must be a date.");
      const amount = int(b, "amountCents", { min: 1, max: MAX_CENTS });
      const row = await db
        .prepare(
          "INSERT INTO tax_payments (tax_year, jurisdiction, quarter, paid_on, amount_cents, applied_refund, note) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *",
        )
        .bind(taxYear, b.jurisdiction, quarter, b.paidOn, amount, b.appliedRefund ? 1 : 0, optStr(b, "note", { max: 200 }) ?? null)
        .first<Row>();
      return json(toPayment(row!), 201);
    },
  ],
  [
    "DELETE",
    /^\/api\/tax-payments\/(\d+)$/,
    async ({ db, params }) => {
      const r = await db.prepare("DELETE FROM tax_payments WHERE id = ?").bind(idFrom(params[0])).run();
      if (!r.meta.changes) throw notFound("Payment not found.");
      return new Response(null, { status: 204 });
    },
  ],
];
