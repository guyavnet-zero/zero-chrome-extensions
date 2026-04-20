// Runs in the MAIN world (page JS context) at document_start so it patches
// fetch/XHR before the portal app code executes. Captured tokens are posted
// to the isolated-world content script via postMessage, which then forwards
// them to the background service worker for storage.
(function () {
  'use strict';

  function relay(authValue) {
    if (!authValue || String(authValue).trim().length < 24) return;
    window.postMessage({ type: 'ZN_TOKEN_CAPTURED', token: String(authValue).trim(), host: location.hostname }, '*');
  }

  function isZnApiUrl(url) {
    try {
      var s = typeof url === 'string' ? url
            : url instanceof URL     ? url.href
            : (url && url.url)       ? url.url : '';
      return s.indexOf('zeronetworks.com/api/') !== -1;
    } catch (e) { return false; }
  }

  // ── Patch fetch ────────────────────────────────────────────────────────────
  var _fetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      if (isZnApiUrl(input) && init && init.headers) {
        var h = init.headers;
        var auth = null;
        if (typeof h.get === 'function') {
          auth = h.get('Authorization') || h.get('authorization');
        } else if (typeof h === 'object') {
          auth = h['Authorization'] || h['authorization'];
        }
        if (auth) relay(auth);
      }
    } catch (e) { /* noop */ }
    return _fetch.apply(this, arguments);
  };

  // ── Patch XMLHttpRequest ───────────────────────────────────────────────────
  var _open = XMLHttpRequest.prototype.open;
  var _setHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._znApiUrl = isZnApiUrl(url);
    return _open.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this._znApiUrl && name && name.toLowerCase() === 'authorization') {
      relay(value);
    }
    return _setHeader.apply(this, arguments);
  };

  // ── Trigger a fresh API call when requested by the dashboard ───────────────
  // This makes a real authenticated request using the portal's own session/cookies,
  // so background.js intercepts it and stores a fresh Bearer token automatically.
  window.addEventListener('message', function(event) {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== 'ZN_TRIGGER_FRESH_API') return;

    _fetch('/api/v1/settings/subscriptions/licenses/connect', {
      method: 'GET',
      credentials: 'include'
    }).catch(function() { /* ignore — we only need the request to go out */ });
  });
}());
