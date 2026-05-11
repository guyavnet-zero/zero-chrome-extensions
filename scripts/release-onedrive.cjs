// @ts-check
const fs = require('fs')
const path = require('path')
const os = require('os')

const { version } = require('../package.json')

const ONEDRIVE_FOLDER = path.join(
  os.homedir(),
  'Library/CloudStorage/OneDrive-ZeroNetworks/Zero Networks - Connect/zero-networks-connect-ext'
)
const LOCAL_RELEASE = path.resolve(__dirname, '../release/Zero-Connect-Extension')
const DIST = path.resolve(__dirname, '../dist')

// Write version.json into dist/ so it is included in every copy below
fs.writeFileSync(path.join(DIST, 'version.json'), JSON.stringify({ version }, null, 2))

// Always rebuild the local release copy
fs.rmSync(LOCAL_RELEASE, { recursive: true, force: true })
fs.cpSync(DIST, LOCAL_RELEASE, { recursive: true })

// If the OneDrive root itself is missing, bail out gracefully
if (!fs.existsSync(path.dirname(ONEDRIVE_FOLDER))) {
  console.log(`\n✓ Built v${version} → release/Zero-Connect-Extension/`)
  console.log('  OneDrive folder not found — copy that folder to OneDrive manually.\n')
  process.exit(0)
}

// Create the extension folder if this is the first deploy
if (!fs.existsSync(ONEDRIVE_FOLDER)) {
  fs.mkdirSync(ONEDRIVE_FOLDER, { recursive: true })
  console.log('  Created zero-networks-connect-ext/ on OneDrive (first deploy).')
}

// Read the old version from the currently deployed manifest.json
const oldManifestPath = path.join(ONEDRIVE_FOLDER, 'manifest.json')
let oldVersion = null
if (fs.existsSync(oldManifestPath)) {
  try {
    oldVersion = JSON.parse(fs.readFileSync(oldManifestPath, 'utf8')).version
  } catch (_) {}
}

// Archive the current OneDrive contents into 'old versions/vX.Y.Z/'
if (oldVersion) {
  const oldVersionsDir = path.join(ONEDRIVE_FOLDER, 'old versions')
  const archiveDir = path.join(oldVersionsDir, `v${oldVersion}`)

  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true })
    for (const entry of fs.readdirSync(ONEDRIVE_FOLDER)) {
      if (entry === 'old versions') continue
      fs.cpSync(path.join(ONEDRIVE_FOLDER, entry), path.join(archiveDir, entry), { recursive: true })
    }
    console.log(`  Archived previous v${oldVersion} → old versions/v${oldVersion}/`)
  }
}

// Deploy new version first (overwrite in place), then remove files that no
// longer exist in dist/. This avoids a brief window where the folder is empty
// and OneDrive could sync a deletion to users' computers mid-update.
fs.cpSync(DIST, ONEDRIVE_FOLDER, { recursive: true })

// Remove stale root-level entries that are not in the new dist (keep 'old versions')
const distEntries = new Set(fs.readdirSync(DIST))
for (const entry of fs.readdirSync(ONEDRIVE_FOLDER)) {
  if (entry === 'old versions') continue
  if (!distEntries.has(entry)) {
    fs.rmSync(path.join(ONEDRIVE_FOLDER, entry), { recursive: true, force: true })
  }
}

console.log(`\n✓ Built v${version} → OneDrive (zero-networks-connect-ext) — syncing now.`)

// Auto-update the public GitHub Gist so the extension update check picks up
// the new version. Requires GITHUB_TOKEN env var with gist write permission.
const GIST_ID = 'b53427ba229f9cf1e9e97cad6834ef2a'
const githubToken = process.env.GITHUB_TOKEN
if (githubToken) {
  const https = require('https')
  const body = JSON.stringify({ files: { 'version.json': { content: JSON.stringify({ version }, null, 2) } } })
  const req = https.request(
    { hostname: 'api.github.com', path: `/gists/${GIST_ID}`, method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'zero-dashboard-release', Authorization: `token ${githubToken}`, 'Content-Length': Buffer.byteLength(body) } },
    (res) => {
      if (res.statusCode === 200) console.log(`  Gist updated → version.json now reports v${version}`)
      else console.warn(`  Gist update failed (HTTP ${res.statusCode}) — update it manually at gist.github.com`)
      res.resume() // drain the response body so the socket closes and Node.js can exit
    }
  )
  req.setTimeout(8000, () => {
    console.warn('  Gist update timed out — update it manually at gist.github.com')
    req.destroy()
  })
  req.on('error', () => console.warn('  Gist update failed (network error) — update it manually at gist.github.com'))
  req.write(body)
  req.end()
} else {
  console.log(`  ⚠ GITHUB_TOKEN not set — update the gist manually:`)
  console.log(`    https://gist.github.com/${GIST_ID}`)
  console.log(`    Set "version" to "${version}" in version.json\n`)
}
