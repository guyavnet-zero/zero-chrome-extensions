(function loadRoboto() {
    if (document.querySelector('link[href*="fonts.googleapis.com"][href*="Roboto"]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap';
    document.head.appendChild(link);
})();

(function injectBelowMapWidgetHeights() {
    var style = document.createElement('style');
    style.id = 'zn-widget-heights';
    style.textContent = [
        '#card-os-distribution-wrap,#card-posture-violations-wrap,#card-top-users-posture-wrap{min-height:0!important;overflow:hidden!important;}',
        '#card-os-distribution-wrap>.audit-chart-inner,',
        '#card-posture-violations-wrap>.metric-scroll{',
        'overflow-y:auto!important;max-height:none!important;}',
        '#card-top-users-posture-wrap>.metric-scroll{',
        'overflow-y:auto!important;max-height:320px!important;}'
    ].join('');
    document.head.appendChild(style);
})();

var __znDebugLogs = [];

// ── Extension update check ────────────────────────────────────────────────
// Fetches the version from a public GitHub Gist every time the dashboard
// loads. If a newer version is available, silently reloads the extension.
// Loop protection: chrome.storage.local tracks the last version we already
// reloaded for, so copy-users (not on OneDrive) never get stuck in a loop.
var VERSION_CHECK_URL = 'https://gist.githubusercontent.com/guyavnet-zero/b53427ba229f9cf1e9e97cad6834ef2a/raw/version.json';

(function checkForExtensionUpdate() {
    if (!VERSION_CHECK_URL) return;
    setTimeout(function () {
        fetch(VERSION_CHECK_URL)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var latest = (data && data.version) ? String(data.version) : null;
                if (!latest) return;
                var current = (isExtCtxAlive() && chrome.runtime.getManifest().version) || '';
                if (!znIsNewerVersion(latest, current)) return;
                if (!isExtCtxAlive()) return;
                chrome.storage.local.get('znLastAutoReloadVersion', function (result) {
                    if (result.znLastAutoReloadVersion === latest) return;
                    chrome.storage.local.set({ znLastAutoReloadVersion: latest }, function () {
                        try { chrome.runtime.reload(); } catch (e) {}
                        // Reload the portal page so the updated extension takes effect
                        // immediately. sessionStorage survives page reloads so the dashboard
                        // will auto-reopen at the new version.
                        setTimeout(function () {
                            try { window.top.location.reload(); } catch (e) {}
                        }, 1000);
                    });
                });
            })
            .catch(function () {});
    }, 4000);
}());

function znIsNewerVersion(a, b) {
    var av = a.split('.').map(Number);
    var bv = b.split('.').map(Number);
    for (var i = 0; i < 3; i++) {
        if ((av[i] || 0) > (bv[i] || 0)) return true;
        if ((av[i] || 0) < (bv[i] || 0)) return false;
    }
    return false;
}

/** Returns true only when the extension context is still alive.
 *  chrome.runtime.id becomes undefined once the service-worker is invalidated. */
function isExtCtxAlive() {
    try { return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id); }
    catch (e) { return false; }
}

// ── Console error capture ─────────────────────────────────────────────────
// Forward every console.error call to the background SW so it can persist
// the message in chrome.storage.local for the side-panel debug tab.
(function() {
    var _origError = console.error.bind(console);
    console.error = function() {
        _origError.apply(console, arguments);
        if (!isExtCtxAlive()) return;
        try {
            var args = Array.prototype.slice.call(arguments);
            chrome.runtime.sendMessage({
                type:    'ZN_DIAG_LOG',
                level:   'error',
                source:  'dashboard',
                message: args.map(function(a) {
                    return (a instanceof Error) ? (a.message + (a.stack ? '\n' + a.stack : '')) : String(a);
                }).join(' ')
            }, function() { void chrome.runtime.lastError; });
        } catch (_) {}
    };
})();

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

    if (isExtCtxAlive() && chrome.storage && chrome.storage.local) {
        try { chrome.storage.local.get('znTokens', function(result) {
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
        }); } catch (e) {
            var hostname = (typeof ZN_PORTAL_HOSTNAME !== 'undefined') ? ZN_PORTAL_HOSTNAME : '?';
            render({ hostname: hostname, status: 'chrome.storage not available' }, []);
        }
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

// ── Analytics helper ─────────────────────────────────────────────────────
// Sends a named event to the background service worker, which forwards it
// to GA4 via the Measurement Protocol. Fire-and-forget: errors are silent.
function znTrack(eventName, params) {
    if (!isExtCtxAlive()) return;
    try {
        chrome.runtime.sendMessage({
            type:   'ZN_ANALYTICS',
            event:  eventName,
            envId:  ZN_PORTAL_HOSTNAME,
            params: params || {}
        }, function() { void chrome.runtime.lastError; });
    } catch (e) { /* noop — analytics must never break the dashboard */ }
}

// Track sidebar nav clicks via event delegation on <aside>.
(function() {
    var aside = document.querySelector('aside');
    if (!aside) return;
    aside.addEventListener('click', function(e) {
        var link = e.target.closest('.sidebar-nav-item[data-page]');
        if (link) znTrack('sidebar_nav_click', { page: link.getAttribute('data-page') || '' });
    });
}());
var auditChartInstance = null;
/** Set while Audit Activity chart is bar mode — used for bar click drill-down. */
var auditChartDrillContext = null;
/** Session Creation by Region: per chart x-label, type-96 stats for external tooltip. */
var znAuditActivityConnectDailyInsights = null;
/** Policy Operations: per chart x-label, types 100/101/102 stats for external tooltip. */
var znAuditActivityPolicyDailyInsights = null;
/** Posture Audits: per chart x-label, found/resolved counts + rawEvents for drawer. */
var znAuditActivityPostureDailyInsights = null;
var leafletMap         = null;   // maplibregl.Map instance

/**
 * Safe wrapper around leafletMap.resize().
 * MapLibre throws a RangeError ("mismatched image size") when resize() is
 * called while the canvas has zero dimensions (hidden container, off-screen
 * route, etc.). Guard against that by checking offsetWidth/offsetHeight and
 * swallowing any stray errors so they never surface in the extension.
 */
function znSafeMapResize() {
    if (!leafletMap) return;
    var mapEl = document.getElementById('map');
    if (!mapEl || !mapEl.offsetWidth || !mapEl.offsetHeight) return;
    try { leafletMap.resize(); } catch (e) { /* maplibre size mismatch — ignore */ }
}
var regionMarkers      = [];     // kept for API compat (unused with GeoJSON layers)
var mapUserMarkers     = [];     // kept for API compat (unused with GeoJSON layers)
var mapServerMarkers   = [];     // kept for API compat (alias of regionMarkers)
var mapPolylines       = [];     // HTML arrow maplibregl.Marker objects
var mapMoveSaveTimer    = null;
var mapBounds           = null;  // znCreateMapBounds() instance; reset on each renderMap
var mapBoundsFitTimer   = null;  // debounce timer for debouncedFitBounds
var mapServerCoord      = {};    // regionName → [lat,lng]; shared with updateMapProgressively
var _znMapSourcesReady  = false; // true once map style loaded + sources added
var _mapUserFeatures    = [];    // current GeoJSON features for zn-users source
var _mapConnFeatures    = [];    // current GeoJSON features for zn-connections source
var _mapIpSessions      = {};    // ip → sessions[] for click handling
var _mapRegionSessions  = {};    // regionName → sessions[] for click handling
var _mapRegionHTMLMarkers      = [];  // maplibregl.Marker[] for region donut HTML markers
var _mapClusterHTMLMarkers     = {};  // cluster_id → maplibregl.Marker for user cluster donuts
var _mapClusterMarkersOnScreen = {};  // cluster_id → maplibregl.Marker currently on screen
var _mapIndivHTMLMarkers       = {};  // ip → maplibregl.Marker for individual (unclustered) user dots
var _mapIndivMarkersOnScreen   = {};  // ip → maplibregl.Marker currently on screen
var _mapUserHasInteracted = false; // true once user pans/zooms; suppresses auto-fitBounds
var _mapAutoFitDone       = false; // true after the first auto-flyTo fires; suppresses repeated fly on progressive IP resolution
var ZN_MAP_DEFAULT_LATLNG = [20, 0];
var ZN_MAP_DEFAULT_ZOOM   = 2;
/** IPs whose country is unknown are not plotted; znResolveUnknownGeoIps handles them. */
var mapMode            = 'both';   // 'both' | 'servers' | 'users'
var activePeriod       = '30d';    // hardcoded — time-filter UI removed
var dauChartRangeDays  = 7;        // Activity chart: last N days (7 | 14 | 30 | 90)
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
var ZN_GEO_ZERO_RETRIES = 1;
/** Delay (ms) between Zero session-data retries. */
var ZN_GEO_ZERO_RETRY_MS = 500;
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
    regions: [],             // items from /api/v1/settings/connect/regions
    postureProfiles: [],     // items from /api/v1/connect/posture
    connectRoles: [],        // items from /api/v1/connect/roles (Connect policies)
    policyById: Object.create(null), // keyed by role.id for fast session→policy lookup
    latestClientVersions: null  // { windows, macIntel, macArm, latest } from download API
};
/** Populated when opening Audit Operations drill-down modal (Inspect uses this array by row index). */
var znAuditDrillRecentEvents = [];

// ── Known region → [lat, lng] lookup ─────────────────────────────────────
var REGION_COORDS = {
    // ── Legacy / generic keys ─────────────────────────────────────────────
    'il':           [32.0804, 34.7807],
    'il backup':    [32.0804, 34.7807],
    'colo':         [39.7,   -104.9  ],
    'us-east':      [38.9,    -77.0  ],
    'us-west':      [37.8,   -122.4  ],
    'eu':           [51.5,    10.0   ],
    'eu-west':      [53.3,    -6.3   ],
    'apac':         [ 1.3,   103.8   ],
    'australia':    [-33.9,  151.2   ],
    // ── Middle East ───────────────────────────────────────────────────────
    'israel':       [32.08,   34.78  ],
    'tel aviv':     [32.08,   34.78  ],
    'dubai':        [25.20,   55.27  ],
    'abu dhabi':    [24.47,   54.37  ],
    'riyadh':       [24.69,   46.72  ],
    // ── Europe ────────────────────────────────────────────────────────────
    'london':       [51.51,   -0.13  ],
    'frankfurt':    [50.11,    8.68  ],
    'amsterdam':    [52.37,    4.90  ],
    'paris':        [48.86,    2.35  ],
    'stockholm':    [59.33,   18.07  ],
    'madrid':       [40.42,   -3.70  ],
    'dublin':       [53.33,   -6.25  ],
    'zurich':       [47.38,    8.54  ],
    'warsaw':       [52.23,   21.01  ],
    'milan':        [45.46,    9.19  ],
    'rome':         [41.90,   12.50  ],
    'vienna':       [48.21,   16.37  ],
    'brussels':     [50.85,    4.35  ],
    'lisbon':       [38.72,   -9.14  ],
    'oslo':         [59.91,   10.75  ],
    'helsinki':     [60.17,   24.94  ],
    'prague':       [50.08,   14.44  ],
    'budapest':     [47.50,   19.04  ],
    'bucharest':    [44.43,   26.10  ],
    'sofia':        [42.70,   23.32  ],
    'athens':       [37.98,   23.73  ],
    // ── North America ─────────────────────────────────────────────────────
    'new york':     [40.71,   -74.01 ],
    'nyc':          [40.71,   -74.01 ],
    'los angeles':  [34.05,  -118.24 ],
    'chicago':      [41.88,   -87.63 ],
    'dallas':       [32.78,   -96.80 ],
    'seattle':      [47.61,  -122.33 ],
    'miami':        [25.77,   -80.19 ],
    'atlanta':      [33.75,   -84.39 ],
    'boston':       [42.36,   -71.06 ],
    'denver':       [39.74,  -104.98 ],
    'phoenix':      [33.45,  -112.07 ],
    'san jose':     [37.34,  -121.89 ],
    'san francisco':[37.77,  -122.42 ],
    'ashburn':      [39.04,   -77.49 ],
    'toronto':      [43.65,   -79.38 ],
    'montreal':     [45.50,   -73.57 ],
    'vancouver':    [49.25,  -123.12 ],
    'mexico city':  [19.43,   -99.13 ],
    // ── South America ─────────────────────────────────────────────────────
    'sao paulo':    [-23.55,  -46.63 ],
    'são paulo':    [-23.55,  -46.63 ],
    'brazil':       [-15.78,  -47.93 ],
    'buenos aires': [-34.60,  -58.38 ],
    'santiago':     [-33.45,  -70.67 ],
    'bogota':       [  4.71,  -74.07 ],
    // ── Asia Pacific ──────────────────────────────────────────────────────
    'singapore':    [  1.35,  103.82 ],
    'tokyo':        [ 35.68,  139.69 ],
    'mumbai':       [ 19.08,   72.88 ],
    'bangalore':    [ 12.97,   77.59 ],
    'bengaluru':    [ 12.97,   77.59 ],
    'sydney':       [-33.87,  151.21 ],
    'melbourne':    [-37.81,  144.96 ],
    'seoul':        [ 37.57,  126.98 ],
    'hong kong':    [ 22.32,  114.17 ],
    'taipei':       [ 25.03,  121.56 ],
    'osaka':        [ 34.69,  135.50 ],
    'jakarta':      [ -6.21,  106.85 ],
    'kuala lumpur': [  3.14,  101.69 ],
    'bangkok':      [ 13.75,  100.52 ],
    'ho chi minh':  [ 10.82,  106.63 ],
    'manila':       [ 14.60,  120.98 ],
    'delhi':        [ 28.61,   77.21 ],
    'chennai':      [ 13.08,   80.27 ],
    'hyderabad':    [ 17.39,   78.49 ],
    // ── Africa ────────────────────────────────────────────────────────────
    'johannesburg': [-26.20,   28.04 ],
    'cape town':    [-33.93,   18.42 ],
    'nairobi':      [ -1.29,   36.82 ],
    'cairo':        [ 30.04,   31.24 ],
    'lagos':        [  6.45,    3.40 ]
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
    if (period === '24h') return now - 24  * 3600  * 1000;
    if (period === '7d')  return now - 7   * 86400 * 1000;
    if (period === '30d') return now - 30  * 86400 * 1000;
    if (period === '90d') return now - 90  * 86400 * 1000;
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
// Set to true once renderDashboardFast has run; prevents audit 401s from
// triggering a full-page reload when the user is already looking at data.
var znFastDataRendered = false;

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
    try {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'ZN_DASHBOARD_AUTH_REQUIRED' }, '*');
            return;
        }
    } catch (e) { /* cross-origin read guard — fall through */ }
    openPortalReauth();
}

function hideAuthGate() { /* gate removed */ }

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

    // If fast data is already on screen, a background auth failure (e.g. an
    // audit fetch 401) should not reload the page — that would make the user
    // lose the data they're looking at and create an infinite refresh loop.
    if (znFastDataRendered) {
        console.log('[ZN Dashboard] Auth error after fast render — skipping reload, marking audit unavailable.');
        return;
    }

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
        if (!isExtCtxAlive() || !chrome.tabs || !chrome.storage) {
            resolve(false);
            return;
        }

        // Remember the capture timestamp we know is stale so we can detect when a new token arrives.
        // Comparing timestamps (not token values) means we detect a re-capture of the same JWT string.
        try {
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
                    if (!isExtCtxAlive()) {
                        clearInterval(interval);
                        resolve(false);
                        return;
                    }
                    try {
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
                    } catch (e) { clearInterval(interval); resolve(false); }
                }, 500);
            });
        });
        } catch (e) { resolve(false); }
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
    374: "Connect posture check failed",
    387: "Posture profile created",
    388: "Posture profile edited",
    389: "Posture profile deleted",
    392: "Posture violation setting updated",
    393: "Global posture checks excluded users updated",
    394: "Posture violation status changed"
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
    var maxAttempts = 3;
    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
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
            var msg = e && e.message ? e.message : String(e);
            if (attempt < maxAttempts) {
                console.log('[Audit Pagination] Attempt', attempt, 'failed (' + msg + '), retrying in', attempt * 1000, 'ms…');
                await new Promise(function(resolve) { setTimeout(resolve, attempt * 1000); });
            } else {
                console.error('[Audit Pagination Failed] URL:', url, 'Error:', msg);
            }
        }
    }
    return null;
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
    var cutoff90d = Date.now() - 30 * 24 * 60 * 60 * 1000;
    var newItems  = [];
    var hitLimit  = false;
    var maxPages  = 300;
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
        newItems = newItems.concat(filterAuditsNotOlderThanCutoff(batch, cutoff90d));

        if (statusEl) {
            statusEl.textContent = 'Syncing 30-day audit\u2026 (' +
                ((lastData.aud || []).length + newItems.length) + ' events total)';
        }

        var lastMs = getAuditItemTs(batch[batch.length - 1]);
        if (lastMs !== null && lastMs < cutoff90d) break;

        var cursorVal = getAuditCursorRawFromItem(batch[batch.length - 1]);
        if (cursorVal === null) {
            console.warn('[ZN Audit] Phase-2: no cursor on last row — stopping.');
            break;
        }
        nextCursor = cursorVal;
    }

    if (pagesDone >= maxPages) {
        var gMin = globalOldestAuditMs(newItems);
        if (gMin !== null && gMin >= cutoff90d) hitLimit = true;
    }

    // Merge with the 7-day data already in lastData.aud; dedup handles any boundary overlap
    lastData.aud        = dedupeAuditItems((lastData.aud || []).concat(newItems));
    lastData.audConnect = filterAuditConnectEvents(lastData.aud);
    lastData.audHitLimit = !!(lastData.audHitLimit || hitLimit);
    isFullAuditLoaded   = true;

    reRenderAuditWidgets();
    try { buildMasterUserList(); } catch (e2) { console.warn('[ZN] buildMasterUserList:', e2); }

    // Ensure Leaflet recalculates tile coverage now the full grid is stable
    setTimeout(znSafeMapResize, 100);
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
    // When a specific user is filtered include ALL their sessions (active + offline)
    // so an offline user's IP still gets geo-resolved and plotted on the map.
    var userFilter = getSelectedDashboardUserName();
    var act = userFilter
        ? forMap
        : forMap.filter(function(s) { return sessionState(s) === 'active'; });
    var seenIp = Object.create(null);

    // Preserve city-level resolutions (external GeoIP) — they survive filter changes.
    var savedCity = new Map();
    geoIpCache.forEach(function(coords, ip) {
        if (geoIpMapPrecision.get(ip) === 'city') savedCity.set(ip, coords);
    });

    geoIpCache.clear();
    geoIpMapPrecision.clear();
    geoIpFailedIps.clear();
    znGeoPendingIps.clear();

    // Restore city-level coords so previously resolved IPs are immediately available.
    savedCity.forEach(function(coords, ip) {
        geoIpCache.set(ip, coords);
        geoIpMapPrecision.set(ip, 'city');
    });

    var unresolved = [];
    for (var i = 0; i < act.length; i++) {
        var ip = sessionPublicIp(act[i]);
        if (!ip) continue;
        var k = String(ip).trim();
        if (!k || seenIp[k]) continue;
        seenIp[k] = true;
        if (geoIpCache.has(k)) continue; // already have city-level coords — keep them
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
    if (!leafletMap || !_znMapSourcesReady) return false;
    var z = leafletMap.getZoom();
    if (z < ZN_MAP_CITY_MIN_ZOOM) return false;
    var b = leafletMap.getBounds();
    if (!b) return false;
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
            if (!b.contains([c[1], c[0]])) continue; // MapLibre: [lng, lat]
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
 * Fetch a GeoIP URL. Tries the background service worker first (to avoid CORS
 * in restricted contexts); falls back to a direct fetch when the SW is
 * unavailable (killed by Chrome or not yet started).
 * Returns a response-like object with { ok, status, json() }.
 */
function znGeoFetch(url) {
    function directFetch(u) {
        return fetch(u)
            .then(function(r) {
                var ok = r.ok, status = r.status;
                return r.json().then(function(data) {
                    return { ok: ok, status: status, json: function() { return Promise.resolve(data); } };
                });
            })
            .catch(function() {
                return { ok: false, status: 0, json: function() { return Promise.resolve(null); } };
            });
    }

    return new Promise(function (resolve) {
        try {
            chrome.runtime.sendMessage({ type: 'ZN_GEO_FETCH', url: url }, function (resp) {
                if (chrome.runtime.lastError || !resp) {
                    // SW unavailable — try direct fetch (extension pages have host_permissions)
                    directFetch(url).then(resolve);
                    return;
                }
                resolve({
                    ok: resp.ok,
                    status: resp.status,
                    json: function () { return Promise.resolve(resp.data); }
                });
            });
        } catch (e) {
            directFetch(url).then(resolve);
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

    // Show loading badge for all public GeoIP batches.
    if (ips.length > 0) {
        mapGeoTotalIps   = ips.length;
        mapGeoLocatedIps = 0;
        updateMapGeoBadge(true);
    }
    console.log('[GeoIP Queue] Starting for ' + ips.length + ' IPs:', ips.join(', '));

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
                    !bNow.contains([curC[1], curC[0]])) { // MapLibre: [lng, lat]
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
                // Mark as 'city' precision regardless of batch type so coords
                // survive the next znSeedCountryLevelMapGeo (which clears non-city).
                geoIpMapPrecision.set(ip, 'city');
                console.log('[GeoIP Queue] Resolved', ip, '→', coords[0].toFixed(2), coords[1].toFixed(2), label ? '(' + label + ')' : '');
                if (isCityRefineBatch) znRelocateUserMarkerForIp(ip, coords);
                else updateMapProgressively(ip);
                mapGeoLocatedIps++;
                updateMapGeoBadge(true);
            } else {
                console.log('[GeoIP Queue] Failed to resolve', ip);
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
            if (uniqC.length) znDrainPendingGeoIps(uniqC);
        }
        return;
    }

    updateMapGeoBadge(false);
    geoQueueDrainCallbacks.splice(0).forEach(function(cb) { cb(); });

    var resolvedCount = ips.filter(function(ip) { var c = geoIpCache.get(ip); return c && znIsValidLatLng(c[0], c[1]); }).length;
    console.log('[GeoIP Queue] Done — resolved ' + resolvedCount + '/' + ips.length + ' IPs. mapUserMarkers.length=' + mapUserMarkers.length);

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
        if (uniq.length) znDrainPendingGeoIps(uniq);
    }
}

/**
 * Drains buffered IPs from pendingGeoOnlyIps after the queue finishes.
 * IPs that already have coordinates get city-refinement; IPs with no coords yet
 * (e.g. an offline user's IP that was queued while the initial batch was running)
 * get a plain resolution pass so the viewport check does not silently drop them.
 */
function znDrainPendingGeoIps(ips) {
    var withCoords = [];
    var withoutCoords = [];
    ips.forEach(function(ip) {
        var c = geoIpCache.get(ip);
        if (c && znIsValidLatLng(c[0], c[1])) withCoords.push(ip);
        else withoutCoords.push(ip);
    });
    if (withCoords.length) processSessionGeoIps(null, { onlyIps: withCoords, _cityRefine: true });
    if (withoutCoords.length) processSessionGeoIps(null, { onlyIps: withoutCoords });
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
 * Moves an existing user dot when city-level GeoIP refines coords — updates the
 * GeoJSON source in-place so the MapLibre GPU layer re-renders without a full redraw.
 */
function znRelocateUserMarkerForIp(ip, coords) {
    if (!leafletMap || !_znMapSourcesReady || !lastData || !lastData.ses) return;
    if (mapMode === 'servers') return;
    if (!coords || !znIsValidLatLng(coords[0], coords[1])) return;
    var plotCoords = jitterMarkerCoordsForIp(ip, coords[0], coords[1]);
    if (!znIsValidLatLng(plotCoords[0], plotCoords[1])) return;
    for (var i = 0; i < _mapUserFeatures.length; i++) {
        if (_mapUserFeatures[i].properties.ip === ip) {
            _mapUserFeatures[i].geometry.coordinates = [plotCoords[1], plotCoords[0]];
            leafletMap.getSource('zn-users').setData({ type: 'FeatureCollection', features: _mapUserFeatures });
            if (mapBounds) mapBounds.extend(plotCoords);
            if (!_mapAutoFitDone) debouncedFitBounds();
            return;
        }
    }
}

/**
 * Appends a single IP's user dot to the live map without clearing other layers.
 * Called by processSessionGeoIps() after each GeoIP resolution so dots pop in
 * progressively as the throttled queue works through the IP list.
 */
function updateMapProgressively(ip) {
    if (!leafletMap || !_znMapSourcesReady || !lastData || !lastData.ses) {
        console.log('[MapDot] skip ' + ip + ' — map not ready');
        return;
    }
    if (mapMode === 'servers') return;

    var coords = geoIpCache.get(ip);
    if (!coords || !znIsValidLatLng(coords[0], coords[1])) {
        console.log('[MapDot] skip ' + ip + ' — invalid coords:', coords);
        return;
    }

    // Skip if already in the GeoJSON source from this render pass.
    if (_mapUserFeatures.some(function(f) { return f.properties.ip === ip; })) return;

    var userFilter = getSelectedDashboardUserName();
    var filteredAll = filterSessionsByDashboardFilters(lastData.ses).filter(function(s) {
        return sessionPublicIp(s) === ip;
    });
    var sessionsForIp = userFilter
        ? filteredAll
        : filteredAll.filter(function(s) { return sessionState(s) === 'active'; });
    if (sessionsForIp.length === 0) {
        console.log('[MapDot] skip ' + ip + ' — no sessions');
        return;
    }
    console.log('[MapDot] placing dot for ' + ip + ' at', coords[0].toFixed(2), coords[1].toFixed(2));

    var plotCoords = jitterMarkerCoordsForIp(ip, coords[0], coords[1]);
    if (!znIsValidLatLng(plotCoords[0], plotCoords[1])) return;

    _mapIpSessions[ip] = sessionsForIp;
    if (mapBounds) mapBounds.extend(plotCoords);

    var isOffline = sessionsForIp.every(function(s) { return sessionState(s) !== 'active'; });
    _mapUserFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [plotCoords[1], plotCoords[0]] },
        properties: { ip: ip, offline: isOffline }
    });
    leafletMap.getSource('zn-users').setData({ type: 'FeatureCollection', features: _mapUserFeatures });

    if (mapMode === 'both') {
        var rn = regionName(sessionsForIp[0]);
        var sc = rn ? mapServerCoord[rn] : null;
        if (sc) {
            _mapConnFeatures.push({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: _znMakeArcCoords(
                        plotCoords[1], plotCoords[0],
                        sc[1], sc[0]
                    )
                },
                properties: {}
            });
            leafletMap.getSource('zn-connections').setData({ type: 'FeatureCollection', features: _mapConnFeatures });
            _znAddArrowMarker(plotCoords, sc);
        }
    }

    if (mapBounds && !_mapAutoFitDone) debouncedFitBounds();
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

/** Sets drawer title element to "Name  ·  25 Apr  ·  7d" with a muted suffix span.
 *  Callers MUST use innerHTML (not textContent) when using the returned HTML string.
 *  Pass the element directly for safety. */
function setDrawerTitle(el, name, dayLabel) {
    if (!el) return;
    var nDays = typeof dauChartRangeDays === 'number' && dauChartRangeDays >= 1 ? dauChartRangeDays : 7;
    var suffix = (dayLabel ? ' \u00b7 ' + dayLabel : '') + ' \u00b7 ' + nDays + 'd';
    el.innerHTML = name + '<span class="sdw-title-meta">' + suffix + '</span>';
}

/** @deprecated Use setDrawerTitle() instead. */
function buildDrawerTitle(name, dayLabel) {
    var nDays = typeof dauChartRangeDays === 'number' && dauChartRangeDays >= 1 ? dauChartRangeDays : 7;
    return name + (dayLabel ? ' \u00b7 ' + dayLabel : '') + ' \u00b7 ' + nDays + 'd';
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
    var TYPE_SET = { 96: true };
    var result = buckets.map(function(b) {
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
    return result;
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
            policyCounts: Object.create(null),
            totalEvents: 0
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

        entry.totalEvents++;

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
                        location: null,
                        asset: '\u2014'
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
                var _destName = (Array.isArray(item.destinationEntitiesList) && item.destinationEntitiesList.length > 0 && item.destinationEntitiesList[0].name)
                    ? String(item.destinationEntitiesList[0].name).trim() : null;
                var assetStr = (detailsObj.sourceAsset ? String(detailsObj.sourceAsset).trim() : null) ||
                    _destName ||
                    readName(item.asset) ||
                    (detailsObj.deviceName ? String(detailsObj.deviceName).trim() : null) ||
                    (detailsObj.asset && typeof detailsObj.asset === 'string' ? detailsObj.asset.trim() : null) ||
                    (detailsObj.fqdn ? String(detailsObj.fqdn).trim() : null) ||
                    (detailsObj.hostname ? String(detailsObj.hostname).trim() : null) ||
                    (detailsObj.assetName ? String(detailsObj.assetName).trim() : null) ||
                    null;
                if (assetStr) urow.asset = assetStr;
            }
        }

        if (detailsObj.uacName != null) {
            var pol = typeof detailsObj.uacName === 'string' ? detailsObj.uacName.trim() : String(detailsObj.uacName).trim();
            if (pol) {
                entry.policyCounts[pol] = (entry.policyCounts[pol] || 0) + 1;
                // Store most-recent policy applied per user
                if (detailsObj.user != null) {
                    var ukey = typeof detailsObj.user === 'string' ? detailsObj.user.trim() : String(detailsObj.user).trim();
                    if (ukey && entry.uniqueUserMap[ukey]) entry.uniqueUserMap[ukey].policy = pol;
                }
            }
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
        var regionSet = Object.create(null);
        userList.forEach(function(u) { if (u && u.region && u.region !== 'Unknown') regionSet[u.region] = true; });
        dailyInsights[k] = {
            uniqueUserCount: userList.length,
            topPolicy: max > 0 ? topPolicy : '\u2014',
            userList: userList,
            policyBreakdown: policyBreakdown,
            totalEvents: d.totalEvents || 0,
            uniqueRegionsCount: Object.keys(regionSet).length
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
    var t = policyOpTypeId(ev);
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
 * Resolve the policy operation type (100=created, 101=edited, 102=deleted) for an audit event.
 * Falls back to label-based detection (via auditOperationWhitelistKey) when the auditType field
 * is absent or unrecognised — the ZN API sometimes returns policy events with no numeric type,
 * relying on the action/description field instead.
 */
function policyOpTypeId(item) {
    var n = auditTypeToNum(item);
    if (n === 100 || n === 101 || n === 102) return n;
    var key = auditOperationWhitelistKey(item);
    if (key === 'policy created')  return 100;
    if (key === 'policy edited')   return 101;
    if (key === 'policy deleted')  return 102;
    return NaN;
}

/**
 * Like countAuditTypeInBucketRange but uses policyOpTypeId() so label-matched
 * policy events (no numeric auditType) are counted correctly.
 */
function countPolicyOpTypeInBucketRange(poolItems, typeId, b0, b1) {
    var c = 0;
    poolItems.forEach(function(item) {
        if (policyOpTypeId(item) !== typeId) return;
        var ts = getAuditItemTs(item);
        if (ts == null || ts < b0 || ts >= b1) return;
        c++;
    });
    return c;
}

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
        if (isNaN(policyOpTypeId(item))) return;
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

// ── Posture Audit helpers ──────────────────────────────────────────────────

var AUDIT_TYPES_POSTURE_VIOLATIONS  = { 390: true, 374: true };
var AUDIT_TYPES_POSTURE_RESOLVED    = { 391: true };
var AUDIT_TYPES_POSTURE_ADMIN       = { 387: true, 388: true, 389: true, 392: true, 393: true, 394: true };

var POSTURE_CHECK_TYPE_LABELS = {
    12: 'MFA check',
    13: 'MFA configuration',
    18: 'Password policy',
    19: 'OS version',
    20: 'Inactive account'
};

function postureCheckTypeLabel(n) {
    var num = Number(n);
    return POSTURE_CHECK_TYPE_LABELS[num] || ('Check #' + num);
}

function postureAuditEventBadgeText(typeNum) {
    var n = Number(typeNum);
    if (AUDIT_TYPES_POSTURE_VIOLATIONS[n]) return 'Violation Found';
    if (AUDIT_TYPES_POSTURE_RESOLVED[n])  return 'Resolved';
    if (n === 387) return 'Profile Created';
    if (n === 388) return 'Profile Edited';
    if (n === 389) return 'Profile Deleted';
    if (n === 392) return 'Setting Updated';
    if (n === 393) return 'Excluded Users Updated';
    if (n === 394) return 'Status Changed';
    return 'Event';
}

function postureAuditEventBadge(typeNum) {
    var n = Number(typeNum);
    if (AUDIT_TYPES_POSTURE_VIOLATIONS[n])  return '<span class="posture-badge posture-badge--violation">Violation Found</span>';
    if (AUDIT_TYPES_POSTURE_RESOLVED[n])    return '<span class="posture-badge posture-badge--resolved">Resolved</span>';
    if (n === 387) return '<span class="posture-badge posture-badge--admin">Profile Created</span>';
    if (n === 388) return '<span class="posture-badge posture-badge--admin">Profile Edited</span>';
    if (n === 389) return '<span class="posture-badge posture-badge--admin-del">Profile Deleted</span>';
    if (n === 392) return '<span class="posture-badge posture-badge--admin">Setting Updated</span>';
    if (n === 393) return '<span class="posture-badge posture-badge--admin">Excluded Users Updated</span>';
    if (n === 394) return '<span class="posture-badge posture-badge--admin">Status Changed</span>';
    return '<span class="posture-badge posture-badge--admin">Event</span>';
}

/**
 * Posture Audits chart: violations found, resolved, admin/profile changes per bucket.
 * Final: { [label]: { found, resolved, adminChanges, topUser, rawEvents } }
 */
function buildPostureAuditDailyInsights(poolItems, timeBuckets) {
    var daily = {};
    timeBuckets.forEach(function(b) {
        daily[b.label] = { found: 0, resolved: 0, adminChanges: 0, topUser: '\u2014', rawEvents: [],
                           _userCounts: Object.create(null) };
    });

    (poolItems || []).forEach(function(item) {
        var t = auditTypeToNum(item);
        var isViol  = !!AUDIT_TYPES_POSTURE_VIOLATIONS[t];
        var isResol = !!AUDIT_TYPES_POSTURE_RESOLVED[t];
        var isAdmin = !!AUDIT_TYPES_POSTURE_ADMIN[t];
        if (!isViol && !isResol && !isAdmin) return;

        var ts = getAuditItemTs(item);
        if (ts == null) return;
        var bucket = null;
        for (var bi = 0; bi < timeBuckets.length; bi++) {
            var bu = timeBuckets[bi];
            if (ts >= bu.startMs && ts < bu.endMs) { bucket = bu; break; }
        }
        if (!bucket) return;
        var e = daily[bucket.label];
        if (!e) return;

        if (isViol)  e.found++;
        if (isResol) e.resolved++;
        if (isAdmin) e.adminChanges++;
        e.rawEvents.push(item);

        var dest = item.destinationEntitiesList;
        if (Array.isArray(dest) && dest.length > 0 && dest[0].name) {
            var uname = String(dest[0].name).trim();
            e._userCounts[uname] = (e._userCounts[uname] || 0) + 1;
        }
    });

    Object.keys(daily).forEach(function(k) {
        var e = daily[k];
        var topUser = '\u2014', maxU = 0;
        Object.keys(e._userCounts).forEach(function(u) {
            if (e._userCounts[u] > maxU) { maxU = e._userCounts[u]; topUser = u; }
        });
        e.topUser = maxU > 0 ? topUser : '\u2014';
        delete e._userCounts;
    });
    return daily;
}

/**
 * Users with more than 2 type-390 (Violation Found) events in the last 30 days.
 * Returns array of { userName, count, topCheckType } sorted by count descending.
 * Threshold: > 2 (i.e. 3 or more violations) to filter out one-off incidents.
 */
function postureTopFailingUsers30d(audItems) {
    var cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    var userCounts = Object.create(null);   // userName → total violation count
    var userChecks = Object.create(null);   // userName → { checkType → count }

    (audItems || []).forEach(function(item) {
        if (auditTypeToNum(item) !== 390) return;
        var ts = getAuditItemTs(item);
        if (ts == null || ts < cutoff) return;
        var d = parseAuditDetails(item);
        if (!d) return;
        var uName = d.userName || item.reportedObjectId || '\u2014';
        if (!uName || uName === '\u2014') return;
        var checks = Array.isArray(d.postureCheckTypes) ? d.postureCheckTypes : [];
        var increment = Math.max(checks.length, 1);
        userCounts[uName] = (userCounts[uName] || 0) + increment;
        if (!userChecks[uName]) userChecks[uName] = Object.create(null);
        checks.forEach(function(ct) {
            userChecks[uName][ct] = (userChecks[uName][ct] || 0) + 1;
        });
    });

    var result = [];
    Object.keys(userCounts).forEach(function(uName) {
        var c = userCounts[uName];
        if (c <= 2) return;
        var checkMap = userChecks[uName] || {};
        var topCt = null, topCtCount = 0;
        Object.keys(checkMap).forEach(function(ct) {
            if (checkMap[ct] > topCtCount) { topCtCount = checkMap[ct]; topCt = ct; }
        });
        result.push({ userName: uName, count: c, topCheckType: topCt });
    });
    result.sort(function(a, b) { return b.count - a.count; });
    return result;
}

/** Day with the highest violation count, if it's ≥3 and ≥2× the rolling daily average. */
function postureViolationSpike30d(audItems, timeBuckets) {
    var dayCounts = timeBuckets.map(function(b) {
        return countAuditTypeInBucketRange(audItems, 390, b.startMs, b.endMs) +
               countAuditTypeInBucketRange(audItems, 374, b.startMs, b.endMs);
    });
    if (!dayCounts.length) return null;
    var maxCount = Math.max.apply(null, dayCounts);
    var maxIdx   = dayCounts.indexOf(maxCount);
    var avg = dayCounts.reduce(function(a, b) { return a + b; }, 0) / dayCounts.length;
    if (maxCount < 3 || avg < 0.5 || maxCount < 2 * avg) return null;
    return {
        dayLabel: (timeBuckets[maxIdx] ? timeBuckets[maxIdx].label : '?'),
        count: maxCount,
        avg: Math.round(avg * 10) / 10
    };
}

/** Per-check-type violation counts across all 390 events in 30d pool for widget bars. */
function postureCheckTypeCounts30d(audItems) {
    var counts = Object.create(null);
    (audItems || []).forEach(function(item) {
        if (auditTypeToNum(item) !== 390) return;
        var d = parseAuditDetails(item);
        if (!d || !Array.isArray(d.postureCheckTypes)) return;
        d.postureCheckTypes.forEach(function(ct) {
            counts[ct] = (counts[ct] || 0) + 1;
        });
    });
    return counts;
}

/**
 * Per-user open violation count using latest-event-wins per (userId, checkType) in last 30 days.
 * Returns [{userId, userName, count}] sorted desc by count, capped to top 8.
 */
function postureTopViolatingUsers30d(audItems) {
    var cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    var latestByKey = Object.create(null);
    var userNames   = Object.create(null);

    (audItems || []).forEach(function(item) {
        var t = auditTypeToNum(item);
        if (t !== 390 && t !== 391) return;
        var ts = getAuditItemTs(item);
        if (ts == null || ts < cutoff) return;
        var d = parseAuditDetails(item);
        if (!d) return;
        var userId = d.userId || item.reportedObjectId || '';
        if (!userId) return;
        var uName  = d.userName || userId;
        userNames[userId] = uName;
        var checks = Array.isArray(d.postureCheckTypes) ? d.postureCheckTypes : [0];
        checks.forEach(function(ct) {
            var key = userId + ':' + ct;
            if (!latestByKey[key] || ts > latestByKey[key].ts) {
                latestByKey[key] = { ts: ts, type: t, userId: userId };
            }
        });
    });

    var userCounts = Object.create(null);
    Object.keys(latestByKey).forEach(function(k) {
        var e = latestByKey[k];
        if (e.type === 390) {
            userCounts[e.userId] = (userCounts[e.userId] || 0) + 1;
        }
    });

    return Object.keys(userCounts)
        .map(function(uid) {
            return { userId: uid, userName: userNames[uid] || uid || '\u2014', count: userCounts[uid] };
        })
        .sort(function(a, b) { return b.count - a.count || a.userName.localeCompare(b.userName); });
}

/** Top users by session creation count within the given period (default 30d). */
function topUsersBySessionCreation(audItems, period) {
    var pool = filterByPeriod(audItems || [], period || '30d');
    var counts = Object.create(null);
    var names  = Object.create(null);
    pool.forEach(function(item) {
        if (auditTypeToNum(item) !== AUDIT_TYPE_SESSION_CREATED) return;
        var uid  = (item.user && item.user.id  != null) ? String(item.user.id)  : '';
        var name = (item.user && item.user.name != null) ? String(item.user.name).trim() : '';
        if (!uid && !name) {
            var pb = item.performedBy;
            if (pb && pb.id)   uid  = String(pb.id);
            if (pb && pb.name) name = String(pb.name).trim();
        }
        var key = uid || name;
        if (!key) return;
        counts[key] = (counts[key] || 0) + 1;
        if (name) names[key] = name;
    });
    return Object.keys(counts)
        .map(function(k) { return { userId: k, userName: names[k] || k, count: counts[k] }; })
        .sort(function(a, b) { return b.count - a.count || a.userName.localeCompare(b.userName); });
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
        var t = policyOpTypeId(ev);
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
        if (ttMode === 'region_health' && typeof val === 'number') val = Math.abs(val);
        var bg = dp.dataset && dp.dataset.backgroundColor;
        if (Array.isArray(bg)) bg = bg[0];
        bg = bg != null ? String(bg) : '#94a3b8';
        return '<div class="zn-rich-tooltip-row">' +
            '<span class="color-box" style="background:' + znRichTooltipEscapeHtml(bg) + '"></span>' +
            '<span class="zn-rich-tooltip-label">' + znRichTooltipEscapeHtml(lab) + '</span>' +
            '<span class="zn-rich-tooltip-val">' + znRichTooltipEscapeHtml(String(val)) + '</span></div>';
    }).join('');

    var headerHtml = escDate ? '<div class="zn-rich-tooltip-date">' + escDate + '</div>' : '';

    var insightsHtml = '';
    if (ttMode === 'posture_audit' && znAuditActivityPostureDailyInsights && dateLabel) {
        var insPost = znAuditActivityPostureDailyInsights[dateLabel];
        if (insPost && (insPost.found > 0 || insPost.resolved > 0 || insPost.adminChanges > 0)) {
            var net = insPost.found - insPost.resolved;
            var netStr = net > 0 ? '+' + net + ' net open' : (net < 0 ? net + ' net' : 'balanced');
            insightsHtml = '<hr class="zn-rich-tooltip-hr">' +
                '<div class="zn-rich-tooltip-insight">Net: <strong>' + znRichTooltipEscapeHtml(netStr) + '</strong></div>' +
                (insPost.topUser !== '\u2014'
                    ? '<div class="zn-rich-tooltip-insight">Top user: <strong>' + znRichTooltipEscapeHtml(insPost.topUser) + '</strong></div>'
                    : '') +
                '<div class="zn-rich-tooltip-insight" style="color:#94a3b8;font-size:0.72rem">Click bar to view events</div>';
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

    // Explicit field checks — covers all known Zero API variants
    var ip = s.currentPublicIp || s.publicIp || s.srcIp || s.ip || s.ipAddress || s.ipAddr ||
        s.externalIP || s.externalIp || s.natIp || s.publicNatIp ||
        s.clientIp || s.sourceIp || s.remoteIp || s.userIp || s.connectingIp ||
        (ed && (ed.currentPublicIp || ed.publicIp || ed.ip || ed.ipV4 || ed.srcIp ||
                ed.externalIP || ed.externalIp || ed.addr || ed.address)) ||
        (s.src && typeof s.src === 'object' &&
            (s.src.currentPublicIp || s.src.publicIp || s.src.ip || s.src.ipV4 ||
             s.src.externalIP || s.src.externalIp || s.src.addr)) ||
        (typeof s.src === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(String(s.src).trim())
            ? String(s.src).trim() : null);

    if (ip) return ip;

    // Fallback: scan every top-level string field for a public IPv4 address.
    // This handles any field name Zero might use that we haven't hard-coded above.
    var pubIpRe = /^(?!10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.|169\.254\.)(\d{1,3}\.){3}\d{1,3}$/;
    var keys = Object.keys(s);
    for (var ki = 0; ki < keys.length; ki++) {
        var v = s[keys[ki]];
        if (typeof v === 'string') {
            var vt = v.trim();
            if (pubIpRe.test(vt)) return vt;
        }
    }

    return null;
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
            buildEmptyState(ZN_ICON_USERS, 'No session data', 'No active sessions were found for this selection');
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

// ── Map Combo Drawer state ─────────────────────────────────────────────────
var _mcdActiveTab          = 'users';
var _mcdSessFilter         = 'all';
var _mcdSessState          = { searchQuery: '', currentPage: 1, filteredSessions: [] };
var _mcdRhRows             = [];
var _mcdRhCurrentPage      = 1;
// When the drawer is opened from a map location click, these hold the
// sessions / region-names scoped to that location.  null = no filter (show all).
var _mcdLocationSessions   = null;  // Session[] | null
var _mcdLocationRegionNames = null; // string[]  | null

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
    znTrack('drawer_opened', { drawer: 'sessions' });
    var bd = document.getElementById('sessions-drawer-backdrop');
    if (!bd) return;
    sessionsDrawerFilter = 'all';
    sessionsDrawerState.searchQuery = '';
    sessionsDrawerState.sortColumn = null;
    sessionsDrawerState.sortDirection = 'asc';
    sessionsDrawerState.currentPage = 1;
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
            sessionsDrawerState.currentPage = 1;
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
            sessionsDrawerState.currentPage = 1;
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

/** Sessions drawer state: search filter, sort column, sort direction, pagination. */
var SDW_PAGE_SIZE = 25;
var sessionsDrawerState = {
    searchQuery: '',
    sortColumn: null,
    sortDirection: 'asc',
    currentPage: 1,
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

/** Render stats bar + session list + pagination; re-call after a filter change. */
function renderSessionsDrawerContent() {
    var allSessions = lastData.ses || [];
    sessionsDrawerState.allSessions = allSessions;

    // Count buckets from ALL sessions (not filtered by category) for the stats bar
    var totalActive = 0, totalOffline = 0;
    allSessions.forEach(function(s) {
        if (sessionDisplayState(s) === 'active') totalActive++;
        else totalOffline++;
    });
    var totalAll = allSessions.length;

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

    // ── Stats bar (3 segments: all / active / offline) ────────────────────
    var statsEl = document.getElementById('sessions-drawer-stats');
    if (statsEl) {
        var segs = [
            { key: 'all',     num: totalAll,     dot: 'hidden', label: 'all sessions' },
            { key: 'active',  num: totalActive,  dot: 'green',  label: 'active sessions' },
            { key: 'offline', num: totalOffline, dot: 'gray',   label: 'authenticated & offline' }
        ];
        statsEl.innerHTML = segs.map(function(seg) {
            var isActive = sessionsDrawerFilter === seg.key ? ' is-active' : '';
            return '<div class="sdw-stat-seg' + isActive + '" data-ses-filter="' + seg.key + '">' +
                '<span class="sdw-stat-dot sdw-stat-dot--' + seg.dot + '"></span>' +
                '<span class="sdw-stat-num">' + seg.num + '</span>' +
                '<span class="sdw-stat-label">' + escapeHtmlAttr(seg.label) + '</span>' +
                '</div>';
        }).join('');
        Array.prototype.forEach.call(statsEl.querySelectorAll('.sdw-stat-seg'), function(seg) {
            seg.addEventListener('click', function() {
                var f = seg.getAttribute('data-ses-filter');
                sessionsDrawerFilter = (sessionsDrawerFilter === f && f !== 'all') ? 'all' : f;
                sessionsDrawerState.currentPage = 1;
                renderSessionsDrawerContent();
            });
        });
    }

    // ── Pagination state ──────────────────────────────────────────────────
    var totalCount = sortedSessions.length;
    var totalPages = Math.max(1, Math.ceil(totalCount / SDW_PAGE_SIZE));
    var currentPage = Math.min(sessionsDrawerState.currentPage || 1, totalPages);
    sessionsDrawerState.currentPage = currentPage;
    var pageStart = (currentPage - 1) * SDW_PAGE_SIZE;
    var pageSessions = sortedSessions.slice(pageStart, pageStart + SDW_PAGE_SIZE);

    // ── Session list ──────────────────────────────────────────────────────
    var listEl = document.getElementById('sessions-drawer-list');
    if (!listEl) return;

    if (!sortedSessions.length) {
        listEl.innerHTML = '<div class="ses-empty">' + buildEmptyState(ZN_ICON_USERS, 'No sessions found', 'Try adjusting the filters or wait for new connections') + '</div>';
        listEl._znVisibleSessions = [];
        updateSortIndicators();
        renderSessionsPagination(0, 1, 1);
        return;
    }

    listEl.innerHTML = pageSessions.map(function(s, i) {
        var globalIdx = pageStart + i;
        var st = sessionDisplayState(s);
        var dotCls = st === 'active' ? 'ses-status-dot--active' : 'ses-status-dot--offline';
        var user  = escapeHtmlAttr(userName(s)  || '\u2014');
        var asset = escapeHtmlAttr(assetName(s) || '\u2014');
        var ip    = s.currentPublicIp != null ? s.currentPublicIp : sessionPublicIp(s);
        var country = escapeHtmlAttr(resolveIpToCountry(ip));
        var lastAuthRaw = formatLastAuthDisplay(getLastAuthTimeForSession(s));
        // Split date and time onto two lines if they contain a space (e.g. "1/25/2024 2:35 PM")
        var lastAuthHtml = lastAuthRaw
            ? (function() {
                var parts = String(lastAuthRaw).match(/^(\S+)\s+(.+)$/);
                return parts
                    ? escapeHtmlAttr(parts[1]) + '<br>' + escapeHtmlAttr(parts[2])
                    : escapeHtmlAttr(lastAuthRaw);
              }())
            : '\u2014';
        return '<div class="ses-row ses-row--sessions-drill cursor-pointer" data-ses-drawer-idx="' + globalIdx + '">' +
            '<div class="ses-row-user-cell">' +
                '<span class="ses-status-dot ' + dotCls + '"></span>' +
                '<span class="ses-row-user-name">' + user + '</span>' +
            '</div>' +
            '<div class="ses-row-cell">' + asset + '</div>' +
            '<div class="ses-row-cell">' + country + '</div>' +
            '<div class="ses-row-cell ses-row-cell--date">' + lastAuthHtml + '</div>' +
            '</div>';
    }).join('');
    listEl._znVisibleSessions = sortedSessions;
    updateSortIndicators();
    renderSessionsPagination(totalCount, currentPage, totalPages);

    // Re-render once real geo labels arrive
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

/** Render pagination controls for the sessions drawer. */
function renderSessionsPagination(totalCount, currentPage, totalPages) {
    var labelEl = document.getElementById('sdp-page-label');
    var totalEl = document.getElementById('sdp-total-count');
    var firstBtn = document.getElementById('sdp-first');
    var prevBtn  = document.getElementById('sdp-prev');
    var nextBtn  = document.getElementById('sdp-next');
    var lastBtn  = document.getElementById('sdp-last');
    if (labelEl) labelEl.textContent = currentPage + ' of ' + totalPages;
    if (totalEl) totalEl.textContent = 'Total count: ' + totalCount;
    var atFirst = currentPage <= 1;
    var atLast  = currentPage >= totalPages;
    if (firstBtn) firstBtn.disabled = atFirst;
    if (prevBtn)  prevBtn.disabled  = atFirst;
    if (nextBtn)  nextBtn.disabled  = atLast;
    if (lastBtn)  lastBtn.disabled  = atLast;
    // Wire buttons once
    if (firstBtn && !firstBtn.dataset.znPagWired) {
        firstBtn.dataset.znPagWired = '1';
        firstBtn.addEventListener('click', function() { sessionsDrawerState.currentPage = 1; renderSessionsDrawerContent(); });
        prevBtn.addEventListener('click',  function() { sessionsDrawerState.currentPage = Math.max(1, (sessionsDrawerState.currentPage || 1) - 1); renderSessionsDrawerContent(); });
        nextBtn.addEventListener('click',  function() { sessionsDrawerState.currentPage = Math.min(totalPages, (sessionsDrawerState.currentPage || 1) + 1); renderSessionsDrawerContent(); });
        lastBtn.addEventListener('click',  function() { sessionsDrawerState.currentPage = totalPages; renderSessionsDrawerContent(); });
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

// ── Policy-as-source-of-truth helpers ────────────────────────────────────────
// Returns the Connect policy (role) object for a session, or null if not found.
function getPolicyForSession(s) {
    if (!s || !lastData.policyById) return null;
    var id = s.roleId || s.uacId || s.policyId ||
             (s.uac  && (s.uac.id  || s.uac.roleId)) ||
             (s.role && s.role.id) ||
             (s.policy && s.policy.id) || null;
    return id ? (lastData.policyById[id] || null) : null;
}

// Returns true if the policy has alwaysOn configured.
// Falls back to the session's own field when no policy is resolved.
function sessionAlwaysOnFromPolicy(s) {
    var p = getPolicyForSession(s);
    return p !== null ? p.alwaysOn === true : s.alwaysOn === true;
}

// Returns true if the policy has connectAfterBoot configured.
function sessionConnectAfterBootFromPolicy(s) {
    var p = getPolicyForSession(s);
    return p !== null ? p.connectAfterBoot === true : postureKpiConnectAfterBootTrue(s);
}

// Returns true if the policy has a device posture profile attached.
function sessionHasDevicePostureFromPolicy(s) {
    var p = getPolicyForSession(s);
    if (!p) return false;
    return !!(p.devicePostureProfileId || p.postureProfileId ||
              (p.devicePostureProfile && p.devicePostureProfile.id) ||
              (p.postureProfile       && p.postureProfile.id));
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
 * connect + sessions: details.user only. policy: performedBy.name (no region filter). region_health/posture_audit: no filter.
 */
function filterAuditsForActivityChartScope(poolItems, mode) {
    var pool = poolItems || [];

    if (mode === 'region_health' || mode === 'posture_audit') {
        // system-generated events — skip all filters
        return pool;
    }

    if (mode === 'policy') {
        // policy events are admin actions with no region; apply user filter only
        // (auditEventUser falls back to performedBy.name when details.user is absent)
        pool = filterAuditsByDashboardUser(pool);
        return pool;
    }

    // connect, sessions: apply full user + region filter
    pool = filterAuditsByDashboardFilters(pool);
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
    var elT = document.getElementById('kpi-total-sessions');
    if (elA) elA.textContent = String(a);
    if (elO) elO.textContent = String(o);
    if (elT) elT.textContent = String(a + o);
    document.getElementById('trend-active').textContent = '';

    var alwaysOnCount = 0;
    var afterBootCount = 0;
    var totalActive = filteredActive.length;
    filteredActive.forEach(function(s) {
        if (sessionAlwaysOnFromPolicy(s))        alwaysOnCount++;
        if (sessionConnectAfterBootFromPolicy(s)) afterBootCount++;
    });
    var validatedTotal = alwaysOnCount + afterBootCount;

    var kpiAo  = document.getElementById('kpi-posture-always-on');
    var kpiCab = document.getElementById('kpi-posture-connect-after-boot');
    if (kpiAo)  kpiAo.textContent  = String(alwaysOnCount);
    if (kpiCab) kpiCab.textContent = String(afterBootCount);

    var elAoPct  = document.getElementById('kpi-posture-always-on-pct');
    var elCabPct = document.getElementById('kpi-posture-connect-after-boot-pct');
    if (elAoPct)  elAoPct.textContent  = totalActive > 0 ? '(' + Math.round(alwaysOnCount  / totalActive * 100) + '%)' : '';
    if (elCabPct) elCabPct.textContent = totalActive > 0 ? '(' + Math.round(afterBootCount / totalActive * 100) + '%)' : '';

    var elTotal = document.getElementById('kpi-posture-validated-total');
    var elTotalPct = document.getElementById('kpi-posture-validated-total-pct');
    if (elTotal) elTotal.textContent = totalActive > 0 ? String(validatedTotal) : '\u2014';
    if (elTotalPct) elTotalPct.textContent = totalActive > 0 ? '(' + Math.round(validatedTotal / totalActive * 100) + '%)' : '';
}

// ── 1. Audit Activity — multi-mode chart (30d pool, window = dauChartRangeDays) ─
function renderActivityExplorerChart(allItems, period) {
    void period;
    var poolItems = filterByPeriod(allItems || [], '30d');
    var mode = activityChartMode || 'connect';
    if (mode !== 'connect' && mode !== 'sessions' && mode !== 'region_health' && mode !== 'policy' && mode !== 'posture_audit') {
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
    var connectBorderPal = ['#00cec9', '#00b894', '#74b9ff', '#a29bfe', '#0984e3', '#6c5ce7', '#55efc4', '#fd79a8', '#fab1a0', '#fdcb6e'];

    if (auditChartInstance) {
        try { auditChartInstance.destroy(); } catch (e) { /* noop */ }
        auditChartInstance = null;
    }
    auditChartDrillContext = null;
    znAuditActivityConnectDailyInsights = null;
    znAuditActivityPolicyDailyInsights = null;
    znAuditActivityPostureDailyInsights = null;
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
                borderColor: '#00cec9',
                backgroundColor: 'rgba(0,206,201,0.15)',
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 4,
                borderWidth: 2
            }];
        } else {
            datasets = regionsSorted.map(function(reg, i) {
                var hex = connectBorderPal[i % connectBorderPal.length];
                return {
                    label: reg,
                    data: perBucket.map(function(byReg) { return byReg[reg] || 0; }),
                    borderColor: hex,
                    backgroundColor: hexToRgba(hex, 0.15),
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 3,
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
        chartOptions.onClick = function(evt, elements, chart) {
            if (!elements || !elements.length) return;
            var hit = elements[0];
            var dataIdx = hit.index;
            var dayLab = chart.data.labels[dataIdx] != null ? String(chart.data.labels[dataIdx]) : String(dataIdx);
            var insights = znAuditActivityConnectDailyInsights && znAuditActivityConnectDailyInsights[dayLab];
            if (!insights) return;
            openSessionCreationDrawer(dayLab, insights);
        };
        chartOptions.onHover = function(evt, elements) {
            if (evt && evt.native && evt.native.target) {
                evt.native.target.style.cursor = elements && elements.length ? 'pointer' : 'default';
            }
        };
    } else if (mode === 'sessions') {
        chartType = 'bar';
        var sessTypes = [
            { label: 'Expired',  type: 97,  color: '#31B7E1', bg: 'rgba(49,183,225,0.8)' },
            { label: 'Extended', type: 123, color: '#00AD7A', bg: 'rgba(0,173,122,0.8)' },
            { label: 'Logout',   type: 99,  color: '#7083E9', bg: 'rgba(112,131,233,0.8)' },
            { label: 'Revoked',  type: 98,  color: '#DB7800', bg: 'rgba(219,120,0,0.8)' }
        ];
        datasets = sessTypes.map(function(st) {
            return {
                label: st.label,
                data: timeBuckets.map(function(b) {
                    return countAuditTypeInBucketRange(poolItems, st.type, b.startMs, b.endMs);
                }),
                backgroundColor: st.bg,
                borderColor: st.color,
                borderWidth: 0,
                borderRadius: 2,
                borderSkipped: false
            };
        });
        chartOptions.scales.x.stacked = true;
        chartOptions.scales.y.stacked = true;
        if (chartOptions.scales.y.title) chartOptions.scales.y.title.text = 'Events';
        chartOptions.plugins.tooltip = {
            enabled: false,
            external: customRichTooltip
        };
    } else if (mode === 'region_health') {
        chartType = 'bar';
        var rhRecovered = timeBuckets.map(function(b) {
            return countAuditTypeInBucketRange(poolItems, 352, b.startMs, b.endMs);
        });
        var rhDown = timeBuckets.map(function(b) {
            return countAuditTypeInBucketRange(poolItems, 351, b.startMs, b.endMs);
        });
        datasets = [
            {
                label: 'Recovered',
                data: rhRecovered,
                backgroundColor: 'rgba(0,173,122,0.8)',
                borderColor: '#00AD7A',
                borderWidth: 0,
                borderRadius: 2,
                borderSkipped: false
            },
            {
                label: 'Down',
                data: rhDown.map(function(v) { return -v; }),
                backgroundColor: 'rgba(255,77,77,0.8)',
                borderColor: '#FF4D4D',
                borderWidth: 0,
                borderRadius: 2,
                borderSkipped: false
            }
        ];
        var rhMax = 0;
        rhRecovered.forEach(function(v) { if (v > rhMax) rhMax = v; });
        rhDown.forEach(function(v) { if (v > rhMax) rhMax = v; });
        rhMax = Math.max(rhMax, 1);
        var rhPad = Math.ceil(rhMax * 0.25) || 2;
        chartOptions.scales.y.min = -(rhMax + rhPad);
        chartOptions.scales.y.max = rhMax + rhPad;
        chartOptions.scales.y.beginAtZero = false;
        chartOptions.scales.y.ticks = {
            precision: 0,
            font: { size: 10 },
            color: '#7e90ab',
            callback: function(val) { return Math.abs(val); }
        };
        chartOptions.scales.x.stacked = false;
        chartOptions.scales.y.stacked = false;
        chartOptions.scales.x.grouped = false;
        if (chartOptions.scales.y.title) chartOptions.scales.y.title.text = 'Events';
        chartOptions.plugins.tooltip = {
            enabled: false,
            external: customRichTooltip
        };
    } else if (mode === 'policy') {
        chartType = 'bar';
        datasets = [
            {
                label: 'Policy created',
                data: timeBuckets.map(function(b) {
                    return countPolicyOpTypeInBucketRange(poolItems, 100, b.startMs, b.endMs);
                }),
                backgroundColor: 'rgba(99,102,241,0.78)',
                borderColor: '#6366f1',
                borderWidth: 1
            },
            {
                label: 'Policy edited',
                data: timeBuckets.map(function(b) {
                    return countPolicyOpTypeInBucketRange(poolItems, 101, b.startMs, b.endMs);
                }),
                backgroundColor: 'rgba(14,165,233,0.72)',
                borderColor: '#0ea5e9',
                borderWidth: 1
            },
            {
                label: 'Policy deleted',
                data: timeBuckets.map(function(b) {
                    return countPolicyOpTypeInBucketRange(poolItems, 102, b.startMs, b.endMs);
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
    } else if (mode === 'posture_audit') {
        chartType = 'bar';
        datasets = [
            {
                label: 'Violations Found',
                data: timeBuckets.map(function(b) {
                    return countAuditTypeInBucketRange(poolItems, 390, b.startMs, b.endMs) +
                           countAuditTypeInBucketRange(poolItems, 374, b.startMs, b.endMs);
                }),
                backgroundColor: 'rgba(239,68,68,0.72)',
                borderColor: '#ef4444',
                borderWidth: 1
            },
            {
                label: 'Resolved',
                data: timeBuckets.map(function(b) {
                    return countAuditTypeInBucketRange(poolItems, 391, b.startMs, b.endMs);
                }),
                backgroundColor: 'rgba(0,168,118,0.72)',
                borderColor: '#00a876',
                borderWidth: 1
            },
            {
                label: 'Profile / Config',
                data: timeBuckets.map(function(b) {
                    return [387,388,389,392,393,394].reduce(function(s, tid) {
                        return s + countAuditTypeInBucketRange(poolItems, tid, b.startMs, b.endMs);
                    }, 0);
                }),
                backgroundColor: 'rgba(100,116,139,0.55)',
                borderColor: '#64748b',
                borderWidth: 1
            }
        ];
        chartOptions.scales.x.stacked = false;
        chartOptions.scales.y.stacked = false;
        if (chartOptions.scales.y.title) chartOptions.scales.y.title.text = 'Events';

        znAuditActivityPostureDailyInsights = buildPostureAuditDailyInsights(poolItems, timeBuckets);
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
            if (ctxClick.mode === 'posture_audit') {
                var postureEvents = [];
                [374, 387, 388, 389, 390, 391, 392, 393, 394].forEach(function(tid) {
                    postureEvents = postureEvents.concat(filterAuditsForActivityBarSegment(ctxClick.poolItems, tid, bucket));
                });
                postureEvents.sort(function(a, b) { return (getAuditItemTs(b) || 0) - (getAuditItemTs(a) || 0); });
                openPostureAuditDrawer(dayLab, postureEvents);
                return;
            }
            if (ctxClick.mode === 'sessions') {
                var sessEvents = [];
                [97, 98, 99, 123].forEach(function(tid) {
                    sessEvents = sessEvents.concat(filterAuditsForActivityBarSegment(ctxClick.poolItems, tid, bucket));
                });
                sessEvents.sort(function(a, b) { return (getAuditItemTs(b) || 0) - (getAuditItemTs(a) || 0); });
                openSessionAuditDrawer(dayLab, sessEvents);
                return;
            }
            if (ctxClick.mode === 'region_health') {
                var rhEvents = [];
                [351, 352].forEach(function(tid) {
                    rhEvents = rhEvents.concat(filterAuditsForActivityBarSegment(ctxClick.poolItems, tid, bucket));
                });
                rhEvents.sort(function(a, b) { return (getAuditItemTs(b) || 0) - (getAuditItemTs(a) || 0); });
                openRegionAuditDrawer(dayLab, rhEvents);
                return;
            }
            var typeId = auditActivityBarTypeId(ctxClick.mode, dsIdx);
            var matched = filterAuditsForActivityBarSegment(ctxClick.poolItems, typeId, bucket);
            var ds = chart.data.datasets[dsIdx];
            var typeLab = ds && ds.label != null ? String(ds.label) : String(typeId);
            /* unknown segment type — no action */
        };
    } else {
        if (mode !== 'connect') delete chartOptions.onClick;
    }

    var ctx = canvasEl.getContext('2d');
    auditChartInstance = new Chart(ctx, {
        type: chartType,
        data: { labels: newLabels, datasets: datasets },
        options: chartOptions,
        plugins: [
            {
                id: 'znDauLegendSync',
                afterUpdate: function(chart) {
                    syncDauChartHtmlLegend(chart);
                }
            },
            {
                id: 'znLinesOnTop',
                afterDraw: function(chart) {
                    if (activityChartMode !== 'connect') return;
                    var ctx2 = chart.ctx;
                    var ca = chart.chartArea;
                    if (!ca) return;
                    ctx2.save();
                    ctx2.beginPath();
                    ctx2.rect(ca.left, ca.top, ca.right - ca.left, ca.bottom - ca.top);
                    ctx2.clip();
                    chart.data.datasets.forEach(function(ds, i) {
                        if (!chart.isDatasetVisible(i)) return;
                        var meta = chart.getDatasetMeta(i);
                        if (!meta || meta.type !== 'line') return;
                        var pts = meta.data;
                        if (!pts || pts.length < 2) return;
                        ctx2.save();
                        ctx2.beginPath();
                        ctx2.moveTo(pts[0].x, pts[0].y);
                        for (var j = 1; j < pts.length; j++) {
                            var prev = pts[j - 1];
                            var curr = pts[j];
                            if (prev.cp2x !== undefined && curr.cp1x !== undefined) {
                                ctx2.bezierCurveTo(prev.cp2x, prev.cp2y, curr.cp1x, curr.cp1y, curr.x, curr.y);
                            } else {
                                ctx2.lineTo(curr.x, curr.y);
                            }
                        }
                        ctx2.strokeStyle = String(ds.borderColor || '#ccc').replace(/"/g, '');
                        ctx2.lineWidth = ds.borderWidth || 2;
                        ctx2.lineJoin = 'round';
                        ctx2.lineCap = 'round';
                        ctx2.stroke();
                        ctx2.restore();
                    });
                    ctx2.restore();
                }
            }
        ]
    });
    syncDauChartHtmlLegend(auditChartInstance);
    syncActivityChartControlUi();
}

function renderAuditChart(allItems, period) {
    renderActivityExplorerChart(allItems, period);
}

// ── 2. OS Distribution — donut chart by major family (active sessions) ─────
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
            var hasSessions = Array.isArray(lastData.ses) && lastData.ses.length > 0;
            el.innerHTML = '<div class="ses-empty">' + buildEmptyState(
                ZN_ICON_USERS,
                hasSessions ? 'No active sessions' : 'No sessions yet',
                hasSessions ? 'All registered sessions are currently offline' : 'OS distribution will appear once sessions are connected'
            ) + '</div>';
            return;
        }

        var famKeys = Object.keys(families).sort(function(a, b) {
            return families[b].total - families[a].total;
        });

        var palette = ['#4861EE', '#BDD0FB', '#818cf8', '#a5b4fc', '#c7d2fe'];
        var colors  = famKeys.map(function(_, i) { return palette[Math.min(i, palette.length - 1)]; });
        var values  = famKeys.map(function(fam) { return families[fam].total; });

        // Inject donut wrapper + canvas + legend container
        el.innerHTML =
            '<div class="os-donut-wrap">' +
                '<canvas id="os-donut-canvas"></canvas>' +
                '<div class="os-donut-legend" id="os-donut-legend"></div>' +
            '</div>';

        // Draw donut chart
        var canvas = document.getElementById('os-donut-canvas');
        if (canvas) {
            var dpr  = window.devicePixelRatio || 1;
            var size = 120;
            canvas.width  = size * dpr;
            canvas.height = size * dpr;
            canvas.style.width  = size + 'px';
            canvas.style.height = size + 'px';

            var ctx  = canvas.getContext('2d');
            ctx.scale(dpr, dpr);

            var cx    = size / 2;
            var cy    = size / 2;
            var r     = size / 2 - 6;
            var inner = r * 0.62;
            var start = -Math.PI / 2;

            values.forEach(function(v, i) {
                var angle = (v / grandTotal) * Math.PI * 2;
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.arc(cx, cy, r, start, start + angle);
                ctx.closePath();
                ctx.fillStyle = colors[i];
                ctx.fill();
                start += angle;
            });

            // punch hole to form donut
            ctx.globalCompositeOperation = 'destination-out';
            ctx.beginPath();
            ctx.arc(cx, cy, inner, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalCompositeOperation = 'source-over';

            // center: total count
            ctx.fillStyle    = '#1f2937';
            ctx.font         = 'bold 22px Inter,sans-serif';
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(grandTotal, cx, cy + 4);

            // center: "Active sessions" two-line label
            ctx.fillStyle = '#9ca3af';
            ctx.font      = '10px Inter,sans-serif';
            ctx.fillText('Active',   cx, cy + 17);
            ctx.fillText('sessions', cx, cy + 28);
        }

        // Render legend — each item is clickable and opens the OS drawer
        var legendEl = document.getElementById('os-donut-legend');
        if (legendEl) {
            legendEl.innerHTML = famKeys.map(function(fam, i) {
                var count = families[fam].total;
                var pct   = Math.round(count / grandTotal * 100);
                return '<div class="os-donut-item os-family-row cursor-pointer" data-os-family="' + escapeHtmlAttr(fam) + '">' +
                    '<div class="os-donut-dot" style="background:' + colors[i] + '"></div>' +
                    '<div class="os-donut-info">' +
                        '<div class="os-donut-row">' +
                            '<span class="os-donut-name">' + escapeHtmlAttr(fam) + '</span>' +
                            '<span class="os-donut-count">' + count + '</span>' +
                        '</div>' +
                        '<div class="os-donut-pct">' + pct + '% of users</div>' +
                    '</div>' +
                '</div>';
            }).join('');
        }

        // Wire canvas slice clicks by tracking segment angles
        if (canvas) {
            var segAngles = [];
            var segStart = -Math.PI / 2;
            values.forEach(function(v, i) {
                var sweep = (v / grandTotal) * Math.PI * 2;
                segAngles.push({ fam: famKeys[i], start: segStart, end: segStart + sweep });
                segStart += sweep;
            });
            canvas.style.cursor = 'pointer';
            canvas.addEventListener('click', function(e) {
                var rect = canvas.getBoundingClientRect();
                var cx   = rect.width  / 2;
                var cy   = rect.height / 2;
                var dx   = e.clientX - rect.left  - cx;
                var dy   = e.clientY - rect.top   - cy;
                var dist = Math.sqrt(dx * dx + dy * dy);
                var r    = (120 / 2 - 6);
                var innerR = r * 0.62;
                if (dist < innerR || dist > r) return; // inside hole or outside ring
                var angle = Math.atan2(dy, dx);
                // Normalize to [-π/2, 3π/2) range that matches our segment starts
                while (angle < -Math.PI / 2) angle += Math.PI * 2;
                for (var i = 0; i < segAngles.length; i++) {
                    var seg = segAngles[i];
                    if (angle >= seg.start && angle < seg.end) {
                        openOsDrawer(seg.fam);
                        return;
                    }
                }
            });
        }

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

/** Lightweight bounds accumulator compatible with MapLibre's fitBounds format. */
function znCreateMapBounds() {
    return {
        _pts: [],
        extend: function(latLng) { this._pts.push(latLng); },
        isValid: function() { return this._pts.length > 0; },
        toMLBounds: function() {
            var minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
            this._pts.forEach(function(p) {
                if (p[0] < minLat) minLat = p[0];
                if (p[0] > maxLat) maxLat = p[0];
                if (p[1] < minLng) minLng = p[1];
                if (p[1] > maxLng) maxLng = p[1];
            });
            // Pad single-point bounds so fitBounds doesn't zoom in to infinity.
            if (minLat === maxLat) { minLat -= 2; maxLat += 2; }
            if (minLng === maxLng) { minLng -= 2; maxLng += 2; }
            return [[minLng, minLat], [maxLng, maxLat]];
        },
        /**
         * Geographic centroid via 3D unit-vector averaging.
         * This correctly handles anti-meridian wraparound: points in North America
         * (-100°) and East Asia (+140°) produce a centroid over the Pacific, not Africa.
         * Returns [lat, lng] in degrees.
         */
        centroid: function() {
            if (this._pts.length === 0) return [0, 0];
            var x = 0, y = 0, z = 0;
            this._pts.forEach(function(p) {
                var lat = p[0] * Math.PI / 180;
                var lng = p[1] * Math.PI / 180;
                x += Math.cos(lat) * Math.cos(lng);
                y += Math.cos(lat) * Math.sin(lng);
                z += Math.sin(lat);
            });
            var n = this._pts.length;
            x /= n; y /= n; z /= n;
            var lng = Math.atan2(y, x) * 180 / Math.PI;
            var hyp = Math.sqrt(x * x + y * y);
            var lat = Math.atan2(z, hyp) * 180 / Math.PI;
            return [lat, lng];
        },
        /**
         * Maximum great-circle distance (degrees) from the centroid to any stored point.
         * Used to pick a zoom level that keeps all dots on-screen.
         */
        maxAngularRadius: function() {
            var c = this.centroid();
            var cLat = c[0] * Math.PI / 180;
            var cLng = c[1] * Math.PI / 180;
            var maxAngle = 0;
            this._pts.forEach(function(p) {
                var lat = p[0] * Math.PI / 180;
                var lng = p[1] * Math.PI / 180;
                var dLat = lat - cLat;
                var dLng = lng - cLng;
                var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                        Math.cos(cLat) * Math.cos(lat) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
                var angle = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 180 / Math.PI;
                if (angle > maxAngle) maxAngle = angle;
            });
            return maxAngle;
        }
    };
}

/**
 * Fly the globe camera to the geographic centroid of all accumulated points,
 * at a zoom level derived from their angular spread.
 * Replaces fitBounds for globe projection where 2D bounding-box math produces
 * misleading results (e.g. centering on Africa when users span Americas + Asia).
 */
function znGlobeFlyToBounds(bounds, maxZoom) {
    if (!bounds || !bounds.isValid() || !leafletMap) return false;
    // _znMapSourcesReady is set only after the 'load' event fires AND sources are
    // fully initialised.  This is a stricter guard than loaded(): in MapLibre v5
    // loaded() can return true while the internal camera transform is still null,
    // causing flyTo to throw "Cannot read properties of null (reading '0')"
    // asynchronously inside the animation loop (where try/catch cannot catch it).
    if (!_znMapSourcesReady) return false;
    var centroid = bounds.centroid();
    var radius   = bounds.maxAngularRadius();
    // Map angular radius → zoom.  At globe zoom≈1 you see ~90° radius; each
    // additional zoom halves the visible angle.  Add 0.3 zoom of padding.
    var zoom = radius < 0.1
        ? maxZoom
        : Math.min(maxZoom, Math.max(1, Math.log2(80 / Math.max(radius, 1)) + 0.3));
    try {
        // Stop any in-progress animation (lat-clamp easeTo, previous flyTo, etc.)
        // before starting a new one.  Without this MapLibre v5 throws
        // "Attempting to run(), but is already running." asynchronously.
        leafletMap.stop();
        leafletMap.flyTo({ center: [centroid[1], centroid[0]], zoom: zoom, animate: true });
        return true;
    } catch (e) {
        // Use debug rather than warn so Vite's error overlay doesn't surface this.
        console.debug('[ZN Map] znGlobeFlyToBounds failed:', e.message);
        return false;
    }
}

/**
 * Debounced fitBounds — waits 500 ms of inactivity before panning the camera.
 * This prevents the map from jerking on every individual marker that pops in
 * via updateMapProgressively(); instead the viewport settles once after a burst.
 *
 * Uses spherical-centroid flyTo so the globe faces the actual cluster of dots
 * rather than the midpoint of a 2D bounding box (which lands on Africa when
 * users span the Americas and Asia).
 */
function debouncedFitBounds() {
    if (mapBoundsFitTimer) clearTimeout(mapBoundsFitTimer);
    mapBoundsFitTimer = setTimeout(function() {
        mapBoundsFitTimer = null;
        // Once the user has manually panned or zoomed, don't override their view.
        if (_mapUserHasInteracted) return;
        if (!leafletMap || !mapBounds || !mapBounds.isValid()) return;
        var maxZ = getSelectedDashboardUserName() ? 9 : 5;
        znGlobeFlyToBounds(mapBounds, maxZ);
        // Suppress further auto-fits from progressive IP resolutions — the globe
        // has already flown to the best-fit view; trickle-in dots should appear
        // silently rather than repeatedly dragging the camera around.
        _mapAutoFitDone = true;
    }, 500);
}

// ── 3. MapLibre GL map (Servers / Users / Both, built-in GeoJSON clustering) ──
function renderMap(sessions) {
    // ── Init map once ────────────────────────────────────────────────────
    if (!leafletMap && !renderMap._initInProgress) {
        renderMap._initInProgress = true;

        // Remove any orphaned canvas/container nodes left by previous failed init attempts.
        var _mapEl = document.getElementById('map');
        if (_mapEl) {
            while (_mapEl.firstChild) { _mapEl.removeChild(_mapEl.firstChild); }
        }

        // Always start at the neutral world view so debouncedFitBounds can
        // position the camera on the session dots once data loads.
        // (The localStorage position is preserved for recenterConnectivityMap.)
        var initCenter = [20, 0];
        var initZoom = 2;

        var _mapInitOptions = {
            container: 'map',
            center: [initCenter[1], initCenter[0]], // MapLibre: [lng, lat]
            zoom: initZoom,
            minZoom: 0.5,
            maxZoom: 19,
            // maxBounds is intentionally omitted here — passing it in the constructor
            // triggers a constrainInternal() → _calcMatrices() call before the projection
            // matrices are ready in MapLibre v5, causing a null-dereference crash.
            // It is applied via setMaxBounds() immediately after construction instead.
            attributionControl: false,
            cooperativeGestures: false,
        };

        function _createMap(style) {
            _mapInitOptions.style = style;
            leafletMap = new maplibregl.Map(_mapInitOptions);
            renderMap._initInProgress = false;
            // Limit scroll/pinch zoom speed: default wheel rate is 1/450 and trackpad
            // rate is 1/100, which feels too fast. Halving both caps max zoom velocity.
            leafletMap.scrollZoom.setWheelZoomRate(1 / 900);
            leafletMap.scrollZoom.setZoomRate(1 / 200);

            // MapLibre 5.x globe projection does not support easeTo/flyTo with an
            // `around` point (the scroll-zoom cursor anchor).  The warning is benign —
            // the map still zooms correctly — but Vite's overlay treats it as a crash.
            // Suppress it at the source by patching console.warn for this one message.
            (function() {
                var _origWarn = console.warn.bind(console);
                console.warn = function() {
                    if (arguments[0] && typeof arguments[0] === 'string' &&
                        /easing around a point is not supported under globe/i.test(arguments[0])) {
                        return;
                    }
                    _origWarn.apply(console, arguments);
                };
            })();

            leafletMap.on('error', function(e) {
                // Silently drop tile/sprite/glyph fetch errors and the globe easing
                // warning so they don't surface in the Vite dev-overlay.
                var msg = (e && e.error && e.error.message) ? e.error.message : String(e);
                if (/glyph|font|pbf|sprite|tile|easing around/i.test(msg)) return;
                console.warn('[MapLibre]', msg);
            });
            leafletMap.on('load', function() {
                // Hard north/south pan limit: clamp in real-time during drag so the
                // map never shows content past ±60° latitude.  Using 'move' (not
                // 'moveend') so it acts as a wall rather than a snap-back after release.
                // stop() kills inertia momentum so the globe can't wrap over the poles.
                var _latClampBusy = false;
                leafletMap.on('move', function() {
                    if (!leafletMap || _latClampBusy) return;
                    var c = leafletMap.getCenter();
                    var LAT_LIMIT = 60;
                    if (Math.abs(c.lat) > LAT_LIMIT) {
                        _latClampBusy = true;
                        leafletMap.stop();
                        leafletMap.setCenter([c.lng, c.lat > 0 ? LAT_LIMIT : -LAT_LIMIT]);
                        _latClampBusy = false;
                    }
                });

                try {
                    _znMapInitSources();
                } catch (initErr) {
                    console.error('[ZN Map] _znMapInitSources failed:', initErr);
                }
                // Use the freshest available data — the closure's `sessions` may be
                // stale if data arrived while the style was still loading.
                var freshSessions = (lastData && lastData.ses)
                    ? filterSessionsByDashboardFilters(lastData.ses)
                    : sessions;
                _znRenderMapData(freshSessions);
            });

            var mapEl = document.getElementById('map');
            if (mapEl && typeof ResizeObserver !== 'undefined') {
                new ResizeObserver(znSafeMapResize).observe(mapEl);
            }
            // Stop wheel/pinch events from bubbling to the page's scroll container
            // so that trackpad pinch-to-zoom and scroll-to-zoom work on macOS and Windows.
            if (mapEl) {
                mapEl.addEventListener('wheel', function(e) {
                    // Disarm auto-fit on the first wheel event from the user.
                    if (!_mapUserHasInteracted) {
                        _mapUserHasInteracted = true;
                        if (mapBoundsFitTimer) { clearTimeout(mapBoundsFitTimer); mapBoundsFitTimer = null; }
                    }
                    e.stopPropagation();
                }, { passive: false });
            }
            setTimeout(znSafeMapResize, 100);

            // Disarm auto-fit the instant the user starts moving the map —
            // don't wait for moveend, which fires only after the animation ends.
            leafletMap.on('movestart', function(e) {
                if (e && e.originalEvent) {
                    _mapUserHasInteracted = true;
                    if (mapBoundsFitTimer) { clearTimeout(mapBoundsFitTimer); mapBoundsFitTimer = null; }
                }
            });
            leafletMap.on('moveend', function(e) {
                if (!leafletMap) return;
                // Mark that the user has manually interacted so debouncedFitBounds
                // stops overriding their chosen view.  Programmatic moves (fitBounds,
                // flyTo) have no originalEvent.
                if (e && e.originalEvent) _mapUserHasInteracted = true;
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

        fetch('https://tiles.openfreemap.org/styles/positron')
            .then(function(r) { return r.json(); })
            .then(function(style) {
                style.layers = (style.layers || []).filter(function(l) { return l.type !== 'symbol'; });
                delete style.glyphs;
                // Bake globe projection into the style so it is active from the first
                // render frame — avoids a post-load setProjection() call which fires a
                // styledata event that temporarily marks sources as unloaded and wipes markers.
                style.projection = { type: 'globe' };
                _createMap(style);
            })
            .catch(function(err) {
                console.warn('[ZN Map] Style fetch failed, using dark fallback:', err && err.message);
                renderMap._initInProgress = false;
                _createMap({
                    version: 8,
                    sources: {},
                    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#1e293b' } }],
                    projection: { type: 'globe' }
                });
            });

    } else {
        _znRenderMapData(sessions);
    }
}

// ── Donut marker helpers ──────────────────────────────────────────────────────

/** Returns label font-size in px — larger when zoomed out for readability. */
function _znDonutFontSize(zoom) {
    if (zoom <= 2) return 13;
    if (zoom <= 4) return 12;
    if (zoom <= 6) return 10;
    return 9;
}

/**
 * Build the SVG string for a donut marker.
 *
 * Layout (56 × 86 px, ring centre at 28,43):
 *   ┌──────────────────────┐
 *   │  ╭── green chip ──╮  │  ← user count pill, above ring
 *   │  ╰────────────────╯  │
 *   │       (ring)         │
 *   │  ╭── blue chip  ──╮  │  ← region count pill, below ring
 *   │  ╰────────────────╯  │
 *   └──────────────────────┘
 *
 * Each pill has transparent fill and a coloured stroke so the chip
 * sits cleanly above the map tiles without blocking them.
 * Plain SVG text — no MapLibre glyph server required.
 */
function _znMakeDonutSVG(userCount, regionCount, fontSize, chipFlip) {
    // SVG is wider than the ring so chips with "N users" / "N regions" text fit.
    // Ring centre (CX,CY) = element centre (W/2, H/2) so anchor:'center' keeps the
    // ring pinned to the geographic coordinate.
    var W = 120, H = 86, CX = 60, CY = 43, R = 16, SW = 5;
    var C    = 2 * Math.PI * R;  // ≈ 100.53
    var HALF = C / 2;            // ≈ 50.27
    var fs   = fontSize || 11;
    var FF   = 'font-family="Inter,system-ui,sans-serif"';

    // Ring outer edge: CY ± (R + SW/2) → top ≈ 24.5, bottom ≈ 61.5
    // Default: user chip above ring (12-o'clock endpoint), region chip below (6-o'clock endpoint).
    // chipFlip = true  →  swap: user chip moves to the bottom endpoint, region chip to the top.
    //   Use flip when more connection arrows arrive from above (the top endpoint is busier).
    var CHIP_H  = 16, CHIP_RX = 8;
    var USER_Y,  USER_CY, REGION_Y, REGION_CY;
    if (chipFlip) {
        USER_Y   = 65; USER_CY   = 73;   // user chip at bottom endpoint
        REGION_Y = 5;  REGION_CY = 13;   // region chip at top endpoint
    } else {
        USER_Y   = 5;  USER_CY   = 13;   // user chip at top endpoint (default)
        REGION_Y = 65; REGION_CY = 73;   // region chip at bottom endpoint (default)
    }

    // Chip width scales with the rendered text "N label" (rough proportional estimate).
    function chipW(n, label) {
        var chars = String(n).length + 1 + label.length;  // digits + space + label
        return Math.round(chars * fs * 0.60) + 14;
    }

    // Renders a pill chip with "N label" — number in bold, label in regular weight.
    function chip(n, label, chipY, centerY, fillColor) {
        var cw = chipW(n, label), cx = CX - cw / 2;
        return '<rect x="' + cx + '" y="' + chipY + '" width="' + cw + '" height="' + CHIP_H + '" rx="' + CHIP_RX + '"' +
            ' fill="' + fillColor + '" stroke="none"/>' +
            '<text x="' + CX + '" y="' + centerY + '" text-anchor="middle" dominant-baseline="central"' +
            ' fill="#374151" font-size="' + fs + '" ' + FF + '>' +
            '<tspan font-weight="bold">' + n + '</tspan>' +
            '<tspan font-weight="normal"> ' + label + '</tspan>' +
            '</text>';
    }

    function ring(extra) {
        return '<circle cx="' + CX + '" cy="' + CY + '" r="' + R + '" fill="none" stroke-width="' + SW + '" ' + extra + '/>';
    }

    var parts = ['<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">'];

    if (userCount > 0 && regionCount > 0) {
        // Dark backdrop so the gap between arcs doesn't expose map tiles
        parts.push(ring('stroke="#1e293b"'));
        // Top half — green (users), starting from 12 o'clock going clockwise
        parts.push(ring('stroke="#0CD89B"' +
            ' stroke-dasharray="' + HALF.toFixed(2) + ' ' + C.toFixed(2) + '"' +
            ' stroke-dashoffset="0" transform="rotate(-90 ' + CX + ' ' + CY + ')"'));
        // Bottom half — blue (regions)
        parts.push(ring('stroke="#3b82f6"' +
            ' stroke-dasharray="' + HALF.toFixed(2) + ' ' + C.toFixed(2) + '"' +
            ' stroke-dashoffset="' + (-HALF).toFixed(2) + '" transform="rotate(-90 ' + CX + ' ' + CY + ')"'));
        parts.push(chip(userCount,   'users',   USER_Y,   USER_CY,   '#0CD89B'));
        parts.push(chip(regionCount, 'regions', REGION_Y, REGION_CY, '#93c5fd'));
    } else if (userCount > 0) {
        parts.push(ring('stroke="#0CD89B"'));
        parts.push(chip(userCount, 'users', USER_Y, USER_CY, '#0CD89B'));
    } else {
        parts.push(ring('stroke="#3b82f6"'));
        parts.push(chip(regionCount, 'regions', REGION_Y, REGION_CY, '#93c5fd'));
    }

    parts.push('</svg>');
    return parts.join('');
}

/**
 * Renders a standalone pill chip (no ring) for individual unclustered user dots.
 * The chip reads "N users" with the count bold and the label lighter.
 */
function _znMakeChipSVG(n, label, fontSize, fillColor) {
    var fs  = fontSize || 11;
    var FF  = 'font-family="Inter,system-ui,sans-serif"';
    var chars = String(n).length + 1 + label.length;
    var cw  = Math.round(chars * fs * 0.60) + 14;
    var ch  = 16;
    return '<svg width="' + cw + '" height="' + ch + '" viewBox="0 0 ' + cw + ' ' + ch + '" xmlns="http://www.w3.org/2000/svg">' +
        '<rect x="0" y="0" width="' + cw + '" height="' + ch + '" rx="8" fill="' + fillColor + '" stroke="none"/>' +
        '<text x="' + (cw / 2) + '" y="' + (ch / 2) + '" text-anchor="middle" dominant-baseline="central"' +
        ' fill="#374151" font-size="' + fs + '" ' + FF + '>' +
        '<tspan font-weight="bold">' + n + '</tspan>' +
        '<tspan font-weight="normal"> ' + label + '</tspan>' +
        '</text>' +
        '</svg>';
}

/** One-time setup of GeoJSON sources and layers, called after MapLibre style loads. */
function _znMapInitSources() {
    var emptyFC = { type: 'FeatureCollection', features: [] };

    // Connection arcs between users and their region
    // lineMetrics: true is required for the line-gradient paint property.
    leafletMap.addSource('zn-connections', { type: 'geojson', data: emptyFC, lineMetrics: true });
    leafletMap.addLayer({
        id: 'zn-connection-lines',
        type: 'line',
        source: 'zn-connections',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
            'line-width': 3,
            'line-opacity': 0.7,
            'line-gradient': [
                'interpolate', ['linear'], ['line-progress'],
                0,   '#0CD89B',   // user end  — green
                1,   '#3b82f6'    // region end — blue
            ]
        }
    });

    // Region source — data is still pushed here so arc geometry can reference it;
    // visual markers are HTML donut elements built in _znRenderMapData.
    leafletMap.addSource('zn-regions', { type: 'geojson', data: emptyFC });

    // User source with built-in GPU clustering
    leafletMap.addSource('zn-users', {
        type: 'geojson',
        data: emptyFC,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 60,
    });
    // Invisible sentinel — zero-radius, zero-opacity circle layer that exists
    // solely so queryRenderedFeatures can discover cluster features.
    // All visual representation is done by HTML donut markers in the render loop.
    leafletMap.addLayer({
        id: 'zn-cluster-sentinel',
        type: 'circle',
        source: 'zn-users',
        filter: ['has', 'point_count'],
        paint: { 'circle-radius': 1, 'circle-opacity': 0, 'circle-color': '#000000' }
    });
    leafletMap.addLayer({
        id: 'zn-user-dots',
        type: 'circle',
        source: 'zn-users',
        filter: ['!', ['has', 'point_count']],
        paint: {
            'circle-radius': 5,
            'circle-color': ['case', ['get', 'offline'], '#94a3b8', '#0CD89B'],
            'circle-stroke-width': ['case', ['get', 'offline'], 2, 0],
            'circle-stroke-color': '#64748b',
        }
    });

    // Click: individual user dot
    leafletMap.on('click', 'zn-user-dots', function(e) {
        var ip = e.features && e.features[0] && e.features[0].properties && e.features[0].properties.ip;
        var sessions = ip ? (_mapIpSessions[ip] || null) : null;
        openMapComboDrawer('users', sessions, null);
    });

    // Pointer cursor on hover over individual user dots only
    leafletMap.on('mouseenter', 'zn-user-dots', function() { leafletMap.getCanvas().style.cursor = 'pointer'; });
    leafletMap.on('mouseleave', 'zn-user-dots', function() { leafletMap.getCanvas().style.cursor = ''; });

    // ── Cluster HTML donut markers (render loop) ──────────────────────────────
    // Runs every frame but only creates/destroys DOM elements when state changes.
    leafletMap.on('render', function() {
        if (!leafletMap.isSourceLoaded('zn-users')) return;

        var zoom     = leafletMap.getZoom();
        var fontSize = _znDonutFontSize(zoom);
        var newOnScreen = {};

        var features = leafletMap.queryRenderedFeatures({ layers: ['zn-cluster-sentinel'] });

        // First pass: determine which region markers are co-located with a cluster.
        // A region is "co-located" if any cluster centroid is within 40 screen-px.
        var colocatedRegionIndices = {};
        features.forEach(function(f) {
            if (!f.geometry || !f.geometry.coordinates) return;
            var cPx = leafletMap.project(f.geometry.coordinates);
            _mapRegionHTMLMarkers.forEach(function(rm, ri) {
                var rPx = leafletMap.project(rm.getLngLat());
                var dx  = cPx.x - rPx.x, dy = cPx.y - rPx.y;
                if (Math.sqrt(dx * dx + dy * dy) < 40) colocatedRegionIndices[ri] = true;
            });
        });

        // Show/hide standalone region donut markers based on co-location.
        _mapRegionHTMLMarkers.forEach(function(rm, ri) {
            rm.getElement().style.display = colocatedRegionIndices[ri] ? 'none' : '';
        });

        // Second pass: create/update cluster HTML markers.
        features.forEach(function(f) {
            if (!f.geometry || !f.geometry.coordinates) return;
            var id     = f.properties.cluster_id;
            var cnt    = f.properties.point_count;
            var coords = f.geometry.coordinates;

            // Find co-located region count, chipFlip, and region names (synchronous)
            var regionCount = 0;
            var chipFlip    = false;
            var colocatedRegionNames = [];
            var cPx = leafletMap.project(coords);
            _mapRegionHTMLMarkers.forEach(function(rm) {
                var rPx = leafletMap.project(rm.getLngLat());
                var dx  = cPx.x - rPx.x, dy = cPx.y - rPx.y;
                if (Math.sqrt(dx * dx + dy * dy) < 40) {
                    regionCount = rm._znRegionCount || 0;
                    chipFlip    = !!rm._znChipFlip;
                    // Collect all region names from this co-located marker
                    (rm._znRegionNames || (rm._znRegionName ? [rm._znRegionName] : [])).forEach(function(rn) {
                        if (rn && colocatedRegionNames.indexOf(rn) === -1) colocatedRegionNames.push(rn);
                    });
                }
            });

            var existing = _mapClusterHTMLMarkers[id];

            if (!existing) {
                // Create new cluster donut marker
                var el = document.createElement('div');
                el.style.cssText = 'pointer-events:auto;cursor:pointer;';
                el.dataset.clusterId   = String(id);
                el.dataset.regionCount = String(regionCount);
                el.innerHTML = _znMakeDonutSVG(cnt, regionCount, fontSize, chipFlip);
                var m = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(coords);
                m._znUserCount          = cnt;
                m._znRegionCount        = regionCount;
                m._znFontSize           = fontSize;
                m._znChipFlip           = chipFlip;
                m._znColocatedRegionNames = colocatedRegionNames;
                // Async: collect the user sessions for this cluster so the Users tab can filter
                leafletMap.getSource('zn-users').getClusterLeaves(id, Infinity, 0, function(err, leaves) {
                    if (err || !leaves) return;
                    var sessList = [];
                    leaves.forEach(function(f) {
                        var ip = f.properties && f.properties.ip;
                        if (!ip) return;
                        (_mapIpSessions[ip] || []).forEach(function(s) { sessList.push(s); });
                    });
                    m._znSessions = sessList;
                });
                el.addEventListener('click', (function(mRef, elRef) {
                    return function() {
                        var rc  = parseInt(elRef.dataset.regionCount || '0', 10);
                        var tab = rc > 0 ? 'regions' : 'users';
                        var rns = rc > 0 ? (mRef._znColocatedRegionNames.length ? mRef._znColocatedRegionNames : null) : null;
                        var userSessions = mRef._znSessions || null;
                        openMapComboDrawer(tab, userSessions, rns);
                    };
                })(m, el));
                _mapClusterHTMLMarkers[id] = m;
                existing = m;
            } else {
                // Update position; regenerate SVG if counts, font size, or flip changed
                existing.setLngLat(coords);
                if (existing._znUserCount !== cnt || existing._znRegionCount !== regionCount ||
                        existing._znFontSize !== fontSize || existing._znChipFlip !== chipFlip) {
                    existing.getElement().innerHTML = _znMakeDonutSVG(cnt, regionCount, fontSize, chipFlip);
                    existing.getElement().dataset.regionCount = String(regionCount);
                    existing._znUserCount   = cnt;
                    existing._znRegionCount = regionCount;
                    existing._znFontSize    = fontSize;
                    existing._znChipFlip    = chipFlip;
                }
                // Always refresh co-located region names (can change as user pans/zooms)
                existing._znColocatedRegionNames = colocatedRegionNames;
            }

            newOnScreen[id] = existing;
            if (!_mapClusterMarkersOnScreen[id]) existing.addTo(leafletMap);
        });

        // Remove markers that have scrolled off screen or been merged into a larger cluster
        Object.keys(_mapClusterMarkersOnScreen).forEach(function(id) {
            if (!newOnScreen[id]) {
                _mapClusterMarkersOnScreen[id].remove();
                delete _mapClusterHTMLMarkers[id];
            }
        });
        _mapClusterMarkersOnScreen = newOnScreen;

        // ── Individual (unclustered) user dot chip markers ────────────────────
        var indivFeatures = leafletMap.queryRenderedFeatures({ layers: ['zn-user-dots'] });
        var newIndivOnScreen = {};

        indivFeatures.forEach(function(f) {
            var ip      = f.properties.ip;
            var sessions = _mapIpSessions[ip] || [];
            var cnt     = sessions.length || 1;
            var coords  = f.geometry.coordinates;  // [lng, lat]

            var existing = _mapIndivHTMLMarkers[ip];

            if (!existing) {
                var el = document.createElement('div');
                el.style.cssText = 'pointer-events:auto;cursor:pointer;';
                el.innerHTML = _znMakeChipSVG(cnt, 'users', fontSize, '#0CD89B');
                el.addEventListener('click', (function(ip_) {
                    return function() {
                        var s = _mapIpSessions[ip_];
                        if (s) openConnectivityModalGeo(s, { cluster: false });
                    };
                })(ip));
                // anchor:'bottom' places the chip just above the 5 px user dot
                var m = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -7] })
                    .setLngLat(coords);
                m._znUserCount = cnt;
                m._znFontSize  = fontSize;
                _mapIndivHTMLMarkers[ip] = m;
                existing = m;
            } else {
                existing.setLngLat(coords);
                if (existing._znUserCount !== cnt || existing._znFontSize !== fontSize) {
                    existing.getElement().innerHTML = _znMakeChipSVG(cnt, 'users', fontSize, '#0CD89B');
                    existing._znUserCount = cnt;
                    existing._znFontSize  = fontSize;
                }
            }

            newIndivOnScreen[ip] = existing;
            if (!_mapIndivMarkersOnScreen[ip]) existing.addTo(leafletMap);
        });

        // Remove chips for dots that have scrolled off or clustered
        Object.keys(_mapIndivMarkersOnScreen).forEach(function(ip) {
            if (!newIndivOnScreen[ip]) {
                _mapIndivMarkersOnScreen[ip].remove();
                delete _mapIndivHTMLMarkers[ip];
            }
        });
        _mapIndivMarkersOnScreen = newIndivOnScreen;
    });

    // ── Zoom-responsive font size update ─────────────────────────────────────
    leafletMap.on('zoomend', function() {
        var fs = _znDonutFontSize(leafletMap.getZoom());
        // Region markers
        _mapRegionHTMLMarkers.forEach(function(rm) {
            rm.getElement().innerHTML = _znMakeDonutSVG(rm._znUserCount || 0, rm._znRegionCount || 0, fs, !!rm._znChipFlip);
        });
        // Cluster markers currently on screen
        Object.keys(_mapClusterMarkersOnScreen).forEach(function(id) {
            var m = _mapClusterMarkersOnScreen[id];
            m.getElement().innerHTML = _znMakeDonutSVG(m._znUserCount || 0, m._znRegionCount || 0, fs, !!m._znChipFlip);
            m._znFontSize = fs;
        });
        // Individual dot chips
        Object.keys(_mapIndivMarkersOnScreen).forEach(function(ip) {
            var m = _mapIndivMarkersOnScreen[ip];
            m.getElement().innerHTML = _znMakeChipSVG(m._znUserCount || 1, 'users', fs, '#0CD89B');
            m._znFontSize = fs;
        });
    });

    // ── Pole X markers (native globe surface via symbol layer) ───────────────
    // Using a GeoJSON + symbol layer instead of HTML markers so the icons sit
    // on the curved 3D sphere surface and tilt/fade with the globe projection.
    // Wrapped in try/catch: MapLibre throws a RangeError ("mismatched image size")
    // when addImage is called on a style with no sprite URL (atlas starts at size 0).
    // Pole markers are decorative — failure must not block _znMapSourcesReady.
    try {
        (function _znAddPoleMarkers() {
            var sz = 24;
            var canvas = document.createElement('canvas');
            canvas.width = sz; canvas.height = sz;
            var ctx = canvas.getContext('2d');
            var pad = 4;
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.9)';
            ctx.lineWidth = 2.5;
            ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(pad, pad); ctx.lineTo(sz - pad, sz - pad); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(sz - pad, pad); ctx.lineTo(pad, sz - pad); ctx.stroke();

            if (!leafletMap.hasImage('zn-pole-x')) {
                var imgData = ctx.getImageData(0, 0, sz, sz);
                leafletMap.addImage('zn-pole-x', { width: sz, height: sz, data: new Uint8Array(imgData.data.buffer) });
            }

            leafletMap.addSource('zn-poles', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [
                        { type: 'Feature', geometry: { type: 'Point', coordinates: [0,  90] }, properties: {} },
                        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, -90] }, properties: {} }
                    ]
                }
            });

            leafletMap.addLayer({
                id: 'zn-pole-markers',
                type: 'symbol',
                source: 'zn-poles',
                layout: {
                    'icon-image': 'zn-pole-x',
                    'icon-size': 1,
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true
                }
            });
        })();
    } catch (poleErr) {
        console.warn('[ZN Map] Pole markers skipped:', poleErr && poleErr.message);
    }

    _znMapSourcesReady = true;
}

/** Return a straight two-point LineString between user and region coords. */
function _znMakeArcCoords(lng0, lat0, lng1, lat1) {
    return [[lng0, lat0], [lng1, lat1]];
}

/** Rebuild all GeoJSON source data and arrow/donut HTML markers from current session state. */
function _znRenderMapData(sessions) {
    if (!leafletMap || !_znMapSourcesReady) return;

    // Remove arrow HTML markers from previous render
    mapPolylines.forEach(function(m) { try { m.remove(); } catch (e) {} });
    mapPolylines = [];
    regionMarkers = [];
    mapUserMarkers = [];

    // Remove region donut HTML markers
    _mapRegionHTMLMarkers.forEach(function(m) { try { m.remove(); } catch (e) {} });
    _mapRegionHTMLMarkers = [];

    // Remove all cluster donut HTML markers (render loop will recreate them)
    Object.keys(_mapClusterHTMLMarkers).forEach(function(id) {
        try { _mapClusterHTMLMarkers[id].remove(); } catch (e) {}
    });
    _mapClusterHTMLMarkers = {};
    _mapClusterMarkersOnScreen = {};

    // Remove all individual user dot chip markers (render loop will recreate them)
    Object.keys(_mapIndivHTMLMarkers).forEach(function(ip) {
        try { _mapIndivHTMLMarkers[ip].remove(); } catch (e) {}
    });
    _mapIndivHTMLMarkers = {};
    _mapIndivMarkersOnScreen = {};

    mapBounds      = znCreateMapBounds();
    mapServerCoord = {};
    _mapIpSessions = {};
    _mapRegionSessions = {};

    var activeSessions = sessions.filter(function(s) { return sessionState(s) === 'active'; });
    var userFilterActive = !!getSelectedDashboardUserName();
    var userMarkerSessions = userFilterActive ? sessions : activeSessions;
    znMergeCountryGeoSeedForSessions(userMarkerSessions);

    // ── Region donut HTML markers ──────────────────────────────────────────
    var serverCoord = {};

    var serverData = {};
    activeSessions.forEach(function(s) {
        var rn = regionName(s);
        if (!rn) return;
        serverData[rn] = (serverData[rn] || 0) + 1;
        if (!_mapRegionSessions[rn]) _mapRegionSessions[rn] = [];
        _mapRegionSessions[rn].push(s);
    });

    if (mapMode === 'servers' || mapMode === 'both') {
        var zoom = leafletMap ? leafletMap.getZoom() : 3;
        var fs   = _znDonutFontSize(zoom);

        // Group regions by geographic coordinate so the blue chip shows the
        // actual number of ZN regions at that location and the green chip shows
        // the total active session count for those regions.
        var coordGroups = {};   // coordKey → { coords, regionNames[], sessionCount }
        function coordKey(c) { return c[0].toFixed(4) + ',' + c[1].toFixed(4); }

        Object.keys(serverData).forEach(function(rn) {
            var coords = regionCoords(rn);
            if (!coords || !znIsValidLatLng(coords[0], coords[1])) return;
            serverCoord[rn]    = coords;
            mapServerCoord[rn] = coords;
            mapBounds.extend(coords);
            var key = coordKey(coords);
            if (!coordGroups[key]) coordGroups[key] = { coords: coords, regionNames: [], sessionCount: 0 };
            coordGroups[key].regionNames.push(rn);
            coordGroups[key].sessionCount += serverData[rn];
        });

        Object.keys(coordGroups).forEach(function(key) {
            var grp        = coordGroups[key];
            var coords     = grp.coords;
            var regionCnt  = grp.regionNames.length;   // blue chip — actual region count
            var sessionCnt = grp.sessionCount;          // green chip — active sessions

            // Decide chip placement: compare how many users are above vs below.
            var aboveCount = 0, belowCount = 0;
            grp.regionNames.forEach(function(rn) {
                (_mapRegionSessions[rn] || []).forEach(function(s) {
                    var ip = sessionPublicIp(s);
                    var uCoords = ip ? geoIpCache.get(ip) : null;
                    if (!uCoords) return;
                    if (uCoords[0] > coords[0]) aboveCount++; else belowCount++;
                });
            });
            var chipFlip = aboveCount > belowCount;

            var el = document.createElement('div');
            el.style.cssText = 'pointer-events:auto;cursor:pointer;';
            el.innerHTML = _znMakeDonutSVG(sessionCnt, regionCnt, fs, chipFlip);

            var m = new maplibregl.Marker({ element: el, anchor: 'center' })
                .setLngLat([coords[1], coords[0]])
                .addTo(leafletMap);
            m._znRegionCount = regionCnt;
            m._znUserCount   = sessionCnt;
            m._znRegionName  = grp.regionNames[0];
            m._znRegionNames = grp.regionNames;
            m._znChipFlip    = chipFlip;

            el.addEventListener('click', (function(mRef) {
                return function() {
                    var rns      = mRef._znRegionNames || (mRef._znRegionName ? [mRef._znRegionName] : []);
                    var sessList = [];
                    rns.forEach(function(rn) {
                        (_mapRegionSessions[rn] || []).forEach(function(s) { sessList.push(s); });
                    });
                    openMapComboDrawer('regions',
                        sessList.length ? sessList : null,
                        rns.length      ? rns      : null);
                };
            })(m));

            _mapRegionHTMLMarkers.push(m);
        });
    }

    // Keep the GeoJSON source empty (no circle layer uses it now, but
    // the source must exist for the arc line geometry to reference region coords).
    leafletMap.getSource('zn-regions').setData({ type: 'FeatureCollection', features: [] });

    // ── User dots + connection lines ──────────────────────────────────────
    var userFeatures = [];
    var connFeatures = [];

    if (mapMode === 'users' || mapMode === 'both') {
        var ipMap = {};
        userMarkerSessions.forEach(function(s) {
            var ip = sessionPublicIp(s);
            if (!ip) return;
            if (!ipMap[ip]) ipMap[ip] = [];
            ipMap[ip].push(s);
        });

        var ipList = Object.keys(ipMap);
        var cachedIps = ipList.filter(function(ip) { return geoIpCache.has(ip) && geoIpCache.get(ip); });
        console.log('[ZN Map] active=' + activeSessions.length +
            ' withIp=' + ipList.length + ' cached=' + cachedIps.length +
            ' IPs=[' + ipList.join(',') + ']');
        if (ipList.length === 0 && activeSessions.length > 0) {
            console.warn('[ZN Map] No public IPs found. Session keys: ' +
                (userMarkerSessions[0] ? Object.keys(userMarkerSessions[0]).join(', ') : '(empty)'));
        }

        for (var i = 0; i < ipList.length; i++) {
            var ip = ipList[i];
            if (!geoIpCache.has(ip)) continue;
            var coords = geoIpCache.get(ip);
            if (!coords || !znIsValidLatLng(coords[0], coords[1])) continue;
            var plotCoords = jitterMarkerCoordsForIp(ip, coords[0], coords[1]);
            if (!znIsValidLatLng(plotCoords[0], plotCoords[1])) continue;

            var sessList = ipMap[ip];
            _mapIpSessions[ip] = sessList;
            mapBounds.extend(plotCoords);

            var isOffline = sessList.every(function(s) { return sessionState(s) !== 'active'; });
            userFeatures.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [plotCoords[1], plotCoords[0]] },
                properties: { ip: ip, offline: isOffline }
            });

            if (mapMode === 'both') {
                var rn = regionName(sessList[0]);
                var sc = rn ? serverCoord[rn] : null;
                if (sc) {
                    connFeatures.push({
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: _znMakeArcCoords(
                                plotCoords[1], plotCoords[0],
                                sc[1], sc[0]
                            )
                        },
                        properties: {}
                    });
                    _znAddArrowMarker(plotCoords, sc);
                }
            }
        }
    }

    _mapUserFeatures = userFeatures;
    _mapConnFeatures = connFeatures;
    leafletMap.getSource('zn-users').setData({ type: 'FeatureCollection', features: userFeatures });
    leafletMap.getSource('zn-connections').setData({ type: 'FeatureCollection', features: connFeatures });

    debouncedFitBounds();
    setTimeout(znSafeMapResize, 300);
    setTimeout(znSafeMapResize, 900);
}

/** Add a directional arrow HTML marker at the midpoint between user and region coords. */
function _znAddArrowMarker(plotCoords, sc) {
    var mid   = [(plotCoords[0] + sc[0]) / 2, (plotCoords[1] + sc[1]) / 2];
    var angle = Math.atan2(-(sc[0] - plotCoords[0]), sc[1] - plotCoords[1]) * (180 / Math.PI);
    var el    = document.createElement('div');
    el.style.cssText = 'width:18px;height:18px;display:flex;align-items:center;justify-content:center;pointer-events:none;';
    el.innerHTML = '<div style="transform:rotate(' + angle + 'deg);width:18px;height:18px;display:flex;align-items:center;justify-content:center;">' +
        '<svg viewBox="0 0 12 12" width="12" height="12" fill="#00df9a"><polygon points="0,2 8,6 0,10 3,6"/></svg></div>';
    var m = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([mid[1], mid[0]])
        .addTo(leafletMap);
    mapPolylines.push(m);
}

function recenterConnectivityMap() {
    if (!leafletMap) return;
    try { localStorage.removeItem(ZN_MAP_VIEW_LS); } catch (e) { /* ignore */ }

    // Let auto-fit run again after this deliberate recenter.
    _mapUserHasInteracted = false;
    _mapAutoFitDone = false;

    // Cancel any in-flight debounce so it can't override us.
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

    // renderMap schedules a debouncedFitBounds — cancel it so we control the camera.
    if (mapBoundsFitTimer) {
        clearTimeout(mapBoundsFitTimer);
        mapBoundsFitTimer = null;
    }

    znGeoRetryFailedForFilteredSessions();

    if (mapBounds && mapBounds.isValid()) {
        if (znGlobeFlyToBounds(mapBounds, 5)) return;
    }
    // Default world view
    if (_znMapSourcesReady) {
        try {
            leafletMap.stop();
            leafletMap.flyTo({ center: [ZN_MAP_DEFAULT_LATLNG[1], ZN_MAP_DEFAULT_LATLNG[0]], zoom: ZN_MAP_DEFAULT_ZOOM });
        } catch (_) { /* map style not ready yet */ }
    }
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

    kpiEl.className = 'widget-primary-metric';
    if (totalRegions === 0) {
        kpiEl.innerHTML = '\u2014';
        subEl.style.display = 'none';
        return;
    }

    kpiEl.innerHTML = upRegions + '<span class="kpi-out-of"> out of ' + totalRegions + '</span>';
    if (downAmongKnown === 0) {
        subEl.style.display = 'none';
    } else {
        kpiEl.classList.add(downAmongKnown >= totalRegions ? 'red' : 'amber');
        subEl.textContent = 'Warning: 1 or more regions degraded.';
        subEl.style.display = 'block';
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

    var sorted = Object.keys(verUserCount).sort(function(a, b) {
        return semverGt(a, b) ? -1 : semverGt(b, a) ? 1 : 0;
    }).slice(0, 5);
    if (sorted.length === 0) {
        var hasSessions = Array.isArray(lastData.ses) && lastData.ses.length > 0;
        el.innerHTML = '<div class="ses-empty">' + buildEmptyState(
            ZN_ICON_USERS,
            hasSessions ? 'No active sessions' : 'No sessions yet',
            hasSessions ? 'All registered sessions are currently offline' : 'Client versions will appear once sessions are connected'
        ) + '</div>';
        return;
    }
    var grandTotal = Object.keys(verUserCount).reduce(function(s, v) { return s + verUserCount[v]; }, 0) || 1;
    var max = Math.max.apply(null, sorted.map(function(v) { return verUserCount[v]; }));

    var lcv = lastData.latestClientVersions || null;
    var officialLatest = lcv && lcv.latest ? lcv.latest : null;

    var barsHtml = sorted.map(function(v) {
        var count = verUserCount[v];
        var pctBar = Math.round(count / max * 100);
        return '<div class="metric-row json-inspect-row" data-json-client-ver="' + escapeHtmlAttr(v) + '">' +
            '<span class="metric-label">v' + escapeHtmlAttr(v) + '</span>' +
            '<div class="metric-bar-wrap"><div class="metric-bar indigo" style="width:' + pctBar + '%"></div></div>' +
            '<span class="metric-count versions-count">' + count + '</span></div>';
    }).join('');

    var CV_WIN_ICON = ZN_OS_WIN_ICON;
    var CV_MAC_ICON = ZN_OS_MAC_ICON;

    function cvOsEntry(icon, ver) {
        return '<span class="cv-os-entry">' + icon +
            '<span class="cv-latest-ver-pill">v' + escapeHtmlAttr(ver) + '</span>' +
            '</span>';
    }

    var footerHtml = '';
    if (officialLatest) {
        var entries = [];
        if (lcv.windows) entries.push(cvOsEntry(CV_WIN_ICON, lcv.windows));
        var macVer = lcv.macIntel || lcv.macArm;
        if (macVer) entries.push(cvOsEntry(CV_MAC_ICON, macVer));
        if (entries.length) {
            footerHtml = '<div class="cv-latest-footer">' +
                '<div class="cv-latest-title">Official latest release</div>' +
                '<div class="cv-latest-os-row">' + entries.join('') + '</div>' +
                '</div>';
        }
    }

    el.innerHTML = barsHtml;
    var footerEl = document.getElementById('cv-latest-footer-container');
    if (footerEl) footerEl.innerHTML = footerHtml;
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
        el.innerHTML = '<div class="metric-placeholder">No session activity in this period.</div>';
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

// ── Empty State Component ──────────────────────────────────────────────────
var ZN_ICON_SHIELD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>';
var ZN_ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/></svg>';
var ZN_ICON_USERS  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
var ZN_ICON_CLOCK  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
var ZN_ICON_GLOBE  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
var ZN_ICON_LIST   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';

// OS icons reused by the Legacy Clients insight drawer and the client-versions widget
var ZN_OS_WIN_ICON = '<svg class="cv-os-icon" viewBox="0 0 88 88" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<rect x="0" y="0" width="40" height="40" fill="#0078d4"/>' +
    '<rect x="48" y="0" width="40" height="40" fill="#0078d4"/>' +
    '<rect x="0" y="48" width="40" height="40" fill="#0078d4"/>' +
    '<rect x="48" y="48" width="40" height="40" fill="#0078d4"/>' +
    '</svg>';
var ZN_OS_MAC_ICON = '<img class="cv-os-icon" aria-hidden="true" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAABY2lDQ1BrQ0dDb2xvclNwYWNlRGlzcGxheVAzAAAokX2QsUvDUBDGv1aloHUQHRwcMolDlJIKuji0FURxCFXB6pS+pqmQxkeSIgU3/4GC/4EKzm4Whzo6OAiik+jm5KTgouV5L4mkInqP435877vjOCA5bnBu9wOoO75bXMorm6UtJfWMBL0gDObxnK6vSv6uP+P9PvTeTstZv///jcGK6TGqn5QZxl0fSKjE+p7PJe8Tj7m0FHFLshXyieRyyOeBZ71YIL4mVljNqBC/EKvlHt3q4brdYNEOcvu06WysyTmUE1jEDjxw2DDQhAId2T/8s4G/gF1yN+FSn4UafOrJkSInmMTLcMAwA5VYQ4ZSk3eO7ncX3U+NtYMnYKEjhLiItZUOcDZHJ2vH2tQ8MDIEXLW54RqB1EeZrFaB11NguASM3lDPtlfNauH26Tww8CjE2ySQOgS6LSE+joToHlPzA3DpfAEDp2ITpJYOWwAAAARjSUNQDA0AAW4D4+8AAACKZVhJZk1NACoAAAAIAAQBGgAFAAAAAQAAAD4BGwAFAAAAAQAAAEYBKAADAAAAAQACAACHaQAEAAAAAQAAAE4AAAAAAAAAkAAAAAEAAACQAAAAAQADkoYABwAAABIAAAB4oAIABAAAAAEAAAAwoAMABAAAAAEAAAAwAAAAAEFTQ0lJAAAAU2NyZWVuc2hvdA73nrsAAAAJcEhZcwAAFiUAABYlAUlSJPAAAAKnaVRYdFhNTDpjb20uYWRvYmUueG1wAAAAAAA8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJYTVAgQ29yZSA2LjAuMCI+CiAgIDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+CiAgICAgIDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiCiAgICAgICAgICAgIHhtbG5zOnRpZmY9Imh0dHA6Ly9ucy5hZG9iZS5jb20vdGlmZi8xLjAvIgogICAgICAgICAgICB4bWxuczpleGlmPSJodHRwOi8vbnMuYWRvYmUuY29tL2V4aWYvMS4wLyI+CiAgICAgICAgIDx0aWZmOllSZXNvbHV0aW9uPjE0NDwvdGlmZjpZUmVzb2x1dGlvbj4KICAgICAgICAgPHRpZmY6WFJlc29sdXRpb24+MTQ0PC90aWZmOlhSZXNvbHV0aW9uPgogICAgICAgICA8dGlmZjpSZXNvbHV0aW9uVW5pdD4yPC90aWZmOlJlc29sdXRpb25Vbml0PgogICAgICAgICA8ZXhpZjpQaXhlbFlEaW1lbnNpb24+NzEwPC9leGlmOlBpeGVsWURpbWVuc2lvbj4KICAgICAgICAgPGV4aWY6VXNlckNvbW1lbnQ+U2NyZWVuc2hvdDwvZXhpZjpVc2VyQ29tbWVudD4KICAgICAgICAgPGV4aWY6UGl4ZWxYRGltZW5zaW9uPjYyNjwvZXhpZjpQaXhlbFhEaW1lbnNpb24+CiAgICAgIDwvcmRmOkRlc2NyaXB0aW9uPgogICA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgoTbaHvAAAGA0lEQVRoBc1aS0iVTxQ/ppaSRuajrLRQoQzyRYUI6kKECMGFSOZjKQiuhCA30jY3LVwIkgt1I0K0F3tsFEU3WuQjJVQSX/nWFC2n8zv//8z/u97veu+V/30MXL/5vjkz8/udOTNz5owhihMFQTo+PiZACQ0N9QrNOa+k/2fhzc1N+vTpE7W3t9Pe3p7X4AUORsDfaXBwUNXX16vU1FSMvoqKilILCwtngoFh83li85A+ZmZmVFVVlbpw4YIAB3j8EhIS1OLi4plw+IUAkH348EElJycb4CEhIQo/EMjNzVWHh4dKE/WGSRg34LPEQIhB0sjICD179oxWVlbo3Ll/ph3KdHr8+DGFh4fLJNbfPH56w9ZbWWh0e3tbPXr0SDTN4EXrVu3HxMSo6elpb5s28j43odvWWjUAe5LA87WsaqqbMAVJY/phcJaWloKioqK1A7OZkBk4dxAKrq6ukAMuiH0YhJOLMDEFjwAPbCHHNdnU7e35pBrBsAgBiZZwFDFZYFQFAHDrqwJNmpOVN6ZwJmNFxJKOuMGHOmOtjBkEoaD9aTmQoF+tYA4N4pAsAbhqCLiSaKAAAAAElFTkSuQmCC" alt="macOS">';

function buildEmptyState(svgIcon, title, hint) {
    return '<div class="zn-empty-state">' +
        '<div class="zn-empty-state__icon">' + svgIcon + '</div>' +
        '<div class="zn-empty-state__title">' + escapeHtmlAttr(title) + '</div>' +
        (hint ? '<div class="zn-empty-state__hint">' + escapeHtmlAttr(hint) + '</div>' : '') +
        '</div>';
}
// ─────────────────────────────────────────────────────────────────────────────

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
        if (bd.contains(document.activeElement)) document.activeElement.blur();
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
    if (rows.length === 0) {
        bEl.innerHTML = buildEmptyState(ZN_ICON_LIST, 'No data available', '');
        bd.classList.add('open');
        bd.setAttribute('aria-hidden', 'false');
        return;
    }
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
        if (bd.contains(document.activeElement)) document.activeElement.blur();
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
    if (rows.length === 0) {
        bodyEl.innerHTML = buildEmptyState(ZN_ICON_LIST, 'No data available', '');
    } else {
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
    }
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
    var isPolicyType = (auditTypeId === 100 || auditTypeId === 101 || auditTypeId === 102);
    return (poolItems || []).filter(function(item) {
        var typeMatch = isPolicyType
            ? policyOpTypeId(item) === auditTypeId
            : auditTypeToNum(item) === auditTypeId;
        if (!typeMatch) return false;
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
        el.innerHTML = '<div class="metric-placeholder">No audit operations in this period.</div>';
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
        return '<tr><td>' + escapeHtmlAttr(dateStr) + '</td><td>' + escapeHtmlAttr(String(u)) + '</td></tr>';
    }).join('');

    if (!rows) {
        document.getElementById('modal-body').innerHTML =
            '<div class="audit-drill-modal-wrap">' +
            buildEmptyState(ZN_ICON_CLOCK, 'No events in this window', 'No matching audit events were recorded for this period') +
            '<div id="audit-drill-json-wrap" class="audit-drill-json-wrap" style="display:none">' +
            '<pre class="audit-drill-json-pre"><code id="audit-drill-json-code"></code></pre></div></div>';
        document.getElementById('modal-backdrop').classList.add('open');
        return;
    }

    document.getElementById('modal-body').innerHTML =
        '<div class="audit-drill-modal-wrap">' +
        '<table class="insight-modal-table audit-drill-table">' +
        '<thead><tr><th>Date</th><th>User</th></tr></thead><tbody>' + rows + '</tbody></table>' +
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
        el.innerHTML = '<div class="ses-empty">' + buildEmptyState(
            ZN_ICON_LIST,
            'No policy hits',
            'No Connect sessions with a named policy in the last ' + usePeriod
        ) + '</div>';
        return;
    }

    var grandTotal = sorted.reduce(function(s, name) { return s + policyCounts[name]; }, 0) || 1;
    var max = policyCounts[sorted[0]];
    el.innerHTML = sorted.map(function(name) {
        var count = policyCounts[name];
        var pctBar = Math.round(count / max * 100);
        var pctTot = Math.round(count / grandTotal * 100);
        var esc = escapeHtmlAttr(name);
        return '<div class="metric-row pn-widget-row cursor-pointer" data-policy-name="' + esc + '" title="Click to view users covered by this policy">' +
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
        body += buildEmptyState(ZN_ICON_SHIELD, 'No records found', 'No data available for this insight right now');
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


/** Opens the Insights Logic Guide as a standard modal dialog. */
function openInsightsLogicGuideModal() {
    var titleEl  = document.getElementById('modal-title');
    var metaEl   = document.getElementById('modal-meta');
    var bodyEl   = document.getElementById('modal-body');
    var modal    = document.getElementById('detailsModal');
    var backdrop = document.getElementById('modal-backdrop');
    if (!titleEl || !metaEl || !bodyEl || !backdrop) return;

    titleEl.textContent = 'Insights Logic Guide';
    metaEl.style.display = 'none';
    if (modal) modal.classList.add('modal--wide-connectivity');

    var sessionRows = [
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
            logic: 'Uses the paginated audit stream in the selected period. For each user and calendar day, counts Connect session-created events (type 96); flagged when count is greater than 3 (more than 3 reconnects on the same day).'
        }
    ];

    var postureRows = [
        {
            name: 'Failing Users on Posture Checks',
            sev: 'Medium',
            sevClass: 'insights-logic-sev--medium',
            logic: 'Counts type-390 (Violation Found) audit events per user over the last 30 days. Flags users with more than 2 violations — those likely being blocked from Connect access and needing admin attention.'
        },
        {
            name: 'Posture Violation Spike',
            sev: 'Medium',
            sevClass: 'insights-logic-sev--medium',
            logic: 'Compares each day\'s violation count to the rolling daily average over 30 days. Triggers when the peak day has \u22653 violations and \u22652\xd7 the average \u2014 signals a policy change, OS update, or misconfiguration.'
        }
    ];

    function buildTable(rows) {
        var thead = '<thead><tr><th style="width:32%">Insight</th><th style="width:11%">Severity</th><th>Detection Logic</th></tr></thead>';
        var tbody = '<tbody>' + rows.map(function(r) {
            return '<tr>' +
                '<td class="insights-logic-name">' + escapeHtmlAttr(r.name) + '</td>' +
                '<td class="insights-logic-sev ' + r.sevClass + '">' + escapeHtmlAttr(r.sev) + '</td>' +
                '<td class="insights-logic-col">' + escapeHtmlAttr(r.logic) + '</td>' +
            '</tr>';
        }).join('') + '</tbody>';
        return '<table class="insights-logic-table">' + thead + tbody + '</table>';
    }

    bodyEl.innerHTML =
        '<div class="insights-logic-subhd" style="margin-top:0">Session Insights</div>' +
        buildTable(sessionRows) +
        '<div class="insights-logic-subhd">Posture Insights</div>' +
        buildTable(postureRows) +
        '<p style="color:#94a3b8;font-size:0.72rem;margin-top:14px;line-height:1.45">' +
        'Insight cards show findings from the current data window. A green \u2713 OK badge means no issues were detected for that category.</p>';

    backdrop.classList.add('open');
}

function insightSessionIsLegacyClient(s) {
    if (sessionState(s) !== 'active') return false;
    var v = clientVer(s);
    if (v === undefined || v === null || v === '') return false;
    var norm = String(v).trim().replace(/^v/i, '');
    var lcv = lastData.latestClientVersions;
    var latest = lcv && lcv.latest ? String(lcv.latest).trim().replace(/^v/i, '') : null;
    if (latest) {
        // Flag any client not on the exact latest version
        return norm !== latest && semverGt(latest, norm);
    }
    // Fallback when latest version is unknown: flag pre-v4 clients
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

// Type 96 per user per calendar day; modal lists (User, Date, Reconnect Count) where count > 3.
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
        if (c <= 3) return;
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
    var kind = escapeHtmlAttr(item.insightKind || '');
    if (item.dismissed) {
        var clsD = 'insight-card insight-card--dismissed';
        return '<div class="' + clsD + '" data-insight-card="' + kind +
            '" aria-label="' + escapeHtmlAttr(item.title) + ': dismissed">';
    }
    if (item.allClear) {
        var clsC = 'insight-card insight-card--clear insight-card--green';
        return '<div class="' + clsC + '" data-insight-card="' + kind +
            '" aria-label="' + escapeHtmlAttr(item.title) + ': No issues detected">';
    }
    var cls = 'insight-card insight-card--interactive insight-card--' + (item.colour || 'amber');
    return '<div class="' + cls + '" tabindex="0" role="button" data-insight-card="' + kind +
        '" aria-label="View details: ' + escapeHtmlAttr(item.title) + '">';
}

/** Native `title` tooltips for key insights (hover / long-hover for full text). */
var INSIGHT_ADMIN_TOOLTIP_ROUTING =
    "Why it's important: Cross-region connections drastically increase latency and degrade the end-user experience. How it's calculated: Compares the client's calculated 'Desired Region' against the 'Actual Region' server they are anchored to.";
function insightTooltipLegacy() {
    var lcv = lastData.latestClientVersions;
    var latest = lcv && lcv.latest ? lcv.latest : null;
    var latestNote = latest ? ' The latest official release is v' + latest + '.' : '';
    return "Why it's important: Outdated agents lack security patches and miss new features." + latestNote + " How it's calculated: Compares each active client's version against the current official release; any client not on the latest version is flagged as legacy.";
}
var INSIGHT_ADMIN_TOOLTIP_LEGACY = insightTooltipLegacy();
var INSIGHT_ADMIN_TOOLTIP_DEGRADED =
    "Why it's important: Devices that lose connectivity after reboot may be offline from policy updates and exposure windows. How it's calculated: Active sessions where Connect After Boot / connectivity-after-reboot reads as false.";
var INSIGHT_ADMIN_TOOLTIP_FLAPPING =
    "Why it's important: Frequent reconnects can signal unstable clients, policy loops, or network issues worth investigating. How it's calculated: On the full paginated 30-day audit stream, flags any calendar day where a user has more than 3 Connect session created events (type 96). The high threshold avoids noise from routine reconnects.";
var INSIGHT_ADMIN_TOOLTIP_POSTURE_TOP_CHECK =
    "Why it's important: Identifies users who are repeatedly blocked by posture checks — they likely need device remediation, a policy exception, or direct admin support. How it's calculated: Counts type-390 (Violation Found) audit events per user in the last 30 days. Users with more than 2 violations are flagged. The drawer shows each flagged user's total failure count and their most common failing check.";
var INSIGHT_ADMIN_TOOLTIP_POSTURE_SPIKE =
    "Why it's important: A sudden spike in violations may indicate a policy change, a new OS update that breaks posture rules, or a misconfiguration. How it's calculated: Compares each day's violation count to the rolling daily average across the 30-day audit window. Triggers when the peak day is ≥3 violations and ≥2× the average.";

function insightTitleBlockHtml(item) {
    var titleEsc = escapeHtmlAttr(item.title);
    var tip = item.adminTooltip ? escapeHtmlAttr(item.adminTooltip) : '';
    var sev = item.allClear ? 'insight-title--sev-default' : insightTitleSeverityClass(item.colour);
    var infoBtn = tip
        ? '<button type="button" class="insight-help" title="' + tip + '" aria-label="Full admin explanation (hover or focus)">i</button>'
        : '';
    var clearBadge = item.allClear
        ? '<span class="insight-clear-badge">' +
          '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">' +
          '<path d="M2 5.2l2 2 4-4" stroke="#16a34a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>OK</span>'
        : '';
    return '<div class="insight-title-row">' +
        '<span class="insight-title ' + sev + '">' + titleEsc + '</span>' +
        infoBtn +
        '</div>' +
        (clearBadge ? '<div class="insight-clear-badge-row">' + clearBadge + '</div>' : '');
}

// ── 4d. Insights panel ────────────────────────────────────────────────────

// ── Dismiss state helpers (localStorage-backed) ───────────────────────────
var INSIGHT_DISMISS_KEY = 'zn_dismissed_insights';

function getInsightDismissed() {
    try {
        var raw = localStorage.getItem(INSIGHT_DISMISS_KEY);
        if (!raw) return {};
        var arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return {};
        var map = Object.create(null);
        arr.forEach(function(k) { if (k) map[k] = true; });
        return map;
    } catch (e) { return {}; }
}

function setInsightDismissed(kind) {
    try {
        var map = getInsightDismissed();
        map[kind] = true;
        localStorage.setItem(INSIGHT_DISMISS_KEY, JSON.stringify(Object.keys(map)));
    } catch (e) {}
}

function clearInsightDismissed(kind) {
    try {
        var map = getInsightDismissed();
        delete map[kind];
        localStorage.setItem(INSIGHT_DISMISS_KEY, JSON.stringify(Object.keys(map)));
    } catch (e) {}
}

// Full set always rendered: Active findings shown normally; items with no findings shown greyed with green OK badge.
// Dismissed items are greyed out and sorted to the bottom regardless of findings.
function renderInsights(lic, ses, aud, period) {
    void lic;
    var usePeriod = period || activePeriod;
    var items     = [];
    var dismissMap = getInsightDismissed();

    // ── Session insights ───────────────────────────────────────────────────
    var routingRows = insightRowsSubOptimalRouting(ses);
    if (routingRows.length > 0) {
        items.push({
            colour:'amber',
            title:'Sub-optimal Routing',
            detail: routingRows.length + ' active session' + (routingRows.length !== 1 ? 's are' : ' is') +
                ' anchored away from the desired region.',
            adminTooltip: INSIGHT_ADMIN_TOOLTIP_ROUTING,
            insightKind: 'region-routing',
            findingCount: routingRows.length
        });
    } else {
        items.push({
            colour:'green', allClear: true,
            title:'Sub-optimal Routing',
            detail: 'All sessions are connected to their desired region.',
            adminTooltip: INSIGHT_ADMIN_TOOLTIP_ROUTING,
            insightKind: 'region-routing',
            findingCount: 0
        });
    }

    var legacyRows = insightRowsLegacyClients(ses);
    var _lcv = lastData.latestClientVersions;
    var _latestVer = _lcv && _lcv.latest ? _lcv.latest : null;
    var _latestSuffix = _latestVer ? ' Latest available: v' + _latestVer + '.' : '';
    if (legacyRows.length > 0) {
        items.push({
            colour:'amber',
            title:'Legacy Clients',
            detail: legacyRows.length + ' active device' + (legacyRows.length !== 1 ? 's are' : ' is') +
                ' not on the latest release. Upgrades should be scheduled.' + _latestSuffix,
            adminTooltip: insightTooltipLegacy(),
            insightKind: 'legacy-clients',
            findingCount: legacyRows.length
        });
    } else {
        items.push({
            colour:'green', allClear: true,
            title:'Legacy Clients',
            detail: 'All active clients are on the latest release.' + _latestSuffix,
            adminTooltip: insightTooltipLegacy(),
            insightKind: 'legacy-clients',
            findingCount: 0
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
            insightKind: 'degraded-health',
            findingCount: degradedRows.length
        });
    } else {
        items.push({
            colour:'green', allClear: true,
            title:'Degraded Asset Health',
            detail: 'All active devices report healthy connectivity after reboot.',
            adminTooltip: INSIGHT_ADMIN_TOOLTIP_DEGRADED,
            insightKind: 'degraded-health',
            findingCount: 0
        });
    }

    var flapUserCount = connectionFlappingAffectedUserCount(aud, usePeriod);
    if (flapUserCount > 0) {
        items.push({
            colour:'blue',
            title:'Connection Flapping',
            detail: flapUserCount + ' user' + (flapUserCount !== 1 ? 's' : '') +
                ' had more than 3 reconnects on a single day — investigate network stability or policy loops.',
            adminTooltip: INSIGHT_ADMIN_TOOLTIP_FLAPPING,
            insightKind: 'connection-flapping',
            findingCount: flapUserCount
        });
    } else {
        items.push({
            colour:'green', allClear: true,
            title:'Connection Flapping',
            detail: 'No users exceeded 3 reconnects on any single day in the selected period.',
            adminTooltip: INSIGHT_ADMIN_TOOLTIP_FLAPPING,
            insightKind: 'connection-flapping',
            findingCount: 0
        });
    }

    // ── Posture insights (audit-based) ─────────────────────────────────────
    var postureAud = filterByPeriod(aud || [], '30d');

    var failingUsers = postureTopFailingUsers30d(postureAud);
    if (failingUsers.length > 0) {
        items.push({
            colour: 'amber',
            title: 'Failing Users on Posture Checks',
            detail: failingUsers.length + ' user' + (failingUsers.length !== 1 ? 's' : '') +
                ' had 3 or more posture check failures in the last 30 days — they may be blocked from Connect access.',
            adminTooltip: INSIGHT_ADMIN_TOOLTIP_POSTURE_TOP_CHECK,
            insightKind: 'posture-top-check',
            findingCount: failingUsers.length
        });
    } else {
        items.push({
            colour:'green', allClear: true,
            title:'Failing Users on Posture Checks',
            detail: 'No users with 3 or more posture failures recorded in the last 30 days.',
            adminTooltip: INSIGHT_ADMIN_TOOLTIP_POSTURE_TOP_CHECK,
            insightKind: 'posture-top-check',
            findingCount: 0
        });
    }

    var spike30 = postureViolationSpike30d(postureAud, buildLastNDayBuckets(30));
    if (spike30) {
        items.push({
            colour: 'amber',
            title: 'Posture Violation Spike',
            detail: spike30.count + ' violations on ' + spike30.dayLabel +
                ' vs a ' + spike30.avg + '/day average — investigate recent policy or OS changes.',
            adminTooltip: INSIGHT_ADMIN_TOOLTIP_POSTURE_SPIKE,
            insightKind: 'posture-spike',
            findingCount: spike30.count
        });
    } else {
        items.push({
            colour:'green', allClear: true,
            title:'Posture Violation Spike',
            detail: 'No unusual spikes in posture violations over the last 30 days.',
            adminTooltip: INSIGHT_ADMIN_TOOLTIP_POSTURE_SPIKE,
            insightKind: 'posture-spike',
            findingCount: 0
        });
    }

    // Mark dismissed items
    items.forEach(function(item) {
        if (dismissMap[item.insightKind]) item.dismissed = true;
    });

    // Sort: active issues first → clear (no findings) → dismissed
    var severityOrder = { red: 0, amber: 1, blue: 2, green: 3 };
    items.sort(function(a, b) {
        var aDismissed = a.dismissed ? 1 : 0;
        var bDismissed = b.dismissed ? 1 : 0;
        if (aDismissed !== bDismissed) return aDismissed - bDismissed;
        var aClear = (a.allClear && !a.dismissed) ? 1 : 0;
        var bClear = (b.allClear && !b.dismissed) ? 1 : 0;
        if (aClear !== bClear) return aClear - bClear;
        var sa = severityOrder[a.colour] !== undefined ? severityOrder[a.colour] : 3;
        var sb = severityOrder[b.colour] !== undefined ? severityOrder[b.colour] : 3;
        return sa - sb;
    });

    // All-clear banner: shown when every non-dismissed item has zero findings
    var nonDismissedItems = items.filter(function(i) { return !i.dismissed; });
    var allClearBanner = nonDismissedItems.length > 0 && nonDismissedItems.every(function(i) { return i.allClear; })
        ? '<li class="insights-all-clear-banner" aria-live="polite">' +
          '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">' +
          '<circle cx="7" cy="7" r="6" stroke="#16a34a" stroke-width="1.5"/>' +
          '<path d="M4.5 7.2l2 2 3-3" stroke="#16a34a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>' +
          '<span>All insights are clear \u2014 no findings to review.</span>' +
          '</li>'
        : '';

    var listEl = document.getElementById('insights-list');
    if (!listEl) return;

    listEl.innerHTML = allClearBanner + items.map(function(item) {
        var dotColour = (item.dismissed || item.allClear) ? 'green' : item.colour;
        var dismissKind = escapeHtmlAttr(item.insightKind);
        var dismissLabel = item.dismissed ? 'Unmute insight' : 'Mute insight';
        var dismissBtn = '<button type="button" class="insight-dismiss-btn' +
            (item.dismissed ? ' insight-dismiss-btn--reactivate' : '') +
            '" data-dismiss-kind="' + dismissKind + '" title="' +
            (item.dismissed ? 'Re-activate monitoring for this insight' : 'Stop monitoring this insight \u2014 it will be greyed out until unmuted') +
            '" aria-label="' + dismissLabel + ': ' + escapeHtmlAttr(item.title) + '">' +
            dismissLabel + '</button>';
        var hiddenNote = (item.dismissed && item.findingCount > 0)
            ? '<div class="insight-dismissed-note">Muted \u2014 ' + item.findingCount + ' finding' +
              (item.findingCount !== 1 ? 's' : '') + ' not shown</div>'
            : '';
        return '<li class="insights-list-item">' +
            insightCardOpenTag(item) +
            '<span class="insight-dot ' + dotColour + '" aria-hidden="true"></span>' +
            '<div class="insight-body">' +
                insightTitleBlockHtml(item) +
                '<div class="insight-detail">' + escapeHtmlAttr(item.detail) + '</div>' +
                hiddenNote +
                '<div class="insight-card-footer">' + dismissBtn + '</div>' +
            '</div></div></li>';
    }).join('');

    // Recalculate custom scrollbar thumb after content changes
    (function() {
        var list  = document.getElementById('insights-list');
        var track = document.getElementById('insights-scrollbar-track');
        var thumb = document.getElementById('insights-scrollbar-thumb');
        if (!list || !track || !thumb) return;
        var trackH  = track.clientHeight;
        var scrollH = list.scrollHeight;
        var clientH = list.clientHeight;
        if (scrollH <= clientH) { thumb.style.height = '0'; return; }
        var thumbH = Math.max(24, Math.round((clientH / scrollH) * trackH));
        thumb.style.height = thumbH + 'px';
        thumb.style.top    = '0px';
    }());
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
    // Reset so debouncedFitBounds will zoom to the filtered user's dots.
    _mapUserHasInteracted = false;
    _mapAutoFitDone = false;
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
    // Reset so debouncedFitBounds will zoom to the filtered region's markers.
    _mapUserHasInteracted = false;
    _mapAutoFitDone = false;
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
        znTrack('user_filter_applied');
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
        znTrack('region_filter_applied');
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
 * Opens the Insight side-drawer.
 * Shows an optional logic description card, a "Recommended Action" alert box,
 * a search input, and a sortable filterable table.
 *
 * @param {Object[]} data             - rows from insightRows* helpers
 * @param {string}   title            - short insight name, e.g. "Connection Flapping"
 * @param {string}   description      - recommended action text
 * @param {string[]} columns          - ordered column keys for the table
 * @param {string}   severity         - 'amber' | 'blue' (default 'blue')
 * @param {string}   [logicDescription] - 1-2 sentence explanation of how the check works
 */
function openInsightDrawer(data, title, description, columns, severity, logicDescription) {
    var rows = data || [];
    var backdrop = document.getElementById('insight-drawer-backdrop');
    var titleEl  = document.getElementById('insight-drawer-title');
    var logicEl  = document.getElementById('insight-drawer-logic');
    var recEl    = document.getElementById('insight-drawer-recommended');
    var searchEl = document.getElementById('insight-drawer-search');
    var tableEl  = document.getElementById('insight-drawer-table');
    if (!backdrop || !titleEl || !recEl || !searchEl || !tableEl) return;

    titleEl.textContent = 'Insight: ' + (title || 'Details');

    // Logic description card (above Recommended Action)
    if (logicEl) {
        if (logicDescription) {
            logicEl.innerHTML =
                '<div class="insight-drawer-logic-label">How this check works</div>' +
                '<div class="insight-drawer-logic-body">' + escapeHtmlAttr(logicDescription) + '</div>';
            logicEl.style.display = '';
        } else {
            logicEl.innerHTML = '';
            logicEl.style.display = 'none';
        }
    }

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

    // Sort state — reset on each open
    var sortCol = null;
    var sortDir = 'asc';

    function sortedRows(arr) {
        if (!sortCol) return arr;
        var idx = columns.indexOf(sortCol);
        if (idx === -1) return arr;
        return arr.slice().sort(function(a, b) {
            var av = String(a && (Array.isArray(a) ? a[idx] : a[sortCol]) != null
                ? (Array.isArray(a) ? a[idx] : a[sortCol]) : '').toLowerCase();
            var bv = String(b && (Array.isArray(b) ? b[idx] : b[sortCol]) != null
                ? (Array.isArray(b) ? b[idx] : b[sortCol]) : '').toLowerCase();
            if (av < bv) return sortDir === 'asc' ? -1 : 1;
            if (av > bv) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }

    function renderTable(filter) {
        var lc = (filter || '').toLowerCase();
        var filtered = lc
            ? rows.filter(function(row) {
                return columns.some(function(c, ci) {
                    var v = Array.isArray(row) ? row[ci] : (row && row[c]);
                    return v && String(v).toLowerCase().indexOf(lc) !== -1;
                });
              })
            : rows;
        if (filtered.length === 0) {
            if (lc) {
                tableEl.innerHTML = buildEmptyState(
                    ZN_ICON_SEARCH,
                    'No results for \u201c' + filter + '\u201d',
                    'Try a different search term'
                );
            } else {
                tableEl.innerHTML = buildEmptyState(
                    ZN_ICON_SHIELD,
                    'No records found',
                    'There is no data available for this insight right now'
                );
            }
            return;
        }
        var sorted = sortedRows(filtered);
        var thead = '<thead><tr>' + columns.map(function(c) {
            var isActive = c === sortCol;
            var arrow = isActive ? (sortDir === 'asc' ? ' <span class="sort-arrow">\u25b2</span>' : ' <span class="sort-arrow">\u25bc</span>') : ' <span class="sort-arrow sort-arrow--idle">\u25b2</span>';
            return '<th class="insight-th-sortable' + (isActive ? ' sort-active' : '') +
                '" data-sort-col="' + escapeHtmlAttr(String(c)) + '">' +
                escapeHtmlAttr(String(c)) + arrow + '</th>';
        }).join('') + '</tr></thead>';
        var tbody = '<tbody>' + sorted.map(function(row) {
            var userVal = Array.isArray(row)
                ? (row[0] || '')
                : ((row && (row['User'] || row['Asset Name'])) || '');
            return '<tr class="insight-drawer-row" data-user="' + escapeHtmlAttr(String(userVal)) + '">' +
                columns.map(function(c, ci) {
                    var v = Array.isArray(row) ? row[ci] : (row && row[c]);
                    return '<td>' + escapeHtmlAttr(v === undefined || v === null ? '' : String(v)) + '</td>';
                }).join('') + '</tr>';
        }).join('') + '</tbody>';
        tableEl.innerHTML = '<table class="insight-drawer-table">' + thead + tbody + '</table>';
    }

    renderTable('');
    backdrop.classList.add('is-open');

    // Search live-filter
    searchEl.oninput = function() { renderTable(searchEl.value.trim()); };

    // Sortable column headers
    tableEl.onclick = function(e) {
        var th = e.target.closest('th.insight-th-sortable');
        if (th) {
            var col = th.getAttribute('data-sort-col');
            if (sortCol === col) {
                sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                sortCol = col;
                sortDir = 'asc';
            }
            renderTable(searchEl.value.trim());
            return;
        }
        // Row drill-down → global user filter
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

/**
 * Specialised drawer for the Legacy Clients insight — same as openInsightDrawer
 * but renders macOS / Windows OS tabs instead of a plain table.
 */
function openLegacyClientsInsightDrawer(allRows, recText) {
    var LOGIC = 'Compares each active client\u2019s installed agent version against the current official release. Any client not running the latest version is flagged as legacy and is missing recent security patches and feature updates.';
    var columns = ['Asset Name', 'Current Version', 'OS'];

    // Use openInsightDrawer to set up the common chrome (title, logic card, rec card, search)
    openInsightDrawer([], 'Legacy Clients', recText, columns, 'amber', LOGIC);

    var tableEl  = document.getElementById('insight-drawer-table');
    var searchEl = document.getElementById('insight-drawer-search');
    if (!tableEl || !searchEl) return;

    var activeTab = 'all';   // 'all' | 'windows' | 'macos'
    var sortCol   = null;
    var sortDir   = 'asc';

    function osFamily(row) {
        var os = (row && row['OS']) || '';
        return osMajorFamilyFromExactString(os);
    }

    function tabRows() {
        if (activeTab === 'windows') return allRows.filter(function(r) { return osFamily(r) === 'Windows'; });
        if (activeTab === 'macos')   return allRows.filter(function(r) { return osFamily(r) === 'macOS'; });
        return allRows;
    }

    function sortedRows(arr) {
        if (!sortCol) return arr;
        var ci = columns.indexOf(sortCol);
        if (ci === -1) return arr;
        return arr.slice().sort(function(a, b) {
            var av = String(a && a[sortCol] != null ? a[sortCol] : '').toLowerCase();
            var bv = String(b && b[sortCol] != null ? b[sortCol] : '').toLowerCase();
            if (av < bv) return sortDir === 'asc' ? -1 : 1;
            if (av > bv) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }

    var winCount = allRows.filter(function(r) { return osFamily(r) === 'Windows'; }).length;
    var macCount = allRows.filter(function(r) { return osFamily(r) === 'macOS'; }).length;

    function tabBtn(id, icon, label, count) {
        var active = activeTab === id ? ' legacy-tab--active' : '';
        return '<button type="button" class="legacy-tab-btn' + active + '" data-tab="' + id + '">' +
            icon + '<span class="legacy-tab-label">' + escapeHtmlAttr(label) + '</span>' +
            '<span class="legacy-tab-count">' + count + '</span></button>';
    }

    function render(filter) {
        var lc = (filter || '').toLowerCase();
        var base = tabRows();
        var filtered = lc ? base.filter(function(row) {
            return columns.some(function(c) {
                var v = row && row[c];
                return v && String(v).toLowerCase().indexOf(lc) !== -1;
            });
        }) : base;
        var sorted = sortedRows(filtered);

        var tabsHtml =
            '<div class="legacy-tabs">' +
            tabBtn('all', '', 'All', allRows.length) +
            (winCount ? tabBtn('windows', ZN_OS_WIN_ICON, 'Windows', winCount) : '') +
            (macCount ? tabBtn('macos', ZN_OS_MAC_ICON, 'macOS', macCount) : '') +
            '</div>';

        var tableHtml;
        if (sorted.length === 0) {
            tableHtml = lc
                ? buildEmptyState(ZN_ICON_SEARCH, 'No results for \u201c' + filter + '\u201d', 'Try a different search term')
                : buildEmptyState(ZN_ICON_SHIELD, 'No legacy clients', 'All active clients in this category are on the latest release');
        } else {
            var thead = '<thead><tr>' + columns.map(function(c) {
                var isActive = c === sortCol;
                var arrow = isActive
                    ? (sortDir === 'asc' ? ' <span class="sort-arrow">\u25b2</span>' : ' <span class="sort-arrow">\u25bc</span>')
                    : ' <span class="sort-arrow sort-arrow--idle">\u25b2</span>';
                return '<th class="insight-th-sortable' + (isActive ? ' sort-active' : '') +
                    '" data-sort-col="' + escapeHtmlAttr(c) + '">' + escapeHtmlAttr(c) + arrow + '</th>';
            }).join('') + '</tr></thead>';
            var tbody = '<tbody>' + sorted.map(function(row) {
                var userVal = (row && row['Asset Name']) || '';
                return '<tr class="insight-drawer-row" data-user="' + escapeHtmlAttr(String(userVal)) + '">' +
                    columns.map(function(c) {
                        var v = row && row[c];
                        return '<td>' + escapeHtmlAttr(v == null ? '' : String(v)) + '</td>';
                    }).join('') + '</tr>';
            }).join('') + '</tbody>';
            tableHtml = '<table class="insight-drawer-table">' + thead + tbody + '</table>';
        }
        tableEl.innerHTML = tabsHtml + tableHtml;
    }

    render('');
    searchEl.oninput = function() { render(searchEl.value.trim()); };

    tableEl.onclick = function(e) {
        // Tab switch
        var btn = e.target.closest('button.legacy-tab-btn');
        if (btn) {
            activeTab = btn.getAttribute('data-tab') || 'all';
            sortCol = null; sortDir = 'asc';
            render(searchEl.value.trim());
            return;
        }
        // Sort header
        var th = e.target.closest('th.insight-th-sortable');
        if (th) {
            var col = th.getAttribute('data-sort-col');
            if (sortCol === col) {
                sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                sortCol = col;
                sortDir = 'asc';
            }
            render(searchEl.value.trim());
            return;
        }
        // Row drill-down
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
    if (card.classList && card.classList.contains('insight-card--clear')) return;
    if (card.classList && card.classList.contains('insight-card--dismissed')) return;
    var kind = card.getAttribute('data-insight-card');
    if (!kind) return;
    var ses = filterSessionsByDashboardUser(lastData.ses || []);
    var aud = lastData.aud || [];
    var period = activePeriod;

    if (kind === 'region-routing') {
        openInsightDrawer(
            insightRowsSubOptimalRouting(filterSessionsByDashboardFilters(ses)),
            'Sub-optimal Routing',
            'Review regional routing and policy for the listed users. Align actual region with desired region where possible to reduce latency.',
            ['User', 'Desired Region', 'Actual Region'],
            'blue',
            'Checks every active session to see whether the gateway region the client is actually connected to matches the region Zero Networks considers optimal for that user. A mismatch means traffic is being routed further away than necessary, increasing latency.'
        );
    } else if (kind === 'legacy-clients') {
        var _lcvDrawer = lastData.latestClientVersions;
        var _latestDrawer = _lcvDrawer && _lcvDrawer.latest ? _lcvDrawer.latest : null;
        var _recText = _latestDrawer
            ? 'Plan upgrades to v' + _latestDrawer + ' (the current official release) so all clients receive the latest security patches and features.'
            : 'Plan upgrades to the current release so all clients receive the latest security patches and features.';
        openLegacyClientsInsightDrawer(
            insightRowsLegacyClients(filterSessionsByDashboardFilters(ses)),
            _recText
        );
    } else if (kind === 'degraded-health') {
        openInsightDrawer(
            insightRowsDegradedAssetHealth(filterSessionsByDashboardFilters(ses)),
            'Degraded Asset Health',
            'Investigate endpoint network state, reboot behavior, and agent install health for the listed users.',
            ['User', 'External IP', 'Last Seen'],
            'amber',
            'Reads the post-reboot connectivity health signal reported by the Connect agent on each active endpoint. A failing signal means the agent did not successfully re-establish its network state after the device last restarted.'
        );
    } else if (kind === 'connection-flapping') {
        openInsightDrawer(
            insightRowsConnectionFlapping(filterAuditsByDashboardFilters(aud), period),
            'Connection Flapping',
            'Review recent audits for these accounts. Check for unstable networks, credential prompts, or policy changes causing repeated sign-ins.',
            ['User', 'Date', 'Reconnect Count'],
            'amber',
            'Detects users who created more than 3 new Connect sessions within a single calendar day. A high session-creation count on the same day indicates the connection is repeatedly dropping and re-establishing rather than staying stable.'
        );
    } else if (kind === 'posture-top-check') {
        var posturePool30dFU = filterByPeriod(filterAuditsByDashboardFilters(aud), '30d');
        var fuRows = postureTopFailingUsers30d(posturePool30dFU).map(function(u) {
            return [
                u.userName,
                String(u.count),
                u.topCheckType !== null ? postureCheckTypeLabel(u.topCheckType) : '\u2014'
            ];
        });
        openInsightDrawer(fuRows, 'Failing Users on Posture Checks',
            'These users have 3 or more posture violations in the last 30 days and may be blocked from Connect access. Investigate their device posture, applied profiles, and whether a policy exception or device fix is needed.',
            ['User', 'Failure Count', 'Most Common Check'], 'amber',
            'Counts posture check failures per user over the last 30 days. Users who accumulate 3 or more failures are surfaced here, since repeated violations point to a persistent device compliance gap that can result in blocked access.');
    } else if (kind === 'posture-spike') {
        var posturePool30dSp = filterByPeriod(filterAuditsByDashboardFilters(aud), '30d');
        var spikeRows = [];
        posturePool30dSp.forEach(function(item) {
            if (auditTypeToNum(item) !== 390 && auditTypeToNum(item) !== 374) return;
            var ts = getAuditItemTs(item);
            if (!ts) return;
            var d = parseAuditDetails(item);
            var uName = (d && d.userName) || (item.destinationEntitiesList && item.destinationEntitiesList[0] && item.destinationEntitiesList[0].name) || '\u2014';
            var checks = (d && Array.isArray(d.postureCheckTypes)) ? d.postureCheckTypes.map(postureCheckTypeLabel).join(', ') : '\u2014';
            spikeRows.push([uName, checks, new Date(ts).toLocaleDateString()]);
        });
        spikeRows.sort(function(a, b) { return b[2].localeCompare(a[2]); });
        openInsightDrawer(spikeRows, 'Posture Violation Spike',
            'A high-volume violation day was detected. Check whether a policy change, OS update, or posture profile change caused this spike.',
            ['User', 'Check Types', 'Date'], 'amber',
            'Compares each day\u2019s violation count to the 30-day rolling daily average. A day is flagged when it records at least 3 violations and more than twice the average \u2014 a pattern that typically indicates a policy change, OS update, or posture profile misconfiguration that affected many users at once.');
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
    // ── Custom scrollbar for Insights (macOS overlay scrollbars don't show persistently) ──
    (function() {
        var list  = document.getElementById('insights-list');
        var track = document.getElementById('insights-scrollbar-track');
        var thumb = document.getElementById('insights-scrollbar-thumb');
        if (!list || !track || !thumb) return;

        function updateThumb() {
            var trackH   = track.clientHeight;
            var scrollH  = list.scrollHeight;
            var clientH  = list.clientHeight;
            if (scrollH <= clientH) {
                thumb.style.height = '0';
                return;
            }
            var thumbH = Math.max(24, Math.round((clientH / scrollH) * trackH));
            var maxTop = trackH - thumbH;
            var top    = Math.round((list.scrollTop / (scrollH - clientH)) * maxTop);
            thumb.style.height = thumbH + 'px';
            thumb.style.top    = top + 'px';
        }

        list.addEventListener('scroll', updateThumb, { passive: true });
        new ResizeObserver(updateThumb).observe(list);
        updateThumb();
    }());

    var insightsList = document.getElementById('insights-list');
    if (insightsList) {
        insightsList.addEventListener('click', function(e) {
            // Dismiss / Re-activate button — intercept before card drill-down
            var dismissBtn = e.target.closest('.insight-dismiss-btn');
            if (dismissBtn && insightsList.contains(dismissBtn)) {
                e.preventDefault();
                e.stopPropagation();
                var kind = dismissBtn.getAttribute('data-dismiss-kind');
                if (!kind) return;
                if (dismissBtn.classList.contains('insight-dismiss-btn--reactivate')) {
                    clearInsightDismissed(kind);
                } else {
                    setInsightDismissed(kind);
                }
                renderInsights(lastData.lic, lastData.ses || [], lastData.aud || [], activePeriod);
                return;
            }
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



// ── Wire clickable widget headers → drawers ────────────────────────────────
(function() {
    function wire(id, fn) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    }

    // Click the big number to open the drawer; title text is freely selectable.
    wire('kpi-sessions-trigger', function() { znTrack('kpi_widget_click', { widget: 'sessions' }); openSessionsDrawer(); });
    wire('kpi-regions-trigger',  function() { znTrack('kpi_widget_click', { widget: 'regions' });  openRegionHealthDrawer(); });
    wire('kpi-posture-trigger',  function() { znTrack('kpi_widget_click', { widget: 'posture' });  openPostureDrawer(); });

    var insightsGuideBtn = document.getElementById('btn-insights-logic-guide');
    if (insightsGuideBtn) {
        insightsGuideBtn.addEventListener('click', function(ev) {
            ev.stopPropagation();
            ev.preventDefault();
            openInsightsLogicGuideModal();
        });
    }






}());

initTopUsersModeSelect();

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
                if (v === 7 || v === 14 || v === 30 || v === 90) dauChartRangeDays = v;
                znTrack('audit_chart_range_change', { days: v });
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
    /* audit-drill-inspect-btn removed — raw JSON inspector not exposed to users */
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
        znTrack('export_pdf_clicked');
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
                '    <span style="font-size:18px;font-weight:700;color:#0f172a;">Zero Networks — Connect Dashboard (#1)</span>',
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
var _rhTableRows    = [];   // flat server rows for the Regions Health table
var _rhCurrentPage  = 1;
var _rhPageSize     = 10;

function openRegionHealthDrawer() {
    znTrack('drawer_opened', { drawer: 'region_health' });
    var bd = document.getElementById('region-health-drawer-backdrop');
    if (!bd) return;
    _activeRegionInfoName = null;
    // Show Figma summary bar + pagination; hide legacy stat boxes
    var summaryBar = document.getElementById('rh-summary-bar');
    var statsEl    = document.getElementById('rh-drawer-stats');
    var distEl     = document.getElementById('rh-drawer-distributions');
    var pgEl       = document.getElementById('rh-pagination');
    if (summaryBar) summaryBar.style.display = '';
    if (statsEl)    statsEl.style.display    = 'none';
    if (distEl)     distEl.innerHTML         = '';
    if (pgEl)       pgEl.style.display       = 'none'; // shown after render
    var titleEl = document.getElementById('rh-drawer-title');
    if (titleEl) titleEl.textContent = 'Regions health';
    wireRhPagination();
    renderRegionHealthDrawerContent();
    bd.classList.add('is-open');
}
function closeRegionHealthDrawer() {
    var bd = document.getElementById('region-health-drawer-backdrop');
    if (bd) bd.classList.remove('is-open');
    _activeRegionInfoName = null;
}

// ── Map Combo Drawer (Users + Regions tabs) ────────────────────────────────

function openMapComboDrawer(defaultTab, locationSessions, locationRegionNames) {
    znTrack('drawer_opened', { drawer: 'map_combo', tab: defaultTab || 'users' });
    var bd = document.getElementById('map-combo-backdrop');
    if (!bd) return;
    _mcdActiveTab  = defaultTab || 'users';
    _mcdSessFilter = 'all';
    _mcdSessState.searchQuery = '';
    _mcdSessState.currentPage = 1;
    _mcdRhCurrentPage = 1;
    _mcdLocationSessions    = locationSessions    || null;
    _mcdLocationRegionNames = locationRegionNames || null;
    var searchEl = document.getElementById('mcd-search');
    if (searchEl) searchEl.value = '';
    _mcdSwitchTab(_mcdActiveTab, true);
    // Always sync the Users tab badge regardless of which tab is active,
    // because _mcdSwitchTab only renders the active tab's content.
    if (_mcdActiveTab !== 'users') {
        var usersBadge = document.getElementById('mcd-tab-users-badge');
        if (usersBadge) {
            var badgeSessions = _mcdLocationSessions !== null ? _mcdLocationSessions : (lastData && lastData.ses || []);
            usersBadge.textContent = badgeSessions.length;
        }
    }
    bd.classList.add('is-open');
}

function closeMapComboDrawer() {
    var bd = document.getElementById('map-combo-backdrop');
    if (bd) bd.classList.remove('is-open');
    _mcdLocationSessions    = null;
    _mcdLocationRegionNames = null;
}

function _mcdSwitchTab(tab, forceRender) {
    _mcdActiveTab = tab;
    var usersTab   = document.getElementById('mcd-tab-users');
    var regTab     = document.getElementById('mcd-tab-regions');
    var usersPanel = document.getElementById('mcd-users-panel');
    var regPanel   = document.getElementById('mcd-regions-panel');
    if (!usersTab || !regTab || !usersPanel || !regPanel) return;
    if (tab === 'users') {
        usersTab.classList.add('mcd-tab--active');
        regTab.classList.remove('mcd-tab--active');
        usersPanel.style.display = '';
        regPanel.style.display   = 'none';
        if (forceRender) renderMcdUsersTab();
    } else {
        regTab.classList.add('mcd-tab--active');
        usersTab.classList.remove('mcd-tab--active');
        regPanel.style.display   = '';
        usersPanel.style.display = 'none';
        if (forceRender) renderMcdRegionsTab();
    }
}

var _MCD_PAGE_SIZE = 25;

function renderMcdUsersTab() {
    var allSessions = _mcdLocationSessions !== null ? _mcdLocationSessions : (lastData.ses || []);
    var totalActive = 0, totalOffline = 0;
    allSessions.forEach(function(s) {
        if (sessionDisplayState(s) === 'active') totalActive++; else totalOffline++;
    });
    var totalAll = allSessions.length;

    var categorySessions = _mcdSessFilter === 'all' ? allSessions
        : allSessions.filter(function(s) {
            var st = sessionDisplayState(s);
            return _mcdSessFilter === 'active' ? st === 'active' : st !== 'active';
        });
    var filtered = applySessionsDrawerSearch(categorySessions, _mcdSessState.searchQuery);
    _mcdSessState.filteredSessions = filtered;

    // Stats bar
    var statsEl = document.getElementById('mcd-stats-bar');
    if (statsEl) {
        var segs = [
            { key: 'all',     num: totalAll,     dot: 'hidden', label: 'all sessions' },
            { key: 'active',  num: totalActive,  dot: 'green',  label: 'active' },
            { key: 'offline', num: totalOffline, dot: 'gray',   label: 'offline' }
        ];
        statsEl.innerHTML = segs.map(function(seg) {
            var isAct = _mcdSessFilter === seg.key ? ' is-active' : '';
            return '<div class="sdw-stat-seg' + isAct + '" data-mcd-filter="' + seg.key + '">' +
                '<span class="sdw-stat-dot sdw-stat-dot--' + seg.dot + '"></span>' +
                '<span class="sdw-stat-num">' + seg.num + '</span>' +
                '<span class="sdw-stat-label">' + escapeHtmlAttr(seg.label) + '</span>' +
                '</div>';
        }).join('');
        Array.prototype.forEach.call(statsEl.querySelectorAll('.sdw-stat-seg'), function(seg) {
            seg.addEventListener('click', function() {
                var f = seg.getAttribute('data-mcd-filter');
                _mcdSessFilter = (_mcdSessFilter === f && f !== 'all') ? 'all' : f;
                _mcdSessState.currentPage = 1;
                renderMcdUsersTab();
            });
        });
    }

    // Tab badge
    var badge = document.getElementById('mcd-tab-users-badge');
    if (badge) badge.textContent = totalAll;

    // Pagination state
    var totalPages  = Math.max(1, Math.ceil(filtered.length / _MCD_PAGE_SIZE));
    var currentPage = Math.max(1, Math.min(_mcdSessState.currentPage || 1, totalPages));
    _mcdSessState.currentPage = currentPage;
    var pageStart = (currentPage - 1) * _MCD_PAGE_SIZE;
    var pageSessions = filtered.slice(pageStart, pageStart + _MCD_PAGE_SIZE);

    // List
    var listEl = document.getElementById('mcd-sess-list');
    if (!listEl) return;
    if (!filtered.length) {
        listEl.innerHTML = '<div class="ses-empty">' + buildEmptyState(ZN_ICON_USERS, 'No sessions found', 'No sessions match the current filter') + '</div>';
    } else {
        listEl.innerHTML = pageSessions.map(function(s) {
            var st      = sessionDisplayState(s);
            var dotCls  = st === 'active' ? 'ses-status-dot--active' : 'ses-status-dot--offline';
            var user    = escapeHtmlAttr(userName(s)  || '\u2014');
            var asset   = escapeHtmlAttr(assetName(s) || '\u2014');
            var ip      = s.currentPublicIp != null ? s.currentPublicIp : sessionPublicIp(s);
            var country = escapeHtmlAttr(resolveIpToCountry(ip));
            var lastAuthRaw = formatLastAuthDisplay(getLastAuthTimeForSession(s));
            var lastAuthHtml = lastAuthRaw
                ? (function() {
                    var pts = String(lastAuthRaw).match(/^(\S+)\s+(.+)$/);
                    return pts ? escapeHtmlAttr(pts[1]) + '<br>' + escapeHtmlAttr(pts[2]) : escapeHtmlAttr(lastAuthRaw);
                  }())
                : '\u2014';
            return '<div class="ses-row ses-row--sessions-drill">' +
                '<div class="ses-row-user-cell"><span class="ses-status-dot ' + dotCls + '"></span><span class="ses-row-user-name">' + user + '</span></div>' +
                '<div class="ses-row-cell">' + asset + '</div>' +
                '<div class="ses-row-cell">' + country + '</div>' +
                '<div class="ses-row-cell ses-row-cell--date">' + lastAuthHtml + '</div>' +
                '</div>';
        }).join('');
    }

    // Pagination controls
    var pgEl    = document.getElementById('mcd-pagination');
    var labelEl = document.getElementById('mcd-pg-label');
    var totalEl = document.getElementById('mcd-pg-total');
    if (labelEl) labelEl.textContent = currentPage + ' of ' + totalPages;
    if (totalEl) totalEl.textContent = 'Total count: ' + filtered.length;
    if (pgEl) pgEl.style.display = filtered.length > _MCD_PAGE_SIZE ? 'flex' : 'none';
    var atFirst = currentPage <= 1, atLast = currentPage >= totalPages;
    ['mcd-pg-first', 'mcd-pg-prev'].forEach(function(id) { var b = document.getElementById(id); if (b) b.disabled = atFirst; });
    ['mcd-pg-next',  'mcd-pg-last'].forEach(function(id) { var b = document.getElementById(id); if (b) b.disabled = atLast; });
}

function renderMcdRegionsTab() {
    var regionNames = Object.create(null);
    (lastData.regions || []).forEach(function(r) { if (r.name) regionNames[String(r.name).trim()] = true; });
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
    var apiOrder = (lastData.regions || []).map(function(r) { return r.name; });
    var sortedRegions = Object.keys(regionNames).sort(function(a, b) {
        var ai = apiOrder.indexOf(a), bi = apiOrder.indexOf(b);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return a.localeCompare(b);
    });
    // When opened from a map location, restrict to the regions at that location.
    if (_mcdLocationRegionNames && _mcdLocationRegionNames.length) {
        var allowed = {};
        _mcdLocationRegionNames.forEach(function(rn) { allowed[String(rn).trim()] = true; });
        sortedRegions = sortedRegions.filter(function(rn) { return !!allowed[rn]; });
    }

    var totalHealthEvents = 0;
    sortedRegions.forEach(function(rn) {
        var hc = countRegionHealthEvents30d(rn);
        totalHealthEvents += hc.down + hc.recovered;
    });
    var rcEl = document.getElementById('mcd-rh-regions-count');
    var evEl = document.getElementById('mcd-rh-events-count');
    if (rcEl) rcEl.textContent = sortedRegions.length;
    if (evEl) evEl.textContent = totalHealthEvents;

    // Tab badge
    var badge = document.getElementById('mcd-tab-regions-badge');
    if (badge) badge.textContent = sortedRegions.length;

    var allRows = [];
    sortedRegions.forEach(function(rn) {
        var serverList   = getServerOsListForRegion(rn);
        var geoLabel     = getGeoLocationForRegion(rn);
        var healthCounts = countRegionHealthEvents30d(rn);
        if (serverList.length) {
            serverList.forEach(function(srv) {
                var activeSessions = (lastData.activeSessions || []).filter(function(s) {
                    var sn = s.server && s.server.name ? String(s.server.name).trim() : '';
                    return sn === srv.server;
                }).length;
                allRows.push({ regionName: rn, serverName: srv.server, serverOS: srv.os || '\u2014', location: geoLabel, downCount: healthCounts.down, activeSessions: activeSessions });
            });
        } else {
            var activeSessions = (lastData.activeSessions || []).filter(function(s) {
                var rn2 = s.actualRegion && s.actualRegion.name != null ? String(s.actualRegion.name).trim() : '';
                return rn2 === rn;
            }).length;
            allRows.push({ regionName: rn, serverName: '', serverOS: '\u2014', location: geoLabel, downCount: healthCounts.down, activeSessions: activeSessions });
        }
    });
    _mcdRhRows = allRows;
    _mcdRhCurrentPage = 1;
    renderMcdRhPage(1);
}

function renderMcdRhPage(page) {
    var listEl = document.getElementById('mcd-rh-list');
    var pgEl   = document.getElementById('mcd-rh-pagination');
    if (!listEl) return;
    var total      = _mcdRhRows.length;
    var totalPages = Math.max(1, Math.ceil(total / 10));
    page = Math.max(1, Math.min(page, totalPages));
    _mcdRhCurrentPage = page;

    if (!total) {
        listEl.innerHTML = '<div class="ses-empty">' + buildEmptyState(ZN_ICON_GLOBE, 'No region data yet', 'Waiting for session or audit sync') + '</div>';
        if (pgEl) pgEl.style.display = 'none';
        return;
    }

    var COLS     = '1.55fr 1.35fr 1fr 1fr 0.8fr 1fr';
    var start    = (page - 1) * 10;
    var pageRows = _mcdRhRows.slice(start, start + 10);

    var headerHtml = '<div class="rh-table-header" style="grid-template-columns:' + COLS + '">' +
        ['Region name', 'Server OS', 'Location', 'Down/recovery', 'Avg load', 'Active sessions']
            .map(function(h) { return '<div class="rh-th">' + h + '</div>'; }).join('') +
        '</div>';
    var rowsHtml = pageRows.map(function(row) {
        return '<div class="rh-table-row" style="grid-template-columns:' + COLS + '">' +
            '<div class="rh-td rh-td--name"><span class="rh-region-primary">' + escapeHtmlAttr(row.regionName) + '</span>' +
            (row.serverName ? '<span class="rh-region-server">' + escapeHtmlAttr(row.serverName) + '</span>' : '') + '</div>' +
            '<div class="rh-td rh-td--os">' + escapeHtmlAttr(row.serverOS) + '</div>' +
            '<div class="rh-td">' + escapeHtmlAttr(row.location) + '</div>' +
            '<div class="rh-td">' + escapeHtmlAttr(String(row.downCount)) + '</div>' +
            '<div class="rh-td">\u2014</div>' +
            '<div class="rh-td rh-td--num-blue">' + escapeHtmlAttr(String(row.activeSessions)) + '</div>' +
            '</div>';
    }).join('');
    listEl.innerHTML = headerHtml + rowsHtml;

    if (pgEl) {
        pgEl.style.display = total > 10 ? 'flex' : 'none';
        if (total > 10) {
            var labelEl = document.getElementById('mcd-rh-pg-label');
            var totalEl = document.getElementById('mcd-rh-pg-total');
            if (labelEl) labelEl.textContent = page + ' of ' + totalPages;
            if (totalEl) totalEl.textContent = 'Total count: ' + total;
            ['mcd-rh-pg-first', 'mcd-rh-pg-prev'].forEach(function(id) { var b = document.getElementById(id); if (b) b.disabled = page <= 1; });
            ['mcd-rh-pg-next',  'mcd-rh-pg-last'].forEach(function(id) { var b = document.getElementById(id); if (b) b.disabled = page >= totalPages; });
        }
    }
}

/**
 * Open the Region Info drawer drilled into a specific region (from the Region Load widget).
 */
function openRegionInfoDrawer(regionName) {
    var bd = document.getElementById('region-health-drawer-backdrop');
    if (!bd) return;
    _activeRegionInfoName = regionName;
    // Hide Figma summary bar + pagination; show legacy stat boxes
    var summaryBar = document.getElementById('rh-summary-bar');
    var statsEl    = document.getElementById('rh-drawer-stats');
    var pgEl       = document.getElementById('rh-pagination');
    if (summaryBar) summaryBar.style.display = 'none';
    if (pgEl)       pgEl.style.display       = 'none';
    if (statsEl) {
        statsEl.style.display            = '';
        statsEl.style.gridTemplateColumns = 'repeat(1,1fr)';
    }
    var titleEl = document.getElementById('rh-drawer-title');
    if (titleEl) titleEl.textContent = 'Region Info';
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
        usersHtml += '<div class="ses-empty">' + buildEmptyState(ZN_ICON_GLOBE, 'No active sessions', 'No users are currently connected to this region') + '</div>';
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
    // ── Collect all known region names ───────────────────────────────────
    var regionNames = Object.create(null);
    (lastData.regions || []).forEach(function(r) {
        if (r.name) regionNames[String(r.name).trim()] = true;
    });
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

    // Sort: API order first, then alphabetical
    var apiOrder = (lastData.regions || []).map(function(r) { return r.name; });
    var sortedRegions = Object.keys(regionNames).sort(function(a, b) {
        var ai = apiOrder.indexOf(a), bi = apiOrder.indexOf(b);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return a.localeCompare(b);
    });

    // ── Summary bar: N regions | N health events ─────────────────────────
    var totalHealthEvents = 0;
    sortedRegions.forEach(function(rn) {
        var hc = countRegionHealthEvents30d(rn);
        totalHealthEvents += hc.down + hc.recovered;
    });
    var regCountEl = document.getElementById('rh-regions-count');
    var evCountEl  = document.getElementById('rh-health-events-count');
    if (regCountEl) regCountEl.textContent = sortedRegions.length;
    if (evCountEl)  evCountEl.textContent  = totalHealthEvents;

    // ── Build flat server-level rows (one row per server per region) ──────
    var allRows = [];
    sortedRegions.forEach(function(regionName) {
        var serverList   = getServerOsListForRegion(regionName);
        var geoLabel     = getGeoLocationForRegion(regionName);
        var healthCounts = countRegionHealthEvents30d(regionName);

        if (serverList.length) {
            serverList.forEach(function(srv) {
                var activeSessions = (lastData.activeSessions || []).filter(function(s) {
                    var sn = s.server && s.server.name ? String(s.server.name).trim() : '';
                    return sn === srv.server;
                }).length;
                allRows.push({
                    regionName:     regionName,
                    serverName:     srv.server,
                    serverOS:       srv.os || '\u2014',
                    location:       geoLabel,
                    downCount:      healthCounts.down,
                    activeSessions: activeSessions
                });
            });
        } else {
            var activeSessions = (lastData.activeSessions || []).filter(function(s) {
                var rn = s.actualRegion && s.actualRegion.name != null ? String(s.actualRegion.name).trim() : '';
                return rn === regionName;
            }).length;
            allRows.push({
                regionName:     regionName,
                serverName:     '',
                serverOS:       '\u2014',
                location:       geoLabel,
                downCount:      healthCounts.down,
                activeSessions: activeSessions
            });
        }
    });

    _rhTableRows   = allRows;
    _rhCurrentPage = 1;
    renderRhTablePage(1);
}

/**
 * Render one page of the Regions Health 6-column table (Figma spec).
 */
function renderRhTablePage(page) {
    var listEl = document.getElementById('rh-drawer-list');
    var pgEl   = document.getElementById('rh-pagination');
    if (!listEl) return;

    var total      = _rhTableRows.length;
    var totalPages = Math.max(1, Math.ceil(total / _rhPageSize));
    page = Math.max(1, Math.min(page, totalPages));
    _rhCurrentPage = page;

    if (!total) {
        listEl.innerHTML = '<div class="ses-empty">' + buildEmptyState(ZN_ICON_GLOBE, 'No region data yet', 'Waiting for session or audit sync') + '</div>';
        if (pgEl) pgEl.style.display = 'none';
        return;
    }

    var start    = (page - 1) * _rhPageSize;
    var pageRows = _rhTableRows.slice(start, start + _rhPageSize);
    var COLS     = '1.55fr 1.35fr 1fr 1fr 0.8fr 1fr';

    var headerHtml = '<div class="rh-table-header" style="grid-template-columns:' + COLS + '">' +
        ['Region name', 'Server OS', 'Location', 'Down/recovery', 'Avg load', 'Active sessions']
            .map(function(h) { return '<div class="rh-th">' + h + '</div>'; }).join('') +
        '</div>';

    var rowsHtml = pageRows.map(function(row) {
        return '<div class="rh-table-row" data-region-name="' + escapeHtmlAttr(row.regionName) + '" style="grid-template-columns:' + COLS + '">' +
            '<div class="rh-td rh-td--name">' +
                '<span class="rh-region-primary">' + escapeHtmlAttr(row.regionName) + '</span>' +
                (row.serverName ? '<span class="rh-region-server">' + escapeHtmlAttr(row.serverName) + '</span>' : '') +
            '</div>' +
            '<div class="rh-td rh-td--os">' + escapeHtmlAttr(row.serverOS) + '</div>' +
            '<div class="rh-td">' + escapeHtmlAttr(row.location) + '</div>' +
            '<div class="rh-td">' + escapeHtmlAttr(String(row.downCount)) + '</div>' +
            '<div class="rh-td">\u2014</div>' +
            '<div class="rh-td rh-td--num-blue">' + escapeHtmlAttr(String(row.activeSessions)) + '</div>' +
        '</div>';
    }).join('');

    listEl.innerHTML = headerHtml + rowsHtml;

    if (pgEl) {
        pgEl.style.display = 'flex';
        var labelEl  = document.getElementById('rh-pg-label');
        var totalEl  = document.getElementById('rh-pg-total');
        var firstBtn = document.getElementById('rh-pg-first');
        var prevBtn  = document.getElementById('rh-pg-prev');
        var nextBtn  = document.getElementById('rh-pg-next');
        var lastBtn  = document.getElementById('rh-pg-last');
        if (labelEl)  labelEl.textContent = page + ' of ' + totalPages;
        if (totalEl)  totalEl.textContent = 'Total count: ' + total;
        if (firstBtn) firstBtn.disabled   = page <= 1;
        if (prevBtn)  prevBtn.disabled    = page <= 1;
        if (nextBtn)  nextBtn.disabled    = page >= totalPages;
        if (lastBtn)  lastBtn.disabled    = page >= totalPages;
    }
}

/**
 * Wire pagination buttons for the Regions Health drawer (idempotent).
 */
function wireRhPagination() {
    var pgEl = document.getElementById('rh-pagination');
    if (!pgEl || pgEl.dataset.znWired) return;
    pgEl.dataset.znWired = '1';
    var firstBtn = document.getElementById('rh-pg-first');
    var prevBtn  = document.getElementById('rh-pg-prev');
    var nextBtn  = document.getElementById('rh-pg-next');
    var lastBtn  = document.getElementById('rh-pg-last');
    if (firstBtn) firstBtn.addEventListener('click', function() { renderRhTablePage(1); });
    if (prevBtn)  prevBtn.addEventListener( 'click', function() { renderRhTablePage(_rhCurrentPage - 1); });
    if (nextBtn)  nextBtn.addEventListener( 'click', function() { renderRhTablePage(_rhCurrentPage + 1); });
    if (lastBtn)  lastBtn.addEventListener( 'click', function() {
        renderRhTablePage(Math.ceil(_rhTableRows.length / _rhPageSize) || 1);
    });
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

var postureDrawerState = {
    sortKey:   'user',
    sortDir:   'asc',
    search:    '',
    page:      1,
    pageSize:  15
};

function openPostureDrawer() {
    znTrack('drawer_opened', { drawer: 'posture' });
    var bd = document.getElementById('posture-drawer-backdrop');
    if (!bd) return;
    // Reset state on open
    postureDrawerState.search = '';
    postureDrawerState.page   = 1;
    var searchEl = document.getElementById('posture-drawer-search');
    if (searchEl) searchEl.value = '';
    renderPostureDrawerContent();
    wirePostureDrawerInteractions();
    bd.classList.add('is-open');
}
function closePostureDrawer() {
    var bd = document.getElementById('posture-drawer-backdrop');
    if (bd) bd.classList.remove('is-open');
}

function renderPostureDrawerContent() {
    var allSessions    = lastData.activeSessions || [];
    var alwaysOnCnt    = 0;
    var afterBootCnt   = 0;
    var devicePostureCnt = 0;
    allSessions.forEach(function(s) {
        if (sessionAlwaysOnFromPolicy(s))        alwaysOnCnt++;
        if (sessionConnectAfterBootFromPolicy(s)) afterBootCnt++;
        if (sessionHasDevicePostureFromPolicy(s)) devicePostureCnt++;
    });

    // ── Stats bar ─────────────────────────────────────────────────────────
    var statsEl = document.getElementById('posture-drawer-stats');
    if (statsEl) {
        statsEl.innerHTML =
            '<span class="posture-stat-item">' +
                '<span class="posture-stat-dot"></span>' +
                '<strong class="posture-stat-num">' + allSessions.length + '</strong>' +
                '<span class="posture-stat-lbl">Active sessions</span>' +
            '</span>' +
            '<span class="posture-stat-sep"></span>' +
            '<span class="posture-stat-item">' +
                '<strong class="posture-stat-num">' + alwaysOnCnt + '</strong>' +
                '<span class="posture-stat-lbl">Always on</span>' +
            '</span>' +
            '<span class="posture-stat-sep"></span>' +
            '<span class="posture-stat-item">' +
                '<strong class="posture-stat-num">' + afterBootCnt + '</strong>' +
                '<span class="posture-stat-lbl">Connect after boot</span>' +
            '</span>' +
            '<span class="posture-stat-sep"></span>' +
            '<span class="posture-stat-item">' +
                '<strong class="posture-stat-num">' + devicePostureCnt + '</strong>' +
                '<span class="posture-stat-lbl">Device posture</span>' +
            '</span>';
    }

    // ── Filter & sort ─────────────────────────────────────────────────────
    var q = (postureDrawerState.search || '').toLowerCase().trim();
    var filtered = allSessions.filter(function(s) {
        if (!q) return true;
        var u = (userName(s) || '').toLowerCase();
        var os = (osMajorFamilyFromExactString(sessionAssetOperatingSystemExact(s)) || '').toLowerCase();
        return u.indexOf(q) !== -1 || os.indexOf(q) !== -1;
    });

    var sk = postureDrawerState.sortKey;
    var sd = postureDrawerState.sortDir;
    filtered.sort(function(a, b) {
        var av, bv;
        if (sk === 'user') {
            av = (userName(a) || '').toLowerCase();
            bv = (userName(b) || '').toLowerCase();
        } else if (sk === 'os') {
            av = (osMajorFamilyFromExactString(sessionAssetOperatingSystemExact(a)) || '').toLowerCase();
            bv = (osMajorFamilyFromExactString(sessionAssetOperatingSystemExact(b)) || '').toLowerCase();
        } else {
            av = bv = '';
        }
        if (av < bv) return sd === 'asc' ? -1 : 1;
        if (av > bv) return sd === 'asc' ? 1 : -1;
        return 0;
    });

    // ── Pagination ────────────────────────────────────────────────────────
    var ps    = postureDrawerState.pageSize;
    var total = filtered.length;
    var pages = Math.max(1, Math.ceil(total / ps));
    if (postureDrawerState.page > pages) postureDrawerState.page = pages;
    var pg    = postureDrawerState.page;
    var start = (pg - 1) * ps;
    var slice = filtered.slice(start, start + ps);

    var labelEl = document.getElementById('posture-pag-label');
    if (labelEl) labelEl.textContent = pg + ' of ' + pages;
    var totalEl = document.getElementById('posture-pag-total');
    if (totalEl) totalEl.textContent = 'Total count: ' + total;

    var firstBtn = document.getElementById('posture-pag-first');
    var prevBtn  = document.getElementById('posture-pag-prev');
    var nextBtn  = document.getElementById('posture-pag-next');
    var lastBtn  = document.getElementById('posture-pag-last');
    if (firstBtn) firstBtn.disabled = pg <= 1;
    if (prevBtn)  prevBtn.disabled  = pg <= 1;
    if (nextBtn)  nextBtn.disabled  = pg >= pages;
    if (lastBtn)  lastBtn.disabled  = pg >= pages;

    // ── Sort header indicator ─────────────────────────────────────────────
    var sortHeader = document.getElementById('posture-sort-user');
    if (sortHeader) {
        var arrow = sortHeader.querySelector('.posture-sort-arrow');
        if (arrow) {
            arrow.style.transform = sd === 'desc' ? 'rotate(180deg)' : '';
        }
    }

    // ── Table rows ────────────────────────────────────────────────────────
    var listEl = document.getElementById('posture-drawer-list');
    if (!listEl) return;

    if (!slice.length) {
        listEl.innerHTML = '<div class="ses-empty">' + buildEmptyState(
            q ? ZN_ICON_SEARCH : ZN_ICON_SHIELD,
            q ? 'No results for \u201c' + escapeHtmlAttr(q) + '\u201d' : 'No active sessions',
            q ? 'Try a different search term' : 'No users currently have posture flags'
        ) + '</div>';
        return;
    }

    var CHECK = '<svg width="14" height="11" viewBox="0 0 14 11" fill="none" aria-hidden="true"><path d="M1 5l4 4L13 1" stroke="#0CD89B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    listEl.innerHTML = slice.map(function(s) {
        var rawUser    = userName(s) || '';
        var user       = escapeHtmlAttr(rawUser || '\u2014');
        var os         = escapeHtmlAttr(osMajorFamilyFromExactString(sessionAssetOperatingSystemExact(s)));
        var alwaysOn   = sessionAlwaysOnFromPolicy(s);
        var afterBoot  = sessionConnectAfterBootFromPolicy(s);
        var hasPosture = sessionHasDevicePostureFromPolicy(s);
        return '<div class="posture-tbody-row cursor-pointer" data-user-name="' + escapeHtmlAttr(rawUser) + '">' +
            '<div class="posture-cell">' +
                '<span class="posture-user-dot"></span>' +
                '<span>' + user + '</span>' +
            '</div>' +
            '<div class="posture-cell posture-cell-os">' + os + '</div>' +
            '<div class="posture-cell posture-cell-flag">' + (alwaysOn   ? CHECK : '') + '</div>' +
            '<div class="posture-cell posture-cell-flag">' + (afterBoot  ? CHECK : '') + '</div>' +
            '<div class="posture-cell posture-cell-flag">' + (hasPosture ? CHECK : '') + '</div>' +
            '</div>';
    }).join('');
}

function wirePostureDrawerInteractions() {
    // Search
    var searchEl = document.getElementById('posture-drawer-search');
    if (searchEl && !searchEl._znPostureWired) {
        searchEl._znPostureWired = true;
        searchEl.addEventListener('input', function() {
            postureDrawerState.search = searchEl.value;
            postureDrawerState.page   = 1;
            renderPostureDrawerContent();
        });
    }

    // Sortable header
    var sortHeader = document.getElementById('posture-sort-user');
    if (sortHeader && !sortHeader._znPostureWired) {
        sortHeader._znPostureWired = true;
        sortHeader.addEventListener('click', function() {
            if (postureDrawerState.sortKey === 'user') {
                postureDrawerState.sortDir = postureDrawerState.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                postureDrawerState.sortKey = 'user';
                postureDrawerState.sortDir = 'asc';
            }
            postureDrawerState.page = 1;
            renderPostureDrawerContent();
        });
    }

    // Row clicks → apply user filter and close
    var postureListEl = document.getElementById('posture-drawer-list');
    if (postureListEl && !postureListEl._znPostureDrillWired) {
        postureListEl._znPostureDrillWired = true;
        postureListEl.addEventListener('click', function(e) {
            var row = e.target.closest('.posture-tbody-row[data-user-name]');
            if (!row || !postureListEl.contains(row)) return;
            var uname = row.getAttribute('data-user-name');
            if (!uname || !String(uname).trim()) return;
            closePostureDrawer();
            var globalInput = document.getElementById('global-user-input');
            if (globalInput) {
                globalInput.value = uname;
                var clearBtn = document.getElementById('clear-user-search');
                if (clearBtn) clearBtn.classList.remove('hidden');
            }
            applyGlobalUserFilter(uname);
        });
    }

    // Pagination
    function wirePagBtn(id, fn) {
        var btn = document.getElementById(id);
        if (btn && !btn._znPostureWired) {
            btn._znPostureWired = true;
            btn.addEventListener('click', fn);
        }
    }
    wirePagBtn('posture-pag-first', function() {
        postureDrawerState.page = 1;
        renderPostureDrawerContent();
    });
    wirePagBtn('posture-pag-prev', function() {
        if (postureDrawerState.page > 1) { postureDrawerState.page--; renderPostureDrawerContent(); }
    });
    wirePagBtn('posture-pag-next', function() {
        var sessions = lastData.activeSessions || [];
        var pages = Math.max(1, Math.ceil(sessions.length / postureDrawerState.pageSize));
        if (postureDrawerState.page < pages) { postureDrawerState.page++; renderPostureDrawerContent(); }
    });
    wirePagBtn('posture-pag-last', function() {
        var sessions = lastData.activeSessions || [];
        postureDrawerState.page = Math.max(1, Math.ceil(sessions.length / postureDrawerState.pageSize));
        renderPostureDrawerContent();
    });
}

// ── Connect Versions Drawer ────────────────────────────────────────────────

var CV_DRAWER_PAGE_SIZE = 25;

var connectVersionsDrawerState = {
    clickedVersion: '',
    filteredSessions: [],
    searchQuery: '',
    currentPage: 1
};

function openConnectVersionsDrawer(clickedVersion) {
    var bd = document.getElementById('connect-versions-drawer-backdrop');
    if (!bd) return;

    connectVersionsDrawerState.clickedVersion = clickedVersion || '';
    connectVersionsDrawerState.searchQuery = '';
    connectVersionsDrawerState.currentPage = 1;

    var searchInput = document.getElementById('cv-drawer-search');
    if (searchInput) searchInput.value = '';

    renderConnectVersionsDrawerContent();

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

    // ── Title ─────────────────────────────────────────────────────────────
    var titleEl = document.getElementById('cv-drawer-title');
    if (titleEl) {
        titleEl.textContent = 'Sessions with Connect version ' + (clickedVersion || '—');
    }

    // ── Filter sessions by version ────────────────────────────────────────
    var allSessions = lastData.activeSessions || [];
    var versionFilteredSessions = [];

    if (clickedVersion) {
        allSessions.forEach(function(session) {
            var ver = clientVer(session);
            if (!ver) return;
            ver = String(ver).trim().replace(/^v/i, '');
            if (ver === clickedVersion) versionFilteredSessions.push(session);
        });
    } else {
        versionFilteredSessions = allSessions.slice();
    }

    // ── Apply search ──────────────────────────────────────────────────────
    var filteredSessions = versionFilteredSessions;
    if (searchQuery) {
        filteredSessions = versionFilteredSessions.filter(function(session) {
            return sessionUserLabelForPosture(session).toLowerCase().includes(searchQuery);
        });
    }

    connectVersionsDrawerState.filteredSessions = filteredSessions;

    // ── Stats bar ─────────────────────────────────────────────────────────
    var statsBarEl = document.getElementById('cv-drawer-stats-bar');
    if (statsBarEl) {
        var totalUsers = filteredSessions.length;

        statsBarEl.innerHTML =
            '<div class="sdw-stat-seg">' +
                '<span class="sdw-stat-dot sdw-stat-dot--green"></span>' +
                '<span class="sdw-stat-num">' + totalUsers + '</span>' +
                '<span class="sdw-stat-label">active sessions</span>' +
            '</div>';
    }

    // ── Pagination ────────────────────────────────────────────────────────
    var totalCount = filteredSessions.length;
    var totalPages = Math.max(1, Math.ceil(totalCount / CV_DRAWER_PAGE_SIZE));
    var currentPage = Math.min(connectVersionsDrawerState.currentPage || 1, totalPages);
    connectVersionsDrawerState.currentPage = currentPage;
    var pageStart = (currentPage - 1) * CV_DRAWER_PAGE_SIZE;
    var pageSessions = filteredSessions.slice(pageStart, pageStart + CV_DRAWER_PAGE_SIZE);

    // ── Session table ─────────────────────────────────────────────────────
    var listEl = document.getElementById('cv-drawer-list');
    if (!listEl) return;

    if (!filteredSessions.length) {
        listEl.innerHTML = '<div class="ses-empty">' + buildEmptyState(ZN_ICON_LIST, 'No sessions for this version', 'No active sessions are running this client version') + '</div>';
        renderCvDrawerPagination(0, 1, 1);
        return;
    }

    listEl.innerHTML = pageSessions.map(function(session, i) {
        var globalIdx = pageStart + i;
        var st = sessionDisplayState(session);
        var dotCls = st === 'active' ? 'ses-status-dot--active' : 'ses-status-dot--offline';
        var user   = escapeHtmlAttr(sessionUserLabelForPosture(session) || '\u2014');
        var asset  = escapeHtmlAttr(assetName(session) || '\u2014');
        var os     = escapeHtmlAttr(osMajorFamilyFromExactString(sessionAssetOperatingSystemExact(session) || '') || sessionAssetOperatingSystemExact(session) || '\u2014');
        var ip       = session.currentPublicIp != null ? session.currentPublicIp : sessionPublicIp(session);
        var locIso   = sessionCountryIsoFromZero(session);
        var locLabel = (locIso ? znEnglishCountryLabelFromIso(locIso) : null) || resolveIpToCountry(ip) || '\u2014';
        var location = escapeHtmlAttr(locLabel);
        var region = escapeHtmlAttr((session.actualRegion && session.actualRegion.name) || '\u2014');

        return '<div class="ses-row ses-row--cv-drill cv-drawer-grid cursor-pointer" data-cv-ses-idx="' + globalIdx + '" data-user-name="' + user + '">' +
            '<div class="ses-row-user-cell">' +
                '<span class="ses-status-dot ' + dotCls + '"></span>' +
                '<span class="ses-row-user-name">' + user + '</span>' +
            '</div>' +
            '<div class="ses-row-cell">' + asset + '</div>' +
            '<div class="ses-row-cell">' + os + '</div>' +
            '<div class="ses-row-cell">' + location + '</div>' +
            '<div class="ses-row-cell">' + region + '</div>' +
            '</div>';
    }).join('');

    renderCvDrawerPagination(totalCount, currentPage, totalPages);

    // Trigger geo resolution for any IPs not yet in cache, then re-render
    var unresolvedIps = [];
    filteredSessions.forEach(function(s) {
        if (sessionCountryIsoFromZero(s)) return; // already has country from session data
        var ip = s.currentPublicIp != null ? s.currentPublicIp : sessionPublicIp(s);
        if (!ip || String(ip).trim() === '') return;
        var k = String(ip).trim();
        if (!Object.prototype.hasOwnProperty.call(geoLabelCache, k)) unresolvedIps.push(k);
    });
    if (unresolvedIps.length) {
        Promise.all(unresolvedIps.map(function(ip) { return znGeoEnsureLookupComplete(ip); }))
            .then(function() {
                var bd = document.getElementById('connect-versions-drawer-backdrop');
                if (bd && bd.classList.contains('is-open')) renderConnectVersionsDrawerContent();
            });
    }
}

function renderCvDrawerPagination(total, current, totalPages) {
    var label = document.getElementById('cv-pag-label');
    var totalEl = document.getElementById('cv-pag-total');
    var first = document.getElementById('cv-pag-first');
    var prev  = document.getElementById('cv-pag-prev');
    var next  = document.getElementById('cv-pag-next');
    var last  = document.getElementById('cv-pag-last');
    if (label) label.textContent = current + ' of ' + totalPages;
    if (totalEl) totalEl.textContent = 'Total count: ' + total;
    if (first) first.disabled = current <= 1;
    if (prev)  prev.disabled  = current <= 1;
    if (next)  next.disabled  = current >= totalPages;
    if (last)  last.disabled  = current >= totalPages;
}

function wireConnectVersionsDrawerInteractions() {
    // Search
    var searchInput = document.getElementById('cv-drawer-search');
    if (searchInput && !searchInput.dataset.znCvSearchWired) {
        searchInput.dataset.znCvSearchWired = '1';
        searchInput.addEventListener('input', function() {
            connectVersionsDrawerState.searchQuery = searchInput.value || '';
            connectVersionsDrawerState.currentPage = 1;
            renderConnectVersionsDrawerContent();
        });
    }

    // Row clicks
    var listEl = document.getElementById('cv-drawer-list');
    if (listEl && !listEl.dataset.znCvDrillWired) {
        listEl.dataset.znCvDrillWired = '1';
        listEl.addEventListener('click', function(e) {
            var row = e.target.closest('.ses-row--cv-drill[data-user-name]');
            if (!row || !listEl.contains(row)) return;
            var uname = row.getAttribute('data-user-name');
            if (!uname || !String(uname).trim()) return;
            closeConnectVersionsDrawer();
            var globalInput = document.getElementById('global-user-input');
            if (globalInput) {
                globalInput.value = uname;
                var clearBtn = document.getElementById('clear-user-search');
                if (clearBtn) clearBtn.classList.remove('hidden');
            }
            applyGlobalUserFilter(uname);
        });
    }

    // Pagination
    function wirePagBtn(id, fn) {
        var btn = document.getElementById(id);
        if (btn && !btn.dataset.znCvPagWired) {
            btn.dataset.znCvPagWired = '1';
            btn.addEventListener('click', fn);
        }
    }
    wirePagBtn('cv-pag-first', function() {
        connectVersionsDrawerState.currentPage = 1;
        renderConnectVersionsDrawerContent();
    });
    wirePagBtn('cv-pag-prev', function() {
        connectVersionsDrawerState.currentPage = Math.max(1, connectVersionsDrawerState.currentPage - 1);
        renderConnectVersionsDrawerContent();
    });
    wirePagBtn('cv-pag-next', function() {
        var total = connectVersionsDrawerState.filteredSessions.length;
        var totalPages = Math.max(1, Math.ceil(total / CV_DRAWER_PAGE_SIZE));
        connectVersionsDrawerState.currentPage = Math.min(totalPages, connectVersionsDrawerState.currentPage + 1);
        renderConnectVersionsDrawerContent();
    });
    wirePagBtn('cv-pag-last', function() {
        var total = connectVersionsDrawerState.filteredSessions.length;
        connectVersionsDrawerState.currentPage = Math.max(1, Math.ceil(total / CV_DRAWER_PAGE_SIZE));
        renderConnectVersionsDrawerContent();
    });
}

// ── OS Distribution Drawer ─────────────────────────────────────────────────

var OS_DRAWER_PAGE_SIZE = 25;

var osDrawerState = {
    clickedOsFamily: '',
    filteredSessions: [],
    searchQuery: '',
    currentPage: 1,
    sortDir: 'asc'   // 'asc' | 'desc' for Specific OS column
};

function openOsDrawer(clickedOsFamily) {
    var bd = document.getElementById('os-drawer-backdrop');
    if (!bd) return;

    osDrawerState.clickedOsFamily = clickedOsFamily || '';
    osDrawerState.searchQuery = '';
    osDrawerState.currentPage = 1;
    osDrawerState.sortDir = 'asc';

    var searchInput = document.getElementById('os-drawer-search');
    if (searchInput) searchInput.value = '';

    renderOsDrawerContent();

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
    var searchQuery = (osDrawerState.searchQuery || '').toLowerCase().trim();

    // ── Title ─────────────────────────────────────────────────────────────
    var titleEl = document.getElementById('os-drawer-title');
    if (titleEl) titleEl.textContent = 'Sessions with OS ' + (clickedOsFamily || 'All');

    // ── Build OS-family filtered list ─────────────────────────────────────
    var allSessions = lastData.activeSessions || [];
    var osFilteredSessions = clickedOsFamily
        ? allSessions.filter(function(s) {
            var exact = sessionAssetOperatingSystemExact(s);
            return exact && osMajorFamilyFromExactString(exact) === clickedOsFamily;
          })
        : allSessions.slice();

    // ── Apply search ──────────────────────────────────────────────────────
    var searched = searchQuery
        ? osFilteredSessions.filter(function(s) {
            return sessionUserLabelForPosture(s).toLowerCase().indexOf(searchQuery) !== -1;
          })
        : osFilteredSessions;

    // ── Stats ─────────────────────────────────────────────────────────────
    var totalUsers  = searched.length;
    var activeCnt   = 0;
    var offlineCnt  = 0;
    searched.forEach(function(s) {
        if (s.connectionState === 1) activeCnt++;
        else if (s.connectionState === 0) offlineCnt++;
    });

    var statsEl = document.getElementById('os-drawer-stats');
    if (statsEl) {
        statsEl.innerHTML =
            '<div class="sdw-stat-seg">' +
                '<span class="sdw-stat-dot sdw-stat-dot--green"></span>' +
                '<span class="sdw-stat-num">' + activeCnt + '</span>' +
                '<span class="sdw-stat-label">active sessions</span>' +
            '</div>';
    }

    // ── Sort by Specific OS ───────────────────────────────────────────────
    var sortDir = osDrawerState.sortDir;
    var sorted = searched.slice().sort(function(a, b) {
        var osA = (sessionAssetOperatingSystemExact(a) || '').toLowerCase();
        var osB = (sessionAssetOperatingSystemExact(b) || '').toLowerCase();
        if (osA < osB) return sortDir === 'asc' ? -1 : 1;
        if (osA > osB) return sortDir === 'asc' ? 1 : -1;
        return 0;
    });

    // Update sort arrow visual
    var arrowEl = document.querySelector('#os-sort-specific-os .os-sort-arrow');
    if (arrowEl) {
        arrowEl.style.transform = sortDir === 'desc' ? 'rotate(180deg)' : '';
        arrowEl.style.opacity = '1';
    }

    osDrawerState.filteredSessions = sorted;

    // ── Pagination ────────────────────────────────────────────────────────
    var totalCount = sorted.length;
    var totalPages = Math.max(1, Math.ceil(totalCount / OS_DRAWER_PAGE_SIZE));
    var currentPage = Math.min(osDrawerState.currentPage || 1, totalPages);
    osDrawerState.currentPage = currentPage;
    var pageStart = (currentPage - 1) * OS_DRAWER_PAGE_SIZE;
    var pageRows  = sorted.slice(pageStart, pageStart + OS_DRAWER_PAGE_SIZE);

    // ── Table rows ────────────────────────────────────────────────────────
    var listEl = document.getElementById('os-drawer-list');
    if (!listEl) return;

    if (!sorted.length) {
        listEl.innerHTML = '<div class="ses-empty">' + buildEmptyState(
            searchQuery ? ZN_ICON_SEARCH : ZN_ICON_USERS,
            searchQuery ? 'No results for \u201c' + escapeHtmlAttr(searchQuery) + '\u201d' : 'No sessions found',
            searchQuery ? 'Try a different search term' : 'No active sessions for this OS'
        ) + '</div>';
        renderOsPagination(0, 1, 1);
        return;
    }

    listEl.innerHTML = pageRows.map(function(session) {
        var userName    = sessionUserLabelForPosture(session);
        var specificOs  = sessionAssetOperatingSystemExact(session) || '\u2014';
        var connectVer  = clientVer(session);
        var verDisplay  = connectVer ? 'v' + String(connectVer).trim().replace(/^v/i, '') : '\u2014';
        var isActive    = session.connectionState === 1;
        var dotCls      = isActive ? 'ses-status-dot--active' : 'ses-status-dot--offline';

        return '<div class="ses-row ses-row--os-drill cursor-pointer" data-user-name="' + escapeHtmlAttr(userName) + '">' +
            '<div class="ses-row-user-cell">' +
                '<span class="ses-status-dot ' + dotCls + '"></span>' +
                '<span class="ses-row-user-name">' + escapeHtmlAttr(userName) + '</span>' +
            '</div>' +
            '<div class="ses-row-cell">' + escapeHtmlAttr(specificOs) + '</div>' +
            '<div class="ses-row-cell">' + escapeHtmlAttr(verDisplay)  + '</div>' +
        '</div>';
    }).join('');

    renderOsPagination(totalCount, currentPage, totalPages);
}

function renderOsPagination(totalCount, currentPage, totalPages) {
    var labelEl  = document.getElementById('os-pg-label');
    var totalEl  = document.getElementById('os-pg-total');
    var firstBtn = document.getElementById('os-pg-first');
    var prevBtn  = document.getElementById('os-pg-prev');
    var nextBtn  = document.getElementById('os-pg-next');
    var lastBtn  = document.getElementById('os-pg-last');
    if (labelEl) labelEl.textContent  = currentPage + ' of ' + totalPages;
    if (totalEl) totalEl.textContent  = 'Total count: ' + totalCount;
    var atFirst = currentPage <= 1;
    var atLast  = currentPage >= totalPages;
    if (firstBtn) firstBtn.disabled = atFirst;
    if (prevBtn)  prevBtn.disabled  = atFirst;
    if (nextBtn)  nextBtn.disabled  = atLast;
    if (lastBtn)  lastBtn.disabled  = atLast;
}

function wireOsDrawerInteractions() {
    // Search
    var searchInput = document.getElementById('os-drawer-search');
    if (searchInput && !searchInput.dataset.znOsSearchWired) {
        searchInput.dataset.znOsSearchWired = '1';
        searchInput.addEventListener('input', function() {
            osDrawerState.searchQuery = searchInput.value || '';
            osDrawerState.currentPage = 1;
            renderOsDrawerContent();
        });
    }

    // Sort: Specific OS column header
    var sortBtn = document.getElementById('os-sort-specific-os');
    if (sortBtn && !sortBtn.dataset.znOsSortWired) {
        sortBtn.dataset.znOsSortWired = '1';
        sortBtn.style.cursor = 'pointer';
        sortBtn.addEventListener('click', function() {
            osDrawerState.sortDir = osDrawerState.sortDir === 'asc' ? 'desc' : 'asc';
            osDrawerState.currentPage = 1;
            renderOsDrawerContent();
        });
    }

    // Row drill-down: click user name → set global filter
    var listEl = document.getElementById('os-drawer-list');
    if (listEl && !listEl.dataset.znOsDrillWired) {
        listEl.dataset.znOsDrillWired = '1';
        listEl.addEventListener('click', function(e) {
            var row = e.target.closest('.ses-row--os-drill[data-user-name]');
            if (!row || !listEl.contains(row)) return;
            var userName = row.getAttribute('data-user-name');
            if (!userName || !String(userName).trim()) return;
            closeOsDrawer();
            var globalInput = document.getElementById('global-user-input');
            if (globalInput) {
                globalInput.value = userName;
                var clearBtn = document.getElementById('clear-user-search');
                if (clearBtn) clearBtn.classList.remove('hidden');
            }
            applyGlobalUserFilter(userName);
        });
    }

    // Pagination buttons
    function wirePagBtn(id, fn) {
        var btn = document.getElementById(id);
        if (btn && !btn.dataset.znOsPagWired) {
            btn.dataset.znOsPagWired = '1';
            btn.addEventListener('click', fn);
        }
    }
    wirePagBtn('os-pg-first', function() {
        osDrawerState.currentPage = 1;
        renderOsDrawerContent();
    });
    wirePagBtn('os-pg-prev', function() {
        osDrawerState.currentPage = Math.max(1, (osDrawerState.currentPage || 1) - 1);
        renderOsDrawerContent();
    });
    wirePagBtn('os-pg-next', function() {
        var total      = osDrawerState.filteredSessions.length;
        var totalPages = Math.max(1, Math.ceil(total / OS_DRAWER_PAGE_SIZE));
        osDrawerState.currentPage = Math.min(totalPages, (osDrawerState.currentPage || 1) + 1);
        renderOsDrawerContent();
    });
    wirePagBtn('os-pg-last', function() {
        var total = osDrawerState.filteredSessions.length;
        osDrawerState.currentPage = Math.max(1, Math.ceil(total / OS_DRAWER_PAGE_SIZE));
        renderOsDrawerContent();
    });
}

// ── Policy Operations Drawer ───────────────────────────────────────────────

var policyDrawerState = {
    events:       [],
    totalCount:   0,
    dayLabel:     '',
    searchQuery:  '',
    currentPage:  1,
    filteredRows: []
};

var PO_DRAWER_PAGE_SIZE = 50;

function openPolicyDrawer(dayLabel, eventsArray) {
    var bd = document.getElementById('policy-drawer-backdrop');
    if (!bd) return;
    policyDrawerState.events      = eventsArray || [];
    policyDrawerState.totalCount  = eventsArray ? eventsArray.length : 0;
    policyDrawerState.dayLabel    = dayLabel || '';
    policyDrawerState.searchQuery = '';
    policyDrawerState.currentPage = 1;
    var searchEl = document.getElementById('policy-drawer-search');
    if (searchEl) searchEl.value = '';
    var titleEl = document.getElementById('policy-drawer-title');
    if (titleEl) setDrawerTitle(titleEl, 'Policy Operations', dayLabel);
    renderPolicyDrawerContent();
    bd.classList.add('is-open');
}

function closePolicyDrawer() {
    var bd = document.getElementById('policy-drawer-backdrop');
    if (bd) bd.classList.remove('is-open');
}

function renderPolicyDrawerContent() {
    var events   = policyDrawerState.events;
    var dayLabel = policyDrawerState.dayLabel || '';
    var query    = (policyDrawerState.searchQuery || '').toLowerCase().trim();

    var created = 0, updated = 0, deleted = 0;
    events.forEach(function(ev) {
        var t = auditTypeToNum(ev);
        if (t === 100) created++;
        else if (t === 101) updated++;
        else if (t === 102) deleted++;
    });

    var statsEl = document.getElementById('policy-drawer-stats');
    if (statsEl) {
        statsEl.innerHTML =
            '<div class="sdw-stat-seg">' +
                '<span class="sdw-stat-num sdw-stat-num--green">' + created + '</span>' +
                '<span class="sdw-stat-label">Created</span>' +
            '</div>' +
            '<div class="sdw-stat-seg">' +
                '<span class="sdw-stat-num">' + updated + '</span>' +
                '<span class="sdw-stat-label">Edited</span>' +
            '</div>' +
            '<div class="sdw-stat-seg">' +
                '<span class="sdw-stat-num sdw-stat-num--red">' + deleted + '</span>' +
                '<span class="sdw-stat-label">Deleted</span>' +
            '</div>';
    }

    // Build flat rows
    var allRows = events.map(function(ev) {
        var t       = auditTypeToNum(ev);
        var ts      = getAuditItemTs(ev);
        var admin   = (ev.performedBy && ev.performedBy.name) ? String(ev.performedBy.name) : '\u2014';
        var details = parseAuditDetails(ev);
        var policy  = extractPolicyName(details) || '\u2014';
        var summary = buildPolicyChangeSummary(ev, details, t);
        return { ts: ts, admin: admin, type: t, policy: policy, summary: summary };
    });

    var filtered = query
        ? allRows.filter(function(r) {
            return (r.admin  || '').toLowerCase().indexOf(query) !== -1 ||
                   (r.policy || '').toLowerCase().indexOf(query) !== -1 ||
                   getPolicyActionLabel(r.type).toLowerCase().indexOf(query) !== -1;
          })
        : allRows;
    policyDrawerState.filteredRows = filtered;

    var totalCount = filtered.length;
    var totalPages = Math.max(1, Math.ceil(totalCount / PO_DRAWER_PAGE_SIZE));
    var currentPage = Math.min(policyDrawerState.currentPage || 1, totalPages);
    policyDrawerState.currentPage = currentPage;
    var pageRows  = filtered.slice((currentPage - 1) * PO_DRAWER_PAGE_SIZE, currentPage * PO_DRAWER_PAGE_SIZE);

    var listEl = document.getElementById('policy-drawer-list');
    if (!listEl) return;
    if (!filtered.length) {
        listEl.innerHTML = '<div class="ses-empty">' + buildEmptyState(
            query ? ZN_ICON_SEARCH : ZN_ICON_LIST,
            query ? 'No results for \u201c' + escapeHtmlAttr(query) + '\u201d' : 'No policy events',
            query ? 'Try a different search term' : 'No policy events were recorded for this day'
        ) + '</div>';
        renderPoPagination(0, 1, 1);
        return;
    }
    listEl.innerHTML = pageRows.map(function(r) {
        var timeStr = r.ts ? new Date(r.ts).toLocaleString() : '\u2014';
        return '<div class="ses-row ses-row--po-drill">' +
            '<div class="ses-row-cell ses-row-cell--date">' + escapeHtmlAttr(timeStr) + '</div>' +
            '<div class="ses-row-cell">' + escapeHtmlAttr(r.admin) + '</div>' +
            '<div class="ses-row-cell">' + getPolicyActionBadge(r.type) + '</div>' +
            '<div class="ses-row-cell">' + escapeHtmlAttr(r.policy) + '</div>' +
            '<div class="ses-row-cell ses-row-cell--summary">' + escapeHtmlAttr(r.summary) + '</div>' +
        '</div>';
    }).join('');
    renderPoPagination(totalCount, currentPage, totalPages);
}

function getPolicyActionLabel(auditType) {
    if (auditType === 100) return 'Created';
    if (auditType === 101) return 'Edited';
    if (auditType === 102) return 'Deleted';
    return 'Unknown';
}

function buildPolicyChangeSummary(event, details, auditType) {
    if (!details || !details._d) return '\u2014';
    var role    = details._d.Role    || null;
    var prev    = details._d.PrevRole || null;

    if (auditType === 101 && role && prev) {
        var parts = [];
        var uChg = compareArrays(prev.allowedUsers || [], role.allowedUsers || [], function(u) { return u.name || u.id || ''; });
        if (uChg.added.length)   parts.push('+' + uChg.added.length + ' user' + (uChg.added.length > 1 ? 's' : ''));
        if (uChg.removed.length) parts.push('-' + uChg.removed.length + ' user' + (uChg.removed.length > 1 ? 's' : ''));
        var dChg = compareArrays(prev.allowedDestinations || [], role.allowedDestinations || [], function(d) { return d.name || d.address || ''; });
        if (dChg.added.length)   parts.push('+' + dChg.added.length + ' dest');
        if (dChg.removed.length) parts.push('-' + dChg.removed.length + ' dest');
        if (prev.alwaysOn !== role.alwaysOn) parts.push('AlwaysOn: ' + (prev.alwaysOn ? 'Yes' : 'No') + '\u2192' + (role.alwaysOn ? 'Yes' : 'No'));
        if (prev.connectAfterBoot !== role.connectAfterBoot) parts.push('CAB: ' + (prev.connectAfterBoot ? 'Yes' : 'No') + '\u2192' + (role.connectAfterBoot ? 'Yes' : 'No'));
        return parts.length ? parts.join(' \u00b7 ') : 'No changes detected';
    }
    if ((auditType === 100 || auditType === 102) && role) {
        var info = [];
        if (role.allowedUsers && role.allowedUsers.length)        info.push(role.allowedUsers.length + ' user' + (role.allowedUsers.length > 1 ? 's' : ''));
        if (role.allowedDestinations && role.allowedDestinations.length) info.push(role.allowedDestinations.length + ' dest');
        if (role.alwaysOn !== undefined) info.push('AlwaysOn: ' + (role.alwaysOn ? 'Yes' : 'No'));
        return info.length ? info.join(' \u00b7 ') : '\u2014';
    }
    return '\u2014';
}

function renderPoPagination(totalCount, currentPage, totalPages) {
    var lbl = document.getElementById('po-pag-label');
    var tot = document.getElementById('po-pag-total');
    var f   = document.getElementById('po-pag-first');
    var p   = document.getElementById('po-pag-prev');
    var n   = document.getElementById('po-pag-next');
    var l   = document.getElementById('po-pag-last');
    if (lbl) lbl.textContent = currentPage + ' of ' + totalPages;
    if (tot) tot.textContent = 'Total count: ' + totalCount;
    var atFirst = currentPage <= 1, atLast = currentPage >= totalPages;
    if (f) f.disabled = atFirst; if (p) p.disabled = atFirst;
    if (n) n.disabled = atLast;  if (l) l.disabled = atLast;
}

function renderPolicyEventCard(event, index) {
    var auditType = policyOpTypeId(event);
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

// ── Posture Audit Drawer ───────────────────────────────────────────────────

var postureAuditDrawerState = { events: [], dayLabel: '', searchQuery: '', currentPage: 1, filteredRows: [] };

// ── Session Creation — Unique Users Drawer ─────────────────────────────

var SC_DRAWER_PAGE_SIZE = 10;
var scDrawerState = {
    dayLabel: '',
    allRows: [],
    filteredRows: [],
    currentPage: 1,
    searchQuery: ''
};

function openSessionCreationDrawer(dayLabel, insights) {
    var bd = document.getElementById('sc-drawer-backdrop');
    if (!bd) return;
    scDrawerState.dayLabel    = dayLabel || '';
    scDrawerState.allRows     = (insights && Array.isArray(insights.userList)) ? insights.userList.slice() : [];
    scDrawerState.currentPage = 1;
    scDrawerState.searchQuery = '';
    scDrawerState._insights   = insights || {};

    var searchEl = document.getElementById('sc-drawer-search');
    if (searchEl) searchEl.value = '';

    var titleEl = document.getElementById('sc-drawer-title');
    if (titleEl) setDrawerTitle(titleEl, 'Session creation', dayLabel);

    renderSessionCreationDrawer();
    bd.classList.add('is-open');
}

function closeSessionCreationDrawer() {
    var bd = document.getElementById('sc-drawer-backdrop');
    if (bd) bd.classList.remove('is-open');
}

/* ─── Audit Activity — Used Policies Drawer ──────────────────────────────── */
var AP_DRAWER_PAGE_SIZE = 10;
var apDrawerState = {
    dayLabel:    '',
    sortDir:     'desc',
    allRows:     [],
    filteredRows:[],
    currentPage: 1,
    searchQuery: ''
};

function openAuditPoliciesDrawer(dayLabel, insights) {
    var bd = document.getElementById('audit-policies-drawer-backdrop');
    if (!bd) return;

    var policyBreakdown = (insights && insights.policyBreakdown && typeof insights.policyBreakdown === 'object')
        ? insights.policyBreakdown : {};
    var rows = Object.keys(policyBreakdown).map(function(name) {
        return { name: name, hits: policyBreakdown[name] || 0 };
    });

    apDrawerState.dayLabel    = dayLabel || '';
    apDrawerState.allRows     = rows;
    apDrawerState.currentPage = 1;
    apDrawerState.searchQuery = '';
    apDrawerState.sortDir     = 'desc';

    var searchEl = document.getElementById('ap-drawer-search');
    if (searchEl) searchEl.value = '';

    var titleEl = document.getElementById('ap-drawer-title');
    if (titleEl) setDrawerTitle(titleEl, 'Session creation \u2013 used policies', dayLabel);

    renderAuditPoliciesDrawer();
    bd.classList.add('is-open');
}

function closeAuditPoliciesDrawer() {
    var bd = document.getElementById('audit-policies-drawer-backdrop');
    if (bd) bd.classList.remove('is-open');
}

function renderAuditPoliciesDrawer() {
    var allRows = apDrawerState.allRows || [];
    var query   = (apDrawerState.searchQuery || '').toLowerCase().trim();
    var sortDir = apDrawerState.sortDir || 'desc';

    // Stats bar
    var statsEl = document.getElementById('ap-drawer-stats');
    if (statsEl) {
        var totalPolicies = allRows.length;
        var totalHits = allRows.reduce(function(s, r) { return s + (r.hits || 0); }, 0);
        statsEl.innerHTML =
            '<div class="sdw-stat-seg">' +
                '<span class="sdw-stat-num">' + totalPolicies + '</span>' +
                '<span class="sdw-stat-label">used policies</span>' +
            '</div>' +
            '<div class="sdw-stat-seg">' +
                '<span class="sdw-stat-num">' + totalHits + '</span>' +
                '<span class="sdw-stat-label">hits</span>' +
            '</div>';
    }

    // Filter by search
    var filtered = query
        ? allRows.filter(function(r) { return (r.name || '').toLowerCase().indexOf(query) !== -1; })
        : allRows.slice();

    // Sort by hits
    filtered.sort(function(a, b) {
        return sortDir === 'asc' ? (a.hits - b.hits) : (b.hits - a.hits);
    });
    apDrawerState.filteredRows = filtered;

    // Pagination
    var totalCount = filtered.length;
    var totalPages = Math.max(1, Math.ceil(totalCount / AP_DRAWER_PAGE_SIZE));
    var currentPage = Math.min(apDrawerState.currentPage || 1, totalPages);
    apDrawerState.currentPage = currentPage;
    var pageStart = (currentPage - 1) * AP_DRAWER_PAGE_SIZE;
    var pageRows  = filtered.slice(pageStart, pageStart + AP_DRAWER_PAGE_SIZE);

    // Render rows
    var listEl = document.getElementById('ap-drawer-list');
    if (!listEl) return;
    if (!pageRows.length) {
        listEl.innerHTML = '<div class="ses-empty">' + buildEmptyState(
            query ? ZN_ICON_SEARCH : ZN_ICON_LIST,
            query ? 'No results for \u201c' + escapeHtmlAttr(query) + '\u201d' : 'No policies found',
            query ? 'Try a different search term' : 'No policies were active on this day'
        ) + '</div>';
        renderApPagination(0, 1, 1);
        return;
    }
    listEl.innerHTML = pageRows.map(function(r) {
        return '<div class="ses-row ses-row--ap-drill">' +
            '<div class="ap-policy-name">' + escapeHtmlAttr(r.name || '\u2014') + '</div>' +
            '<div class="ap-hits-count">' + (r.hits != null ? r.hits : '\u2014') + '</div>' +
        '</div>';
    }).join('');
    renderApPagination(totalCount, currentPage, totalPages);
}

function renderApPagination(totalCount, currentPage, totalPages) {
    var labelEl  = document.getElementById('ap-pg-label');
    var totalEl  = document.getElementById('ap-pg-total');
    var firstBtn = document.getElementById('ap-pg-first');
    var prevBtn  = document.getElementById('ap-pg-prev');
    var nextBtn  = document.getElementById('ap-pg-next');
    var lastBtn  = document.getElementById('ap-pg-last');
    if (labelEl) labelEl.textContent = currentPage + ' of ' + totalPages;
    if (totalEl) totalEl.textContent = 'Total count: ' + totalCount;
    var atFirst = currentPage <= 1;
    var atLast  = currentPage >= totalPages;
    if (firstBtn) firstBtn.disabled = atFirst;
    if (prevBtn)  prevBtn.disabled  = atFirst;
    if (nextBtn)  nextBtn.disabled  = atLast;
    if (lastBtn)  lastBtn.disabled  = atLast;
}

function renderSessionCreationDrawer() {
    var ins      = scDrawerState._insights || {};
    var allRows  = scDrawerState.allRows || [];
    var query    = (scDrawerState.searchQuery || '').toLowerCase().trim();

    // Stats bar
    var statsEl = document.getElementById('sc-drawer-stats');
    if (statsEl) {
        var uniqueRegs   = ins.uniqueRegionsCount != null ? ins.uniqueRegionsCount : 0;
        var totalSess    = ins.totalEvents != null ? ins.totalEvents : 0;
        var usedPolicies = ins.policyBreakdown ? Object.keys(ins.policyBreakdown).length : 0;
        statsEl.innerHTML =
            '<div class="sdw-stat-seg">' +
                '<span class="sdw-stat-num">' + totalSess + '</span>' +
                '<span class="sdw-stat-label">Active sessions</span>' +
            '</div>' +
            '<div class="sdw-stat-seg">' +
                '<span class="sdw-stat-num">' + uniqueRegs + '</span>' +
                '<span class="sdw-stat-label">Regions</span>' +
            '</div>' +
            '<div class="sdw-stat-seg">' +
                '<span class="sdw-stat-num">' + usedPolicies + '</span>' +
                '<span class="sdw-stat-label">Used policies</span>' +
            '</div>';
    }

    // Filter rows by search
    var filtered = query
        ? allRows.filter(function(r) {
            var u = (r.name     || '').toLowerCase();
            var a = (r.asset    || '').toLowerCase();
            var l = (r.location || '').toLowerCase();
            var g = (r.region   || '').toLowerCase();
            var p = (r.policy   || '').toLowerCase();
            return u.indexOf(query) !== -1 || a.indexOf(query) !== -1 ||
                   l.indexOf(query) !== -1 || g.indexOf(query) !== -1 || p.indexOf(query) !== -1;
          })
        : allRows;
    scDrawerState.filteredRows = filtered;

    // Pagination
    var totalCount = filtered.length;
    var totalPages = Math.max(1, Math.ceil(totalCount / SC_DRAWER_PAGE_SIZE));
    var currentPage = Math.min(scDrawerState.currentPage || 1, totalPages);
    scDrawerState.currentPage = currentPage;
    var pageStart = (currentPage - 1) * SC_DRAWER_PAGE_SIZE;
    var pageRows  = filtered.slice(pageStart, pageStart + SC_DRAWER_PAGE_SIZE);

    // Render rows
    var listEl = document.getElementById('sc-drawer-list');
    if (!listEl) return;
    if (!filtered.length) {
        listEl.innerHTML = '<div class="ses-empty">' + buildEmptyState(
            query ? ZN_ICON_SEARCH : ZN_ICON_USERS,
            query ? 'No results for \u201c' + escapeHtmlAttr(query) + '\u201d' : 'No users found',
            query ? 'Try a different search term' : 'No session creation events for this day'
        ) + '</div>';
        renderScPagination(0, 1, 1);
        return;
    }
    listEl.innerHTML = pageRows.map(function(r) {
        var user    = escapeHtmlAttr(r.name     || '\u2014');
        var device  = escapeHtmlAttr(r.asset    || '\u2014');
        var country = escapeHtmlAttr(r.location || '\u2014');
        var region  = escapeHtmlAttr(r.region   || '\u2014');
        var policy  = escapeHtmlAttr(r.policy   || '\u2014');
        return '<div class="ses-row ses-row--sc-drill cursor-pointer" data-user-name="' + escapeHtmlAttr(r.name || '') + '">' +
            '<div class="ses-row-user-cell"><span class="ses-row-user-name">' + user + '</span></div>' +
            '<div class="ses-row-cell">' + device  + '</div>' +
            '<div class="ses-row-cell">' + country + '</div>' +
            '<div class="ses-row-cell">' + region  + '</div>' +
            '<div class="ses-row-cell">' + policy  + '</div>' +
        '</div>';
    }).join('');
    renderScPagination(totalCount, currentPage, totalPages);
}

function renderScPagination(totalCount, currentPage, totalPages) {
    var labelEl = document.getElementById('sc-pg-label');
    var totalEl = document.getElementById('sc-pg-total');
    var firstBtn = document.getElementById('sc-pg-first');
    var prevBtn  = document.getElementById('sc-pg-prev');
    var nextBtn  = document.getElementById('sc-pg-next');
    var lastBtn  = document.getElementById('sc-pg-last');
    if (labelEl) labelEl.textContent = currentPage + ' of ' + totalPages;
    if (totalEl) totalEl.textContent = 'Total count: ' + totalCount;
    var atFirst = currentPage <= 1;
    var atLast  = currentPage >= totalPages;
    if (firstBtn) firstBtn.disabled = atFirst;
    if (prevBtn)  prevBtn.disabled  = atFirst;
    if (nextBtn)  nextBtn.disabled  = atLast;
    if (lastBtn)  lastBtn.disabled  = atLast;
}

var PA_DRAWER_PAGE_SIZE = 50;

function openPostureAuditDrawer(dayLabel, eventsArray) {
    var bd = document.getElementById('posture-audit-drawer-backdrop');
    if (!bd) return;
    postureAuditDrawerState.events      = eventsArray || [];
    postureAuditDrawerState.dayLabel    = dayLabel || '';
    postureAuditDrawerState.searchQuery = '';
    postureAuditDrawerState.currentPage = 1;
    var searchEl = document.getElementById('posture-audit-drawer-search');
    if (searchEl) searchEl.value = '';
    var titleEl = document.getElementById('posture-audit-drawer-title');
    if (titleEl) setDrawerTitle(titleEl, 'Posture Audits', dayLabel);
    renderPostureAuditDrawerContent();
    bd.classList.add('is-open');
}

function closePostureAuditDrawer() {
    var bd = document.getElementById('posture-audit-drawer-backdrop');
    if (bd) bd.classList.remove('is-open');
}

function renderPostureAuditDrawerContent() {
    var events   = postureAuditDrawerState.events;
    var dayLabel = postureAuditDrawerState.dayLabel;
    var query    = (postureAuditDrawerState.searchQuery || '').toLowerCase().trim();

    var found = 0, resolved = 0, adminCh = 0;
    events.forEach(function(ev) {
        var t = auditTypeToNum(ev);
        if (AUDIT_TYPES_POSTURE_VIOLATIONS[t])    found++;
        else if (AUDIT_TYPES_POSTURE_RESOLVED[t]) resolved++;
        else if (AUDIT_TYPES_POSTURE_ADMIN[t])    adminCh++;
    });

    var statsEl = document.getElementById('posture-audit-drawer-stats');
    if (statsEl) {
        statsEl.innerHTML =
            '<div class="sdw-stat-seg">' +
                '<span class="sdw-stat-num sdw-stat-num--amber">' + found + '</span>' +
                '<span class="sdw-stat-label">Violations</span>' +
            '</div>' +
            '<div class="sdw-stat-seg">' +
                '<span class="sdw-stat-num sdw-stat-num--green">' + resolved + '</span>' +
                '<span class="sdw-stat-label">Resolved</span>' +
            '</div>' +
            '<div class="sdw-stat-seg">' +
                '<span class="sdw-stat-num">' + adminCh + '</span>' +
                '<span class="sdw-stat-label">Policy Configuration</span>' +
            '</div>';
    }

    var allRows = events.map(function(ev) {
        var t    = auditTypeToNum(ev);
        var ts   = getAuditItemTs(ev);
        var dest = ev.destinationEntitiesList;
        var user = (Array.isArray(dest) && dest.length > 0 && dest[0].name)
            ? String(dest[0].name)
            : ((ev.performedBy && ev.performedBy.name) ? String(ev.performedBy.name) : '\u2014');
        var isAdmin = !!AUDIT_TYPES_POSTURE_ADMIN[t];
        var admin  = (isAdmin && ev.performedBy && ev.performedBy.name) ? String(ev.performedBy.name) : null;
        var d      = parseAuditDetails(ev);
        var device = (d && (d.sourceAsset || d.deviceName || d.asset || d.fqdn || d.hostname || d.assetName)) ? String(d.sourceAsset || d.deviceName || d.asset || d.fqdn || d.hostname || d.assetName) : '\u2014';
        var checks = (d && Array.isArray(d.postureCheckTypes) && d.postureCheckTypes.length > 0)
            ? d.postureCheckTypes.map(postureCheckTypeLabel)
            : [];
        var profile = (d && (d.profileName || d.name || d.displayName)) ? String(d.profileName || d.name || d.displayName) : '\u2014';
        return { ts: ts, user: user, admin: admin, device: device, type: t, checks: checks, profile: profile };
    });

    var filtered = query
        ? allRows.filter(function(r) {
            var checkStr = r.checks.join(' ').toLowerCase();
            return (r.user    || '').toLowerCase().indexOf(query) !== -1 ||
                   (r.device  || '').toLowerCase().indexOf(query) !== -1 ||
                   (r.profile || '').toLowerCase().indexOf(query) !== -1 ||
                   checkStr.indexOf(query) !== -1;
          })
        : allRows;
    postureAuditDrawerState.filteredRows = filtered;

    var totalCount = filtered.length;
    var totalPages = Math.max(1, Math.ceil(totalCount / PA_DRAWER_PAGE_SIZE));
    var currentPage = Math.min(postureAuditDrawerState.currentPage || 1, totalPages);
    postureAuditDrawerState.currentPage = currentPage;
    var pageRows = filtered.slice((currentPage - 1) * PA_DRAWER_PAGE_SIZE, currentPage * PA_DRAWER_PAGE_SIZE);

    var listEl = document.getElementById('posture-audit-drawer-list');
    if (!listEl) return;
    if (!filtered.length) {
        listEl.innerHTML = '<div class="ses-empty">' + buildEmptyState(
            query ? ZN_ICON_SEARCH : ZN_ICON_SHIELD,
            query ? 'No results for \u201c' + escapeHtmlAttr(query) + '\u201d' : 'No posture events',
            query ? 'Try a different search term' : 'No posture events were recorded for this day'
        ) + '</div>';
        renderPaPagination(0, 1, 1);
        return;
    }
    listEl.innerHTML = pageRows.map(function(r) {
        var timeStr = r.ts ? new Date(r.ts).toLocaleString() : '\u2014';
        var userHtml = escapeHtmlAttr(r.user) +
            (r.admin ? '<span class="ses-row-sub-label">by ' + escapeHtmlAttr(r.admin) + '</span>' : '');
        var chipsHtml = r.checks.length
            ? r.checks.map(function(c) { return '<span class="posture-check-chip">' + escapeHtmlAttr(c) + '</span>'; }).join('')
            : '\u2014';
        return '<div class="ses-row ses-row--pa-drill">' +
            '<div class="ses-row-cell ses-row-cell--date">' + escapeHtmlAttr(timeStr) + '</div>' +
            '<div class="ses-row-cell"><span class="ses-row-user-name">' + userHtml + '</span></div>' +
            '<div class="ses-row-cell">' + escapeHtmlAttr(r.device) + '</div>' +
            '<div class="ses-row-cell">' + postureAuditEventBadge(r.type) + '</div>' +
            '<div class="ses-row-cell">' + chipsHtml + '</div>' +
            '<div class="ses-row-cell">' + escapeHtmlAttr(r.profile) + '</div>' +
        '</div>';
    }).join('');
    renderPaPagination(totalCount, currentPage, totalPages);
}

function renderPaPagination(totalCount, currentPage, totalPages) {
    var lbl = document.getElementById('pa-pag-label');
    var tot = document.getElementById('pa-pag-total');
    var f   = document.getElementById('pa-pag-first');
    var p   = document.getElementById('pa-pag-prev');
    var n   = document.getElementById('pa-pag-next');
    var l   = document.getElementById('pa-pag-last');
    if (lbl) lbl.textContent = currentPage + ' of ' + totalPages;
    if (tot) tot.textContent = 'Total count: ' + totalCount;
    var atFirst = currentPage <= 1, atLast = currentPage >= totalPages;
    if (f) f.disabled = atFirst; if (p) p.disabled = atFirst;
    if (n) n.disabled = atLast;  if (l) l.disabled = atLast;
}

// ── Session Operations Audit Drawer ───────────────────────────────────────

var SA_DRAWER_PAGE_SIZE = 50;
var sessionAuditDrawerState = { events: [], dayLabel: '', searchQuery: '', currentPage: 1, filteredRows: [] };

function sessionAuditEventBadge(typeNum) {
    var n = Number(typeNum);
    if (n === 97)  return '<span class="posture-badge posture-badge--violation">Expired</span>';
    if (n === 98)  return '<span class="posture-badge posture-badge--admin-del">Revoked</span>';
    if (n === 99)  return '<span class="posture-badge posture-badge--admin">Logout</span>';
    if (n === 123) return '<span class="posture-badge posture-badge--resolved">Extended</span>';
    return '<span class="posture-badge posture-badge--admin">Event</span>';
}

function sessionAuditEventLabel(typeNum) {
    var n = Number(typeNum);
    if (n === 97)  return 'Expired';
    if (n === 98)  return 'Revoked';
    if (n === 99)  return 'Logout';
    if (n === 123) return 'Extended';
    return 'Event';
}

function openSessionAuditDrawer(dayLabel, eventsArray) {
    var bd = document.getElementById('session-audit-drawer-backdrop');
    if (!bd) return;
    sessionAuditDrawerState.events      = eventsArray || [];
    sessionAuditDrawerState.dayLabel    = dayLabel || '';
    sessionAuditDrawerState.searchQuery = '';
    sessionAuditDrawerState.currentPage = 1;
    var searchEl = document.getElementById('session-audit-drawer-search');
    if (searchEl) searchEl.value = '';
    var titleEl = document.getElementById('session-audit-drawer-title');
    if (titleEl) setDrawerTitle(titleEl, 'Session Operations', dayLabel);
    renderSessionAuditDrawerContent();
    bd.classList.add('is-open');
}

function closeSessionAuditDrawer() {
    var bd = document.getElementById('session-audit-drawer-backdrop');
    if (bd) bd.classList.remove('is-open');
}

function renderSessionAuditDrawerContent() {
    var events   = sessionAuditDrawerState.events;
    var dayLabel = sessionAuditDrawerState.dayLabel;
    var query    = (sessionAuditDrawerState.searchQuery || '').toLowerCase().trim();

    var counts = { 97: 0, 98: 0, 99: 0, 123: 0 };
    events.forEach(function(ev) { var t = auditTypeToNum(ev); if (counts[t] !== undefined) counts[t]++; });

    var statsEl = document.getElementById('session-audit-drawer-stats');
    if (statsEl) {
        statsEl.innerHTML =
            '<div class="sdw-stat-seg">' +
                '<span class="sdw-stat-num sdw-stat-num--amber">' + counts[97] + '</span>' +
                '<span class="sdw-stat-label">Expired</span>' +
            '</div>' +
            '<div class="sdw-stat-seg">' +
                '<span class="sdw-stat-num sdw-stat-num--red">' + counts[98] + '</span>' +
                '<span class="sdw-stat-label">Revoked</span>' +
            '</div>' +
            '<div class="sdw-stat-seg">' +
                '<span class="sdw-stat-num">' + counts[99] + '</span>' +
                '<span class="sdw-stat-label">Logout</span>' +
            '</div>' +
            '<div class="sdw-stat-seg">' +
                '<span class="sdw-stat-num sdw-stat-num--green">' + counts[123] + '</span>' +
                '<span class="sdw-stat-label">Extended</span>' +
            '</div>';
    }

    // Build flat rows from events
    var allRows = events.map(function(ev) {
        var t    = auditTypeToNum(ev);
        var ts   = getAuditItemTs(ev);
        var dest = ev.destinationEntitiesList;
        var user = (Array.isArray(dest) && dest.length > 0 && dest[0].name)
            ? String(dest[0].name)
            : (auditActivitySessionDetailsUser(ev) || '\u2014');
        var admin  = (ev.performedBy && ev.performedBy.name && String(ev.performedBy.name) !== user)
            ? String(ev.performedBy.name) : null;
        var d      = parseAuditDetails(ev);
        var device = (d && (d.sourceAsset || d.deviceName || d.asset || d.fqdn || d.hostname || d.assetName)) ? String(d.sourceAsset || d.deviceName || d.asset || d.fqdn || d.hostname || d.assetName) : '\u2014';
        return { ts: ts, user: user, type: t, device: device, admin: admin, _ev: ev };
    });

    var filtered = query
        ? allRows.filter(function(r) {
            return (r.user   || '').toLowerCase().indexOf(query) !== -1 ||
                   (r.device || '').toLowerCase().indexOf(query) !== -1 ||
                   sessionAuditEventLabel(r.type).toLowerCase().indexOf(query) !== -1;
          })
        : allRows;
    sessionAuditDrawerState.filteredRows = filtered;

    var totalCount = filtered.length;
    var totalPages = Math.max(1, Math.ceil(totalCount / SA_DRAWER_PAGE_SIZE));
    var currentPage = Math.min(sessionAuditDrawerState.currentPage || 1, totalPages);
    sessionAuditDrawerState.currentPage = currentPage;
    var pageStart = (currentPage - 1) * SA_DRAWER_PAGE_SIZE;
    var pageRows  = filtered.slice(pageStart, pageStart + SA_DRAWER_PAGE_SIZE);

    var listEl = document.getElementById('session-audit-drawer-list');
    if (!listEl) return;
    if (!filtered.length) {
        listEl.innerHTML = '<div class="ses-empty">' + buildEmptyState(
            query ? ZN_ICON_SEARCH : ZN_ICON_CLOCK,
            query ? 'No results for \u201c' + escapeHtmlAttr(query) + '\u201d' : 'No session events',
            query ? 'Try a different search term' : 'No session operations were recorded for this day'
        ) + '</div>';
        renderSaPagination(0, 1, 1);
        return;
    }
    listEl.innerHTML = pageRows.map(function(r) {
        var timeStr = r.ts ? new Date(r.ts).toLocaleString() : '\u2014';
        var userHtml = escapeHtmlAttr(r.user) +
            (r.admin ? '<span class="ses-row-sub-label">by ' + escapeHtmlAttr(r.admin) + '</span>' : '');
        return '<div class="ses-row ses-row--sa-drill">' +
            '<div class="ses-row-cell ses-row-cell--date">' + escapeHtmlAttr(timeStr) + '</div>' +
            '<div class="ses-row-cell"><span class="ses-row-user-name">' + userHtml + '</span></div>' +
            '<div class="ses-row-cell">' + sessionAuditEventBadge(r.type) + '</div>' +
            '<div class="ses-row-cell">' + escapeHtmlAttr(r.device) + '</div>' +
        '</div>';
    }).join('');
    renderSaPagination(totalCount, currentPage, totalPages);
}

function renderSaPagination(totalCount, currentPage, totalPages) {
    var lbl  = document.getElementById('sa-pag-label');
    var tot  = document.getElementById('sa-pag-total');
    var f    = document.getElementById('sa-pag-first');
    var p    = document.getElementById('sa-pag-prev');
    var n    = document.getElementById('sa-pag-next');
    var l    = document.getElementById('sa-pag-last');
    if (lbl) lbl.textContent = currentPage + ' of ' + totalPages;
    if (tot) tot.textContent = 'Total count: ' + totalCount;
    var atFirst = currentPage <= 1, atLast = currentPage >= totalPages;
    if (f) f.disabled = atFirst; if (p) p.disabled = atFirst;
    if (n) n.disabled = atLast;  if (l) l.disabled = atLast;
}

// ── Region Health Audit Drawer ─────────────────────────────────────────────

var RHA_DRAWER_PAGE_SIZE = 50;
var regionAuditDrawerState = { events: [], dayLabel: '', searchQuery: '', currentPage: 1, filteredRows: [] };

function regionAuditEventBadge(typeNum) {
    var n = Number(typeNum);
    if (n === 351) return '<span class="posture-badge posture-badge--violation">Region Down</span>';
    if (n === 352) return '<span class="posture-badge posture-badge--resolved">Recovered</span>';
    return '<span class="posture-badge posture-badge--admin">Event</span>';
}

function regionAuditEventLabel(typeNum) {
    var n = Number(typeNum);
    if (n === 351) return 'Region Down';
    if (n === 352) return 'Recovered';
    return 'Event';
}

function openRegionAuditDrawer(dayLabel, eventsArray) {
    var bd = document.getElementById('region-audit-drawer-backdrop');
    if (!bd) return;
    regionAuditDrawerState.events      = eventsArray || [];
    regionAuditDrawerState.dayLabel    = dayLabel || '';
    regionAuditDrawerState.searchQuery = '';
    regionAuditDrawerState.currentPage = 1;
    var searchEl = document.getElementById('region-audit-drawer-search');
    if (searchEl) searchEl.value = '';
    var titleEl = document.getElementById('region-audit-drawer-title');
    if (titleEl) setDrawerTitle(titleEl, 'Region Health', dayLabel);
    renderRegionAuditDrawerContent();
    bd.classList.add('is-open');
}

function closeRegionAuditDrawer() {
    var bd = document.getElementById('region-audit-drawer-backdrop');
    if (bd) bd.classList.remove('is-open');
}

// ── Policy Coverage Drawer — opens from "Policy names by hits" widget ─────
var PN_DRAWER_PAGE_SIZE = 50;

var pnDrawerState = {
    policyName:   '',
    allRows:      [],
    filteredRows: [],
    searchQuery:  '',
    currentPage:  1
};

function openPolicyNameDrawer(policyName) {
    var bd = document.getElementById('pn-drawer-backdrop');
    if (!bd) return;

    var events = filterAuditsByDashboardUser(
        filterPolicyAuditsByUacName(lastData.aud || [], activePeriod, policyName)
    );

    // Aggregate by user
    var userMap = Object.create(null);
    events.forEach(function(ev) {
        var user = auditEventUser(ev) || '\u2014';
        var ts   = getAuditItemTs(ev) || 0;
        var d    = parseAuditDetails(ev);
        var region = (d && typeof d.region === 'string' && d.region.trim()) ? d.region.trim() : null;
        var device = (d && (d.sourceAsset || d.hostname || d.clientHostname || d.device)) || null;
        if (typeof device !== 'string') device = null;
        if (device) device = device.trim() || null;

        if (!userMap[user]) {
            userMap[user] = { user: user, count: 0, lastTs: 0, regions: [], device: null };
        }
        var entry = userMap[user];
        entry.count++;
        if (ts > entry.lastTs) {
            entry.lastTs = ts;
            if (device) entry.device = device;
        }
        if (region && entry.regions.indexOf(region) === -1) entry.regions.push(region);
    });

    var allRows = Object.keys(userMap).map(function(k) { return userMap[k]; })
                        .sort(function(a, b) { return b.count - a.count; });

    pnDrawerState.policyName   = policyName;
    pnDrawerState.allRows      = allRows;
    pnDrawerState.filteredRows = allRows;
    pnDrawerState.searchQuery  = '';
    pnDrawerState.currentPage  = 1;

    var searchEl = document.getElementById('pn-drawer-search');
    if (searchEl) searchEl.value = '';

    var titleEl = document.getElementById('pn-drawer-title');
    if (titleEl) {
        var nDays = typeof dauChartRangeDays === 'number' && dauChartRangeDays >= 1 ? dauChartRangeDays : 30;
        titleEl.innerHTML = 'Policy: ' + escapeHtmlAttr(policyName) +
            '<span class="sdw-title-meta"> \u00b7 ' + nDays + 'd</span>';
    }

    renderPolicyNameDrawerContent();
    bd.classList.add('is-open');
}

function closePolicyNameDrawer() {
    var bd = document.getElementById('pn-drawer-backdrop');
    if (bd) bd.classList.remove('is-open');
}

function renderPolicyNameDrawerContent() {
    var allRows = pnDrawerState.allRows || [];
    var query   = (pnDrawerState.searchQuery || '').toLowerCase().trim();

    // Stats bar
    var statsEl = document.getElementById('pn-drawer-stats');
    if (statsEl) {
        var totalSessions  = allRows.reduce(function(s, r) { return s + r.count; }, 0);
        var uniqueUsers    = allRows.length;
        var avgStr = uniqueUsers > 0 ? (totalSessions / uniqueUsers).toFixed(1) : '—';
        statsEl.innerHTML =
            '<div class="sdw-stat-seg">' +
                '<span class="sdw-stat-num">' + totalSessions + '</span>' +
                '<span class="sdw-stat-label">Sessions</span>' +
            '</div>' +
            '<div class="sdw-stat-seg">' +
                '<span class="sdw-stat-num">' + uniqueUsers + '</span>' +
                '<span class="sdw-stat-label">Users</span>' +
            '</div>' +
            '<div class="sdw-stat-seg">' +
                '<span class="sdw-stat-num">' + avgStr + '</span>' +
                '<span class="sdw-stat-label">Avg sessions / user</span>' +
            '</div>';
    }

    // Filter
    var filtered = query
        ? allRows.filter(function(r) {
            return (r.user    || '').toLowerCase().indexOf(query) !== -1 ||
                   (r.regions || []).join(' ').toLowerCase().indexOf(query) !== -1 ||
                   (r.device  || '').toLowerCase().indexOf(query) !== -1;
          })
        : allRows;
    pnDrawerState.filteredRows = filtered;

    // Pagination
    var totalCount  = filtered.length;
    var totalPages  = Math.max(1, Math.ceil(totalCount / PN_DRAWER_PAGE_SIZE));
    var currentPage = Math.min(pnDrawerState.currentPage || 1, totalPages);
    pnDrawerState.currentPage = currentPage;
    var pageStart   = (currentPage - 1) * PN_DRAWER_PAGE_SIZE;
    var pageRows    = filtered.slice(pageStart, pageStart + PN_DRAWER_PAGE_SIZE);

    var listEl = document.getElementById('pn-drawer-list');
    if (!listEl) return;
    if (!filtered.length) {
        listEl.innerHTML = '<div class="ses-empty">' + buildEmptyState(
            query ? ZN_ICON_SEARCH : ZN_ICON_USERS,
            query ? 'No results for \u201c' + escapeHtmlAttr(query) + '\u201d' : 'No users found',
            query ? 'Try a different search term' : 'No users match this policy'
        ) + '</div>';
        renderPnPagination(0, 1, 1);
        return;
    }

    listEl.innerHTML = pageRows.map(function(r) {
        var user    = escapeHtmlAttr(r.user || '\u2014');
        var regions = r.regions.length ? escapeHtmlAttr(r.regions.slice(0, 2).join(', ') + (r.regions.length > 2 ? '\u2026' : '')) : '\u2014';
        var device  = escapeHtmlAttr(r.device || '\u2014');
        var lastSes = r.lastTs ? escapeHtmlAttr(fmtConnLogTs(r.lastTs)) : '\u2014';
        return '<div class="ses-row ses-row--pn-drill">' +
            '<div class="ses-row-user-cell"><span class="ses-row-user-name">' + user + '</span></div>' +
            '<div class="ses-row-cell pn-sessions-count">' + r.count + '</div>' +
            '<div class="ses-row-cell">' + lastSes + '</div>' +
            '<div class="ses-row-cell">' + regions + '</div>' +
            '<div class="ses-row-cell">' + device + '</div>' +
        '</div>';
    }).join('');

    renderPnPagination(totalCount, currentPage, totalPages);
}

function renderPnPagination(totalCount, currentPage, totalPages) {
    var labelEl = document.getElementById('pn-pag-label');
    var totalEl = document.getElementById('pn-pag-total');
    var firstBtn = document.getElementById('pn-pag-first');
    var prevBtn  = document.getElementById('pn-pag-prev');
    var nextBtn  = document.getElementById('pn-pag-next');
    var lastBtn  = document.getElementById('pn-pag-last');
    if (labelEl) labelEl.textContent = currentPage + ' of ' + totalPages;
    if (totalEl) totalEl.textContent = 'Total count: ' + totalCount;
    var atFirst = currentPage <= 1;
    var atLast  = currentPage >= totalPages;
    if (firstBtn) firstBtn.disabled = atFirst;
    if (prevBtn)  prevBtn.disabled  = atFirst;
    if (nextBtn)  nextBtn.disabled  = atLast;
    if (lastBtn)  lastBtn.disabled  = atLast;
}

function renderRegionAuditDrawerContent() {
    var events   = regionAuditDrawerState.events;
    var dayLabel = regionAuditDrawerState.dayLabel;
    var query    = (regionAuditDrawerState.searchQuery || '').toLowerCase().trim();

    var downCount = 0, recovCount = 0;
    events.forEach(function(ev) {
        var t = auditTypeToNum(ev);
        if (t === 351) downCount++;
        else if (t === 352) recovCount++;
    });

    var statsEl = document.getElementById('region-audit-drawer-stats');
    if (statsEl) {
        statsEl.innerHTML =
            '<div class="sdw-stat-seg">' +
                '<span class="sdw-stat-num sdw-stat-num--red">' + downCount + '</span>' +
                '<span class="sdw-stat-label">Down</span>' +
            '</div>' +
            '<div class="sdw-stat-seg">' +
                '<span class="sdw-stat-num sdw-stat-num--green">' + recovCount + '</span>' +
                '<span class="sdw-stat-label">Recovered</span>' +
            '</div>';
    }

    var allRows = events.map(function(ev) {
        var t    = auditTypeToNum(ev);
        var ts   = getAuditItemTs(ev);
        var dest = ev.destinationEntitiesList;
        var regionName = (Array.isArray(dest) && dest.length > 0 && dest[0].name)
            ? String(dest[0].name)
            : ((ev.performedBy && ev.performedBy.name) ? String(ev.performedBy.name) : '\u2014');
        var d      = parseAuditDetails(ev);
        var server = (d && d.serverName) ? String(d.serverName) : '\u2014';
        return { ts: ts, region: regionName, type: t, server: server };
    });

    var filtered = query
        ? allRows.filter(function(r) {
            return (r.region || '').toLowerCase().indexOf(query) !== -1 ||
                   (r.server || '').toLowerCase().indexOf(query) !== -1 ||
                   regionAuditEventLabel(r.type).toLowerCase().indexOf(query) !== -1;
          })
        : allRows;
    regionAuditDrawerState.filteredRows = filtered;

    var totalCount = filtered.length;
    var totalPages = Math.max(1, Math.ceil(totalCount / RHA_DRAWER_PAGE_SIZE));
    var currentPage = Math.min(regionAuditDrawerState.currentPage || 1, totalPages);
    regionAuditDrawerState.currentPage = currentPage;
    var pageRows = filtered.slice((currentPage - 1) * RHA_DRAWER_PAGE_SIZE, currentPage * RHA_DRAWER_PAGE_SIZE);

    var listEl = document.getElementById('region-audit-drawer-list');
    if (!listEl) return;
    if (!filtered.length) {
        listEl.innerHTML = '<div class="ses-empty">' + buildEmptyState(
            query ? ZN_ICON_SEARCH : ZN_ICON_GLOBE,
            query ? 'No results for \u201c' + escapeHtmlAttr(query) + '\u201d' : 'No region health events',
            query ? 'Try a different search term' : 'No region health events were recorded for this day'
        ) + '</div>';
        renderRhaPagination(0, 1, 1);
        return;
    }
    listEl.innerHTML = pageRows.map(function(r) {
        var timeStr = r.ts ? new Date(r.ts).toLocaleString() : '\u2014';
        return '<div class="ses-row ses-row--rh-drill">' +
            '<div class="ses-row-cell ses-row-cell--date">' + escapeHtmlAttr(timeStr) + '</div>' +
            '<div class="ses-row-cell">' + escapeHtmlAttr(r.region) + '</div>' +
            '<div class="ses-row-cell">' + regionAuditEventBadge(r.type) + '</div>' +
            '<div class="ses-row-cell">' + escapeHtmlAttr(r.server) + '</div>' +
        '</div>';
    }).join('');
    renderRhaPagination(totalCount, currentPage, totalPages);
}

function renderRhaPagination(totalCount, currentPage, totalPages) {
    var lbl = document.getElementById('rha-pag-label');
    var tot = document.getElementById('rha-pag-total');
    var f   = document.getElementById('rha-pag-first');
    var p   = document.getElementById('rha-pag-prev');
    var n   = document.getElementById('rha-pag-next');
    var l   = document.getElementById('rha-pag-last');
    if (lbl) lbl.textContent = currentPage + ' of ' + totalPages;
    if (tot) tot.textContent = 'Total count: ' + totalCount;
    var atFirst = currentPage <= 1, atLast = currentPage >= totalPages;
    if (f) f.disabled = atFirst; if (p) p.disabled = atFirst;
    if (n) n.disabled = atLast;  if (l) l.disabled = atLast;
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
    wireDrawer('map-combo-backdrop',               'map-combo-close',          closeMapComboDrawer);
    wireRhPagination();

    // Map combo drawer — tabs, search, pagination
    (function wireMcdDrawer() {
        var tabUsers   = document.getElementById('mcd-tab-users');
        var tabRegions = document.getElementById('mcd-tab-regions');
        if (tabUsers)   tabUsers.addEventListener('click',   function() { _mcdSwitchTab('users',   true); });
        if (tabRegions) tabRegions.addEventListener('click', function() { _mcdSwitchTab('regions', true); });

        var searchEl = document.getElementById('mcd-search');
        if (searchEl) searchEl.addEventListener('input', function() {
            _mcdSessState.searchQuery = this.value;
            _mcdSessState.currentPage = 1;
            renderMcdUsersTab();
        });

        var pgPairs = [
            ['mcd-pg-first', function() { _mcdSessState.currentPage = 1; renderMcdUsersTab(); }],
            ['mcd-pg-prev',  function() { _mcdSessState.currentPage = Math.max(1, (_mcdSessState.currentPage || 1) - 1); renderMcdUsersTab(); }],
            ['mcd-pg-next',  function() { _mcdSessState.currentPage = (_mcdSessState.currentPage || 1) + 1; renderMcdUsersTab(); }],
            ['mcd-pg-last',  function() { _mcdSessState.currentPage = Math.ceil((_mcdSessState.filteredSessions || []).length / _MCD_PAGE_SIZE) || 1; renderMcdUsersTab(); }],
            ['mcd-rh-pg-first', function() { renderMcdRhPage(1); }],
            ['mcd-rh-pg-prev',  function() { renderMcdRhPage(Math.max(1, _mcdRhCurrentPage - 1)); }],
            ['mcd-rh-pg-next',  function() { renderMcdRhPage(_mcdRhCurrentPage + 1); }],
            ['mcd-rh-pg-last',  function() { renderMcdRhPage(Math.ceil(_mcdRhRows.length / 10) || 1); }]
        ];
        pgPairs.forEach(function(p) {
            var b = document.getElementById(p[0]);
            if (b) b.addEventListener('click', p[1]);
        });
    }());
    wireDrawer('posture-drawer-backdrop',          'posture-drawer-close',     closePostureDrawer);
    wireDrawer('connect-versions-drawer-backdrop', 'cv-drawer-close',          closeConnectVersionsDrawer);
    wireDrawer('os-drawer-backdrop',               'os-drawer-close',          closeOsDrawer);
    wireDrawer('policy-drawer-backdrop',           'policy-drawer-close',      closePolicyDrawer);
    wireDrawer('posture-audit-drawer-backdrop',    'posture-audit-drawer-close', closePostureAuditDrawer);
    wireDrawer('session-audit-drawer-backdrop',    'session-audit-drawer-close', closeSessionAuditDrawer);
    wireDrawer('region-audit-drawer-backdrop',     'region-audit-drawer-close',  closeRegionAuditDrawer);
    wireDrawer('sc-drawer-backdrop',               'sc-drawer-close',            closeSessionCreationDrawer);
    wireDrawer('audit-policies-drawer-backdrop',   'ap-drawer-close',            closeAuditPoliciesDrawer);
    wireDrawer('pn-drawer-backdrop',               'pn-drawer-close',            closePolicyNameDrawer);
    wireDrawer('insight-drawer-backdrop',          'insight-drawer-close',     closeInsightDrawer);

    // Session Creation drawer — search + pagination
    (function wireScDrawer() {
        var searchEl = document.getElementById('sc-drawer-search');
        if (searchEl) {
            searchEl.addEventListener('input', function() {
                scDrawerState.searchQuery = searchEl.value || '';
                scDrawerState.currentPage = 1;
                renderSessionCreationDrawer();
            });
        }
        function scPagClick(delta, toPage) {
            return function() {
                var ins = scDrawerState._insights || {};
                var allRows = scDrawerState.allRows || [];
                var query = (scDrawerState.searchQuery || '').toLowerCase().trim();
                var filtered = query
                    ? allRows.filter(function(r) {
                        var u = (r.name || '').toLowerCase();
                        var a = (r.asset || '').toLowerCase();
                        var l = (r.location || '').toLowerCase();
                        var g = (r.region || '').toLowerCase();
                        return u.indexOf(query) !== -1 || a.indexOf(query) !== -1 || l.indexOf(query) !== -1 || g.indexOf(query) !== -1;
                      })
                    : allRows;
                var totalPages = Math.max(1, Math.ceil(filtered.length / SC_DRAWER_PAGE_SIZE));
                if (toPage === 'first') scDrawerState.currentPage = 1;
                else if (toPage === 'last') scDrawerState.currentPage = totalPages;
                else scDrawerState.currentPage = Math.max(1, Math.min(totalPages, (scDrawerState.currentPage || 1) + delta));
                renderSessionCreationDrawer();
            };
        }
        var f = document.getElementById('sc-pg-first');
        var p = document.getElementById('sc-pg-prev');
        var n = document.getElementById('sc-pg-next');
        var l = document.getElementById('sc-pg-last');
        if (f) f.addEventListener('click', scPagClick(0, 'first'));
        if (p) p.addEventListener('click', scPagClick(-1, null));
        if (n) n.addEventListener('click', scPagClick(+1, null));
        if (l) l.addEventListener('click', scPagClick(0, 'last'));

        // Row clicks → apply user filter and close
        var scListEl = document.getElementById('sc-drawer-list');
        if (scListEl && !scListEl.dataset.znScDrillWired) {
            scListEl.dataset.znScDrillWired = '1';
            scListEl.addEventListener('click', function(e) {
                var row = e.target.closest('.ses-row--sc-drill[data-user-name]');
                if (!row || !scListEl.contains(row)) return;
                var uname = row.getAttribute('data-user-name');
                if (!uname || !String(uname).trim()) return;
                closeSessionCreationDrawer();
                var globalInput = document.getElementById('global-user-input');
                if (globalInput) {
                    globalInput.value = uname;
                    var clearBtn = document.getElementById('clear-user-search');
                    if (clearBtn) clearBtn.classList.remove('hidden');
                }
                applyGlobalUserFilter(uname);
            });
        }
    }());

    // Audit Policies drawer — search + pagination
    (function wireApDrawer() {
        var searchEl = document.getElementById('ap-drawer-search');
        if (searchEl) {
            searchEl.addEventListener('input', function() {
                apDrawerState.searchQuery = searchEl.value || '';
                apDrawerState.currentPage = 1;
                renderAuditPoliciesDrawer();
            });
        }
        function apPagClick(delta, toPage) {
            return function() {
                var allRows   = apDrawerState.allRows || [];
                var query     = (apDrawerState.searchQuery || '').toLowerCase().trim();
                var filtered  = query
                    ? allRows.filter(function(r) { return (r.name || '').toLowerCase().indexOf(query) !== -1; })
                    : allRows;
                var totalPages = Math.max(1, Math.ceil(filtered.length / AP_DRAWER_PAGE_SIZE));
                if (toPage === 'first') apDrawerState.currentPage = 1;
                else if (toPage === 'last') apDrawerState.currentPage = totalPages;
                else apDrawerState.currentPage = Math.max(1, Math.min(totalPages, (apDrawerState.currentPage || 1) + delta));
                renderAuditPoliciesDrawer();
            };
        }
        var af = document.getElementById('ap-pg-first');
        var ap = document.getElementById('ap-pg-prev');
        var an = document.getElementById('ap-pg-next');
        var al = document.getElementById('ap-pg-last');
        if (af) af.addEventListener('click', apPagClick(0, 'first'));
        if (ap) ap.addEventListener('click', apPagClick(-1, null));
        if (an) an.addEventListener('click', apPagClick(+1, null));
        if (al) al.addEventListener('click', apPagClick(0, 'last'));
    }());

    // ── CSV Export Utility ─────────────────────────────────────────────────
    function exportTableToCsv(filename, headers, rows) {
        var lines = [headers.map(function(h) { return '"' + String(h).replace(/"/g, '""') + '"'; }).join(',')];
        rows.forEach(function(row) {
            lines.push(row.map(function(cell) {
                return '"' + String(cell == null ? '' : cell).replace(/"/g, '""') + '"';
            }).join(','));
        });
        var blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement('a');
        a.href = url; a.download = filename; a.style.display = 'none';
        document.body.appendChild(a); a.click();
        setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 1000);
    }

    // ── Session Creation CSV ───────────────────────────────────────────────
    (function() {
        var btn = document.getElementById('sc-export-btn');
        if (!btn) return;
        btn.addEventListener('click', function() {
            var rows = (scDrawerState.filteredRows || scDrawerState.allRows || []).map(function(r) {
                return [r.name || '', r.asset || '', r.location || '', r.region || '', r.policy || ''];
            });
            exportTableToCsv('session-creation.csv', ['User','Device','Country','Region','Policy Applied'], rows);
        });
    }());

    // ── Session Operations: search + pagination + CSV ─────────────────────
    (function wireSessionAuditDrawer() {
        var searchEl = document.getElementById('session-audit-drawer-search');
        if (searchEl) {
            searchEl.addEventListener('input', function() {
                sessionAuditDrawerState.searchQuery = searchEl.value || '';
                sessionAuditDrawerState.currentPage = 1;
                renderSessionAuditDrawerContent();
            });
        }
        function saPag(delta, toPage) {
            return function() {
                var total = (sessionAuditDrawerState.filteredRows || []).length;
                var pages = Math.max(1, Math.ceil(total / SA_DRAWER_PAGE_SIZE));
                if (toPage === 'first') sessionAuditDrawerState.currentPage = 1;
                else if (toPage === 'last') sessionAuditDrawerState.currentPage = pages;
                else sessionAuditDrawerState.currentPage = Math.max(1, Math.min(pages, (sessionAuditDrawerState.currentPage || 1) + delta));
                renderSessionAuditDrawerContent();
            };
        }
        var sf = document.getElementById('sa-pag-first'); var sp = document.getElementById('sa-pag-prev');
        var sn = document.getElementById('sa-pag-next');  var sl = document.getElementById('sa-pag-last');
        if (sf) sf.addEventListener('click', saPag(0,'first')); if (sp) sp.addEventListener('click', saPag(-1,null));
        if (sn) sn.addEventListener('click', saPag(+1,null));   if (sl) sl.addEventListener('click', saPag(0,'last'));

        var exportBtn = document.getElementById('session-audit-export-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', function() {
                var rows = (sessionAuditDrawerState.filteredRows || []).map(function(r) {
                    return [r.ts ? new Date(r.ts).toLocaleString() : '', r.user || '', sessionAuditEventLabel(r.type), r.device || '', r.admin || ''];
                });
                exportTableToCsv('session-operations.csv', ['Timestamp','User','Event Type','Device','Admin Responsible'], rows);
            });
        }
    }());

    // ── Policy Operations: search + pagination + CSV ───────────────────────
    (function wirePolicyDrawer() {
        var searchEl = document.getElementById('policy-drawer-search');
        if (searchEl) {
            searchEl.addEventListener('input', function() {
                policyDrawerState.searchQuery = searchEl.value || '';
                policyDrawerState.currentPage = 1;
                renderPolicyDrawerContent();
            });
        }
        function poPag(delta, toPage) {
            return function() {
                var total = (policyDrawerState.filteredRows || []).length;
                var pages = Math.max(1, Math.ceil(total / PO_DRAWER_PAGE_SIZE));
                if (toPage === 'first') policyDrawerState.currentPage = 1;
                else if (toPage === 'last') policyDrawerState.currentPage = pages;
                else policyDrawerState.currentPage = Math.max(1, Math.min(pages, (policyDrawerState.currentPage || 1) + delta));
                renderPolicyDrawerContent();
            };
        }
        var pf = document.getElementById('po-pag-first'); var pp = document.getElementById('po-pag-prev');
        var pn = document.getElementById('po-pag-next');  var pl = document.getElementById('po-pag-last');
        if (pf) pf.addEventListener('click', poPag(0,'first')); if (pp) pp.addEventListener('click', poPag(-1,null));
        if (pn) pn.addEventListener('click', poPag(+1,null));   if (pl) pl.addEventListener('click', poPag(0,'last'));

        var exportBtn = document.getElementById('policy-export-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', function() {
                var rows = (policyDrawerState.filteredRows || []).map(function(r) {
                    return [r.ts ? new Date(r.ts).toLocaleString() : '', r.admin || '', getPolicyActionLabel(r.type), r.policy || '', r.summary || ''];
                });
                exportTableToCsv('policy-operations.csv', ['Timestamp','Admin','Action','Policy Name','Change Summary'], rows);
            });
        }
    }());

    // ── Region Health Audit: search + pagination + CSV ─────────────────────
    (function wireRegionAuditDrawer() {
        var searchEl = document.getElementById('region-audit-drawer-search');
        if (searchEl) {
            searchEl.addEventListener('input', function() {
                regionAuditDrawerState.searchQuery = searchEl.value || '';
                regionAuditDrawerState.currentPage = 1;
                renderRegionAuditDrawerContent();
            });
        }
        function rhaPag(delta, toPage) {
            return function() {
                var total = (regionAuditDrawerState.filteredRows || []).length;
                var pages = Math.max(1, Math.ceil(total / RHA_DRAWER_PAGE_SIZE));
                if (toPage === 'first') regionAuditDrawerState.currentPage = 1;
                else if (toPage === 'last') regionAuditDrawerState.currentPage = pages;
                else regionAuditDrawerState.currentPage = Math.max(1, Math.min(pages, (regionAuditDrawerState.currentPage || 1) + delta));
                renderRegionAuditDrawerContent();
            };
        }
        var rf = document.getElementById('rha-pag-first'); var rp = document.getElementById('rha-pag-prev');
        var rn = document.getElementById('rha-pag-next');  var rl = document.getElementById('rha-pag-last');
        if (rf) rf.addEventListener('click', rhaPag(0,'first')); if (rp) rp.addEventListener('click', rhaPag(-1,null));
        if (rn) rn.addEventListener('click', rhaPag(+1,null));   if (rl) rl.addEventListener('click', rhaPag(0,'last'));

        var exportBtn = document.getElementById('region-audit-export-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', function() {
                var rows = (regionAuditDrawerState.filteredRows || []).map(function(r) {
                    return [r.ts ? new Date(r.ts).toLocaleString() : '', r.region || '', regionAuditEventLabel(r.type), r.server || ''];
                });
                exportTableToCsv('region-health-events.csv', ['Timestamp','Region Name','Event Type','Server Name'], rows);
            });
        }
    }());

    // ── Posture Audits: search + pagination + CSV ─────────────────────────
    (function wirePostureAuditDrawer() {
        var searchEl = document.getElementById('posture-audit-drawer-search');
        if (searchEl) {
            searchEl.addEventListener('input', function() {
                postureAuditDrawerState.searchQuery = searchEl.value || '';
                postureAuditDrawerState.currentPage = 1;
                renderPostureAuditDrawerContent();
            });
        }
        function paPag(delta, toPage) {
            return function() {
                var total = (postureAuditDrawerState.filteredRows || []).length;
                var pages = Math.max(1, Math.ceil(total / PA_DRAWER_PAGE_SIZE));
                if (toPage === 'first') postureAuditDrawerState.currentPage = 1;
                else if (toPage === 'last') postureAuditDrawerState.currentPage = pages;
                else postureAuditDrawerState.currentPage = Math.max(1, Math.min(pages, (postureAuditDrawerState.currentPage || 1) + delta));
                renderPostureAuditDrawerContent();
            };
        }
        var paf = document.getElementById('pa-pag-first'); var pap = document.getElementById('pa-pag-prev');
        var pan = document.getElementById('pa-pag-next');  var pal = document.getElementById('pa-pag-last');
        if (paf) paf.addEventListener('click', paPag(0,'first')); if (pap) pap.addEventListener('click', paPag(-1,null));
        if (pan) pan.addEventListener('click', paPag(+1,null));   if (pal) pal.addEventListener('click', paPag(0,'last'));

        var exportBtn = document.getElementById('posture-audit-export-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', function() {
                var rows = (postureAuditDrawerState.filteredRows || []).map(function(r) {
                    return [r.ts ? new Date(r.ts).toLocaleString() : '', r.user || '', r.device || '',
                            postureAuditEventBadgeText(r.type), r.checks.join('; '), r.profile || ''];
                });
                exportTableToCsv('posture-audits.csv', ['Timestamp','User','Device','Event Type','Check Types','Profile'], rows);
            });
        }
    }());

    // ── Policy Coverage drawer: search + pagination + CSV ─────────────────
    (function wirePolicyNameDrawer() {
        var searchEl = document.getElementById('pn-drawer-search');
        if (searchEl) {
            searchEl.addEventListener('input', function() {
                pnDrawerState.searchQuery = searchEl.value || '';
                pnDrawerState.currentPage = 1;
                renderPolicyNameDrawerContent();
            });
        }
        function pnPag(delta, toPage) {
            return function() {
                var total = (pnDrawerState.filteredRows || []).length;
                var pages = Math.max(1, Math.ceil(total / PN_DRAWER_PAGE_SIZE));
                if (toPage === 'first') pnDrawerState.currentPage = 1;
                else if (toPage === 'last') pnDrawerState.currentPage = pages;
                else pnDrawerState.currentPage = Math.max(1, Math.min(pages, (pnDrawerState.currentPage || 1) + delta));
                renderPolicyNameDrawerContent();
            };
        }
        var pnf = document.getElementById('pn-pag-first'); var pnp = document.getElementById('pn-pag-prev');
        var pnn = document.getElementById('pn-pag-next');  var pnl = document.getElementById('pn-pag-last');
        if (pnf) pnf.addEventListener('click', pnPag(0,'first')); if (pnp) pnp.addEventListener('click', pnPag(-1,null));
        if (pnn) pnn.addEventListener('click', pnPag(+1,null));   if (pnl) pnl.addEventListener('click', pnPag(0,'last'));

        var exportBtn = document.getElementById('pn-export-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', function() {
                var policyName = pnDrawerState.policyName || 'policy';
                var rows = (pnDrawerState.filteredRows || []).map(function(r) {
                    return [
                        r.user || '',
                        String(r.count),
                        r.lastTs ? new Date(r.lastTs).toLocaleString() : '',
                        (r.regions || []).join('; '),
                        r.device || ''
                    ];
                });
                var safeName = policyName.replace(/[^a-z0-9_\-]/gi, '_').toLowerCase();
                exportTableToCsv('policy-coverage-' + safeName + '.csv',
                    ['User', 'Sessions', 'Last Session', 'Regions', 'Device'], rows);
            });
        }
    }());

    // ── Active Sessions CSV ────────────────────────────────────────────────
    (function() {
        var btn = document.getElementById('sessions-export-btn');
        if (!btn) return;
        btn.addEventListener('click', function() {
            var rows = (window._znActiveSessionsForExport || []).map(function(s) {
                return [s.userName || s.user || '', s.assetName || s.asset || '', s.country || s.location || '', s.region || '', s.lastAuth || ''];
            });
            exportTableToCsv('active-sessions.csv', ['User','Asset','Country','Region','Last Auth'], rows);
        });
    }());

    // Wire region health drawer drill-down
    var rhDrawerList = document.getElementById('rh-drawer-list');
    if (rhDrawerList && !rhDrawerList.dataset.znRegionDrillWired) {
        rhDrawerList.dataset.znRegionDrillWired = '1';
        rhDrawerList.addEventListener('click', function(e) {
            var row = e.target.closest('.ses-row--region-drill[data-region-name], .rh-table-row[data-region-name]');
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
        closeSessionCreationDrawer();
        closeAuditPoliciesDrawer();
        closePostureAuditDrawer();
        closeSessionAuditDrawer();
        closeRegionAuditDrawer();
        closePolicyDrawer();
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
    if (pol && !pol.dataset.pnDrawerWired) {
        pol.dataset.pnDrawerWired = '1';
        pol.addEventListener('click', function(e) {
            var row = e.target.closest('.pn-widget-row[data-policy-name]');
            if (!row || !pol.contains(row)) return;
            var name = row.getAttribute('data-policy-name');
            if (!name) return;
            openPolicyNameDrawer(name);
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

// ── 8a. Map 2D/3D projection toggle ──────────────────────────────────────
(function wireMapDimToggle() {
    var btn2d = document.getElementById('map-dim-2d');
    var btn3d = document.getElementById('map-dim-3d');
    function setDim(dim) {
        if (!leafletMap) return;
        if (dim === '3d') {
            leafletMap.setProjection({ type: 'globe' });
            btn3d && btn3d.classList.add('active');
            btn2d && btn2d.classList.remove('active');
        } else {
            leafletMap.setProjection({ type: 'mercator' });
            btn2d && btn2d.classList.add('active');
            btn3d && btn3d.classList.remove('active');
        }
        znTrack && znTrack('map_dim_change', { dim: dim });
        // setProjection fires a styledata event that temporarily marks sources as
        // unloaded.  Re-render once the map goes idle (sources reloaded, tiles settled)
        // so the render loop finds features and recreates the chip markers.
        // A 400 ms fallback fires first in case idle takes longer than expected.
        var _projRerenderDone = false;
        function _projRerender() {
            if (_projRerenderDone) return;
            _projRerenderDone = true;
            if (!lastData || !lastData.ses) return;
            try { renderMap(filterSessionsByDashboardFilters(lastData.ses)); }
            catch (e) { console.warn('[ZN] map re-render after projection change failed:', e); }
            // Force a render-loop tick so the chip markers are created immediately.
            if (leafletMap) leafletMap.triggerRepaint();
        }
        setTimeout(_projRerender, 400);
        leafletMap.once('idle', _projRerender);
    }
    if (btn2d) btn2d.addEventListener('click', function() { setDim('2d'); });
    if (btn3d) btn3d.addEventListener('click', function() { setDim('3d'); });
}());

// ── 8. Map mode toggle ────────────────────────────────────────────────────
document.querySelectorAll('.map-mode-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.map-mode-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        mapMode = btn.dataset.mode;
        znTrack('map_mode_change', { mode: btn.dataset.mode || '' });
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

(function wireMapZoom() {
    var zoomIn = document.getElementById('map-zoom-in');
    if (zoomIn) {
        zoomIn.addEventListener('click', function() {
            if (leafletMap) leafletMap.zoomIn();
        });
    }
    var zoomOut = document.getElementById('map-zoom-out');
    if (zoomOut) {
        zoomOut.addEventListener('click', function() {
            if (leafletMap) leafletMap.zoomOut();
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
    try { renderPostureViolationsWidget(lastData.aud || []); }
    catch(e) { console.error('[ZN] postureViolationsWidget failed:', e); }
    try { renderTopUserPostureViolationsWidget(lastData.aud || []); }
    catch(e) { console.error('[ZN] topUserPostureViolationsWidget failed:', e); }
}

/**
 * Filter posture audit events by the selected dashboard user.
 * For system-generated events (type 390/391/374), the affected user is in
 * destinationEntitiesList[0].name, not in performedBy. For admin events
 * (387-394) the performer is the admin user. We check both.
 */
function filterPostureAuditsByDashboardUser(audItems) {
    var sel = getSelectedDashboardUserName();
    if (!sel) return audItems || [];
    return (audItems || []).filter(function(item) {
        // Check performer first (covers admin events + posture check failed)
        var performer = auditEventUser(item);
        if (performer && performer === sel) return true;
        // Check destination entity (covers system-generated violation events)
        var dest = item.destinationEntitiesList;
        if (Array.isArray(dest) && dest.length > 0) {
            var destName = dest[0].name ? String(dest[0].name).trim() : null;
            if (destName && destName === sel) return true;
        }
        return false;
    });
}

// ── Posture Violations Widget ──────────────────────────────────────────────
var _lastPostureViolationsPool = [];

/**
 * Returns a human-readable summary of what a posture profile checks.
 * Inspects windowsChecks / macChecks / linuxChecks fields.
 */
function postureProfileCheckSummary(profile) {
    var parts = [];
    var osSections = ['windowsChecks', 'macChecks', 'linuxChecks'];
    var labelMap = {
        antivirus:                      'Antivirus',
        domainJoined:                   'Domain joined',
        osVersionBuild:                 'OS version',
        fileExistsList:                 'File exists',
        processRunningList:             'Process running',
        registryKeyValueDataExistsList: 'Registry key',
        certificateExistsList:          'Certificate',
        encryptionEnabled:              'Disk encryption',
        firewallEnabled:                'Firewall'
    };
    osSections.forEach(function(os) {
        var section = profile[os];
        if (!section) return;
        Object.keys(section).forEach(function(key) {
            var val = section[key];
            var isEmpty = Array.isArray(val) ? val.length === 0
                        : (typeof val === 'object' && val !== null)
                            ? Object.keys(val).length === 0
                            : !val;
            if (isEmpty) return;
            var label = labelMap[key] || key;
            if (parts.indexOf(label) === -1) parts.push(label);
        });
    });
    return parts.length ? parts.join(', ') : 'Custom checks';
}

// Per-profile data map, keyed by profileId — populated during render, used by click handler.
// Each entry: { profileName, count, byUser: { userName: { count, checks: Set } } }
var _postureProfileViolations = Object.create(null);

// ── PV Drawer state ────────────────────────────────────────────────────────
var PV_DRAWER_PAGE_SIZE = 50;
var pvDrawerState = {
    profileId:   null,
    profileName: '',
    allRows:     [],
    searchQuery: '',
    currentPage: 1
};

/**
 * Parse type-374 (Connect posture check failed) events and extract failedChecks entries.
 * Returns array of { profileId, profileName, userName, sourceAsset, checks[], ts }
 */
function extractFailedCheckEntries(audItems) {
    var entries = [];
    (audItems || []).forEach(function(item) {
        if (auditTypeToNum(item) !== 374) return;
        var d = parseAuditDetails(item);
        if (!d || !Array.isArray(d.failedChecks)) return;
        var userName    = d.user || (item.performedBy && item.performedBy.name) || '\u2014';
        var sourceAsset = d.sourceAsset || '\u2014';
        var ts          = getAuditItemTs(item);
        d.failedChecks.forEach(function(fc) {
            entries.push({
                profileId:   fc.profileId   || '\u2014',
                profileName: fc.profileName || fc.profileId || '\u2014',
                userName:    userName,
                sourceAsset: sourceAsset,
                checks:      Array.isArray(fc.checks) ? fc.checks : [],
                ts:          ts
            });
        });
    });
    return entries;
}

function renderPostureViolationsWidget(audItems) {
    var el = document.getElementById('card-posture-violations');
    if (!el) return;

    var pvWrap = document.getElementById('card-posture-violations-wrap');
    if (pvWrap) pvWrap.style.minHeight = '';

    // Case A: posture not configured — no profiles set up yet
    if (!lastData.postureProfiles || lastData.postureProfiles.length === 0) {
        el.innerHTML =
            '<div class="posture-compliant-wrap">' +
                '<div class="posture-compliant-icon">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="32" height="32">' +
                        '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' +
                        '<line x1="12" y1="8" x2="12" y2="12"/>' +
                        '<line x1="12" y1="16" x2="12.01" y2="16"/>' +
                    '</svg>' +
                '</div>' +
                '<p class="posture-compliant-title">Posture not configured</p>' +
                '<p class="posture-compliant-body">No posture profiles are defined. Configure posture profiles to start tracking device compliance.</p>' +
            '</div>';
        return;
    }

    var pool = filterPostureAuditsByDashboardUser(
        filterAuditsByDashboardRegion(audItems || [])
    );
    _lastPostureViolationsPool = filterByPeriod(pool, '30d');

    // Build per-profile aggregation from type 374 failedChecks
    _postureProfileViolations = Object.create(null);
    var allEntries = extractFailedCheckEntries(_lastPostureViolationsPool);

    allEntries.forEach(function(e) {
        if (!_postureProfileViolations[e.profileId]) {
            _postureProfileViolations[e.profileId] = {
                profileName: e.profileName,
                count:       0,
                byUser:      Object.create(null)
            };
        }
        var p = _postureProfileViolations[e.profileId];
        p.count++;
        if (!p.byUser[e.userName]) {
            p.byUser[e.userName] = { count: 0, checks: [], asset: e.sourceAsset };
        }
        var u = p.byUser[e.userName];
        u.count++;
        // Collect unique check strings
        e.checks.forEach(function(c) {
            if (u.checks.indexOf(c) === -1) u.checks.push(c);
        });
    });

    var profileEntries = Object.keys(_postureProfileViolations)
        .map(function(pid) {
            var p = _postureProfileViolations[pid];
            return { profileId: pid, profileName: p.profileName, count: p.count };
        })
        .sort(function(a, b) { return b.count - a.count; });

    // Case B: posture configured, no violations in 30d — all devices comply
    if (profileEntries.length === 0) {
        el.innerHTML =
            '<div class="posture-compliant-wrap">' +
                '<div class="posture-compliant-icon">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="32" height="32">' +
                        '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' +
                        '<polyline points="9 12 11 14 15 10"/>' +
                    '</svg>' +
                '</div>' +
                '<p class="posture-compliant-title">All devices comply</p>' +
                '<p class="posture-compliant-body">No posture profile violations detected in the last 30 days.</p>' +
            '</div>';
        return;
    }

    var maxV = profileEntries[0].count;
    var html = profileEntries.map(function(p) {
        var pct = Math.round((p.count / maxV) * 100);
        return '<div class="metric-row posture-profile-viol-row" data-posture-profile-id="' + escapeHtmlAttr(p.profileId) + '">' +
            '<span class="metric-label">' + escapeHtmlAttr(p.profileName) + '</span>' +
            '<div class="metric-bar-wrap"><div class="metric-bar indigo" style="width:' + pct + '%"></div></div>' +
            '<span class="metric-count">' + p.count + '</span>' +
        '</div>';
    }).join('');

    el.innerHTML = html;

    // Wire click on each profile bar → open PV drawer
    el.querySelectorAll('.posture-profile-viol-row').forEach(function(row) {
        row.style.cursor = 'pointer';
        row.addEventListener('click', function() {
            var pid = row.getAttribute('data-posture-profile-id');
            if (pid) openPostureViolationDrawer(pid);
        });
    });
}

// ── Top Users Widget (Session Creation / Posture Violations) ───────────────
var topUsersMode = 'session_creation'; // 'session_creation' | 'posture_violations'

function renderTopUserPostureViolationsWidget(audItems) {
    renderTopUsersWidget(audItems, topUsersMode);
}

function renderTopUsersWidget(audItems, mode) {
    var el     = document.getElementById('card-top-users-posture');
    var loadEl = document.getElementById('audit-top-users-posture-loading');
    var badge  = document.getElementById('top-users-period-badge');
    if (!el) return;

    // Clear any stale inline min-height left by a previous version of this code
    var wrap = document.getElementById('card-top-users-posture-wrap');
    if (wrap) wrap.style.minHeight = '';

    if (loadEl) loadEl.style.display = 'none';

    var isPosture = (mode === 'posture_violations');
    var pool      = filterByPeriod(audItems || [], '30d');
    var users     = isPosture ? postureTopViolatingUsers30d(pool) : topUsersBySessionCreation(audItems, '30d');

    if (badge) badge.textContent = isPosture ? '30d' : '30d';

    if (!users.length) {
        el.innerHTML = '<div class="ses-empty">' + buildEmptyState(
            isPosture ? ZN_ICON_SHIELD : ZN_ICON_USERS,
            isPosture ? 'No open violations' : 'No session activity',
            isPosture ? 'No posture violations in the last 30 days' : 'No session creation events in the last 30 days'
        ) + '</div>';
        return;
    }

    var maxCount = users[0].count;

    var rows = users.map(function(u) {
        var pct     = maxCount > 0 ? Math.round((u.count / maxCount) * 100) : 0;
        var initial = (u.userName || '?').charAt(0).toUpperCase();
        var safeName   = escapeHtmlAttr(u.userName);
        var safeUid    = escapeHtmlAttr(u.userId);
        var label      = isPosture
            ? (u.count + ' open violation' + (u.count !== 1 ? 's' : ''))
            : (u.count + ' session' + (u.count !== 1 ? 's' : ''));

        return '<div class="metric-row tuv-row" data-uid="' + safeUid + '" data-uname="' + safeName + '" ' +
            'title="' + safeName + ' \u2014 ' + label + '">' +
            '<span class="metric-label tuv-label-cell">' +
                '<span class="tuv-avatar">' + escapeHtmlAttr(initial) + '</span>' +
                '<span class="tuv-inline-name">' + safeName + '</span>' +
            '</span>' +
            '<div class="metric-bar-wrap"><div class="metric-bar indigo" style="width:' + pct + '%"></div></div>' +
            '<span class="metric-count">' + u.count + '</span>' +
            '</div>';
    }).join('');

    el.innerHTML = rows;

    el.querySelectorAll('.tuv-row').forEach(function(row) {
        row.addEventListener('click', function() {
            var uid   = row.dataset.uid;
            var uname = row.dataset.uname;

            if (isPosture) {
                var cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
                var latestByKey = Object.create(null);
                pool.forEach(function(item) {
                    var t = auditTypeToNum(item);
                    if (t !== 390 && t !== 391) return;
                    var ts = getAuditItemTs(item);
                    if (ts == null || ts < cutoff) return;
                    var d = parseAuditDetails(item);
                    if (!d) return;
                    var itemUid = d.userId || item.reportedObjectId || '';
                    if (itemUid !== uid) return;
                    var checks = Array.isArray(d.postureCheckTypes) ? d.postureCheckTypes : [0];
                    checks.forEach(function(ct) {
                        var key = String(ct);
                        if (!latestByKey[key] || ts > latestByKey[key].ts) {
                            latestByKey[key] = { ts: ts, type: t, checkType: ct };
                        }
                    });
                });
                var drawerRows = Object.keys(latestByKey)
                    .filter(function(k) { return latestByKey[k].type === 390; })
                    .map(function(k) {
                        var e = latestByKey[k];
                        return {
                            'User': uname,
                            'Failing Check': postureCheckTypeLabel(e.checkType),
                            'Last Seen': new Date(e.ts).toLocaleDateString()
                        };
                    })
                    .sort(function(a, b) { return a['Failing Check'].localeCompare(b['Failing Check']); });
                openInsightDrawer(
                    drawerRows,
                    'Posture Violations \u2014 ' + uname,
                    'Review and remediate the open posture violations for this user. Consider updating the posture profile or excluding this user if violations are expected.',
                    ['User', 'Failing Check', 'Last Seen'],
                    'red',
                    'Shows the latest open posture violation per check type for this user, using the most recent event to determine whether the check is currently failing.'
                );
            } else {
                var sessionRows = filterByPeriod(audItems || [], '30d').filter(function(item) {
                    if (auditTypeToNum(item) !== AUDIT_TYPE_SESSION_CREATED) return false;
                    var iuid = (item.user && item.user.id != null) ? String(item.user.id) : '';
                    var iname = (item.user && item.user.name != null) ? String(item.user.name).trim() : '';
                    if (!iuid && !iname) {
                        var pb = item.performedBy;
                        if (pb && pb.id)   iuid  = String(pb.id);
                        if (pb && pb.name) iname = String(pb.name).trim();
                    }
                    return (iuid && iuid === uid) || (iname && iname === uname);
                }).map(function(item) {
                    var ts = getAuditItemTs(item);
                    var d  = parseAuditDetails(item);
                    return {
                        'User': uname,
                        'Region': (d && d.connectServer) ? String(d.connectServer) : '\u2014',
                        'Time': ts ? new Date(ts).toLocaleString() : '\u2014'
                    };
                }).sort(function(a, b) { return b['Time'].localeCompare(a['Time']); });
                openInsightDrawer(
                    sessionRows,
                    'Session Creation \u2014 ' + uname,
                    'All Connect sessions created by this user in the last 30 days.',
                    ['User', 'Region', 'Time'],
                    'blue',
                    'Lists every Connect session-created audit event recorded for this user in the last 30 days, sorted newest first.'
                );
            }
        });
    });
}

function initTopUsersModeSelect() {
    var sel = document.getElementById('top-users-mode-select');
    if (!sel) return;
    sel.addEventListener('change', function() {
        topUsersMode = sel.value;
        renderTopUsersWidget(lastData.aud || [], topUsersMode);
    });
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

async function fetchPostureProfiles(token) {
    var raw = await fetchAPI(token, ZN_API_BASE + '/api/v1/connect/posture?_limit=100&_offset=0&with_count=true');
    var items = (raw && raw.items) || (Array.isArray(raw) ? raw : []);
    return Array.isArray(items) ? items : [];
}

async function fetchConnectRoles(token) {
    // Some environments expose this under /settings/connect/roles; try both.
    var endpoints = [
        ZN_API_BASE + '/api/v1/connect/roles?_limit=100&_offset=0&with_count=true',
        ZN_API_BASE + '/api/v1/settings/connect/roles?_limit=100&_offset=0&with_count=true',
    ];
    for (var i = 0; i < endpoints.length; i++) {
        try {
            var raw = await fetchAPI(token, endpoints[i]);
            var items = (raw && raw.items) || (Array.isArray(raw) ? raw : []);
            return Array.isArray(items) ? items : [];
        } catch (e) {
            if (e && e.message === ZN_ERR_UNAUTHORIZED) throw e;
            // If first path returns 404, silently try the alternate path
            if (i < endpoints.length - 1 && parseInt(e && e.message, 10) === 404) continue;
            throw e;
        }
    }
    return [];
}

// ── Latest Connect client versions — one call per platform ──────────────────
// platform=1 → Windows x64, platform=2 → macOS Intel, platform=3 → macOS ARM
// Response: { url: "https://…/ZeroNetworksConnect-x64-5.0.10.0.zip?…" }
// We parse the version string from the filename portion of the signed URL.
function semverGt(a, b) {
    if (!a) return false;
    if (!b) return true;
    var ap = String(a).split('.').map(Number);
    var bp = String(b).split('.').map(Number);
    var len = Math.max(ap.length, bp.length);
    for (var i = 0; i < len; i++) {
        var an = ap[i] || 0, bn = bp[i] || 0;
        if (an > bn) return true;
        if (an < bn) return false;
    }
    return false;
}

async function fetchLatestClientVersions(token) {
    var platforms = [
        { id: 1, os: 'windows' },
        { id: 2, os: 'macIntel' },
        { id: 3, os: 'macArm' }
    ];
    var results = await Promise.all(platforms.map(function(p) {
        return fetchAPI(token, ZN_API_BASE + '/api/v1/download/connect/client?platform=' + p.id)
            .then(function(r) {
                var url = (r && r.url) || '';
                var m = url.match(/ZeroNetworksConnect-[^-]+-(\d+(?:\.\d+)+)/);
                return { os: p.os, version: m ? m[1] : null };
            })
            .catch(function() { return { os: p.os, version: null }; });
    }));
    var out = {};
    results.forEach(function(r) { if (r.version) out[r.os] = r.version; });
    var allVersions = results.map(function(r) { return r.version; }).filter(Boolean);
    out.latest = allVersions.reduce(function(best, v) { return semverGt(v, best) ? v : best; }, allVersions[0] || null);
    return out;
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
    var kpiAoPct = document.getElementById('kpi-posture-always-on-pct');
    var kpiCabPct = document.getElementById('kpi-posture-connect-after-boot-pct');
    if (kpiAoPct) kpiAoPct.textContent = '';
    if (kpiCabPct) kpiCabPct.textContent = '';
    var kpiVtotal = document.getElementById('kpi-posture-validated-total');
    if (kpiVtotal) kpiVtotal.textContent = '\u2014';
    var kpiVtotalPct = document.getElementById('kpi-posture-validated-total-pct');
    if (kpiVtotalPct) kpiVtotalPct.textContent = '';
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
    if (isExtCtxAlive() && chrome.storage && chrome.storage.local) {
        try {
        chrome.storage.local.get('znTokens', function(result) {
            var le = chrome.runtime && chrome.runtime.lastError;
            if (le) console.warn('[ZN] chrome.storage:', le.message);
            var tokens = (result && result.znTokens) || {};
            var entry = tokens[ZN_PORTAL_HOSTNAME];
            var t = coerceDashBearerToken(entry && entry.token);
            if (t) { callback(t); return; }
            // Legacy fallback for installs that still have the old flat znToken key
            try {
                callback(coerceDashBearerToken(localStorage.getItem('znToken')));
            } catch (e) { callback(null); }
        });
        } catch (e) {
            try { callback(coerceDashBearerToken(localStorage.getItem('znToken'))); }
            catch (e2) { callback(null); }
        }
    } else {
        try {
            callback(coerceDashBearerToken(localStorage.getItem('znToken')));
        } catch (e2) { callback(null); }
    }
}

// ── 10. Main data loader ───────────────────────────────────────────────────
// License + sessions first (fast path); paginated audit runs in the background.
async function loadDashboard(token) {
    window.__znDash401Handled = false;
    znFastDataRendered = false;
    znTrack('dashboard_opened');

    var statusEl = document.getElementById('debug-status');
    if (statusEl) {
        statusEl.textContent = 'Loading\u2026';
        statusEl.style.color = '#94a3b8';
    }

    var bearer = coerceDashBearerToken(token);
    if (!bearer) {
        // No stored token yet. Before redirecting, ask an open portal tab to fire
        // a fresh API call so the background service worker can capture and store
        // the token. This handles extension-reload / service-worker-eviction cases
        // where the portal is open and authenticated but the token isn't in storage yet.
        if (statusEl) {
            statusEl.textContent = 'Waiting for session\u2026';
            statusEl.style.color = '#94a3b8';
        }
        attemptTokenRefresh().then(function(success) {
            if (!success) {
                // No portal tab found or timed out — redirect to portal login.
                showAuthGate('no-token');
                if (statusEl) {
                    statusEl.textContent = 'Not signed in';
                    statusEl.style.color = '#f87171';
                }
                lastData.auditFetchPending = false;
                lastData.ses = [];
                lastData.lic = null;
                renderDashboardDataUnavailable('No data available');
            }
            // success=true: attemptTokenRefresh already called window.location.reload()
        });
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
                    if (parseInt(e && e.message, 10) < 500) console.warn('[ZN] License API failed:', e.message);
                    return null;
                }),
            fetchConnectSessions(bearer)
                .catch(function(e) {
                    if (e && e.message === ZN_ERR_UNAUTHORIZED) throw e;
                    if (parseInt(e && e.message, 10) < 500) console.warn('[ZN] Sessions API failed:', e.message);
                    return [];
                }),
            fetchConnectRegions(bearer)
                .catch(function(e) {
                    if (e && e.message === ZN_ERR_UNAUTHORIZED) throw e;
                    if (parseInt(e && e.message, 10) < 500) console.warn('[ZN] Regions API failed:', e.message);
                    return [];
                }),
            fetchPostureProfiles(bearer)
                .catch(function(e) {
                    if (e && e.message === ZN_ERR_UNAUTHORIZED) throw e;
                    var msg = e && e.message ? e.message : '';
                    var status = parseInt(msg, 10);
                    if (msg !== 'Failed to fetch' && !(status >= 400 && status < 500)) console.warn('[ZN] Posture profiles API failed:', msg || e);
                    return [];
                }),
            fetchConnectRoles(bearer)
                .catch(function(e) {
                    if (e && e.message === ZN_ERR_UNAUTHORIZED) throw e;
                    // 404 means the endpoint isn't available in this environment — handled gracefully
                    var status = parseInt(e && e.message, 10);
                    if (status !== 404 && status < 500) console.warn('[ZN] Connect roles (policy) API failed:', e.message);
                    return [];
                }),
            fetchLatestClientVersions(bearer)
                .catch(function() { return null; })
        ]);

        var licRaw  = phaseFast[0];
        var ses     = Array.isArray(phaseFast[1]) ? phaseFast[1] : [];
        var regions = Array.isArray(phaseFast[2]) ? phaseFast[2] : [];
        var postureProfiles = Array.isArray(phaseFast[3]) ? phaseFast[3] : [];
        var connectRoles    = Array.isArray(phaseFast[4]) ? phaseFast[4] : [];
        var latestClientVersions = phaseFast[5] || null;

        var lic = licRaw || null;

        lastData.lic                 = lic;
        lastData.ses                 = ses;
        lastData.regions             = regions;
        lastData.postureProfiles     = postureProfiles;
        lastData.connectRoles        = connectRoles;
        lastData.latestClientVersions = latestClientVersions;

        // Build policy lookup map keyed by role id
        lastData.policyById = Object.create(null);
        connectRoles.forEach(function(r) { if (r && r.id) lastData.policyById[r.id] = r; });

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

        // Full load succeeded (fast data + 7-day audit) — safe to reset the
        // reload counter so a future genuine token expiry can still trigger a refresh.
        try { sessionStorage.removeItem('znDashReloads'); } catch (e2) { /* noop */ }

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
        if (e && e.message && e.message.includes('Extension context invalidated')) {
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
    // Mark fast data as rendered so subsequent background 401s (e.g. audit fetch)
    // do not trigger a page reload and create an infinite refresh loop.
    znFastDataRendered = true;

    if (lic && lic.licenseState) {
        var licInUse = lic.licenseState.inUse || 0;
        var licLimit = (lic.licenseState.configInfo && lic.licenseState.configInfo.limit) || 0;
        var overCapacity = licInUse > licLimit;
        document.getElementById('kpi-licenses').textContent = licInUse + ' out of ' + licLimit;
        document.getElementById('kpi-licenses').className = 'widget-primary-metric';
        var licPct = licLimit > 0 ? Math.min(100, Math.round(licInUse / licLimit * 100)) : 0;
        var licBar = document.getElementById('license-bar');
        if (licBar) {
            licBar.style.width      = licPct + '%';
            licBar.style.background = overCapacity ? '#FF4D4D' : licPct >= 90 ? '#f59e0b' : '#00df9a';
        }
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
    setTimeout(znSafeMapResize, 300);
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

    // Re-validate auth when the user comes back from sleep / tab switch.
    // Without this, after closing the lid for an hour and reopening, the page
    // stays silently stale until the next API call fails — by which point the
    // portal tab may have already navigated away and the user sees a broken
    // half-login, half-dashboard split screen.
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState !== 'visible') return;
        readStoredZnToken(function(token) {
            var bearer = coerceDashBearerToken(token);
            if (!bearer || !isZeroNetworksPortalAuthOk()) {
                showAuthGate('expired');
            }
        });
    });
}

// ── Feedback ──────────────────────────────────────────────────────────────────
(function () {
    // Replace YOUR_FORMSPREE_ID with your form ID from formspree.io
    var FORMSPREE_URL = 'https://formspree.io/f/xwvayppg';

    var tabBtn    = document.getElementById('feedback-tab-btn');
    var backdrop  = document.getElementById('feedback-modal-backdrop');
    var closeBtn  = document.getElementById('feedback-modal-close-btn');
    var form      = document.getElementById('feedback-form');
    var submitBtn = document.getElementById('feedback-submit-btn');
    var statusEl  = document.getElementById('feedback-form-status');

    if (!tabBtn || !backdrop) return;

    function openFeedbackModal() {
        backdrop.removeAttribute('aria-hidden');
        backdrop.classList.add('open');
        document.getElementById('feedback-type').focus();
    }

    function closeFeedbackModal() {
        if (backdrop.contains(document.activeElement)) document.activeElement.blur();
        backdrop.setAttribute('aria-hidden', 'true');
        backdrop.classList.remove('open');
        form.reset();
        setFeedbackStatus('', '');
    }

    function setFeedbackStatus(msg, type) {
        statusEl.textContent = msg;
        statusEl.className = 'feedback-status' + (type ? ' feedback-status--' + type : '');
    }

    tabBtn.addEventListener('click', openFeedbackModal);
    closeBtn.addEventListener('click', closeFeedbackModal);
    backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop) closeFeedbackModal();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && backdrop.classList.contains('open')) closeFeedbackModal();
    });

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        var type    = document.getElementById('feedback-type').value;
        var email   = document.getElementById('feedback-email').value.trim();
        var message = document.getElementById('feedback-message').value.trim();

        if (!type)    { setFeedbackStatus('Please select a feedback type.', 'error'); return; }
        if (!message) { setFeedbackStatus('Please describe your feedback.', 'error'); return; }

        submitBtn.disabled = true;
        setFeedbackStatus('Sending\u2026', '');

        // doSubmit performs the actual Formspree POST with the optional debug bundle.
        function doSubmit(debugBundle) {
            var payload = {
                type:    type,
                email:   email || '(not provided)',
                message: message
            };
            if (debugBundle) payload._debug = debugBundle;

            fetch(FORMSPREE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(payload)
            })
            .then(function (res) {
                return res.json().then(function (data) { return { ok: res.ok, data: data }; });
            })
            .then(function (result) {
                if (result.ok) {
                    znTrack('feedback_submitted', { feedback_type: type });
                    if (type === 'bug') znTrack('bug_reported', { source: 'feedback_form' });
                    setFeedbackStatus('Thanks! Your feedback was sent.', 'success');
                    form.reset();
                    setTimeout(closeFeedbackModal, 2200);
                } else {
                    setFeedbackStatus('Something went wrong. Please try again.', 'error');
                }
            })
            .catch(function () {
                setFeedbackStatus('Network error. Please check your connection and retry.', 'error');
            })
            .finally(function () {
                submitBtn.disabled = false;
            });
        }

        // Always collect the debug bundle from the background SW before submitting.
        // If the extension context is unavailable, fall back to submitting without it.
        if (isExtCtxAlive()) {
            try {
                chrome.runtime.sendMessage({ type: 'ZN_GET_DEBUG_BUNDLE' }, function (bundle) {
                    void chrome.runtime.lastError;
                    doSubmit(bundle || null);
                });
            } catch (_) {
                doSubmit(null);
            }
        } else {
            doSubmit(null);
        }
    });
}());
