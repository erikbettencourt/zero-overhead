import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

export const PERSIST_DIR = ".wrangler/test-state";

// Fresh local database for every run, with all migrations applied.
export default function setup() {
  rmSync(PERSIST_DIR, { recursive: true, force: true });
  execSync(`npx wrangler d1 migrations apply DB --local --persist-to ${PERSIST_DIR}`, {
    stdio: "ignore",
    env: { ...process.env, CI: "1" },
  });
}
