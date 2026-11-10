import { type Route, HttpError, json, notFound } from "./http";

/**
 * Backups: the whole database as one JSON file. Every night one is saved to R2, the last
 * 90 nights are kept, plus the first of each month for seven years (the IRS record window).
 * Restore with scripts/restore.mjs; see the README.
 */

export const BACKUP_TABLES = [
  "settings",
  "tasks",
  "clients",
  "projects",
  "project_tasks",
  "invoices",
  "invoice_lines",
  "time_entries",
  "expense_categories",
  "bank_items",
  "bank_accounts",
  "bank_rules",
  "bank_transactions",
  "tax_payments",
] as const;

export interface Backup {
  app: "Zero Overhead";
  version: 1;
  exportedAt: string;
  /** The last database migration applied when it was made, like "0014_imported_accounts.sql". */
  schema?: string | null;
  /** Whether bank logins are included (only ever encrypted ones). */
  includesBankLogins: boolean;
  data: Record<string, Record<string, unknown>[]>;
}

const KEEP_DAILY = 90;
const KEEP_MONTHLY = 7 * 12;
const LAST_KEY = "backup.last";

/**
 * Everything in the app. Bank logins are included only when encrypted, and only when asked
 * (for the private nightly copy), so a downloaded file never carries a usable bank login.
 */
export async function exportAll(db: D1Database, opts: { includeSealedBankLogins?: boolean } = {}): Promise<Backup> {
  const results = await db.batch(BACKUP_TABLES.map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`)));
  const data = Object.fromEntries(BACKUP_TABLES.map((t, i) => [t, results[i].results as Record<string, unknown>[]]));
  let includesBankLogins = false;
  data.bank_items = data.bank_items.map((item) => {
    const sealed = typeof item.access_token === "string" && item.access_token.startsWith("enc:v1:");
    if (opts.includeSealedBankLogins && sealed) {
      includesBankLogins = true;
      return item;
    }
    const { access_token: _dropped, ...rest } = item;
    return rest;
  });
  return { app: "Zero Overhead", version: 1, exportedAt: new Date().toISOString(), schema: await schemaVersion(db), includesBankLogins, data };
}

/** The last migration Wrangler applied, so a restore can tell whether the backup fits this database. */
async function schemaVersion(db: D1Database): Promise<string | null> {
  try {
    const row = await db.prepare("SELECT max(name) AS name FROM d1_migrations").first<{ name: string | null }>();
    return row?.name ?? null;
  } catch {
    return null;
  }
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Save tonight's copy, keep the first of each month, and clear out copies past their keep date. */
export async function runBackup(db: D1Database, bucket: R2Bucket, now = new Date()) {
  const backup = await exportAll(db, { includeSealedBankLogins: true });
  const body = JSON.stringify(backup);
  const key = `daily/${day(now)}.json`;
  await bucket.put(key, body, { httpMetadata: { contentType: "application/json" } });
  const monthKey = `monthly/${day(now).slice(0, 7)}.json`;
  if (!(await bucket.head(monthKey))) await bucket.put(monthKey, body, { httpMetadata: { contentType: "application/json" } });

  const dailyCutoff = `daily/${day(new Date(now.getTime() - KEEP_DAILY * 86_400_000))}.json`;
  const monthCutoff = (() => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - KEEP_MONTHLY, 1));
    return `monthly/${day(d).slice(0, 7)}.json`;
  })();
  const stale: string[] = [];
  for (const [prefix, cutoff] of [
    ["daily/", dailyCutoff],
    ["monthly/", monthCutoff],
  ] as const) {
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix, cursor });
      stale.push(...page.objects.map((o) => o.key).filter((k) => k < cutoff));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  if (stale.length) await bucket.delete(stale);

  const last = { at: now.toISOString(), key, bytes: body.length };
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .bind(LAST_KEY, JSON.stringify(last))
    .run();
  return { ...last, removed: stale.length };
}

export interface BackupStatus {
  configured: boolean;
  last: { at: string; key: string; bytes: number } | null;
  recent: { key: string; bytes: number; uploaded: string }[];
}

async function status(db: D1Database, bucket: R2Bucket | undefined): Promise<BackupStatus> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(LAST_KEY).first<{ value: string }>();
  const last = row ? (JSON.parse(row.value) as BackupStatus["last"]) : null;
  if (!bucket) return { configured: false, last, recent: [] };
  const [daily, monthly] = await Promise.all([bucket.list({ prefix: "daily/" }), bucket.list({ prefix: "monthly/" })]);
  const recent = [...daily.objects.sort((a, b) => b.key.localeCompare(a.key)).slice(0, 7), ...monthly.objects.sort((a, b) => b.key.localeCompare(a.key)).slice(0, 6)].map(
    (o) => ({ key: o.key, bytes: o.size, uploaded: o.uploaded.toISOString() }),
  );
  return { configured: true, last, recent };
}

function requireBucket(bucket: R2Bucket | undefined): R2Bucket {
  if (!bucket) throw new HttpError(503, "Automatic backups aren't set up. Create the zero-overhead-backups bucket in Cloudflare R2.");
  return bucket;
}

const attachment = (body: BodyInit, name: string) =>
  new Response(body, {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });

export const backupRoutes: Route[] = [
  [
    "GET",
    /^\/api\/data\/export$/,
    async ({ db }) => attachment(JSON.stringify(await exportAll(db), null, 2), `zero-overhead-backup-${day(new Date())}.json`),
  ],
  ["GET", /^\/api\/data\/backups$/, async ({ db, backups }) => json(await status(db, backups))],
  ["POST", /^\/api\/data\/backups$/, async ({ db, backups }) => json(await runBackup(db, requireBucket(backups)), 201)],
  [
    "GET",
    /^\/api\/data\/backups\/((?:daily|monthly)\/[\d-]+\.json)$/,
    async ({ params, backups }) => {
      const obj = await requireBucket(backups).get(params[0]);
      if (!obj) throw notFound("Backup not found.");
      return attachment(obj.body, `zero-overhead-${params[0].replace("/", "-")}`);
    },
  ],
];
