-- Categories follow the Schedule C lines exactly, plus health insurance premiums, which are
-- deducted separately (Schedule 1, not Schedule C). Transactions are business or personal
-- only: transfers become personal. Transactions gain a note (like the merchant behind a
-- PayPal charge) and a key so imported ones aren't added twice.
PRAGMA defer_foreign_keys = on;

ALTER TABLE expense_categories ADD COLUMN deduction TEXT NOT NULL DEFAULT 'schedule_c' CHECK (deduction IN ('schedule_c', 'health_insurance'));

-- The named groups on line 27a fold into Other expenses.
UPDATE expense_categories SET name = 'Other expenses' WHERE name = 'Other';
UPDATE bank_transactions SET category_id = (SELECT id FROM expense_categories WHERE name = 'Other expenses')
  WHERE category_id IN (SELECT id FROM expense_categories WHERE name IN ('Software and subscriptions', 'Phone and internet', 'Education', 'Bank and card fees'));
UPDATE bank_rules SET category_id = (SELECT id FROM expense_categories WHERE name = 'Other expenses')
  WHERE category_id IN (SELECT id FROM expense_categories WHERE name IN ('Software and subscriptions', 'Phone and internet', 'Education', 'Bank and card fees'));
DELETE FROM expense_categories WHERE name IN ('Software and subscriptions', 'Phone and internet', 'Education', 'Bank and card fees');

-- The names on the form.
UPDATE expense_categories SET name = 'Advertising' WHERE name = 'Advertising and marketing';
UPDATE expense_categories SET name = 'Car and truck expenses' WHERE name = 'Car and truck';
UPDATE expense_categories SET name = 'Depreciation and section 179' WHERE name = 'Equipment';
UPDATE expense_categories SET name = 'Insurance (other than health)' WHERE name = 'Insurance';
UPDATE expense_categories SET name = 'Office expense' WHERE name = 'Office expenses';
UPDATE expense_categories SET name = 'Rent or lease' WHERE name = 'Rent';
UPDATE expense_categories SET name = 'Deductible meals' WHERE name = 'Meals';

INSERT INTO expense_categories (name, schedule_c_line, deductible_percent, deduction)
  VALUES ('Health insurance premiums', NULL, 100, 'health_insurance');

-- Business or personal only.
CREATE TABLE bank_rules_new (
  id          INTEGER PRIMARY KEY,
  match_text  TEXT    NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('business', 'personal')),
  category_id INTEGER REFERENCES expense_categories(id),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO bank_rules_new (id, match_text, kind, category_id, created_at)
  SELECT id, match_text, CASE kind WHEN 'transfer' THEN 'personal' ELSE kind END, category_id, created_at FROM bank_rules;

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
  invoice_id           INTEGER REFERENCES invoices(id),
  rule_id              INTEGER REFERENCES bank_rules(id) ON DELETE SET NULL,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  note                 TEXT,
  import_key           TEXT    UNIQUE
);
INSERT INTO bank_transactions_new (id, account_id, plaid_transaction_id, date, name, merchant_name, amount_cents, plaid_category, kind, category_id, invoice_id, rule_id, created_at)
  SELECT id, account_id, plaid_transaction_id, date, name, merchant_name, amount_cents, plaid_category,
         CASE kind WHEN 'transfer' THEN 'personal' ELSE kind END, category_id, invoice_id, rule_id, created_at
  FROM bank_transactions;

DROP TABLE bank_transactions;
DROP TABLE bank_rules;
ALTER TABLE bank_rules_new RENAME TO bank_rules;
ALTER TABLE bank_transactions_new RENAME TO bank_transactions;

CREATE INDEX bank_transactions_by_date ON bank_transactions(date);
CREATE INDEX bank_transactions_by_kind ON bank_transactions(kind, date);
CREATE INDEX bank_transactions_by_invoice ON bank_transactions(invoice_id);
CREATE INDEX bank_transactions_by_account ON bank_transactions(account_id, date);
