-- Estimated tax payments, federal and state, including refunds applied from last year's return.
CREATE TABLE tax_payments (
  id             INTEGER PRIMARY KEY,
  tax_year       INTEGER NOT NULL,
  jurisdiction   TEXT    NOT NULL CHECK (jurisdiction IN ('federal', 'state')),
  quarter        INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  paid_on        TEXT    NOT NULL,
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
  applied_refund INTEGER NOT NULL DEFAULT 0,
  note           TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX tax_payments_by_year ON tax_payments(tax_year, quarter);
