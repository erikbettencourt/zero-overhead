-- Module 1: time tracking and invoicing.
-- Money is stored in integer cents and time in integer minutes to avoid rounding drift.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE clients (
  id                  INTEGER PRIMARY KEY,
  name                TEXT    NOT NULL,
  address             TEXT,
  email               TEXT,
  default_rate_cents  INTEGER,
  payment_terms_days  INTEGER NOT NULL DEFAULT 30,
  archived            INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE projects (
  id          INTEGER PRIMARY KEY,
  client_id   INTEGER NOT NULL REFERENCES clients(id),
  name        TEXT    NOT NULL,
  rate_cents  INTEGER,
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tasks (
  id        INTEGER PRIMARY KEY,
  name      TEXT    NOT NULL UNIQUE,
  billable  INTEGER NOT NULL DEFAULT 1,
  archived  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE project_tasks (
  project_id  INTEGER NOT NULL REFERENCES projects(id),
  task_id     INTEGER NOT NULL REFERENCES tasks(id),
  rate_cents  INTEGER,
  PRIMARY KEY (project_id, task_id)
);

CREATE TABLE invoices (
  id            INTEGER PRIMARY KEY,
  number        TEXT    NOT NULL UNIQUE,
  client_id     INTEGER NOT NULL REFERENCES clients(id),
  period_start  TEXT    NOT NULL,
  period_end    TEXT    NOT NULL,
  issued_on     TEXT,
  due_on        TEXT,
  status        TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'void')),
  total_cents   INTEGER NOT NULL DEFAULT 0,
  pdf_key       TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE time_entries (
  id          INTEGER PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id),
  task_id     INTEGER NOT NULL REFERENCES tasks(id),
  date        TEXT    NOT NULL,
  minutes     INTEGER NOT NULL CHECK (minutes >= 0),
  note        TEXT,
  invoice_id  INTEGER REFERENCES invoices(id),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX time_entries_by_date    ON time_entries(date);
CREATE INDEX time_entries_by_project ON time_entries(project_id, date);
CREATE INDEX time_entries_by_invoice ON time_entries(invoice_id);

CREATE TABLE invoice_lines (
  id            INTEGER PRIMARY KEY,
  invoice_id    INTEGER NOT NULL REFERENCES invoices(id),
  project_id    INTEGER NOT NULL REFERENCES projects(id),
  task_id       INTEGER NOT NULL REFERENCES tasks(id),
  minutes       INTEGER NOT NULL,
  rate_cents    INTEGER NOT NULL,
  amount_cents  INTEGER NOT NULL
);

-- Starting tasks; rename or add your own in Settings.
INSERT INTO tasks (name) VALUES ('Project management'), ('UI design'), ('Frontend development');
