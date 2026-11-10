import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { handleApi } from "../worker/api";
import { wipeAll } from "./reset";
import { type BankProvider, type ProviderTransaction, type SyncPage, ProviderError, plaidFromEnv } from "../worker/plaid";
import type { BankOverview, BankRule, BankTransaction, InvoiceDetail, SpendingSummary, SyncResult } from "../shared/types";

let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;

beforeAll(async () => {
  proxy = await getPlatformProxy<{ DB: D1Database }>({ persist: { path: ".wrangler/test-state/v3" } });
  db = proxy.env.DB;
});
afterAll(async () => proxy?.dispose());

/** A fake bank: hands out whatever pages the test queues up. */
class FakeBank implements BankProvider {
  environment = "sandbox";
  pages: (SyncPage | Error)[] = [];
  removed: string[] = [];
  accountsList = [
    { accountId: "acc-check", name: "Everyday Checking", mask: "1234", type: "depository", subtype: "checking" },
    { accountId: "acc-card", name: "Rewards Visa", mask: "9876", type: "credit", subtype: "credit card" },
  ];
  async linkToken(accessToken?: string) {
    return accessToken ? `link-update-${accessToken}` : "link-new";
  }
  async exchange(publicToken: string) {
    return { accessToken: `access-${publicToken}`, itemId: `item-${publicToken}` };
  }
  async accounts() {
    return this.accountsList;
  }
  async sync(): Promise<SyncPage> {
    const next = this.pages.shift() ?? { added: [], modified: [], removed: [], nextCursor: "c-end", hasMore: false };
    if (next instanceof Error) throw next;
    return next;
  }
  async remove(accessToken: string) {
    this.removed.push(accessToken);
  }
}

const txn = (id: string, date: string, name: string, cents: number, extra: Partial<ProviderTransaction> = {}): ProviderTransaction => ({
  transactionId: id,
  accountId: "acc-card",
  date,
  name,
  merchantName: null,
  amountCents: cents,
  pending: false,
  category: null,
  ...extra,
});
const page = (p: Partial<SyncPage>): SyncPage => ({ added: [], modified: [], removed: [], nextCursor: "c1", hasMore: false, ...p });

const bank = new FakeBank();

async function call<T = unknown>(method: string, path: string, body?: unknown, provider: BankProvider | null = bank) {
  const req = new Request("https://admin.example.com" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await handleApi(req, db, "owner@example.com", provider ?? undefined);
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
}

const review = async () => (await call<BankTransaction[]>("GET", "/api/transactions?view=review")).data;
const byName = (list: BankTransaction[], name: string) => list.find((t) => t.name === name)!;

describe("Plaid client", () => {
  it("is off until both keys are set", () => {
    expect(plaidFromEnv({})).toBeUndefined();
    expect(plaidFromEnv({ PLAID_CLIENT_ID: "id" })).toBeUndefined();
  });

  it("sends the keys, asks for two years, and flips Plaid's signs", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      calls.push({ url, body });
      if (url.endsWith("/link/token/create")) return Response.json({ link_token: "lt" });
      return Response.json({
        added: [
          { transaction_id: "t1", account_id: "a", date: "2026-11-02", name: "ADOBE", amount: 59.99, pending: false },
          { transaction_id: "t2", account_id: "a", date: "2026-11-03", name: "CLIENT ACH", amount: -4000, pending: false },
        ],
        modified: [],
        removed: [],
        next_cursor: "n",
        has_more: false,
      });
    }) as unknown as typeof fetch;
    const plaid = plaidFromEnv({ PLAID_CLIENT_ID: "id", PLAID_SECRET: "sec" }, fetcher)!;
    expect(plaid.environment).toBe("production");
    await plaid.linkToken();
    expect(calls[0].url).toBe("https://production.plaid.com/link/token/create");
    expect(calls[0].body).toMatchObject({ client_id: "id", secret: "sec", products: ["transactions"], transactions: { days_requested: 730 } });
    const r = await plaid.sync("tok", null);
    expect(r.added.map((t) => t.amountCents)).toEqual([-5999, 400000]);
  });

  it("marks login errors as needing a reconnect", async () => {
    const fetcher = (async () =>
      Response.json({ error_code: "ITEM_LOGIN_REQUIRED", error_message: "login required", display_message: null }, { status: 400 })) as unknown as typeof fetch;
    const plaid = plaidFromEnv({ PLAID_CLIENT_ID: "id", PLAID_SECRET: "sec", PLAID_ENV: "sandbox" }, fetcher)!;
    await expect(plaid.sync("tok", null)).rejects.toMatchObject({ code: "ITEM_LOGIN_REQUIRED", needsReconnect: true });
  });
});

describe("bank connections", () => {
  // Start clean: other test files may have loaded sample transactions.
  beforeAll(async () => {
    await wipeAll(db);
  });

  it("says when Plaid isn't set up", async () => {
    const r = await call<BankOverview>("GET", "/api/bank", undefined, null);
    expect(r.data.configured).toBe(false);
    expect((await call("POST", "/api/bank/link-token", {}, null)).status).toBe(503);
  });

  it("connects a bank, downloads posted transactions and skips pending ones", async () => {
    bank.pages = [
      page({
        added: [
          txn("p1", "2026-10-01", "ADOBE *CREATIVE CLOUD", -5999, { merchantName: "Adobe" }),
          txn("p2", "2026-10-02", "NETFLIX.COM", -1549, { merchantName: "Netflix" }),
          txn("p3", "2026-10-03", "AMAZON WEB SERVICES", -2300),
        ],
        nextCursor: "c1",
        hasMore: true,
      }),
      page({
        added: [
          txn("p4", "2026-10-04", "AMAZON MKTPLACE", -4500),
          txn("p5", "2026-10-20", "ACME CORP ACH", 450000, { accountId: "acc-check" }),
          txn("p6", "2026-10-21", "PENDING COFFEE", -500, { pending: true }),
        ],
        nextCursor: "c2",
      }),
    ];
    const r = await call<{ overview: BankOverview; sync: SyncResult }>("POST", "/api/bank/connections", { publicToken: "pub", institutionName: "Example Bank" });
    expect(r.status).toBe(201);
    expect(r.data.sync).toMatchObject({ added: 5, errors: [] });
    expect(r.data.overview.connections).toHaveLength(1);
    expect(r.data.overview.connections[0].accounts.map((a) => a.name).sort()).toEqual(["Everyday Checking", "Rewards Visa"]);

    const open = await review();
    expect(open.map((t) => t.name)).not.toContain("PENDING COFFEE");
    expect(byName(open, "ACME CORP ACH")).toMatchObject({ amountCents: 450000, accountName: "Everyday Checking 1234", needsReview: true });
  });

  it("asks for a category before business spending counts as reviewed", async () => {
    const adobe = byName(await review(), "ADOBE *CREATIVE CLOUD");
    const business = await call<BankTransaction>("PATCH", `/api/transactions/${adobe.id}`, { kind: "business" });
    expect(business.data.needsReview).toBe(true);
    const software = (await call<{ id: number; name: string }[]>("GET", "/api/categories")).data.find((c) => c.name === "Office expense")!;
    const done = await call<BankTransaction>("PATCH", `/api/transactions/${adobe.id}`, { categoryId: software.id });
    expect(done.data).toMatchObject({ kind: "business", categoryId: software.id, needsReview: false });
    expect((await call("PATCH", `/api/transactions/${adobe.id}`, { kind: "rent" })).status).toBe(400);
  });

  it("applies rules, the most specific first, and keeps them for later downloads", async () => {
    const cats = (await call<{ id: number; name: string }[]>("GET", "/api/categories")).data;
    const software = cats.find((c) => c.name === "Office expense")!.id;
    const netflix = byName(await review(), "NETFLIX.COM");
    const personal = await call<{ rule: BankRule }>("POST", "/api/rules", { matchText: "netflix", kind: "personal", transactionId: netflix.id });
    expect(personal.status).toBe(201);
    expect((await call("POST", "/api/rules", { matchText: "am", kind: "personal" })).status).toBe(400);

    await call("POST", "/api/rules", { matchText: "AMAZON", kind: "personal" });
    const aws = await call<{ applied: number }>("POST", "/api/rules", { matchText: "amazon web services", kind: "business", categoryId: software });
    expect(aws.data.applied).toBeGreaterThanOrEqual(0);

    const all = (await call<BankTransaction[]>("GET", "/api/transactions?view=all&from=2026-10-01&to=2026-10-31")).data;
    expect(byName(all, "NETFLIX.COM").kind).toBe("personal");
    expect(byName(all, "AMAZON WEB SERVICES")).toMatchObject({ kind: "business", categoryId: software });
    expect(byName(all, "AMAZON MKTPLACE").kind).toBe("personal");

    // Next night's download is sorted by the same rules.
    bank.pages = [page({ added: [txn("p7", "2026-10-25", "NETFLIX.COM", -1549)], nextCursor: "c3" })];
    const sync = await call<SyncResult>("POST", "/api/bank/sync", {});
    expect(sync.data).toMatchObject({ added: 1, categorized: 1 });
    const rules = (await call<BankRule[]>("GET", "/api/rules")).data;
    expect(rules.find((r) => r.matchText === "netflix")!.matches).toBe(2);
  });

  it("counts every transaction a rule fits, flags ones sorted another way, and never keeps two of a rule", async () => {
    const all = (await call<BankTransaction[]>("GET", "/api/transactions?view=all&from=2026-10-01&to=2026-10-31")).data;
    const nf = all.filter((t) => t.name === "NETFLIX.COM");
    // Sort one by hand as business: the rule still fits it, but it's sorted differently.
    await call("PATCH", `/api/transactions/${nf[0].id}`, { kind: "business" });
    let rule = (await call<BankRule[]>("GET", "/api/rules")).data.find((r) => r.matchText === "netflix")!;
    expect(rule).toMatchObject({ matches: 2, different: 1, unsorted: 0, firstDate: "2026-10-02" });
    // "AMAZON WEB SERVICES" is counted under its own, more specific rule, not under "AMAZON".
    const rules = (await call<BankRule[]>("GET", "/api/rules")).data;
    expect(rules.find((r) => r.matchText === "amazon web services")!.matches).toBe(1);

    // The same text in any case updates the existing rule, and what it sorted follows.
    const again = await call<{ rule: BankRule }>("POST", "/api/rules", { matchText: "NETFLIX", kind: "business", categoryId: null });
    expect(again.status).toBe(201);
    expect((await call<BankRule[]>("GET", "/api/rules")).data.filter((r) => r.matchText.toLowerCase() === "netflix")).toHaveLength(1);
    expect(again.data.rule.id).toBe(rule.id);
    rule = (await call<BankRule[]>("GET", "/api/rules")).data.find((r) => r.id === rule.id)!;
    expect(rule.kind).toBe("business");
    await call("POST", "/api/rules", { matchText: "netflix", kind: "personal" });
    await call("PATCH", `/api/transactions/${nf[0].id}`, { kind: "personal" });
  });

  it("keeps your review when the bank changes a transaction, and drops removed ones", async () => {
    bank.pages = [
      page({
        modified: [txn("p1", "2026-10-01", "ADOBE CREATIVE CLOUD", -6499, { merchantName: "Adobe" })],
        removed: ["p4"],
        nextCursor: "c4",
      }),
    ];
    await call("POST", "/api/bank/sync", {});
    const all = (await call<BankTransaction[]>("GET", "/api/transactions?view=all&from=2026-10-01&to=2026-10-31")).data;
    expect(byName(all, "ADOBE CREATIVE CLOUD")).toMatchObject({ amountCents: -6499, kind: "business", needsReview: false });
    expect(all.map((t) => t.name)).not.toContain("AMAZON MKTPLACE");
  });

  it("matches a deposit to the unpaid invoice it paid, on the day it arrived", async () => {
    const client = await db.prepare("INSERT INTO clients (name) VALUES ('Acme Bank Test') RETURNING id").first<{ id: number }>();
    const inv = await db
      .prepare(
        `INSERT INTO invoices (number, client_id, period_start, period_end, issued_on, due_on, status, total_cents, client_snapshot)
         VALUES ('BT-1', ?, '2026-09-01', '2026-09-30', '2026-10-01', '2026-10-16', 'unpaid', 450000, '{"name":"Acme Bank Test"}') RETURNING id`,
      )
      .bind(client!.id)
      .first<{ id: number }>();
    const deposit = byName(await review(), "ACME CORP ACH");
    expect(deposit.suggestedInvoices).toEqual([{ id: inv!.id, number: "BT-1", clientName: "Acme Bank Test", totalCents: 450000 }]);

    // With a bank connected, the deposit is what marks an invoice paid.
    const byHand = await call("PATCH", `/api/invoices/${inv!.id}`, { status: "paid", paidOn: "2026-10-20" });
    expect(byHand.status).toBe(409);
    expect((await call<InvoiceDetail>("GET", `/api/invoices/${inv!.id}`)).data).toMatchObject({ status: "unpaid", markPaidByHand: false, deposit: null });

    const matched = await call<BankTransaction>("POST", `/api/transactions/${deposit.id}/match`, { invoiceIds: [inv!.id] });
    expect(matched.data).toMatchObject({ kind: "business", invoices: [{ number: "BT-1" }], needsReview: false, suggestedInvoices: null });
    const paid = (await call<InvoiceDetail>("GET", `/api/invoices/${inv!.id}`)).data;
    expect(paid).toMatchObject({ status: "paid", paidOn: "2026-10-20", deposit: { id: deposit.id, date: "2026-10-20", amountCents: 450000, alsoPaid: [] } });
    expect((await call("POST", `/api/transactions/${deposit.id}/match`, { invoiceIds: [inv!.id] })).status).toBe(409);
    // Its date is the deposit's.
    expect((await call("PATCH", `/api/invoices/${inv!.id}`, { paidOn: "2026-11-01" })).status).toBe(409);

    // Marking the invoice unpaid sends the deposit back to review.
    await call("PATCH", `/api/invoices/${inv!.id}`, { status: "unpaid" });
    expect(byName(await review(), "ACME CORP ACH")).toMatchObject({ invoices: [], kind: null });
    expect((await call<InvoiceDetail>("GET", `/api/invoices/${inv!.id}`)).data).toMatchObject({ status: "unpaid", paidOn: null, deposit: null });
    await call("POST", `/api/transactions/${deposit.id}/match`, { invoiceIds: [inv!.id] });
  });

  it("pays several invoices with one deposit, on the day it arrived", async () => {
    const client = await db.prepare("INSERT INTO clients (name) VALUES ('Globex') RETURNING id").first<{ id: number }>();
    const other = await db.prepare("INSERT INTO clients (name) VALUES ('Initech') RETURNING id").first<{ id: number }>();
    const invoice = (number: string, clientId: number, issued: string, cents: number, name: string) =>
      db
        .prepare(
          `INSERT INTO invoices (number, client_id, period_start, period_end, issued_on, due_on, status, total_cents, client_snapshot)
           VALUES (?, ?, '2026-11-01', '2026-11-30', ?, ?, 'unpaid', ?, ?) RETURNING id`,
        )
        .bind(number, clientId, issued, issued, cents, JSON.stringify({ name }))
        .first<{ id: number }>();
    const a = await invoice("CP-1", client!.id, "2026-12-01", 300000, "Globex");
    const b = await invoice("CP-2", client!.id, "2026-12-15", 200000, "Globex");
    // Another client's invoice that would add up too, but clients pay their own invoices.
    await invoice("CP-3", other!.id, "2026-12-01", 100000, "Initech");
    await invoice("CP-4", client!.id, "2027-01-20", 50000, "Globex");
    const add = (date: string, name: string, cents: number) =>
      db
        .prepare("INSERT INTO bank_transactions (account_id, date, name, amount_cents) SELECT id, ?, ?, ? FROM bank_accounts WHERE plaid_account_id = 'acc-check' RETURNING id")
        .bind(date, name, cents)
        .first<{ id: number }>();
    const both = await add("2027-01-05", "GLOBEX PAYMENT", 500000);
    const short = await add("2027-01-06", "GLOBEX PARTIAL", 340000);
    const early = await add("2026-12-10", "GLOBEX EARLY", 500000);

    const list = (await call<BankTransaction[]>("GET", "/api/transactions?view=review&q=globex")).data;
    expect(byName(list, "GLOBEX PAYMENT").suggestedInvoices?.map((i) => i.number)).toEqual(["CP-1", "CP-2"]);
    // Nothing adds up to it, and an invoice sent after the money arrived can't be what it paid.
    expect(byName(list, "GLOBEX PARTIAL").suggestedInvoices).toBeNull();
    expect(byName(list, "GLOBEX EARLY").suggestedInvoices).toBeNull();

    const paid = await call<BankTransaction>("POST", `/api/transactions/${both!.id}/match`, { invoiceIds: [a!.id, b!.id] });
    expect(paid.data.invoices.map((i) => i.number)).toEqual(["CP-1", "CP-2"]);
    // Both count as income on the day the money arrived, in the year it arrived.
    const detail = (await call<InvoiceDetail>("GET", `/api/invoices/${b!.id}`)).data;
    expect(detail).toMatchObject({ status: "paid", paidOn: "2027-01-05", deposit: { date: "2027-01-05", alsoPaid: ["CP-1"] } });
    const s = (await call<SpendingSummary>("GET", "/api/spending/summary?from=2027-01-01&to=2027-01-31")).data;
    expect(s.receivedCents).toBe(500000);

    // Unpaying one leaves the deposit paying the other.
    await call("PATCH", `/api/invoices/${a!.id}`, { status: "unpaid" });
    expect((await call<BankTransaction[]>("GET", "/api/transactions?view=all&from=2027-01-01&to=2027-01-31&q=globex%20payment")).data[0]).toMatchObject({
      kind: "business",
      invoices: [{ number: "CP-2" }],
    });

    // A deposit that doesn't match the invoices exactly can still pay them. Undo frees them all.
    const partial = await call<BankTransaction>("POST", `/api/transactions/${short!.id}/match`, { invoiceIds: [a!.id, a!.id] });
    expect(partial.data.invoices.map((i) => i.number)).toEqual(["CP-1"]);
    expect((await call("POST", `/api/transactions/${short!.id}/match`, { invoiceIds: [b!.id] })).status).toBe(409);
    expect((await call("POST", `/api/transactions/${early!.id}/match`, { invoiceIds: [b!.id] })).status).toBe(409);
    await call("POST", `/api/transactions/${both!.id}/unmatch`, {});
    expect((await call<InvoiceDetail>("GET", `/api/invoices/${b!.id}`)).data).toMatchObject({ status: "unpaid", paidOn: null });

    // Marking a deposit personal frees the invoices it paid.
    await call("PATCH", `/api/transactions/${short!.id}`, { kind: "personal" });
    expect((await call<InvoiceDetail>("GET", `/api/invoices/${a!.id}`)).data).toMatchObject({ status: "unpaid", deposit: null });

    await db.prepare("DELETE FROM bank_transactions WHERE name LIKE 'GLOBEX%'").run();
    await db.prepare("DELETE FROM invoices WHERE number LIKE 'CP-%'").run();
    await db.prepare("DELETE FROM clients WHERE name IN ('Globex', 'Initech')").run();
  });

  it("totals business spending and money received for a period", async () => {
    const extra = await db
      .prepare(
        "INSERT INTO bank_transactions (account_id, date, name, amount_cents, kind) SELECT id, '2026-10-22', 'SIDE GIG PAYPAL', 25000, 'business' FROM bank_accounts WHERE plaid_account_id = 'acc-check' RETURNING id",
      )
      .first<{ id: number }>();
    const s = (await call<SpendingSummary>("GET", "/api/spending/summary?from=2026-10-01&to=2026-10-31")).data;
    // Adobe $64.99 + AWS $23.00. Netflix and Amazon are personal.
    expect(s.businessSpendingCents).toBe(6499 + 2300);
    expect(s.byCategory).toEqual([{ categoryId: expect.any(Number), name: "Office expense", cents: 8799 }]);
    // The invoice paid Oct 20, plus the other business deposit.
    expect(s.receivedCents).toBe(450000 + 25000);
    await db.prepare("DELETE FROM bank_transactions WHERE id = ?").bind(extra!.id).run();
  });

  it("searches, filters by category, and marks many at once", async () => {
    const oct = "view=all&from=2026-10-01&to=2026-10-31";
    const office = (await call<{ id: number; name: string }[]>("GET", "/api/categories")).data.find((c) => c.name === "Office expense")!.id;
    const netflix = (await call<BankTransaction[]>("GET", `/api/transactions?${oct}&q=NetFlix`)).data;
    expect(netflix.map((t) => t.name)).toEqual(["NETFLIX.COM", "NETFLIX.COM"]);
    expect((await call<BankTransaction[]>("GET", `/api/transactions?${oct}&q=amazon%20web`)).data.map((t) => t.name)).toEqual(["AMAZON WEB SERVICES"]);
    // Words match from their start, so "flix" isn't Netflix.
    expect((await call<BankTransaction[]>("GET", `/api/transactions?${oct}&q=flix`)).data).toEqual([]);
    expect((await call<BankTransaction[]>("GET", `/api/transactions?${oct}&q=netflix.com`)).data).toHaveLength(2);
    const inOffice = (await call<BankTransaction[]>("GET", `/api/transactions?${oct}&categoryId=${office}`)).data;
    expect(inOffice.map((t) => t.name).sort()).toEqual(["ADOBE CREATIVE CLOUD", "AMAZON WEB SERVICES"]);

    // Income: business money in without a category; a refund keeps the category it reverses.
    await db.batch([
      db.prepare("INSERT INTO bank_transactions (account_id, date, name, amount_cents, kind) SELECT id, '2026-10-20', 'CLIENT PAYMENT', 500000, 'business' FROM bank_accounts WHERE plaid_account_id = 'acc-check'"),
      db.prepare("INSERT INTO bank_transactions (account_id, date, name, amount_cents, kind, category_id) SELECT id, '2026-10-21', 'ADOBE REFUND', 2000, 'business', ? FROM bank_accounts WHERE plaid_account_id = 'acc-check'").bind(office),
    ]);
    const income = (await call<BankTransaction[]>("GET", `/api/transactions?view=business&from=2026-10-01&to=2026-10-31&categoryId=income`)).data;
    expect(income.map((t) => t.name)).toContain("CLIENT PAYMENT");
    expect(income.map((t) => t.name)).not.toContain("ADOBE REFUND");
    expect(income.every((t) => t.amountCents > 0 && t.kind === "business" && t.categoryId === null)).toBe(true);
    await db.prepare("DELETE FROM bank_transactions WHERE name IN ('CLIENT PAYMENT', 'ADOBE REFUND')").run();

    // To review can be narrowed to dates.
    await db.batch(
      ["2025-06-01", "2026-06-01"].map((d) =>
        db.prepare("INSERT INTO bank_transactions (account_id, date, name, amount_cents) SELECT id, ?, 'OPEN ONE', -100 FROM bank_accounts WHERE plaid_account_id = 'acc-check'").bind(d),
      ),
    );
    expect((await call<BankTransaction[]>("GET", "/api/transactions?view=review&q=open%20one")).data.map((t) => t.date)).toEqual(["2026-06-01", "2025-06-01"]);
    expect((await call<BankTransaction[]>("GET", "/api/transactions?view=review&q=open%20one&from=2026-01-01&to=2026-12-31")).data.map((t) => t.date)).toEqual(["2026-06-01"]);
    expect((await call("GET", "/api/transactions?view=review&from=2026-01-01")).status).toBe(400);
    await db.prepare("DELETE FROM bank_transactions WHERE name = 'OPEN ONE'").run();

    // A deposit that paid an invoice is left alone.
    const deposit = byName((await call<BankTransaction[]>("GET", `/api/transactions?${oct}`)).data, "ACME CORP ACH");
    const ids = [...netflix.map((t) => t.id), deposit.id];
    const bulk = await call<{ changed: number; skipped: number }>("PATCH", "/api/transactions", { ids, kind: "business", categoryId: office });
    expect(bulk.data).toEqual({ changed: 2, skipped: 1 });
    expect((await call<BankTransaction[]>("GET", `/api/transactions?${oct}&q=netflix`)).data.every((t) => t.kind === "business" && t.categoryId === office && !t.ruleId)).toBe(true);
    expect((await call<{ changed: number }>("PATCH", "/api/transactions", { ids, kind: "personal" })).data.changed).toBe(2);
    expect(byName((await call<BankTransaction[]>("GET", `/api/transactions?${oct}`)).data, "ACME CORP ACH").invoices.map((i) => i.number)).toEqual(["BT-1"]);

    // Business, personal or transfer only.
    expect((await call("PATCH", `/api/transactions/${netflix[0].id}`, { kind: "draw" })).status).toBe(400);
    expect((await call("PATCH", "/api/transactions", { ids: [], kind: "personal" })).status).toBe(400);
  });

  it("keeps health insurance out of business spending", async () => {
    const health = (await call<{ id: number; name: string; deduction: string; scheduleCLine: string | null }[]>("GET", "/api/categories")).data.find(
      (c) => c.name === "Health insurance premiums",
    )!;
    expect(health).toMatchObject({ deduction: "health_insurance", scheduleCLine: null });
    // Only categories something uses are on the short list.
    const cats = (await call<{ name: string; used: boolean }[]>("GET", "/api/categories")).data;
    expect(cats.filter((c) => c.used).map((c) => c.name)).toEqual(["Office expense"]);
    const row = await db
      .prepare(
        "INSERT INTO bank_transactions (account_id, date, name, amount_cents, kind, category_id) SELECT id, '2026-10-24', 'HEALTH PLAN PREMIUM', -50000, 'business', ? FROM bank_accounts WHERE plaid_account_id = 'acc-check' RETURNING id",
      )
      .bind(health.id)
      .first<{ id: number }>();
    const s = (await call<SpendingSummary>("GET", "/api/spending/summary?from=2026-10-01&to=2026-10-31")).data;
    expect(s.businessSpendingCents).toBe(6499 + 2300);
    expect(s.healthInsuranceCents).toBe(50000);
    await db.prepare("DELETE FROM bank_transactions WHERE id = ?").bind(row!.id).run();
  });

  it("keeps a business account's transfers out of income and spending", async () => {
    const oct = "from=2026-10-01&to=2026-10-31";
    const before = (await call<SpendingSummary>("GET", `/api/spending/summary?${oct}`)).data;
    const checking = (await call<BankOverview>("GET", "/api/bank")).data.connections[0].accounts.find((a) => a.name === "Everyday Checking")!;
    expect(checking.businessOnly).toBe(false);
    const on = await call<BankOverview>("PATCH", `/api/bank/accounts/${checking.id}`, { businessOnly: true });
    expect(on.data.connections[0].accounts.find((a) => a.id === checking.id)!.businessOnly).toBe(true);
    expect((await call("PATCH", `/api/bank/accounts/${checking.id}`, { businessOnly: "yes" })).status).toBe(400);

    bank.pages = [
      page({
        added: [
          txn("bo-1", "2026-10-25", "PAYMENT TO REWARDS VISA", -50000, { accountId: "acc-check", category: "LOAN_PAYMENTS" }),
          txn("bo-2", "2026-10-25", "FIGMA ANNUAL", -1500, { accountId: "acc-check" }),
          // The bank calls client payments transfers too, so deposits wait for you.
          txn("bo-3", "2026-10-26", "ONLINE TRANSFER FROM SAVINGS", 100000, { accountId: "acc-check", category: "TRANSFER_IN" }),
        ],
      }),
    ];
    await call("POST", "/api/bank/sync", {});
    const list = (await call<BankTransaction[]>("GET", `/api/transactions?view=all&${oct}`)).data;
    expect(byName(list, "PAYMENT TO REWARDS VISA")).toMatchObject({ kind: "transfer", businessAccount: true, needsReview: false });
    expect(byName(list, "FIGMA ANNUAL")).toMatchObject({ kind: "business", categoryId: null, needsReview: true });
    const deposit = byName(list, "ONLINE TRANSFER FROM SAVINGS");
    expect(deposit).toMatchObject({ kind: null, needsReview: true });

    // Money you put in is a transfer, not income. Card payments aren't spending.
    await call("PATCH", `/api/transactions/${deposit.id}`, { kind: "transfer" });
    const after = (await call<SpendingSummary>("GET", `/api/spending/summary?${oct}`)).data;
    expect(after.receivedCents).toBe(before.receivedCents);
    expect(after.businessSpendingCents).toBe(before.businessSpendingCents + 1500);
    expect((await call<BankTransaction[]>("GET", `/api/transactions?view=transfer&${oct}`)).data.map((t) => t.name).sort()).toEqual([
      "ONLINE TRANSFER FROM SAVINGS",
      "PAYMENT TO REWARDS VISA",
    ]);
    // Rules can sort into transfers too.
    const rule = await call<{ rule: BankRule }>("POST", "/api/rules", { matchText: "transfer from savings", kind: "transfer" });
    expect(rule.data.rule.kind).toBe("transfer");
    await call("DELETE", `/api/rules/${rule.data.rule.id}`);

    // Back to a mixed account: its transfers go back to review.
    await call("PATCH", `/api/bank/accounts/${checking.id}`, { businessOnly: false });
    const back = (await call<BankTransaction[]>("GET", `/api/transactions?view=all&${oct}`)).data;
    expect(byName(back, "PAYMENT TO REWARDS VISA")).toMatchObject({ kind: null, businessAccount: false });
    await db.prepare("DELETE FROM bank_transactions WHERE plaid_transaction_id LIKE 'bo-%'").run();
  });

  it("imports statements for a bank you don't connect, adding only what's new", async () => {
    const columns = { date: "Date", description: "Description", amount: "Amount", moneyOut: "negative" };
    const created = await call<{ id: number; overview: BankOverview }>("POST", "/api/bank/accounts", { name: "Credit union checking", type: "depository", mask: "4321" });
    expect(created.status).toBe(201);
    const id = created.data.id;
    expect(created.data.overview.imported).toEqual([
      expect.objectContaining({ id, name: "Credit union checking", mask: "4321", imported: true, businessOnly: false, csvColumns: null }),
    ]);
    const row = (date: string, description: string, amountCents: number, n = 1) => ({ date, description, amountCents, key: `${date}|${description}|${amountCents}#${n}` });
    const first = await call<{ added: number; skipped: number; sorted: number }>("POST", `/api/bank/accounts/${id}/import`, {
      columns,
      rows: [row("2026-09-02", "NETFLIX.COM", -1549), row("2026-09-03", "COFFEE SHOP", -450), row("2026-09-03", "COFFEE SHOP", -450, 2)],
    });
    // Your rules sort what they can (the netflix rule from earlier).
    expect(first.data).toMatchObject({ added: 3, skipped: 0, sorted: 1 });
    // A later file that overlaps adds only the new rows, and the columns are remembered.
    const second = await call<{ added: number; skipped: number }>("POST", `/api/bank/accounts/${id}/import`, {
      columns,
      rows: [row("2026-09-03", "COFFEE SHOP", -450), row("2026-09-03", "COFFEE SHOP", -450, 2), row("2026-09-10", "CLIENT DEPOSIT", 250000)],
    });
    expect(second.data).toMatchObject({ added: 1, skipped: 2 });
    expect((await call<BankOverview>("GET", "/api/bank")).data.imported[0].csvColumns).toEqual(columns);
    const sept = (await call<BankTransaction[]>("GET", `/api/transactions?view=all&from=2026-09-01&to=2026-09-30&accountId=${id}`)).data;
    expect(sept.map((t) => [t.name, t.kind]).sort()).toEqual([
      ["CLIENT DEPOSIT", null],
      ["COFFEE SHOP", null],
      ["COFFEE SHOP", null],
      ["NETFLIX.COM", "personal"],
    ]);

    // Bad input, and accounts that download on their own, are refused.
    expect((await call("POST", `/api/bank/accounts/${id}/import`, { columns: { date: "Date" }, rows: [row("2026-09-02", "X", -1)] })).status).toBe(400);
    expect((await call("POST", `/api/bank/accounts/${id}/import`, { columns, rows: [{ date: "09/02/2026", description: "X", amountCents: -1, key: "k" }] })).status).toBe(400);
    const connected = (await call<BankOverview>("GET", "/api/bank")).data.connections[0].accounts[0].id;
    expect((await call("POST", `/api/bank/accounts/${connected}/import`, { columns, rows: [row("2026-09-02", "X", -1)] })).status).toBe(409);
    expect((await call("DELETE", `/api/bank/accounts/${connected}`)).status).toBe(409);

    // Removing it removes what was brought in.
    const removed = await call<BankOverview>("DELETE", `/api/bank/accounts/${id}`);
    expect(removed.data.imported).toEqual([]);
    expect((await db.prepare("SELECT count(*) AS n FROM bank_transactions WHERE account_id = ?").bind(id).first<{ n: number }>())!.n).toBe(0);
  });

  it("flags a bank that needs you to log in again, and carries on", async () => {
    bank.pages = [new ProviderError("Log in to Example Bank again.", "ITEM_LOGIN_REQUIRED", true)];
    const sync = await call<SyncResult>("POST", "/api/bank/sync", {});
    expect(sync.data.needsReconnect).toEqual(["Example Bank"]);
    const overview = (await call<BankOverview>("GET", "/api/bank")).data;
    expect(overview.connections[0]).toMatchObject({ status: "reconnect", error: "Log in to Example Bank again." });

    const id = overview.connections[0].id;
    expect((await call<{ linkToken: string }>("POST", "/api/bank/link-token", { connectionId: id })).data.linkToken).toBe("link-update-access-pub");
    const back = await call<{ overview: BankOverview }>("POST", `/api/bank/connections/${id}/reconnected`, {});
    expect(back.data.overview.connections[0].status).toBe("ok");
  });

  it("erasing time and invoices keeps the bank, its transactions and your sorting", async () => {
    const before = (await call<BankTransaction[]>("GET", "/api/transactions?view=all&from=2026-10-01&to=2026-10-31")).data;
    expect(byName(before, "ACME CORP ACH").invoices).toHaveLength(1);
    expect((await call("POST", "/api/data/erase", { confirm: "erase" })).status).toBe(200);
    const after = (await call<BankTransaction[]>("GET", "/api/transactions?view=all&from=2026-10-01&to=2026-10-31")).data;
    expect(after).toHaveLength(before.length);
    expect(byName(after, "NETFLIX.COM").kind).toBe("personal");
    // The deposit's invoice is gone, so it goes back to review.
    expect(byName(after, "ACME CORP ACH")).toMatchObject({ invoices: [], kind: null, needsReview: true });
    expect((await call<BankOverview>("GET", "/api/bank")).data.connections).toHaveLength(1);
    expect((await call<BankRule[]>("GET", "/api/rules")).data.length).toBeGreaterThan(0);
  });

  it("disconnects a bank but keeps what it downloaded", async () => {
    bank.pages = [page({ added: [txn("p9", "2026-11-01", "FIGMA", -1500)], nextCursor: "c9" })];
    await call("POST", "/api/bank/sync", {});
    const id = (await call<BankOverview>("GET", "/api/bank")).data.connections[0].id;
    expect((await call("DELETE", `/api/bank/connections/${id}`)).status).toBe(204);
    expect(bank.removed).toEqual(["access-pub"]);
    expect((await call<BankOverview>("GET", "/api/bank")).data.connections).toEqual([]);
    expect(byName(await review(), "FIGMA").accountName).toBe("Rewards Visa 9876");
  });

  it("loads sample spending, and erasing removes only the sample's", async () => {
    await wipeAll(db);
    expect((await call("POST", "/api/data/sample", { today: "2026-11-08" })).status).toBe(201);
    const open = await review();
    expect(open.length).toBeGreaterThan(3);
    expect(open.every((t) => t.needsReview)).toBe(true);
    await call("POST", "/api/data/erase", { confirm: "erase" });
    expect(await review()).toEqual([]);
  });
});
