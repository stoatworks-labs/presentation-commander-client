// Runs on the audience-facing Google Slides "present" tab. The presenter
// console / speaker-notes window are separate popups this script can't see
// (and doesn't need to — notes come from the Slides API in background.js,
// keyed off the slide id this script extracts from the URL).

const PRESENTATION_ID_RE = /\/presentation\/d\/([^/]+)/
const SLIDE_ID_RE = /[?&]slide=id\.([^&]+)/
const ALT_TEXT_RE = /^Slide (\d+) of (\d+):/

let lastSentKey = null

function currentPresentationId() {
  const match = location.href.match(PRESENTATION_ID_RE)
  return match ? match[1] : null
}

function currentSlideId() {
  const match = location.href.match(SLIDE_ID_RE)
  return match ? decodeURIComponent(match[1]) : null
}

function currentIndexAndTotal() {
  const img = document.querySelector('img[alt^="Slide "]')
  const match = img?.alt?.match(ALT_TEXT_RE)
  if (!match) return { index: null, total: null, img: null }
  return { index: Number(match[1]), total: Number(match[2]), img }
}

function captureFrameDataUrl(img) {
  if (!img || !img.naturalWidth) return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    return canvas.toDataURL('image/png')
  } catch (err) {
    // Tainted canvas (cross-origin slide asset without CORS) — index/notes
    // still get through, just no frame this tick.
    console.warn('[presentation-commander] frame capture failed:', err)
    return null
  }
}

function reportIfChanged() {
  const slideId = currentSlideId()
  if (!slideId) return

  const { index, total, img } = currentIndexAndTotal()
  // Google Slides can take a beat to actually render the new slide after
  // the URL updates — don't latch this slide as "reported" until the
  // alt-text index/total are available, so a poll tick that races ahead
  // of rendering retries instead of getting stuck on an incomplete update.
  if (index === null || total === null) return

  const frameDataUrl = captureFrameDataUrl(img)
  // Same race, one layer down: alt text can be ready before the image
  // itself has finished loading (naturalWidth still 0). Fold frame
  // availability into the dedup key too, so a tick that captured no frame
  // doesn't block a later tick — once captured — from sending it.
  const key = `${slideId}:${index}:${total}:${frameDataUrl ? 'framed' : 'pending'}`
  if (key === lastSentKey) return
  lastSentKey = key

  const presentationId = currentPresentationId()

  chrome.runtime.sendMessage({
    type: 'slide-update',
    presentationId,
    slideId,
    index,
    total,
    frameDataUrl
  })
}

// Google Slides is a SPA — the URL changes via the History API without a
// full navigation, and doesn't reliably fire popstate for every change
// observed live (arrow-key navigation especially), so poll instead.
setInterval(reportIfChanged, 250)
reportIfChanged()

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'navigate') return
  const key = message.direction === 'next' ? 'ArrowRight' : 'ArrowLeft'
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true })
  )
})
