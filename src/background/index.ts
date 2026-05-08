/**
 * Zero Dashboard — Background Service Worker
 *
 * Responsibilities:
 *  1. Lifecycle logging — version on startup, install/update events.
 *  2. Auto-update — calls chrome.runtime.reload() when Chrome detects a new
 *     Web Store version (guarded in dev so CRXJS HMR is never disrupted).
 *  3. Token capture — intercepts outgoing ZN API requests via webRequest to
 *     persist valid Bearer tokens in chrome.storage.local (primary path),
 *     and accepts relayed tokens from the page-token-bridge content script
 *     (fallback path for when the SW was dormant at page load).
 *  4. GeoIP proxy — forwards fetch requests from the dashboard iframe through
 *     the service worker to avoid CORS restrictions on extension pages.
 *  5. Analytics proxy — routes GA4 Measurement Protocol events from dashboard
 *     pages (blocked by MV3 CSP) through the service worker.
 *  6. Diagnostic log collection — stores recent errors from the SW and the
 *     dashboard page in chrome.storage.local for display in the debug panel.
 *  7. Formspree proxy — routes issue-report submissions from the side panel
 *     through the service worker (extension pages need SW for cross-origin).
 */

// ── Diagnostic log helper ─────────────────────────────────────────────────
//
// Defined first so the error handlers below can call it immediately.
// Keeps the 50 most-recent entries; silently drops the oldest on overflow.

interface DiagLogEntry {
  level: string
  source: string
  message: string
  ts: string
}

function _storeDiagLog(entry: Omit<DiagLogEntry, 'ts'>) {
  chrome.storage.local.get('znDiagLogs', (r) => {
    const logs = ((r as Record<string, unknown>).znDiagLogs ?? []) as DiagLogEntry[]
    logs.unshift({ ...entry, ts: new Date().toISOString() })
    chrome.storage.local.set({ znDiagLogs: logs.slice(0, 50) })
  })
}

// ── 0a. CRXJS HMR fetch errors — suppress unhandled rejections ───────────────
//
// In development the CRXJS client worker (injected into this service worker by
// Vite) periodically calls fetch() against localhost:5173 to poll for HMR
// updates.  When the dev server is momentarily unreachable the promise rejects
// with "TypeError: Failed to fetch", which Chrome surfaces in the Extensions
// error panel even though it is harmless.  Catching it here keeps the panel
// clean without affecting real errors.

self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  const msg: string =
    (event.reason instanceof Error ? event.reason.message : String(event.reason ?? ''))
  if (msg.toLowerCase().includes('failed to fetch')) {
    event.preventDefault()
    return
  }
  // Store all other unhandled rejections for the debug panel.
  _storeDiagLog({ level: 'error', source: 'background', message: `UnhandledRejection: ${msg}` })
})

// Capture synchronous SW errors (rare but possible with third-party imports).
self.addEventListener('error', (event: ErrorEvent) => {
  _storeDiagLog({
    level: 'error',
    source: 'background',
    message: `${event.message} (${event.filename}:${event.lineno})`,
  })
})

// ── 0b. Port lifecycle — suppress bfcache disconnect errors ──────────────────
//
// When a portal page enters the back/forward cache Chrome closes any open
// extension ports, which triggers an unhandled disconnect error in the CRXJS
// HMR client worker.  Listening to onConnect and reading chrome.runtime.lastError
// inside onDisconnect acknowledges the error so Chrome stops surfacing it.

chrome.runtime.onConnect.addListener((port) => {
  port.onDisconnect.addListener(() => {
    // Intentionally consume lastError — port closed due to bfcache or page unload.
    void chrome.runtime.lastError
  })
})

// ── 1. Lifecycle ────────────────────────────────────────────────────────────

const { version, name: extName } = chrome.runtime.getManifest()
const _swStartedAt = Date.now() // recorded once when SW boots

console.log(`Zero Dashboard Service Worker Active - Version ${version}`)

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    console.log(`[Zero Dashboard] Extension installed (v${version})`)
  } else if (reason === chrome.runtime.OnInstalledReason.UPDATE) {
    console.log(`[Zero Dashboard] Extension updated to v${version}`)
  }
})

chrome.runtime.onUpdateAvailable.addListener(({ version: nextVersion }) => {
  console.log(
    `[Zero Dashboard] Update available: v${nextVersion} — reloading to apply…`,
  )
  // Skip forced reload in dev — CRXJS owns the reload lifecycle.
  if (!import.meta.env.DEV) {
    chrome.runtime.reload()
  }
})

// ── 1b. Side panel — disable open-on-action-click ───────────────────────────
//
// Chrome persists the openPanelOnActionClick setting across SW restarts.
// Explicitly set it to false so the toolbar icon always opens the popup,
// not the side panel.

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })
  .catch(() => { /* not fatal if sidePanel API unavailable */ })

// ── 2. Token capture via webRequest (primary path) ─────────────────────────
//
// Hold tokens seen in onBeforeSendHeaders until we confirm the response
// succeeded. Prevents poisoning storage with a JWT from a 401 response.

interface PendingToken { host: string; token: string }
const _pendingTokens = new Map<string, PendingToken>()

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details): chrome.webRequest.BlockingResponse | undefined => {
    const authHeader = details.requestHeaders?.find(
      h => h.name.toLowerCase() === 'authorization',
    )
    if (authHeader?.value) {
      const host = new URL(details.url).hostname
      _pendingTokens.set(details.requestId, { host, token: authHeader.value })
    }
    return undefined
  },
  { urls: ['*://*.zeronetworks.com/api/*'] },
  ['requestHeaders'],
)

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const pending = _pendingTokens.get(details.requestId)
    _pendingTokens.delete(details.requestId)
    if (!pending || details.statusCode < 200 || details.statusCode >= 300) return
    const { host, token } = pending
    chrome.storage.local.get('znTokens', (result) => {
      const tokens = (result?.znTokens ?? {}) as Record<string, { token: string; at: number }>
      tokens[host] = { token, at: Date.now() }
      chrome.storage.local.set({ znTokens: tokens })
    })
    console.log('[ZN Dashboard] Bearer token persisted from successful request.')
  },
  { urls: ['*://*.zeronetworks.com/api/*'] },
)

chrome.webRequest.onErrorOccurred.addListener(
  (details) => { _pendingTokens.delete(details.requestId) },
  { urls: ['*://*.zeronetworks.com/api/*'] },
)

// ── 3. Token relay from content script (fallback path) ──────────────────────
//
// Fires even when the SW was dormant during the page's initial API calls,
// making token capture reliable on fresh devices or after SW eviction.

chrome.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as Record<string, unknown>
  if (msg?.type === 'ZN_TOKEN_CAPTURED' && typeof msg.token === 'string') {
    const host = typeof msg.host === 'string'
      ? msg.host
      : 'zerocorp-admin-dev.zeronetworks.com'
    chrome.storage.local.get('znTokens', (result) => {
      const tokens = (result?.znTokens ?? {}) as Record<string, { token: string; at: number }>
      tokens[host] = { token: msg.token as string, at: Date.now() }
      chrome.storage.local.set({ znTokens: tokens })
    })
    console.log('[ZN Dashboard] Bearer token captured via page bridge.')
  }
})

// ── 4. GeoIP fetch proxy ────────────────────────────────────────────────────
//
// The SW has host_permissions and is not subject to CORS, so GeoIP requests
// from the dashboard iframe are routed through here instead of being made
// directly (which would be blocked by CORS on extension pages).

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    const msg = message as Record<string, unknown>
    if (msg?.type === 'ZN_GEO_FETCH' && typeof msg.url === 'string') {
      fetch(msg.url)
        .then(r => {
          const { ok, status } = r
          return r.json().then((data: unknown) => ({ ok, status, data }))
        })
        .catch((e: Error) => ({ ok: false, status: 0, data: null, error: e.message }))
        .then(sendResponse)
      return true // keep the message channel open for the async response
    }
  },
)

// ── 5. Diagnostic log ingestion ──────────────────────────────────────────────
//
// Accepts ZN_DIAG_LOG messages from the dashboard page (via its console.error
// intercept) and stores them via _storeDiagLog.

chrome.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as Record<string, unknown>
  if (msg?.type === 'ZN_DIAG_LOG') {
    _storeDiagLog({
      level:   String(msg.level   ?? 'error'),
      source:  String(msg.source  ?? 'dashboard'),
      message: String(msg.message ?? ''),
    })
  }
})

// ── 6. Analytics proxy (GA4 Measurement Protocol) ───────────────────────────
//
// Dashboard pages cannot POST to google-analytics.com directly due to MV3 CSP,
// so they route analytics events through this service worker instead.
// Replace GA4_MEASUREMENT_ID and GA4_API_SECRET with your property's values
// (Admin → Data Streams → Measurement Protocol API secrets).

const GA4_MEASUREMENT_ID = 'G-Z3XNB4SQPD'
const GA4_API_SECRET      = 'oBSkMQBRRm-AjB3sBgg3mA'
const GA4_ENDPOINT = `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`

/** Decode a JWT payload section without verifying signature. */
function _jwtPayloadClaim(token: string, claim: string): string {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(b64)) as Record<string, unknown>
    return String(payload[claim] ?? '')
  } catch {
    return ''
  }
}

/**
 * Normalize an email address so that plus-addressed viewer aliases used by
 * Zero Networks employees are resolved back to the real employee identity.
 *
 * e.g. "guy.avnet+znviewer@zeronetworks.com" → "guy.avnet@zeronetworks.com"
 *
 * Plain emails and non-ZN domains are returned unchanged.
 */
function _normalizeAdminEmail(email: string): string {
  if (!email) return email
  const plusIdx = email.indexOf('+')
  if (plusIdx === -1) return email
  const atIdx = email.indexOf('@', plusIdx)
  if (atIdx === -1) return email
  return email.slice(0, plusIdx) + email.slice(atIdx)
}

/** Extract a single JWT claim without any fallback chains. */
function _jwtClaim(token: string, claim: string): string {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(b64)) as Record<string, unknown>
    return String(payload[claim] ?? '')
  } catch {
    return ''
  }
}

/** Extract the pure Bearer value (strips "Bearer " prefix if present). */
function _bearerValue(raw: string): string {
  return raw.startsWith('Bearer ') ? raw.slice(7) : raw
}

/** Derive a short human-readable environment name from a portal hostname.
 *  e.g. "zerocorp-admin.zeronetworks.com" → "zerocorp-admin" */
function _envNameFromHostname(hostname: string): string {
  return hostname.replace(/\.zeronetworks\.com$/i, '').replace(/\.zeronetwor?ks\.com$/i, '') || hostname
}

/** Get or create a stable random client_id stored in chrome.storage.local.
 *  GA4 Measurement Protocol requires this to associate events with a device. */
async function _getOrCreateClientId(): Promise<string> {
  return new Promise(resolve => {
    chrome.storage.local.get('znAnalyticsClientId', result => {
      const existing = (result as Record<string, string>)['znAnalyticsClientId']
      if (existing) { resolve(existing); return }
      const newId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      chrome.storage.local.set({ znAnalyticsClientId: newId })
      resolve(newId)
    })
  })
}

/** Session ID for the current SW lifetime — resets on every SW startup.
 *  GA4 Measurement Protocol requires session_id + engagement_time_msec for
 *  events to appear in user/session metrics (Realtime, Engagement reports). */
const _ga4SessionId = String(Date.now())

interface AnalyticsMessage {
  type: 'ZN_ANALYTICS'
  event: string
  params?: Record<string, string | number | boolean>
  envId?: string
}

// ── User-activity log ────────────────────────────────────────────────────────
//
// Every GA4 event also gets written to a local rolling log so the dashboard
// can render a "who's using the extension" widget without needing GA4 API
// credentials.

interface UserActivityEntry {
  adminUser: string
  envId: string
  event: string
  ts: number
}

function _storeUserActivity(entry: UserActivityEntry) {
  chrome.storage.local.get('znUserActivity', (r) => {
    const log = ((r as Record<string, unknown>).znUserActivity ?? []) as UserActivityEntry[]
    log.unshift(entry)
    chrome.storage.local.set({ znUserActivity: log.slice(0, 1000) })
  })
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const msg = message as AnalyticsMessage
  if (msg?.type !== 'ZN_ANALYTICS' || typeof msg.event !== 'string') return

  const envId   = msg.envId ?? ''
  const envName = _envNameFromHostname(envId)

  ;(async () => {
    // Look up the Bearer token for this environment to extract the admin identity.
    const stored = await new Promise<Record<string, { token: string; at: number }>>(res => {
      chrome.storage.local.get('znTokens', r => {
        res(((r as Record<string, unknown>)['znTokens'] ?? {}) as Record<string, { token: string; at: number }>)
      })
    })
    const entry     = stored[envId] ?? Object.values(stored)[0]
    const rawToken  = entry?.token ?? ''
    const bearer    = _bearerValue(rawToken)
    const adminUser = bearer
      ? _normalizeAdminEmail(_jwtPayloadClaim(bearer, 'email') || _jwtPayloadClaim(bearer, 'name') || _jwtPayloadClaim(bearer, 'sub'))
      : ''

    // Extract the ZN platform version from the JWT "ver" claim (if present).
    const clientVersion = bearer ? _jwtClaim(bearer, 'ver') : ''

    const clientId = await _getOrCreateClientId()

    const eventParams: Record<string, string | number | boolean> = {
      env_id:               envId,
      env_name:             envName,
      admin_user:           adminUser,
      extension_version:    version,
      debug_mode:           true,
      session_id:           _ga4SessionId,
      engagement_time_msec: 100,
      ...(clientVersion ? { client_version: clientVersion } : {}),
      ...(msg.params ?? {}),
    }

    const body: Record<string, unknown> = {
      client_id: clientId,
      ...(adminUser ? { user_id: adminUser } : {}),
      events: [{ name: msg.event, params: eventParams }],
    }

    // Persist locally for the in-dashboard usage widget.
    _storeUserActivity({ adminUser: adminUser || '(not set)', envId, event: msg.event, ts: Date.now() })

    try {
      await fetch(GA4_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (e) {
      console.warn('[ZN Analytics] Failed to send event:', (e as Error).message)
    }
  })()
    .then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false }))

  return true // keep message channel open for async response
})

// ── 6b. User-activity query ───────────────────────────────────────────────────
//
// Returns aggregated usage data keyed by admin_user so the dashboard can
// render a "who's using the extension" widget without any external API calls.

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if ((message as Record<string, unknown>)?.type !== 'ZN_GET_USER_ACTIVITY') return

  chrome.storage.local.get('znUserActivity', (r) => {
    const log = ((r as Record<string, unknown>).znUserActivity ?? []) as UserActivityEntry[]

    const map = new Map<string, {
      adminUser: string
      envId: string
      eventCount: number
      lastSeen: number
      eventNames: Map<string, number>
    }>()

    for (const entry of log) {
      const key = entry.adminUser || '(not set)'
      if (!map.has(key)) {
        map.set(key, { adminUser: key, envId: entry.envId, eventCount: 0, lastSeen: 0, eventNames: new Map() })
      }
      const agg = map.get(key)!
      agg.eventCount++
      if (entry.ts > agg.lastSeen) agg.lastSeen = entry.ts
      if (entry.envId && !agg.envId) agg.envId = entry.envId
      agg.eventNames.set(entry.event, (agg.eventNames.get(entry.event) ?? 0) + 1)
    }

    const data = Array.from(map.values())
      .map(agg => ({
        adminUser: agg.adminUser,
        envId: agg.envId,
        eventCount: agg.eventCount,
        lastSeen: agg.lastSeen,
        topEvents: Array.from(agg.eventNames.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([name, count]) => ({ name, count })),
      }))
      .sort((a, b) => b.eventCount - a.eventCount)

    sendResponse({ ok: true, data, total: log.length })
  })

  return true // keep message channel open for async response
})

// ── 7. Debug bundle builder ──────────────────────────────────────────────────
//
// Collects a comprehensive snapshot of extension state, browser environment,
// ZN context, and captured errors. Used by both the popup "Report a Bug" path
// and the feedback form's bug-report path. Exposed via ZN_GET_DEBUG_BUNDLE so
// any extension page can request the bundle without duplicating this logic.

async function buildDebugBundle(): Promise<Record<string, unknown>> {
  const manifest = chrome.runtime.getManifest()

  // Read all storage in one pass.
  const storage = await new Promise<Record<string, unknown>>(resolve => {
    chrome.storage.local.get(null, items => resolve(items as Record<string, unknown>))
  })

  const tokens   = (storage.znTokens  ?? {}) as Record<string, { token: string; at: number }>
  const diagLogs = (storage.znDiagLogs ?? []) as DiagLogEntry[]

  // Token / ZN context — use the first stored host.
  const tokenHosts  = Object.keys(tokens)
  const firstHost   = tokenHosts[0] ?? ''
  const firstEntry  = firstHost ? tokens[firstHost] : null
  const tokenAgeMins = firstEntry?.at
    ? Math.round((Date.now() - firstEntry.at) / 60_000)
    : null

  const bearer       = firstEntry?.token ? _bearerValue(firstEntry.token) : ''
  const clientVer    = bearer ? _jwtClaim(bearer, 'ver') : ''
  const adminUser    = bearer
    ? _normalizeAdminEmail(_jwtPayloadClaim(bearer, 'email') || _jwtPayloadClaim(bearer, 'name') || _jwtPayloadClaim(bearer, 'sub'))
    : ''

  // Browser — navigator is available in service workers.
  const ua           = navigator.userAgent
  const chromeVer    = (ua.match(/Chrome\/(\d+)/) ?? [])[1] ?? 'unknown'

  return {
    // Extension
    extension_version: manifest.version,
    extension_name:    extName,

    // Browser
    user_agent:     ua,
    chrome_version: chromeVer,
    platform:       navigator.platform,
    language:       navigator.language,
    online:         navigator.onLine,

    // ZN context
    portal_host:        firstHost,
    token_present:      Boolean(firstEntry),
    token_age_minutes:  tokenAgeMins,
    token_captured_at:  firstEntry?.at ? new Date(firstEntry.at).toISOString() : null,
    token_hosts_count:  tokenHosts.length,
    admin_user:         adminUser,
    client_version:     clientVer || null,

    // Errors (last 20 captured errors, all log entries for context)
    error_count:    diagLogs.filter(l => l.level === 'error').length,
    recent_errors:  diagLogs.filter(l => l.level === 'error').slice(0, 20),
    all_logs:       diagLogs.slice(0, 20),

    // Storage — key names only (no sensitive values)
    storage_keys: Object.keys(storage),

    // Timing
    bundle_generated_at: new Date().toISOString(),
    sw_started_at:       new Date(_swStartedAt).toISOString(),
    sw_uptime_minutes:   Math.round((Date.now() - _swStartedAt) / 60_000),
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if ((message as Record<string, unknown>)?.type !== 'ZN_GET_DEBUG_BUNDLE') return
  buildDebugBundle().then(sendResponse)
  return true // keep message channel open for async response
})

// ── 9. Update checker ────────────────────────────────────────────────────────
//
// On SW startup (and every 4 hours via chrome.alarms), fetch the public Gist
// that the release pipeline keeps up to date. If the Gist version is newer
// than the installed extension version, write { znUpdateAvailable, znLatestVersion }
// to chrome.storage.local so the popup can show a "please reload" banner.

const GIST_VERSION_URL =
  'https://gist.githubusercontent.com/guyavnet-zero/b53427ba229f9cf1e9e97cad6834ef2a/raw/version.json'

async function _checkForUpdate(): Promise<void> {
  try {
    const res  = await fetch(`${GIST_VERSION_URL}?t=${Date.now()}`)
    if (!res.ok) return
    const data = await res.json() as { version?: string }
    const latest = data?.version ?? ''
    if (!latest) return

    if (latest !== version) {
      chrome.storage.local.set({ znUpdateAvailable: true, znLatestVersion: latest })
      console.log(`[ZN Update] New version available: v${latest} (installed: v${version})`)
    } else {
      chrome.storage.local.remove(['znUpdateAvailable', 'znLatestVersion'])
    }
  } catch {
    // Network unavailable — silently skip, will retry on next alarm.
  }
}

// Run once on SW startup (non-blocking).
_checkForUpdate()

// Re-check every 4 hours. chrome.alarms.create is idempotent when the alarm
// already exists (duplicate calls from SW restarts are harmless).
chrome.alarms.create('zn-update-check', { periodInMinutes: 240 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'zn-update-check') _checkForUpdate()
})

// ── 8. Formspree proxy ───────────────────────────────────────────────────────
//
// Extension pages (side panel) cannot POST to formspree.io directly without
// host_permissions, so issue-report submissions are routed through the SW.

const FORMSPREE_URL = 'https://formspree.io/f/xwvayppg'

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    const msg = message as Record<string, unknown>
    if (msg?.type !== 'ZN_FORMSPREE_SUBMIT') return

    fetch(FORMSPREE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(msg.payload ?? {}),
    })
      .then(r => r.json().then(data => ({ ok: r.ok, data })))
      .catch((e: Error) => ({ ok: false, data: { error: e.message } }))
      .then(sendResponse)

    return true // keep message channel open for async response
  },
)
