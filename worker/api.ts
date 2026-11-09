import type { Bootstrap, Client, Project, ProjectTask, Task, TimeEntry, Timer } from "../shared/types";
import { isIsoDate } from "../shared/time";
import {
  type Route,
  type Row,
  all,
  HttpError,
  badRequest,
  conflict,
  idFrom,
  int,
  isUniqueViolation,
  json,
  notFound,
  optBool,
  optInt,
  optStr,
  readJson,
  setClause,
  str,
} from "./http";
import { importHarvest } from "./import";
import { getBusiness, invoiceRoutes } from "./invoices";
import { dataRoutes } from "./data";
import { bankRoutes, listCategories } from "./bank";
import { taxRoutes } from "./taxes";
import { quickbooksRoutes } from "./quickbooks";
import { backupRoutes } from "./backup";
import type { BankProvider } from "./plaid";


const MAX_MINUTES_PER_ENTRY = 24 * 60;
const RATE_MAX = 100_000_00; // $100k/hour is plenty

const toClient = (r: Row): Client => ({
  id: r.id as number,
  name: r.name as string,
  email: (r.email as string) ?? null,
  address: (r.address as string) ?? null,
  defaultRateCents: (r.default_rate_cents as number) ?? null,
  paymentTermsDays: r.payment_terms_days as number,
  billingPeriod: ((r.billing_period as string) ?? "monthly") as Client["billingPeriod"],
  archived: !!r.archived,
});

const BILLING_PERIODS = ["monthly", "biweekly", "quarterly"] as const;
function readBillingPeriod(b: Record<string, unknown>): Client["billingPeriod"] | undefined {
  if (b.billingPeriod === undefined) return undefined;
  if (!BILLING_PERIODS.includes(b.billingPeriod as never)) throw badRequest("billingPeriod must be monthly, biweekly or quarterly.");
  return b.billingPeriod as Client["billingPeriod"];
}

const toProject = (r: Row): Project => ({
  id: r.id as number,
  clientId: r.client_id as number,
  name: r.name as string,
  rateCents: (r.rate_cents as number) ?? null,
  archived: !!r.archived,
});

const toTask = (r: Row): Task => ({
  id: r.id as number,
  name: r.name as string,
  billable: !!r.billable,
  archived: !!r.archived,
});

const toProjectTask = (r: Row): ProjectTask => ({
  projectId: r.project_id as number,
  taskId: r.task_id as number,
  rateCents: (r.rate_cents as number) ?? null,
});

const toEntry = (r: Row): TimeEntry => ({
  id: r.id as number,
  projectId: r.project_id as number,
  taskId: r.task_id as number,
  date: r.date as string,
  minutes: r.minutes as number,
  note: (r.note as string) ?? null,
  locked: r.invoice_id != null || !!r.invoiced_elsewhere,
});


async function getTimer(db: D1Database): Promise<Timer | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'timer'").first<{ value: string }>();
  return row ? (JSON.parse(row.value) as Timer) : null;
}

async function requireProjectTask(db: D1Database, projectId: number, taskId: number) {
  const link = await db
    .prepare("SELECT 1 FROM project_tasks WHERE project_id = ? AND task_id = ?")
    .bind(projectId, taskId)
    .first();
  if (!link) throw badRequest("That task isn't assigned to that project.");
}

async function requireUnlocked(db: D1Database, id: number): Promise<Row> {
  const row = await db.prepare("SELECT * FROM time_entries WHERE id = ?").bind(id).first<Row>();
  if (!row) throw notFound("Entry not found.");
  if (row.invoice_id != null || row.invoiced_elsewhere) throw conflict("This entry has been invoiced and is locked.");
  return row;
}

const routes: Route[] = [
  [
    "GET",
    /^\/api\/bootstrap$/,
    async ({ db, email }) => {
      const [clients, projects, tasks, projectTasks, timer, business, categories] = await Promise.all([
        all(db, "SELECT * FROM clients ORDER BY archived, name COLLATE NOCASE"),
        all(db, "SELECT * FROM projects ORDER BY archived, name COLLATE NOCASE"),
        all(db, "SELECT * FROM tasks ORDER BY archived, name COLLATE NOCASE"),
        all(db, "SELECT * FROM project_tasks"),
        getTimer(db),
        getBusiness(db),
        listCategories(db),
      ]);
      const body: Bootstrap = {
        email,
        clients: clients.map(toClient),
        projects: projects.map(toProject),
        tasks: tasks.map(toTask),
        projectTasks: projectTasks.map(toProjectTask),
        timer,
        business,
        categories,
      };
      return json(body);
    },
  ],

  // Clients
  [
    "POST",
    /^\/api\/clients$/,
    async ({ req, db }) => {
      const b = await readJson(req);
      try {
        const row = await db
          .prepare(
            "INSERT INTO clients (name, email, address, default_rate_cents, payment_terms_days, billing_period) VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
          )
          .bind(
            str(b, "name"),
            optStr(b, "email", { max: 200 }) ?? null,
            optStr(b, "address") ?? null,
            optInt(b, "defaultRateCents", { min: 0, max: RATE_MAX }) ?? null,
            optInt(b, "paymentTermsDays", { min: 0, max: 365 }) ?? 15,
            readBillingPeriod(b) ?? "monthly",
          )
          .first<Row>();
        return json(toClient(row!), 201);
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict("A client with that name already exists.");
        throw e;
      }
    },
  ],
  [
    "PATCH",
    /^\/api\/clients\/(\d+)$/,
    async ({ req, db, params }) => {
      const b = await readJson(req);
      const { sql, values } = setClause({
        name: "name" in b ? str(b, "name") : undefined,
        email: optStr(b, "email", { max: 200 }),
        address: optStr(b, "address"),
        default_rate_cents: optInt(b, "defaultRateCents", { min: 0, max: RATE_MAX }),
        payment_terms_days: "paymentTermsDays" in b ? int(b, "paymentTermsDays", { min: 0, max: 365 }) : undefined,
        billing_period: readBillingPeriod(b),
        archived: optBool(b, "archived"),
      });
      try {
        const row = await db
          .prepare(`UPDATE clients SET ${sql} WHERE id = ? RETURNING *`)
          .bind(...values, idFrom(params[0]))
          .first<Row>();
        if (!row) throw notFound("Client not found.");
        return json(toClient(row));
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict("A client with that name already exists.");
        throw e;
      }
    },
  ],

  // Projects
  [
    "POST",
    /^\/api\/projects$/,
    async ({ req, db }) => {
      const b = await readJson(req);
      const clientId = int(b, "clientId", { min: 1 });
      if (!(await db.prepare("SELECT 1 FROM clients WHERE id = ?").bind(clientId).first())) throw badRequest("Unknown client.");
      try {
        const row = await db
          .prepare("INSERT INTO projects (client_id, name, rate_cents) VALUES (?, ?, ?) RETURNING *")
          .bind(clientId, str(b, "name"), optInt(b, "rateCents", { min: 0, max: RATE_MAX }) ?? null)
          .first<Row>();
        return json(toProject(row!), 201);
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict("That client already has a project with that name.");
        throw e;
      }
    },
  ],
  [
    "PATCH",
    /^\/api\/projects\/(\d+)$/,
    async ({ req, db, params }) => {
      const b = await readJson(req);
      const { sql, values } = setClause({
        name: "name" in b ? str(b, "name") : undefined,
        rate_cents: optInt(b, "rateCents", { min: 0, max: RATE_MAX }),
        archived: optBool(b, "archived"),
      });
      try {
        const row = await db
          .prepare(`UPDATE projects SET ${sql} WHERE id = ? RETURNING *`)
          .bind(...values, idFrom(params[0]))
          .first<Row>();
        if (!row) throw notFound("Project not found.");
        return json(toProject(row));
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict("That client already has a project with that name.");
        throw e;
      }
    },
  ],
  [
    "PUT",
    /^\/api\/projects\/(\d+)\/tasks$/,
    async ({ req, db, params }) => {
      const projectId = idFrom(params[0]);
      const b = await readJson(req);
      if (!Array.isArray(b.tasks)) throw badRequest("tasks must be a list.");
      if (!(await db.prepare("SELECT 1 FROM projects WHERE id = ?").bind(projectId).first())) throw notFound("Project not found.");
      const links = (b.tasks as Record<string, unknown>[]).map((t) => ({
        taskId: int(t, "taskId", { min: 1 }),
      }));
      await db.batch([
        db.prepare("DELETE FROM project_tasks WHERE project_id = ?").bind(projectId),
        ...links.map((l) =>
          db
            .prepare("INSERT INTO project_tasks (project_id, task_id) SELECT ?, id FROM tasks WHERE id = ?")
            .bind(projectId, l.taskId),
        ),
      ]);
      const rows = await all(db, "SELECT * FROM project_tasks WHERE project_id = ?", projectId);
      return json(rows.map(toProjectTask));
    },
  ],

  // Tasks
  [
    "POST",
    /^\/api\/tasks$/,
    async ({ req, db }) => {
      const b = await readJson(req);
      try {
        const row = await db
          .prepare("INSERT INTO tasks (name, billable) VALUES (?, ?) RETURNING *")
          .bind(str(b, "name"), optBool(b, "billable") === false ? 0 : 1)
          .first<Row>();
        return json(toTask(row!), 201);
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict("A task with that name already exists.");
        throw e;
      }
    },
  ],
  [
    "PATCH",
    /^\/api\/tasks\/(\d+)$/,
    async ({ req, db, params }) => {
      const b = await readJson(req);
      const { sql, values } = setClause({
        name: "name" in b ? str(b, "name") : undefined,
        billable: optBool(b, "billable"),
        archived: optBool(b, "archived"),
      });
      try {
        const row = await db
          .prepare(`UPDATE tasks SET ${sql} WHERE id = ? RETURNING *`)
          .bind(...values, idFrom(params[0]))
          .first<Row>();
        if (!row) throw notFound("Task not found.");
        return json(toTask(row));
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict("A task with that name already exists.");
        throw e;
      }
    },
  ],

  [
    "GET",
    /^\/api\/tasks\/(\d+)\/usage$/,
    async ({ db, params }) => {
      const id = idFrom(params[0]);
      const r = await db
        .prepare(
          `SELECT (SELECT count(*) FROM time_entries WHERE task_id = ?) AS entries,
                  (SELECT count(*) FROM project_tasks WHERE task_id = ?) AS projects`,
        )
        .bind(id, id)
        .first<{ entries: number; projects: number }>();
      return json(r);
    },
  ],
  [
    "POST",
    /^\/api\/tasks\/(\d+)\/merge$/,
    async ({ req, db, params }) => {
      // Fold a duplicate task into another: its projects, time entries and invoice lines move
      // over, a running timer follows, and the duplicate is deleted. Issued invoices keep
      // their wording, since each line stores its own description.
      const from = idFrom(params[0]);
      const into = int(await readJson(req), "intoId", { min: 1 });
      if (from === into) throw badRequest("Choose a different task to merge into.");
      const [a, b] = await Promise.all([
        db.prepare("SELECT id FROM tasks WHERE id = ?").bind(from).first(),
        db.prepare("SELECT id FROM tasks WHERE id = ?").bind(into).first(),
      ]);
      if (!a || !b) throw notFound("Task not found.");
      const timer = await getTimer(db);
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO project_tasks (project_id, task_id) SELECT project_id, ? FROM project_tasks WHERE task_id = ?").bind(into, from),
        db.prepare("DELETE FROM project_tasks WHERE task_id = ?").bind(from),
        db.prepare("UPDATE time_entries SET task_id = ? WHERE task_id = ?").bind(into, from),
        db.prepare("UPDATE invoice_lines SET task_id = ? WHERE task_id = ?").bind(into, from),
        ...(timer?.taskId === from ? [db.prepare("UPDATE settings SET value = ? WHERE key = 'timer'").bind(JSON.stringify({ ...timer, taskId: into }))] : []),
        db.prepare("DELETE FROM tasks WHERE id = ?").bind(from),
      ]);
      return json({ ok: true });
    },
  ],

  // Time entries
  [
    "GET",
    /^\/api\/entries$/,
    async ({ db, url }) => {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw badRequest("from and to must be dates, from <= to.");
      const rows = await all(db, "SELECT * FROM time_entries WHERE date BETWEEN ? AND ? ORDER BY date, id", from, to);
      return json(rows.map(toEntry));
    },
  ],
  [
    "POST",
    /^\/api\/entries$/,
    async ({ req, db }) => {
      const b = await readJson(req);
      const projectId = int(b, "projectId", { min: 1 });
      const taskId = int(b, "taskId", { min: 1 });
      const date = b.date;
      if (!isIsoDate(date)) throw badRequest("date must be YYYY-MM-DD.");
      await requireProjectTask(db, projectId, taskId);
      const row = await db
        .prepare("INSERT INTO time_entries (project_id, task_id, date, minutes, note) VALUES (?, ?, ?, ?, ?) RETURNING *")
        .bind(projectId, taskId, date, int(b, "minutes", { min: 0, max: MAX_MINUTES_PER_ENTRY }), optStr(b, "note") ?? null)
        .first<Row>();
      return json(toEntry(row!), 201);
    },
  ],
  [
    "PATCH",
    /^\/api\/entries\/(\d+)$/,
    async ({ req, db, params }) => {
      const id = idFrom(params[0]);
      const existing = await requireUnlocked(db, id);
      const b = await readJson(req);
      if ("date" in b && !isIsoDate(b.date)) throw badRequest("date must be YYYY-MM-DD.");
      const projectId = optInt(b, "projectId", { min: 1 }) ?? undefined;
      const taskId = optInt(b, "taskId", { min: 1 }) ?? undefined;
      if (projectId !== undefined || taskId !== undefined) {
        await requireProjectTask(db, projectId ?? (existing.project_id as number), taskId ?? (existing.task_id as number));
      }
      const { sql, values } = setClause({
        project_id: projectId,
        task_id: taskId,
        date: b.date as string | undefined,
        minutes: "minutes" in b ? int(b, "minutes", { min: 0, max: MAX_MINUTES_PER_ENTRY }) : undefined,
        note: optStr(b, "note"),
      });
      const row = await db
        .prepare(`UPDATE time_entries SET ${sql}, updated_at = datetime('now') WHERE id = ? RETURNING *`)
        .bind(...values, id)
        .first<Row>();
      return json(toEntry(row!));
    },
  ],
  [
    "DELETE",
    /^\/api\/entries\/(\d+)$/,
    async ({ db, params }) => {
      const id = idFrom(params[0]);
      await requireUnlocked(db, id);
      await db.prepare("DELETE FROM time_entries WHERE id = ?").bind(id).run();
      return new Response(null, { status: 204 });
    },
  ],

  // Timer: one running timer, stored as a setting.
  [
    "POST",
    /^\/api\/timer\/start$/,
    async ({ req, db }) => {
      if (await getTimer(db)) throw conflict("A timer is already running.");
      const b = await readJson(req);
      const projectId = int(b, "projectId", { min: 1 });
      const taskId = int(b, "taskId", { min: 1 });
      if (!isIsoDate(b.date)) throw badRequest("date must be YYYY-MM-DD.");
      await requireProjectTask(db, projectId, taskId);
      const timer: Timer = { projectId, taskId, note: optStr(b, "note") ?? null, date: b.date, startedAt: new Date().toISOString() };
      await db.prepare("INSERT INTO settings (key, value) VALUES ('timer', ?)").bind(JSON.stringify(timer)).run();
      return json(timer, 201);
    },
  ],
  [
    "POST",
    /^\/api\/timer\/stop$/,
    async ({ db }) => {
      const timer = await getTimer(db);
      if (!timer) throw conflict("No timer is running.");
      const elapsed = Math.max(1, Math.ceil((Date.now() - Date.parse(timer.startedAt)) / 60000));
      const minutes = Math.min(elapsed, MAX_MINUTES_PER_ENTRY);
      const [, inserted] = await db.batch([
        db.prepare("DELETE FROM settings WHERE key = 'timer'"),
        db
          .prepare("INSERT INTO time_entries (project_id, task_id, date, minutes, note) VALUES (?, ?, ?, ?, ?) RETURNING *")
          .bind(timer.projectId, timer.taskId, timer.date, minutes, timer.note),
      ]);
      return json(toEntry((inserted.results as Row[])[0]), 201);
    },
  ],
  [
    "POST",
    /^\/api\/timer\/discard$/,
    async ({ db }) => {
      await db.prepare("DELETE FROM settings WHERE key = 'timer'").run();
      return new Response(null, { status: 204 });
    },
  ],

  // Harvest import
  [
    "POST",
    /^\/api\/import\/harvest$/,
    async ({ req, db }) => json(await importHarvest(db, await readJson(req))),
  ],

  ...invoiceRoutes,
  ...dataRoutes,
  ...bankRoutes,
  ...taxRoutes,
  ...quickbooksRoutes,
  ...backupRoutes,
];

export async function handleApi(req: Request, db: D1Database | undefined, email: string, bank?: BankProvider, backups?: R2Bucket): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/api/me") return json({ email });
  if (url.pathname === "/api/health") {
    let database = "not connected";
    if (db) {
      try {
        await db.prepare("SELECT 1").first();
        database = "ok";
      } catch {
        database = "error";
      }
    }
    return json({ status: "ok", database });
  }

  if (!db) return json({ error: "The database isn't connected." }, 503);

  for (const [method, pattern, handler] of routes) {
    const match = pattern.exec(url.pathname);
    if (!match) continue;
    if (req.method !== method) continue;
    try {
      return await handler({ req, db, params: match.slice(1), url, email, bank, backups });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Something went wrong." }, 500);
    }
  }

  const known = routes.some(([, pattern]) => pattern.test(url.pathname));
  return json({ error: known ? "Method not allowed" : "Not found" }, known ? 405 : 404);
}
