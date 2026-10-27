import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { baseURL: "http://127.0.0.1:4189", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4189 --strictPort",
    url: "http://127.0.0.1:4189",
    reuseExistingServer: false,
  },
});
