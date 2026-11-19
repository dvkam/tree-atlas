import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: "../tests/local-browser",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  outputDir: "../test-results/local-browser",
  reporter: [
    ["list"],
    ["json", { outputFile: fileURLToPath(new URL("./browser-results.json", import.meta.url)) }],
  ],
  use: {
    baseURL: process.env["TREE_ATLAS_LOCAL_URL"] ?? "http://127.0.0.1:4199",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "allow",
  },
  projects: [{ name: "local-chromium", use: { ...devices["Desktop Chrome"] } }],
});
