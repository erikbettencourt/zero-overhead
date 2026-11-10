import { useEffect, useMemo, useRef, useState } from "react";
import { FileUpIcon, TriangleAlertIcon } from "lucide-react";
import type { BankAccount, QbAccountPlan, QbImportRequest, QbImportResult, QbImportRow, QbTarget } from "../../shared/types";
import { formatMoney } from "../../shared/time";
import { api } from "../api";
import { categoryLabel, niceDate } from "../format";
import { guessAccount, parseQuickBooks, suggestFix, suggestTarget, taxQuarter, withImportKeys, type ParsedQuickBooks, type QbRow } from "../quickbooks";
import { useAction, useData } from "../state";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PAYMENT_SERVICE = /paypal|venmo|cash app|square/i;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const money = (cents: number) => `${cents < 0 ? "−" : ""}${formatMoney(Math.abs(cents))}`;

/** Targets as select values: "personal", "income", "cat:12", "tax:federal". */
const targetValue = (t: QbTarget | null) =>
  !t ? "" : t.kind === "personal" ? "personal" : t.kind === "tax" ? `tax:${t.jurisdiction}` : t.categoryId === null ? "income" : `cat:${t.categoryId}`;
function targetFrom(v: string): QbTarget | null {
  if (v === "personal") return { kind: "personal" };
  if (v === "income") return { kind: "business", categoryId: null };
  if (v === "tax:federal" || v === "tax:state") return { kind: "tax", jurisdiction: v.slice(4) as "federal" | "state" };
  if (v.startsWith("cat:")) return { kind: "business", categoryId: Number(v.slice(4)) };
  return null;
}

const planValue = (p: QbAccountPlan) => (p.mode === "skip" ? "skip" : `${p.mode}:${p.accountId}`);

interface TaxChoice {
  include: boolean;
  taxYear: number;
  quarter: 1 | 2 | 3 | 4;
}

/**
 * Bring QuickBooks Self-Employed's sorting over: choose the file, check how its accounts and
 * categories line up, then import. Nothing changes until you press Import.
 */
export function QuickBooksImport({ accounts, onDone }: { accounts: BankAccount[]; onDone: () => void }) {
  const run = useAction();
  const { data, notify } = useData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedQuickBooks | null>(null);
  const [plans, setPlans] = useState<Record<string, QbAccountPlan>>({});
  const [targets, setTargets] = useState<Record<string, QbTarget | null>>({});
  // Fixes keyed by "category|description": the category to use, or null to keep QuickBooks'.
  const [fixes, setFixes] = useState<Record<string, number | null>>({});
  const [taxes, setTaxes] = useState<Record<string, TaxChoice>>({});
  const [addMissing, setAddMissing] = useState(true);
  const [preview, setPreview] = useState<QbImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<QbImportResult | null>(null);

  const rows = useMemo(() => (parsed ? withImportKeys(parsed.rows) : []), [parsed]);
  const depository = accounts.filter((a) => a.type === "depository");

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setDone(null);
    const p = parseQuickBooks(await file.text());
    setParsed(p);
    // Starting guesses for every account and category in the file.
    const nextPlans: Record<string, QbAccountPlan> = {};
    const nextTargets: Record<string, QbTarget | null> = {};
    const nextFixes: Record<string, number | null> = {};
    const nextTaxes: Record<string, TaxChoice> = {};
    for (const r of p.rows) {
      if (!(r.accountKey in nextPlans)) {
        const id = guessAccount(r, accounts);
        nextPlans[r.accountKey] = id
          ? { mode: "account", accountId: id }
          : PAYMENT_SERVICE.test(r.bank) && depository[0]
            ? { mode: "via", accountId: depository[0].id, match: r.bank.match(PAYMENT_SERVICE)![0].toLowerCase() }
            : { mode: "skip" };
      }
      if (!(r.category in nextTargets)) nextTargets[r.category] = suggestTarget(r.category, r.type, data.categories);
    }
    for (const r of withImportKeys(p.rows)) {
      const fix = suggestFix(r.description, nextTargets[r.category], data.categories);
      if (fix) nextFixes[`${r.category}|${r.description}`] = fix.categoryId;
      if (nextTargets[r.category]?.kind === "tax") nextTaxes[r.key] = { include: true, ...taxQuarter(r.date) };
    }
    setPlans(nextPlans);
    setTargets(nextTargets);
    setFixes(nextFixes);
    setTaxes(nextTaxes);
  }

  // Summaries for the review screen.
  const accountRows = useMemo(() => groupBy(rows, (r) => r.accountKey), [rows]);
  const categoryRows = useMemo(() => groupBy(rows, (r) => r.category), [rows]);
  const fixGroups = useMemo(() => {
    const groups = new Map<string, { category: string; description: string; count: number; cents: number; suggested: number; reason: string }>();
    for (const r of rows) {
      const key = `${r.category}|${r.description}`;
      const fix = suggestFix(r.description, targets[r.category] ?? null, data.categories);
      if (!fix) continue;
      const g = groups.get(key) ?? { category: r.category, description: r.description, count: 0, cents: 0, suggested: fix.categoryId, reason: fix.reason };
      g.count++;
      g.cents += r.amountCents;
      groups.set(key, g);
    }
    return [...groups.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [rows, targets, data.categories]);
  const taxRows = rows.filter((r) => targets[r.category]?.kind === "tax");
  const unresolved = Object.entries(targets).filter(([, t]) => t === null).map(([c]) => c);

  /** The rows as the server needs them: each with what it becomes. */
  const request = useMemo((): QbImportRequest | null => {
    if (!rows.length || unresolved.length) return null;
    const out: QbImportRow[] = [];
    for (const r of rows) {
      let target = targets[r.category]!;
      const fix = fixes[`${r.category}|${r.description}`];
      if (target.kind === "business" && fix != null && fixGroups.some(([k]) => k === `${r.category}|${r.description}`)) target = { kind: "business", categoryId: fix };
      const row: QbImportRow = { key: r.key, date: r.date, accountKey: r.accountKey, description: r.description, amountCents: r.amountCents, target };
      if (target.kind === "tax") {
        const t = taxes[r.key] ?? { include: true, ...taxQuarter(r.date) };
        if (!t.include) continue;
        Object.assign(row, { taxYear: t.taxYear, quarter: t.quarter, appliedRefund: /refund/i.test(r.description) });
      }
      out.push(row);
    }
    return { rows: out, accounts: plans, addMissing, commit: false };
  }, [rows, targets, fixes, fixGroups, taxes, plans, addMissing, unresolved.length]);

  // What the import would do, refreshed as choices change.
  useEffect(() => {
    if (!request || done) return setPreview(null);
    let live = true;
    const t = setTimeout(() => {
      void run(() => api.importQuickBooks(request)).then((r) => live && r && setPreview(r));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [request, done, run]);

  async function commit() {
    if (!request) return;
    setImporting(true);
    const r = await run(() => api.importQuickBooks({ ...request, commit: true }));
    setImporting(false);
    if (r) {
      setDone(r);
      notify(`QuickBooks import finished. ${plural(r.sorted, "transaction")} sorted.`);
    }
  }

  const span = rows.length ? `${niceDate(rows.reduce((a, r) => (r.date < a ? r.date : a), rows[0].date))} to ${niceDate(rows.reduce((a, r) => (r.date > a ? r.date : a), rows[0].date))}` : "";

  return (
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>Import from QuickBooks</DialogTitle>
        <DialogDescription>
          Brings over how you sorted transactions in QuickBooks Self-Employed. Each one is found among your downloaded transactions and sorted the same way, using
          the Schedule C categories here. Anything you've already sorted here stays as you had it, and importing the same file twice changes nothing more.
        </DialogDescription>
      </DialogHeader>

      {!parsed || parsed.rows.length === 0 ? (
        <div className="grid gap-4">
          <ol className="grid gap-2 text-sm sm:grid-cols-3">
            {["In QuickBooks, open Transactions.", "Choose the dates (all of this year), with every account.", "Export to CSV and choose the file below."].map((step, i) => (
              <li key={step} className="flex gap-2.5 rounded-lg bg-muted/60 p-3">
                <span className="num flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
                <span className="text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="QuickBooks CSV file" onChange={(e) => void onFile(e.target.files?.[0])} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-sm transition-colors hover:border-input hover:bg-muted/40"
          >
            <FileUpIcon className="size-6 text-muted-foreground" />
            <span className="font-semibold">{fileName || "Choose a QuickBooks CSV file"}</span>
            <span className="text-muted-foreground">Transactions export, .csv</span>
          </button>
          {parsed?.problems.map((p) => (
            <p key={p} className="text-sm text-destructive">
              {p}
            </p>
          ))}
        </div>
      ) : done ? (
        <Outcome result={done} />
      ) : (
        <div className="grid gap-6">
          <p className="text-sm">
            <span className="font-semibold">{fileName}</span> has {plural(rows.length, "transaction")} from {span}.
            {parsed.problems.length > 0 && <span className="text-destructive"> {plural(parsed.problems.length, "line")} couldn't be read and will be left out.</span>}
          </p>

          <Section title="Accounts" intro="Where each QuickBooks account's transactions are here.">
            {[...accountRows.entries()].map(([key, list]) => (
              <div key={key} className="grid grid-cols-[1fr_auto] items-center gap-3 sm:grid-cols-[1fr_18rem]">
                <div>
                  <p className="text-sm font-semibold">{key}</p>
                  <p className="text-xs text-muted-foreground">{plural(list.length, "transaction")}</p>
                </div>
                <Select value={planValue(plans[key] ?? { mode: "skip" })} onValueChange={(v) => setPlans((p) => ({ ...p, [key]: planFrom(v, list[0]) }))}>
                  <SelectTrigger className="w-full [&>span]:truncate" aria-label={`Where ${key} is`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={`account:${a.id}`}>
                        {a.institutionName}, {a.name} {a.mask}
                      </SelectItem>
                    ))}
                    {PAYMENT_SERVICE.test(list[0].bank) &&
                      depository.map((a) => (
                        <SelectItem key={`via${a.id}`} value={`via:${a.id}`}>
                          As {list[0].bank} charges in {a.name} {a.mask}
                        </SelectItem>
                      ))}
                    <SelectItem value="skip">Skip this account</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </Section>

          <Section title="Categories" intro="What each QuickBooks category becomes. Tax payments go on the Taxes page instead of Transactions.">
            {[...categoryRows.entries()]
              .sort((a, b) => b[1].length - a[1].length)
              .map(([category, list]) => (
                <div key={category} className="grid grid-cols-[1fr_auto] items-center gap-3 sm:grid-cols-[1fr_18rem]">
                  <div>
                    <p className="text-sm font-semibold">{category || "No category"}</p>
                    <p className="text-xs text-muted-foreground">
                      {plural(list.length, "transaction")}, <span className="num">{money(list.reduce((s, r) => s + r.amountCents, 0))}</span>
                    </p>
                  </div>
                  <Select value={targetValue(targets[category] ?? null)} onValueChange={(v) => setTargets((t) => ({ ...t, [category]: targetFrom(v) }))}>
                    <SelectTrigger className={cn("w-full [&>span]:truncate", !targets[category] && "border-now text-now")} aria-label={`What ${category} becomes`}>
                      <SelectValue placeholder="Choose…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="personal">Personal</SelectItem>
                      <SelectItem value="income">Business income</SelectItem>
                      {data.categories.map((c) => (
                        <SelectItem key={c.id} value={`cat:${c.id}`}>
                          {categoryLabel(c)}
                        </SelectItem>
                      ))}
                      <SelectItem value="tax:federal">Federal estimated tax payment</SelectItem>
                      <SelectItem value="tax:state">State estimated tax payment</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
          </Section>

          {fixGroups.length > 0 && (
            <Section title="Fixes" intro="These look like they were put in the wrong category in QuickBooks. Uncheck any to keep QuickBooks' category.">
              {fixGroups.map(([key, g]) => {
                const on = fixes[key] != null;
                return (
                  <div key={key} className="grid grid-cols-[auto_1fr] items-start gap-3 sm:grid-cols-[auto_1fr_16rem] sm:items-center">
                    <Checkbox
                      className="mt-0.5 sm:mt-0"
                      checked={on}
                      aria-label={`Fix ${g.description}`}
                      onCheckedChange={(v) => setFixes((f) => ({ ...f, [key]: v === true ? g.suggested : null }))}
                    />
                    <div>
                      <p className="text-sm font-semibold">
                        {g.description} <span className="font-normal text-muted-foreground">×{g.count}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {g.reason}. In QuickBooks as {g.category}.
                      </p>
                    </div>
                    <Select disabled={!on} value={on ? String(fixes[key]) : ""} onValueChange={(v) => setFixes((f) => ({ ...f, [key]: Number(v) }))}>
                      <SelectTrigger className="col-start-2 w-full sm:col-start-auto [&>span]:truncate" aria-label={`Category for ${g.description}`}>
                        <SelectValue placeholder="Keep QuickBooks' category" />
                      </SelectTrigger>
                      <SelectContent>
                        {data.categories.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            {categoryLabel(c)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </Section>
          )}

          {taxRows.length > 0 && (
            <Section title="Tax payments" intro="Recorded on the Taxes page. A January payment usually belongs to last year's fourth quarter.">
              {taxRows.map((r) => {
                const t = taxes[r.key] ?? { include: true, ...taxQuarter(r.date) };
                const year = Number(r.date.slice(0, 4));
                return (
                  <div key={r.key} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 sm:grid-cols-[auto_1fr_10rem]">
                    <Checkbox checked={t.include} aria-label={`Record ${r.description}`} onCheckedChange={(v) => setTaxes((x) => ({ ...x, [r.key]: { ...t, include: v === true } }))} />
                    <div>
                      <p className="text-sm font-semibold">
                        {targets[r.category]?.kind === "tax" && (targets[r.category] as { jurisdiction: string }).jurisdiction === "federal" ? "Federal" : "State"}{" "}
                        <span className="num">{formatMoney(Math.abs(r.amountCents))}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {niceDate(r.date)}, {r.description}
                      </p>
                    </div>
                    <Select
                      disabled={!t.include}
                      value={`${t.taxYear}-${t.quarter}`}
                      onValueChange={(v) => setTaxes((x) => ({ ...x, [r.key]: { ...t, taxYear: Number(v.slice(0, 4)), quarter: Number(v.slice(5)) as TaxChoice["quarter"] } }))}
                    >
                      <SelectTrigger className="w-full" aria-label="Quarter">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[year - 1, year].flatMap((y) =>
                          [1, 2, 3, 4].map((q) => (
                            <SelectItem key={`${y}-${q}`} value={`${y}-${q}`}>
                              {y} Q{q}
                            </SelectItem>
                          )),
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </Section>
          )}

          <label className="flex items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={addMissing} onCheckedChange={(v) => setAddMissing(v === true)} />
            <span>
              Add business transactions that aren't in your bank's download
              <span className="block text-xs text-muted-foreground">So nothing deductible is lost. Personal ones don't need adding.</span>
            </span>
          </label>

          {unresolved.length > 0 ? (
            <p className="flex gap-2 text-sm text-now">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              Choose what {unresolved.map((c) => `"${c || "No category"}"`).join(", ")} becomes.
            </p>
          ) : (
            <Preview result={preview} />
          )}
        </div>
      )}

      <DialogFooter>
        {done ? (
          <Button onClick={onDone}>Done</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onDone}>
              Cancel
            </Button>
            <Button disabled={!request || !preview || importing} onClick={() => void commit()}>
              {importing ? "Importing…" : "Import"}
            </Button>
          </>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

function planFrom(v: string, row: QbRow): QbAccountPlan {
  if (v === "skip") return { mode: "skip" };
  const [mode, id] = v.split(":");
  if (mode === "via") return { mode: "via", accountId: Number(id), match: (row.bank.match(PAYMENT_SERVICE)?.[0] ?? row.bank).toLowerCase() };
  return { mode: "account", accountId: Number(id) };
}

function groupBy<T>(list: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const k = key(x);
    const g = m.get(k) ?? [];
    g.push(x);
    m.set(k, g);
  }
  return m;
}

function Section({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{intro}</p>
      <div className="mt-3 grid gap-3">{children}</div>
    </section>
  );
}

function Preview({ result }: { result: QbImportResult | null }) {
  if (!result) return <p className="text-sm text-muted-foreground">Checking against your downloaded transactions…</p>;
  return (
    <div className="rounded-lg border bg-muted/50 px-4 py-3 text-sm">
      <p className="font-semibold">What the import will do</p>
      <Summary result={result} />
    </div>
  );
}

function Summary({ result }: { result: QbImportResult }) {
  const added = result.missingBusiness.filter((m) => m.added).length;
  return (
    <>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        <li>
          {plural(result.matched, "transaction")} found here, {plural(result.sorted, "transaction")} {result.committed ? "sorted" : "to sort"}
          {result.keptYours > 0 && `, ${plural(result.keptYours, "transaction")} you sorted differently here kept as you had them`}.
        </li>
        {result.taxPayments.added + result.taxPayments.alreadyRecorded > 0 && (
          <li>
            {plural(result.taxPayments.added, "tax payment")} {result.committed ? "recorded" : "to record"} on the Taxes page
            {result.taxPayments.alreadyRecorded > 0 && `, ${result.taxPayments.alreadyRecorded} already there`}.
          </li>
        )}
        {result.missingBusiness.length > 0 && (
          <li>
            {plural(result.missingBusiness.length, "business transaction")} not in your bank's download
            {added > 0 ? `, ${added} ${result.committed ? "added" : "will be added"}` : ""}.
          </li>
        )}
        {result.missingPersonal > 0 && <li>{plural(result.missingPersonal, "personal transaction")} not in the download, which don't need adding.</li>}
        {result.skipped > 0 && <li>{plural(result.skipped, "transaction")} in skipped accounts.</li>}
      </ul>
      {result.missingBusiness.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-muted-foreground">Business transactions not in the download</summary>
          <ul className="mt-1 space-y-0.5">
            {result.missingBusiness.map((m, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>
                  {niceDate(m.date)}, {m.description} <span className="text-muted-foreground">({m.accountKey})</span>
                  {!m.added && <span className="text-muted-foreground">, not added</span>}
                </span>
                <span className="num">{money(m.amountCents)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function Outcome({ result }: { result: QbImportResult }) {
  return (
    <div className="rounded-lg bg-success-wash px-4 py-3 text-sm">
      <p className="font-semibold text-success">Import finished</p>
      <Summary result={result} />
      <p className="mt-2">Search for a merchant, like Slack, to check every month came through.</p>
    </div>
  );
}
