-- One rate per project. Each task's rate as billed (its own, or else the client's) is
-- counted; when the most common one differs from the client's rate, the project takes it,
-- so most hours bill the same. Then task rates are cleared: a project's rate, or else the
-- client's, applies to every task.
UPDATE projects SET rate_cents = (
  SELECT coalesce(pt.rate_cents, c.default_rate_cents) AS r FROM project_tasks pt JOIN clients c ON c.id = projects.client_id
  WHERE pt.project_id = projects.id
  GROUP BY r ORDER BY count(*) DESC, r DESC LIMIT 1
)
WHERE rate_cents IS NULL
  AND (
    SELECT coalesce(pt.rate_cents, c.default_rate_cents) AS r FROM project_tasks pt JOIN clients c ON c.id = projects.client_id
    WHERE pt.project_id = projects.id
    GROUP BY r ORDER BY count(*) DESC, r DESC LIMIT 1
  ) IS NOT (SELECT default_rate_cents FROM clients WHERE id = projects.client_id);

UPDATE project_tasks SET rate_cents = NULL;
