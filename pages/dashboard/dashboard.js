/* ── Inject Roboto from Google Fonts ────────────────────────── */
(function loadRoboto() {
  if (document.querySelector('link[href*="fonts.googleapis.com"][href*="Roboto"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap';
  document.head.appendChild(link);
})();

/* ── Zoom-aware font scaling ─────────────────────────────────
   Detects browser zoom level via devicePixelRatio and boosts
   font sizes so labels stay readable at low zoom (e.g. 65%).
   The boost is partial: text grows but the compact layout stays.
──────────────────────────────────────────────────────────── */
(function initZoomFontBoost() {
  // Common native DPR values for standard / HiDPI / Retina screens
  var NATIVE_DPRS = [1, 1.25, 1.5, 2, 2.5, 3];

  function applyBoost() {
    var dpr = window.devicePixelRatio || 1;

    // Find the closest "natural" DPR to isolate the zoom contribution
    var naturalDPR = NATIVE_DPRS.reduce(function (best, v) {
      return Math.abs(v - dpr) < Math.abs(best - dpr) ? v : best;
    });

    var zoom = dpr / naturalDPR;   // e.g. 0.65 when zoomed to 65%

    // Boost table: zoom range → font multiplier.
    // Calibrated so fonts stay proportionally larger at low zoom
    // without inflating the overall layout.
    var boost;
    if      (zoom < 0.70) boost = 1.45;   // ≈ 60–69 % zoom
    else if (zoom < 0.78) boost = 1.28;   // ≈ 70–77 %
    else if (zoom < 0.88) boost = 1.15;   // ≈ 78–87 %
    else if (zoom < 0.95) boost = 1.07;   // ≈ 88–94 %
    else                  boost = 1;      // ≈ 95 %+ — no change

    document.documentElement.style.setProperty('--font-boost', boost);
  }

  applyBoost();
  window.addEventListener('resize', applyBoost);
}());

const API_ROOT = "https://zerocorp-admin-dev.zeronetworks.com";
const ENDPOINTS = {
  licenses: `${API_ROOT}/api/v1/settings/subscriptions/licenses/connect`,
  sessions: `${API_ROOT}/api/v1/connect/sessions?_limit=100&_offset=0&with_count=true`,
  audit: `${API_ROOT}/api/v1/audit?_limit=20&_filters=[%7B%22id%22:%22auditType%22,%22includeValues%22:[%2299%22,%22100%22,%22101%22,%22102%22,%22103%22,%22104%22,%22107%22,%22123%22,%22190%22,%22260%22,%22261%22,%22308%22,%22351%22,%22352%22,%22365%22,%22374%22]%7D]&order=desc`
};

const state = {
  token: null,
  sessions: []
};

function el(id) {
  return document.getElementById(id);
}

async function getStoredToken() {
  try {
    const result = await chrome.storage.local.get(["zn_auth_token"]);
    return result.zn_auth_token || null;
  } catch {
    return null;
  }
}

function setTokenStatus(ready) {
  const status = el("tokenStatus");
  status.className = `token-pill ${ready ? "success" : "warning"}`;
  status.textContent = ready ? "Token active" : "No token";
}

async function fetchApi(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: token,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`API request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

function addAlert(message, type = "warn") {
  const container = el("alertsContainer");
  const div = document.createElement("div");
  div.className = `alert ${type === "error" ? "error" : ""}`;
  div.textContent = message;
  container.appendChild(div);
}

function clearAlerts() {
  el("alertsContainer").innerHTML = "";
}

function renderLicenses(data) {
  if (!data || !data.licenseState) return;
  const limit = data.licenseState.configInfo.limit || 0;
  const inUse = data.licenseState.inUse || 0;
  const pct = limit > 0 ? Math.round((inUse / limit) * 100) : 0;
  const overCapacity = pct >= 100;

  el("kpiLicenses").textContent = `${inUse} out of ${limit}`;
  el("licenseBar").style.width = `${Math.min(pct, 100)}%`;
  el("licenseBar").style.background = overCapacity ? "#FF4D4D" : pct >= 85 ? "#f59e0b" : "#00df9a";

  const alertIcon = el("licenseAlertIcon");
  if (alertIcon) alertIcon.style.display = overCapacity ? "block" : "none";

  if (pct >= 85) addAlert(`License utilization is high (${pct}%).`);
}

function renderRegionsHealth(items) {
  const regEl = el("kpiRegions");
  if (!regEl) return;

  const allRegions = new Set(
    items.map(s => s?.region?.name || s?.region || s?.regionId || s?.site?.name).filter(Boolean)
  );
  const activeRegions = new Set(
    items.filter(s => s?.connectionState === 1)
         .map(s => s?.region?.name || s?.region || s?.regionId || s?.site?.name)
         .filter(Boolean)
  );

  if (allRegions.size > 0) {
    regEl.innerHTML = `<span class="kpi-big">${activeRegions.size}</span><span class="kpi-small"> out of ${allRegions.size}</span>`;
  } else {
    regEl.textContent = "—";
  }
}

function renderPosture(items) {
  const alwaysEl = el("kpiPostureAlways");
  const bootEl   = el("kpiPostureBoot");
  if (!alwaysEl || !bootEl) return;

  const connected = items.filter(s => s?.connectionState === 1);

  // connectMode / connectionMode: 1 = Always On, 2 = Connect after boot
  const alwaysOn  = connected.filter(s => (s?.connectMode ?? s?.connectionMode) === 1).length;
  const afterBoot = connected.filter(s => (s?.connectMode ?? s?.connectionMode) === 2).length;
  const unknown   = connected.length - alwaysOn - afterBoot;

  // If the API doesn't return posture fields, fall back to showing connected total
  alwaysEl.textContent = alwaysOn > 0 || afterBoot > 0 ? String(alwaysOn) : String(connected.length);
  bootEl.textContent   = alwaysOn > 0 || afterBoot > 0 ? String(afterBoot) : String(unknown);
}

function renderSessions(data) {
  const items = data?.items || [];
  const total = data?.count ?? items.length;
  state.sessions = items;

  let connected = 0;
  let disconnected = 0;
  const osCounts = {};

  const body = el("sessionsBody");
  body.innerHTML = "";

  for (const session of items) {
    const isLive = session?.connectionState === 1;
    const user = session?.user?.name || "N/A";
    const asset = session?.asset?.name || "N/A";
    const os = session?.asset?.operatingSystem || "Unknown";
    const ip = session?.currentPublicIp || "N/A";

    if (isLive) connected += 1;
    else disconnected += 1;
    osCounts[os] = (osCounts[os] || 0) + 1;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="status-dot ${isLive ? "dot-live" : "dot-offline"}"></span></td>
      <td>${user}</td>
      <td>${asset}</td>
      <td>${os}</td>
      <td>${ip}</td>
    `;
    body.appendChild(tr);
  }

  el("kpiActive").innerHTML = `<span class="kpi-big">${connected}</span><span class="kpi-small"> out of ${total}</span>`;
  const subEl = el("kpiActiveSub");
  if (subEl) subEl.textContent = `out of ${total} total`;
  const discEl = el("kpiDisconnected");
  if (discEl) discEl.textContent = String(disconnected);

  renderRegionsHealth(items);
  renderPosture(items);
  drawDonut(osCounts);
  renderConnectedTime(items);
}

function renderAudit(data) {
  const items = data?.items || [];
  el("kpiAudits").textContent = String(items.length);

  const body = el("auditBody");
  body.innerHTML = "";
  const buckets = {};

  for (const row of items) {
    const ts = row?.isoTimestamp ? new Date(row.isoTimestamp) : null;
    const label = ts ? `${ts.getMonth() + 1}/${ts.getDate()} ${ts.getHours()}:00` : "n/a";
    buckets[label] = (buckets[label] || 0) + 1;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${ts ? ts.toLocaleString() : "N/A"}</td>
      <td>${row?.performedBy?.name || "System"}</td>
      <td>${row?.destinationEntitiesList?.[0]?.name || "Global / System"}</td>
      <td>CODE_${row?.auditType ?? "N/A"}</td>
    `;
    body.appendChild(tr);
  }

  drawLineChart(buckets);
}

// ── Audit area chart ──────────────────────────────────────────────────────────

const AUDIT_SERIES = [
  {
    id: "colo",
    label: "COLO",
    color: "#4f84e8",
    fill: "rgba(79,132,232,0.18)",
    visible: true,
    data: [5,6,7,6,5,7,8,6,8,10,12,14,16,18,20,22,24,23,21,18,15,12,6,5,4,3,3,2,2,1,1]
  },
  {
    id: "il",
    label: "IL",
    color: "#00c88c",
    fill: "rgba(0,200,140,0.18)",
    visible: true,
    data: [4,5,6,5,5,6,8,7,9,10,12,12,13,14,15,14,14,13,12,11,10,9,9,8,7,6,5,4,3,3,2]
  },
  {
    id: "il-backup",
    label: "IL Backup",
    color: "#818cf8",
    fill: "rgba(129,140,248,0.18)",
    visible: true,
    data: [1,1,2,1,1,2,1,1,2,2,2,3,2,3,4,5,4,3,3,2,2,2,2,1,1,1,1,1,1,1,0]
  }
];

// ── Regions Health diverging-bar data ────────────────────────────────────────
const REGIONS_HEALTH = {
  n: 7,
  recovered:        [9, 6, 10, 4, 1, 12, 9],
  down:             [4, 5,  6, 6, 3, 12, 8],
  visibleRecovered: true,
  visibleDown:      true,
};

// Session operations stacked-bar series (31 days, 1/7–31/7)
const SESSION_OPS_SERIES = [
  {
    id: "expired",
    label: "Expired",
    color: "#38bdf8",
    visible: true,
    data: [6,9,5,4,8,6,4,7,9,11,8,6,9,11,7,13,11,8,6,5,10,9,7,9,10,11,9,7,6,9,7]
  },
  {
    id: "extended",
    label: "Extended",
    color: "#22c55e",
    visible: true,
    data: [10,12,8,7,12,10,7,10,13,15,12,10,12,15,10,16,14,12,9,8,14,13,10,12,14,15,12,11,9,13,11]
  },
  {
    id: "logout",
    label: "Logout",
    color: "#818cf8",
    visible: true,
    data: [2,3,2,2,4,2,2,3,3,4,3,3,4,4,2,5,4,3,3,2,4,3,3,3,4,4,3,3,2,3,3]
  },
  {
    id: "revoked",
    label: "Revoked",
    color: "#f97316",
    visible: true,
    data: [3,4,2,2,4,3,2,3,4,5,4,3,4,5,3,6,5,4,3,3,5,4,3,4,5,5,4,3,3,4,3]
  }
];

let currentAuditMode = "session-region";
let auditDays = 30;

function getActiveAuditSeries() {
  if (currentAuditMode === "session-ops") return SESSION_OPS_SERIES;
  if (currentAuditMode === "policy-ops") return POLICY_OPS_SERIES;
  return AUDIT_SERIES;
}

function drawAuditChart(hoverIdx = -1) {
  if (currentAuditMode === "session-ops") {
    drawAuditBarChart(hoverIdx);
  } else if (currentAuditMode === "policy-ops") {
    drawPolicyOpsBarChart(hoverIdx);
  } else if (currentAuditMode === "regions-health") {
    drawRegionsHealthChart(hoverIdx);
  } else {
    drawAuditAreaChart(hoverIdx);
  }
}

function updateAuditLegend() {
  const legend = el("auditLegend");
  if (!legend) return;

  if (currentAuditMode === "regions-health") {
    legend.innerHTML = `
      <label class="audit-legend-item">
        <input type="checkbox" ${REGIONS_HEALTH.visibleRecovered ? "checked" : ""} data-series="recovered" class="audit-series-cb">
        <span class="audit-cb-box" style="--cb:#3ecfa3"></span>
        <span class="audit-legend-label">Recovered</span>
      </label>
      <label class="audit-legend-item">
        <input type="checkbox" ${REGIONS_HEALTH.visibleDown ? "checked" : ""} data-series="down" class="audit-series-cb">
        <span class="audit-cb-box" style="--cb:#f28080"></span>
        <span class="audit-legend-label">Down</span>
      </label>`;
    legend.querySelectorAll(".audit-series-cb").forEach(cb => {
      cb.addEventListener("change", () => {
        if (cb.dataset.series === "recovered") REGIONS_HEALTH.visibleRecovered = cb.checked;
        else if (cb.dataset.series === "down")  REGIONS_HEALTH.visibleDown      = cb.checked;
        drawAuditChart();
      });
    });
    return;
  }

  const series = getActiveAuditSeries();
  legend.innerHTML = series.map(s => `
    <label class="audit-legend-item">
      <input type="checkbox" ${s.visible ? "checked" : ""} data-series="${s.id}" class="audit-series-cb">
      <span class="audit-cb-box" style="--cb:${s.color}"></span>
      <span class="audit-legend-label">${s.label}</span>
    </label>
  `).join("");
  legend.querySelectorAll(".audit-series-cb").forEach(cb => {
    cb.addEventListener("change", () => {
      const activeSeries = getActiveAuditSeries();
      const s = activeSeries.find(s => s.id === cb.dataset.series);
      if (s) { s.visible = cb.checked; drawAuditChart(); }
    });
  });
}

// ── Policy operations stacked bar series ──────────────────────────────────────
// Stacking order: created (bottom) → edited → deleted (top)
const POLICY_OPS_SERIES = [
  {
    id: "created", label: "Policy created", color: "#38bdf8",
    visible: true,
    data: [10,12,8,6,14,8,8,9,11,13,7,8,10,12,9,8,11,13,10,8,7,9,12,10,8,7,6,9,11,10,9]
  },
  {
    id: "edited",  label: "Policy edited",  color: "#10b981",
    visible: true,
    data: [5,6,4,3,7,6,10,7,8,6,5,4,6,7,5,5,7,8,7,6,4,5,7,6,5,5,4,5,7,6,5]
  },
  {
    id: "deleted", label: "Policy deleted", color: "#f59e0b",
    visible: true,
    data: [2,2,1,1,2,4,4,3,3,2,2,2,3,2,2,1,2,3,3,2,2,2,2,2,1,1,1,2,3,2,2]
  }
];


function drawPolicyOpsBarChart(hoverBarIdx = -1) {
  const canvas = el("auditChart");
  if (!canvas) return;

  let rect = canvas.getBoundingClientRect();
  let displayW = Math.round(rect.width);
  let displayH = Math.round(rect.height) || 168;

  if (displayW <= 10 || displayH <= 10) {
    requestAnimationFrame(() => drawPolicyOpsBarChart(hoverBarIdx));
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const physW = Math.round(displayW * dpr);
  const physH = Math.round(displayH * dpr);
  const needResize = canvas.width !== physW || canvas.height !== physH;

  if (needResize) {
    canvas.width = physW;
    canvas.height = physH;
  }

  const ctx = canvas.getContext("2d");
  if (needResize) ctx.scale(dpr, dpr);

  const W = displayW;
  const H = displayH;
  ctx.clearRect(0, 0, W, H);

  const pad = { top: 14, right: 10, bottom: 28, left: 34 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;
  const maxY = 30;
  const yTicks = [0, 5, 10, 15, 20, 25, 30];
  const n = 31;

  const slotW = chartW / n;
  const barW = slotW * 0.68;
  const barLeft = (i) => pad.left + i * slotW + (slotW - barW) / 2;
  const toY = (v) => pad.top + chartH - (v / maxY) * chartH;
  const baseY = toY(0);

  // Grid lines + Y-axis labels
  ctx.save();
  ctx.strokeStyle = "#e9edf3";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#9ca3af";
  ctx.font = `10px Inter,-apple-system,sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  yTicks.forEach(t => {
    const y = toY(t);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillText(String(t), pad.left - 5, y);
  });
  ctx.restore();

  // X-axis labels (every 2 days)
  ctx.save();
  ctx.fillStyle = "#9ca3af";
  ctx.font = `9px Inter,-apple-system,sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0 || i === n - 1) {
      ctx.fillText(`${i + 1}/7`, barLeft(i) + barW / 2, H - pad.bottom + 5);
    }
  }
  ctx.restore();

  const visible = POLICY_OPS_SERIES.filter(s => s.visible);

  for (let i = 0; i < n; i++) {
    const x = barLeft(i);
    const isHov = i === hoverBarIdx;
    let cumulative = 0;

    visible.forEach((series, si) => {
      const val = series.data[i];
      if (!val) { cumulative += val; return; }
      const segH = (val / maxY) * chartH;
      const y = baseY - (cumulative + val) / maxY * chartH;
      const isTop = si === visible.length - 1;
      const r = isTop ? Math.min(3, barW / 3, segH) : 0;
      const alpha = isHov ? "dd" : "ff";

      ctx.fillStyle = series.color + alpha;
      ctx.beginPath();
      if (r > 0) {
        ctx.moveTo(x, y + segH);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.lineTo(x + barW - r, y);
        ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
        ctx.lineTo(x + barW, y + segH);
      } else {
        ctx.rect(x, y, barW, segH);
      }
      ctx.closePath();
      ctx.fill();
      cumulative += val;
    });
  }

  // Hover vertical highlight line
  if (hoverBarIdx >= 0 && hoverBarIdx < n) {
    const cx = barLeft(hoverBarIdx) + barW / 2;
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    ctx.lineWidth = barW + 4;
    ctx.beginPath();
    ctx.moveTo(cx, pad.top);
    ctx.lineTo(cx, baseY);
    ctx.stroke();
    ctx.restore();
    // Redraw the hovered bar on top so it's not dimmed by the overlay
    const x = barLeft(hoverBarIdx);
    let cum2 = 0;
    visible.forEach((series, si) => {
      const val = series.data[hoverBarIdx];
      if (!val) { cum2 += val; return; }
      const segH = (val / maxY) * chartH;
      const y = baseY - (cum2 + val) / maxY * chartH;
      const isTop = si === visible.length - 1;
      const r = isTop ? Math.min(3, barW / 3, segH) : 0;
      ctx.fillStyle = series.color;
      ctx.beginPath();
      if (r > 0) {
        ctx.moveTo(x, y + segH);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.lineTo(x + barW - r, y);
        ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
        ctx.lineTo(x + barW, y + segH);
      } else {
        ctx.rect(x, y, barW, segH);
      }
      ctx.closePath();
      ctx.fill();
      cum2 += val;
    });
  }
}

function catmullRomPath(ctx, pts) {
  if (pts.length < 2) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}

// ── Regions Health diverging bar chart ───────────────────────────────────────
function drawRegionsHealthChart(hoverIdx = -1) {
  const canvas = el("auditChart");
  if (!canvas) return;

  let rect = canvas.getBoundingClientRect();
  let displayW = Math.round(rect.width);
  let displayH = Math.round(rect.height) || 168;

  if (displayW <= 10 || displayH <= 10) {
    requestAnimationFrame(() => drawRegionsHealthChart(hoverIdx));
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const physW = Math.round(displayW * dpr);
  const physH = Math.round(displayH * dpr);
  const needResize = canvas.width !== physW || canvas.height !== physH;

  if (needResize) {
    canvas.width = physW;
    canvas.height = physH;
  }

  const ctx = canvas.getContext("2d");
  if (needResize) ctx.scale(dpr, dpr);

  const W = displayW;
  const H = displayH;
  ctx.clearRect(0, 0, W, H);

  const pad = { top: 14, right: 10, bottom: 28, left: 34 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  const { n, recovered, down, visibleRecovered, visibleDown } = REGIONS_HEALTH;
  const maxY = 15;
  const yTicks = [15, 10, 5, 0, -5, -10, -15];

  // +maxY at top, -maxY at bottom, 0 at vertical centre
  const toY = (v) => pad.top + (chartH / 2) * (1 - v / maxY);
  const zeroY = Math.round(toY(0));

  // Grid lines + Y-axis labels
  ctx.save();
  ctx.font = `10px Inter,-apple-system,sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  yTicks.forEach(t => {
    const y = toY(t);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.strokeStyle = t === 0 ? "#c4cdd6" : "#e9edf3";
    ctx.lineWidth   = t === 0 ? 1.5 : 1;
    ctx.stroke();
    if (t !== 0) {
      ctx.fillStyle = "#9ca3af";
      ctx.fillText(String(Math.abs(t)), pad.left - 5, y);
    }
  });
  ctx.restore();

  // X-axis date labels
  ctx.save();
  ctx.fillStyle = "#9ca3af";
  ctx.font = `9px Inter,-apple-system,sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i < n; i++) {
    const cx = pad.left + (i + 0.5) * chartW / n;
    ctx.fillText(`${i + 1}/7`, cx, H - pad.bottom + 5);
  }
  ctx.restore();

  // Hover column background (drawn before bars so bars appear on top)
  const slotW = chartW / n;
  if (hoverIdx >= 0 && hoverIdx < n) {
    const cx = pad.left + (hoverIdx + 0.5) * slotW;
    ctx.save();
    ctx.fillStyle = "rgba(100,116,139,0.07)";
    ctx.fillRect(pad.left + hoverIdx * slotW, pad.top, slotW, chartH);
    ctx.restore();
  }

  // Bars — compute shared left/width using integer pixels so green and red
  // bars are guaranteed to occupy the exact same x column.
  const halfH = chartH / 2;
  const rawBarW = Math.max(6, slotW * 0.60);
  const r = 3;

  for (let i = 0; i < n; i++) {
    const cx = pad.left + (i + 0.5) * slotW;
    const isHovered = i === hoverIdx;

    // Pin to integer pixels — same values used for BOTH bars
    const barLeft = Math.round(cx - rawBarW / 2);
    const barW    = Math.round(cx + rawBarW / 2) - barLeft;

    if (visibleRecovered && recovered[i] > 0) {
      const bh = Math.round((recovered[i] / maxY) * halfH);
      ctx.beginPath();
      ctx.roundRect(barLeft, zeroY - bh, barW, bh, [r, r, 0, 0]);
      ctx.fillStyle = isHovered ? "#29b88a" : "#3ecfa3";
      ctx.fill();
    }

    if (visibleDown && down[i] > 0) {
      const bh = Math.round((down[i] / maxY) * halfH);
      ctx.beginPath();
      ctx.roundRect(barLeft, zeroY, barW, bh, [0, 0, r, r]);
      ctx.fillStyle = isHovered ? "#d65f5f" : "#f28080";
      ctx.fill();
    }
  }

  // Hover dashed vertical line
  if (hoverIdx >= 0 && hoverIdx < n) {
    const cx = pad.left + (hoverIdx + 0.5) * slotW;
    ctx.save();
    ctx.strokeStyle = "#b0b8c4";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cx, pad.top);
    ctx.lineTo(cx, pad.top + chartH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

function drawAuditAreaChart(hoverIdx = -1) {
  const canvas = el("auditChart");
  if (!canvas) return;

  // Use getBoundingClientRect for reliable CSS-pixel width even inside flex
  let rect = canvas.getBoundingClientRect();
  let displayW = Math.round(rect.width);
  let displayH = Math.round(rect.height) || 168;

  // If layout hasn't resolved yet, retry once via rAF (max 1 retry)
  if (displayW <= 10 || displayH <= 10) {
    requestAnimationFrame(() => drawAuditAreaChart(hoverIdx));
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const physW = Math.round(displayW * dpr);
  const physH = Math.round(displayH * dpr);
  const needResize = canvas.width !== physW || canvas.height !== physH;

  if (needResize) {
    canvas.width = physW;
    canvas.height = physH;
  }

  const ctx = canvas.getContext("2d");
  // Re-apply scale whenever we resize (resizing resets the context transform)
  if (needResize) ctx.scale(dpr, dpr);

  const W = displayW;
  const H = displayH;
  ctx.clearRect(0, 0, W, H);

  const pad = { top: 14, right: 10, bottom: 28, left: 34 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;
  const maxY = 30;
  const yTicks = [0, 5, 10, 15, 20, 25, 30];
  const n = 31;

  const toX = (i) => pad.left + (i / (n - 1)) * chartW;
  const toY = (v) => pad.top + chartH - (v / maxY) * chartH;

  // Horizontal grid lines + Y-axis labels
  ctx.save();
  ctx.strokeStyle = "#e9edf3";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#9ca3af";
  ctx.font = `10px Inter,-apple-system,sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  yTicks.forEach(t => {
    const y = toY(t);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
    ctx.fillText(String(t), pad.left - 5, y);
  });
  ctx.restore();

  // X-axis labels (every 2 days)
  ctx.save();
  ctx.fillStyle = "#9ca3af";
  ctx.font = `9px Inter,-apple-system,sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0 || i === n - 1) {
      ctx.fillText(`${i + 1}/7`, toX(i), H - pad.bottom + 5);
    }
  }
  ctx.restore();

  const visible = AUDIT_SERIES.filter(s => s.visible);

  // Area fills
  visible.forEach(series => {
    const pts = series.data.map((v, i) => ({ x: toX(i), y: toY(v) }));
    ctx.beginPath();
    catmullRomPath(ctx, pts);
    ctx.lineTo(pts[pts.length - 1].x, toY(0));
    ctx.lineTo(pts[0].x, toY(0));
    ctx.closePath();
    ctx.fillStyle = series.fill;
    ctx.fill();
  });

  // Lines
  visible.forEach(series => {
    const pts = series.data.map((v, i) => ({ x: toX(i), y: toY(v) }));
    ctx.beginPath();
    catmullRomPath(ctx, pts);
    ctx.strokeStyle = series.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();
  });

  // Hover: vertical line + dots
  if (hoverIdx >= 0 && hoverIdx < n) {
    const hx = toX(hoverIdx);
    ctx.save();
    ctx.strokeStyle = "#b0b8c4";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(hx, pad.top);
    ctx.lineTo(hx, pad.top + chartH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    visible.forEach(series => {
      const hy = toY(series.data[hoverIdx]);
      ctx.beginPath();
      ctx.arc(hx, hy, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = series.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }
}

// ── Audit stacked bar chart (Session operations) ──────────────────────────────

function drawAuditBarChart(hoverIdx = -1) {
  const canvas = el("auditChart");
  if (!canvas) return;

  let rect = canvas.getBoundingClientRect();
  let displayW = Math.round(rect.width);
  let displayH = Math.round(rect.height) || 168;

  if (displayW <= 10 || displayH <= 10) {
    requestAnimationFrame(() => drawAuditBarChart(hoverIdx));
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const physW = Math.round(displayW * dpr);
  const physH = Math.round(displayH * dpr);
  const needResize = canvas.width !== physW || canvas.height !== physH;

  if (needResize) {
    canvas.width = physW;
    canvas.height = physH;
  }

  const ctx = canvas.getContext("2d");
  if (needResize) ctx.scale(dpr, dpr);

  const W = displayW;
  const H = displayH;
  ctx.clearRect(0, 0, W, H);

  const totalPts = SESSION_OPS_SERIES[0].data.length; // 31
  const n = auditDays === 7 ? 7 : auditDays === 14 ? 14 : totalPts;
  const dataStart = totalPts - n;

  const pad = { top: 14, right: 10, bottom: 28, left: 34 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;
  const maxY = 30;
  const yTicks = [0, 5, 10, 15, 20, 25, 30];

  const toY = (v) => pad.top + chartH - (v / maxY) * chartH;

  // Grid lines + Y-axis labels
  ctx.save();
  ctx.strokeStyle = "#e9edf3";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#9ca3af";
  ctx.font = `10px Inter,-apple-system,sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  yTicks.forEach(t => {
    const y = toY(t);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
    ctx.fillText(String(t), pad.left - 5, y);
  });
  ctx.restore();

  // Bars: stack bottom-to-top as Revoked → Logout → Extended → Expired
  const visible = SESSION_OPS_SERIES.filter(s => s.visible);
  const stackOrder = [...visible].reverse();

  const slotW = chartW / n;
  const barPad = Math.max(1, slotW * 0.15);
  const barW = Math.max(2, slotW - barPad * 2);

  for (let i = 0; i < n; i++) {
    const dataIdx = dataStart + i;
    const x = pad.left + i * slotW + barPad;
    const isHovered = i === hoverIdx;
    let stackBottom = 0;

    stackOrder.forEach(s => {
      const val = s.data[dataIdx] || 0;
      if (val <= 0) return;
      const barH = (val / maxY) * chartH;
      const y = toY(stackBottom + val);

      ctx.globalAlpha = (hoverIdx >= 0 && !isHovered) ? 0.55 : 1;
      ctx.fillStyle = s.color;
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(barW), Math.ceil(barH));
      ctx.globalAlpha = 1;

      stackBottom += val;
    });
  }

  // X-axis labels
  ctx.save();
  ctx.fillStyle = "#9ca3af";
  ctx.font = `9px Inter,-apple-system,sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const labelEvery = n > 20 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    if (i % labelEvery === 0 || i === n - 1) {
      const dayNum = dataStart + i + 1;
      ctx.fillText(`${dayNum}/7`, pad.left + i * slotW + slotW / 2, H - pad.bottom + 5);
    }
  }
  ctx.restore();
}

// Legacy wrapper kept so renderAudit still compiles
function drawLineChart() {
  drawAuditChart();
}

function drawDonut(counts) {
  const canvas = el("osChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const size = 120;
  canvas.width  = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width  = size + "px";
  canvas.style.height = size + "px";
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, size, size);

  const labels = Object.keys(counts);
  const values = Object.values(counts);
  const total  = values.reduce((acc, v) => acc + v, 0);
  if (!total) return;

  // First two OS entries get the brand palette; rest get generic blues
  const palette = ["#4861EE", "#BDD0FB", "#818cf8", "#a5b4fc", "#c7d2fe"];
  const colors  = labels.map((_, i) => palette[i] || palette[palette.length - 1]);

  const cx = size / 2;
  const cy = size / 2;
  const r     = size / 2 - 6;
  const inner = r * 0.62;
  let start   = -Math.PI / 2;

  values.forEach((v, i) => {
    const angle = (v / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = colors[i];
    ctx.fill();
    start += angle;
  });

  // punch hole
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  // center: count
  ctx.fillStyle   = "#1f2937";
  ctx.font        = "bold 22px Inter,sans-serif";
  ctx.textAlign   = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(total, cx, cy + 4);

  // center: "Active sessions" on two lines
  ctx.fillStyle    = "#9ca3af";
  ctx.font         = "10px Inter,sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Active", cx, cy + 17);
  ctx.fillText("sessions", cx, cy + 28);

  // legend
  const legend = el("osLegend");
  if (legend) {
    legend.innerHTML = labels.map((label, i) => {
      const pct = Math.round((values[i] / total) * 100);
      return `<div class="os-legend-item">
        <div class="os-legend-dot" style="background:${colors[i]}"></div>
        <div class="os-legend-info">
          <div class="os-legend-row">
            <span class="os-legend-name">${label}</span>
            <span class="os-legend-count">${values[i]}</span>
          </div>
          <div class="os-legend-pct">${pct}% of users</div>
        </div>
      </div>`;
    }).join("");
  }
}

function renderConnectedTime(sessions) {
  const container = el("connectedTimeBody");
  if (!container) return;

  const live = sessions.filter(s => s?.connectionState === 1).slice(0, 5);
  if (!live.length) {
    container.innerHTML = `<p style="color:#9ca3af;font-size:12px;padding:8px 0">No active sessions</p>`;
    return;
  }

  const avatarColors = ["#3b82f6","#10b981","#f59e0b","#8b5cf6","#ef4444"];
  container.innerHTML = live.map((s, i) => {
    const name = s?.user?.name || "Unknown";
    const initials = name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
    const barW = Math.round(60 + Math.random() * 35);
    const hours = Math.round(24 + Math.random() * 60);
    const mins = Math.round(Math.random() * 59);
    const hh = String(hours).padStart(2, "0");
    const mm = String(mins).padStart(2, "0");
    const color = avatarColors[i % avatarColors.length];
    return `<div class="ct-row">
      <div class="ct-avatar" style="background:${color}">${initials}</div>
      <span class="ct-name">${name}</span>
      <div class="ct-bar-wrap"><div class="ct-bar" style="width:${barW}%;background:${color}"></div></div>
      <span class="ct-time">${hh}h ${mm}m</span>
    </div>`;
  }).join("");
}

function drawRegionsChart() {
  const canvas = el("regionsChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const series = [
    { label: "IL backup", color: "#00df9a", data: [18,22,25,20,28,24,22,19,16,14] },
    { label: "IL",        color: "#3b82f6", data: [8,10,9,11,10,9,8,10,9,8] },
    { label: "Colo",      color: "#f59e0b", data: [3,4,3,5,4,3,4,3,4,3] },
  ];

  const pad = { top: 14, right: 14, bottom: 24, left: 28 };
  const allVals = series.flatMap(s => s.data);
  const maxVal = Math.max(...allVals, 1);
  const steps = series[0].data.length;

  // grid lines
  ctx.strokeStyle = "#f0f3f7";
  ctx.lineWidth = 1;
  [0.25, 0.5, 0.75, 1].forEach(f => {
    const y = pad.top + (1 - f) * (H - pad.top - pad.bottom);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
  });

  const xStep = (W - pad.left - pad.right) / (steps - 1);
  series.forEach(s => {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    s.data.forEach((v, i) => {
      const x = pad.left + i * xStep;
      const y = pad.top + (1 - v / maxVal) * (H - pad.top - pad.bottom);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // dot at last point
    const lx = pad.left + (steps - 1) * xStep;
    const ly = pad.top + (1 - s.data[steps - 1] / maxVal) * (H - pad.top - pad.bottom);
    ctx.beginPath();
    ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = s.color;
    ctx.fill();
  });

  // x-axis labels
  const xLabels = ["02:00","03:00","04:00","05:00","06:00","07:00","08:00","09:00","now"];
  ctx.fillStyle = "#9ca3af";
  ctx.font = "9px Inter,sans-serif";
  ctx.textAlign = "center";
  const labelStep = Math.floor((steps - 1) / (xLabels.length - 1));
  xLabels.forEach((lbl, i) => {
    const x = pad.left + i * labelStep * xStep;
    ctx.fillText(lbl, x, H - 4);
  });
}

function applySessionFilter() {
  const text = el("sessionSearch").value.trim().toLowerCase();
  const rows = el("sessionsBody").querySelectorAll("tr");
  rows.forEach((row) => {
    row.style.display = row.textContent.toLowerCase().includes(text) ? "" : "none";
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderFilterChips() {
  const container = el("searchChips");
  if (!container) return;

  const userVal   = (el("sessionSearch")?.value || "").trim();
  const regionVal = (el("regionSearch")?.value  || "").trim();

  const chips = [];

  if (userVal) {
    chips.push(`<span class="filter-chip">
      <span class="filter-chip-type">User:</span>
      <span>${escapeHtml(userVal)}</span>
      <span class="filter-chip-x" data-clear="user" title="Clear user filter" role="button" aria-label="Clear user filter">
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
      </span>
    </span>`);
  }

  if (regionVal) {
    chips.push(`<span class="filter-chip">
      <span class="filter-chip-type">Region:</span>
      <span>${escapeHtml(regionVal)}</span>
      <span class="filter-chip-x" data-clear="region" title="Clear region filter" role="button" aria-label="Clear region filter">
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
      </span>
    </span>`);
  }

  container.innerHTML = chips.join("");
  container.classList.toggle("has-chips", chips.length > 0);

  container.querySelectorAll(".filter-chip-x").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.clear === "user") {
        el("sessionSearch").value = "";
        applySessionFilter();
        if (typeof window._mapApplyUserFilter === "function") {
          window._mapApplyUserFilter("");
        }
      } else if (btn.dataset.clear === "region") {
        el("regionSearch").value = "";
        if (typeof window._mapApplyRegionFilter === "function") {
          window._mapApplyRegionFilter("");
        }
      }
      renderFilterChips();
    });
  });
}

async function loadData() {
  clearAlerts();
  const token = state.token || (await getStoredToken());
  state.token = token;
  setTokenStatus(Boolean(token));

  if (!token) {
    addAlert("No Authorization token has been captured yet. Open a portal page that calls API endpoints first.", "error");
    return;
  }

  try {
    const [licenses, sessions, audit] = await Promise.all([
      fetchApi(ENDPOINTS.licenses, token),
      fetchApi(ENDPOINTS.sessions, token),
      fetchApi(ENDPOINTS.audit, token)
    ]);
    renderLicenses(licenses);
    renderSessions(sessions);
    renderAudit(audit);
  } catch (error) {
    addAlert(`Failed loading dashboard data: ${error.message}`, "error");
  }
}

async function init() {
  state.token = await getStoredToken();
  setTokenStatus(Boolean(state.token));

  el("refreshBtn").addEventListener("click", loadData);
  el("sessionSearch").addEventListener("input", () => {
    applySessionFilter();
    if (typeof window._mapApplyUserFilter === "function") {
      window._mapApplyUserFilter(el("sessionSearch").value);
    }
    renderFilterChips();
  });

  const regionSearchEl = document.getElementById("regionSearch");
  if (regionSearchEl) {
    regionSearchEl.addEventListener("input", () => {
      if (typeof window._mapApplyRegionFilter === "function") {
        window._mapApplyRegionFilter(regionSearchEl.value);
      }
      renderFilterChips();
    });
  }

  // time-filter buttons (UI only — scope active state to the parent .time-filters group)
  document.querySelectorAll(".time-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const group = btn.closest(".time-filters");
      if (group) group.querySelectorAll(".time-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  // tab buttons
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const group = btn.closest(".tab-group");
      group.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  // ── Audit dropdown ──────────────────────────────────────────────────────────
  const auditDropdown = el("auditDropdown");
  const auditDropdownBtn = el("auditDropdownBtn");
  const auditDropdownLabel = el("auditDropdownLabel");
  const auditDropdownMenu = el("auditDropdownMenu");

  if (auditDropdownBtn && auditDropdown) {
    auditDropdownBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      auditDropdown.classList.toggle("open");
    });

    auditDropdownMenu && auditDropdownMenu.querySelectorAll(".audit-dd-item").forEach(item => {
      item.addEventListener("click", () => {
        auditDropdownMenu.querySelectorAll(".audit-dd-item").forEach(i => i.classList.remove("active"));
        item.classList.add("active");
        auditDropdownLabel.textContent = item.textContent;
        auditDropdown.classList.remove("open");
        currentAuditMode = item.dataset.value;
        updateAuditLegend();
        const canvas = el("auditChart");
        if (canvas) { canvas.width = 0; canvas.height = 0; }
        drawAuditChart();
      });
    });

    document.addEventListener("click", (e) => {
      if (!auditDropdown.contains(e.target)) {
        auditDropdown.classList.remove("open");
      }
    });
  }

  // ── Audit legend (initial render + checkbox binding) ──────────────────────
  updateAuditLegend();

  // ── Audit chart tooltip ─────────────────────────────────────────────────────
  const auditCanvas = el("auditChart");
  const auditTooltip = el("auditTooltip");

  if (auditCanvas && auditTooltip) {
    auditCanvas.addEventListener("mousemove", (e) => {
      const rect = auditCanvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const padLeft = 34;
      const padRight = 10;
      const chartW = rect.width - padLeft - padRight;

      // ── Regions health: diverging bar chart ───────────────────────────────
      if (currentAuditMode === "regions-health") {
        const { n, recovered, down, visibleRecovered, visibleDown } = REGIONS_HEALTH;
        const slotW = chartW / n;
        const dayIdx = Math.max(0, Math.min(n - 1, Math.floor((mouseX - padLeft) / slotW)));
        const date = new Date(2026, 6, dayIdx + 1);
        const dateStr = date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

        let rowsHtml = "";
        if (visibleRecovered) rowsHtml += `
          <div class="audit-tooltip-row">
            <span class="audit-tooltip-cb" style="--cb:#3ecfa3"></span>
            <span class="audit-tooltip-name">Recovered:</span>
            <span class="audit-tooltip-value">${recovered[dayIdx]}</span>
          </div>`;
        if (visibleDown) rowsHtml += `
          <div class="audit-tooltip-row">
            <span class="audit-tooltip-cb" style="--cb:#f28080"></span>
            <span class="audit-tooltip-name">Down:</span>
            <span class="audit-tooltip-value">${down[dayIdx]}</span>
          </div>`;

        auditTooltip.innerHTML = `<div class="audit-tooltip-date">${dateStr}</div>${rowsHtml}`;
        const tipW = 190;
        let tipX = e.clientX + 14;
        if (tipX + tipW > window.innerWidth - 8) tipX = e.clientX - tipW - 14;
        auditTooltip.style.left = tipX + "px";
        auditTooltip.style.top = (e.clientY - 10) + "px";
        auditTooltip.hidden = false;
        drawRegionsHealthChart(dayIdx);
        return;
      }

      // ── All other modes ───────────────────────────────────────────────────
      const isBarMode = currentAuditMode === "session-ops" || currentAuditMode === "policy-ops";
      const totalPts = SESSION_OPS_SERIES[0].data.length;
      const n = auditDays === 7 ? 7 : auditDays === 14 ? 14 : (isBarMode ? totalPts : 31);
      const dataStart = isBarMode ? totalPts - n : 0;

      let dayIdx;
      if (isBarMode) {
        const slotW = chartW / n;
        dayIdx = Math.max(0, Math.min(n - 1, Math.floor((mouseX - padLeft) / slotW)));
      } else {
        const frac = (mouseX - padLeft) / chartW;
        dayIdx = Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
      }

      const absDataIdx = dataStart + dayIdx;
      const date = new Date(2026, 6, absDataIdx + 1);
      const dateStr = date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

      const activeSeries = getActiveAuditSeries();
      const visible = activeSeries.filter(s => s.visible);
      const rowsHtml = visible.map(s =>
        `<div class="audit-tooltip-row">
          <span class="audit-tooltip-dot" style="background:${s.color}"></span>
          <span class="audit-tooltip-name">${s.label}:</span>
          <span class="audit-tooltip-value">${s.data[absDataIdx] ?? 0}</span>
        </div>`
      ).join("");

      let extraHtml = "";
      if (currentAuditMode === "session-region") {
        const uniqueUsers = Math.max(1, Math.round(
          (AUDIT_SERIES[0].data[absDataIdx] + AUDIT_SERIES[1].data[absDataIdx]) / 4
        ));
        extraHtml = `
          <div class="audit-tooltip-extra">
            Unique users: <strong>${uniqueUsers}</strong><br>
            Top policies: <strong>Employees, policy1</strong>
          </div>`;
      } else if (currentAuditMode === "policy-ops") {
        extraHtml = `
          <div class="audit-tooltip-extra">
            Top admin: <strong>David Olivier Lilah</strong><br>
            Policies affected: <strong>Employees</strong>
          </div>`;
      }

      auditTooltip.innerHTML = `
        <div class="audit-tooltip-date">${dateStr}</div>
        ${rowsHtml}
        ${extraHtml}`;

      const tipW = 220;
      let tipX = e.clientX + 14;
      if (tipX + tipW > window.innerWidth - 8) tipX = e.clientX - tipW - 14;
      auditTooltip.style.left = tipX + "px";
      auditTooltip.style.top = (e.clientY - 10) + "px";
      auditTooltip.hidden = false;

      drawAuditChart(dayIdx);
    });

    auditCanvas.addEventListener("mouseleave", () => {
      auditTooltip.hidden = true;
      drawAuditChart();
    });
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.zn_auth_token) return;
      state.token = changes.zn_auth_token.newValue || null;
      setTokenStatus(Boolean(state.token));
    });
  } catch {
    // not running inside a Chrome extension — storage listener unavailable
  }

  // ── Audit time-range buttons ─────────────────────────────────────────────────
  document.querySelectorAll(".time-btn[data-days]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".time-btn[data-days]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      auditDays = parseInt(btn.dataset.days, 10);
      const canvas = el("auditChart");
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      drawAuditChart();
    });
  });

  drawRegionsChart();
  drawAuditChart();

  // Re-draw audit chart on resize — reset pixel dims so needResize triggers
  window.addEventListener("resize", () => {
    const canvas = el("auditChart");
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    requestAnimationFrame(drawAuditChart);
  });

  initMap();
  loadData();
}

init();

// ── Connectivity map ──────────────────────────────────────────────────────────
function initMap() {
  const container = document.getElementById('mapWidget');
  if (!container || typeof L === 'undefined') return;

  const DEFAULT_CENTER = [20, 10];
  const DEFAULT_ZOOM   = 2;

  const map = L.map('mapWidget', {
    zoomControl:       false,
    attributionControl: false,
    scrollWheelZoom:   false,
    dragging:          true,
    doubleClickZoom:   true,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    subdomains: 'abcd',
  }).addTo(map);

  map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);

  // ── Marker helpers ──────────────────────────────────────────────────────────
  const dotIcon = L.divIcon({
    className: '',
    html: '<div style="width:9px;height:9px;border-radius:50%;background:#0CD89B;outline:2px solid #fff;"></div>',
    iconSize:   [9, 9],
    iconAnchor: [4.5, 4.5],
  });

  function clusterIcon(count) {
    return L.divIcon({
      className: '',
      html: `<div style="
        width:25px;height:25px;border-radius:50%;background:#0CD89B;
        display:flex;align-items:center;justify-content:center;
      "><div style="
        width:18.76px;height:18.76px;border-radius:50%;background:#fff;
        display:flex;align-items:center;justify-content:center;
        font-family:Inter,-apple-system,sans-serif;font-size:10px;
        font-weight:600;color:#0F477A;
      ">${count}</div></div>`,
      iconSize:   [25, 25],
      iconAnchor: [12.5, 12.5],
    });
  }

  // ── Named marker data with region metadata ──────────────────────────────────
  const MARKER_DATA = [
    { lat: 37,  lng: -122, region: 'west usa',    icon: dotIcon,          count: 1  },
    { lat: 40,  lng:  -74, region: 'east usa',    icon: clusterIcon(8),   count: 8  },
    { lat: 51,  lng:   10, region: 'west europe', icon: clusterIcon(20),  count: 20 },
    { lat: 32,  lng:   35, region: 'middle east', icon: clusterIcon(12),  count: 12 },
    { lat:  4,  lng:   38, region: 'east africa', icon: dotIcon,          count: 1  },
    { lat: 22,  lng:   77, region: 'india',       icon: dotIcon,          count: 1  },
    { lat: -25, lng:  133, region: 'australia',   icon: dotIcon,          count: 1  },
  ];

  // Keep leaflet layer references so we can show/hide them
  const markerLayers = MARKER_DATA.map(d => ({
    ...d,
    layer: L.marker([d.lat, d.lng], { icon: d.icon }).addTo(map),
  }));

  // ── Auto-focus helpers ──────────────────────────────────────────────────────
  function focusOnMarkers(markers, pad = 0.3) {
    if (!markers.length) {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      return;
    }
    if (markers.length === 1) {
      map.setView([markers[0].lat, markers[0].lng], 5, { animate: true });
      return;
    }
    const bounds = L.latLngBounds(markers.map(m => [m.lat, m.lng]));
    map.fitBounds(bounds, { padding: [40, 40], animate: true, maxZoom: 7 });
  }

  function focusAll() {
    focusOnMarkers(markerLayers);
  }

  // Show all markers and reset to full world view
  function showAllMarkers() {
    markerLayers.forEach(m => { if (!map.hasLayer(m.layer)) map.addLayer(m.layer); });
  }

  // Filter markers by region query string, hide non-matching, auto-fit bounds
  function applyRegionFilter(query) {
    const text = query.trim().toLowerCase();
    let visible = [];
    markerLayers.forEach(m => {
      const match = !text || m.region.includes(text);
      if (match) {
        if (!map.hasLayer(m.layer)) map.addLayer(m.layer);
        visible.push(m);
      } else {
        if (map.hasLayer(m.layer)) map.removeLayer(m.layer);
      }
    });
    focusOnMarkers(visible);
  }

  // Focus on a set of region names derived from the session/user filter
  function applyUserFilter(query) {
    const text = query.trim().toLowerCase();
    if (!text) {
      showAllMarkers();
      focusAll();
      return;
    }
    // Use live session data from state to find which regions match the user query
    const sessionRegions = new Set(
      (state.sessions || [])
        .filter(s => {
          const name = (s?.userName || s?.user?.name || s?.userId || '').toLowerCase();
          return name.includes(text);
        })
        .map(s => (s?.region?.name || s?.region || s?.regionId || s?.site?.name || '').toLowerCase())
        .filter(Boolean)
    );

    if (!sessionRegions.size) {
      // No region data for this user — keep all markers visible but zoom out
      showAllMarkers();
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: true });
      return;
    }

    let visible = [];
    markerLayers.forEach(m => {
      const match = [...sessionRegions].some(r => m.region.includes(r) || r.includes(m.region));
      if (match) {
        if (!map.hasLayer(m.layer)) map.addLayer(m.layer);
        visible.push(m);
      } else {
        if (map.hasLayer(m.layer)) map.removeLayer(m.layer);
      }
    });
    focusOnMarkers(visible);
  }

  // Expose map auto-focus so filters can call it
  window._mapApplyRegionFilter = applyRegionFilter;
  window._mapApplyUserFilter   = applyUserFilter;
  window._mapFocusAll          = () => { showAllMarkers(); focusAll(); };

  // ── Map tab wiring ──────────────────────────────────────────────────────────
  const mapTabGroup = document.getElementById('mapTabGroup');
  if (mapTabGroup) {
    mapTabGroup.querySelectorAll('.tab-btn[data-map-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.mapTab;
        showAllMarkers();
        if (tab === 'all' || tab === 'users') {
          // Respect any active text filters
          const regionQuery = (document.getElementById('regionSearch') || {}).value || '';
          const userQuery   = (document.getElementById('sessionSearch') || {}).value || '';
          if (regionQuery.trim()) applyRegionFilter(regionQuery);
          else if (tab === 'users' && userQuery.trim()) applyUserFilter(userQuery);
          else focusAll();
        } else {
          // Regions tab — fit all region markers with slight zoom
          focusOnMarkers(markerLayers);
        }
      });
    });
  }

  // Initial fit to all markers
  focusAll();

  // ── Custom control wiring ───────────────────────────────────────────────────
  const focusBtn   = document.getElementById('mapFocus');
  const zoomInBtn  = document.getElementById('mapZoomIn');
  const zoomOutBtn = document.getElementById('mapZoomOut');

  if (focusBtn)   focusBtn.addEventListener('click',   () => { showAllMarkers(); map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: true }); });
  if (zoomInBtn)  zoomInBtn.addEventListener('click',  () => map.zoomIn());
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => map.zoomOut());
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

    fetch(FORMSPREE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        type: type,
        email: email || '(not provided)',
        message: message
      })
    })
    .then(function (res) {
      return res.json().then(function (data) { return { ok: res.ok, data: data }; });
    })
    .then(function (result) {
      if (result.ok) {
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
  });
}());
