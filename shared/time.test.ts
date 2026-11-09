import { describe, expect, it } from "vitest";
import {
  addDays,
  billableHundredths,
  formatHours,
  lineAmountCents,
  monthRange,
  nextInvoiceNumber,
  formatDuration,
  isIsoDate,
  parseDuration,
  parseMoney,
  resolveRateCents,
  startOfWeek,
} from "./time";

describe("parseDuration", () => {
  it.each([
    ["", 0],
    ["1.5", 90],
    [".25", 15],
    ["2", 120],
    ["1:30", 90],
    ["0:05", 5],
    ["90m", 90],
    ["2h", 120],
    ["1h 15m", 75],
    ["1.5h", 90],
  ])("%s -> %i minutes", (input, minutes) => {
    expect(parseDuration(input)).toBe(minutes);
  });

  it.each(["abc", "1:75", "-1", "1..5"])("rejects %s", (input) => {
    expect(parseDuration(input)).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formats hours and minutes", () => {
    expect(formatDuration(90)).toBe("1:30");
    expect(formatDuration(5)).toBe("0:05");
  });
  it("leaves zero blank unless asked", () => {
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(0, { blankZero: false })).toBe("0:00");
  });
});

describe("parseMoney", () => {
  it("parses dollars into cents", () => {
    expect(parseMoney("150")).toBe(15000);
    expect(parseMoney("$1,250.50")).toBe(125050);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("12.345")).toBeUndefined();
  });
});

describe("resolveRateCents", () => {
  it("prefers the most specific rate", () => {
    expect(resolveRateCents(15000, 10000)).toBe(15000);
    expect(resolveRateCents(null, 10000)).toBe(10000);
    expect(resolveRateCents(null, null)).toBeNull();
  });
});

describe("dates", () => {
  it("validates real calendar dates", () => {
    expect(isIsoDate("2026-11-04")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("11/04/2026")).toBe(false);
  });
  it("finds the Monday of the week", () => {
    expect(startOfWeek("2026-11-04")).toBe("2026-11-02");
    expect(startOfWeek("2026-11-08")).toBe("2026-11-02");
    expect(startOfWeek("2026-11-02")).toBe("2026-11-02");
  });
  it("adds days across month ends", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  });
});

describe("invoice math", () => {
  it("rounds hours to two decimals before applying the rate", () => {
    expect(billableHundredths(20)).toBe(33); // 0.333 h -> 0.33
    expect(lineAmountCents(20, 15000)).toBe(4950); // 0.33 x $150 = $49.50
    expect(lineAmountCents(90, 15000)).toBe(22500);
    expect(formatHours(450)).toBe("7.50");
  });
  it("increments invoice numbers, keeping prefixes and padding", () => {
    expect(nextInvoiceNumber("1042")).toBe("1043");
    expect(nextInvoiceNumber("EB-0099")).toBe("EB-0100");
    expect(nextInvoiceNumber("INV")).toBe("INV-2");
  });
  it("finds a month's first and last day", () => {
    expect(monthRange("2026-11-04")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(monthRange("2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});
