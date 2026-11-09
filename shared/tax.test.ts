import { describe, expect, it } from "vitest";
import { dueDates, estimateTax, figuresFor, TAX_FIGURES } from "./tax";
import { CUSTOM_STATE, STATE_LIST, STATES, stateFor } from "./states";

const f = TAX_FIGURES[2026];
const MA = STATES.MA.years[2026];
const single = (profitCents: number, extra = {}) => estimateTax({ filingStatus: "single", profitCents, w2WagesCents: 0, otherIncomeCents: 0, ...extra }, f, MA);

describe("2026 tax estimate", () => {
  it("matches a hand calculation for $140,000 of profit, single", () => {
    const r = single(140_000_00);
    // 140,000 x 92.35% = 129,290; x 15.3% = 19,781.37
    expect(r.selfEmploymentTaxCents).toBe(19_781_37);
    // AGI 130,109.32 less the 16,100 standard deduction = 114,009.32. QBI is capped at 20% of that: 22,801.86.
    expect(r.qbiDeductionCents).toBe(22_801_86);
    expect(r.federalTaxableIncomeCents).toBe(91_207_45);
    // 1,240 + 4,560 + 22% of 40,807.45
    expect(r.federalIncomeTaxCents).toBe(14_777_64);
    expect(r.federalTotalCents).toBe(19_781_37 + 14_777_64);
    expect(r.additionalMedicareCents).toBe(0);
    // MA: 140,000 less 2,000 of SE tax and the 4,400 exemption, at 5%
    expect(r.stateTaxableIncomeCents).toBe(133_600_00);
    expect(r.stateTotalCents).toBe(6_680_00);
  });

  it("deducts health insurance premiums from income tax, not self-employment tax", () => {
    const r = single(140_000_00, { healthInsuranceCents: 7_000_00 });
    expect(r.selfEmploymentTaxCents).toBe(19_781_37);
    expect(r.healthInsuranceDeductionCents).toBe(7_000_00);
    // AGI 123,109.32 less 16,100 = 107,009.32; QBI capped at 20% of that, 21,401.86.
    expect(r.qbiDeductionCents).toBe(21_401_86);
    expect(r.federalTaxableIncomeCents).toBe(85_607_45);
    // 1,240 + 4,560 + 22% of 35,207.45
    expect(r.federalIncomeTaxCents).toBe(13_545_64);
    // MA: 140,000 less 7,000 of premiums, 2,000 of SE tax and the 4,400 exemption, at 5%
    expect(r.stateTotalCents).toBe(6_330_00);
    // Never more than the profit.
    expect(single(10_000_00, { healthInsuranceCents: 50_000_00 }).healthInsuranceDeductionCents).toBe(10_000_00 - Math.round((10_000_00 * 0.9235 * 0.153) / 2));
  });

  it("stops Social Security at the wage base and adds the extra Medicare tax", () => {
    const r = single(300_000_00);
    // 277,050 of earnings: 12.4% of 184,500 plus 2.9% of all of it
    expect(r.selfEmploymentTaxCents).toBe(Math.round(184_500_00 * 0.124 + 277_050_00 * 0.029));
    expect(r.additionalMedicareCents).toBe(Math.round((277_050_00 - 200_000_00) * 0.009));
    // Inside the QBI phase-in range ($201,750 to $276,750 of taxable income): a partial deduction.
    expect(r.qbiDeductionCents).toBeGreaterThan(0);
    expect(r.qbiDeductionCents).toBeLessThan(10_000_00);
    // Past it: none.
    expect(single(400_000_00).qbiDeductionCents).toBe(0);
  });

  it("lets W-2 wages use up the Social Security wage base first", () => {
    const r = single(50_000_00, { w2WagesCents: 184_500_00 });
    expect(r.selfEmploymentTaxCents).toBe(Math.round(50_000_00 * 0.9235 * 0.029));
  });

  it("owes nothing on a loss or tiny profit", () => {
    expect(single(-5_000_00).federalTotalCents).toBe(0);
    expect(single(300_00).selfEmploymentTaxCents).toBe(0);
  });

  it("uses the joint brackets and deduction", () => {
    const r = estimateTax({ filingStatus: "joint", profitCents: 140_000_00, w2WagesCents: 0, otherIncomeCents: 0 }, f, MA);
    expect(r.federalIncomeTaxCents).toBeLessThan(single(140_000_00).federalIncomeTaxCents);
    expect(r.stateTaxableIncomeCents).toBe(140_000_00 - 2_000_00 - 8_800_00);
  });

  it("falls back to the latest figures for a year not yet published", () => {
    expect(figuresFor(2028).figuresYear).toBe(2027);
    expect(figuresFor(2027).figuresYear).toBe(2027);
    expect(figuresFor(2026).figuresYear).toBe(2026);
  });

  it("uses the 2027 brackets and wage base", () => {
    const r = estimateTax({ filingStatus: "single", profitCents: 140_000_00, w2WagesCents: 0, otherIncomeCents: 0 }, TAX_FIGURES[2027]);
    // Same self-employment tax (under both wage bases), lower income tax from the wider brackets.
    expect(r.selfEmploymentTaxCents).toBe(19_781_37);
    expect(r.federalIncomeTaxCents).toBeLessThan(14_777_64);
    expect(TAX_FIGURES[2027].pending).toContain("the QBI deduction threshold");
  });

  it("puts due dates on weekdays", () => {
    expect(dueDates(2026)).toEqual(["2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"]);
    // Jan 15, 2028 is a Saturday.
    expect(dueDates(2027)[3]).toBe("2028-01-17");
  });
});

describe("state tax", () => {
  // $100,000 of profit, single: AGI is 100,000 less half the self-employment tax, 92,935.23.
  const at = (code: string, extra = {}, custom?: { rateBps: number; deductionCents: number }) =>
    estimateTax({ filingStatus: "single", profitCents: 100_000_00, w2WagesCents: 0, otherIncomeCents: 0, ...extra }, f, stateFor(code, 2026, custom).figures);

  it("charges nothing where there's no income tax", () => {
    expect(at("TX")).toMatchObject({ stateIncomeTaxCents: 0, stateTotalCents: 0 });
    expect(at("WA").stateTotalCents).toBe(0);
    expect(at("").stateTotalCents).toBe(0);
  });

  it("works a flat rate with an exemption (Illinois 4.95%, $2,925)", () => {
    expect(at("IL").stateIncomeTaxCents).toBe(4_455_51);
  });

  it("leaves income below a first bracket untaxed (Idaho 5.3% over $4,811 after the deduction)", () => {
    expect(at("ID").stateIncomeTaxCents).toBe(3_817_28);
  });

  it("works graduated brackets and an exemption credit (California)", () => {
    expect(at("CA").stateIncomeTaxCents).toBe(4_413_39);
  });

  it("takes your own rate and deduction for somewhere else", () => {
    expect(at(CUSTOM_STATE, {}, { rateBps: 500, deductionCents: 10_000_00 }).stateIncomeTaxCents).toBe(4_146_76);
  });

  it("adds a city or county rate on adjusted gross income", () => {
    expect(at("TX", { localRate: 0.03 })).toMatchObject({ stateIncomeTaxCents: 0, localTaxCents: 2_788_06, stateTotalCents: 2_788_06 });
  });

  it("uses the latest earlier year until a state's new figures are added", () => {
    expect(stateFor("CA", 2027).figuresYear).toBe(2026);
    expect(stateFor("TX", 2027).figuresYear).toBeNull();
  });

  it("covers all 50 states and DC, each with figures or marked as having no income tax", () => {
    expect(STATE_LIST).toHaveLength(51);
    for (const s of STATE_LIST) {
      const info = STATES[s.code];
      if (info.noIncomeTax) continue;
      const year = info.years[2026];
      expect(year, s.name).toBeDefined();
      for (const status of ["single", "joint"] as const) {
        const b = year.brackets[status];
        expect(b.length, `${s.name} ${status}`).toBeGreaterThan(0);
        // Brackets climb, and rates are fractions, not percents.
        for (let i = 0; i < b.length; i++) {
          expect(b[i][1], `${s.name} rate`).toBeLessThan(0.2);
          if (i > 0) expect(b[i][0], `${s.name} bracket order`).toBeGreaterThan(b[i - 1][0]);
        }
      }
    }
  });
});
