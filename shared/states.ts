import type { FilingStatus } from "./types";

/**
 * State income tax figures by tax year, as data: one calculation (in tax.ts) works for every
 * state. Everything is in cents and rates are fractions.
 *
 * Each year a state has:
 * - brackets by filing status: [from, rate]. A flat tax is one bracket. A first bracket that
 *   starts above $0 means income below it isn't taxed.
 * - standardDeduction and exemption, subtracted from income (when the state has them).
 * - credit, subtracted from the tax (for states whose exemption is a credit).
 * - seDeductionCap, for states that let you deduct self-employment tax up to a cap instead of
 *   the federal half (Massachusetts).
 * Income starts from federal adjusted gross income, so half the self-employment tax and the
 * self-employed health insurance deduction come off first. A few states define income their
 * own way; for a quarterly estimate this is close enough.
 *
 * Sources:
 * - 2026: Tax Foundation, "State Individual Income Tax Rates and Brackets, 2026" (rates as of
 *   January 1, 2026), https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/
 * - Massachusetts 2026: mass.gov (surtax threshold $1,107,750; self-employment tax deduction
 *   up to $2,000).
 * Add a year when new figures are published (the Tax Foundation usually publishes in February).
 * A year without its own figures uses the latest earlier year, and says so on the Taxes page.
 */

export interface StateTaxYear {
  brackets: Record<FilingStatus, [fromCents: number, rate: number][]>;
  standardDeduction?: Record<FilingStatus, number>;
  exemption?: Record<FilingStatus, number>;
  credit?: Record<FilingStatus, number>;
  seDeductionCap?: number;
}

export interface StateInfo {
  name: string;
  /** No tax on wages or self-employment income. */
  noIncomeTax?: boolean;
  /** City or county income taxes exist here; the Tax profile has a field for a local rate. */
  localTaxes?: boolean;
  years: Record<number, StateTaxYear>;
}

const $ = (dollars: number) => Math.round(dollars * 100);
const pct = (n: number) => Math.round(n * 100) / 10_000;
const both = <T>(v: T): Record<FilingStatus, T> => ({ single: v, joint: v });
const pair = (single: number, joint: number): Record<FilingStatus, number> => ({ single: $(single), joint: $(joint) });

/** One rate for everyone above an optional floor. */
const flat = (rate: number, extra: Omit<StateTaxYear, "brackets"> = {}, from = 0): StateTaxYear => ({ brackets: both([[$(from), pct(rate)]]), ...extra });
/** Brackets as [from dollars, rate %], separate for single and joint filers. */
const graduated = (single: [number, number][], joint: [number, number][], extra: Omit<StateTaxYear, "brackets"> = {}): StateTaxYear => ({
  brackets: { single: single.map(([f, r]) => [$(f), pct(r)]), joint: joint.map(([f, r]) => [$(f), pct(r)]) },
  ...extra,
});
const same = (b: [number, number][], extra: Omit<StateTaxYear, "brackets"> = {}) => graduated(b, b, extra);
const none = (name: string, extra: Partial<StateInfo> = {}): StateInfo => ({ name, noIncomeTax: true, years: {}, ...extra });

const MA_2026 = same(
  [
    [0, 5],
    [1_107_750, 9],
  ],
  { exemption: pair(4_400, 8_800), seDeductionCap: $(2_000) },
);

export const STATES: Record<string, StateInfo> = {
  AL: { name: "Alabama", localTaxes: true, years: { 2026: graduated([[0, 2], [500, 4], [3_000, 5]], [[0, 2], [1_000, 4], [6_000, 5]], { standardDeduction: pair(3_000, 8_500), exemption: pair(1_500, 3_000) }) } },
  AK: none("Alaska"),
  AZ: { name: "Arizona", years: { 2026: flat(2.5, { standardDeduction: pair(8_350, 16_700) }) } },
  AR: { name: "Arkansas", years: { 2026: same([[0, 2], [4_600, 3.9]], { standardDeduction: pair(2_470, 4_940), credit: pair(29, 58) }) } },
  CA: {
    name: "California",
    years: {
      2026: graduated(
        [[0, 1], [11_079, 2], [26_264, 4], [41_452, 6], [57_542, 8], [72_724, 9.3], [371_479, 10.3], [445_771, 11.3], [742_953, 12.3], [1_000_000, 13.3]],
        [[0, 1], [22_158, 2], [52_528, 4], [82_904, 6], [115_084, 8], [145_448, 9.3], [742_958, 10.3], [891_542, 11.3], [1_000_000, 12.3], [1_485_906, 13.3]],
        { standardDeduction: pair(5_540, 11_080), credit: pair(153, 306) },
      ),
    },
  },
  CO: { name: "Colorado", years: { 2026: flat(4.4, { standardDeduction: pair(16_100, 32_200) }) } },
  CT: {
    name: "Connecticut",
    years: {
      2026: graduated(
        [[0, 2], [10_000, 4.5], [50_000, 5.5], [100_000, 6], [200_000, 6.5], [250_000, 6.9], [500_000, 6.99]],
        [[0, 2], [20_000, 4.5], [100_000, 5.5], [200_000, 6], [400_000, 6.5], [500_000, 6.9], [1_000_000, 6.99]],
        { exemption: pair(15_000, 24_000) },
      ),
    },
  },
  DE: { name: "Delaware", years: { 2026: same([[2_000, 2.2], [5_000, 3.9], [10_000, 4.8], [20_000, 5.2], [25_000, 5.55], [60_000, 6.6]], { standardDeduction: pair(3_250, 6_500), credit: pair(110, 220) }) } },
  DC: { name: "District of Columbia", years: { 2026: same([[0, 4], [10_000, 6], [40_000, 6.5], [60_000, 8.5], [250_000, 9.25], [500_000, 9.75], [1_000_000, 10.75]], { standardDeduction: pair(16_100, 32_200) }) } },
  FL: none("Florida"),
  GA: { name: "Georgia", years: { 2026: flat(5.19, { standardDeduction: pair(12_000, 24_000) }) } },
  HI: {
    name: "Hawaii",
    years: {
      2026: graduated(
        [[0, 1.4], [9_600, 3.2], [14_400, 5.5], [19_200, 6.4], [24_000, 6.8], [36_000, 7.2], [48_000, 7.6], [125_000, 7.9], [175_000, 8.25], [225_000, 9], [275_000, 10], [325_000, 11]],
        [[0, 1.4], [19_200, 3.2], [28_800, 5.5], [38_400, 6.4], [48_000, 6.8], [72_000, 7.2], [96_000, 7.6], [250_000, 7.9], [350_000, 8.25], [450_000, 9], [550_000, 10], [650_000, 11]],
        { standardDeduction: pair(4_400, 8_800), exemption: pair(1_144, 2_288) },
      ),
    },
  },
  ID: { name: "Idaho", years: { 2026: graduated([[4_811, 5.3]], [[9_622, 5.3]], { standardDeduction: pair(16_100, 32_200) }) } },
  IL: { name: "Illinois", years: { 2026: flat(4.95, { exemption: pair(2_925, 5_850) }) } },
  IN: { name: "Indiana", localTaxes: true, years: { 2026: flat(2.95, { exemption: pair(1_000, 2_000) }) } },
  IA: { name: "Iowa", localTaxes: true, years: { 2026: flat(3.8, { standardDeduction: pair(16_100, 32_200), credit: pair(40, 80) }) } },
  KS: { name: "Kansas", years: { 2026: graduated([[0, 5.2], [23_000, 5.58]], [[0, 5.2], [46_000, 5.58]], { standardDeduction: pair(3_605, 8_240), exemption: pair(9_160, 18_320) }) } },
  KY: { name: "Kentucky", localTaxes: true, years: { 2026: flat(3.5, { standardDeduction: pair(3_360, 3_360) }) } },
  LA: { name: "Louisiana", years: { 2026: flat(3, { standardDeduction: pair(12_875, 25_750) }) } },
  ME: { name: "Maine", years: { 2026: graduated([[0, 5.8], [27_399, 6.75], [64_849, 7.15]], [[0, 5.8], [54_849, 6.75], [129_749, 7.15]], { standardDeduction: pair(8_350, 16_700), exemption: pair(5_300, 10_600) }) } },
  MD: {
    name: "Maryland",
    localTaxes: true,
    years: {
      2026: graduated(
        [[0, 2], [1_000, 3], [2_000, 4], [3_000, 4.75], [100_000, 5], [125_000, 5.25], [150_000, 5.5], [250_000, 5.75], [500_000, 6.25], [1_000_000, 6.5]],
        [[0, 2], [1_000, 3], [2_000, 4], [3_000, 4.75], [150_000, 5], [175_000, 5.25], [225_000, 5.5], [300_000, 5.75], [600_000, 6.25], [1_200_000, 6.5]],
        { standardDeduction: pair(3_350, 6_700), exemption: pair(3_200, 6_400) },
      ),
    },
  },
  MA: { name: "Massachusetts", years: { 2026: MA_2026 } },
  MI: { name: "Michigan", localTaxes: true, years: { 2026: flat(4.25, { exemption: pair(5_900, 11_800) }) } },
  MN: { name: "Minnesota", years: { 2026: graduated([[0, 5.35], [33_310, 6.8], [109_430, 7.85], [203_150, 9.85]], [[0, 5.35], [48_700, 6.8], [193_480, 7.85], [337_930, 9.85]], { standardDeduction: pair(15_300, 30_600) }) } },
  MS: { name: "Mississippi", years: { 2026: flat(4, { standardDeduction: pair(2_300, 4_600), exemption: pair(6_000, 12_000) }, 10_000) } },
  MO: { name: "Missouri", localTaxes: true, years: { 2026: same([[1_348, 2], [2_696, 2.5], [4_044, 3], [5_392, 3.5], [6_740, 4], [8_088, 4.5], [9_436, 4.7]], { standardDeduction: pair(16_100, 32_200) }) } },
  MT: { name: "Montana", years: { 2026: graduated([[0, 4.7], [47_500, 5.65]], [[0, 4.7], [95_000, 5.65]], { standardDeduction: pair(16_100, 32_200) }) } },
  NE: { name: "Nebraska", years: { 2026: graduated([[0, 2.46], [4_130, 3.51], [24_760, 4.55]], [[0, 2.46], [8_250, 3.51], [49_530, 4.55]], { standardDeduction: pair(8_850, 17_700), credit: pair(176, 352) }) } },
  NV: none("Nevada"),
  NH: none("New Hampshire"),
  NJ: {
    name: "New Jersey",
    years: {
      2026: graduated(
        [[0, 1.4], [20_000, 1.75], [35_000, 3.5], [40_000, 5.53], [75_000, 6.37], [500_000, 8.97], [1_000_000, 10.75]],
        [[0, 1.4], [20_000, 1.75], [50_000, 2.45], [70_000, 3.5], [80_000, 5.53], [150_000, 6.37], [500_000, 8.97], [1_000_000, 10.75]],
        { exemption: pair(1_000, 2_000) },
      ),
    },
  },
  NM: { name: "New Mexico", years: { 2026: graduated([[0, 1.5], [5_500, 3.2], [16_500, 4.3], [33_500, 4.7], [66_500, 4.9], [210_000, 5.9]], [[0, 1.5], [8_000, 3.2], [25_000, 4.3], [50_000, 4.7], [100_000, 4.9], [315_000, 5.9]], { standardDeduction: pair(16_100, 32_200) }) } },
  NY: {
    name: "New York",
    localTaxes: true,
    years: {
      2026: graduated(
        [[0, 3.9], [8_500, 4.4], [11_700, 5.15], [13_900, 5.4], [80_650, 5.9], [215_400, 6.85], [1_077_550, 9.65], [5_000_000, 10.3], [25_000_000, 10.9]],
        [[0, 3.9], [17_150, 4.4], [23_600, 5.15], [27_900, 5.4], [161_550, 5.9], [323_200, 6.85], [2_155_350, 9.65], [5_000_000, 10.3], [25_000_000, 10.9]],
        { standardDeduction: pair(8_000, 16_050) },
      ),
    },
  },
  NC: { name: "North Carolina", years: { 2026: flat(3.99, { standardDeduction: pair(12_750, 25_500) }) } },
  ND: { name: "North Dakota", years: { 2026: graduated([[48_475, 1.95], [244_825, 2.5]], [[80_975, 1.95], [298_075, 2.5]], { standardDeduction: pair(16_100, 32_200) }) } },
  OH: { name: "Ohio", localTaxes: true, years: { 2026: flat(2.75, { exemption: pair(2_400, 4_800) }, 26_050) } },
  OK: { name: "Oklahoma", years: { 2026: graduated([[3_750, 2.5], [4_900, 3.5], [7_200, 4.5]], [[7_500, 2.5], [9_800, 3.5], [14_400, 4.5]], { standardDeduction: pair(6_350, 12_700), exemption: pair(1_000, 2_000) }) } },
  OR: { name: "Oregon", localTaxes: true, years: { 2026: graduated([[0, 4.75], [4_550, 6.75], [11_400, 8.75], [125_000, 9.9]], [[0, 4.75], [9_100, 6.75], [22_800, 8.75], [250_000, 9.9]], { standardDeduction: pair(2_910, 5_820), credit: pair(256, 512) }) } },
  PA: { name: "Pennsylvania", localTaxes: true, years: { 2026: flat(3.07) } },
  RI: { name: "Rhode Island", years: { 2026: same([[0, 3.75], [82_050, 4.75], [186_450, 5.99]], { standardDeduction: pair(11_200, 22_400), exemption: pair(5_250, 10_500) }) } },
  SC: { name: "South Carolina", years: { 2026: same([[0, 0], [3_640, 3], [18_230, 6]], { standardDeduction: pair(8_350, 16_700) }) } },
  SD: none("South Dakota"),
  TN: none("Tennessee"),
  TX: none("Texas"),
  UT: { name: "Utah", years: { 2026: flat(4.5, { credit: pair(966, 1_932) }) } },
  VT: { name: "Vermont", years: { 2026: graduated([[0, 3.35], [49_400, 6.6], [119_700, 7.6], [249_700, 8.75]], [[0, 3.35], [82_500, 6.6], [199_450, 7.6], [304_000, 8.75]], { standardDeduction: pair(7_650, 15_300), exemption: pair(5_300, 10_600) }) } },
  VA: { name: "Virginia", years: { 2026: same([[0, 2], [3_000, 3], [5_000, 5], [17_000, 5.75]], { standardDeduction: pair(8_750, 17_500), exemption: pair(930, 1_860) }) } },
  // Washington taxes capital gains only, not wages or self-employment income.
  WA: none("Washington"),
  WV: { name: "West Virginia", years: { 2026: same([[0, 2.22], [10_000, 2.96], [25_000, 3.33], [40_000, 4.44], [60_000, 4.82]], { exemption: pair(2_000, 4_000) }) } },
  WI: { name: "Wisconsin", years: { 2026: graduated([[0, 3.5], [15_110, 4.4], [51_950, 5.3], [332_720, 7.65]], [[0, 3.5], [20_150, 4.4], [69_260, 5.3], [443_630, 7.65]], { standardDeduction: pair(13_960, 25_840), exemption: pair(700, 1_400) }) } },
  WY: none("Wyoming"),
};

/** The custom choice: your own flat rate and deduction, for a situation the table doesn't fit. */
export const CUSTOM_STATE = "custom";

export interface StateChoice {
  code: string;
  name: string;
  /** Null when there's no state income tax (or no state chosen yet). */
  figures: StateTaxYear | null;
  /** The year the figures come from, which is an earlier year until the new ones are added. */
  figuresYear: number | null;
}

/** The state figures to use for a tax year: the state's own, the latest earlier year's, or your custom rate. */
export function stateFor(code: string, year: number, custom?: { rateBps: number; deductionCents: number }): StateChoice {
  if (code === CUSTOM_STATE) {
    const rate = (custom?.rateBps ?? 0) / 10_000;
    const deduction = custom?.deductionCents ?? 0;
    return { code, name: "Your state", figures: { brackets: both([[0, rate]]), standardDeduction: both(deduction) }, figuresYear: year };
  }
  const info = STATES[code];
  if (!info) return { code: "", name: "Your state", figures: null, figuresYear: null };
  if (info.noIncomeTax) return { code, name: info.name, figures: null, figuresYear: null };
  const years = Object.keys(info.years).map(Number).sort((a, b) => a - b);
  const figuresYear = years.filter((y) => y <= year).at(-1) ?? years[0];
  return { code, name: info.name, figures: info.years[figuresYear], figuresYear };
}

/** States in alphabetical order, for pickers. */
export const STATE_LIST = Object.entries(STATES)
  .map(([code, s]) => ({ code, name: s.name, noIncomeTax: !!s.noIncomeTax, localTaxes: !!s.localTaxes }))
  .sort((a, b) => a.name.localeCompare(b.name));
