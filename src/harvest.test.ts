import { describe, expect, it } from "vitest";
import { parseCsv, parseHarvest, withKeys } from "./harvest";

const SAMPLE = [
  "Date,Client,Project,Project Code,Task,Notes,Hours,Hours Rounded,Billable?,Invoiced?,Billable Rate",
  '2026-10-02,Acme Co,Prototypes,,Frontend development,"Build, then test",1.5,1.5,Yes,No,160',
  '10/01/2026,Acme Co,Prototypes,,Frontend development,"She said ""ship it""",2,2,Yes,Yes,$150.00',
  ",Acme Co,Prototypes,,Frontend development,,1,1,Yes,No,150",
].join("\r\n");

describe("parseCsv", () => {
  it("handles quotes, commas and escaped quotes", () => {
    expect(parseCsv('a,"b, c","d ""e"""\n1,2,3')).toEqual([
      ["a", "b, c", 'd "e"'],
      ["1", "2", "3"],
    ]);
  });
});

describe("parseHarvest", () => {
  it("reads a Harvest export, sorts oldest first and reports bad lines", () => {
    const { rows, problems } = parseHarvest(SAMPLE);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: "2026-10-01", minutes: 120, invoiced: true, billableRateCents: 15000, notes: 'She said "ship it"' });
    expect(rows[1]).toMatchObject({ date: "2026-10-02", minutes: 90, invoiced: false, billableRateCents: 16000, notes: "Build, then test" });
    expect(problems).toEqual(["Line 4 was skipped: it's missing a date, client, project, task or hours."]);
  });

  it("rejects files that aren't Harvest exports", () => {
    expect(parseHarvest("Name,Amount\nx,1").problems[0]).toMatch(/Missing columns/);
  });
});

describe("withKeys", () => {
  it("gives identical rows different keys, and the same keys on a re-run", async () => {
    const { rows } = parseHarvest(SAMPLE);
    const dup = [rows[0], { ...rows[0] }];
    const a = await withKeys(dup);
    const b = await withKeys(dup);
    expect(a[0].key).not.toBe(a[1].key);
    expect(a.map((r) => r.key)).toEqual(b.map((r) => r.key));
  });
});
