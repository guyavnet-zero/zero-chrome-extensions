import './style.css'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const { version } = chrome.runtime.getManifest()
const CONTACT_EMAIL = 'guy.avnet@zeronetworks.com'
const FORMSPREE_URL = 'https://formspree.io/f/xwvayppg'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---------------------------------------------------------------------------
// Feedback modal
// ---------------------------------------------------------------------------
const backdrop  = document.getElementById('feedback-modal-backdrop')!
const form      = document.getElementById('feedback-form') as HTMLFormElement
const submitBtn = document.getElementById('feedback-submit-btn') as HTMLButtonElement
const statusEl  = document.getElementById('feedback-form-status')!
const typeEl    = document.getElementById('feedback-type') as HTMLSelectElement

function openFeedbackModal(presetType?: string) {
  form.reset()
  setStatus('', '')
  if (presetType) typeEl.value = presetType
  backdrop.removeAttribute('aria-hidden')
  backdrop.classList.add('open')
  ;(presetType ? document.getElementById('feedback-message') : typeEl)?.focus()
}

function closeFeedbackModal() {
  backdrop.setAttribute('aria-hidden', 'true')
  backdrop.classList.remove('open')
  form.reset()
  setStatus('', '')
}

function setStatus(msg: string, type: string) {
  statusEl.textContent = msg
  statusEl.className   = 'feedback-status' + (type ? ' feedback-status--' + type : '')
}

document.getElementById('feedback-modal-close-btn')!
  .addEventListener('click', closeFeedbackModal)

backdrop.addEventListener('click', (e) => {
  if (e.target === backdrop) closeFeedbackModal()
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && backdrop.classList.contains('open')) closeFeedbackModal()
})

form.addEventListener('submit', async (e) => {
  e.preventDefault()

  const type    = typeEl.value
  const email   = (document.getElementById('feedback-email') as HTMLInputElement).value.trim()
  const message = (document.getElementById('feedback-message') as HTMLTextAreaElement).value.trim()

  if (!type)    { setStatus('Please select a feedback type.', 'error'); return }
  if (!message) { setStatus('Please describe your feedback.',  'error'); return }

  submitBtn.disabled = true
  setStatus('Collecting diagnostics…', '')

  // Always collect the debug bundle silently before posting.
  let debugBundle: Record<string, unknown> | null = null
  try {
    debugBundle = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'ZN_GET_DEBUG_BUNDLE' }, (bundle) => {
        void chrome.runtime.lastError
        resolve((bundle as Record<string, unknown>) ?? null)
      })
    })
  } catch { /* no extension context — proceed without bundle */ }

  setStatus('Sending…', '')

  const payload: Record<string, unknown> = {
    type,
    email:   email || '(not provided)',
    message,
    _source: 'popup_feedback',
  }
  if (debugBundle) payload._debug = debugBundle

  try {
    const res  = await fetch(FORMSPREE_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))

    if (res.ok) {
      // Fire analytics event (fire-and-forget).
      chrome.runtime.sendMessage({
        type:   'ZN_ANALYTICS',
        event:  'feedback_submitted',
        envId:  (debugBundle?.portal_host as string) ?? '',
        params: { feedback_type: type, source: 'popup', extension_version: version },
      }, () => { void chrome.runtime.lastError })

      if (type === 'Bug Report') {
        chrome.runtime.sendMessage({
          type:   'ZN_ANALYTICS',
          event:  'bug_reported',
          envId:  (debugBundle?.portal_host as string) ?? '',
          params: { source: 'popup', error_count: (debugBundle?.error_count as number) ?? 0, extension_version: version },
        }, () => { void chrome.runtime.lastError })
      }

      setStatus('Thanks! Your feedback was sent.', 'success')
      form.reset()
      setTimeout(closeFeedbackModal, 2200)
    } else {
      const errMsg = (data as { error?: string }).error ?? 'Please try again.'
      setStatus('Something went wrong. ' + errMsg, 'error')
    }
  } catch {
    setStatus('Network error. Please check your connection and retry.', 'error')
  } finally {
    submitBtn.disabled = false
  }
})

// ---------------------------------------------------------------------------
// Open dashboard helper
// ---------------------------------------------------------------------------
async function openDashboard() {
  const tabs = await chrome.tabs.query({ url: '*://*.zeronetworks.com/*' })
  if (tabs.length > 0 && tabs[0].id !== undefined) {
    await chrome.tabs.update(tabs[0].id, { active: true })
    chrome.tabs.sendMessage(tabs[0].id, { action: 'openDashboard' }, () => {
      void chrome.runtime.lastError
    })
  } else {
    await chrome.tabs.create({ url: 'https://portal.zeronetworks.com' })
  }
  window.close()
}

// ---------------------------------------------------------------------------
// Render (static shell — only runs once)
// ---------------------------------------------------------------------------
function render() {
  const app = document.getElementById('app')!
  app.innerHTML = `
    <div class="popup-root">
      <header class="popup-header">
        <div class="popup-logo">
          <img src="${chrome.runtime.getURL('logo.svg')}" alt="Zero" class="popup-logo-img" />
          <div class="popup-logo-text">
            <span class="popup-name">Zero Connect Extension</span>
            <span class="popup-version">v${esc(version)}</span>
          </div>
        </div>
        <a class="popup-contact" href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>
      </header>

      <div class="popup-body">
        <p class="popup-desc">
          Zero Connect Extension adds a dashboard to your Zero Networks portal,
          giving remote-access admins a dedicated view under the Connect section.
          <button id="btn-open-dashboard" class="popup-desc-link">Click here</button>
          to open it.
        </p>

        <button class="btn btn--report" id="btn-report">
          Report a Bug
        </button>
      </div>
    </div>`

  document.getElementById('btn-report')!
    .addEventListener('click', () => openFeedbackModal('Bug Report'))
  document.getElementById('btn-open-dashboard')!
    .addEventListener('click', () => openDashboard())
}

// ---------------------------------------------------------------------------
// Update banner
// ---------------------------------------------------------------------------
function showUpdateBannerIfNeeded() {
  chrome.storage.local.get(['znUpdateAvailable', 'znLatestVersion'], (r) => {
    void chrome.runtime.lastError
    if (!r.znUpdateAvailable) return

    const latestVersion = esc(String(r.znLatestVersion ?? ''))
    const banner = document.createElement('div')
    banner.className = 'update-banner'
    banner.innerHTML =
      `<span class="update-banner__icon">↑</span>` +
      `<span class="update-banner__text">` +
        `Version <strong>v${latestVersion}</strong> available — ` +
        `open <strong>chrome://extensions</strong> and click <strong>↺</strong> next to Zero Connect.` +
      `</span>`

    document.querySelector('.popup-body')!.prepend(banner)
  })
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
render()
showUpdateBannerIfNeeded()
