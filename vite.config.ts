import fs from 'node:fs'
import path from 'node:path'
import { crx } from '@crxjs/vite-plugin'
import { defineConfig, type Plugin } from 'vite'
import zip from 'vite-plugin-zip-pack'
import manifest from './manifest.config.js'
import { name, version } from './package.json'

/**
 * Three CRXJS dev-mode issues patched at both the node_modules source level
 * (so regenerated files are clean) and in closeBundle (safety net on disk).
 *
 * 1. dist/vendor/crx-client-port.js  — HMRPort.initPort() / send() need
 *    try/catch so an invalidated extension context triggers location.reload()
 *    instead of throwing and falling back to a direct WebSocket.
 *
 * 2. dist/vendor/vite-client.js      — remove webcomponents polyfill import
 *    (causes CSP violations in MV3) and suppress the unreachable WebSocket
 *    fallback console.error.
 *
 * 3. dist/src/content/*-loader.js    — strip the console.warn emitted for
 *    world:"MAIN" content scripts (pure dev noise; script runs fine).
 */
function patchCrxjsDevAssets(): Plugin {
  function applyPatch(filePath: string, transform: (src: string) => string) {
    if (!fs.existsSync(filePath)) return
    const original = fs.readFileSync(filePath, 'utf8')
    const patched = transform(original)
    if (patched !== original) fs.writeFileSync(filePath, patched)
  }

  return {
    name: 'patch-crxjs-dev-assets',

    // Patch CRXJS source: restrict the dev-mode web_accessible_resources entry
    // from <all_urls> to *.zeronetworks.com.  CRXJS's "crx:web-accessible-resources"
    // (apply:"serve") plugin hard-codes matches:["<all_urls>"] so every extension
    // asset is reachable from any page on the internet — including sites like
    // google.com or gemini.google.com.  We patch the plugin's source once at
    // startup so the manifest it generates is already restricted.
    // NOTE: this patch survives restarts (the patched file lives on disk) but is
    // reset by `npm install`.  A postinstall script re-applies it automatically.
    buildStart() {
      applyPatch(
        path.resolve(__dirname, 'node_modules/@crxjs/vite-plugin/dist/index.mjs'),
        (src) => src.replace(
          'matches: ["<all_urls>"]',
          'matches: ["https://*.zeronetworks.com/*"]',
        ),
      )
      applyPatch(
        path.resolve(__dirname, 'node_modules/@crxjs/vite-plugin/dist/index.cjs'),
        (src) => src.replace(
          'matches: ["<all_urls>"]',
          'matches: ["https://*.zeronetworks.com/*"]',
        ),
      )
    },

    // Intercept every HTTP request for vendor/vite-client.js from the dev
    // server and serve a patched version on-the-fly.  CRXJS regenerates this
    // file after every HMR rebuild, which overwrites the closeBundle disk
    // patch before the extension can read it.  Serving a patched response here
    // ensures the extension always receives the corrected file regardless of
    // when CRXJS last wrote it to dist/.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.includes('/vendor/vite-client.js')) return next()
        const filePath = path.resolve(__dirname, 'dist', 'vendor', 'vite-client.js')
        if (!fs.existsSync(filePath)) return next()
        let src = fs.readFileSync(filePath, 'utf8')

        const catchMarker = '} catch (e) {\n\t\t\t\tif (!hmrPort) {'
        const catchIdx = src.indexOf(catchMarker)
        if (catchIdx !== -1) {
          const insertAt = catchIdx + catchMarker.length
          src = src.slice(0, insertAt) +
            '\n\t\t\t\t\treturn; /* crxjs: direct-WebSocket fallback skipped */' +
            src.slice(insertAt)
        }

        const errMarker = 'console.error(`[vite] failed to connect to websocket.'
        const errIdx = src.indexOf(errMarker)
        if (errIdx !== -1) {
          const errEnd = src.indexOf('`);', errIdx) + 3
          if (errEnd >= 3) {
            src = src.slice(0, errIdx) + '/* crxjs: WebSocket error suppressed */' + src.slice(errEnd)
          }
        }

        res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        res.end(src)
      })
    },

    // Patch @crx/client-worker (virtual module served by the dev server).
    // The onDisconnect handler calls console.error(chrome.runtime.lastError),
    // which is a plain object — Chrome's extension error reporter records it as
    // "[object Object]" in chrome://extensions. Log the message string instead
    // so the error page stays clean and the true reason for disconnect is visible.
    transform(code, id) {
      if (!id.includes('client-worker')) return null
      const patched = code.replace(
        'console.error(chrome.runtime.lastError);',
        'console.error(chrome.runtime.lastError?.message ?? String(chrome.runtime.lastError));',
      )
      return patched === code ? null : { code: patched, map: null }
    },

    // vite-client.js goes through Rollup's chunk pipeline.
    // Two patches are applied on every chunk rebuild:
    //
    // A) Replace the entire outer catch's body with an early return so the
    //    direct-WebSocket fallback is never attempted.  It always fails in
    //    content scripts (Chrome CSP blocks localhost WebSocket) and HMRPort
    //    manages its own reconnection, so the fallback serves no purpose.
    //
    // B) Belt-and-suspenders: also wipe the detailed console.error that names
    //    the "current setup" in case the catch-body pattern shifts in a future
    //    Vite release.
    renderChunk(code) {
      // Only touch the vite-client chunk
      if (!code.includes('failed to connect to websocket')) return null
      let patched = code

      // Patch A — neutralise the catch block that triggers the WebSocket fallback.
      // The marker is specific enough: this exact 3-line sequence only appears once.
      const catchMarker = '} catch (e) {\n\t\t\t\tif (!hmrPort) {'
      const catchIdx = patched.indexOf(catchMarker)
      if (catchIdx !== -1) {
        const insertAt = catchIdx + catchMarker.length
        patched = patched.slice(0, insertAt) +
          '\n\t\t\t\t\treturn; /* crxjs: direct-WebSocket fallback skipped */' +
          patched.slice(insertAt)
      }

      // Patch B — suppress the detailed console.error (belt-and-suspenders)
      const errMarker = 'console.error(`[vite] failed to connect to websocket.'
      const errStart = patched.indexOf(errMarker)
      if (errStart !== -1) {
        const errEnd = patched.indexOf('`);', errStart) + 3
        if (errEnd >= 3) {
          patched = patched.slice(0, errStart) + '/* crxjs: WebSocket error suppressed */' + patched.slice(errEnd)
        }
      }

      return patched === code ? null : { code: patched, map: null }
    },

    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist')

      // Fix 1a: guard HMRPort.send() against an invalidated extension context
      // Fix 1b: guard HMRPort.initPort() so a dead context reloads the page
      //         instead of throwing — prevents vite-client from trying the
      //         direct-WebSocket fallback that always fails in content scripts.
      applyPatch(
        path.join(distDir, 'vendor', 'crx-client-port.js'),
        (src) => {
          // send() guard
          let out = src.replace(
            '    if (this.port)\n      this.port.postMessage({ data });\n    else',
            '    if (this.port)\n      try { this.port.postMessage({ data }); } catch (_) {}\n    else'
          )
          // initPort() guard
          out = out.replace(
            '  initPort = () => {\n    this.port?.disconnect();\n    this.port = chrome.runtime.connect({ name: "@crx/client" });\n    this.port.onDisconnect.addListener(this.handleDisconnect.bind(this));\n    this.port.onMessage.addListener(this.handleMessage.bind(this));\n    this.port.postMessage({ type: "connected" });\n  };',
            '  initPort = () => {\n    try {\n      this.port?.disconnect();\n      this.port = chrome.runtime.connect({ name: "@crx/client" });\n      this.port.onDisconnect.addListener(this.handleDisconnect.bind(this));\n      this.port.onMessage.addListener(this.handleMessage.bind(this));\n      this.port.postMessage({ type: "connected" });\n    } catch (error) {\n      if (error instanceof Error && error.message.includes("Extension context invalidated.")) location.reload();\n    }\n  };'
          )
          return out
        }
      )

      // Fix 1c: patch vite-client.js —
      //   a) remove the @webcomponents/custom-elements import (inline-script
      //      polyfill violates MV3 CSP; Chrome has native custom elements)
      //   b) neutralise the direct-WebSocket fallback catch block
      //   c) belt-and-suspenders: also wipe the detailed console.error
      applyPatch(path.join(distDir, 'vendor', 'vite-client.js'), (src) => {
        let out = src
        // a) Remove webcomponents polyfill import
        out = out.replace("import '/vendor/webcomponents-custom-elements.js';", '')
        out = out.replace('import "/vendor/webcomponents-custom-elements.js";', '')
        // b) Skip the direct-WebSocket fallback entirely
        const catchMarker = '} catch (e) {\n\t\t\t\tif (!hmrPort) {'
        const catchIdx = out.indexOf(catchMarker)
        if (catchIdx !== -1) {
          const insertAt = catchIdx + catchMarker.length
          out = out.slice(0, insertAt) +
            '\n\t\t\t\t\treturn; /* crxjs: direct-WebSocket fallback skipped */' +
            out.slice(insertAt)
        }
        // c) Suppress the detailed console.error
        const errMarker = 'console.error(`[vite] failed to connect to websocket.'
        const errIdx = out.indexOf(errMarker)
        if (errIdx !== -1) {
          const errEnd = out.indexOf('`);', errIdx) + 3
          if (errEnd >= 3) {
            out = out.slice(0, errIdx) + '/* crxjs: WebSocket error suppressed */' + out.slice(errEnd)
          }
        }
        return out
      })

      // Fix 2: strip the MAIN-world HMR console.warn from every loader file
      const loaderDir = path.join(distDir, 'src', 'content')
      if (fs.existsSync(loaderDir)) {
        for (const file of fs.readdirSync(loaderDir)) {
          if (!file.endsWith('-loader.js')) continue
          applyPatch(path.join(loaderDir, file), (src) => {
            // Use plain string search so multiline/escaping issues can't interfere
            const marker = "Content-script doesn't support HMR because the world is MAIN"
            const warnStart = src.lastIndexOf('console.warn(', src.indexOf(marker))
            if (warnStart === -1) return src
            const warnEnd = src.indexOf(');\n', warnStart) + 3
            if (warnEnd < 3) return src
            // Also eat any leading whitespace on that line
            let lineStart = warnStart
            while (lineStart > 0 && src[lineStart - 1] !== '\n') lineStart--
            return src.slice(0, lineStart) + src.slice(warnEnd)
          })
        }
      }

    },
  }
}

/**
 * Copies plain JS/CSS sibling files that are referenced by <script src> /
 * <link href> in the dashboard HTML pages but are NOT processed by Rollup
 * (they are vanilla files, not ES modules). Vite only emits the HTML entry
 * itself; we need to copy the adjacent assets manually so the extension can
 * load them from dist/.
 *
 * Works in BOTH `vite dev` and `vite build`:
 *  - closeBundle   → initial copy after CRXJS builds the extension bundle
 *  - configureServer → watches source files and re-copies on change so the
 *                      extension in Chrome always sees the latest version
 *                      without a full dev-server restart.
 */
function copyDashboardAssets(): Plugin {
  const pairs: Array<{ src: string; dest: string }> = [
    // pages/connect/ — HTML must be listed first so the initial copy runs before
    // the browser loads the page. CRXJS copies these HTML files verbatim to dist
    // during the first build but does NOT re-copy them when they change in dev
    // mode, so we watch and sync them manually.
    {
      src: 'pages/connect/index.html',
      dest: 'pages/connect/index.html',
    },
    {
      src: 'pages/connect/dashboard-logic.js',
      dest: 'pages/connect/dashboard-logic.js',
    },
    {
      src: 'pages/connect/index.css',
      dest: 'pages/connect/index.css',
    },
    // pages/dashboard/
    {
      src: 'pages/dashboard/index.html',
      dest: 'pages/dashboard/index.html',
    },
    {
      src: 'pages/dashboard/dashboard.js',
      dest: 'pages/dashboard/dashboard.js',
    },
    {
      src: 'pages/dashboard/dashboard.css',
      dest: 'pages/dashboard/dashboard.css',
    },
  ]

  function copyAll(outDir: string) {
    for (const { src, dest } of pairs) {
      const srcPath = path.resolve(__dirname, src)
      const destPath = path.resolve(outDir, dest)
      if (!fs.existsSync(srcPath)) {
        console.warn(`[copy-dashboard-assets] source not found: ${srcPath}`)
        continue
      }
      fs.mkdirSync(path.dirname(destPath), { recursive: true })
      fs.copyFileSync(srcPath, destPath)
      console.log(`[copy-dashboard-assets] copied ${src} → dist/${dest}`)
    }
  }

  return {
    name: 'copy-dashboard-assets',
    // No `apply` restriction — must run in both serve and build modes.
    closeBundle() {
      // Fires after every Rollup bundle write, including CRXJS's dev-mode build.
      copyAll(path.resolve(__dirname, 'dist'))
    },
    configureServer(server) {
      // In dev mode: watch source files and re-copy to dist on change.
      // This keeps the extension's loaded CSS/JS in sync without a full restart.
      const outDir = path.resolve(__dirname, 'dist')
      const absSources = pairs.map(p => path.resolve(__dirname, p.src))
      server.watcher.add(absSources)
      server.watcher.on('change', (changedPath) => {
        const pair = pairs.find(p => path.resolve(__dirname, p.src) === changedPath)
        if (!pair) return
        const destPath = path.resolve(outDir, pair.dest)
        if (!fs.existsSync(changedPath)) return
        fs.mkdirSync(path.dirname(destPath), { recursive: true })
        fs.copyFileSync(changedPath, destPath)
        console.log(`[copy-dashboard-assets] hot-copied ${pair.src} → dist/${pair.dest}`)
        // These are not ES modules so HMR can't patch them in-place;
        // send a full-reload signal so the extension page refreshes.
        server.ws.send({ type: 'full-reload' })
      })
    },
  }
}

export default defineConfig({
  resolve: {
    alias: {
      '@': `${path.resolve(__dirname, 'src')}`,
    },
  },
  plugins: [
    crx({ manifest }),
    zip({ outDir: 'release', outFileName: `crx-${name}-${version}.zip` }),
    copyDashboardAssets(),
    patchCrxjsDevAssets(),
  ],
  build: {
    rollupOptions: {
      input: {
        // Dashboard pages are web_accessible_resources loaded inside iframes
        // injected into the Zero Networks portal. Declaring them here ensures
        // Vite processes their HTML, copies adjacent CSS/JS, and emits them to
        // dist/ at the same relative path the manifest declares.
        connectDashboard: 'pages/connect/index.html',
        dashboardV2: 'pages/dashboard/index.html',
      },
    },
  },
  server: {
    cors: {
      origin: [
        /chrome-extension:\/\//,
      ],
    },
  },
})
