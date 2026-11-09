import type { VersionInfo } from "../shared/types";
import { APP_VERSION, CHANGELOG_URL, UPSTREAM_PACKAGE_URL, compareVersions } from "../shared/version";
import { type Route, json } from "./http";

/**
 * Is there a newer version? Once a night the Worker reads the version number from the public
 * repo's package.json and keeps it. Nothing about this install is sent: it's a plain download
 * of a public file.
 */

const KEY = "update.latest";

export async function checkForUpdate(db: D1Database, fetcher: typeof fetch = fetch): Promise<VersionInfo> {
  try {
    const res = await fetcher(UPSTREAM_PACKAGE_URL, { signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
    if (res.ok) {
      const latest = ((await res.json()) as { version?: unknown }).version;
      if (typeof latest === "string" && /^\d+\.\d+\.\d+/.test(latest)) {
        const value = JSON.stringify({ version: latest, checkedAt: new Date().toISOString() });
        await db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(KEY, value).run();
      }
    }
  } catch (e) {
    // Offline or GitHub unreachable: keep what we knew.
    console.warn("Update check failed", e instanceof Error ? e.message : e);
  }
  return versionInfo(db);
}

export async function versionInfo(db: D1Database): Promise<VersionInfo> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(KEY).first<{ value: string }>();
  const saved = row ? (JSON.parse(row.value) as { version: string; checkedAt: string }) : null;
  return {
    current: APP_VERSION,
    latest: saved?.version ?? null,
    checkedAt: saved?.checkedAt ?? null,
    updateAvailable: !!saved && compareVersions(saved.version, APP_VERSION) > 0,
    changelogUrl: CHANGELOG_URL,
  };
}

export const updateRoutes: Route[] = [
  ["GET", /^\/api\/version$/, async ({ db }) => json(await versionInfo(db))],
  ["POST", /^\/api\/version\/check$/, async ({ db }) => json(await checkForUpdate(db))],
];
