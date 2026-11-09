import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { wipeAll } from "./reset";

let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;

beforeAll(async () => {
  proxy = await getPlatformProxy<{ DB: D1Database }>({ persist: { path: ".wrangler/test-state/v3" } });
  db = proxy.env.DB;
  await wipeAll(db);
});
afterAll(async () => {
  await wipeAll(db);
  await proxy?.dispose();
});

describe("one rate per project (migration 0009)", () => {
  it("moves task rates onto the project only where billing would otherwise change", async () => {
    const client = async (name: string, rate: number | null) =>
      (await db.prepare("INSERT INTO clients (name, default_rate_cents) VALUES (?, ?) RETURNING id").bind(name, rate).first<{ id: number }>())!.id;
    const project = async (clientId: number, name: string, rate: number | null) =>
      (await db.prepare("INSERT INTO projects (client_id, name, rate_cents) VALUES (?, ?, ?) RETURNING id").bind(clientId, name, rate).first<{ id: number }>())!.id;
    const tasks = (await db.prepare("SELECT id FROM tasks ORDER BY id").all<{ id: number }>()).results.map((t) => t.id);
    const link = (projectId: number, taskId: number, rate: number | null) =>
      db.prepare("INSERT INTO project_tasks (project_id, task_id, rate_cents) VALUES (?, ?, ?)").bind(projectId, taskId, rate);

    // Task rates match the client's: nothing to move.
    const same = await project(await client("Acme Co", 10000), "Platform", null);
    // Task rates differ from the client's: the project takes the common one.
    const differs = await project(await client("Globex", null), "Portal", null);
    // One task out of three differs: most hours already bill at the client's rate, so nothing moves.
    const oneOff = await project(await client("Northwind", 15000), "Portal", null);
    // The project already has its own rate: kept.
    const own = await project(await client("Other", 9000), "Site", 12000);
    await db.batch([
      link(same, tasks[0], 10000),
      link(same, tasks[1], 10000),
      link(differs, tasks[0], 11000),
      link(differs, tasks[1], 11000),
      link(differs, tasks[2], 9000),
      link(own, tasks[0], 15000),
      link(oneOff, tasks[0], null),
      link(oneOff, tasks[1], null),
      link(oneOff, tasks[2], 16000),
    ]);

    const sql = readFileSync(new URL("../migrations/0009_one_rate_per_project.sql", import.meta.url), "utf8")
      .split(/;\s*$/m)
      .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
      .filter(Boolean);
    await db.batch(sql.map((s) => db.prepare(s)));

    const rate = async (id: number) => (await db.prepare("SELECT rate_cents FROM projects WHERE id = ?").bind(id).first<{ rate_cents: number | null }>())!.rate_cents;
    expect(await rate(same)).toBeNull();
    expect(await rate(differs)).toBe(11000);
    expect(await rate(own)).toBe(12000);
    expect(await rate(oneOff)).toBeNull();
    expect((await db.prepare("SELECT count(*) AS n FROM project_tasks WHERE rate_cents IS NOT NULL").first<{ n: number }>())!.n).toBe(0);
  });
});
