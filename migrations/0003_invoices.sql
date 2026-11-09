-- Invoices are records: they keep the names, addresses and rates as they were when issued,
-- even if a client, project or task is later renamed or re-rated.

ALTER TABLE invoices ADD COLUMN notes TEXT;
ALTER TABLE invoices ADD COLUMN sent_on TEXT;
ALTER TABLE invoices ADD COLUMN paid_on TEXT;
ALTER TABLE invoices ADD COLUMN client_snapshot TEXT;
ALTER TABLE invoices ADD COLUMN business_snapshot TEXT;

ALTER TABLE invoice_lines ADD COLUMN description TEXT;

CREATE INDEX invoices_by_client ON invoices(client_id, period_start);
