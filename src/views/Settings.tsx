import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BriefcaseIcon,
  BuildingIcon,
  ChevronDownIcon,
  DatabaseIcon,
  DownloadIcon,
  FileUpIcon,
  LandmarkIcon,
  ReceiptIcon,
  ListChecksIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UsersIcon,
  WandSparklesIcon,
  MergeIcon,
} from "lucide-react";
import type { BillingPeriod, Client, ImportResult, Project, Task } from "../../shared/types";
import { BILLING_LABEL } from "../periods";
import { formatDuration, formatMoney, parseMoney, toIsoDate } from "../../shared/time";
import { api } from "../api";
import { parseHarvest, withKeys, type ParsedHarvest } from "../harvest";
import { useAction, useData } from "../state";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { BankAccounts, SpendingRules } from "./BankSettings";
import { TaxProfileSettings } from "./TaxSettings";
import { VersionCard } from "./VersionCard";

const TABS = [
  ["business", "Your business", BuildingIcon],
  ["clients", "Clients", UsersIcon],
  ["projects", "Projects", BriefcaseIcon],
  ["tasks", "Tasks", ListChecksIcon],
  ["bank", "Bank accounts", LandmarkIcon],
  ["rules", "Spending rules", WandSparklesIcon],
  ["taxes", "Tax profile", ReceiptIcon],
  ["import", "Import from Harvest", DownloadIcon],
  ["data", "Data", DatabaseIcon],
] as const;

export default function SettingsView({ tab }: { tab: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      <div className="mt-6 grid gap-8 md:grid-cols-[12rem_1fr]">
        <nav aria-label="Settings" className="flex gap-1 overflow-x-auto md:flex-col">
          {TABS.map(([id, label, Icon]) => (
            <a
              key={id}
              href={`#/settings/${id}`}
              aria-current={tab === id ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors",
                tab === id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </a>
          ))}
        </nav>
        <div className="min-w-0">
          {tab === "business" && <YourBusiness />}
          {tab === "clients" && <Clients />}
          {tab === "projects" && <Projects />}
          {tab === "tasks" && <Tasks />}
          {tab === "bank" && <BankAccounts />}
          {tab === "rules" && <SpendingRules />}
          {tab === "taxes" && <TaxProfileSettings />}
          {tab === "import" && <HarvestImport />}
          {tab === "data" && <DataTools />}
        </div>
      </div>
    </div>
  );
}

function Section({ title, intro, action, children }: { title: string; intro?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          {intro && <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{intro}</p>}
        </div>
        {action}
      </div>
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

function Field({ id, label, hint, className, children }: { id: string; label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("grid content-start gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function EmptyCard({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <Card className="px-6 py-12 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      {children && <div className="mt-4 flex justify-center">{children}</div>}
    </Card>
  );
}

function rateText(cents: number | null | undefined) {
  return cents == null ? "" : (cents / 100).toFixed(2).replace(/\.00$/, "");
}

/** Validates a money field: returns cents, null for blank, or false (and an error) if invalid. */
function readRate(raw: string, setError: (m: string) => void): number | null | false {
  const v = parseMoney(raw);
  if (v === undefined) {
    setError("Rates are dollars per hour, like 150 or 150.50.");
    return false;
  }
  return v;
}

/** A money input with a $ in front and /h after. */
function RateInput({ id, value, onChange, placeholder, className, ...rest }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string; disabled?: boolean; "aria-label"?: string }) {
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">$</span>
      <Input id={id} inputMode="decimal" className="num pr-8 pl-6" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} {...rest} />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">/h</span>
    </div>
  );
}

/* Your business */

function YourBusiness() {
  const { data, setData, notify } = useData();
  const run = useAction();
  const [form, setForm] = useState(data.business);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const saved = await run(() => api.saveBusiness(form));
    setSaving(false);
    if (saved) {
      setData((d) => ({ ...d, business: saved }));
      setForm(saved);
      notify("Business details saved.");
    }
  }

  return (
    <Section title="Your business" intro="What appears at the top of every invoice. Invoices keep the details they were issued with, so later edits don't change past invoices.">
      <Card className="overflow-hidden">
        <form onSubmit={submit}>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <Field id="biz-name" label="Business name">
              <Input id="biz-name" required value={form.name} onChange={set("name")} />
            </Field>
            <Field id="biz-email" label="Email">
              <Input id="biz-email" type="email" value={form.email} onChange={set("email")} />
            </Field>
            <Field id="biz-phone" label="Phone">
              <Input id="biz-phone" type="tel" value={form.phone} onChange={set("phone")} />
            </Field>
            <Field id="biz-logo" label="Logo" hint="Shown at the top left of invoices. Without one, your business name is used.">
              <LogoPicker id="biz-logo" value={form.logo} onChange={(logo) => setForm((f) => ({ ...f, logo }))} />
            </Field>
            <Field id="biz-address" label="Address" className="sm:col-span-2">
              <Textarea id="biz-address" rows={3} value={form.address} onChange={set("address")} />
            </Field>
            <Field
              id="biz-pay"
              label="Payment instructions"
              hint="How clients pay you, like bank transfer details or a payment link. Shown on every invoice."
              className="sm:col-span-2"
            >
              <Textarea id="biz-pay" rows={4} value={form.paymentInstructions} onChange={set("paymentInstructions")} />
            </Field>
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={saving}>
              Save details
            </Button>
          </CardFooter>
        </form>
      </Card>
    </Section>
  );
}

/** Pick an image, shrink it in the browser, and keep it as a data URL. */
function LogoPicker({ id, value, onChange }: { id: string; value: string; onChange: (dataUrl: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  async function pick(file: File | undefined) {
    setError("");
    if (!file) return;
    if (file.type === "image/svg+xml") {
      if (file.size > 250_000) return setError("That SVG is too large.");
      const text = await file.text();
      return onChange(`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`);
    }
    try {
      const bitmap = await createImageBitmap(file);
      // Twice the printed size, so it stays crisp on paper.
      const scale = Math.min(1, 900 / bitmap.width, 240 / bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      onChange(canvas.toDataURL("image/png"));
    } catch {
      setError("That file couldn't be read as an image.");
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex min-h-16 items-center justify-center rounded-md border border-dashed bg-white p-3">
        {value ? <img src={value} alt="Your logo" className="max-h-12 max-w-full object-contain" /> : <span className="text-sm text-muted-foreground">No logo</span>}
      </div>
      <input ref={ref} id={id} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} />
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => ref.current?.click()}>
          <FileUpIcon />
          {value ? "Replace" : "Upload"}
        </Button>
        {value && (
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onChange("")}>
            Remove
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/* Clients */

function Clients() {
  const { data } = useData();
  const [dialog, setDialog] = useState<Client | "new" | null>(null);

  return (
    <Section
      title="Clients"
      intro="Who you bill. The default rate applies to any project or task without its own rate."
      action={
        <Button onClick={() => setDialog("new")}>
          <PlusIcon />
          Add client
        </Button>
      }
    >
      {data.clients.length === 0 ? (
        <EmptyCard title="No clients yet" body="Add the first company you bill. You'll give it projects next.">
          <Button variant="outline" onClick={() => setDialog("new")}>
            <PlusIcon />
            Add client
          </Button>
        </EmptyCard>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y">
            {data.clients.map((c) => (
              <li key={c.id} className="flex items-center gap-4 px-5 py-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground" aria-hidden="true">
                  {c.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("font-bold", c.archived && "text-muted-foreground")}>{c.name}</span>
                    {c.archived && <Badge variant="secondary">Archived</Badge>}
                  </div>
                  <div className="truncate text-sm text-muted-foreground">{c.email ?? "No billing email"}</div>
                </div>
                <div className="num text-right text-sm">
                  {c.defaultRateCents != null ? <span className="font-semibold">{formatMoney(c.defaultRateCents)}/h</span> : <span className="text-muted-foreground">No rate</span>}
                  <div className="text-xs text-muted-foreground">
                    {BILLING_LABEL[c.billingPeriod]}, Net {c.paymentTermsDays}
                  </div>
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${c.name}`} onClick={() => setDialog(c)}>
                  <PencilIcon />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog && <ClientDialog key={dialog === "new" ? "new" : dialog.id} client={dialog === "new" ? undefined : dialog} onDone={() => setDialog(null)} />}
      </Dialog>
    </Section>
  );
}

function ClientDialog({ client, onDone }: { client?: Client; onDone: () => void }) {
  const { setData, notify } = useData();
  const run = useAction();
  const [name, setName] = useState(client?.name ?? "");
  const [email, setEmail] = useState(client?.email ?? "");
  const [address, setAddress] = useState(client?.address ?? "");
  const [rate, setRate] = useState(rateText(client?.defaultRateCents));
  const [terms, setTerms] = useState(String(client?.paymentTermsDays ?? 15));
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>(client?.billingPeriod ?? "monthly");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const defaultRateCents = readRate(rate, setError);
    if (defaultRateCents === false) return;
    const paymentTermsDays = Number(terms);
    if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 365) {
      return setError("Payment terms are a number of days, like 30.");
    }
    const body = { name, email: email || null, address: address || null, defaultRateCents, paymentTermsDays, billingPeriod };
    const saved = await run(() => (client ? api.updateClient(client.id, body) : api.createClient(body)));
    if (!saved) return;
    setData((d) => ({
      ...d,
      clients: client ? d.clients.map((c) => (c.id === saved.id ? saved : c)) : [...d.clients, saved].sort((a, b) => a.name.localeCompare(b.name)),
    }));
    notify(client ? "Client saved." : `Added ${saved.name}. Next, give it a project.`);
    onDone();
  }

  async function toggleArchive() {
    if (!client) return;
    const saved = await run(() => api.updateClient(client.id, { archived: !client.archived }));
    if (saved) {
      setData((d) => ({ ...d, clients: d.clients.map((c) => (c.id === saved.id ? saved : c)) }));
      notify(saved.archived ? `${saved.name} archived.` : `${saved.name} restored.`);
      onDone();
    }
  }

  return (
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{client ? `Edit ${client.name}` : "Add client"}</DialogTitle>
        <DialogDescription>Billing details appear on invoices. Rate and terms set the defaults for this client's projects.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field id="client-name" label="Name">
          <Input id="client-name" required value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field id="client-email" label="Billing email">
          <Input id="client-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field id="client-rate" label="Default rate" hint="Optional.">
          <RateInput id="client-rate" value={rate} onChange={setRate} />
        </Field>
        <Field id="client-terms" label="Payment terms" hint="Days until an invoice is due.">
          <div className="relative">
            <Input id="client-terms" className="num pr-12" inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value)} />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">days</span>
          </div>
        </Field>
        <Field id="client-period" label="Billing period" hint="What New invoice starts with for this client.">
          <Select value={billingPeriod} onValueChange={(v) => setBillingPeriod(v as BillingPeriod)}>
            <SelectTrigger id="client-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(BILLING_LABEL) as BillingPeriod[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {BILLING_LABEL[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="client-address" label="Billing address" className="sm:col-span-2">
          <Textarea id="client-address" rows={3} value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
        <DialogFooter className="sm:col-span-2">
          {client && (
            <Button type="button" variant="ghost" className="mr-auto text-muted-foreground" onClick={() => void toggleArchive()}>
              {client.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
              {client.archived ? "Restore client" : "Archive client"}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit">{client ? "Save client" : "Add client"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/* Projects */

function Projects() {
  const { data, clientById } = useData();
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const activeClients = data.clients.filter((c) => !c.archived);

  const byClient = useMemo(() => {
    const groups = new Map<number, Project[]>();
    for (const p of data.projects) groups.set(p.clientId, [...(groups.get(p.clientId) ?? []), p]);
    return [...groups.entries()].sort(([a], [b]) => (clientById.get(a)?.name ?? "").localeCompare(clientById.get(b)?.name ?? ""));
  }, [data.projects, clientById]);

  if (data.clients.length === 0) {
    return (
      <Section title="Projects">
        <EmptyCard title="Add a client first" body="Projects belong to a client.">
          <Button asChild variant="outline">
            <a href="#/settings/clients">Add a client</a>
          </Button>
        </EmptyCard>
      </Section>
    );
  }

  return (
    <Section
      title="Projects"
      intro="Each project lists the tasks you do on it. Only assigned tasks show up in the timesheet."
      action={
        activeClients.length > 0 && (
          <Button onClick={() => setAdding(true)}>
            <PlusIcon />
            Add project
          </Button>
        )
      }
    >
      <Dialog open={adding} onOpenChange={setAdding}>
        {adding && (
          <NewProject
            onDone={(id) => {
              setAdding(false);
              if (id) setOpen(id);
            }}
          />
        )}
      </Dialog>
      {byClient.length === 0 && <EmptyCard title="No projects yet" body="Add a project for one of your clients, then choose the tasks you do on it." />}
      {byClient.map(([clientId, projects]) => (
        <div key={clientId}>
          <h3 className="mb-2 text-xs font-bold text-muted-foreground">{clientById.get(clientId)?.name}</h3>
          <Card className="overflow-hidden">
            <ul className="divide-y">
              {projects.map((p) => {
                const count = data.projectTasks.filter((l) => l.projectId === p.id).length;
                return (
                  <li key={p.id}>
                    <button
                      className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted/50"
                      aria-expanded={open === p.id}
                      onClick={() => setOpen(open === p.id ? null : p.id)}
                    >
                      <span className={cn("flex-1 font-bold", p.archived && "text-muted-foreground")}>{p.name}</span>
                      {p.archived && <Badge variant="secondary">Archived</Badge>}
                      <Badge variant="outline">
                        {count} {count === 1 ? "task" : "tasks"}
                      </Badge>
                      <ChevronDownIcon className={cn("size-4 text-muted-foreground transition-transform", open === p.id && "rotate-180")} />
                    </button>
                    {open === p.id && <ProjectEditor project={p} onClose={() => setOpen(null)} />}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      ))}
    </Section>
  );
}

function NewProject({ onDone }: { onDone: (id?: number) => void }) {
  const { data, setData } = useData();
  const run = useAction();
  const clients = data.clients.filter((c) => !c.archived);
  const [clientId, setClientId] = useState(String(clients[0]?.id ?? ""));
  const [name, setName] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const project = await run(() => api.createProject({ clientId: Number(clientId), name }));
    if (!project) return;
    // Start every new project with all current tasks assigned; untick what doesn't apply.
    const links = await run(() =>
      api.setProjectTasks(
        project.id,
        data.tasks.filter((t) => !t.archived).map((t) => ({ taskId: t.id })),
      ),
    );
    setData((d) => ({ ...d, projects: [...d.projects, project], projectTasks: [...d.projectTasks, ...(links ?? [])] }));
    onDone(project.id);
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Add project</DialogTitle>
        <DialogDescription>It starts with every task assigned. Untick what doesn't apply after.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="grid gap-4">
        <Field id="np-client" label="Client">
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger id="np-client">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="np-name" label="Project name">
          <Input id="np-name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onDone()}>
            Cancel
          </Button>
          <Button type="submit">Add project</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function ProjectEditor({ project, onClose }: { project: Project; onClose: () => void }) {
  const { data, setData, clientById, notify } = useData();
  const run = useAction();
  const client = clientById.get(project.clientId);
  const links = data.projectTasks.filter((l) => l.projectId === project.id);
  const [name, setName] = useState(project.name);
  const [rate, setRate] = useState(rateText(project.rateCents));
  const [assigned, setAssigned] = useState<Record<number, boolean>>(() => Object.fromEntries(data.tasks.map((t) => [t.id, links.some((l) => l.taskId === t.id)])));
  const [error, setError] = useState("");
  const tasks = data.tasks.filter((t) => !t.archived || assigned[t.id]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    const rateCents = readRate(rate, setError);
    if (rateCents === false) return;
    const taskLinks = tasks.filter((t) => assigned[t.id]).map((t) => ({ taskId: t.id }));
    const updated = await run(() => api.updateProject(project.id, { name, rateCents }));
    if (!updated) return;
    const newLinks = await run(() => api.setProjectTasks(project.id, taskLinks));
    if (!newLinks) return;
    setData((d) => ({
      ...d,
      projects: d.projects.map((p) => (p.id === updated.id ? updated : p)),
      projectTasks: [...d.projectTasks.filter((l) => l.projectId !== project.id), ...newLinks],
    }));
    notify("Project saved.");
    onClose();
  }

  async function toggleArchive() {
    const updated = await run(() => api.updateProject(project.id, { archived: !project.archived }));
    if (updated) setData((d) => ({ ...d, projects: d.projects.map((p) => (p.id === updated.id ? updated : p)) }));
  }

  return (
    <form onSubmit={save} className="space-y-5 border-t bg-muted/40 px-5 py-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`pe-name-${project.id}`} label="Project name">
          <Input id={`pe-name-${project.id}`} required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          id={`pe-rate-${project.id}`}
          label="Project rate"
          hint={client?.defaultRateCents != null ? `Blank uses ${client.name}'s ${formatMoney(client.defaultRateCents)}/h.` : "Optional."}
        >
          <RateInput id={`pe-rate-${project.id}`} value={rate} onChange={setRate} />
        </Field>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold">Tasks on this project</legend>
        <p className="text-xs text-muted-foreground">Every task bills at the project rate. Only checked tasks show up in the timesheet.</p>
        <ul className="mt-2 divide-y rounded-lg border bg-card">
          {tasks.map((t) => {
            const on = assigned[t.id] ?? false;
            return (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                <Checkbox
                  id={`pt-${project.id}-${t.id}`}
                  checked={on}
                  onCheckedChange={(v) => setAssigned((a) => ({ ...a, [t.id]: v === true }))}
                />
                <Label htmlFor={`pt-${project.id}-${t.id}`} className={cn("flex-1 font-normal", !on && "text-muted-foreground")}>
                  {t.name}
                  {!t.billable && <Badge variant="secondary">Not billable</Badge>}
                </Label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" className="text-muted-foreground" onClick={() => void toggleArchive()}>
          {project.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
          {project.archived ? "Restore project" : "Archive project"}
        </Button>
        <Button type="button" variant="outline" className="ml-auto" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Save project</Button>
      </div>
    </form>
  );
}

/* Tasks */

function Tasks() {
  const { data, setData } = useData();
  const run = useAction();
  const [name, setName] = useState("");

  async function add(e: FormEvent) {
    e.preventDefault();
    const task = await run(() => api.createTask({ name }));
    if (task) {
      setData((d) => ({ ...d, tasks: [...d.tasks, task] }));
      setName("");
    }
  }

  async function update(t: Task, body: Partial<Task>) {
    const saved = await run(() => api.updateTask(t.id, body));
    if (saved) setData((d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === saved.id ? saved : x)) }));
  }
  const [merging, setMerging] = useState<Task | null>(null);

  return (
    <Section title="Tasks" intro="The kinds of work you do. Assign them to projects in Projects. Click a name to rename it.">
      <Card className="overflow-hidden">
        <div className="flex items-center gap-4 border-b bg-muted/50 px-5 py-2 text-xs font-bold text-muted-foreground">
          <span className="flex-1">Task</span>
          <span className="w-20 text-center">Billable</span>
          <span className="w-[4.75rem]" />
        </div>
        <ul className="divide-y">
          {data.tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-4 py-1.5 pr-3 pl-3">
              <TaskName task={t} onRename={(n) => update(t, { name: n })} />
              {t.archived && <Badge variant="secondary">Archived</Badge>}
              <span className="flex w-20 justify-center">
                <Switch checked={t.billable} aria-label={`${t.name} is billable`} onCheckedChange={(v) => void update(t, { billable: v })} />
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label={`Merge ${t.name} into another task`}
                title="Merge into another task"
                onClick={() => setMerging(t)}
              >
                <MergeIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label={t.archived ? `Restore ${t.name}` : `Archive ${t.name}`}
                title={t.archived ? "Restore" : "Archive"}
                onClick={() => void update(t, { archived: !t.archived })}
              >
                {t.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
              </Button>
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="flex gap-2 border-t bg-muted/50 px-5 py-3">
          <Label htmlFor="new-task" className="sr-only">
            New task
          </Label>
          <Input id="new-task" className="flex-1" placeholder="New task, like Research" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="outline" disabled={!name.trim()}>
            <PlusIcon />
            Add task
          </Button>
        </form>
      </Card>
      <Dialog open={merging !== null} onOpenChange={(o) => !o && setMerging(null)}>
        {merging && <MergeTaskDialog task={merging} onDone={() => setMerging(null)} />}
      </Dialog>
    </Section>
  );
}

/** Fold a duplicate task into the one you keep, then delete the duplicate. */
function MergeTaskDialog({ task, onDone }: { task: Task; onDone: () => void }) {
  const { data, reload, notify } = useData();
  const run = useAction();
  const others = data.tasks.filter((t) => t.id !== task.id);
  const norm = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Suggest the task whose name matches once spacing, case and punctuation are ignored.
  const [intoId, setIntoId] = useState<string>(() => String(others.find((t) => norm(t.name) === norm(task.name))?.id ?? ""));
  const [usage, setUsage] = useState<{ entries: number; projects: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const into = others.find((t) => String(t.id) === intoId);

  useEffect(() => {
    void run(() => api.taskUsage(task.id)).then((u) => u && setUsage(u));
  }, [run, task.id]);

  async function merge() {
    if (!into) return;
    setBusy(true);
    const ok = await run(() => api.mergeTask(task.id, into.id));
    setBusy(false);
    if (!ok) return;
    await reload();
    notify(`Merged "${task.name}" into "${into.name}".`);
    onDone();
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Merge "{task.name}"</DialogTitle>
        <DialogDescription>
          Its time entries and projects move to the task you keep, and "{task.name}" is deleted. Invoices you've sent keep their wording.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="merge-into">Keep</Label>
        <Select value={intoId} onValueChange={setIntoId}>
          <SelectTrigger id="merge-into">
            <SelectValue placeholder="Choose a task" />
          </SelectTrigger>
          <SelectContent>
            {others.map((t) => (
              <SelectItem key={t.id} value={String(t.id)}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          {usage === null
            ? "Checking…"
            : usage.entries === 0 && usage.projects === 0
              ? `"${task.name}" isn't used anywhere, so this just removes it.`
              : `${usage.entries.toLocaleString()} time ${usage.entries === 1 ? "entry" : "entries"} on ${usage.projects} ${usage.projects === 1 ? "project" : "projects"} move${into ? ` to "${into.name}"` : ""}.`}
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={!into || busy} onClick={() => void merge()}>
          {busy ? "Merging…" : into ? `Merge into "${into.name}"` : "Merge"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function TaskName({ task, onRename }: { task: Task; onRename: (name: string) => Promise<void> }) {
  const [value, setValue] = useState(task.name);
  return (
    <Input
      aria-label="Task name"
      className={cn("flex-1 border-transparent bg-transparent shadow-none hover:border-input", task.archived ? "text-muted-foreground" : "font-semibold")}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const v = value.trim();
        if (!v) return setValue(task.name);
        if (v !== task.name) void onRename(v);
      }}
    />
  );
}

/* Harvest import */

const BATCH = 400;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function niceDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function HarvestImport() {
  const { reload, notify } = useData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedHarvest | null>(null);
  const [fileName, setFileName] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

  async function onFile(file: File | undefined) {
    setResult(null);
    setError("");
    if (!file) return;
    setFileName(file.name);
    setParsed(parseHarvest(await file.text()));
  }

  const summary = useMemo(() => {
    if (!parsed || parsed.rows.length === 0) return null;
    const rows = parsed.rows;
    return {
      count: rows.length,
      from: rows[0].date,
      to: rows[rows.length - 1].date,
      clients: new Set(rows.map((r) => r.client.toLowerCase())).size,
      projects: new Set(rows.map((r) => `${r.client}|${r.project}`.toLowerCase())).size,
      minutes: rows.reduce((s, r) => s + r.minutes, 0),
      invoiced: rows.filter((r) => r.invoiced).length,
    };
  }, [parsed]);

  async function runImport() {
    if (!parsed) return;
    setError("");
    const rows = await withKeys(parsed.rows);
    const total: ImportResult = { clientsCreated: 0, projectsCreated: 0, tasksCreated: 0, entriesCreated: 0, entriesSkipped: 0 };
    setProgress(0);
    try {
      for (let i = 0; i < rows.length; i += BATCH) {
        const r = await api.importHarvest(rows.slice(i, i + BATCH));
        for (const k of Object.keys(total) as (keyof ImportResult)[]) total[k] += r[k];
        setProgress(Math.min(rows.length, i + BATCH));
      }
      setResult(total);
      await reload();
      notify(`Imported ${total.entriesCreated} entries.`);
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "The import stopped."} Rows already imported are kept; run it again to finish.`);
    } finally {
      setProgress(null);
    }
  }

  return (
    <Section
      title="Import from Harvest"
      intro="Bring your history over. Clients, projects and tasks are created to match, and entries already invoiced in Harvest are locked so they can't be billed twice. Importing the same file again won't create duplicates."
    >
      <Card className="overflow-hidden">
        <CardContent className="space-y-4">
          <ol className="grid gap-2 text-sm sm:grid-cols-3">
            {["In Harvest, open Reports, then Detailed time.", "Choose the full date range, with all clients and projects.", "Export as CSV and choose the file below."].map((step, i) => (
              <li key={step} className="flex gap-2.5 rounded-lg bg-muted/60 p-3">
                <span className="num flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
                <span className="text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Harvest CSV file" onChange={(e) => void onFile(e.target.files?.[0])} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-sm transition-colors hover:border-input hover:bg-muted/40"
          >
            <FileUpIcon className="size-6 text-muted-foreground" />
            <span className="font-semibold">{fileName || "Choose a Harvest CSV file"}</span>
            <span className="text-muted-foreground">{fileName ? "Choose a different file" : "Detailed time export, .csv"}</span>
          </button>
        </CardContent>

        {parsed && (
          <div className="space-y-3 border-t px-5 py-4">
            {summary && (
              <>
                <p className="text-sm">
                  <span className="font-semibold">{fileName}</span> has {plural(summary.count, "entry", "entries")} from {niceDate(summary.from)} to {niceDate(summary.to)},
                  totaling <span className="num">{formatDuration(summary.minutes, { blankZero: false })}</span> hours across {plural(summary.clients, "client")} and{" "}
                  {plural(summary.projects, "project")}. {summary.invoiced > 0 && `${plural(summary.invoiced, "entry was", "entries were")} already invoiced and will be locked.`}
                </p>
                {!result && (
                  <Button disabled={progress !== null} onClick={() => void runImport()}>
                    {progress !== null ? `Importing ${progress.toLocaleString()} of ${summary.count.toLocaleString()}…` : `Import ${plural(summary.count, "entry", "entries")}`}
                  </Button>
                )}
              </>
            )}
            {parsed.problems.length > 0 && (
              <details className="text-sm" open={!summary}>
                <summary className="cursor-pointer text-muted-foreground">
                  {parsed.problems.length} {parsed.problems.length === 1 ? "line needs" : "lines need"} attention
                </summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-destructive">
                  {parsed.problems.slice(0, 20).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {error && <p className="border-t px-5 py-4 text-sm text-destructive">{error}</p>}

        {result && (
          <div className="border-t bg-success-wash px-5 py-4 text-sm">
            <p className="font-semibold text-success">Import finished</p>
            <p className="mt-1 text-foreground">
              Added {plural(result.entriesCreated, "entry", "entries")}
              {result.entriesSkipped > 0 && ` (skipped ${result.entriesSkipped.toLocaleString()} already imported)`}, {plural(result.clientsCreated, "client")},{" "}
              {plural(result.projectsCreated, "project")} and {plural(result.tasksCreated, "task")}. Check the rates on each project, then head to{" "}
              <a href="#/day" className="font-semibold underline underline-offset-2">
                your timesheet
              </a>
              .
            </p>
          </div>
        )}
      </Card>
    </Section>
  );
}

/* Sample data and erase */

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB`;

function backupLabel(key: string) {
  const m = /^(daily|monthly)\/([\d-]+)\.json$/.exec(key);
  if (!m) return key;
  if (m[1] === "monthly") return `${new Date(`${m[2]}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" })}, kept 7 years`;
  return new Date(`${m[2]}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function Backups() {
  const run = useAction();
  const { notify } = useData();
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.backups>> | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => void run(() => api.backups()).then((s) => s && setStatus(s));
  useEffect(load, [run]);

  async function backUp() {
    setBusy(true);
    const r = await run(() => api.backUpNow());
    setBusy(false);
    if (r) {
      notify("Backed up.");
      load();
    }
  }

  const stale = status?.last && Date.now() - Date.parse(status.last.at) > 2 * 86_400_000;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Backups</CardTitle>
        <CardDescription>
          {status?.configured
            ? "A full copy is saved every night. The last 90 nights are kept, plus the first of each month for 7 years."
            : "Download a copy any time. For automatic nightly backups, create a bucket named zero-overhead-backups in Cloudflare R2."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 pt-4">
        {status?.configured && (
          <p className={cn("text-sm", stale ? "text-destructive" : "text-muted-foreground")}>
            {status.last ? `Last backup ${new Date(status.last.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}, ${kb(status.last.bytes)}.` : "No backup yet. The first runs tonight."}
            {stale && " That's more than two days ago; check the Worker's logs in Cloudflare."}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {status?.configured && (
            <Button variant="outline" disabled={busy} onClick={() => void backUp()}>
              <DatabaseIcon />
              {busy ? "Backing up…" : "Back up now"}
            </Button>
          )}
          <Button asChild variant="outline">
            <a href="/api/data/export" download>
              <DownloadIcon />
              Download a copy
            </a>
          </Button>
        </div>
        {status && status.recent.length > 0 && (
          <ul className="grid gap-1 text-sm">
            {status.recent.map((b) => (
              <li key={b.key} className="flex items-center justify-between border-t pt-1.5">
                <span>{backupLabel(b.key)}</span>
                <a className="text-primary underline-offset-2 hover:underline" href={`/api/data/backups/${b.key}`} download>
                  Download {kb(b.bytes)}
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DataTools() {
  const { reload, notify } = useData();
  const run = useAction();
  const [confirmText, setConfirmText] = useState("");
  const [eraseOpen, setEraseOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.erasePreview>> | null>(null);

  async function loadSample() {
    setBusy(true);
    const ok = await run(() => api.loadSample(toIsoDate(new Date())));
    if (ok) {
      await reload();
      notify("Sample data loaded. Try Reports to create an invoice.");
    }
    setBusy(false);
  }

  async function erase() {
    setBusy(true);
    const ok = await run(() => api.eraseTimeAndInvoices());
    if (ok) {
      await reload();
      setConfirmText("");
      setEraseOpen(false);
      notify("Time and invoices erased. Everything else is as it was.");
      location.hash = "#/day";
    }
    setBusy(false);
  }

  const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
  const deletes = preview
    ? [
        plural(preview.timeEntries, "time entry").replace("entrys", "entries"),
        plural(preview.invoices, "invoice"),
        ...(preview.clients ? [`${plural(preview.clients, "sample client")} and their projects`] : []),
        ...(preview.sampleTransactions ? [`${plural(preview.sampleTransactions, "sample bank transaction")} and their sample accounts`] : []),
      ]
    : [];

  return (
    <Section title="Data" intro="Your version, backups, sample data, and starting fresh.">
      <VersionCard />
      <Backups />

      <Card>
        <CardHeader>
          <CardTitle>Load sample data</CardTitle>
          <CardDescription>
            Two fictional clients with six weeks of hours and a few sample bank transactions, so you can try everything. Your business details aren't replaced.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <Button variant="outline" disabled={busy} onClick={() => void loadSample()}>
            <DatabaseIcon />
            Load sample data
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">Works when there's no time or invoices yet.</p>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone: erase time and invoices</CardTitle>
          <CardDescription>
            Deletes every time entry and invoice, and any sample data, so you can start tracking from scratch. Your clients and projects, business
            details, bank accounts and transactions, spending rules, tax profile and tax payments stay. This can't be undone.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <Dialog
            open={eraseOpen}
            onOpenChange={(o) => {
              setEraseOpen(o);
              if (o) {
                setPreview(null);
                void run(() => api.erasePreview()).then((p) => p && setPreview(p));
              } else setConfirmText("");
            }}
          >
            <DialogTrigger asChild>
              <Button variant="destructive">
                <Trash2Icon />
                Erase time and invoices
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Erase time and invoices?</DialogTitle>
                <DialogDescription>This deletes them for good. There's no undo.</DialogDescription>
              </DialogHeader>
              {!preview ? (
                <p className="text-sm text-muted-foreground">Counting…</p>
              ) : (
                <div className="grid gap-3 text-sm">
                  <div>
                    <p className="font-semibold text-destructive">Deletes</p>
                    <ul className="mt-1 list-disc pl-5">
                      {deletes.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="font-semibold">Keeps</p>
                    <p className="mt-1 text-muted-foreground">
                      Your clients, projects, tasks and rates, business details, bank connections and transactions (a deposit that paid a deleted invoice goes
                      back to To review), spending rules, tax profile and tax payments.
                    </p>
                  </div>
                  {preview.paidInvoices > 0 && (
                    <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive">
                      {plural(preview.paidInvoices, "invoice")} {preview.paidInvoices === 1 ? "is" : "are"} marked paid, so this may be real work. Download a
                      backup first.
                    </p>
                  )}
                  <Button asChild variant="outline" className="justify-self-start">
                    <a href="/api/data/export" download>
                      <DownloadIcon />
                      Download a backup first
                    </a>
                  </Button>
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="erase-confirm">
                  Type <span className="font-bold">erase</span> to confirm
                </Label>
                <Input id="erase-confirm" autoComplete="off" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEraseOpen(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" disabled={confirmText.trim().toLowerCase() !== "erase" || busy || !preview} onClick={() => void erase()}>
                  Erase time and invoices
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </Section>
  );
}
