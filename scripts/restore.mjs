#!/usr/bin/env node
/**
 * Restore Zero Overhead from a backup file.
 *
 *   node scripts/restore.mjs backup.json > restore.sql
 *   npx wrangler d1 execute DB --remote --file restore.sql
 *
 * It replaces everything in the database with the backup's contents. See the README for
 * where backups live and how to try a restore safely first.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Parents before children, so every reference points at a row that already exists.
export const RESTORE_ORDER = [
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
];

const sqlValue = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replaceAll("'", "''")}'`;
};

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** The SQL statements that make the database match the backup. */
export function restoreStatements(backup) {
  if (backup?.app !== "Zero Overhead" || backup.version !== 1 || !backup.data) throw new Error("This isn't a Zero Overhead backup.");
  const out = [];
  // A backup from a newer version than this database would fail partway, so check first. The
  // constraint's name is the error message you see if it doesn't fit.
  if (backup.schema) {
    if (!/^[\w.-]+$/.test(backup.schema)) throw new Error("This backup's schema version doesn't look right.");
    out.push("CREATE TABLE IF NOT EXISTS restore_check (ok INTEGER NOT NULL CONSTRAINT backup_is_from_a_newer_version_update_the_app_first CHECK (ok = 1))");
    out.push(`INSERT INTO restore_check SELECT coalesce((SELECT max(name) FROM d1_migrations), '') >= '${backup.schema}'`);
    out.push("DROP TABLE restore_check");
  }
  // Children first when clearing.
  for (const table of [...RESTORE_ORDER].reverse()) out.push(`DELETE FROM ${table}`);
  for (const table of RESTORE_ORDER) {
    for (const original of backup.data[table] ?? []) {
      const row = { ...original };
      // A bank whose login wasn't in the backup comes back needing a fresh login.
      if (table === "bank_items" && !row.access_token) {
        row.access_token = "";
        row.status = "reconnect";
        row.error = "Restored from a backup without its bank login. Connect this bank again.";
      }
      const cols = Object.keys(row);
      // Column names go into the SQL as written, so only plain names are allowed.
      const bad = cols.find((c) => !IDENTIFIER.test(c));
      if (bad) throw new Error(`This backup has a column name that isn't allowed (${table}.${bad.slice(0, 40)}).`);
      out.push(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => sqlValue(row[c])).join(", ")})`);
    }
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/restore.mjs backup.json > restore.sql");
    process.exit(1);
  }
  const backup = JSON.parse(readFileSync(file, "utf8"));
  const statements = restoreStatements(backup);
  process.stdout.write(["PRAGMA defer_foreign_keys = on", ...statements, "PRAGMA defer_foreign_keys = off"].join(";\n") + ";\n");
  const rows = statements.filter((s) => s.startsWith("INSERT")).length;
  console.error(`Backup from ${backup.exportedAt}${backup.schema ? ` (database ${backup.schema})` : ""}: ${rows} rows.${backup.includesBankLogins ? "" : " Bank logins weren't included, so banks will need connecting again."}`);
}
