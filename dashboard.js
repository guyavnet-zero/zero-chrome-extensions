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

  el("kpiLicenses").textContent = `${inUse} out of ${limit}`;
  el("kpiLicenses").className = `kpi-value${pct >= 100 ? " kpi-danger" : pct >= 85 ? " kpi-warn" : ""}`;
  el("licenseBar").style.width = `${Math.min(pct, 100)}%`;
  el("licenseBar").style.background = pct >= 100 ? "#dc2626" : pct >= 85 ? "#f59e0b" : "#00df9a";

  if (pct >= 85) addAlert(`License utilization is high (${pct}%).`);
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

  el("kpiActive").textContent = String(connected);
  const subEl = el("kpiActiveSub");
  if (subEl) subEl.textContent = `out of ${total} total`;
  el("kpiDisconnected").textContent = String(disconnected);
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

function drawLineChart(buckets) {
  const canvas = el("auditChart");
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const labels = Object.keys(buckets);
  const values = labels.map((k) => buckets[k]);
  if (!values.length) return;

  const max = Math.max(...values, 1);
  const left = 32;
  const bottom = height - 26;
  const top = 18;
  const right = width - 18;

  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.stroke();

  const step = values.length > 1 ? (right - left) / (values.length - 1) : 0;
  ctx.strokeStyle = "#00df9a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = left + i * step;
    const y = bottom - ((v / max) * (bottom - top));
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function drawDonut(counts) {
  const canvas = el("osChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const values = Object.values(counts);
  const labels = Object.keys(counts);
  const total = values.reduce((acc, v) => acc + v, 0);
  if (!total) return;

  const colors = ["#00df9a", "#3b82f6", "#f59e0b", "#ec4899", "#a855f7", "#6366f1"];
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(cx, cy) - 8;
  const inner = r * 0.56;
  let start = -Math.PI / 2;

  values.forEach((v, i) => {
    const angle = (v / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    start += angle;
  });

  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  // centre label
  ctx.fillStyle = "#1f2937";
  ctx.font = `bold ${Math.round(r * 0.35)}px Inter,sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(total, cx, cy - 4);
  ctx.fillStyle = "#9ca3af";
  ctx.font = `${Math.round(r * 0.18)}px Inter,sans-serif`;
  ctx.fillText("Active", cx, cy + Math.round(r * 0.22));

  // external legend
  const legend = el("osLegend");
  if (legend) {
    legend.innerHTML = labels.map((label, i) => {
      const pct = Math.round((values[i] / total) * 100);
      return `<div class="os-legend-item">
        <div class="os-legend-dot" style="background:${colors[i % colors.length]}"></div>
        <span class="os-legend-name">${label}</span>
        <span class="os-legend-count">${values[i]} &nbsp;<small>${pct}%</small></span>
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
  el("sessionSearch").addEventListener("input", applySessionFilter);

  // time-filter buttons (UI only for now)
  document.querySelectorAll(".time-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".time-btn").forEach(b => b.classList.remove("active"));
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

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.zn_auth_token) return;
      state.token = changes.zn_auth_token.newValue || null;
      setTokenStatus(Boolean(state.token));
    });
  } catch {
    // not running inside a Chrome extension — storage listener unavailable
  }

  drawRegionsChart();
  loadData();
}

init();
