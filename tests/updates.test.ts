import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { handleApi } from "../worker/api";
import { checkForUpdate } from "../worker/updates";
import { APP_VERSION, UPSTREAM_PACKAGE_URL, compareVersions } from "../shared/version";
import type { Bootstrap, VersionInfo } from "../shared/types";
import { wipeAll } from "./reset";

let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;

beforeAll(async () => {
  proxy = await getPlatformProxy<{ DB: D1Database }>({ persist: { path: ".wrangler/test-state/v3" } });
  db = proxy.env.DB;
  await wipeAll(db);
});
afterAll(async () => {
  await wipeAll(db);
  await proxy?.dispose();
});

async function call<T>(method: string, path: string) {
  const res = await handleApi(new Request("https://admin.example.com" + path, { method }), db, "owner@example.com");
  return (await res.json()) as T;
}

/** A stand-in for GitHub, so tests never reach the network. */
const upstream = (version: unknown, ok = true) =>
  (async (url: RequestInfo | URL) => {
    expect(String(url)).toBe(UPSTREAM_PACKAGE_URL);
    return new Response(JSON.stringify({ name: "zero-overhead", version }), { status: ok ? 200 : 500 });
  }) as typeof fetch;

describe("update check", () => {
  it("compares version numbers part by part", () => {
    expect(compareVersions("1.10.0", "1.9.2")).toBe(1);
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("v0.2", "0.2.1")).toBe(-1);
  });

  it("says nothing until the first check, then notices a newer version", async () => {
    const before = (await call<Bootstrap>("GET", "/api/bootstrap")).version;
    expect(before).toMatchObject({ current: APP_VERSION, latest: null, checkedAt: null, updateAvailable: false });

    expect(await checkForUpdate(db, upstream(APP_VERSION))).toMatchObject({ latest: APP_VERSION, updateAvailable: false });
    const newer = await checkForUpdate(db, upstream("99.0.0"));
    expect(newer).toMatchObject({ current: APP_VERSION, latest: "99.0.0", updateAvailable: true });
    expect(newer.checkedAt).not.toBeNull();
    expect((await call<VersionInfo>("GET", "/api/version")).updateAvailable).toBe(true);
  });

  it("keeps what it knew when GitHub can't be reached or answers oddly", async () => {
    expect((await checkForUpdate(db, upstream("ignored", false))).latest).toBe("99.0.0");
    expect((await checkForUpdate(db, upstream("not a version"))).latest).toBe("99.0.0");
    const offline = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect((await checkForUpdate(db, offline)).latest).toBe("99.0.0");
  });
});
