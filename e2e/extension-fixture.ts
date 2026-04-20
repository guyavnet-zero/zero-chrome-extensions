import { test as base, chromium, type BrowserContext } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

/** Repo root (contains manifest.json). */
const extensionPath = path.resolve(__dirname, "..");

/**
 * Chromium + this unpacked MV3 extension. Uses a dedicated persistent profile under
 * `e2e/.pw-chromium-profile` so cookies survive runs (log in once, or use storage state).
 */
export const test = base.extend<{ context: BrowserContext }>({
  context: async ({}, use) => {
    const userDataDir = path.join(__dirname, ".pw-chromium-profile");
    const storageState = process.env.ZN_PLAYWRIGHT_STORAGE_STATE;

    const launchOpts: Parameters<typeof chromium.launchPersistentContext>[1] = {
      channel: "chromium",
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    };

    if (storageState && fs.existsSync(storageState)) {
      launchOpts.storageState = storageState;
    }

    const context = await chromium.launchPersistentContext(userDataDir, launchOpts);
    await use(context);
    await context.close();
  },
});

export { expect } from "@playwright/test";
