import { addDays, startOfWeek } from "../shared/time";
import { type Route, badRequest, conflict, json, readJson } from "./http";

const DEFAULT_TASKS = ["Project management", "UI design", "Frontend development"];

/** Sample clients are the ones from sample data, recognizable by their fictional .example addresses. */
const SAMPLE_CLIENTS = "SELECT id FROM clients WHERE email LIKE '%.example' AND name IN ('Northwind Labs', 'Brightline Events')";

/** Sample bank accounts are the only ones with no bank behind them at all. */
const SAMPLE_ACCOUNTS = "SELECT id FROM bank_accounts WHERE item_id IS NULL AND plaid_account_id IS NULL AND imported = 0";

/**
 * Clear time and invoices so you can start fresh, plus anything sample data added. Everything
 * else stays: your clients and projects, business details, bank connections and their
 * transactions, how you sorted them, rules, tax profile and payments.
 */
async function eraseTimeAndInvoices(db: D1Database) {
  const b = SAMPLE.business;
  const sampleBusiness: [string, string][] = [
    ["business.name", b.name],
    ["business.email", b.email],
    ["business.phone", b.phone],
    ["business.address", b.address],
    ["business.payment_instructions", SAMPLE_PAYMENT],
  ];
  await db.batch([
    // A deposit that paid one of these invoices goes back to To review.
    db.prepare("UPDATE bank_transactions SET kind = NULL WHERE id IN (SELECT deposit_id FROM invoices)"),
    db.prepare(`DELETE FROM bank_transactions WHERE account_id IN (${SAMPLE_ACCOUNTS})`),
    db.prepare(`DELETE FROM bank_accounts WHERE id IN (${SAMPLE_ACCOUNTS})`),
    db.prepare("DELETE FROM invoice_lines"),
    db.prepare("DELETE FROM time_entries"),
    db.prepare("DELETE FROM invoices"),
    // Your clients and projects stay. Only the sample clients go, with their projects.
    db.prepare(`DELETE FROM project_tasks WHERE project_id IN (SELECT id FROM projects WHERE client_id IN (${SAMPLE_CLIENTS}))`),
    db.prepare(`DELETE FROM projects WHERE client_id IN (${SAMPLE_CLIENTS})`),
    db.prepare(`DELETE FROM clients WHERE id IN (${SAMPLE_CLIENTS})`),
    db.prepare("DELETE FROM settings WHERE key IN ('timer', 'invoice.next_number')"),
    // Sample business details go, but only where you haven't changed them.
    ...sampleBusiness.map(([k, v]) => db.prepare("DELETE FROM settings WHERE key = ? AND value = ?").bind(k, v)),
  ]);
}

/** What erasing would delete, so the confirmation can say so. */
async function erasePreview(db: D1Database) {
  const count = async (sql: string) => (await db.prepare(sql).first<{ n: number }>())?.n ?? 0;
  const [clients, projects, timeEntries, invoices, paidInvoices, sampleTransactions] = await Promise.all([
    count(`SELECT count(*) AS n FROM clients WHERE id IN (${SAMPLE_CLIENTS})`),
    count(`SELECT count(*) AS n FROM projects WHERE client_id IN (${SAMPLE_CLIENTS})`),
    count("SELECT count(*) AS n FROM time_entries"),
    count("SELECT count(*) AS n FROM invoices"),
    count("SELECT count(*) AS n FROM invoices WHERE status = 'paid'"),
    count(`SELECT count(*) AS n FROM bank_transactions WHERE account_id IN (${SAMPLE_ACCOUNTS})`),
  ]);
  return { clients, projects, timeEntries, invoices, paidInvoices, sampleTransactions };
}

const SAMPLE_PAYMENT = "Pay by ACH or check.\nThis is sample data.";

// Fictional clients, so sample data is never mistaken for real work.
const SAMPLE = {
  business: { name: "Sample Studio", email: "billing@sample.example", phone: "555-010-0199", address: "123 Example St\nAnytown, MA", next: "S-1001" },
  clients: [
    {
      name: "Northwind Labs",
      email: "ap@northwind.example",
      address: "500 Harbor Rd\nBoston, MA",
      rate: 15000,
      terms: 15,
      period: "monthly",
      project: "Platform redesign",
      tasks: ["Project management", "UI design", "Frontend development"],
    },
    {
      name: "Brightline Events",
      email: "finance@brightline.example",
      address: "42 Market St\nProvidence, RI",
      rate: 12500,
      terms: 15,
      period: "biweekly",
      project: "Onboarding flow",
      tasks: ["Project management", "UI design"],
    },
  ],
  // A typical week: [weekday 0-4, client index, task, minutes, note]
  week: [
    [0, 0, "Project management", 30, "Weekly planning"],
    [0, 0, "Project management", 45, "Kickoff with product and eng leads"],
    [0, 0, "UI design", 180, "Dashboard layouts"],
    [1, 0, "Frontend development", 240, "Build table views"],
    [1, 0, "Project management", 30, "Design review with Dana"],
    [1, 1, "UI design", 120, "Signup screens"],
    [2, 0, "Frontend development", 300, "Filters and search"],
    [2, 1, "Project management", 45, "Client call"],
    [2, 1, "Project management", 30, "Follow up on onboarding copy"],
    [3, 0, "UI design", 150, "Review revisions"],
    [3, 1, "UI design", 180, "Empty states and errors"],
    [4, 0, "Frontend development", 210, "QA fixes"],
  ] as const,
};

async function loadSample(db: D1Database, today: string) {
  if ((await db.prepare("SELECT 1 FROM time_entries LIMIT 1").first()) || (await db.prepare("SELECT 1 FROM invoices LIMIT 1").first())) {
    throw conflict("Sample data can only be loaded when there's no time or invoices. Erase time and invoices first.");
  }
  if (await db.prepare(`SELECT 1 FROM clients WHERE name IN ('Northwind Labs', 'Brightline Events')`).first()) {
    throw conflict("The sample clients are already here.");
  }

  const tasks = new Map<string, number>();
  for (const name of DEFAULT_TASKS) {
    let row = await db.prepare("SELECT id FROM tasks WHERE name = ? COLLATE NOCASE").bind(name).first<{ id: number }>();
    if (!row) row = await db.prepare("INSERT INTO tasks (name) VALUES (?) RETURNING id").bind(name).first<{ id: number }>();
    tasks.set(name, row!.id);
  }

  const projectIds: number[] = [];
  for (const c of SAMPLE.clients) {
    const client = await db
      .prepare("INSERT INTO clients (name, email, address, default_rate_cents, payment_terms_days, billing_period) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(c.name, c.email, c.address, c.rate, c.terms, c.period ?? "monthly")
      .first<{ id: number }>();
    const project = await db
      .prepare("INSERT INTO projects (client_id, name) VALUES (?, ?) RETURNING id")
      .bind(client!.id, c.project)
      .first<{ id: number }>();
    projectIds.push(project!.id);
    await db.batch(
      c.tasks.map((task) => db.prepare("INSERT INTO project_tasks (project_id, task_id) VALUES (?, ?)").bind(project!.id, tasks.get(task))),
    );
  }

  // Six weeks of history up to today, so last month and this month both have time.
  const thisWeek = startOfWeek(today);
  const inserts: D1PreparedStatement[] = [];
  for (let w = 5; w >= 0; w--) {
    const monday = addDays(thisWeek, -7 * w);
    for (const [day, clientIdx, task, minutes, note] of SAMPLE.week) {
      const date = addDays(monday, day);
      if (date > today) continue;
      // Vary the hours a little week to week so reports don't look copy-pasted.
      const wobble = ((w * 7 + day * 3) % 5) * 15 - 30;
      inserts.push(
        db
          .prepare("INSERT INTO time_entries (project_id, task_id, date, minutes, note) VALUES (?, ?, ?, ?, ?)")
          .bind(projectIds[clientIdx], tasks.get(task), date, Math.max(15, minutes + wobble), note),
      );
    }
  }

  const b = SAMPLE.business;
  const settings: [string, string][] = [
    ["business.name", b.name],
    ["business.email", b.email],
    ["business.phone", b.phone],
    ["business.address", b.address],
    ["business.payment_instructions", SAMPLE_PAYMENT],
    ["invoice.next_number", b.next],
  ];
  await db.batch([
    ...inserts,
    // Sample details only fill blanks; your own business details are never overwritten.
    ...settings.map(([k, v]) =>
      db
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE settings.value = ''")
        .bind(k, v),
    ),
  ]);
  await loadSampleSpending(db, today);
}

// A few weeks of card and checking activity, some already sorted, most still to review.
const SAMPLE_SPENDING: [daysAgo: number, account: 0 | 1, name: string, merchant: string | null, cents: number, kind?: string, category?: string][] = [
  [1, 1, "ADOBE *CREATIVE CLOUD", "Adobe", -5999],
  [2, 1, "NETFLIX.COM", "Netflix", -1549, "personal"],
  [3, 1, "AMAZON MKTPLACE PMTS", "Amazon", -15703],
  [4, 0, "NORTHWIND LABS ACH PMT", null, 400000],
  [5, 1, "FIGMA MONTHLY", "Figma", -1500, "business", "Office expense"],
  [6, 1, "STARBUCKS STORE 4412", "Starbucks", -645],
  [8, 0, "COMCAST CABLE", "Comcast", -8999],
  [9, 1, "DELTA AIR LINES", "Delta", -41230],
  [11, 0, "TRANSFER TO SAV 4471", null, -200000, "personal"],
  [12, 1, "WHOLEFDS MKT 10234", "Whole Foods", -8722, "personal"],
  [14, 1, "GITHUB INC", "GitHub", -400, "business", "Office expense"],
  [16, 1, "OFFICE DEPOT 2231", "Office Depot", -3418],
];

async function loadSampleSpending(db: D1Database, today: string) {
  const ids: number[] = [];
  for (const name of ["Sample checking", "Sample credit card"]) {
    const row = await db
      .prepare("INSERT INTO bank_accounts (institution_name, name, mask, type) VALUES ('Sample Bank', ?, ?, ?) RETURNING id")
      .bind(name, name.includes("checking") ? "0001" : "0002", name.includes("checking") ? "depository" : "credit")
      .first<{ id: number }>();
    ids.push(row!.id);
  }
  const categories = new Map(
    ((await db.prepare("SELECT id, name FROM expense_categories").all<{ id: number; name: string }>()).results).map((c) => [c.name, c.id]),
  );
  await db.batch(
    SAMPLE_SPENDING.map(([daysAgo, account, name, merchant, cents, kind, category]) =>
      db
        .prepare("INSERT INTO bank_transactions (account_id, date, name, merchant_name, amount_cents, kind, category_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(ids[account], addDays(today, -daysAgo), name, merchant, cents, kind ?? null, category ? (categories.get(category) ?? null) : null),
    ),
  );
}

export const dataRoutes: Route[] = [
  [
    "POST",
    /^\/api\/data\/erase$/,
    async ({ req, db }) => {
      const b = await readJson(req);
      if (b.confirm !== "erase") throw badRequest('Type "erase" to confirm.');
      await eraseTimeAndInvoices(db);
      return json({ ok: true });
    },
  ],
  ["GET", /^\/api\/data\/erase-preview$/, async ({ db }) => json(await erasePreview(db))],
  [
    "POST",
    /^\/api\/data\/sample$/,
    async ({ req, db }) => {
      const b = await readJson(req);
      const today = typeof b.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.today) ? b.today : new Date().toISOString().slice(0, 10);
      await loadSample(db, today);
      return json({ ok: true }, 201);
    },
  ],
];
