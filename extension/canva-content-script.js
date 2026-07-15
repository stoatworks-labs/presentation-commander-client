// Runs inside Canva's Presenter Window (https://www.canva.com/popout) — a
// genuinely separate OS-level window opened via a live window.opener
// handshake from the editor tab, not a fresh-navigable URL (confirmed live:
// navigating straight to /popout shows a blank page). This script only runs
// once that window is already open and populated, so it doesn't need to
// worry about that handshake at all — it just observes the DOM.
//
// Unlike Google Slides, the popout's URL never changes (always exactly
// /popout, no query params), so there's no URL-derived slide id to key off.
// The slide index itself is the only stable identity available; it comes
// from the "N / M" counter Canva renders in the toolbar.

const COUNT_RE = /^(\d+)\s*\/\s*(\d+)$/

let lastSentKey = null

function currentIndexAndTotal() {
  for (const el of document.querySelectorAll('span')) {
    if (el.children.length > 0) continue
    const match = COUNT_RE.exec((el.textContent || '').trim())
    if (match) return { index: Number(match[1]), total: Number(match[2]) }
  }
  return { index: null, total: null }
}

function captureFrameDataUrl() {
  const canvases = Array.from(document.querySelectorAll('canvas')).sort(
    (a, b) => b.width * b.height - a.width * a.height
  )
  for (const canvas of canvases) {
    try {
      const url = canvas.toDataURL('image/png')
      if (url && url !== 'data:,') return url
    } catch (err) {
      // Tainted canvas (cross-origin asset drawn without CORS) — try the
      // next one; confirmed live that the main slide canvas is untainted,
      // but a defensive fallback costs nothing.
      console.warn('[presentation-commander] Canva frame capture failed:', err)
    }
  }
  return null
}

// Confirmed live (twice, independently): Canva only renders the presenter-
// notes <textarea> (aria-label="Presenter notes.") when notes are EMPTY —
// it's an "Add notes…" placeholder prompt, not a live mirror of real text.
// Once notes have content, that textarea disappears entirely and the text
// renders instead as a plain <span class="GR6TCg">. That class name is a
// Canva CSS-module hash, not a stable public API, so it's used as a fast
// primary check with a positional fallback (anchored on the "Notes" section
// heading, which is present in both states) in case Canva ever renames it.
function currentNotes() {
  const span = document.querySelector('span.GR6TCg')
  const spanText = (span?.textContent || '').trim()
  if (spanText) return spanText

  const heading = Array.from(document.querySelectorAll('p, span, div')).find(
    (el) => el.children.length === 0 && (el.textContent || '').trim() === 'Notes'
  )
  if (!heading) return ''

  const hRect = heading.getBoundingClientRect()
  let best = null
  let bestDist = Infinity
  for (const el of document.querySelectorAll('span, div, p')) {
    if (el === heading || el.contains(heading) || heading.contains(el)) continue
    if (el.children.length > 0) continue
    // Skip the "N characters remaining" live region and the heading's own
    // text — confirmed live that both sit close enough to the heading to
    // otherwise win this search and produce a false match.
    if (el.closest('[aria-live]')) continue
    const text = (el.textContent || '').trim()
    if (!text || text === 'Notes' || /characters remaining$/.test(text)) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const dist = Math.abs(r.x - hRect.x) + Math.abs(r.y - hRect.y)
    if (dist < 150 && dist < bestDist) {
      bestDist = dist
      best = text
    }
  }
  return best ?? ''
}

function reportIfChanged() {
  const { index, total } = currentIndexAndTotal()
  if (index === null || total === null) return

  const frameDataUrl = captureFrameDataUrl()
  const notes = currentNotes()
  // Same race-avoidance as the Slides content script: don't latch this
  // slide as "reported" until a frame is actually captured, so a poll tick
  // that races ahead of rendering retries instead of getting stuck.
  const key = `${index}:${total}:${notes}:${frameDataUrl ? 'framed' : 'pending'}`
  if (key === lastSentKey) return
  lastSentKey = key

  chrome.runtime.sendMessage({
    type: 'canva-slide-update',
    slideId: `page-${index}`,
    index,
    total,
    frameDataUrl,
    notes
  })
}

// Canva's Presenter Window is a single static-URL SPA — content changes
// (slide advance, notes edited live in the editor tab) happen via in-place
// DOM mutation, so poll rather than watch for navigation.
setInterval(reportIfChanged, 250)
reportIfChanged()

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'navigate') return
  const key = message.direction === 'next' ? 'ArrowRight' : 'ArrowLeft'
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true })
  )
})
