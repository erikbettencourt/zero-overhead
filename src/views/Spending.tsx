import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2Icon, FileSpreadsheetIcon, FileUpIcon, Landmark, RefreshCwIcon, SearchIcon, Undo2Icon, WandSparklesIcon, XIcon } from "lucide-react";
import type { BankOverview, BankTransaction, InvoiceRef, InvoiceSummary, SpendingSummary, TransactionKind } from "../../shared/types";
import { formatMoney, toIsoDate } from "../../shared/time";
import { api } from "../api";
import { niceDate } from "../format";
import { rangeFor, rangeLabel, type Range } from "../periods";
import { useAction, useData } from "../state";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, Stat } from "./Reports";
import { DateMenu } from "./DateMenu";
import { QuickBooksImport } from "./QuickBooksImport";
import { StatementImport } from "./StatementImport";
import { CategoryItems, useMarkCategoryUsed } from "./CategoryItems";

export type SpendingView = "review" | "business" | "personal" | "transfer" | "all";
const VIEWS: [SpendingView, string][] = [
  ["review", "To review"],
  ["business", "Business"],
  ["personal", "Personal"],
  ["transfer", "Transfers"],
  ["all", "All"],
];


function go(view: SpendingView, range: Range) {
  location.hash = `#/spending/${view}/${range.from}/${range.to}`;
}

/** Every bank and card transaction, sorted into business and personal. */
export default function SpendingView({ view, from, to, initialSearch = "" }: { view: SpendingView; from?: string; to?: string; initialSearch?: string }) {
  const run = useAction();
  const { data, notify } = useData();
  const markUsed = useMarkCategoryUsed();
  const range: Range = from && to ? { from, to } : rangeFor("year", toIsoDate(new Date()));
  // To review shows every date unless you pick some.
  const reviewRange: Range | null = from && to ? { from, to } : null;
  const [accountId, setAccountId] = useState<number | undefined>();
  const [rows, setRows] = useState<BankTransaction[] | null>(null);
  const [summary, setSummary] = useState<SpendingSummary | null>(null);
  const [bank, setBank] = useState<BankOverview | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [ruleFor, setRuleFor] = useState<BankTransaction | null>(null);
  const [importing, setImporting] = useState(false);
  const [statement, setStatement] = useState(false);
  // Search and the category filter. The search box waits a moment for typing to stop.
  const [search, setSearch] = useState(initialSearch);
  const [q, setQ] = useState(initialSearch);
  const [categoryId, setCategoryId] = useState<number | "none" | undefined>();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const lastClicked = useRef<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    const [list, sum] = await Promise.all([
      run(() => api.transactions({ view, accountId, q: q || undefined, categoryId, ...(view === "review" ? (reviewRange ?? {}) : range) })),
      run(() => api.spendingSummary(range.from, range.to)),
    ]);
    if (list) setRows(list);
    if (sum) setSummary(sum);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, view, accountId, q, categoryId, range.from, range.to, from, to]);

  useEffect(() => {
    setRows(null);
    setSelected(new Set());
    lastClicked.current = null;
    void load();
  }, [load]);
  useEffect(() => {
    void run(() => api.bank()).then((b) => b && setBank(b));
  }, [run]);

  // Deposits that paid an invoice can't be changed in bulk.
  const selectable = useMemo(() => (rows ?? []).filter((t) => t.invoices.length === 0), [rows]);
  const allSelected = selectable.length > 0 && selectable.every((t) => selected.has(t.id));

  function toggle(t: BankTransaction, shift: boolean) {
    const list = rows ?? [];
    const next = new Set(selected);
    const on = !selected.has(t.id);
    const at = list.findIndex((x) => x.id === t.id);
    const from = shift && lastClicked.current !== null ? list.findIndex((x) => x.id === lastClicked.current) : -1;
    // Shift-click selects (or clears) everything between this and the last one clicked.
    const range = from >= 0 ? list.slice(Math.min(from, at), Math.max(from, at) + 1) : [t];
    for (const x of range) if (x.invoices.length === 0) on ? next.add(x.id) : next.delete(x.id);
    lastClicked.current = t.id;
    setSelected(next);
  }

  async function markSelected(kind: TransactionKind, category?: number | null) {
    const ids = [...selected];
    const r = await run(() => api.updateTransactions(ids, { kind, ...(kind === "business" ? { categoryId: category ?? null } : {}) }));
    if (!r) return;
    markUsed(category);
    const what = kind !== "business" ? kind : category ? `business, ${data.categories.find((c) => c.id === category)?.name}` : "business";
    notify(`${r.changed} transaction${r.changed === 1 ? "" : "s"} marked ${what}.`);
    setSelected(new Set());
    void load();
  }

  const shownTotal = (rows ?? []).reduce((s, t) => s + t.amountCents, 0);
  const filtering = q !== "" || categoryId !== undefined;

  const refreshSummary = () => void run(() => api.spendingSummary(range.from, range.to)).then((s) => s && setSummary(s));
  const replace = (t: BankTransaction) => {
    setRows((list) => list?.map((x) => (x.id === t.id ? t : x)) ?? null);
    refreshSummary();
  };

  async function sync() {
    setSyncing(true);
    const r = await run(() => api.syncBanks());
    setSyncing(false);
    if (!r) return;
    const parts = [`${r.added} new transaction${r.added === 1 ? "" : "s"}`];
    if (r.categorized) parts.push(`${r.categorized} sorted by your rules`);
    notify(parts.join(", ") + ".");
    if (r.needsReconnect.length) notify(`Reconnect ${r.needsReconnect.join(" and ")} in Settings, under Bank accounts.`);
    void load();
    void run(() => api.bank()).then((b) => b && setBank(b));
  }

  const accounts = [...(bank?.connections.flatMap((c) => c.accounts) ?? []), ...(bank?.imported ?? [])];
  const hasBusinessAccounts = accounts.some((a) => a.businessOnly);
  const noBanks = bank !== null && bank.connections.length === 0 && bank.imported.length === 0;
  const lastSynced = bank?.connections.map((c) => c.lastSyncedAt).filter(Boolean).sort().at(-1);
  const reconnect = bank?.connections.filter((c) => c.status === "reconnect") ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Spending</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Mark each transaction business or {hasBusinessAccounts ? "personal, or a transfer between your accounts" : "personal"}. Only business spending counts toward your taxes.
          </p>
        </div>
        {bank && (
          <div className="flex flex-wrap items-center gap-3">
            {lastSynced && <span className="text-sm text-muted-foreground">Synced {niceDate(lastSynced.slice(0, 10))}</span>}
            {accounts.length > 0 && (
              <Button variant="outline" onClick={() => setImporting(true)}>
                <FileUpIcon />
                Import from QuickBooks
              </Button>
            )}
            <Button variant="outline" onClick={() => setStatement(true)}>
              <FileSpreadsheetIcon />
              Import statement
            </Button>
            {bank.connections.length > 0 && (
              <Button variant="outline" onClick={() => void sync()} disabled={syncing}>
                <RefreshCwIcon className={cn(syncing && "animate-spin")} />
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
            )}
          </div>
        )}
      </div>

      {reconnect.length > 0 && (
        <Card className="mt-4 flex flex-wrap items-center justify-between gap-3 border-destructive/40 p-4 text-sm">
          <span>
            <span className="font-semibold">{reconnect.map((c) => c.institutionName).join(" and ")}</span> needs you to log in again before it can sync.
          </span>
          <Button asChild variant="outline" size="sm">
            <a href="#/settings/bank">Reconnect</a>
          </Button>
        </Card>
      )}

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="To review" value={summary ? String(summary.toReview) : "–"} tone={summary?.toReview ? "text-now" : "text-muted-foreground"} />
        <Stat
          label="Business spending"
          value={summary ? formatMoney(summary.businessSpendingCents) : "–"}
          hint={summary?.healthInsuranceCents ? `${rangeLabel(range)}, plus ${formatMoney(summary.healthInsuranceCents)} health insurance` : rangeLabel(range)}
        />
        <Stat label="Received" value={summary ? formatMoney(summary.receivedCents) : "–"} hint={`${rangeLabel(range)}, paid invoices and other business deposits`} />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Tabs value={view} onValueChange={(v) => go(v as SpendingView, range)}>
          <TabsList>
            {VIEWS.filter(([id]) => id !== "transfer" || hasBusinessAccounts || view === "transfer").map(([id, label]) => (
              <TabsTrigger key={id} value={id}>
                {label}
                {id === "review" && summary && summary.toReview > 0 && <span className="num ml-1 text-now">{summary.toReview}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {accounts.length > 1 && (
          <Select value={accountId ? String(accountId) : "all"} onValueChange={(v) => setAccountId(v === "all" ? undefined : Number(v))}>
            <SelectTrigger className="w-full sm:w-44 [&>span]:truncate" aria-label="Account">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.name} {a.mask}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {view === "review" ? (
          <DateMenu range={reviewRange} onChange={(r) => go(view, r)} onAll={() => (location.hash = "#/spending/review")} />
        ) : (
          <DateMenu range={range} onChange={(r) => go(view, r)} />
        )}
        <Select value={categoryId === undefined ? "all" : String(categoryId)} onValueChange={(v) => setCategoryId(v === "all" ? undefined : v === "none" ? "none" : Number(v))}>
          <SelectTrigger className="w-full sm:w-44 [&>span]:truncate" aria-label="Category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            <SelectItem value="none">Business, no category yet</SelectItem>
            <CategoryItems current={typeof categoryId === "number" ? categoryId : null} />
          </SelectContent>
        </Select>
        <SearchBox value={search} onChange={setSearch} />
      </div>

      {rows === null ? (
        <p className="mt-10 text-muted-foreground">Loading…</p>
      ) : noBanks && rows.length === 0 ? (
        <Empty
          title="Bring in your transactions"
          body="Connect your checking and credit card accounts so new transactions download every night, or import statements you download from your bank as CSV files."
        >
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <a href="#/settings/bank">
                <Landmark />
                Connect a bank
              </a>
            </Button>
            <Button variant="outline" onClick={() => setStatement(true)}>
              <FileSpreadsheetIcon />
              Import a statement
            </Button>
          </div>
        </Empty>
      ) : rows.length === 0 ? (
        filtering ? (
          <Empty title="No matches" body={`Nothing ${q ? `matching "${q}" ` : ""}in ${view === "review" ? "To review" : rangeLabel(range)}. Try All, or a longer period.`} />
        ) : view === "review" ? (
          reviewRange ? (
            <Empty title={`Nothing to review in ${rangeLabel(reviewRange)}`} body="Everything in this period is sorted. Choose All dates to see the rest." />
          ) : (
            <Empty title="All caught up" body="Every transaction is sorted. New ones show up here after the next sync." />
          )
        ) : (
          <Empty title="Nothing here" body={`No ${view === "all" ? "" : view + " "}transactions in ${rangeLabel(range)}.`} />
        )
      ) : (
        <>
          {view === "business" && !filtering && summary && summary.byCategory.length > 0 && <ByCategory summary={summary} />}
          {filtering && (
            <p className="mt-4 text-sm text-muted-foreground">
              {rows.length} transaction{rows.length === 1 ? "" : "s"}, <span className="num font-semibold text-foreground">{shownTotal < 0 ? "−" : ""}{formatMoney(Math.abs(shownTotal))}</span>
              {view !== "review" && ` in ${rangeLabel(range)}`}
            </p>
          )}
          <Card className="mt-4 overflow-hidden">
            <Table className="min-w-[800px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-5">
                    <Checkbox
                      aria-label="Select all"
                      checked={allSelected ? true : selected.size > 0 ? "indeterminate" : false}
                      onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((t) => t.id)))}
                    />
                  </TableHead>
                  <TableHead className="w-32">Date</TableHead>
                  <TableHead>Transaction</TableHead>
                  <TableHead className="w-28 text-right">Amount</TableHead>
                  <TableHead className="w-56">Type</TableHead>
                  <TableHead className="w-64 pr-5">Category</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TxnRow
                    key={t.id}
                    txn={t}
                    faded={view === "review" && !t.needsReview}
                    selected={selected.has(t.id)}
                    onSelect={(shift) => toggle(t, shift)}
                    onChange={replace}
                    onMatched={() => void load()}
                    onRule={() => setRuleFor(t)}
                  />
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      {selected.size > 0 && <BulkBar count={selected.size} transfers={hasBusinessAccounts} onMark={(k, c) => void markSelected(k, c)} onClear={() => setSelected(new Set())} />}

      <Dialog open={statement} onOpenChange={setStatement}>
        {statement && (
          <StatementImport
            accounts={bank?.imported ?? []}
            onDone={() => {
              setStatement(false);
              void run(() => api.bank()).then((b) => b && setBank(b));
              void load();
            }}
          />
        )}
      </Dialog>

      <Dialog open={importing} onOpenChange={setImporting}>
        {importing && (
          <QuickBooksImport
            accounts={accounts}
            onDone={() => {
              setImporting(false);
              void load();
            }}
          />
        )}
      </Dialog>

      <Dialog open={ruleFor !== null} onOpenChange={(o) => !o && setRuleFor(null)}>
        {ruleFor && (
          <RuleDialog
            txn={ruleFor}
            onDone={(applied) => {
              setRuleFor(null);
              notify(applied ? `Rule saved. ${applied} more transaction${applied === 1 ? "" : "s"} sorted.` : "Rule saved.");
              void load();
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function ByCategory({ summary }: { summary: SpendingSummary }) {
  const max = Math.max(...summary.byCategory.map((c) => c.cents), 1);
  return (
    <Card className="mt-4 p-4">
      <p className="text-sm font-semibold">By category</p>
      <div className="mt-3 grid gap-2">
        {summary.byCategory.map((c) => (
          <div key={c.categoryId ?? "none"} className="grid grid-cols-[12rem_1fr_6rem] items-center gap-3 text-sm">
            <span className={cn(c.categoryId === null && "text-now")}>{c.name}</span>
            <span className="h-2 rounded-full bg-muted">
              <span className="block h-2 rounded-full bg-primary" style={{ width: `${Math.max(2, (c.cents / max) * 100)}%` }} />
            </span>
            <span className="num text-right">{formatMoney(c.cents)}</span>
          </div>
        ))}
      </div>
      {summary.healthInsuranceCents > 0 && (
        <div className="mt-3 grid grid-cols-[12rem_1fr_6rem] items-center gap-3 border-t pt-3 text-sm">
          <span>Health insurance premiums</span>
          <span className="text-xs text-muted-foreground">Deducted separately, not part of business spending</span>
          <span className="num text-right">{formatMoney(summary.healthInsuranceCents)}</span>
        </div>
      )}
    </Card>
  );
}

/** A search button that opens into a box, and stays open while there's something in it. */
function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(value !== "");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  if (!open) {
    return (
      <Button variant="outline" size="icon" className="ml-auto" aria-label="Search transactions" title="Search" onClick={() => setOpen(true)}>
        <SearchIcon />
      </Button>
    );
  }
  return (
    <div className="relative ml-auto w-full min-w-36 sm:w-auto sm:max-w-60 sm:flex-1">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => value === "" && setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onChange("");
            setOpen(false);
          }
        }}
        placeholder="Search, like Slack"
        aria-label="Search transactions"
        className="pr-8 pl-8"
      />
      <button
        type="button"
        aria-label="Clear search"
        className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          onChange("");
          setOpen(false);
        }}
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}

/** Mark everything selected at once. */
function BulkBar({
  count,
  transfers,
  onMark,
  onClear,
}: {
  count: number;
  transfers: boolean;
  onMark: (kind: TransactionKind, categoryId?: number | null) => void;
  onClear: () => void;
}) {
  return (
    <div className="sticky bottom-4 z-10 mt-4 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 shadow-lg">
      <span className="px-2 text-sm font-semibold">
        <span className="num">{count}</span> selected
      </span>
      <Select value="" onValueChange={(v) => onMark("business", v === "income" ? null : Number(v))}>
        <SelectTrigger className="h-8 w-56 text-xs" aria-label="Mark business">
          <SelectValue placeholder="Mark business…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="income">Business, income or no category</SelectItem>
          <CategoryItems />
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" onClick={() => onMark("personal")}>
        Mark personal
      </Button>
      {transfers && (
        <Button size="sm" variant="outline" onClick={() => onMark("transfer")}>
          Mark transfer
        </Button>
      )}
      <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}

/** "INV-1, INV-2 and INV-3" */
function andList(items: string[]) {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
const invoiceList = (list: InvoiceRef[]) => `${list.length === 1 ? "Invoice" : "Invoices"} ${andList(list.map((i) => i.number))}`;

/** Pick which unpaid invoices a deposit paid, for when the amounts don't line up on their own. */
function MatchInvoices({ txn, onClose, onMatch }: { txn: BankTransaction; onClose: () => void; onMatch: (ids: number[]) => Promise<boolean> }) {
  const run = useAction();
  const [unpaid, setUnpaid] = useState<InvoiceSummary[] | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(() => new Set((txn.suggestedInvoices ?? []).map((i) => i.id)));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void run(() => api.invoices()).then((list) => setUnpaid((list ?? []).filter((i) => i.status === "unpaid").sort((a, b) => a.clientName.localeCompare(b.clientName) || a.number.localeCompare(b.number))));
  }, [run]);

  const total = (unpaid ?? []).filter((i) => chosen.has(i.id)).reduce((s, i) => s + i.totalCents, 0);
  const diff = txn.amountCents - total;
  const flip = (id: number) =>
    setChosen((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Which invoices did this pay?</DialogTitle>
          <DialogDescription>
            {formatMoney(txn.amountCents)} from {txn.merchantName ?? txn.name} on {niceDate(txn.date)}. They'll be marked paid on that day, which is when they count as income.
          </DialogDescription>
        </DialogHeader>
        {unpaid === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : unpaid.length === 0 ? (
          <p className="text-sm text-muted-foreground">There are no unpaid invoices.</p>
        ) : (
          <ul className="-mx-1 max-h-80 overflow-y-auto">
            {unpaid.map((i) => (
              <li key={i.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-md px-1 py-2 hover:bg-accent/60">
                  <Checkbox checked={chosen.has(i.id)} onCheckedChange={() => flip(i.id)} />
                  <span className="flex-1 text-sm">
                    <span className="num font-semibold">{i.number}</span> <span className="text-muted-foreground">{i.clientName}</span>
                    {i.issuedOn && <span className="block text-xs text-muted-foreground">Sent {niceDate(i.issuedOn)}</span>}
                  </span>
                  <span className="num text-sm font-semibold">{formatMoney(i.totalCents)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {chosen.size > 0 && (
          <p className={cn("text-sm", diff === 0 ? "text-success" : "text-muted-foreground")}>
            {diff === 0
              ? "The invoices add up to the deposit."
              : `The invoices come to ${formatMoney(total)}, ${formatMoney(Math.abs(diff))} ${diff < 0 ? "more" : "less"} than the deposit.`}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={chosen.size === 0 || saving}
            onClick={async () => {
              setSaving(true);
              const ok = await onMatch([...chosen]);
              setSaving(false);
              if (ok) onClose();
            }}
          >
            {chosen.size <= 1 ? "Mark paid" : `Mark ${chosen.size} paid`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TxnRow({
  txn,
  faded,
  selected,
  onSelect,
  onChange,
  onMatched,
  onRule,
}: {
  txn: BankTransaction;
  faded: boolean;
  selected: boolean;
  onSelect: (shift: boolean) => void;
  onChange: (t: BankTransaction) => void;
  /** Invoices were paid or unpaid, so other deposits' suggestions may change. */
  onMatched: () => void;
  onRule: () => void;
}) {
  const run = useAction();
  const { notify } = useData();
  const markUsed = useMarkCategoryUsed();
  const moneyIn = txn.amountCents > 0;
  // A business account has no personal money in it: only business and transfers between your accounts.
  const types: [TransactionKind, string][] = [
    ["business", moneyIn ? "Income" : "Business"],
    txn.businessAccount ? ["transfer", "Transfer"] : ["personal", "Personal"],
  ];

  async function update(body: { kind?: TransactionKind | null; categoryId?: number | null }) {
    const t = await run(() => api.updateTransaction(txn.id, body));
    if (t) {
      onChange(t);
      markUsed(t.categoryId);
    }
  }
  const [matching, setMatching] = useState(false);
  const paid = txn.invoices;
  const suggested = txn.suggestedInvoices;
  // Money in that could be an invoice payment: not personal, not a refund, not matched yet.
  const couldPay = moneyIn && paid.length === 0 && (txn.kind === null || (txn.kind === "business" && !txn.categoryId));

  async function match(invoiceIds: number[]) {
    const t = await run(() => api.matchTransaction(txn.id, invoiceIds));
    if (t) {
      onChange(t);
      onMatched();
      notify(`${invoiceList(t.invoices)} marked paid on ${niceDate(t.date)}.`);
    }
    return !!t;
  }
  async function unmatch() {
    const t = await run(() => api.unmatchTransaction(txn.id));
    if (t) {
      onChange(t);
      onMatched();
      notify(`${invoiceList(paid)} ${paid.length === 1 ? "is" : "are"} unpaid again.`);
    }
  }
  const paidTotal = paid.reduce((s, i) => s + i.totalCents, 0);

  return (
    <TableRow className={cn("align-top transition-opacity", faded && !selected && "opacity-50", selected && "bg-now-wash/60")} data-state={selected ? "selected" : undefined}>
      <TableCell className="pt-3.5 pl-5">
        <Checkbox
          aria-label={`Select ${txn.merchantName ?? txn.name}`}
          checked={selected}
          disabled={paid.length > 0}
          onClick={(e) => {
            e.preventDefault();
            onSelect(e.shiftKey);
          }}
        />
      </TableCell>
      <TableCell className="num pt-3.5 whitespace-nowrap text-muted-foreground">{niceDate(txn.date)}</TableCell>
      <TableCell className="pt-3">
        <p className="font-semibold">{txn.merchantName ?? txn.name}</p>
        <p className="text-xs text-muted-foreground">
          {txn.merchantName ? `${txn.name} · ` : ""}
          {txn.accountName}
        </p>
        {txn.note && <p className="text-xs text-muted-foreground">{txn.note}</p>}
        {suggested && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-success-wash px-2.5 py-1.5 text-xs text-success">
            Looks like payment for {andList(suggested.map((i) => i.number))}, {suggested[0].clientName}.
            <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => void match(suggested.map((i) => i.id))}>
              {suggested.length === 1 ? `Mark ${suggested[0].number} paid` : `Mark ${suggested.length === 2 ? "both" : `all ${suggested.length}`} paid`}
            </Button>
            <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => setMatching(true)}>
              Other invoices
            </button>
          </div>
        )}
        {couldPay && !suggested && (
          <button type="button" className="mt-1 text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setMatching(true)}>
            Match invoices
          </button>
        )}
        {matching && <MatchInvoices txn={txn} onClose={() => setMatching(false)} onMatch={match} />}
      </TableCell>
      <TableCell className={cn("num pt-3.5 text-right font-semibold", moneyIn && "text-success")}>
        {moneyIn ? "" : "−"}
        {formatMoney(Math.abs(txn.amountCents))}
      </TableCell>
      <TableCell className="pt-2.5">
        {paid.length > 0 ? (
          <div className="pt-1 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2Icon className="size-4 shrink-0 text-success" />
              <span>
                Paid{" "}
                {paid.map((i, n) => (
                  <span key={i.id}>
                    {n > 0 && ", "}
                    <a href={`#/invoices/${i.id}`} className="font-semibold">
                      {i.number}
                    </a>
                  </span>
                ))}
              </span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" onClick={() => void unmatch()}>
                <Undo2Icon className="size-3" />
                Undo
              </Button>
            </div>
            {paidTotal !== txn.amountCents && (
              <p className="mt-1 text-xs text-muted-foreground">
                {formatMoney(Math.abs(paidTotal - txn.amountCents))} {paidTotal > txn.amountCents ? "less" : "more"} than the invoices
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <div role="group" aria-label="Type" className="inline-flex overflow-hidden rounded-md border border-input text-xs shadow-xs">
              {types.map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={txn.kind === k}
                  onClick={() => void update({ kind: txn.kind === k ? null : k })}
                  className={cn(
                    "border-l border-input px-2.5 py-1.5 font-semibold first:border-l-0 transition-colors",
                    txn.kind === k ? (k === "business" ? "bg-primary text-primary-foreground" : "bg-accent text-foreground") : "text-muted-foreground hover:bg-accent/60",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {txn.kind && (
              <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label="Make a rule from this" title="Always sort transactions like this" onClick={onRule}>
                <WandSparklesIcon className="size-3.5" />
              </Button>
            )}
          </div>
        )}
        {txn.ruleId && paid.length === 0 && <p className="mt-1 text-xs text-muted-foreground">Sorted by a rule</p>}
      </TableCell>
      <TableCell className="pt-2.5 pr-5">
        {txn.kind === "business" && paid.length === 0 && (
          <Select
            value={txn.categoryId ? String(txn.categoryId) : moneyIn ? "income" : ""}
            onValueChange={(v) => void update({ categoryId: v === "income" ? null : Number(v) })}
          >
            <SelectTrigger className={cn("h-8 w-full text-xs whitespace-nowrap [&>span]:truncate", !txn.categoryId && !moneyIn && "border-now text-now")} aria-label="Category">
              <SelectValue placeholder="Choose a category" />
            </SelectTrigger>
            <SelectContent>
              {moneyIn && <SelectItem value="income">Income</SelectItem>}
              <CategoryItems current={txn.categoryId} label={moneyIn ? (c) => `Refund: ${c.name}` : undefined} />
            </SelectContent>
          </Select>
        )}
      </TableCell>
    </TableRow>
  );
}

/** Suggest the merchant, or the first words of the bank's description, as the text to match. */
function suggestMatch(t: BankTransaction) {
  if (t.merchantName) return t.merchantName;
  return t.name
    .replace(/[#*].*$/, "")
    .replace(/\b\d{3,}\b.*$/, "")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(" ");
}

function RuleDialog({ txn, onDone }: { txn: BankTransaction; onDone: (applied: number) => void }) {
  const run = useAction();
  const { data } = useData();
  const [matchText, setMatchText] = useState(() => suggestMatch(txn));
  const category = data.categories.find((c) => c.id === txn.categoryId);
  const label = txn.kind === "business" ? (txn.amountCents > 0 && !category ? "income" : `business, ${category?.name ?? "no category yet"}`) : txn.kind;
  const tooShort = matchText.trim().length < 3;

  async function save() {
    const r = await run(() => api.createRule({ matchText: matchText.trim(), kind: txn.kind!, categoryId: txn.categoryId, transactionId: txn.id }));
    if (r) onDone(r.applied);
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Always sort these the same way</DialogTitle>
        <DialogDescription>
          Transactions containing this text are marked <span className="font-semibold text-foreground">{label}</span>, now and in future downloads.
          Anything you've sorted by hand stays as it is.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="rule-match">Contains</Label>
        <Input id="rule-match" value={matchText} onChange={(e) => setMatchText(e.target.value)} />
        <p className="text-xs text-muted-foreground">
          From: {txn.name}
          {txn.merchantName ? ` (${txn.merchantName})` : ""}
        </p>
        {tooShort && <p className="text-sm text-destructive">Use at least 3 characters.</p>}
      </div>
      <DialogFooter>
        <Button disabled={tooShort} onClick={() => void save()}>
          Save rule
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
