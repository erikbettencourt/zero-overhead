import { describe, expect, it } from "vitest";
import { lastBillingPeriod, modeOf, rangeFor, rangeLabel, shiftBilling, shiftRange } from "./periods";

describe("billing periods", () => {
  // Saturday, Nov 7 2026. The week started Monday, Nov 2.
  const today = "2026-11-07";

  it("defaults to the last finished period", () => {
    expect(lastBillingPeriod("monthly", today)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(lastBillingPeriod("quarterly", today)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(lastBillingPeriod("biweekly", today)).toEqual({ from: "2026-10-19", to: "2026-11-01" });
  });

  it("steps periods across year ends", () => {
    expect(shiftRange({ from: "2026-12-01", to: "2026-12-31" }, 1)).toEqual({ from: "2027-01-01", to: "2027-01-31" });
    expect(shiftRange({ from: "2026-01-01", to: "2026-03-31" }, -1)).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(shiftBilling("biweekly", { from: "2026-12-21", to: "2027-01-03" }, 1)).toEqual({ from: "2027-01-04", to: "2027-01-17" });
  });

  it("recognizes and names ranges", () => {
    expect(modeOf({ from: "2026-02-01", to: "2026-02-28" })).toBe("month");
    expect(modeOf({ from: "2026-04-01", to: "2026-06-30" })).toBe("quarter");
    expect(modeOf({ from: "2026-01-01", to: "2026-12-31" })).toBe("year");
    expect(modeOf({ from: "2026-10-19", to: "2026-11-01" })).toBe("custom");
    expect(rangeLabel({ from: "2026-10-01", to: "2026-10-31" })).toBe("October 2026");
    expect(rangeLabel({ from: "2026-07-01", to: "2026-09-30" })).toBe("Q3 2026");
    expect(rangeLabel({ from: "2026-10-19", to: "2026-11-01" })).toBe("Oct 19 to Nov 1, 2026");
    // A custom range moves by its own length.
    expect(shiftRange({ from: "2026-10-19", to: "2026-11-01" }, 1)).toEqual({ from: "2026-11-02", to: "2026-11-15" });
  });
});

describe("weeks", () => {
  it("runs Monday to Sunday, steps a week at a time, and reads as the week's Monday", () => {
    const w = rangeFor("week", "2026-11-11");
    expect(w).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(modeOf(w)).toBe("week");
    expect(shiftRange(w, -1)).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(shiftRange({ from: "2026-12-28", to: "2027-01-03" }, 1)).toEqual({ from: "2027-01-04", to: "2027-01-10" });
    expect(rangeLabel(w)).toBe("Week of Nov 9, 2026");
  });
});
