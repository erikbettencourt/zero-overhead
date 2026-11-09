import { useEffect, useState } from "react";
import { FileSpreadsheetIcon, InfoIcon, Landmark, PlusIcon, RefreshCwIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import type { BankAccount, BankOverview, BankRule, SyncResult } from "../../shared/types";
import { api } from "../api";
import { niceDate } from "../format";
import { openPlaidLink } from "../plaid-link";
import { StatementImport } from "./StatementImport";
import { useAction, useData } from "../state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const FREE_PLAN_LIMIT = 10;

function Header({ title, intro, action }: { title: string; intro: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{intro}</p>
      </div>
      {action}
    </div>
  );
}

function syncMessage(r: SyncResult) {
  if (r.errors.length) return `Connected, but the first download hit a problem: ${r.errors[0]}`;
  if (r.added === 0) return "Connected. Your bank is still gathering history; it arrives on the next sync, usually within a few minutes.";
  return `Connected. ${r.added} transaction${r.added === 1 ? "" : "s"} downloaded.`;
}

export function BankAccounts() {
  const run = useAction();
  const { notify } = useData();
  const [bank, setBank] = useState<BankOverview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void run(() => api.bank()).then((b) => b && setBank(b));
  }, [run]);

  async function connect(connectionId?: number) {
    setBusy(true);
    try {
      const token = await run(() => api.linkToken(connectionId));
      if (!token) return;
      const done = await run(() => openPlaidLink(token.linkToken));
      if (!done) return;
      const r = await run(() => (connectionId ? api.bankReconnected(connectionId) : api.connectBank(done.publicToken, done.institutionName)));
      if (r) {
        setBank(r.overview);
        notify(connectionId ? "Reconnected." : syncMessage(r.sync));
      }
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    const r = await run(() => api.syncBanks());
    setBusy(false);
    if (r) notify(`${r.added} new transaction${r.added === 1 ? "" : "s"}.`);
    void run(() => api.bank()).then((b) => b && setBank(b));
  }

  async function setBusinessOnly(id: number, on: boolean) {
    const r = await run(() => api.updateBankAccount(id, { businessOnly: on }));
    if (r) {
      setBank(r);
      notify(
        on
          ? "Business account. Its charges are business, and transfers between your accounts are kept apart."
          : "Business and personal again. Its transfers are back in To review.",
      );
    }
  }

  async function disconnect(id: number) {
    const ok = await run(async () => {
      await api.disconnectBank(id);
      return true;
    });
    if (ok) {
      setBank((b) => b && { ...b, connections: b.connections.filter((c) => c.id !== id) });
      notify("Disconnected. Its transactions stay in Spending.");
    }
  }

  if (!bank) return <p className="text-muted-foreground">Loading…</p>;
  if (!bank.configured)
    return (
      <div className="grid gap-10">
        <SetupSteps />
        <ImportedAccounts bank={bank} onChange={setBank} />
      </div>
    );

  return (
    <div className="grid gap-10">
      <section>
        <Header
          title="Bank accounts"
          intro="Connected through Plaid. New transactions download every night; Sync now pulls them any time."
          action={
            <div className="flex gap-2">
              {bank.connections.length > 0 && (
                <Button variant="outline" onClick={() => void sync()} disabled={busy}>
                  <RefreshCwIcon />
                  Sync now
                </Button>
              )}
              <Button onClick={() => void connect()} disabled={busy}>
                <PlusIcon />
                Connect a bank
              </Button>
            </div>
          }
        />
        {bank.encrypted ? (
          <p className="mt-3 text-sm text-muted-foreground">Bank logins are stored encrypted.</p>
        ) : (
          <p className="mt-3 text-sm text-now">
            Bank logins aren't encrypted yet. Add a BANK_TOKEN_KEY secret to the Worker in Cloudflare; existing logins are encrypted on the next nightly run.
          </p>
        )}
        {bank.environment === "sandbox" && <p className="mt-3 text-sm text-now">Using Plaid's test bank. Log in with user_good and pass_good.</p>}

        {bank.connections.length === 0 ? (
          <Card className="mt-5 px-6 py-12 text-center">
            <Landmark className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-2 font-semibold">No banks connected yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Connect each bank once. One login brings in all its accounts, like checking and a credit card. Up to two years of history comes with it.
            </p>
          </Card>
        ) : (
          <div className="mt-5 grid gap-3">
            {bank.connections.map((c) => (
              <Card key={c.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 font-bold">
                      {c.institutionName}
                      {c.status === "reconnect" ? <Badge variant="destructive">Needs login</Badge> : <Badge variant="success">Connected</Badge>}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {c.lastSyncedAt ? `Last synced ${niceDate(c.lastSyncedAt.slice(0, 10))}` : "Not synced yet"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {c.status === "reconnect" && (
                      <Button size="sm" onClick={() => void connect(c.id)} disabled={busy}>
                        Reconnect
                      </Button>
                    )}
                    <ConfirmDialog
                      trigger={
                        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
                          <Trash2Icon />
                          Disconnect
                        </Button>
                      }
                      title={`Disconnect ${c.institutionName}?`}
                      description={`Downloaded transactions stay. On Plaid's free plan, connecting it again uses another of your ${FREE_PLAN_LIMIT} connections, so use Reconnect instead if it just needs a fresh login.`}
                      confirmLabel="Disconnect"
                      onConfirm={() => disconnect(c.id)}
                    />
                  </div>
                </div>
                {c.error && (
                  <p className="mt-3 flex gap-2 text-sm text-destructive">
                    <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
                    {c.error}
                  </p>
                )}
                <ul className="mt-3 grid gap-1 text-sm">
                  {c.accounts.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t pt-1.5">
                      <span>
                        {a.name}
                        <span className="num ml-2 text-muted-foreground">
                          {a.type === "credit" ? "Credit card" : "Bank account"} ending {a.mask}
                        </span>
                      </span>
                      <BusinessSwitch account={a} onChange={(on) => void setBusinessOnly(a.id, on)} />
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </section>
      <ImportedAccounts bank={bank} onChange={setBank} />
    </div>
  );
}

function BusinessSwitch({ account: a, onChange }: { account: BankAccount; onChange: (on: boolean) => void }) {
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      <label className="flex items-center gap-2">
        <Switch checked={a.businessOnly} onCheckedChange={onChange} aria-label={`${a.name} is a business account`} />
        Business account
      </label>
      <BusinessAccountHelp />
    </div>
  );
}

/** Accounts brought in from CSV statements, for banks you don't connect. */
function ImportedAccounts({ bank, onChange }: { bank: BankOverview; onChange: (b: BankOverview) => void }) {
  const run = useAction();
  const { notify } = useData();
  const [importing, setImporting] = useState(false);

  async function setBusinessOnly(id: number, on: boolean) {
    const r = await run(() => api.updateBankAccount(id, { businessOnly: on }));
    if (r) onChange(r);
  }
  async function remove(a: BankAccount) {
    const r = await run(() => api.deleteBankAccount(a.id));
    if (r) {
      onChange(r);
      notify(`${a.name} and its transactions removed.`);
    }
  }

  return (
    <section>
      <Header
        title="Imported from statements"
        intro="For a bank you don't connect: download transactions from its website as a CSV and import them. Each account remembers its columns, and overlapping files add only what's new."
        action={
          <Button variant="outline" onClick={() => setImporting(true)}>
            <FileSpreadsheetIcon />
            Import a statement
          </Button>
        }
      />
      {bank.imported.length > 0 && (
        <Card className="mt-5 p-5">
          <ul className="grid gap-1 text-sm">
            {bank.imported.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t pt-1.5 first:border-t-0 first:pt-0">
                <span>
                  {a.name}
                  <span className="num ml-2 text-muted-foreground">
                    {a.type === "credit" ? "Credit card" : "Bank account"}
                    {a.mask ? ` ending ${a.mask}` : ""}
                  </span>
                </span>
                <div className="flex items-center gap-3">
                  <BusinessSwitch account={a} onChange={(on) => void setBusinessOnly(a.id, on)} />
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" aria-label={`Remove ${a.name}`}>
                        <Trash2Icon />
                      </Button>
                    }
                    title={`Remove ${a.name}?`}
                    description="Its imported transactions are deleted too, along with how you sorted them. Invoices its deposits paid stay paid."
                    confirmLabel="Remove account"
                    onConfirm={() => remove(a)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Dialog open={importing} onOpenChange={setImporting}>
        {importing && (
          <StatementImport
            accounts={bank.imported}
            onDone={() => {
              setImporting(false);
              void run(() => api.bank()).then((b) => b && onChange(b));
            }}
          />
        )}
      </Dialog>
    </section>
  );
}

/** When to use the Business account switch, and what it changes. Opens on hover, focus or tap. */
function BusinessAccountHelp() {
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="-m-1 rounded-full p-1 text-muted-foreground hover:text-foreground"
            aria-label="What's a business account?"
            onClick={() => setOpen((o) => !o)}
          >
            <InfoIcon className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-sm p-3 text-left text-[13px] leading-snug">
          <p className="font-semibold">Turn this on for an account used only for your business</p>
          <p className="mt-1">Like a business checking account, or a card you use only for work. Leave it off for accounts that mix business and personal.</p>
          <p className="mt-2 font-semibold">What it changes</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>Charges come in as Business, ready for a category.</li>
            <li>Card payments and money moved to your own accounts come in as Transfer, which isn't income or spending.</li>
            <li>Deposits still wait in To review, so money you put in yourself isn't counted as income.</li>
            <li>Personal is replaced by Transfer.</li>
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Shown until the Plaid keys are on the Worker. */
function SetupSteps() {
  const steps = [
    ["Find your keys in Plaid", "In the Plaid dashboard, open Developers, then Keys. Copy your client ID and your Production secret."],
    [
      "Add them to Cloudflare",
      "In Cloudflare, open Workers & Pages, then zero-overhead, then Settings, then Variables and secrets. Add PLAID_CLIENT_ID and PLAID_SECRET, both as type Secret, then Deploy.",
    ],
    ["Come back here", "Reload this page and Connect a bank. Each bank login uses one of the 10 connections on Plaid's free plan."],
  ];
  return (
    <section>
      <Header
        title="Bank accounts"
        intro="Optional. Bank sync downloads transactions every night using Plaid. Add your Plaid keys to the Worker to turn it on, or import statements below instead. They stay in Cloudflare and never pass through this page."
      />
      <ol className="mt-5 grid gap-3">
        {steps.map(([title, body], i) => (
          <Card key={title} className="flex gap-4 p-4">
            <span className="num flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
              {i + 1}
            </span>
            <div>
              <p className="font-semibold">{title}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
            </div>
          </Card>
        ))}
      </ol>
    </section>
  );
}

const KIND_LABEL = { business: "Business", personal: "Personal", transfer: "Transfer" } as const;

/** How many transactions the rule fits, flagging any sorted another way. Opens them in Spending. */
function RuleMatches({ rule: r }: { rule: BankRule }) {
  if (r.matches === 0) return <span className="num text-muted-foreground">None yet</span>;
  const today = new Date().toISOString().slice(0, 10);
  const href = `#/spending/all/${r.firstDate ?? today}/${today}?q=${encodeURIComponent(r.matchText)}`;
  const status =
    r.different > 0
      ? { text: `${r.different} sorted differently`, tone: "text-destructive" }
      : r.unsorted > 0
        ? { text: `${r.unsorted} to review`, tone: "text-now" }
        : { text: r.matches === 1 ? "Matches the rule" : "All match the rule", tone: "text-muted-foreground" };
  return (
    <a href={href} className="group inline-block text-right" title="Show them in Spending">
      <span className="num font-semibold group-hover:underline">{r.matches}</span>
      <span className={`block text-xs ${status.tone}`}>{status.text}</span>
    </a>
  );
}

export function SpendingRules() {
  const run = useAction();
  const { notify } = useData();
  const [rules, setRules] = useState<BankRule[] | null>(null);

  useEffect(() => {
    void run(() => api.rules()).then((r) => r && setRules(r));
  }, [run]);

  async function remove(rule: BankRule) {
    const ok = await run(async () => {
      await api.deleteRule(rule.id);
      return true;
    });
    if (ok) {
      setRules((r) => r?.filter((x) => x.id !== rule.id) ?? null);
      notify("Rule deleted. Transactions it already sorted stay as they are.");
    }
  }

  return (
    <section>
      <Header
        title="Spending rules"
        intro="Rules sort new transactions as they download. Make one from any transaction in Spending with the wand button. The most specific match wins."
      />
      {rules === null ? (
        <p className="mt-5 text-muted-foreground">Loading…</p>
      ) : rules.length === 0 ? (
        <Card className="mt-5 px-6 py-10 text-center text-sm text-muted-foreground">No rules yet.</Card>
      ) : (
        <Card className="mt-5 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Contains</TableHead>
                <TableHead>Sorted as</TableHead>
                <TableHead className="text-right">Matches</TableHead>
                <TableHead className="w-12 pr-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-5 font-semibold">{r.matchText}</TableCell>
                  <TableCell>
                    {KIND_LABEL[r.kind]}
                    {r.categoryName && <span className="text-muted-foreground">, {r.categoryName}</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <RuleMatches rule={r} />
                  </TableCell>
                  <TableCell className="pr-5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete rule ${r.matchText}`}
                      onClick={() => void remove(r)}
                    >
                      <Trash2Icon />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </section>
  );
}
