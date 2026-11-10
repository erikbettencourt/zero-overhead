import { describe, expect, it } from "vitest";
import type { TaxQuarter } from "../shared/types";
import { quarterAmounts, shortLabel } from "./taxQuarters";

const quarter = (n: 1 | 2 | 3 | 4, fed: [number, number], st: [number, number], status: TaxQuarter["status"]): TaxQuarter => ({
  quarter: n,
  dueOn: "2026-01-15",
  federal: { estimateCents: fed[0], paidCents: fed[1] },
  state: { estimateCents: st[0], paidCents: st[1] },
  status,
});

describe("quarterAmounts", () => {
  it("shows what to pay on the next payment, with the share beside it when they differ", () => {
    const q4 = quarter(4, [1000_00, 0], [200_00, 0], "due");
    const next = { quarter: 4 as const, dueOn: "2027-01-15", federalCents: 800_00, stateCents: 200_00, catchUpCents: 0 };
    expect(quarterAmounts({ next }, q4)).toEqual({ federalCents: 800_00, stateCents: 200_00, federalShareCents: 1000_00, stateShareCents: null });
  });

  it("shows the even share on every other quarter", () => {
    const q1 = quarter(1, [1000_00, 900_00], [200_00, 200_00], "past due");
    const next = { quarter: 4 as const, dueOn: "2027-01-15", federalCents: 800_00, stateCents: 200_00, catchUpCents: 0 };
    expect(quarterAmounts({ next }, q1)).toEqual({ federalCents: 1000_00, stateCents: 200_00, federalShareCents: null, stateShareCents: null });
    expect(quarterAmounts({ next: null }, q1).federalCents).toBe(1000_00);
  });
});

describe("shortLabel", () => {
  const ma = { code: "MA", chosen: true };
  it("names the one that was short", () => {
    expect(shortLabel(quarter(2, [1000_00, 1500_00], [200_00, 150_00], "past due"), ma)).toBe("MA short");
    expect(shortLabel(quarter(1, [1000_00, 900_00], [200_00, 200_00], "past due"), ma)).toBe("Federal short");
    expect(shortLabel(quarter(2, [1000_00, 1500_00], [200_00, 150_00], "past due"), { code: "custom", chosen: true })).toBe("State short");
  });

  it("says Short when both were", () => {
    expect(shortLabel(quarter(1, [1000_00, 900_00], [200_00, 150_00], "past due"), ma)).toBe("Short");
  });
});
