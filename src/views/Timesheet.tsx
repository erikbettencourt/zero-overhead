import { useCallback, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, LockIcon, PencilIcon, PlusIcon } from "lucide-react";
import type { Summary, TimeEntry } from "../../shared/types";
import { addDays, formatDuration, formatMoney, parseDuration, startOfWeek, toIsoDate } from "../../shared/time";
import { api } from "../api";
import { useAction, useData } from "../state";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import WeekGrid from "./Week";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_MINUTES = 24 * 60;
const LAST_PICK = "zo.lastProjectTask";

export type Mode = "day" | "week";

export function toDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export const dayLabel = (iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", month: "short", day: "numeric" }) =>
  toDate(iso).toLocaleDateString("en-US", opts);

function rangeLabel(start: string) {
  const a = toDate(start);
  const b = toDate(addDays(start, 6));
  const month = (d: Date) => d.toLocaleString("en-US", { month: "short" });
  return a.getMonth() === b.getMonth() ? `${month(a)} ${a.getDate()} to ${b.getDate()}` : `${month(a)} ${a.getDate()} to ${month(b)} ${b.getDate()}`;
}

/** One week of entries, shared by the Day and Week views so switching between them is instant. */
export default function Timesheet({ mode, date }: { mode: Mode; date: string }) {
  const today = toIsoDate(new Date());
  const weekStart = startOfWeek(date);
  const weekEnd = addDays(weekStart, 6);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [dialog, setDialog] = useState<{ date: string; entry?: TimeEntry } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const run = useAction();

  const load = useCallback(async () => {
    const list = await run(() => api.entries(weekStart, weekEnd));
    if (list) setEntries(list);
  }, [run, weekStart, weekEnd]);

  useEffect(() => {
    setEntries(null);
    void load();
  }, [load]);

  const upsert = useCallback(
    (entry: TimeEntry) =>
      setEntries((es) => {
        const list = (es ?? []).filter((e) => e.id !== entry.id);
        return entry.date >= weekStart && entry.date <= weekEnd ? [...list, entry] : list;
      }),
    [weekStart, weekEnd],
  );
  const remove = useCallback((id: number) => setEntries((es) => (es ?? []).filter((e) => e.id !== id)), []);

  const step = mode === "day" ? 1 : 7;
  const isCurrent = mode === "day" ? date === today : weekStart === startOfWeek(today);
  const go = (d: string, m: Mode = mode) => (location.hash = `#/${m}/${d}`);
  const newEntryDate = mode === "day" ? date : today >= weekStart && today <= weekEnd ? today : weekStart;
  const weekTotal = (entries ?? []).reduce((s, e) => s + e.minutes, 0);
  const thisWeek = startOfWeek(today);
  const whichWeek = weekStart === thisWeek ? "this week" : weekStart === addDays(thisWeek, -7) ? "last week" : `week of ${dayLabel(weekStart, { month: "short", day: "numeric" })}`;

  // What the week is worth, at the same rates Reports and invoices use. Refreshed as entries change.
  const [money, setMoney] = useState<Summary | null>(null);
  useEffect(() => {
    if (!entries) return;
    let live = true;
    const t = setTimeout(() => void run(() => api.summary(weekStart, weekEnd)).then((s) => live && s && setMoney(s)), 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [entries, weekStart, weekEnd, run]);
  const earned = money?.clients.reduce((s, c) => s + c.earnedCents, 0) ?? 0;
  const invoiced = money?.clients.reduce((s, c) => s + c.invoicedCents, 0) ?? 0;
  const noRate = money?.clients.some((c) => c.missingRateMinutes > 0) ?? false;
  const worth =
    !money || weekTotal === 0
      ? null
      : earned === 0
        ? noRate
          ? "Set a rate to see what this time is worth"
          : "Nothing billable"
        : `${formatMoney(earned)} billable, ${invoiced === 0 ? "not yet invoiced" : invoiced >= earned ? "all invoiced" : `${formatMoney(invoiced)} invoiced`}${noRate ? ", some time has no rate" : ""}`;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {/* The week's hours are the heading; the page itself is the Timesheet. */}
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="sr-only">Timesheet, </span>
            <span className="num">{entries ? formatDuration(weekTotal, { blankZero: false }) : "…"}</span> {whichWeek}
          </h1>
          <p className="mt-0.5 min-h-5 text-sm text-muted-foreground">{worth}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isCurrent && (
            <Button variant="link" size="sm" onClick={() => go(today)}>
              {mode === "day" ? "Back to today" : "Back to this week"}
            </Button>
          )}
          <div className="flex">
            <Button variant="outline" size="icon" className="rounded-r-none" aria-label={mode === "day" ? "Previous day" : "Previous week"} onClick={() => go(addDays(date, -step))}>
              <ChevronLeftIcon />
            </Button>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="-mx-px min-w-56 rounded-none" aria-label="Choose a date">
                  <CalendarIcon className="text-muted-foreground" />
                  {isCurrent && <span className="text-now">{mode === "day" ? "Today" : "This week"}</span>}
                  {mode === "day" ? dayLabel(date) : rangeLabel(weekStart)}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={toDate(date)}
                  defaultMonth={toDate(date)}
                  onSelect={(d) => {
                    if (!d) return;
                    setPickerOpen(false);
                    go(toIsoDate(d));
                  }}
                />
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="icon" className="rounded-l-none" aria-label={mode === "day" ? "Next day" : "Next week"} onClick={() => go(addDays(date, step))}>
              <ChevronRightIcon />
            </Button>
          </div>
          <Tabs value={mode} onValueChange={(m) => go(date, m as Mode)}>
            <TabsList>
              <TabsTrigger value="day">Day</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {mode === "day" ? (
        <DayBody
          date={date}
          today={today}
          days={days}
          entries={entries}
          onTrack={() => setDialog({ date })}
          onEdit={(entry) => setDialog({ date: entry.date, entry })}
        />
      ) : (
        <WeekGrid days={days} today={today} entries={entries} onUpsert={upsert} onTrack={() => setDialog({ date: newEntryDate })} reload={load} />
      )}

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog && (
          <EntryDialog
            key={dialog.entry?.id ?? `new-${dialog.date}`}
            date={dialog.date}
            entry={dialog.entry}
            onClose={() => setDialog(null)}
            onSaved={(e) => {
              upsert(e);
              setDialog(null);
            }}
            onDeleted={(id) => {
              remove(id);
              setDialog(null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function DayBody({
  date,
  today,
  days,
  entries,
  onTrack,
  onEdit,
}: {
  date: string;
  today: string;
  days: string[];
  entries: TimeEntry[] | null;
  onTrack: () => void;
  onEdit: (e: TimeEntry) => void;
}) {
  const dayTotal = (d: string) => (entries ?? []).filter((e) => e.date === d).reduce((s, e) => s + e.minutes, 0);
  const list = (entries ?? []).filter((e) => e.date === date).sort((a, b) => a.id - b.id);
  const total = list.reduce((s, e) => s + e.minutes, 0);

  return (
    <>
      <nav className="mt-5 grid grid-cols-7 gap-1" aria-label="Days this week">
        {days.map((d, i) => {
          const selected = d === date;
          const isToday = d === today;
          const minutes = dayTotal(d);
          return (
            <a
              key={d}
              href={`#/day/${d}`}
              aria-current={selected ? "date" : undefined}
              className={cn(
                "min-w-0 rounded-md px-1.5 py-2 text-sm transition-colors sm:px-3",
                selected ? "bg-primary text-primary-foreground shadow-xs" : "hover:bg-accent",
              )}
            >
              <span className={cn("flex items-center gap-1.5 font-semibold", !selected && (isToday ? "text-now" : "text-muted-foreground"))}>
                {DAY_NAMES[i]} <span className="num hidden font-normal sm:inline">{Number(d.slice(5, 7))}/{Number(d.slice(8, 10))}</span>
                {isToday && <span className={cn("size-1.5 rounded-full", selected ? "bg-primary-foreground" : "bg-now")} aria-label="Today" />}
              </span>
              <span className={cn("num block", !selected && (minutes ? "text-foreground" : "text-muted-foreground"))}>
                {entries ? formatDuration(minutes, { blankZero: false }) : " "}
              </span>
            </a>
          );
        })}
      </nav>

      <Card className="mt-4 overflow-hidden">
        {entries === null ? (
          <p className="px-5 py-14 text-center text-muted-foreground">Loading…</p>
        ) : list.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="font-semibold">Nothing tracked on {dayLabel(date, { weekday: "long" })}</p>
            <p className="mt-1 text-sm text-muted-foreground">Add an entry for each meeting or block of work, with a note for each.</p>
            <Button className="mt-4" variant="outline" onClick={onTrack}>
              <PlusIcon />
              Track time
            </Button>
          </div>
        ) : (
          <>
            <ul className="divide-y">
              {list.map((e) => (
                <EntryLine key={e.id} entry={e} onEdit={() => onEdit(e)} />
              ))}
            </ul>
            <div className="flex items-center gap-4 border-t bg-muted/50 px-5 py-2.5">
              <Button variant="ghost" size="sm" className="-ml-3" onClick={onTrack}>
                <PlusIcon />
                Track time
              </Button>
              <span className="ml-auto text-sm text-muted-foreground">Total</span>
              <span className="num w-16 text-right text-xl font-bold">{formatDuration(total, { blankZero: false })}</span>
              <span className="w-8" />
            </div>
          </>
        )}
      </Card>
    </>
  );
}

function EntryLine({ entry, onEdit }: { entry: TimeEntry; onEdit: () => void }) {
  const { projectById, clientById, taskById } = useData();
  const project = projectById.get(entry.projectId);
  const client = project && clientById.get(project.clientId);
  return (
    <li className="flex items-start gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold">{project?.name ?? "Unknown project"}</span>
          <Badge variant="outline">{client?.name ?? "Unknown client"}</Badge>
          {entry.locked && <Badge variant="success">Invoiced</Badge>}
        </div>
        <div className="mt-0.5 text-sm text-muted-foreground">{taskById.get(entry.taskId)?.name ?? "Unknown task"}</div>
        {entry.note && <p className="mt-1.5 whitespace-pre-line">{entry.note}</p>}
      </div>
      <div className="num w-16 text-right text-xl font-bold">{formatDuration(entry.minutes, { blankZero: false })}</div>
      {entry.locked ? (
        <span className="flex size-8 items-center justify-center text-muted-foreground" title="Invoiced, so it can't be changed">
          <LockIcon className="size-4" />
        </span>
      ) : (
        <Button variant="ghost" size="icon-sm" aria-label="Edit entry" onClick={onEdit}>
          <PencilIcon />
        </Button>
      )}
    </li>
  );
}

function readLastPick(): string {
  try {
    return localStorage.getItem(LAST_PICK) ?? "";
  } catch {
    return "";
  }
}

function EntryDialog({
  date,
  entry,
  onClose,
  onSaved,
  onDeleted,
}: {
  date: string;
  entry?: TimeEntry;
  onClose: () => void;
  onSaved: (e: TimeEntry) => void;
  onDeleted: (id: number) => void;
}) {
  const run = useAction();
  const { data, clientById, taskById } = useData();

  // Projects you can log to, grouped by client. An entry's own project stays listed even if archived since.
  const projects = useMemo(() => {
    const ok = data.projects.filter((p) => {
      const c = clientById.get(p.clientId);
      const live = !p.archived && c && !c.archived && data.projectTasks.some((pt) => pt.projectId === p.id && !taskById.get(pt.taskId)?.archived);
      return live || p.id === entry?.projectId;
    });
    const groups = new Map<string, typeof ok>();
    for (const p of ok) {
      const client = clientById.get(p.clientId)?.name ?? "";
      groups.set(client, [...(groups.get(client) ?? []), p]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([client, list]) => [client, list.sort((a, b) => a.name.localeCompare(b.name))] as const);
  }, [data.projects, data.projectTasks, clientById, taskById, entry?.projectId]);

  const tasksFor = useCallback(
    (projectId: number) =>
      data.projectTasks
        .filter((pt) => pt.projectId === projectId)
        .map((pt) => taskById.get(pt.taskId)!)
        .filter((t) => t && (!t.archived || (entry && t.id === entry.taskId && projectId === entry.projectId)))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data.projectTasks, taskById, entry],
  );

  const [projectId, setProjectId] = useState<number>(() => {
    if (entry) return entry.projectId;
    const [p] = readLastPick().split(":").map(Number);
    const all = projects.flatMap(([, l]) => l);
    return all.some((x) => x.id === p) ? p : (all[0]?.id ?? 0);
  });
  const [taskId, setTaskId] = useState<number>(() => {
    if (entry) return entry.taskId;
    const [p, t] = readLastPick().split(":").map(Number);
    const tasks = tasksFor(projectId);
    return p === projectId && tasks.some((x) => x.id === t) ? t : (tasks[0]?.id ?? 0);
  });
  const [note, setNote] = useState(entry?.note ?? "");
  const [hours, setHours] = useState(entry ? formatDuration(entry.minutes, { blankZero: false }) : "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const tasks = tasksFor(projectId);

  function pickProject(id: number) {
    setProjectId(id);
    const next = tasksFor(id);
    if (!next.some((t) => t.id === taskId)) setTaskId(next[0]?.id ?? 0);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!projectId || !taskId) return setError("Choose a project and task.");
    const minutes = parseDuration(hours || "0");
    if (minutes === null || minutes > MAX_MINUTES) return setError("Enter the time like 1:30 or 1.5.");
    setError(null);
    setSaving(true);
    const body = { projectId, taskId, minutes, note: note.trim() || null };
    const saved = await run(() => (entry ? api.updateEntry(entry.id, body) : api.createEntry({ ...body, date })));
    setSaving(false);
    if (!saved) return;
    try {
      localStorage.setItem(LAST_PICK, `${projectId}:${taskId}`);
    } catch {
      // Remembering the last pick is a convenience only.
    }
    onSaved(saved);
  }

  async function del() {
    if (!entry) return;
    const ok = await run(async () => {
      await api.deleteEntry(entry.id);
      return true;
    });
    if (ok) onDeleted(entry.id);
  }

  const submitOnCmdEnter = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{entry ? "Edit entry" : "Track time"}</DialogTitle>
        <DialogDescription>{dayLabel(date, { weekday: "long", month: "long", day: "numeric" })}</DialogDescription>
      </DialogHeader>
      <form onSubmit={(e) => void save(e)} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="entry-project">Project</Label>
          <Select value={String(projectId)} onValueChange={(v) => pickProject(Number(v))}>
            <SelectTrigger id="entry-project" className="h-auto min-h-12">
              <SelectValue placeholder="Choose a project">
                {(() => {
                  const hit = projects.flatMap(([client, list]) => list.map((p) => [client, p] as const)).find(([, p]) => p.id === projectId);
                  return hit ? (
                    <span className="flex flex-col">
                      <span className="text-xs text-muted-foreground">{hit[0]}</span>
                      <span className="font-semibold">{hit[1].name}</span>
                    </span>
                  ) : null;
                })()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {projects.map(([client, list]) => (
                <SelectGroup key={client}>
                  <SelectLabel>{client}</SelectLabel>
                  {list.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="entry-task">Task</Label>
          <Select value={taskId ? String(taskId) : ""} onValueChange={(v) => setTaskId(Number(v))}>
            <SelectTrigger id="entry-task">
              <SelectValue placeholder="Choose a task" />
            </SelectTrigger>
            <SelectContent>
              {tasks.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-[1fr_8rem] gap-3">
          <div className="grid gap-2">
            <Label htmlFor="entry-note">Notes</Label>
            <Textarea
              id="entry-note"
              autoFocus
              className="min-h-24 resize-y"
              placeholder="What was this time for?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={submitOnCmdEnter}
            />
          </div>
          <div className="grid content-start gap-2">
            <Label htmlFor="entry-hours">Time</Label>
            <Input
              id="entry-hours"
              inputMode="decimal"
              className="num h-24 text-right text-3xl font-bold md:text-3xl"
              placeholder="0:00"
              value={hours}
              aria-invalid={!!error}
              onChange={(e) => setHours(e.target.value)}
            />
          </div>
        </div>
        {error && <p className="-mt-2 text-sm text-destructive">{error}</p>}
        <DialogFooter className="mt-1">
          {entry && (
            <Button type="button" variant="ghost" className="mr-auto text-muted-foreground hover:text-destructive" onClick={() => void del()}>
              Delete
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {entry ? "Save entry" : "Add entry"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
