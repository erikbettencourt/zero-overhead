import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeftIcon, ChevronRightIcon, FilePlusIcon, TriangleAlertIcon } from "lucide-react";
import type { Report, Summary } from "../../shared/types";
import { formatHours, formatMoney, toIsoDate } from "../../shared/time";
import { api } from "../api";
import { niceDate } from "../format";
import { rangeFor, rangeLabel, type Range } from "../periods";
import { useAction, useData } from "../state";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NewInvoiceDialog } from "./NewInvoice";
import { DateMenu } from "./DateMenu";

const today = () => toIsoDate(new Date());

function go(range: Range, clientId?: number) {
  location.hash = `#/reports/${range.from}/${range.to}${clientId ? `/${clientId}` : ""}`;
}

/** Reports start with every client for a period; pick one to see its projects, tasks and entries. */
export default function ReportsView({ from, to, clientId }: { from?: string; to?: string; clientId?: number }) {
  const range: Range = from && to ? { from, to } : rangeFor("month", today());
  const [invoiceFor, setInvoiceFor] = useState<number | null>(null);

  return (
    <div>
      {clientId ? <ClientReport clientId={clientId} range={range} onInvoice={() => setInvoiceFor(clientId)} /> : <AllClients range={range} onInvoice={setInvoiceFor} />}
      <Dialog open={invoiceFor !== null} onOpenChange={(o) => !o && setInvoiceFor(null)}>
        {invoiceFor !== null && <NewInvoiceDialog key={invoiceFor} clientId={invoiceFor} range={range} onClose={() => setInvoiceFor(null)} />}
      </Dialog>
    </div>
  );
}

export function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn("num mt-1 text-2xl font-bold", tone)}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

export function Empty({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <Card className="mt-6 px-6 py-14 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      {children && <div className="mt-4 flex justify-center gap-2">{children}</div>}
    </Card>
  );
}

/* All clients */

function AllClients({ range, onInvoice }: { range: Range; onInvoice: (clientId: number) => void }) {
  const run = useAction();
  const { data } = useData();
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    let live = true;
    setSummary(null);
    void run(() => api.summary(range.from, range.to)).then((s) => live && s && setSummary(s));
    return () => {
      live = false;
    };
  }, [range.from, range.to, run]);

  const rows = summary?.clients ?? [];
  const sum = (k: "minutes" | "billableMinutes" | "earnedCents" | "invoicedCents" | "uninvoicedCents") => rows.reduce((s, r) => s + r[k], 0);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">What you logged and earned, across every client. Pick a client for the details.</p>
        </div>
      </div>

      <div className="mt-5">
        <DateMenu arrows range={range} onChange={(r) => go(r)} />
      </div>

      {data.clients.length === 0 ? (
        <Empty title="Reports appear once you have a client" body="Add a client and track some time, and it shows up here.">
          <Button asChild variant="outline">
            <a href="#/settings/clients">Add a client</a>
          </Button>
        </Empty>
      ) : !summary ? (
        <p className="mt-10 text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Hours" value={formatHours(sum("minutes"))} hint={`${formatHours(sum("billableMinutes"))} billable`} />
            <Stat label="Earned" value={formatMoney(sum("earnedCents"))} hint="Billable time at your rates" />
            <Stat label="Invoiced" value={formatMoney(sum("invoicedCents"))} tone={sum("invoicedCents") ? undefined : "text-muted-foreground"} />
            <Stat label="Not invoiced" value={formatMoney(sum("uninvoicedCents"))} tone={sum("uninvoicedCents") ? "text-now" : "text-muted-foreground"} hint="Still to bill for this period" />
          </div>

          {rows.length === 0 ? (
            <Empty title={`No time logged in ${rangeLabel(range)}`} body="Pick another period, or track some time first." />
          ) : (
            <Card className="mt-4 overflow-hidden">
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Client</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead className="text-right">Earned</TableHead>
                    <TableHead className="text-right">Invoiced</TableHead>
                    <TableHead className="text-right">Not invoiced</TableHead>
                    <TableHead className="w-32 pr-5" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.clientId} className="hover:bg-muted/40">
                      <TableCell className="pl-5">
                        <a href={`#/reports/${range.from}/${range.to}/${r.clientId}`} className="group inline-flex items-center gap-1 font-bold hover:underline">
                          {r.clientName}
                          <ChevronRightIcon className="size-4 text-muted-foreground group-hover:text-foreground" />
                        </a>
                        {r.archived && (
                          <Badge variant="secondary" className="ml-2">
                            Archived
                          </Badge>
                        )}
                        {r.missingRateMinutes > 0 && (
                          <Badge variant="destructive" className="ml-2">
                            <TriangleAlertIcon />
                            {formatHours(r.missingRateMinutes)} h without a rate
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="num text-right">{formatHours(r.minutes)}</TableCell>
                      <TableCell className="num text-right font-semibold">{formatMoney(r.earnedCents)}</TableCell>
                      <TableCell className={cn("num text-right", !r.invoicedCents && "text-muted-foreground")}>{formatMoney(r.invoicedCents)}</TableCell>
                      <TableCell className={cn("num text-right font-semibold", !r.uninvoicedCents && "font-normal text-muted-foreground")}>{formatMoney(r.uninvoicedCents)}</TableCell>
                      <TableCell className="pr-5 text-right">
                        {r.uninvoicedMinutes > 0 && !r.archived && (
                          <Button variant="outline" size="sm" onClick={() => onInvoice(r.clientId)}>
                            <FilePlusIcon />
                            Invoice
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="pl-5">Total</TableCell>
                    <TableCell className="num text-right">{formatHours(sum("minutes"))}</TableCell>
                    <TableCell className="num text-right">{formatMoney(sum("earnedCents"))}</TableCell>
                    <TableCell className="num text-right">{formatMoney(sum("invoicedCents"))}</TableCell>
                    <TableCell className="num text-right">{formatMoney(sum("uninvoicedCents"))}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            </Card>
          )}
        </>
      )}
    </>
  );
}

/* One client */

function ClientReport({ clientId, range, onInvoice }: { clientId: number; range: Range; onInvoice: () => void }) {
  const { clientById } = useData();
  const run = useAction();
  const [report, setReport] = useState<Report | null>(null);
  const client = clientById.get(clientId);

  useEffect(() => {
    let live = true;
    setReport(null);
    void run(() => api.report(clientId, range.from, range.to)).then((r) => live && r && setReport(r));
    return () => {
      live = false;
    };
  }, [clientId, range.from, range.to, run]);

  const billableLines = report?.lines.filter((l) => l.billable) ?? [];
  const otherLines = report?.lines.filter((l) => !l.billable) ?? [];
  const invoicedCents = report ? report.amountCents - report.uninvoicedAmountCents : 0;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
        <a href={`#/reports/${range.from}/${range.to}`}>
          <ArrowLeftIcon />
          All clients
        </a>
      </Button>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{client?.name ?? "Client"}</h1>
        {report && report.uninvoicedMinutes > 0 && (
          <Button onClick={onInvoice}>
            <FilePlusIcon />
            Invoice {formatMoney(report.uninvoicedAmountCents)}
          </Button>
        )}
      </div>

      <div className="mt-5">
        <DateMenu arrows range={range} onChange={(r) => go(r, clientId)} />
      </div>

      {!report ? (
        <p className="mt-10 text-muted-foreground">Loading…</p>
      ) : report.lines.length === 0 ? (
        <Empty title={`No time for ${client?.name ?? "this client"} in ${rangeLabel(range)}`} body="Pick another period, or track time for this client first." />
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Hours" value={formatHours(report.totalMinutes)} hint={`${formatHours(report.billableMinutes)} billable`} />
            <Stat label="Earned" value={formatMoney(report.amountCents)} />
            <Stat label="Invoiced" value={formatMoney(invoicedCents)} tone={invoicedCents ? undefined : "text-muted-foreground"} />
            <Stat label="Not invoiced" value={formatMoney(report.uninvoicedAmountCents)} tone={report.uninvoicedAmountCents ? "text-now" : "text-muted-foreground"} />
          </div>

          {report.missingRates.length > 0 && (
            <Card className="mt-4 flex items-start gap-3 border-destructive/40 p-4">
              <TriangleAlertIcon className="mt-0.5 size-5 shrink-0 text-destructive" />
              <div>
                <p className="font-semibold">Set a rate before invoicing</p>
                <p className="mt-0.5 text-sm text-muted-foreground">These have billable time but no rate: {report.missingRates.join("; ")}.</p>
                <Button asChild variant="outline" size="sm" className="mt-3">
                  <a href="#/settings/projects">Open projects</a>
                </Button>
              </div>
            </Card>
          )}

          <SummaryTable title="By project and task" lines={billableLines} />
          {otherLines.length > 0 && <SummaryTable title="Not billable" lines={otherLines} />}

          <h2 className="mt-10 text-lg font-bold">Detailed time</h2>
          <Card className="mt-3 overflow-hidden">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Date</TableHead>
                  <TableHead>Project and task</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="pr-5">Invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.entries.map((e) => (
                  <TableRow key={e.id} className="align-top">
                    <TableCell className="num pl-5 whitespace-nowrap">{niceDate(e.date, { month: "short", day: "numeric" })}</TableCell>
                    <TableCell>{e.description}</TableCell>
                    <TableCell className="text-muted-foreground">{e.note}</TableCell>
                    <TableCell className="num text-right">{formatHours(e.minutes)}</TableCell>
                    <TableCell className="pr-5 whitespace-nowrap">
                      {e.invoiceId ? (
                        <a href={`#/invoices/${e.invoiceId}`}>
                          <Badge variant="outline" className="hover:border-foreground hover:text-foreground">
                            {e.invoiceNumber}
                          </Badge>
                        </a>
                      ) : e.invoicedElsewhere ? (
                        <Badge variant="secondary">In Harvest</Badge>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}

function SummaryTable({ title, lines }: { title: string; lines: Report["lines"] }) {
  if (lines.length === 0) return null;
  const billable = lines[0].billable;
  return (
    <>
      <h2 className="mt-10 text-lg font-bold">{title}</h2>
      <Card className="mt-3 overflow-hidden">
        <Table className="min-w-[520px]">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Project and task</TableHead>
              <TableHead className="text-right">Hours</TableHead>
              {billable && <TableHead className="text-right">Rate</TableHead>}
              {billable && <TableHead className="pr-5 text-right">Amount</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={`${l.projectId}:${l.taskId}`}>
                <TableCell className="pl-5">{l.description}</TableCell>
                <TableCell className="num text-right">{formatHours(l.minutes)}</TableCell>
                {billable && (
                  <TableCell className="num text-right">{l.rateCents != null ? formatMoney(l.rateCents) : <Badge variant="destructive">No rate</Badge>}</TableCell>
                )}
                {billable && <TableCell className="num pr-5 text-right">{formatMoney(l.amountCents)}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
          {billable && (
            <TableFooter>
              <TableRow>
                <TableCell className="pl-5">Total</TableCell>
                <TableCell className="num text-right">{formatHours(lines.reduce((s, l) => s + l.minutes, 0))}</TableCell>
                <TableCell />
                <TableCell className="num pr-5 text-right">{formatMoney(lines.reduce((s, l) => s + l.amountCents, 0))}</TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </Card>
    </>
  );
}
