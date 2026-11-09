import type { FilingStatus } from "./types";
import type { StateTaxYear } from "./states";

/**
 * Federal figures by tax year. Everything is in cents. State figures are in states.ts.
 *
 * 2026 sources:
 * - Brackets and standard deduction: IRS, "IRS releases tax inflation adjustments for tax year 2026"
 *   (Rev. Proc. 2025-32).
 * - Social Security wage base $184,500: SSA, October 2025.
 * - QBI threshold and the wider phase-in ranges: section 199A as amended in 2025.
 * 2027 sources:
 * - Brackets and standard deduction: IRS, "IRS releases tax inflation adjustments for tax year 2027", November 2026.
 * - Social Security wage base $192,300: SSA, October 14, 2026.
 * - Not yet published when added: the 2027 QBI threshold. It carries over from 2026 and is
 *   listed in `pending` until updated.
 * Add a year here when the IRS publishes its figures, usually in October or November.
 */
export interface TaxFigures {
  /** Figures carried over from the year before because the new ones weren't published yet. */
  pending?: string[];
  brackets: Record<FilingStatus, [fromCents: number, rate: number][]>;
  standardDeduction: Record<FilingStatus, number>;
  socialSecurityWageBase: number;
  additionalMedicareThreshold: Record<FilingStatus, number>;
  qbiThreshold: Record<FilingStatus, number>;
  qbiPhaseIn: Record<FilingStatus, number>;
}

const $ = (dollars: number) => Math.round(dollars * 100);

export const TAX_FIGURES: Record<number, TaxFigures> = {
  2026: {
    brackets: {
      single: [
        [0, 0.1],
        [$(12_400), 0.12],
        [$(50_400), 0.22],
        [$(105_700), 0.24],
        [$(201_775), 0.32],
        [$(256_225), 0.35],
        [$(640_600), 0.37],
      ],
      joint: [
        [0, 0.1],
        [$(24_800), 0.12],
        [$(100_800), 0.22],
        [$(211_400), 0.24],
        [$(403_550), 0.32],
        [$(512_450), 0.35],
        [$(768_700), 0.37],
      ],
    },
    standardDeduction: { single: $(16_100), joint: $(32_200) },
    socialSecurityWageBase: $(184_500),
    additionalMedicareThreshold: { single: $(200_000), joint: $(250_000) },
    qbiThreshold: { single: $(201_750), joint: $(403_500) },
    qbiPhaseIn: { single: $(75_000), joint: $(150_000) },
  },
  2027: {
    pending: ["the QBI deduction threshold"],
    brackets: {
      single: [
        [0, 0.1],
        [$(12_800), 0.12],
        [$(52_025), 0.22],
        [$(109_125), 0.24],
        [$(208_325), 0.32],
        [$(264_550), 0.35],
        [$(661_375), 0.37],
      ],
      joint: [
        [0, 0.1],
        [$(25_600), 0.12],
        [$(104_050), 0.22],
        [$(218_250), 0.24],
        [$(416_650), 0.32],
        [$(529_100), 0.35],
        [$(793_650), 0.37],
      ],
    },
    standardDeduction: { single: $(16_600), joint: $(33_200) },
    socialSecurityWageBase: $(192_300),
    additionalMedicareThreshold: { single: $(200_000), joint: $(250_000) },
    // 2026 values until the IRS publishes 2027's.
    qbiThreshold: { single: $(201_750), joint: $(403_500) },
    qbiPhaseIn: { single: $(75_000), joint: $(150_000) },
  },
};

/** The figures for a year, or the latest year we have, while a new year's are pending. */
export function figuresFor(year: number): { figuresYear: number; figures: TaxFigures } {
  const years = Object.keys(TAX_FIGURES).map(Number).sort();
  const figuresYear = years.filter((y) => y <= year).at(-1) ?? years[0];
  return { figuresYear, figures: TAX_FIGURES[figuresYear] };
}

function bracketTax(taxable: number, brackets: [number, number][]): number {
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const [from, rate] = brackets[i];
    const to = brackets[i + 1]?.[0] ?? Infinity;
    if (taxable <= from) break;
    tax += (Math.min(taxable, to) - from) * rate;
  }
  return tax;
}

export interface TaxInput {
  filingStatus: FilingStatus;
  /** Net self-employment profit for the year. */
  profitCents: number;
  w2WagesCents: number;
  otherIncomeCents: number;
  /** Health insurance premiums paid while self-employed, deducted from income (not from self-employment tax). */
  healthInsuranceCents?: number;
  /** A city or county income tax rate, as a fraction, applied to adjusted gross income. */
  localRate?: number;
}

export interface TaxResult {
  selfEmploymentTaxCents: number;
  additionalMedicareCents: number;
  qbiDeductionCents: number;
  /** The self-employed health insurance deduction, limited to profit. */
  healthInsuranceDeductionCents: number;
  federalTaxableIncomeCents: number;
  federalIncomeTaxCents: number;
  federalTotalCents: number;
  stateTaxableIncomeCents: number;
  /** State income tax, before any local tax. */
  stateIncomeTaxCents: number;
  localTaxCents: number;
  /** State plus local: what the state column of each estimated payment covers. */
  stateTotalCents: number;
}

/**
 * A year's federal, state and local tax for a sole proprietor, on the main items only:
 * self-employment tax, the standard deduction, the QBI deduction and the brackets.
 * Health insurance premiums are deducted from income, up to the profit left after half the
 * self-employment tax. It doesn't know about credits, itemized deductions or retirement contributions.
 */
export function estimateTax(input: TaxInput, f: TaxFigures, state: StateTaxYear | null = null): TaxResult {
  const status = input.filingStatus;
  const profit = Math.max(0, input.profitCents);
  const wages = Math.max(0, input.w2WagesCents);

  // Self-employment tax: 15.3% on 92.35% of profit; the Social Security part stops at the wage base,
  // which W-2 wages use up first. Nothing is due on under $400.
  const earnings = profit * 0.9235;
  let seTax = 0;
  if (earnings >= 400_00) {
    const ssRoom = Math.max(0, f.socialSecurityWageBase - wages);
    seTax = Math.min(earnings, ssRoom) * 0.124 + earnings * 0.029;
  }
  const additionalMedicare = Math.max(0, (seTax > 0 ? earnings : 0) + wages - f.additionalMedicareThreshold[status]) * 0.009;

  // Federal income tax.
  const halfSe = seTax / 2;
  const health = Math.min(Math.max(0, input.healthInsuranceCents ?? 0), Math.max(0, profit - halfSe));
  const agi = wages + input.otherIncomeCents + profit - halfSe - health;
  const beforeQbi = Math.max(0, agi - f.standardDeduction[status]);
  // QBI is the profit less the deductions that come from it.
  const qbi = Math.max(0, profit - halfSe - health);
  let qbiDeduction = Math.min(qbi * 0.2, beforeQbi * 0.2);
  // Above the threshold, a business with no employees (and any service business) phases out entirely
  // across the phase-in range.
  const over = beforeQbi - f.qbiThreshold[status];
  if (over > 0) qbiDeduction *= Math.max(0, 1 - over / f.qbiPhaseIn[status]);
  // The minimum deduction for an active business with at least $1,000 of QBI.
  if (qbi >= 1_000_00 && over <= 0) qbiDeduction = Math.max(qbiDeduction, Math.min(400_00, beforeQbi));
  const taxable = Math.max(0, beforeQbi - qbiDeduction);
  const incomeTax = bracketTax(taxable, f.brackets[status]);

  // State: from federal adjusted gross income (or, where the state caps the self-employment
  // tax deduction instead, income less that capped amount), less the state's deduction and
  // exemption, through its brackets, less any exemption credit.
  let stateTaxable = 0;
  let stateTax = 0;
  if (state) {
    const seDeduction = state.seDeductionCap !== undefined ? Math.min(seTax, state.seDeductionCap) : halfSe;
    const base = wages + input.otherIncomeCents + profit - health - seDeduction;
    stateTaxable = Math.max(0, base - (state.standardDeduction?.[status] ?? 0) - (state.exemption?.[status] ?? 0));
    stateTax = Math.max(0, bracketTax(stateTaxable, state.brackets[status]) - (state.credit?.[status] ?? 0));
  }
  const localTax = Math.max(0, agi) * Math.max(0, input.localRate ?? 0);

  const r = Math.round;
  return {
    selfEmploymentTaxCents: r(seTax),
    additionalMedicareCents: r(additionalMedicare),
    qbiDeductionCents: r(qbiDeduction),
    healthInsuranceDeductionCents: r(health),
    federalTaxableIncomeCents: r(taxable),
    federalIncomeTaxCents: r(incomeTax),
    federalTotalCents: r(seTax) + r(additionalMedicare) + r(incomeTax),
    stateTaxableIncomeCents: r(stateTaxable),
    stateIncomeTaxCents: r(stateTax),
    localTaxCents: r(localTax),
    stateTotalCents: r(stateTax) + r(localTax),
  };
}

/**
 * Estimated payment due dates for a tax year, moved past weekends. Almost every state uses the
 * federal dates; check your state's if you're unsure.
 */
export function dueDates(year: number): string[] {
  return [
    [year, 3, 15],
    [year, 5, 15],
    [year, 8, 15],
    [year + 1, 0, 15],
  ].map(([y, m, d]) => {
    const date = new Date(Date.UTC(y, m, d));
    while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  });
}
