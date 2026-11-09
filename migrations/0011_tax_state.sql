-- State tax became a setting. Installs that were already in use estimated Massachusetts tax,
-- so they keep it. A new install (no data yet) chooses its state in the Tax profile.
INSERT INTO settings (key, value)
  SELECT 'tax.profile', '{"state":"MA"}'
  WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'tax.profile')
    AND (EXISTS (SELECT 1 FROM time_entries) OR EXISTS (SELECT 1 FROM bank_transactions) OR EXISTS (SELECT 1 FROM tax_payments));

UPDATE settings SET value = json_set(value, '$.state', 'MA')
  WHERE key = 'tax.profile' AND json_extract(value, '$.state') IS NULL;
