-- Imported entries and duplicate protection.

-- Entries already invoiced in another tool (e.g. Harvest) are locked and never re-invoiced.
ALTER TABLE time_entries ADD COLUMN invoiced_elsewhere INTEGER NOT NULL DEFAULT 0;

-- A stable key per imported row, so re-running an import never duplicates entries.
ALTER TABLE time_entries ADD COLUMN import_key TEXT;
CREATE UNIQUE INDEX time_entries_import_key ON time_entries(import_key) WHERE import_key IS NOT NULL;

-- Names are unique where people would expect them to be.
CREATE UNIQUE INDEX clients_name ON clients(name COLLATE NOCASE);
CREATE UNIQUE INDEX projects_client_name ON projects(client_id, name COLLATE NOCASE);
