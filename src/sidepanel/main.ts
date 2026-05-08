import './style.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface DevicePosture {
  deviceId: string
  hostname: string
  status: 'compliant' | 'non-compliant' | 'pending'
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  lastSeen: string
  osVersion: string
  agentVersion: string
  postureScore: number
  policies: Array<{ name: string; passed: boolean; detail: string }>
}

interface LogEntry {
  id: string
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
  source: string
}

interface DiagLog {
  level: string
  source: string
  message: string
  ts: string
}

interface DiagResults {
  tokenStatus: string
  tokenHost: string
  tokenAge: string
  storageKeys: string[]
  logCount: number
  checkedAt: string
}

interface StoredTokenEntry {
  token: string
  at: number
}

interface OverviewStats {
  sessions: { total: number; active: number; offline: number } | null
  licenses: { inUse: number; limit: number } | null
  regions:  { total: number } | null
  error:    string | null
  loadedAt: number
}

type PanelSection = 'overview' | 'posture' | 'logs' | 'debug'
type ReportState = 'idle' | 'sending' | 'sent' | 'error'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const { version } = chrome.runtime.getManifest()

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------
async function getActiveTokenEntry(): Promise<{ token: string; host: string; at: number } | null> {
  return new Promise(resolve => {
    chrome.storage.local.get(['znTokens', 'zn_auth_token'], (result) => {
      const tokens = result.znTokens as Record<string, StoredTokenEntry> | undefined
      if (tokens) {
        const hosts = Object.keys(tokens)
        if (hosts.length > 0) {
          resolve({ host: hosts[0], ...tokens[hosts[0]] })
          return
        }
      }
      const legacy = result.zn_auth_token as string | undefined
      resolve(legacy ? { token: legacy, host: 'unknown', at: 0 } : null)
    })
  })
}

// ---------------------------------------------------------------------------
// ZN API helpers
// ---------------------------------------------------------------------------

async function fetchZnApi(path: string): Promise<unknown> {
  const entry = await getActiveTokenEntry()
  if (!entry) throw new Error('no token')
  const res = await fetch(`https://${entry.host}${path}`, {
    headers: { Authorization: entry.token },
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function _parseItems(raw: unknown): unknown[] {
  if (!raw) return []
  const r = raw as Record<string, unknown>
  const items = r.items ?? r.sessions ?? r.data ?? r.events
  if (Array.isArray(items)) return items
  if (Array.isArray(raw)) return raw as unknown[]
  return []
}

function _isActiveSession(s: unknown): boolean {
  if (!s || typeof s !== 'object') return false
  const sess = s as Record<string, unknown>
  const cs = sess.connectionState ?? sess.sessionState ?? sess.state ?? sess.status
  if (typeof cs === 'number') return cs === 1 || cs === 2
  if (typeof cs === 'string') {
    const v = cs.toLowerCase()
    return v === 'active' || v === 'connected' || v === 'online'
  }
  return false
}

async function loadOverviewData(): Promise<OverviewStats> {
  const result: OverviewStats = {
    sessions: null, licenses: null, regions: null, error: null, loadedAt: Date.now(),
  }
  try {
    const [sesRaw, licRaw, regRaw] = await Promise.allSettled([
      fetchZnApi('/api/v1/connect/sessions?_limit=100'),
      fetchZnApi('/api/v1/settings/subscriptions/licenses/connect'),
      fetchZnApi('/api/v1/settings/connect/regions?_limit=100&_offset=0&with_count=true'),
    ])

    if (sesRaw.status === 'fulfilled') {
      const items = _parseItems(sesRaw.value)
      const active  = items.filter(_isActiveSession).length
      result.sessions = { total: items.length, active, offline: items.length - active }
    }

    if (licRaw.status === 'fulfilled') {
      const lic = licRaw.value as Record<string, unknown>
      const ls  = (lic.licenseState ?? lic) as Record<string, unknown>
      const inUse = Number(ls.inUse ?? ls.used ?? ls.consumed ?? 0)
      const limit = Number(ls.limit ?? ls.total ?? ls.max ?? 0)
      if (limit > 0 || inUse > 0) result.licenses = { inUse, limit }
    }

    if (regRaw.status === 'fulfilled') {
      const items = _parseItems(regRaw.value)
      result.regions = { total: items.length }
    }
  } catch (e) {
    result.error = (e as Error).message
  }
  return result
}

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------
function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------
function badge(text: string, variant: 'green' | 'red' | 'amber' | 'blue' | 'slate'): string {
  return `<span class="badge badge--${variant}">${text}</span>`
}

function riskBadge(level: DevicePosture['riskLevel']): string {
  const map = { low: 'green', medium: 'amber', high: 'red', critical: 'red' } as const
  return badge(level.charAt(0).toUpperCase() + level.slice(1), map[level])
}

function statusBadge(status: DevicePosture['status']): string {
  const map = { compliant: 'green', 'non-compliant': 'red', pending: 'amber' } as const
  return badge(status, map[status])
}

function scoreBar(score: number): string {
  const color = score >= 80 ? '#00df9a' : score >= 50 ? '#f59e0b' : '#ef4444'
  return `
    <div class="score-bar-wrap" title="Posture score: ${score}/100">
      <div class="score-bar-track">
        <div class="score-bar-fill" style="width:${score}%;background:${color}"></div>
      </div>
      <span class="score-num" style="color:${color}">${score}</span>
    </div>`
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------
function statVal(v: number | null, cls = ''): string {
  if (v === null) return `<span class="stat-val stat-val--dim">—</span>`
  return `<span class="stat-val ${cls}">${v}</span>`
}

function renderOverview(
  hasToken: boolean,
  tokenEntry: { host: string; at: number } | null,
  stats: OverviewStats | null,
  statsLoading: boolean,
): string {
  let tokenDetail = ''
  if (tokenEntry?.at) {
    const ageMins = Math.round((Date.now() - tokenEntry.at) / 60_000)
    tokenDetail = `<span class="status-detail">${esc(tokenEntry.host)} · ${ageMins < 1 ? 'just now' : ageMins + 'm ago'}</span>`
  }

  const tokenHtml = hasToken
    ? `<div class="status-row status-row--connected">
         <span class="status-dot status-dot--green"></span>
         <span class="status-label">Portal connected</span>
         ${tokenDetail}
       </div>`
    : `<div class="status-row status-row--disconnected">
         <span class="status-dot status-dot--red"></span>
         <span class="status-label">Not connected — visit portal</span>
       </div>`

  const ses = stats?.sessions ?? null
  const lic = stats?.licenses ?? null
  const reg = stats?.regions  ?? null

  const refreshHtml = hasToken
    ? `<button class="overview-refresh ${statsLoading ? 'overview-refresh--spin' : ''}" id="btn-refresh-overview" title="Refresh">↻</button>`
    : ''

  const licSection = lic ? `
    <div class="section-title">License Capacity</div>
    <div class="stat-card">
      <div class="stat-row">
        <span class="stat-label">In use</span>
        ${statVal(lic.inUse, 'stat-val--green')}
      </div>
      <div class="stat-row">
        <span class="stat-label">Limit</span>
        ${statVal(lic.limit)}
      </div>
      <div class="stat-row">
        <span class="stat-label">Available</span>
        ${statVal(lic.limit > 0 ? lic.limit - lic.inUse : null)}
      </div>
    </div>` : ''

  return `
    ${tokenHtml}

    <div class="overview-header-row">
      <span class="section-title" style="margin-top:2px">Sessions</span>
      ${refreshHtml}
    </div>
    <div class="stat-card">
      <div class="stat-row">
        <span class="stat-label">All sessions</span>
        ${statVal(ses?.total ?? null)}
      </div>
      <div class="stat-row">
        <span class="stat-label">
          <span class="dot dot--green"></span> Active
        </span>
        ${statVal(ses?.active ?? null, 'stat-val--green')}
      </div>
      <div class="stat-row">
        <span class="stat-label">
          <span class="dot dot--slate"></span> Auth &amp; offline
        </span>
        ${statVal(ses?.offline ?? null)}
      </div>
    </div>

    ${licSection}

    <div class="section-title">Regions</div>
    <div class="stat-card">
      <div class="stat-row">
        <span class="stat-label">Configured</span>
        ${statVal(reg?.total ?? null)}
      </div>
    </div>

    ${stats?.error ? `<div class="overview-error">Could not load data: ${esc(stats.error)}</div>` : ''}`
}

function renderPosture(devices: DevicePosture[]): string {
  if (devices.length === 0) {
    return `<div class="empty-state">No device data available.</div>`
  }
  return devices.map(d => `
    <div class="device-card">
      <div class="device-card-top">
        <div class="device-info">
          <span class="device-hostname">${d.hostname}</span>
          <span class="device-os">${d.osVersion}</span>
        </div>
        <div class="device-badges">
          ${statusBadge(d.status)}
          ${riskBadge(d.riskLevel)}
        </div>
      </div>
      ${scoreBar(d.postureScore)}
      <div class="policy-list">
        ${d.policies.map(p => `
          <div class="policy-row">
            <span class="policy-icon ${p.passed ? 'policy-icon--pass' : 'policy-icon--fail'}">
              ${p.passed ? '✓' : '✗'}
            </span>
            <span class="policy-name">${p.name}</span>
            <span class="policy-detail">${p.detail}</span>
          </div>`).join('')}
      </div>
    </div>`).join('')
}

function renderLogs(logs: LogEntry[]): string {
  if (logs.length === 0) {
    return `<div class="empty-state">No recent log entries.</div>`
  }
  const levelIcon  = { info: 'ℹ', warn: '⚠', error: '✖' }
  const levelClass = { info: 'log--info', warn: 'log--warn', error: 'log--error' }
  return logs.map(l => `
    <div class="log-entry ${levelClass[l.level]}">
      <div class="log-top">
        <span class="log-icon">${levelIcon[l.level]}</span>
        <span class="log-source">${l.source}</span>
        <span class="log-time">${l.timestamp}</span>
      </div>
      <div class="log-msg">${l.message}</div>
    </div>`).join('')
}

function renderDebug(
  diagLogs: DiagLog[],
  diagResults: DiagResults | null,
  reportState: ReportState,
): string {
  const errorLogs = diagLogs.filter(l => l.level === 'error')

  const logsHtml = errorLogs.length === 0
    ? `<div class="empty-state dbg-empty">No errors captured yet.</div>`
    : errorLogs.slice(0, 15).map(l => `
        <div class="diag-log-entry">
          <div class="diag-log-meta">
            <span class="diag-log-source">${esc(l.source)}</span>
            <span class="diag-log-time">${l.ts.slice(11, 19)}</span>
          </div>
          <div class="diag-log-msg">${esc(l.message.slice(0, 140))}${l.message.length > 140 ? '…' : ''}</div>
        </div>`).join('')

  const diagHtml = diagResults ? `
    <div class="diag-result-card">
      <div class="diag-result-row">
        <span class="diag-result-label">Token</span>
        <span class="diag-result-val ${diagResults.tokenStatus.startsWith('valid') ? 'diag-val--ok' : diagResults.tokenStatus === 'none' ? 'diag-val--warn' : 'diag-val--stale'}">${esc(diagResults.tokenStatus)}</span>
      </div>
      ${diagResults.tokenHost ? `
      <div class="diag-result-row">
        <span class="diag-result-label">Host</span>
        <span class="diag-result-val">${esc(diagResults.tokenHost)}</span>
      </div>` : ''}
      ${diagResults.tokenAge ? `
      <div class="diag-result-row">
        <span class="diag-result-label">Token age</span>
        <span class="diag-result-val">${esc(diagResults.tokenAge)}</span>
      </div>` : ''}
      <div class="diag-result-row">
        <span class="diag-result-label">Storage keys</span>
        <span class="diag-result-val">${diagResults.storageKeys.length}</span>
      </div>
      <div class="diag-result-row">
        <span class="diag-result-label">Logged errors</span>
        <span class="diag-result-val ${diagResults.logCount > 0 ? 'diag-val--warn' : 'diag-val--ok'}">${diagResults.logCount}</span>
      </div>
      <div class="diag-result-row">
        <span class="diag-result-label">Checked at</span>
        <span class="diag-result-val">${esc(diagResults.checkedAt)}</span>
      </div>
    </div>` : ''

  const reportLabel =
    reportState === 'sending' ? 'Sending…' :
    reportState === 'sent'    ? 'Report sent!' :
    reportState === 'error'   ? 'Send failed — retry' :
                                'Report an Issue'
  const reportMod =
    reportState === 'sent'  ? ' dbg-btn--sent' :
    reportState === 'error' ? ' dbg-btn--error' : ''

  return `
    <div class="diag-version-card">
      <div class="diag-version-row">
        <span class="diag-version-label">Extension version</span>
        <span class="diag-version-val">v${esc(version)}</span>
      </div>
    </div>

    <div class="section-title">Recent Errors</div>
    <div class="diag-log-list">${logsHtml}</div>

    <div class="dbg-actions">
      <button class="dbg-btn dbg-btn--diag" id="btn-run-diag">Run Diagnostics</button>
      <button class="dbg-btn dbg-btn--copy" id="btn-copy-debug">Copy Debug Info</button>
    </div>

    ${diagHtml}

    <div class="dbg-report-wrap">
      <button class="dbg-btn dbg-btn--report${reportMod}" id="btn-report-issue" ${reportState === 'sending' ? 'disabled' : ''}>
        ${reportLabel}
      </button>
      <p class="dbg-report-hint">Bundles version, errors &amp; diagnostics and sends them to the Zero Networks team.</p>
    </div>`
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
let activeSection: PanelSection = 'overview'
let devices: DevicePosture[]    = []
let logs: LogEntry[]            = []
let hasToken                    = false
let tokenEntry: { host: string; at: number } | null = null
let loading                     = true
let overviewStats: OverviewStats | null = null
let overviewLoading             = false
let diagLogs: DiagLog[]         = []
let diagResults: DiagResults | null = null
let reportState: ReportState    = 'idle'

// ---------------------------------------------------------------------------
// Overview data loading
// ---------------------------------------------------------------------------
async function refreshOverview() {
  if (overviewLoading) return
  overviewLoading = true
  renderApp()
  overviewStats   = await loadOverviewData()
  overviewLoading = false
  renderApp()
}

// ---------------------------------------------------------------------------
// Debug helpers
// ---------------------------------------------------------------------------
function loadDiagLogs() {
  chrome.storage.local.get('znDiagLogs', (r) => {
    diagLogs = ((r as Record<string, unknown>).znDiagLogs ?? []) as DiagLog[]
    renderApp()
  })
}

async function runDiagnostics() {
  const entry = await getActiveTokenEntry()
  const allKeys = await new Promise<string[]>(resolve => {
    chrome.storage.local.get(null, (items) => resolve(Object.keys(items)))
  })
  const logCount = diagLogs.filter(l => l.level === 'error').length

  let tokenStatus = 'none'
  let tokenHost   = ''
  let tokenAge    = ''

  if (entry) {
    const ageMins = entry.at ? Math.round((Date.now() - entry.at) / 60_000) : 0
    tokenStatus = ageMins > 60 ? `stale (${ageMins}m old)` : 'valid'
    tokenHost   = entry.host
    tokenAge    = ageMins > 0 ? `${ageMins} min ago` : 'just captured'
  }

  diagResults = {
    tokenStatus,
    tokenHost,
    tokenAge,
    storageKeys: allKeys,
    logCount,
    checkedAt: new Date().toLocaleTimeString(),
  }
  renderApp()
}

async function buildDebugBundle(): Promise<Record<string, unknown>> {
  const entry = await getActiveTokenEntry()
  const allStorage = await new Promise<Record<string, unknown>>(resolve => {
    chrome.storage.local.get(null, (items) => resolve(items as Record<string, unknown>))
  })

  // Redact sensitive values; keep structure for debugging.
  const safeStorage: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(allStorage)) {
    if (k === 'znTokens') {
      safeStorage[k] = Object.keys(v as object)
    } else if (k === 'znDiagLogs') {
      safeStorage[k] = v
    } else {
      safeStorage[k] = '[redacted]'
    }
  }

  return {
    extension_version: version,
    reported_at:       new Date().toISOString(),
    token_present:     Boolean(entry),
    token_host:        entry?.host ?? '',
    token_age_mins:    entry?.at ? Math.round((Date.now() - entry.at) / 60_000) : null,
    error_count:       diagLogs.filter(l => l.level === 'error').length,
    recent_errors:     diagLogs.filter(l => l.level === 'error').slice(0, 10),
    storage_keys:      Object.keys(allStorage),
    diag_results:      diagResults,
    storage_safe:      safeStorage,
  }
}

async function reportIssue() {
  if (reportState === 'sending') return
  reportState = 'sending'
  renderApp()

  try {
    const bundle = await buildDebugBundle()

    // Fire GA4 event (fire-and-forget).
    chrome.runtime.sendMessage({
      type:   'ZN_ANALYTICS',
      event:  'issue_reported',
      envId:  '',
      params: {
        error_count:       bundle.error_count as number,
        extension_version: version,
      },
    }, () => { void chrome.runtime.lastError })

    // Send full bundle via Formspree (routed through background SW).
    const result = await new Promise<{ ok: boolean }>((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'ZN_FORMSPREE_SUBMIT', payload: bundle },
        (r) => resolve((r as { ok: boolean }) ?? { ok: false }),
      )
    })

    reportState = result.ok ? 'sent' : 'error'
  } catch {
    reportState = 'error'
  }

  renderApp()
  if (reportState === 'sent') {
    setTimeout(() => { reportState = 'idle'; renderApp() }, 4_000)
  }
}

// ---------------------------------------------------------------------------
// Section switching
// ---------------------------------------------------------------------------
function switchSection(section: PanelSection) {
  activeSection = section
  if (section === 'debug') {
    loadDiagLogs()
    runDiagnostics() // auto-populate on every open so the tab is never blank
  }
  renderApp()
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function renderApp() {
  const app = document.getElementById('app')!

  let bodyHtml = ''
  if (loading) {
    bodyHtml = `<div class="loading-wrap"><span class="spinner"></span><span class="loading-text">Loading…</span></div>`
  } else {
    if      (activeSection === 'overview') bodyHtml = renderOverview(hasToken, tokenEntry, overviewStats, overviewLoading)
    else if (activeSection === 'posture')  bodyHtml = renderPosture(devices)
    else if (activeSection === 'logs')     bodyHtml = renderLogs(logs)
    else                                   bodyHtml = renderDebug(diagLogs, diagResults, reportState)
  }

  const errorCount = diagLogs.filter(l => l.level === 'error').length

  const navItem = (id: PanelSection, label: string, badgeCount = 0) => {
    const badgeHtml = badgeCount > 0
      ? ` <span class="nav-badge">${badgeCount > 9 ? '9+' : badgeCount}</span>`
      : ''
    return `<button class="nav-btn ${activeSection === id ? 'nav-btn--active' : ''}" data-section="${id}">${label}${badgeHtml}</button>`
  }

  app.innerHTML = `
    <div class="panel-root">
      <header class="panel-header">
        <div class="panel-logo">
          <span class="logo-text">ZERO</span><span class="logo-dot">.</span>
        </div>
        <span class="panel-subtitle">Connect</span>
      </header>

      <nav class="panel-nav">
        ${navItem('overview', 'Overview')}
        ${navItem('posture',  'Posture')}
        ${navItem('logs',     'Logs')}
        ${navItem('debug',    'Debug', errorCount)}
      </nav>

      <div class="panel-body">
        ${bodyHtml}
      </div>

      <footer class="panel-footer">
        <span class="footer-label">Zero Networks Dashboard</span>
        <div class="footer-right">
          <span class="footer-version">v${esc(version)}</span>
          <span class="footer-badge">BETA</span>
        </div>
      </footer>
    </div>`

  // Nav clicks
  app.querySelectorAll<HTMLButtonElement>('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchSection(btn.dataset.section as PanelSection))
  })

  // Overview refresh
  app.querySelector('#btn-refresh-overview')?.addEventListener('click', () => refreshOverview())

  // Debug tab buttons
  app.querySelector('#btn-run-diag')?.addEventListener('click', () => runDiagnostics())

  app.querySelector('#btn-copy-debug')?.addEventListener('click', async () => {
    const bundle = await buildDebugBundle()
    await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2))
    const btn = app.querySelector<HTMLButtonElement>('#btn-copy-debug')
    if (btn) {
      btn.textContent = 'Copied!'
      setTimeout(() => { btn.textContent = 'Copy Debug Info' }, 2_000)
    }
  })

  app.querySelector('#btn-report-issue')?.addEventListener('click', () => reportIssue())
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
async function init() {
  renderApp()

  // Load token + diag logs in parallel so the nav badge renders immediately.
  const [entry] = await Promise.all([
    getActiveTokenEntry(),
    new Promise<void>(resolve => {
      chrome.storage.local.get('znDiagLogs', (r) => {
        diagLogs = ((r as Record<string, unknown>).znDiagLogs ?? []) as DiagLog[]
        resolve()
      })
    }),
  ])

  tokenEntry = entry
  hasToken   = Boolean(entry)
  loading    = false
  renderApp()

  // Kick off overview data fetch (non-blocking — re-renders when done).
  if (hasToken) refreshOverview()
}

init()

// Re-render when storage changes (new token, new diag logs captured live).
chrome.storage.onChanged.addListener((changes) => {
  if (changes.znDiagLogs) {
    diagLogs = (changes.znDiagLogs.newValue ?? []) as DiagLog[]
  }
  const hadToken = hasToken
  getActiveTokenEntry().then(entry => {
    tokenEntry = entry
    hasToken   = Boolean(entry)
    renderApp()
    // If a token just arrived (user logged in), fetch overview data.
    if (!hadToken && hasToken) refreshOverview()
  })
})
