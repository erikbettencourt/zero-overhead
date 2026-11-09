/** Test-only: empty every table and restore the starter tasks, so each test file starts clean. */
export async function wipeAll(db: D1Database) {
  await db.batch(
    [
      "DELETE FROM tax_payments",
      "DELETE FROM bank_transactions",
      "DELETE FROM bank_rules",
      "DELETE FROM bank_accounts",
      "DELETE FROM bank_items",
      "DELETE FROM invoice_lines",
      "DELETE FROM time_entries",
      "DELETE FROM invoices",
      "DELETE FROM project_tasks",
      "DELETE FROM projects",
      "DELETE FROM clients",
      "DELETE FROM tasks",
      "DELETE FROM settings",
      "INSERT INTO tasks (name) VALUES ('Project management'), ('UI design'), ('Frontend development')",
    ].map((sql) => db.prepare(sql)),
  );
}
