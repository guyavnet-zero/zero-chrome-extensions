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
    var auth = null;
    try {
      if (isZnApiUrl(input) && init && init.headers) {
        var h = init.headers;
        if (typeof h.get === 'function') {
          auth = h.get('Authorization') || h.get('authorization');
        } else if (typeof h === 'object') {
          auth = h['Authorization'] || h['authorization'];
        }
      }
    } catch (e) { /* noop */ }
    var promise = _fetch.apply(this, arguments);
    if (auth) {
      var capturedAuth = auth;
      // #region agent log
      var _url = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input && input.url) || '');
      // #endregion
      promise.then(function(res) {
        if (res && res.ok) {
          relay(capturedAuth);
          // #region agent log
          window.postMessage({type:'ZN_DBG_717b26',payload:{sessionId:'717b26',location:'page-token-bridge.js:fetch-relay',message:'Token relayed after successful fetch',data:{url:_url,status:res.status,authLen:capturedAuth.length},hypothesisId:'H-B-H-D',timestamp:Date.now()}},'*');
          // #endregion
        } else {
          // #region agent log
          window.postMessage({type:'ZN_DBG_717b26',payload:{sessionId:'717b26',location:'page-token-bridge.js:fetch-skip',message:'Token relay skipped — response not ok',data:{url:_url,status:res&&res.status,authLen:capturedAuth.length},hypothesisId:'H-B-H-D',timestamp:Date.now()}},'*');
          // #endregion
        }
      }).catch(function(){});
    }
    return promise;
  };

  // ── Patch XMLHttpRequest ───────────────────────────────────────────────────
  var _open = XMLHttpRequest.prototype.open;
  var _setHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._znApiUrl = isZnApiUrl(url);
    if (this._znApiUrl) {
      // Relay the captured auth token only after a successful response.
      var self = this;
      this.addEventListener('load', function () {
        if (self._znAuthValue && self.status >= 200 && self.status < 300) {
          relay(self._znAuthValue);
        }
      });
    }
    return _open.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this._znApiUrl && name && name.toLowerCase() === 'authorization') {
      this._znAuthValue = value;
    }
    return _setHeader.apply(this, arguments);
  };

  // ── Trigger a fresh API call when requested by the dashboard ───────────────
  // This makes a real authenticated request using the portal's own session/cookies,
  // so background.js intercepts it and stores a fresh Bearer token automatically.
  window.addEventListener('message', function(event) {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== 'ZN_TRIGGER_FRESH_API') return;

    // #region agent log
    window.postMessage({type:'ZN_DBG_717b26',payload:{sessionId:'717b26',location:'page-token-bridge.js:ZN_TRIGGER_FRESH_API',message:'ZN_TRIGGER_FRESH_API received — firing fresh licenses call',data:{hash:location.hash},hypothesisId:'H-C',timestamp:Date.now()}},'*');
    // #endregion
    _fetch('/api/v1/settings/subscriptions/licenses/connect', {
      method: 'GET',
      credentials: 'include'
    }).catch(function() { /* ignore — we only need the request to go out */ });
  });
}());
