import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { CheckIcon, EllipsisIcon, LockIcon, PencilIcon, PlusIcon, SparklesIcon, Trash2Icon, XIcon } from "lucide-react";
import type { TimeEntry } from "../../shared/types";
import { formatHm, parseDuration } from "../../shared/time";
import { api } from "../api";
import { useAction, useData } from "../state";
import { suggestionsFor, whyLine, type Suggestion } from "../suggestions";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dayLabel } from "./Timesheet";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_MINUTES = 24 * 60;
const NUDGE = 30;
export const LAST_PICK = "zo.lastProjectTask";
const SKIPPED = "zo.skippedSuggestions";

/* Choosing a project and task, shared by the inline rows here and the full form. */

export function readLastPick(): [number, number] {
  try {
    const [p, t] = (localStorage.getItem(LAST_PICK) ?? "").split(":").map(Number);
    return [p || 0, t || 0];
  } catch {
    return [0, 0];
  }
}

export function rememberPick(projectId: number, taskId: number) {
  try {
    localStorage.setItem(LAST_PICK, `${projectId}:${taskId}`);
  } catch {
    // Remembering the last pick is a convenience only.
  }
}

/** Projects you can log to, grouped by client, and each one's tasks. An entry's own project and task stay listed even if archived since. */
export function useChoices(entry?: Pick<TimeEntry, "projectId" | "taskId">) {
  const { data, clientById, taskById } = useData();
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

  /** The last project and task you used, if you still can, or else the first one. */
  const defaultPick = useCallback((): [number, number] => {
    const [p, t] = readLastPick();
    const all = projects.flatMap(([, l]) => l);
    const projectId = all.some((x) => x.id === p) ? p : (all[0]?.id ?? 0);
    const tasks = tasksFor(projectId);
    return [projectId, p === projectId && tasks.some((x) => x.id === t) ? t : (tasks[0]?.id ?? 0)];
  }, [projects, tasksFor]);

  return { projects, tasksFor, defaultPick };
}

/* Skipped suggestions are remembered per day, on this device. */

function readSkipped(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(SKIPPED) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function useSkipped(date: string) {
  const [all, setAll] = useState(readSkipped);
  const skip = useCallback(
    (key: string) =>
      setAll((prev) => {
        const next = { ...prev, [date]: [...(prev[date] ?? []), key] };
        // Only recent days matter; keep the last month or so.
        for (const d of Object.keys(next).sort().slice(0, -31)) delete next[d];
        try {
          localStorage.setItem(SKIPPED, JSON.stringify(next));
        } catch {
          // Skips only last for this visit then.
        }
        return next;
      }),
    [date],
  );
  return { skipped: useMemo(() => new Set(all[date] ?? []), [all, date]), skip };
}

/** Keys typed into a field, a menu or a dialog are theirs, not shortcuts. */
export function isShortcutTarget(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return false;
  const t = e.target as HTMLElement | null;
  if (t?.closest?.("input, textarea, select, [contenteditable=true], [role=combobox], [role=menu], [role=listbox], [role=dialog], [role=tablist]")) return false;
  // Enter and Tab on a focused button or link are that control's own.
  if ((e.key === "Enter" || e.key === "Tab" || e.key === " ") && t?.closest?.("button, a")) return false;
  return !document.querySelector("[role=dialog], [role=menu], [role=listbox]");
}

type Selected = { kind: "entry"; id: number } | { kind: "suggestion"; key: string };
type Mode = { kind: "view" } | { kind: "edit"; id: number; focus: "note" | "hours" } | { kind: "confirm"; id: number } | { kind: "new" };

export function DayBody({
  date,
  today,
  days,
  entries,
  history,
  onStep,
  onUpsert,
  onRemove,
  onFullForm,
}: {
  date: string;
  today: string;
  days: string[];
  entries: TimeEntry[] | null;
  /** The four weeks before this one, for suggestions. */
  history: TimeEntry[] | null;
  onStep: (days: number) => void;
  onUpsert: (e: TimeEntry) => void;
  onRemove: (id: number) => void;
  onFullForm: (entry: TimeEntry) => void;
}) {
  const run = useAction();
  const { data, projectById, clientById, taskById } = useData();
  const [selected, setSelected] = useState<Selected | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const { skipped, skip } = useSkipped(date);

  useEffect(() => {
    setSelected(null);
    setMode({ kind: "view" });
  }, [date]);

  const dayTotal = (d: string) => (entries ?? []).filter((e) => e.date === d).reduce((s, e) => s + e.minutes, 0);
  const list = useMemo(() => (entries ?? []).filter((e) => e.date === date).sort((a, b) => a.id - b.id), [entries, date]);
  const total = list.reduce((s, e) => s + e.minutes, 0);

  const canLog = useCallback(
    (projectId: number, taskId: number) => {
      const p = projectById.get(projectId);
      const c = p && clientById.get(p.clientId);
      const t = taskById.get(taskId);
      return !!(p && !p.archived && c && !c.archived && t && !t.archived && data.projectTasks.some((pt) => pt.projectId === projectId && pt.taskId === taskId));
    },
    [projectById, clientById, taskById, data.projectTasks],
  );
  // Suggestions only for days that have happened, once the history is in.
  const suggestions = useMemo(
    () => (entries && history && date <= today ? suggestionsFor(date, history, list, { skip: skipped, canLog }) : []),
    [entries, history, date, today, list, skipped, canLog],
  );

  // Everything the arrow keys move through, top to bottom.
  const order: Selected[] = useMemo(
    () => [...list.map((e) => ({ kind: "entry", id: e.id }) as const), ...suggestions.map((s) => ({ kind: "suggestion", key: s.key }) as const)],
    [list, suggestions],
  );
  const same = (a: Selected | null, b: Selected) => !!a && a.kind === b.kind && (a.kind === "entry" ? a.id === (b as { id: number }).id : a.key === (b as { key: string }).key);
  const isSelected = (s: Selected) => same(selected, s);

  // Once an action finishes, hand the keyboard back to the list.
  const focusList = () => requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-day-card]")?.focus({ preventScroll: true }));

  useEffect(() => {
    if (!selected) return;
    const id = selected.kind === "entry" ? `entry-${selected.id}` : `suggestion-${selected.key}`;
    document.getElementById(id)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const addSuggestion = useCallback(
    async (s: Suggestion) => {
      const created = await run(() => api.createEntry({ projectId: s.projectId, taskId: s.taskId, date, minutes: s.minutes, note: s.note }));
      if (created) {
        onUpsert(created);
        setSelected({ kind: "entry", id: created.id });
      }
    },
    [run, date, onUpsert],
  );

  const del = useCallback(
    async (id: number) => {
      const ok = await run(async () => {
        await api.deleteEntry(id);
        return true;
      });
      setMode({ kind: "view" });
      if (!ok) return;
      const i = order.findIndex((o) => o.kind === "entry" && o.id === id);
      const rest = order.filter((o) => !(o.kind === "entry" && o.id === id));
      setSelected(rest[Math.min(i, rest.length - 1)] ?? null);
      onRemove(id);
      focusList();
    },
    [run, order, onRemove],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (mode.kind === "confirm") {
        // The confirm row owns Enter and Esc wherever focus is.
        if (e.key === "Enter") {
          e.preventDefault();
          void del(mode.id);
        } else if (e.key === "Escape") {
          e.preventDefault();
          setMode({ kind: "view" });
          focusList();
        }
        return;
      }
      if (mode.kind !== "view" || !isShortcutTarget(e)) return;
      const at = selected ? order.findIndex((o) => same(selected, o)) : -1;
      const entry = selected?.kind === "entry" ? list.find((x) => x.id === selected.id) : undefined;
      const suggestion = selected?.kind === "suggestion" ? suggestions.find((x) => x.key === selected.key) : undefined;

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        onStep(e.key === "ArrowLeft" ? -1 : 1);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (order.length === 0) return;
        e.preventDefault();
        const next = at === -1 ? (e.key === "ArrowDown" ? 0 : order.length - 1) : Math.max(0, Math.min(order.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)));
        setSelected(order[next]);
      } else if ((e.key === "Tab" || e.key === "Enter") && entry && !e.shiftKey) {
        e.preventDefault();
        if (!entry.locked) setMode({ kind: "edit", id: entry.id, focus: "note" });
      } else if (e.key === "Enter" && suggestion) {
        e.preventDefault();
        void addSuggestion(suggestion);
      } else if ((e.key === "Delete" || e.key === "Backspace") && entry) {
        e.preventDefault();
        if (!entry.locked) setMode({ kind: "confirm", id: entry.id });
      } else if ((e.key === "Delete" || e.key === "Backspace") && suggestion) {
        e.preventDefault();
        setSelected(order[at + 1] ?? order[at - 1] ?? null);
        skip(suggestion.key);
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setMode({ kind: "new" });
      } else if (e.key === "Escape" && selected) {
        setSelected(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const weekday = dayLabel(date, { weekday: "long" });
  const busy = mode.kind !== "view";
  const empty = list.length === 0 && suggestions.length === 0 && mode.kind !== "new";

  return (
    <>
      <nav className="mt-5 grid grid-cols-7 gap-1" aria-label="Days this week">
        {days.map((d, i) => {
          const isCurrent = d === date;
          const isToday = d === today;
          return (
            <a
              key={d}
              href={`#/day/${d}`}
              aria-current={isCurrent ? "date" : undefined}
              className={cn("min-w-0 rounded-md px-1.5 py-2 text-sm transition-colors sm:px-3", isCurrent ? "bg-primary text-primary-foreground shadow-xs" : "hover:bg-accent")}
            >
              <span className={cn("flex items-center gap-1.5 font-semibold", !isCurrent && (isToday ? "text-now" : "text-muted-foreground"))}>
                {DAY_NAMES[i]}{" "}
                <span className="num hidden font-normal sm:inline">
                  {Number(d.slice(5, 7))}/{Number(d.slice(8, 10))}
                </span>
                {isToday && <span className={cn("size-1.5 rounded-full", isCurrent ? "bg-primary-foreground" : "bg-now")} aria-label="Today" />}
              </span>
              {/* Days with nothing tracked stay blank. */}
              <span className="num block min-h-5 text-xs whitespace-nowrap sm:text-sm">{entries ? formatHm(dayTotal(d)) : ""}</span>
            </a>
          );
        })}
      </nav>

      <Card className="mt-4 overflow-hidden outline-none" tabIndex={-1} data-day-card aria-label={`Entries for ${weekday}`}>
        {entries === null ? (
          <p className="px-5 py-14 text-center text-muted-foreground">Loading…</p>
        ) : empty ? (
          <div className="px-5 py-14 text-center">
            <p className="font-semibold">Nothing tracked on {weekday}</p>
            <p className="mt-1 text-sm text-muted-foreground">Add an entry for each meeting or block of work, with a note for each.</p>
            <Button className="mt-4" variant="outline" onClick={() => setMode({ kind: "new" })}>
              <PlusIcon />
              Add entry
              <Kbd>N</Kbd>
            </Button>
          </div>
        ) : (
          <>
            <ul className="divide-y" aria-label="Entries">
              {list.map((e) =>
                mode.kind === "edit" && mode.id === e.id ? (
                  <EditRow
                    key={e.id}
                    entry={e}
                    focus={mode.focus}
                    onDone={(saved) => {
                      if (saved) onUpsert(saved);
                      setMode({ kind: "view" });
                      setSelected({ kind: "entry", id: e.id });
                      focusList();
                    }}
                  />
                ) : mode.kind === "confirm" && mode.id === e.id ? (
                  <ConfirmDeleteRow key={e.id} entry={e} onDelete={() => void del(e.id)} onKeep={() => (setMode({ kind: "view" }), focusList())} />
                ) : (
                  <EntryLine
                    key={e.id}
                    entry={e}
                    selected={isSelected({ kind: "entry", id: e.id })}
                    onOpen={(focus) => {
                      if (busy) return;
                      setSelected({ kind: "entry", id: e.id });
                      if (!e.locked) setMode({ kind: "edit", id: e.id, focus });
                    }}
                    onFullForm={() => onFullForm(e)}
                    onDelete={() => {
                      setSelected({ kind: "entry", id: e.id });
                      setMode({ kind: "confirm", id: e.id });
                    }}
                  />
                ),
              )}
              {suggestions.length > 0 && (
                <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-y border-dashed bg-muted/50 px-5 py-2 text-sm">
                  <SparklesIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="font-semibold">Usually on {weekday}s</span>
                  <span className="text-muted-foreground">
                    {suggestions.length === 1 ? "1 suggestion" : `${suggestions.length} suggestions`}, not counted until you add {suggestions.length === 1 ? "it" : "them"}
                  </span>
                </li>
              )}
              {suggestions.map((s) => (
                <SuggestionLine
                  key={s.key}
                  suggestion={s}
                  why={whyLine(s, date)}
                  selected={isSelected({ kind: "suggestion", key: s.key })}
                  onAdd={() => void addSuggestion(s)}
                  onSkip={() => skip(s.key)}
                />
              ))}
              {mode.kind === "new" && (
                <NewRow
                  date={date}
                  onDone={(saved) => {
                    setMode({ kind: "view" });
                    if (saved) {
                      onUpsert(saved);
                      setSelected({ kind: "entry", id: saved.id });
                    }
                    focusList();
                  }}
                />
              )}
            </ul>
            <div className="flex items-center gap-4 border-t bg-muted/50 px-5 py-2.5">
              <Button variant="ghost" size="sm" className="-ml-3" onClick={() => setMode({ kind: "new" })} disabled={busy}>
                <PlusIcon />
                Add entry
                <Kbd>N</Kbd>
              </Button>
              <span className="ml-auto text-sm text-muted-foreground">Total</span>
              <span className="num min-w-16 text-right text-xl font-bold">{formatHm(total)}</span>
              <span className="w-8" />
            </div>
          </>
        )}
      </Card>

      <p className="mt-3 hidden flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground md:flex" aria-label="Keyboard shortcuts">
        <span>
          <Kbd>←</Kbd> <Kbd>→</Kbd> days
        </span>
        <span>
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> entries
        </span>
        <span>
          <Kbd>Tab</Kbd> edit
        </span>
        <span>
          <Kbd>Enter</Kbd> saves, or adds a suggestion
        </span>
        <span>
          <Kbd>Esc</Kbd> cancels
        </span>
        <span>
          <Kbd>Delete</Kbd> deletes, after a confirm, or skips a suggestion
        </span>
        <span>
          <Kbd>N</Kbd> new entry
        </span>
      </p>
    </>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn("num inline-flex h-5 min-w-5 items-center justify-center rounded border border-input bg-card px-1 font-sans text-[11px] leading-none font-semibold text-muted-foreground shadow-xs", className)}>{children}</kbd>;
}

function Names({ projectId, faded }: { projectId: number; faded?: boolean }) {
  const { projectById, clientById } = useData();
  const project = projectById.get(projectId);
  const client = project && clientById.get(project.clientId);
  return (
    <>
      <span className={cn("font-bold", faded && "text-muted-foreground")}>{project?.name ?? "Unknown project"}</span>
      <Badge variant="outline">{client?.name ?? "Unknown client"}</Badge>
    </>
  );
}

const rowFrame = (selected: boolean) => cn("relative scroll-my-16 px-5 py-4", selected && "bg-accent/60 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-now");

function EntryLine({
  entry,
  selected,
  onOpen,
  onFullForm,
  onDelete,
}: {
  entry: TimeEntry;
  selected: boolean;
  onOpen: (focus: "note" | "hours") => void;
  onFullForm: () => void;
  onDelete: () => void;
}) {
  const { taskById } = useData();
  return (
    <li id={`entry-${entry.id}`} className={cn(rowFrame(selected), "flex items-start gap-4", !entry.locked && "cursor-pointer hover:bg-accent/40")} onClick={(ev) => onOpen((ev.target as HTMLElement).closest("[data-hours]") ? "hours" : "note")}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Names projectId={entry.projectId} />
          {entry.locked && <Badge variant="success">Invoiced</Badge>}
        </div>
        <div className="mt-0.5 text-sm text-muted-foreground">{taskById.get(entry.taskId)?.name ?? "Unknown task"}</div>
        {entry.note && <p className="mt-1.5 whitespace-pre-line">{entry.note}</p>}
      </div>
      <div className="num min-w-16 text-right text-xl font-bold" data-hours>
        {formatHm(entry.minutes)}
      </div>
      {entry.locked ? (
        <span className="flex size-8 items-center justify-center text-muted-foreground" title="Invoiced, so it can't be changed">
          <LockIcon className="size-4" />
        </span>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More for this entry" onClick={(ev) => ev.stopPropagation()}>
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent onClick={(ev) => ev.stopPropagation()}>
            <DropdownMenuItem onSelect={onFullForm}>
              <PencilIcon />
              <span>
                <span className="block font-semibold">Edit all fields</span>
                <span className="block text-xs text-muted-foreground">To change the project or day</span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDelete}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

function SuggestionLine({ suggestion: s, why, selected, onAdd, onSkip }: { suggestion: Suggestion; why: string; selected: boolean; onAdd: () => void; onSkip: () => void }) {
  const { taskById } = useData();
  return (
    <li id={`suggestion-${s.key}`} className={cn(rowFrame(selected), "flex items-start gap-4 border-dashed")} aria-label={`Suggestion: ${why}`}>
      <div className="min-w-0 flex-1 opacity-75">
        <div className="flex flex-wrap items-center gap-2">
          <Names projectId={s.projectId} faded />
        </div>
        <div className="mt-0.5 text-sm text-muted-foreground">{taskById.get(s.taskId)?.name ?? "Unknown task"}</div>
        {s.note && <p className="mt-1.5 whitespace-pre-line text-muted-foreground">{s.note}</p>}
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex items-start gap-3">
          <div className="num pt-0.5 text-xl font-bold text-muted-foreground">{formatHm(s.minutes)}</div>
          <Button variant="outline" size="sm" onClick={onAdd}>
            <CheckIcon />
            Add
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Skip for today" title="Skip for today" onClick={onSkip}>
            <XIcon />
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">{why}</span>
      </div>
    </li>
  );
}

/** The Hours field: up and down nudge by 30 minutes; anything typed is kept exactly. */
function HoursInput({ value, onChange, invalid, autoFocus, id }: { value: string; onChange: (v: string) => void; invalid: boolean; autoFocus?: boolean; id: string }) {
  function onKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const now = parseDuration(value);
    if (now === null) return;
    onChange(formatHm(Math.min(MAX_MINUTES, Math.max(0, now + (e.key === "ArrowUp" ? NUDGE : -NUDGE)))) || "0h");
  }
  return (
    <Input
      id={id}
      inputMode="decimal"
      autoFocus={autoFocus}
      onFocus={(e) => e.target.select()}
      className="num h-10 text-right text-lg font-bold md:text-lg"
      placeholder="0h"
      value={value}
      aria-invalid={invalid}
      aria-describedby={`${id}-hint`}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKey}
    />
  );
}

function TaskSelect({ id, projectId, value, onChange, entry }: { id: string; projectId: number; value: number; onChange: (id: number) => void; entry?: TimeEntry }) {
  const { tasksFor } = useChoices(entry);
  return (
    <Select value={value ? String(value) : ""} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger id={id} className="h-10">
        <SelectValue placeholder="Choose a task" />
      </SelectTrigger>
      <SelectContent>
        {tasksFor(projectId).map((t) => (
          <SelectItem key={t.id} value={String(t.id)}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Enter saves from anywhere in the row, Esc puts it back. An open task list keeps its own keys. */
function rowKeys(save: () => void, cancel: () => void) {
  return (e: ReactKeyboardEvent) => {
    if ((e.target as HTMLElement).closest("[role=listbox]")) return;
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  };
}

function Field({ label, htmlFor, className, children }: { label: string; htmlFor: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-semibold text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function Hint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-2 flex flex-wrap items-center justify-end gap-1 text-right text-xs text-muted-foreground">
      {children}
    </p>
  );
}

const editFrame = "relative bg-now-wash/60 px-5 py-4 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-now";

function EditRow({ entry, focus, onDone }: { entry: TimeEntry; focus: "note" | "hours"; onDone: (saved: TimeEntry | null) => void }) {
  const run = useAction();
  const [taskId, setTaskId] = useState(entry.taskId);
  const [note, setNote] = useState(entry.note ?? "");
  const [hours, setHours] = useState(formatHm(entry.minutes));
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  async function save() {
    if (saving.current) return;
    const minutes = parseDuration(hours);
    if (minutes === null || minutes > MAX_MINUTES) return setError("Enter the time like 1h 30m, 1:30 or 1.5.");
    const body = { taskId, minutes, note: note.trim() || null };
    if (body.taskId === entry.taskId && body.minutes === entry.minutes && body.note === entry.note) return onDone(null);
    saving.current = true;
    const saved = await run(() => api.updateEntry(entry.id, body));
    saving.current = false;
    if (saved) {
      rememberPick(saved.projectId, saved.taskId);
      onDone(saved);
    }
  }

  const id = `edit-${entry.id}`;
  return (
    <li id={`entry-${entry.id}`} className={editFrame} onKeyDownCapture={rowKeys(() => void save(), () => onDone(null))}>
      <div className="flex flex-wrap items-center gap-2">
        <Names projectId={entry.projectId} />
        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          Editing. <Kbd>Enter</Kbd> saves, <Kbd>Esc</Kbd> cancels
        </span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(10rem,14rem)_1fr_9rem]">
        <Field label="Task" htmlFor={`${id}-task`}>
          <TaskSelect id={`${id}-task`} projectId={entry.projectId} value={taskId} onChange={setTaskId} entry={entry} />
        </Field>
        <Field label="Description" htmlFor={`${id}-note`}>
          <Input id={`${id}-note`} className="h-10" autoFocus={focus === "note"} placeholder="What was this time for?" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label="Hours" htmlFor={`${id}-hours`}>
          <HoursInput id={`${id}-hours`} value={hours} onChange={setHours} invalid={!!error} autoFocus={focus === "hours"} />
        </Field>
      </div>
      <Hint id={`${id}-hours-hint`}>
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : (
          <>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> in Hours add or take off 30 minutes. Typed times are kept exactly.
          </>
        )}
      </Hint>
    </li>
  );
}

function NewRow({ date, onDone }: { date: string; onDone: (saved: TimeEntry | null) => void }) {
  const run = useAction();
  const { projects, tasksFor, defaultPick } = useChoices();
  const [[projectId, taskId], setPick] = useState(defaultPick);
  const [note, setNote] = useState("");
  const [hours, setHours] = useState("");
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  function pickProject(id: number) {
    const tasks = tasksFor(id);
    setPick([id, tasks.some((t) => t.id === taskId) ? taskId : (tasks[0]?.id ?? 0)]);
  }

  async function save() {
    if (saving.current) return;
    if (!projectId || !taskId) return setError("Choose a project and task.");
    const minutes = parseDuration(hours);
    if (minutes === null || minutes > MAX_MINUTES) return setError("Enter the time like 1h 30m, 1:30 or 1.5.");
    if (minutes === 0) return setError("Enter how long it took.");
    saving.current = true;
    const saved = await run(() => api.createEntry({ projectId, taskId, date, minutes, note: note.trim() || null }));
    saving.current = false;
    if (saved) {
      rememberPick(projectId, taskId);
      onDone(saved);
    }
  }

  const id = `new-${date}`;
  return (
    <li className={editFrame} onKeyDownCapture={rowKeys(() => void save(), () => onDone(null))}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-now">New entry</span>
        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          <Kbd>Enter</Kbd> saves, <Kbd>Esc</Kbd> cancels
        </span>
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(12rem,16rem)_minmax(10rem,13rem)_1fr_9rem]">
        <Field label="Project" htmlFor={`${id}-project`}>
          <Select value={projectId ? String(projectId) : ""} onValueChange={(v) => pickProject(Number(v))}>
            <SelectTrigger id={`${id}-project`} className="h-10" autoFocus>
              <SelectValue placeholder="Choose a project">
                {(() => {
                  const hit = projects.flatMap(([client, list]) => list.map((p) => [client, p] as const)).find(([, p]) => p.id === projectId);
                  return hit ? (
                    <span className="truncate">
                      <span className="text-muted-foreground">{hit[0]} / </span>
                      {hit[1].name}
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
        </Field>
        <Field label="Task" htmlFor={`${id}-task`}>
          <TaskSelect id={`${id}-task`} projectId={projectId} value={taskId} onChange={(t) => setPick([projectId, t])} />
        </Field>
        <Field label="Description" htmlFor={`${id}-note`}>
          <Input id={`${id}-note`} className="h-10" placeholder="What was this time for?" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label="Hours" htmlFor={`${id}-hours`}>
          <HoursInput id={`${id}-hours`} value={hours} onChange={setHours} invalid={!!error} />
        </Field>
      </div>
      {error && (
        <Hint id={`${id}-hours-hint`}>
          <span className="text-destructive">{error}</span>
        </Hint>
      )}
    </li>
  );
}

function ConfirmDeleteRow({ entry, onDelete, onKeep }: { entry: TimeEntry; onDelete: () => void; onKeep: () => void }) {
  const { projectById } = useData();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <li
      id={`entry-${entry.id}`}
      role="alert"
      className="relative flex flex-wrap items-center gap-x-3 gap-y-2 bg-destructive/8 px-5 py-4 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-destructive"
    >
      <span className="font-bold">
        Delete {projectById.get(entry.projectId)?.name ?? "this entry"}, <span className="num">{formatHm(entry.minutes) || "0h"}</span>?
      </span>
      {entry.note && <span className="min-w-0 truncate text-sm text-muted-foreground">{entry.note}</span>}
      <span className="ml-auto flex items-center gap-2">
        <Button ref={ref} variant="destructive" size="sm" onClick={onDelete}>
          <Trash2Icon />
          Delete
          <Kbd className="border-transparent bg-destructive-foreground/90 text-destructive">Enter</Kbd>
        </Button>
        <Button variant="ghost" size="sm" onClick={onKeep}>
          Keep it
          <Kbd>Esc</Kbd>
        </Button>
      </span>
    </li>
  );
}
