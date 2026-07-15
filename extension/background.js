// Service worker: bridges whichever content script is currently active
// (Google Slides' audience tab, or Canva's Presenter Window) to the
// Presentation Commander Client's local WebSocket server. Google Slides
// notes are resolved via the official Slides API instead of scraping the
// presenter-notes popup (which a content script running on the audience tab
// can't reach anyway — see the plan's Phase 2 notes); Canva has no
// equivalent public API, so canva-content-script.js scrapes notes text
// directly from the Presenter Window's DOM and sends it already resolved.

const BRIDGE_URL = 'ws://localhost:9801'
const notesCache = new Map() // presentationId+slideId -> notes text (Google Slides only)

const CONTENT_SCRIPT_URL_PATTERNS = {
  'google-slides': 'https://docs.google.com/presentation/*/present*',
  canva: 'https://www.canva.com/popout*'
}

let socket = null
let reconnectTimer = null

function connect() {
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    return
  }
  socket = new WebSocket(BRIDGE_URL)

  socket.addEventListener('open', () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  })

  socket.addEventListener('message', (event) => {
    let message
    try {
      message = JSON.parse(event.data)
    } catch {
      return
    }
    if (message.type === 'navigate') {
      forwardToActiveContentScript(message)
    }
  })

  socket.addEventListener('close', scheduleReconnect)
  socket.addEventListener('error', () => socket?.close())
}

function scheduleReconnect() {
  if (reconnectTimer) return
  // The Client app may not be running yet, or may restart — keep trying.
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, 2000)
}

function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
}

// MV3 service workers get suspended after ~30s idle, and any pending
// setTimeout (scheduleReconnect's 2s retry included) is discarded when that
// happens rather than firing later — so a dead socket can sit un-reconnected
// indefinitely with nothing left to wake it. Rather than trust the timer,
// treat every incoming event as a chance to notice the socket isn't OPEN and
// re-establish it — this covers both a genuinely fresh worker restart (where
// connect() at the bottom of this file already handles it) and a resumed
// worker whose in-memory `socket` still points at something CLOSED.

async function forwardToActiveContentScript(message) {
  const pattern = CONTENT_SCRIPT_URL_PATTERNS[message.app]
  const urls = pattern ? [pattern] : Object.values(CONTENT_SCRIPT_URL_PATTERNS)
  const tabs = await chrome.tabs.query({ url: urls })
  for (const tab of tabs) {
    if (tab.id) chrome.tabs.sendMessage(tab.id, message)
  }
}

async function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError ?? new Error('No auth token'))
      } else {
        resolve(token)
      }
    })
  })
}

async function fetchNotes(presentationId, slideId) {
  const cacheKey = `${presentationId}:${slideId}`
  if (notesCache.has(cacheKey)) return notesCache.get(cacheKey)

  try {
    const token = await getAuthToken()
    const res = await fetch(
      `https://slides.googleapis.com/v1/presentations/${presentationId}/pages/${slideId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) throw new Error(`Slides API ${res.status}`)
    const page = await res.json()
    const notesObjectId = page.slideProperties?.notesPage?.notesProperties?.speakerNotesObjectId
    const notesShape = page.slideProperties?.notesPage?.pageElements?.find(
      (el) => el.objectId === notesObjectId
    )
    const text =
      notesShape?.shape?.text?.textElements
        ?.map((el) => el.textRun?.content ?? '')
        .join('')
        .trim() ?? ''
    notesCache.set(cacheKey, text)
    return text
  } catch (err) {
    console.warn('[presentation-commander] fetching speaker notes failed:', err)
    return ''
  }
}

chrome.runtime.onMessage.addListener((message) => {
  connect()

  if (message?.type === 'slide-update') {
    send({
      type: 'slide-update',
      app: 'google-slides',
      presentationId: message.presentationId,
      slideId: message.slideId,
      index: message.index,
      total: message.total,
      frameDataUrl: message.frameDataUrl,
      notes: ''
    })

    if (message.presentationId && message.slideId) {
      fetchNotes(message.presentationId, message.slideId).then((notes) => {
        send({
          type: 'slide-notes',
          app: 'google-slides',
          presentationId: message.presentationId,
          slideId: message.slideId,
          notes
        })
      })
    }
    return
  }

  if (message?.type === 'canva-slide-update') {
    // Canva has already resolved notes text in-page (no API to fetch it
    // from), so this sends a complete update in one message — no matching
    // 'slide-notes' follow-up like Google Slides needs.
    send({
      type: 'slide-update',
      app: 'canva',
      presentationId: null,
      slideId: message.slideId,
      index: message.index,
      total: message.total,
      frameDataUrl: message.frameDataUrl,
      notes: message.notes ?? ''
    })
  }
})

connect()
