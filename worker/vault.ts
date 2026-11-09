import type { BankProvider } from "./plaid";
import { ProviderError } from "./plaid";

/**
 * Bank access tokens are stored encrypted (AES-GCM) with BANK_TOKEN_KEY, a secret only the
 * Worker holds. Without the key, tokens are stored as before, so the app keeps working.
 * Encrypted values look like "enc:v1:<base64 of iv + ciphertext>".
 */
const PREFIX = "enc:v1:";

export interface Vault {
  enabled: boolean;
  seal(plain: string): Promise<string>;
  open(stored: string): Promise<string>;
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const isSealed = (stored: string) => stored.startsWith(PREFIX);

export async function vaultFromKey(keyBase64: string | undefined): Promise<Vault> {
  if (!keyBase64) {
    return {
      enabled: false,
      seal: async (plain) => plain,
      open: async (stored) => {
        if (isSealed(stored)) throw new ProviderError("BANK_TOKEN_KEY is missing, so the bank login can't be read. Add it back in Cloudflare.", "VAULT_KEY_MISSING");
        return stored;
      },
    };
  }
  const raw = unb64(keyBase64.trim());
  if (raw.length !== 32) throw new Error("BANK_TOKEN_KEY must be 32 random bytes, base64 encoded.");
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  return {
    enabled: true,
    async seal(plain) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
      const out = new Uint8Array(iv.length + ct.length);
      out.set(iv);
      out.set(ct, iv.length);
      return PREFIX + b64(out);
    },
    async open(stored) {
      if (!isSealed(stored)) return stored;
      const bytes = unb64(stored.slice(PREFIX.length));
      try {
        const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
        return new TextDecoder().decode(pt);
      } catch {
        throw new ProviderError("The bank login couldn't be decrypted. BANK_TOKEN_KEY may have changed.", "VAULT_KEY_MISMATCH");
      }
    },
  };
}

/**
 * A provider that hands out sealed tokens and opens them before each call, so the rest
 * of the app only ever stores and passes sealed tokens.
 */
export function sealedProvider(inner: BankProvider, vault: Vault): BankProvider {
  return {
    environment: inner.environment,
    encryptsLogins: vault.enabled,
    linkToken: async (token) => inner.linkToken(token ? await vault.open(token) : undefined),
    exchange: async (publicToken) => {
      const r = await inner.exchange(publicToken);
      return { ...r, accessToken: await vault.seal(r.accessToken) };
    },
    accounts: async (token) => inner.accounts(await vault.open(token)),
    sync: async (token, cursor) => inner.sync(await vault.open(token), cursor),
    remove: async (token) => inner.remove(await vault.open(token)),
  };
}

/** Encrypt any tokens stored before the key was set. */
export async function sealStoredTokens(db: D1Database, vault: Vault): Promise<number> {
  if (!vault.enabled) return 0;
  const rows = (await db.prepare("SELECT id, access_token FROM bank_items WHERE access_token NOT LIKE 'enc:v1:%'").all<{ id: number; access_token: string }>()).results;
  if (rows.length === 0) return 0;
  await db.batch(
    await Promise.all(rows.map(async (r) => db.prepare("UPDATE bank_items SET access_token = ? WHERE id = ?").bind(await vault.seal(r.access_token), r.id))),
  );
  return rows.length;
}
