import { describe, expect, it } from "vitest";
import type { ExpenseCategory } from "../shared/types";
import { guessAccount, parseQuickBooks, suggestFix, suggestTarget, taxQuarter, withImportKeys } from "./quickbooks";

const CATEGORIES: ExpenseCategory[] = [
  ["Advertising", "8"],
  ["Car and truck expenses", "9"],
  ["Insurance (other than health)", "15"],
  ["Office expense", "18"],
  ["Travel", "24a"],
  ["Deductible meals", "24b"],
  ["Utilities", "25"],
  ["Other expenses", "27a"],
  ["Health insurance premiums", null],
].map(([name, line], i) => ({
  id: i + 1,
  name: name!,
  scheduleCLine: line,
  deductiblePercent: name === "Deductible meals" ? 50 : 100,
  deduction: line ? "schedule_c" : "health_insurance",
  used: false,
}));
const id = (name: string) => CATEGORIES.find((c) => c.name === name)!.id;

const CSV = `Date,Bank,Account,Description,Amount,Type,Category,Receipt,Notes
11/7/26,"Northstar Credit Card","NORTHSTAR CARD","Grocery Store",-80.00,Personal,Personal spending,N,
11/6/26,"Northstar Credit Card","NORTHSTAR CARD","Payment Thank You",1000.00,Personal,Personal income,N,
11/1/26,"Northstar Credit Card","NORTHSTAR CARD","Slack Txxxxxxxx Ca",-12.00,Business,Office Expenses,N,
11/1/26,"Northstar Credit Card","NORTHSTAR CARD","Slack Txxxxxxxx Ca",-12.00,Business,Office Expenses,N,
10/8/26,"Northstar Credit Card","NORTHSTAR CARD","DesignTool Pro",-25.00,Business,"Health insurance premium",N,
10/26/26,"Example Bank","Everyday Checking","State Health Plan",-500.00,Business,"Health insurance premium",N,
9/16/26,"Example Bank","Everyday Checking","Acme Co Payment",12500,Business,Income,N,
bad,"Example Bank","Everyday Checking","Broken",x,Business,Income,N,
9/29/26,"Example Bank","Everyday Checking","Rewards ATM Fee Waiver",0,Personal,Personal income,N,
`;

describe("parseQuickBooks", () => {
  it("reads the export, with money out negative", () => {
    const { rows, problems } = parseQuickBooks(CSV);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({
      date: "2026-11-07",
      accountKey: "Northstar Credit Card · NORTHSTAR CARD",
      description: "Grocery Store",
      amountCents: -8000,
      type: "personal",
      category: "Personal spending",
    });
    expect(rows[6]).toMatchObject({ amountCents: 1_250_000, type: "business", category: "Income" });
    expect(problems).toEqual(["Line 9: couldn't read the date or amount."]);
  });

  it("says when a file isn't a QuickBooks export", () => {
    expect(parseQuickBooks("Date,Client,Hours\n2026-01-01,A,1").problems[0]).toMatch(/Missing columns/);
    expect(parseQuickBooks("Date,Bank,Account,Description,Amount,Type,Category,Receipt,Notes\n").problems[0]).toMatch(/no transactions/);
  });

  it("gives identical rows different keys", () => {
    const keys = withImportKeys(parseQuickBooks(CSV).rows).map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[2]).toMatch(/#1$/);
    expect(keys[3]).toMatch(/#2$/);
  });
});

describe("suggestTarget", () => {
  it("maps QuickBooks categories onto Schedule C", () => {
    expect(suggestTarget("Personal spending", "personal", CATEGORIES)).toEqual({ kind: "personal" });
    expect(suggestTarget("Office Expenses", "business", CATEGORIES)).toEqual({ kind: "business", categoryId: id("Office expense") });
    expect(suggestTarget("Apps/software/web services", "business", CATEGORIES)).toEqual({ kind: "business", categoryId: id("Office expense") });
    expect(suggestTarget("Health insurance premium", "business", CATEGORIES)).toEqual({ kind: "business", categoryId: id("Health insurance premiums") });
    expect(suggestTarget("Insurance", "business", CATEGORIES)).toEqual({ kind: "business", categoryId: id("Insurance (other than health)") });
    expect(suggestTarget("Travel expenses", "business", CATEGORIES)).toEqual({ kind: "business", categoryId: id("Travel") });
    expect(suggestTarget("Meals (business)", "business", CATEGORIES)).toEqual({ kind: "business", categoryId: id("Deductible meals") });
    expect(suggestTarget("Income", "business", CATEGORIES)).toEqual({ kind: "business", categoryId: null });
    expect(suggestTarget("Something new", "business", CATEGORIES)).toBeNull();
  });

  it("treats tax payments as payments, not spending", () => {
    expect(suggestTarget("Federal estimated taxes", "business", CATEGORIES)).toEqual({ kind: "tax", jurisdiction: "federal" });
    expect(suggestTarget("State tax", "business", CATEGORIES)).toEqual({ kind: "tax", jurisdiction: "state" });
  });
});

describe("suggestFix", () => {
  const health = { kind: "business" as const, categoryId: id("Health insurance premiums") };
  const officeT = { kind: "business" as const, categoryId: id("Office expense") };
  it("catches charges that aren't health insurance", () => {
    expect(suggestFix("DesignTool Pro", health, CATEGORIES)).toEqual({ categoryId: id("Office expense"), reason: "Doesn't look like health insurance" });
    expect(suggestFix("State Health Plan", health, CATEGORIES)).toBeNull();
  });
  it("catches travel filed elsewhere", () => {
    for (const d of ["Uber.com", "JetBlue", "Hilton", "Airport Parking", "Turnpike Toll", "Bolt"]) {
      expect(suggestFix(d, officeT, CATEGORIES)).toEqual({ categoryId: id("Travel"), reason: "Looks like travel" });
    }
    expect(suggestFix("Slack Txxxxxxxx Ca", officeT, CATEGORIES)).toBeNull();
    expect(suggestFix("Uber.com", { kind: "personal" }, CATEGORIES)).toBeNull();
  });
});

describe("taxQuarter", () => {
  it("puts a payment in the quarter it was due, up to a month late", () => {
    expect(taxQuarter("2026-01-15")).toEqual({ taxYear: 2025, quarter: 4 });
    expect(taxQuarter("2026-04-04")).toEqual({ taxYear: 2026, quarter: 1 });
    expect(taxQuarter("2026-04-15")).toEqual({ taxYear: 2026, quarter: 1 });
    expect(taxQuarter("2026-06-16")).toEqual({ taxYear: 2026, quarter: 2 });
    expect(taxQuarter("2026-09-16")).toEqual({ taxYear: 2026, quarter: 3 });
    expect(taxQuarter("2026-12-20")).toEqual({ taxYear: 2026, quarter: 4 });
  });
});

describe("guessAccount", () => {
  const accounts = [
    { id: 1, name: "Everyday Checking", institutionName: "Example Bank", type: "depository" },
    { id: 2, name: "Premier Cash Rewards Visa Signature", institutionName: "Example Bank", type: "credit" },
    { id: 3, name: "Northstar Card", institutionName: "Northstar", type: "credit" },
  ];
  it("matches by shared words, not just the bank", () => {
    expect(guessAccount({ bank: "Example Bank", account: "Everyday Checking" }, accounts)).toBe(1);
    expect(guessAccount({ bank: "Example Bank", account: "Cash Rewards Visa Signature" }, accounts)).toBe(2);
    expect(guessAccount({ bank: "Northstar Credit Card", account: "NORTHSTAR CARD" }, accounts)).toBe(3);
    expect(guessAccount({ bank: "Example Bank", account: "Savings" }, accounts)).toBeNull();
    expect(guessAccount({ bank: "PayPal", account: "Sample Design Co - PayPal" }, accounts)).toBeNull();
    // "Cash" alone isn't enough to be the Cash Rewards card.
    expect(guessAccount({ bank: "Cash Account", account: "Cash" }, accounts)).toBeNull();
    // The only Northstar account, whatever Plaid calls it.
    expect(guessAccount({ bank: "Northstar Credit Card", account: "NORTHSTAR CARD" }, [accounts[0], { ...accounts[2], name: "Northstar Everyday" }])).toBe(3);
  });
});
