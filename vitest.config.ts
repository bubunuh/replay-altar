import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    // Simulation tests run WC3V on real replays; give them room.
    testTimeout: 120_000,
  },
});
