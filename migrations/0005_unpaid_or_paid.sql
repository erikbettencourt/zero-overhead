-- Invoices are either unpaid or paid. Draft and sent become unpaid; voided invoices,
-- whose hours were already released, are removed. The sent date is no longer kept.
PRAGMA defer_foreign_keys = on;

DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE status = 'void');
UPDATE time_entries SET invoice_id = NULL WHERE invoice_id IN (SELECT id FROM invoices WHERE status = 'void');
DELETE FROM invoices WHERE status = 'void';

CREATE TABLE invoices_new (
  id                INTEGER PRIMARY KEY,
  number            TEXT    NOT NULL UNIQUE,
  client_id         INTEGER NOT NULL REFERENCES clients(id),
  period_start      TEXT    NOT NULL,
  period_end        TEXT    NOT NULL,
  issued_on         TEXT,
  due_on            TEXT,
  status            TEXT    NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid')),
  total_cents       INTEGER NOT NULL DEFAULT 0,
  pdf_key           TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  notes             TEXT,
  paid_on           TEXT,
  client_snapshot   TEXT,
  business_snapshot TEXT
);

INSERT INTO invoices_new (id, number, client_id, period_start, period_end, issued_on, due_on, status, total_cents, pdf_key, created_at, notes, paid_on, client_snapshot, business_snapshot)
SELECT id, number, client_id, period_start, period_end, issued_on, due_on,
       CASE status WHEN 'paid' THEN 'paid' ELSE 'unpaid' END,
       total_cents, pdf_key, created_at, notes, CASE status WHEN 'paid' THEN paid_on END, client_snapshot, business_snapshot
FROM invoices;

DROP TABLE invoices;
ALTER TABLE invoices_new RENAME TO invoices;
CREATE INDEX invoices_by_client ON invoices(client_id, period_start);

PRAGMA defer_foreign_keys = off;
