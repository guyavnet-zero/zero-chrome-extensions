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

  // Hoisted so both configureServer (middleware + file watcher) and closeBundle
  // use exactly the same set of patches — eliminates the bug where CRXJS
  // regenerating the file after closeBundle left send() unguarded.
  function patchCrxClientPort(src: string): string {
    let out = src

    // Patch A — send() guard (idempotent: no-op if already wrapped)
    out = out.replace(
      '    if (this.port)\n      this.port.postMessage({ data });\n    else',
      '    if (this.port)\n      try { this.port.postMessage({ data }); } catch (_) {}\n    else',
    )

    // Patch A2 — remove the else-throw from send() so a null/dead port is silently
    // skipped instead of throwing an uncaught error.  Runs after Patch A so it
    // always sees the try/catch form regardless of whether Patch A fired this run.
    out = out.replace(
      '    if (this.port)\n      try { this.port.postMessage({ data }); } catch (_) {}\n    else\n      throw new Error("HMRPort is not initialized");',
      '    if (this.port)\n      try { this.port.postMessage({ data }); } catch (_) {}',
    )

    // Patch B — initPort() guard (idempotent: no-op if already wrapped)
    out = out.replace(
      '  initPort = () => {\n    this.port?.disconnect();\n    this.port = chrome.runtime.connect({ name: "@crx/client" });\n    this.port.onDisconnect.addListener(this.handleDisconnect.bind(this));\n    this.port.onMessage.addListener(this.handleMessage.bind(this));\n    this.port.postMessage({ type: "connected" });\n  };',
      '  initPort = () => {\n    try {\n      this.port?.disconnect();\n      this.port = chrome.runtime.connect({ name: "@crx/client" });\n      this.port.onDisconnect.addListener(this.handleDisconnect.bind(this));\n      this.port.onMessage.addListener(this.handleMessage.bind(this));\n      this.port.postMessage({ type: "connected" });\n    } catch (error) {\n      if (error instanceof Error && error.message.includes("Extension context invalidated.")) location.reload();\n    }\n  };',
    )

    // Patch C — ping-interval catch: swallow ALL non-reload errors so no Chrome
    // port error (e.g. "Attempting to use a disconnected port object", "disconnected
    // port", etc.) can propagate as an uncaught exception from a timer callback.
    // Three regex variants handle every form the file could have:
    //   v1 — original CRXJS: `} else\n    throw error;`
    //   v2 — prior patch form: `} else if (... && !includes("disconnected port")) { throw error }`
    //   v3 — template before source-patch: `} else if (!(... includes("disconnected port")))\n    throw error;`
    out = out.replace(
      /error\.message\.includes\("Extension context invalidated\."\)\) \{\n(\s+)location\.reload\(\);\n(\s+)\} else\n(\s+)throw error;/,
      (_, sp1, sp2) =>
        `error.message.includes("Extension context invalidated.")) {\n${sp1}location.reload();\n${sp2}}`,
    )
    out = out.replace(
      /error\.message\.includes\("Extension context invalidated\."\)\) \{\n(\s+)location\.reload\(\);\n(\s+)\} else if \(error instanceof Error && !error\.message\.includes\("disconnected port"\)\) \{\n(\s+)throw error;\n(\s+)\}/,
      (_, sp1, sp2) =>
        `error.message.includes("Extension context invalidated.")) {\n${sp1}location.reload();\n${sp2}}`,
    )
    out = out.replace(
      /error\.message\.includes\("Extension context invalidated\."\)\) \{\n(\s+)location\.reload\(\);\n(\s+)\} else if \(!\(error instanceof Error && error\.message\.includes\("disconnected port"\)\)\)\n(\s+)throw error;/,
      (_, sp1, sp2) =>
        `error.message.includes("Extension context invalidated.")) {\n${sp1}location.reload();\n${sp2}}`,
    )

    // Patch D — handleDisconnect: null the dead port and schedule an immediate
    // reconnect (1 s) so HMR recovers after a SW restart instead of waiting up
    // to 5 minutes for the setInterval to fire.  The try/catch around initPort()
    // ensures that a not-yet-ready SW doesn't surface a new error.
    out = out.replace(
      '  handleDisconnect = () => {\n    if (this.callbacks.has("close"))\n      for (const cb of this.callbacks.get("close")) {\n        cb({ wasClean: true });\n      }\n  };',
      '  handleDisconnect = () => {\n    this.port = null;\n    if (this.callbacks.has("close"))\n      for (const cb of this.callbacks.get("close")) {\n        cb({ wasClean: true });\n      }\n    setTimeout(() => { try { this.initPort(); } catch (_) {} }, 1e3);\n  };',
    )

    return out
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
      // Patch the contentHmrPort template string embedded in the CRXJS plugin source
      // so that every file CRXJS generates is already correct — eliminating the race
      // window between CRXJS writing the unpatched file and our file-watcher re-patching it.
      //
      // Three fixes applied to the template:
      //  1. Ping-interval catch: remove the else-if-throw so any Chrome port error
      //     (e.g. "Attempting to use a disconnected port object") is silently swallowed
      //     instead of bubbling up as an uncaught exception from a timer callback.
      //  2. handleDisconnect: null the dead port and schedule an immediate reconnect
      //     so HMR recovers after a SW restart without waiting up to 5 minutes.
      //  3. send(): remove the else-throw so a null/dead port is silently skipped.
      function patchContentHmrPortTemplate(src: string): string {
        let out = src
        // Fix 1 — swallow all non-reload errors from the ping interval
        out = out.replace(
          '} else if (!(error instanceof Error && error.message.includes(\\"disconnected port\\")))\\n          throw error;',
          '}',
        )
        // Fix 2 — handleDisconnect: null port + auto-reconnect
        out = out.replace(
          'handleDisconnect = () => {\\n    if (this.callbacks.has(\\"close\\"))\\n      for (const cb of this.callbacks.get(\\"close\\")) {\\n        cb({ wasClean: true });\\n      }\\n  };',
          'handleDisconnect = () => {\\n    this.port = null;\\n    if (this.callbacks.has(\\"close\\"))\\n      for (const cb of this.callbacks.get(\\"close\\")) {\\n        cb({ wasClean: true });\\n      }\\n    setTimeout(() => { try { this.initPort(); } catch (_) {} }, 1e3);\\n  };',
        )
        // Fix 3 — remove else-throw from send()
        out = out.replace(
          '\\n    else\\n      throw new Error(\\"HMRPort is not initialized\\");',
          '',
        )
        return out
      }

      applyPatch(
        path.resolve(__dirname, 'node_modules/@crxjs/vite-plugin/dist/index.mjs'),
        (src) => patchContentHmrPortTemplate(src).replace(
          'matches: ["<all_urls>"]',
          'matches: ["https://*.zeronetworks.com/*"]',
        ),
      )
      applyPatch(
        path.resolve(__dirname, 'node_modules/@crxjs/vite-plugin/dist/index.cjs'),
        (src) => patchContentHmrPortTemplate(src).replace(
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
      // crx-client-port.js middleware + file-watcher both use the hoisted
      // patchCrxClientPort() so all three patches (A/B/C) are applied consistently.
      server.middlewares.use((req, res, next) => {
        if (!req.url?.includes('/vendor/crx-client-port.js')) return next()
        const filePath = path.resolve(__dirname, 'dist', 'vendor', 'crx-client-port.js')
        if (!fs.existsSync(filePath)) return next()
        const src = fs.readFileSync(filePath, 'utf8')
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        res.end(patchCrxClientPort(src))
      })

      // Re-patch the disk file whenever CRXJS overwrites it.
      const crxPortPath = path.resolve(__dirname, 'dist', 'vendor', 'crx-client-port.js')
      server.watcher.add(crxPortPath)
      server.watcher.on('change', (changedPath) => {
        if (changedPath !== crxPortPath) return
        applyPatch(crxPortPath, patchCrxClientPort)
      })

      // Re-patch vite-client.js whenever CRXJS regenerates it (overwriting the
      // closeBundle disk patch).  Without this watcher the Patch D that scopes
      // console forwarding to chrome-extension:// pages never survives a rebuild,
      // so the portal page's own console.error calls bleed into the extension
      // error panel (e.g. "[ZN] map failed: ReferenceError: L is not defined"
      // showing up with the portal URL as context).
      function patchViteClientDisk(src: string): string {
        let out = src
        // a) Remove webcomponents polyfill import
        out = out.replace("import '/vendor/webcomponents-custom-elements.js';", '')
        out = out.replace('import "/vendor/webcomponents-custom-elements.js";', '')
        // b) Skip the direct-WebSocket fallback
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
        // d) Scope console forwarding to chrome-extension:// pages only
        out = out.replace(
          '"logLevels":["error","warn"]}',
          '"logLevels":(location.protocol==="chrome-extension:"?["error","warn"]:[])}'
        )
        return out
      }
      const viteClientPath = path.resolve(__dirname, 'dist', 'vendor', 'vite-client.js')
      server.watcher.add(viteClientPath)
      server.watcher.on('change', (changedPath) => {
        if (changedPath !== viteClientPath) return
        applyPatch(viteClientPath, patchViteClientDisk)
      })

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

        // Patch D — scope console forwarding to extension pages only.
        // The content script's Vite client wraps console.error/warn on the host
        // web page, intercepting the portal app's own internal errors and surfacing
        // them as extension errors (e.g. "map-insights-grid: NOT FOUND").
        // When running on a web page (content script context) we disable forwarding
        // so only chrome-extension:// pages forward their console logs.
        src = src.replace(
          '"logLevels":["error","warn"]}',
          '"logLevels":(location.protocol==="chrome-extension:"?["error","warn"]:[])}'
        )

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

      // Patch C — scope console forwarding to extension pages only (see closeBundle for details).
      patched = patched.replace(
        '"logLevels":["error","warn"]}',
        '"logLevels":(location.protocol==="chrome-extension:"?["error","warn"]:[])}'
      )

      return patched === code ? null : { code: patched, map: null }
    },

    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist')

      // Apply all three crx-client-port.js guards (A/B/C) via the shared helper —
      // same function used by the dev-server middleware and file watcher above.
      applyPatch(path.join(distDir, 'vendor', 'crx-client-port.js'), patchCrxClientPort)

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
        // d) Scope console forwarding to extension pages only.
        // The content script runs on web pages (e.g. the Zero Networks portal) and
        // shares the same console object with the host page.  Without this guard,
        // the Vite client wraps console.error/warn and forwards the portal app's
        // own internal errors (e.g. "map-insights-grid: NOT FOUND") as if they
        // were extension errors.  Restricting forwarding to chrome-extension://
        // pages eliminates these false positives while preserving error reporting
        // for the real extension pages (dashboard iframes, side panel, etc.).
        out = out.replace(
          '"logLevels":["error","warn"]}',
          '"logLevels":(location.protocol==="chrome-extension:"?["error","warn"]:[])}'
        )
        return out
      })

      // Fix 3: convert static HTTP imports in service-worker-loader.js to a
      // resilient dynamic-import wrapper with exponential-backoff retry.
      //
      // CRXJS generates:
      //   import 'http://localhost:5173/@vite/env';
      //   import 'http://localhost:5173/@crx/client-worker';
      //   import 'http://localhost:5173/src/background/index.ts';
      //
      // Chrome terminates MV3 service workers after 30 s of inactivity and
      // tries to restart them on demand.  Each restart re-evaluates those
      // static imports.  If the dev server is even momentarily unreachable
      // (browser cold-start before Vite is up, a hot-rebuild window, dev
      // server restart) the fetch fails and Chrome logs
      // "Service worker registration failed. Status code: 3" in the Errors
      // panel — the "again and again" pattern the user sees.
      //
      // Converting to dynamic imports with retry means:
      //   • The SW registers successfully immediately (no registration failure)
      //   • Dev modules load asynchronously once the server is ready
      //   • Transient hiccups are retried silently instead of surfacing as errors
      applyPatch(path.join(distDir, 'service-worker-loader.js'), (src) => {
        // Only patch dev-mode files that contain the localhost HTTP imports
        if (!src.includes("import 'http://localhost:")) return src
        // Extract the quoted URLs from the static imports in order
        const urlRegex = /^import '(http:\/\/[^']+)';$/gm
        const urls: string[] = []
        let m: RegExpExecArray | null
        while ((m = urlRegex.exec(src)) !== null) urls.push(m[1])
        if (urls.length === 0) return src
        // Each import() uses a string literal (not a variable) — Chrome's service
        // worker parser rejects import(expression) with a runtime variable.
        const importLines = urls.map(u => `    await import('${u}');`).join('\n')
        return (
          `// patched by patchCrxjsDevAssets: resilient dynamic-import with retry\n` +
          `(async function retry(n) {\n` +
          `  try {\n` +
          `${importLines}\n` +
          `  } catch (_) {\n` +
          `    if (n < 12) setTimeout(() => retry(n + 1), Math.min(500 * Math.pow(2, n), 8000));\n` +
          `  }\n` +
          `})(0);\n`
        )
      })

      // Fix 4: strip the MAIN-world HMR console.warn from every content loader
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
