import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { handleApi } from "../worker/api";
import type { Bootstrap, Business, InvoiceDetail } from "../shared/types";

let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
let clientId: number;

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
  await call("POST", "/api/data/erase", { confirm: "erase" });
  // One client with October and November hours to invoice.
  const client = await db.prepare("INSERT INTO clients (name, default_rate_cents) VALUES ('Numbering Co', 10000) RETURNING id").first<{ id: number }>();
  clientId = client!.id;
  const project = await db.prepare("INSERT INTO projects (client_id, name) VALUES (?, 'Site') RETURNING id").bind(clientId).first<{ id: number }>();
  const task = await db.prepare("SELECT id FROM tasks WHERE name = 'UI design'").first<{ id: number }>();
  await db.batch([
    db.prepare("INSERT INTO project_tasks (project_id, task_id) VALUES (?, ?)").bind(project!.id, task!.id),
    db.prepare("INSERT INTO time_entries (project_id, task_id, date, minutes) VALUES (?, ?, '2026-10-05', 60)").bind(project!.id, task!.id),
    db.prepare("INSERT INTO time_entries (project_id, task_id, date, minutes) VALUES (?, ?, '2026-11-05', 60)").bind(project!.id, task!.id),
  ]);
});
afterAll(async () => {
  await call("POST", "/api/data/erase", { confirm: "erase" });
  await proxy?.dispose();
});

describe("invoice numbering", () => {
  it("saves business details without a next invoice number", async () => {
    const r = await call<Business>("PUT", "/api/business", { name: "Sample Design Co" });
    expect(r.status).toBe(200);
    expect(r.data.nextInvoiceNumber).toBe("1001");
  });

  it("lets the first invoice choose its number, carrying on from QuickBooks", async () => {
    const bad = await call("POST", "/api/invoices", { clientId, from: "2026-10-01", to: "2026-10-31", number: "QB-END" });
    expect(bad.status).toBe(400);
    const first = await call<InvoiceDetail>("POST", "/api/invoices", { clientId, from: "2026-10-01", to: "2026-10-31", number: "1043" });
    expect(first.status).toBe(201);
    expect(first.data.number).toBe("1043");
    expect((await call<Bootstrap>("GET", "/api/bootstrap")).data.business.nextInvoiceNumber).toBe("1044");
  });

  it("counts up from there, and won't restart numbering", async () => {
    const restart = await call("POST", "/api/invoices", { clientId, from: "2026-11-01", to: "2026-11-30", number: "1" });
    expect(restart.status).toBe(409);
    const second = await call<InvoiceDetail>("POST", "/api/invoices", { clientId, from: "2026-11-01", to: "2026-11-30" });
    expect(second.data.number).toBe("1044");
  });
});
