import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    // Simulation tests run WC3V on real replays (~500 MB each); give them room and run test
    // files one at a time; in parallel, one simulation could fail under contention.
    testTimeout: 120_000,
    fileParallelism: false,
  },
});
