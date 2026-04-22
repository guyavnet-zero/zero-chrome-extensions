// @ts-nocheck
(function () {
  "use strict";

  function isExtensionContextValid() {
    try { return !!chrome.runtime?.id; } catch (_) { return false; }
  }

  // Forward tokens relayed by page-token-bridge.js (MAIN world) to the
  // background service worker so it can persist them in chrome.storage.local.
  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== "ZN_TOKEN_CAPTURED") return;
    var token = event.data.token;
    if (!token || String(token).trim().length < 24) return;
    if (!isExtensionContextValid()) return;
    try {
      chrome.runtime.sendMessage({ type: "ZN_TOKEN_CAPTURED", token: String(token).trim(), host: location.hostname });
    } catch (_) {}
  });

  // #region agent log — relay debug logs from MAIN world through to background.js
  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== "ZN_DBG_717b26") return;
    if (!isExtensionContextValid()) return;
    try { chrome.runtime.sendMessage({ type: "ZN_DBG_717b26", payload: event.data.payload }); } catch (_) {}
  });
  // #endregion

  // Tell the page to fire a fresh authenticated API call so background.js
  // can intercept it and store a new token in chrome.storage.
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (!isExtensionContextValid()) return false;
    try {
      if (request.action === 'triggerFreshApiCall') {
        window.postMessage({ type: 'ZN_TRIGGER_FRESH_API' }, '*');
        sendResponse({ ok: true });
      }
    } catch (_) {}
    return false;
  });

  const BTN_ID   = "zn-dashboard-beta-button";
  const MOUNT_ID = "zn-dashboard-beta-mount";
  const STORAGE_KEY = "zn-connect-dashboard-open";

  let globalListenersAttached = false;
  let mutationObserver = null;
  let injectRaf = null;
  let mutationRepositionRaf = null;
  let znDrillReorderObserver = null;
  let znDrillObservedEl = null;
  let znDrillObsRaf = null;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function normalize(text) {
    return (text || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  /** Elements the portal may use for Connect rows (Material + plain HTML + ZN sidebar). */
  const CONNECT_NAV_CANDIDATE_SELECTOR =
    "a.zn-route-sidebar-item, a, button, li, [role='menuitem'], [role='listitem'], mat-list-item, " +
    ".mat-mdc-list-item, .mdc-list-item, .mat-list-item";

  function getSidebarSearchRoot() {
    const zn = document.querySelector(".zn-sidebar");
    if (zn) return zn;
    const aside = document.querySelector("aside");
    if (aside) return aside;
    for (const nav of document.querySelectorAll("nav")) {
      const r = nav.getBoundingClientRect?.();
      if (r && r.left <= 56 && r.width > 20 && r.width <= 440) return nav;
    }
    return document.documentElement;
  }

  /**
   * Finds a sidebar row whose visible text equals `label`.
   * When preferLast is true, uses the last match in the sidebar — avoids a stray
   * earlier duplicate and matches the real Material row order.
   */
  function findConnectNavLabelElement(label, preferLast) {
    const needle = normalize(label);
    const root = getSidebarSearchRoot();
    const matches = Array.from(root.querySelectorAll(CONNECT_NAV_CANDIDATE_SELECTOR)).filter(
      (el) => normalize(el.textContent) === needle
    );
    if (matches.length === 0) return null;
    return preferLast ? matches[matches.length - 1] : matches[0];
  }

  function findNavItem(label) {
    return findConnectNavLabelElement(label, false);
  }

  /** Last sidebar node whose text clearly is the Device Posture row (Material quirks). */
  function findDevicePostureRowFallback(root) {
    const matches = Array.from(root.querySelectorAll(CONNECT_NAV_CANDIDATE_SELECTOR)).filter(
      (el) => {
        const t = normalize(el.textContent);
        return t.includes("device posture");
      }
    );
    return matches.length ? matches[matches.length - 1] : null;
  }

  /**
   * Zero portal uses <a class="zn-route-sidebar-item" href="#/connect/device-posture"> — resolve
   * by route when label text is split across children or delayed.
   */
  function findDevicePostureRouteAnchor(root) {
    const matches = Array.from(
      root.querySelectorAll(
        'a.zn-route-sidebar-item[href*="connect/device-posture"], a[href*="/connect/device-posture"]'
      )
    );
    return matches.length ? matches[matches.length - 1] : null;
  }

  function findDevicePostureNavElement(root) {
    let el = findConnectNavLabelElement("Device Posture", true);
    if (el) return el;
    el = findDevicePostureRowFallback(root);
    if (el) return el;
    return findDevicePostureRouteAnchor(root);
  }

  /** Zero portal Connect drill-down: native rows live in these items; we mount our control as its own item. */
  const ZN_DRILL_DOWN_CONTENT_SEL = ".zn-main-drill-down__content";
  const ZN_DRILL_DOWN_SHELL_SEL = ".zn-main-drill-down";
  const ZN_DRILL_DOWN_ITEM_SEL = ".zn-main-drill-down__content__item";
  const ZN_BETA_ITEM_WRAP_ATTR = "data-zn-dashboard-beta-item";
  const ZN_BETA_ROW_CLASS = "zn-dashboard-beta-extension-row";

  /** Flex/grid on the portal can paint siblings out of DOM order — force our row last. */
  function applyZnBetaRowVisualOrder(wrap) {
    if (!wrap) return;
    wrap.style.setProperty("order", "9999", "important");
    wrap.style.setProperty("flex-shrink", "0", "important");
    wrap.style.setProperty("align-self", "stretch", "important");
  }

  /** Direct `.__content__item` row children of the drill list (ignores text nodes / stray divs). */
  function getZnDrillDirectItemRows(drillContent) {
    if (!drillContent) return [];
    return Array.prototype.filter.call(drillContent.children, function (c) {
      return c.nodeType === Node.ELEMENT_NODE && c.matches && c.matches(ZN_DRILL_DOWN_ITEM_SEL);
    });
  }

  function ensureZnDashboardBetaItemWrapper(btn) {
    if (!btn) return null;
    const existing = btn.closest("[" + ZN_BETA_ITEM_WRAP_ATTR + "]");
    if (existing) return existing;
    const wrap = document.createElement("div");
    wrap.setAttribute(ZN_BETA_ITEM_WRAP_ATTR, "true");
    wrap.className = "zn-main-drill-down__content__item " + ZN_BETA_ROW_CLASS;
    const inner = document.createElement("div");
    inner.className = "zn-sidebar-item";
    inner.appendChild(btn);
    wrap.appendChild(inner);
    const divider = document.createElement("div");
    divider.className = "zn-main-drill-down__divider";
    wrap.appendChild(divider);
    return wrap;
  }

  /** Drop the synthetic content__item wrapper when falling back to legacy injection. */
  function detachZnDashboardBetaItemWrapper(btn) {
    if (!btn) return;
    const wrap = btn.closest("[" + ZN_BETA_ITEM_WRAP_ATTR + "]");
    if (!wrap) return;
    const p = wrap.parentNode;
    if (!p) return;
    p.insertBefore(btn, wrap);
    wrap.remove();
  }

  /** Prefer the visible Connect drill list (SPA may mount multiple drill-down regions). */
  function scoreZnDrillContentEl(el) {
    if (!el || !el.isConnected) return -1;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return -1;
    const items = el.querySelectorAll(ZN_DRILL_DOWN_ITEM_SEL).length;
    const hasSessions = !!el.querySelector('a[href*="connect/sessions"], a[href*="/connect/sessions"]');
    const hasPosture = !!el.querySelector('a[href*="device-posture"], a[href*="device_posture"]');
    return (hasSessions ? 4000 : 0) + (hasPosture ? 2000 : 0) + Math.min(items, 99);
  }

  /** Drill-down list in the left shell — must not use the first global match (SPA can duplicate markup). */
  function getZnConnectDrillDownContent() {
    const inSidebar = document.querySelectorAll(".zn-sidebar " + ZN_DRILL_DOWN_CONTENT_SEL);
    if (inSidebar.length) {
      let best = null;
      let bestScore = -1;
      inSidebar.forEach((el) => {
        const s = scoreZnDrillContentEl(el);
        if (s > bestScore) {
          bestScore = s;
          best = el;
        }
      });
      if (best) return best;
    }
    const shell =
      document.querySelector(".zn-sidebar__content .zn-main-drill-down") ||
      document.querySelector(".zn-sidebar .zn-main-drill-down");
    if (shell) {
      const inner = shell.querySelector(ZN_DRILL_DOWN_CONTENT_SEL);
      if (inner) return inner;
    }
    return document.querySelector(ZN_DRILL_DOWN_CONTENT_SEL);
  }

  /** When scoring missed (e.g. timing), recover the Connect list from an already-mounted control. */
  function getZnConnectDrillDownContentFromButton(btn) {
    if (!btn || !btn.closest) return null;
    const fromBtn = btn.closest(ZN_DRILL_DOWN_CONTENT_SEL);
    if (fromBtn) return fromBtn;
    return null;
  }

  /**
   * Last-resort: a known Connect route anchor almost always lives inside the real drill list.
   * (Try several routes so we still resolve when e.g. Device Posture is not rendered yet.)
   */
  function getZnConnectDrillDownContentByRoute() {
    const selectors = [
      ".zn-sidebar a[href*=\"connect/device-posture\"]",
      ".zn-sidebar a[href*=\"connect/sessions\"]",
      ".zn-sidebar a[href*=\"connect/policies\"]",
      "a.zn-route-sidebar-item[href*=\"connect/device-posture\"]",
      "a[href*=\"#/connect/device-posture\"]",
      "a[href*=\"#/connect/sessions\"]",
    ];
    for (var i = 0; i < selectors.length; i++) {
      var a = document.querySelector(selectors[i]);
      if (a) {
        var d = a.closest(ZN_DRILL_DOWN_CONTENT_SEL);
        if (d) return d;
      }
    }
    return null;
  }

  /** Route-based anchor: Device Posture row inside this drill list (last match wins if duplicated). */
  function findDevicePostureDrillContentItem(drillContent) {
    if (!drillContent) return null;
    const anchors = drillContent.querySelectorAll(
      'a[href*="device-posture"], a[href*="device_posture"], a[href*="DevicePosture"]'
    );
    if (!anchors.length) return null;
    const a = anchors[anchors.length - 1];
    const row = a.closest(ZN_DRILL_DOWN_ITEM_SEL);
    if (!row || row.hasAttribute(ZN_BETA_ITEM_WRAP_ATTR)) return null;
    return row;
  }

  /**
   * Row after which we mount Dashboard (Beta): always the Device Posture entry when present,
   * so the control is the last Connect drill item — not after Policies.
   */
  function findLastZnDrillNativeConnectItem(drillContent) {
    if (!drillContent) return null;
    const items = Array.from(drillContent.querySelectorAll(ZN_DRILL_DOWN_ITEM_SEL)).filter(
      function (item) {
        if (item.hasAttribute(ZN_BETA_ITEM_WRAP_ATTR)) return false;
        return !!item.querySelector(
          'a.zn-route-sidebar-item, a[href*="connect"], a[href*="#/connect"]'
        );
      }
    );
    if (!items.length) return null;
    for (var i = items.length - 1; i >= 0; i--) {
      var row = items[i];
      if (
        row.querySelector(
          'a[href*="device-posture"], a[href*="device_posture"], a[href*="DevicePosture"]'
        )
      ) {
        return row;
      }
    }
    return items[items.length - 1];
  }

  /** Row host for list parents — ZN sidebar anchors + Material list items are often not <li>. */
  function toConnectNavRowHost(el) {
    if (!el) return null;
    return (
      el.closest(
        "a.zn-route-sidebar-item, mat-list-item, .mat-mdc-list-item, .mdc-list-item, [role='listitem'], li"
      ) || el
    );
  }

  /** Labels for native Connect sidebar entries (order here does not matter). */
  const KNOWN_CONNECT_NAV_LABELS = ["Device Posture", "Policies", "Sessions"];

  /**
   * Returns whichever known Connect nav node appears last in the document.
   * The portal may split items across multiple lists (e.g. Policies in one ul,
   * Device Posture in another); anchoring to the last match keeps our control
   * visually below every native item we can detect.
   */
  function findLastKnownConnectNavItem() {
    const root = getSidebarSearchRoot();
    let best = null;
    for (const label of KNOWN_CONNECT_NAV_LABELS) {
      let el =
        label === "Device Posture"
          ? findDevicePostureNavElement(root)
          : findConnectNavLabelElement(label, true);
      if (!el) continue;
      if (
        !best ||
        (best.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
      ) {
        best = el;
      }
    }
    return best;
  }

  /** True when a mutated node is part of the left-hand portal shell (aside / narrow nav). */
  function touchesConnectSidebarNav(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.id === BTN_ID) return false;
    if (node.closest?.("#" + BTN_ID)) return false;
    if (node.closest?.(".zn-sidebar, .zn-main-drill-down")) return true;
    if (node.matches?.("aside")) return true;
    if (node.closest?.("aside")) return true;
    const nav = node.closest?.("nav");
    if (nav) {
      const r = nav.getBoundingClientRect?.();
      if (r && r.left <= 48 && r.width > 20 && r.width <= 420) return true;
    }
    return false;
  }

  function scheduleRepositionFromSidebarMutation() {
    if (mutationRepositionRaf != null) return;
    mutationRepositionRaf = requestAnimationFrame(() => {
      mutationRepositionRaf = null;
      ensureButtonIsLast();
    });
  }

  function subtreeContainsZnBetaWrap(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return false;
    if (root.matches?.("[" + ZN_BETA_ITEM_WRAP_ATTR + "]")) return true;
    return !!root.querySelector?.("[" + ZN_BETA_ITEM_WRAP_ATTR + "]");
  }

  function disconnectZnDrillReorderObserver() {
    if (znDrillObsRaf != null) {
      cancelAnimationFrame(znDrillObsRaf);
      znDrillObsRaf = null;
    }
    if (znDrillReorderObserver) {
      znDrillReorderObserver.disconnect();
      znDrillReorderObserver = null;
    }
    znDrillObservedEl = null;
  }

  /**
   * Vue can reorder children of `.zn-main-drill-down__content` after we append.
   * Watch **only** that list (cheap) and snap our wrapper back to the last row slot.
   */
  function attachZnDrillReorderObserver(drillContent) {
    if (!drillContent) return;
    if (znDrillObservedEl === drillContent && znDrillReorderObserver) return;
    disconnectZnDrillReorderObserver();
    znDrillObservedEl = drillContent;
    znDrillReorderObserver = new MutationObserver(function () {
      if (!drillContent.isConnected) {
        disconnectZnDrillReorderObserver();
        return;
      }
      if (znDrillObsRaf != null) return;
      znDrillObsRaf = requestAnimationFrame(function () {
        znDrillObsRaf = null;
        var b = getLiveDashboardButton();
        if (!b || !isConnectRoute()) return;
        var w = b.closest("[" + ZN_BETA_ITEM_WRAP_ATTR + "]");
        if (!w) {
          moveDashboardButtonToEndOfConnectNav(b, true);
          return;
        }
        var rows = getZnDrillDirectItemRows(drillContent);
        if (!rows.length || rows[rows.length - 1] !== w) {
          drillContent.appendChild(w);
          applyZnBetaRowVisualOrder(w);
        }
      });
    });
    znDrillReorderObserver.observe(drillContent, { childList: true, subtree: true });
  }

  /** Global CSS so our row wins flex/grid paint order even when another extension touches the sidebar. */
  function ensureZnDashboardBetaOrderStyle() {
    const existing = document.getElementById("zn-dashboard-beta-order-style");
    if (existing) existing.remove(); // always replace so the latest CSS version is used
    var st = document.createElement("style");
    st.id = "zn-dashboard-beta-order-style";
    st.textContent =
      // Keep our row last in flex/grid paint order
      ".zn-sidebar .zn-main-drill-down__content > .zn-dashboard-beta-extension-row," +
      ".zn-sidebar .zn-main-drill-down__content > [" + ZN_BETA_ITEM_WRAP_ATTR + "]" +
      "{order:2147483647!important;}" +

      // Base: all native Connect nav items get readable light text on the dark sidebar.
      // This covers the icon (SVG uses currentColor) + label text in one rule.
      // The :not() guard prevents bleeding into our own Dashboard (Beta) button wrapper.
      ".zn-sidebar .zn-main-drill-down__content__item:not([" + ZN_BETA_ITEM_WRAP_ATTR + "])," +
      ".zn-sidebar .zn-main-drill-down__content__item:not([" + ZN_BETA_ITEM_WRAP_ATTR + "]) a," +
      ".zn-sidebar .zn-main-drill-down__content__item:not([" + ZN_BETA_ITEM_WRAP_ATTR + "]) mat-icon," +
      ".zn-sidebar .zn-main-drill-down__content__item:not([" + ZN_BETA_ITEM_WRAP_ATTR + "]) .mdc-list-item__primary-text," +
      ".zn-sidebar .zn-main-drill-down__content__item:not([" + ZN_BETA_ITEM_WRAP_ATTR + "]) .mat-mdc-list-item-unscoped-content," +
      ".zn-sidebar a.zn-route-sidebar-item" +
      "{color:#cbd5e1!important;}" +

      // Active / exact-active route: Angular router can put router-link-active on the
      // <a> itself OR on the parent mat-list-item host — cover both patterns.
      // White text keeps the icon + label readable on the dark sidebar.
      ".zn-sidebar a.zn-route-sidebar-item.router-link-active," +
      ".zn-sidebar a.zn-route-sidebar-item.router-link-exact-active," +
      ".zn-sidebar a.zn-route-sidebar-item.active," +
      ".zn-sidebar a.zn-route-sidebar-item.zn-active," +
      ".zn-sidebar mat-list-item.router-link-active a.zn-route-sidebar-item," +
      ".zn-sidebar mat-list-item.router-link-exact-active a.zn-route-sidebar-item," +
      ".zn-sidebar .mat-mdc-list-item.router-link-active a," +
      ".zn-sidebar .mat-mdc-list-item.router-link-exact-active a," +
      ".zn-sidebar .mdc-list-item.router-link-active a," +
      ".zn-sidebar .mdc-list-item.router-link-exact-active a," +
      ".zn-sidebar .zn-main-drill-down__content__item.router-link-active a," +
      ".zn-sidebar .zn-main-drill-down__content__item.router-link-exact-active a," +
      ".zn-sidebar .zn-main-drill-down__content__item.active a," +
      // Also target text/icon children of any active host
      ".zn-sidebar mat-list-item.router-link-active .mdc-list-item__primary-text," +
      ".zn-sidebar mat-list-item.router-link-exact-active .mdc-list-item__primary-text," +
      ".zn-sidebar mat-list-item.router-link-active mat-icon," +
      ".zn-sidebar mat-list-item.router-link-exact-active mat-icon," +
      ".zn-sidebar .mat-mdc-list-item.router-link-active .mdc-list-item__primary-text," +
      ".zn-sidebar .mat-mdc-list-item.router-link-exact-active .mdc-list-item__primary-text," +
      ".zn-sidebar a.zn-route-sidebar-item.router-link-active .mdc-list-item__primary-text," +
      ".zn-sidebar a.zn-route-sidebar-item.router-link-exact-active .mdc-list-item__primary-text," +
      ".zn-sidebar a.zn-route-sidebar-item.active .mdc-list-item__primary-text" +
      "{color:#ffffff!important;}" +

      // When the Dashboard overlay is open the portal's router still marks the last
      // visited portal route as active (green highlight + dark text).  Strip that
      // highlight so no portal item appears selected while Dashboard is showing.
      "html.zn-dashboard-beta-active .zn-sidebar mat-list-item.router-link-active," +
      "html.zn-dashboard-beta-active .zn-sidebar mat-list-item.router-link-exact-active," +
      "html.zn-dashboard-beta-active .zn-sidebar mat-list-item.active," +
      "html.zn-dashboard-beta-active .zn-sidebar .mat-mdc-list-item.router-link-active," +
      "html.zn-dashboard-beta-active .zn-sidebar .mat-mdc-list-item.router-link-exact-active," +
      "html.zn-dashboard-beta-active .zn-sidebar .mdc-list-item.router-link-active," +
      "html.zn-dashboard-beta-active .zn-sidebar .mdc-list-item.router-link-exact-active," +
      "html.zn-dashboard-beta-active .zn-sidebar a.zn-route-sidebar-item.router-link-active," +
      "html.zn-dashboard-beta-active .zn-sidebar a.zn-route-sidebar-item.router-link-exact-active," +
      "html.zn-dashboard-beta-active .zn-sidebar a.zn-route-sidebar-item.active," +
      "html.zn-dashboard-beta-active .zn-sidebar .zn-main-drill-down__content__item.router-link-active," +
      "html.zn-dashboard-beta-active .zn-sidebar .zn-main-drill-down__content__item.router-link-exact-active" +
      "{background:transparent!important;background-color:transparent!important;color:#cbd5e1!important;}" +

      "html.zn-dashboard-beta-active .zn-sidebar mat-list-item.router-link-active .mdc-list-item__primary-text," +
      "html.zn-dashboard-beta-active .zn-sidebar mat-list-item.router-link-exact-active .mdc-list-item__primary-text," +
      "html.zn-dashboard-beta-active .zn-sidebar mat-list-item.router-link-active mat-icon," +
      "html.zn-dashboard-beta-active .zn-sidebar mat-list-item.router-link-exact-active mat-icon," +
      "html.zn-dashboard-beta-active .zn-sidebar a.zn-route-sidebar-item.router-link-active .mdc-list-item__primary-text," +
      "html.zn-dashboard-beta-active .zn-sidebar a.zn-route-sidebar-item.router-link-exact-active .mdc-list-item__primary-text" +
      "{color:#cbd5e1!important;}" +

      // The diagnostic confirmed background-color is already transparent — the green
      // highlight must come from a ::before/::after pseudo-element (common in Vue/Angular
      // scoped CSS for active-state indicators). Reset those and also clear box-shadow/border.
      // IMPORTANT: Only target pseudo-elements on ACTIVE items — targeting all items would
      // wipe out hover shadows and cause label visual glitches on non-active rows.
      "html.zn-dashboard-beta-active .zn-sidebar .zn-main-drill-down__content__item.router-link-active::before," +
      "html.zn-dashboard-beta-active .zn-sidebar .zn-main-drill-down__content__item.router-link-active::after," +
      "html.zn-dashboard-beta-active .zn-sidebar .zn-main-drill-down__content__item.router-link-exact-active::before," +
      "html.zn-dashboard-beta-active .zn-sidebar .zn-main-drill-down__content__item.router-link-exact-active::after," +
      "html.zn-dashboard-beta-active .zn-sidebar .zn-main-drill-down__content__item.active::before," +
      "html.zn-dashboard-beta-active .zn-sidebar .zn-main-drill-down__content__item.active::after," +
      "html.zn-dashboard-beta-active .zn-sidebar .zn-sidebar-item.router-link-active::before," +
      "html.zn-dashboard-beta-active .zn-sidebar .zn-sidebar-item.router-link-active::after," +
      "html.zn-dashboard-beta-active .zn-sidebar .zn-sidebar-item.router-link-exact-active::before," +
      "html.zn-dashboard-beta-active .zn-sidebar .zn-sidebar-item.router-link-exact-active::after," +
      "html.zn-dashboard-beta-active .zn-sidebar a.zn-route-sidebar-item.router-link-active::before," +
      "html.zn-dashboard-beta-active .zn-sidebar a.zn-route-sidebar-item.router-link-active::after," +
      "html.zn-dashboard-beta-active .zn-sidebar a.zn-route-sidebar-item.router-link-exact-active::before," +
      "html.zn-dashboard-beta-active .zn-sidebar a.zn-route-sidebar-item.router-link-exact-active::after," +
      "html.zn-dashboard-beta-active .zn-sidebar a.zn-route-sidebar-item.active::before," +
      "html.zn-dashboard-beta-active .zn-sidebar a.zn-route-sidebar-item.active::after" +
      "{background:transparent!important;background-color:transparent!important;" +
      "box-shadow:none!important;opacity:0!important;}" +

      // ROOT CAUSE (confirmed by diagnostic): the green highlight is on div.zn-sidebar-item-base
      // (bg: rgb(12,216,155)) — a child INSIDE the <a> tag. All previous rules targeted the <a>
      // and its ancestors, but missed this inner element. Target it directly.
      // IMPORTANT: Scope to the ACTIVE anchor only — applying background:transparent to ALL
      // .zn-sidebar-item-base elements breaks label rendering on non-active items.
      // Diagnostic confirmed: the portal sets color:rgb(34,42,85) (dark navy) on the active
      // .zn-sidebar-item-base — designed for dark text on green bg.  When we remove the green
      // bg we must also restore the text colour, otherwise the label is invisible on the dark
      // sidebar.  Add color:#cbd5e1 to match all other non-active nav items.
      "html.zn-dashboard-beta-active .zn-sidebar a.zn-route-sidebar-item--active .zn-sidebar-item-base," +
      "html.zn-dashboard-beta-active .zn-sidebar a.zn-route-sidebar-item--active .zn-sidebar-item-base__icon," +
      "html.zn-dashboard-beta-active .zn-sidebar a.zn-route-sidebar-item--active .zn-sidebar-item-base svg," +
      "html.zn-dashboard-beta-active .zn-sidebar a.zn-route-sidebar-item--active .zn-sidebar-item-base path" +
      "{background-color:transparent!important;color:#cbd5e1!important;fill:currentColor!important;}";
    (document.head || document.documentElement).appendChild(st);
  }

  /** True when our row is the last Connect drill item row, or in an accepted shell / host fallback. */
  function isZnBetaWrapPlacedCorrectly(wrap, drillContent) {
    if (!wrap || !drillContent || !wrap.isConnected) return false;
    if (wrap.parentNode === drillContent) {
      var rows = getZnDrillDirectItemRows(drillContent);
      if (rows.length && rows[rows.length - 1] === wrap) return true;
    }
    const shell = drillContent.closest(ZN_DRILL_DOWN_SHELL_SEL);
    if (shell && wrap.parentNode === shell && !drillContent.contains(wrap)) {
      var pos = drillContent.compareDocumentPosition(wrap);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return true;
    }
    const host = shell && shell.parentElement;
    if (shell && host && wrap.parentNode === host && wrap.previousElementSibling === shell) return true;
    const mountParent = drillContent.parentNode;
    if (mountParent) {
      return wrap.parentNode === mountParent && wrap.previousElementSibling === drillContent;
    }
    return false;
  }

  /**
   * Place the dashboard control after every native Connect item we recognize.
   * **`drillContent.appendChild(wrap)`** is the primary fix: it always makes our synthetic
   * `.__content__item` the **last row** under `.zn-main-drill-down__content`, regardless of
   * dividers or earlier mis-insertions (Vue often leaves the node between Policies and
   * Posture if we only `insertAdjacentElement` after posture). We still set a high flex
   * `order` so painted order matches when the list uses flex/grid.
   */
  function moveDashboardButtonToEndOfConnectNav(btn, skipDeferredFollowUp) {
    if (!btn) return;
    var drillContent =
      getZnConnectDrillDownContentFromButton(btn) ||
      getZnConnectDrillDownContent() ||
      getZnConnectDrillDownContentByRoute();

    if (drillContent) {
      const wrap = ensureZnDashboardBetaItemWrapper(btn);
      var moved = false;
      if (isZnBetaWrapPlacedCorrectly(wrap, drillContent)) {
        applyZnBetaRowVisualOrder(wrap);
        attachZnDrillReorderObserver(drillContent);
        if (!skipDeferredFollowUp) {
          queueMicrotask(function () {
            var b = getLiveDashboardButton();
            var d =
              getZnConnectDrillDownContentFromButton(b) ||
              getZnConnectDrillDownContent() ||
              getZnConnectDrillDownContentByRoute();
            var w = b && b.closest("[" + ZN_BETA_ITEM_WRAP_ATTR + "]");
            if (b && d && w && !isZnBetaWrapPlacedCorrectly(w, d)) {
              moveDashboardButtonToEndOfConnectNav(b, true);
            }
          });
        }
        return;
      }
      drillContent.appendChild(wrap);
      moved = true;
      applyZnBetaRowVisualOrder(wrap);
      attachZnDrillReorderObserver(drillContent);
      if (moved && !skipDeferredFollowUp) {
        queueMicrotask(function () {
          var b = getLiveDashboardButton();
          if (b) moveDashboardButtonToEndOfConnectNav(b, true);
        });
      }
      return;
    }

    disconnectZnDrillReorderObserver();
    detachZnDashboardBetaItemWrapper(btn);

    const lastNative = findLastKnownConnectNavItem();
    const drillViaNav =
      lastNative && lastNative.closest && lastNative.closest(ZN_DRILL_DOWN_CONTENT_SEL);
    if (drillViaNav) {
      moveDashboardButtonToEndOfConnectNav(btn, skipDeferredFollowUp);
      return;
    }

    if (!lastNative) {
      if (btn.parentElement && btn.parentElement.lastElementChild !== btn) {
        btn.parentElement.appendChild(btn);
      }
      return;
    }
    const row = toConnectNavRowHost(lastNative);
    const parent = row && row.parentElement;
    if (!parent) return;
    const wrapped = ensureZnDashboardBetaItemWrapper(btn);
    if (parent !== wrapped.parentElement || parent.lastElementChild !== wrapped) {
      parent.appendChild(wrapped);
    }
    applyZnBetaRowVisualOrder(wrapped);
  }

  /** True if URL still looks like the Connect area (SPA may use path or hash). */
  function isConnectRoute() {
    const p = (location.pathname || "").toLowerCase();
    const h = (location.hash || "").toLowerCase();
    if (p.includes("/connect") || h.includes("connect")) return true;
    // Fallback: Connect sidebar labels present (initial paint / custom routes).
    return !!(findNavItem("Device Posture") || findNavItem("Sessions"));
  }

  function getLiveDashboardButton() {
    const btn = document.getElementById(BTN_ID);
    if (btn && btn.isConnected) return btn;
    return null;
  }

  // ── Sidebar width detection ───────────────────────────────────────────────

  // Remember the last good sidebar width so we never fall back to 0
  let _lastKnownSidebarRight = 0;

  function getSidebarRight() {
    // Try to measure from the button's parent sidebar element
    const btn = getLiveDashboardButton();
    if (btn) {
      let el = btn.parentElement;
      while (el && el !== document.body) {
        const rect = el.getBoundingClientRect();
        if (
          rect.left  <= 4 &&
          rect.height >= window.innerHeight * 0.5 &&
          rect.width  >  20 &&
          rect.width  <= 400
        ) {
          _lastKnownSidebarRight = Math.round(rect.right);
          return _lastKnownSidebarRight;
        }
        el = el.parentElement;
      }
    }

    // Fallback: query any fixed/absolute left-side nav directly
    const navCandidates = document.querySelectorAll(
      'aside, nav, [class*="sidebar"], [class*="side-bar"], [class*="nav-panel"], [class*="left-panel"]'
    );
    for (const nav of navCandidates) {
      const rect = nav.getBoundingClientRect();
      if (rect.left <= 4 && rect.height >= window.innerHeight * 0.5 && rect.width > 20 && rect.width <= 400) {
        _lastKnownSidebarRight = Math.round(rect.right);
        return _lastKnownSidebarRight;
      }
    }

    // Return the last known good value so the iframe never covers the sidebar
    return _lastKnownSidebarRight || 0;
  }

  // Keep the dashboard iframe's left edge aligned with the sidebar if it resizes
  function syncDashboardLeft() {
    const mount = document.getElementById(MOUNT_ID);
    if (!mount || mount.style.display === "none") return;
    const right = getSidebarRight();
    if (right > 0) mount.style.left = right + "px";
  }

  // ── Active-item highlight reset (JS override) ────────────────────────────
  //
  // The portal's Vue scoped CSS sets background-color on div.zn-sidebar-item-base
  // (confirmed: rgb(12,216,155)) using !important with a scoped attribute selector
  // that appears AFTER our injected <style> tag, so our CSS !important loses.
  // The only guaranteed win is an inline style with !important (specificity 1,0,0,0
  // beats any class-based selector, regardless of source order).

  function resetActiveItemHighlight() {
    if (!document.documentElement.classList.contains("zn-dashboard-beta-active")) return;
    var sidebar = document.querySelector(".zn-sidebar");
    if (!sidebar) return;
    // Only clear the background on the ACTIVE item's inner element.
    // Applying background:transparent to all .zn-sidebar-item-base elements
    // breaks label rendering on non-active rows (the portal uses background for
    // text rendering on those elements).
    var activeItemBaseSelector = [
      "a.zn-route-sidebar-item--active .zn-sidebar-item-base",
      "a.zn-route-sidebar-item.router-link-active .zn-sidebar-item-base",
      "a.zn-route-sidebar-item.router-link-exact-active .zn-sidebar-item-base",
      "a.zn-route-sidebar-item.active .zn-sidebar-item-base",
      "mat-list-item.router-link-active .zn-sidebar-item-base",
      "mat-list-item.router-link-exact-active .zn-sidebar-item-base",
      ".zn-main-drill-down__content__item.router-link-active .zn-sidebar-item-base",
      ".zn-main-drill-down__content__item.router-link-exact-active .zn-sidebar-item-base",
    ].join(",");
    sidebar.querySelectorAll(activeItemBaseSelector).forEach(function (el) {
      // Remove the green background. background-color only — NOT the background shorthand —
      // so background-image/background-clip are left intact.
      el.style.setProperty("background-color", "transparent", "important");
      // The portal sets color:rgb(34,42,85) (dark navy) on the active .zn-sidebar-item-base,
      // designed for dark text on a green background.  Without the green bg that text is
      // invisible against the dark sidebar, so we must restore the readable label colour.
      el.style.setProperty("color", "#cbd5e1", "important");
    });
  }

  function restoreActiveItemHighlight() {
    var sidebar = document.querySelector(".zn-sidebar");
    if (!sidebar) return;
    sidebar.querySelectorAll(".zn-sidebar-item-base").forEach(function (el) {
      el.style.removeProperty("background-color");
      el.style.removeProperty("color");
    });
  }

  // ── Show / hide dashboard ─────────────────────────────────────────────────

  function showDashboard() {
    if (!chrome.runtime || !chrome.runtime.getURL) {
      alert("Dashboard extension was reloaded — please refresh this tab.");
      return;
    }

    document.documentElement.classList.add("zn-dashboard-beta-active");
    resetActiveItemHighlight();
    // Re-run after short delays in case the portal's Vue re-renders the sidebar
    [50, 150, 350, 700].forEach(function (ms) { setTimeout(resetActiveItemHighlight, ms); });

    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch (_) {}

    const existing = document.getElementById(MOUNT_ID);
    if (existing) {
      existing.style.removeProperty("display");
      return;
    }

    const leftOffset = getSidebarRight();

    const mount = document.createElement("div");
    mount.id    = MOUNT_ID;
    mount.setAttribute('data-zn-dashboard-mount', 'true');
    Object.assign(mount.style, {
      position:   "fixed",
      top:        "0",
      left:       leftOffset + "px",
      right:      "0",
      bottom:     "0",
      zIndex:     "999999", // Higher z-index to ensure it's on top
      background: "#f4f6f8",
      overflow:   "hidden",
      pointerEvents: "auto", // Ensure interaction works
    });

    const iframe = document.createElement("iframe");
    iframe.src   = chrome.runtime.getURL("pages/connect/index.html") + "?portalHost=" + encodeURIComponent(location.origin);
    iframe.setAttribute('data-zn-dashboard-iframe', 'true');
    Object.assign(iframe.style, {
      width:   "100%",
      height:  "100%",
      border:  "none",
      display: "block",
      pointerEvents: "auto",
    });
    
    mount.appendChild(iframe);
    document.body.appendChild(mount);
  }

  /** Hide the overlay only (keeps session preference for “return to Connect”). */
  function hideDashboardOverlay() {
    document.documentElement.classList.remove("zn-dashboard-beta-active");
    restoreActiveItemHighlight();
    const mount = document.getElementById(MOUNT_ID);
    if (mount) mount.style.setProperty("display", "none", "important");
  }

  /** User chose another shell control — do not auto-reopen dashboard on next Connect visit. */
  function dismissDashboardPreference() {
    try {
      sessionStorage.setItem(STORAGE_KEY, "0");
    } catch (_) {}
  }

  function hideDashboardFromNavClick() {
    hideDashboardOverlay();
    dismissDashboardPreference();
  }

  function shouldReopenDashboard() {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  /** After inject / route change: restore overlay if user left it open. */
  function maybeRestoreDashboard() {
    if (!shouldReopenDashboard()) return;
    if (!isConnectRoute()) return;
    requestAnimationFrame(() => {
      if (!getLiveDashboardButton()) return;
      showDashboard();
    });
  }

  // ── Button ────────────────────────────────────────────────────────────────

  function createButton() {
    const btn  = document.createElement("button");
    btn.id     = BTN_ID;
    btn.type   = "button";
    btn.textContent = "Dashboard (Beta)";
    btn.setAttribute('data-zn-dashboard-btn', 'true'); // Unique identifier
    Object.assign(btn.style, {
      display:      "block",
      width:        "100%",
      marginTop:    "0",
      padding:      "10px 12px",
      borderRadius: "0",
      border:       "none",
      background:   "transparent",
      color:        "#ffffff",
      fontWeight:   "400",
      fontSize:     "13px",
      textAlign:    "left",
      cursor:       "pointer",
      fontFamily:   "inherit",
      position:     "relative",
      zIndex:       "1000",
      pointerEvents: "auto",
    });
    btn.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        showDashboard();
      },
      true
    );
    return btn;
  }

  /**
   * Injects the Dashboard control after a known Connect sidebar item (stable DOM append).
   * Does not clone Material tabs or insert into horizontal sub-nav rows — avoids breaking
   * the native portal sidebar layout.
   */
  function tryInjectDashboardButton() {
    if (!isConnectRoute()) return false;

    const existing = getLiveDashboardButton();
    if (existing) {
      moveDashboardButtonToEndOfConnectNav(existing);
      maybeRestoreDashboard();
      return true;
    }

    // Check if we already have a button in the DOM (even if disconnected)
    const allButtons = document.querySelectorAll('#' + BTN_ID);
    if (allButtons.length > 0) {
      // Remove any disconnected buttons
      allButtons.forEach(btn => {
        if (!btn.isConnected) {
          btn.remove();
        }
      });
      // If we still have a connected button, don't inject another
      const connectedButton = document.getElementById(BTN_ID);
      if (connectedButton && connectedButton.isConnected) {
        moveDashboardButtonToEndOfConnectNav(connectedButton);
        maybeRestoreDashboard();
        return true;
      }
    }

    const drillEarly = getZnConnectDrillDownContent();
    const drillAnchor =
      drillEarly &&
      (findDevicePostureDrillContentItem(drillEarly) || findLastZnDrillNativeConnectItem(drillEarly));
    const anchor = drillAnchor ? null : findLastKnownConnectNavItem();
    if (!drillAnchor && !anchor) return false;

    const btn = createButton();
    if (!drillAnchor && anchor) {
      const anchorEl = toConnectNavRowHost(anchor);
      const parent = anchorEl.parentElement;
      const nearbyButtons = parent ? parent.querySelectorAll("#" + BTN_ID) : [];
      if (nearbyButtons.length > 0) return true;
    }

    moveDashboardButtonToEndOfConnectNav(btn);

    // Poll after injection to catch any nav items the SPA renders after us.
    // Each check re-appends our button to the end if it has slipped behind a
    // newly-added sibling.
    scheduleButtonPositionChecks();

    maybeRestoreDashboard();
    return true;
  }

  function ensureButtonIsLast() {
    moveDashboardButtonToEndOfConnectNav(getLiveDashboardButton());
  }

  function scheduleButtonPositionChecks() {
    [100, 250, 500, 1000, 2000, 3500, 5000, 7500, 10000].forEach(ms => setTimeout(ensureButtonIsLast, ms));
  }

  function scheduleTryInject() {
    if (injectRaf != null) return;
    injectRaf = requestAnimationFrame(() => {
      injectRaf = null;
      tryInjectDashboardButton();
    });
  }

  // ── Handle auth messages from dashboard iframe ───────────────────────────

  function handleDashboardAuthMessage(event) {
    if (event.data && event.data.type === 'ZN_DASHBOARD_AUTH_REQUIRED') {
      // Redirect the portal tab to its own login page (same origin, /login path).
      // Using the current origin keeps us on the right portal environment
      // (portal-dev vs zerocorp-admin-dev vs production).
      var loginUrl = window.location.origin + '/login';
      window.location.href = loginUrl;
    }
  }

  // ── Global listeners (once): hide overlay on portal nav / route changes ───

  function attachGlobalListenersOnce() {
    if (globalListenersAttached) return;
    globalListenersAttached = true;

    // Listen for auth messages from dashboard iframe
    window.addEventListener('message', handleDashboardAuthMessage);

    document.addEventListener(
      "click",
      (e) => {
        if (e.target.closest("#" + BTN_ID)) return;
        const mount = document.getElementById(MOUNT_ID);
        if (!mount || mount.style.display === "none") return;
        if (
          e.target.closest("aside, nav, [role='navigation']") ||
          e.target.closest("a[routerLink], a[href], button[routerLink]")
        ) {
          hideDashboardFromNavClick();
        }
      },
      true
    );

    const onRouteChange = () => {
      if (!isConnectRoute()) {
        hideDashboardOverlay();
        disconnectZnDrillReorderObserver();
      }
      scheduleTryInject();
      setTimeout(maybeRestoreDashboard, 0);
      // Re-sync iframe position after SPA navigation may have shifted the sidebar
      setTimeout(syncDashboardLeft, 150);
      // Re-enforce button position after each route change in case the SPA
      // re-renders the nav and appends new items after our button.
      scheduleButtonPositionChecks();
    };

    window.addEventListener("hashchange", onRouteChange);
    window.addEventListener("popstate", onRouteChange);

    const wrapHistory = (fnName) => {
      const orig = history[fnName];
      if (typeof orig !== "function") return;
      history[fnName] = function () {
        const ret = orig.apply(this, arguments);
        onRouteChange();
        return ret;
      };
    };
    wrapHistory("pushState");
    wrapHistory("replaceState");
  }

  // ── Persistent MutationObserver (never disconnect for SPA remounts) ─────────

  function startMutationObserver() {
    if (mutationObserver) return;
    mutationObserver = new MutationObserver((mutations) => {
      if (!isConnectRoute()) return;

      let buttonRemoved = false;
      let sidebarMutated = false;

      mutations.forEach((mutation) => {
        mutation.removedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.id === BTN_ID || (node.querySelector && node.querySelector("#" + BTN_ID))) {
              buttonRemoved = true;
            }
            if (subtreeContainsZnBetaWrap(node)) {
              sidebarMutated = true;
            }
            if (touchesConnectSidebarNav(node)) {
              sidebarMutated = true;
            }
          }
        });

        // New rows may land in a *different* list than our button (multi-section
        // sidebars) or after delayed tenant-config fetches — any aside/nav
        // mutation triggers a reposition pass.
        if (!buttonRemoved && mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach((node) => {
            if (touchesConnectSidebarNav(node)) {
              sidebarMutated = true;
            }
          });
        }
      });

      if (buttonRemoved || !getLiveDashboardButton()) {
        scheduleTryInject();
      } else if (sidebarMutated) {
        scheduleRepositionFromSidebarMutation();
      }
    });
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // ── Sidebar ResizeObserver — keep iframe left-edge in sync ──────────────────

  function startSidebarResizeObserver() {
    if (!window.ResizeObserver) return;
    const ro = new ResizeObserver(() => syncDashboardLeft());
    // Observe any sidebar/nav element that exists now; re-run after mutations add new ones
    function observeSidebars() {
      document.querySelectorAll(
        'aside, nav, [class*="sidebar"], [class*="side-bar"], [class*="nav-panel"], [class*="left-panel"]'
      ).forEach(el => {
        try { ro.observe(el); } catch (_) {}
      });
    }
    observeSidebars();
    // Also re-observe after short delay in case portal SPA hasn't rendered sidebar yet
    setTimeout(observeSidebars, 1000);
    setTimeout(observeSidebars, 3000);
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    ensureZnDashboardBetaOrderStyle();
    attachGlobalListenersOnce();
    startMutationObserver();
    startSidebarResizeObserver();
    tryInjectDashboardButton();
    setTimeout(maybeRestoreDashboard, 300);
  }

  init();

  // ── Diagnostic: inject znDiagnoseSidebarLabel() into the portal's main world ─
  // Content scripts run in an isolated world and are NOT callable from the DevTools
  // console. Injecting a <script> tag puts the function in the page's main world so
  // the user can call  znDiagnoseSidebarLabel()  directly in the portal tab's console.
  (function injectDiagnostic() {
    if (document.getElementById("zn-sidebar-diag-script")) return;
    const s = document.createElement("script");
    s.id = "zn-sidebar-diag-script";
    s.textContent = /* js */`
(function() {
  window.znDiagnoseSidebarLabel = function znDiagnoseSidebarLabel() {
    var out = ['=== ZN Sidebar Label Diagnostic ===', new Date().toISOString(), ''];

    var sidebar = document.querySelector('.zn-sidebar');
    if (!sidebar) {
      console.warn('[znDiag] .zn-sidebar not found — run this in the PORTAL tab, not the iframe.');
      return;
    }

    out.push('--- Dashboard overlay state ---');
    out.push('html.zn-dashboard-beta-active : ' +
      document.documentElement.classList.contains('zn-dashboard-beta-active'));
    out.push('sessionStorage[zn-connect-dashboard-open] : ' +
      sessionStorage.getItem('zn-connect-dashboard-open'));
    out.push('Extension style tag present   : ' +
      !!document.getElementById('zn-dashboard-beta-order-style'));
    out.push('');

    function shortEl(el) {
      if (!el) return 'null';
      var cls = typeof el.className === 'string'
        ? el.className.trim().replace(/\\s+/g, '.') : '';
      return '<' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
             (cls ? '.' + cls : '') + '>';
    }

    function dumpEl(label, el) {
      if (!el) { out.push('  ' + label + ': (not found)'); return; }
      var cs = getComputedStyle(el);
      out.push('  ' + label + '  ' + shortEl(el));
      out.push('    inline style : ' + (el.style.cssText || '(none)'));
      out.push('    color        : ' + cs.color);
      out.push('    background   : ' + cs.background);
      out.push('    bg-color     : ' + cs.backgroundColor);
      out.push('    bg-image     : ' + cs.backgroundImage);
      out.push('    bg-clip      : ' + cs.backgroundClip + ' / -webkit: ' + cs.webkitBackgroundClip);
      out.push('    opacity      : ' + cs.opacity);
      out.push('    visibility   : ' + cs.visibility);
      out.push('    display      : ' + cs.display);
      out.push('    text content : "' + el.textContent.trim().replace(/\\s+/g, ' ').substring(0, 80) + '"');
    }

    function walkSubtree(el, depth) {
      if (!el || depth > 6) return;
      var cs = getComputedStyle(el);
      var bgClip = cs.backgroundClip || '';
      var wbgClip = cs.webkitBackgroundClip || '';
      var interesting =
        bgClip.includes('text') || wbgClip.includes('text') ||
        cs.color === 'transparent' || cs.color === 'rgba(0, 0, 0, 0)' ||
        (el.style && (el.style.background || el.style.backgroundColor));
      if (interesting) {
        out.push('    [depth=' + depth + '] ' + shortEl(el));
        out.push('      bg-clip        : ' + bgClip + ' / ' + wbgClip);
        out.push('      color          : ' + cs.color);
        out.push('      bg-color       : ' + cs.backgroundColor);
        out.push('      bg-image       : ' + cs.backgroundImage);
        out.push('      inline style   : ' + (el.style.cssText || '(none)'));
      }
      for (var i = 0; i < el.children.length; i++) walkSubtree(el.children[i], depth + 1);
    }

    var ACTIVE_SELS = [
      'a.zn-route-sidebar-item--active',
      'a.zn-route-sidebar-item.router-link-active',
      'a.zn-route-sidebar-item.router-link-exact-active',
      '.zn-main-drill-down__content__item.router-link-active a',
      '.zn-main-drill-down__content__item.router-link-exact-active a',
    ];

    var found = false;
    ACTIVE_SELS.forEach(function(sel) {
      var hits = sidebar.querySelectorAll(sel);
      if (!hits.length) return;
      found = true;
      out.push('--- Active item matched by "' + sel + '" ---');
      hits.forEach(function(a) {
        dumpEl('anchor', a);
        dumpEl('.zn-sidebar-item-base',
          a.querySelector('.zn-sidebar-item-base') || a.closest('.zn-sidebar-item-base'));
        dumpEl('.zn-sidebar-item-base__icon', a.querySelector('.zn-sidebar-item-base__icon'));
        var labelEl = a.querySelector(
          '.zn-sidebar-item-base__label, [class*="label"], [class*="text"], span');
        dumpEl('first label/text child', labelEl);
        out.push('  --- background-clip:text scan (full subtree) ---');
        walkSubtree(a, 0);
        out.push('');
      });
    });

    if (!found) {
      out.push('(no active item found with known selectors)');
      out.push('All .zn-route-sidebar-item anchors present:');
      sidebar.querySelectorAll('a.zn-route-sidebar-item').forEach(function(a) {
        out.push('  ' + shortEl(a) + '  "' + a.textContent.trim().substring(0, 50) + '"');
      });
    }

    out.push('--- All .zn-sidebar-item-base inline styles ---');
    var anyInline = false;
    sidebar.querySelectorAll('.zn-sidebar-item-base').forEach(function(el) {
      if (!el.style.cssText) return;
      anyInline = true;
      out.push('  ' + shortEl(el) + '  style="' + el.style.cssText + '"');
    });
    if (!anyInline) out.push('  (none — extension is NOT setting inline styles on these elements)');

    var text = out.join('\\n');
    console.log('%c' + text, 'color:#00df9a;font-family:monospace;font-size:11px');

    // Show overlay UI
    var old = document.getElementById('zn-diag-sidebar-overlay');
    if (old) old.remove();
    var overlay = document.createElement('div');
    overlay.id = 'zn-diag-sidebar-overlay';
    Object.assign(overlay.style, {
      position:'fixed', top:'0', left:'0', right:'0', bottom:'0', zIndex:'9999999',
      background:'rgba(0,0,0,0.88)', display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center', padding:'24px',
    });
    var card = document.createElement('div');
    Object.assign(card.style, {
      background:'#1e293b', borderRadius:'12px', padding:'20px', width:'100%',
      maxWidth:'860px', maxHeight:'84vh', display:'flex', flexDirection:'column', gap:'12px',
    });
    var hdr = document.createElement('div');
    Object.assign(hdr.style, { display:'flex', justifyContent:'space-between', alignItems:'center' });
    var ttl = document.createElement('h3');
    ttl.textContent = 'Sidebar Label Diagnostic';
    Object.assign(ttl.style, { margin:'0', color:'#f1f5f9', fontSize:'16px' });
    var xBtn = document.createElement('button');
    xBtn.textContent = 'X';
    Object.assign(xBtn.style, {
      background:'transparent', border:'none', color:'#94a3b8',
      fontSize:'18px', cursor:'pointer', padding:'0 4px',
    });
    xBtn.onclick = function() { overlay.remove(); };
    hdr.appendChild(ttl); hdr.appendChild(xBtn);
    var ta = document.createElement('textarea');
    ta.value = text; ta.readOnly = true;
    Object.assign(ta.style, {
      flex:'1', background:'#0f172a', color:'#94a3b8', border:'1px solid #334155',
      borderRadius:'8px', padding:'12px', fontFamily:'monospace', fontSize:'11px',
      resize:'none', minHeight:'300px',
    });
    var cpBtn = document.createElement('button');
    cpBtn.textContent = 'Copy to clipboard';
    Object.assign(cpBtn.style, {
      background:'#00df9a', color:'#0f172a', border:'none', borderRadius:'8px',
      padding:'10px 20px', fontWeight:'600', cursor:'pointer', fontSize:'13px', flexShrink:'0',
    });
    cpBtn.onclick = function() {
      navigator.clipboard.writeText(text).then(function() {
        cpBtn.textContent = 'Copied!';
        setTimeout(function() { cpBtn.textContent = 'Copy to clipboard'; }, 2000);
      }).catch(function() { ta.select(); document.execCommand('copy'); });
    };
    card.appendChild(hdr); card.appendChild(ta); card.appendChild(cpBtn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  };
  console.log('%c[ZN Extension] znDiagnoseSidebarLabel() is ready — call it any time in this tab\\'s console.', 'color:#00df9a');
})();
    `;
    (document.head || document.documentElement).appendChild(s);
  })();
})();
