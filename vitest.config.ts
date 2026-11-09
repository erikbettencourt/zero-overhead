import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./tests/setup.ts"],
    testTimeout: 20000,
    hookTimeout: 60000,
    // The API test files share one local database, so they take turns.
    fileParallelism: false,
  },
});
