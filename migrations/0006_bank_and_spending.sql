-- Bank connections (through Plaid), the accounts behind them, and every posted transaction.
-- A transaction is reviewed once it's marked business, personal or a transfer.

CREATE TABLE bank_items (
  id               INTEGER PRIMARY KEY,
  plaid_item_id    TEXT    NOT NULL UNIQUE,
  access_token     TEXT    NOT NULL,
  institution_name TEXT    NOT NULL,
  cursor           TEXT,
  status           TEXT    NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'reconnect')),
  error            TEXT,
  last_synced_at   TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE bank_accounts (
  id               INTEGER PRIMARY KEY,
  item_id          INTEGER REFERENCES bank_items(id) ON DELETE SET NULL,
  plaid_account_id TEXT    UNIQUE,
  institution_name TEXT    NOT NULL,
  name             TEXT    NOT NULL,
  mask             TEXT,
  type             TEXT,
  subtype          TEXT
);

-- Business expense categories, named after the lines on Schedule C.
CREATE TABLE expense_categories (
  id                 INTEGER PRIMARY KEY,
  name               TEXT    NOT NULL UNIQUE,
  schedule_c_line    TEXT,
  deductible_percent INTEGER NOT NULL DEFAULT 100,
  archived           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE bank_rules (
  id          INTEGER PRIMARY KEY,
  match_text  TEXT    NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('business', 'personal', 'transfer')),
  category_id INTEGER REFERENCES expense_categories(id),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE bank_transactions (
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
  invoice_id           INTEGER REFERENCES invoices(id),
  rule_id              INTEGER REFERENCES bank_rules(id) ON DELETE SET NULL,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX bank_transactions_by_date ON bank_transactions(date);
CREATE INDEX bank_transactions_by_kind ON bank_transactions(kind, date);
CREATE INDEX bank_transactions_by_invoice ON bank_transactions(invoice_id);

INSERT INTO expense_categories (name, schedule_c_line, deductible_percent) VALUES
  ('Advertising and marketing', '8', 100),
  ('Car and truck', '9', 100),
  ('Commissions and fees', '10', 100),
  ('Contract labor', '11', 100),
  ('Equipment', '13', 100),
  ('Insurance', '15', 100),
  ('Interest', '16', 100),
  ('Legal and professional services', '17', 100),
  ('Office expenses', '18', 100),
  ('Rent', '20', 100),
  ('Repairs and maintenance', '21', 100),
  ('Supplies', '22', 100),
  ('Taxes and licenses', '23', 100),
  ('Travel', '24a', 100),
  ('Meals', '24b', 50),
  ('Utilities', '25', 100),
  ('Software and subscriptions', '27a', 100),
  ('Phone and internet', '27a', 100),
  ('Education', '27a', 100),
  ('Bank and card fees', '27a', 100),
  ('Other', '27a', 100);
