var __znDebugLogs = [];

function znShowDebugDump() {
    function render(tokenInfo, allHostnames) {
        var lines = ['=== ZN Dashboard Debug Dump ===', new Date().toISOString(), '',
            '--- Token Info ---', JSON.stringify(tokenInfo, null, 2), '',
            '--- All Stored Hostnames ---', JSON.stringify(allHostnames, null, 2), '',
            '--- Console Logs (last 200) ---'];
        var logs = __znDebugLogs.slice(-200);
        logs.forEach(function(l) { lines.push('[' + l.level.toUpperCase() + '] ' + l.ts + '  ' + l.msg); });
        var text = lines.join('\n');

        var old = document.getElementById('zn-debug-dump-overlay');
        if (old) old.remove();
        var overlay = document.createElement('div');
        overlay.id = 'zn-debug-dump-overlay';
        Object.assign(overlay.style, { position:'fixed', top:'0', left:'0', right:'0', bottom:'0', zIndex:'9999999', background:'rgba(0,0,0,0.85)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'24px' });
        var card = document.createElement('div');
        Object.assign(card.style, { background:'#1e293b', borderRadius:'12px', padding:'20px', width:'100%', maxWidth:'780px', maxHeight:'82vh', display:'flex', flexDirection:'column', gap:'12px' });
        var header = document.createElement('div');
        Object.assign(header.style, { display:'flex', justifyContent:'space-between', alignItems:'center' });
        var title = document.createElement('h3');
        title.textContent = 'Debug Info Dump';
        Object.assign(title.style, { margin:'0', color:'#f1f5f9', fontSize:'16px' });
        var closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        Object.assign(closeBtn.style, { background:'transparent', border:'none', color:'#94a3b8', fontSize:'18px', cursor:'pointer', padding:'0 4px' });
        closeBtn.onclick = function() { overlay.remove(); };
        header.appendChild(title); header.appendChild(closeBtn);
        var textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.readOnly = true;
        Object.assign(textarea.style, { flex:'1', background:'#0f172a', color:'#94a3b8', border:'1px solid #334155', borderRadius:'8px', padding:'12px', fontFamily:'monospace', fontSize:'11px', resize:'none', minHeight:'300px' });
        var copyBtn = document.createElement('button');
        copyBtn.textContent = 'Copy to clipboard';
        Object.assign(copyBtn.style, { background:'#00df9a', color:'#0f172a', border:'none', borderRadius:'8px', padding:'10px 20px', fontWeight:'600', cursor:'pointer', fontSize:'13px', flexShrink:'0' });
        copyBtn.onclick = function() {
            navigator.clipboard.writeText(text).then(function() {
                copyBtn.textContent = 'Copied!';
                setTimeout(function() { copyBtn.textContent = 'Copy to clipboard'; }, 2000);
            }).catch(function() {
                textarea.select();
                document.execCommand('copy');
                copyBtn.textContent = 'Copied!';
                setTimeout(function() { copyBtn.textContent = 'Copy to clipboard'; }, 2000);
            });
        };
        card.appendChild(header); card.appendChild(textarea); card.appendChild(copyBtn);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get('znTokens', function(result) {
            var tokens = (result && result.znTokens) || {};
            var hostname = (typeof ZN_PORTAL_HOSTNAME !== 'undefined') ? ZN_PORTAL_HOSTNAME : '?';
            var entry = tokens[hostname] || null;
            var tokenInfo = entry ? {
                hostname: hostname,
                tokenPrefix: entry.token ? entry.token.substring(0, 30) + '…' : 'none',
                tokenLen: entry.token ? entry.token.length : 0,
                capturedAt: entry.at ? new Date(entry.at).toISOString() : 'unknown',
                ageMinutes: entry.at ? Math.round((Date.now() - entry.at) / 60000) : null
            } : { hostname: hostname, status: 'no token for this hostname' };
            render(tokenInfo, Object.keys(tokens));
        });
    } else {
        var hostname = (typeof ZN_PORTAL_HOSTNAME !== 'undefined') ? ZN_PORTAL_HOSTNAME : '?';
        render({ hostname: hostname, status: 'chrome.storage not available' }, []);
    }
}

// ── Extension iframe: hide our own sidebar ────────────────────────────────
if (window.self !== window.top) {
    var aside = document.querySelector('aside');
    if (aside) aside.style.display = 'none';
}

// ── Portal environment detection ──────────────────────────────────────────
// content.js passes the active portal's origin as ?portalHost=<url> when it
// creates the iframe, so the dashboard always calls the correct environment's
// API regardless of which ZN portal the user has open.
var ZN_PORTAL_HOSTNAME = (function() {
    try {
        var p = new URLSearchParams(location.search).get('portalHost');
        if (p) return new URL(p).hostname;
    } catch (e) {}
    return 'zerocorp-admin-dev.zeronetworks.com';
})();
var ZN_API_BASE = 'https://' + ZN_PORTAL_HOSTNAME;

// ── Global state ──────────────────────────────────────────────────────────
var auditChartInstance = null;
/** Set while Audit Activity chart is bar mode — used for bar click drill-down. */
var auditChartDrillContext = null;
/** Session Creation by Region: per chart x-label, type-96 stats for external tooltip. */
var znAuditActivityConnectDailyInsights = null;
/** Policy Operations: per chart x-label, types 100/101/102 stats for external tooltip. */
var znAuditActivityPolicyDailyInsights = null;
var leafletMap         = null;
var regionMarkers      = [];   // server circle markers
var mapUserMarkers     = [];   // GeoIP user markers
var mapServerMarkers   = [];   // named server markers (same as regionMarkers alias)
var mapPolylines       = [];   // user→server lines
var mapUserClusterGroup = null;
var mapMoveSaveTimer    = null;
var mapBounds           = null;    // L.latLngBounds(); reset on each renderMap call
var mapBoundsFitTimer   = null;    // debounce timer for debouncedFitBounds
var mapServerCoord      = {};      // regionName → [lat,lng]; shared with updateMapProgressively
var ZN_MAP_DEFAULT_LATLNG = [20, 0];
var ZN_MAP_DEFAULT_ZOOM   = 2;
/** IPs whose country is unknown are not plotted; znResolveUnknownGeoIps handles them. */
var mapMode            = 'both';   // 'both' | 'servers' | 'users'
var activePeriod       = '30d';    // hardcoded — time-filter UI removed
var dauChartRangeDays  = 7;        // Activity chart: last N days from 30d audit pool (7 | 14 | 30)
/** True once the background 8-30 day audit fetch has completed successfully. */
var isFullAuditLoaded  = false;
/** Promise returned by fetchRemainingAuditLogs() — awaited by 14/30-day pill clicks. */
var backgroundAuditPromise = null;
var activityChartMode  = 'connect'; // connect | sessions | region_health | policy
var geoCache           = {};       // ip → [lat,lng] | null  (kept for label-system compat)
/** ip → human-readable City, Country (or null) — shared by table/drawer/audit label consumers */
var geoLabelCache      = {};
/** Primary map coord cache for the progressive rendering pipeline. */
var geoIpCache         = new Map();  // ip → [lat,lng] | null
/** True while processSessionGeoIps is running; prevents duplicate queue instances. */
var isGeoIpQueueRunning = false;
/** Callbacks fired when processSessionGeoIps finishes (e.g. sessions-drawer re-render). */
var geoQueueDrainCallbacks = [];
/** In-flight GeoIP lookup promises keyed by IP — prevents duplicate network requests. */
var _geoLookupInFlight = Object.create(null);
/** Per-provider 429 backoff (ms): freeipapi, ipinfo, ipapi.co, geojs.io */
var znGeoProviderBackoffUntil = [0, 0, 0, 0];
var znGeoProvider429NoticeShown = [false, false, false, false];
/** Consecutive network-error count per provider — backs off after ZN_GEO_NET_FAIL_THRESHOLD. */
var znGeoProviderNetFails = [0, 0, 0, 0];
var ZN_GEO_NET_FAIL_THRESHOLD = 3;
/** IPs with a definitive GeoIP miss (null coords after lookup) — Recenter retries these only. */
var geoIpFailedIps = new Set();
/** IPs queued for znResolveUnknownGeoIps — prevents duplicate queuing on filter changes. */
var znGeoPendingIps = new Set();
/** IPs to process after the current GeoIP queue finishes (retry while busy). */
var pendingGeoOnlyIps = null;
/** Times to re-read Zero session data before falling back to public providers. */
var ZN_GEO_ZERO_RETRIES = 3;
/** Delay (ms) between Zero session-data retries. */
var ZN_GEO_ZERO_RETRY_MS = 2000;
/** ISO2 → [lat,lng] for country-level map pins (offline; loaded from country-centroids.json). */
var znCountryCentroids = null;
/** Per-IP map coordinate precision: 'country' (centroid / Zero DB) or 'city' (public APIs). */
var geoIpMapPrecision = new Map();
/** Timer for debounced viewport-based city GeoIP (public APIs). */
var znViewportCityGeoTimer = null;
/** True while the viewport city queue is draining (throttled public GeoIP). */
var isViewportCityGeoRunning = false;
/** Zoom / span thresholds: public city APIs run only when the map is zoomed in ~country scale. */
var ZN_MAP_CITY_MIN_ZOOM = 6;
var ZN_MAP_CITY_MAX_LAT_SPAN = 14;
var ZN_MAP_CITY_MAX_LNG_SPAN = 24;
/** Loading-badge state for the connectivity map geo-resolution progress. */
var mapGeoTotalIps   = 0;
var mapGeoLocatedIps = 0;
/** Cached sorted unique display names for global user autocomplete (see buildMasterUserList). */
var znMasterUserList   = [];

/** Cached sorted unique region names for global region autocomplete (see buildMasterRegionList). */
var znMasterRegionList = [];
var lastData           = {
    lic: null, ses: null, aud: null, audConnect: null, audHitLimit: false, connTime: {}, connTimeCalcByUser: {},
    activeSessions: [], offlineSessions: [],   // mutually exclusive split of lastData.ses (master list)
    auditFetchPending: false,
    regionHealthEvents: [],  // audit rows type 351 / 352 for debug modal
    regionStats: { total: 0, healthy: 0, degraded: 0, byNorm: Object.create(null), stateByNorm: Object.create(null) },
    regions: []              // items from /api/v1/settings/connect/regions
};
/** Populated when opening Audit Operations drill-down modal (Inspect uses this array by row index). */
var znAuditDrillRecentEvents = [];

// ── Known region → [lat, lng] lookup ─────────────────────────────────────
var REGION_COORDS = {
    'il':        [32.0804, 34.7807],
    'il backup': [32.0804, 34.7807],
    'colo':      [39.7, -104.9],
    'us-east':   [38.9,  -77.0],
    'us-west':   [37.8, -122.4],
    'eu':        [51.5,  10.0],
    'eu-west':   [53.3,  -6.3],
    'apac':      [ 1.3,  103.8],
    'australia': [-33.9, 151.2]
};

function regionCoords(name) {
    if (!name) return null;
    var key = name.toLowerCase().trim();
    if (REGION_COORDS[key]) return REGION_COORDS[key];
    for (var k in REGION_COORDS) {
        if (key.includes(k) || k.includes(key)) return REGION_COORDS[k];
    }
    return null;
}

// ── Period helpers ────────────────────────────────────────────────────────
function cutoffMs(period) {
    var now = Date.now();
    if (period === '24h') return now - 24 * 3600 * 1000;
    if (period === '7d')  return now - 7  * 86400 * 1000;
    if (period === '30d') return now - 30 * 86400 * 1000;
    return 0;
}

function filterByPeriod(items, period) {
    var cut = cutoffMs(period);
    var warnedOnce = false;

    return items.filter(function(item) {
        // Probe every field name the ZN API might use for the event timestamp
        var ts = item.isoTimestamp !== undefined ? item.isoTimestamp :
                 item.performedAt  !== undefined ? item.performedAt  :
                 item.createdAt    !== undefined ? item.createdAt    :
                 item.timestamp    !== undefined ? item.timestamp    :
                 item.time         !== undefined ? item.time         :
                 item.date         !== undefined ? item.date         :
                 item.eventDate    !== undefined ? item.eventDate    :
                 item.auditDate    !== undefined ? item.auditDate    :
                 item.eventTime    !== undefined ? item.eventTime    :
                 item.occurredAt   !== undefined ? item.occurredAt   :
                 item.actionTime   !== undefined ? item.actionTime   :
                 item._ts          !== undefined ? item._ts          :
                 undefined;

        if (ts === undefined || ts === null || ts === '') {
            if (!warnedOnce) {
                console.warn('[ZN] filterByPeriod: no timestamp field found in audit event.',
                             'Keys present:', Object.keys(item).join(', '));
                warnedOnce = true;
            }
            return true;   // include events with no recognisable timestamp
        }

        var ms;
        if (typeof ts === 'number') {
            // Unix seconds ≈ 1.7e9 (< 1e11); Unix ms ≈ 1.7e12 (> 1e11)
            ms = ts > 1e11 ? ts : ts * 1000;
        } else {
            ms = new Date(ts).getTime();
        }
        return ms >= cut;
    });
}

// ── Auth / session (portal + extension) ───────────────────────────────────
var ZN_ERR_UNAUTHORIZED = 'ZN_UNAUTHORIZED';

function coerceDashBearerToken(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (s.length < 24) return null;
    return s;
}

/** Optional portal hook: if present and explicitly false, block API calls. */
function isZeroNetworksPortalAuthOk() {
    var z = window.ZeroNetworksAuth;
    if (z && typeof z === 'object' && z.isAuthenticated === false) return false;
    return true;
}

function isPortalAuthReadyForApi(token) {
    if (!coerceDashBearerToken(token)) return false;
    if (!isZeroNetworksPortalAuthOk()) return false;
    return true;
}

function showAuthGate(mode) {
    var gate = document.getElementById('dashboard-auth-gate');
    var titleEl = document.getElementById('zn-auth-gate-title');
    var bodyEl = document.getElementById('zn-auth-gate-body');
    if (!gate) return;
    
    if (titleEl) {
        titleEl.textContent = mode === 'no-token' ? 'Sign in required' : 'Session expired';
    }
    
    if (bodyEl) {
        if (mode === 'no-token') {
            bodyEl.innerHTML = `
                <p style="margin-bottom: 16px;">
                    The dashboard needs an active Zero Networks portal session to load your data.
                </p>
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
                    <h4 style="margin: 0 0 8px 0; color: #475569; font-size: 14px; font-weight: 600;">
                        What happens next:
                    </h4>
                    <ol style="margin: 0; padding-left: 20px; color: #64748b; font-size: 14px; line-height: 1.5;">
                        <li>You'll be redirected to the Zero Networks portal</li>
                        <li>Sign in with your credentials</li>
                        <li>You'll be automatically returned to the dashboard</li>
                    </ol>
                </div>
            `;
        } else {
            bodyEl.innerHTML = `
                <p style="margin-bottom: 16px;">
                    Your portal session has expired. Please sign in again to continue using the dashboard.
                </p>
                <div style="background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                    <p style="margin: 0; color: #92400e; font-size: 14px;">
                        💡 <strong>Tip:</strong> Keep the portal tab open to avoid frequent re-authentication.
                    </p>
                </div>
            `;
        }
    }
    
    gate.classList.add('is-visible');
    gate.setAttribute('aria-hidden', 'false');
}

function hideAuthGate() {
    var gate = document.getElementById('dashboard-auth-gate');
    if (!gate) return;
    gate.classList.remove('is-visible');
    gate.setAttribute('aria-hidden', 'true');
}

function getZnReauthTargetUrl() {
    var custom = typeof window.ZN_DASHBOARD_LOGIN_URL === 'string' ? window.ZN_DASHBOARD_LOGIN_URL.trim() : '';
    if (custom) return custom;
    try {
        if (window.top && window.top !== window && window.top.location && window.top.location.origin) {
            return window.top.location.origin + '/';
        }
    } catch (e) { /* cross-origin */ }
    try {
        if (location && location.origin) return location.origin + '/';
    } catch (e2) { /* noop */ }
    return '/';
}

function openPortalReauth() {
    var portalUrl = 'https://portal-dev.zeronetworks.com/';
    
    // For extension context, redirect silently in same window
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
        // Store current URL for return
        var returnUrl = encodeURIComponent(window.location.href);
        window.location.href = portalUrl + '?returnTo=' + returnUrl;
        return;
    }
    
    // For embedded mode, redirect in same window/frame
    var url = getZnReauthTargetUrl();
    try {
        if (window.top && window.top !== window) {
            window.top.location.href = url;
            return;
        }
    } catch (e) { /* noop */ }
    window.location.href = url;
}


function markApiUnauthorized() {
    if (window.__znDash401Handled) return;
    window.__znDash401Handled = true;

    var statusEl = document.getElementById('debug-status');
    if (statusEl) {
        statusEl.textContent = 'Session expired — refreshing\u2026';
        statusEl.style.color = '#f59e0b';
    }

    attemptTokenRefresh().then(function(success) {
        if (success) return;
        clearStoredToken();
        showAuthGate('expired');
    });
}

/** Called when the server explicitly says the JWT is invalid (not just expired).
 *  Skip the refresh attempt — the whole portal session is gone. */
function markApiUnauthorizedNoRetry() {
    if (window.__znDash401Handled) return;
    window.__znDash401Handled = true;
    clearStoredToken();
    showAuthGate('expired');
}

function clearStoredToken() {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get('znTokens', function(result) {
                var tokens = (result && result.znTokens) || {};
                delete tokens[ZN_PORTAL_HOSTNAME];
                chrome.storage.local.set({ znTokens: tokens });
            });
        }
    } catch (e) { /* noop */ }
    try { localStorage.removeItem('znToken'); } catch (e2) { /* noop */ }
}

/**
 * Ask the portal tab to make a fresh authenticated API call.
 * background.js will intercept the request and store the new token automatically.
 * We then poll chrome.storage until a token different from the expired one appears.
 */
function attemptTokenRefresh() {
    return new Promise(function(resolve) {
        if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.storage) {
            resolve(false);
            return;
        }

        // Remember the capture timestamp we know is stale so we can detect when a new token arrives.
        // Comparing timestamps (not token values) means we detect a re-capture of the same JWT string.
        chrome.storage.local.get('znTokens', function(result) {
            var tokens = (result && result.znTokens) || {};
            var staleTimestamp = (tokens[ZN_PORTAL_HOSTNAME] && tokens[ZN_PORTAL_HOSTNAME].at) || 0;

            // Only send the trigger to tabs on the same portal hostname (so dev tabs
            // don't accidentally refresh a production token and vice versa).
            chrome.tabs.query({url: '*://' + ZN_PORTAL_HOSTNAME + '/*'}, function(tabs) {
                if (!tabs || !tabs.length) {
                    console.log('[ZN Dashboard] No portal tabs — cannot refresh token');
                    resolve(false);
                    return;
                }

                // Tell every portal tab to fire a fresh API call so background.js
                // can intercept it and store the new Bearer token.
                tabs.forEach(function(tab) {
                    chrome.tabs.sendMessage(tab.id, {action: 'triggerFreshApiCall'}, function() {
                        if (chrome.runtime.lastError) { /* tab may not have content script */ }
                    });
                });

                // Poll chrome.storage for a token whose capture timestamp is newer than the stale one.
                var polls = 0;
                var maxPolls = 20; // 10 seconds total
                var interval = setInterval(function() {
                    polls++;
                    chrome.storage.local.get('znTokens', function(r) {
                        var ts = (r && r.znTokens) || {};
                        var entry = ts[ZN_PORTAL_HOSTNAME];
                        var capturedAt = (entry && entry.at) || 0;
                        var latest = entry && entry.token;
                        var isNew = latest && latest.length > 24 && capturedAt > staleTimestamp;
                        if (isNew || polls >= maxPolls) {
                            clearInterval(interval);
                            if (isNew) {
                                var reloadCount = parseInt(sessionStorage.getItem('znDashReloads') || '0', 10);
                                if (reloadCount >= 2) {
                                    console.log('[ZN Dashboard] Reload limit reached — showing auth gate');
                                    resolve(false);
                                    return;
                                }
                                sessionStorage.setItem('znDashReloads', reloadCount + 1);
                                console.log('[ZN Dashboard] Fresh token received, reloading… (attempt ' + (reloadCount + 1) + ')');
                                window.__znDash401Handled = false;
                                resolve(true);
                                setTimeout(function() { window.location.reload(); }, 100);
                            } else {
                                console.log('[ZN Dashboard] Token refresh timed out');
                                resolve(false);
                            }
                        }
                    });
                }, 500);
            });
        });
    });
}

// ── API helper ────────────────────────────────────────────────────────────
async function fetchAPI(token, url) {
    var res = await fetch(url, { headers: { 'Authorization': token }, credentials: 'include' });

    if (res.status === 401) {
        // Read the body to distinguish a fully-invalid JWT from a mere expiry.
        // "jwt invalid" → the whole portal session is gone; skip the refresh
        // dance and go straight to the sign-in gate.
        var body = '';
        try { body = await res.text(); } catch (e) { /* ignore */ }

        if (body.indexOf('jwt invalid') !== -1) {
            markApiUnauthorizedNoRetry();
        } else {
            markApiUnauthorized();
        }
        throw new Error(ZN_ERR_UNAUTHORIZED);
    }
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
    return res.json();
}

// ── Audit widget loading UI (index.html overlays + policy / conn placeholders) ─
var AUDIT_CARD_LOADING_HTML =
    '<div class="audit-widget-loading-static">' +
        '<div class="loading-spinner" aria-hidden="true"></div>' +
        '<div class="loading-spinner-text">Loading 30-day data&hellip;</div>' +
        '<div class="audit-skeleton" style="width:88%;max-width:220px;margin-top:4px"></div>' +
        '<div class="audit-skeleton" style="width:72%;max-width:180px"></div>' +
    '</div>';

function setAuditWidgetsLoading(loading) {
    var kpiL = document.getElementById('audit-kpi-loading');
    var chL  = document.getElementById('audit-chart-loading');
    if (kpiL) kpiL.classList.toggle('is-active', !!loading);
    if (chL)  chL.classList.toggle('is-active', !!loading);
    if (loading) {
        var pol = document.getElementById('card-policy-rules');
        var ct  = document.getElementById('card-conn-time');
        if (pol) pol.innerHTML = AUDIT_CARD_LOADING_HTML;
        if (ct) {
            ct.classList.add('metric-scroll');
            ct.innerHTML = AUDIT_CARD_LOADING_HTML;
        }
        var at = document.getElementById('card-audit-types');
        if (at) {
            at.classList.add('metric-scroll');
            at.innerHTML = AUDIT_CARD_LOADING_HTML;
        }
        var ver = document.getElementById('card-versions');
        var reg = document.getElementById('card-regions');
        if (ver) ver.innerHTML = AUDIT_CARD_LOADING_HTML;
        if (reg) reg.innerHTML = AUDIT_CARD_LOADING_HTML;
    }
}

// ── Audit event deduplication fingerprint ────────────────────────────────
// Produces a stable string key for an event so we can discard exact
// duplicates that arise when _offset is silently ignored by the API
// (each page returns the same 200 most-recent events → inflated counts).
// Priority: unique id field  →  timestamp + action composite  →  null (keep).
function auditFingerprint(item) {
    var id = item.id      != null ? item.id      :
             item.auditId != null ? item.auditId :
             item.eventId != null ? item.eventId :
             item._id     != null ? item._id     : null;
    if (id !== null) return String(id);

    var ts  = item.isoTimestamp || item.performedAt || item.createdAt ||
              item.timestamp    || item.time        || null;
    var act = item.action || item.type || item.description || '';
    return ts ? (String(ts) + '|' + String(act)) : null;
}

// ── Extract the ms timestamp from a single audit event ────────────────────
// Returns a Number (ms) or null if no recognisable timestamp field exists.
function getAuditItemTs(item) {
    var ts = item.isoTimestamp !== undefined ? item.isoTimestamp :
             item.performedAt  !== undefined ? item.performedAt  :
             item.createdAt    !== undefined ? item.createdAt    :
             item.timestamp    !== undefined ? item.timestamp    :
             item.time         !== undefined ? item.time         :
             item.date         !== undefined ? item.date         :
             item.eventDate    !== undefined ? item.eventDate    :
             undefined;
    if (ts === undefined || ts === null || ts === '') return null;
    var ms = typeof ts === 'number' ? (ts > 1e11 ? ts : ts * 1000) : new Date(ts).getTime();
    return isNaN(ms) || ms <= 0 ? null : ms;
}

function getAuditItemDisplayTimeString(item) {
    var ms = getAuditItemTs(item);
    if (ms == null) return '\u2014';
    try {
        return new Date(ms).toLocaleString();
    } catch (e) {
        return String(ms);
    }
}

// ── Audit fetcher ─────────────────────────────────────────────────────────
// ZN /api/v1/audit: first page ?_limit=200&order=desc; then &_cursor=<timestamp
// of the last record in the previous batch>. Stops on empty page or when the
// last row is older than 30 days.
var AUDIT_LIMIT = 200;
var AUDIT_URL   = ZN_API_BASE + '/api/v1/audit';

const AUDIT_TYPE_NAMES = {
    96: "Connect session created",
    97: "Connect session expired",
    98: "Connect session revoked",
    99: "Connect session logout",
    100: "Connect policy created",
    101: "Connect policy edited",
    102: "Connect policy deleted",
    103: "Connect server deployed",
    104: "Connect asset created",
    107: "Connect server edited",
    123: "Connect session extended",
    190: "Connect server deleted",
    260: "Attempted to exceed connect license limit",
    261: "Connect licenses available",
    308: "Connect trial started",
    351: "Connect region down",
    352: "Connect region recovered",
    365: "Connect auto-update settings updated",
    374: "Connect posture check failed"
};

// Server-side /audit filter: only these Connect auditType IDs (must match AUDIT_TYPE_NAMES).
var AUDIT_CONNECT_FILTERS_QUERY = (function() {
    var ids = Object.keys(AUDIT_TYPE_NAMES).map(String).sort(function(a, b) {
        return parseInt(a, 10) - parseInt(b, 10);
    });
    return '_filters=' + encodeURIComponent(JSON.stringify([{ id: 'auditType', includeValues: ids }]));
})();

// Client-side fallback IDs (same set as server filter).
var AUDIT_CONNECT_TYPE_IDS = Object.keys(AUDIT_TYPE_NAMES).map(function(k) { return parseInt(k, 10); });

// Stable breakdown key + human label for Audit Events (KPI — Connect) modal table.
function auditEventBreakdownKey(item) {
    if (item.auditType !== undefined && item.auditType !== null && item.auditType !== '') {
        var n = typeof item.auditType === 'number' ? item.auditType : parseInt(String(item.auditType), 10);
        if (!isNaN(n)) return 'id:' + n;
    }
    var lbl = String(item.action || item.type || item.description || '').trim();
    return 'lbl:' + (lbl || 'Unknown');
}

function auditTypeNameOrFallback(typeId) {
    var n = typeof typeId === 'number' ? typeId : parseInt(String(typeId), 10);
    if (isNaN(n)) return null;
    var named = AUDIT_TYPE_NAMES[n];
    return named ? named : ('Connect Event (' + n + ')');
}

function auditEventBreakdownLabel(key) {
    if (key.indexOf('id:') === 0) {
        var id = parseInt(key.slice(3), 10);
        return auditTypeNameOrFallback(id) || 'Unknown';
    }
    if (key.indexOf('lbl:') === 0) return key.slice(4);
    return key;
}

function parseAuditItems(raw) {
    return raw ? (raw.items || raw.events || raw.data || (Array.isArray(raw) ? raw : [])) : [];
}

function auditTotal(raw) {
    return raw && typeof raw === 'object'
        ? (raw.total || raw.count || raw.totalCount || raw.totalItems || null)
        : null;
}

// Log non-item fields from a raw response — helps identify which pagination
// fields the ZN API returns so we can use them.  Call once per first page.
function logAuditResponseMeta(raw) {
    if (!raw || typeof raw !== 'object') return;
    var meta = {};
    Object.keys(raw).forEach(function(k) {
        if (k !== 'items' && k !== 'data' && k !== 'events') meta[k] = raw[k];
    });
    console.log('[ZN Audit] Response meta (pagination fields):', JSON.stringify(meta));
}

// Raw timestamp value from the last row for API `_cursor` (prefer `timestamp`, then other event-time fields).
function getAuditCursorRawFromItem(item) {
    if (!item || typeof item !== 'object') return null;
    var v = item.timestamp    !== undefined ? item.timestamp    :
            item.isoTimestamp !== undefined ? item.isoTimestamp :
            item.performedAt  !== undefined ? item.performedAt  :
            item.createdAt    !== undefined ? item.createdAt    :
            item.time         !== undefined ? item.time         :
            null;
    if (v === undefined || v === null || v === '') return null;
    return v;
}

async function fetchAuditPageOrdered(token, cursorRaw) {
    var url = AUDIT_URL + '?_limit=' + AUDIT_LIMIT + '&order=desc&' + AUDIT_CONNECT_FILTERS_QUERY;
    if (cursorRaw != null && cursorRaw !== '') {
        url += '&_cursor=' + encodeURIComponent(String(cursorRaw));
    }
    try {
        var response = await fetch(url, { headers: { 'Authorization': token } });
        if (response.status === 401) {
            markApiUnauthorized();
            return { __error401: true };
        }
        if (!response.ok) {
            console.error('[Audit Pagination Failed] URL:', response.url, 'Status:', response.status);
            return null;
        }
        return await response.json();
    } catch (e) {
        console.error('[Audit Pagination Failed] URL:', url, 'Error:', e && e.message ? e.message : e);
        return null;
    }
}

function auditTypeIsKnownConnect(val) {
    if (val === undefined || val === null || val === '') return false;
    var n = typeof val === 'number' ? val : parseInt(String(val), 10);
    return !isNaN(n) && AUDIT_CONNECT_TYPE_IDS.indexOf(n) >= 0;
}

// Wide net: any nested string field may carry "connect" (e.g. details.connectedSince). Integers alone do not match.
function auditPayloadStringMentionsConnectLoose(item) {
    if (!item || typeof item !== 'object') return false;
    try {
        return JSON.stringify(item).toLowerCase().indexOf('connect') >= 0;
    } catch (e) {
        return false;
    }
}

function filterAuditConnectEvents(items) {
    var arr = items || [];
    var out = arr.filter(auditPayloadStringMentionsConnectLoose);
    if (out.length === 0 && arr.length > 0) {
        out = arr.filter(function(audit) { return auditTypeIsKnownConnect(audit.auditType); });
        if (out.length > 0) {
            console.log('[ZN Audit] Connect filter: 0 stringify matches — using auditType IDs',
                AUDIT_CONNECT_TYPE_IDS.join(', '), '→', out.length, 'events');
        }
    }
    return out;
}

function dedupeAuditItems(items) {
    var fpSeen = Object.create(null);
    return items.filter(function(item) {
        var fp = auditFingerprint(item);
        if (fp === null) return true;
        if (fpSeen[fp]) return false;
        fpSeen[fp] = true;
        return true;
    });
}

function filterAuditsNotOlderThanCutoff(items, cutoffMs) {
    return items.filter(function(it) {
        var t = getAuditItemTs(it);
        return t === null || t >= cutoffMs;
    });
}

function globalOldestAuditMs(items) {
    var minT = null;
    (items || []).forEach(function(it) {
        var t = getAuditItemTs(it);
        if (t !== null && (minT === null || t < minT)) minT = t;
    });
    return minT;
}

// Paginate /audit with _cursor = timestamp of last row in the previous batch; stop on [] or past 30d.
// Returns { items, hitLimit } where hitLimit means we may still be missing sub-cutoff history.
async function fetchAllAuditsThirtyDays(token, statusEl) {
    var cutoffMs  = Date.now() - 30 * 24 * 60 * 60 * 1000;
    var allAudits = [];
    var hitLimit  = false;
    var maxPages  = 150;
    var pagesDone = 0;
    var nextCursor = null;

    function bumpStatus() {
        if (statusEl) {
            statusEl.textContent =
                'Loading audit history\u2026 (' + allAudits.length + ' events, last 30 days)';
        }
    }

    while (pagesDone < maxPages) {
        var raw = await fetchAuditPageOrdered(token, nextCursor);
        if (raw && raw.__error401) {
            throw new Error(ZN_ERR_UNAUTHORIZED);
        }
        if (raw === null) {
            if (pagesDone > 0) hitLimit = true;
            break;
        }

        var batch = parseAuditItems(raw);
        if (pagesDone === 0) {
            console.log('[ZN Audit] First page: server _filters (19 Connect auditType IDs), _limit=' + AUDIT_LIMIT +
                ', order=desc —', batch.length, 'events, total:', auditTotal(raw));
            logAuditResponseMeta(raw);
        }

        if (batch.length === 0) break;

        pagesDone++;
        allAudits = allAudits.concat(filterAuditsNotOlderThanCutoff(batch, cutoffMs));
        bumpStatus();

        var lastMs = getAuditItemTs(batch[batch.length - 1]);
        if (lastMs !== null && lastMs < cutoffMs) break;

        var cursorVal = getAuditCursorRawFromItem(batch[batch.length - 1]);
        if (cursorVal === null) {
            console.warn('[ZN Audit] No timestamp on last row for _cursor — stopping pagination.');
            break;
        }
        nextCursor = cursorVal;
    }

    if (pagesDone >= maxPages) {
        var gMin = globalOldestAuditMs(allAudits);
        if (gMin !== null && gMin >= cutoffMs) hitLimit = true;
    }

    return { items: dedupeAuditItems(allAudits), hitLimit: hitLimit };
}

// ── Phase-1 audit fetch: immediate 7-day window ───────────────────────────
// Returns { items, hitLimit, resumeCursor } where resumeCursor is the raw
// cursor value to hand off to fetchRemainingAuditLogs() for phase 2.
async function fetchAuditSevenDays(token, statusEl) {
    var cutoff   = Date.now() - 7 * 24 * 60 * 60 * 1000;
    var allAudits = [];
    var hitLimit  = false;
    var maxPages  = 50;
    var pagesDone = 0;
    var nextCursor   = null;
    var resumeCursor = null;

    while (pagesDone < maxPages) {
        var raw = await fetchAuditPageOrdered(token, nextCursor);
        if (raw && raw.__error401) throw new Error(ZN_ERR_UNAUTHORIZED);
        if (raw === null) {
            if (pagesDone > 0) hitLimit = true;
            break;
        }
        var batch = parseAuditItems(raw);
        if (pagesDone === 0) {
            console.log('[ZN Audit] Phase-1 (7d) first page: _limit=' + AUDIT_LIMIT + ', order=desc —',
                batch.length, 'events, total:', auditTotal(raw));
            logAuditResponseMeta(raw);
        }
        if (batch.length === 0) break;

        pagesDone++;
        allAudits = allAudits.concat(filterAuditsNotOlderThanCutoff(batch, cutoff));
        if (statusEl) {
            statusEl.textContent = 'Loading 7-day audit\u2026 (' + allAudits.length + ' events)';
        }

        var lastMs = getAuditItemTs(batch[batch.length - 1]);
        if (lastMs !== null && lastMs < cutoff) {
            // This batch crossed the 7d boundary — capture cursor so phase 2 continues from here
            resumeCursor = getAuditCursorRawFromItem(batch[batch.length - 1]);
            break;
        }

        var cursorVal = getAuditCursorRawFromItem(batch[batch.length - 1]);
        if (cursorVal === null) {
            console.warn('[ZN Audit] Phase-1: no cursor on last row — stopping.');
            break;
        }
        nextCursor   = cursorVal;
        resumeCursor = cursorVal;
    }

    if (pagesDone >= maxPages) hitLimit = true;
    return { items: dedupeAuditItems(allAudits), hitLimit: hitLimit, resumeCursor: resumeCursor };
}

// ── Phase-2 audit fetch: background days 8-30 ────────────────────────────
// Starts from resumeCursor (end of the 7-day fetch), paginates backwards to
// 30 days, then merges results into lastData.aud without overwriting 7d data.
async function fetchRemainingAuditLogs(token, statusEl, resumeCursor) {
    var cutoff30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
    var newItems  = [];
    var hitLimit  = false;
    var maxPages  = 100;
    var pagesDone = 0;
    var nextCursor = resumeCursor;

    while (pagesDone < maxPages) {
        var raw = await fetchAuditPageOrdered(token, nextCursor);
        if (raw && raw.__error401) {
            isFullAuditLoaded = true;
            throw new Error(ZN_ERR_UNAUTHORIZED);
        }
        if (raw === null) {
            if (pagesDone > 0) hitLimit = true;
            break;
        }
        var batch = parseAuditItems(raw);
        if (batch.length === 0) break;

        pagesDone++;
        newItems = newItems.concat(filterAuditsNotOlderThanCutoff(batch, cutoff30d));

        if (statusEl) {
            statusEl.textContent = 'Syncing 30-day audit\u2026 (' +
                ((lastData.aud || []).length + newItems.length) + ' events total)';
        }

        var lastMs = getAuditItemTs(batch[batch.length - 1]);
        if (lastMs !== null && lastMs < cutoff30d) break;

        var cursorVal = getAuditCursorRawFromItem(batch[batch.length - 1]);
        if (cursorVal === null) {
            console.warn('[ZN Audit] Phase-2: no cursor on last row — stopping.');
            break;
        }
        nextCursor = cursorVal;
    }

    if (pagesDone >= maxPages) {
        var gMin = globalOldestAuditMs(newItems);
        if (gMin !== null && gMin >= cutoff30d) hitLimit = true;
    }

    // Merge with the 7-day data already in lastData.aud; dedup handles any boundary overlap
    lastData.aud        = dedupeAuditItems((lastData.aud || []).concat(newItems));
    lastData.audConnect = filterAuditConnectEvents(lastData.aud);
    lastData.audHitLimit = !!(lastData.audHitLimit || hitLimit);
    isFullAuditLoaded   = true;

    reRenderAuditWidgets();
    try { buildMasterUserList(); } catch (e2) { console.warn('[ZN] buildMasterUserList:', e2); }

    // Ensure Leaflet recalculates tile coverage now the full grid is stable
    setTimeout(function() { if (leafletMap) leafletMap.invalidateSize(); }, 100);
}

// ── Country-level map geo (Zero session fields + offline centroids) ───────

function znEnsureCountryCentroidsLoaded(done) {
    done = typeof done === 'function' ? done : function() {};
    if (znCountryCentroids) {
        done();
        return;
    }
    var url = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
        ? chrome.runtime.getURL('country-centroids.json')
        : 'country-centroids.json';
    fetch(url)
        .then(function(r) { return r.ok ? r.json() : {}; })
        .then(function(j) { znCountryCentroids = j && typeof j === 'object' ? j : {}; })
        .catch(function() { znCountryCentroids = {}; })
        .then(done);
}

/**
 * Reads ISO 3166-1 alpha-2 from session / entityData when the portal provides it
 * (enriched by Zero / log-ingestor). Extend keys here if the API adds new fields.
 */
function sessionCountryIsoFromZero(s) {
    if (!s) return null;
    var ed = s.entityData || {};
    var cands = [
        s.countryIso2, s.countryISO2, s.clientCountryCode, s.countryCode, s.geoCountryCode,
        ed.countryIso2, ed.countryISO2, ed.clientCountryCode, ed.countryCode, ed.geoCountryCode
    ];
    for (var i = 0; i < cands.length; i++) {
        var v = cands[i];
        if (v == null || v === '') continue;
        var cc = String(v).trim().toUpperCase();
        if (/^[A-Z]{2}$/.test(cc)) return cc;
    }
    return null;
}

function znEnglishCountryLabelFromIso(iso) {
    if (!iso) return null;
    try {
        if (typeof Intl !== 'undefined' && Intl.DisplayNames) {
            var dn = new Intl.DisplayNames(['en'], { type: 'region' });
            var name = dn.of(iso);
            if (name && name !== iso) return name + ' (' + iso + ')';
        }
    } catch (e0) { /* ignore */ }
    return iso;
}

function znCentroidForCountryIso(iso) {
    if (!iso || !znCountryCentroids) return null;
    var c = znCountryCentroids[iso];
    if (!c || c.length < 2) return null;
    var lat = parseFloat(c[0]);
    var lng = parseFloat(c[1]);
    if (!znIsValidLatLng(lat, lng)) return null;
    return [lat, lng];
}

/** Pick a single ISO country for an IP from active sessions (first match wins). */
function znCountryIsoForIpFromSessions(ip, sessions) {
    if (!ip || !sessions || !sessions.length) return null;
    var want = String(ip).trim();
    if (!want) return null;
    for (var i = 0; i < sessions.length; i++) {
        if (sessionState(sessions[i]) !== 'active') continue;
        if (String(sessionPublicIp(sessions[i]) || '').trim() !== want) continue;
        var iso = sessionCountryIsoFromZero(sessions[i]);
        if (iso) return iso;
    }
    return null;
}

/**
 * Resolves geo for IPs whose country was not available from Zero session data.
 * Strategy:
 *   1. Re-read Zero session data up to ZN_GEO_ZERO_RETRIES times (the portal may
 *      enrich sessions asynchronously, so a later read can yield a country ISO).
 *   2. For any IPs still unresolved after those retries, hand off to the existing
 *      throttled public-provider queue (processSessionGeoIps), which tries all four
 *      public GeoIP services with back-off.
 * Successful resolutions call updateMapProgressively so dots pop onto the map
 * gradually without needing a full re-render.
 */
async function znResolveUnknownGeoIps(ips) {
    if (!ips || !ips.length) return;
    var remaining = ips.slice();

    for (var attempt = 0; attempt < ZN_GEO_ZERO_RETRIES && remaining.length; attempt++) {
        if (attempt > 0) {
            await new Promise(function(r) { setTimeout(r, ZN_GEO_ZERO_RETRY_MS); });
        }
        var sessions = lastData && lastData.ses;
        if (!sessions) break;
        var act = filterSessionsByDashboardFilters(sessions)
            .filter(function(s) { return sessionState(s) === 'active'; });
        var stillUnresolved = [];
        for (var i = 0; i < remaining.length; i++) {
            var ip = remaining[i];
            // Bail out if a newer seed call superseded us (znGeoPendingIps was cleared).
            if (!znGeoPendingIps.has(ip)) continue;
            var iso = znCountryIsoForIpFromSessions(ip, act);
            var centroid = iso ? znCentroidForCountryIso(iso) : null;
            if (centroid) {
                geoIpCache.set(ip, centroid);
                geoCache[ip] = centroid;
                geoIpMapPrecision.set(ip, 'country');
                geoIpFailedIps.delete(ip);
                znGeoPendingIps.delete(ip);
                if (iso) {
                    var lbl = znEnglishCountryLabelFromIso(iso);
                    if (lbl) geoLabelCache[ip] = lbl;
                }
                updateMapProgressively(ip);
            } else {
                stillUnresolved.push(ip);
            }
        }
        remaining = stillUnresolved;
    }

    // Hand off survivors to the public-provider queue (throttled, ~350 ms / IP).
    // Remove from pending first so filter-change merges can re-queue if needed.
    remaining.forEach(function(ip) { znGeoPendingIps.delete(ip); });
    if (remaining.length) {
        processSessionGeoIps(null, { onlyIps: remaining });
    }
}

/**
 * Seeds geoIpCache / geoLabelCache with country-level coords (no public HTTP).
 * Call after country-centroids.json is loaded, before renderMap.
 */
function znSeedCountryLevelMapGeo(sessions) {
    sessions = Array.isArray(sessions) ? sessions : [];
    var forMap = filterSessionsByDashboardFilters(sessions);
    var act = forMap.filter(function(s) { return sessionState(s) === 'active'; });
    var seenIp = Object.create(null);
    geoIpCache.clear();
    geoIpMapPrecision.clear();
    geoIpFailedIps.clear();
    znGeoPendingIps.clear();
    var unresolved = [];
    for (var i = 0; i < act.length; i++) {
        var ip = sessionPublicIp(act[i]);
        if (!ip) continue;
        var k = String(ip).trim();
        if (!k || seenIp[k]) continue;
        seenIp[k] = true;
        var iso = znCountryIsoForIpFromSessions(k, act);
        var centroid = iso ? znCentroidForCountryIso(iso) : null;
        if (centroid) {
            geoIpCache.set(k, centroid);
            geoIpMapPrecision.set(k, 'country');
            if (iso) {
                var lbl = znEnglishCountryLabelFromIso(iso);
                if (lbl) geoLabelCache[k] = lbl;
            }
        } else {
            // No country data from Zero yet — queue for async resolution.
            // Do NOT put a fake coordinate in cache; the IP stays hidden until resolved.
            unresolved.push(k);
            znGeoPendingIps.add(k);
        }
    }
    if (unresolved.length) znResolveUnknownGeoIps(unresolved);
}

/** Adds country-level coords for any active-session IPs not yet in geoIpCache (filter changes). */
function znMergeCountryGeoSeedForSessions(sessions) {
    if (!znCountryCentroids) return;
    sessions = Array.isArray(sessions) ? sessions : [];
    var act = sessions.filter(function(s) { return sessionState(s) === 'active'; });
    var seenIp = Object.create(null);
    var unresolved = [];
    for (var i = 0; i < act.length; i++) {
        var ip = sessionPublicIp(act[i]);
        if (!ip) continue;
        var k = String(ip).trim();
        if (!k || seenIp[k]) continue;
        seenIp[k] = true;
        if (geoIpCache.has(k) || znGeoPendingIps.has(k)) continue;
        var iso = znCountryIsoForIpFromSessions(k, act);
        var centroid = iso ? znCentroidForCountryIso(iso) : null;
        if (centroid) {
            geoIpCache.set(k, centroid);
            geoIpMapPrecision.set(k, 'country');
            if (iso) {
                var lbl = znEnglishCountryLabelFromIso(iso);
                if (lbl) geoLabelCache[k] = lbl;
            }
        } else {
            unresolved.push(k);
            znGeoPendingIps.add(k);
        }
    }
    if (unresolved.length) znResolveUnknownGeoIps(unresolved);
}

function znMapViewportWantsCityPrecision() {
    if (!leafletMap) return false;
    var z = leafletMap.getZoom();
    if (z < ZN_MAP_CITY_MIN_ZOOM) return false;
    var b = leafletMap.getBounds();
    if (!b || !b.isValid()) return false;
    var latSpan = Math.abs(b.getNorth() - b.getSouth());
    var lngSpan = Math.abs(b.getEast() - b.getWest());
    if (latSpan > ZN_MAP_CITY_MAX_LAT_SPAN) return false;
    if (lngSpan > ZN_MAP_CITY_MAX_LNG_SPAN) return false;
    return true;
}

/**
 * IPs that need city-level public GeoIP, intersected with the current map viewport.
 * Limited per batch to avoid bursts when many markers are visible.
 */
function znCollectViewportIpsForCityGeo(maxN) {
    maxN = maxN || 18;
    if (!leafletMap || !znMapViewportWantsCityPrecision() || !lastData || !lastData.ses) return [];
    var b = leafletMap.getBounds();
    var forMap = filterSessionsByDashboardFilters(lastData.ses);
    var act = forMap.filter(function(s) { return sessionState(s) === 'active'; });
    var out = [];
    var seen = Object.create(null);
    for (var i = 0; i < act.length; i++) {
        var ip = sessionPublicIp(act[i]);
        if (!ip) continue;
        var k = String(ip).trim();
        if (!k || seen[k]) continue;
        seen[k] = true;
        if (geoIpMapPrecision.get(k) === 'city') continue;
        var c = geoIpCache.get(k);
        if (!c || !znIsValidLatLng(c[0], c[1])) continue;
        try {
            if (!b.contains(L.latLng(c[0], c[1]))) continue;
        } catch (eB) { continue; }
        out.push(k);
        if (out.length >= maxN) break;
    }
    return out;
}

function znScheduleViewportCityGeo(delayMs) {
    if (!leafletMap) return;
    if (znViewportCityGeoTimer) clearTimeout(znViewportCityGeoTimer);
    znViewportCityGeoTimer = setTimeout(function() {
        znViewportCityGeoTimer = null;
        znRunViewportCityGeoPass();
    }, typeof delayMs === 'number' ? delayMs : 320);
}

function znRunViewportCityGeoPass() {
    if (!leafletMap || isGeoIpQueueRunning || isViewportCityGeoRunning) return;
    if (!znMapViewportWantsCityPrecision()) return;
    var batch = znCollectViewportIpsForCityGeo(18);
    if (!batch.length) return;
    processSessionGeoIps(null, { onlyIps: batch, _cityRefine: true });
}

// ── GeoIP resolver ────────────────────────────────────────────────────────
// Four free HTTPS providers (rotating primary per IP to spread load):
//   0: free.freeipapi.com — { latitude, longitude } (subdomain avoids CSP redirect issues)
//   1: ipinfo.io — { loc: "lat,lng" }
//   2: ipapi.co — { latitude, longitude }
//   3: get.geojs.io — { latitude, longitude }
// Israeli IPs: many Geo-IP DBs centroid on Jerusalem; product default is Tel Aviv.
var ZN_TEL_AVIV_GEO = [32.0804, 34.7807];
var ZN_GEO_NUM_PROVIDERS = 4;
var ZN_GEO_PROVIDER_LOG_NAMES = ['freeipapi', 'ipinfo.io', 'ipapi.co', 'geojs.io'];

function applyIsraelGeoIpOverrides(ip, coords) {
    var ipStr = String(ip || '');
    if (/^147\.235\./.test(ipStr)) return ZN_TEL_AVIV_GEO.slice();
    if (!coords || coords.length < 2) return coords;
    var lat = coords[0];
    var lng = coords[1];
    if (isNaN(lat) || isNaN(lng)) return coords;
    // Broad box around Jerusalem + common mis-tags for Israeli ISP blocks
    if (lat >= 31.62 && lat <= 31.92 && lng >= 34.98 && lng <= 35.42) return ZN_TEL_AVIV_GEO.slice();
    return coords;
}

/** Tiny deterministic offset so multiple sessions sharing one IP separate when unclustered. */
function znIsValidLatLng(lat, lng) {
    return typeof lat === 'number' && typeof lng === 'number' &&
        isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function jitterMarkerCoordsForIp(ip, lat, lng) {
    var s = String(ip || '');
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
        h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    }
    var u1 = ((h >>> 0) % 2001) / 2000;
    var u2 = ((Math.imul(h, 1103515245) >>> 0) % 2001) / 2000;
    var dLat = (u1 - 0.5) * 0.0028;
    var dLng = (u2 - 0.5) * 0.0028;
    return [lat + dLat, lng + dLng];
}

function znGeoShouldTryProvider(pi) {
    return Date.now() >= (znGeoProviderBackoffUntil[pi] || 0);
}

function znGeoNoteProvider429(pi) {
    znGeoProviderBackoffUntil[pi] = Date.now() + 15 * 60 * 1000;
    if (!znGeoProvider429NoticeShown[pi]) {
        znGeoProvider429NoticeShown[pi] = true;
        console.info('[GeoIP] ' + (ZN_GEO_PROVIDER_LOG_NAMES[pi] || 'provider') +
            ' rate limit (429); backing off ~15 minutes.');
    }
}

/** Deterministic provider order per IP — spreads first-hop load across services. */
function znGeoProviderOrder(ip) {
    var s = String(ip || '');
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
        h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    }
    var n = ZN_GEO_NUM_PROVIDERS;
    var start = (h >>> 0) % n;
    var order = [];
    for (var j = 0; j < n; j++) order.push((start + j) % n);
    return order;
}

/**
 * Proxy GeoIP fetches through the background service worker so they bypass
 * CORS restrictions that block direct fetches from the extension iframe.
 * Returns a response-like object with { ok, status, json() }.
 */
function znGeoFetch(url) {
    return new Promise(function (resolve) {
        try {
            chrome.runtime.sendMessage({ type: 'ZN_GEO_FETCH', url: url }, function (resp) {
                if (chrome.runtime.lastError || !resp) {
                    resolve({ ok: false, status: 0, json: function () { return Promise.resolve(null); } });
                    return;
                }
                resolve({
                    ok: resp.ok,
                    status: resp.status,
                    json: function () { return Promise.resolve(resp.data); }
                });
            });
        } catch (e) {
            resolve({ ok: false, status: 0, json: function () { return Promise.resolve(null); } });
        }
    });
}

async function znGeoTryProvider(pi, ip) {
    if (!znGeoShouldTryProvider(pi)) return null;
    try {
        if (pi === 0) {
            var r = await znGeoFetch('https://free.freeipapi.com/api/json/' + encodeURIComponent(ip));
            if (r.status === 429) { znGeoNoteProvider429(0); return { r429: true }; }
            if (!r.ok) return null;
            var d = await r.json();
            znGeoProviderNetFails[0] = 0; // successful response — reset failure counter
            var out = { coords: null, label: null, r429: false };
            out.label = formatLocationLabelFromFreeipapi(d);
            if (d.latitude != null && d.longitude != null) {
                var c = [parseFloat(d.latitude), parseFloat(d.longitude)];
                if (!isNaN(c[0]) && !isNaN(c[1])) out.coords = applyIsraelGeoIpOverrides(ip, c);
            }
            return out;
        }
        if (pi === 1) {
            var r2 = await znGeoFetch('https://ipinfo.io/' + encodeURIComponent(ip) + '/json');
            if (r2.status === 429) { znGeoNoteProvider429(1); return { r429: true }; }
            if (!r2.ok) return null;
            znGeoProviderNetFails[1] = 0;
            var d2 = await r2.json();
            var out2 = { coords: null, label: null, r429: false };
            if (d2.loc) {
                var parts = String(d2.loc).split(',');
                var c2 = [parseFloat(parts[0]), parseFloat(parts[1])];
                if (!isNaN(c2[0]) && !isNaN(c2[1])) out2.coords = applyIsraelGeoIpOverrides(ip, c2);
            }
            out2.label = formatLocationLabelFromIpinfo(d2);
            return out2;
        }
        if (pi === 2) {
            var r3 = await znGeoFetch('https://ipapi.co/' + encodeURIComponent(ip) + '/json/');
            if (r3.status === 429) { znGeoNoteProvider429(2); return { r429: true }; }
            if (!r3.ok) return null;
            znGeoProviderNetFails[2] = 0;
            var d3 = await r3.json();
            if (d3 && d3.error) return null;
            var out3 = { coords: null, label: null, r429: false };
            out3.label = formatLocationLabelFromIpapiCo(d3);
            if (d3.latitude != null && d3.longitude != null) {
                var c3 = [parseFloat(d3.latitude), parseFloat(d3.longitude)];
                if (!isNaN(c3[0]) && !isNaN(c3[1])) out3.coords = applyIsraelGeoIpOverrides(ip, c3);
            }
            return out3;
        }
        if (pi === 3) {
            var r4 = await znGeoFetch('https://get.geojs.io/v1/ip/geo/' + encodeURIComponent(ip) + '.json');
            if (r4.status === 429) { znGeoNoteProvider429(3); return { r429: true }; }
            if (!r4.ok) return null;
            znGeoProviderNetFails[3] = 0;
            var d4 = await r4.json();
            var out4 = { coords: null, label: null, r429: false };
            out4.label = formatLocationLabelFromGeojs(d4);
            if (d4.latitude != null && d4.longitude != null) {
                var c4 = [parseFloat(String(d4.latitude)), parseFloat(String(d4.longitude))];
                if (!isNaN(c4[0]) && !isNaN(c4[1])) out4.coords = applyIsraelGeoIpOverrides(ip, c4);
            }
            return out4;
        }
    } catch (e) {
        znGeoProviderNetFails[pi] = (znGeoProviderNetFails[pi] || 0) + 1;
        if (znGeoProviderNetFails[pi] >= ZN_GEO_NET_FAIL_THRESHOLD) {
            // Provider is consistently unreachable — back it off like a 429 so
            // subsequent IPs skip it immediately rather than waiting to time out.
            znGeoProviderBackoffUntil[pi] = Date.now() + 15 * 60 * 1000;
            console.info('[GeoIP] ' + (ZN_GEO_PROVIDER_LOG_NAMES[pi] || pi) +
                ' backed off after ' + znGeoProviderNetFails[pi] + ' consecutive network errors' +
                ' — will retry in ~15 min.');
        } else {
            console.warn('[GeoIP] ' + (ZN_GEO_PROVIDER_LOG_NAMES[pi] || pi) + ' failed for', ip,
                '\u2014', e && e.message ? e.message : e);
        }
        return null;
    }
    return null;
}

/**
 * Walk providers in hash order until coords+label filled (best-effort) or all tried.
 * @returns {{ coords: *, label: *, rateLimitedCoords: boolean, delayBump: boolean }}
 */
async function znGeoResolveFromApis(ip) {
    var coords = null;
    var label = null;
    var any429 = false;
    var order = znGeoProviderOrder(ip);
    var oi;
    for (oi = 0; oi < order.length; oi++) {
        if (coords != null && label != null) break;
        var part = await znGeoTryProvider(order[oi], ip);
        if (!part) continue;
        if (part.r429) any429 = true;
        if (part.coords != null && coords == null) coords = part.coords;
        if (part.label != null && label == null) label = part.label;
    }
    if (coords == null) {
        var ov = applyIsraelGeoIpOverrides(ip, null);
        if (ov != null) coords = ov;
    }
    var rateLimitedCoords = any429 && coords == null;
    return {
        coords: coords,
        label: label,
        rateLimitedCoords: rateLimitedCoords,
        delayBump: any429
    };
}

/**
 * On-demand GeoIP lookup for label consumers (sessions drawer, table Country column).
 * Runs the lookup directly — 429 backoff vars protect against bursts.
 * Map pins use country seeding first; city-level public GeoIP for the map is throttled
 * and only queued for viewport-visible IPs when zoomed in (see znScheduleViewportCityGeo).
 */
function znGeoEnsureLookupComplete(key) {
    if (!key) return Promise.resolve();
    var k = String(key).trim();
    if (!k) return Promise.resolve();
    var coordsDone = Object.prototype.hasOwnProperty.call(geoCache, k);
    var labelDone = Object.prototype.hasOwnProperty.call(geoLabelCache, k);
    if (coordsDone && labelDone) return Promise.resolve();
    // Deduplicate: reuse existing in-flight promise so only one network request fires per IP.
    if (k in _geoLookupInFlight) return _geoLookupInFlight[k];
    var p = znGeoPerformLookup(k).then(function() {
        delete _geoLookupInFlight[k];
    }, function() {
        delete _geoLookupInFlight[k];
    });
    _geoLookupInFlight[k] = p;
    return p;
}

async function znGeoPerformLookup(k) {
    var haveCoords = Object.prototype.hasOwnProperty.call(geoCache, k);
    var haveLabel = Object.prototype.hasOwnProperty.call(geoLabelCache, k);
    if (haveCoords && haveLabel) return;

    var coordsVal = haveCoords ? geoCache[k] : null;
    var labelVal = haveLabel ? geoLabelCache[k] : null;

    var fetched = { coords: null, label: null, rateLimitedCoords: false };
    if (coordsVal == null || labelVal == null) {
        fetched = await znGeoResolveFromApis(k);
        if (coordsVal == null && fetched.coords != null) coordsVal = fetched.coords;
        if (labelVal == null && fetched.label != null) labelVal = fetched.label;
    }

    var rateLimitedCoords = fetched.rateLimitedCoords && coordsVal == null;

    if (!haveCoords) {
        if (coordsVal != null || !rateLimitedCoords) {
            geoCache[k] = coordsVal;
            if (coordsVal != null) {
                geoIpCache.set(k, coordsVal);
                geoIpFailedIps.delete(k);
            } else {
                geoIpCache.set(k, null);
                geoIpFailedIps.add(k);
            }
        }
    } else if (coordsVal != null && geoCache[k] == null) {
        geoCache[k] = coordsVal;
        geoIpCache.set(k, coordsVal);
        geoIpFailedIps.delete(k);
    }

    if (!haveLabel) geoLabelCache[k] = labelVal;
    else if (labelVal != null && geoLabelCache[k] == null) geoLabelCache[k] = labelVal;
}

/**
 * Throttled public GeoIP queue for city-level refinement (map zoomed in + viewport filter).
 * ~350 ms between requests; backs off to 2 s on 429. Ignores audit data.
 * @param {object} [options]
 * @param {string[]} [options.onlyIps] — IPs to resolve (must pass _cityRefine for map city mode).
 * @param {boolean} [options._cityRefine] — when true with onlyIps, uses public providers + marker relocate.
 */
// ── Map geo-loading badge ─────────────────────────────────────────────────

function updateMapGeoBadge(visible) {
    var el = document.getElementById('map-geo-loading');
    if (!el) return;
    if (!visible) { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    var txt = document.getElementById('map-geo-loading-text');
    if (txt) {
        txt.textContent = mapGeoTotalIps > 0
            ? 'Processing sessions\u2026 ' + mapGeoLocatedIps + '\u202f/\u202f' + mapGeoTotalIps + ' located'
            : 'Processing sessions\u2026';
    }
}

async function processSessionGeoIps(sessions, options) {
    options = options || {};
    var isCityRefineBatch = !!(options._cityRefine && Array.isArray(options.onlyIps) && options.onlyIps.length);
    if (isGeoIpQueueRunning) {
        if (Array.isArray(options.onlyIps) && options.onlyIps.length) {
            pendingGeoOnlyIps = (pendingGeoOnlyIps || []).concat(options.onlyIps);
        }
        return;
    }
    isGeoIpQueueRunning = true;
    if (isCityRefineBatch) isViewportCityGeoRunning = true;

    var delay = 350;
    var seen = Object.create(null);
    var ips = [];
    if (Array.isArray(options.onlyIps)) {
        options.onlyIps.forEach(function(raw) {
            var ip = raw && String(raw).trim();
            if (!ip || seen[ip]) return;
            seen[ip] = true;
            ips.push(ip);
        });
    }

    // Show loading badge for city-refinement batches (public GeoIP).
    if (ips.length > 0 && isCityRefineBatch) {
        mapGeoTotalIps   = ips.length;
        mapGeoLocatedIps = 0;
        updateMapGeoBadge(true);
    }

    for (var i = 0; i < ips.length; i++) {
        var ip = ips[i];
        if (!Array.isArray(options.onlyIps) && geoIpCache.has(ip)) continue;

        await new Promise(function(r) { setTimeout(r, delay); });
        delay = 350;

        try {
            if (isCityRefineBatch && leafletMap) {
                var bNow = leafletMap.getBounds();
                var curC = geoIpCache.get(ip);
                if (!curC || !znIsValidLatLng(curC[0], curC[1]) ||
                    !bNow.contains(L.latLng(curC[0], curC[1]))) {
                    continue;
                }
            }

            var fetched = await znGeoResolveFromApis(ip);
            var coords = fetched.coords;
            var label = fetched.label;
            if (fetched.delayBump) delay = 2000;

            if (coords != null || !fetched.rateLimitedCoords) {
                geoIpCache.set(ip, coords);
                geoCache[ip] = coords;
                if (coords != null) geoIpFailedIps.delete(ip);
                else geoIpFailedIps.add(ip);
            }

            if (label != null && !Object.prototype.hasOwnProperty.call(geoLabelCache, ip))
                geoLabelCache[ip] = label;

            if (coords != null) {
                if (isCityRefineBatch) geoIpMapPrecision.set(ip, 'city');
                if (isCityRefineBatch) znRelocateUserMarkerForIp(ip, coords);
                else updateMapProgressively(ip);
                mapGeoLocatedIps++;
                if (isCityRefineBatch) updateMapGeoBadge(true);
            }

        } catch (e) {
            console.warn('[GeoIP Queue]', ip, e && e.message ? e.message : e);
        }
    }

    isGeoIpQueueRunning = false;

    if (isCityRefineBatch) {
        isViewportCityGeoRunning = false;
        updateMapGeoBadge(false);
        geoQueueDrainCallbacks.splice(0).forEach(function(cb) { cb(); });
        if (znMapViewportWantsCityPrecision() && znCollectViewportIpsForCityGeo(1).length) {
            znScheduleViewportCityGeo(120);
        }
        var pendingC = pendingGeoOnlyIps;
        pendingGeoOnlyIps = null;
        if (pendingC && pendingC.length) {
            var uniqSeenC = Object.create(null);
            var uniqC = [];
            pendingC.forEach(function(p) {
                var k = p && String(p).trim();
                if (!k || uniqSeenC[k]) return;
                uniqSeenC[k] = true;
                uniqC.push(k);
            });
            if (uniqC.length) processSessionGeoIps(null, { onlyIps: uniqC, _cityRefine: true });
        }
        return;
    }

    updateMapGeoBadge(false);
    geoQueueDrainCallbacks.splice(0).forEach(function(cb) { cb(); });

    if (ips.length && lastData && lastData.ses) {
        try {
            renderMap(filterSessionsByDashboardFilters(lastData.ses));
        } catch (eRender) {
            console.warn('[ZN Map] Post-GeoIP re-render failed:', eRender);
            debouncedFitBounds();
        }
    } else if (ips.length) {
        debouncedFitBounds();
    }

    var pending = pendingGeoOnlyIps;
    pendingGeoOnlyIps = null;
    if (pending && pending.length) {
        var uniqSeen = Object.create(null);
        var uniq = [];
        pending.forEach(function(p) {
            var k = p && String(p).trim();
            if (!k || uniqSeen[k]) return;
            uniqSeen[k] = true;
            uniq.push(k);
        });
        if (uniq.length) processSessionGeoIps(null, { onlyIps: uniq, _cityRefine: true });
    }
}

/**
 * Purge GeoIP caches for failed IPs visible under current dashboard filters and re-queue lookups only for those.
 */
function znGeoRetryFailedForFilteredSessions() {
    if (!lastData || !lastData.ses) return;
    var sessions = filterSessionsByDashboardFilters(lastData.ses);
    var retry = [];
    var seen = Object.create(null);
    sessions.forEach(function(s) {
        if (sessionState(s) !== 'active') return;
        var ip = sessionPublicIp(s);
        if (!ip || seen[ip]) return;
        seen[ip] = true;
        if (!geoIpFailedIps.has(ip)) return;
        delete geoCache[ip];
        geoIpCache.delete(ip);
        delete geoLabelCache[ip];
        geoIpFailedIps.delete(ip);
        retry.push(ip);
    });
    if (retry.length === 0) return;
    znSeedCountryLevelMapGeo(lastData.ses);
    try {
        renderMap(filterSessionsByDashboardFilters(lastData.ses));
    } catch (eRm) {
        console.warn('[ZN Map] renderMap after geo retry failed:', eRm);
    }
    processSessionGeoIps(null, { onlyIps: retry, _cityRefine: true });
}

/**
 * Moves an existing user marker when city-level GeoIP refines coords (no full renderMap).
 */
function znRelocateUserMarkerForIp(ip, coords) {
    if (!leafletMap || !lastData || !lastData.ses) return;
    if (mapMode === 'servers') return;
    if (!coords || !znIsValidLatLng(coords[0], coords[1])) return;
    var plotCoords = jitterMarkerCoordsForIp(ip, coords[0], coords[1]);
    if (!znIsValidLatLng(plotCoords[0], plotCoords[1])) return;
    for (var mi = 0; mi < mapUserMarkers.length; mi++) {
        var m = mapUserMarkers[mi];
        if (m && m._znIp === ip) {
            m.setLatLng(plotCoords);
            if (mapUserClusterGroup && typeof mapUserClusterGroup.refreshClusters === 'function') {
                try { mapUserClusterGroup.refreshClusters(); } catch (eR) { /* ignore */ }
            }
            if (mapBounds) mapBounds.extend(plotCoords);
            debouncedFitBounds();
            return;
        }
    }
}

/**
 * Appends a single IP's user markers to the live map without clearing any layers.
 * Called by processSessionGeoIps() after each successful GeoIP resolution so dots
 * pop onto the map progressively as the throttled queue works through the IP list.
 */
function updateMapProgressively(ip) {
    if (!leafletMap || !lastData || !lastData.ses) return;
    if (mapMode === 'servers') return; // user dots are hidden in servers-only mode

    var coords = geoIpCache.get(ip);
    if (!coords || !znIsValidLatLng(coords[0], coords[1])) return;

    // Skip if renderMap already added a marker for this IP in the current pass.
    if (mapUserMarkers.some(function(m) { return m._znIp === ip; })) return;

    // Only draw markers for sessions that pass the current dashboard filters and are active.
    var activeSessions = filterSessionsByDashboardFilters(lastData.ses).filter(function(s) {
        return sessionState(s) === 'active' && sessionPublicIp(s) === ip;
    });
    if (activeSessions.length === 0) return;

    var plotCoords = jitterMarkerCoordsForIp(ip, coords[0], coords[1]);
    if (!znIsValidLatLng(plotCoords[0], plotCoords[1])) return;

    // Keep mapBounds current as dots pop in so debouncedFitBounds is accurate.
    if (mapBounds) mapBounds.extend(plotCoords);

    var userDotIcon = L.divIcon({
        className: 'zn-map-user-dot',
        html: '<div style="width:14px;height:14px;border-radius:50%;background:#00df9a;' +
            'border:2px solid #059669;box-sizing:border-box"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7]
    });

    var userMarker = L.marker(plotCoords, { icon: userDotIcon });
    userMarker._znSessions = activeSessions;
    userMarker._znIp = ip;
    (function(ss) {
        userMarker.on('click', function() { openConnectivityModalGeo(ss, { cluster: false }); });
    }(activeSessions));

    if (mapUserClusterGroup) {
        mapUserClusterGroup.addLayer(userMarker);
    } else {
        userMarker.addTo(leafletMap);
    }
    mapUserMarkers.push(userMarker);

    if (mapMode === 'both') {
        var rn = regionName(activeSessions[0]);
        var sc = rn ? mapServerCoord[rn] : null;
        if (sc) {
            var line = L.polyline([plotCoords, sc], {
                color: '#94a3b8', weight: 1.5, opacity: 0.55, dashArray: '5 6'
            }).addTo(leafletMap);
            mapPolylines.push(line);

            var mid = [(plotCoords[0] + sc[0]) / 2, (plotCoords[1] + sc[1]) / 2];
            var angle = Math.atan2(
                -(sc[0] - plotCoords[0]),
                sc[1] - plotCoords[1]
            ) * (180 / Math.PI);
            var arrowIcon = L.divIcon({
                className: 'zn-map-arrow',
                html: '<div style="transform:rotate(' + angle + 'deg);' +
                    'width:18px;height:18px;display:flex;' +
                    'align-items:center;justify-content:center;">' +
                    '<svg viewBox="0 0 12 12" width="12" height="12" fill="#00df9a">' +
                    '<polygon points="0,2 8,6 0,10 3,6"/>' +
                    '</svg></div>',
                iconSize: [18, 18],
                iconAnchor: [9, 9]
            });
            var arrowMark = L.marker(mid, { icon: arrowIcon, interactive: false })
                .addTo(leafletMap);
            mapPolylines.push(arrowMark);
        }
    }

    if (mapBounds) {
        mapBounds.extend(plotCoords);
        debouncedFitBounds();
    }
}

async function resolveIP(ip) {
    if (!ip) return null;
    var k = String(ip).trim();
    if (!k) return null;
    if (geoIpCache.has(k)) return geoIpCache.get(k);
    if (Object.prototype.hasOwnProperty.call(geoCache, k)) return geoCache[k];
    await znGeoEnsureLookupComplete(k);
    return geoIpCache.has(k) ? geoIpCache.get(k) : geoCache[k];
}

function formatLocationLabelFromFreeipapi(d) {
    if (!d || typeof d !== 'object') return null;
    var city = d.cityName != null ? String(d.cityName).trim() : '';
    var region = d.regionName != null ? String(d.regionName).trim() : '';
    var country = d.countryName != null ? String(d.countryName).trim() : '';
    var parts = [];
    if (city) parts.push(city);
    if (region && region !== city) parts.push(region);
    if (country) parts.push(country);
    return parts.length ? parts.join(', ') : null;
}

function formatLocationLabelFromIpinfo(d) {
    if (!d || typeof d !== 'object') return null;
    var city = d.city != null ? String(d.city).trim() : '';
    var region = d.region != null ? String(d.region).trim() : '';
    var country = d.country != null ? String(d.country).trim() : '';
    var parts = [];
    if (city) parts.push(city);
    if (region && region !== city) parts.push(region);
    if (country) parts.push(country);
    return parts.length ? parts.join(', ') : null;
}

function formatLocationLabelFromIpapiCo(d) {
    if (!d || typeof d !== 'object' || d.error) return null;
    var city = d.city != null ? String(d.city).trim() : '';
    var region = d.region != null ? String(d.region).trim() : '';
    var country = d.country_name != null ? String(d.country_name).trim() : '';
    var parts = [];
    if (city) parts.push(city);
    if (region && region !== city) parts.push(region);
    if (country) parts.push(country);
    return parts.length ? parts.join(', ') : null;
}

function formatLocationLabelFromGeojs(d) {
    if (!d || typeof d !== 'object') return null;
    var city = d.city != null ? String(d.city).trim() : '';
    var region = d.region != null ? String(d.region).trim() : '';
    var country = d.country != null ? String(d.country).trim() : '';
    var parts = [];
    if (city) parts.push(city);
    if (region && region !== city) parts.push(region);
    if (country) parts.push(country);
    return parts.length ? parts.join(', ') : null;
}

/** City / region / country string for dashboard tables (shares queue + caches with resolveIP). */
async function resolveIpLocationLabel(ip) {
    if (!ip) return null;
    var key = String(ip).trim();
    if (!key || key === '\u2014') return null;
    if (Object.prototype.hasOwnProperty.call(geoLabelCache, key)) return geoLabelCache[key];
    await znGeoEnsureLookupComplete(key);
    return geoLabelCache[key];
}

function enrichConnectDailyInsightsUserLocations(insights) {
    if (!insights || typeof insights !== 'object') return Promise.resolve();
    var ipSet = Object.create(null);
    Object.keys(insights).forEach(function(day) {
        var ul = insights[day] && insights[day].userList;
        if (!Array.isArray(ul)) return;
        ul.forEach(function(u) {
            if (!u || u.ip == null) return;
            var ip = String(u.ip).trim();
            if (ip && ip !== '\u2014') ipSet[ip] = true;
        });
    });
    var ips = Object.keys(ipSet);
    if (ips.length === 0) return Promise.resolve();
    return Promise.all(ips.map(function(ip) {
        return resolveIpLocationLabel(ip).then(function(label) {
            return { ip: ip, label: label };
        });
    })).then(function(results) {
        var map = Object.create(null);
        results.forEach(function(r) {
            map[r.ip] = r.label || r.ip;
        });
        Object.keys(insights).forEach(function(day) {
            var ul = insights[day] && insights[day].userList;
            if (!Array.isArray(ul)) return;
            ul.forEach(function(u) {
                if (!u) return;
                var ip = u.ip != null ? String(u.ip).trim() : '';
                if (ip && ip !== '\u2014' && map[ip] !== undefined) u.location = map[ip];
            });
        });
    });
}

// ── Field extractors ──────────────────────────────────────────────────────
function readName(obj) {
    if (!obj) return null;
    return obj.name || obj.displayName || obj.email || obj.id || null;
}

// ── Audit event helpers ────────────────────────────────────────────────────
// Parse the `details` JSON string once and cache it on the item object.
function parseAuditDetails(item) {
    if ('_d' in item) return item._d;
    if (!item.details) { item._d = null; return null; }
    if (typeof item.details === 'object') { item._d = item.details; return item._d; }
    try   { item._d = JSON.parse(item.details); }
    catch (e) { item._d = null; }
    return item._d;
}

// True if an audit event represents a Connect / session-open action.
// Checks action/type text first, then falls back to details JSON keys.
function isConnectEvent(item) {
    if (!item || typeof item !== 'object') return false;
    if (auditTypeIsKnownConnect(item.auditType)) return true;
    var raw = String(item.action || item.type || item.description || '').toLowerCase();
    if (/connect|session|login|auth|sign[\s-]?in|session[\s-]?start/.test(raw)) return true;
    var d = parseAuditDetails(item);
    return !!(d && (d.connectedSince !== undefined || d.connectServer !== undefined ||
                    d.externalIP     !== undefined || d.expiresAt      !== undefined));
}

// True if an audit event represents a Disconnect / session-close action.
function isDisconnectEvent(item) {
    var raw = String(item.action || item.type || item.description || '').toLowerCase();
    if (/disconnect|logout|sign[\s-]?out|session[\s-]?end|terminate/.test(raw)) return true;
    var d = parseAuditDetails(item);
    return !!(d && (d.disconnectedAt !== undefined || d.disconnectReason !== undefined ||
                    d.sessionEnd     !== undefined));
}

// Return the user display name from a connect-type audit event.
// For ZN connect events, the user is in details.user OR performedBy.name.
function auditEventUser(item) {
    var d = parseAuditDetails(item);
    if (d && d.user) {
        var du = String(d.user).trim();
        if (du) return du;
    }
    var pb = item.performedBy || item.user || item.initiator || null;
    if (!pb) return null;
    var n = typeof pb === 'object'
        ? (pb.name || pb.displayName || pb.email || pb.upn || pb.userPrincipalName || null)
        : String(pb);
    return n ? String(n).trim() : null;
}

// Never drop a row for missing display name: fall back to session fingerprint / anonymous bucket.
function auditEventUserKey(item) {
    var u = auditEventUser(item);
    if (u) return u;
    return sessionUserKeyForPairing(item);
}

// Return the millisecond timestamp when a connect event started.
// Prefers details.connectedSince (accurate session start) over the event timestamp.
function auditConnectStartMs(item) {
    var d = parseAuditDetails(item);
    if (d && d.connectedSince) {
        var cs = d.connectedSince;
        var ms = typeof cs === 'number' ? (cs > 1e11 ? cs : cs * 1000) : new Date(cs).getTime();
        if (!isNaN(ms) && ms > 0) return ms;
    }
    // Fall back to the event's own timestamp
    var ts = item.timestamp || item.isoTimestamp || item.createdAt || item.performedAt || null;
    if (!ts) return null;
    var ms2 = typeof ts === 'number' ? (ts > 1e11 ? ts : ts * 1000) : new Date(ts).getTime();
    return isNaN(ms2) ? null : ms2;
}

// Connected-time widget only: require a real details.connectedSince (not 0 / missing / invalid).
function auditConnectedSinceMsStrict(item) {
    var d = parseAuditDetails(item);
    if (!d || d.connectedSince === undefined || d.connectedSince === null || d.connectedSince === '') return null;
    var cs = d.connectedSince;
    if (cs === 0 || cs === '0') return null;
    var ms = typeof cs === 'number' ? (cs > 1e11 ? cs : cs * 1000) : new Date(cs).getTime();
    if (isNaN(ms) || ms <= 0) return null;
    return ms;
}

// Connect Activity chart: pair auditType 96 with 97 / 98 / 99 per user (FIFO).
var AUDIT_TYPE_SESSION_CREATED = 96;
var AUDIT_TYPE_SESSION_ENDED   = { 97: true, 98: true, 99: true };
// Connected-time: session end events only — 97 / 98 / 99. Type 123 (extended) shares connectedSince; crediting it would double-count.
// (Spec may cite type 100 for extended; this API uses 123 for "Connect session extended" and 100 for policy.)
var AUDIT_TYPES_CONN_TIME_CREDIT = { 97: true, 98: true, 99: true };
// Product semantics (Connect session lifecycle) — see Insights & Audit Logic Guide modal.
// 96 Connect Created: user Connect; new session; posture checked.
// 97 Connect Expired: server max session / 24h limit.
// 98 Connect Revoked: admin terminated session.
// 99 Connect Logout: user Disconnect.
// Audit Operations widget: strict whitelist (IDs + normalized labels after stripping "Connect ").
var AUDIT_OPERATIONS_WHITELIST_IDS = {
    96: true, 98: true, 99: true, 123: true,
    100: true, 101: true, 102: true,
    351: true, 352: true
};
var AUDIT_OPERATIONS_WHITELIST_LABELS = {
    'session created': true,
    'session deleted': true,
    'connect session deleted': true,
    'session revoked': true,
    'connect session revoked': true,
    'region down': true,
    'region recovered': true,
    'session logout': true,
    'session extended': true,
    'policy created': true,
    'policy edited': true,
    'policy deleted': true
};
// Fixed row order + display labels (Connect prefix stripped in UI via cleanAuditTypeDisplayName).
var AUDIT_OPERATIONS_ROW_DEFS = [
    { ids: [96], label: 'Session created' },
    { ids: [98], label: 'Session deleted' },
    { ids: [351], label: 'Region down' },
    { ids: [352], label: 'Region recovered' },
    { ids: [99], label: 'Session logout' },
    { ids: [123], label: 'Session extended' },
    { ids: [100], label: 'Policy created' },
    { ids: [101], label: 'Policy edited' },
    { ids: [102], label: 'Policy deleted' }
];
// Session-related types that may include details.connectServer (often absent on 96; present on end/extended).
var AUDIT_TYPES_CONNECT_SERVER_REGION = { 96: true, 97: true, 98: true, 99: true, 123: true };
// Region Load widget: session end events only (connectServer); exclude 123 to avoid inflated counts.
var AUDIT_TYPES_REGION_LOAD_EVENTS = { 97: true, 98: true, 99: true };
function auditTypeToNum(item) {
    var n = item && item.auditType;
    if (n === undefined || n === null || n === '') return NaN;
    return typeof n === 'number' ? n : parseInt(String(n), 10);
}

/** Labels for connected-time debug (historical rows only use 97–99). */
function sessionEndTypeLabelForConnTime(n) {
    if (n === 97) return 'Expired';
    if (n === 98) return 'Revoked';
    if (n === 99) return 'Logout';
    return 'End (' + n + ')';
}

function auditTypeMayHaveConnectServerRegion(item) {
    var n = auditTypeToNum(item);
    return AUDIT_TYPES_CONNECT_SERVER_REGION[n] === true;
}

function detailsFieldMs(d, key) {
    if (!d || d[key] === undefined || d[key] === null || d[key] === '') return null;
    var v = d[key];
    var ms = typeof v === 'number' ? (v > 1e11 ? v : v * 1000) : new Date(v).getTime();
    return isNaN(ms) || ms <= 0 ? null : ms;
}

function sessionUserKeyForPairing(item) {
    var u = auditEventUser(item);
    if (u) return u;
    var fp = auditFingerprint(item);
    if (fp) return '__id:' + fp;
    return '__anon';
}

function sessionStartMsFromConnectItem(connectItem) {
    var ms = auditConnectStartMs(connectItem);
    if (ms != null) return ms;
    return getAuditItemTs(connectItem);
}

function sessionEndMsFromPair(connectItem, disconnectItem) {
    if (disconnectItem) {
        var dm = getAuditItemTs(disconnectItem);
        if (dm != null) return dm;
    }
    var d = parseAuditDetails(connectItem);
    var ex = detailsFieldMs(d, 'expiresAt');
    if (ex != null) return ex;
    return Date.now();
}

// Ordered connect sessions: { userKey, startMs, endMs } with end > start.
function buildConnectSessionsFromAudits(items) {
    var sessions = [];
    var rel = (items || []).filter(function(it) {
        var n = auditTypeToNum(it);
        return n === AUDIT_TYPE_SESSION_CREATED || AUDIT_TYPE_SESSION_ENDED[n];
    });
    rel.sort(function(a, b) {
        var ta = getAuditItemTs(a);
        var tb = getAuditItemTs(b);
        ta = ta != null ? ta : 0;
        tb = tb != null ? tb : 0;
        return ta - tb;
    });

    var pending = Object.create(null); // userKey -> connectItem[]

    rel.forEach(function(it) {
        var n = auditTypeToNum(it);
        var ukey = sessionUserKeyForPairing(it);
        if (n === AUDIT_TYPE_SESSION_CREATED) {
            if (!pending[ukey]) pending[ukey] = [];
            pending[ukey].push(it);
        } else if (AUDIT_TYPE_SESSION_ENDED[n]) {
            var stack = pending[ukey];
            if (!stack || stack.length === 0) return;
            var conn = stack.shift();
            var s0 = sessionStartMsFromConnectItem(conn);
            var s1 = sessionEndMsFromPair(conn, it);
            if (s0 != null && s1 != null && s1 > s0) {
                sessions.push({ userKey: ukey, startMs: s0, endMs: s1 });
            }
        }
    });

    Object.keys(pending).forEach(function(ukey) {
        (pending[ukey] || []).forEach(function(conn) {
            var s0 = sessionStartMsFromConnectItem(conn);
            if (s0 == null) return;
            var s1 = sessionEndMsFromPair(conn, null);
            if (s1 > s0) sessions.push({ userKey: ukey, startMs: s0, endMs: s1 });
        });
    });

    return sessions;
}

// Time buckets for Connect Activity: daily for 7d/30d, 12-hour steps for 24h.
function buildConnectActivityBuckets(period) {
    var cutMs = cutoffMs(period);
    var nowMs = Date.now();
    var out = [];

    if (period === '24h') {
        var step = 12 * 3600 * 1000;
        var t = cutMs;
        var bi = 0;
        while (t < nowMs) {
            var end = Math.min(t + step, nowMs);
            var d = new Date(t);
            var slot = d.getHours() < 12 ? '0–12h' : '12–24h';
            out.push({
                startMs: t,
                endMs: end,
                label: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + slot
            });
            bi++;
            t = end;
            if (bi > 48) break;
        }
        if (out.length === 0) out.push({ startMs: cutMs, endMs: nowMs, label: 'Last 24h' });
    } else {
        var cursor = new Date(cutMs);
        cursor.setHours(0, 0, 0, 0);
        var guard = 0;
        while (cursor.getTime() <= nowMs && guard < 400) {
            guard++;
            var dayStart = cursor.getTime();
            var nextDay = new Date(cursor);
            nextDay.setDate(nextDay.getDate() + 1);
            var dayEndMs = nextDay.getTime();
            var b0 = Math.max(dayStart, cutMs);
            var b1 = Math.min(dayEndMs, nowMs);
            if (b0 < b1) {
                out.push({
                    startMs: b0,
                    endMs: b1,
                    label: cursor.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
                });
            }
            cursor.setDate(cursor.getDate() + 1);
        }
    }
    if (out.length === 0) {
        out.push({ startMs: cutMs, endMs: nowMs, label: 'Current window' });
    }
    return out;
}

// DAU chart: last N calendar days (oldest → newest), clipped to "now" for the current day.
function buildLastNDayBuckets(n) {
    var nDays = Math.max(1, Math.min(30, parseInt(n, 10) || 7));
    var nowMs = Date.now();
    var out = [];
    for (var i = nDays - 1; i >= 0; i--) {
        var d = new Date(nowMs);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - i);
        var dayStart = d.getTime();
        var nextDay = new Date(d);
        nextDay.setDate(nextDay.getDate() + 1);
        var b0 = dayStart;
        var b1 = Math.min(nextDay.getTime(), nowMs);
        if (b0 < b1) {
            out.push({
                startMs: b0,
                endMs: b1,
                label: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
            });
        }
    }
    if (out.length === 0) {
        out.push({ startMs: nowMs - 86400000, endMs: nowMs, label: 'Current' });
    }
    return out;
}

function auditOperationWhitelistKey(item) {
    var n = auditTypeToNum(item);
    var raw = auditTypeNameOrFallback(n);
    if (!raw || String(raw).indexOf('Connect Event (') === 0) {
        raw = String(item.action || item.type || item.description || '').trim();
    }
    return String(raw).replace(/^Connect\s+/i, '').trim().toLowerCase();
}

function auditOperationIsWhitelisted(item) {
    var n = auditTypeToNum(item);
    if (!isNaN(n) && AUDIT_OPERATIONS_WHITELIST_IDS[n]) return true;
    var key = auditOperationWhitelistKey(item);
    if (AUDIT_OPERATIONS_WHITELIST_LABELS[key]) return true;
    return false;
}

function syncActivityChartControlUi() {
    var modeSel = document.getElementById('activity-mode-select');
    if (modeSel) modeSel.value = activityChartMode || 'connect';
    var d = typeof dauChartRangeDays === 'number' ? Math.floor(dauChartRangeDays) : 7;
    if (d !== 7 && d !== 14 && d !== 30) d = 7;
    var pillHost = document.getElementById('activity-range-pills');
    if (pillHost) {
        pillHost.querySelectorAll('.activity-range-pill').forEach(function(btn) {
            var n = parseInt(btn.getAttribute('data-days'), 10);
            btn.classList.toggle('is-active', n === d);
        });
    }
}

function countConcurrentUsersInBucket(sessions, b0, b1) {
    var seen = Object.create(null);
    var n = 0;
    (sessions || []).forEach(function(s) {
        if (s.startMs < b1 && s.endMs > b0 && !seen[s.userKey]) {
            seen[s.userKey] = true;
            n++;
        }
    });
    return n;
}

// DAU stacked chart: only named regions — omit "", undefined, Unknown, and junk strings.
function isValidDauRegionLabel(r) {
    if (r === undefined || r === null) return false;
    var s = String(r).trim();
    if (s === '') return false;
    var lower = s.toLowerCase();
    if (lower === 'unknown' || lower === 'undefined' || lower === 'null') return false;
    return true;
}

// Most recent region per user from session end audits (97, 98, 99) with consistent mapping.
function buildUserKeyToMostRecentRegionFromAudits(allItems, period) {
    var usePeriod = period || activePeriod;
    var filtered = filterByPeriod(allItems || [], usePeriod);
    var endEvents = filtered.filter(function(item) {
        return AUDIT_TYPES_REGION_LOAD_EVENTS[auditTypeToNum(item)];
    });
    endEvents.sort(function(a, b) {
        var ta = getAuditItemTs(a);
        var tb = getAuditItemTs(b);
        ta = ta != null ? ta : 0;
        tb = tb != null ? tb : 0;
        return tb - ta;
    });
    var map = Object.create(null);
    endEvents.forEach(function(item) {
        // Use consistent region resolution instead of raw connectServer
        var r = resolveRegionNameFromAudit(item);
        if (!r) return;
        var u = auditEventUserKey(item);
        if (map[u] === undefined) map[u] = r;
    });
    return map;
}

function countUniqueUsersByRegionInBucket(sessions, b0, b1, userKeyToRegion) {
    var seen = Object.create(null);
    var byRegion = Object.create(null);
    (sessions || []).forEach(function(s) {
        if (s.startMs >= b1 || s.endMs <= b0) return;
        if (seen[s.userKey]) return;
        seen[s.userKey] = true;
        var reg = userKeyToRegion && userKeyToRegion[s.userKey];
        if (!isValidDauRegionLabel(reg)) return;
        byRegion[reg] = (byRegion[reg] || 0) + 1;
    });
    return byRegion;
}

/** Audit Activity — Connect mode: unique users per day (session created / expired / logout), split by region. */
function countUniqueUsers969798PerBucketByRegion(poolItems, buckets, userKeyToRegion) {
    var TYPE_SET = { 97: true, 98: true, 99: true };
    return buckets.map(function(b) {
        var seenUser = Object.create(null);
        poolItems.forEach(function(item) {
            if (!TYPE_SET[auditTypeToNum(item)]) return;
            var ts = getAuditItemTs(item);
            if (ts == null || ts < b.startMs || ts >= b.endMs) return;
            var u = auditEventUserKey(item);
            if (!u || seenUser[u] !== undefined) return;
            var reg = resolveRegionNameFromAudit(item);
            if (!reg) reg = userKeyToRegion && userKeyToRegion[u];
            if (!reg) return;
            seenUser[u] = reg;
        });
        var byReg = Object.create(null);
        Object.keys(seenUser).forEach(function(u) {
            var r = seenUser[u];
            byReg[r] = (byReg[r] || 0) + 1;
        });
        return byReg;
    });
}

/**
 * Type 96 (session created) only: per bucket label, unique users (with ip/region), `uacName` frequencies.
 * Final shape: { [label]: { uniqueUserCount, topPolicy, userList: {name,ip,region,location?}[], policyBreakdown } }.
 */
function buildConnectModeDailyInsightsFromType96(poolItems, timeBuckets) {
    var dailyInsights = {};
    timeBuckets.forEach(function(b) {
        dailyInsights[b.label] = {
            uniqueUserMap: Object.create(null),
            policyCounts: Object.create(null)
        };
    });

    (poolItems || []).forEach(function(item) {
        if (auditTypeToNum(item) !== AUDIT_TYPE_SESSION_CREATED) return;
        var ts = getAuditItemTs(item);
        if (ts == null) return;
        var bucket = null;
        for (var bi = 0; bi < timeBuckets.length; bi++) {
            var bu = timeBuckets[bi];
            if (ts >= bu.startMs && ts < bu.endMs) {
                bucket = bu;
                break;
            }
        }
        if (!bucket) return;
        var entry = dailyInsights[bucket.label];
        if (!entry) return;

        var detailsObj = null;
        try {
            if (item.details === undefined || item.details === null || item.details === '') return;
            detailsObj = typeof item.details === 'object' ? item.details : JSON.parse(item.details);
        } catch (err) {
            return;
        }
        if (!detailsObj || typeof detailsObj !== 'object') return;

        if (detailsObj.user != null) {
            var ustr = typeof detailsObj.user === 'string' ? detailsObj.user.trim() : String(detailsObj.user).trim();
            if (ustr) {
                if (!entry.uniqueUserMap[ustr]) {
                    entry.uniqueUserMap[ustr] = {
                        name: ustr,
                        ip: '\u2014',
                        region: 'Unknown',
                        location: null
                    };
                }
                var urow = entry.uniqueUserMap[ustr];
                var extIp = detailsObj.externalIP != null ? detailsObj.externalIP : detailsObj.externalIp;
                if (extIp != null && String(extIp).trim()) urow.ip = String(extIp).trim();
                var srvNm = item.server && item.server.name != null ? String(item.server.name).trim() : '';
                var arNm = item.actualRegion && item.actualRegion.name != null ? String(item.actualRegion.name).trim() : '';
                var csLab = connectServerRegionLabel(detailsObj);
                var regResolved = arNm || csLab || srvNm || null;
                if (regResolved) urow.region = regResolved;
            }
        }

        if (detailsObj.uacName != null) {
            var pol = typeof detailsObj.uacName === 'string' ? detailsObj.uacName.trim() : String(detailsObj.uacName).trim();
            if (pol) entry.policyCounts[pol] = (entry.policyCounts[pol] || 0) + 1;
        }
    });

    Object.keys(dailyInsights).forEach(function(k) {
        var d = dailyInsights[k];
        var userList = d.uniqueUserMap
            ? Object.keys(d.uniqueUserMap).sort().map(function(key) { return d.uniqueUserMap[key]; })
            : [];
        var policyBreakdown = Object.create(null);
        var topPolicy = '\u2014';
        var max = 0;
        if (d.policyCounts) {
            Object.keys(d.policyCounts).forEach(function(p) {
                var c = d.policyCounts[p];
                policyBreakdown[p] = c;
                if (c > max) {
                    max = c;
                    topPolicy = p;
                }
            });
        }
        dailyInsights[k] = {
            uniqueUserCount: userList.length,
            topPolicy: max > 0 ? topPolicy : '\u2014',
            userList: userList,
            policyBreakdown: policyBreakdown
        };
    });

    return dailyInsights;
}

/** Policy name from audit details JSON (`Role.name` or nested shapes). */
function policyRoleNameFromAuditDetails(d) {
    if (!d || typeof d !== 'object') return null;
    var R = d.Role;
    if (R && typeof R === 'object') {
        var nm = R.name != null ? R.name : R.displayName;
        if (nm != null) {
            var s = String(nm).trim();
            if (s) return s;
        }
    }
    R = d.role;
    if (R && typeof R === 'object') {
        var nm2 = R.name != null ? R.name : R.displayName;
        if (nm2 != null) {
            var t = String(nm2).trim();
            if (t) return t;
        }
    }
    return null;
}

function auditPolicyOperationActionLabel(typeNum) {
    var n = Number(typeNum);
    if (n === 100) return 'Created';
    if (n === 101) return 'Edited';
    if (n === 102) return 'Deleted';
    return '\u2014';
}

function policyAuditTablePolicyName(ev) {
    var t = auditTypeToNum(ev);
    var d = parseAuditDetails(ev);
    if (!d || typeof d !== 'object') return '\u2014';
    if (t === 102 && d.PrevRole && typeof d.PrevRole === 'object') {
        var pr = d.PrevRole.name != null ? d.PrevRole.name : d.PrevRole.displayName;
        if (pr != null && String(pr).trim()) return String(pr).trim();
    }
    return policyRoleNameFromAuditDetails(d) || '\u2014';
}

var AUDIT_TYPES_POLICY_OPS = { 100: true, 101: true, 102: true };

/**
 * Policy Operations chart: types 100/101/102 per bucket — admin counts, affected policy names, raw rows.
 * Final: { [label]: { topAdmin, affectedPolicies, rawEvents } }.
 */
function buildPolicyModeDailyInsightsFrom100101102(poolItems, timeBuckets) {
    var dailyPolicyInsights = {};
    timeBuckets.forEach(function(b) {
        dailyPolicyInsights[b.label] = {
            adminCounts: Object.create(null),
            policyNames: new Set(),
            rawEvents: []
        };
    });

    (poolItems || []).forEach(function(item) {
        if (!AUDIT_TYPES_POLICY_OPS[auditTypeToNum(item)]) return;
        var ts = getAuditItemTs(item);
        if (ts == null) return;
        var bucket = null;
        for (var bi = 0; bi < timeBuckets.length; bi++) {
            var bu = timeBuckets[bi];
            if (ts >= bu.startMs && ts < bu.endMs) {
                bucket = bu;
                break;
            }
        }
        if (!bucket) return;
        var entry = dailyPolicyInsights[bucket.label];
        if (!entry) return;

        var adminName = '(unknown)';
        var pb = item.performedBy;
        if (pb && typeof pb === 'object' && pb.name != null && String(pb.name).trim()) {
            adminName = String(pb.name).trim();
        } else {
            var rn = readName(pb);
            if (rn) adminName = String(rn).trim();
        }
        entry.adminCounts[adminName] = (entry.adminCounts[adminName] || 0) + 1;

        var d = parseAuditDetails(item);
        var polName = policyRoleNameFromAuditDetails(d);
        if (polName) entry.policyNames.add(polName);

        entry.rawEvents.push(item);
    });

    Object.keys(dailyPolicyInsights).forEach(function(k) {
        var e = dailyPolicyInsights[k];
        var topAdmin = '\u2014';
        var maxA = 0;
        if (e.adminCounts) {
            Object.keys(e.adminCounts).forEach(function(a) {
                var c = e.adminCounts[a];
                if (c > maxA) {
                    maxA = c;
                    topAdmin = a;
                }
            });
        }
        if (maxA === 0) topAdmin = '\u2014';
        var affectedPolicies = e.policyNames instanceof Set ? Array.from(e.policyNames).sort() : [];
        dailyPolicyInsights[k] = {
            topAdmin: topAdmin,
            affectedPolicies: affectedPolicies,
            rawEvents: e.rawEvents
        };
    });

    return dailyPolicyInsights;
}

function znRichTooltipEscapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
}

/** Sorted rows for Policy Operations popover / modal table. */
function znBuildPolicyOperationsTableRows(eventsArray) {
    var evs = (eventsArray || []).slice().sort(function(a, b) {
        var ta = getAuditItemTs(a);
        var tb = getAuditItemTs(b);
        if (ta == null && tb == null) return 0;
        if (ta == null) return 1;
        if (tb == null) return -1;
        return ta - tb;
    });
    return evs.map(function(ev) {
        var t = auditTypeToNum(ev);
        var admin = ev.performedBy && typeof ev.performedBy === 'object' && ev.performedBy.name != null
            ? String(ev.performedBy.name).trim()
            : (readName(ev.performedBy) || '\u2014');
        return [
            getAuditItemDisplayTimeString(ev),
            auditPolicyOperationActionLabel(t),
            policyAuditTablePolicyName(ev),
            admin
        ];
    });
}

function znPinChartRichTooltip() {
    var tt = document.getElementById('chartjs-rich-tooltip');
    if (tt) tt.classList.add('is-pinned');
}

function znRichTooltipOnClick(ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var userEl = t.closest('.user-link');
    if (userEl) {
        var dUser = userEl.getAttribute('data-date') || '';
        var insU = znAuditActivityConnectDailyInsights && znAuditActivityConnectDailyInsights[dUser];
        var list = insU && Array.isArray(insU.userList) ? insU.userList : [];
        znPinChartRichTooltip();
        openFormattedUsersPopover(dUser, list);
        return;
    }
    var polEl = t.closest('.policy-link');
    if (polEl) {
        var dPol = polEl.getAttribute('data-date') || '';
        var insP = znAuditActivityConnectDailyInsights && znAuditActivityConnectDailyInsights[dPol];
        var br = insP && insP.policyBreakdown && typeof insP.policyBreakdown === 'object'
            ? insP.policyBreakdown
            : {};
        var polRows = Object.keys(br).sort(function(a, b) {
            return (br[b] || 0) - (br[a] || 0);
        }).map(function(k) {
            return [k, String(br[k] != null ? br[k] : '')];
        });
        znPinChartRichTooltip();
        showChartDetailPopover('Top Policy Triggered on ' + dPol, ['Policy Name', 'Hits'], polRows);
        return;
    }
    var adminL = t.closest('.admin-link');
    var affPolL = t.closest('.affected-policy-link');
    if (adminL || affPolL) {
        var dPolOp = (adminL || affPolL).getAttribute('data-date') || '';
        var insPo = znAuditActivityPolicyDailyInsights && znAuditActivityPolicyDailyInsights[dPolOp];
        znPinChartRichTooltip();
        if (adminL) {
            var rawEv = insPo && Array.isArray(insPo.rawEvents) ? insPo.rawEvents : [];
            var rowsAdm = znBuildPolicyOperationsTableRows(rawEv);
            showChartDetailPopover('Top Administrator on ' + dPolOp,
                ['Time', 'Action', 'Policy Name', 'Admin'], rowsAdm);
        } else {
            var aff = insPo && Array.isArray(insPo.affectedPolicies) ? insPo.affectedPolicies : [];
            var affRows = aff.map(function(p) { return [String(p)]; });
            showChartDetailPopover('Policies Affected on ' + dPolOp, ['Policy Name'], affRows);
        }
        return;
    }
}

function znFormatAffectedPoliciesPreviewEscaped(arr) {
    var a = Array.isArray(arr) ? arr : [];
    if (a.length === 0) return '\u2014';
    var first = a.slice(0, 3).map(function(p) { return znRichTooltipEscapeHtml(String(p)); }).join(', ');
    if (a.length <= 3) return first;
    return first + ' +' + (a.length - 3) + ' more';
}

function znActivityModeForRichTooltip() {
    var modeSel = document.getElementById('activity-mode-select');
    var v = modeSel && modeSel.value ? String(modeSel.value) : '';
    if (v) return v;
    return activityChartMode || 'connect';
}

function znRichTooltipEnsureBound(tooltipEl) {
    if (!tooltipEl || tooltipEl.getAttribute('data-zn-rich-bound') === '1') return;
    tooltipEl.setAttribute('data-zn-rich-bound', '1');
    tooltipEl.addEventListener('mouseenter', function() {
        tooltipEl.classList.add('is-hovered');
    });
    tooltipEl.addEventListener('mouseleave', function() {
        tooltipEl.classList.remove('is-hovered');
        if (tooltipEl.classList.contains('is-pinned')) return;
        tooltipEl.style.opacity = '0';
        tooltipEl.style.visibility = 'hidden';
    });
    tooltipEl.addEventListener('click', znRichTooltipOnClick);
}

function customRichTooltip(context) {
    var tooltip = context.tooltip;
    var tooltipEl = document.getElementById('chartjs-rich-tooltip');
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'chartjs-rich-tooltip';
        document.body.appendChild(tooltipEl);
    }
    znRichTooltipEnsureBound(tooltipEl);

    if (!tooltip || tooltip.opacity === 0) {
        if (tooltipEl.classList.contains('is-pinned')) return;
        if (!tooltipEl.classList.contains('is-hovered')) {
            tooltipEl.style.opacity = '0';
            tooltipEl.style.visibility = 'hidden';
        }
        return;
    }

    var chart = context.chart;
    var position = chart.canvas.getBoundingClientRect();
    var dateLabel = (tooltip.title && tooltip.title.length) ? String(tooltip.title[0]) : '';
    var dataPoints = tooltip.dataPoints || [];
    var escDate = znRichTooltipEscapeHtml(dateLabel);
    var ttMode = znActivityModeForRichTooltip();

    var rows = dataPoints.map(function(dp) {
        var lab = dp.dataset && dp.dataset.label != null ? String(dp.dataset.label) : '';
        var val = dp.parsed && dp.parsed.y !== undefined ? dp.parsed.y : dp.raw;
        var bc = dp.dataset && dp.dataset.borderColor;
        if (Array.isArray(bc)) bc = bc[0];
        bc = bc != null ? String(bc) : '#94a3b8';
        return '<div class="zn-rich-tooltip-row">' +
            '<span class="color-box" style="background:' + znRichTooltipEscapeHtml(bc) + '"></span>' +
            '<span class="zn-rich-tooltip-label">' + znRichTooltipEscapeHtml(lab) + '</span>' +
            '<span class="zn-rich-tooltip-val">' + znRichTooltipEscapeHtml(String(val)) + '</span></div>';
    }).join('');

    var headerHtml = escDate ? '<div class="zn-rich-tooltip-date">' + escDate + '</div>' : '';

    var insightsHtml = '';
    if (ttMode === 'connect' && znAuditActivityConnectDailyInsights && dateLabel) {
        var ins = znAuditActivityConnectDailyInsights[dateLabel];
        if (ins) {
            var uniqueCount = ins.uniqueUserCount || 0;
            var polBr = ins.policyBreakdown || {};
            var topPols = Object.keys(polBr)
                .sort(function(a, b) { return (polBr[b] || 0) - (polBr[a] || 0); })
                .slice(0, 2);
            var topPolsStr = topPols.length
                ? topPols.map(function(p) { return znRichTooltipEscapeHtml(p); }).join(', ')
                : '\u2014';
            insightsHtml = '<hr class="zn-rich-tooltip-hr">' +
                '<div class="zn-rich-tooltip-insight user-link" data-date="' + znRichTooltipEscapeHtml(dateLabel) + '">' +
                'Unique users: <strong>' + uniqueCount + '</strong></div>' +
                '<div class="zn-rich-tooltip-insight policy-link" data-date="' + znRichTooltipEscapeHtml(dateLabel) + '">' +
                'Top policies: <strong>' + topPolsStr + '</strong></div>';
        }
    }

    tooltipEl.innerHTML = headerHtml + rows + insightsHtml;

    tooltipEl.style.opacity = '1';
    tooltipEl.style.visibility = 'visible';
    tooltipEl.style.position = 'absolute';
    tooltipEl.style.left = position.left + window.pageXOffset + tooltip.caretX + 'px';
    tooltipEl.style.top = position.top + window.pageYOffset + tooltip.caretY + 'px';
}

function countAuditTypeInBucketRange(poolItems, typeId, b0, b1) {
    var c = 0;
    poolItems.forEach(function(item) {
        if (auditTypeToNum(item) !== typeId) return;
        var ts = getAuditItemTs(item);
        if (ts == null || ts < b0 || ts >= b1) return;
        c++;
    });
    return c;
}

function hexToRgba(hex, alpha) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return 'rgba(0,223,154,' + alpha + ')';
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + alpha + ')';
}

function rawOS(session) {
    var ed = session.entityData;
    if (ed && ed.src) {
        var v = ed.src.osType;
        if (v !== undefined && v !== null && v !== '') return v;
        v = ed.src.operatingSystem || ed.src.os;
        if (v !== undefined && v !== null && v !== '') return v;
    }
    if (session.asset) {
        var v2 = session.asset.osType;
        if (v2 !== undefined && v2 !== null && v2 !== '') return v2;
        v2 = session.asset.operatingSystem || session.asset.os;
        if (v2 !== undefined && v2 !== null && v2 !== '') return v2;
    }
    return session.osType || session.operatingSystem || session.os || null;
}

// OS Distribution accordion: exact string from session.asset.operatingSystem only.
function sessionAssetOperatingSystemExact(session) {
    if (!session || !session.asset || session.asset.operatingSystem === undefined || session.asset.operatingSystem === null)
        return null;
    var t = String(session.asset.operatingSystem).trim();
    return t || null;
}

// Map API OS string → top-level family (Windows, macOS, Linux, iOS, Android, Other, Unknown).
function osMajorFamilyFromExactString(exact) {
    if (exact === undefined || exact === null) return 'Unknown';
    var lower = String(exact).trim().toLowerCase();
    if (!lower) return 'Unknown';
    if (lower.indexOf('ipad') !== -1 || lower.indexOf('iphone') !== -1 || lower.indexOf('ipados') !== -1)
        return 'iOS';
    if (lower.indexOf('ios') !== -1 && lower.indexOf('macos') === -1 && lower.indexOf('mac os') === -1)
        return 'iOS';
    if (lower.indexOf('android') !== -1) return 'Android';
    if (lower.indexOf('windows') !== -1 || /^win\d/.test(lower) || lower === 'win32' || lower === 'win64')
        return 'Windows';
    if (lower.indexOf('mac') !== -1 || lower.indexOf('darwin') !== -1 || lower.indexOf('os x') !== -1)
        return 'macOS';
    if (lower.indexOf('linux') !== -1 || lower.indexOf('ubuntu') !== -1 || lower.indexOf('debian') !== -1 ||
        lower.indexOf('fedora') !== -1 || lower.indexOf('centos') !== -1 || lower.indexOf('red hat') !== -1 ||
        lower.indexOf('rhel') !== -1)
        return 'Linux';
    return 'Other';
}

function clientVer(session) {
    return session.currentClientVersion || session.clientVersion || session.version || null;
}

function regionName(session) {
    if (!session || !session.actualRegion || session.actualRegion.name == null) return null;
    var n = String(session.actualRegion.name).trim();
    return n || null;
}

function userName(session) {
    var ed = session.entityData;
    if (ed && ed.src) return readName(ed.src) || null;
    return readName(session.user || session.src || session.subject) || null;
}

function assetName(session) {
    var ed = session.entityData;
    if (ed && ed.dst) return readName(ed.dst) || null;
    return readName(session.asset || session.dst || session.device) || null;
}

function safe(val, fallback) {
    return (val !== null && val !== undefined && val !== '') ? val : (fallback || 'N/A');
}

var ZN_MAP_VIEW_LS = 'zn_connectivity_map_view';
var ZN_GEO_LOCATION_DISCLAIMER = 'Location data is approximate based on ISP registration.';

function sessionPublicIp(s) {
    if (!s || typeof s !== 'object') return null;
    var ed = s.entityData && s.entityData.src;
    return s.currentPublicIp || s.publicIp || s.srcIp ||
        s.externalIP || s.externalIp ||
        s.clientIp || s.sourceIp || s.remoteIp ||
        (ed && (ed.currentPublicIp || ed.publicIp || ed.ip || ed.srcIp || ed.externalIP || ed.externalIp)) ||
        (s.src && (s.src.currentPublicIp || s.src.publicIp || s.src.ip || s.src.externalIP || s.src.externalIp)) ||
        null;
}

function connectivityUserName(s) {
    if (s.user && typeof s.user.name === 'string' && s.user.name.trim()) return s.user.name.trim();
    return safe(userName(s));
}

function connectivityDeviceName(s) {
    if (s.asset && typeof s.asset.name === 'string' && s.asset.name.trim()) return s.asset.name.trim();
    return safe(assetName(s));
}

function connectivityOSName(s) {
    if (s.asset && s.asset.operatingSystem != null && s.asset.operatingSystem !== '')
        return String(s.asset.operatingSystem);
    return 'N/A';
}

function connectivityClientVersion(s) {
    return safe(s.clientVersion || clientVer(s));
}

function connectivityRegionName(s) {
    return (s.actualRegion && s.actualRegion.name) ? String(s.actualRegion.name) : 'N/A';
}

function buildConnectivityTableHtml(sessions) {
    var rows = (sessions || []).map(function(s) {
        var ip = sessionPublicIp(s);
        return '<tr>' +
            '<td>' + escapeHtmlAttr(connectivityUserName(s)) + '</td>' +
            '<td>' + escapeHtmlAttr(connectivityDeviceName(s)) + '</td>' +
            '<td>' + escapeHtmlAttr(connectivityOSName(s)) + '</td>' +
            '<td>' + escapeHtmlAttr(connectivityClientVersion(s)) + '</td>' +
            '<td>' + escapeHtmlAttr(ip != null ? String(ip) : 'N/A') + '</td>' +
            '<td>' + escapeHtmlAttr(connectivityRegionName(s)) + '</td>' +
            '</tr>';
    }).join('');
    return '<table class="zn-connectivity-table">' +
        '<thead><tr>' +
        '<th>User</th><th>Device</th><th>OS</th><th>Version</th><th>Public IP</th><th>Region</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>';
}

function openConnectivityModal(title, sessions, meta) {
    meta = meta || {};
    var detailsModal = document.getElementById('detailsModal');
    if (detailsModal) detailsModal.classList.add('modal--wide-connectivity');
    var metaEl = document.getElementById('modal-meta');
    if (metaEl) metaEl.style.display = 'none';
    document.getElementById('modal-title').textContent = title;

    var sub = '';
    if (meta.locationLine) {
        sub += '<div class="zn-connectivity-modal-subtitle">' + meta.locationLine +
            ' <span class="zn-connectivity-tip" title="' + escapeHtmlAttr(ZN_GEO_LOCATION_DISCLAIMER) +
            '">ⓘ</span></div>';
    }
    if (meta.serverNote) {
        sub += '<div class="zn-connectivity-modal-subtitle">' + meta.serverNote + '</div>';
    }

    if (!sessions || sessions.length === 0) {
        document.getElementById('modal-body').innerHTML = sub +
            '<p style="color:#94a3b8;font-style:italic;padding:12px 0">No session data.</p>';
        document.getElementById('modal-backdrop').classList.add('open');
        return;
    }

    document.getElementById('modal-body').innerHTML =
        sub + '<div style="overflow-x:auto;margin-top:4px">' + buildConnectivityTableHtml(sessions) + '</div>';
    document.getElementById('modal-backdrop').classList.add('open');
}

function openConnectivityModalGeo(sessions, opts) {
    opts = opts || {};
    var uniq = [];
    var seen = Object.create(null);
    (sessions || []).forEach(function(s) {
        var ip = sessionPublicIp(s);
        if (ip != null && String(ip) !== '' && !seen[String(ip)]) {
            seen[String(ip)] = true;
            uniq.push(String(ip));
        }
    });
    var locationLine;
    if (uniq.length === 1) {
        locationLine = 'Location: Based on Public IP (' + escapeHtmlAttr(uniq[0]) + ')';
    } else if (uniq.length > 1) {
        locationLine = 'Location: Based on Public IP (' + uniq.length + ' distinct addresses in this cluster)';
    } else {
        locationLine = 'Location: Public IP unavailable for Geo-IP in this selection';
    }
    var n = (sessions || []).length;
    var title = opts.cluster
        ? ('Connectivity — ' + n + ' session' + (n !== 1 ? 's' : ''))
        : 'Connectivity';
    openConnectivityModal(title, sessions, { locationLine: locationLine });
}

function openConnectivityModalServer(gatewayName, sessions) {
    var title = 'Gateway: ' + safe(gatewayName, 'Unknown');
    var n = (sessions || []).length;
    var note = n + ' active session' + (n !== 1 ? 's' : '') + ' anchored to this gateway.';
    openConnectivityModal(title, sessions, { serverNote: note });
}

// Format milliseconds as a human-readable duration: "4h 32m", "15m", "45s"
function formatDuration(ms) {
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    if (h > 0) return h + 'h' + (m > 0 ? ' ' + m + 'm' : '');
    if (m > 0) return m + 'm' + (s > 0 ? ' ' + s + 's' : '');
    return s + 's';
}

// Overall Connected Time: >= 24h → "X days, Y hrs"; else "Xh Ym" (or minutes/seconds).
function formatConnectedDuration(ms) {
    if (ms == null || !isFinite(ms) || ms <= 0) return '0s';
    var dayMs = 24 * 3600 * 1000;
    if (ms >= dayMs) {
        var days = Math.floor(ms / dayMs);
        var rem = ms - days * dayMs;
        var hrs = Math.floor(rem / 3600000);
        var out = days + (days === 1 ? ' day' : ' days');
        if (hrs > 0) out += ', ' + hrs + (hrs === 1 ? ' hr' : ' hrs');
        return out;
    }
    return formatDuration(ms);
}

/** Overall Connected Time card: hours + minutes only (no seconds), e.g. "12h 34m" or "45m". */
function formatConnTimeHoursMinutes(ms) {
    if (ms == null || !isFinite(ms) || ms <= 0) return '0m';
    var totalMin = Math.floor(ms / 60000);
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm';
    return '< 1m';
}

/** Debug modal: total elapsed as H:MM:SS (hours may exceed 24). */
function formatDurationHMS(ms) {
    if (ms == null || !isFinite(ms) || ms < 0) return '00:00:00';
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    function z(x) { return x < 10 ? '0' + x : String(x); }
    return String(h) + ':' + z(m) + ':' + z(s);
}

function fmtConnLogTs(ms) {
    if (ms == null || !isFinite(ms)) return '?';
    try {
        return new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
    } catch (e) {
        return String(ms);
    }
}

function calendarDayKeyLocal(ms) {
    if (ms == null || !isFinite(ms)) return null;
    var d = new Date(ms);
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

function formatCalendarDayMedium(ymd) {
    var p = String(ymd || '').split('-');
    if (p.length !== 3) return String(ymd);
    var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    if (isNaN(d.getTime())) return String(ymd);
    return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

// Normalise connectionState to 'active' | 'offline' | 'unknown'
function sessionState(s) {
    var cs = s.connectionState;
    if (cs === 1 || cs === 'active'   || cs === 'Active'   || cs === 'ACTIVE'      ||
        cs === 'connected' || cs === 'Connected') return 'active';
    if (cs === 2 || cs === 'offline'  || cs === 'Offline'  || cs === 'OFFLINE'     ||
        cs === 'disconnected') return 'offline';
    if (cs === 3 || cs === 'connecting') return 'connecting';
    return 'unknown';
}

// Split the master /connect/sessions array into two mutually exclusive buckets.
// Active = live connected; "offline" KPI bucket = everything else (offline, connecting, unknown).
function splitSessionsByLiveState(sessions) {
    var active = [];
    var offlineBucket = [];
    (sessions || []).forEach(function(s) {
        if (sessionState(s) === 'active') active.push(s);
        else offlineBucket.push(s);
    });
    return { active: active, offline: offlineBucket };
}

// ── Active Sessions Drawer ─────────────────────────────────────────────────

var sessionsDrawerFilter = 'all'; // 'all' | 'active' | 'offline'

/** Resolve a session's display state: active | connecting | offline */
function sessionDisplayState(s) {
    var st = sessionState(s);
    if (st === 'active')     return 'active';
    if (st === 'connecting') return 'connecting';
    return 'offline'; // covers 'offline' + 'unknown' (Authenticated but not Connected)
}

/** Badge class + label for a session row */
function sessionBadgeInfo(s) {
    var st = sessionDisplayState(s);
    if (st === 'active')     return { cls: 'badge-green', label: 'Connected' };
    if (st === 'connecting') return { cls: 'badge-amber', label: 'Connecting' };
    return { cls: 'badge-slate', label: 'Offline' };
}

function openSessionsDrawer() {
    var bd = document.getElementById('sessions-drawer-backdrop');
    if (!bd) return;
    sessionsDrawerFilter = 'all';
    sessionsDrawerState.searchQuery = '';
    sessionsDrawerState.sortColumn = null;
    sessionsDrawerState.sortDirection = 'asc';
    var searchInput = document.getElementById('sessions-drawer-search');
    if (searchInput) searchInput.value = '';
    try { renderSessionsDrawerContent(); } catch (e) { console.error('[ZN] renderSessionsDrawerContent failed:', e); }
    
    // Ensure event listeners are wired after render
    setTimeout(function() {
        wireSessionsDrawerInteractions();
    }, 0);
    
    bd.classList.add('is-open');
}

function wireSessionsDrawerInteractions() {
    // Wire sessions drawer search input
    var sessionsSearch = document.getElementById('sessions-drawer-search');
    if (sessionsSearch && !sessionsSearch.dataset.znSearchWired) {
        sessionsSearch.dataset.znSearchWired = '1';
        sessionsSearch.addEventListener('input', function() {
            sessionsDrawerState.searchQuery = sessionsSearch.value || '';
            renderSessionsDrawerContent();
        });
    }

    // Wire sessions drawer column sorting
    var sortableHeaders = document.querySelectorAll('.ses-list-header--sortable .sortable-header');
    sortableHeaders.forEach(function(header) {
        if (header.dataset.znSortWired) return;
        header.dataset.znSortWired = '1';
        header.addEventListener('click', function() {
            var column = header.getAttribute('data-sort');
            if (sessionsDrawerState.sortColumn === column) {
                sessionsDrawerState.sortDirection = sessionsDrawerState.sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                sessionsDrawerState.sortColumn = column;
                sessionsDrawerState.sortDirection = 'asc';
            }
            renderSessionsDrawerContent();
        });
    });
}

function closeSessionsDrawer() {
    var bd = document.getElementById('sessions-drawer-backdrop');
    if (bd) bd.classList.remove('is-open');
}

// Professional deep-palette gradients: [darkStop, lightStop]
var DIST_GRADIENTS = {
    Windows:  ['#1e3a8a', '#2563eb'],
    macOS:    ['#4c1d95', '#7c3aed'],
    Linux:    ['#78350f', '#d97706'],
    iOS:      ['#064e3b', '#059669'],
    Android:  ['#14532d', '#16a34a'],
    Other:    ['#374151', '#6b7280'],
    Unknown:  ['#1e293b', '#475569']
};
var DIST_DEFAULT_GRADIENTS = [
    ['#1e3a8a', '#2563eb'],
    ['#4f3d6c', '#7e5bbd'],
    ['#064e3b', '#059669'],
    ['#7c2d12', '#ea580c'],
    ['#1e1b4b', '#4338ca'],
    ['#134e4a', '#0d9488'],
    ['#44403c', '#78716c'],
    ['#312e81', '#6366f1']
];

/** Enterprise slot colors: primary blue, secondary slate, tertiary light gray. */
var DIST_BAR_SLOT_COLORS = ['#3b82f6', '#64748b', '#cbd5e1'];

/** Build a distribution bar from a {label→count} map (solid enterprise palette by rank). */
function buildDistBar(counts, colorMap) {
    var total = Object.keys(counts).reduce(function(s, k) { return s + counts[k]; }, 0);
    if (!total) {
        return '<div class="dist-bar-row"><div class="dist-bar" style="background:#e2e8f0;flex:1"></div>' +
               '<span class="dist-total-label">0</span></div>';
    }
    var keys = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; });
    var barHtml = keys.map(function(k, i) {
        var pct = Math.round(counts[k] / total * 100);
        if (!pct) return '';
        var bg;
        if (colorMap && colorMap[k]) {
            var pair = colorMap[k];
            bg = 'linear-gradient(135deg, ' + pair[0] + ' 0%, ' + pair[1] + ' 100%)';
        } else {
            var si = Math.min(i, DIST_BAR_SLOT_COLORS.length - 1);
            bg = DIST_BAR_SLOT_COLORS[si];
        }
        var showText = pct >= 15;
        var label = showText ? (k + ' ' + pct + '%') : '';
        var noLbl = showText ? '' : ' dist-segment--no-label';
        return '<div class="dist-segment' + noLbl + '" style="flex:' + pct + ';background:' + bg + '" title="' +
            escapeHtmlAttr(k + ': ' + pct + '%') + '">' + escapeHtmlAttr(label) + '</div>';
    }).join('');
    return '<div class="dist-bar-row"><div class="dist-bar">' + barHtml + '</div>' +
           '<span class="dist-total-label">100%</span></div>';
}

// OS_COLORS is kept as null — DIST_GRADIENTS handles OS names by key automatically.
var OS_COLORS = null;

/** Sessions drawer state: search filter, sort column, sort direction. */
var sessionsDrawerState = {
    searchQuery: '',
    sortColumn: null,
    sortDirection: 'asc',
    allSessions: [],
    filteredSessions: []
};

/** Returns the real geo label from geoLabelCache when available, or em-dash while pending / on failure. */
function resolveIpToCountry(ip) {
    if (ip == null || String(ip).trim() === '') return '\u2014';
    var k = String(ip).trim();
    if (Object.prototype.hasOwnProperty.call(geoLabelCache, k)) {
        return geoLabelCache[k] || '\u2014';
    }
    return '\u2014';
}

function sessionUserId(s) {
    if (!s || !s.user || typeof s.user !== 'object') return null;
    var id = s.user.id != null ? s.user.id : (s.user.userId != null ? s.user.userId : null);
    return id != null ? String(id) : null;
}

function auditRecordUserIdMatch(item, userIdStr) {
    if (!userIdStr) return false;
    if (item.user && item.user.id != null && String(item.user.id) === userIdStr) return true;
    var d = parseAuditDetails(item);
    if (!d) return false;
    if (d.userId != null && String(d.userId) === userIdStr) return true;
    if (d.user && typeof d.user === 'object' && d.user.id != null && String(d.user.id) === userIdStr) return true;
    return false;
}

/** Most recent Connect session created (type 96) for this user id, from loaded audits. */
function getLastAuthTime(userId) {
    if (!userId) return null;
    var arr = lastData.aud || [];
    var bestMs = -1;
    arr.forEach(function(item) {
        if (auditTypeToNum(item) !== AUDIT_TYPE_SESSION_CREATED) return;
        if (!auditRecordUserIdMatch(item, String(userId))) return;
        var ts = getAuditItemTs(item);
        if (ts == null) return;
        var ms = typeof ts === 'number' ? (ts > 1e11 ? ts : ts * 1000) : new Date(ts).getTime();
        if (isNaN(ms) || ms <= 0) return;
        if (ms > bestMs) bestMs = ms;
    });
    return bestMs < 0 ? null : new Date(bestMs);
}

/** Enhanced last auth lookup: matches by user ID, performedBy.name, or audit event user. */
function getLastAuthTimeForSession(s) {
    if (!s) return null;
    var arr = lastData.aud || [];
    var bestMs = -1;
    var bestItem = null;
    
    // Get session identifiers
    var uid = sessionUserId(s);
    var userName = s.user && s.user.name ? String(s.user.name).trim() : null;
    
    arr.forEach(function(item) {
        if (auditTypeToNum(item) !== AUDIT_TYPE_SESSION_CREATED) return;
        
        // Match by user ID first (most reliable)
        if (uid && item.user && item.user.id != null && String(item.user.id) === uid) {
            var ts = getAuditItemTs(item);
            if (ts != null) {
                var ms = typeof ts === 'number' ? (ts > 1e11 ? ts : ts * 1000) : new Date(ts).getTime();
                if (!isNaN(ms) && ms > 0 && ms > bestMs) {
                    bestMs = ms;
                    bestItem = item;
                }
            }
            return;
        }
        
        // Match by performedBy.name (common in audit events)
        if (userName && item.performedBy && item.performedBy.name === userName) {
            var ts = getAuditItemTs(item);
            if (ts != null) {
                var ms = typeof ts === 'number' ? (ts > 1e11 ? ts : ts * 1000) : new Date(ts).getTime();
                if (!isNaN(ms) && ms > 0 && ms > bestMs) {
                    bestMs = ms;
                    bestItem = item;
                }
            }
            return;
        }
        
        // Fallback: match by audit event user
        if (userName && auditEventUser(item) === userName) {
            var ts = getAuditItemTs(item);
            if (ts != null) {
                var ms = typeof ts === 'number' ? (ts > 1e11 ? ts : ts * 1000) : new Date(ts).getTime();
                if (!isNaN(ms) && ms > 0 && ms > bestMs) {
                    bestMs = ms;
                    bestItem = item;
                }
            }
        }
    });
    
    return bestMs < 0 ? null : new Date(bestMs);
}

function formatLastAuthDisplay(d) {
    if (!d || isNaN(d.getTime())) return '\u2014';
    try {
        return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch (e) {
        return '\u2014';
    }
}

/** Apply search filter to sessions based on user name, asset name, and country. */
function applySessionsDrawerSearch(sessions, query) {
    if (!query || !String(query).trim()) return sessions;
    var q = String(query).trim().toLowerCase();
    return sessions.filter(function(s) {
        var user = userName(s) || '';
        var asset = assetName(s) || '';
        var ip = s.currentPublicIp != null ? s.currentPublicIp : sessionPublicIp(s);
        var country = resolveIpToCountry(ip) || '';
        
        return user.toLowerCase().indexOf(q) !== -1 ||
               asset.toLowerCase().indexOf(q) !== -1 ||
               country.toLowerCase().indexOf(q) !== -1;
    });
}

/** Sort sessions by the specified column and direction. */
function sortSessionsByColumn(sessions, column, direction) {
    if (!column) return sessions;
    
    return sessions.slice().sort(function(a, b) {
        var aVal, bVal;
        
        switch (column) {
            case 'user':
                aVal = userName(a) || '';
                bVal = userName(b) || '';
                break;
            case 'country':
                var aIp = a.currentPublicIp != null ? a.currentPublicIp : sessionPublicIp(a);
                var bIp = b.currentPublicIp != null ? b.currentPublicIp : sessionPublicIp(b);
                aVal = resolveIpToCountry(aIp) || '';
                bVal = resolveIpToCountry(bIp) || '';
                break;
            case 'lastAuth':
                var aAuth = getLastAuthTimeForSession(a);
                var bAuth = getLastAuthTimeForSession(b);
                aVal = aAuth ? aAuth.getTime() : 0;
                bVal = bAuth ? bAuth.getTime() : 0;
                break;
            default:
                return 0;
        }
        
        var comparison;
        if (typeof aVal === 'number' && typeof bVal === 'number') {
            comparison = aVal - bVal;
        } else {
            comparison = String(aVal).localeCompare(String(bVal));
        }
        
        return direction === 'desc' ? -comparison : comparison;
    });
}

/** Update sort indicators in the header. */
function updateSortIndicators() {
    var headers = document.querySelectorAll('.sortable-header');
    headers.forEach(function(header) {
        var indicator = header.querySelector('.sort-indicator');
        var column = header.getAttribute('data-sort');
        
        header.classList.remove('active');
        if (indicator) indicator.textContent = '';
        
        if (column === sessionsDrawerState.sortColumn) {
            header.classList.add('active');
            if (indicator) {
                indicator.textContent = sessionsDrawerState.sortDirection === 'asc' ? '▲' : '▼';
            }
        }
    });
}

/** Render Big Numbers + distributions + session list; re-call after a filter change. */
function renderSessionsDrawerContent() {
    var allSessions = lastData.ses || [];
    sessionsDrawerState.allSessions = allSessions;

    // Apply category filter (active/offline/all)
    var categorySessions = sessionsDrawerFilter === 'all'
        ? allSessions
        : allSessions.filter(function(s) {
            var st = sessionDisplayState(s);
            return sessionsDrawerFilter === 'active' ? st === 'active' : st !== 'active';
          });

    // Apply search filter
    var searchFiltered = applySessionsDrawerSearch(categorySessions, sessionsDrawerState.searchQuery);
    
    // Apply sorting
    var sortedSessions = sortSessionsByColumn(searchFiltered, sessionsDrawerState.sortColumn, sessionsDrawerState.sortDirection);
    sessionsDrawerState.filteredSessions = sortedSessions;

    // ── Count buckets (from filtered sessions) ────────────────────────────
    var counts = { active: 0, offline: 0 };
    sortedSessions.forEach(function(s) {
        var st = sessionDisplayState(s);
        if (st === 'active') counts.active++;
        else counts.offline++;
    });

    // ── Two Big Number boxes ──────────────────────────────────────────────
    var statsEl = document.getElementById('sessions-drawer-stats');
    if (statsEl) {
        var defs = [
            { key: 'active',  num: counts.active,  numCls: 'green', label: 'Connected', tooltip: null },
            { key: 'offline', num: counts.offline, numCls: 'slate',  label: 'Offline',
              tooltip: 'User is Authenticated but not currently Connected.' }
        ];
        statsEl.innerHTML = defs.map(function(d) {
            var tip = d.tooltip
                ? '<span class="info-tooltip"><span class="info-icon">?</span>' +
                  '<span class="tooltip-text">' + escapeHtmlAttr(d.tooltip) + '</span></span>'
                : '';
            var isActive = sessionsDrawerFilter === d.key ? ' is-active' : '';
            return '<div class="ses-stat-box' + isActive + '" data-ses-filter="' + d.key + '">' +
                '<div class="ses-stat-num ' + d.numCls + '">' + d.num + '</div>' +
                '<div class="ses-stat-label">' + escapeHtmlAttr(d.label) + tip + '</div>' +
                '</div>';
        }).join('');
        Array.prototype.forEach.call(statsEl.querySelectorAll('.ses-stat-box'), function(box) {
            box.addEventListener('click', function() {
                var f = box.getAttribute('data-ses-filter');
                sessionsDrawerFilter = (sessionsDrawerFilter === f) ? 'all' : f;
                renderSessionsDrawerContent();
            });
        });
    }

    // ── Distribution bars (from filtered sessions) ────────────────────────
    var distEl = document.getElementById('sessions-drawer-distributions');
    if (distEl) {
        var osCounts = {};
        var verCounts = {};
        sortedSessions.forEach(function(s) {
            var os  = osMajorFamilyFromExactString(sessionAssetOperatingSystemExact(s));
            osCounts[os] = (osCounts[os] || 0) + 1;
            var ver = clientVer(s);
            var vk  = ver ? String(ver).trim() : 'Unknown';
            verCounts[vk] = (verCounts[vk] || 0) + 1;
        });
        // Collapse versions: keep top 2, lump rest as "Other"
        var verKeys = Object.keys(verCounts).sort(function(a, b) { return verCounts[b] - verCounts[a]; });
        var verCollapsed = {};
        verKeys.forEach(function(k, i) {
            if (i < 2) verCollapsed[k] = verCounts[k];
            else verCollapsed['Other'] = (verCollapsed['Other'] || 0) + verCounts[k];
        });
        distEl.innerHTML =
            '<div><div class="dist-row-label">Operating Systems</div>' + buildDistBar(osCounts, OS_COLORS) + '</div>' +
            '<div><div class="dist-row-label">Client Versions</div>'   + buildDistBar(verCollapsed, null) + '</div>';
    }

    // ── Session list ──────────────────────────────────────────────────────
    var listEl = document.getElementById('sessions-drawer-list');
    if (!listEl) return;

    if (!sortedSessions.length) {
        listEl.innerHTML = '<div class="ses-empty">No sessions match the current filters.</div>';
        listEl._znVisibleSessions = [];
        updateSortIndicators();
        return;
    }

    listEl.innerHTML = sortedSessions.map(function(s, i) {
        var user  = escapeHtmlAttr(userName(s)  || '\u2014');
        var asset = escapeHtmlAttr(assetName(s) || '\u2014');
        var ip    = s.currentPublicIp != null ? s.currentPublicIp : sessionPublicIp(s);
        var country = escapeHtmlAttr(resolveIpToCountry(ip));
        var lastAuth = escapeHtmlAttr(formatLastAuthDisplay(getLastAuthTimeForSession(s)));
        return '<div class="ses-row ses-row--sessions-drill cursor-pointer" data-ses-drawer-idx="' + i + '">' +
            '<div><div class="ses-row-name">' + user + '</div><div class="ses-row-sub">' + asset + '</div></div>' +
            '<div class="ses-row-asset">' + country + '</div>' +
            '<div class="ses-row-asset">' + lastAuth + '</div>' +
            '</div>';
    }).join('');
    listEl._znVisibleSessions = sortedSessions;
    updateSortIndicators();

    // Re-render once real geo labels arrive (Country column reads geoLabelCache).
    // Register once with geoQueueDrainCallbacks so we get a single re-render when
    // processSessionGeoIps finishes, rather than on every individual IP resolution.
    var hasUnresolvedGeo = sortedSessions.some(function(s) {
        var ip = s.currentPublicIp != null ? s.currentPublicIp : sessionPublicIp(s);
        if (ip == null || String(ip).trim() === '') return false;
        return !Object.prototype.hasOwnProperty.call(geoLabelCache, String(ip).trim());
    });
    if (hasUnresolvedGeo && (isGeoIpQueueRunning || isViewportCityGeoRunning)) {
        geoQueueDrainCallbacks.push(function() {
            var bd = document.getElementById('sessions-drawer-backdrop');
            if (bd && bd.classList.contains('is-open')) renderSessionsDrawerContent();
        });
    }
}

// Delegated click on the drawer list — wired once, reads _znVisibleSessions
(function wireDrawerListClicks() {
    function wireList(listId, onPick) {
        var listEl = document.getElementById(listId);
        if (!listEl) return;
        listEl.addEventListener('click', function(e) {
            var row = e.target.closest('.ses-row[data-ses-drawer-idx]');
            if (!row || !listEl.contains(row)) return;
            var idx = parseInt(row.getAttribute('data-ses-drawer-idx'), 10);
            var sessions = listEl._znVisibleSessions || [];
            var session = sessions[idx];
            if (!session) return;
            onPick(session);
        });
    }
    wireList('sessions-drawer-list', function(session) {
        var name = userName(session);
        if (!name || !String(name).trim()) return;
        closeSessionsDrawer();
        var input = document.getElementById('global-user-input');
        if (input) {
            input.value = String(name).trim();
            var clearBtn = document.getElementById('clear-user-search');
            if (clearBtn) clearBtn.classList.remove('hidden');
        }
        applyGlobalUserFilter(String(name).trim());
    });
    wireList('posture-drawer-list', function(session) {
        openSessionModal({ _sessionData: session });
    });
}());

// ── Posture KPI: strict flags from live API (active sessions only).
function postureKpiConnectAfterBootTrue(s) {
    var c = s.connectivityStateAfterReboot;
    return c === 1 || c === true;
}

function getSelectedDashboardUserName() {
    try {
        var v = typeof window !== 'undefined' ? window.selectedDashboardUser : null;
        if (v === undefined || v === null) return null;
        var t = String(v).trim();
        return t || null;
    } catch (e) {
        return null;
    }
}

function getSelectedDashboardRegionName() {
    try {
        var v = typeof window !== 'undefined' ? window.selectedDashboardRegion : null;
        if (v === undefined || v === null) return null;
        var t = String(v).trim();
        return t || null;
    } catch (e) {
        return null;
    }
}

/** All connection states: narrow to sessions where user.name matches the dashboard filter. */
function filterSessionsByDashboardUser(sessions) {
    var sel = getSelectedDashboardUserName();
    if (!sel) return sessions || [];
    return (sessions || []).filter(function(s) {
        return s && s.user && s.user.name === sel;
    });
}

/** All connection states: narrow to sessions where actualRegion.name matches the dashboard filter. */
function filterSessionsByDashboardRegion(sessions) {
    var sel = getSelectedDashboardRegionName();
    if (!sel) return sessions || [];
    return (sessions || []).filter(function(s) {
        return s && s.actualRegion && s.actualRegion.name === sel;
    });
}

/** Combined filter: apply both user and region filters. */
function filterSessionsByDashboardFilters(sessions) {
    var filtered = filterSessionsByDashboardUser(sessions);
    return filterSessionsByDashboardRegion(filtered);
}

/** Active bucket only; same strict user.name match as session list filter. */
function filterActiveSessionsForDashboardUser(activeSessions) {
    var sel = getSelectedDashboardUserName();
    if (!sel) return activeSessions || [];
    return (activeSessions || []).filter(function(s) {
        return s && s.user && s.user.name === sel;
    });
}

/** Active bucket only; apply both user and region filters. */
function filterActiveSessionsForDashboardFilters(activeSessions) {
    var filtered = filterActiveSessionsForDashboardUser(activeSessions);
    return filterSessionsByDashboardRegion(filtered);
}

/** Audits whose resolved event user (auditEventUser) matches the selected dashboard user. */
function filterAuditsByDashboardUser(audItems) {
    var sel = getSelectedDashboardUserName();
    if (!sel) return audItems || [];
    return (audItems || []).filter(function(item) {
        return auditEventUser(item) === sel;
    });
}

/** Audits whose resolved region name matches the selected dashboard region. */
function filterAuditsByDashboardRegion(audItems) {
    var sel = getSelectedDashboardRegionName();
    if (!sel) return audItems || [];
    return (audItems || []).filter(function(item) {
        var regionName = resolveRegionNameFromAudit(item);
        return regionName === sel;
    });
}

/** Combined audit filter: apply both user and region filters. */
function filterAuditsByDashboardFilters(audItems) {
    var filtered = filterAuditsByDashboardUser(audItems);
    return filterAuditsByDashboardRegion(filtered);
}

/** Session-related audits: end user from details.user (string or object); null if absent. */
function auditActivitySessionDetailsUser(item) {
    var d = parseAuditDetails(item);
    if (!d || d.user === undefined || d.user === null) return null;
    if (typeof d.user === 'string') {
        var ts = d.user.trim();
        return ts || null;
    }
    if (typeof d.user === 'object') {
        var nm = readName(d.user);
        return nm ? String(nm).trim() : null;
    }
    var s = String(d.user).trim();
    return s || null;
}

function auditActivityPerformedByName(item) {
    var pb = item.performedBy;
    if (!pb || typeof pb !== 'object' || pb.name == null) return null;
    var n = String(pb.name).trim();
    return n || null;
}

/**
 * Audit Activity chart: narrow the 30d pool by dashboard user.
 * connect + sessions: details.user only. policy: performedBy.name. region_health: no filter.
 */
function filterAuditsForActivityChartScope(poolItems, mode) {
    var pool = poolItems || [];
    
    // Apply dashboard region and user filters (same as other widgets)
    if (mode !== 'region_health') {
        pool = filterAuditsByDashboardFilters(pool);
    }
    
    return pool;
}

/** Audit Operations widget: details.user or performedBy.name matches selection. */
function auditOperationMatchesDashboardUser(item, sel) {
    if (!sel) return true;
    var du = auditActivitySessionDetailsUser(item);
    if (du === sel) return true;
    var pn = auditActivityPerformedByName(item);
    return pn === sel;
}

/** Period slice + dashboard user filter for Audit Operations counts and drill-down modal. */
function filterAuditOperationsListSource(audItems, period) {
    var usePeriod = period || activePeriod;
    var items = filterByPeriod(audItems || [], usePeriod);
    var sel = getSelectedDashboardUserName();
    if (sel) {
        items = items.filter(function(a) { return auditOperationMatchesDashboardUser(a, sel); });
    }
    return items;
}

// Refresh cached split + Overall Sessions KPI from the master session list.
function applySessionKpisFromMasterList(sessions) {
    var list = Array.isArray(sessions) ? sessions : (Array.isArray(lastData.ses) ? lastData.ses : []);
    var split = splitSessionsByLiveState(list);
    lastData.activeSessions = split.active;
    lastData.offlineSessions = split.offline;
    var filteredActive = filterActiveSessionsForDashboardFilters(split.active);
    var filteredOffline = filterSessionsByDashboardFilters(split.offline);
    var a = filteredActive.length;
    var o = filteredOffline.length;
    var elA = document.getElementById('kpi-active-count');
    var elO = document.getElementById('kpi-offline-count');
    if (elA) elA.textContent = String(a);
    if (elO) elO.textContent = String(o);
    document.getElementById('trend-active').textContent = '';

    var alwaysOnCount = 0;
    var afterBootCount = 0;
    filteredActive.forEach(function(s) {
        if (s.alwaysOn === true) alwaysOnCount++;
        if (postureKpiConnectAfterBootTrue(s)) afterBootCount++;
    });
    var kpiAo = document.getElementById('kpi-posture-always-on');
    var kpiCab = document.getElementById('kpi-posture-connect-after-boot');
    if (kpiAo) kpiAo.textContent = String(alwaysOnCount);
    if (kpiCab) kpiCab.textContent = String(afterBootCount);
}

// ── 1. Audit Activity — multi-mode chart (30d pool, window = dauChartRangeDays) ─
function renderActivityExplorerChart(allItems, period) {
    void period;
    var poolItems = filterByPeriod(allItems || [], '30d');
    var mode = activityChartMode || 'connect';
    if (mode !== 'connect' && mode !== 'sessions' && mode !== 'region_health' && mode !== 'policy') {
        activityChartMode = 'connect';
        mode = 'connect';
    }
    poolItems = filterAuditsForActivityChartScope(poolItems, mode);
    var nChart = (typeof dauChartRangeDays === 'number' && dauChartRangeDays >= 1)
        ? Math.min(30, Math.floor(dauChartRangeDays))
        : 7;
    var timeBuckets = buildLastNDayBuckets(nChart);
    var newLabels = timeBuckets.map(function(b) { return b.label; });

    console.log('[ZN] Audit Activity: mode=' + mode + ', days=' + nChart +
        ', pool rows=' + poolItems.length + ', buckets=' + timeBuckets.length);

    var canvasEl = document.getElementById('auditChart');
    if (!canvasEl) return;

    var borderPal = ['#00b894', '#6c5ce7', '#fdcb6e', '#0984e3', '#e17055', '#a29bfe', '#00cec9', '#fd79a8', '#fab1a0', '#74b9ff'];

    if (auditChartInstance) {
        try { auditChartInstance.destroy(); } catch (e) { /* noop */ }
        auditChartInstance = null;
    }
    auditChartDrillContext = null;
    znAuditActivityConnectDailyInsights = null;
    znAuditActivityPolicyDailyInsights = null;
    var znRttHide = document.getElementById('chartjs-rich-tooltip');
    if (znRttHide) {
        znRttHide.classList.remove('is-hovered');
        znRttHide.classList.remove('is-pinned');
        znRttHide.style.opacity = '0';
        znRttHide.style.visibility = 'hidden';
    }
    closeChartDetailPopover();

    var chartType = 'line';
    var datasets = [];
    var chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { display: false },
            title: { display: false },
            tooltip: {
                callbacks: {
                    label: function(ctx) {
                        var v = ctx.parsed && ctx.parsed.y !== undefined ? ctx.parsed.y : ctx.raw;
                        return ' ' + (ctx.dataset && ctx.dataset.label ? ctx.dataset.label : '') + ': ' + v;
                    }
                }
            }
        },
        scales: {
            x: {
                stacked: false,
                grid: { display: false },
                ticks: { font: { size: 10 } }
            },
            y: {
                stacked: false,
                beginAtZero: true,
                ticks: { precision: 0, font: { size: 10 } },
                title: { display: true, text: 'Count', color: '#94a3b8', font: { size: 10 } },
                grid: { color: 'rgba(0,0,0,0.04)' }
            }
        }
    };

    if (mode === 'connect') {
        chartType = 'line';
        var userKeyToRegion = buildUserKeyToMostRecentRegionFromAudits(poolItems, '30d');
        var perBucket = countUniqueUsers969798PerBucketByRegion(poolItems, timeBuckets, userKeyToRegion);
        var regionSet = Object.create(null);
        perBucket.forEach(function(byReg) {
            Object.keys(byReg).forEach(function(r) {
                if (isValidDauRegionLabel(r)) regionSet[r] = true;
            });
        });
        var regionsSorted = Object.keys(regionSet).filter(isValidDauRegionLabel).sort();

        if (regionsSorted.length === 0) {
            datasets = [{
                label: 'Unique users',
                data: perBucket.map(function(byReg) {
                    var t = 0;
                    Object.keys(byReg).forEach(function(k) { t += byReg[k]; });
                    return t;
                }),
                borderColor: '#00df9a',
                backgroundColor: 'rgba(0,223,154,0.12)',
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 4,
                borderWidth: 2
            }];
        } else {
            datasets = regionsSorted.map(function(reg, i) {
                var hex = borderPal[i % borderPal.length];
                return {
                    label: reg,
                    data: perBucket.map(function(byReg) { return byReg[reg] || 0; }),
                    borderColor: hex,
                    backgroundColor: hexToRgba(hex, 0.12),
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    borderWidth: 2
                };
            });
        }
        chartOptions.scales.x.stacked = false;
        chartOptions.scales.y.stacked = false;
        if (chartOptions.scales.y.title) chartOptions.scales.y.title.text = 'Unique users';

        znAuditActivityConnectDailyInsights = buildConnectModeDailyInsightsFromType96(poolItems, timeBuckets);
        enrichConnectDailyInsightsUserLocations(znAuditActivityConnectDailyInsights).catch(function(e) {
            console.warn('[ZN] User location enrich failed:', e && e.message ? e.message : e);
        });
        chartOptions.plugins.tooltip = {
            enabled: false,
            external: customRichTooltip
        };
    } else if (mode === 'sessions') {
        chartType = 'bar';
        var sessTypes = [
            { label: 'Expired', type: 97 },
            { label: 'Revoked', type: 98 },
            { label: 'Logout', type: 99 },
            { label: 'Extended', type: 123 }
        ];
        datasets = sessTypes.map(function(st, i) {
            var hex = borderPal[i % borderPal.length];
            return {
                label: st.label,
                data: timeBuckets.map(function(b) {
                    return countAuditTypeInBucketRange(poolItems, st.type, b.startMs, b.endMs);
                }),
                backgroundColor: hexToRgba(hex, 0.72),
                borderColor: hex,
                borderWidth: 1
            };
        });
        chartOptions.scales.x.stacked = false;
        chartOptions.scales.y.stacked = false;
        if (chartOptions.scales.y.title) chartOptions.scales.y.title.text = 'Events';
    } else if (mode === 'region_health') {
        chartType = 'bar';
        datasets = [
            {
                label: 'Region down',
                data: timeBuckets.map(function(b) {
                    return countAuditTypeInBucketRange(poolItems, 351, b.startMs, b.endMs);
                }),
                backgroundColor: 'rgba(239,68,68,0.72)',
                borderColor: '#ef4444',
                borderWidth: 1
            },
            {
                label: 'Region recovered',
                data: timeBuckets.map(function(b) {
                    return countAuditTypeInBucketRange(poolItems, 352, b.startMs, b.endMs);
                }),
                backgroundColor: 'rgba(0,223,154,0.7)',
                borderColor: '#00a876',
                borderWidth: 1
            }
        ];
        chartOptions.scales.x.stacked = false;
        chartOptions.scales.y.stacked = false;
        if (chartOptions.scales.y.title) chartOptions.scales.y.title.text = 'Events';
    } else if (mode === 'policy') {
        chartType = 'bar';
        datasets = [
            {
                label: 'Policy created',
                data: timeBuckets.map(function(b) {
                    return countAuditTypeInBucketRange(poolItems, 100, b.startMs, b.endMs);
                }),
                backgroundColor: 'rgba(99,102,241,0.78)',
                borderColor: '#6366f1',
                borderWidth: 1
            },
            {
                label: 'Policy edited',
                data: timeBuckets.map(function(b) {
                    return countAuditTypeInBucketRange(poolItems, 101, b.startMs, b.endMs);
                }),
                backgroundColor: 'rgba(14,165,233,0.72)',
                borderColor: '#0ea5e9',
                borderWidth: 1
            },
            {
                label: 'Policy deleted',
                data: timeBuckets.map(function(b) {
                    return countAuditTypeInBucketRange(poolItems, 102, b.startMs, b.endMs);
                }),
                backgroundColor: 'rgba(244,63,94,0.68)',
                borderColor: '#f43f5e',
                borderWidth: 1
            }
        ];
        chartOptions.scales.x.stacked = false;
        chartOptions.scales.y.stacked = false;
        if (chartOptions.scales.y.title) chartOptions.scales.y.title.text = 'Events';

        znAuditActivityPolicyDailyInsights = buildPolicyModeDailyInsightsFrom100101102(poolItems, timeBuckets);
        chartOptions.plugins.tooltip = {
            enabled: false,
            external: customRichTooltip
        };
    }

    if (chartType === 'bar') {
        auditChartDrillContext = { mode: mode, timeBuckets: timeBuckets, poolItems: poolItems };
        chartOptions.onClick = function(evt, elements, chart) {
            if (!elements || !elements.length) return;
            var ctxClick = auditChartDrillContext;
            if (!ctxClick || ctxClick.mode === 'connect') return;
            var hit = elements[0];
            var dsIdx = hit.datasetIndex;
            var dataIdx = hit.index;
            var bucket = ctxClick.timeBuckets[dataIdx];
            var dayLab = chart.data.labels[dataIdx] != null ? String(chart.data.labels[dataIdx]) : String(dataIdx);
            if (ctxClick.mode === 'policy') {
                var dayEvents = [];
                [100, 101, 102].forEach(function(tid) {
                    dayEvents = dayEvents.concat(filterAuditsForActivityBarSegment(ctxClick.poolItems, tid, bucket));
                });
                openPolicyDrawer(dayLab, dayEvents);
                return;
            }
            var typeId = auditActivityBarTypeId(ctxClick.mode, dsIdx);
            var matched = filterAuditsForActivityBarSegment(ctxClick.poolItems, typeId, bucket);
            var ds = chart.data.datasets[dsIdx];
            var typeLab = ds && ds.label != null ? String(ds.label) : String(typeId);
            openJsonInspector('Audit Activity: ' + typeLab + ' on ' + dayLab, matched);
        };
    } else {
        delete chartOptions.onClick;
    }

    var ctx = canvasEl.getContext('2d');
    auditChartInstance = new Chart(ctx, {
        type: chartType,
        data: { labels: newLabels, datasets: datasets },
        options: chartOptions,
        plugins: [{
            id: 'znDauLegendSync',
            afterUpdate: function(chart) {
                syncDauChartHtmlLegend(chart);
            }
        }]
    });
    syncDauChartHtmlLegend(auditChartInstance);
    syncActivityChartControlUi();
}

function renderAuditChart(allItems, period) {
    renderActivityExplorerChart(allItems, period);
}

// ── 2. OS Distribution — accordion by major family; versions from asset.operatingSystem (active sessions) ─
function renderOsAccordion(activeSessions) {
    try {
        var el = document.getElementById('card-os-accordion');
        if (!el) return;

        var sessions = activeSessions || [];
        var families = Object.create(null);
        var grandTotal = 0;

        sessions.forEach(function(s) {
            var exact = sessionAssetOperatingSystemExact(s);
            if (!exact) return;
            grandTotal++;
            var fam = osMajorFamilyFromExactString(exact);
            if (!families[fam]) families[fam] = { total: 0, versions: Object.create(null) };
            families[fam].total++;
            families[fam].versions[exact] = (families[fam].versions[exact] || 0) + 1;
        });

        if (grandTotal === 0) {
            el.innerHTML = '<div class="metric-placeholder" style="padding:12px 4px">No asset.operatingSystem on active sessions.</div>';
            return;
        }

        var famKeys = Object.keys(families).sort(function(a, b) {
            return families[b].total - families[a].total;
        });

        // Render simple clickable rows instead of accordion
        el.innerHTML = famKeys.map(function(fam) {
            var pack = families[fam];
            var pctL1 = Math.round(pack.total / grandTotal * 100);
            var escFam = escapeHtmlAttr(fam);
            var max = families[famKeys[0]].total; // Get max for bar width calculation
            var pctBar = Math.round(pack.total / max * 100);
            
            return '<div class="metric-row os-family-row cursor-pointer" data-os-family="' + escFam + '">' +
                '<span class="metric-label">' + escFam + '</span>' +
                '<div class="metric-bar-wrap"><div class="metric-bar" style="width:' + pctBar + '%"></div></div>' +
                '<span class="metric-count">' + pack.total +
                ' <span style="color:#94a3b8;font-weight:500">(' + pctL1 + '%)</span></span></div>';
        }).join('');
    } finally {
        var osL = document.getElementById('os-chart-loading');
        if (osL) osL.classList.remove('is-active');
    }
}

// ── Bearing (degrees, 0 = North, clockwise) between two [lat,lng] points ──
function calcBearing(from, to) {
    var lat1 = from[0] * Math.PI / 180;
    var lat2 = to[0]  * Math.PI / 180;
    var dLng = (to[1] - from[1]) * Math.PI / 180;
    var y = Math.sin(dLng) * Math.cos(lat2);
    var x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/**
 * Debounced fitBounds — waits 500 ms of inactivity before panning the camera.
 * This prevents the map from jerking on every individual marker that pops in
 * via updateMapProgressively(); instead the viewport settles once after a burst.
 */
function debouncedFitBounds() {
    if (mapBoundsFitTimer) clearTimeout(mapBoundsFitTimer);
    mapBoundsFitTimer = setTimeout(function() {
        mapBoundsFitTimer = null;
        if (!leafletMap || !mapBounds || !mapBounds.isValid()) return;
        try {
            leafletMap.fitBounds(mapBounds, { padding: [50, 50], maxZoom: 5 });
        } catch (e) {
            console.warn('[ZN Map] debouncedFitBounds failed:', e.message);
        }
    }, 500);
}

// ── 3. Leaflet map (Servers / Users / Both, user clustering) ──────────────
function renderMap(sessions) {
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
        iconUrl: 'libs/images/marker-icon.png',
        iconRetinaUrl: 'libs/images/marker-icon-2x.png',
        shadowUrl: 'libs/images/marker-shadow.png'
    });

    // ── Init map once ────────────────────────────────────────────────────
    if (!leafletMap) {
        var initCenter = [20, 0];
        var initZoom = 2;
        try {
            var rawV = localStorage.getItem(ZN_MAP_VIEW_LS);
            if (rawV) {
                var parsed = JSON.parse(rawV);
                if (parsed && typeof parsed.lat === 'number' && typeof parsed.lng === 'number' &&
                    typeof parsed.z === 'number' && znIsValidLatLng(parsed.lat, parsed.lng)) {
                    initCenter = [parsed.lat, parsed.lng];
                    initZoom = parsed.z;
                }
            }
        } catch (e0) { /* ignore */ }

        leafletMap = L.map('map', {
            zoomControl: true,
            scrollWheelZoom: true,
            minZoom: 2,
            worldCopyJump: false
        }).setView(initCenter, initZoom);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap &copy; CARTO',
            subdomains: 'abcd', maxZoom: 19, crossOrigin: true
        }).addTo(leafletMap);
        var mapEl = document.getElementById('map');
        if (mapEl && typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(function() { if (leafletMap) leafletMap.invalidateSize(); }).observe(mapEl);
        }
        // After the new side-by-side layout is painted, force Leaflet to
        // recalculate tile coverage for the taller, narrower container.
        setTimeout(function() { if (leafletMap) leafletMap.invalidateSize(); }, 100);
        leafletMap.getContainer().addEventListener('wheel', function(e) {
            e.preventDefault();
        }, { passive: false });

        if (typeof L.markerClusterGroup !== 'function') {
            console.warn('[ZN Map] leaflet.markercluster not loaded — user markers will not cluster.');
        }

        leafletMap.on('moveend', function() {
            if (!leafletMap) return;
            if (mapMoveSaveTimer) clearTimeout(mapMoveSaveTimer);
            mapMoveSaveTimer = setTimeout(function() {
                try {
                    var c = leafletMap.getCenter();
                    var z = leafletMap.getZoom();
                    if (!znIsValidLatLng(c.lat, c.lng)) return;
                    localStorage.setItem(ZN_MAP_VIEW_LS, JSON.stringify({
                        lat: c.lat, lng: c.lng, z: z
                    }));
                } catch (e1) { /* ignore */ }
                znScheduleViewportCityGeo(420);
            }, 400);
        });
        leafletMap.on('zoomend', function() {
            znScheduleViewportCityGeo(320);
        });
    }

    // ── Clear previous layers + reset bounds state ───────────────────────
    if (mapUserClusterGroup && leafletMap) {
        leafletMap.removeLayer(mapUserClusterGroup);
        mapUserClusterGroup = null;
    }
    regionMarkers.forEach(function(m) { try { m.remove(); } catch (e) {} });
    mapPolylines.forEach(function(p) { try { p.remove(); } catch (e) {} });
    regionMarkers = [];
    mapUserMarkers = [];
    mapPolylines = [];
    mapBounds     = L.latLngBounds();  // fresh bounds for this render pass
    mapServerCoord = {};               // repopulated below for 'both' mode

    var activeSessions = sessions.filter(function(s) { return sessionState(s) === 'active'; });
    znMergeCountryGeoSeedForSessions(sessions);

    var userDotIcon = L.divIcon({
        className: 'zn-map-user-dot',
        html: '<div style="width:14px;height:14px;border-radius:50%;background:#00df9a;' +
            'border:2px solid #059669;box-sizing:border-box"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7]
    });

    // ── Server markers (blue) ─────────────────────────────────────────────
    var serverData  = {};
    var serverCoord = {};
    activeSessions.forEach(function(s) {
        var rn = regionName(s);
        if (!rn) return;
        serverData[rn] = (serverData[rn] || 0) + 1;
    });

    var allBounds = [];

    if (mapMode === 'servers' || mapMode === 'both') {
        Object.keys(serverData).forEach(function(rn) {
            var coords = regionCoords(rn);
            if (!coords || !znIsValidLatLng(coords[0], coords[1])) return;
            serverCoord[rn]   = coords;
            mapServerCoord[rn] = coords; // expose for updateMapProgressively
            allBounds.push(coords);
            mapBounds.extend(coords);
            var count = serverData[rn];
            var m = L.circleMarker(coords, {
                radius: Math.max(8, Math.min(22, 6 + count * 0.5)),
                fillColor: '#3b82f6', color: '#1d4ed8',
                weight: 2, opacity: 1, fillOpacity: 0.75
            }).addTo(leafletMap);
            (function(regionLabel) {
                m.on('click', function() {
                    var regionSessions = activeSessions.filter(function(s) {
                        return regionName(s) === regionLabel;
                    });
                    openConnectivityModalServer(regionLabel, regionSessions);
                });
            }(rn));
            regionMarkers.push(m);
        });
    }

    // ── User markers (green, GeoIP) + MarkerClusterGroup ─────────────────
    if (mapMode === 'users' || mapMode === 'both') {
        if (typeof L.markerClusterGroup === 'function') {
            mapUserClusterGroup = L.markerClusterGroup({
                maxClusterRadius: 20,
                spiderfyOnMaxZoom: false,
                showCoverageOnHover: false,
                zoomToBoundsOnClick: false,
                iconCreateFunction: function(cluster) {
                    var children = cluster.getAllChildMarkers();
                    var blueCount = 0;
                    var greenCount = 0;
                    children.forEach(function(m) {
                        var arr = m._znSessions || [];
                        if (arr.length === 0) {
                            greenCount++;
                            return;
                        }
                        arr.forEach(function(s) {
                            var rn = regionName(s);
                            if (rn && regionCoords(rn)) blueCount++;
                            else greenCount++;
                        });
                    });
                    var totalMix = blueCount + greenCount;
                    var gradient;
                    if (totalMix === 0) {
                        gradient = 'conic-gradient(#00df9a 0deg 360deg)';
                    } else {
                        var frac = blueCount / totalMix;
                        if (frac <= 0) {
                            gradient = 'conic-gradient(#00df9a 0deg 360deg)';
                        } else if (frac >= 1) {
                            gradient = 'conic-gradient(#3b82f6 0deg 360deg)';
                        } else {
                            var deg = frac * 360;
                            gradient = 'conic-gradient(from 0deg, #3b82f6 0deg, #3b82f6 ' + deg + 'deg, #00df9a ' + deg + 'deg, #00df9a 360deg)';
                        }
                    }
                    var markerCount = cluster.getChildCount();
                    var html = '<div class="zn-map-cluster-donut" style="background:' + gradient + '">' +
                        '<div class="zn-map-cluster-hole">' +
                        '<span class="zn-map-cluster-count">' + markerCount + '</span>' +
                        '</div></div>';
                    return L.divIcon({
                        html: html,
                        className: 'zn-map-cluster-icon',
                        iconSize: [44, 44],
                        iconAnchor: [22, 22]
                    });
                }
            });
            mapUserClusterGroup.on('clusterclick', function(e) {
                var markers = e.layer.getAllChildMarkers();
                var sess = [];
                for (var ci = 0; ci < markers.length; ci++) {
                    var arr = markers[ci]._znSessions;
                    if (arr) {
                        for (var cj = 0; cj < arr.length; cj++) sess.push(arr[cj]);
                    }
                }
                openConnectivityModalGeo(sess, { cluster: true });
            });
            mapUserClusterGroup.addTo(leafletMap);
        }

        var ipMap = {};
        activeSessions.forEach(function(s) {
            var ip = sessionPublicIp(s);
            if (!ip) return;
            if (!ipMap[ip]) ipMap[ip] = [];
            ipMap[ip].push(s);
        });

        var ipList = Object.keys(ipMap);
        if (ipList.length === 0 && activeSessions.length > 0) {
            console.debug('[ZN Map] No public IPs on active sessions (currentPublicIp / publicIp / srcIp / externalIp).');
        }

        // Render markers only for IPs already in geoIpCache (seeded from Zero + centroids).
        // City-level refinement uses throttled public GeoIP only for viewport-visible IPs
        // when zoomed in (see znScheduleViewportCityGeo / processSessionGeoIps).
        for (var i = 0; i < ipList.length; i++) {
            var ip = ipList[i];
            if (!geoIpCache.has(ip)) continue; // not yet resolved; queue handles it

            var coords = geoIpCache.get(ip);
            if (!coords || !znIsValidLatLng(coords[0], coords[1])) continue;

            var plotCoords = jitterMarkerCoordsForIp(ip, coords[0], coords[1]);
            if (!znIsValidLatLng(plotCoords[0], plotCoords[1])) {
                console.warn('[ZN Map] invalid plot coords for IP:', ip, '— skip marker');
                continue;
            }
            allBounds.push(plotCoords);
            mapBounds.extend(plotCoords);
            var sessList = ipMap[ip];
            var s = sessList[0];

            var userMarker = L.marker(plotCoords, { icon: userDotIcon });
            userMarker._znSessions = sessList;
            userMarker._znIp = ip; // used by updateMapProgressively duplicate-check
            (function(sessionsAtMarker) {
                userMarker.on('click', function() {
                    openConnectivityModalGeo(sessionsAtMarker, { cluster: false });
                });
            }(sessList));

            if (mapUserClusterGroup) {
                mapUserClusterGroup.addLayer(userMarker);
            } else {
                userMarker.addTo(leafletMap);
            }
            mapUserMarkers.push(userMarker);

            if (mapMode === 'both') {
                var rn = regionName(s);
                var sc = rn ? serverCoord[rn] : null;
                if (sc) {
                    var line = L.polyline([plotCoords, sc], {
                        color: '#94a3b8', weight: 1.5, opacity: 0.55, dashArray: '5 6'
                    }).addTo(leafletMap);
                    mapPolylines.push(line);

                    var mid = [(plotCoords[0] + sc[0]) / 2, (plotCoords[1] + sc[1]) / 2];
                    var angle = Math.atan2(
                        -(sc[0] - plotCoords[0]),
                        sc[1] - plotCoords[1]
                    ) * (180 / Math.PI);
                    var arrowIcon = L.divIcon({
                        className: 'zn-map-arrow',
                        html: '<div style="transform:rotate(' + angle + 'deg);' +
                            'width:18px;height:18px;display:flex;' +
                            'align-items:center;justify-content:center;">' +
                            '<svg viewBox="0 0 12 12" width="12" height="12" fill="#00df9a">' +
                            '<polygon points="0,2 8,6 0,10 3,6"/>' +
                            '</svg></div>',
                        iconSize: [18, 18],
                        iconAnchor: [9, 9]
                    });
                    var arrowMark = L.marker(mid, { icon: arrowIcon, interactive: false })
                        .addTo(leafletMap);
                    mapPolylines.push(arrowMark);
                }
            }
        }

    }

    // Camera: debounced so it doesn't thrash as markers pop in via updateMapProgressively.
    debouncedFitBounds();

    setTimeout(function() { if (leafletMap) leafletMap.invalidateSize(); }, 300);
    setTimeout(function() { if (leafletMap) leafletMap.invalidateSize(); }, 900);
}

function recenterConnectivityMap() {
    if (!leafletMap) return;
    try { localStorage.removeItem(ZN_MAP_VIEW_LS); } catch (e) { /* ignore */ }
    if (mapBoundsFitTimer) {
        clearTimeout(mapBoundsFitTimer);
        mapBoundsFitTimer = null;
    }
    if (lastData && lastData.ses) {
        try {
            renderMap(filterSessionsByDashboardFilters(lastData.ses));
        } catch (e0) {
            console.warn('[ZN Map] renderMap on recenter failed:', e0);
        }
    }
    znGeoRetryFailedForFilteredSessions();
    if (mapBounds && mapBounds.isValid()) {
        try {
            leafletMap.fitBounds(mapBounds, { padding: [50, 50], animate: true, maxZoom: 5 });
            return;
        } catch (e2) {
            console.warn('[ZN Map] Recenter fitBounds failed:', e2 && e2.message ? e2.message : e2);
        }
    }
    leafletMap.setView(ZN_MAP_DEFAULT_LATLNG, ZN_MAP_DEFAULT_ZOOM, { animate: true });
}

// Region label from details.connectServer (string or { name }).
function connectServerRegionLabel(d) {
    if (!d || d.connectServer === undefined || d.connectServer === null) return null;
    var r = d.connectServer;
    if (typeof r === 'string') {
        var t = r.trim();
        return t ? t : null;
    }
    if (r && typeof r === 'object' && typeof r.name === 'string') {
        var n = r.name.trim();
        return n || null;
    }
    return null;
}

// Strict JSON.parse for audit.details (string or object) — avoids silent parse failures on Region Load.
function parseAuditDetailsJsonLoose(item) {
    if (!item || item.details === undefined || item.details === null || item.details === '') return null;
    try {
        if (typeof item.details === 'object') return item.details;
        return JSON.parse(item.details);
    } catch (e) {
        return null;
    }
}

function normRegionKey(s) {
    return String(s).trim().toLowerCase();
}

function connectServerFromAuditDetailsStrict(item) {
    return connectServerRegionLabel(parseAuditDetailsJsonLoose(item));
}

var AUDIT_TYPE_REGION_DOWN      = 351;
var AUDIT_TYPE_REGION_RECOVERED = 352;

function primaryRegionKeyFromHealthAudit(item) {
    if (item.actualRegion && item.actualRegion.name != null) {
        var an = String(item.actualRegion.name).trim();
        if (an) return normRegionKey(an);
    }
    var d = parseAuditDetailsJsonLoose(item);
    if (!d) return null;
    var r = connectServerRegionLabel(d);
    if (r) return normRegionKey(r);
    if (d.region != null) {
        var rs = typeof d.region === 'string' ? d.region : (d.region && d.region.name);
        rs = rs != null ? String(rs).trim() : '';
        if (rs) return normRegionKey(rs);
    }
    return null;
}

// KPI: unique connectServer from session audits (96, 97, 98, 99, 123); health from newest 351/352 per region key.
function renderRegionHealthKpi(audItems) {
    var kpiEl = document.getElementById('regions-kpi');
    var subEl = document.getElementById('regions-subtext');
    if (!kpiEl || !subEl) return;

    var arr = audItems || [];
    var regionDisplayByNorm = Object.create(null);
    arr.forEach(function(item) {
        if (!auditTypeMayHaveConnectServerRegion(item)) return;
        var arNm = item.actualRegion && item.actualRegion.name != null ? String(item.actualRegion.name).trim() : '';
        var label = arNm || connectServerFromAuditDetailsStrict(item);
        if (!label) return;
        var nk = normRegionKey(label);
        if (!regionDisplayByNorm[nk]) regionDisplayByNorm[nk] = label;
    });
    var regionNormKeys = Object.keys(regionDisplayByNorm);
    var totalRegions = regionNormKeys.length;

    var healthAudits = arr.filter(function(it) {
        var n = auditTypeToNum(it);
        return n === AUDIT_TYPE_REGION_DOWN || n === AUDIT_TYPE_REGION_RECOVERED;
    });
    lastData.regionHealthEvents = healthAudits.slice();

    healthAudits.sort(function(a, b) {
        var ta = getAuditItemTs(a);
        var tb = getAuditItemTs(b);
        ta = ta == null ? 0 : ta;
        tb = tb == null ? 0 : tb;
        return tb - ta;
    });

    var latestStateByNorm = Object.create(null);
    healthAudits.forEach(function(it) {
        var nk = primaryRegionKeyFromHealthAudit(it);
        if (!nk) return;
        if (latestStateByNorm[nk] !== undefined) return;
        latestStateByNorm[nk] = auditTypeToNum(it) === AUDIT_TYPE_REGION_DOWN ? 'down' : 'up';
    });

    var downAmongKnown = 0;
    regionNormKeys.forEach(function(nk) {
        if (latestStateByNorm[nk] === 'down') downAmongKnown++;
    });
    var upRegions = totalRegions - downAmongKnown;

    kpiEl.className = 'kpi-value';
    if (totalRegions === 0) {
        kpiEl.textContent = '\u2014';
        kpiEl.classList.add('amber');
        subEl.textContent = 'No regions found (connectServer on session events 96–99, 123).';
        return;
    }

    kpiEl.textContent = upRegions + ' / ' + totalRegions;
    if (downAmongKnown === 0) {
        kpiEl.classList.add('green');
        subEl.textContent = 'All regions operational.';
    } else {
        kpiEl.classList.add(downAmongKnown >= totalRegions ? 'red' : 'amber');
        subEl.textContent = 'Warning: 1 or more regions degraded.';
    }

    // Persist computed stats for the Region Health drawer
    lastData.regionStats = {
        total:       totalRegions,
        healthy:     upRegions,
        degraded:    downAmongKnown,
        byNorm:      regionDisplayByNorm,
        stateByNorm: latestStateByNorm
    };
}

// ── 4a. Client Versions — live active sessions; unique users per clientVersion ─
function sessionUserLabelForPosture(s) {
    if (s && s.user && s.user.name) {
        var n = String(s.user.name).trim();
        if (n) return n;
    }
    var u = userName(s);
    return u && String(u).trim() ? String(u).trim() : 'Active session (unlabeled)';
}

function renderVersionsCardFromSessions(activeSessions) {
    var el = document.getElementById('card-versions');
    if (!el) return;

    var userToVers = Object.create(null);
    (activeSessions || []).forEach(function(session) {
        var ver = clientVer(session);
        if (!ver) return;
        ver = String(ver).trim().replace(/^v/i, '');
        if (!ver) return;
        var u = sessionUserLabelForPosture(session);
        if (!userToVers[u]) userToVers[u] = Object.create(null);
        userToVers[u][ver] = true;
    });

    var verUserCount = Object.create(null);
    Object.keys(userToVers).forEach(function(u) {
        Object.keys(userToVers[u]).forEach(function(v) {
            verUserCount[v] = (verUserCount[v] || 0) + 1;
        });
    });

    var sorted = Object.keys(verUserCount).sort(function(a, b) { return verUserCount[b] - verUserCount[a]; }).slice(0, 5);
    if (sorted.length === 0) {
        el.innerHTML = '<div class="metric-placeholder">No client version on active sessions.</div>';
        return;
    }
    var grandTotal = Object.keys(verUserCount).reduce(function(s, v) { return s + verUserCount[v]; }, 0) || 1;
    var max = verUserCount[sorted[0]];
    el.innerHTML = sorted.map(function(v) {
        var count = verUserCount[v];
        var pctBar = Math.round(count / max * 100);
        var pctTot = Math.round(count / grandTotal * 100);
        var legacy = parseInt(String(v).split('.')[0], 10) < 4;
        return '<div class="metric-row json-inspect-row" data-json-client-ver="' + escapeHtmlAttr(v) + '">' +
            '<span class="metric-label' + (legacy ? ' amber-text' : '') + '">v' + escapeHtmlAttr(v) + '</span>' +
            '<div class="metric-bar-wrap"><div class="metric-bar' + (legacy ? ' amber' : '') + '" style="width:' + pctBar + '%"></div></div>' +
            '<span class="metric-count">' + count +
            ' <span style="color:#94a3b8;font-weight:500">(' + pctTot + '%)</span></span></div>';
    }).join('');
}

// ── 4b. Region Load — session end events 97–99; connectServer from JSON.parse(details) ─
function renderRegionCard(audItems, period) {
    var el = document.getElementById('card-regions');
    if (!el) return;

    let regionCounts = {};
    el.innerHTML = '';

    var usePeriod = period || activePeriod;
    var filtered = filterByPeriod(audItems || [], usePeriod);

    filtered.forEach(function(item) {
        var n = auditTypeToNum(item);
        if (!AUDIT_TYPES_REGION_LOAD_EVENTS[n]) return;
        var regionName = resolveRegionNameFromAudit(item);
        if (!regionName) return;
        regionCounts[regionName] = (regionCounts[regionName] || 0) + 1;
    });

    var sorted = Object.keys(regionCounts).sort(function(a, b) { return regionCounts[b] - regionCounts[a]; });
    if (sorted.length === 0) {
        el.innerHTML = '<div class="metric-placeholder">No session end events (97-99) in this window.</div>';
        return;
    }
    var grandTotal = sorted.reduce(function(s, r) { return s + regionCounts[r]; }, 0) || 1;
    var max = regionCounts[sorted[0]];
    el.innerHTML = sorted.map(function(r) {
        var count = regionCounts[r];
        var pctBar = Math.round(count / max * 100);
        var pctTot = Math.round(count / grandTotal * 100);
        return '<div class="metric-row json-inspect-row cursor-pointer" data-json-region="' + escapeHtmlAttr(r) + '" title="Click to view region info">' +
            '<span class="metric-label">' + escapeHtmlAttr(r) + '</span>' +
            '<div class="metric-bar-wrap"><div class="metric-bar indigo" style="width:' + pctBar + '%"></div></div>' +
            '<span class="metric-count">' + count +
            ' <span style="color:#94a3b8;font-weight:500">(' + pctTot + '%)</span></span></div>';
    }).join('');
}

// ── 4b2. Audit Operations — strict whitelist (policy / region health / user block); unique users per type.
function escapeHtmlAttr(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
}

function openJsonInspector(title, data) {
    var payload = data === undefined || data === null ? [] : data;
    var tEl = document.getElementById('json-inspector-title');
    var cEl = document.getElementById('json-inspector-code');
    var bd = document.getElementById('json-inspector-backdrop');
    if (!tEl || !cEl || !bd) return;
    tEl.textContent = title != null ? String(title) : 'Raw Data';
    try {
        cEl.textContent = JSON.stringify(payload, null, 2);
    } catch (err) {
        cEl.textContent = String(err);
    }
    bd.classList.add('open');
    bd.setAttribute('aria-hidden', 'false');
}

function closeJsonInspector() {
    var bd = document.getElementById('json-inspector-backdrop');
    if (bd) {
        bd.classList.remove('open');
        bd.setAttribute('aria-hidden', 'true');
    }
}

function openDynamicTableModal(title, columns, dataArray) {
    var tEl = document.getElementById('formatted-table-modal-title');
    var bEl = document.getElementById('formatted-table-modal-body');
    var bd = document.getElementById('formatted-table-modal-backdrop');
    if (!tEl || !bEl || !bd) return;
    var cols = Array.isArray(columns) ? columns : [];
    var rows = Array.isArray(dataArray) ? dataArray : [];
    tEl.textContent = title != null ? String(title) : '';
    var esc = znRichTooltipEscapeHtml;
    var thead = '<thead><tr>' + cols.map(function(c) {
        return '<th>' + esc(String(c)) + '</th>';
    }).join('') + '</tr></thead>';
    var tbody = '<tbody>' + rows.map(function(row) {
        var cells = Array.isArray(row) ? row : [];
        return '<tr>' + cells.map(function(cell) {
            var v = cell === null || cell === undefined ? '' : String(cell);
            return '<td>' + esc(v) + '</td>';
        }).join('') + '</tr>';
    }).join('') + '</tbody>';
    bEl.innerHTML = '<table class="zn-dynamic-table">' + thead + tbody + '</table>';
    bd.classList.add('open');
    bd.setAttribute('aria-hidden', 'false');
}

function closeFormattedTableModal() {
    var bd = document.getElementById('formatted-table-modal-backdrop');
    if (bd) {
        bd.classList.remove('open');
        bd.setAttribute('aria-hidden', 'true');
    }
}

function closeChartDetailPopover() {
    var pop = document.getElementById('chart-detail-popover');
    if (pop) pop.classList.add('hidden');
    var tt = document.getElementById('chartjs-rich-tooltip');
    if (tt) tt.classList.remove('is-pinned');
}

function showChartDetailPopover(title, columns, dataArray) {
    var pop = document.getElementById('chart-detail-popover');
    var bodyEl = document.getElementById('chart-detail-popover-body');
    var titleEl = document.getElementById('chart-detail-popover-title');
    if (!pop || !bodyEl || !titleEl) return;
    var tt = document.getElementById('chartjs-rich-tooltip');
    var rect = tt ? tt.getBoundingClientRect() : { left: 80, top: 80, width: 0, height: 0 };
    var cols = Array.isArray(columns) ? columns : [];
    var rows = Array.isArray(dataArray) ? dataArray : [];
    titleEl.textContent = title != null ? String(title) : '';
    var esc = znRichTooltipEscapeHtml;
    var thead = '<thead><tr>' + cols.map(function(c) {
        return '<th>' + esc(String(c)) + '</th>';
    }).join('') + '</tr></thead>';
    var tbody = '<tbody>' + rows.map(function(row) {
        var cells = Array.isArray(row) ? row : [];
        return '<tr>' + cells.map(function(cell) {
            var v = cell === null || cell === undefined ? '' : String(cell);
            return '<td>' + esc(v) + '</td>';
        }).join('') + '</tr>';
    }).join('') + '</tbody>';
    bodyEl.innerHTML = '<table class="chart-detail-popover-table">' + thead + tbody + '</table>';
    pop.style.position = 'fixed';
    var left = rect.left + rect.width + 10;
    var top = rect.top;
    pop.classList.remove('hidden');
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    requestAnimationFrame(function() {
        var w = pop.offsetWidth || 320;
        var maxW = 500;
        if (w > maxW) w = maxW;
        if (left + w > window.innerWidth - 8) {
            pop.style.left = Math.max(8, rect.left - w - 10) + 'px';
        }
        if (pop.offsetHeight + top > window.innerHeight - 8) {
            pop.style.top = Math.max(8, window.innerHeight - pop.offsetHeight - 8) + 'px';
        }
    });
}

function openFormattedUsersPopover(date, userArray) {
    var rows = (userArray || []).map(function(u) {
        if (u && typeof u === 'object') {
            var loc = u.location != null && String(u.location).trim()
                ? String(u.location).trim()
                : (u.ip != null && String(u.ip).trim() ? String(u.ip).trim() : '\u2014');
            return [
                u.name != null ? String(u.name) : '',
                loc,
                u.region != null ? String(u.region) : 'Unknown'
            ];
        }
        return [String(u), '\u2014', 'Unknown'];
    });
    showChartDetailPopover('Unique Users on ' + String(date),
        ['User Name', 'Location', 'Region (Gateway)'], rows);
}

function openFormattedPolicyModal(date, eventsArray) {
    var rows = znBuildPolicyOperationsTableRows(eventsArray);
    showChartDetailPopover('Policy Operations on ' + String(date),
        ['Time', 'Action', 'Policy Name', 'Admin'], rows);
}

function filterPolicyAuditsByUacName(audItems, period, uacName) {
    var filtered = filterByPeriod(audItems || [], period || activePeriod);
    var out = [];
    filtered.forEach(function(item) {
        if (auditTypeToNum(item) !== AUDIT_TYPE_SESSION_CREATED) return;
        var d = parseAuditDetails(item);
        if (!d || d.uacName === undefined || d.uacName === null) return;
        var name = typeof d.uacName === 'string' ? d.uacName.trim() : String(d.uacName).trim();
        if (name === uacName) out.push(item);
    });
    return out;
}

function filterAuditsByConnectServerRegionLabel(audItems, period, regionLabel) {
    var filtered = filterByPeriod(audItems || [], period || activePeriod);
    var want = regionLabel != null ? String(regionLabel).trim() : '';
    return filtered.filter(function(item) {
        if (!AUDIT_TYPES_REGION_LOAD_EVENTS[auditTypeToNum(item)]) return false;
        var ar = item.actualRegion && item.actualRegion.name != null ? String(item.actualRegion.name).trim() : '';
        if (want && ar === want) return true;
        var r = connectServerFromAuditDetailsStrict(item);
        return r && String(r).trim() === want;
    });
}

function filterSessionsByNormalizedClientVersion(sessions, verNorm) {
    return (sessions || []).filter(function(s) {
        var ver = clientVer(s);
        if (!ver) return false;
        ver = String(ver).trim().replace(/^v/i, '');
        return ver === verNorm;
    });
}

function filterSessionsByOsFamilyName(sessions, family) {
    return (sessions || []).filter(function(s) {
        var exact = sessionAssetOperatingSystemExact(s);
        if (!exact) return false;
        return osMajorFamilyFromExactString(exact) === family;
    });
}

/** OS widget drill: prefer `asset.operatingSystem.includes(needle)`; fallback to family match. */
function filterSessionsForOsWidgetDrill(sessions, clickedOsName) {
    var n = String(clickedOsName || '');
    if (!n) return [];
    var list = sessions || [];
    var inc = list.filter(function(s) {
        var os = s.asset && s.asset.operatingSystem;
        if (os == null || os === '') return false;
        return String(os).indexOf(n) !== -1;
    });
    if (inc.length) return inc;
    return filterSessionsByOsFamilyName(list, n);
}

function filterSessionsByOsExactString(sessions, exactOs) {
    return (sessions || []).filter(function(s) {
        var ex = sessionAssetOperatingSystemExact(s);
        return ex && ex === exactOs;
    });
}

function auditActivityBarTypeId(mode, datasetIndex) {
    if (mode === 'sessions') {
        var ids = [97, 98, 99, 123];
        return ids[datasetIndex];
    }
    if (mode === 'region_health') return datasetIndex === 0 ? 351 : 352;
    if (mode === 'policy') {
        var p = [100, 101, 102];
        return p[datasetIndex];
    }
    return NaN;
}

function filterAuditsForActivityBarSegment(poolItems, auditTypeId, bucket) {
    if (!bucket || auditTypeId == null || isNaN(auditTypeId)) return [];
    return (poolItems || []).filter(function(item) {
        if (auditTypeToNum(item) !== auditTypeId) return false;
        var ts = getAuditItemTs(item);
        if (ts == null) return false;
        return ts >= bucket.startMs && ts < bucket.endMs;
    });
}

function syncDauChartHtmlLegend(chart) {
    var host = document.getElementById('dau-chart-legend');
    if (!host || !chart || !chart.data) return;
    var datasets = chart.data.datasets || [];
    if (datasets.length === 0) {
        host.innerHTML = '';
        host.style.display = 'none';
        return;
    }
    var checkSvg = '<svg class="dau-legend-check" viewBox="0 0 12 10" width="10" height="8" aria-hidden="true" focusable="false">' +
        '<path fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M1 5l3 3 6-6"/></svg>';
    host.style.display = '';
    host.innerHTML = datasets.map(function(ds, i) {
        var visible = chart.isDatasetVisible(i);
        var color = ds.borderColor || ds.backgroundColor || '#94a3b8';
        if (Array.isArray(color)) color = color[0];
        color = String(color || '#94a3b8').replace(/"/g, '');
        var lab = ds.label != null ? String(ds.label) : 'Series ' + i;
        return '<div class="dau-legend-item' + (visible ? '' : ' is-row-off') + '" title="Toggle ' + escapeHtmlAttr(lab) + '">' +
            '<button type="button" class="dau-legend-toggle' + (visible ? '' : ' is-off') + '" data-dataset-index="' + i + '" ' +
            'style="--legend-color:' + color + '" aria-label="Toggle ' + escapeHtmlAttr(lab) + '" aria-pressed="' + visible + '" role="switch">' +
            checkSvg +
            '</button>' +
            '<span class="dau-legend-label">' + escapeHtmlAttr(lab) + '</span>' +
            '</div>';
    }).join('');
}

// Identity for unique-user counts: top-level `user`, else `performedBy.name` (per spec).
// Audit Types widget: drop leading "Connect " from API labels; capitalize first letter.
function cleanAuditTypeDisplayName(rawName) {
    var s = String(rawName || '').trim();
    if (!s) return s;
    var stripped = s.replace(/^Connect\s+/i, '');
    if (!stripped) stripped = s;
    return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

function auditTypesUniqueUserKey(item) {
    if (!item || typeof item !== 'object') return null;
    var u = item.user;
    if (u !== undefined && u !== null) {
        if (typeof u === 'string') {
            var us = u.trim();
            if (us) return us;
        }
        if (typeof u === 'object' && u.name != null) {
            var un = String(u.name).trim();
            if (un) return un;
        }
    }
    var pb = item.performedBy;
    if (pb !== undefined && pb !== null && typeof pb === 'object' && pb.name != null) {
        var pn = String(pb.name).trim();
        if (pn) return pn;
    }
    return null;
}

function renderAuditTypesCard(audItems, period) {
    var el = document.getElementById('card-audit-types');
    if (!el) return;

    var usePeriod = period || activePeriod;
    var items = filterAuditOperationsListSource(audItems, usePeriod);

    if (items.length === 0) {
        el.innerHTML = '<div class="metric-placeholder">No audit events in this window.</div>';
        return;
    }

    var counts = Object.create(null);
    AUDIT_OPERATIONS_ROW_DEFS.forEach(function(def) {
        def.ids.forEach(function(id) {
            counts[id] = 0;
        });
    });

    items.forEach(function(item) {
        if (!auditOperationIsWhitelisted(item)) return;
        var n = auditTypeToNum(item);
        if (isNaN(n) || counts[n] === undefined) return;
        counts[n]++;
    });

    var sumWhitelisted = 0;
    AUDIT_OPERATIONS_ROW_DEFS.forEach(function(def) {
        def.ids.forEach(function(id) { sumWhitelisted += counts[id] || 0; });
    });
    if (sumWhitelisted === 0) {
        el.innerHTML = '<div class="metric-placeholder">No whitelisted audit operations in this window.</div>';
        return;
    }

    el.innerHTML = AUDIT_OPERATIONS_ROW_DEFS.map(function(def, defIdx) {
        var c = 0;
        def.ids.forEach(function(id) { c += counts[id] || 0; });
        var lab = cleanAuditTypeDisplayName(def.label);
        var esc = escapeHtmlAttr(lab);
        return '<div class="metric-row audit-op-line audit-op-line--clickable" role="listitem" data-audit-op-def-index="' + defIdx + '" title="View recent events">' +
            '<span class="metric-label">' + esc + '</span>' +
            '<span class="metric-count audit-op-line-count">' + c + '</span></div>';
    }).join('');
}

function openAuditOperationCategoryModal(categoryDisplayName, def) {
    var metaEl = document.getElementById('modal-meta');
    if (metaEl) metaEl.style.display = 'none';
    document.getElementById('modal-title').textContent = 'Audit Detail: ' + categoryDisplayName;

    var items = filterAuditOperationsListSource(lastData.aud, activePeriod);
    var matched = [];
    var idSet = Object.create(null);
    (def.ids || []).forEach(function(id) { idSet[id] = true; });

    items.forEach(function(item) {
        if (!auditOperationIsWhitelisted(item)) return;
        var n = auditTypeToNum(item);
        if (!idSet[n]) return;
        matched.push(item);
    });

    matched.sort(function(a, b) {
        var ta = getAuditItemTs(a);
        var tb = getAuditItemTs(b);
        ta = ta != null ? ta : 0;
        tb = tb != null ? tb : 0;
        return tb - ta;
    });

    znAuditDrillRecentEvents = matched.slice(0, 80);

    var rows = znAuditDrillRecentEvents.map(function(ev, i) {
        var ts = getAuditItemTs(ev);
        var dateStr = ts != null ? fmtConnLogTs(ts) : '\u2014';
        var u = auditEventUser(ev) || auditTypesUniqueUserKey(ev) || '\u2014';
        return '<tr><td>' + escapeHtmlAttr(dateStr) + '</td><td>' + escapeHtmlAttr(String(u)) + '</td>' +
            '<td><button type="button" class="audit-drill-inspect-btn" data-audit-event-index="' + i + '">Inspect</button></td></tr>';
    }).join('');

    if (!rows) {
        rows = '<tr><td colspan="3">' + escapeHtmlAttr('No matching events in this window.') + '</td></tr>';
    }

    document.getElementById('modal-body').innerHTML =
        '<div class="audit-drill-modal-wrap">' +
        '<table class="insight-modal-table audit-drill-table">' +
        '<thead><tr><th>Date</th><th>User</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
        '<div id="audit-drill-json-wrap" class="audit-drill-json-wrap" style="display:none">' +
        '<pre class="audit-drill-json-pre"><code id="audit-drill-json-code"></code></pre></div></div>';

    document.getElementById('modal-backdrop').classList.add('open');
}

// ── 4c. Policy hits — access policy hit counts from Connect session created (96), details.uacName ─
function renderPolicyRulesCard(audItems, period) {
    var el = document.getElementById('card-policy-rules');
    if (!el) return;

    var usePeriod = period || activePeriod;
    var filtered = filterByPeriod(audItems || [], usePeriod);
    var policyCounts = {};

    filtered.forEach(function(item) {
        if (auditTypeToNum(item) !== AUDIT_TYPE_SESSION_CREATED) return;
        var d = parseAuditDetails(item);
        if (!d || d.uacName === undefined || d.uacName === null) return;
        var name = typeof d.uacName === 'string' ? d.uacName.trim() : String(d.uacName).trim();
        if (!name) return;
        policyCounts[name] = (policyCounts[name] || 0) + 1;
    });

    var sorted = Object.keys(policyCounts)
        .sort(function(a, b) { return policyCounts[b] - policyCounts[a]; })
        .slice(0, 5);

    if (sorted.length === 0) {
        el.innerHTML = '<div class="metric-placeholder">No policy hits (type 96 with details.uacName) in ' + usePeriod + '.</div>';
        return;
    }

    var grandTotal = sorted.reduce(function(s, name) { return s + policyCounts[name]; }, 0) || 1;
    var max = policyCounts[sorted[0]];
    el.innerHTML = sorted.map(function(name) {
        var count = policyCounts[name];
        var pctBar = Math.round(count / max * 100);
        var pctTot = Math.round(count / grandTotal * 100);
        var esc = escapeHtmlAttr(name);
        return '<div class="metric-row json-inspect-row" data-json-policy-uac="' + esc + '">' +
            '<span class="metric-label" title="' + esc + '">' + esc + '</span>' +
            '<div class="metric-bar-wrap"><div class="metric-bar indigo" style="width:' + pctBar + '%"></div></div>' +
            '<span class="metric-count">' + count +
            ' <span style="color:#94a3b8;font-weight:500">(' + pctTot + '%)</span></span></div>';
    }).join('');
}

// ── 4d. Overall Connected Time card ───────────────────────────────────────
// Audits: types 97 / 98 / 99 only (ignore 96). Parse details JSON; user + connectedSince; skip connectedSince 0;
// duration = end − start, discard negative; cap start to selected time-window start. Live: active sessions only,
// same cap. Invoked from renderAuditStreamWidgets only when auditFetchPending is false.
function liveSessionStartMs(s) {
    var tsRaw = s.startTime || s.connectedAt || s.connectedSince || s.createdAt || s.sessionStart || s.lastConnectedAt || null;
    if (tsRaw === undefined || tsRaw === null || tsRaw === '' || tsRaw === 0) {
        var rawD = s.sessionDetails || s.connectDetails || s.details;
        if (rawD) {
            var d = null;
            if (typeof rawD === 'string') {
                try { d = JSON.parse(rawD); } catch (err) { d = null; }
            } else if (typeof rawD === 'object') {
                d = rawD;
            }
            if (d && d.connectedSince !== undefined && d.connectedSince !== null && d.connectedSince !== '' && d.connectedSince !== 0) {
                tsRaw = d.connectedSince;
            }
        }
    }
    if (tsRaw === undefined || tsRaw === null || tsRaw === '' || tsRaw === 0) return null;
    var ms = typeof tsRaw === 'number' ? (tsRaw > 1e11 ? tsRaw : tsRaw * 1000) : new Date(tsRaw).getTime();
    if (isNaN(ms) || ms <= 0) return null;
    return ms;
}

function renderConnectionTimeCard(audItems, liveSessions) {
    var el = document.getElementById('card-conn-time');
    if (!el) return;

    var userDurations = {};
    var calcByUser = Object.create(null);
    lastData.connTime = {};
    lastData.connTimeCalcByUser = calcByUser;

    var selUser = getSelectedDashboardUserName();
    var liveForCard = selUser ? filterSessionsByDashboardUser(liveSessions || []) : (liveSessions || []);

    function ensureCalc(userKey) {
        if (!calcByUser[userKey]) {
            calcByUser[userKey] = { segments: [], historicalMs: 0, liveMs: 0 };
        }
        return calcByUser[userKey];
    }

    var filtered = filterByPeriod(audItems || [], activePeriod);
    var windowStartMs = cutoffMs(activePeriod);
    var now = Date.now();

    function parseConnectedSinceMs(cs) {
        if (cs === undefined || cs === null || cs === '' || cs === 0 || cs === '0') return null;
        var ms = typeof cs === 'number' ? (cs > 1e11 ? cs : cs * 1000) : new Date(cs).getTime();
        if (isNaN(ms) || ms <= 0) return null;
        return ms;
    }

    function connTimeUserFromParsedDetails(detailsObj, item) {
        if (!detailsObj) return auditEventUser(item);
        var u = detailsObj.user;
        if (u != null) {
            if (typeof u === 'string' && u.trim()) return u.trim();
            if (typeof u === 'object') {
                var nm = readName(u);
                if (nm) return String(nm).trim();
            }
        }
        return auditEventUser(item);
    }

    filtered.forEach(function(item) {
        var n = auditTypeToNum(item);
        if (!AUDIT_TYPES_CONN_TIME_CREDIT[n]) return;

        var detailsObj = null;
        try {
            if (item.details === undefined || item.details === null || item.details === '') return;
            detailsObj = typeof item.details === 'object' ? item.details : JSON.parse(item.details);
        } catch (err) {
            return;
        }
        if (!detailsObj || typeof detailsObj !== 'object') return;

        var userKey = connTimeUserFromParsedDetails(detailsObj, item);
        if (!userKey) return;
        if (selUser && userKey !== selUser) return;

        var cs = detailsObj.connectedSince;
        if (cs === undefined || cs === null || cs === 0 || cs === '0') return;

        var endMs = getAuditItemTs(item);
        if (endMs == null || isNaN(endMs)) return;

        var startMs = parseConnectedSinceMs(cs);
        if (startMs == null || isNaN(startMs)) return;

        var effectiveStart = Math.max(startMs, windowStartMs);
        var dur = endMs - effectiveStart;
        if (dur < 0) return;

        var cHist = ensureCalc(userKey);
        cHist.segments.push({
            endType: sessionEndTypeLabelForConnTime(n),
            startFmt: fmtConnLogTs(effectiveStart),
            endFmt: fmtConnLogTs(endMs),
            durMs: dur
        });
        cHist.historicalMs += dur;

        userDurations[userKey] = (userDurations[userKey] || 0) + dur;
    });

    liveForCard.forEach(function(s) {
        if (sessionState(s) !== 'active') return;
        var user = sessionUserLabelForPosture(s);
        var startLive = liveSessionStartMs(s);
        if (startLive == null) return;

        var effectiveStart = Math.max(startLive, windowStartMs);
        var liveDur = now - effectiveStart;
        if (liveDur < 0) return;

        var cLive = ensureCalc(user);
        cLive.segments.push({
            endType: 'Live session',
            startFmt: fmtConnLogTs(effectiveStart),
            endFmt: fmtConnLogTs(now),
            durMs: liveDur
        });
        cLive.liveMs += liveDur;

        userDurations[user] = (userDurations[user] || 0) + liveDur;
    });

    lastData.connTime = userDurations;

    console.log('[ZN] conn-time userDurations (pre-sort, includes zero totals)', userDurations);

    var sorted = Object.keys(userDurations)
        .filter(function(k) { return userDurations[k] > 0; })
        .sort(function(a, b) { return userDurations[b] - userDurations[a]; });

    if (sorted.length === 0) {
        el.innerHTML = '<div class="metric-placeholder">No users with positive connected time in this window.</div>';
        return;
    }

    var maxMs = Math.max.apply(null, sorted.map(function(k) { return userDurations[k]; })) || 1;
    el.innerHTML = sorted.map(function(user) {
        var ms  = userDurations[user];
        var pct = Math.round(ms / maxMs * 100);
        var esc = escapeHtmlAttr(user);
        return '<div class="metric-row conn-time-row">' +
            '<span class="metric-label" title="' + esc + '">' + esc + '</span>' +
            '<div class="metric-bar-wrap"><div class="metric-bar" style="width:' + pct + '%;background:#8b5cf6"></div></div>' +
            '<span class="metric-count conn-time-value">' + formatConnTimeHoursMinutes(ms) + '</span>' +
            '</div>';
    }).join('');
}

// ── 4d. Insights — unified modal (recommended action + fixed-column table) ─
function openInsightModal(data, title, description, columns, apiEndpoint) {
    var rows = data || [];
    title = title || 'Insight';
    description = description || '';
    columns = Array.isArray(columns) ? columns : [];
    var endpoint = apiEndpoint || '/api/v1/connect/sessions';

    document.getElementById('modal-title').textContent = title;

    var metaEl = document.getElementById('modal-meta');
    metaEl.style.display = 'flex';
    metaEl.innerHTML =
        '<div class="modal-meta-item">' +
            '<span class="modal-meta-key">API</span>' +
            '<span class="modal-meta-val"><code>GET ' + escapeHtmlAttr(endpoint) + '</code></span>' +
        '</div>' +
        '<div class="modal-meta-item">' +
            '<span class="modal-meta-key">Records</span>' +
            '<span class="modal-meta-val">' + rows.length + '</span>' +
        '</div>';

    var body = '';
    if (description) {
        body +=
            '<div class="insight-modal-recommended">' +
            '<div class="insight-modal-recommended-label">Recommended action</div>' +
            '<div class="insight-modal-recommended-body">' +
            description.split('\n').map(function(line) { return escapeHtmlAttr(line); }).join('<br>') +
            '</div></div>';
    }
    if (rows.length === 0) {
        body += '<p style="color:#94a3b8;font-style:italic;padding:12px 0">No matching records.</p>';
    } else {
        var thead = '<thead><tr>' + columns.map(function(c) {
            return '<th>' + escapeHtmlAttr(String(c)) + '</th>';
        }).join('') + '</tr></thead>';
        var tbody = '<tbody>' + rows.map(function(row) {
            return '<tr>' + columns.map(function(c) {
                var v = row && row[c];
                var cell = v === undefined || v === null ? '' : String(v);
                return '<td>' + escapeHtmlAttr(cell) + '</td>';
            }).join('') + '</tr>';
        }).join('') + '</tbody>';
        body += '<table class="insight-modal-table">' + thead + tbody + '</table>';
    }

    document.getElementById('modal-body').innerHTML = body;
    document.getElementById('modal-backdrop').classList.add('open');
}

function openOverallConnectedTimeDebugModal() {
    var durMap = lastData.connTime || {};
    var calcMap = lastData.connTimeCalcByUser || {};
    var sorted = Object.keys(durMap)
        .filter(function(k) { return durMap[k] > 0; })
        .sort(function(a, b) { return durMap[b] - durMap[a]; })
        .slice(0, 5);

    document.getElementById('modal-title').textContent = 'Overall Connected Time — Debug';

    var metaEl = document.getElementById('modal-meta');
    metaEl.style.display = 'flex';
    metaEl.innerHTML =
        '<div class="modal-meta-item">' +
            '<span class="modal-meta-key">API</span>' +
            '<span class="modal-meta-val"><code>GET ' + escapeHtmlAttr('/api/v1/audit') + '</code> + live sessions</span>' +
        '</div>' +
        '<div class="modal-meta-item">' +
            '<span class="modal-meta-key">Preview</span>' +
            '<span class="modal-meta-val">Top 5 users by total — one row per session segment</span>' +
        '</div>';

    var columns = ['User', 'Session End Type', 'Start Time', 'End Time', 'Calculated Duration'];
    var rows = [];
    sorted.forEach(function(u) {
        var entry = calcMap[u];
        var segs = entry && Array.isArray(entry.segments) ? entry.segments : [];
        segs.forEach(function(seg) {
            rows.push({
                'User': u,
                'Session End Type': seg.endType,
                'Start Time': seg.startFmt,
                'End Time': seg.endFmt,
                'Calculated Duration': formatDurationHMS(seg.durMs)
            });
        });
    });

    var body;
    if (sorted.length === 0) {
        body = '<p style="color:#94a3b8;font-style:italic;padding:12px 0">No users with positive connected time.</p>';
    } else if (rows.length === 0) {
        body = '<p style="color:#94a3b8;font-style:italic;padding:12px 0">No segment detail stored for top users.</p>';
    } else {
        var thead = '<thead><tr>' + columns.map(function(c) {
            return '<th>' + escapeHtmlAttr(String(c)) + '</th>';
        }).join('') + '</tr></thead>';
        var cellStyle = ' style="font-size:0.72rem;vertical-align:top;white-space:pre-wrap;word-break:break-word"';
        var tbody = '<tbody>' + rows.map(function(row) {
            return '<tr>' + columns.map(function(c) {
                var v = row[c];
                var cell = v === undefined || v === null ? '' : String(v);
                return '<td' + cellStyle + '>' + escapeHtmlAttr(cell) + '</td>';
            }).join('') + '</tr>';
        }).join('') + '</tbody>';
        body = '<table class="insight-modal-table">' + thead + tbody + '</table>' +
            '<p style="color:#94a3b8;font-size:0.72rem;margin-top:12px;line-height:1.45">' +
            'Historical rows: audit types 97 (Expired), 98 (Revoked), 99 (Logout) only. Parse details JSON; duration = audit timestamp \u2212 max(connectedSince, window start). ' +
            'Skip connectedSince 0 and negative duration. Live rows: active sessions only; end = now, same window cap.</p>';
    }
    document.getElementById('modal-body').innerHTML = body;
    document.getElementById('modal-backdrop').classList.add('open');
}

/** Static reference for all five insight kinds (shown even when current hit count is zero). */
function openInsightsLogicGuideModal() {
    document.getElementById('modal-title').textContent = 'Insights & Audit Logic Guide';
    var metaEl = document.getElementById('modal-meta');
    metaEl.style.display = 'none';

    var auditRows = [
        {
            id: '96',
            name: 'Connect Created',
            when: 'When the user selects Connect. Opens a new identity session; posture is evaluated at this point.'
        },
        {
            id: '97',
            name: 'Connect Expired',
            when: 'When the server ends the session after max session time / 24h (or equivalent policy limit).'
        },
        {
            id: '98',
            name: 'Connect Revoked',
            when: 'When an administrator manually terminates the session.'
        },
        {
            id: '99',
            name: 'Connect Logout',
            when: 'When the user disconnects (explicit Disconnect).'
        }
    ];

    var rows = [
        {
            name: 'Always-On Violation',
            sev: 'High',
            sevClass: 'insights-logic-sev--high',
            logic: 'Live Connect sessions only. Triggered when Always-On posture reads as off (false, 0, disabled, or equivalent string) on fields such as alwaysOn, alwaysConnected, or isAlwaysOn.'
        },
        {
            name: 'Sub-optimal Routing',
            sev: 'Medium',
            sevClass: 'insights-logic-sev--medium',
            logic: 'Active sessions only. Triggered when the session\'s actual region (actualRegion.name) differs from the geo-IP / policy desired region (desiredRegion.name).'
        },
        {
            name: 'Legacy Clients',
            sev: 'Medium',
            sevClass: 'insights-logic-sev--medium',
            logic: 'Active sessions only. Triggered when the client version major number is below 4 (telemetry string parsed after stripping a leading "v").'
        },
        {
            name: 'Degraded Asset Health',
            sev: 'Medium',
            sevClass: 'insights-logic-sev--medium',
            logic: 'Active sessions only. Triggered when connectivityStateAfterReboot is false, 0, or the string "false" — i.e. the asset is not reporting healthy connectivity after reboot.'
        },
        {
            name: 'Connection Flapping',
            sev: 'Info',
            sevClass: 'insights-logic-sev--info',
            logic: 'Uses the paginated audit stream in the selected period. For each user and calendar day, counts Connect session-created events (type 96); flagged when count is greater than one (multiple reconnects same day).'
        }
    ];

    var thead = '<thead><tr><th>Name</th><th>Severity</th><th>Logic</th></tr></thead>';
    var tbody = '<tbody>' + rows.map(function(r) {
        return '<tr>' +
            '<td class="insights-logic-name">' + escapeHtmlAttr(r.name) + '</td>' +
            '<td class="insights-logic-sev ' + r.sevClass + '">' + escapeHtmlAttr(r.sev) + '</td>' +
            '<td class="insights-logic-col">' + escapeHtmlAttr(r.logic) + '</td>' +
        '</tr>';
    }).join('') + '</tbody>';

    var auditThead = '<thead><tr><th>Type</th><th>Event</th><th>When / how</th></tr></thead>';
    var auditTbody = '<tbody>' + auditRows.map(function(a) {
        return '<tr>' +
            '<td class="insights-logic-name">' + escapeHtmlAttr(a.id) + '</td>' +
            '<td class="insights-logic-name">' + escapeHtmlAttr(a.name) + '</td>' +
            '<td class="insights-logic-col">' + escapeHtmlAttr(a.when) + '</td>' +
        '</tr>';
    }).join('') + '</tbody>';

    document.getElementById('modal-body').innerHTML =
        '<table class="insights-logic-table">' + thead + tbody + '</table>' +
        '<div class="insights-logic-subhd">Connect audit dictionary</div>' +
        '<p style="color:#64748b;font-size:0.76rem;margin:0 0 10px;line-height:1.45">' +
        'Calculations on this dashboard use these meanings: session length from historical data uses <strong>end</strong> events 97–99 only; ' +
        'DAU pairing and policy hits use 96; connection flapping counts multiple 96 per user per day.</p>' +
        '<table class="insights-logic-table">' + auditThead + auditTbody + '</table>' +
        '<p style="color:#94a3b8;font-size:0.72rem;margin-top:14px;line-height:1.45">' +
        'Insight cards appear only when matching live or audit data exists; insight definitions and the audit dictionary above are always valid.</p>';
    document.getElementById('modal-backdrop').classList.add('open');
}

function insightAlwaysOnDisabledOnActiveSession(s) {
    if (sessionState(s) !== 'active') return false;
    var aoVal = s.alwaysOn !== undefined ? s.alwaysOn
        : s.alwaysConnected !== undefined ? s.alwaysConnected
        : s.isAlwaysOn;
    if (aoVal === undefined || aoVal === null) return false;
    if (aoVal === false || aoVal === 0 || aoVal === '0') return true;
    var aov = typeof aoVal === 'string' ? aoVal.toLowerCase() : aoVal;
    if (aov === 'false' || aov === 'off' || aov === 'no' || aov === 'disabled') return true;
    return false;
}

function insightSessionIsLegacyClient(s) {
    if (sessionState(s) !== 'active') return false;
    var v = clientVer(s);
    if (v === undefined || v === null || v === '') return false;
    var norm = String(v).trim().replace(/^v/i, '');
    var major = parseInt(norm.split('.')[0], 10);
    return !isNaN(major) && major < 4;
}

function insightRowsSubOptimalRouting(sessions) {
    return (sessions || []).filter(function(s) {
        var act = s.actualRegion && s.actualRegion.name;
        var des = s.desiredRegion && s.desiredRegion.name;
        return sessionState(s) === 'active' && act && des && act !== des;
    }).map(function(s) {
        return {
            'User': (s.user && s.user.name) || userName(s) || '—',
            'Desired Region': (s.desiredRegion && s.desiredRegion.name) || '—',
            'Actual Region': (s.actualRegion && s.actualRegion.name) || '—'
        };
    });
}

function insightRowsLegacyClients(sessions) {
    return (sessions || []).filter(function(s) {
        return insightSessionIsLegacyClient(s);
    }).map(function(s) {
        var os = sessionAssetOperatingSystemExact(s) || rawOS(s);
        return {
            'Asset Name': (s.asset && s.asset.name) || assetName(s) || '—',
            'Current Version': clientVer(s) != null ? String(clientVer(s)) : '—',
            'OS': os != null ? String(os) : '—'
        };
    });
}

function insightSessionDegradedAssetHealth(s) {
    if (sessionState(s) !== 'active') return false;
    var c = s.connectivityStateAfterReboot;
    if (c === false || c === 0 || c === '0' || c === 'false') return true;
    return false;
}

function insightRowsDegradedAssetHealth(sessions) {
    function sessionExternalIp(s) {
        var ip = sessionPublicIp(s);
        return ip ? String(ip) : '—';
    }
    function sessionLastSeenLabel(s) {
        var raw = s.lastSeen || s.lastActivityAt || s.updatedAt || s.lastConnectedAt || s.modifiedAt || s.endTime;
        if (raw == null || raw === '') return '—';
        var ms = typeof raw === 'number' ? (raw > 1e11 ? raw : raw * 1000) : new Date(raw).getTime();
        if (isNaN(ms)) return '—';
        try {
            return new Date(ms).toLocaleString();
        } catch (err) {
            return '—';
        }
    }
    return (sessions || []).filter(function(s) {
        return insightSessionDegradedAssetHealth(s);
    }).map(function(s) {
        return {
            'User': (s.user && s.user.name) || userName(s) || '—',
            'External IP': sessionExternalIp(s),
            'Last Seen': sessionLastSeenLabel(s)
        };
    });
}

function insightRowsAlwaysOnViolations(sessions) {
    return (sessions || []).filter(insightAlwaysOnDisabledOnActiveSession).map(function(s) {
        return {
            'User': (s.user && s.user.name) || userName(s) || '—',
            'Asset': assetName(s) || '—',
            'Status': 'Always-On disabled'
        };
    });
}

// Type 96 per user per calendar day; modal lists (User, Date, Reconnect Count) where count > 1.
function insightRowsConnectionFlapping(audItems, period) {
    var usePeriod = period || activePeriod;
    var filtered = filterByPeriod(audItems || [], usePeriod);
    var selFlap = getSelectedDashboardUserName();
    var dayMap = Object.create(null);
    filtered.forEach(function(item) {
        if (auditTypeToNum(item) !== AUDIT_TYPE_SESSION_CREATED) return;
        var u = auditActivitySessionDetailsUser(item) || auditEventUserKey(item);
        if (!u) return;
        if (selFlap && u !== selFlap) return;
        var ts = getAuditItemTs(item);
        if (ts == null || isNaN(ts)) return;
        var dayKey = calendarDayKeyLocal(ts);
        if (!dayKey) return;
        var k = u + '\0' + dayKey;
        dayMap[k] = (dayMap[k] || 0) + 1;
    });
    var rows = [];
    Object.keys(dayMap).forEach(function(k) {
        var c = dayMap[k];
        if (c <= 1) return;
        var z = k.indexOf('\0');
        var user = k.slice(0, z);
        var ymd = k.slice(z + 1);
        rows.push({
            'User': user,
            'Date': formatCalendarDayMedium(ymd),
            'Reconnect Count': String(c)
        });
    });
    rows.sort(function(a, b) {
        var cu = String(a['User']).localeCompare(String(b['User']));
        if (cu !== 0) return cu;
        return String(a['Date']).localeCompare(String(b['Date']));
    });
    return rows;
}

function connectionFlappingAffectedUserCount(audItems, period) {
    var rows = insightRowsConnectionFlapping(audItems, period);
    var seen = Object.create(null);
    rows.forEach(function(r) { seen[r['User']] = true; });
    return Object.keys(seen).length;
}

/** Maps insight dot colour to title text colour (severity / tone). */
function insightTitleSeverityClass(colour) {
    if (colour === 'red') return 'insight-title--sev-high';
    if (colour === 'amber') return 'insight-title--sev-medium';
    if (colour === 'green') return 'insight-title--sev-low';
    if (colour === 'blue') return 'insight-title--sev-info';
    return 'insight-title--sev-default';
}

/** Opening tag + classes/attributes for per-insight card (entire card opens modal). */
function insightCardOpenTag(item) {
    var cls = 'insight-card insight-card--interactive';
    var kind = item.insightKind || '';
    return '<div class="' + cls + '" tabindex="0" role="button" data-insight-card="' + escapeHtmlAttr(kind) +
        '" aria-label="View details: ' + escapeHtmlAttr(item.title) + '">';
}

/** Native `title` tooltips for key insights (hover / long-hover for full text). */
var INSIGHT_ADMIN_TOOLTIP_ALWAYS_ON =
    "Why it's important: Always-On ensures corporate assets remain protected by the security stack and cannot bypass posture checks. How it's calculated: Scans live sessions to identify clients where Always-On is returning as false.";
var INSIGHT_ADMIN_TOOLTIP_ROUTING =
    "Why it's important: Cross-region connections drastically increase latency and degrade the end-user experience. How it's calculated: Compares the client's calculated 'Desired Region' against the 'Actual Region' server they are anchored to.";
var INSIGHT_ADMIN_TOOLTIP_LEGACY =
    "Why it's important: Outdated agents lack critical security patches. Advanced features require v4.0.0 or higher. How it's calculated: Checks the live session telemetry for any client version string below v4.0.0.";
var INSIGHT_ADMIN_TOOLTIP_DEGRADED =
    "Why it's important: Devices that lose connectivity after reboot may be offline from policy updates and exposure windows. How it's calculated: Active sessions where Connect After Boot / connectivity-after-reboot reads as false.";
var INSIGHT_ADMIN_TOOLTIP_FLAPPING =
    "Why it's important: Frequent reconnects can signal unstable clients, policy loops, or network issues worth investigating. How it's calculated: On the full paginated 30-day audit stream, flags any calendar day where a user has more than one Connect session created event (type 96).";

function insightTitleBlockHtml(item) {
    var titleEsc = escapeHtmlAttr(item.title);
    var tip = item.adminTooltip ? escapeHtmlAttr(item.adminTooltip) : '';
    var sev = insightTitleSeverityClass(item.colour);
    var infoBtn = tip
        ? '<button type="button" class="insight-help" title="' + tip + '" aria-label="Full admin explanation (hover or focus)">i</button>'
        : '';
    return '<div class="insight-title-row">' +
        '<span class="insight-title ' + sev + '">' + titleEsc + '</span>' +
        infoBtn +
        '</div>';
}

// ── 4d. Insights panel ────────────────────────────────────────────────────
// Fixed set: Always-On Violation, Sub-optimal Routing, Legacy Clients, Degraded Asset Health, Connection Flapping.
function renderInsights(lic, ses, aud, period) {
    void lic;
    var usePeriod = period || activePeriod;
    var items     = [];

    var alwaysOnViol = (ses || []).filter(insightAlwaysOnDisabledOnActiveSession);
    if (alwaysOnViol.length > 0) {
        items.push({
            colour:'amber',
            title:'Always-On Violation',
            detail: alwaysOnViol.length + ' active session' + (alwaysOnViol.length !== 1 ? 's have' : ' has') +
                ' Always-On disabled. Open the table to review users and assets.',
            adminTooltip: INSIGHT_ADMIN_TOOLTIP_ALWAYS_ON,
            insightKind: 'always-on'
        });
    }

    var routingRows = insightRowsSubOptimalRouting(ses);
    if (routingRows.length > 0) {
        items.push({
            colour:'amber',
            title:'Sub-optimal Routing',
            detail: routingRows.length + ' active session' + (routingRows.length !== 1 ? 's are' : ' is') +
                ' anchored away from the desired region.',
            adminTooltip: INSIGHT_ADMIN_TOOLTIP_ROUTING,
            insightKind: 'region-routing'
        });
    }

    var legacyRows = insightRowsLegacyClients(ses);
    if (legacyRows.length > 0) {
        items.push({
            colour:'amber',
            title:'Legacy Clients',
            detail: legacyRows.length + ' active device' + (legacyRows.length !== 1 ? 's are' : ' is') +
                ' below agent v4.0. Upgrade paths should be scheduled.',
            adminTooltip: INSIGHT_ADMIN_TOOLTIP_LEGACY,
            insightKind: 'legacy-clients'
        });
    }

    var degradedRows = insightRowsDegradedAssetHealth(ses);
    if (degradedRows.length > 0) {
        items.push({
            colour:'amber',
            title:'Degraded Asset Health',
            detail: degradedRows.length + ' active session' + (degradedRows.length !== 1 ? 's show' : ' shows') +
                ' Connect-after-boot connectivity as unhealthy.',
            adminTooltip: INSIGHT_ADMIN_TOOLTIP_DEGRADED,
            insightKind: 'degraded-health'
        });
    }

    var flapUserCount = connectionFlappingAffectedUserCount(aud, usePeriod);
    if (flapUserCount > 0) {
        items.push({
            colour:'blue',
            title:'Connection Flapping',
            detail: flapUserCount + ' user' + (flapUserCount !== 1 ? 's' : '') +
                ' experienced multiple reconnects within a 24-hour period.',
            adminTooltip: INSIGHT_ADMIN_TOOLTIP_FLAPPING,
            insightKind: 'connection-flapping'
        });
    }

    if (items.length === 0) {
        document.getElementById('insights-list').innerHTML = '<li style="color:#94a3b8;font-size:0.8rem">No insights available.</li>';
        return;
    }

    document.getElementById('insights-list').innerHTML = items.map(function(item) {
        return '<li class="insights-list-item">' +
            insightCardOpenTag(item) +
            '<span class="insight-dot ' + item.colour + '" aria-hidden="true"></span>' +
            '<div class="insight-body">' +
                insightTitleBlockHtml(item) +
                '<div class="insight-detail">' + escapeHtmlAttr(item.detail) + '</div>' +
            '</div></div></li>';
    }).join('');
}

// ── 5. Sessions list widget removed (KPI + debug still use session APIs) ─

// ── 6. Global user search (autocomplete master list + wiring) ────────────
/**
 * Combine unique user display names from live active sessions and all loaded audits.
 * Sessions: session.user.name. Audits: parseAuditDetails(audit).user and audit.performedBy.name.
 * @returns {string[]} deduplicated, sorted (locale-aware)
 */
function buildMasterUserList() {
    var seen = Object.create(null);
    var out = [];
    function addName(s) {
        if (s === undefined || s === null) return;
        var t = typeof s === 'string' ? s.trim() : String(s).trim();
        if (!t) return;
        if (seen[t]) return;
        seen[t] = true;
        out.push(t);
    }
    (lastData.activeSessions || []).forEach(function(session) {
        if (session && session.user && session.user.name != null)
            addName(session.user.name);
    });
    (lastData.aud || []).forEach(function(audit) {
        var detailsObj = parseAuditDetails(audit);
        if (detailsObj && detailsObj.user != null)
            addName(typeof detailsObj.user === 'string' ? detailsObj.user : String(detailsObj.user));
        if (audit.performedBy && typeof audit.performedBy === 'object' && audit.performedBy.name != null)
            addName(audit.performedBy.name);
    });
    out.sort(function(a, b) { return a.localeCompare(b, undefined, { sensitivity: 'base' }); });
    znMasterUserList = out;
    return out;
}

/**
 * Build unique region names from live active sessions and audit data.
 * Sessions: session.actualRegion.name. Audits: actualRegion.name or connectServer.
 * @returns {string[]} deduplicated, sorted (locale-aware)
 */
function buildMasterRegionList() {
    var seen = Object.create(null);
    var out = [];
    function addName(s) {
        if (s === undefined || s === null) return;
        var t = typeof s === 'string' ? s.trim() : String(s).trim();
        if (!t) return;
        if (seen[t]) return;
        seen[t] = true;
        out.push(t);
    }
    (lastData.activeSessions || []).forEach(function(session) {
        if (session && session.actualRegion && session.actualRegion.name != null)
            addName(session.actualRegion.name);
    });
    (lastData.aud || []).forEach(function(audit) {
        if (audit.actualRegion && audit.actualRegion.name != null)
            addName(audit.actualRegion.name);
    });
    out.sort(function(a, b) { return a.localeCompare(b, undefined, { sensitivity: 'base' }); });
    znMasterRegionList = out;
    return out;
}

/** Set global user scope and re-render session- and audit-scoped widgets (not license / region-health KPI). */
function applyGlobalUserFilter(selectedUserName) {
    try {
        if (selectedUserName === undefined || selectedUserName === null || String(selectedUserName).trim() === '') {
            window.selectedDashboardUser = null;
        } else {
            window.selectedDashboardUser = String(selectedUserName).trim();
        }
    } catch (e) {
        window.selectedDashboardUser = null;
    }
    var statusEl = document.getElementById('debug-status');
    if (Array.isArray(lastData.ses)) {
        try { renderDashboardFast(lastData.lic, lastData.ses, statusEl); } catch (e2) {
            console.warn('[ZN] renderDashboardFast after user filter:', e2);
        }
    }
    if (!lastData.auditFetchPending && Array.isArray(lastData.aud)) {
        try { applyTimeFilter(activePeriod); } catch (e3) {
            console.warn('[ZN] applyTimeFilter after user filter:', e3);
        }
    }
}

/** Set global region scope and re-render session- and audit-scoped widgets. */
function applyGlobalRegionFilter(selectedRegionName) {
    try {
        if (selectedRegionName === undefined || selectedRegionName === null || String(selectedRegionName).trim() === '') {
            window.selectedDashboardRegion = null;
        } else {
            window.selectedDashboardRegion = String(selectedRegionName).trim();
        }
    } catch (e) {
        window.selectedDashboardRegion = null;
    }
    var statusEl = document.getElementById('debug-status');
    if (Array.isArray(lastData.ses)) {
        try { renderDashboardFast(lastData.lic, lastData.ses, statusEl); } catch (e2) {
            console.warn('[ZN] renderDashboardFast after region filter:', e2);
        }
    }
    if (!lastData.auditFetchPending && Array.isArray(lastData.aud)) {
        try { applyTimeFilter(activePeriod); } catch (e3) {
            console.warn('[ZN] applyTimeFilter after region filter:', e3);
        }
    }
}

(function wireGlobalUserSearch() {
    var input = document.getElementById('global-user-input');
    var listEl = document.getElementById('autocomplete-results');
    var clearBtn = document.getElementById('clear-user-search');
    var wrap = document.querySelector('.global-user-search .autocomplete-wrapper');
    if (!input || !listEl) return;

    var maxSuggest = 80;

    function hideResults() {
        listEl.classList.add('hidden');
        listEl.innerHTML = '';
    }

    function showClear(show) {
        if (!clearBtn) return;
        clearBtn.classList.toggle('hidden', !show);
    }

    input.addEventListener('input', function() {
        var raw = input.value;
        var q = raw.trim().toLowerCase();
        if (!q) {
            hideResults();
            showClear(false);
            applyGlobalUserFilter(null);
            return;
        }
        var master = znMasterUserList.length ? znMasterUserList : buildMasterUserList();
        var matches = [];
        for (var i = 0; i < master.length && matches.length < maxSuggest; i++) {
            if (master[i].toLowerCase().indexOf(q) !== -1) matches.push(master[i]);
        }
        if (matches.length === 0) {
            hideResults();
            return;
        }
        listEl.innerHTML = '';
        matches.forEach(function(name) {
            var li = document.createElement('li');
            li.setAttribute('role', 'option');
            li.tabIndex = -1;
            li.textContent = name;
            listEl.appendChild(li);
        });
        listEl.classList.remove('hidden');
    });

    listEl.addEventListener('click', function(e) {
        var li = e.target.closest('li');
        if (!li || !listEl.contains(li)) return;
        var name = li.textContent || '';
        input.value = name;
        hideResults();
        showClear(true);
        applyGlobalUserFilter(name);
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', function() {
            input.value = '';
            hideResults();
            showClear(false);
            applyGlobalUserFilter(null);
            input.focus();
        });
    }

    document.addEventListener('mousedown', function(e) {
        if (!wrap || wrap.contains(e.target)) return;
        hideResults();
    });
}());

(function wireGlobalRegionSearch() {
    var input = document.getElementById('region-filter-input');
    var listEl = document.getElementById('region-autocomplete-results');
    var clearBtn = document.getElementById('clear-region-search');
    var wrap = document.querySelector('.global-region-search .autocomplete-wrapper');
    if (!input || !listEl) return;

    var maxSuggest = 80;

    function hideResults() {
        listEl.classList.add('hidden');
        listEl.innerHTML = '';
    }

    function showClear(show) {
        if (!clearBtn) return;
        clearBtn.classList.toggle('hidden', !show);
    }

    input.addEventListener('input', function() {
        var raw = input.value;
        var q = raw.trim().toLowerCase();
        if (!q) {
            hideResults();
            showClear(false);
            applyGlobalRegionFilter(null);
            return;
        }
        var master = znMasterRegionList.length ? znMasterRegionList : buildMasterRegionList();
        var matches = [];
        for (var i = 0; i < master.length && matches.length < maxSuggest; i++) {
            if (master[i].toLowerCase().indexOf(q) !== -1) matches.push(master[i]);
        }
        if (matches.length === 0) {
            hideResults();
            return;
        }
        listEl.innerHTML = '';
        matches.forEach(function(name) {
            var li = document.createElement('li');
            li.setAttribute('role', 'option');
            li.tabIndex = -1;
            li.textContent = name;
            listEl.appendChild(li);
        });
        listEl.classList.remove('hidden');
    });

    listEl.addEventListener('click', function(e) {
        var li = e.target.closest('li');
        if (!li || !listEl.contains(li)) return;
        var name = li.textContent || '';
        input.value = name;
        hideResults();
        showClear(true);
        applyGlobalRegionFilter(name);
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', function() {
            input.value = '';
            hideResults();
            showClear(false);
            applyGlobalRegionFilter(null);
            input.focus();
        });
    }

    document.addEventListener('mousedown', function(e) {
        if (!wrap || wrap.contains(e.target)) return;
        hideResults();
    });
}());

function closeInsightDrawer() {
    var bd = document.getElementById('insight-drawer-backdrop');
    if (bd) bd.classList.remove('is-open');
}

/**
 * Opens the Insight side-drawer (Sprints 1 & 2).
 * Shows a full-width "Recommended Action" alert box, a search input,
 * and a filterable table. Row clicks apply the global user filter.
 *
 * @param {Object[]} data      - rows from insightRows* helpers
 * @param {string}   title     - short insight name, e.g. "Always-On Violation"
 * @param {string}   description - recommended action text
 * @param {string[]} columns   - ordered column keys for the table
 * @param {string}   severity  - 'amber' | 'blue' (default 'blue')
 */
function openInsightDrawer(data, title, description, columns, severity) {
    var rows = data || [];
    var backdrop = document.getElementById('insight-drawer-backdrop');
    var titleEl  = document.getElementById('insight-drawer-title');
    var recEl    = document.getElementById('insight-drawer-recommended');
    var searchEl = document.getElementById('insight-drawer-search');
    var tableEl  = document.getElementById('insight-drawer-table');
    if (!backdrop || !titleEl || !recEl || !searchEl || !tableEl) return;

    titleEl.textContent = 'Insight: ' + (title || 'Details');

    // Recommended Action alert box
    var sev = severity || 'blue';
    recEl.className = 'insight-drawer-recommended' + (sev === 'amber' ? ' severity-amber' : '');
    if (description) {
        recEl.innerHTML =
            '<div class="insight-drawer-recommended-label">Recommended Action:</div>' +
            '<div class="insight-drawer-recommended-body">' +
            escapeHtmlAttr(description) + '</div>';
        recEl.style.display = '';
    } else {
        recEl.innerHTML = '';
        recEl.style.display = 'none';
    }

    searchEl.value = '';

    function renderTable(filter) {
        var lc = (filter || '').toLowerCase();
        var filtered = lc
            ? rows.filter(function(row) {
                return columns.some(function(c) {
                    var v = row && row[c];
                    return v && String(v).toLowerCase().indexOf(lc) !== -1;
                });
              })
            : rows;
        if (filtered.length === 0) {
            tableEl.innerHTML =
                '<p style="color:#94a3b8;font-style:italic;padding:12px 0">No matching records.</p>';
            return;
        }
        var thead = '<thead><tr>' + columns.map(function(c) {
            return '<th>' + escapeHtmlAttr(String(c)) + '</th>';
        }).join('') + '</tr></thead>';
        var tbody = '<tbody>' + filtered.map(function(row) {
            var userVal = (row && (row['User'] || row['Asset Name'])) || '';
            return '<tr class="insight-drawer-row" data-user="' + escapeHtmlAttr(String(userVal)) + '">' +
                columns.map(function(c) {
                    var v = row && row[c];
                    return '<td>' + escapeHtmlAttr(v === undefined || v === null ? '' : String(v)) + '</td>';
                }).join('') + '</tr>';
        }).join('') + '</tbody>';
        tableEl.innerHTML = '<table class="insight-drawer-table">' + thead + tbody + '</table>';
    }

    renderTable('');
    backdrop.classList.add('is-open');

    // Search live-filter (Sprint 1)
    searchEl.oninput = function() { renderTable(searchEl.value.trim()); };

    // Row drill-down → global user filter (Sprint 2)
    tableEl.onclick = function(e) {
        var tr = e.target.closest('tr.insight-drawer-row');
        if (!tr) return;
        var user = tr.getAttribute('data-user');
        if (!user) return;
        closeInsightDrawer();
        var input = document.getElementById('global-user-input');
        if (input) {
            input.value = user;
            var clearBtn = document.getElementById('clear-user-search');
            if (clearBtn) clearBtn.classList.remove('hidden');
        }
        applyGlobalUserFilter(user);
    };
}

function fireInsightCardAction(card) {
    if (!card || !card.getAttribute) return;
    var kind = card.getAttribute('data-insight-card');
    if (!kind) return;
    var ses = filterSessionsByDashboardUser(lastData.ses || []);
    var aud = lastData.aud || [];
    var period = activePeriod;

    if (kind === 'always-on') {
        openInsightDrawer(
            insightRowsAlwaysOnViolations(filterSessionsByDashboardFilters(ses)),
            'Always-On Violation',
            'Verify whether these users are in an approved exception group. If not, update the Connect policy so Always-On is required for their segment.',
            ['User', 'Asset', 'Status'],
            'amber'
        );
    } else if (kind === 'region-routing') {
        openInsightDrawer(
            insightRowsSubOptimalRouting(filterSessionsByDashboardFilters(ses)),
            'Sub-optimal Routing',
            'Review regional routing and policy for the listed users. Align actual region with desired region where possible to reduce latency.',
            ['User', 'Desired Region', 'Actual Region'],
            'blue'
        );
    } else if (kind === 'legacy-clients') {
        openInsightDrawer(
            insightRowsLegacyClients(filterSessionsByDashboardFilters(ses)),
            'Legacy Clients',
            'Plan upgrades to v4.0.0 or newer so clients receive security patches and supported features.',
            ['Asset Name', 'Current Version', 'OS'],
            'amber'
        );
    } else if (kind === 'degraded-health') {
        openInsightDrawer(
            insightRowsDegradedAssetHealth(filterSessionsByDashboardFilters(ses)),
            'Degraded Asset Health',
            'Investigate endpoint network state, reboot behavior, and agent install health for the listed users.',
            ['User', 'External IP', 'Last Seen'],
            'amber'
        );
    } else if (kind === 'connection-flapping') {
        openInsightDrawer(
            insightRowsConnectionFlapping(filterAuditsByDashboardFilters(aud), period),
            'Connection Flapping',
            'Review recent audits for these accounts. Check for unstable networks, credential prompts, or policy changes causing repeated sign-ins.',
            ['User', 'Date', 'Reconnect Count'],
            'amber'
        );
    }
}

// CSP-safe delegated handlers (no inline onclick — portal script-src blocks them)
(function wireCspSafeDelegatedClicks() {
    var tbody = document.getElementById('sessions-tbody');
    if (tbody) {
        tbody.addEventListener('click', function(e) {
            var tr = e.target.closest('tr[data-session-idx]');
            if (!tr || tr.classList.contains('empty-row')) return;
            openSessionModal(tr);
        });
        tbody.addEventListener('keydown', function(e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            var tr = e.target.closest('tr[data-session-idx]');
            if (!tr || tr.classList.contains('empty-row')) return;
            e.preventDefault();
            openSessionModal(tr);
        });
    }
    var insightsList = document.getElementById('insights-list');
    if (insightsList) {
        insightsList.addEventListener('click', function(e) {
            var card = e.target.closest('[data-insight-card]');
            if (!card || !insightsList.contains(card)) return;
            e.preventDefault();
            e.stopPropagation();
            fireInsightCardAction(card);
        });
        insightsList.addEventListener('keydown', function(e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            var card = e.target.closest('[data-insight-card]');
            if (!card || !insightsList.contains(card)) return;
            e.preventDefault();
            e.stopPropagation();
            fireInsightCardAction(card);
        });
    }
}());

// ── 7a. Universal Debug Modal (dedicated overlay + accordion) ─────────────
// openDebugModal(widgetName, apiEndpoint, dataArray, dateKey, prependHtml?)
//   widgetName   – human title shown in the modal header
//   apiEndpoint  – e.g. '/api/v1/audit'  (displayed as "GET <endpoint>")
//   dataArray    – the exact filtered/deduped array that produced the widget number
//   dateKey      – reserved for future use (oldest-record probes)
//   prependHtml  – optional HTML injected before the JSON accordion list
function closeDebugModal() {
    var overlay = document.getElementById('debug-modal-overlay');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
}

function openDebugModal(widgetName, apiEndpoint, dataArray, dateKey, prependHtml) {
    var arr = dataArray || [];
    var overlay = document.getElementById('debug-modal-overlay');
    var titleEl = document.getElementById('debug-modal-title-text');
    var apiEl = document.getElementById('debug-modal-api');
    var recEl = document.getElementById('debug-modal-records');
    var prependEl = document.getElementById('debug-modal-prepend');
    var listEl = document.getElementById('debug-accordion-list');
    if (!overlay || !titleEl || !listEl) return;

    titleEl.textContent = widgetName + ' — Debug';
    if (apiEl) apiEl.textContent = 'GET ' + apiEndpoint;
    if (recEl) recEl.textContent = String(arr.length);
    if (prependEl) prependEl.innerHTML = prependHtml || '';

    var bodyHtml;
    if (arr.length === 0) {
        bodyHtml = '<li class="debug-accordion-item">' +
            '<p style="color:#94a3b8;font-style:italic;padding:12px 16px;margin:0">No data available.</p></li>';
    } else {
        bodyHtml = arr.map(function(item, i) {
            var summary = item._label ||
                (item.name) ||
                (item.user && (item.user.name || item.user)) ||
                (item.asset && item.asset.name) ||
                (item.performedBy && item.performedBy.name) ||
                (item.username) ||
                (item.ruleName || item.policyName || item.rule || item.policy) ||
                ('Record ' + (i + 1));
            var json = JSON.stringify(item, null, 2)
                .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            return '<li class="debug-accordion-item">' +
                '<div class="debug-accordion-header">' + escapeHtmlAttr(String(summary).substring(0, 72)) + '</div>' +
                '<div class="debug-accordion-body"><pre><code>' + json + '</code></pre></div>' +
                '</li>';
        }).join('');
    }

    listEl.innerHTML = bodyHtml;
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
}

/** Per-widget debug: same datasets as header click handlers (see wire() below). */
var ZN_DEBUG_HEADER_CONFIG = [
    { id: 'header-license', title: 'License Capacity', api: '/api/v1/licenses', dateKey: 'createdAt',
        getData: function() { return lastData.lic ? [lastData.lic] : []; } },
    { id: 'header-kpi-sessions', title: 'Overall Sessions', api: '/api/v1/connect/sessions', dateKey: 'timestamp',
        getData: function() { return filterSessionsByDashboardFilters(lastData.ses || []); } },
    { id: 'header-region-health', title: 'Region Health', api: '/api/v1/audit', dateKey: 'timestamp',
        getData: function() { return filterAuditsByDashboardFilters(lastData.aud || []); } },
    { id: 'header-posture', title: 'POSTURE', api: '/api/v1/connect/sessions', dateKey: 'timestamp',
        getData: function() { return lastData.activeSessions || []; } },
    { id: 'header-audit-chart', title: 'Audit Activity', api: '/api/v1/audit', dateKey: 'timestamp',
        getData: function() { return filterAuditsByDashboardFilters(lastData.aud || []); } },
    { id: 'header-insights', title: 'INSIGHTS', api: '/api/v1/audit', dateKey: 'timestamp',
        getData: function() { return filterAuditsByDashboardFilters(lastData.aud || []); } },
    { id: 'header-map', title: 'Connectivity Map', api: '/api/v1/sessions', dateKey: 'timestamp',
        getData: function() { return filterSessionsByDashboardFilters(lastData.ses || []); } },
    { id: 'header-versions', title: 'Connect Versions (live active sessions)', api: '/api/v1/connect/sessions', dateKey: 'timestamp',
        getData: function() { return filterActiveSessionsForDashboardFilters(lastData.activeSessions || []); } },
    { id: 'header-os', title: 'OS Distribution (asset.operatingSystem · active sessions)', api: '/api/v1/connect/sessions', dateKey: 'timestamp',
        getData: function() { return filterActiveSessionsForDashboardFilters(lastData.activeSessions || []); } },
    { id: 'header-regions', title: 'Regions Load (Session End Events · types 97-99)', api: '/api/v1/audit', dateKey: 'timestamp',
        getData: function() { return filterAuditsByDashboardFilters(lastData.aud || []); } },
    { id: 'header-policy', title: 'Policy Names by Hits (uacName · type 96)', api: '/api/v1/audit', dateKey: 'timestamp',
        getData: function() { return filterAuditsByDashboardFilters(lastData.aud || []); } },
    { id: 'header-audit-types', title: 'Audit Operations (30-day window)', api: '/api/v1/audit', dateKey: 'timestamp',
        getData: function() { return filterAuditsByDashboardFilters(lastData.aud || []); } },
    { id: 'header-conn-time', special: 'connTime' }
];

function injectDashboardDebugTriggers() {
    ZN_DEBUG_HEADER_CONFIG.forEach(function(cfg) {
        var headerEl = document.getElementById(cfg.id);
        if (!headerEl) return;
        var root = headerEl.closest('.card, .chart-card, .map-card, .insights-card, .filter-bar-card');
        if (!root || root.querySelector('.debug-trigger')) return;
        var tr = document.createElement('div');
        tr.className = 'debug-trigger';
        tr.title = 'View Raw Data';
        tr.innerHTML = '<code>&lt;/&gt;</code>';
        tr.setAttribute('data-debug-header-id', cfg.id);
        root.appendChild(tr);
    });
}

(function wireDebugModalUi() {
    var overlay = document.getElementById('debug-modal-overlay');
    if (!overlay || overlay.dataset.znDebugWired) return;
    overlay.dataset.znDebugWired = '1';

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeDebugModal();
    });
    var closeBtn = document.getElementById('debug-modal-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeDebugModal);

    var listEl = document.getElementById('debug-accordion-list');
    if (listEl) {
        listEl.addEventListener('click', function(e) {
            var h = e.target.closest('.debug-accordion-header');
            if (!h || !listEl.contains(h)) return;
            var item = h.closest('.debug-accordion-item');
            var body = item && item.querySelector('.debug-accordion-body');
            if (body) body.classList.toggle('is-expanded');
        });
    }

    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Escape') return;
        if (overlay.classList.contains('is-open')) closeDebugModal();
    });

    document.addEventListener('click', function(e) {
        var tr = e.target.closest('.debug-trigger');
        if (!tr) return;
        e.preventDefault();
        e.stopPropagation();
        var hid = tr.getAttribute('data-debug-header-id');
        var cfg = ZN_DEBUG_HEADER_CONFIG.filter(function(c) { return c.id === hid; })[0];
        if (!cfg) return;
        if (cfg.special === 'connTime') {
            openOverallConnectedTimeDebugModal();
            return;
        }
        openDebugModal(cfg.title, cfg.api, cfg.getData(), cfg.dateKey);
    });
}());

injectDashboardDebugTriggers();

// ── Shim: legacy callers (map click handlers) keep working unchanged ──────
function openDataModal(title, rows) {
    // Hide meta strip — these calls pass pre-shaped data with no endpoint info
    var metaEl = document.getElementById('modal-meta');
    if (metaEl) metaEl.style.display = 'none';

    document.getElementById('modal-title').textContent = title;

    if (!rows || rows.length === 0) {
        document.getElementById('modal-body').innerHTML =
            '<p style="color:#94a3b8;font-style:italic;padding:12px 0">No data available.</p>';
        document.getElementById('modal-backdrop').classList.add('open');
        return;
    }

    var html = rows.map(function(row, i) {
        var summary = row._label ||
            (row.name || (row.user && (row.user.name || row.user)) ||
             (row.performedBy && row.performedBy.name) || 'Record ' + (i + 1));
        var json = JSON.stringify(row, null, 2);
        return '<details style="margin-bottom:6px;border-bottom:1px solid #f1f5f9;padding-bottom:6px">' +
            '<summary style="cursor:pointer;font-size:0.78rem;color:#334155;font-weight:600;' +
            'padding:4px 0;list-style:none;display:flex;align-items:center;gap:6px">' +
            '<span style="font-size:0.65rem;color:#94a3b8">▶</span>' +
            String(summary).substring(0, 72) + '</summary>' +
            '<pre style="font-size:0.68rem;color:#475569;margin:6px 0 0 16px;' +
            'overflow-x:auto;white-space:pre-wrap;line-height:1.5">' +
            json.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') +
            '</pre></details>';
    }).join('');

    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal-backdrop').classList.add('open');
}

// ── Wire clickable widget headers → Universal Debug Modal ──────────────────
(function() {
    function wire(id, fn) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    }

    // ── KPI tiles ──────────────────────────────────────────────────────────
    wire('header-license', function() {
        var arr = lastData.lic ? [lastData.lic] : [];
        openDebugModal('License Capacity', '/api/v1/licenses', arr, 'createdAt');
    });

    // Click the big number to open the drawer; title text is freely selectable.
    wire('kpi-sessions-trigger', function() { openSessionsDrawer(); });
    wire('kpi-regions-trigger',  function() { openRegionHealthDrawer(); });
    wire('kpi-posture-trigger',  function() { openPostureDrawer(); });

    // ── Charts & panels ────────────────────────────────────────────────────
    wire('header-audit-chart', function() {
        openDebugModal('Audit Activity', '/api/v1/audit', lastData.aud || [], 'timestamp');
    });

    wire('header-insights', function() {
        openDebugModal('INSIGHTS', '/api/v1/audit', lastData.aud || [], 'timestamp');
    });

    var insightsGuideBtn = document.getElementById('btn-insights-logic-guide');
    if (insightsGuideBtn) {
        insightsGuideBtn.addEventListener('click', function(ev) {
            ev.stopPropagation();
            ev.preventDefault();
            openInsightsLogicGuideModal();
        });
    }

    // ── 5-column row ───────────────────────────────────────────────────────
    wire('header-versions', function() {
        openConnectVersionsDrawer(''); // Open with all versions initially
    });

    wire('header-regions', function() {
        openDebugModal('Regions Load (Session End Events · types 97-99)', '/api/v1/audit', lastData.aud || [], 'timestamp');
    });

    wire('header-policy', function() {
        openDebugModal('Policy Names by Hits (uacName · type 96)', '/api/v1/audit', lastData.aud || [], 'timestamp');
    });

    wire('header-conn-time', function() {
        openOverallConnectedTimeDebugModal();
    });

    wire('header-audit-types', function() {
        openDebugModal('Audit Operations (30-day window)', '/api/v1/audit', lastData.aud || [], 'timestamp');
    });

    wire('header-os', function() {
        openDebugModal('OS Distribution (asset.operatingSystem · active sessions)', '/api/v1/connect/sessions',
            lastData.activeSessions || [], 'timestamp');
    });

    // ── Map row ────────────────────────────────────────────────────────────
    wire('header-map', function() {
        openDebugModal('Connectivity Map', '/api/v1/sessions', lastData.ses || [], 'timestamp');
    });

}());

(function wireActivityExplorerControls() {
    var modeSel = document.getElementById('activity-mode-select');
    if (modeSel) {
        modeSel.addEventListener('change', function() {
            activityChartMode = modeSel.value || 'connect';
            if (lastData.aud && Array.isArray(lastData.aud)) {
                try { renderActivityExplorerChart(lastData.aud, activePeriod); }
                catch (err) { console.error('[ZN] Activity chart:', err); }
            }
        });
    }
    var pillHost = document.getElementById('activity-range-pills');
    if (pillHost) {
        pillHost.querySelectorAll('.activity-range-pill').forEach(function(btn) {
            btn.addEventListener('click', async function() {
                var v = parseInt(btn.getAttribute('data-days'), 10);
                if (v === 7 || v === 14 || v === 30) dauChartRangeDays = v;
                pillHost.querySelectorAll('.activity-range-pill').forEach(function(b) {
                    b.classList.toggle('is-active', b === btn);
                });

                // For 14-day or 30-day views, wait for the background fetch if it isn't done yet
                if ((v === 14 || v === 30) && !isFullAuditLoaded && backgroundAuditPromise) {
                    var overlay = document.getElementById('audit-range-loading-overlay');
                    if (overlay) overlay.classList.add('is-active');
                    try { await backgroundAuditPromise; } catch (e) { /* handled in background */ }
                    if (overlay) overlay.classList.remove('is-active');
                }

                if (lastData.aud && Array.isArray(lastData.aud)) {
                    try { renderActivityExplorerChart(lastData.aud, activePeriod); }
                    catch (err) { console.error('[ZN] Activity chart:', err); }
                }
            });
        });
    }
}());

(function wireDauChartHtmlLegendClicks() {
    var host = document.getElementById('dau-chart-legend');
    if (!host || host.dataset.znLegendWired) return;
    host.dataset.znLegendWired = '1';
    host.addEventListener('click', function(e) {
        var btn = e.target.closest('.dau-legend-toggle');
        if (!btn || !host.contains(btn)) return;
        e.preventDefault();
        var chart = auditChartInstance;
        if (!chart) return;
        var idx = parseInt(btn.getAttribute('data-dataset-index'), 10);
        if (isNaN(idx)) return;
        var on = !chart.isDatasetVisible(idx);
        chart.setDatasetVisibility(idx, on);
        chart.update();
    });
}());

(function wireAuditOperationsDrilldownAndInspect() {
    var card = document.getElementById('card-audit-types');
    if (card && !card.dataset.znAuditOpDrillWired) {
        card.dataset.znAuditOpDrillWired = '1';
        card.addEventListener('click', function(e) {
            var row = e.target.closest('.audit-op-line--clickable');
            if (!row || !card.contains(row)) return;
            var idx = parseInt(row.getAttribute('data-audit-op-def-index'), 10);
            if (isNaN(idx) || !AUDIT_OPERATIONS_ROW_DEFS[idx]) return;
            var def = AUDIT_OPERATIONS_ROW_DEFS[idx];
            openAuditOperationCategoryModal(cleanAuditTypeDisplayName(def.label), def);
        });
    }

    var modalBody = document.getElementById('modal-body');
    var modalBackdrop = document.getElementById('modal-backdrop');
    if (modalBackdrop && modalBody && !modalBackdrop.dataset.znAuditInspectWired) {
        modalBackdrop.dataset.znAuditInspectWired = '1';
        modalBackdrop.addEventListener('click', function(e) {
            var btn = e.target.closest('.audit-drill-inspect-btn');
            if (!btn || !modalBody.contains(btn)) return;
            e.preventDefault();
            e.stopPropagation();
            var idx = parseInt(btn.getAttribute('data-audit-event-index'), 10);
            var ev = znAuditDrillRecentEvents[idx];
            if (!ev) return;
            var title = document.getElementById('modal-title');
            var prefix = title && title.textContent ? String(title.textContent).trim() : 'Audit Detail';
            openJsonInspector('Event Details · ' + prefix, [ev]);
        });
    }
}());

// ── 7b. Session detail modal (row click) ─────────────────────────────────
function openSessionModal(tr) {
    var session = tr._sessionData;
    if (!session) return;
    // Hide the debug meta strip — row clicks show a kv-table, not a debug view
    var metaEl = document.getElementById('modal-meta');
    if (metaEl) metaEl.style.display = 'none';
    document.getElementById('modal-title').textContent =
        safe(userName(session)) + ' → ' + safe(assetName(session));

    // Flatten nested object to key-value rows
    function flatten(obj, prefix) {
        var rows = [];
        Object.keys(obj || {}).forEach(function(k) {
            var key = prefix ? prefix + '.' + k : k;
            var val = obj[k];
            if (val && typeof val === 'object' && !Array.isArray(val)) {
                rows = rows.concat(flatten(val, key));
            } else {
                rows.push([key, val === null || val === undefined ? 'N/A' : String(val)]);
            }
        });
        return rows;
    }

    var kvRows = flatten(session, '');
    document.getElementById('modal-body').innerHTML =
        '<table class="kv-table">' +
        kvRows.map(function(r) {
            return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>';
        }).join('') +
        '</table>';

    document.getElementById('modal-backdrop').classList.add('open');
}

function closeModal() {
    document.getElementById('modal-backdrop').classList.remove('open');
    var detailsModal = document.getElementById('detailsModal');
    if (detailsModal) detailsModal.classList.remove('modal--wide-connectivity');
}

document.getElementById('modal-close-btn').addEventListener('click', closeModal);
document.getElementById('modal-backdrop').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
});

// ── PDF Export ──────────────────────────────────────────────────────────────
(function() {
    var btn = document.getElementById('export-pdf-btn');
    if (!btn) return;

    btn.addEventListener('click', function() {
        exportDashboardPDF();
    });

    function exportDashboardPDF() {
        var btn = document.getElementById('export-pdf-btn');

        // Show generating state
        btn.disabled = true;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="animation:znSpin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Generating…';

        // Inject print styles
        var styleId = 'zn-pdf-print-style';
        var existing = document.getElementById(styleId);
        if (existing) existing.remove();

        var style = document.createElement('style');
        style.id = styleId;
        style.textContent =
            '@keyframes znSpin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }' +
            '@media print {' +
            '  @page { size: A4 landscape; margin: 12mm 10mm; }' +
            '  #dashboard-page-header, #export-pdf-btn, .debug-bar, .dashboard-auth-gate, .modal, #modal-backdrop { display: none !important; }' +
            '  body, html { background: #fff !important; }' +
            '  .content { padding: 0 !important; gap: 12px !important; overflow: visible !important; }' +
            '  .zn-pdf-title { display: block !important; }' +
            '  .kpi-card, .dau-chart-card, .insights-card, .connectivity-map-card, .section-card, .filter-bar-card { break-inside: avoid; page-break-inside: avoid; }' +
            '  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }' +
            '  canvas { max-width: 100% !important; height: auto !important; }' +
            '}';
        document.head.appendChild(style);

        // Insert a print-only title row
        var titleBanner = document.getElementById('zn-pdf-title-banner');
        if (!titleBanner) {
            titleBanner = document.createElement('div');
            titleBanner.id = 'zn-pdf-title-banner';
            titleBanner.className = 'zn-pdf-title';
            titleBanner.style.cssText = 'display:none; margin-bottom:12px; padding-bottom:10px; border-bottom:2px solid #e2e8f0;';
            titleBanner.innerHTML = [
                '<div style="display:flex;align-items:center;justify-content:space-between;">',
                '  <div style="display:flex;align-items:center;gap:10px;">',
                '    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00df9a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">',
                '      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>',
                '      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
                '    </svg>',
                '    <span style="font-size:18px;font-weight:700;color:#0f172a;">Zero Networks — Connect Dashboard</span>',
                '  </div>',
                '  <span style="font-size:11px;color:#64748b;" id="zn-pdf-date"></span>',
                '</div>',
            ].join('');
            var container = document.getElementById('dashboard-container');
            if (container) container.prepend(titleBanner);
        }

        // Set current date/time
        var dateEl = document.getElementById('zn-pdf-date');
        if (dateEl) {
            dateEl.textContent = 'Generated: ' + new Date().toLocaleString();
        }

        // Trigger print after a short delay to let the DOM settle
        setTimeout(function() {
            window.print();

            // Restore button after dialog closes
            var restoreBtn = function() {
                btn.disabled = false;
                btn.innerHTML = [
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">',
                    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>',
                    '<polyline points="14 2 14 8 20 8"/>',
                    '<line x1="12" y1="18" x2="12" y2="12"/>',
                    '<line x1="9" y1="15" x2="15" y2="15"/>',
                    '</svg> Export PDF',
                ].join('');
            };

            // afterprint fires when print dialog is dismissed
            window.addEventListener('afterprint', restoreBtn, { once: true });
            // Safety fallback in case afterprint doesn't fire
            setTimeout(restoreBtn, 5000);
        }, 300);
    }
}());

// ── Region Health / Info Drawer ────────────────────────────────────────────
// Tracks which single region the Info drawer is scoped to (null = Health / all-regions mode).
var _activeRegionInfoName = null;

function openRegionHealthDrawer() {
    var bd = document.getElementById('region-health-drawer-backdrop');
    if (!bd) return;
    _activeRegionInfoName = null;
    var titleEl = document.getElementById('rh-drawer-title');
    if (titleEl) titleEl.textContent = 'Region Health';
    var statsEl = document.getElementById('rh-drawer-stats');
    if (statsEl) statsEl.style.gridTemplateColumns = 'repeat(2,1fr)';
    renderRegionHealthDrawerContent();
    bd.classList.add('is-open');
}
function closeRegionHealthDrawer() {
    var bd = document.getElementById('region-health-drawer-backdrop');
    if (bd) bd.classList.remove('is-open');
    _activeRegionInfoName = null;
}

/**
 * Open the Region Info drawer drilled into a specific region (from the Region Load widget).
 */
function openRegionInfoDrawer(regionName) {
    var bd = document.getElementById('region-health-drawer-backdrop');
    if (!bd) return;
    _activeRegionInfoName = regionName;
    var titleEl = document.getElementById('rh-drawer-title');
    if (titleEl) titleEl.textContent = 'Region Info';
    var statsEl = document.getElementById('rh-drawer-stats');
    if (statsEl) statsEl.style.gridTemplateColumns = 'repeat(1,1fr)';
    renderRegionInfoDrawerContent(regionName);
    bd.classList.add('is-open');
}

/**
 * Render the Region Info drawer for a single specific region.
 * Shows: session count for that region, the region's table row, and users with active sessions.
 */
function renderRegionInfoDrawerContent(regionName) {
    // ── Active sessions for this region ──────────────────────────────────
    // The Region Load widget may use server names (e.g. "elkg-znvpn2") as region keys
    // when the connectServer field isn't in the static map. Match by actualRegion.name
    // first, then fall back to server.name so drill-downs always find sessions.
    var regionSessions = (lastData.activeSessions || []).filter(function(s) {
        var rn = s.actualRegion && s.actualRegion.name != null ? String(s.actualRegion.name).trim() : '';
        if (rn === regionName) return true;
        var sn = s.server && s.server.name ? String(s.server.name).trim() : '';
        return sn === regionName;
    });

    // ── Top stat: sessions only ───────────────────────────────────────────
    var statsEl = document.getElementById('rh-drawer-stats');
    if (statsEl) {
        statsEl.innerHTML =
            '<div class="ses-stat-box">' +
                '<div class="ses-stat-num green">' + regionSessions.length + '</div>' +
                '<div class="ses-stat-label">Active Sessions</div>' +
            '</div>';
    }

    // ── Hide distributions ────────────────────────────────────────────────
    var distEl = document.getElementById('rh-drawer-distributions');
    if (distEl) distEl.innerHTML = '';

    // ── Region table (single row) ─────────────────────────────────────────
    var listEl = document.getElementById('rh-drawer-list');
    if (!listEl) return;

    var geoLabel = getGeoLocationForRegion(regionName);
    var healthCounts = countRegionHealthEvents30d(regionName);
    var hasEvents = healthCounts.down > 0 || healthCounts.recovered > 0;
    var eventDisplay = hasEvents
        ? '<span style="color:#f59e0b;font-weight:600;">' + healthCounts.down + '</span>' +
          '<span style="color:#94a3b8;font-size:0.8em;margin:0 2px">/</span>' +
          '<span style="color:#22c55e;font-weight:600;">' + healthCounts.recovered + '</span>'
        : '<span style="color:#64748b">0 / 0</span>';

    var serverOsList = getServerOsListForRegion(regionName);
    var serverOsHtml = serverOsList.map(function(item) {
        return '<div class="region-server-name">' + escapeHtmlAttr(item.server) + '</div>' +
               '<div class="region-server-os">' + escapeHtmlAttr(item.os) + '</div>';
    }).join('');

    var regionTableHtml =
        '<div class="ses-row ses-row--header" style="grid-template-columns:1.4fr 1.2fr 1fr;background:#f8fafc;border-bottom:2px solid #e2e8f0;font-size:0.72rem;font-weight:700;color:#64748b;letter-spacing:0.06em;text-transform:uppercase;">' +
            '<div class="ses-row-name" style="padding:8px 12px;">Region Name</div>' +
            '<div class="ses-row-asset" style="text-align:left;padding:8px 12px;">Geo Location</div>' +
            '<div class="ses-row-asset" style="text-align:center;padding:8px 12px;">Down/Recovery (30d)</div>' +
        '</div>' +
        '<div class="ses-row" style="grid-template-columns:1.4fr 1.2fr 1fr">' +
            '<div class="ses-row-name">' +
                '<div class="region-primary-name">' + escapeHtmlAttr(regionName) + '</div>' +
                serverOsHtml +
            '</div>' +
            '<div class="ses-row-asset" style="text-align:left;display:flex;align-items:flex-start;gap:5px;padding-top:2px;">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:2px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
                '<span style="color:#374151;font-size:0.82rem;">' + escapeHtmlAttr(geoLabel) + '</span>' +
            '</div>' +
            '<div class="ses-row-asset" style="text-align:center">' + eventDisplay + '</div>' +
        '</div>';

    // ── Users table ───────────────────────────────────────────────────────
    var usersHtml =
        '<div style="margin-top:20px;">' +
            '<div style="font-size:0.72rem;font-weight:700;color:#64748b;letter-spacing:0.06em;text-transform:uppercase;padding:8px 12px;background:#f8fafc;border-top:2px solid #e2e8f0;border-bottom:2px solid #e2e8f0;">Users with Active Sessions</div>';

    if (!regionSessions.length) {
        usersHtml += '<div class="ses-empty" style="padding:12px 16px;color:#94a3b8;font-size:0.85rem;">No active sessions on this region.</div>';
    } else {
        usersHtml +=
            '<div class="ses-row ses-row--header" style="grid-template-columns:1.5fr 1.5fr 1fr;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:0.72rem;font-weight:700;color:#64748b;letter-spacing:0.06em;text-transform:uppercase;">' +
                '<div class="ses-row-name" style="padding:8px 12px;">User</div>' +
                '<div class="ses-row-asset" style="text-align:left;padding:8px 12px;">Device</div>' +
                '<div class="ses-row-asset" style="text-align:left;padding:8px 12px;">Client Version</div>' +
            '</div>' +
            regionSessions.map(function(s) {
                var user    = escapeHtmlAttr(userName(s) || '\u2014');
                var device  = escapeHtmlAttr(assetName(s) || '\u2014');
                var ver     = escapeHtmlAttr(clientVer(s) != null ? String(clientVer(s)) : '\u2014');
                return '<div class="ses-row" style="grid-template-columns:1.5fr 1.5fr 1fr;">' +
                    '<div class="ses-row-name">' + user + '</div>' +
                    '<div class="ses-row-asset" style="text-align:left;">' + device + '</div>' +
                    '<div class="ses-row-asset" style="text-align:left;">' + ver + '</div>' +
                    '</div>';
            }).join('');
    }
    usersHtml += '</div>';

    listEl.innerHTML = regionTableHtml + usersHtml;
}

/**
 * Count down (351) and recovery (352) events in the last 30 days for a specific region
 * using the full paginated audit stream (lastData.aud).
 * Returns { down: number, recovered: number }.
 */
function countRegionHealthEvents30d(regionName) {
    if (!regionName) return { down: 0, recovered: 0 };

    var allAudits = lastData.aud || [];
    var cutoff = Date.now() - 30 * 86400 * 1000;
    var down = 0;
    var recovered = 0;

    allAudits.forEach(function(item) {
        var ts = getAuditItemTs(item);
        if (ts == null || ts < cutoff) return;

        var n = auditTypeToNum(item);
        if (n !== AUDIT_TYPE_REGION_DOWN && n !== AUDIT_TYPE_REGION_RECOVERED) return;

        var resolvedRegion = resolveRegionNameFromAudit(item);
        if (resolvedRegion !== regionName) return;

        if (n === AUDIT_TYPE_REGION_DOWN) {
            down++;
        } else {
            recovered++;
        }
    });
    return { down: down, recovered: recovered };
}

function getGatewayOsForRegion(regionName) {
    if (!regionName) return 'Unknown';
    
    var serverOsMap = Object.create(null);
    (lastData.activeSessions || []).forEach(function(s) {
        var rn = s.actualRegion && s.actualRegion.name != null ? String(s.actualRegion.name).trim() : '';
        if (rn !== regionName) return;
        
        var serverName = s.server && s.server.name ? String(s.server.name).trim() : null;
        if (!serverName) return;
        
        // Try to get OS from server object or asset object
        var os = null;
        if (s.server && s.server.operatingSystem) {
            os = String(s.server.operatingSystem).trim();
        } else if (s.asset && s.asset.operatingSystem) {
            os = String(s.asset.operatingSystem).trim();
        }
        
        if (os) {
            serverOsMap[serverName] = os;
        }
    });
    
    return formatGatewayOsDisplay(serverOsMap);
}

function formatGatewayOsDisplay(serverOsMap) {
    var servers = Object.keys(serverOsMap);
    if (!servers.length) return 'Unknown';
    
    var osCounts = Object.create(null);
    servers.forEach(function(serverName) {
        var os = serverOsMap[serverName];
        osCounts[os] = (osCounts[os] || 0) + 1;
    });
    
    var osEntries = Object.keys(osCounts).map(function(os) {
        var count = osCounts[os];
        return count > 1 ? os + ' (x' + count + ')' : os;
    });
    
    return osEntries.join(', ') || 'Unknown';
}

function mapConnectServerToRegionName(serverName) {
    // Map server names to their parent region names
    var serverToRegionMap = {
        'colo-connect-1': 'COLO',
        'il-sapir-connect-1': 'IL',
        'il-sapir-connect-2': 'IL Backup'
    };
    return serverToRegionMap[serverName] || serverName;
}

function buildServerToRegionMapping() {
    var mapping = Object.create(null);
    (lastData.activeSessions || []).forEach(function(s) {
        if (s.server && s.server.name && s.actualRegion && s.actualRegion.name) {
            mapping[s.server.name] = s.actualRegion.name;
        }
    });
    return mapping;
}

function resolveRegionNameFromAudit(item) {
    // For session end events, prioritize connectServer since actualRegion may be missing
    var csLab = connectServerRegionLabel(parseAuditDetailsJsonLoose(item));
    if (csLab) return mapConnectServerToRegionName(csLab);
    
    // Fallback to actualRegion.name if available
    var arNm = item.actualRegion && item.actualRegion.name != null ? String(item.actualRegion.name).trim() : '';
    if (arNm) return arNm;
    
    // Last resort: server.name
    var srvNm = item.server && item.server.name != null ? String(item.server.name).trim() : '';
    if (srvNm) return mapConnectServerToRegionName(srvNm);
    
    return null;
}

function getConnectServersForRegion(regionName) {
    if (!regionName) return '';
    
    var servers = [];
    (lastData.activeSessions || []).forEach(function(s) {
        var rn = s.actualRegion && s.actualRegion.name != null ? String(s.actualRegion.name).trim() : '';
        if (rn === regionName && s.server && s.server.name) {
            var serverName = String(s.server.name).trim();
            if (servers.indexOf(serverName) === -1) {
                servers.push(serverName);
            }
        }
    });
    
    return servers.join(', ');
}

function getServerOsListForRegion(regionName) {
    if (!regionName) return [];
    
    var serverOsList = [];
    var serverOsMap = Object.create(null);
    
    (lastData.activeSessions || []).forEach(function(s) {
        var rn = s.actualRegion && s.actualRegion.name != null ? String(s.actualRegion.name).trim() : '';
        if (rn !== regionName) return;
        
        var serverName = s.server && s.server.name ? String(s.server.name).trim() : null;
        if (!serverName) return;
        
        var os = null;
        if (s.server && s.server.operatingSystem) {
            os = String(s.server.operatingSystem).trim();
        } else if (s.asset && s.asset.operatingSystem) {
            os = String(s.asset.operatingSystem).trim();
        }
        
        if (!serverOsMap[serverName]) {
            serverOsMap[serverName] = os || 'Unknown';
        }
    });
    
    Object.keys(serverOsMap).forEach(function(serverName) {
        serverOsList.push({
            server: serverName,
            os: serverOsMap[serverName]
        });
    });
    
    return serverOsList;
}

function renderRegionHealthDrawerContent() {
    // Primary source: regions API (guarantees all regions shown, not just ones with active sessions)
    var regionNames = Object.create(null);
    (lastData.regions || []).forEach(function(r) {
        if (r.name) regionNames[String(r.name).trim()] = true;
    });

    // Supplement with any regions seen in live sessions or audit events (catches edge cases)
    (lastData.activeSessions || []).forEach(function(s) {
        var rn = s.actualRegion && s.actualRegion.name != null ? String(s.actualRegion.name).trim() : '';
        if (rn) regionNames[rn] = true;
    });
    (lastData.regionHealthEvents || []).forEach(function(item) {
        var ar = item.actualRegion && item.actualRegion.name != null ? String(item.actualRegion.name).trim() : '';
        if (ar) { regionNames[ar] = true; return; }
        var cs = connectServerFromAuditDetailsStrict(item);
        if (cs) regionNames[cs] = true;
    });

    // Sort to match API order where possible, otherwise alphabetical
    var apiOrder = (lastData.regions || []).map(function(r) { return r.name; });
    var regions = Object.keys(regionNames).sort(function(a, b) {
        var ai = apiOrder.indexOf(a);
        var bi = apiOrder.indexOf(b);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return a.localeCompare(b);
    });

    // ── Top stats ─────────────────────────────────────────────────────────
    var statsEl = document.getElementById('rh-drawer-stats');
    if (statsEl) {
        var totalRegions = regions.length;
        var totalSessions = (lastData.activeSessions || []).length;

        statsEl.innerHTML = [
            { num: totalRegions,  numCls: '',      label: 'Total Regions' },
            { num: totalSessions, numCls: 'green', label: 'Active Sessions' }
        ].map(function(d) {
            return '<div class="ses-stat-box">' +
                '<div class="ses-stat-num ' + d.numCls + '">' + d.num + '</div>' +
                '<div class="ses-stat-label">' + escapeHtmlAttr(d.label) + '</div>' +
                '</div>';
        }).join('');
    }

    // ── Session-load-by-region distribution bar ───────────────────────────
    var distEl = document.getElementById('rh-drawer-distributions');
    if (distEl) {
        var regionLoad = Object.create(null);
        (lastData.activeSessions || []).forEach(function(s) {
            var rn = (s.actualRegion && s.actualRegion.name) || 'Unknown';
            regionLoad[rn] = (regionLoad[rn] || 0) + 1;
        });
        distEl.innerHTML = '<div><div class="dist-row-label">Session Load by Region</div>' +
            buildDistBar(regionLoad, null) + '</div>';
    }

    // ── Region list ───────────────────────────────────────────────────────
    var listEl = document.getElementById('rh-drawer-list');
    if (!listEl) return;

    if (!regions.length) {
        listEl.innerHTML = '<div class="ses-empty">No region data yet — waiting for session or audit sync.</div>';
        return;
    }

    // ── Table header ─────────────────────────────────────────────────────────
    var header = '<div class="ses-row ses-row--header" style="grid-template-columns:1.4fr 1.2fr 1fr;background:#f8fafc;border-bottom:2px solid #e2e8f0;font-size:0.72rem;font-weight:700;color:#64748b;letter-spacing:0.06em;text-transform:uppercase;">' +
        '<div class="ses-row-name" style="padding:8px 12px;">Region Name</div>' +
        '<div class="ses-row-asset" style="text-align:left;padding:8px 12px;">Geo Location</div>' +
        '<div class="ses-row-asset" style="text-align:center;padding:8px 12px;">Down/Recovery (30d)</div>' +
        '</div>';

    listEl.innerHTML = header + regions.map(function(regionName) {
        // Geo location: try to resolve from server IPs captured in geoLabelCache,
        // then fall back to deriving from the region name itself.
        var geoLabel = getGeoLocationForRegion(regionName);

        // Down / recovery counts from the paginated audit stream (types 351 / 352)
        var healthCounts = countRegionHealthEvents30d(regionName);
        var hasEvents = healthCounts.down > 0 || healthCounts.recovered > 0;
        var eventDisplay = hasEvents
            ? '<span style="color:#f59e0b;font-weight:600;">' + healthCounts.down + '</span>' +
              '<span style="color:#94a3b8;font-size:0.8em;margin:0 2px">/</span>' +
              '<span style="color:#22c55e;font-weight:600;">' + healthCounts.recovered + '</span>'
            : '<span style="color:#64748b">0 / 0</span>';

        // Get server and OS information for this region
        var serverOsList = getServerOsListForRegion(regionName);
        var serverOsHtml = serverOsList.map(function(item) {
            return '<div class="region-server-name">' + escapeHtmlAttr(item.server) + '</div>' +
                   '<div class="region-server-os">' + escapeHtmlAttr(item.os) + '</div>';
        }).join('');

        return '<div class="ses-row ses-row--region-drill cursor-pointer" data-region-name="' + escapeHtmlAttr(regionName) + '" style="grid-template-columns:1.4fr 1.2fr 1fr">' +
            '<div class="ses-row-name">' +
                '<div class="region-primary-name">' + escapeHtmlAttr(regionName) + '</div>' +
                serverOsHtml +
            '</div>' +
            '<div class="ses-row-asset" style="text-align:left;display:flex;align-items:flex-start;gap:5px;padding-top:2px;">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:2px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
                '<span style="color:#374151;font-size:0.82rem;">' + escapeHtmlAttr(geoLabel) + '</span>' +
            '</div>' +
            '<div class="ses-row-asset" style="text-align:center">' + eventDisplay + '</div>' +
            '</div>';
    }).join('');
}

/**
 * Return the geo location string for a region.
 * Uses the ipAddress from the regions API → resolveIpLocationLabel (geo cache).
 * Falls back to a loading placeholder if the lookup is still in flight.
 * Also handles the case where regionName is actually a server name (as used by Region Load).
 */
function getGeoLocationForRegion(regionName) {
    if (!regionName) return '—';

    var regionObj = (lastData.regions || []).find(function(r) {
        return r.name === regionName;
    });

    // If not found directly, check if regionName is a server name — resolve the parent region
    if (!regionObj) {
        var serverToRegion = buildServerToRegionMapping();
        var resolvedRegionName = serverToRegion[regionName];
        if (resolvedRegionName) {
            regionObj = (lastData.regions || []).find(function(r) {
                return r.name === resolvedRegionName;
            });
        }
    }

    if (!regionObj || !regionObj.ipAddress) return '—';

    var ip = String(regionObj.ipAddress).trim();
    if (!ip) return '—';

    // Check if already resolved in cache
    if (Object.prototype.hasOwnProperty.call(geoLabelCache, ip)) {
        return geoLabelCache[ip] || ip;  // show raw IP if label came back null
    }

    // Not yet in cache — kick off async lookup and return a placeholder.
    // Re-render the drawer once the lookup completes using whichever mode is active.
    resolveIpLocationLabel(ip).then(function() {
        var bd = document.getElementById('region-health-drawer-backdrop');
        if (!bd || !bd.classList.contains('is-open')) return;
        if (_activeRegionInfoName) {
            renderRegionInfoDrawerContent(_activeRegionInfoName);
        } else {
            renderRegionHealthDrawerContent();
        }
    });

    return '\u2026'; // ellipsis while resolving
}

/**
 * Pre-warm geo lookups for all region IPs so the drawer shows real labels immediately.
 * Called once after regions are loaded.
 */
function prefetchRegionGeoLabels() {
    var regions = lastData.regions || [];
    if (!regions.length) return;
    regions.forEach(function(r) {
        if (r.ipAddress) resolveIpLocationLabel(String(r.ipAddress).trim());
    });
}

// ── Posture Drawer ─────────────────────────────────────────────────────────

function openPostureDrawer() {
    var bd = document.getElementById('posture-drawer-backdrop');
    if (!bd) return;
    renderPostureDrawerContent();
    bd.classList.add('is-open');
}
function closePostureDrawer() {
    var bd = document.getElementById('posture-drawer-backdrop');
    if (bd) bd.classList.remove('is-open');
}

function renderPostureDrawerContent() {
    var sessions     = lastData.activeSessions || [];
    var totalMon     = sessions.length;
    var alwaysOnCnt  = 0;
    var afterBootCnt = 0;
    sessions.forEach(function(s) {
        if (s.alwaysOn === true) alwaysOnCnt++;
        if (postureKpiConnectAfterBootTrue(s)) afterBootCnt++;
    });

    // ── Top stats ─────────────────────────────────────────────────────────
    var statsEl = document.getElementById('posture-drawer-stats');
    if (statsEl) {
        statsEl.innerHTML = [
            { num: totalMon,     numCls: '',      label: 'Total Monitored' },
            { num: alwaysOnCnt,  numCls: 'green', label: 'Always On' },
            { num: afterBootCnt, numCls: 'indigo', label: 'Connect After Boot' }
        ].map(function(d) {
            return '<div class="ses-stat-box">' +
                '<div class="ses-stat-num ' + d.numCls + '">' + d.num + '</div>' +
                '<div class="ses-stat-label">' + escapeHtmlAttr(d.label) + '</div>' +
                '</div>';
        }).join('');
    }

    // ── Source/Domain distribution bar ────────────────────────────────────
    var distEl = document.getElementById('posture-drawer-distributions');
    if (distEl) {
        var sourceCounts = Object.create(null);
        var hasSource = false;
        sessions.forEach(function(s) {
            var src = (s.user && s.user.source) || (s.user && s.user.identityProvider) || '';
            if (src) hasSource = true;
            var key = src || 'Unknown';
            sourceCounts[key] = (sourceCounts[key] || 0) + 1;
        });
        var barLabel = hasSource ? 'Source / Domain' : 'OS Family';
        var barCounts = sourceCounts;
        if (!hasSource) {
            barCounts = Object.create(null);
            sessions.forEach(function(s) {
                var os = osMajorFamilyFromExactString(sessionAssetOperatingSystemExact(s));
                barCounts[os] = (barCounts[os] || 0) + 1;
            });
        }
        distEl.innerHTML = '<div><div class="dist-row-label">' + escapeHtmlAttr(barLabel) + '</div>' +
            buildDistBar(barCounts, hasSource ? null : OS_COLORS) + '</div>';
    }

    // ── Asset list ────────────────────────────────────────────────────────
    var listEl = document.getElementById('posture-drawer-list');
    if (!listEl) return;

    if (!sessions.length) {
        listEl.innerHTML = '<div class="ses-empty">No active sessions.</div>';
        return;
    }

    listEl.innerHTML = sessions.map(function(s, i) {
        var asset    = escapeHtmlAttr(assetName(s) || '\u2014');
        var user     = escapeHtmlAttr(userName(s)  || '\u2014');
        var os       = escapeHtmlAttr(osMajorFamilyFromExactString(sessionAssetOperatingSystemExact(s)));
        var flags    = [];
        if (s.alwaysOn === true) flags.push('Always On');
        if (postureKpiConnectAfterBootTrue(s)) flags.push('After Boot');
        var posture  = escapeHtmlAttr(flags.length ? flags.join(', ') : 'None');
        var badgeCls = flags.length ? 'badge-green' : 'badge-slate';
        return '<div class="ses-row" data-ses-drawer-idx="' + i + '" style="grid-template-columns:1fr 1fr auto auto">' +
            '<div class="ses-row-name">'  + asset + '</div>' +
            '<div class="ses-row-asset">' + user  + '</div>' +
            '<div class="ses-row-asset">' + os    + '</div>' +
            '<span class="badge ' + badgeCls + '">' + posture + '</span>' +
            '</div>';
    }).join('');
    listEl._znVisibleSessions = sessions;
}

// ── Connect Versions Drawer ────────────────────────────────────────────────

var connectVersionsDrawerState = {
    clickedVersion: '',
    filteredSessions: [],
    searchQuery: ''
};

function openConnectVersionsDrawer(clickedVersion) {
    var bd = document.getElementById('connect-versions-drawer-backdrop');
    if (!bd) return;
    
    // Store the clicked version and reset search
    connectVersionsDrawerState.clickedVersion = clickedVersion || '';
    connectVersionsDrawerState.searchQuery = '';
    
    var searchInput = document.getElementById('cv-drawer-search');
    if (searchInput) searchInput.value = '';
    
    renderConnectVersionsDrawerContent();
    
    // Ensure event listeners are wired after render
    setTimeout(function() {
        wireConnectVersionsDrawerInteractions();
    }, 0);
    
    bd.classList.add('is-open');
}

function closeConnectVersionsDrawer() {
    var bd = document.getElementById('connect-versions-drawer-backdrop');
    if (bd) bd.classList.remove('is-open');
}

function renderConnectVersionsDrawerContent() {
    var clickedVersion = connectVersionsDrawerState.clickedVersion;
    var searchQuery = connectVersionsDrawerState.searchQuery.toLowerCase();
    
    // Update drawer title
    var titleEl = document.getElementById('cv-drawer-title');
    if (titleEl) {
        titleEl.textContent = 'Version: ' + (clickedVersion ? 'v' + clickedVersion : '[All]');
    }
    
    // Filter sessions by clicked version
    var allSessions = lastData.activeSessions || [];
    var versionFilteredSessions = [];
    
    if (clickedVersion) {
        allSessions.forEach(function(session) {
            var ver = clientVer(session);
            if (!ver) return;
            ver = String(ver).trim().replace(/^v/i, '');
            if (ver === clickedVersion) {
                versionFilteredSessions.push(session);
            }
        });
    } else {
        versionFilteredSessions = allSessions.slice(); // All sessions if no version specified
    }
    
    // Apply search filter
    var filteredSessions = versionFilteredSessions;
    if (searchQuery) {
        filteredSessions = versionFilteredSessions.filter(function(session) {
            var userName = sessionUserLabelForPosture(session).toLowerCase();
            return userName.includes(searchQuery);
        });
    }
    
    connectVersionsDrawerState.filteredSessions = filteredSessions;
    
    // ── Top metrics ───────────────────────────────────────────────────────
    var statsEl = document.getElementById('cv-drawer-stats');
    if (statsEl) {
        var totalDevices = filteredSessions.length;
        var activeCount = 0;
        var offlineCount = 0;
        
        filteredSessions.forEach(function(session) {
            if (session.connectionState === 1) {
                activeCount++;
            } else if (session.connectionState === 0) {
                offlineCount++;
            }
        });
        
        statsEl.innerHTML = [
            { num: totalDevices, numCls: '', label: 'Total Devices' },
            { num: activeCount, numCls: 'green', label: 'Active' },
            { num: offlineCount, numCls: 'amber', label: 'Offline <span class="tooltip-trigger">?</span>' }
        ].map(function(d) {
            return '<div class="ses-stat-box">' +
                '<div class="ses-stat-num ' + d.numCls + '">' + d.num + '</div>' +
                '<div class="ses-stat-label">' + d.label + '</div>' +
                '</div>';
        }).join('');
    }
    
    // ── Distribution bars ─────────────────────────────────────────────────
    var distEl = document.getElementById('cv-drawer-distributions');
    if (distEl) {
        // Operating Systems distribution
        var osCounts = Object.create(null);
        filteredSessions.forEach(function(session) {
            var os = sessionAssetOperatingSystemExact(session) || 'Unknown';
            var osFamily = osMajorFamilyFromExactString(os);
            osCounts[osFamily] = (osCounts[osFamily] || 0) + 1;
        });
        
        // Regions distribution
        var regionCounts = Object.create(null);
        filteredSessions.forEach(function(session) {
            var region = (session.actualRegion && session.actualRegion.name) || 'Unknown';
            regionCounts[region] = (regionCounts[region] || 0) + 1;
        });
        
        distEl.innerHTML = 
            '<div><div class="dist-row-label">Operating Systems</div>' +
            buildDistBar(osCounts, OS_COLORS) + '</div>' +
            '<div><div class="dist-row-label">Regions</div>' +
            buildDistBar(regionCounts, null) + '</div>';
    }
    
    // ── Session table ─────────────────────────────────────────────────────
    var listEl = document.getElementById('cv-drawer-list');
    if (!listEl) return;
    
    if (!filteredSessions.length) {
        listEl.innerHTML = '<div class="ses-empty">No sessions found for this version.</div>';
        return;
    }
    
    listEl.innerHTML = filteredSessions.map(function(session, i) {
        var userName = sessionUserLabelForPosture(session);
        var os = sessionAssetOperatingSystemExact(session) || 'Unknown';
        
        return '<div class="ses-row ses-row--cv-drill cursor-pointer" data-user-name="' + escapeHtmlAttr(userName) + '" style="grid-template-columns:1.5fr 1fr">' +
            '<div class="ses-row-name">' + escapeHtmlAttr(userName) + '</div>' +
            '<div class="ses-row-asset">' + escapeHtmlAttr(os) + '</div>' +
            '</div>';
    }).join('');
}

function wireConnectVersionsDrawerInteractions() {
    // Wire search input
    var searchInput = document.getElementById('cv-drawer-search');
    if (searchInput && !searchInput.dataset.znCvSearchWired) {
        searchInput.dataset.znCvSearchWired = '1';
        searchInput.addEventListener('input', function() {
            connectVersionsDrawerState.searchQuery = searchInput.value || '';
            renderConnectVersionsDrawerContent();
        });
    }
    
    // Wire row drill-down clicks
    var listEl = document.getElementById('cv-drawer-list');
    if (listEl && !listEl.dataset.znCvDrillWired) {
        listEl.dataset.znCvDrillWired = '1';
        listEl.addEventListener('click', function(e) {
            var row = e.target.closest('.ses-row--cv-drill[data-user-name]');
            if (!row || !listEl.contains(row)) return;
            var userName = row.getAttribute('data-user-name');
            if (!userName || !String(userName).trim()) return;
            
            // Close drawer
            closeConnectVersionsDrawer();
            
            // Set global user filter
            var userFilterInput = document.getElementById('user-filter-input');
            if (userFilterInput) {
                userFilterInput.value = userName;
                // Trigger global dashboard re-render
                applyGlobalUserFilter();
            }
        });
    }
}

// ── OS Distribution Drawer ─────────────────────────────────────────────────

var osDrawerState = {
    clickedOsFamily: '',
    filteredSessions: [],
    searchQuery: ''
};

function openOsDrawer(clickedOsFamily) {
    var bd = document.getElementById('os-drawer-backdrop');
    if (!bd) return;
    
    // Store the clicked OS family and reset search
    osDrawerState.clickedOsFamily = clickedOsFamily || '';
    osDrawerState.searchQuery = '';
    
    var searchInput = document.getElementById('os-drawer-search');
    if (searchInput) searchInput.value = '';
    
    renderOsDrawerContent();
    
    // Ensure event listeners are wired after render
    setTimeout(function() {
        wireOsDrawerInteractions();
    }, 0);
    
    bd.classList.add('is-open');
}

function closeOsDrawer() {
    var bd = document.getElementById('os-drawer-backdrop');
    if (bd) bd.classList.remove('is-open');
}

function renderOsDrawerContent() {
    var clickedOsFamily = osDrawerState.clickedOsFamily;
    var searchQuery = osDrawerState.searchQuery.toLowerCase();
    
    // Update drawer title
    var titleEl = document.getElementById('os-drawer-title');
    if (titleEl) {
        titleEl.textContent = 'OS: ' + (clickedOsFamily || '[All]');
    }
    
    // Filter sessions by clicked OS family
    var allSessions = lastData.activeSessions || [];
    var osFilteredSessions = [];
    
    if (clickedOsFamily) {
        allSessions.forEach(function(session) {
            var exact = sessionAssetOperatingSystemExact(session);
            if (!exact) return;
            var fam = osMajorFamilyFromExactString(exact);
            if (fam === clickedOsFamily) {
                osFilteredSessions.push(session);
            }
        });
    } else {
        osFilteredSessions = allSessions.slice(); // All sessions if no OS specified
    }
    
    // Apply search filter
    var filteredSessions = osFilteredSessions;
    if (searchQuery) {
        filteredSessions = osFilteredSessions.filter(function(session) {
            var userName = sessionUserLabelForPosture(session).toLowerCase();
            return userName.includes(searchQuery);
        });
    }
    
    osDrawerState.filteredSessions = filteredSessions;
    
    // ── Top metrics ───────────────────────────────────────────────────────
    var statsEl = document.getElementById('os-drawer-stats');
    if (statsEl) {
        var totalDevices = filteredSessions.length;
        var activeCount = 0;
        var offlineCount = 0;
        
        filteredSessions.forEach(function(session) {
            if (session.connectionState === 1) {
                activeCount++;
            } else if (session.connectionState === 0) {
                offlineCount++;
            }
        });
        
        statsEl.innerHTML = [
            { num: totalDevices, numCls: '', label: 'Total Devices' },
            { num: activeCount, numCls: 'green', label: 'Active' },
            { num: offlineCount, numCls: 'amber', label: 'Offline' }
        ].map(function(d) {
            return '<div class="ses-stat-box">' +
                '<div class="ses-stat-num ' + d.numCls + '">' + d.num + '</div>' +
                '<div class="ses-stat-label">' + d.label + '</div>' +
                '</div>';
        }).join('');
    }
    
    // ── Distribution bars ─────────────────────────────────────────────────
    var distEl = document.getElementById('os-drawer-distributions');
    if (distEl) {
        // Specific OS versions distribution
        var versionCounts = Object.create(null);
        filteredSessions.forEach(function(session) {
            var exact = sessionAssetOperatingSystemExact(session) || 'Unknown';
            versionCounts[exact] = (versionCounts[exact] || 0) + 1;
        });
        
        distEl.innerHTML = 
            '<div><div class="dist-row-label">Specific OS Versions</div>' +
            buildDistBar(versionCounts, OS_COLORS) + '</div>';
    }
    
    // ── Session table ─────────────────────────────────────────────────────
    var listEl = document.getElementById('os-drawer-list');
    if (!listEl) return;
    
    if (!filteredSessions.length) {
        listEl.innerHTML = '<div class="ses-empty">No sessions found for this OS family.</div>';
        return;
    }
    
    listEl.innerHTML = filteredSessions.map(function(session, i) {
        var userName = sessionUserLabelForPosture(session);
        var specificOs = sessionAssetOperatingSystemExact(session) || 'Unknown';
        var connectVersion = clientVer(session);
        var versionDisplay = connectVersion ? 'v' + String(connectVersion).trim().replace(/^v/i, '') : 'Unknown';
        var status = session.connectionState === 1 ? 'Active' : 'Offline';
        var statusClass = session.connectionState === 1 ? 'green' : 'amber';
        
        return '<div class="ses-row ses-row--os-drill cursor-pointer" data-user-name="' + escapeHtmlAttr(userName) + '" style="grid-template-columns:1fr 1fr 1fr 1fr">' +
            '<div class="ses-row-name">' + escapeHtmlAttr(userName) + '</div>' +
            '<div class="ses-row-asset">' + escapeHtmlAttr(specificOs) + '</div>' +
            '<div class="ses-row-asset">' + escapeHtmlAttr(versionDisplay) + '</div>' +
            '<div class="ses-row-asset"><span class="badge ' + statusClass + '">' + escapeHtmlAttr(status) + '</span></div>' +
            '</div>';
    }).join('');
}

function wireOsDrawerInteractions() {
    // Wire search input
    var searchInput = document.getElementById('os-drawer-search');
    if (searchInput && !searchInput.dataset.znOsSearchWired) {
        searchInput.dataset.znOsSearchWired = '1';
        searchInput.addEventListener('input', function() {
            osDrawerState.searchQuery = searchInput.value || '';
            renderOsDrawerContent();
        });
    }
    
    // Wire row drill-down clicks
    var listEl = document.getElementById('os-drawer-list');
    if (listEl && !listEl.dataset.znOsDrillWired) {
        listEl.dataset.znOsDrillWired = '1';
        listEl.addEventListener('click', function(e) {
            var row = e.target.closest('.ses-row--os-drill[data-user-name]');
            if (!row || !listEl.contains(row)) return;
            var userName = row.getAttribute('data-user-name');
            if (!userName || !String(userName).trim()) return;
            
            // Close drawer
            closeOsDrawer();
            
            // Set global user filter
            var userFilterInput = document.getElementById('user-filter-input');
            if (userFilterInput) {
                userFilterInput.value = userName;
                // Trigger global dashboard re-render
                applyGlobalUserFilter();
            }
        });
    }
}

// ── Policy Operations Drawer ───────────────────────────────────────────────

var policyDrawerState = {
    events: [],
    totalCount: 0
};

function openPolicyDrawer(dayLabel, eventsArray) {
    var bd = document.getElementById('policy-drawer-backdrop');
    if (!bd) return;
    
    // Store the events data
    policyDrawerState.events = eventsArray || [];
    policyDrawerState.totalCount = eventsArray ? eventsArray.length : 0;
    
    renderPolicyDrawerContent(dayLabel);
    bd.classList.add('is-open');
}

function closePolicyDrawer() {
    var bd = document.getElementById('policy-drawer-backdrop');
    if (bd) bd.classList.remove('is-open');
}

function renderPolicyDrawerContent(dayLabel) {
    var events = policyDrawerState.events;
    var totalCount = policyDrawerState.totalCount;
    
    // ── Top accumulative metric ───────────────────────────────────────────
    var statsEl = document.getElementById('policy-drawer-stats');
    if (statsEl) {
        statsEl.innerHTML = '<div class="ses-stat-box">' +
            '<div class="ses-stat-num">' + totalCount + '</div>' +
            '<div class="ses-stat-label">Policy Operations' + (dayLabel ? ' on ' + dayLabel : '') + '</div>' +
            '</div>';
    }
    
    // ── Render each event ─────────────────────────────────────────────────
    var metadataEl = document.getElementById('policy-drawer-metadata');
    var detailsEl = document.getElementById('policy-drawer-details');
    
    if (!metadataEl || !detailsEl || !events.length) {
        if (metadataEl) metadataEl.innerHTML = '<div class="ses-empty">No policy events found.</div>';
        if (detailsEl) detailsEl.innerHTML = '';
        return;
    }
    
    var eventsHtml = events.map(function(event, index) {
        return renderPolicyEventCard(event, index);
    }).join('');
    
    metadataEl.innerHTML = eventsHtml;
    detailsEl.innerHTML = '';
}

function renderPolicyEventCard(event, index) {
    var auditType = auditTypeToNum(event);
    var actionBadge = getPolicyActionBadge(auditType);
    var timestamp = getAuditItemTs(event);
    var timeDisplay = timestamp ? new Date(timestamp).toLocaleString() : 'Unknown';
    
    // Extract basic metadata
    var admin = (event.performedBy && event.performedBy.name) || 'Unknown Admin';
    var details = parseAuditDetails(event);
    var policyName = extractPolicyName(details) || 'Unknown Policy';
    
    var cardHtml = '<div class="policy-event-card" data-event-index="' + index + '">' +
        '<div class="policy-event-header">' +
            '<div class="policy-event-meta">' +
                '<div class="policy-event-admin"><strong>Admin:</strong> ' + escapeHtmlAttr(admin) + '</div>' +
                '<div class="policy-event-time"><strong>Time:</strong> ' + escapeHtmlAttr(timeDisplay) + '</div>' +
                '<div class="policy-event-policy"><strong>Policy:</strong> ' + escapeHtmlAttr(policyName) + '</div>' +
            '</div>' +
            '<div class="policy-event-action">' + actionBadge + '</div>' +
        '</div>' +
        '<div class="policy-event-details">' +
            renderPolicyEventDetails(event, details, auditType) +
        '</div>' +
    '</div>';
    
    return cardHtml;
}

function getPolicyActionBadge(auditType) {
    switch (auditType) {
        case 100:
            return '<span class="badge green">Created</span>';
        case 101:
            return '<span class="badge blue">Updated</span>';
        case 102:
            return '<span class="badge red">Deleted</span>';
        default:
            return '<span class="badge slate">Unknown</span>';
    }
}

function extractPolicyName(details) {
    if (!details) return null;
    
    // Try _d.Role.name first
    if (details._d && details._d.Role && details._d.Role.name) {
        return details._d.Role.name;
    }
    
    // Fallback to destinationEntitiesList[0].name
    if (details.destinationEntitiesList && details.destinationEntitiesList.length > 0 && 
        details.destinationEntitiesList[0].name) {
        return details.destinationEntitiesList[0].name;
    }
    
    return null;
}

function renderPolicyEventDetails(event, details, auditType) {
    if (!details || !details._d) {
        return '<div class="policy-details-empty">No detailed information available.</div>';
    }
    
    if (auditType === 101 && details._d.Role && details._d.PrevRole) {
        // Updated event - show diff
        return renderPolicyDiff(details._d.Role, details._d.PrevRole);
    } else if ((auditType === 100 || auditType === 102) && details._d.Role) {
        // Created or Deleted event - show summary
        return renderPolicySummary(details._d.Role, auditType === 100 ? 'created' : 'deleted');
    }
    
    return '<div class="policy-details-fallback">Policy configuration details not available.</div>';
}

function renderPolicySummary(role, action) {
    var summary = [];
    
    if (role.allowedUsers && role.allowedUsers.length > 0) {
        var userNames = role.allowedUsers.map(function(u) { return u.name || 'Unknown'; }).join(', ');
        summary.push('<div><strong>Allowed Users:</strong> ' + role.allowedUsers.length + ' (' + escapeHtmlAttr(userNames) + ')</div>');
    }
    
    if (role.excludedUsers && role.excludedUsers.length > 0) {
        var excludedNames = role.excludedUsers.map(function(u) { return u.name || 'Unknown'; }).join(', ');
        summary.push('<div><strong>Excluded Users:</strong> ' + role.excludedUsers.length + ' (' + escapeHtmlAttr(excludedNames) + ')</div>');
    }
    
    if (role.allowedAssets && role.allowedAssets.length > 0) {
        summary.push('<div><strong>Allowed Assets:</strong> ' + role.allowedAssets.length + ' assets</div>');
    }
    
    if (role.allowedDestinations && role.allowedDestinations.length > 0) {
        var destNames = role.allowedDestinations.map(function(d) { 
            return d.name || d.address || 'Unknown'; 
        }).join(', ');
        summary.push('<div><strong>Allowed Destinations:</strong> ' + escapeHtmlAttr(destNames) + '</div>');
    }
    
    if (role.alwaysOn !== undefined) {
        summary.push('<div><strong>Always On:</strong> ' + (role.alwaysOn ? 'Yes' : 'No') + '</div>');
    }
    
    if (summary.length === 0) {
        return '<div class="policy-summary-empty">No scope information available for this ' + action + ' policy.</div>';
    }
    
    return '<div class="policy-summary"><h4>Policy ' + (action === 'created' ? 'Configuration' : 'Was Configured With') + ':</h4>' + 
           summary.join('') + '</div>';
}

function renderPolicyDiff(currentRole, prevRole) {
    var changes = [];
    
    // Compare allowedUsers
    var userChanges = compareArrays(
        prevRole.allowedUsers || [], 
        currentRole.allowedUsers || [], 
        function(u) { return u.name || u.id || JSON.stringify(u); }
    );
    if (userChanges.added.length > 0) {
        changes.push('<div class="diff-added"><strong>Added Users:</strong> ' + 
                    userChanges.added.map(function(u) { return u.name || 'Unknown'; }).join(', ') + '</div>');
    }
    if (userChanges.removed.length > 0) {
        changes.push('<div class="diff-removed"><strong>Removed Users:</strong> ' + 
                    userChanges.removed.map(function(u) { return u.name || 'Unknown'; }).join(', ') + '</div>');
    }
    
    // Compare allowedDestinations
    var destChanges = compareArrays(
        prevRole.allowedDestinations || [], 
        currentRole.allowedDestinations || [],
        function(d) { return d.name || d.address || JSON.stringify(d); }
    );
    if (destChanges.added.length > 0) {
        changes.push('<div class="diff-added"><strong>Added Destinations:</strong> ' + 
                    destChanges.added.map(function(d) { return d.name || d.address || 'Unknown'; }).join(', ') + '</div>');
    }
    if (destChanges.removed.length > 0) {
        changes.push('<div class="diff-removed"><strong>Removed Destinations:</strong> ' + 
                    destChanges.removed.map(function(d) { return d.name || d.address || 'Unknown'; }).join(', ') + '</div>');
    }
    
    // Compare alwaysOn
    if (prevRole.alwaysOn !== currentRole.alwaysOn) {
        changes.push('<div class="diff-changed"><strong>Always On:</strong> Changed from ' + 
                    (prevRole.alwaysOn ? 'Yes' : 'No') + ' to ' + (currentRole.alwaysOn ? 'Yes' : 'No') + '</div>');
    }
    
    // Compare other boolean/simple fields
    ['connectAfterBoot', 'enabled'].forEach(function(field) {
        if (prevRole[field] !== currentRole[field]) {
            changes.push('<div class="diff-changed"><strong>' + field + ':</strong> Changed from ' + 
                        (prevRole[field] ? 'Yes' : 'No') + ' to ' + (currentRole[field] ? 'Yes' : 'No') + '</div>');
        }
    });
    
    if (changes.length === 0) {
        return '<div class="policy-diff-empty"><h4>What Changed:</h4>Metadata updated (Timestamp/Description or other non-scope changes)</div>';
    }
    
    return '<div class="policy-diff"><h4>What Changed:</h4>' + changes.join('') + '</div>';
}

function compareArrays(prevArray, currentArray, keyExtractor) {
    var prevKeys = prevArray.map(keyExtractor);
    var currentKeys = currentArray.map(keyExtractor);
    
    var added = currentArray.filter(function(item) {
        return prevKeys.indexOf(keyExtractor(item)) === -1;
    });
    
    var removed = prevArray.filter(function(item) {
        return currentKeys.indexOf(keyExtractor(item)) === -1;
    });
    
    return { added: added, removed: removed };
}

// ── Wire all drawer close buttons + backdrop + Escape ─────────────────────
(function() {
    function wireDrawer(backdropId, closeBtnId, closeFn) {
        var bd  = document.getElementById(backdropId);
        var btn = document.getElementById(closeBtnId);
        if (btn) btn.addEventListener('click', closeFn);
        if (bd)  bd.addEventListener('click', function(e) { if (e.target === bd) closeFn(); });
    }
    wireDrawer('sessions-drawer-backdrop',         'sessions-drawer-close',    closeSessionsDrawer);
    wireDrawer('region-health-drawer-backdrop',    'rh-drawer-close',          closeRegionHealthDrawer);
    wireDrawer('posture-drawer-backdrop',          'posture-drawer-close',     closePostureDrawer);
    wireDrawer('connect-versions-drawer-backdrop', 'cv-drawer-close',          closeConnectVersionsDrawer);
    wireDrawer('os-drawer-backdrop',               'os-drawer-close',          closeOsDrawer);
    wireDrawer('policy-drawer-backdrop',           'policy-drawer-close',      closePolicyDrawer);
    wireDrawer('insight-drawer-backdrop',          'insight-drawer-close',     closeInsightDrawer);

    // Wire region health drawer drill-down
    var rhDrawerList = document.getElementById('rh-drawer-list');
    if (rhDrawerList && !rhDrawerList.dataset.znRegionDrillWired) {
        rhDrawerList.dataset.znRegionDrillWired = '1';
        rhDrawerList.addEventListener('click', function(e) {
            var row = e.target.closest('.ses-row--region-drill[data-region-name]');
            if (!row || !rhDrawerList.contains(row)) return;
            var regionName = row.getAttribute('data-region-name');
            if (!regionName || !String(regionName).trim()) return;
            
            closeRegionHealthDrawer();
            
            var regionInput = document.getElementById('region-filter-input');
            if (regionInput) {
                regionInput.value = String(regionName).trim();
                var clearBtn = document.getElementById('clear-region-search');
                if (clearBtn) clearBtn.classList.remove('hidden');
            }
            
            applyGlobalRegionFilter(String(regionName).trim());
        });
    }
    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Escape') return;
        closeSessionsDrawer();
        closeRegionHealthDrawer();
        closePostureDrawer();
        closeInsightDrawer();
    });
}());

(function wireChartDetailPopover() {
    var closeBtn = document.getElementById('chart-detail-popover-close');
    if (closeBtn && !closeBtn.dataset.znWired) {
        closeBtn.dataset.znWired = '1';
        closeBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            closeChartDetailPopover();
        });
    }
    if (!document.documentElement.dataset.znChartPopoverDoc) {
        document.documentElement.dataset.znChartPopoverDoc = '1';
        document.addEventListener('mousedown', function(e) {
            var pop = document.getElementById('chart-detail-popover');
            if (!pop || pop.classList.contains('hidden')) return;
            if (pop.contains(e.target)) return;
            var tt = document.getElementById('chartjs-rich-tooltip');
            if (tt && tt.contains(e.target)) return;
            closeChartDetailPopover();
        }, true);
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') closeChartDetailPopover();
        });
    }
}());

(function wireJsonInspectorUiAndListDrill() {
    var jClose = document.getElementById('json-inspector-close-btn');
    var jBd = document.getElementById('json-inspector-backdrop');
    if (jClose) jClose.addEventListener('click', closeJsonInspector);
    if (jBd) {
        jBd.addEventListener('click', function(e) {
            if (e.target === jBd) closeJsonInspector();
        });
    }

    var pol = document.getElementById('card-policy-rules');
    if (pol && !pol.dataset.jsonInspectWired) {
        pol.dataset.jsonInspectWired = '1';
        pol.addEventListener('click', function(e) {
            var row = e.target.closest('.json-inspect-row[data-json-policy-uac]');
            if (!row || !pol.contains(row)) return;
            var name = row.getAttribute('data-json-policy-uac');
            if (!name) return;
            openJsonInspector('Policy Names by Hits: ' + name,
                filterAuditsByDashboardUser(filterPolicyAuditsByUacName(lastData.aud, activePeriod, name)));
        });
    }

    var ver = document.getElementById('card-versions');
    if (ver && !ver.dataset.jsonInspectWired) {
        ver.dataset.jsonInspectWired = '1';
        ver.addEventListener('click', function(e) {
            var row = e.target.closest('.json-inspect-row[data-json-client-ver]');
            if (!row || !ver.contains(row)) return;
            var v = row.getAttribute('data-json-client-ver');
            if (!v) return;
            openConnectVersionsDrawer(v);
        });
    }

    var os = document.getElementById('card-os-accordion');
    if (os && !os.dataset.osDrawerWired) {
        os.dataset.osDrawerWired = '1';
        os.addEventListener('click', function(e) {
            var row = e.target.closest('.os-family-row[data-os-family]');
            if (!row || !os.contains(row)) return;
            var osFamily = row.getAttribute('data-os-family');
            if (!osFamily) return;
            openOsDrawer(osFamily);
        });
    }

    var reg = document.getElementById('card-regions');
    if (reg && !reg.dataset.regionInfoWired) {
        reg.dataset.regionInfoWired = '1';
        reg.addEventListener('click', function(e) {
            var row = e.target.closest('.json-inspect-row[data-json-region]');
            if (!row || !reg.contains(row)) return;
            var rn = row.getAttribute('data-json-region');
            if (!rn) return;
            openRegionInfoDrawer(rn);
        });
    }

    var acc = document.getElementById('card-os-accordion');
    if (acc && !acc.dataset.jsonInspectWired) {
        acc.dataset.jsonInspectWired = '1';
        acc.addEventListener('click', function(e) {
            var verRow = e.target.closest('.os-json-inspect-version[data-os-exact]');
            if (verRow && acc.contains(verRow)) {
                var exact = verRow.getAttribute('data-os-exact');
                if (exact) {
                    var filteredEx = filterSessionsByOsExactString(
                        filterActiveSessionsForDashboardUser(lastData.activeSessions || []), exact);
                    var mappedEx = filteredEx.map(function(s) {
                        return [
                            userName(s) || '\u2014',
                            clientVer(s) != null ? String(clientVer(s)) : '\u2014'
                        ];
                    });
                    openDynamicTableModal('OS: ' + exact, ['User Name', 'Client Version'], mappedEx);
                }
                return;
            }
            var famHit = e.target.closest('.os-json-inspect-family[data-os-family]');
            if (famHit && acc.contains(famHit) && e.target.closest('.os-acc-summary')) {
                var fam = famHit.getAttribute('data-os-family');
                if (fam) {
                    e.stopPropagation();
                    var filteredFam = filterSessionsForOsWidgetDrill(
                        filterActiveSessionsForDashboardUser(lastData.activeSessions || []), fam);
                    var mappedFam = filteredFam.map(function(s) {
                        return [
                            userName(s) || '\u2014',
                            clientVer(s) != null ? String(clientVer(s)) : '\u2014'
                        ];
                    });
                    openDynamicTableModal('OS: ' + fam, ['User Name', 'Client Version'], mappedFam);
                }
            }
        });
    }
}());

(function wireFormattedTableModalUi() {
    var btn = document.getElementById('formatted-table-modal-close-btn');
    var bd = document.getElementById('formatted-table-modal-backdrop');
    if (btn) btn.addEventListener('click', closeFormattedTableModal);
    if (bd) {
        bd.addEventListener('click', function(e) {
            if (e.target === bd) closeFormattedTableModal();
        });
    }
}());

// ── 8. Map mode toggle ────────────────────────────────────────────────────
document.querySelectorAll('.map-mode-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.map-mode-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        mapMode = btn.dataset.mode;
        if (lastData.ses) {
            try { renderMap(filterSessionsByDashboardFilters(lastData.ses)); }
            catch (e) { console.error('[ZN] map failed:', e); }
        }
    });
});

(function wireMapRecenter() {
    var rec = document.getElementById('map-recenter-btn');
    if (rec) {
        rec.addEventListener('click', function() {
            recenterConnectivityMap();
        });
    }
}());

// ── 9. Period-aware render pass ────────────────────────────────────────────
// Policy hits, Overall Connected Time, and Audit Operations read only lastData.aud (full 30d after pagination).
// applyTimeFilter returns early while auditFetchPending so those widgets never run on a partial fetch.
// Overall Connected Time also merges lastData.ses (live) for in-progress duration once audits are complete.
function renderAuditStreamWidgets(period) {
    var audFilteredScope = filterAuditsByDashboardFilters(lastData.aud);
    try { renderPolicyRulesCard(audFilteredScope, period); }
    catch(e) { console.error('[ZN] policyRulesCard failed:', e); }
    try { renderConnectionTimeCard(audFilteredScope, filterSessionsByDashboardFilters(lastData.ses)); }
    catch(e) { console.error('[ZN] connectionTimeCard failed:', e); }
    try { renderAuditTypesCard(audFilteredScope, period); }
    catch(e) { console.error('[ZN] auditTypesCard failed:', e); }
}

function applyTimeFilter(period) {
    activePeriod = period;

    if (lastData.auditFetchPending) return;

    if (!Array.isArray(lastData.aud)) {
        console.warn('[ZN] applyTimeFilter: lastData.aud is not an array');
        return;
    }

    // ── 1. Re-draw chart (create on first call, update in-place after that) ─
    try {
        renderAuditChart(lastData.aud, period);
    } catch(e) {
        console.error('[ZN] auditChart re-draw failed:', e);
    }

    // ── 2. Connect audit stream stats (logged; KPI tile removed from UI) ─
    var connectBase = lastData.audConnect || [];
    var filtered    = filterByPeriod(connectBase, period);
    console.log('[ZN] connect-audit stream for', period, ':', filtered.length, '/', connectBase.length,
        'connect ·', lastData.aud.length, 'total audit');

    // Active / Offline session KPIs come only from the master sessions list (see applySessionKpisFromMasterList).

    // ── 3. Client Versions + OS chart: live sessions (see renderDashboardFast / fetchSessions path)

    // ── 4. Region Load (audits only) — scoped to selected dashboard user when set ─
    try { renderRegionCard(filterAuditsByDashboardFilters(lastData.aud), period); }
    catch(e) { console.error('[ZN] regionCard failed:', e); }

    // ── 5–6. Policy hits, Overall Connected Time, Audit Types (lastData.aud only, one batch) ─
    renderAuditStreamWidgets(period);

    // ── 7. Insights — session-based cards + connection flapping respect dashboard user when set ─
    if (lastData.lic && lastData.ses) {
        try {
            renderInsights(lastData.lic, filterSessionsByDashboardFilters(lastData.ses), filterAuditsByDashboardFilters(lastData.aud), period);
        } catch(e) { console.error('[ZN] insights re-render failed:', e); }
    }
}


// ── Audit-only re-render (after background pagination completes) ───────────
function reRenderAuditWidgets() {
    try {
        applyTimeFilter(activePeriod);
    } catch (e) {
        console.error('[ZN] reRenderAuditWidgets:', e);
    }
    try { renderRegionHealthKpi(lastData.aud); }
    catch (e) { console.error('[ZN] regionHealthKpi failed:', e); }
    var statusEl = document.getElementById('debug-status');
    if (!statusEl) return;
    statusEl.textContent = 'Last synced: ' + new Date().toLocaleTimeString() +
        ' (' + (lastData.audConnect || []).length + ' connect / ' + (lastData.aud || []).length + ' audit, 30d' +
        (lastData.audHitLimit ? ', pagination cap\u2026' : '') + ')';
    statusEl.style.color = '#00df9a';
}

// ── Live Connect sessions (device posture: versions, OS, always-on, CARB) ─
async function fetchConnectSessions(token) {
    var sesRaw = await fetchAPI(token, ZN_API_BASE + '/api/v1/connect/sessions?_limit=100');
    var out = (sesRaw && (sesRaw.items || sesRaw.sessions || sesRaw.data)) || (Array.isArray(sesRaw) ? sesRaw : []);
    return Array.isArray(out) ? out : [];
}

async function fetchConnectRegions(token) {
    var raw = await fetchAPI(token, ZN_API_BASE + '/api/v1/settings/connect/regions?_limit=100&_offset=0&with_count=true');
    var items = (raw && raw.items) || (Array.isArray(raw) ? raw : []);
    return Array.isArray(items) ? items : [];
}

// ── Empty / error UI (avoid blank or undefined text) ────────────────────────
function renderDashboardDataUnavailable(reason) {
    var msg = String(reason || 'No data available');
    try { setAuditWidgetsLoading(false); } catch (e0) { /* noop */ }
    var auditKpiL = document.getElementById('audit-kpi-loading');
    if (auditKpiL) auditKpiL.classList.remove('is-active');
    var chL = document.getElementById('audit-chart-loading');
    if (chL) chL.classList.remove('is-active');
    var osL = document.getElementById('os-chart-loading');
    if (osL) osL.classList.remove('is-active');

    function ph() {
        return '<div class="metric-placeholder">' + escapeHtmlAttr(msg) + '</div>';
    }

    var kpiLic = document.getElementById('kpi-licenses');
    if (kpiLic) kpiLic.textContent = '\u2014';
    var licBar = document.getElementById('license-bar');
    if (licBar) licBar.style.width = '0%';
    var kpiA = document.getElementById('kpi-active-count');
    var kpiO = document.getElementById('kpi-offline-count');
    if (kpiA) kpiA.textContent = '\u2014';
    if (kpiO) kpiO.textContent = '\u2014';
    var trAct = document.getElementById('trend-active');
    if (trAct) trAct.textContent = msg;
    var regK = document.getElementById('regions-kpi');
    if (regK) regK.textContent = '\u2014';
    var regSub = document.getElementById('regions-subtext');
    if (regSub) regSub.textContent = msg;
    var kpiAo = document.getElementById('kpi-posture-always-on');
    var kpiCab = document.getElementById('kpi-posture-connect-after-boot');
    if (kpiAo) kpiAo.textContent = '\u2014';
    if (kpiCab) kpiCab.textContent = '\u2014';
    var kpiAud = document.getElementById('kpi-audits');
    if (kpiAud) kpiAud.textContent = '\u2014';
    var trAud = document.getElementById('trend-audits');
    if (trAud) trAud.textContent = msg;

    var cv = document.getElementById('card-versions');
    if (cv) cv.innerHTML = ph();
    var cr = document.getElementById('card-regions');
    if (cr) cr.innerHTML = ph();
    var cp = document.getElementById('card-policy-rules');
    if (cp) cp.innerHTML = ph();
    var cct = document.getElementById('card-conn-time');
    if (cct) cct.innerHTML = ph();
    var cat = document.getElementById('card-audit-types');
    if (cat) cat.innerHTML = ph();
    var osAcc = document.getElementById('card-os-accordion');
    if (osAcc) osAcc.innerHTML = ph();

    var ins = document.getElementById('insights-list');
    if (ins) {
        ins.innerHTML = '<li style="color:#94a3b8;font-size:0.8rem">' + escapeHtmlAttr(msg) + '</li>';
    }

    var tbody = document.getElementById('sessions-tbody');
    if (tbody) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="6">' + escapeHtmlAttr(msg) + '</td></tr>';
    }
    var sc = document.getElementById('session-count');
    if (sc) sc.textContent = '';

    try {
        if (auditChartInstance && auditChartInstance.data) {
            auditChartInstance.data.labels = [];
            auditChartInstance.data.datasets = [];
            auditChartInstance.update();
        }
    } catch (e1) { /* noop */ }
    var leg = document.getElementById('dau-chart-legend');
    if (leg) {
        leg.innerHTML = '';
        leg.style.display = 'none';
    }
}

function readStoredZnToken(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get('znTokens', function(result) {
            var le = chrome.runtime && chrome.runtime.lastError;
            if (le) console.warn('[ZN] chrome.storage:', le.message);
            var tokens = (result && result.znTokens) || {};
            var entry = tokens[ZN_PORTAL_HOSTNAME];
            var t = coerceDashBearerToken(entry && entry.token);
            // #region agent log
            try { chrome.runtime.sendMessage({type:'ZN_DBG_717b26',payload:{sessionId:'717b26',location:'dashboard-logic.js:readStoredZnToken',message:'Token lookup complete',data:{hostname:ZN_PORTAL_HOSTNAME,hasToken:!!t,tokenLen:t?t.length:0,capturedAt:(entry&&entry.at)||0,ageMs:entry&&entry.at?(Date.now()-entry.at):null,allHosts:Object.keys(tokens)},hypothesisId:'H-A',timestamp:Date.now()}}); } catch(e) {}
            // #endregion
            if (t) { callback(t); return; }
            // Legacy fallback for installs that still have the old flat znToken key
            try {
                callback(coerceDashBearerToken(localStorage.getItem('znToken')));
            } catch (e) { callback(null); }
        });
    } else {
        try {
            callback(coerceDashBearerToken(localStorage.getItem('znToken')));
        } catch (e2) { callback(null); }
    }
}

// ── 10. Topbar widgets data loader ─────────────────────────────────────────
function loadTopbarWidgets(bearer) {
    if (!bearer) return;

    // User profile → avatar initials + tooltip
    fetchAPI(bearer, ZN_API_BASE + '/api/v1/profile')
        .then(function(profileData) {
            var initialsEl = document.getElementById('topbar-avatar-initials');
            var avatarEl   = document.getElementById('topbar-avatar');
            if (!initialsEl) return;
            var name = (profileData && (profileData.name || (profileData.user && profileData.user.name))) || '';
            if (name) {
                var initials = name.trim().split(/\s+/).map(function(n){ return n[0]; }).join('').toUpperCase().slice(0,2);
                initialsEl.textContent = initials;
                if (avatarEl) avatarEl.title = name;
            }
        })
        .catch(function(){});

    // System health indicator
    fetchAPI(bearer, ZN_API_BASE + '/api/v1/environments/system-health')
        .then(function(healthData) {
            var healthWrap  = document.getElementById('topbar-health');
            var healthDot   = document.getElementById('topbar-health-dot');
            var healthLabel = document.getElementById('topbar-health-label');
            if (!healthWrap) return;
            healthWrap.classList.remove('hidden');
            // response is {hasIssues: bool} or {issues: [...]}
            var hasIssues = healthData && (healthData.hasIssues || (Array.isArray(healthData.issues) && healthData.issues.length > 0) || healthData.has_issues);
            if (hasIssues) {
                if (healthDot)   { healthDot.classList.remove('health-dot-healthy'); healthDot.classList.add('health-dot-unhealthy'); }
                if (healthLabel)   healthLabel.textContent = 'Issues';
                healthWrap.title = 'System Health: Issues detected';
            } else {
                if (healthDot)   { healthDot.classList.remove('health-dot-unhealthy'); healthDot.classList.add('health-dot-healthy'); }
                if (healthLabel)   healthLabel.textContent = 'Healthy';
                healthWrap.title = 'System Health: Healthy';
            }
        })
        .catch(function(){});

    // "System is learning" badge
    fetchAPI(bearer, ZN_API_BASE + '/api/v1/ai/next-batch')
        .then(function(learningData) {
            var badge = document.getElementById('topbar-learning');
            if (!badge) return;
            // response: {nextBatchTime: ...} — badge is visible whenever the endpoint succeeds with a future batch time
            var active = learningData && (learningData.learning_active || learningData.nextBatchTime || learningData.next_batch_time);
            if (active) {
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        })
        .catch(function(){});

    // Help link via Gitbook token
    fetchAPI(bearer, ZN_API_BASE + '/api/v1/gitbook/token')
        .then(function(gitbookData) {
            var helpLink = document.getElementById('topbar-help-link');
            if (!helpLink) return;
            var url = gitbookData && (gitbookData.gitbook_url || gitbookData.url || gitbookData.token_url);
            if (url) helpLink.href = url;
        })
        .catch(function(){});
}

// ── 11. Main data loader ───────────────────────────────────────────────────
// License + sessions first (fast path); paginated audit runs in the background.
async function loadDashboard(token) {
    window.__znDash401Handled = false;

    var statusEl = document.getElementById('debug-status');
    if (statusEl) {
        statusEl.textContent = 'Loading\u2026';
        statusEl.style.color = '#94a3b8';
    }

    var bearer = coerceDashBearerToken(token);
    // #region agent log
    try { chrome.runtime.sendMessage({type:'ZN_DBG_717b26',payload:{sessionId:'717b26',location:'dashboard-logic.js:loadDashboard',message:'loadDashboard called',data:{hasToken:!!bearer,tokenLen:bearer?bearer.length:0,branch:bearer?'fetching':'no-token-gate'},hypothesisId:'H-A-H-D',timestamp:Date.now()}}); } catch(e) {}
    // #endregion
    if (!bearer) {
        showAuthGate('no-token');
        if (statusEl) {
            statusEl.textContent = 'Not signed in';
            statusEl.style.color = '#f87171';
        }
        lastData.auditFetchPending = false;
        lastData.ses = [];
        lastData.lic = null;
        renderDashboardDataUnavailable('No data available');
        return;
    }
    if (!isZeroNetworksPortalAuthOk()) {
        showAuthGate('expired');
        if (statusEl) {
            statusEl.textContent = 'Portal auth not ready';
            statusEl.style.color = '#f87171';
        }
        lastData.auditFetchPending = false;
        renderDashboardDataUnavailable('No data available');
        return;
    }

    hideAuthGate();

    loadTopbarWidgets(bearer);

    lastData.auditFetchPending = true;
    lastData.aud = [];
    lastData.audConnect = [];
    lastData.connTime = {};
    lastData.connTimeCalcByUser = {};
    setAuditWidgetsLoading(true);

    try {
        if (statusEl) statusEl.textContent = 'Loading\u2026 (license, sessions, regions)';
        var phaseFast = await Promise.all([
            fetchAPI(bearer, ZN_API_BASE + '/api/v1/settings/subscriptions/licenses/connect')
                .catch(function(e) {
                    if (e && e.message === ZN_ERR_UNAUTHORIZED) throw e;
                    console.warn('[ZN] License API failed:', e.message);
                    return null;
                }),
            fetchConnectSessions(bearer)
                .catch(function(e) {
                    if (e && e.message === ZN_ERR_UNAUTHORIZED) throw e;
                    console.warn('[ZN] Sessions API failed:', e.message);
                    return [];
                }),
            fetchConnectRegions(bearer)
                .catch(function(e) {
                    if (e && e.message === ZN_ERR_UNAUTHORIZED) throw e;
                    console.warn('[ZN] Regions API failed:', e.message);
                    return [];
                })
        ]);

        var licRaw = phaseFast[0];
        var ses    = Array.isArray(phaseFast[1]) ? phaseFast[1] : [];
        var regions = Array.isArray(phaseFast[2]) ? phaseFast[2] : [];

        var lic = licRaw || null;

        lastData.lic     = lic;
        lastData.ses     = ses;
        lastData.regions = regions;

        prefetchRegionGeoLabels();

        renderDashboardFast(lic, ses, statusEl);

        // ── Phase 1: Immediate 7-day fetch — await so chart renders right away ──
        var auditPhase1;
        try {
            auditPhase1 = await fetchAuditSevenDays(bearer, statusEl);
        } catch (auditErr) {
            if (auditErr && auditErr.message === ZN_ERR_UNAUTHORIZED) throw auditErr;
            console.warn('[ZN] 7-day audit fetch failed:',
                auditErr && auditErr.message ? auditErr.message : auditErr);
            auditPhase1 = { items: [], hitLimit: false, resumeCursor: null };
        }

        lastData.aud               = auditPhase1.items || [];
        lastData.audConnect        = filterAuditConnectEvents(lastData.aud);
        lastData.audHitLimit       = !!auditPhase1.hitLimit;
        lastData.auditFetchPending = false;
        isFullAuditLoaded          = false;

        reRenderAuditWidgets();
        setAuditWidgetsLoading(false);
        try { buildMasterUserList(); } catch (e2) { console.warn('[ZN] buildMasterUserList:', e2); }

        if (statusEl) {
            statusEl.textContent = 'Sessions + 7-day audit loaded \u00b7 syncing 30-day history\u2026';
            statusEl.style.color = '#94a3b8';
        }

        // ── Phase 2: Background fetch for days 8-30 — no await ──────────────
        backgroundAuditPromise = fetchRemainingAuditLogs(bearer, statusEl, auditPhase1.resumeCursor)
            .catch(function(bgErr) {
                if (bgErr && bgErr.message === ZN_ERR_UNAUTHORIZED) return;
                console.warn('[ZN] Background audit (days 8-30) failed:',
                    bgErr && bgErr.message ? bgErr.message : bgErr);
                isFullAuditLoaded = true; // unblock pill toggle awaiters
            });

    } catch(e) {
        lastData.auditFetchPending = false;
        setAuditWidgetsLoading(false);
        if (e && e.message === ZN_ERR_UNAUTHORIZED) {
            return;
        }
        console.error('[ZN Dashboard] Error:', e);
        renderDashboardDataUnavailable('No data available');
        if (statusEl) {
            statusEl.textContent = 'Error: ' + (e && e.message ? e.message : 'unknown');
            statusEl.style.color = '#f87171';
        }
    }
}

// ── Fast path: license, sessions, map, OS, table (no audit-dependent widgets) ─
function renderDashboardFast(lic, ses, statusEl) {
    ses = Array.isArray(ses) ? ses : [];
    try { sessionStorage.removeItem('znDashReloads'); } catch (e) { /* noop */ }

    if (lic && lic.licenseState) {
        var licInUse = lic.licenseState.inUse || 0;
        var licLimit = (lic.licenseState.configInfo && lic.licenseState.configInfo.limit) || 0;
        document.getElementById('kpi-licenses').innerText = licInUse + ' / ' + licLimit;
        var licPct = licLimit > 0 ? Math.min(100, Math.round(licInUse / licLimit * 100)) : 0;
        var licBar = document.getElementById('license-bar');
        if (licBar) {
            licBar.style.width      = licPct + '%';
            licBar.style.background = licPct >= 100 ? '#ef4444' : licPct >= 90 ? '#f59e0b' : '#00df9a';
        }
        if (licInUse > licLimit) document.getElementById('kpi-licenses').className = 'widget-primary-metric red';
    } else {
        document.getElementById('kpi-licenses').innerText = 'N/A';
    }

    applySessionKpisFromMasterList(ses);

    var filteredActive = filterActiveSessionsForDashboardFilters(lastData.activeSessions || []);
    try { renderVersionsCardFromSessions(filteredActive); }
    catch (e) { console.error('[ZN] versionsCard (sessions) failed:', e); }
    try { renderOsAccordion(filteredActive); } catch (e) { console.error('[ZN] osAccordion failed:', e); }
    // Map: country pins from Zero session fields + offline centroids; public GeoIP
    // (throttled) runs only when zoomed in and only for IPs visible in the viewport.
    znEnsureCountryCentroidsLoaded(function() {
        try {
            znSeedCountryLevelMapGeo(ses);
            renderMap(filterSessionsByDashboardFilters(ses));
        } catch (e) {
            console.error('[ZN] map failed:', e);
        }
        znScheduleViewportCityGeo(220);
    });
    // Force Leaflet to recalculate tile coverage once the CSS grid has settled
    setTimeout(function() { if (leafletMap) leafletMap.invalidateSize(); }, 300);
    var insList = document.getElementById('insights-list');
    if (insList) {
        insList.innerHTML = '<li style="color:#94a3b8;font-size:0.8rem">' +
            'Loading insights\u2026 audit history is still syncing.</li>';
    }
    if (statusEl) {
        statusEl.textContent = 'Sessions loaded · loading 30-day Connect audit\u2026';
        statusEl.style.color = '#94a3b8';
    }

    try { buildMasterUserList(); } catch (e) { console.warn('[ZN] buildMasterUserList:', e); }
    try { buildMasterRegionList(); } catch (e) { console.warn('[ZN] buildMasterRegionList:', e); }
}

// ── 11. Auto-sync on open (after portal auth / extension token capture) ─────

// Handle return from portal authentication
function handleAuthReturn() {
    var urlParams = new URLSearchParams(window.location.search);
    var returnTo = urlParams.get('returnTo');
    
    if (returnTo) {
        // Clear the return parameter and redirect back to dashboard
        try {
            var cleanUrl = decodeURIComponent(returnTo);
            window.location.replace(cleanUrl);
            return true;
        } catch (e) {
            console.warn('[ZN] Invalid returnTo URL:', e);
        }
    }
    return false;
}

// Check for auth return on load
if (handleAuthReturn()) {
    // Will redirect, so don't continue with normal initialization
} else {
    // Normal dashboard initialization
    var tokenEl = document.getElementById('debug-token');

var znAuthGateBtn = document.getElementById('zn-auth-gate-login');
if (znAuthGateBtn) {
    znAuthGateBtn.addEventListener('click', function() {
        // Tell the parent portal page to navigate to the sign-in URL.
        // The content script handles this message and redirects window.location.
        window.parent.postMessage({ type: 'ZN_DASHBOARD_AUTH_REQUIRED' }, '*');
    });
}

var znGateDumpBtn = document.getElementById('zn-gate-dump-btn');
if (znGateDumpBtn) {
    znGateDumpBtn.addEventListener('click', function() { znShowDebugDump(); });
}

// Manual token paste fallback (for fresh devices where the service worker
// hasn't yet intercepted a portal API request to auto-capture the token).
(function() {
    var toggleBtn = document.getElementById('zn-gate-manual-toggle');
    var section   = document.getElementById('zn-gate-manual-section');
    var applyBtn  = document.getElementById('zn-gate-manual-apply');
    var tokenInput = document.getElementById('zn-gate-token-input');
    var errorEl   = document.getElementById('zn-gate-manual-error');

    if (toggleBtn && section) {
        toggleBtn.addEventListener('click', function() {
            var open = section.classList.toggle('is-open');
            toggleBtn.textContent = open
                ? 'Hide manual entry'
                : 'Having trouble? Paste your token manually';
            if (open && tokenInput) tokenInput.focus();
        });
    }

    if (applyBtn && tokenInput) {
        applyBtn.addEventListener('click', function() {
            var raw = tokenInput.value.trim();
            var token = coerceDashBearerToken(raw);
            if (!token) {
                if (errorEl) errorEl.classList.add('is-visible');
                return;
            }
            if (errorEl) errorEl.classList.remove('is-visible');
            try {
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    chrome.storage.local.get('znTokens', function(result) {
                        var tokens = (result && result.znTokens) || {};
                        tokens[ZN_PORTAL_HOSTNAME] = { token: token, at: Date.now() };
                        chrome.storage.local.set({ znTokens: tokens });
                    });
                }
                localStorage.setItem('znToken', token);
            } catch (e) { /* noop */ }
            hideAuthGate();
            window.__znDash401Handled = false;
            loadDashboard(token);
        });
    }
}());

    readStoredZnToken(function(stored) {
        var ok = !!coerceDashBearerToken(stored);
        if (tokenEl) {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                tokenEl.textContent = ok
                    ? 'Token: Found \u2713'
                    : 'Token: Missing \u2014 sign in via the portal, then reopen the dashboard.';
                tokenEl.style.color = ok ? '#00df9a' : '#f87171';
            } else {
                tokenEl.textContent = ok
                    ? 'Token: Found (localStorage) \u2713'
                    : 'Token: Missing \u2014 open from the extension after signing in, or set znToken in localStorage for dev.';
                tokenEl.style.color = ok ? '#00df9a' : '#f59e0b';
            }
        }
        loadDashboard(stored);
    });
}
