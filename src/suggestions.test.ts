import { describe, expect, it } from "vitest";
import type { TimeEntry } from "../shared/types";
import { addDays } from "../shared/time";
import { suggestionKey, suggestionsFor, whyLine } from "./suggestions";

const FRIDAY = "2026-11-20";
let id = 1;
const entry = (weeksAgo: number, projectId: number, taskId: number, minutes: number, note: string | null = null): TimeEntry => ({
  id: id++,
  projectId,
  taskId,
  date: addDays(FRIDAY, -7 * weeksAgo),
  minutes,
  note,
  locked: false,
});

describe("suggestionsFor", () => {
  it("suggests a repeat on 3 or more of the last 4 same weekdays, with the usual time", () => {
    const history = [entry(1, 1, 1, 30, "Weekly check-in"), entry(2, 1, 1, 30, "Weekly check-in"), entry(3, 1, 1, 45, "weekly check-in"), entry(4, 1, 1, 30, "Weekly check-in")];
    const [s, ...rest] = suggestionsFor(FRIDAY, history, []);
    expect(rest).toHaveLength(0);
    expect(s).toMatchObject({ projectId: 1, taskId: 1, note: "Weekly check-in", minutes: 30, hits: 4 });
    expect(whyLine(s, FRIDAY)).toBe("4 of your last 4 Fridays");
  });

  it("needs a streak of at least 3", () => {
    const history = [entry(1, 1, 1, 60), entry(3, 1, 1, 60)];
    expect(suggestionsFor(FRIDAY, history, [])).toEqual([]);
  });

  it("ignores other weekdays and anything older than 4 weeks", () => {
    const thursday = { ...entry(1, 1, 1, 60), date: addDays(FRIDAY, -8) };
    const history = [thursday, { ...thursday, id: 99, date: addDays(FRIDAY, -15) }, entry(2, 1, 1, 60), entry(5, 1, 1, 60), entry(6, 1, 1, 60)];
    expect(suggestionsFor(FRIDAY, history, [])).toEqual([]);
  });

  it("adds up several entries of the same thing on one day", () => {
    const history = [1, 2, 3].flatMap((w) => [entry(w, 2, 2, 60, "Build"), entry(w, 2, 2, 30, "Build")]);
    expect(suggestionsFor(FRIDAY, history, [])[0].minutes).toBe(90);
  });

  it("leaves out what's already tracked, skipped, or can't be logged", () => {
    const history = [1, 2, 3].flatMap((w) => [entry(w, 1, 1, 30, "A"), entry(w, 2, 2, 30, "B"), entry(w, 3, 3, 30, "C")]);
    const today = [{ ...entry(0, 1, 1, 15, "a "), id: 500 }];
    const skip = new Set([suggestionKey({ projectId: 2, taskId: 2, note: "B" })]);
    expect(suggestionsFor(FRIDAY, history, today, { skip, canLog: (p) => p !== 3 })).toEqual([]);
  });

  it("shows two at most, strongest streak first", () => {
    const history = [
      ...[1, 2, 3].map((w) => entry(w, 1, 1, 30, "Three")),
      ...[1, 2, 3, 4].map((w) => entry(w, 2, 1, 60, "Four")),
      ...[1, 2, 3].map((w) => entry(w, 3, 1, 120, "Three again")),
    ];
    expect(suggestionsFor(FRIDAY, history, []).map((s) => s.note)).toEqual(["Four", "Three again"]);
  });
});
