-- One rule per match text. Duplicates (same text, any case) fold into the oldest one,
-- and transactions they sorted point at it instead.
UPDATE bank_transactions SET rule_id = (
  SELECT min(k.id) FROM bank_rules k JOIN bank_rules r ON lower(k.match_text) = lower(r.match_text) WHERE r.id = bank_transactions.rule_id
) WHERE rule_id IS NOT NULL;

DELETE FROM bank_rules WHERE id NOT IN (SELECT min(id) FROM bank_rules GROUP BY lower(match_text));

CREATE UNIQUE INDEX bank_rules_match_text ON bank_rules(match_text COLLATE NOCASE);
