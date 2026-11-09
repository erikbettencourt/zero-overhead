import { useMemo, useRef, useState } from "react";
import { FileUpIcon } from "lucide-react";
import type { BankAccount, StatementColumns } from "../../shared/types";
import { formatMoney } from "../../shared/time";
import { api } from "../api";
import { niceDate } from "../format";
import { columnsFit, guessColumns, readStatement, statementRows, type StatementFile } from "../statement";
import { useAction, useData } from "../state";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NEW = "new";

/**
 * Bring in a bank or card statement (CSV), for a bank you don't connect through Plaid.
 * The columns are worked out from the file and remembered per account; importing a file
 * that overlaps an earlier one adds only what's new.
 */
export function StatementImport({ accounts, onDone }: { accounts: BankAccount[]; onDone: (accountId: number) => void }) {
  const run = useAction();
  const { notify } = useData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState<string>(accounts[0] ? String(accounts[0].id) : NEW);
  const [newAccount, setNewAccount] = useState({ name: "", type: "depository" as "depository" | "credit", mask: "" });
  const [fileName, setFileName] = useState("");
  const [file, setFile] = useState<StatementFile | null>(null);
  const [problem, setProblem] = useState("");
  const [columns, setColumns] = useState<StatementColumns | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const account = accounts.find((a) => String(a.id) === accountId);
  const saved = file && account && columnsFit(file, account.csvColumns) ? account.csvColumns : null;
  const parsed = useMemo(() => (file && columns ? statementRows(file, columns) : null), [file, columns]);
  const dates = parsed?.rows.map((r) => r.date).sort() ?? [];

  function pickAccount(v: string) {
    setAccountId(v);
    const a = accounts.find((x) => String(x.id) === v);
    if (file) {
      const fit = a && columnsFit(file, a.csvColumns);
      setColumns(fit ? a.csvColumns : guessColumns(file));
      setEditing(!fit);
    }
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    setFileName(f.name);
    const read = readStatement(await f.text());
    setFile(read);
    setProblem(read ? "" : "Couldn't find dates in this file. Download your statement from your bank as a CSV (sometimes called Excel or spreadsheet format).");
    if (read) {
      const fit = account && columnsFit(read, account.csvColumns);
      setColumns(fit ? account.csvColumns : guessColumns(read));
      setEditing(!fit);
    }
  }

  async function importRows() {
    if (!parsed || !columns || parsed.rows.length === 0) return;
    setSaving(true);
    try {
      let id = account?.id;
      if (!id) {
        const created = await run(() =>
          api.createBankAccount({ name: newAccount.name.trim(), type: newAccount.type, mask: newAccount.mask.trim() || undefined }),
        );
        if (!created) return;
        id = created.id;
      }
      const r = await run(() => api.importStatement(id!, { columns, rows: parsed.rows }));
      if (!r) return;
      notify(
        `${r.added} transaction${r.added === 1 ? "" : "s"} added, ${niceDate(r.from)} to ${niceDate(r.to)}.` +
          (r.skipped ? ` ${r.skipped} already here, skipped.` : "") +
          (r.sorted ? ` ${r.sorted} sorted by your rules.` : ""),
      );
      onDone(id);
    } finally {
      setSaving(false);
    }
  }

  const needsName = accountId === NEW && newAccount.name.trim().length === 0;
  const header = file?.header.filter(Boolean) ?? [];

  return (
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Import a statement</DialogTitle>
        <DialogDescription>
          For a bank or card you don't connect. Download transactions from its website as a CSV and bring them in here. Importing a file that overlaps an
          earlier one adds only what's new.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="st-account">Account</Label>
          <Select value={accountId} onValueChange={pickAccount}>
            <SelectTrigger id="st-account" className="font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.name}
                  {a.mask ? ` ${a.mask}` : ""}
                </SelectItem>
              ))}
              <SelectItem value={NEW}>New account…</SelectItem>
            </SelectContent>
          </Select>
          {accountId === NEW && (
            <div className="grid grid-cols-[minmax(0,1fr)_10rem_6rem] gap-2">
              <Input
                aria-label="Account name"
                placeholder="Name, like Business checking"
                value={newAccount.name}
                onChange={(e) => setNewAccount((a) => ({ ...a, name: e.target.value }))}
              />
              <Select value={newAccount.type} onValueChange={(v) => setNewAccount((a) => ({ ...a, type: v as "depository" | "credit" }))}>
                <SelectTrigger aria-label="Account type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="depository">Bank account</SelectItem>
                  <SelectItem value="credit">Credit card</SelectItem>
                </SelectContent>
              </Select>
              <Input
                aria-label="Last 4 digits"
                placeholder="Last 4"
                inputMode="numeric"
                maxLength={6}
                value={newAccount.mask}
                onChange={(e) => setNewAccount((a) => ({ ...a, mask: e.target.value.replace(/\D/g, "") }))}
              />
            </div>
          )}
        </div>

        <div className="grid gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label="Statement CSV file"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6 text-sm transition-colors hover:border-input hover:bg-muted/40"
          >
            <FileUpIcon className="size-6 text-muted-foreground" />
            <span className="font-semibold">{fileName || "Choose a CSV file"}</span>
            <span className="text-muted-foreground">{fileName ? "Choose a different file" : "Transactions downloaded from your bank or card"}</span>
          </button>
          {problem && <p className="text-sm text-destructive">{problem}</p>}
        </div>

        {file && columns && (
          <div className="grid gap-3">
            {saved && !editing ? (
              <p className="text-sm text-muted-foreground">
                Using the columns from last time.{" "}
                <button type="button" className="font-semibold text-primary underline-offset-2 hover:underline" onClick={() => setEditing(true)}>
                  Change
                </button>
              </p>
            ) : (
              <ColumnPicker header={header} columns={columns} onChange={setColumns} />
            )}

            {parsed && parsed.rows.length > 0 ? (
              <>
                <div className="overflow-hidden rounded-lg border">
                  <table className="w-full text-sm">
                    <tbody>
                      {parsed.rows.slice(0, 5).map((r) => (
                        <tr key={r.key} className="border-b last:border-0">
                          <td className="num px-3 py-2 whitespace-nowrap text-muted-foreground">{niceDate(r.date)}</td>
                          <td className="w-full max-w-0 truncate px-3 py-2">{r.description}</td>
                          <td className={cn("num px-3 py-2 text-right font-semibold whitespace-nowrap", r.amountCents > 0 && "text-success")}>
                            {r.amountCents < 0 ? "−" : ""}
                            {formatMoney(Math.abs(r.amountCents))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {parsed.rows.length} transaction{parsed.rows.length === 1 ? "" : "s"}
                  </span>
                  , {niceDate(dates[0])} to {niceDate(dates.at(-1))}. Charges should show as money out (−) and deposits in green; if they're the other way
                  round, switch how money out is shown.
                  {parsed.skipped > 0 && ` ${parsed.skipped} line${parsed.skipped === 1 ? "" : "s"} without a date or amount left out.`}
                </p>
              </>
            ) : (
              <p className="text-sm text-destructive">No transactions with a date and an amount in those columns.</p>
            )}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button disabled={!parsed || parsed.rows.length === 0 || needsName || saving} onClick={() => void importRows()}>
          {saving ? "Importing…" : parsed && parsed.rows.length > 0 ? `Import ${parsed.rows.length} transactions` : "Import"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function ColumnPicker({ header, columns, onChange }: { header: string[]; columns: StatementColumns; onChange: (c: StatementColumns) => void }) {
  const split = !columns.amount;
  const pick = (label: string, value: string | undefined, set: (v: string) => void) => (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value ?? ""} onValueChange={set}>
        <SelectTrigger className="h-9 [&>span]:truncate" aria-label={`${label} column`}>
          <SelectValue placeholder="Choose a column" />
        </SelectTrigger>
        <SelectContent>
          {header.map((h) => (
            <SelectItem key={h} value={h}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  return (
    <div className="grid gap-3 rounded-lg border p-4">
      <p className="text-sm font-semibold">Which columns hold what</p>
      <div className="grid grid-cols-2 gap-3">
        {pick("Date", columns.date, (v) => onChange({ ...columns, date: v }))}
        {pick("Description", columns.description, (v) => onChange({ ...columns, description: v }))}
      </div>
      <div role="group" aria-label="Amounts" className="inline-flex w-fit overflow-hidden rounded-md border border-input text-xs shadow-xs">
        {(
          [
            [false, "One amount column"],
            [true, "Money out and in, separately"],
          ] as const
        ).map(([s, label]) => (
          <button
            key={label}
            type="button"
            aria-pressed={split === s}
            onClick={() =>
              onChange(
                s
                  ? {
                      date: columns.date,
                      description: columns.description,
                      debit: columns.debit ?? header[2],
                      credit: columns.credit ?? header[3],
                      moneyOut: columns.moneyOut,
                    }
                  : { date: columns.date, description: columns.description, amount: columns.amount ?? header[2], moneyOut: columns.moneyOut },
              )
            }
            className={cn(
              "border-l border-input px-2.5 py-1.5 font-semibold first:border-l-0",
              split === s ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {split ? (
        <div className="grid grid-cols-2 gap-3">
          {pick("Money out", columns.debit, (v) => onChange({ ...columns, debit: v }))}
          {pick("Money in", columns.credit, (v) => onChange({ ...columns, credit: v }))}
        </div>
      ) : (
        <div className="grid grid-cols-2 items-end gap-3">
          {pick("Amount", columns.amount, (v) => onChange({ ...columns, amount: v }))}
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Money out shows as</Label>
            <Select value={columns.moneyOut} onValueChange={(v) => onChange({ ...columns, moneyOut: v as StatementColumns["moneyOut"] })}>
              <SelectTrigger className="h-9" aria-label="Money out shows as">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="negative">Negative, like −12.00</SelectItem>
                <SelectItem value="positive">Positive, like 12.00</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
