# Zero Connect Extension — How to Distribute

---

## Scenario D — GitHub Releases (recommended for external customers)

Repository: **https://github.com/guyavnet-zero/zero-chrome-extensions** (private)

### One-time setup

1. Make sure the repo remote is configured locally:
   ```bash
   git remote add origin https://github.com/guyavnet-zero/zero-chrome-extensions.git
   git push -u origin main
   ```
2. In GitHub repo **Settings → Secrets and variables → Actions**, add a secret named `GIST_TOKEN`:
   - Generate a Personal Access Token at https://github.com/settings/tokens (classic)
   - Scopes needed: `gist`
   - Paste the token as the secret value

### Your steps (each release)

```bash
npm run release:github
```

This single command:
1. Bumps the patch version in `package.json`
2. Commits and tags (`v1.0.X`)
3. Pushes to GitHub — GitHub Actions then:
   - Builds the extension
   - Creates a GitHub Release with the zip attached
   - Updates the version Gist so installed extensions are notified

Share the release URL with customers:
```
https://github.com/guyavnet-zero/zero-chrome-extensions/releases/latest
```

### What customers see

Within 4 hours of a release, users who open the extension popup will see an amber banner:

> **Version v1.0.X available** — open `chrome://extensions` and click ↺ next to Zero Connect.

### Customer steps (first install)

1. Download the zip from the latest GitHub Release.
2. Unzip it.
3. Open Chrome → `chrome://extensions` → enable **Developer mode**.
4. Click **Load unpacked** → select the unzipped folder.

### Customer steps (update)

1. Download the new zip from the latest GitHub Release.
2. Unzip to the **same location** (overwrite existing files).
3. Open `chrome://extensions` → click **↺** next to Zero Connect.

---

---

## Running the commands

All commands below are run in **macOS Terminal**, inside the project folder:

```bash
cd ~/Desktop/zero-dashboard
```

Then run whatever command is listed.

---

## Scenario A — Small group, no OneDrive (email / Slack / Teams)

### Your steps (each release)

```bash
npm run version:bump   # increments the version number
npm run build          # compiles the extension
```

This creates a ready-to-share zip file at:
```
release/crx-zero-dashboard-X.Y.Z.zip
```

Send that zip file to your users (email, Slack, Teams — any way you like).

### User steps (first install)

1. Download and **unzip** the file you sent them.
2. Open Chrome → go to `chrome://extensions`
3. Enable **Developer mode** (toggle, top-right corner).
4. Click **Load unpacked** → navigate to the unzipped folder → click **Select**.

### User steps (update)

Send them a new zip. They unzip it to the **same location** (overwrite), then in `chrome://extensions` click the **↺ reload** icon next to the extension.

---

## Scenario B — Entire company, via OneDrive

OneDrive folder path:
`Zero Networks → Documents → Product → UI Extensions → Connect → zero-networks-connect-ext`

### One-time setup (you do this once)

The `zero-networks-connect-ext` folder already exists on your OneDrive. Make sure it is shared / visible to your company so it syncs to everyone's computer.

### Your steps (each release)

```bash
cd ~/Desktop/zero-dashboard
npm run version:bump      # increments the version number
npm run release:onedrive  # compiles and copies directly into the OneDrive folder
```

That's it. The script builds the extension and copies it straight into
`OneDrive-ZeroNetworks/Zero Networks - Connect/zero-networks-connect-ext` on your Mac.
OneDrive picks up the change and syncs automatically.

3. Wait for OneDrive to finish syncing (cloud icon shows ✓).
4. Send a quick Teams/Slack message: *"New version released — open chrome://extensions and click ↺ next to Zero Connect."*

### User steps (first install)

1. Make sure OneDrive is syncing on your computer (the `zero-networks-connect-ext` folder should be visible locally).
2. Open Chrome → go to `chrome://extensions`
3. Enable **Developer mode** (toggle, top-right corner).
4. Click **Load unpacked** → navigate to:
   `OneDrive → Zero Networks → Documents → Product → UI Extensions → Connect → zero-networks-connect-ext`
   → click **Select**.

### User steps (update)

When notified of a new version:
1. Wait a minute for OneDrive to finish syncing (cloud icon shows ✓).
2. Open `chrome://extensions` → click the **↺ reload** icon next to Zero Connect.

---

## Scenario C — External customer (no OneDrive access)

### Your steps (each release)

```bash
npm run version:bump   # increments the version number
npm run build          # compiles the extension
```

This creates:
```
release/crx-zero-dashboard-X.Y.Z.zip
```

Send that zip to the customer however is convenient — email, WeTransfer, Dropbox link, etc.

### Customer steps (first install)

1. Download and **unzip** the file.
2. Open Chrome → go to `chrome://extensions`
3. Enable **Developer mode** (toggle, top-right corner).
4. Click **Load unpacked** → navigate to the unzipped folder → click **Select**.

### Customer steps (update)

Send them a new zip. They unzip it to the **same location** (overwrite), then in `chrome://extensions` click the **↺ reload** icon.

---

## Quick reference

| Scenario | Command to run | What to share |
|---|---|---|
| Small group / external | `npm run build` | `release/crx-zero-dashboard-X.Y.Z.zip` |
| Company OneDrive | `npm run release:onedrive` | Contents of `release/Zero-Connect-Extension/` → paste into OneDrive folder |

---

## Troubleshooting

**"This extension is not from the Chrome Web Store" banner**
Normal. Click **Keep** — it won't affect functionality.

**Extension disappeared after Chrome restart**
Developer-mode extensions occasionally get disabled by Chrome after a browser update. Users just repeat the Load Unpacked step, pointing to the same folder.

**OneDrive scenario: I don't see the reload icon**
Make sure OneDrive finished syncing first (green checkmark in the system tray, not a spinning icon).
