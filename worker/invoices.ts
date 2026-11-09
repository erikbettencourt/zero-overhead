import type { Business, ClientSummary, InvoiceDetail, InvoiceStatus, InvoiceSummary, Report, ReportEntry, ReportLine } from "../shared/types";
import { addDays, isIsoDate, lineAmountCents, nextInvoiceNumber, resolveRateCents } from "../shared/time";
import { type Route, type Row, all, badRequest, conflict, idFrom, int, json, notFound, optStr, readJson } from "./http";

const DEFAULT_FIRST_NUMBER = "1001";

function readInvoiceNumber(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw badRequest("Enter an invoice number.");
  const n = value.trim();
  if (n.length > 40 || !/^[A-Za-z0-9._/-]+$/.test(n)) throw badRequest("Invoice numbers can use letters, digits, dashes, dots and slashes.");
  if (!/\d$/.test(n)) throw badRequest("End the invoice number with a digit, so the next one can count up from it.");
  return n;
}

/* Business details (stored as settings rows) */

const BUSINESS_KEYS: Record<keyof Business, string> = {
  name: "business.name",
  email: "business.email",
  phone: "business.phone",
  address: "business.address",
  logo: "business.logo",
  paymentInstructions: "business.payment_instructions",
  nextInvoiceNumber: "invoice.next_number",
};

export async function getBusiness(db: D1Database): Promise<Business> {
  const rows = await all(db, "SELECT key, value FROM settings WHERE key LIKE 'business.%' OR key = 'invoice.next_number'");
  const map = new Map(rows.map((r) => [r.key as string, r.value as string]));
  return {
    name: map.get(BUSINESS_KEYS.name) ?? "",
    email: map.get(BUSINESS_KEYS.email) ?? "",
    phone: map.get(BUSINESS_KEYS.phone) ?? "",
    address: map.get(BUSINESS_KEYS.address) ?? "",
    logo: map.get(BUSINESS_KEYS.logo) ?? "",
    paymentInstructions: map.get(BUSINESS_KEYS.paymentInstructions) ?? "",
    nextInvoiceNumber: map.get(BUSINESS_KEYS.nextInvoiceNumber) ?? DEFAULT_FIRST_NUMBER,
  };
}

const upsertSetting = (db: D1Database, key: string, value: string) =>
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(key, value);

/* Report: every entry for one client in a date range */

const ENTRY_QUERY = `
  SELECT e.id, e.date, e.minutes, e.note, e.invoice_id, e.invoiced_elsewhere, e.project_id, e.task_id,
         p.name AS project_name, p.rate_cents AS project_rate,
         t.name AS task_name, t.billable,
         c.default_rate_cents AS client_rate,
         i.number AS invoice_number
  FROM time_entries e
  JOIN projects p ON p.id = e.project_id
  JOIN clients c ON c.id = p.client_id
  JOIN tasks t ON t.id = e.task_id
  LEFT JOIN invoices i ON i.id = e.invoice_id`;

const describeRow = (r: Row) => `${r.project_name}, ${r.task_name}`;

const toReportEntry = (r: Row): ReportEntry => ({
  id: r.id as number,
  date: r.date as string,
  description: describeRow(r),
  minutes: r.minutes as number,
  note: (r.note as string) ?? null,
  invoiceId: (r.invoice_id as number) ?? null,
  invoiceNumber: (r.invoice_number as string) ?? null,
  invoicedElsewhere: !!r.invoiced_elsewhere,
});

const isUninvoicedBillable = (r: Row) => !!r.billable && r.invoice_id == null && !r.invoiced_elsewhere && (r.minutes as number) > 0;

function groupLines(rows: Row[]): ReportLine[] {
  const lines = new Map<string, ReportLine>();
  for (const r of rows) {
    const key = `${r.project_id}:${r.task_id}`;
    let line = lines.get(key);
    if (!line) {
      line = {
        projectId: r.project_id as number,
        taskId: r.task_id as number,
        description: describeRow(r),
        billable: !!r.billable,
        minutes: 0,
        rateCents: r.billable
          ? resolveRateCents(r.project_rate as number | null, r.client_rate as number | null)
          : null,
        amountCents: 0,
      };
      lines.set(key, line);
    }
    line.minutes += r.minutes as number;
    // Like Harvest, each entry is rounded and priced on its own, so totals match the invoice line by line.
    if (line.billable && line.rateCents != null) line.amountCents += lineAmountCents(r.minutes as number, line.rateCents);
  }
  return [...lines.values()].sort((a, b) => a.description.localeCompare(b.description));
}

async function buildReport(db: D1Database, clientId: number, from: string, to: string): Promise<{ report: Report; rows: Row[] }> {
  const rows = await all(db, `${ENTRY_QUERY} WHERE p.client_id = ? AND e.date BETWEEN ? AND ? ORDER BY e.date, p.name, t.name, e.id`, clientId, from, to);
  const lines = groupLines(rows);
  const uninvoiced = groupLines(rows.filter(isUninvoicedBillable));
  const report: Report = {
    clientId,
    from,
    to,
    lines,
    entries: rows.map(toReportEntry),
    totalMinutes: lines.reduce((s, l) => s + l.minutes, 0),
    billableMinutes: lines.filter((l) => l.billable).reduce((s, l) => s + l.minutes, 0),
    amountCents: lines.reduce((s, l) => s + l.amountCents, 0),
    uninvoicedMinutes: uninvoiced.reduce((s, l) => s + l.minutes, 0),
    uninvoicedAmountCents: uninvoiced.reduce((s, l) => s + l.amountCents, 0),
    missingRates: uninvoiced.filter((l) => l.rateCents == null).map((l) => l.description),
  };
  return { report, rows };
}

function readRange(from: unknown, to: unknown) {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw badRequest("from and to must be dates, from <= to.");
  return { from, to };
}

/* Invoices */

const toSummary = (r: Row): InvoiceSummary => ({
  id: r.id as number,
  number: r.number as string,
  clientId: r.client_id as number,
  clientName: (r.client_name as string) ?? "",
  periodStart: r.period_start as string,
  periodEnd: r.period_end as string,
  issuedOn: (r.issued_on as string) ?? null,
  dueOn: (r.due_on as string) ?? null,
  status: r.status as InvoiceStatus,
  totalCents: r.total_cents as number,
  paidOn: (r.paid_on as string) ?? null,
});

async function getInvoiceRow(db: D1Database, id: number): Promise<Row> {
  const row = await db
    .prepare("SELECT i.*, c.name AS client_name FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ?")
    .bind(id)
    .first<Row>();
  if (!row) throw notFound("Invoice not found.");
  return row;
}

async function invoiceDetail(db: D1Database, id: number): Promise<InvoiceDetail> {
  const row = await getInvoiceRow(db, id);
  const [lines, entries, deposit, banked] = await Promise.all([
    all(db, "SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id", id),
    all(db, `${ENTRY_QUERY} WHERE e.invoice_id = ? ORDER BY e.date, p.name, t.name, e.id`, id),
    row.deposit_id == null
      ? null
      : db
          .prepare(
            `SELECT t.id, t.date, t.amount_cents, a.name AS account_name, a.mask AS account_mask,
               (SELECT group_concat(number, ', ') FROM invoices WHERE deposit_id = t.id AND id != ?) AS others
             FROM bank_transactions t JOIN bank_accounts a ON a.id = t.account_id WHERE t.id = ?`,
          )
          .bind(id, row.deposit_id)
          .first<Row>(),
    hasBankAccounts(db),
  ]);
  const client = row.client_snapshot ? JSON.parse(row.client_snapshot as string) : { name: row.client_name, email: null, address: null };
  const business = row.business_snapshot ? JSON.parse(row.business_snapshot as string) : { name: "", email: "", address: "", paymentInstructions: "" };
  return {
    ...toSummary(row),
    clientName: client.name,
    notes: (row.notes as string) ?? null,
    paidOn: (row.paid_on as string) ?? null,
    deposit: deposit
      ? {
          id: deposit.id as number,
          date: deposit.date as string,
          amountCents: deposit.amount_cents as number,
          accountName: deposit.account_mask ? `${deposit.account_name} ${deposit.account_mask}` : (deposit.account_name as string),
          alsoPaid: deposit.others ? (deposit.others as string).split(", ") : [],
        }
      : null,
    markPaidByHand: !banked,
    client,
    business,
    lines: lines.map((l) => ({
      description: (l.description as string) ?? "",
      minutes: l.minutes as number,
      rateCents: l.rate_cents as number,
      amountCents: l.amount_cents as number,
    })),
    entries: entries.map(toReportEntry),
  };
}

/** Any bank account, connected or sample. */
async function hasBankAccounts(db: D1Database) {
  return !!(await db.prepare("SELECT 1 AS x FROM bank_accounts LIMIT 1").first());
}

const today = () => new Date().toISOString().slice(0, 10);

const MAX_LOGO_CHARS = 400_000;

/** A small image stored as a data URL. Blank removes it. */
function readLogo(v: unknown): string {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v !== "string" || !/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v)) throw badRequest("The logo must be a PNG, JPEG, WebP or SVG image.");
  if (v.length > MAX_LOGO_CHARS) throw badRequest("That logo is too large. Use an image under about 300 KB.");
  return v;
}

export const invoiceRoutes: Route[] = [
  [
    "PUT",
    /^\/api\/business$/,
    async ({ req, db }) => {
      const b = await readJson(req);
      const values: Record<string, string> = {
        [BUSINESS_KEYS.name]: optStr(b, "name", { max: 200 }) ?? "",
        [BUSINESS_KEYS.email]: optStr(b, "email", { max: 200 }) ?? "",
        [BUSINESS_KEYS.phone]: optStr(b, "phone", { max: 60 }) ?? "",
        [BUSINESS_KEYS.address]: optStr(b, "address", { max: 1000 }) ?? "",
        [BUSINESS_KEYS.logo]: readLogo(b.logo),
        [BUSINESS_KEYS.paymentInstructions]: optStr(b, "paymentInstructions", { max: 2000 }) ?? "",
      };
      // Numbering is set when you create your first invoice; it can still be set here directly.
      if (b.nextInvoiceNumber !== undefined) values[BUSINESS_KEYS.nextInvoiceNumber] = readInvoiceNumber(b.nextInvoiceNumber);
      await db.batch(Object.entries(values).map(([k, v]) => upsertSetting(db, k, v)));
      return json(await getBusiness(db));
    },
  ],

  [
    "GET",
    /^\/api\/summary$/,
    async ({ db, url }) => {
      const { from, to } = readRange(url.searchParams.get("from"), url.searchParams.get("to"));
      const rows = await all(
        db,
        `${ENTRY_QUERY.replace("SELECT e.id", "SELECT c.id AS client_id, c.name AS client_name, c.archived AS client_archived, e.id")} WHERE e.date BETWEEN ? AND ?`,
        from,
        to,
      );
      const byClient = new Map<number, ClientSummary>();
      for (const r of rows) {
        const id = r.client_id as number;
        let s = byClient.get(id);
        if (!s) {
          s = {
            clientId: id,
            clientName: r.client_name as string,
            archived: !!r.client_archived,
            minutes: 0,
            billableMinutes: 0,
            earnedCents: 0,
            invoicedCents: 0,
            uninvoicedMinutes: 0,
            uninvoicedCents: 0,
            missingRateMinutes: 0,
          };
          byClient.set(id, s);
        }
        const minutes = r.minutes as number;
        s.minutes += minutes;
        if (!r.billable) continue;
        s.billableMinutes += minutes;
        const rate = resolveRateCents(r.project_rate as number | null, r.client_rate as number | null);
        // Priced entry by entry, the same way invoices are, so the numbers always agree.
        const amount = rate == null ? 0 : lineAmountCents(minutes, rate);
        s.earnedCents += amount;
        if (r.invoice_id != null || r.invoiced_elsewhere) s.invoicedCents += amount;
        else if (minutes > 0) {
          s.uninvoicedMinutes += minutes;
          s.uninvoicedCents += amount;
          if (rate == null) s.missingRateMinutes += minutes;
        }
      }
      const clients = [...byClient.values()].sort((a, b) => b.earnedCents - a.earnedCents || a.clientName.localeCompare(b.clientName));
      return json({ from, to, clients });
    },
  ],

  [
    "GET",
    /^\/api\/report$/,
    async ({ db, url }) => {
      const clientId = Number(url.searchParams.get("clientId"));
      if (!Number.isInteger(clientId) || clientId <= 0) throw badRequest("clientId is required.");
      const { from, to } = readRange(url.searchParams.get("from"), url.searchParams.get("to"));
      return json((await buildReport(db, clientId, from, to)).report);
    },
  ],

  [
    "GET",
    /^\/api\/invoices$/,
    async ({ db }) => {
      const rows = await all(
        db,
        "SELECT i.*, c.name AS client_name FROM invoices i JOIN clients c ON c.id = i.client_id ORDER BY i.created_at DESC, i.id DESC",
      );
      return json(rows.map(toSummary));
    },
  ],

  [
    "GET",
    /^\/api\/invoices\/(\d+)$/,
    async ({ db, params }) => json(await invoiceDetail(db, idFrom(params[0]))),
  ],

  [
    "POST",
    /^\/api\/invoices$/,
    async ({ req, db }) => {
      const b = await readJson(req);
      const clientId = int(b, "clientId", { min: 1 });
      const { from, to } = readRange(b.from, b.to);
      const issuedOn = b.issuedOn === undefined ? today() : b.issuedOn;
      if (!isIsoDate(issuedOn)) throw badRequest("issuedOn must be a date.");
      if (b.dueOn !== undefined && b.dueOn !== null && (!isIsoDate(b.dueOn) || b.dueOn < issuedOn)) throw badRequest("dueOn must be a date on or after the issue date.");

      const client = await db.prepare("SELECT * FROM clients WHERE id = ?").bind(clientId).first<Row>();
      if (!client) throw notFound("Client not found.");
      const business = await getBusiness(db);
      if (!business.name) throw badRequest("Add your business name in Settings, under Your business, before creating invoices.");

      const { rows } = await buildReport(db, clientId, from, to);
      const billable = rows.filter(isUninvoicedBillable);
      if (billable.length === 0) throw conflict("There's no uninvoiced billable time for this client in that period.");
      const missing = groupLines(billable).filter((l) => l.rateCents == null);
      if (missing.length) throw badRequest(`Set a rate before invoicing: ${missing.map((l) => l.description).join("; ")}.`);
      // The invoice is the summary, one line per project and task. The hours report after it lists every entry.
      const lines = groupLines(billable).map((l) => ({ ...l, rateCents: l.rateCents! }));

      // Your first invoice picks its own number, so numbering can carry on from QuickBooks or Harvest.
      // After that, each invoice takes the next number.
      let number = business.nextInvoiceNumber;
      if (b.number !== undefined) {
        if (await db.prepare("SELECT 1 FROM invoices LIMIT 1").first()) throw conflict("Numbering is already set. New invoices continue from your last one.");
        number = readInvoiceNumber(b.number);
      }
      if (await db.prepare("SELECT 1 FROM invoices WHERE number = ?").bind(number).first()) {
        throw conflict(`Invoice ${number} already exists.`);
      }
      const total = lines.reduce((s, l) => s + l.amountCents, 0);
      const dueOn = (b.dueOn as string | undefined) ?? addDays(issuedOn, client.payment_terms_days as number);
      const maxId = Math.max(...billable.map((r) => r.id as number));
      const { nextInvoiceNumber: _ignored, ...businessSnapshot } = business;
      const clientSnapshot = { name: client.name, email: client.email ?? null, address: client.address ?? null };
      const invoiceId = "(SELECT id FROM invoices WHERE number = ?)";

      // One transaction: the invoice, its lines, locking exactly the entries it covers, and the next number.
      await db.batch([
        db
          .prepare(
            `INSERT INTO invoices (number, client_id, period_start, period_end, issued_on, due_on, status, total_cents, notes, client_snapshot, business_snapshot)
             VALUES (?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, ?, ?)`,
          )
          .bind(number, clientId, from, to, issuedOn, dueOn, total, optStr(b, "notes") ?? null, JSON.stringify(clientSnapshot), JSON.stringify(businessSnapshot)),
        ...lines.map((l) =>
          db
            .prepare(
              `INSERT INTO invoice_lines (invoice_id, project_id, task_id, minutes, rate_cents, amount_cents, description)
               VALUES (${invoiceId}, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(number, l.projectId, l.taskId, l.minutes, l.rateCents, l.amountCents, l.description),
        ),
        db
          .prepare(
            `UPDATE time_entries SET invoice_id = ${invoiceId}
             WHERE invoice_id IS NULL AND invoiced_elsewhere = 0 AND minutes > 0 AND id <= ? AND id IN (
               SELECT e.id FROM time_entries e JOIN projects p ON p.id = e.project_id JOIN tasks t ON t.id = e.task_id
               WHERE p.client_id = ? AND e.date BETWEEN ? AND ? AND t.billable = 1)`,
          )
          .bind(number, maxId, clientId, from, to),
        upsertSetting(db, BUSINESS_KEYS.nextInvoiceNumber, nextInvoiceNumber(number)),
      ]);

      const created = await db.prepare("SELECT id FROM invoices WHERE number = ?").bind(number).first<{ id: number }>();
      return json(await invoiceDetail(db, created!.id), 201);
    },
  ],

  [
    "PATCH",
    /^\/api\/invoices\/(\d+)$/,
    async ({ req, db, params }) => {
      const id = idFrom(params[0]);
      const row = await getInvoiceRow(db, id);
      const b = await readJson(req);

      const status = b.status as InvoiceStatus | undefined;
      if (status !== undefined && !["unpaid", "paid"].includes(status)) throw badRequest("Status must be unpaid or paid.");
      for (const k of ["issuedOn", "dueOn", "paidOn"]) {
        if (k in b && b[k] !== null && !isIsoDate(b[k])) throw badRequest(`${k} must be a date.`);
      }
      // With a bank connected, an invoice is paid by matching its deposit in Spending, so the
      // paid date is the day the money arrived and the deposit isn't counted twice.
      if (status === "paid" && row.status !== "paid" && (await hasBankAccounts(db))) {
        throw conflict("Match the deposit that paid this invoice in Spending. That marks it paid on the day the money arrived.");
      }
      if (b.paidOn !== undefined && row.deposit_id != null) throw conflict("This invoice's paid date is the day its deposit arrived.");
      const nextStatus = status ?? (row.status as InvoiceStatus);
      if (nextStatus === "paid" && (b.issuedOn !== undefined || b.dueOn !== undefined)) {
        throw conflict("Mark the invoice unpaid before changing its dates.");
      }
      const issued = (b.issuedOn as string | undefined) ?? (row.issued_on as string | null);
      const due = (b.dueOn as string | undefined) ?? (row.due_on as string | null);
      if (issued && due && due < issued) throw badRequest("The due date can't be before the issue date.");

      const set: Record<string, unknown> = {
        issued_on: b.issuedOn,
        due_on: b.dueOn,
        notes: optStr(b, "notes"),
        status,
      };
      // Paid means money received: the date it arrived is what counts as income.
      if (status === "paid") set.paid_on = (b.paidOn as string | undefined) ?? row.paid_on ?? today();
      else if (status === undefined && b.paidOn !== undefined && row.status === "paid") set.paid_on = b.paidOn;
      if (status === "unpaid") Object.assign(set, { paid_on: null, deposit_id: null });

      const cols = Object.entries(set).filter(([, v]) => v !== undefined);
      if (cols.length === 0) throw badRequest("Nothing to update.");
      const statements = [
        db.prepare(`UPDATE invoices SET ${cols.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`).bind(...cols.map(([, v]) => v), id),
      ];
      // Unpaid again: a deposit that paid only this invoice goes back to To review.
      if (status === "unpaid" && row.deposit_id != null) {
        statements.push(
          db
            .prepare("UPDATE bank_transactions SET kind = NULL WHERE id = ? AND NOT EXISTS (SELECT 1 FROM invoices WHERE deposit_id = ? AND id != ?)")
            .bind(row.deposit_id, row.deposit_id, id),
        );
      }
      await db.batch(statements);
      return json(await invoiceDetail(db, id));
    },
  ],

  [
    "DELETE",
    /^\/api\/invoices\/(\d+)$/,
    async ({ db, params }) => {
      const id = idFrom(params[0]);
      const row = await getInvoiceRow(db, id);
      // Deleting an unpaid invoice releases its hours, so they can be invoiced again or combined into another invoice.
      if (row.status === "paid") throw conflict("Mark the invoice unpaid before deleting it.");
      const business = await getBusiness(db);
      const statements = [
        db.prepare("UPDATE time_entries SET invoice_id = NULL WHERE invoice_id = ?").bind(id),
        db.prepare("DELETE FROM invoice_lines WHERE invoice_id = ?").bind(id),
        db.prepare("DELETE FROM invoices WHERE id = ?").bind(id),
      ];
      // Deleting the most recent invoice gives its number back, so there's no gap.
      if (nextInvoiceNumber(row.number as string) === business.nextInvoiceNumber) {
        statements.push(upsertSetting(db, BUSINESS_KEYS.nextInvoiceNumber, row.number as string));
      }
      await db.batch(statements);
      return new Response(null, { status: 204 });
    },
  ],
];
