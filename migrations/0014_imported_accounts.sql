-- Accounts you bring in from bank statements (CSV), for banks you don't connect through
-- Plaid. They remember which columns hold the date, description and amount.
ALTER TABLE bank_accounts ADD COLUMN imported INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bank_accounts ADD COLUMN csv_columns TEXT;
