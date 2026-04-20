import { defineConfig } from "@playwright/test";

/** Config lives in `e2e/`; specs and fixtures are in this directory. */
export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
});
