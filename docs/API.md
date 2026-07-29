# Presentation Commander Client — Interfaces

Four things talk to this app from outside, plus one file format it reads and writes.

| § | Interface | Source |
|---|---|---|
| [1](#1-osc-control) | **OSC control** — actions in, feedback out | `src/renderer/src/osc/protocol.ts`, `src/main/services/oscControlServer.ts` |
| [2](#2-master-server-link) | Master Server link — WebSocket client | `src/main/services/serverLink.ts`, `src/shared/protocol.ts` |
| [3](#3-browser-extension-bridge) | Browser-extension bridge — WebSocket `:9801` | `src/main/services/browserBridge.ts`, `extension/` |
| [4](#4-notes-sidecar-format) | `.notes.json` sidecar | `src/main/index.ts` |
| [5](#5-source-capability-matrix) | What each source type can actually do | `src/renderer/src/sources/` |

---

## 1. OSC control

A generic UDP OSC transport in the main process; the protocol semantics live in the renderer,
where the real app state already is. Bundles are unwrapped to individual messages.

### Ports

| | Default | Meaning |
|---|---|---|
| `localPort` | **35551** | this app listens here for actions |
| `remoteHost` | `127.0.0.1` | where feedback is sent |
| `remotePort` | **35550** | feedback destination port |
| `autoStart` | `false` | off unless you turn it on |

Two ports, action-in and feedback-out, is the OSCPoint-derived architecture. Config persists to
`osc-config.json` in Electron's `userData` directory.

> **No authentication, and OSC is UDP.** Anything that can send a datagram to the listening port
> can drive the presentation — jump slides, blank the screen, open and close Program Out, list
> and open files from the watched folder, and set the desktop wallpaper. There is no token and
> no source-address check. Keep it on a control network.

### Gating — three switches that silently swallow messages

This is the most common source of "the button does nothing":

1. **`actions/enable`** — while actions are disabled, **every inbound message except
   `/presentcommander/actions/enable` is dropped**. No response, no log.
2. **`feedbacks/enable`** — while feedbacks are disabled, nothing is sent out. `feedbacks/refresh`
   is the exception: it **always** sends, regardless of the flag, because it is an explicit
   request.
3. **`filesEnabled`** — all three `/files/*` actions are no-ops unless file control is switched
   on in the app.

Additionally, `slideshow/pause` and `slideshow/resume` are **no-ops unless timed auto-advance is
already enabled**. They suspend and resume an already-configured auto-advance timer; they do not
turn the feature on from cold.

**Nothing reports a refusal.** An address this app can't fulfil for the current source falls
through to the switch's default case and is silently ignored — not treated as an error.

### Actions (inbound)

| Address | Args | Behaviour |
|---|---|---|
| `/presentcommander/actions/enable` | — | The only message accepted while disabled |
| `/presentcommander/actions/disable` | — | |
| `/presentcommander/feedbacks/enable` | — | Also triggers a full refresh |
| `/presentcommander/feedbacks/disable` | — | |
| `/presentcommander/feedbacks/refresh` | — | Always sends, even when feedbacks are disabled |
| `/presentcommander/next` | — | |
| `/presentcommander/previous` | — | |
| `/presentcommander/goto/slide` | int/float | **Clamped** to 1…totalPages, rounded. Out of range is not an error. |
| `/presentcommander/goto/slide/first` | — | |
| `/presentcommander/goto/slide/last` | — | |
| `/presentcommander/goto/section` | string | **Case-sensitive exact match.** Unknown name = silent no-op. |
| `/presentcommander/slideshow/start` | int? | Opens Program Out, goes to that page (default 1) |
| `/presentcommander/slideshow/start/current` | — | Opens Program Out, stays put |
| `/presentcommander/slideshow/end` | — | Closes Program Out |
| `/presentcommander/slideshow/black` | bool? | **Omit the arg and it toggles**; send a bool to set explicitly |
| `/presentcommander/slideshow/white` | bool? | Same. Black and white are one `screenBlank` state — setting one clears the other. |
| `/presentcommander/slideshow/laserpointer` | bool? | Omit to toggle |
| `/presentcommander/slideshow/setwallpaper` | int?, int? | Renders the current screen and sets it as desktop wallpaper. Defaults 1920×1080. |
| `/presentcommander/slideshow/pause` | — | No-op unless auto-advance is enabled |
| `/presentcommander/slideshow/resume` | — | Same |
| `/presentcommander/files/setpath` | string | **Relative to the user's home directory**, always |
| `/presentcommander/files/list` | — | |
| `/presentcommander/files/open` | string | Bare filename only |
| `/presentcommander/media/play` | — | PowerPoint-on-Windows only (§5) |
| `/presentcommander/media/pause` | — | Same |
| `/presentcommander/media/playpause` | — | Same |
| `/presentcommander/media/stop` | — | Same |

**Argument coercion is permissive.** Numbers accept `integer`, `float`, `double` and `bigint`.
Booleans accept any of those (non-zero = true) plus the OSC `true`/`false` types. Strings accept
`string`, `symbol`, `character`, **and `blob`** — a blob is decoded as UTF-8, so non-ASCII
values can be sent that way. An argument of an unusable type is treated as *absent*, which for
`black`/`white`/`laserpointer` means **it toggles instead of setting** — a malformed "turn
blackout on" can therefore turn it off.

**`files/open` rejects path traversal.** Anything containing `/`, `\` or `..` is refused, as is
any extension outside `.pdf`, `.key`, `.pptx`, `.ppt`. Refusal is a silent no-op returning
`null`, not an error. It does **not** check the file exists — that surfaces when the source
tries to open it.

### Feedback (outbound)

Sent to `remoteHost:remotePort` when feedbacks are enabled.

| Address | Type | Notes |
|---|---|---|
| `/presentcommander/presentation` | string | A **JSON document** (see below) |
| `/presentcommander/presentation/name` | string | `''` when nothing is loaded |
| `/presentcommander/presentation/slides/count` | int | |
| `/presentcommander/presentation/slides/count/visible` | int | Currently always equal to `count` |
| `/presentcommander/slideshow/state` | string | `edit` \| `running` \| `paused` |
| `/presentcommander/slideshow/currentslide` | int | **Not sent when `totalPages` is 0** |
| `/presentcommander/slideshow/slidesremaining` | int | Same |
| `/presentcommander/slideshow/notes` | string | ASCII-safe form |
| `/presentcommander/slideshow/notes-utf8` | blob | UTF-8 bytes — **use this one** for anything non-ASCII |
| `/presentcommander/slideshow/section/index` | int | **1-based.** Not sent at all unless the current page falls inside a known section. |
| `/presentcommander/slideshow/section/name` | string | |
| `/presentcommander/slideshow/section/slidesremaining` | int | Within the section |
| `/presentcommander/files/enabled` | bool | |
| `/presentcommander/files/activefolder` | string | Relative to home; `''` if unset |
| `/presentcommander/files/activefolder/fullpath` | string | |
| `/presentcommander/slideshow/media/duration` | int (ms) | **Not sent unless a duration is known** |

Several of these are **absent rather than zero** when they don't apply, which is deliberate: a
controller can tell "no sections exist" apart from "section 0 of 0", and there is no fabricated
section-of-1 when a deck has no sections. If you are building a surface, treat a missing message
as "unknown", not as a default value.

`slideshow/state` is derived: `edit` when Program Out is closed; otherwise `paused` if
auto-advance is enabled *and* paused, else `running`.

`/presentcommander/presentation` carries:

```json
{ "name": "…", "path": "…", "slideCount": 42, "saved": true,
  "active": true, "slideshow": false,
  "sections": [{ "id": "0", "name": "…", "firstSlide": 1, "lastSlide": 12 }] }
```

`saved` is **hardcoded `true`**. `active` means `slideCount > 0`. `slideshow` mirrors whether
Program Out is open. `sections` is `null` when there are none.

**Not exposed on any source, at all:** media seeking (`/media/goto/position/*`) and bookmark
navigation (`/media/goto/bookmark/*`). No known automation technique reaches them, even where
play/pause/stop works.

---

## 2. Master Server link

This app is a **WebSocket client** of the
[Master Server](https://github.com/stoatworks-labs/presentation-commander-server)'s hub, at
`ws://<host>:9800`. Message shapes are in `src/shared/protocol.ts` and are **mirrored by hand**
in the server repo — see [DEVELOPING.md](DEVELOPING.md).

**Out:** `register` (name, platform, app), then `slide-state` (totalSlides, currentSlideIndex,
notesBySlide) as things change.

**In:** `registered` (clientId), and `command` carrying `next-slide` / `previous-slide`.

Behaviour worth knowing:

- **There is no reconnect.** `connect()` opens one socket; on close, status becomes
  `disconnected` and it stays there until something reconnects it. A network blip during a show
  drops the link permanently.
- **Malformed frames are ignored silently**, in both directions.
- **`registered` is not waited for.** `register` is sent on open and slide state can start
  flowing immediately.
- `pushSlideState` **drops silently** if the socket isn't open — no queue, no error.
- **The server identifies clients by `name`.** Two machines registering with the same name
  collapse into one client on the server side. Name each machine distinctly.

---

## 3. Browser-extension bridge

A **WebSocket server on port 9801**, local, that the MV3 extension in `extension/` connects to
from its background service worker. It reports live slide and notes state from Google Slides'
audience tab or Canva's Presenter popout.

```ts
{ type: 'slide-update' | 'slide-notes',
  app: 'google-slides' | 'canva',
  presentationId: string | null, slideId: string,
  index?: number|null, total?: number|null,
  frameDataUrl?: string|null, notes?: string }
```

The two platforms deliver notes differently, and that asymmetry is real, not a bug:

- **Google Slides** — frame and index arrive immediately on `slide-update`; notes resolve a beat
  later in a separate `slide-notes` message, **fetched from the Slides API rather than scraped**,
  and cached by `slideId`. Expect notes to lag the frame slightly.
- **Canva** — notes are **scraped in-page** (Canva has no public API for them) and arrive already
  populated on `slide-update`. The frame comes from Canva's own untainted `<canvas>` via
  `toDataURL()`, so no `chrome.tabCapture` permission is needed. The notes text is read from a
  `<span>` that Canva only renders once notes are non-empty — the `<textarea>` exists solely as
  an "Add notes…" placeholder when they're empty, so it can't be read directly.

Only one platform presents at a time, but every update is tagged with `app` so each SlideSource
can ignore the other's messages.

---

## 4. Notes sidecar format

Presenter notes live in a `.notes.json` file **next to the PDF**, named by replacing the `.pdf`
extension. **Two shapes are read; one is written by this app.**

**Bare map** — what this app has always written itself:

```json
{ "1": "Welcome the audience.", "2": "Advance on cue." }
```

**Generated sidecar** — what
[presentation-converter](https://github.com/stoatworks-labs/presentation-converter) writes:

```json
{ "schemaVersion": 1,
  "notes": { "1": "…", "2": "…" },
  "slides": [ { "page": 1, "index": 0, "notes": "…", "hidden": false } ] }
```

It is recognised by having a numeric `schemaVersion` **and** an object `notes`. The extra
envelope carries provenance — the source deck, the engines used, per-slide detail, and whether
hidden slides shifted the page mapping — which is why the notes sit under a key rather than at
the top level. (Exporters drop hidden slides, so slide count ≠ page count; `slides[].page` is
`null` for a slide that produced no page.)

**Saving preserves the envelope.** If the existing file is a generated sidecar, this app merges
the note map into it and updates `slides[].notes` for entries with a real `page`, rather than
overwriting the file with a bare map — otherwise the provenance would be silently destroyed on
the first edit. If there is no readable sidecar, it writes the plain map.

Keys that aren't pure digits, and values that aren't strings, are skipped on read.

---

## 5. Source capability matrix

Not every source can do everything, and the gaps are researched limitations rather than
unimplemented stubs. `SlideSource` declares the optional methods; a source that can't do
something **omits the method entirely** rather than returning empty — so the dispatcher can tell
"none exist" from "not supported here".

| | PDF | Keynote (mac) | PowerPoint (mac) | PowerPoint (Win) | Google Slides | Canva |
|---|---|---|---|---|---|---|
| Render / navigate | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Drives the real app | — | ✅ | ✅ | ✅ | ✅ (synthetic keys) | ✅ (synthetic keys) |
| External page change detected | — | ✅ (~400 ms poll) | ✅ | ✅ | ✅ | ✅ |
| Internal page links (`getLinks`) | ✅ | — | — | — | — | — |
| Sections (`getSections`) | ✅ | — | ⚠ always empty | ✅ | — | — |
| Media play/pause/stop | — | — | ⚠ silent no-op | ✅ | — | — |
| Media duration | — | — | ⚠ always `null` | ✅ | — | — |
| Live screen capture | — | ✅ (macOS) | ✅ (macOS) | — | — | — |

⚠ **The PowerPoint source declares these methods on both platforms**, so on macOS the media and
section addresses are *accepted and silently do nothing* rather than falling through as
unsupported. A controller cannot tell that apart from "there is no media on this slide".

**Sections are captured once, at open time** (Windows COM `SectionProperties`), and are not
live-polled — a presenter editing sections mid-show won't be reflected.

Why the gaps are where they are — each was established by inspection, not assumed:

- **Media control exists only on PowerPoint/Windows**, via an Alt+P `SendKeys` toggle that
  **requires a live PowerPoint slideshow running independently of this bridge**. There is no
  separate play-only or pause-only shortcut and no documented way to query playback state over
  COM, so **all four media addresses call the same toggle**. That is a disclosed limitation, not
  a bug.
- **Keynote** — `Keynote.sdef` was inspected directly: its `movie` class exposes **zero playback
  commands**, only static properties (file name, volume, opacity, rotation).
- **PowerPoint on macOS** — `PowerPoint.sdef` exposes only read-only file-name/link properties on
  its media classes, less even than Keynote. It *does* support media **duration**, via
  `Shape.MediaFormat.Length`, which works against the plain Slides collection with no live
  slideshow needed.
- **PDF** — pdf.js has no embedded-video playback model at all.
- **Google Slides / Canva** — not attempted in this pass.
- **Neither platform drives PowerPoint's own fullscreen slideshow mode** — confirmed unreliable
  under automation and virtualization on both, the same class of problem as Keynote's
  `start`/`show`. The editing view's current slide is enough, because Program Out / NDI is what
  the audience actually sees.

---

## See also

- [USER-GUIDE.md](USER-GUIDE.md) — operating it, per source
- [DEVELOPING.md](DEVELOPING.md) — building, adding a source, the traps
- [README](../README.md) — features, architecture, prior art
