-- How often a client is usually invoiced. The New invoice dialog starts from it.
ALTER TABLE clients ADD COLUMN billing_period TEXT NOT NULL DEFAULT 'monthly'
  CHECK (billing_period IN ('monthly', 'biweekly', 'quarterly'));
