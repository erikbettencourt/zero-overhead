import { useEffect, useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, TriangleAlertIcon } from "lucide-react";
import type { BillingPeriod, Report } from "../../shared/types";
import { addDays, formatHours, formatMoney } from "../../shared/time";
import { api } from "../api";
import { BILLING_LABEL, daysBetween, lastBillingPeriod, rangeLabel, shiftBilling, type Range } from "../periods";
import { useAction, useData } from "../state";
import { DatePicker } from "@/components/date-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Kind = BillingPeriod | "custom";

/**
 * The one place invoices are created. Opened from Invoices (blank) or from a Reports row (client and range filled in).
 * Render it inside a <Dialog>.
 */
export function NewInvoiceDialog({ clientId: initialClient, range: initialRange, onClose }: { clientId?: number; range?: Range; onClose: () => void }) {
  const { data, setData } = useData();
  const run = useAction();
  const clients = data.clients.filter((c) => !c.archived);
  const [clientId, setClientId] = useState<number | null>(initialClient ?? clients[0]?.id ?? null);
  const client = clients.find((c) => c.id === clientId);

  // Start from the range we were given, else the client's usual billing period.
  const [kind, setKind] = useState<Kind>(() => (initialRange ? "custom" : (client?.billingPeriod ?? "monthly")));
  const [range, setRange] = useState<Range>(() => initialRange ?? lastBillingPeriod(client?.billingPeriod ?? "monthly"));
  const [issuedOn, setIssuedOn] = useState(() => addDays(range.to, 1));
  const [dueOn, setDueOn] = useState<string | null>(null);
  const [makeDefault, setMakeDefault] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [creating, setCreating] = useState(false);
  // The first invoice asks where numbering starts, so it can carry on from QuickBooks or Harvest.
  const [isFirst, setIsFirst] = useState(false);
  const [number, setNumber] = useState(data.business.nextInvoiceNumber);
  const numberOk = /^[A-Za-z0-9._/-]*\d$/.test(number.trim()) && number.trim().length <= 40;

  useEffect(() => {
    void run(() => api.invoices()).then((list) => list && setIsFirst(list.length === 0));
  }, [run]);

  // A range that matches a preset shows as that preset, so a month from Reports reads as Monthly.
  useEffect(() => {
    if (!initialRange) return;
    for (const p of ["monthly", "quarterly", "biweekly"] as const) {
      const last = lastBillingPeriod(p, addDays(initialRange.to, 1));
      if (last.from === initialRange.from && last.to === initialRange.to) return setKind(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickClient(id: number) {
    setClientId(id);
    const c = clients.find((x) => x.id === id);
    if (c && !initialRange) {
      setKind(c.billingPeriod);
      applyRange(lastBillingPeriod(c.billingPeriod));
    }
    setDueOn(null);
  }

  function applyRange(r: Range) {
    setRange(r);
    setIssuedOn(addDays(r.to, 1));
    setDueOn(null);
  }

  function pickKind(k: Kind) {
    setKind(k);
    if (k !== "custom") applyRange(lastBillingPeriod(k));
    setMakeDefault(false);
  }

  useEffect(() => {
    if (!clientId || range.from > range.to) return setReport(null);
    let live = true;
    setReport(null);
    void run(() => api.report(clientId, range.from, range.to)).then((r) => live && r && setReport(r));
    return () => {
      live = false;
    };
  }, [clientId, range.from, range.to, run]);

  const terms = client?.paymentTermsDays ?? 15;
  const due = dueOn ?? addDays(issuedOn, terms);
  const net = daysBetween(issuedOn, due);
  const uninvoicedEntries = useMemo(
    () => (report?.entries ?? []).filter((e) => !e.invoiceId && !e.invoicedElsewhere && report?.lines.find((l) => l.description === e.description)?.billable),
    [report],
  );
  const canCreate = !!report && report.uninvoicedMinutes > 0 && report.missingRates.length === 0 && net >= 0 && range.from <= range.to && !creating && (!isFirst || numberOk);

  async function create() {
    if (!clientId) return;
    setCreating(true);
    if (makeDefault && client && kind !== "custom" && kind !== client.billingPeriod) {
      const saved = await run(() => api.updateClient(client.id, { billingPeriod: kind }));
      if (saved) setData((d) => ({ ...d, clients: d.clients.map((c) => (c.id === saved.id ? saved : c)) }));
    }
    const invoice = await run(() => api.createInvoice({ clientId, from: range.from, to: range.to, issuedOn, dueOn: due, ...(isFirst ? { number: number.trim() } : {}) }));
    setCreating(false);
    if (invoice) {
      onClose();
      location.hash = `#/invoices/${invoice.id}`;
    }
  }

  if (clients.length === 0) {
    return (
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
          <DialogDescription>Add a client and track some time first.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button asChild variant="outline">
            <a href="#/settings/clients" onClick={onClose}>
              Add a client
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>New invoice</DialogTitle>
        <DialogDescription>Bills every uninvoiced billable entry for the client in the period, summarized by project and task, with every entry in the hours report after it.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="ni-client">Client</Label>
          <Select value={clientId ? String(clientId) : ""} onValueChange={(v) => pickClient(Number(v))}>
            <SelectTrigger id="ni-client" className="font-semibold">
              <SelectValue placeholder="Choose a client" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label>Billing period</Label>
          <Tabs value={kind} onValueChange={(v) => pickKind(v as Kind)}>
            <TabsList className="w-full">
              <TabsTrigger value="monthly">Month</TabsTrigger>
              <TabsTrigger value="biweekly">Two weeks</TabsTrigger>
              <TabsTrigger value="quarterly">Quarter</TabsTrigger>
              <TabsTrigger value="custom">Custom</TabsTrigger>
            </TabsList>
          </Tabs>
          {kind === "custom" ? (
            <div className="grid grid-cols-2 gap-2">
              <DatePicker id="ni-from" value={range.from} onChange={(d) => applyRange({ from: d, to: range.to < d ? d : range.to })} />
              <DatePicker id="ni-to" value={range.to} onChange={(d) => applyRange({ from: range.from > d ? d : range.from, to: d })} />
            </div>
          ) : (
            <div className="flex">
              <Button variant="outline" size="icon" className="rounded-r-none" aria-label="Earlier period" onClick={() => applyRange(shiftBilling(kind, range, -1))}>
                <ChevronLeftIcon />
              </Button>
              <div className="-mx-px flex h-9 flex-1 items-center justify-center border border-input bg-card px-3 text-sm font-semibold shadow-xs">{rangeLabel(range)}</div>
              <Button variant="outline" size="icon" className="rounded-l-none" aria-label="Later period" onClick={() => applyRange(shiftBilling(kind, range, 1))}>
                <ChevronRightIcon />
              </Button>
            </div>
          )}
          {client && kind !== "custom" && kind !== client.billingPeriod && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox checked={makeDefault} onCheckedChange={(v) => setMakeDefault(v === true)} />
              Bill {client.name} {BILLING_LABEL[kind].toLowerCase()} from now on
            </label>
          )}
        </div>

        {isFirst && (
          <div className="grid gap-2 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <Label htmlFor="ni-number">What number should your first invoice be?</Label>
            <Input id="ni-number" className="num max-w-48 bg-card" value={number} onChange={(e) => setNumber(e.target.value)} />
            {numberOk ? (
              <p className="text-xs text-muted-foreground">
                To carry on from QuickBooks or Harvest, use the number after your last invoice there. Every invoice after this counts up from it.
              </p>
            ) : (
              <p className="text-xs text-destructive">End it with a digit, like 1043 or EB-0042, so the next one can count up.</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor="ni-issued">Invoice date</Label>
            <DatePicker
              id="ni-issued"
              value={issuedOn}
              onChange={(d) => {
                setIssuedOn(d);
                setDueOn(null);
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ni-due" className="justify-between">
              Due date <span className="font-normal text-muted-foreground">{net >= 0 ? `Net ${net}` : "Before invoice date"}</span>
            </Label>
            <DatePicker id="ni-due" value={due} onChange={setDueOn} />
          </div>
        </div>

        <div className="rounded-lg border bg-muted/50 px-4 py-3">
          {!report ? (
            <p className="text-sm text-muted-foreground">Checking the period…</p>
          ) : report.uninvoicedMinutes === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing left to invoice for {client?.name} in {rangeLabel(range)}.
              {report.totalMinutes > 0 && " Everything in this period is already on an invoice or not billable."}
            </p>
          ) : (
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <p className="font-semibold">
                  {uninvoicedEntries.length} {uninvoicedEntries.length === 1 ? "entry" : "entries"}, <span className="num">{formatHours(report.uninvoicedMinutes)}</span> hours
                </p>
                <p className="text-sm text-muted-foreground">
                  {client?.name}, {rangeLabel(range)}
                </p>
              </div>
              <span className="num text-2xl font-bold">{formatMoney(report.uninvoicedAmountCents)}</span>
            </div>
          )}
          {report && report.missingRates.length > 0 && (
            <p className="mt-2 flex gap-2 text-sm text-destructive">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              Set a rate first: {report.missingRates.join("; ")}.
            </p>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!canCreate} onClick={() => void create()}>
          {creating ? "Creating…" : "Create invoice"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

