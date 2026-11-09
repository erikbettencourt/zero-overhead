/**
 * The bank data provider. Plaid today, behind a small interface so tests can use a fake
 * and another provider could stand in later.
 */

export interface ProviderAccount {
  accountId: string;
  name: string;
  mask: string | null;
  type: string | null;
  subtype: string | null;
}

export interface ProviderTransaction {
  transactionId: string;
  accountId: string;
  date: string;
  name: string;
  merchantName: string | null;
  /** Money in is positive, money out is negative. */
  amountCents: number;
  pending: boolean;
  category: string | null;
}

export interface SyncPage {
  added: ProviderTransaction[];
  modified: ProviderTransaction[];
  removed: string[];
  nextCursor: string;
  hasMore: boolean;
}

export interface BankProvider {
  environment: string;
  /** True when stored bank logins are encrypted (BANK_TOKEN_KEY is set). */
  encryptsLogins?: boolean;
  /** A token for the bank login popup. With an access token, it reconnects that bank instead. */
  linkToken(accessToken?: string): Promise<string>;
  exchange(publicToken: string): Promise<{ accessToken: string; itemId: string }>;
  accounts(accessToken: string): Promise<ProviderAccount[]>;
  sync(accessToken: string, cursor: string | null): Promise<SyncPage>;
  remove(accessToken: string): Promise<void>;
}

/** An error from the provider. needsReconnect means the bank wants you to log in again. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public code: string,
    public needsReconnect = false,
  ) {
    super(message);
  }
}

// Plaid's codes for "the login stopped working; log in again to continue".
const RECONNECT_CODES = new Set(["ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION", "ACCESS_NOT_GRANTED", "NO_ACCOUNTS", "USER_PERMISSION_REVOKED"]);

export interface PlaidEnv {
  PLAID_CLIENT_ID?: string;
  PLAID_SECRET?: string;
  /** "production" (the default, also used by Plaid's free Trial plan) or "sandbox" for Plaid's test bank. */
  PLAID_ENV?: string;
}

const toCents = (amount: number) => Math.round(amount * 100);

type PlaidTxn = {
  transaction_id: string;
  account_id: string;
  date: string;
  name: string;
  merchant_name?: string | null;
  amount: number;
  pending: boolean;
  personal_finance_category?: { primary?: string } | null;
};

function toTransaction(t: PlaidTxn): ProviderTransaction {
  return {
    transactionId: t.transaction_id,
    accountId: t.account_id,
    date: t.date,
    name: t.name,
    merchantName: t.merchant_name ?? null,
    // Plaid reports money out as positive. We store money in as positive.
    amountCents: -toCents(t.amount),
    pending: t.pending,
    category: t.personal_finance_category?.primary ?? null,
  };
}

export function plaidFromEnv(env: PlaidEnv, fetcher: typeof fetch = fetch): BankProvider | undefined {
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) return undefined;
  const environment = env.PLAID_ENV === "sandbox" ? "sandbox" : "production";
  const base = `https://${environment}.plaid.com`;

  async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetcher(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, ...body }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const code = String(data.error_code ?? `HTTP_${res.status}`);
      const message = String(data.display_message ?? data.error_message ?? "The bank connection failed.");
      throw new ProviderError(message, code, RECONNECT_CODES.has(code));
    }
    return data as T;
  }

  return {
    environment,
    async linkToken(accessToken) {
      const body: Record<string, unknown> = {
        client_name: "Zero Overhead",
        user: { client_user_id: "owner" },
        country_codes: ["US"],
        language: "en",
      };
      if (accessToken) body.access_token = accessToken;
      else {
        body.products = ["transactions"];
        // Ask for two years on the first connection, so a whole tax year arrives at once.
        body.transactions = { days_requested: 730 };
      }
      return (await call<{ link_token: string }>("/link/token/create", body)).link_token;
    },
    async exchange(publicToken) {
      const r = await call<{ access_token: string; item_id: string }>("/item/public_token/exchange", { public_token: publicToken });
      return { accessToken: r.access_token, itemId: r.item_id };
    },
    async accounts(accessToken) {
      const r = await call<{ accounts: { account_id: string; name: string; official_name?: string; mask?: string; type?: string; subtype?: string }[] }>(
        "/accounts/get",
        { access_token: accessToken },
      );
      return r.accounts.map((a) => ({ accountId: a.account_id, name: a.name, mask: a.mask ?? null, type: a.type ?? null, subtype: a.subtype ?? null }));
    },
    async sync(accessToken, cursor) {
      const r = await call<{ added: PlaidTxn[]; modified: PlaidTxn[]; removed: { transaction_id: string }[]; next_cursor: string; has_more: boolean }>(
        "/transactions/sync",
        { access_token: accessToken, ...(cursor ? { cursor } : {}), count: 500 },
      );
      return {
        added: r.added.map(toTransaction),
        modified: r.modified.map(toTransaction),
        removed: r.removed.map((x) => x.transaction_id),
        nextCursor: r.next_cursor,
        hasMore: r.has_more,
      };
    },
    async remove(accessToken) {
      await call("/item/remove", { access_token: accessToken });
    },
  };
}
