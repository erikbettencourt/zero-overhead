/** Plaid's bank login popup. Its script is only loaded when you connect a bank. */

type LinkMetadata = { institution?: { name?: string } | null };
type PlaidHandler = { open: () => void; destroy: () => void };
type PlaidGlobal = {
  create: (config: {
    token: string;
    onSuccess: (publicToken: string, metadata: LinkMetadata) => void;
    onExit: (error: { display_message?: string | null; error_message?: string } | null) => void;
  }) => PlaidHandler;
};

const SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
let loading: Promise<PlaidGlobal> | null = null;

function loadPlaid(): Promise<PlaidGlobal> {
  const existing = (window as unknown as { Plaid?: PlaidGlobal }).Plaid;
  if (existing) return Promise.resolve(existing);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => resolve((window as unknown as { Plaid: PlaidGlobal }).Plaid);
    script.onerror = () => {
      loading = null;
      reject(new Error("Couldn't load Plaid. Check your connection and try again."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Open the bank login. Resolves with the public token and bank name when you finish,
 * or null if you close it. Errors from the bank come back as a rejected promise.
 */
export async function openPlaidLink(linkToken: string): Promise<{ publicToken: string; institutionName: string } | null> {
  const Plaid = await loadPlaid();
  return new Promise((resolve, reject) => {
    const handler = Plaid.create({
      token: linkToken,
      onSuccess: (publicToken, metadata) => {
        handler.destroy();
        resolve({ publicToken, institutionName: metadata.institution?.name ?? "Bank" });
      },
      onExit: (error) => {
        handler.destroy();
        if (error) reject(new Error(error.display_message || error.error_message || "The bank connection didn't finish."));
        else resolve(null);
      },
    });
    handler.open();
  });
}
