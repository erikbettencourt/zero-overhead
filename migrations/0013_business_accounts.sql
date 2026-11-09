-- An account can be business-only. Its transactions are business or transfers (owner draws,
-- money you put in, card payments between your own accounts), which count as neither
-- income nor spending. Rules can sort into transfers too.
PRAGMA defer_foreign_keys = on;

ALTER TABLE bank_accounts ADD COLUMN business_only INTEGER NOT NULL DEFAULT 0;

-- Rebuilding the tables clears the links that point at them, so keep those and put them back.
CREATE TABLE keep_deposits AS SELECT id, deposit_id FROM invoices WHERE deposit_id IS NOT NULL;
CREATE TABLE keep_rules AS SELECT id, rule_id FROM bank_transactions WHERE rule_id IS NOT NULL;

CREATE TABLE bank_rules_new (
  id          INTEGER PRIMARY KEY,
  match_text  TEXT    NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('business', 'personal', 'transfer')),
  category_id INTEGER REFERENCES expense_categories(id),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO bank_rules_new (id, match_text, kind, category_id, created_at)
  SELECT id, match_text, kind, category_id, created_at FROM bank_rules;

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
  kind                 TEXT    CHECK (kind IN ('business', 'personal', 'transfer')),
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
DROP TABLE bank_rules;
ALTER TABLE bank_rules_new RENAME TO bank_rules;
ALTER TABLE bank_transactions_new RENAME TO bank_transactions;

CREATE UNIQUE INDEX bank_rules_match_text ON bank_rules(match_text COLLATE NOCASE);
CREATE INDEX bank_transactions_by_date ON bank_transactions(date);
CREATE INDEX bank_transactions_by_kind ON bank_transactions(kind, date);
CREATE INDEX bank_transactions_by_account ON bank_transactions(account_id, date);

UPDATE bank_transactions SET rule_id = (SELECT k.rule_id FROM keep_rules k WHERE k.id = bank_transactions.id)
  WHERE id IN (SELECT id FROM keep_rules);
UPDATE invoices SET deposit_id = (SELECT k.deposit_id FROM keep_deposits k WHERE k.id = invoices.id)
  WHERE id IN (SELECT id FROM keep_deposits);

DROP TABLE keep_deposits;
DROP TABLE keep_rules;
