/** Shapes the API returns. Money in cents, time in minutes, dates as YYYY-MM-DD. */

export interface Client {
  id: number;
  name: string;
  email: string | null;
  address: string | null;
  defaultRateCents: number | null;
  paymentTermsDays: number;
  billingPeriod: BillingPeriod;
  archived: boolean;
}

export type BillingPeriod = "monthly" | "biweekly" | "quarterly";

export interface Project {
  id: number;
  clientId: number;
  name: string;
  rateCents: number | null;
  archived: boolean;
}

export interface Task {
  id: number;
  name: string;
  billable: boolean;
  archived: boolean;
}

export interface ProjectTask {
  projectId: number;
  taskId: number;
  rateCents: number | null;
}

export interface TimeEntry {
  id: number;
  projectId: number;
  taskId: number;
  date: string;
  minutes: number;
  note: string | null;
  locked: boolean;
}

export interface Timer {
  projectId: number;
  taskId: number;
  note: string | null;
  date: string;
  startedAt: string;
}

export interface Bootstrap {
  email: string;
  clients: Client[];
  projects: Project[];
  tasks: Task[];
  projectTasks: ProjectTask[];
  timer: Timer | null;
  business: Business;
  categories: ExpenseCategory[];
  version: VersionInfo;
}

/** This install's version, and the latest one published, checked nightly. */
export interface VersionInfo {
  current: string;
  /** Null until the first check. */
  latest: string | null;
  checkedAt: string | null;
  updateAvailable: boolean;
  changelogUrl: string;
}

export interface HarvestRow {
  date: string;
  client: string;
  project: string;
  task: string;
  notes: string;
  minutes: number;
  billableRateCents: number | null;
  invoiced: boolean;
}

export interface ImportResult {
  clientsCreated: number;
  projectsCreated: number;
  tasksCreated: number;
  entriesCreated: number;
  entriesSkipped: number;
}

export interface Business {
  name: string;
  email: string;
  phone: string;
  address: string;
  /** A data URL, or "" for none. */
  logo: string;
  paymentInstructions: string;
  nextInvoiceNumber: string;
}

/** One project + task on a report or invoice. */
export interface ReportLine {
  projectId: number;
  taskId: number;
  description: string;
  billable: boolean;
  minutes: number;
  rateCents: number | null;
  amountCents: number;
}

export interface ReportEntry {
  id: number;
  date: string;
  description: string;
  minutes: number;
  note: string | null;
  invoiceId: number | null;
  invoiceNumber: string | null;
  invoicedElsewhere: boolean;
}

export interface Report {
  clientId: number;
  from: string;
  to: string;
  lines: ReportLine[];
  entries: ReportEntry[];
  totalMinutes: number;
  billableMinutes: number;
  amountCents: number;
  /** Billable time in the period not yet on any invoice. */
  uninvoicedMinutes: number;
  uninvoicedAmountCents: number;
  /** Lines with uninvoiced billable time but no rate anywhere. */
  missingRates: string[];
}

/** Unpaid until the money arrives. Overdue is just an unpaid invoice past its due date. */
export type InvoiceStatus = "unpaid" | "paid";

export interface InvoiceSummary {
  id: number;
  number: string;
  clientId: number;
  clientName: string;
  periodStart: string;
  periodEnd: string;
  issuedOn: string | null;
  dueOn: string | null;
  status: InvoiceStatus;
  totalCents: number;
  paidOn: string | null;
}

export interface InvoiceLine {
  description: string;
  minutes: number;
  rateCents: number;
  amountCents: number;
}

export interface InvoiceRef {
  id: number;
  number: string;
  clientName: string;
  totalCents: number;
}

export interface InvoiceDetail extends InvoiceSummary {
  notes: string | null;
  paidOn: string | null;
  /** The deposit that paid it. Its date is the paid date. */
  deposit: { id: number; date: string; amountCents: number; accountName: string; alsoPaid: string[] } | null;
  /** Only without a bank: then you mark invoices paid yourself, with the date the money arrived. */
  markPaidByHand: boolean;
  client: { name: string; email: string | null; address: string | null };
  business: Omit<Business, "nextInvoiceNumber">;
  lines: InvoiceLine[];
  entries: ReportEntry[];
}

/** One client's totals for a date range, for the all-clients report. */
export interface ClientSummary {
  clientId: number;
  clientName: string;
  archived: boolean;
  minutes: number;
  billableMinutes: number;
  /** Value of all billable time in the range, at current rates. */
  earnedCents: number;
  /** Billable time already on an invoice here, or invoiced in Harvest. */
  invoicedCents: number;
  uninvoicedMinutes: number;
  uninvoicedCents: number;
  /** Billable time with no rate set, which can't be invoiced yet. */
  missingRateMinutes: number;
}

export interface Summary {
  from: string;
  to: string;
  clients: ClientSummary[];
}

/* Bank connections and spending */

/** What a transaction is. Unset means it still needs review. */
/** A transfer is money between your own accounts (owner draws, money you put in, card payments): neither income nor spending. */
export type TransactionKind = "business" | "personal" | "transfer";

export interface BankAccount {
  id: number;
  name: string;
  mask: string | null;
  type: string | null;
  institutionName: string;
  /** Everything here is business or a transfer, never personal. */
  businessOnly: boolean;
  /** Brought in from bank statements rather than connected through Plaid. */
  imported: boolean;
  /** The statement columns last used for this account. */
  csvColumns: StatementColumns | null;
}

/** Which columns of a bank's CSV export hold what. Names are the export's own headings. */
export interface StatementColumns {
  date: string;
  description: string;
  /** One signed amount column... */
  amount?: string;
  /** ...or separate columns for money out and money in. */
  debit?: string;
  credit?: string;
  /** In an amount column, how the bank shows money going out. Card exports often show charges as positive. */
  moneyOut: "negative" | "positive";
}

export interface StatementRow {
  date: string;
  description: string;
  amountCents: number;
  /** The same row in a later export gets the same key, so it isn't added twice. */
  key: string;
}

export interface StatementImportResult {
  added: number;
  skipped: number;
  sorted: number;
  from: string;
  to: string;
}

export interface BankConnection {
  id: number;
  institutionName: string;
  /** "reconnect" when the bank needs you to log in again. */
  status: "ok" | "reconnect";
  error: string | null;
  lastSyncedAt: string | null;
  accounts: BankAccount[];
}

export interface BankOverview {
  /** False until the Plaid keys are set on the Worker. */
  configured: boolean;
  environment: string;
  /** Whether stored bank logins are encrypted. */
  encrypted: boolean;
  connections: BankConnection[];
  /** Accounts brought in from statements. */
  imported: BankAccount[];
}

export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  categorized: number;
  needsReconnect: string[];
  errors: string[];
}

export interface ExpenseCategory {
  id: number;
  name: string;
  scheduleCLine: string | null;
  deductiblePercent: number;
  /** Schedule C spending, or health insurance premiums, which are deducted separately and aren't business spending. */
  deduction: "schedule_c" | "health_insurance";
  /** Whether any transaction or rule uses it, so pickers can show the short list first. */
  used: boolean;
}

export interface BankTransaction {
  id: number;
  accountId: number;
  accountName: string;
  /** On a business-only account: business or transfer, never personal. */
  businessAccount: boolean;
  date: string;
  name: string;
  merchantName: string | null;
  /** Money in is positive, money out is negative. */
  amountCents: number;
  kind: TransactionKind | null;
  categoryId: number | null;
  /** The invoices this deposit paid. Usually one; a client can pay several at once. */
  invoices: InvoiceRef[];
  ruleId: number | null;
  /** Extra detail, like the merchant behind a PayPal charge, carried over from an import. */
  note: string | null;
  /**
   * For a deposit not yet matched: the unpaid invoice for exactly this amount or, failing
   * that, two or three from one client that add up to it.
   */
  suggestedInvoices: InvoiceRef[] | null;
  needsReview: boolean;
}

export interface BankRule {
  id: number;
  matchText: string;
  kind: TransactionKind;
  categoryId: number | null;
  categoryName: string | null;
  /** Transactions this rule fits best, however they were sorted. */
  matches: number;
  /** Of those, how many are still to review, and how many are sorted differently from the rule. */
  unsorted: number;
  different: number;
  /** The earliest of them, for opening them all in Spending. */
  firstDate: string | null;
}

export interface SpendingSummary {
  from: string;
  to: string;
  toReview: number;
  /** Business spending net of refunds, as a positive number. */
  businessSpendingCents: number;
  /** Health insurance premiums paid, deducted separately from business spending. */
  healthInsuranceCents: number;
  /** Money that arrived: paid invoices by the date received, plus other business deposits. */
  receivedCents: number;
  byCategory: { categoryId: number | null; name: string; cents: number }[];
}

/* QuickBooks import */

/** What a QuickBooks row becomes here. */
export type QbTarget =
  | { kind: "personal" }
  /** Business; a null category is income for money in. */
  | { kind: "business"; categoryId: number | null }
  /** An estimated tax payment, recorded on the Taxes page. */
  | { kind: "tax"; jurisdiction: Jurisdiction };

/** Where a QuickBooks account's transactions are found here. */
export type QbAccountPlan =
  | { mode: "account"; accountId: number }
  /** Paid through a service like PayPal: look for its lines in this account. */
  | { mode: "via"; accountId: number; match: string }
  | { mode: "skip" };

export interface QbImportRow {
  key: string;
  date: string;
  accountKey: string;
  description: string;
  amountCents: number;
  target: QbTarget;
  /** For a tax payment. */
  taxYear?: number;
  quarter?: 1 | 2 | 3 | 4;
  appliedRefund?: boolean;
}

export interface QbImportRequest {
  rows: QbImportRow[];
  accounts: Record<string, QbAccountPlan>;
  /** Add business transactions that aren't in your bank's download. */
  addMissing: boolean;
  /** False to see what would happen without changing anything. */
  commit: boolean;
}

export interface QbImportResult {
  committed: boolean;
  /** Rows found among your downloaded transactions. */
  matched: number;
  /** Matched transactions sorted (or re-sorted) by the import. */
  sorted: number;
  /** Matched transactions you'd already sorted differently here, left as you had them. */
  keptYours: number;
  /** Business rows not found here, and whether they were added. */
  missingBusiness: { date: string; accountKey: string; description: string; amountCents: number; added: boolean }[];
  /** Personal rows not found here, which don't need adding. */
  missingPersonal: number;
  /** Rows from accounts set to skip. */
  skipped: number;
  taxPayments: { added: number; alreadyRecorded: number };
}

/* Taxes */

export type FilingStatus = "single" | "joint";

/** What the tax estimate needs to know beyond your freelance income. Set once a year. */
export interface TaxProfile {
  filingStatus: FilingStatus;
  /** Two-letter state code, "custom" for your own rate, or "" until chosen. */
  state: string;
  /** For "custom": a flat rate in basis points (5% is 500) and a deduction. */
  customStateRateBps: number;
  customStateDeductionCents: number;
  /** A city or county income tax rate in basis points, applied to adjusted gross income. */
  localTaxRateBps: number;
  /** Yearly W-2 wages from a job, if any. */
  w2WagesCents: number;
  /** Federal and state tax withheld from those wages for the year. */
  w2FederalWithheldCents: number;
  w2StateWithheldCents: number;
  /** Other taxable income for the year: interest, a spouse's income on a joint return, and so on. */
  otherIncomeCents: number;
  /** Last year's total tax, for the safe harbor amount. Leave at 0 if unknown. */
  priorYearFederalTaxCents: number;
  priorYearStateTaxCents: number;
  /** Over $150,000 last year means the federal safe harbor is 110% of last year's tax. */
  priorYearAgiCents: number;
  /** Your own forecast of this year's profit. 0 projects it from the year so far. */
  expectedProfitCents: number;
}

export type Jurisdiction = "federal" | "state";

export interface TaxPayment {
  id: number;
  taxYear: number;
  jurisdiction: Jurisdiction;
  quarter: 1 | 2 | 3 | 4;
  paidOn: string;
  amountCents: number;
  /** A refund from last year's return applied to this year instead of paid out. */
  appliedRefund: boolean;
  note: string | null;
}

export interface TaxQuarter {
  quarter: 1 | 2 | 3 | 4;
  dueOn: string;
  federal: { estimateCents: number; paidCents: number };
  state: { estimateCents: number; paidCents: number };
  status: "paid" | "due" | "past due" | "upcoming";
}

export interface TaxBreakdown {
  receivedCents: number;
  businessSpendingCents: number;
  /** Spending you can deduct, after limits such as half of meals. */
  deductibleSpendingCents: number;
  profitCents: number;
  /** The year's profit the estimate is based on. */
  projectedProfitCents: number;
  projection: "actual" | "projected" | "expected";
  /** Health insurance premiums paid in the year, and the amount the estimate uses for the full year. */
  healthInsuranceCents: number;
  projectedHealthInsuranceCents: number;
  healthInsuranceDeductionCents: number;
  selfEmploymentTaxCents: number;
  additionalMedicareCents: number;
  federalTaxableIncomeCents: number;
  qbiDeductionCents: number;
  federalIncomeTaxCents: number;
  federalTotalCents: number;
  stateTaxableIncomeCents: number;
  stateIncomeTaxCents: number;
  localTaxCents: number;
  stateTotalCents: number;
}

/** One year, on a cash basis, laid out for an accountant. */
export interface YearEndSummary {
  year: number;
  businessName: string;
  /** The state's name, or null when none is chosen. */
  stateName: string | null;
  /** Schedule C line 1: paid invoices by the day the money arrived, plus other business deposits. */
  grossReceiptsCents: number;
  /** Paid this year for invoices sent in an earlier year. Included. */
  fromEarlierYears: { cents: number; count: number };
  /** Sent this year and not paid by year end. Counts in the year it's paid. */
  notPaidInYear: { cents: number; count: number };
  /** Spending net of refunds, by Schedule C line. Health insurance is separate. */
  expenses: { line: string | null; name: string; deductiblePercent: number; spentCents: number; deductibleCents: number }[];
  totalSpentCents: number;
  totalDeductibleCents: number;
  /** Schedule C line 31. */
  netProfitCents: number;
  /** Schedule 1, line 17. */
  healthInsuranceCents: number;
  payments: TaxPayment[];
  /** Things that would change the numbers, for you to fix before sending. */
  checks: {
    toReview: number;
    uncategorized: number;
    missingQuarters: { quarter: 1 | 2 | 3 | 4; dueOn: string }[];
  };
}

export interface TaxSummary {
  year: number;
  /** The tax figures used, which can be an earlier year's until the new ones are added. */
  figuresYear: number;
  /** Figures carried over from the year before because the new ones weren't published yet. */
  pendingFigures: string[];
  /** The state the estimate uses. */
  state: { code: string; name: string; chosen: boolean; noIncomeTax: boolean; localTaxes: boolean };
  profile: TaxProfile;
  breakdown: TaxBreakdown;
  quarters: TaxQuarter[];
  payments: TaxPayment[];
  /** The next payment, including any catch-up for earlier quarters that came up short. */
  next: { quarter: number; dueOn: string; federalCents: number; stateCents: number; catchUpCents: number } | null;
  paidCents: number;
  estimatedCents: number;
  /** Paying this each quarter avoids underpayment penalties, when last year's tax is known. */
  safeHarbor: { federalPerQuarterCents: number; statePerQuarterCents: number } | null;
}
