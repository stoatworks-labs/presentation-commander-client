// Service worker: bridges the content script (which sees the live Slides
// tab) to the Presentation Commander Client's local WebSocket server, and
// resolves speaker notes via the official Slides API instead of scraping
// the presenter-notes popup (which a content script running on the
// audience tab can't reach anyway — see the plan's Phase 2 notes).

const BRIDGE_URL = 'ws://localhost:9801'
const notesCache = new Map() // presentationId+slideId -> notes text

let socket = null
let reconnectTimer = null

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
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

async function forwardToActiveContentScript(message) {
  const tabs = await chrome.tabs.query({ url: 'https://docs.google.com/presentation/*/present*' })
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
  if (message?.type !== 'slide-update') return
  send({
    type: 'slide-update',
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
        presentationId: message.presentationId,
        slideId: message.slideId,
        notes
      })
    })
  }
})

connect()
