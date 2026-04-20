// Primary path: intercept outgoing requests via webRequest (works when the
// service worker happens to be awake).
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const authHeader = details.requestHeaders?.find(
      (h) => h.name.toLowerCase() === "authorization"
    );
    if (authHeader?.value) {
      const host = new URL(details.url).hostname;
      chrome.storage.local.get("znTokens", (result) => {
        const tokens = (result && result.znTokens) || {};
        tokens[host] = { token: authHeader.value, at: Date.now() };
        chrome.storage.local.set({ znTokens: tokens });
      });
      console.log("[ZN Dashboard] Bearer token captured via webRequest.");
    }
  },
  { urls: ["*://*.zeronetworks.com/api/*"] },
  ["requestHeaders"]
);

// Fallback path: token relayed from page-token-bridge.js (MAIN world) →
// content.js → here. Fires even when the service worker was dormant during
// the page's initial API calls, making token capture reliable on fresh devices.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "ZN_TOKEN_CAPTURED" && message.token) {
    const host = message.host || "zerocorp-admin-dev.zeronetworks.com";
    chrome.storage.local.get("znTokens", (result) => {
      const tokens = (result && result.znTokens) || {};
      tokens[host] = { token: message.token, at: Date.now() };
      chrome.storage.local.set({ znTokens: tokens });
    });
    console.log("[ZN Dashboard] Bearer token captured via page bridge.");
  }
});

// GeoIP fetch proxy — the background service worker has host_permissions and
// is not subject to CORS, so GeoIP requests are routed through here instead
// of being made directly from the extension iframe (which would be blocked).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ZN_GEO_FETCH" && message.url) {
    fetch(message.url)
      .then((r) => {
        const { ok, status } = r;
        return r.json().then((data) => ({ ok, status, data }));
      })
      .catch((e) => ({ ok: false, status: 0, data: null, error: e.message }))
      .then(sendResponse);
    return true; // keep the message channel open for the async response
  }
});
