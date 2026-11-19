import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Real catalogue tests retain large indexes; bound CI memory rather than CPU-count fan-out.
    maxWorkers: 2,
  },
});
