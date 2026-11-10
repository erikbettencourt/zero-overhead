import type { QbImportRequest, QbImportResult, TaxPayment, TaxProfile, TaxSummary, VersionInfo, YearEndSummary, StatementColumns, StatementRow, StatementImportResult, Jurisdiction, BankOverview, BankRule, BankTransaction, SpendingSummary, SyncResult, TransactionKind, Summary, Bootstrap, Business, Client, HarvestRow, ImportResult, InvoiceDetail, InvoiceStatus, InvoiceSummary, Project, ProjectTask, Report, Task, TimeEntry, Timer } from "../shared/types";
import { toIsoDate } from "../shared/time";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Access's login page or a plain-text refusal: the session has likely expired.
    if (res.status === 401 || res.status === 403 || res.redirected) {
      throw new ApiError(res.status, "Your session has expired. Reload the page to sign in again.");
    }
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Request failed (${res.status}).`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const api = {
  bootstrap: () => request<Bootstrap>("GET", "/api/bootstrap"),

  createClient: (body: Partial<Client>) => request<Client>("POST", "/api/clients", body),
  updateClient: (id: number, body: Partial<Client>) => request<Client>("PATCH", `/api/clients/${id}`, body),

  createProject: (body: { clientId: number; name: string; rateCents?: number | null }) => request<Project>("POST", "/api/projects", body),
  updateProject: (id: number, body: Partial<Project>) => request<Project>("PATCH", `/api/projects/${id}`, body),
  setProjectTasks: (id: number, tasks: { taskId: number }[]) =>
    request<ProjectTask[]>("PUT", `/api/projects/${id}/tasks`, { tasks }),

  createTask: (body: { name: string; billable?: boolean }) => request<Task>("POST", "/api/tasks", body),
  updateTask: (id: number, body: Partial<Task>) => request<Task>("PATCH", `/api/tasks/${id}`, body),
  taskUsage: (id: number) => request<{ entries: number; projects: number }>("GET", `/api/tasks/${id}/usage`),
  mergeTask: (id: number, intoId: number) => request<{ ok: true }>("POST", `/api/tasks/${id}/merge`, { intoId }),

  entries: (from: string, to: string) => request<TimeEntry[]>("GET", `/api/entries?from=${from}&to=${to}`),
  createEntry: (body: { projectId: number; taskId: number; date: string; minutes: number; note?: string | null }) =>
    request<TimeEntry>("POST", "/api/entries", body),
  updateEntry: (id: number, body: Partial<Pick<TimeEntry, "minutes" | "note" | "date" | "projectId" | "taskId">>) =>
    request<TimeEntry>("PATCH", `/api/entries/${id}`, body),
  deleteEntry: (id: number) => request<void>("DELETE", `/api/entries/${id}`),

  startTimer: (body: { projectId: number; taskId: number; date: string; note?: string | null }) =>
    request<Timer>("POST", "/api/timer/start", body),
  stopTimer: () => request<TimeEntry>("POST", "/api/timer/stop", {}),
  discardTimer: () => request<void>("POST", "/api/timer/discard", {}),

  saveBusiness: (body: Business) => request<Business>("PUT", "/api/business", body),
  summary: (from: string, to: string) => request<Summary>("GET", `/api/summary?from=${from}&to=${to}`),
  report: (clientId: number, from: string, to: string) => request<Report>("GET", `/api/report?clientId=${clientId}&from=${from}&to=${to}`),
  invoices: () => request<InvoiceSummary[]>("GET", "/api/invoices"),
  invoice: (id: number) => request<InvoiceDetail>("GET", `/api/invoices/${id}`),
  createInvoice: (body: { clientId: number; from: string; to: string; issuedOn: string; dueOn?: string; number?: string }) => request<InvoiceDetail>("POST", "/api/invoices", body),
  updateInvoice: (id: number, body: { status?: InvoiceStatus; issuedOn?: string; dueOn?: string; paidOn?: string; notes?: string | null }) =>
    request<InvoiceDetail>("PATCH", `/api/invoices/${id}`, body),
  deleteInvoice: (id: number) => request<void>("DELETE", `/api/invoices/${id}`),

  eraseTimeAndInvoices: () => request<{ ok: true }>("POST", "/api/data/erase", { confirm: "erase" }),
  backups: () =>
    request<{ configured: boolean; last: { at: string; key: string; bytes: number } | null; recent: { key: string; bytes: number; uploaded: string }[] }>(
      "GET",
      "/api/data/backups",
    ),
  backUpNow: () => request<{ at: string; key: string }>("POST", "/api/data/backups", {}),
  erasePreview: () =>
    request<{ clients: number; projects: number; timeEntries: number; invoices: number; paidInvoices: number; sampleTransactions: number }>(
      "GET",
      "/api/data/erase-preview",
    ),
  loadSample: (today: string) => request<{ ok: true }>("POST", "/api/data/sample", { today }),

  importHarvest: (rows: (HarvestRow & { key: string })[]) => request<ImportResult>("POST", "/api/import/harvest", { rows }),

  bank: () => request<BankOverview>("GET", "/api/bank"),
  linkToken: (connectionId?: number) => request<{ linkToken: string }>("POST", "/api/bank/link-token", connectionId ? { connectionId } : {}),
  connectBank: (publicToken: string, institutionName: string) =>
    request<{ overview: BankOverview; sync: SyncResult }>("POST", "/api/bank/connections", { publicToken, institutionName }),
  bankReconnected: (id: number) => request<{ overview: BankOverview; sync: SyncResult }>("POST", `/api/bank/connections/${id}/reconnected`, {}),
  disconnectBank: (id: number) => request<void>("DELETE", `/api/bank/connections/${id}`),
  syncBanks: () => request<SyncResult>("POST", "/api/bank/sync", {}),
  updateBankAccount: (id: number, body: { businessOnly: boolean }) => request<BankOverview>("PATCH", `/api/bank/accounts/${id}`, body),
  createBankAccount: (body: { name: string; type: "depository" | "credit"; mask?: string }) =>
    request<{ id: number; overview: BankOverview }>("POST", "/api/bank/accounts", body),
  deleteBankAccount: (id: number) => request<BankOverview>("DELETE", `/api/bank/accounts/${id}`),
  importStatement: (id: number, body: { columns: StatementColumns; rows: StatementRow[] }) =>
    request<StatementImportResult>("POST", `/api/bank/accounts/${id}/import`, body),

  transactions: (q: { view: string; from?: string; to?: string; accountId?: number; q?: string; categoryId?: number | "none" }) =>
    request<BankTransaction[]>(
      "GET",
      `/api/transactions?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))}`,
    ),
  updateTransaction: (id: number, body: { kind?: TransactionKind | null; categoryId?: number | null }) =>
    request<BankTransaction>("PATCH", `/api/transactions/${id}`, body),
  updateTransactions: (ids: number[], body: { kind: TransactionKind | null; categoryId?: number | null }) =>
    request<{ changed: number; skipped: number }>("PATCH", "/api/transactions", { ids, ...body }),
  importQuickBooks: (body: QbImportRequest) => request<QbImportResult>("POST", "/api/import/quickbooks", body),
  matchTransaction: (id: number, invoiceIds: number[]) => request<BankTransaction>("POST", `/api/transactions/${id}/match`, { invoiceIds }),
  unmatchTransaction: (id: number) => request<BankTransaction>("POST", `/api/transactions/${id}/unmatch`, {}),
  spendingSummary: (from: string, to: string) => request<SpendingSummary>("GET", `/api/spending/summary?from=${from}&to=${to}`),

  rules: () => request<BankRule[]>("GET", "/api/rules"),
  createRule: (body: { matchText: string; kind: TransactionKind; categoryId?: number | null; transactionId?: number }) =>
    request<{ rule: BankRule; applied: number }>("POST", "/api/rules", body),
  deleteRule: (id: number) => request<void>("DELETE", `/api/rules/${id}`),

  // Today's date as you see it, not the server's (which is UTC, and a day ahead most evenings).
  taxes: (year: number) => request<TaxSummary>("GET", `/api/taxes/${year}?today=${toIsoDate(new Date())}`),
  checkForUpdate: () => request<VersionInfo>("POST", "/api/version/check", {}),
  yearEnd: (year: number) => request<YearEndSummary>("GET", `/api/taxes/${year}/year-end?today=${toIsoDate(new Date())}`),
  taxProfile: () => request<TaxProfile>("GET", "/api/tax-profile"),
  saveTaxProfile: (body: Partial<TaxProfile>) => request<TaxProfile>("PUT", "/api/tax-profile", body),
  recordTaxPayment: (body: { taxYear: number; jurisdiction: Jurisdiction; quarter: number; paidOn: string; amountCents: number; appliedRefund: boolean; note?: string | null }) =>
    request<TaxPayment>("POST", "/api/tax-payments", body),
  deleteTaxPayment: (id: number) => request<void>("DELETE", `/api/tax-payments/${id}`),
};
