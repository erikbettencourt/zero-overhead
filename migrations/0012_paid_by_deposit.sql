-- An invoice is paid by a deposit, and one deposit can pay several invoices (a client paying
-- two invoices at once). The link moves from the deposit to the invoice so that works.
-- Invoices already paid keep their dates.
PRAGMA defer_foreign_keys = on;

CREATE TABLE deposit_links AS SELECT id AS deposit_id, invoice_id FROM bank_transactions WHERE invoice_id IS NOT NULL;

CREATE TABLE bank_transactions_new (
  id                   INTEGER PRIMARY KEY,
  account_id           INTEGER NOT NULL REFERENCES bank_accounts(id),
  plaid_transaction_id TEXT    UNIQUE,
  date                 TEXT    NOT NULL,
  name                 TEXT    NOT NULL,
  merchant_name        TEXT,
  -- Money in is positive, money out is negative.
  amount_cents         INTEGER NOT NULL,
  plaid_category       TEXT,
  kind                 TEXT    CHECK (kind IN ('business', 'personal')),
  category_id          INTEGER REFERENCES expense_categories(id),
  rule_id              INTEGER REFERENCES bank_rules(id) ON DELETE SET NULL,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  note                 TEXT,
  import_key           TEXT    UNIQUE
);
INSERT INTO bank_transactions_new (id, account_id, plaid_transaction_id, date, name, merchant_name, amount_cents, plaid_category, kind, category_id, rule_id, created_at, note, import_key)
  SELECT id, account_id, plaid_transaction_id, date, name, merchant_name, amount_cents, plaid_category, kind, category_id, rule_id, created_at, note, import_key
  FROM bank_transactions;

DROP TABLE bank_transactions;
ALTER TABLE bank_transactions_new RENAME TO bank_transactions;

CREATE INDEX bank_transactions_by_date ON bank_transactions(date);
CREATE INDEX bank_transactions_by_kind ON bank_transactions(kind, date);
CREATE INDEX bank_transactions_by_account ON bank_transactions(account_id, date);

-- If the bank later drops the deposit, the invoice stays paid on the date it was.
ALTER TABLE invoices ADD COLUMN deposit_id INTEGER REFERENCES bank_transactions(id) ON DELETE SET NULL;
UPDATE invoices SET deposit_id = (SELECT deposit_id FROM deposit_links l WHERE l.invoice_id = invoices.id)
  WHERE id IN (SELECT invoice_id FROM deposit_links);
CREATE INDEX invoices_by_deposit ON invoices(deposit_id);

DROP TABLE deposit_links;
