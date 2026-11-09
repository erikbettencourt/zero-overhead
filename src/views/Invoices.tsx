import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeftIcon, CalendarIcon, CheckIcon, FilePlusIcon, PrinterIcon, Undo2Icon } from "lucide-react";
import type { InvoiceDetail, InvoiceStatus, InvoiceSummary } from "../../shared/types";
import { addDays, formatHours, formatMoney, toIsoDate } from "../../shared/time";
import { api } from "../api";
import { niceDate, periodLabel } from "../format";
import { useAction, useData } from "../state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DatePicker } from "@/components/date-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty } from "./Reports";
import { NewInvoiceDialog } from "./NewInvoice";

/** Unpaid past its due date. Nothing to set by hand. */
function isOverdue(i: { status: InvoiceStatus; dueOn: string | null }) {
  return i.status === "unpaid" && !!i.dueOn && i.dueOn < toIsoDate(new Date());
}

function StatusBadge({ invoice }: { invoice: { status: InvoiceStatus; dueOn: string | null } }) {
  if (isOverdue(invoice)) return <Badge variant="destructive">Overdue</Badge>;
  return invoice.status === "paid" ? <Badge variant="success">Paid</Badge> : <Badge variant="now">Unpaid</Badge>;
}

export function InvoiceList() {
  const run = useAction();
  const [invoices, setInvoices] = useState<InvoiceSummary[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void run(() => api.invoices()).then((list) => list && setInvoices(list));
  }, [run]);

  const list = invoices ?? [];
  const unpaid = list.filter((i) => i.status === "unpaid");
  const outstanding = unpaid.reduce((s, i) => s + i.totalCents, 0);
  const overdue = unpaid.filter(isOverdue).reduce((s, i) => s + i.totalCents, 0);
  const year = String(new Date().getFullYear());
  const paidThisYear = list.filter((i) => i.status === "paid" && (i.paidOn ?? "").startsWith(year)).reduce((s, i) => s + i.totalCents, 0);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">One per client and billing period. Print or save each one as a PDF to send.</p>
        </div>
        <Dialog open={creating} onOpenChange={setCreating}>
          <DialogTrigger asChild>
            <Button>
              <FilePlusIcon />
              New invoice
            </Button>
          </DialogTrigger>
          {creating && <NewInvoiceDialog onClose={() => setCreating(false)} />}
        </Dialog>
      </div>

      {invoices === null ? (
        <p className="mt-10 text-muted-foreground">Loading…</p>
      ) : invoices.length === 0 ? (
        <Empty title="No invoices yet" body="Create one for a client and billing period, from the hours you tracked.">
          <Button variant="outline" onClick={() => setCreating(true)}>
            <FilePlusIcon />
            New invoice
          </Button>
        </Empty>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Outstanding" value={formatMoney(outstanding)} />
            <Stat label="Overdue" value={formatMoney(overdue)} tone={overdue > 0 ? "text-destructive" : "text-muted-foreground"} />
            <Stat label={`Received in ${year}`} value={formatMoney(paidThisYear)} />
          </div>
          <Card className="mt-4 overflow-hidden">
            <Table className="min-w-[680px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Number</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="pr-5">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((i) => (
                  <TableRow key={i.id} className="relative cursor-pointer hover:bg-muted/50">
                    <TableCell className="num pl-5 font-bold">
                      <a href={`#/invoices/${i.id}`} className="after:absolute after:inset-0">
                        {i.number}
                      </a>
                    </TableCell>
                    <TableCell>{i.clientName}</TableCell>
                    <TableCell className="text-muted-foreground">{periodLabel(i.periodStart, i.periodEnd)}</TableCell>
                    <TableCell className="num">{niceDate(i.issuedOn)}</TableCell>
                    <TableCell className="num">{niceDate(i.dueOn)}</TableCell>
                    <TableCell className="num text-right font-semibold">{formatMoney(i.totalCents)}</TableCell>
                    <TableCell className="pr-5">
                      <StatusBadge invoice={i} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`num mt-1 text-2xl font-bold ${tone ?? ""}`}>{value}</p>
    </Card>
  );
}

export function InvoicePage({ id }: { id: number }) {
  const run = useAction();
  const { notify } = useData();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [paidOn, setPaidOn] = useState(() => toIsoDate(new Date()));
  const [payOpen, setPayOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);
  const [dates, setDates] = useState({ issuedOn: "", dueOn: "" });

  useEffect(() => {
    setInvoice(null);
    void run(() => api.invoice(id)).then((inv) => (inv ? setInvoice(inv) : setMissing(true)));
  }, [id, run]);

  useEffect(() => {
    if (!invoice) return;
    // Browsers use the page title as the suggested PDF file name.
    document.title = `Invoice ${invoice.number} ${invoice.client.name}`;
    return () => {
      document.title = "Zero Overhead";
    };
  }, [invoice]);

  if (missing)
    return (
      <Empty title="That invoice doesn't exist" body="It may have been deleted.">
        <Button asChild variant="outline">
          <a href="#/invoices">All invoices</a>
        </Button>
      </Empty>
    );
  if (!invoice) return <p className="text-muted-foreground">Loading…</p>;

  async function update(body: Parameters<typeof api.updateInvoice>[1], message: string) {
    const updated = await run(() => api.updateInvoice(id, body));
    if (updated) {
      setInvoice(updated);
      notify(message);
    }
    return updated;
  }

  async function deleteInvoice() {
    const ok = await run(async () => {
      await api.deleteInvoice(id);
      return true;
    });
    if (ok) {
      notify(`Invoice ${invoice!.number} deleted. Its hours can be invoiced again.`);
      location.hash = "#/invoices";
    }
  }

  const s = invoice.status;

  return (
    <div>
      <div className="mb-6 print:hidden">
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <a href="#/invoices">
            <ArrowLeftIcon />
            All invoices
          </a>
        </Button>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="num text-2xl font-bold tracking-tight">{invoice.number}</h1>
          <StatusBadge invoice={invoice} />
          <span className="text-sm text-muted-foreground">
            {invoice.client.name}, {formatMoney(invoice.totalCents)}
            {invoice.paidOn && s === "paid" && !invoice.deposit && `, received ${niceDate(invoice.paidOn)}`}
            {invoice.deposit && s === "paid" && (
              <>
                , paid by the{" "}
                <a href={`#/spending/business/${invoice.deposit.date}/${invoice.deposit.date}`} className="font-semibold">
                  deposit on {niceDate(invoice.deposit.date)}
                </a>
                {invoice.deposit.alsoPaid.length > 0 && `, along with ${invoice.deposit.alsoPaid.join(", ")}`}
              </>
            )}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {s === "unpaid" && (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" className="text-muted-foreground hover:text-destructive">
                    Delete
                  </Button>
                }
                title={`Delete invoice ${invoice.number}?`}
                description="Its hours become available to invoice again, on their own or combined into another invoice."
                confirmLabel="Delete invoice"
                onConfirm={deleteInvoice}
              />
            )}
            {s === "unpaid" && (
              <Dialog
                open={datesOpen}
                onOpenChange={(o) => {
                  setDatesOpen(o);
                  if (o) setDates({ issuedOn: invoice.issuedOn ?? toIsoDate(new Date()), dueOn: invoice.dueOn ?? addDays(invoice.issuedOn ?? toIsoDate(new Date()), 15) });
                }}
              >
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <CalendarIcon />
                    Dates
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Invoice dates</DialogTitle>
                    <DialogDescription>You can change these until the invoice is paid.</DialogDescription>
                  </DialogHeader>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                      <Label htmlFor="ed-issued">Issue date</Label>
                      <DatePicker id="ed-issued" value={dates.issuedOn} onChange={(d) => setDates((x) => ({ ...x, issuedOn: d }))} />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="ed-due">Due date</Label>
                      <DatePicker id="ed-due" value={dates.dueOn} onChange={(d) => setDates((x) => ({ ...x, dueOn: d }))} />
                    </div>
                  </div>
                  {dates.dueOn < dates.issuedOn && <p className="text-sm text-destructive">The due date is before the issue date.</p>}
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDatesOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      disabled={dates.dueOn < dates.issuedOn}
                      onClick={async () => {
                        if (await update(dates, "Dates updated.")) setDatesOpen(false);
                      }}
                    >
                      Save dates
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
            {s === "unpaid" && !invoice.markPaidByHand && (
              <Button asChild variant="outline" title="Match the deposit that paid it, and it's marked paid on the day the money arrived.">
                <a href="#/spending/review">
                  <CheckIcon />
                  Find its deposit
                </a>
              </Button>
            )}
            {s === "unpaid" && invoice.markPaidByHand && (
              <Dialog open={payOpen} onOpenChange={setPayOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <CheckIcon />
                    Mark as paid
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Mark as paid</DialogTitle>
                    <DialogDescription>
                      {invoice.number} for {invoice.client.name}, {formatMoney(invoice.totalCents)}. Use the day the money arrived, since that's the date it counts as income.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-2">
                    <Label htmlFor="paid-on">Date received</Label>
                    <DatePicker id="paid-on" value={paidOn} onChange={setPaidOn} />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setPayOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={async () => {
                        if (await update({ status: "paid", paidOn }, `Invoice ${invoice.number} marked as paid.`)) setPayOpen(false);
                      }}
                    >
                      Mark as paid
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
            {s === "paid" && (
              <Button variant="outline" onClick={() => void update({ status: "unpaid" }, `Invoice ${invoice.number} marked as unpaid.`)}>
                <Undo2Icon />
                Mark as unpaid
              </Button>
            )}
            <Button onClick={() => window.print()}>
              <PrinterIcon />
              Print or save PDF
            </Button>
          </div>
        </div>
      </div>

      <InvoiceDocument invoice={invoice} />
    </div>
  );
}

function Block({ lines }: { lines: (string | null | undefined)[] }) {
  return (
    <>
      {lines
        .filter(Boolean)
        .flatMap((l) => l!.split("\n"))
        .map((l, i) => (
          <span key={i} className="block">
            {l}
          </span>
        ))}
    </>
  );
}

/** 2026-12-01 -> 12/01/2026, the way Harvest prints dates. */
function usDate(iso: string | null) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function daysBetween(a: string, b: string) {
  const t = (iso: string) => Date.UTC(...(iso.split("-").map(Number) as [number, number, number]));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

/** A label on the left, a thin rule, then the content. The building block of the Harvest layout. */
function Labeled({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`grid grid-cols-[6.5rem_1fr] ${className ?? ""}`}>
      <div className="pr-4 text-right text-muted-foreground">{label}</div>
      <div className="border-l border-border pl-4">{children}</div>
    </div>
  );
}

/** The hours behind an invoice, starting on its own page: every entry with its date, project, task and note. */
function HoursReport({ invoice }: { invoice: InvoiceDetail }) {
  const entries = [...invoice.entries].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const total = entries.reduce((s, e) => s + e.minutes, 0);
  const [from, to] = [usDate(invoice.periodStart), usDate(invoice.periodEnd)];

  return (
    <section className="invoice-page mt-6 rounded-xl border border-border bg-card px-[0.6in] py-[0.55in] shadow-xs print:mt-0 print:break-before-page print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <header className="flex items-end justify-between gap-8">
        <div>
          <h2 className="text-xl font-bold tracking-wide">HOURS REPORT</h2>
          <p className="mt-1">
            {invoice.client.name}, {from} to {to}
          </p>
        </div>
        <p className="text-right">
          Invoice ID <span className="num font-bold">{invoice.number}</span>
        </p>
      </header>

      <table className="mt-8 w-full border-collapse">
        <thead className="print:table-header-group">
          <tr className="border-b border-border text-left text-[11.5px]">
            <th className="w-[0.95in] py-2 pr-3 font-bold">Date</th>
            <th className="w-[2.1in] border-l border-border px-3 py-2 font-bold">Project and Task</th>
            <th className="border-l border-border px-3 py-2 font-bold">Notes</th>
            <th className="w-[0.75in] border-l border-border py-2 pl-3 text-right font-bold">Hours</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b border-border align-top break-inside-avoid even:bg-[#f6f6f6]">
              <td className="num py-2.5 pr-3 whitespace-nowrap">{usDate(e.date)}</td>
              <td className="border-l border-border px-3 py-2.5">{e.description}</td>
              <td className="border-l border-border px-3 py-2.5 whitespace-pre-line">{e.note}</td>
              <td className="num border-l border-border py-2.5 pl-3 text-right">{formatHours(e.minutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 flex items-baseline justify-end gap-10 break-inside-avoid">
        <span className="text-base font-bold">Total Hours</span>
        <span className="num text-base font-bold">{formatHours(total)}</span>
      </div>
    </section>
  );
}

export function InvoiceDocument({ invoice }: { invoice: InvoiceDetail }) {
  const b = invoice.business;
  const net = invoice.issuedOn && invoice.dueOn ? daysBetween(invoice.issuedOn, invoice.dueOn) : null;
  const notes = [b.paymentInstructions, invoice.notes].filter(Boolean);

  return (
    <article className="invoice-doc mx-auto max-w-[8.5in] text-[12.5px] leading-snug">
      <section className="invoice-page relative rounded-xl border border-border bg-card px-[0.6in] py-[0.55in] shadow-xs print:rounded-none print:border-0 print:p-0 print:shadow-none">

        <header className="flex items-start justify-between gap-8">
          <div className="pt-1">
            {b.logo ? (
              <img src={b.logo} alt={b.name} className="max-h-14 max-w-[3.25in] object-contain object-left" />
            ) : (
              <p className="text-[26px] leading-none font-bold tracking-tight">{b.name}</p>
            )}
          </div>
          <div className="w-[3.1in]">
            <h1 className="pl-[calc(6.5rem+1rem+1px)] text-xl font-bold tracking-wide">INVOICE</h1>
            <Labeled label="From" className="mt-3">
              <p className="font-bold">{b.name}</p>
              <div className="mt-0.5">
                <Block lines={[b.address, b.email, b.phone]} />
              </div>
            </Labeled>
          </div>
        </header>

        <div className="mt-10 flex items-start justify-between gap-8">
          <Labeled label="Invoice For" className="flex-1 [&>div:first-child]:text-left [&>div:first-child]:whitespace-nowrap">
            <p className="font-bold">{invoice.client.name}</p>
            <div className="mt-0.5">
              <Block lines={[invoice.client.address]} />
            </div>
          </Labeled>
          <div className="grid w-[3.1in] gap-1.5">
            <Labeled label="Invoice ID">
              <span className="num font-bold">{invoice.number}</span>
            </Labeled>
            <Labeled label="Issue Date">
              <span className="num">{usDate(invoice.issuedOn)}</span>
            </Labeled>
            <Labeled label="Due Date">
              <span className="num">
                {usDate(invoice.dueOn)}
                {net != null && net > 0 && ` (Net ${net})`}
              </span>
            </Labeled>
          </div>
        </div>

        <Labeled label="Subject" className="mt-8 [&>div:first-child]:text-left">
          Invoice from {b.name}
        </Labeled>

        <table className="mt-10 w-full border-collapse">
          <thead>
            <tr className="border-b border-border text-left text-[11.5px]">
              <th className="w-[1.05in] py-2 pr-3 font-bold">Item Type</th>
              <th className="border-l border-border px-3 py-2 font-bold">Description</th>
              <th className="w-[0.85in] border-l border-border px-3 py-2 text-right font-bold">Quantity</th>
              <th className="w-[0.95in] border-l border-border px-3 py-2 text-right font-bold">Unit Price</th>
              <th className="w-[0.95in] border-l border-border py-2 pl-3 text-right font-bold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l, i) => (
              <tr key={i} className="border-b border-border align-top break-inside-avoid even:bg-[#f6f6f6]">
                <td className="py-3 pr-3">Service</td>
                <td className="border-l border-border px-3 py-3">{l.description}</td>
                <td className="num border-l border-border px-3 py-3 text-right">{formatHours(l.minutes)}</td>
                <td className="num border-l border-border px-3 py-3 text-right">{formatMoney(l.rateCents)}</td>
                <td className="num border-l border-border py-3 pl-3 text-right font-bold">{formatMoney(l.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 flex items-baseline justify-end gap-10 break-inside-avoid">
          <span className="text-base font-bold">Amount Due</span>
          <span className="num text-base font-bold">{formatMoney(invoice.totalCents)}</span>
        </div>

        {notes.length > 0 && (
          <div className="mt-12 border-t border-border pt-3 break-inside-avoid">
            <p className="text-[11.5px] font-bold">Notes</p>
            <div className="mt-3 space-y-3">
              {notes.map((n, i) => (
                <div key={i}>
                  <Block lines={[n]} />
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {invoice.entries.length > 0 && <HoursReport invoice={invoice} />}
    </article>
  );
}
