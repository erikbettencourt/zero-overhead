import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon, FileTextIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { Jurisdiction, TaxQuarter, TaxSummary } from "../../shared/types";
import { formatMoney, parseMoney, toIsoDate } from "../../shared/time";
import { api } from "../api";
import { niceDate } from "../format";
import { useAction, useData } from "../state";
import { cn } from "@/lib/utils";
import { DatePicker } from "@/components/date-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Stat } from "./Reports";

/** The state's name for labels, or "State" until one is chosen. */
const stateName = (s: TaxSummary) => (s.state.chosen ? s.state.name : "State");
const QUARTER_LABEL = ["", "Q1", "Q2", "Q3", "Q4"];

/** Quarterly estimated tax, federal and state, from money received and business spending. */
export default function TaxesView({ year }: { year: number }) {
  const run = useAction();
  const [s, setS] = useState<TaxSummary | null>(null);
  const [recording, setRecording] = useState(false);

  const load = useCallback(async () => {
    const r = await run(() => api.taxes(year));
    if (r) setS(r);
  }, [run, year]);
  useEffect(() => {
    setS(null);
    void load();
  }, [load]);

  const currentYear = new Date().getFullYear();

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Taxes, {year}</h1>
            <div className="flex">
              <Button asChild variant="ghost" size="icon" aria-label="Previous year">
                <a href={`#/taxes/${year - 1}`}>
                  <ChevronLeftIcon />
                </a>
              </Button>
              <Button asChild variant="ghost" size="icon" aria-label="Next year">
                <a href={`#/taxes/${year + 1}`}>
                  <ChevronRightIcon />
                </a>
              </Button>
            </div>
            {year !== currentYear && (
              <Button asChild variant="link" size="sm">
                <a href={`#/taxes/${currentYear}`}>Back to {currentYear}</a>
              </Button>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">Cash basis: money received in {year}, less business spending in {year}.</p>
        </div>
        {s && (
          <div className="flex flex-wrap gap-2">
            {year <= currentYear && (
              <Button asChild variant="outline">
                <a href={`#/taxes/${year}/year-end`}>
                  <FileTextIcon />
                  Year-end summary
                </a>
              </Button>
            )}
            <Dialog open={recording} onOpenChange={setRecording}>
              <DialogTrigger asChild>
                <Button>
                  <PlusIcon />
                  Record payment
                </Button>
              </DialogTrigger>
              {recording && (
                <RecordPayment
                  summary={s}
                  onDone={() => {
                    setRecording(false);
                    void load();
                  }}
                />
              )}
            </Dialog>
          </div>
        )}
      </div>

      {!s ? (
        <p className="mt-10 text-muted-foreground">Loading…</p>
      ) : (
        <>
          {s.figuresYear !== s.year ? (
            <Card className="mt-4 border-now/40 p-4 text-sm">
              {s.year}'s tax figures aren't in the app yet, so this uses {s.figuresYear}'s brackets and limits.
            </Card>
          ) : (
            s.pendingFigures.length > 0 && (
              <p className="mt-3 text-sm text-muted-foreground">
                Uses {s.year}'s brackets. Still waiting on {s.pendingFigures.join(" and ")}, which carry over from {s.year - 1} for now.
              </p>
            )
          )}

          {!s.state.chosen && (
            <Card className="mt-4 border-now/40 p-4 text-sm">
              This estimate leaves out state tax until you choose your state.{" "}
              <a href="#/settings/taxes" className="font-semibold text-primary underline-offset-2 hover:underline">
                Choose it in Tax profile
              </a>
            </Card>
          )}

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {s.next ? (
              <Card className="border-primary/30 bg-primary/5 p-4">
                <p className="text-sm text-muted-foreground">
                  {QUARTER_LABEL[s.next.quarter]} due {niceDate(s.next.dueOn)}
                </p>
                <p className="num mt-1 text-2xl font-bold text-primary">{formatMoney(s.next.federalCents + s.next.stateCents)}</p>
                <p className="num mt-0.5 text-xs text-muted-foreground">
                  Federal {formatMoney(s.next.federalCents)}, {stateName(s)} {formatMoney(s.next.stateCents)}
                </p>
                {s.next.catchUpCents > 0 && (
                  <p className="num mt-1 text-xs text-muted-foreground">Includes {formatMoney(s.next.catchUpCents)} to catch up on earlier quarters.</p>
                )}
              </Card>
            ) : (
              <Stat label="Next payment" value="None due" tone="text-muted-foreground" hint={`Every ${s.year} payment is covered.`} />
            )}
            <Stat
              label={s.breakdown.projection === "actual" ? "Profit" : "Profit so far"}
              value={formatMoney(s.breakdown.profitCents)}
              hint={
                s.breakdown.projection === "projected"
                  ? `On pace for ${formatMoney(s.breakdown.projectedProfitCents)} this year`
                  : s.breakdown.projection === "expected"
                    ? `Using your forecast of ${formatMoney(s.breakdown.projectedProfitCents)}`
                    : undefined
              }
            />
            <Stat label="Paid so far" value={formatMoney(s.paidCents)} hint={`Of ${formatMoney(s.estimatedCents)} estimated for the year`} />
          </div>

          <Quarters summary={s} />
          <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
            <Breakdown summary={s} />
            <Payments summary={s} onChange={load} />
          </div>

          <p className="mt-6 text-xs text-muted-foreground">
            An estimate, not tax advice. It covers self-employment tax, the standard deduction, the 20% qualified business income deduction, federal brackets, and your
            state's rates, deductions and exemptions. It includes health insurance premiums marked in Spending, but doesn't know about credits, itemized deductions or
            retirement contributions, so check it against your accountant.
          </p>
        </>
      )}
    </div>
  );
}

const STATUS: Record<TaxQuarter["status"], { label: string; variant: "success" | "now" | "destructive" | "outline" }> = {
  paid: { label: "Paid", variant: "success" },
  due: { label: "Due next", variant: "now" },
  "past due": { label: "Short", variant: "destructive" },
  upcoming: { label: "Upcoming", variant: "outline" },
};

function Amount({ estimate, paid }: { estimate: number; paid: number }) {
  return (
    <div className="num text-right">
      <p className="font-semibold">{formatMoney(estimate)}</p>
      {paid > 0 && <p className={cn("text-xs", paid >= estimate ? "text-success" : "text-muted-foreground")}>Paid {formatMoney(paid)}</p>}
    </div>
  );
}

function Quarters({ summary: s }: { summary: TaxSummary }) {
  return (
    <Card className="mt-4 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Payment</TableHead>
            <TableHead>Due</TableHead>
            <TableHead className="text-right">Federal</TableHead>
            <TableHead className="text-right">{stateName(s)}</TableHead>
            <TableHead className="pr-5 text-right">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {s.quarters.map((q) => (
            <TableRow key={q.quarter} className="align-top">
              <TableCell className="pt-3 pl-5 font-semibold">{QUARTER_LABEL[q.quarter]}</TableCell>
              <TableCell className="num pt-3">{niceDate(q.dueOn)}</TableCell>
              <TableCell className="pt-3">
                <Amount estimate={q.federal.estimateCents} paid={q.federal.paidCents} />
              </TableCell>
              <TableCell className="pt-3">
                <Amount estimate={q.state.estimateCents} paid={q.state.paidCents} />
              </TableCell>
              <TableCell className="pt-3 pr-5 text-right">
                <Badge variant={STATUS[q.status].variant}>{STATUS[q.status].label}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {s.quarters.some((q) => q.status === "past due") && (
        <p className="border-t px-5 py-3 text-sm text-muted-foreground">
          A quarter comes up short when your income grew after you paid it. The difference is added to your next payment.
        </p>
      )}
      {s.safeHarbor && (
        <p className="border-t px-5 py-3 text-sm text-muted-foreground">
          Safe harbor: paying <span className="num font-semibold text-foreground">{formatMoney(s.safeHarbor.federalPerQuarterCents)}</span> federal and{" "}
          <span className="num font-semibold text-foreground">{formatMoney(s.safeHarbor.statePerQuarterCents)}</span> {stateName(s)} each quarter avoids underpayment
          penalties, whatever this year's income turns out to be. You'd settle any difference in April.
        </p>
      )}
    </Card>
  );
}

function Row({ label, value, strong, muted }: { label: ReactNode; value: number; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-4 py-1.5 text-sm", strong && "border-t pt-2.5 font-bold", muted && "text-muted-foreground")}>
      <span>{label}</span>
      <span className="num">{formatMoney(value)}</span>
    </div>
  );
}

function Breakdown({ summary: s }: { summary: TaxSummary }) {
  const b = s.breakdown;
  const p = s.profile;
  const meals = b.businessSpendingCents - b.deductibleSpendingCents;
  return (
    <Card className="p-5">
      <p className="font-bold">How it's worked out</p>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {p.filingStatus === "joint" ? "Married filing jointly" : "Single"}
        {p.w2WagesCents > 0 ? `, ${formatMoney(p.w2WagesCents)} of W-2 wages` : ", no W-2 job"}
        {p.otherIncomeCents > 0 ? `, ${formatMoney(p.otherIncomeCents)} other income` : ""}.{" "}
        <a href="#/settings/taxes" className="text-primary underline-offset-2 hover:underline">
          Change
        </a>
      </p>
      <div className="mt-3">
        <Row label="Received" value={b.receivedCents} />
        <Row label={meals > 0 ? "Business spending, half of meals" : "Business spending"} value={-b.deductibleSpendingCents} />
        <Row label="Profit so far" value={b.profitCents} strong />
        {b.projection !== "actual" && (
          <Row label={b.projection === "expected" ? "Your forecast for the year" : "Projected for the year"} value={b.projectedProfitCents} muted />
        )}
        <Row label="Self-employment tax" value={b.selfEmploymentTaxCents} />
        {b.additionalMedicareCents > 0 && <Row label="Additional Medicare tax" value={b.additionalMedicareCents} />}
        <Row label={`Federal income tax on ${formatMoney(b.federalTaxableIncomeCents)}`} value={b.federalIncomeTaxCents} />
        {b.healthInsuranceDeductionCents > 0 && (
          <Row
            label={b.projection === "actual" ? "After health insurance premiums of" : `After health insurance premiums of (${formatMoney(b.healthInsuranceCents)} so far)`}
            value={b.healthInsuranceDeductionCents}
            muted
          />
        )}
        <Row label="After a qualified business income deduction of" value={b.qbiDeductionCents} muted />
        <Row label="Federal total" value={b.federalTotalCents} strong />
        {!s.state.chosen ? (
          <Row label="State tax (choose your state in Tax profile)" value={0} muted />
        ) : s.state.noIncomeTax && b.localTaxCents === 0 ? (
          <Row label={`${s.state.name}, no state income tax`} value={0} muted />
        ) : (
          <>
            {!s.state.noIncomeTax && <Row label={`${s.state.name} income tax on ${formatMoney(b.stateTaxableIncomeCents)}`} value={b.stateIncomeTaxCents} />}
            {b.localTaxCents > 0 && <Row label="City or county income tax" value={b.localTaxCents} />}
            <Row label={`${s.state.name} total`} value={b.stateTotalCents} strong />
          </>
        )}
        {(p.w2FederalWithheldCents > 0 || p.w2StateWithheldCents > 0) && (
          <Row label="Less withholding from your job" value={-(p.w2FederalWithheldCents + p.w2StateWithheldCents)} muted />
        )}
      </div>
    </Card>
  );
}

function Payments({ summary: s, onChange }: { summary: TaxSummary; onChange: () => void }) {
  const run = useAction();
  const { notify } = useData();
  async function remove(id: number) {
    const ok = await run(async () => {
      await api.deleteTaxPayment(id);
      return true;
    });
    if (ok) {
      notify("Payment removed.");
      onChange();
    }
  }
  return (
    <Card className="p-5">
      <p className="font-bold">Payments for {s.year}</p>
      {s.payments.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          None recorded yet. Record each payment you make, and any refund from last year you applied to {s.year}.
        </p>
      ) : (
        <ul className="mt-2">
          {s.payments.map((p) => (
            <li key={p.id} className="flex items-center gap-3 border-t py-2 text-sm first:border-t-0">
              <span className="num w-28 shrink-0 text-muted-foreground">{niceDate(p.paidOn, { month: "short", day: "numeric", year: "numeric" })}</span>
              <span className="flex-1">
                {QUARTER_LABEL[p.quarter]} {p.jurisdiction === "federal" ? "federal" : stateName(s)}
                {p.appliedRefund && <span className="text-muted-foreground">, refund applied</span>}
                {p.note && <span className="text-muted-foreground">, {p.note}</span>}
              </span>
              <span className="num font-semibold">{formatMoney(p.amountCents)}</span>
              <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" aria-label="Remove payment" onClick={() => void remove(p.id)}>
                <Trash2Icon className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecordPayment({ summary: s, onDone }: { summary: TaxSummary; onDone: () => void }) {
  const run = useAction();
  const { notify } = useData();
  const nextQuarter = s.next?.quarter ?? 4;
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>("federal");
  const [refund, setRefund] = useState(false);
  const [quarter, setQuarter] = useState(nextQuarter);
  const [paidOn, setPaidOn] = useState(toIsoDate(new Date()));
  const suggested = s.next && s.next.quarter === quarter ? (jurisdiction === "federal" ? s.next.federalCents : s.next.stateCents) : 0;
  const [amount, setAmount] = useState(suggested ? (suggested / 100).toFixed(2) : "");
  const cents = parseMoney(amount);

  function pickJurisdiction(j: Jurisdiction) {
    setJurisdiction(j);
    const next = s.next && s.next.quarter === quarter ? (j === "federal" ? s.next.federalCents : s.next.stateCents) : 0;
    if (next && !refund) setAmount((next / 100).toFixed(2));
  }
  function pickRefund(on: boolean) {
    setRefund(on);
    // A refund applied to next year counts as paid on the return's due date, so it covers the April payment.
    if (on) {
      setQuarter(1);
      setPaidOn(s.quarters[0].dueOn);
      setAmount("");
    }
  }

  async function save() {
    if (!cents) return;
    const r = await run(() => api.recordTaxPayment({ taxYear: s.year, jurisdiction, quarter, paidOn, amountCents: cents, appliedRefund: refund }));
    if (r) {
      notify("Payment recorded.");
      onDone();
    }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Record a {s.year} payment</DialogTitle>
        <DialogDescription>Payments you've made, from IRS Direct Pay, your state's tax website or a check.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <Tabs value={jurisdiction} onValueChange={(v) => pickJurisdiction(v as Jurisdiction)}>
          <TabsList className="w-full">
            <TabsTrigger value="federal">Federal</TabsTrigger>
            <TabsTrigger value="state">{stateName(s)}</TabsTrigger>
          </TabsList>
        </Tabs>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={refund} onCheckedChange={(v) => pickRefund(v === true)} className="mt-0.5" />
          <span>
            Refund from last year's return, applied to {s.year}
            <span className="block text-xs text-muted-foreground">It counts as paid on the April due date, toward Q1.</span>
          </span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor="tp-quarter">For</Label>
            <Select value={String(quarter)} onValueChange={(v) => setQuarter(Number(v))}>
              <SelectTrigger id="tp-quarter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {s.quarters.map((q) => (
                  <SelectItem key={q.quarter} value={String(q.quarter)}>
                    {QUARTER_LABEL[q.quarter]}, due {niceDate(q.dueOn, { month: "short", day: "numeric" })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tp-date">Paid on</Label>
            <DatePicker id="tp-date" value={paidOn} onChange={setPaidOn} />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="tp-amount">Amount</Label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <Input id="tp-amount" inputMode="decimal" className="num pl-6" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </div>
          {cents === undefined && <p className="text-sm text-destructive">Enter an amount like 4,250.00.</p>}
        </div>
      </div>
      <DialogFooter>
        <Button disabled={!cents} onClick={() => void save()}>
          Record payment
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
