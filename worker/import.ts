import type { ImportResult } from "../shared/types";
import { isIsoDate } from "../shared/time";
import { badRequest } from "./http";

const MAX_ROWS_PER_REQUEST = 500;

interface CleanRow {
  key: string;
  date: string;
  client: string;
  project: string;
  task: string;
  notes: string | null;
  minutes: number;
  billableRateCents: number | null;
  invoiced: boolean;
}

function clean(raw: unknown, i: number): CleanRow {
  const r = raw as Record<string, unknown>;
  const text = (k: string, max = 200) => {
    const v = typeof r[k] === "string" ? (r[k] as string).trim() : "";
    if (v.length > max) throw badRequest(`Row ${i + 1}: ${k} is too long.`);
    return v;
  };
  const key = text("key", 128);
  const date = text("date", 10);
  const client = text("client");
  const project = text("project");
  const task = text("task");
  if (!key || !isIsoDate(date) || !client || !project || !task) {
    throw badRequest(`Row ${i + 1} is missing a date, client, project or task.`);
  }
  const minutes = r.minutes;
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 0 || minutes > 24 * 60) {
    throw badRequest(`Row ${i + 1} has invalid hours.`);
  }
  const rate = r.billableRateCents;
  return {
    key,
    date,
    client,
    project,
    task,
    notes: text("notes", 2000) || null,
    minutes,
    billableRateCents: typeof rate === "number" && Number.isInteger(rate) && rate >= 0 ? rate : null,
    invoiced: r.invoiced === true,
  };
}

/**
 * Import a batch of Harvest time entries. Clients, projects and tasks are matched by name
 * (case-insensitive) and created if missing. Entries carry a stable key, so importing the
 * same file twice never duplicates anything. Entries already invoiced in Harvest are locked.
 */
export async function importHarvest(db: D1Database, body: Record<string, unknown>): Promise<ImportResult> {
  if (!Array.isArray(body.rows) || body.rows.length === 0) throw badRequest("rows must be a non-empty list.");
  if (body.rows.length > MAX_ROWS_PER_REQUEST) throw badRequest(`Send at most ${MAX_ROWS_PER_REQUEST} rows at a time.`);
  const rows = body.rows.map(clean);

  const result: ImportResult = { clientsCreated: 0, projectsCreated: 0, tasksCreated: 0, entriesCreated: 0, entriesSkipped: 0 };
  const clientIds = new Map<string, number>();
  const projectIds = new Map<string, number>();
  const taskIds = new Map<string, number>();

  const k = (s: string) => s.toLowerCase();

  for (const row of rows) {
    if (!clientIds.has(k(row.client))) {
      let found = await db.prepare("SELECT id FROM clients WHERE name = ? COLLATE NOCASE").bind(row.client).first<{ id: number }>();
      if (!found) {
        found = await db.prepare("INSERT INTO clients (name) VALUES (?) RETURNING id").bind(row.client).first<{ id: number }>();
        result.clientsCreated++;
      }
      clientIds.set(k(row.client), found!.id);
    }
    const clientId = clientIds.get(k(row.client))!;

    const projectKey = `${clientId}|${k(row.project)}`;
    if (!projectIds.has(projectKey)) {
      let found = await db
        .prepare("SELECT id FROM projects WHERE client_id = ? AND name = ? COLLATE NOCASE")
        .bind(clientId, row.project)
        .first<{ id: number }>();
      if (!found) {
        found = await db
          .prepare("INSERT INTO projects (client_id, name) VALUES (?, ?) RETURNING id")
          .bind(clientId, row.project)
          .first<{ id: number }>();
        result.projectsCreated++;
      }
      projectIds.set(projectKey, found!.id);
    }

    if (!taskIds.has(k(row.task))) {
      let found = await db.prepare("SELECT id FROM tasks WHERE name = ? COLLATE NOCASE").bind(row.task).first<{ id: number }>();
      if (!found) {
        found = await db.prepare("INSERT INTO tasks (name) VALUES (?) RETURNING id").bind(row.task).first<{ id: number }>();
        result.tasksCreated++;
      }
      taskIds.set(k(row.task), found!.id);
    }
  }

  // One rate per project. Rows arrive oldest first, so the last rate seen is the current one.
  const statements: D1PreparedStatement[] = [];
  const projectRates = new Map<number, number>();
  for (const row of rows) {
    const projectId = projectIds.get(`${clientIds.get(k(row.client))}|${k(row.project)}`)!;
    const taskId = taskIds.get(k(row.task))!;
    if (row.billableRateCents != null) projectRates.set(projectId, row.billableRateCents);
    statements.push(
      db.prepare("INSERT INTO project_tasks (project_id, task_id) VALUES (?, ?) ON CONFLICT (project_id, task_id) DO NOTHING").bind(projectId, taskId),
      db
        .prepare(
          `INSERT INTO time_entries (project_id, task_id, date, minutes, note, invoiced_elsewhere, import_key)
           VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (import_key) WHERE import_key IS NOT NULL DO NOTHING`,
        )
        .bind(projectId, taskId, row.date, row.minutes, row.notes, row.invoiced ? 1 : 0, row.key),
    );
  }

  const outcomes = await db.batch(statements);
  for (let i = 1; i < outcomes.length; i += 2) {
    if (outcomes[i].meta.changes > 0) result.entriesCreated++;
    else result.entriesSkipped++;
  }
  // A project without its own rate takes Harvest's, unless the client's rate already matches.
  if (projectRates.size) {
    await db.batch(
      [...projectRates].map(([projectId, rate]) =>
        db
          .prepare(
            "UPDATE projects SET rate_cents = ? WHERE id = ? AND rate_cents IS NULL AND ? IS NOT (SELECT default_rate_cents FROM clients WHERE id = projects.client_id)",
          )
          .bind(rate, projectId, rate),
      ),
    );
  }
  return result;
}
