import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/**
 * Cloudflare Access is the front door: nobody reaches this Worker without
 * signing in. This module is the second lock. Every request must carry a
 * valid Access token, signed by your team, issued for this app, for an
 * allowed email. If anything is missing or misconfigured, we refuse.
 */

export interface AuthEnv {
  /** e.g. https://yourteam.cloudflareaccess.com */
  TEAM_DOMAIN?: string;
  /** The Access application's AUD tag. */
  POLICY_AUD?: string;
  /** Comma-separated list of emails allowed in. */
  ALLOWED_EMAILS?: string;
}

export type AuthResult =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403 | 500; reason: string };

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(teamDomain: string) {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
}

export function parseAllowedEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function normalizeTeamDomain(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export async function authenticate(
  request: Request,
  env: AuthEnv,
  verify: typeof jwtVerify = jwtVerify,
): Promise<AuthResult> {
  const teamDomain = normalizeTeamDomain(env.TEAM_DOMAIN);
  const audience = env.POLICY_AUD?.trim();
  const allowed = parseAllowedEmails(env.ALLOWED_EMAILS);

  // Fail closed: an unconfigured deployment serves nothing.
  if (!teamDomain || !audience || allowed.size === 0) {
    return { ok: false, status: 500, reason: "Access is not configured for this app." };
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    return { ok: false, status: 401, reason: "Missing Access token." };
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await verify(token, jwksFor(teamDomain), {
      issuer: teamDomain,
      audience,
      algorithms: ["RS256"],
    }));
  } catch {
    return { ok: false, status: 401, reason: "Invalid Access token." };
  }

  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!email || !allowed.has(email)) {
    return { ok: false, status: 403, reason: "This account is not allowed." };
  }

  return { ok: true, email };
}
