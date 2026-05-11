import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'Zero Connect Extension',
  version: pkg.version,
  icons: {
    16: 'public/icon-16.png',
    32: 'public/icon-32.png',
    48: 'public/icon-48.png',
    128: 'public/icon-128.png',
  },
  action: {
    default_icon: {
      16: 'public/icon-16.png',
      32: 'public/icon-32.png',
      48: 'public/icon-48.png',
      128: 'public/icon-128.png',
    },
    default_popup: 'src/popup/index.html',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      // Isolated-world script: injects the dashboard button, manages the iframe,
      // and relays token messages from the MAIN world to the background SW.
      js: ['src/content/main.ts'],
      matches: ['https://*.zeronetworks.com/*'],
      run_at: 'document_idle',
    },
    {
      // MAIN-world script: patches fetch/XHR at document_start to capture Bearer
      // tokens before any portal API calls fire.
      js: ['src/content/page-token-bridge.js'],
      matches: ['https://*.zeronetworks.com/*'],
      run_at: 'document_start',
      world: 'MAIN',
    },
  ],
  permissions: [
    'sidePanel',
    'contentSettings',
    'storage',
    'webRequest',
    'windows',
    'alarms',
  ],
  host_permissions: [
    '*://*.zeronetworks.com/*',
    'https://free.freeipapi.com/*',
    'https://ipinfo.io/*',
    'https://ipapi.co/*',
    'https://get.geojs.io/*',
    'https://gist.githubusercontent.com/*',
    'https://www.google-analytics.com/*',
    'https://tiles.openfreemap.org/*',
    'https://*.openfreemap.org/*',
    'https://formspree.io/*',
    'https://urlscan.io/*',
    'https://rdap.org/*',
    'https://cloudflare-dns.com/*',
    'https://security.cloudflare-dns.com/*',
  ],
  web_accessible_resources: [
    {
      // Dashboard pages loaded inside an iframe injected into the ZN portal.
      resources: [
        'pages/connect/index.html',
        'pages/dashboard/index.html',
      ],
      matches: ['https://*.zeronetworks.com/*'],
    },
  ],
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
})
