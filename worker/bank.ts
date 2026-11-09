import type {
  BankConnection,
  BankOverview,
  BankRule,
  BankTransaction,
  ExpenseCategory,
  InvoiceRef,
  StatementColumns,
  StatementImportResult,
  StatementRow,
  SpendingSummary,
  SyncResult,
  TransactionKind,
} from "../shared/types";
import { isIsoDate } from "../shared/time";
import { type Route, type Row, all, badRequest, conflict, HttpError, idFrom, int, json, notFound, readJson, str } from "./http";
import { type BankProvider, type ProviderTransaction, ProviderError } from "./plaid";

const KINDS: TransactionKind[] = ["business", "personal", "transfer"];

export async function listCategories(db: D1Database): Promise<ExpenseCategory[]> {
  // In Schedule C order, with health insurance (deducted elsewhere) last.
  const rows = await all(
    db,
    `SELECT c.*,
       EXISTS (SELECT 1 FROM bank_transactions t WHERE t.category_id = c.id) OR EXISTS (SELECT 1 FROM bank_rules r WHERE r.category_id = c.id) AS used
     FROM expense_categories c WHERE c.archived = 0
     ORDER BY c.schedule_c_line IS NULL, CAST(c.schedule_c_line AS INTEGER), c.schedule_c_line, c.name`,
  );
  return rows.map((r) => ({
    id: r.id as number,
    name: r.name as string,
    scheduleCLine: (r.schedule_c_line as string) ?? null,
    deductiblePercent: r.deductible_percent as number,
    deduction: (r.deduction as ExpenseCategory["deduction"]) ?? "schedule_c",
    used: !!r.used,
  }));
}

function requireBank(bank: BankProvider | undefined): BankProvider {
  if (!bank) throw new HttpError(503, "Bank sync isn't set up yet. Add your Plaid keys to the Worker in Cloudflare.");
  return bank;
}

/* Reading */

async function overview(db: D1Database, bank: BankProvider | undefined): Promise<BankOverview> {
  const [items, accounts] = await Promise.all([
    all(db, "SELECT id, institution_name, status, error, last_synced_at FROM bank_items ORDER BY institution_name, id"),
    all(db, "SELECT * FROM bank_accounts WHERE item_id IS NOT NULL OR imported = 1 ORDER BY name"),
  ]);
  const connections: BankConnection[] = items.map((i) => ({
    id: i.id as number,
    institutionName: i.institution_name as string,
    status: i.status as BankConnection["status"],
    error: (i.error as string) ?? null,
    lastSyncedAt: (i.last_synced_at as string) ?? null,
    accounts: accounts.filter((a) => a.item_id === i.id).map(toAccount),
  }));
  return {
    configured: !!bank,
    environment: bank?.environment ?? "production",
    encrypted: !!bank?.encryptsLogins,
    connections,
    imported: accounts.filter((a) => a.imported).map(toAccount),
  };
}

const toAccount = (a: Row) => ({
  id: a.id as number,
  name: a.name as string,
  mask: (a.mask as string) ?? null,
  type: (a.type as string) ?? null,
  institutionName: a.institution_name as string,
  businessOnly: !!a.business_only,
  imported: !!a.imported,
  csvColumns: a.csv_columns ? (JSON.parse(a.csv_columns as string) as StatementColumns) : null,
});

function readColumns(v: unknown): StatementColumns {
  const c = v as StatementColumns;
  const name = (x: unknown) => typeof x === "string" && x.length > 0 && x.length <= 100;
  if (!c || !name(c.date) || !name(c.description)) throw badRequest("Choose the date and description columns.");
  if (!name(c.amount) && !(name(c.debit) && name(c.credit))) throw badRequest("Choose an amount column, or the columns for money out and money in.");
  if (c.moneyOut !== "negative" && c.moneyOut !== "positive") throw badRequest("Say how money going out is shown.");
  return name(c.amount)
    ? { date: c.date, description: c.description, amount: c.amount, moneyOut: c.moneyOut }
    : { date: c.date, description: c.description, debit: c.debit, credit: c.credit, moneyOut: c.moneyOut };
}

async function getImportedAccount(db: D1Database, id: number): Promise<Row> {
  const a = await db.prepare("SELECT * FROM bank_accounts WHERE id = ?").bind(id).first<Row>();
  if (!a) throw notFound("Account not found.");
  if (!a.imported) throw conflict("This account is connected through your bank. Its transactions download on their own.");
  return a;
}

/** A deposit that paid one or more invoices. Its income is counted from the invoices, not here. */
export const paysInvoice = (t: string) => `EXISTS (SELECT 1 FROM invoices pi WHERE pi.deposit_id = ${t}.id)`;

/** Still to do: not yet marked, or business spending without a category. */
const NEEDS_REVIEW = "(t.kind IS NULL OR (t.kind = 'business' AND t.amount_cents < 0 AND t.category_id IS NULL))";

async function listTransactions(db: D1Database, url: URL): Promise<BankTransaction[]> {
  const view = url.searchParams.get("view") ?? "review";
  const where: string[] = [];
  const binds: unknown[] = [];
  // To review shows everything still open, for any dates unless some are given. The other views follow the period.
  if (view === "review") {
    where.push(NEEDS_REVIEW);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (from || to) {
      if (!isIsoDate(from) || !isIsoDate(to)) throw badRequest("from and to must be dates.");
      where.push("t.date BETWEEN ? AND ?");
      binds.push(from, to);
    }
  } else {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!isIsoDate(from) || !isIsoDate(to)) throw badRequest("from and to must be dates.");
    where.push("t.date BETWEEN ? AND ?");
    binds.push(from, to);
    if (KINDS.includes(view as TransactionKind)) {
      where.push("t.kind = ?");
      binds.push(view);
    } else if (view !== "all") throw badRequest("Unknown view.");
  }
  const accountId = url.searchParams.get("accountId");
  if (accountId) {
    where.push("t.account_id = ?");
    binds.push(Number(accountId));
  }
  // Every word must start a word in the description, merchant or note, so "slack" finds every
  // Slack charge and "uber" finds Uber but not "Lubert". Punctuation counts as a space.
  const searchText = ["*", ".", "#", "/", "-", ":", ","].reduce(
    (sql, ch) => `replace(${sql}, '${ch}', ' ')`,
    "(' ' || lower(t.name || ' ' || coalesce(t.merchant_name, '') || ' ' || coalesce(t.note, '')))",
  );
  for (const word of (url.searchParams.get("q") ?? "").toLowerCase().split(/[\s*.#/\-:,]+/).filter(Boolean).slice(0, 8)) {
    where.push(`instr(${searchText}, ?) > 0`);
    binds.push(" " + word);
  }
  const category = url.searchParams.get("categoryId");
  if (category === "none") where.push("t.kind = 'business' AND t.amount_cents < 0 AND t.category_id IS NULL");
  else if (category) {
    where.push("t.category_id = ?");
    binds.push(Number(category));
  }

  const [rows, deposits] = await Promise.all([
    all(
      db,
      `SELECT t.*, a.name AS account_name, a.mask AS account_mask, a.business_only
       FROM bank_transactions t JOIN bank_accounts a ON a.id = t.account_id
       WHERE ${where.join(" AND ")} ORDER BY t.date DESC, t.id DESC LIMIT 3000`,
      ...binds,
    ),
    depositContext(db),
  ]);
  return rows.map((r) => toTransaction(r, deposits));
}

type InvoiceRow = InvoiceRef & { clientId: number; issuedOn: string | null };

const toInvoiceRef = (i: Row): InvoiceRow => ({
  id: i.id as number,
  number: i.number as string,
  clientId: i.client_id as number,
  clientName: i.client_snapshot ? (JSON.parse(i.client_snapshot as string) as { name: string }).name : "",
  totalCents: i.total_cents as number,
  issuedOn: (i.issued_on as string) ?? null,
});
const ref = ({ id, number, clientName, totalCents }: InvoiceRow): InvoiceRef => ({ id, number, clientName, totalCents });

/** Combined payments are looked for among up to this many unpaid invoices per client. */
const MAX_COMBINE = 40;

/**
 * What the transaction list needs to know about invoices: which deposits paid which, and a
 * way to guess what a new deposit pays. A deposit for exactly one unpaid invoice's total is
 * probably that payment. If none fits, two or three unpaid invoices from the same client that
 * add up to it probably were paid together.
 */
async function depositContext(db: D1Database) {
  const [unpaidRows, linkedRows] = await Promise.all([
    all(db, "SELECT id, number, client_id, total_cents, issued_on, client_snapshot FROM invoices WHERE status = 'unpaid' ORDER BY issued_on, number"),
    all(db, "SELECT id, number, client_id, total_cents, issued_on, client_snapshot, deposit_id FROM invoices WHERE deposit_id IS NOT NULL ORDER BY number"),
  ]);
  const paidBy = new Map<number, InvoiceRef[]>();
  for (const r of linkedRows) {
    const list = paidBy.get(r.deposit_id as number) ?? [];
    list.push(ref(toInvoiceRef(r)));
    paidBy.set(r.deposit_id as number, list);
  }

  // Every way to pay with one, two or three invoices, by total. Fewer invoices first.
  const unpaid = unpaidRows.map(toInvoiceRef);
  const byTotal = new Map<number, InvoiceRow[][]>();
  const add = (combo: InvoiceRow[]) => {
    const total = combo.reduce((s, i) => s + i.totalCents, 0);
    const list = byTotal.get(total) ?? [];
    list.push(combo);
    byTotal.set(total, list);
  };
  for (const i of unpaid) add([i]);
  const byClient = new Map<number, InvoiceRow[]>();
  for (const i of unpaid) byClient.set(i.clientId, [...(byClient.get(i.clientId) ?? []), i]);
  const groups = [...byClient.values()].map((g) => g.slice(0, MAX_COMBINE));
  for (const g of groups) {
    for (let a = 0; a < g.length; a++) for (let b = a + 1; b < g.length; b++) add([g[a], g[b]]);
  }
  for (const g of groups) {
    for (let a = 0; a < g.length; a++) for (let b = a + 1; b < g.length; b++) for (let c = b + 1; c < g.length; c++) add([g[a], g[b], g[c]]);
  }

  return {
    paidBy: (depositId: number) => paidBy.get(depositId) ?? [],
    /** Only invoices issued by the day the money arrived. */
    suggest: (amount: number, date: string): InvoiceRef[] | null => {
      const combo = byTotal.get(amount)?.find((c) => c.every((i) => !i.issuedOn || i.issuedOn <= date));
      return combo ? combo.map(ref) : null;
    },
  };
}

function toTransaction(r: Row, deposits: Awaited<ReturnType<typeof depositContext>>): BankTransaction {
  const amount = r.amount_cents as number;
  const kind = (r.kind as TransactionKind) ?? null;
  const invoices = deposits.paidBy(r.id as number);
  const canPay = amount > 0 && invoices.length === 0 && (kind === null || kind === "business");
  return {
    id: r.id as number,
    accountId: r.account_id as number,
    accountName: r.account_mask ? `${r.account_name} ${r.account_mask}` : (r.account_name as string),
    businessAccount: !!r.business_only,
    date: r.date as string,
    name: r.name as string,
    merchantName: (r.merchant_name as string) ?? null,
    amountCents: amount,
    kind,
    categoryId: (r.category_id as number) ?? null,
    invoices,
    ruleId: (r.rule_id as number) ?? null,
    note: (r.note as string) ?? null,
    suggestedInvoices: canPay ? deposits.suggest(amount, r.date as string) : null,
    needsReview: kind === null || (kind === "business" && amount < 0 && r.category_id == null),
  };
}

async function getTransaction(db: D1Database, id: number): Promise<Row> {
  const row = await db.prepare("SELECT * FROM bank_transactions WHERE id = ?").bind(id).first<Row>();
  if (!row) throw notFound("Transaction not found.");
  return row;
}

async function oneTransaction(db: D1Database, id: number): Promise<BankTransaction> {
  const row = await db
    .prepare(
      `SELECT t.*, a.name AS account_name, a.mask AS account_mask, a.business_only
       FROM bank_transactions t JOIN bank_accounts a ON a.id = t.account_id WHERE t.id = ?`,
    )
    .bind(id)
    .first<Row>();
  if (!row) throw notFound("Transaction not found.");
  return toTransaction(row, await depositContext(db));
}

export async function spendingSummary(db: D1Database, from: string, to: string): Promise<SpendingSummary> {
  const [review, cats, received, deposits, health] = await Promise.all([
    db.prepare(`SELECT count(*) AS n FROM bank_transactions t WHERE ${NEEDS_REVIEW}`).first<{ n: number }>(),
    // Business money out, less refunds marked with a category. Invoice payments are income, not refunds.
    all(
      db,
      `SELECT t.category_id, c.name, -sum(t.amount_cents) AS cents
       FROM bank_transactions t LEFT JOIN expense_categories c ON c.id = t.category_id
       WHERE t.kind = 'business' AND NOT ${paysInvoice("t")} AND (t.amount_cents < 0 OR t.category_id IS NOT NULL)
         AND coalesce(c.deduction, 'schedule_c') = 'schedule_c' AND t.date BETWEEN ? AND ?
       GROUP BY t.category_id ORDER BY cents DESC`,
      from,
      to,
    ),
    db.prepare("SELECT coalesce(sum(total_cents), 0) AS n FROM invoices WHERE status = 'paid' AND paid_on BETWEEN ? AND ?").bind(from, to).first<{ n: number }>(),
    // Other business deposits: money in marked business, not tied to an invoice and not a refund.
    db
      .prepare(
        `SELECT coalesce(sum(amount_cents), 0) AS n FROM bank_transactions WHERE kind = 'business' AND amount_cents > 0
           AND NOT ${paysInvoice("bank_transactions")} AND category_id IS NULL AND date BETWEEN ? AND ?`,
      )
      .bind(from, to)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT coalesce(-sum(t.amount_cents), 0) AS n FROM bank_transactions t JOIN expense_categories c ON c.id = t.category_id
         WHERE t.kind = 'business' AND c.deduction = 'health_insurance' AND t.date BETWEEN ? AND ?`,
      )
      .bind(from, to)
      .first<{ n: number }>(),
  ]);
  const byCategory = cats.map((c) => ({ categoryId: (c.category_id as number) ?? null, name: (c.name as string) ?? "Uncategorized", cents: c.cents as number }));
  return {
    from,
    to,
    toReview: review?.n ?? 0,
    businessSpendingCents: byCategory.reduce((s, c) => s + c.cents, 0),
    healthInsuranceCents: health?.n ?? 0,
    receivedCents: (received?.n ?? 0) + (deposits?.n ?? 0),
    byCategory,
  };
}

/* Rules */

/** For every transaction, the rule that fits it best (the longest matching text), as applyRules picks. */
const BEST_RULE = `
  SELECT t.id AS tid, t.kind, t.category_id, t.date,
    (SELECT r.id FROM bank_rules r
     WHERE instr(lower(coalesce(t.merchant_name, '') || ' ' || t.name), lower(r.match_text)) > 0
     ORDER BY length(r.match_text) DESC, r.id LIMIT 1) AS rid
  FROM bank_transactions t`;

/**
 * Each rule with every transaction it fits, whoever sorted them: how many agree with the rule,
 * how many are sorted some other way, and how many are still to review.
 */
async function listRules(db: D1Database): Promise<BankRule[]> {
  const rows = await all(
    db,
    `SELECT r.*, c.name AS category_name,
       count(m.tid) AS matches,
       sum(CASE WHEN m.kind IS NULL THEN 1 ELSE 0 END) AS unsorted,
       sum(CASE WHEN m.kind IS NOT NULL AND (m.kind IS NOT r.kind OR (r.kind = 'business' AND m.category_id IS NOT r.category_id)) THEN 1 ELSE 0 END) AS different,
       min(m.date) AS first_date
     FROM bank_rules r
     LEFT JOIN expense_categories c ON c.id = r.category_id
     LEFT JOIN (${BEST_RULE}) m ON m.rid = r.id
     GROUP BY r.id ORDER BY r.match_text COLLATE NOCASE`,
  );
  return rows.map((r) => ({
    id: r.id as number,
    matchText: r.match_text as string,
    kind: r.kind as TransactionKind,
    categoryId: (r.category_id as number) ?? null,
    categoryName: (r.category_name as string) ?? null,
    matches: r.matches as number,
    unsorted: (r.unsorted as number) ?? 0,
    different: (r.different as number) ?? 0,
    firstDate: (r.first_date as string) ?? null,
  }));
}

/**
 * Sort transactions by rule: anything not yet reviewed, and anything a rule sorted before
 * (so a newer, more specific rule can take over). Your own choices are never touched.
 * The longest matching text wins, so "AMAZON WEB SERVICES" beats "AMAZON".
 * Returns how many transactions changed.
 */
export async function applyRules(db: D1Database): Promise<number> {
  const r = await db
    .prepare(
      `UPDATE bank_transactions AS t
       SET kind = b.kind, category_id = CASE WHEN b.kind = 'business' THEN b.category_id END, rule_id = b.id
       FROM (
         SELECT t2.id AS tid,
           (SELECT r.id FROM bank_rules r
            WHERE instr(lower(coalesce(t2.merchant_name, '') || ' ' || t2.name), lower(r.match_text)) > 0
            ORDER BY length(r.match_text) DESC, r.id LIMIT 1) AS rid
         FROM bank_transactions t2
         WHERE (t2.kind IS NULL OR t2.rule_id IS NOT NULL) AND NOT ${paysInvoice("t2")}
       ) AS m
       JOIN bank_rules b ON b.id = m.rid
       WHERE t.id = m.tid AND (t.rule_id IS NULL OR t.rule_id != b.id)`,
    )
    .run();
  return r.meta.changes ?? 0;
}

/** What the bank calls money moving between your own accounts, or paying off a card. */
const BANK_TRANSFERS = "('TRANSFER_OUT', 'LOAN_PAYMENTS')";

/**
 * On a business-only account, whatever is still unsorted after the rules: money out that the
 * bank calls a transfer or a card payment is a transfer, and other charges are business,
 * waiting for a category. Deposits wait for you, so money you put in isn't taken for income.
 */
export async function applyAccountDefaults(db: D1Database, accountId?: number): Promise<number> {
  const r = await db
    .prepare(
      `UPDATE bank_transactions SET kind = CASE WHEN plaid_category IN ${BANK_TRANSFERS} THEN 'transfer' ELSE 'business' END
       WHERE kind IS NULL AND amount_cents < 0
         AND account_id IN (SELECT id FROM bank_accounts WHERE business_only = 1 ${accountId ? "AND id = ?" : ""})`,
    )
    .bind(...(accountId ? [accountId] : []))
    .run();
  return r.meta.changes ?? 0;
}

/* Syncing */

async function upsertAccounts(db: D1Database, bank: BankProvider, item: Row): Promise<Map<string, number>> {
  const accounts = await bank.accounts(item.access_token as string);
  await db.batch(
    accounts.map((a) =>
      db
        .prepare(
          `INSERT INTO bank_accounts (item_id, plaid_account_id, institution_name, name, mask, type, subtype) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (plaid_account_id) DO UPDATE SET item_id = excluded.item_id, institution_name = excluded.institution_name,
             name = excluded.name, mask = excluded.mask, type = excluded.type, subtype = excluded.subtype`,
        )
        .bind(item.id, a.accountId, item.institution_name, a.name, a.mask, a.type, a.subtype),
    ),
  );
  return accountMap(db, item.id as number);
}

async function accountMap(db: D1Database, itemId: number): Promise<Map<string, number>> {
  const rows = await all(db, "SELECT id, plaid_account_id FROM bank_accounts WHERE item_id = ?", itemId);
  return new Map(rows.map((r) => [r.plaid_account_id as string, r.id as number]));
}

/** Pull everything new for one bank. Pending transactions are skipped; they arrive once posted. */
async function syncItem(db: D1Database, bank: BankProvider, item: Row, result: SyncResult) {
  const added: ProviderTransaction[] = [];
  const modified: ProviderTransaction[] = [];
  const removed: string[] = [];
  let cursor = (item.cursor as string) ?? null;

  // Gather every page first, then write, as Plaid recommends. If the data changes mid-way, start over.
  for (let attempt = 0; ; attempt++) {
    added.length = modified.length = removed.length = 0;
    cursor = (item.cursor as string) ?? null;
    try {
      for (let page = 0; page < 100; page++) {
        const r = await bank.sync(item.access_token as string, cursor);
        added.push(...r.added);
        modified.push(...r.modified);
        removed.push(...r.removed);
        cursor = r.nextCursor;
        if (!r.hasMore) break;
      }
      break;
    } catch (e) {
      if (e instanceof ProviderError && e.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && attempt < 2) continue;
      throw e;
    }
  }

  let accounts = await accountMap(db, item.id as number);
  const upserts = [...added, ...modified].filter((t) => !t.pending);
  if (accounts.size === 0 || upserts.some((t) => !accounts.has(t.accountId))) accounts = await upsertAccounts(db, bank, item);

  const statements: D1PreparedStatement[] = [];
  for (const t of upserts) {
    const accountId = accounts.get(t.accountId);
    if (!accountId) continue;
    // A changed transaction keeps how you reviewed it; only the bank's details update.
    statements.push(
      db
        .prepare(
          `INSERT INTO bank_transactions (account_id, plaid_transaction_id, date, name, merchant_name, amount_cents, plaid_category)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (plaid_transaction_id) DO UPDATE SET account_id = excluded.account_id, date = excluded.date, name = excluded.name,
             merchant_name = excluded.merchant_name, amount_cents = excluded.amount_cents, plaid_category = excluded.plaid_category`,
        )
        .bind(accountId, t.transactionId, t.date, t.name, t.merchantName, t.amountCents, t.category),
    );
  }
  for (const id of removed) statements.push(db.prepare("DELETE FROM bank_transactions WHERE plaid_transaction_id = ?").bind(id));
  statements.push(
    db.prepare("UPDATE bank_items SET cursor = ?, status = 'ok', error = NULL, last_synced_at = datetime('now') WHERE id = ?").bind(cursor, item.id),
  );
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));

  result.added += added.filter((t) => !t.pending).length;
  result.updated += modified.filter((t) => !t.pending).length;
  result.removed += removed.length;
}

/** Sync every connected bank. A failing bank is recorded and the rest carry on. */
export async function syncAll(db: D1Database, bank: BankProvider): Promise<SyncResult> {
  const result: SyncResult = { added: 0, updated: 0, removed: 0, categorized: 0, needsReconnect: [], errors: [] };
  const items = await all(db, "SELECT * FROM bank_items WHERE status = 'ok' ORDER BY id");
  for (const item of items) {
    try {
      await syncItem(db, bank, item, result);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Sync failed.";
      if (e instanceof ProviderError && e.needsReconnect) {
        await db.prepare("UPDATE bank_items SET status = 'reconnect', error = ? WHERE id = ?").bind(message, item.id).run();
        result.needsReconnect.push(item.institution_name as string);
      } else {
        await db.prepare("UPDATE bank_items SET error = ? WHERE id = ?").bind(message, item.id).run();
        result.errors.push(`${item.institution_name}: ${message}`);
      }
    }
  }
  result.categorized = await applyRules(db);
  result.categorized += await applyAccountDefaults(db);
  return result;
}

/* Changes */

/** The invoices this deposit paid go back to unpaid, and the deposit back to To review. */
function releaseDeposit(db: D1Database, depositId: number) {
  return [
    db.prepare("UPDATE invoices SET status = 'unpaid', paid_on = NULL, deposit_id = NULL WHERE deposit_id = ?").bind(depositId),
    db.prepare("UPDATE bank_transactions SET kind = NULL, category_id = NULL, rule_id = NULL WHERE id = ?").bind(depositId),
  ];
}

async function paidInvoiceCount(db: D1Database, depositId: number) {
  return (await db.prepare("SELECT count(*) AS n FROM invoices WHERE deposit_id = ?").bind(depositId).first<{ n: number }>())!.n;
}

async function readCategory(db: D1Database, value: unknown): Promise<number | null> {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) throw badRequest("categoryId must be a category.");
  if (!(await db.prepare("SELECT 1 FROM expense_categories WHERE id = ?").bind(value).first())) throw badRequest("Unknown category.");
  return value;
}

function readKind(value: unknown): TransactionKind | null {
  if (value === null) return null;
  if (!KINDS.includes(value as TransactionKind)) throw badRequest("kind must be business, personal or transfer.");
  return value as TransactionKind;
}

function readRange(url: URL) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw badRequest("from and to must be dates, from <= to.");
  return { from, to };
}

export const bankRoutes: Route[] = [
  ["GET", /^\/api\/bank$/, async ({ db, bank }) => json(await overview(db, bank))],

  [
    "POST",
    /^\/api\/bank\/link-token$/,
    async ({ req, db, bank }) => {
      const provider = requireBank(bank);
      const b = await readJson(req);
      let accessToken: string | undefined;
      if (b.connectionId !== undefined) {
        const item = await db.prepare("SELECT access_token FROM bank_items WHERE id = ?").bind(int(b, "connectionId", { min: 1 })).first<Row>();
        if (!item) throw notFound("Connection not found.");
        accessToken = item.access_token as string;
      }
      return json({ linkToken: await provider.linkToken(accessToken) });
    },
  ],

  [
    "POST",
    /^\/api\/bank\/connections$/,
    async ({ req, db, bank }) => {
      const provider = requireBank(bank);
      const b = await readJson(req);
      const publicToken = str(b, "publicToken", { max: 500 });
      const institutionName = str(b, "institutionName", { max: 200 });
      const { accessToken, itemId } = await provider.exchange(publicToken);
      const item = await db
        .prepare(
          `INSERT INTO bank_items (plaid_item_id, access_token, institution_name) VALUES (?, ?, ?)
           ON CONFLICT (plaid_item_id) DO UPDATE SET access_token = excluded.access_token, status = 'ok', error = NULL RETURNING *`,
        )
        .bind(itemId, accessToken, institutionName)
        .first<Row>();
      await upsertAccounts(db, provider, item!);
      // The bank may still be gathering history. Whatever isn't ready now arrives on the next sync.
      const sync = await syncAll(db, provider);
      return json({ overview: await overview(db, bank), sync }, 201);
    },
  ],

  [
    "POST",
    /^\/api\/bank\/connections\/(\d+)\/reconnected$/,
    async ({ db, params, bank }) => {
      const provider = requireBank(bank);
      const id = idFrom(params[0]);
      const r = await db.prepare("UPDATE bank_items SET status = 'ok', error = NULL WHERE id = ?").bind(id).run();
      if (!r.meta.changes) throw notFound("Connection not found.");
      const sync = await syncAll(db, provider);
      return json({ overview: await overview(db, bank), sync });
    },
  ],

  [
    "DELETE",
    /^\/api\/bank\/connections\/(\d+)$/,
    async ({ db, params, bank }) => {
      const id = idFrom(params[0]);
      const item = await db.prepare("SELECT * FROM bank_items WHERE id = ?").bind(id).first<Row>();
      if (!item) throw notFound("Connection not found.");
      // Stop Plaid's access too. If that fails, the connection is still forgotten here.
      if (bank) await bank.remove(item.access_token as string).catch(() => undefined);
      // Transactions already downloaded stay, with their account.
      await db.prepare("DELETE FROM bank_items WHERE id = ?").bind(id).run();
      return new Response(null, { status: 204 });
    },
  ],

  [
    "POST",
    /^\/api\/bank\/accounts$/,
    async ({ req, db, bank }) => {
      // An account you'll bring in from statements.
      const b = await readJson(req);
      const name = str(b, "name", { max: 80 });
      const type = b.type === "credit" ? "credit" : "depository";
      const mask = typeof b.mask === "string" && /^\d{2,6}$/.test(b.mask.trim()) ? b.mask.trim() : null;
      const institution = typeof b.institutionName === "string" && b.institutionName.trim() ? b.institutionName.trim().slice(0, 80) : "Imported";
      const row = await db
        .prepare("INSERT INTO bank_accounts (institution_name, name, mask, type, imported) VALUES (?, ?, ?, ?, 1) RETURNING id")
        .bind(institution, name, mask, type)
        .first<{ id: number }>();
      return json({ id: row!.id, overview: await overview(db, bank) }, 201);
    },
  ],
  [
    "DELETE",
    /^\/api\/bank\/accounts\/(\d+)$/,
    async ({ db, bank, params }) => {
      // An imported account and everything brought in for it. Invoices it paid stay paid.
      const id = idFrom(params[0]);
      await getImportedAccount(db, id);
      await db.batch([
        db.prepare("DELETE FROM bank_transactions WHERE account_id = ?").bind(id),
        db.prepare("DELETE FROM bank_accounts WHERE id = ?").bind(id),
      ]);
      return json(await overview(db, bank));
    },
  ],
  [
    "POST",
    /^\/api\/bank\/accounts\/(\d+)\/import$/,
    async ({ req, db, params }) => {
      // Rows read from a statement. A row already brought in, from this file or an earlier one, is skipped.
      const id = idFrom(params[0]);
      await getImportedAccount(db, id);
      const b = await readJson(req);
      const columns = readColumns(b.columns);
      if (!Array.isArray(b.rows) || b.rows.length === 0 || b.rows.length > 20000) throw badRequest("rows must be a list of up to 20,000 transactions.");
      const rows = (b.rows as StatementRow[]).map((r) => {
        if (!isIsoDate(r.date) || !Number.isInteger(r.amountCents) || r.amountCents === 0 || typeof r.key !== "string" || r.key.length > 400) {
          throw badRequest("Each row needs a date, a description and an amount.");
        }
        return { date: r.date, description: String(r.description ?? "").trim().slice(0, 300) || "Transaction", amountCents: r.amountCents, key: `csv:${id}:${r.key}` };
      });
      let added = 0;
      for (let i = 0; i < rows.length; i += 50) {
        const results = await db.batch(
          rows
            .slice(i, i + 50)
            .map((r) =>
              db
                .prepare("INSERT INTO bank_transactions (account_id, date, name, amount_cents, import_key) VALUES (?, ?, ?, ?, ?) ON CONFLICT (import_key) DO NOTHING")
                .bind(id, r.date, r.description, r.amountCents, r.key),
            ),
        );
        added += results.reduce((s, r) => s + (r.meta.changes ?? 0), 0);
      }
      await db.prepare("UPDATE bank_accounts SET csv_columns = ? WHERE id = ?").bind(JSON.stringify(columns), id).run();
      const sorted = (await applyRules(db)) + (await applyAccountDefaults(db, id));
      const dates = rows.map((r) => r.date).sort();
      const result: StatementImportResult = { added, skipped: rows.length - added, sorted, from: dates[0], to: dates.at(-1)! };
      return json(result);
    },
  ],
  [
    "PATCH",
    /^\/api\/bank\/accounts\/(\d+)$/,
    async ({ req, db, bank, params }) => {
      // Business-only, or a mix of business and personal.
      const id = idFrom(params[0]);
      const b = await readJson(req);
      if (typeof b.businessOnly !== "boolean") throw badRequest("businessOnly must be true or false.");
      const r = await db.prepare("UPDATE bank_accounts SET business_only = ? WHERE id = ?").bind(b.businessOnly ? 1 : 0, id).run();
      if (!r.meta.changes) throw notFound("Account not found.");
      // Turning it on sorts what's waiting. Turning it off sends its transfers back to review.
      if (b.businessOnly) await applyAccountDefaults(db, id);
      else await db.prepare("UPDATE bank_transactions SET kind = NULL, rule_id = NULL WHERE account_id = ? AND kind = 'transfer'").bind(id).run();
      return json(await overview(db, bank));
    },
  ],

  ["POST", /^\/api\/bank\/sync$/, async ({ db, bank }) => json(await syncAll(db, requireBank(bank)))],

  ["GET", /^\/api\/transactions$/, async ({ db, url }) => json(await listTransactions(db, url))],

  [
    "PATCH",
    /^\/api\/transactions$/,
    async ({ req, db }) => {
      // Mark many at once. Deposits that paid an invoice are left alone; undo those one at a time.
      const b = await readJson(req);
      if (!Array.isArray(b.ids) || b.ids.length === 0 || b.ids.length > 5000 || !b.ids.every((x) => Number.isInteger(x) && x > 0)) {
        throw badRequest("ids must be a list of transactions.");
      }
      const kind = readKind(b.kind);
      const categoryId = kind === "business" && b.categoryId !== undefined ? await readCategory(db, b.categoryId) : null;
      const ids = b.ids as number[];
      let changed = 0;
      for (let i = 0; i < ids.length; i += 90) {
        const chunk = ids.slice(i, i + 90);
        const r = await db
          .prepare(`UPDATE bank_transactions SET kind = ?, category_id = ?, rule_id = NULL WHERE NOT ${paysInvoice("bank_transactions")} AND id IN (${chunk.map(() => "?").join(",")})`)
          .bind(kind, categoryId, ...chunk)
          .run();
        changed += r.meta.changes ?? 0;
      }
      return json({ changed, skipped: ids.length - changed });
    },
  ],

  [
    "PATCH",
    /^\/api\/transactions\/(\d+)$/,
    async ({ req, db, params }) => {
      const id = idFrom(params[0]);
      const row = await getTransaction(db, id);
      const b = await readJson(req);
      const kind = "kind" in b ? readKind(b.kind) : ((row.kind as TransactionKind) ?? null);
      let categoryId = "categoryId" in b ? await readCategory(db, b.categoryId) : ((row.category_id as number) ?? null);
      if (kind !== "business") categoryId = null;

      const statements = [
        // A hand-made change replaces whatever a rule decided.
        db.prepare("UPDATE bank_transactions SET kind = ?, category_id = ?, rule_id = NULL WHERE id = ?").bind(kind, categoryId, id),
      ];
      // No longer business income: the invoices it paid go back to unpaid.
      if (kind !== "business" && (await paidInvoiceCount(db, id)) > 0) {
        statements.push(db.prepare("UPDATE invoices SET status = 'unpaid', paid_on = NULL, deposit_id = NULL WHERE deposit_id = ?").bind(id));
      }
      await db.batch(statements);
      return json(await oneTransaction(db, id));
    },
  ],

  [
    "POST",
    /^\/api\/transactions\/(\d+)\/match$/,
    async ({ req, db, params }) => {
      // The invoices this deposit paid. One deposit can pay several, when a client pays them together.
      const id = idFrom(params[0]);
      const row = await getTransaction(db, id);
      const b = await readJson(req);
      const ids = b.invoiceIds;
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50 || !ids.every((x) => Number.isInteger(x) && x > 0)) {
        throw badRequest("invoiceIds must be a list of invoices.");
      }
      const invoiceIds = [...new Set(ids as number[])];
      if ((row.amount_cents as number) <= 0) throw badRequest("Only money coming in can pay an invoice.");
      if ((await paidInvoiceCount(db, id)) > 0) throw conflict("This deposit already paid an invoice. Undo that first.");
      const invoices = await all(db, `SELECT id, status FROM invoices WHERE id IN (${invoiceIds.map(() => "?").join(",")})`, ...invoiceIds);
      if (invoices.length !== invoiceIds.length) throw notFound("Invoice not found.");
      if (invoices.some((i) => i.status === "paid")) throw conflict("One of those invoices is already paid.");
      // Paid on the day the money arrived, which is when it counts as income.
      await db.batch([
        db
          .prepare(`UPDATE invoices SET status = 'paid', paid_on = ?, deposit_id = ? WHERE id IN (${invoiceIds.map(() => "?").join(",")})`)
          .bind(row.date, id, ...invoiceIds),
        db.prepare("UPDATE bank_transactions SET kind = 'business', category_id = NULL, rule_id = NULL WHERE id = ?").bind(id),
      ]);
      return json(await oneTransaction(db, id));
    },
  ],

  [
    "POST",
    /^\/api\/transactions\/(\d+)\/unmatch$/,
    async ({ db, params }) => {
      const id = idFrom(params[0]);
      await getTransaction(db, id);
      if ((await paidInvoiceCount(db, id)) === 0) throw conflict("This deposit isn't matched to an invoice.");
      await db.batch(releaseDeposit(db, id));
      return json(await oneTransaction(db, id));
    },
  ],

  ["GET", /^\/api\/spending\/summary$/, async ({ db, url }) => {
    const { from, to } = readRange(url);
    return json(await spendingSummary(db, from, to));
  }],

  ["GET", /^\/api\/categories$/, async ({ db }) => json(await listCategories(db))],

  ["GET", /^\/api\/rules$/, async ({ db }) => json(await listRules(db))],
  [
    "POST",
    /^\/api\/rules$/,
    async ({ req, db }) => {
      const b = await readJson(req);
      const matchText = str(b, "matchText", { max: 100 });
      if (matchText.length < 3) throw badRequest("Match at least 3 characters, so a rule doesn't catch everything.");
      const kind = readKind(b.kind);
      if (!kind) throw badRequest("kind is required.");
      const categoryId = kind === "business" && b.categoryId !== undefined ? await readCategory(db, b.categoryId) : null;
      // The same text again updates the rule you already have, so there's never two.
      const rule = await db
        .prepare(
          `INSERT INTO bank_rules (match_text, kind, category_id) VALUES (?, ?, ?)
           ON CONFLICT (match_text COLLATE NOCASE) DO UPDATE SET kind = excluded.kind, category_id = excluded.category_id RETURNING id`,
        )
        .bind(matchText, kind, categoryId)
        .first<{ id: number }>();
      // Transactions it already sorted follow the change.
      await db.prepare("UPDATE bank_transactions SET kind = ?, category_id = ? WHERE rule_id = ?").bind(kind, categoryId, rule!.id).run();
      // If created from a transaction, that one follows the rule too.
      if (typeof b.transactionId === "number") {
        await db
          .prepare(`UPDATE bank_transactions SET kind = ?, category_id = ?, rule_id = ? WHERE id = ? AND NOT ${paysInvoice("bank_transactions")}`)
          .bind(kind, categoryId, rule!.id, b.transactionId)
          .run();
      }
      const applied = await applyRules(db);
      const created = (await listRules(db)).find((r) => r.id === rule!.id)!;
      return json({ rule: created, applied }, 201);
    },
  ],
  [
    "DELETE",
    /^\/api\/rules\/(\d+)$/,
    async ({ db, params }) => {
      // Transactions it already sorted keep their type and category.
      const r = await db.prepare("DELETE FROM bank_rules WHERE id = ?").bind(idFrom(params[0])).run();
      if (!r.meta.changes) throw notFound("Rule not found.");
      return new Response(null, { status: 204 });
    },
  ],
];
