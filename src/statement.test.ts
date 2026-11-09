import { describe, expect, it } from "vitest";
import { columnsFit, guessColumns, readStatement, statementRows, toIsoDate } from "./statement";

const checking = `Account Name : Business Checking
Account Number : XXXX0001
Date Range : 10/01/2026-10/31/2026
Transaction Date,Posted Date,Description,Amount,Balance
10/02/2026,10/03/2026,"ACME CO, ACH PMT",4500.00,9500.00
10/05/2026,10/05/2026,FIGMA MONTHLY,-15.00,9485.00
10/05/2026,10/05/2026,FIGMA MONTHLY,-15.00,9470.00
,,Ending balance,,9470.00
`;

const card = `Date,Description,Amount
2026-10-04,ADOBE CREATIVE CLOUD,59.99
2026-10-09,DELTA AIR LINES,412.30
2026-10-20,PAYMENT THANK YOU,-471.29
`;

const split = `Date,Description,Debit,Credit
11/1/26,COFFEE,4.50,
11/2/26,REFUND,,12.00
`;

describe("statement import", () => {
  it("reads US dates in the usual shapes", () => {
    expect(["10/02/2026", "1/2/26", "2026-01-02", "01-02-2026"].map(toIsoDate)).toEqual(["2026-10-02", "2026-01-02", "2026-01-02", "2026-01-02"]);
    expect(toIsoDate("13/40/2026")).toBeNull();
  });

  it("skips lines above the headings and rows without a date", () => {
    const file = readStatement(checking)!;
    expect(file.header).toEqual(["Transaction Date", "Posted Date", "Description", "Amount", "Balance"]);
    const columns = guessColumns(file);
    expect(columns).toEqual({ date: "Transaction Date", description: "Description", amount: "Amount", moneyOut: "negative" });
    const { rows, skipped } = statementRows(file, columns);
    expect(rows.map((r) => [r.date, r.description, r.amountCents])).toEqual([
      ["2026-10-02", "ACME CO, ACH PMT", 450000],
      ["2026-10-05", "FIGMA MONTHLY", -1500],
      ["2026-10-05", "FIGMA MONTHLY", -1500],
    ]);
    expect(skipped).toBe(1);
    // Two identical charges on one day stay two, and keep the same keys in a later export.
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
    expect(statementRows(readStatement(checking)!, columns).rows.map((r) => r.key)).toEqual(rows.map((r) => r.key));
  });

  it("flips a card export that shows charges as positive", () => {
    const file = readStatement(card)!;
    const columns = guessColumns(file);
    expect(columns.moneyOut).toBe("positive");
    expect(statementRows(file, columns).rows.map((r) => r.amountCents)).toEqual([-5999, -41230, 47129]);
  });

  it("reads separate money out and money in columns", () => {
    const file = readStatement(split)!;
    const columns = guessColumns(file);
    expect(columns).toMatchObject({ debit: "Debit", credit: "Credit" });
    expect(statementRows(file, columns).rows.map((r) => [r.date, r.amountCents])).toEqual([
      ["2026-11-01", -450],
      ["2026-11-02", 1200],
    ]);
  });

  it("uses saved columns only when the file still has them", () => {
    const file = readStatement(card)!;
    expect(columnsFit(file, { date: "Date", description: "Description", amount: "Amount", moneyOut: "positive" })).toBe(true);
    expect(columnsFit(file, { date: "Posted Date", description: "Description", amount: "Amount", moneyOut: "positive" })).toBe(false);
    expect(readStatement("not,a,statement\nhello,there,you")).toBeNull();
  });
});
