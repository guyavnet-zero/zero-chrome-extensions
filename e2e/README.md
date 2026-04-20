# Browser E2E (Playwright)

These tests open **Chromium** with **this folder loaded as an unpacked extension**, then open your Zero portal and assert that **Device Posture** appears **above** **Dashboard (Beta)** in the Connect drill sidebar.

This is separate from your day‑to‑day Chrome profile: each run uses `e2e/.pw-chromium-profile`.

## One-time setup

1. From the repo root:

   ```bash
   npm install
   npx playwright install chromium
   ```

2. Pick a URL that already shows the Connect drill (sessions / policies / posture), for example:

   `https://<your-host>.zeronetworks.com/#/connect/sessions`

## Workflow (what you do day to day)

1. **Edit the extension** (`content.js`, etc.) in this repo — same tree Chrome loads if you use “Load unpacked” on this folder.

2. **Run the check** (opens Chromium, loads extension from disk, loads portal):

   ```bash
   export PORTAL_URL='https://YOUR-HOST.zeronetworks.com/#/connect/sessions'
   npm run test:e2e
   ```

3. **First run / after cookies cleared**: a Chromium window opens. **Log in** if prompted. The profile under `e2e/.pw-chromium-profile` keeps the session for the next run.

4. **If the test fails**: read the assertion message (it prints JSON with `reason`). Fix `content.js`, save, run **`npm run test:e2e` again** — no need to click “Reload extension” in your normal Chrome; this Chromium always reads the latest files from disk when it starts (new process each `npm run test:e2e`).

5. **Optional: skip logging in every time** on a clean machine — log in once in the Playwright browser, then export storage:

   ```bash
   npx playwright codegen "$PORTAL_URL" --save-storage=e2e/.auth/user.json
   ```

   Then:

   ```bash
   export ZN_PLAYWRIGHT_STORAGE_STATE=e2e/.auth/user.json
   npm run test:e2e
   ```

   Add `e2e/.auth/` to `.gitignore` if you store real sessions (do not commit secrets).

## npm scripts

| Command           | Meaning                                      |
|-------------------|----------------------------------------------|
| `npm run test:e2e` | Run the sidebar order spec (headed Chromium) |

## Why the browser window suddenly disappears

When the test **ends** (pass or fail), Playwright **closes** that Chromium window. That is normal. It is not your portal crashing.

If you want to **keep exploring** in that same window, run with the inspector (pauses so you can click around; resume or close when done):

```bash
PORTAL_URL='https://…' npx playwright test -c e2e/playwright.config.ts --debug
```

Or run your usual **Chrome** with the extension loaded for open-ended manual testing; use Playwright only when you want an automated **pass/fail** check.

## Limits

- This does **not** control your regular Chrome window or `chrome://extensions` — it only validates behavior in **Playwright’s Chromium**.
- After the test passes here, still do a quick check in **your** Chrome with “Reload” on the extension if you use that browser for manual QA.
