import { lazy, Suspense, useEffect, useState } from "react";
import { DataProvider, useData } from "./state";
import Timesheet from "./views/Timesheet";
import { LogoMark } from "@/components/logo";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { DatabaseIcon, DownloadIcon, PlusIcon } from "lucide-react";

const StyleGuide = lazy(() => import("./views/StyleGuide"));
import { isIsoDate, toIsoDate } from "../shared/time";
import SettingsView from "./views/Settings";
import ReportsView from "./views/Reports";
import { InvoiceList, InvoicePage } from "./views/Invoices";
import SpendingView, { type SpendingView as SpendingTab } from "./views/Spending";
import TaxesView from "./views/Taxes";
import YearEndView from "./views/YearEnd";

type Route =
  | { view: "day"; date: string }
  | { view: "week"; date: string }
  | { view: "reports"; from?: string; to?: string; clientId?: number }
  | { view: "invoices" }
  | { view: "invoice"; id: number }
  | { view: "spending"; tab: SpendingTab; from?: string; to?: string; q?: string }
  | { view: "taxes"; year: number }
  | { view: "yearEnd"; year: number }
  | { view: "settings"; tab: string }
  | { view: "styleguide" };

function parseHash(): Route {
  const [, view, sub] = location.hash.replace(/^#/, "").split("/");
  if (view === "settings") return { view: "settings", tab: sub || "clients" };
  if (view === "styleguide") return { view: "styleguide" };
  if (view === "reports") {
    const [, , from, to, client] = location.hash.replace(/^#/, "").split("/");
    const ok = isIsoDate(from) && isIsoDate(to) && from <= to;
    return { view: "reports", ...(ok ? { from, to } : {}), ...(ok && /^\d+$/.test(client ?? "") ? { clientId: Number(client) } : {}) };
  }
  if (view === "taxes" && /^\d{4}$/.test(sub ?? "") && location.hash.split("/")[3] === "year-end") return { view: "yearEnd", year: Number(sub) };
  if (view === "taxes") return { view: "taxes", year: /^\d{4}$/.test(sub ?? "") ? Number(sub) : new Date().getFullYear() };
  if (view === "spending") {
    // A search can ride along after "?", like #/spending/all/2026-01-01/2026-12-31?q=slack.
    const [path, query] = location.hash.replace(/^#/, "").split("?");
    const [, , tab, from, to] = path.split("/");
    const ok = isIsoDate(from) && isIsoDate(to) && from <= to;
    const tabs = ["review", "business", "personal", "transfer", "all"];
    const q = new URLSearchParams(query ?? "").get("q") ?? undefined;
    return { view: "spending", tab: (tabs.includes(tab) ? tab : "review") as SpendingTab, ...(ok ? { from, to } : {}), ...(q ? { q } : {}) };
  }
  if (view === "invoices" && sub && /^\d+$/.test(sub)) return { view: "invoice", id: Number(sub) };
  if (view === "invoices") return { view: "invoices" };
  const date = isIsoDate(sub) ? sub : toIsoDate(new Date());
  if (view === "week") return { view: "week", date };
  return { view: "day", date };
}

export default function App() {
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  );
}

function Shell() {
  const [route, setRoute] = useState<Route>(parseHash);
  const { data } = useData();

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const isEmpty = data.projectTasks.length === 0;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b bg-card/90 backdrop-blur print:hidden">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <a href="#/day" className="-m-1 flex shrink-0 items-center rounded-md p-1" title="Zero Overhead">
            <LogoMark />
          </a>
          <nav className="flex gap-1 overflow-x-auto">
            <NavLink href="#/day" active={route.view === "day" || route.view === "week"}>
              Time
            </NavLink>
            <NavLink href="#/reports" active={route.view === "reports"}>
              Reports
            </NavLink>
            <NavLink href="#/invoices" active={route.view === "invoices" || route.view === "invoice"}>
              Invoices
            </NavLink>
            <NavLink href="#/spending" active={route.view === "spending"}>
              Transactions
            </NavLink>
            <NavLink href="#/taxes" active={route.view === "taxes" || route.view === "yearEnd"}>
              Taxes
            </NavLink>
            <NavLink href="#/settings/clients" active={route.view === "settings"}>
              Settings
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-4">
            {data.version.updateAvailable && (
              <a href="#/settings/version" className="flex items-center gap-1.5 text-sm font-semibold text-now underline-offset-2 hover:underline">
                <span aria-hidden="true" className="size-2 rounded-full bg-now" />
                Update available
              </a>
            )}
            <span className="hidden text-sm text-muted-foreground sm:block">{data.email}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 print:max-w-none print:p-0">
        {(route.view === "day" || route.view === "week") && (isEmpty ? <FirstRun /> : <Timesheet mode={route.view} date={route.date} />)}
        {route.view === "reports" && <ReportsView from={route.from} to={route.to} clientId={route.clientId} />}
        {route.view === "invoices" && <InvoiceList />}
        {route.view === "invoice" && <InvoicePage id={route.id} />}
        {route.view === "spending" && <SpendingView key={route.q ?? ""} view={route.tab} from={route.from} to={route.to} initialSearch={route.q} />}
        {route.view === "taxes" && <TaxesView year={route.year} />}
        {route.view === "yearEnd" && <YearEndView year={route.year} />}
        {route.view === "settings" && <SettingsView tab={route.tab} />}
        {route.view === "styleguide" && (
          <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
            <StyleGuide />
          </Suspense>
        )}
      </main>
    </div>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: string }) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {children}
    </a>
  );
}

function FirstRun() {
  const options = [
    { href: "#/settings/clients", icon: PlusIcon, title: "Add a client", body: "Then a project, and the tasks you do on it.", primary: true },
    { href: "#/settings/import", icon: DownloadIcon, title: "Import from Harvest", body: "Bring your history over. Clients, projects and tasks come with it." },
    { href: "#/settings/data", icon: DatabaseIcon, title: "Load sample data", body: "Try everything with made-up clients, then erase it." },
  ];
  return (
    <div className="mx-auto max-w-2xl py-10">
      <h1 className="text-2xl font-bold tracking-tight">Set up your work to start tracking time</h1>
      <p className="mt-2 text-muted-foreground">Everything in the timesheet hangs off a client, a project and its tasks. Pick a way to get started.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {options.map(({ href, icon: Icon, title, body, primary }) => (
          <a key={href} href={href} className="group">
            <Card className={cn("h-full p-4 transition-colors group-hover:border-input group-hover:bg-accent/40", primary && "border-primary/30")}>
              <span className={cn("flex size-8 items-center justify-center rounded-md", primary ? "bg-primary text-primary-foreground" : "bg-muted")}>
                <Icon className="size-4" />
              </span>
              <p className="mt-3 font-bold">{title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </Card>
          </a>
        ))}
      </div>
    </div>
  );
}
