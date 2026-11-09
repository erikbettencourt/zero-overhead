import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { handleApi } from "../worker/api";
import { isSafeWrite } from "../worker/index";
import type { Bootstrap, Business, Client, ImportResult, InvoiceDetail, InvoiceSummary, Project, Report, Summary, Task, TimeEntry } from "../shared/types";

let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;

beforeAll(async () => {
  proxy = await getPlatformProxy<{ DB: D1Database }>({ persist: { path: ".wrangler/test-state/v3" } });
  db = proxy.env.DB;
});
afterAll(async () => proxy?.dispose());

const BASE = "https://admin.example.com";

async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const req = new Request(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await handleApi(req, db, "owner@example.com");
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
}

describe("time tracking API", () => {
  let client: Client;
  let project: Project;
  let design: Task;

  it("creates a client, project and task assignment", async () => {
    const c = await call<Client>("POST", "/api/clients", { name: "Acme", defaultRateCents: 15000 });
    expect(c.status).toBe(201);
    client = c.data;

    const dup = await call("POST", "/api/clients", { name: "acme" });
    expect(dup.status).toBe(409);

    const p = await call<Project>("POST", "/api/projects", { clientId: client.id, name: "Website" });
    expect(p.status).toBe(201);
    project = p.data;

    const boot = await call<Bootstrap>("GET", "/api/bootstrap");
    design = boot.data.tasks.find((t) => t.name === "UI design")!;
    expect(design).toBeTruthy();

    const link = await call("PUT", `/api/projects/${project.id}/tasks`, { tasks: [{ taskId: design.id }] });
    expect(link.status).toBe(200);
  });

  it("validates input", async () => {
    expect((await call("POST", "/api/clients", { name: "" })).status).toBe(400);
    expect((await call("POST", "/api/entries", { projectId: project.id, taskId: design.id, date: "2026-02-30", minutes: 60 })).status).toBe(400);
    expect((await call("POST", "/api/entries", { projectId: project.id, taskId: design.id, date: "2026-11-02", minutes: -5 })).status).toBe(400);
  });

  it("refuses entries for a task not assigned to the project", async () => {
    const other = (await call<Bootstrap>("GET", "/api/bootstrap")).data.tasks.find((t) => t.name === "Project management")!;
    const r = await call("POST", "/api/entries", { projectId: project.id, taskId: other.id, date: "2026-11-02", minutes: 60 });
    expect(r.status).toBe(400);
  });

  it("creates, edits, lists and deletes entries", async () => {
    const e = await call<TimeEntry>("POST", "/api/entries", {
      projectId: project.id,
      taskId: design.id,
      date: "2026-11-02",
      minutes: 90,
      note: "Wireframes",
    });
    expect(e.status).toBe(201);
    expect(e.data).toMatchObject({ minutes: 90, note: "Wireframes", locked: false });

    const edited = await call<TimeEntry>("PATCH", `/api/entries/${e.data.id}`, { minutes: 120 });
    expect(edited.data.minutes).toBe(120);

    const list = await call<TimeEntry[]>("GET", "/api/entries?from=2026-11-02&to=2026-11-08");
    expect(list.data.map((x) => x.id)).toContain(e.data.id);

    expect((await call("DELETE", `/api/entries/${e.data.id}`)).status).toBe(204);
  });

  it("runs a timer and turns it into an entry", async () => {
    const start = await call("POST", "/api/timer/start", { projectId: project.id, taskId: design.id, date: "2026-11-04", note: "Review" });
    expect(start.status).toBe(201);
    expect((await call("POST", "/api/timer/start", { projectId: project.id, taskId: design.id, date: "2026-11-04" })).status).toBe(409);

    const stop = await call<TimeEntry>("POST", "/api/timer/stop");
    expect(stop.status).toBe(201);
    expect(stop.data).toMatchObject({ date: "2026-11-04", minutes: 1, note: "Review" });

    expect((await call<Bootstrap>("GET", "/api/bootstrap")).data.timer).toBeNull();
  });

  it("imports Harvest rows once, and locks invoiced ones", async () => {
    const rows = [
      { key: "a1", date: "2026-10-01", client: "Acme Co", project: "Prototypes", task: "Frontend development", notes: "Build", minutes: 120, billableRateCents: 15000, invoiced: true },
      { key: "a2", date: "2026-10-02", client: "acme co", project: "prototypes", task: "frontend development", notes: "", minutes: 60, billableRateCents: 16000, invoiced: false },
    ];
    const first = await call<ImportResult>("POST", "/api/import/harvest", { rows });
    expect(first.data).toEqual({ clientsCreated: 1, projectsCreated: 1, tasksCreated: 0, entriesCreated: 2, entriesSkipped: 0 });

    const again = await call<ImportResult>("POST", "/api/import/harvest", { rows });
    expect(again.data).toMatchObject({ clientsCreated: 0, entriesCreated: 0, entriesSkipped: 2 });

    const entries = (await call<TimeEntry[]>("GET", "/api/entries?from=2026-10-01&to=2026-10-02")).data;
    const locked = entries.find((e) => e.date === "2026-10-01")!;
    expect(locked.locked).toBe(true);
    expect((await call("PATCH", `/api/entries/${locked.id}`, { minutes: 1 })).status).toBe(409);
    expect((await call("DELETE", `/api/entries/${locked.id}`)).status).toBe(409);

    const boot = (await call<Bootstrap>("GET", "/api/bootstrap")).data;
    const proj = boot.projects.find((p) => p.name === "Prototypes")!;
    // One rate per project: the latest Harvest rate, since the client has none.
    expect(proj.rateCents).toBe(16000);
    expect(boot.projectTasks.find((l) => l.projectId === proj.id)!.rateCents).toBeNull();
  });

  it("returns 404 and 405 for unknown routes", async () => {
    expect((await call("GET", "/api/nope")).status).toBe(404);
    expect((await call("DELETE", "/api/clients")).status).toBe(405);
  });
});

describe("reports and invoices", () => {
  let clientId: number;
  let projectId: number;
  let design: number;
  let pm: number;

  beforeAll(async () => {
    const c = await call<Client>("POST", "/api/clients", { name: "Northwind", defaultRateCents: 10000, paymentTermsDays: 15 });
    clientId = c.data.id;
    projectId = (await call<Project>("POST", "/api/projects", { clientId, name: "Portal" })).data.id;
    const tasks = (await call<Bootstrap>("GET", "/api/bootstrap")).data.tasks;
    design = tasks.find((t) => t.name === "UI design")!.id;
    pm = tasks.find((t) => t.name === "Project management")!.id;
    await call("PATCH", `/api/tasks/${pm}`, { billable: false });
    await call("PUT", `/api/projects/${projectId}/tasks`, { tasks: [{ taskId: design }, { taskId: pm }] });
    await call("PATCH", `/api/projects/${projectId}`, { rateCents: 12000 });
    for (const [taskId, date, minutes] of [
      [design, "2026-10-05", 90],
      [design, "2026-10-06", 20],
      [pm, "2026-10-06", 60],
      [design, "2026-11-02", 60],
    ] as const) {
      await call("POST", "/api/entries", { projectId, taskId, date, minutes, note: date === "2026-10-05" ? "Wireframes  for\nsignup" : null });
    }
  });

  it("refuses to invoice before business details exist", async () => {
    const r = await call("POST", "/api/invoices", { clientId, from: "2026-10-01", to: "2026-10-31" });
    expect(r.status).toBe(400);
    const saved = await call<Business>("PUT", "/api/business", { name: "Sample Design Co", nextInvoiceNumber: "EB-0041" });
    expect(saved.data.nextInvoiceNumber).toBe("EB-0041");
  });

  it("reports a month with billable and non-billable time", async () => {
    const r = await call<Report>("GET", `/api/report?clientId=${clientId}&from=2026-10-01&to=2026-10-31`);
    expect(r.data.totalMinutes).toBe(170);
    expect(r.data.billableMinutes).toBe(110);
    // 110 min = 1.83 h x $120 = $219.60
    expect(r.data.uninvoicedAmountCents).toBe(21960);
    expect(r.data.missingRates).toEqual([]);
  });

  it("creates an invoice that snapshots lines and locks only billable entries in range", async () => {
    const r = await call<InvoiceDetail>("POST", "/api/invoices", { clientId, from: "2026-10-01", to: "2026-10-31", issuedOn: "2026-11-01" });
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({ number: "EB-0041", status: "unpaid", totalCents: 21960, dueOn: "2026-11-16" });
    // The invoice summarizes by project and task. Each entry is still rounded and priced on its own: $180.00 + $39.60.
    expect(r.data.lines).toEqual([{ description: "Portal, UI design", minutes: 110, rateCents: 12000, amountCents: 21960 }]);
    // The hours report lists every entry behind it, with its note.
    expect(r.data.entries.map((e) => [e.date, e.minutes, e.note])).toEqual([
      ["2026-10-05", 90, "Wireframes  for\nsignup"],
      ["2026-10-06", 20, null],
    ]);
    expect(r.data.business.name).toBe("Sample Design Co");

    const entries = (await call<TimeEntry[]>("GET", "/api/entries?from=2026-10-01&to=2026-11-30")).data.filter((e) => e.projectId === projectId);
    expect(entries.filter((e) => e.locked).map((e) => e.date).sort()).toEqual(["2026-10-05", "2026-10-06"]);

    expect((await call<Bootstrap>("GET", "/api/bootstrap")).data.business.nextInvoiceNumber).toBe("EB-0042");
    const again = await call("POST", "/api/invoices", { clientId, from: "2026-10-01", to: "2026-10-31" });
    expect(again.status).toBe(409);
  });

  it("sums every client for a range: earned, invoiced and not yet invoiced", async () => {
    const r = await call<Summary>("GET", "/api/summary?from=2026-10-01&to=2026-11-30");
    const mine = r.data.clients.find((c) => c.clientId === clientId)!;
    // October's 110 billable minutes are invoiced; November's 60 are not. The 60 non-billable minutes count as hours only.
    expect(mine).toMatchObject({ minutes: 230, billableMinutes: 170, earnedCents: 33960, invoicedCents: 21960, uninvoicedMinutes: 60, uninvoicedCents: 12000 });
    expect((await call("GET", "/api/summary?from=2026-11-30&to=2026-10-01")).status).toBe(400);
  });

  it("keeps a billing period on each client", async () => {
    const c = await call<Client>("PATCH", `/api/clients/${clientId}`, { billingPeriod: "quarterly" });
    expect(c.data.billingPeriod).toBe("quarterly");
    expect((await call("PATCH", `/api/clients/${clientId}`, { billingPeriod: "yearly" })).status).toBe(400);
    await call("PATCH", `/api/clients/${clientId}`, { billingPeriod: "monthly" });
  });

  it("takes a due date when given, and refuses one before the issue date", async () => {
    const bad = await call("POST", "/api/invoices", { clientId, from: "2026-11-01", to: "2026-11-30", issuedOn: "2026-12-01", dueOn: "2026-11-30" });
    expect(bad.status).toBe(400);
    const r = await call<InvoiceDetail>("POST", "/api/invoices", { clientId, from: "2026-11-01", to: "2026-11-30", issuedOn: "2026-12-01", dueOn: "2026-12-15" });
    expect(r.data).toMatchObject({ issuedOn: "2026-12-01", dueOn: "2026-12-15" });
    expect((await call("DELETE", `/api/invoices/${r.data.id}`)).status).toBe(204);
  });

  it("stores a phone number and logo for invoices, and rejects other kinds of data", async () => {
    const logo = "data:image/png;base64,iVBORw0KGgo=";
    const saved = await call<Business>("PUT", "/api/business", { name: "Sample Design Co", phone: "555-010-0100", logo, nextInvoiceNumber: "EB-0042" });
    expect(saved.data).toMatchObject({ phone: "555-010-0100", logo });
    const bad = await call("PUT", "/api/business", { name: "x", logo: "javascript:alert(1)", nextInvoiceNumber: "EB-0042" });
    expect(bad.status).toBe(400);
  });

  it("keeps the invoice as issued when rates and names change later", async () => {
    await call("PATCH", `/api/projects/${projectId}`, { rateCents: 99900 });
    await call("PATCH", `/api/clients/${clientId}`, { name: "Northwind Traders" });
    const list = (await call<InvoiceSummary[]>("GET", "/api/invoices")).data;
    const inv = (await call<InvoiceDetail>("GET", `/api/invoices/${list.find((i) => i.number === "EB-0041")!.id}`)).data;
    expect(inv.lines[0].rateCents).toBe(12000);
    expect(inv.client.name).toBe("Northwind");
  });

  it("refuses to invoice time with no rate", async () => {
    await call("PATCH", `/api/projects/${projectId}`, { rateCents: null });
    await call("PATCH", `/api/clients/${clientId}`, { defaultRateCents: null });
    const r = await call<{ error: string }>("POST", "/api/invoices", { clientId, from: "2026-11-01", to: "2026-11-30" });
    expect(r.status).toBe(400);
    expect(r.data.error).toMatch(/Portal, UI design/);
    await call("PATCH", `/api/clients/${clientId}`, { defaultRateCents: 10000 });
  });

  it("is unpaid until paid, and paid on the date the money arrived", async () => {
    const id = (await call<InvoiceSummary[]>("GET", "/api/invoices")).data.find((i) => i.number === "EB-0041")!.id;
    expect((await call("PATCH", `/api/invoices/${id}`, { status: "sent" })).status).toBe(400);
    const moved = await call<InvoiceDetail>("PATCH", `/api/invoices/${id}`, { dueOn: "2026-11-20" });
    expect(moved.data.dueOn).toBe("2026-11-20");
    expect((await call("PATCH", `/api/invoices/${id}`, { dueOn: "2026-10-01" })).status).toBe(400);

    const paid = await call<InvoiceDetail>("PATCH", `/api/invoices/${id}`, { status: "paid", paidOn: "2027-01-15" });
    expect(paid.data).toMatchObject({ status: "paid", paidOn: "2027-01-15", deposit: null, markPaidByHand: true });
    // A paid invoice is a record: no date changes and no deleting until it's marked unpaid again.
    expect((await call("PATCH", `/api/invoices/${id}`, { dueOn: "2026-11-30" })).status).toBe(409);
    expect((await call("DELETE", `/api/invoices/${id}`)).status).toBe(409);
    const fixed = await call<InvoiceDetail>("PATCH", `/api/invoices/${id}`, { paidOn: "2027-01-14" });
    expect(fixed.data.paidOn).toBe("2027-01-14");

    const unpaid = await call<InvoiceDetail>("PATCH", `/api/invoices/${id}`, { status: "unpaid" });
    expect(unpaid.data).toMatchObject({ status: "unpaid", paidOn: null });
  });

  it("deleting an unpaid invoice frees its hours to invoice again, combined with more", async () => {
    const list = (await call<InvoiceSummary[]>("GET", "/api/invoices")).data;
    const october = list.find((i) => i.number === "EB-0041")!;
    const november = await call<InvoiceDetail>("POST", "/api/invoices", { clientId, from: "2026-11-01", to: "2026-11-30" });
    expect(november.data.number).toBe("EB-0042");

    expect((await call("DELETE", `/api/invoices/${october.id}`)).status).toBe(204);
    expect((await call("DELETE", `/api/invoices/${november.data.id}`)).status).toBe(204);
    const entries = (await call<TimeEntry[]>("GET", "/api/entries?from=2026-10-01&to=2026-11-30")).data.filter((e) => e.projectId === projectId);
    expect(entries.every((e) => !e.locked)).toBe(true);
    // Deleting the latest invoice gives its number back.
    expect((await call<Bootstrap>("GET", "/api/bootstrap")).data.business.nextInvoiceNumber).toBe("EB-0042");

    const combined = await call<InvoiceDetail>("POST", "/api/invoices", { clientId, from: "2026-10-01", to: "2026-11-30" });
    // A new invoice prices hours at today's rates. An earlier test moved UI design to the $100 client rate:
    // 1.5 h + 0.33 h in October and 1 h in November.
    expect(combined.data).toMatchObject({ number: "EB-0042", status: "unpaid", totalCents: 15000 + 3300 + 10000 });
    expect(combined.data.entries).toHaveLength(3);
  });
});

describe("sample data and erase", () => {
  it("won't load sample data into an app that has data", async () => {
    expect((await call("POST", "/api/data/sample", { today: "2026-11-04" })).status).toBe(409);
  });

  it("requires typing erase", async () => {
    expect((await call("POST", "/api/data/erase", {})).status).toBe(400);
  });

  it("erases time and invoices but keeps clients, projects and your business, then loads sample data", async () => {
    await call("PUT", "/api/tax-profile", { otherIncomeCents: 123_00 });
    const before = (await call<Bootstrap>("GET", "/api/bootstrap")).data;
    expect(before.clients.length).toBeGreaterThan(0);
    const preview = (await call<{ clients: number; invoices: number; timeEntries: number }>("GET", "/api/data/erase-preview")).data;
    // None of these clients are sample clients, so none will be deleted.
    expect(preview.clients).toBe(0);
    expect(preview.timeEntries).toBeGreaterThan(0);

    expect((await call("POST", "/api/data/erase", { confirm: "erase" })).status).toBe(200);
    const after = (await call<Bootstrap>("GET", "/api/bootstrap")).data;
    expect(after.clients).toEqual(before.clients);
    expect(after.projects).toEqual(before.projects);
    expect(after.projectTasks).toEqual(before.projectTasks);
    expect((await call<TimeEntry[]>("GET", "/api/entries?from=2026-01-01&to=2026-12-31")).data).toEqual([]);
    expect((await call<InvoiceSummary[]>("GET", "/api/invoices")).data).toEqual([]);
    expect(after.business.name).toBe("Sample Design Co");
    expect((await call<{ otherIncomeCents: number }>("GET", "/api/tax-profile")).data.otherIncomeCents).toBe(123_00);

    // Sample data adds its own clients alongside yours, without touching your business details.
    expect((await call("POST", "/api/data/sample", { today: "2026-11-04" })).status).toBe(201);
    expect((await call("POST", "/api/data/sample", { today: "2026-11-04" })).status).toBe(409);
    const boot = (await call<Bootstrap>("GET", "/api/bootstrap")).data;
    expect(boot.business.name).toBe("Sample Design Co");
    expect(boot.clients.map((c) => c.name)).toEqual(expect.arrayContaining(["Brightline Events", "Northwind Labs"]));
    const northwind = boot.clients.find((c) => c.name === "Northwind Labs")!;
    const inv = await call<InvoiceDetail>("POST", "/api/invoices", { clientId: northwind.id, from: "2026-10-01", to: "2026-10-31" });
    expect(inv.data.number).toBe("S-1001");

    // Erasing again removes the sample clients and keeps yours.
    expect((await call<{ clients: number }>("GET", "/api/data/erase-preview")).data.clients).toBe(2);
    await call("POST", "/api/data/erase", { confirm: "erase" });
    expect((await call<Bootstrap>("GET", "/api/bootstrap")).data.clients).toEqual(before.clients);
  });

  it("removes sample business details on erase, but not ones you changed", async () => {
    const { wipeAll } = await import("./reset");
    await wipeAll(db);
    await call("POST", "/api/data/sample", { today: "2026-11-04" });
    expect((await call<Bootstrap>("GET", "/api/bootstrap")).data.business.name).toBe("Sample Studio");
    await call("PUT", "/api/business", { name: "Sample Studio", email: "me@real.example", nextInvoiceNumber: "S-1001" });
    await call("POST", "/api/data/erase", { confirm: "erase" });
    const biz = (await call<Bootstrap>("GET", "/api/bootstrap")).data.business;
    expect(biz.name).toBe("");
    expect(biz.email).toBe("me@real.example");
  });

  it("exports a backup without bank access tokens", async () => {
    const req = new Request(BASE + "/api/data/export");
    const res = await handleApi(req, db, "owner@example.com");
    expect(res.headers.get("content-disposition")).toMatch(/zero-overhead-backup-/);
    const body = await res.json<{ data: Record<string, unknown[]> }>();
    expect(Object.keys(body.data)).toEqual(expect.arrayContaining(["clients", "time_entries", "invoices", "bank_transactions", "tax_payments", "bank_items"]));
    expect(JSON.stringify(body.data.bank_items)).not.toMatch(/access_token/);
  });
});

describe("cross-site protection", () => {
  const req = (method: string, headers: Record<string, string>) => new Request(BASE + "/api/clients", { method, headers, body: method === "GET" ? undefined : "{}" });

  it("allows same-origin JSON writes and reads", () => {
    expect(isSafeWrite(req("GET", {}))).toBe(true);
    expect(isSafeWrite(req("POST", { "content-type": "application/json", origin: BASE }))).toBe(true);
  });

  it("refuses form posts and other origins", () => {
    expect(isSafeWrite(req("POST", { "content-type": "application/x-www-form-urlencoded" }))).toBe(false);
    expect(isSafeWrite(req("POST", { "content-type": "application/json", origin: "https://evil.example" }))).toBe(false);
  });
});
