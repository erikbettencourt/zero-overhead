import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangleIcon, ArrowLeftIcon, CheckCircle2Icon, DownloadIcon, PrinterIcon } from "lucide-react";
import type { BankTransaction, ExpenseCategory, Jurisdiction, TaxPayment, YearEndSummary } from "../../shared/types";
import { formatMoney, toIsoDate } from "../../shared/time";
import { dueDates } from "../../shared/tax";
import { api } from "../api";
import { niceDate } from "../format";
import { useAction, useData } from "../state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Money without the dollar sign, for columns. */
const cents = (n: number) => formatMoney(n).replace("$", "");

/** One year laid out for an accountant: a page to check, and a letter-size PDF to send. */
export default function YearEndView({ year }: { year: number }) {
  const run = useAction();
  const { data } = useData();
  const [s, setS] = useState<YearEndSummary | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setS(null);
    void run(() => api.yearEnd(year)).then((r) => r && setS(r));
  }, [run, year]);

  useEffect(() => {
    // Browsers use the page title as the suggested PDF file name.
    document.title = `${s?.businessName ? `${s.businessName} ` : ""}${year} year-end summary`;
    return () => {
      document.title = "Zero Overhead";
    };
  }, [s, year]);

  async function downloadCsv() {
    setExporting(true);
    const rows = await run(() =>
      api.transactions({
        view: "business",
        from: `${year}-01-01`,
        to: `${year}-12-31`,
      }),
    );
    setExporting(false);
    if (!rows) return;
    const blob = new Blob([transactionsCsv(rows, data.categories)], {
      type: "text/csv",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${s?.businessName ? `${s.businessName} ` : ""}${year} business transactions.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const spendingLink = `#/spending/review/${year}-01-01/${year}-12-31`;

  return (
    <div>
      <div className="print:hidden">
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <a href={`#/taxes/${year}`}>
            <ArrowLeftIcon />
            Taxes, {year}
          </a>
        </Button>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{year} year-end summary</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              For your accountant. Income, expenses by Schedule C line, health insurance and estimated payments.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!s || exporting} onClick={() => void downloadCsv()}>
              <DownloadIcon />
              Download CSV
            </Button>
            <Button disabled={!s} onClick={() => window.print()}>
              <PrinterIcon />
              Save as PDF
            </Button>
          </div>
        </div>
      </div>

      {!s ? (
        <p className="mt-10 text-muted-foreground print:hidden">Loading…</p>
      ) : (
        <>
          <div className="mt-6 flex flex-col gap-4 print:hidden">
            <Checks summary={s} spendingLink={spendingLink} />
            <Timing summary={s} />
          </div>
          <p className="mt-8 mb-2 text-center text-xs text-muted-foreground print:hidden">Preview of the PDF</p>
          <Paper summary={s} />
        </>
      )}
    </div>
  );
}

function Checks({ summary: s, spendingLink }: { summary: YearEndSummary; spendingLink: string }) {
  const items: { text: ReactNode; action: string; href: string }[] = [];
  if (s.checks.toReview > 0)
    items.push({
      text: (
        <>
          <strong>{plural(s.checks.toReview, `transaction from ${s.year}`, `transactions from ${s.year}`)}</strong> {s.checks.toReview === 1 ? "is" : "are"}{" "}
          still to review
        </>
      ),
      action: "Review",
      href: spendingLink,
    });
  if (s.checks.uncategorized > 0)
    items.push({
      text: (
        <>
          <strong>{plural(s.checks.uncategorized, "business charge")}</strong> {s.checks.uncategorized === 1 ? "has" : "have"} no category
        </>
      ),
      action: "Fix",
      href: spendingLink,
    });
  for (const q of s.checks.missingQuarters)
    items.push({
      text: (
        <>
          <strong>Q{q.quarter} payments</strong> aren't recorded
          {q.dueOn >= toIsoDate(new Date()) ? ` yet (due ${niceDate(q.dueOn)})` : ""}
        </>
      ),
      action: "Record",
      href: `#/taxes/${s.year}`,
    });

  if (items.length === 0)
    return (
      <Card className="flex-row items-center gap-3 p-4 text-sm">
        <CheckCircle2Icon className="size-5 text-success" />
        Nothing left to review, every business charge has a category, and every quarter's payments are recorded.
      </Card>
    );
  return (
    <Card className="gap-0 border-now/40 bg-now-wash/40 px-5 py-4">
      <h2 className="font-bold">Before you send</h2>
      <p className="mb-2 text-sm text-muted-foreground">These would change the numbers. Only you see this; it isn't part of the PDF.</p>
      <ul>
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-3 border-t border-now/20 py-2.5 text-sm">
            <AlertTriangleIcon className="size-4 shrink-0 text-now" />
            <span className="flex-1">{it.text}</span>
            <a href={it.href} className="font-semibold text-primary underline-offset-2 hover:underline">
              {it.action}
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Timing({ summary: s }: { summary: YearEndSummary }) {
  return (
    <Card className="gap-0 px-5 py-4">
      <h2 className="font-bold">How income is counted</h2>
      <p className="mb-3 text-sm text-muted-foreground">An invoice counts in the year you're paid, whenever the work was done or the invoice was sent.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border px-4 py-3">
          <p className="text-sm text-muted-foreground">Included in {s.year}</p>
          <p className="num mt-1 text-xl font-semibold">{formatMoney(s.fromEarlierYears.cents)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {s.fromEarlierYears.count === 0
              ? `No invoices from earlier years were paid in ${s.year}.`
              : `Paid in ${s.year} for ${plural(s.fromEarlierYears.count, "invoice")} sent earlier`}
          </p>
        </div>
        <div className="rounded-lg border px-4 py-3">
          <p className="text-sm text-muted-foreground">Not included, counts when paid</p>
          <p className="num mt-1 text-xl font-semibold">{formatMoney(s.notPaidInYear.cents)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {s.notPaidInYear.count === 0 ? (
              `Every invoice sent in ${s.year} was paid in ${s.year}.`
            ) : (
              <>
                {plural(s.notPaidInYear.count, "invoice")} sent in {s.year}, not paid in {s.year}.{" "}
                <a href="#/invoices" className="font-semibold text-primary underline-offset-2 hover:underline">
                  See invoices
                </a>
              </>
            )}
          </p>
        </div>
      </div>
    </Card>
  );
}

/** The PDF itself. Always black on white, on screen and on paper. */
function Paper({ summary: s }: { summary: YearEndSummary }) {
  const prepared = niceDate(toIsoDate(new Date()));
  const timing = [
    s.fromEarlierYears.cents > 0 && `includes ${formatMoney(s.fromEarlierYears.cents)} paid in ${s.year} for invoices sent earlier`,
    s.notPaidInYear.cents > 0 && `leaves out ${formatMoney(s.notPaidInYear.cents)} invoiced in ${s.year} and not paid in ${s.year}`,
  ].filter(Boolean);
  const income = `Money received in ${s.year}, counted when paid${timing.length ? `: ${timing.join("; ")}` : ""}.`;

  return (
    <article className="year-end-paper mx-auto max-w-[8.5in] rounded-md bg-white px-[0.7in] py-[0.6in] text-[13px] leading-snug text-neutral-900 shadow-2xl print:max-w-none print:rounded-none print:p-0 print:shadow-none">
      <header className="flex items-end justify-between border-b-2 border-neutral-900 pb-3">
        <div>
          {s.businessName && <p className="text-[13px] text-neutral-600">{s.businessName}</p>}
          <h1 className="text-[22px] font-bold">{s.year} year-end summary</h1>
        </div>
        <div className="text-right text-[12px] text-neutral-600">
          <div>Cash basis</div>
          <div>Prepared {prepared}</div>
        </div>
      </header>

      <PaperSection title="Income">
        <TotalRow label="Gross receipts" note="(Schedule C, line 1)" value={s.grossReceiptsCents} />
        <p className="mt-1.5 text-[12px] text-neutral-600">{income}</p>
      </PaperSection>

      <PaperSection title="Expenses by Schedule C line">
        {s.expenses.length === 0 ? (
          <p className="text-neutral-600">No business expenses in {s.year}.</p>
        ) : (
          <table className="num w-full border-collapse">
            <thead>
              <tr className="border-b border-neutral-300 text-left text-[11px] tracking-wide text-neutral-500 uppercase">
                <th className="w-14 py-1.5 font-semibold">Line</th>
                <th className="py-1.5 font-semibold">Category</th>
                <th className="py-1.5 text-right font-semibold">Spent</th>
                <th className="py-1.5 text-right font-semibold">Deductible</th>
              </tr>
            </thead>
            <tbody>
              {s.expenses.map((e) => (
                <tr key={`${e.line}-${e.name}`} className="border-b border-neutral-200">
                  <td className="py-1.5 text-neutral-600">{e.line ?? "None"}</td>
                  <td className="py-1.5">
                    {e.name}
                    {e.deductiblePercent !== 100 && <span className="text-neutral-500"> ({e.deductiblePercent}%)</span>}
                    {!e.line && <span className="text-neutral-500"> (needs a category)</span>}
                  </td>
                  <td className="py-1.5 text-right">{cents(e.spentCents)}</td>
                  <td className="py-1.5 text-right">{cents(e.deductibleCents)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-1.5 text-neutral-600">28</td>
                <td className="py-1.5">Total expenses</td>
                <td className="py-1.5 text-right">{cents(s.totalSpentCents)}</td>
                <td className="py-1.5 text-right">{cents(s.totalDeductibleCents)}</td>
              </tr>
            </tbody>
          </table>
        )}
        <div className="mt-3 border-t-2 border-neutral-900 pt-2">
          <TotalRow label="Net profit" note="(Schedule C, line 31)" value={s.netProfitCents} />
        </div>
      </PaperSection>

      <PaperSection title="Health insurance">
        <div className="flex justify-between">
          <span>
            Self-employed health insurance premiums <span className="text-neutral-500">(Schedule 1, line 17)</span>
          </span>
          <span className="num font-semibold">{formatMoney(s.healthInsuranceCents)}</span>
        </div>
      </PaperSection>

      <PaperSection title={`Estimated tax payments for ${s.year}`}>
        <div className="grid grid-cols-2 gap-8">
          <PaymentList title="Federal" jurisdiction="federal" summary={s} />
          <PaymentList title={s.stateName ?? "State"} jurisdiction="state" summary={s} />
        </div>
      </PaperSection>

      <p className="mt-8 text-[11px] text-neutral-500">Prepared from bank and card transactions in Zero Overhead. Amounts in US dollars.</p>
    </article>
  );
}

function PaperSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 break-inside-avoid">
      <h2 className="mb-2 text-[11px] font-bold tracking-wider text-neutral-500 uppercase">{title}</h2>
      {children}
    </section>
  );
}

function TotalRow({ label, note, value }: { label: string; note: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between text-[15px] font-bold">
      <span>
        {label} <span className="text-[12px] font-normal text-neutral-500">{note}</span>
      </span>
      <span className="num">{formatMoney(value)}</span>
    </div>
  );
}

function PaymentList({ title, jurisdiction, summary: s }: { title: string; jurisdiction: Jurisdiction; summary: YearEndSummary }) {
  const list = s.payments.filter((p) => p.jurisdiction === jurisdiction).sort((a, b) => a.quarter - b.quarter || a.paidOn.localeCompare(b.paidOn));
  const due = dueDates(s.year);
  const label = (p: TaxPayment) => {
    const d = due[p.quarter - 1];
    return `Q${p.quarter}, ${niceDate(d, d.startsWith(String(s.year)) ? { month: "short", day: "numeric" } : undefined)}`;
  };
  return (
    <div>
      <p className="mb-1 font-semibold">{title}</p>
      {list.length === 0 ? (
        <p className="text-neutral-600">None recorded</p>
      ) : (
        <>
          {list.map((p) => (
            <div key={p.id} className="num flex justify-between border-b border-neutral-200 py-1">
              <span>
                {label(p)}
                {p.appliedRefund && <span className="text-neutral-500"> refund applied</span>}
              </span>
              <span>{cents(p.amountCents)}</span>
            </div>
          ))}
          <div className="num flex justify-between py-1 font-semibold">
            <span>Total</span>
            <span>{formatMoney(list.reduce((t, p) => t + p.amountCents, 0))}</span>
          </div>
        </>
      )}
    </div>
  );
}

/** Every business transaction for the year, for the accountant's spreadsheet. */
function transactionsCsv(rows: BankTransaction[], categories: ExpenseCategory[]) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const quote = (v: string | number) => {
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const money = (n: number) => (n / 100).toFixed(2);
  const header = ["Date", "Description", "Account", "Amount", "Type", "Category", "Schedule C line", "Deductible", "Invoices paid", "Note"];
  const lines = [...rows]
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
    .map((t) => {
      const c = t.categoryId ? byId.get(t.categoryId) : undefined;
      const type = t.invoices.length ? "Invoice payment" : t.amountCents > 0 ? (c ? "Refund" : "Income") : "Expense";
      const line = c?.deduction === "health_insurance" ? "Schedule 1, line 17" : (c?.scheduleCLine ?? "");
      const deductible = t.amountCents < 0 || c ? money(Math.round((-t.amountCents * (c?.deductiblePercent ?? 100)) / 100)) : "";
      return [
        t.date,
        t.merchantName ? `${t.merchantName} (${t.name})` : t.name,
        t.accountName,
        money(t.amountCents),
        type,
        c?.name ?? (t.amountCents < 0 ? "Uncategorized" : ""),
        line,
        deductible,
        t.invoices.map((i) => i.number).join(" "),
        t.note ?? "",
      ].map(quote);
    });
  return [header, ...lines].map((l) => l.join(",")).join("\r\n") + "\r\n";
}
