import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: pkg.name,
  version: pkg.version,
  icons: {
    48: 'public/logo.png',
  },
  action: {
    default_icon: {
      48: 'public/logo.png',
    },
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
  ],
  host_permissions: [
    '*://*.zeronetworks.com/*',
    'https://free.freeipapi.com/*',
    'https://ipinfo.io/*',
    'https://ipapi.co/*',
    'https://get.geojs.io/*',
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
