import type { PlasmoCSConfig } from "plasmo"

// 1. THE MISSING PIECE: This tells Plasmo/Chrome WHERE to run.
export const config: PlasmoCSConfig = {
  matches: ["https://*.zeronetworks.com/*"],
  all_frames: true
}

// 2. WRAP YOUR LOGIC: Plasmo calls this file as a module.
const initializeExtension = () => {
  "use strict";

  // ... (Keep all your existing logic here, but remove the outer (function() { ... })() wrapper)
  // I will show the condensed version below to ensure it works with Plasmo:

  const BTN_ID = "zn-dashboard-beta-button";
  const MOUNT_ID = "zn-dashboard-beta-mount";
  const STORAGE_KEY = "zn-connect-dashboard-open";

  // [ALL YOUR FUNCTIONS: normalize, getSidebarSearchRoot, findNavItem, etc. go here]
  
  // ── Init ───────────────────────────────────────────────────────────────────
  // We call this inside the wrapper
  const init = () => {
    ensureZnDashboardBetaOrderStyle();
    attachGlobalListenersOnce();
    startMutationObserver();
    // startSidebarResizeObserver(); // Optional: ensure this is defined
    tryInjectDashboardButton();
    setTimeout(maybeRestoreDashboard, 300);
  };

  init();
};

// 3. EXECUTE
if (document.readyState === "complete") {
  initializeExtension();
} else {
  window.addEventListener("load", initializeExtension);
}

// NOTE: You must also move all the helper functions (findNavItem, createButton, etc.) 
// from your original file into this new initializeExtension function.