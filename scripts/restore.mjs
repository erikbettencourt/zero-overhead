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

/** The SQL statements that make the database match the backup. */
export function restoreStatements(backup) {
  if (backup?.app !== "Zero Overhead" || backup.version !== 1 || !backup.data) throw new Error("This isn't a Zero Overhead backup.");
  const out = [];
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
      // Older backups can hold transfers, which are now personal.
      if ((table === "bank_transactions" || table === "bank_rules") && row.kind === "transfer") row.kind = "personal";
      const cols = Object.keys(row);
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
  console.error(`Backup from ${backup.exportedAt}: ${rows} rows.${backup.includesBankLogins ? "" : " Bank logins weren't included, so banks will need connecting again."}`);
}
