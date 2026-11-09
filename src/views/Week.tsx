import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { CopyIcon, NotebookPenIcon, PlusIcon } from "lucide-react";
import type { TimeEntry } from "../../shared/types";
import { addDays, formatDuration, parseDuration } from "../../shared/time";
import { api } from "../api";
import { useAction, useData } from "../state";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { dayLabel } from "./Timesheet";

type RowKey = string; // `${projectId}:${taskId}`
const rowKey = (projectId: number, taskId: number): RowKey => `${projectId}:${taskId}`;
const splitKey = (k: RowKey) => k.split(":").map(Number) as [number, number];

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function WeekGrid({
  days,
  today,
  entries,
  onUpsert,
  onTrack,
  reload,
}: {
  days: string[];
  today: string;
  entries: TimeEntry[] | null;
  onUpsert: (e: TimeEntry) => void;
  onTrack: () => void;
  reload: () => Promise<void>;
}) {
  const weekStart = days[0];
  const [extraRows, setExtraRows] = useState<RowKey[]>([]);
  const [notesFor, setNotesFor] = useState<RowKey | null>(null);
  const { clientById, projectById, taskById, data } = useData();
  const run = useAction();

  useEffect(() => setExtraRows([]), [weekStart]);

  const describe = (k: RowKey) => {
    const [p, t] = splitKey(k);
    const project = projectById.get(p);
    return {
      client: project ? (clientById.get(project.clientId)?.name ?? "") : "",
      project: project?.name ?? "Unknown project",
      task: taskById.get(t)?.name ?? "Unknown task",
    };
  };

  // Rows: anything with time this week, plus rows added by hand, sorted client > project > task.
  const rows = useMemo(() => {
    const keys = new Set<RowKey>(extraRows);
    for (const e of entries ?? []) keys.add(rowKey(e.projectId, e.taskId));
    const label = (k: RowKey) => Object.values(describe(k)).join("\u0000");
    return [...keys].sort((a, b) => label(a).localeCompare(label(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, extraRows, projectById, clientById, taskById]);

  const rowEntries = (k: RowKey) => (entries ?? []).filter((e) => rowKey(e.projectId, e.taskId) === k);
  const cellEntries = (k: RowKey, date: string) => rowEntries(k).filter((e) => e.date === date);

  const addableRows = useMemo(() => {
    const present = new Set(rows);
    return data.projectTasks
      .filter((pt) => {
        const project = projectById.get(pt.projectId);
        const client = project && clientById.get(project.clientId);
        const task = taskById.get(pt.taskId);
        return project && !project.archived && client && !client.archived && task && !task.archived;
      })
      .map((pt) => rowKey(pt.projectId, pt.taskId))
      .filter((k) => !present.has(k));
  }, [data.projectTasks, rows, projectById, clientById, taskById]);

  async function copyLastWeek() {
    const prev = await run(() => api.entries(addDays(weekStart, -7), addDays(weekStart, -1)));
    if (!prev) return;
    setExtraRows((r) => [...new Set([...r, ...prev.map((e) => rowKey(e.projectId, e.taskId))])]);
  }

  async function saveCell(k: RowKey, date: string, minutes: number) {
    const existing = cellEntries(k, date);
    const [projectId, taskId] = splitKey(k);
    if (existing.length === 0) {
      if (minutes === 0) return;
      const created = await run(() => api.createEntry({ projectId, taskId, date, minutes }));
      if (created) onUpsert(created);
    } else if (existing.length === 1) {
      const entry = existing[0];
      if (minutes === entry.minutes) return;
      if (minutes === 0 && !entry.note) {
        const ok = await run(async () => {
          await api.deleteEntry(entry.id);
          return true;
        });
        if (ok) {
          setExtraRows((r) => [...new Set([...r, k])]);
          await reload();
        }
      } else {
        const updated = await run(() => api.updateEntry(entry.id, { minutes }));
        if (updated) onUpsert(updated);
      }
    }
  }

  const sum = (list: TimeEntry[]) => list.reduce((s, e) => s + e.minutes, 0);
  const dayTotal = (d: string) => sum((entries ?? []).filter((e) => e.date === d));
  let lastClient = "";

  return (
    <div className="mt-5">
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th className="sticky left-0 z-10 min-w-52 bg-card px-4 py-2.5 text-left font-semibold text-muted-foreground">Project and task</th>
                <th className="w-11" aria-label="Notes" />
                {days.map((d, i) => {
                  const isToday = d === today;
                  return (
                    <th key={d} className={cn("w-[4.75rem] px-1 py-1.5 font-semibold", isToday && "bg-now-wash")}>
                      <a
                        href={`#/day/${d}`}
                        title={`Open ${dayLabel(d)}`}
                        className={cn("block rounded-md px-1 py-1 hover:bg-accent", isToday ? "text-now" : "text-muted-foreground")}
                      >
                        <span className="block">{DAY_NAMES[i]}</span>
                        <span className="block text-xs font-normal">{isToday ? "Today" : dayLabel(d, { month: "short", day: "numeric" })}</span>
                      </a>
                    </th>
                  );
                })}
                <th className="w-20 px-4 py-2.5 text-right font-semibold text-muted-foreground">Total</th>
              </tr>
            </thead>
            <tbody>
              {entries === null && (
                <tr>
                  <td colSpan={10} className="px-4 py-14 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {entries !== null && rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-14 text-center">
                    <p className="font-semibold">Nothing tracked this week</p>
                    <p className="mt-1 text-sm text-muted-foreground">Add a row below, copy last week's rows, or track time.</p>
                    <Button className="mt-4" variant="outline" onClick={onTrack}>
                      <PlusIcon />
                      Track time
                    </Button>
                  </td>
                </tr>
              )}
              {entries !== null &&
                rows.map((k) => {
                  const { client, project, task } = describe(k);
                  const showClient = client !== lastClient;
                  lastClient = client;
                  const list = rowEntries(k);
                  const withNotes = list.filter((e) => e.note).length;
                  return [
                    showClient && (
                      <tr key={`c-${k}`}>
                        <td colSpan={10} className="px-4 pt-4 pb-1 text-xs font-bold text-muted-foreground">
                          <span className="sticky left-4">{client}</span>
                        </td>
                      </tr>
                    ),
                    <tr key={k} className="border-b last:border-0">
                      <td className="sticky left-0 z-10 bg-card px-4 py-2">
                        <span className="block font-bold">{project}</span>
                        <span className="text-muted-foreground">{task}</span>
                      </td>
                      <td className="px-1 py-1 text-center">
                        {list.length > 0 && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className={cn("relative", !withNotes && "text-muted-foreground")}
                            onClick={() => setNotesFor(k)}
                            aria-label={`Notes for ${project}, ${task}`}
                            title={withNotes ? `${withNotes} with notes` : "Add notes"}
                          >
                            <NotebookPenIcon />
                            {withNotes > 0 && (
                              <span className="num absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 font-bold text-primary-foreground">
                                {withNotes}
                              </span>
                            )}
                          </Button>
                        )}
                      </td>
                      {days.map((d) => (
                        <td key={d} className={cn("px-1 py-1.5", d === today && "bg-now-wash")}>
                          <HoursCell entries={cellEntries(k, d)} label={`${project}, ${task}, ${dayLabel(d)}`} onSave={(m) => saveCell(k, d, m)} date={d} />
                        </td>
                      ))}
                      <td className="num px-4 py-2 text-right font-bold">{formatDuration(sum(list), { blankZero: false })}</td>
                    </tr>,
                  ];
                })}
            </tbody>
            {entries !== null && rows.length > 0 && (
              <tfoot>
                <tr className="border-t bg-muted">
                  <td className="sticky left-0 z-10 bg-muted px-4 py-2.5 font-semibold text-muted-foreground">Total</td>
                  <td />
                  {days.map((d) => (
                    <td key={d} className={cn("num px-2 py-2.5 text-right font-bold", d === today && "bg-now-wash", !dayTotal(d) && "text-muted-foreground")}>
                      {formatDuration(dayTotal(d), { blankZero: false })}
                    </td>
                  ))}
                  <td className="num px-4 py-2.5 text-right text-base font-bold">{formatDuration(sum(entries), { blankZero: false })}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {addableRows.length > 0 && <AddRow options={addableRows} describe={describe} onAdd={(k) => setExtraRows((r) => [...r, k])} />}
        <Button variant="ghost" size="sm" onClick={() => void copyLastWeek()}>
          <CopyIcon />
          Copy rows from last week
        </Button>
      </div>

      <Dialog open={!!notesFor} onOpenChange={(o) => !o && setNotesFor(null)}>
        {notesFor && (
          <WeeklyNotes
            key={notesFor}
            names={describe(notesFor)}
            entries={rowEntries(notesFor).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)}
            onSaved={(list) => list.forEach(onUpsert)}
            onClose={() => setNotesFor(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

function HoursCell({ entries, label, onSave, date }: { entries: TimeEntry[]; label: string; onSave: (minutes: number) => Promise<void>; date: string }) {
  const total = entries.reduce((s, e) => s + e.minutes, 0);
  const locked = entries.some((e) => e.locked);
  const multiple = entries.length > 1;
  const notes = entries.map((e) => e.note).filter(Boolean).join("\n");
  const [draft, setDraft] = useState(formatDuration(total));
  const [invalid, setInvalid] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(formatDuration(total));
    setInvalid(false);
  }, [total]);

  const box = "num h-9 w-full rounded-md border px-2 text-right shadow-xs";

  if (locked || multiple) {
    return (
      <a
        href={`#/day/${date}`}
        title={locked ? "Invoiced, so it can't be changed" : `${entries.length} entries. Open the day to edit them.\n${notes}`.trim()}
        className={cn(box, "flex items-center justify-end border-transparent bg-muted text-muted-foreground shadow-none hover:border-input")}
      >
        {formatDuration(total)}
        {locked && <span className="sr-only"> (invoiced)</span>}
      </a>
    );
  }

  async function commit() {
    const minutes = parseDuration(draft);
    if (minutes === null || minutes > 24 * 60) return setInvalid(true);
    setInvalid(false);
    setDraft(formatDuration(minutes));
    if (minutes === total) return;
    setSaving(true);
    await onSave(minutes);
    setSaving(false);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
    if (e.key === "Escape") {
      setDraft(formatDuration(total));
      setInvalid(false);
    }
  }

  return (
    <input
      aria-label={label}
      title={notes || undefined}
      aria-invalid={invalid}
      inputMode="decimal"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={onKey}
      onFocus={(e) => e.target.select()}
      className={cn(
        box,
        "border-input bg-card outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30",
        invalid && "border-destructive text-destructive",
        saving && "opacity-60",
      )}
    />
  );
}

function WeeklyNotes({
  names,
  entries,
  onSaved,
  onClose,
}: {
  names: { client: string; project: string; task: string };
  entries: TimeEntry[];
  onSaved: (list: TimeEntry[]) => void;
  onClose: () => void;
}) {
  const run = useAction();
  const [drafts, setDrafts] = useState<Record<number, string>>(() => Object.fromEntries(entries.map((e) => [e.id, e.note ?? ""])));
  const [saving, setSaving] = useState(false);

  async function save() {
    const changed = entries.filter((e) => !e.locked && (drafts[e.id] ?? "").trim() !== (e.note ?? ""));
    setSaving(true);
    const saved = await run(() => Promise.all(changed.map((e) => api.updateEntry(e.id, { note: drafts[e.id].trim() || null }))));
    setSaving(false);
    if (!saved) return;
    onSaved(saved);
    onClose();
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Weekly notes</DialogTitle>
        <DialogDescription>
          {names.project}, {names.task} for {names.client}
        </DialogDescription>
      </DialogHeader>
      <ul className="grid gap-4">
        {entries.map((e) => (
          <li key={e.id} className="grid gap-2">
            <Label htmlFor={`wn-${e.id}`} className="justify-between">
              <span>{dayLabel(e.date, { weekday: "short", month: "short", day: "numeric" })}</span>
              <span className="flex items-center gap-2">
                {e.locked && <Badge variant="success">Invoiced</Badge>}
                <span className="num font-normal text-muted-foreground">{formatDuration(e.minutes, { blankZero: false })} hrs</span>
              </span>
            </Label>
            <Textarea
              id={`wn-${e.id}`}
              className="min-h-10"
              placeholder="Notes"
              disabled={e.locked}
              value={drafts[e.id] ?? ""}
              onChange={(ev) => setDrafts((d) => ({ ...d, [e.id]: ev.target.value }))}
            />
          </li>
        ))}
      </ul>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={saving} onClick={() => void save()}>
          Save notes
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function AddRow({
  options,
  describe,
  onAdd,
}: {
  options: RowKey[];
  describe: (k: RowKey) => { client: string; project: string; task: string };
  onAdd: (k: RowKey) => void;
}) {
  const grouped = useMemo(() => {
    const groups = new Map<string, RowKey[]>();
    for (const k of options) {
      const { client } = describe(k);
      groups.set(client, [...(groups.get(client) ?? []), k]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [options, describe]);

  return (
    <Select value="" onValueChange={(v) => v && onAdd(v)}>
      <SelectTrigger className="h-8 w-auto gap-1.5 font-semibold" aria-label="Add a row">
        <PlusIcon className="size-4" />
        <SelectValue placeholder="Add row" />
      </SelectTrigger>
      <SelectContent className="min-w-64">
        {grouped.map(([client, keys]) => (
          <SelectGroup key={client}>
            <SelectLabel>{client}</SelectLabel>
            {keys.map((k) => {
              const { project, task } = describe(k);
              return (
                <SelectItem key={k} value={k}>
                  {project}, {task}
                </SelectItem>
              );
            })}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
