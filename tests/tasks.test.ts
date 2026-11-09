import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { handleApi } from "../worker/api";
import { wipeAll } from "./reset";
import type { Bootstrap, Client, Project, Task } from "../shared/types";

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

beforeAll(async () => {
  proxy = await getPlatformProxy<{ DB: D1Database }>({ persist: { path: ".wrangler/test-state/v3" } });
  db = proxy.env.DB;
  await wipeAll(db);
});
afterAll(async () => {
  await wipeAll(db);
  await proxy?.dispose();
});

describe("merging duplicate tasks", () => {
  it("moves projects, entries and a running timer onto the kept task, then deletes the duplicate", async () => {
    const client = (await call<Client>("POST", "/api/clients", { name: "Acme Co" })).data;
    const p1 = (await call<Project>("POST", "/api/projects", { clientId: client.id, name: "Platform" })).data;
    const p2 = (await call<Project>("POST", "/api/projects", { clientId: client.id, name: "Site" })).data;
    const dup = (await call<Bootstrap>("GET", "/api/bootstrap")).data.tasks.find((t) => t.name === "Frontend development")!;
    const keep = (await call<Task>("POST", "/api/tasks", { name: "Front-end Development" })).data;
    await call("PUT", `/api/projects/${p1.id}/tasks`, { tasks: [{ taskId: dup.id }, { taskId: keep.id }] });
    await call("PUT", `/api/projects/${p2.id}/tasks`, { tasks: [{ taskId: dup.id }] });
    await call("POST", "/api/entries", { projectId: p1.id, taskId: dup.id, date: "2026-11-02", minutes: 60 });
    await call("POST", "/api/entries", { projectId: p2.id, taskId: dup.id, date: "2026-11-03", minutes: 30 });
    await call("POST", "/api/timer/start", { projectId: p2.id, taskId: dup.id, date: "2026-11-09" });

    expect((await call("GET", `/api/tasks/${dup.id}/usage`)).data).toEqual({ entries: 2, projects: 2 });
    expect((await call("POST", `/api/tasks/${dup.id}/merge`, { intoId: dup.id })).status).toBe(400);
    expect((await call("POST", `/api/tasks/${dup.id}/merge`, { intoId: 999999 })).status).toBe(404);
    expect((await call("POST", `/api/tasks/${dup.id}/merge`, { intoId: keep.id })).status).toBe(200);

    const boot = (await call<Bootstrap>("GET", "/api/bootstrap")).data;
    expect(boot.tasks.map((t) => t.name)).not.toContain("Frontend development");
    expect(boot.projectTasks.filter((l) => l.taskId === keep.id).map((l) => l.projectId).sort()).toEqual([p1.id, p2.id].sort());
    expect(boot.timer?.taskId).toBe(keep.id);
    const tasks = (await db.prepare("SELECT DISTINCT task_id FROM time_entries").all<{ task_id: number }>()).results;
    expect(tasks).toEqual([{ task_id: keep.id }]);
  });
});
