import type { TimeEntry } from "../shared/types";
import { addDays } from "../shared/time";

/** Look back this many of the same weekday. */
export const LOOKBACK_WEEKS = 4;
/** A repeat must show up on at least this many of them. */
export const MIN_STREAK = 3;
/** Never more than this many suggestions on one day. */
export const MAX_PER_DAY = 2;

export interface Suggestion {
  /** Stable for the same project, task and note, so a skip can be remembered. */
  key: string;
  projectId: number;
  taskId: number;
  note: string | null;
  /** Your usual time for it on this weekday. */
  minutes: number;
  /** How many of the last LOOKBACK_WEEKS same weekdays had it. */
  hits: number;
}

const normalize = (note: string | null) => (note ?? "").trim().replace(/\s+/g, " ").toLowerCase();
export const suggestionKey = (e: Pick<TimeEntry, "projectId" | "taskId" | "note">) => `${e.projectId}:${e.taskId}:${normalize(e.note)}`;

/**
 * Simple repeats for `date`: the same project, task and note on at least MIN_STREAK of the last
 * LOOKBACK_WEEKS same weekdays, prefilled with the usual time. Anything already tracked that day,
 * skipped, or no longer loggable is left out. At most MAX_PER_DAY, strongest streak first.
 */
export function suggestionsFor(
  date: string,
  history: TimeEntry[],
  dayEntries: TimeEntry[],
  { skip = new Set<string>(), canLog = () => true }: { skip?: Set<string>; canLog?: (projectId: number, taskId: number) => boolean } = {},
): Suggestion[] {
  const found = new Map<string, { first: TimeEntry; perDay: number[]; lastSeen: number }>();
  for (let w = 1; w <= LOOKBACK_WEEKS; w++) {
    const day = addDays(date, -7 * w);
    const totals = new Map<string, { entry: TimeEntry; minutes: number }>();
    for (const e of history) {
      if (e.date !== day) continue;
      const k = suggestionKey(e);
      const t = totals.get(k);
      totals.set(k, { entry: t?.entry ?? e, minutes: (t?.minutes ?? 0) + e.minutes });
    }
    for (const [k, { entry, minutes }] of totals) {
      const f = found.get(k);
      if (f) f.perDay.push(minutes);
      // The most recent week is seen first, so its wording is the one shown.
      else found.set(k, { first: entry, perDay: [minutes], lastSeen: w });
    }
  }

  const tracked = new Set(dayEntries.map(suggestionKey));
  const out: Suggestion[] = [];
  for (const [key, { first, perDay }] of found) {
    if (perDay.length < MIN_STREAK || tracked.has(key) || skip.has(key) || !canLog(first.projectId, first.taskId)) continue;
    const sorted = [...perDay].sort((a, b) => a - b);
    out.push({
      key,
      projectId: first.projectId,
      taskId: first.taskId,
      note: first.note,
      minutes: sorted[Math.floor((sorted.length - 1) / 2)],
      hits: perDay.length,
    });
  }
  return out
    .sort((a, b) => b.hits - a.hits || (found.get(a.key)!.lastSeen - found.get(b.key)!.lastSeen) || b.minutes - a.minutes || a.key.localeCompare(b.key))
    .slice(0, MAX_PER_DAY);
}

/** "4 of your last 4 Fridays" */
export function whyLine(s: Suggestion, date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long" });
  return `${s.hits} of your last ${LOOKBACK_WEEKS} ${weekday}s`;
}
