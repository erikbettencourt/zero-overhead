import { authenticate, type AuthEnv } from "./auth";
import { handleApi } from "./api";
import { syncAll } from "./bank";
import { runBackup } from "./backup";
import { plaidFromEnv, type BankProvider, type PlaidEnv } from "./plaid";
import { sealedProvider, sealStoredTokens, vaultFromKey } from "./vault";

export interface Env extends AuthEnv, PlaidEnv {
  ASSETS: Fetcher;
  DB?: D1Database;
  /** R2 bucket for nightly backups. */
  BACKUPS?: R2Bucket;
  /** 32 random bytes, base64. Encrypts stored bank logins. */
  BANK_TOKEN_KEY?: string;
}

/** Plaid, with bank logins encrypted at rest when BANK_TOKEN_KEY is set. */
async function bankFor(env: Env): Promise<BankProvider | undefined> {
  const plaid = plaidFromEnv(env);
  if (!plaid) return undefined;
  return sealedProvider(plaid, await vaultFromKey(env.BANK_TOKEN_KEY));
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy":
    // Plaid's bank login runs its own script and frame from cdn.plaid.com; nothing else is allowed in.
    "default-src 'self'; script-src 'self' https://cdn.plaid.com; frame-src https://cdn.plaid.com; connect-src 'self' https://production.plaid.com https://sandbox.plaid.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function withSecurityHeaders(response: Response): Response {
  const res = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  return res;
}

function plain(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * Changes must come from this app itself: JSON only (an HTML form on another site can't
 * send that without a CORS preflight, which we never grant) and, when the browser sends
 * an Origin, it must be ours.
 */
export function isSafeWrite(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  const type = request.headers.get("content-type") ?? "";
  const hasBody = request.method !== "DELETE" || Number(request.headers.get("content-length") ?? 0) > 0;
  return !hasBody || type.toLowerCase().startsWith("application/json");
}

export default {
  async fetch(request, env): Promise<Response> {
    // Every request, including the app's own files, passes through here first.
    const auth = await authenticate(request, env);
    if (!auth.ok) return withSecurityHeaders(plain(auth.status, auth.reason));

    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (!isSafeWrite(request)) return withSecurityHeaders(plain(403, "Cross-site request refused."));
      return withSecurityHeaders(await handleApi(request, env.DB, auth.email, await bankFor(env), env.BACKUPS));
    }
    const res = withSecurityHeaders(await env.ASSETS.fetch(request));
    // Hashed bundles never change, so keep them. Everything else (index.html) must be
    // rechecked on every load, or a deploy can sit unseen behind a cached page.
    res.headers.set(
      "Cache-Control",
      url.pathname.startsWith("/assets/") ? "private, max-age=31536000, immutable" : "private, no-cache",
    );
    return res;
  },

  // Every night: back up first, then encrypt any old bank logins, then pull new transactions.
  async scheduled(_controller, env, ctx) {
    const db = env.DB;
    if (!db) return;
    ctx.waitUntil(
      (async () => {
        if (env.BACKUPS) {
          try {
            await runBackup(db, env.BACKUPS);
          } catch (e) {
            console.error("Nightly backup failed", e);
          }
        }
        const bank = await bankFor(env);
        if (!bank) return;
        await sealStoredTokens(db, await vaultFromKey(env.BANK_TOKEN_KEY));
        const r = await syncAll(db, bank);
        if (r.errors.length || r.needsReconnect.length) console.warn("Bank sync problems", JSON.stringify(r));
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
