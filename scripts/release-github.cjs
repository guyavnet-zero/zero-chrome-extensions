// @ts-check
/**
 * release:github
 *
 * 1. Bumps the patch version in package.json
 * 2. Commits the version bump
 * 3. Creates a git tag (e.g. v1.0.65)
 * 4. Pushes commit + tag to origin → triggers GitHub Actions release workflow
 */
const { execSync } = require('child_process')
const fs   = require('fs')
const path = require('path')

const pkgPath = path.resolve(__dirname, '../package.json')

// ── Bump patch version ──────────────────────────────────────────────────────
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const parts = pkg.version.split('.').map(Number)
parts[2] += 1
const newVersion = parts.join('.')
pkg.version = newVersion
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`\nBumped version → v${newVersion}`)

// ── Git commit + tag + push ─────────────────────────────────────────────────
function run(cmd) {
  console.log(`  $ ${cmd}`)
  execSync(cmd, { stdio: 'inherit' })
}

try {
  run(`git add package.json`)
  run(`git commit -m "v${newVersion}"`)
  run(`git tag v${newVersion}`)
  run(`git push`)
  run(`git push --tags`)
  console.log(`\n✓ Pushed v${newVersion} — GitHub Actions will build and publish the release.\n`)
} catch (err) {
  console.error('\nGit operation failed:', err.message)
  console.error('Fix the issue above and push manually, or run: git push && git push --tags\n')
  process.exit(1)
}
