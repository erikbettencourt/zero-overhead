import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { handleApi } from "../worker/api";
import { exportAll, runBackup, type Backup } from "../worker/backup";
import { sealedProvider, sealStoredTokens, vaultFromKey } from "../worker/vault";
import type { BankProvider } from "../worker/plaid";
// @ts-expect-error plain JavaScript script
import { restoreStatements } from "../scripts/restore.mjs";
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

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i * 7)));

/** Enough of R2 for backups: put, get, head, list and delete, in memory. */
class FakeBucket {
  objects = new Map<string, { body: string; uploaded: Date }>();
  async put(key: string, body: string) {
    this.objects.set(key, { body, uploaded: new Date() });
  }
  async get(key: string) {
    const o = this.objects.get(key);
    return o ? { body: o.body, text: async () => o.body } : null;
  }
  async head(key: string) {
    return this.objects.has(key) ? {} : null;
  }
  async list({ prefix }: { prefix: string }) {
    const objects = [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.body.length, uploaded: o.uploaded }));
    return { objects, truncated: false };
  }
  async delete(keys: string[]) {
    for (const k of keys) this.objects.delete(k);
  }
}
const asBucket = (b: FakeBucket) => b as unknown as R2Bucket;

async function call<T = unknown>(method: string, path: string, body?: unknown, backups?: R2Bucket) {
  const req = new Request("https://admin.example.com" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await handleApi(req, db, "owner@example.com", undefined, backups);
  return { status: res.status, res };
}

describe("bank login encryption", () => {
  it("seals and opens tokens, and passes old plain ones through", async () => {
    const vault = await vaultFromKey(KEY);
    const sealed = await vault.seal("access-sandbox-123");
    expect(sealed).toMatch(/^enc:v1:/);
    expect(sealed).not.toContain("access-sandbox-123");
    expect(await vault.open(sealed)).toBe("access-sandbox-123");
    expect(await vault.open("access-plain")).toBe("access-plain");
    // Two seals of the same token differ (random IV).
    expect(await vault.seal("x")).not.toBe(await vault.seal("x"));
  });

  it("refuses a bad key, and says so when the key goes missing", async () => {
    await expect(vaultFromKey("c2hvcnQ=")).rejects.toThrow(/32 random bytes/);
    const sealed = await (await vaultFromKey(KEY)).seal("t");
    await expect((await vaultFromKey(undefined)).open(sealed)).rejects.toMatchObject({ code: "VAULT_KEY_MISSING" });
    const other = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
    await expect((await vaultFromKey(other)).open(sealed)).rejects.toMatchObject({ code: "VAULT_KEY_MISMATCH" });
  });

  it("stores sealed tokens and hands Plaid the real one", async () => {
    const seen: string[] = [];
    const inner = {
      environment: "sandbox",
      linkToken: async () => "lt",
      exchange: async () => ({ accessToken: "access-real", itemId: "i" }),
      accounts: async (t: string) => (seen.push(t), []),
      sync: async (t: string) => (seen.push(t), { added: [], modified: [], removed: [], nextCursor: "c", hasMore: false }),
      remove: async (t: string) => void seen.push(t),
    } satisfies BankProvider;
    const bank = sealedProvider(inner, await vaultFromKey(KEY));
    const { accessToken } = await bank.exchange("pub");
    expect(accessToken).toMatch(/^enc:v1:/);
    await bank.sync(accessToken, null);
    await bank.accounts(accessToken);
    expect(seen).toEqual(["access-real", "access-real"]);
  });

  it("encrypts logins saved before the key was added", async () => {
    await db.prepare("INSERT INTO bank_items (plaid_item_id, access_token, institution_name) VALUES ('old', 'access-plain-old', 'Old Bank')").run();
    expect(await sealStoredTokens(db, await vaultFromKey(KEY))).toBe(1);
    const row = await db.prepare("SELECT access_token FROM bank_items WHERE plaid_item_id = 'old'").first<{ access_token: string }>();
    expect(row!.access_token).toMatch(/^enc:v1:/);
    expect(await (await vaultFromKey(KEY)).open(row!.access_token)).toBe("access-plain-old");
    expect(await sealStoredTokens(db, await vaultFromKey(KEY))).toBe(0);
  });
});

describe("backups", () => {
  it("leaves bank logins out of downloads, and keeps only sealed ones in the nightly copy", async () => {
    await db.prepare("INSERT INTO bank_items (plaid_item_id, access_token, institution_name) VALUES ('plain', 'access-plain', 'Plain Bank')").run();
    const download = await exportAll(db);
    expect(JSON.stringify(download.data.bank_items)).not.toMatch(/access_token/);
    const nightly = await exportAll(db, { includeSealedBankLogins: true });
    expect(nightly.includesBankLogins).toBe(true);
    const tokens = nightly.data.bank_items.map((i) => i.access_token);
    expect(tokens.filter(Boolean).every((t) => String(t).startsWith("enc:v1:"))).toBe(true);
    expect(tokens).toContain(undefined);
    await db.prepare("DELETE FROM bank_items WHERE plaid_item_id = 'plain'").run();
  });

  it("saves a nightly copy, keeps the month's first, and clears copies past their keep date", async () => {
    const bucket = new FakeBucket();
    await bucket.put("daily/2026-01-01.json", "{}");
    await bucket.put("daily/2026-09-30.json", "{}");
    await bucket.put("monthly/2019-01.json", "{}");
    await bucket.put("monthly/2020-06.json", "{}");
    const r = await runBackup(db, asBucket(bucket), new Date("2026-11-09T09:17:00Z"));
    expect(r.key).toBe("daily/2026-11-09.json");
    expect([...bucket.objects.keys()].sort()).toEqual(["daily/2026-09-30.json", "daily/2026-11-09.json", "monthly/2020-06.json", "monthly/2026-11.json"]);
    const firstOfMonth = bucket.objects.get("monthly/2026-11.json")!.body;
    await runBackup(db, asBucket(bucket), new Date("2026-11-10T09:17:00Z"));
    expect(bucket.objects.get("monthly/2026-11.json")!.body).toBe(firstOfMonth);

    const status = await call("GET", "/api/data/backups", undefined, asBucket(bucket));
    const body = await status.res.json<{ configured: boolean; last: { key: string }; recent: { key: string }[] }>();
    expect(body).toMatchObject({ configured: true, last: { key: "daily/2026-11-10.json" } });
    expect(body.recent[0].key).toBe("daily/2026-11-10.json");
    const file = await call("GET", "/api/data/backups/daily/2026-11-10.json", undefined, asBucket(bucket));
    expect(file.res.headers.get("content-disposition")).toMatch(/zero-overhead-daily-2026-11-10.json/);
  });

  it("says when backups aren't set up", async () => {
    const r = await call("GET", "/api/data/backups");
    expect(await r.res.json()).toMatchObject({ configured: false });
    expect((await call("POST", "/api/data/backups", {})).status).toBe(503);
  });
});

describe("restore", () => {
  it("rebuilds the database exactly from a backup", async () => {
    await wipeAll(db);
    await call("PUT", "/api/business", { name: "Sample Design Co", phone: "555-010-0100" });
    await call("POST", "/api/data/sample", { today: "2026-11-08" });
    await call("POST", "/api/invoices", { clientId: 1, from: "2026-10-01", to: "2026-10-31", issuedOn: "2026-11-01" });
    await call("PUT", "/api/tax-profile", { priorYearFederalTaxCents: 20_000_00 });
    await call("POST", "/api/tax-payments", { taxYear: 2026, jurisdiction: "federal", quarter: 1, paidOn: "2026-04-15", amountCents: 4_000_00, appliedRefund: true });
    const vault = await vaultFromKey(KEY);
    await db.prepare("INSERT INTO bank_items (plaid_item_id, access_token, institution_name, cursor) VALUES ('item-1', ?, 'Example Bank', 'cur-1')").bind(await vault.seal("access-1")).run();

    // A transfer and a transfer rule must come back as transfers.
    await db.prepare("UPDATE bank_transactions SET kind = 'transfer', category_id = NULL WHERE id = (SELECT min(id) FROM bank_transactions WHERE amount_cents < 0)").run();
    await db.prepare("INSERT INTO bank_rules (match_text, kind) VALUES ('ONLINE TRANSFER', 'transfer')").run();

    const before = await exportAll(db, { includeSealedBankLogins: true });
    expect(before.schema).toMatch(/^\d{4}_.+\.sql$/);
    expect(before.data.bank_transactions.filter((t) => t.kind === "transfer")).toHaveLength(1);
    expect(before.data.time_entries.length).toBeGreaterThan(20);
    expect(before.data.invoices.length).toBe(1);

    // Disaster: everything gone.
    await wipeAll(db);
    for (const sql of restoreStatements(JSON.parse(JSON.stringify(before)) as Backup) as string[]) await db.prepare(sql).run();

    const after = await exportAll(db, { includeSealedBankLogins: true });
    expect(after.data).toEqual(before.data);
    // And the bank login still works.
    const item = await db.prepare("SELECT access_token FROM bank_items WHERE plaid_item_id = 'item-1'").first<{ access_token: string }>();
    expect(await vault.open(item!.access_token)).toBe("access-1");
  });

  it("brings banks back as needing a login when the backup didn't include it", async () => {
    const download = await exportAll(db);
    for (const sql of restoreStatements(download) as string[]) await db.prepare(sql).run();
    const item = await db.prepare("SELECT status, access_token FROM bank_items WHERE plaid_item_id = 'item-1'").first<{ status: string; access_token: string }>();
    expect(item).toEqual({ status: "reconnect", access_token: "" });
  });

  it("refuses a file that isn't a backup", () => {
    expect(() => restoreStatements({ hello: "world" })).toThrow(/isn't a Zero Overhead backup/);
  });

  it("refuses a backup from a newer version, before changing anything", async () => {
    const backup = await exportAll(db);
    const clients = backup.data.clients.length;
    const statements = restoreStatements({ ...backup, schema: "9999_from_the_future.sql", data: { clients: [] } }) as string[];
    await expect(
      (async () => {
        for (const sql of statements) await db.prepare(sql).run();
      })(),
    ).rejects.toThrow(/backup_is_from_a_newer_version_update_the_app_first/);
    expect((await exportAll(db)).data.clients).toHaveLength(clients);
    await db.prepare("DROP TABLE IF EXISTS restore_check").run();
  });

  it("refuses column names that aren't plain names", () => {
    const backup = { app: "Zero Overhead", version: 1, data: { clients: [{ id: 1, "name) VALUES (1); DROP TABLE clients; --": "x" }] } };
    expect(() => restoreStatements(backup)).toThrow(/column name that isn't allowed/);
  });
});
