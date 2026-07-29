# Presentation Commander Client — Developing

Electron + React + TypeScript via electron-vite, with a native N-API addon for NDI send, a
Chrome MV3 extension, and per-platform automation bridges into Keynote and PowerPoint.

---

## 1. The rule that binds three repos

This is the **client** half of a three-repo system, and they **share a wire protocol kept in
sync by hand**:

| Repo | Role |
|---|---|
| **presentation-commander-client** (this) | Runs on the presentation laptop |
| [presentation-commander-server](https://github.com/allansargeant/presentation-commander-server) | Master control: routing, scenes, notes |
| [companion-module-presentation-commander-client](https://github.com/allansargeant/companion-module-presentation-commander-client) | Companion module driving this app's OSC surface |

`src/shared/protocol.ts` is **mirrored by hand** in the server repo. A change to a message shape
here can break the master server mid-show. The OSC address space in
`src/renderer/src/osc/protocol.ts` is likewise a contract with the Companion module — the module
is the one people forget, because it lives outside the pair.

This drives what an audience sees. Prefer changes that **fail safe** (hold the last frame, keep
the current slide) over changes that fail open.

---

## 2. Setup

```bash
npm install          # postinstall runs electron-builder install-app-deps
npm run dev
```

### The NDI SDK is a build-time dependency

`native/ndi-send` links against the
[Vizrt NDI SDK](https://ndi.video/for-developers/ndi-sdk/) — no third-party wrapper. Install it
before `npm install`; override the location with `NDI_SDK_DIR` if it isn't in the default place
(macOS: `/Library/NDI SDK for Apple`). `@electron/rebuild` rebuilds the addon on install.

`native/ndi-send/scripts/resolve-sdk-dir.js` creates a **space-free symlink** at
`native/ndi-send/vendor-sdk`, because the default macOS SDK path contains spaces and node-gyp
doesn't cope.

### ⚠ Packaging depends on `scripts/clean-native-sdk-links.js`

That symlink resolves **outside the project tree**, and **electron-builder refuses to package
such a symlink**. Every `build:*` script removes it first. Omit that step in a custom build and
packaging breaks in ways that don't point back at the cause.

### Scripts

```bash
npm run dev
npm run typecheck        # BOTH tsconfigs — node and web are separate projects
npm run lint
npm run format
npm run build            # typecheck + electron-vite build
npm run build:mac        # / :win / :linux
```

**Two things to know:**

- **`build:mac` and `build:linux` skip the typecheck**, where `build:win` and `build:unpack` go
  through `npm run build`. Run `npm run typecheck` yourself before a mac or linux release.
- **There are no tests.** No test script, no test files. `typecheck` and `lint` are the only
  automated gates.

All packaging runs `--publish never`. CI: `.github/workflows/build-windows.yml` and
`release.yml`.

---

## 3. Architecture

```
src/
  main/                      Electron main process
    index.ts                   windows, IPC, notes sidecar read/write
    services/
      oscControlServer.ts      generic UDP OSC transport — knows nothing about slides
      serverLink.ts            WebSocket client of the Master Server hub
      browserBridge.ts         WebSocket server :9801 for the Chrome extension
      fileControl.ts           the watched folder
      ndiSender.ts             coalescing wrapper, keyed by streamId
      screenCapture.ts         live display capture
      keynoteBridge.ts         osascript / JXA
      powerpointBridgeMac.ts   osascript / AppleScript
      powerpointBridgeWin.ts   PowerShell COM
  renderer/src/
    osc/protocol.ts            THE OSC protocol — dispatch + feedback builders
    sources/                   SlideSource implementations
    pdf.ts, liveCapture.ts, regionDetect.ts
  shared/                      protocol.ts, osc.ts, sections.ts, programOut.ts, files.ts
extension/                     Chrome MV3 extension (Google Slides + Canva)
native/ndi-send/               N-API addon
```

### The OSC split

`oscControlServer.ts` is a **generic transport that deliberately has no idea what a slide is**.
Every inbound message (bundles unwrapped) is emitted as a raw `action` event; all protocol
semantics live in `src/renderer/src/osc/protocol.ts`, where the real app state already is. Keep
that split — putting slide knowledge into the transport is how the two ends drift.

`protocol.ts` is written against a plain **`OscSnapshot`** rather than live state, so callers can
read it from a ref without stale-closure problems. Feedback builders are pure functions of that
snapshot.

### The `SlideSource` interface

`src/renderer/src/sources/types.ts` is the seam. `App.tsx` keeps owning the reactive state
(`currentPage`, `totalPages`, `notesBySlide`); a `SlideSource` is just the strategy for rendering
a page and, where the underlying app has independent state of its own, keeping it in sync.

**The optional methods are a contract about capability.** A source that can't do something
should **omit the method entirely**, not implement it as a stub returning empty — that is what
lets the dispatcher tell "no sections exist" from "this source doesn't do sections".

> The PowerPoint source currently **breaks that rule**: it defines `getSections`,
> `mediaPlay/Pause/Stop` and `getMediaDuration` on both platforms, and the macOS bridge no-ops
> them (`sections: []`, `async mediaToggle(): Promise<void> {}`, duration `null`). So on macOS
> those addresses are accepted and silently do nothing rather than being unsupported. If you
> split the source per platform, that's the inconsistency to fix.

### Adding a source

1. Implement `SlideSource` in `src/renderer/src/sources/`.
2. Implement only the optional methods that genuinely work — **omit the rest**.
3. If it needs OS-level automation, put that in `src/main/services/` behind a handle interface
   and keep the renderer side platform-agnostic (see `powerpointSource.ts` + the two bridges).
4. Add its `kind` to the union in `types.ts` and to `ClientApp` in `src/shared/protocol.ts` —
   **and to the server repo's copy.**
5. If it opens local files, add the extension to `SUPPORTED_EXTENSIONS` in `fileControl.ts`.
6. Update the capability matrix in [API.md §5](API.md#5-source-capability-matrix) and
   [USER-GUIDE.md §0](USER-GUIDE.md).

---

## 4. Traps

Each of these was found the hard way and is load-bearing.

- **`osc-min` is ESM-only and the main bundle is CJS.** A static import fails at runtime with
  `ERR_PACKAGE_PATH_NOT_EXPORTED` — confirmed live. It is loaded through a memoised dynamic
  `import()`, which is the standard interop path. Don't "clean that up" into a static import.
- **A detached `<video>` element stops receiving frames.** The element receiving a
  `getDisplayMedia` stream **must be attached to the DOM**, or Chromium's visibility-based
  resource management stops feeding it after a few seconds. Confirmed live.
- **`backgroundThrottling: false` is required** on the capture window. Chromium throttles
  `setInterval` hard enough to stall the capture loop within seconds once backgrounded — and this
  app *is* backgrounded during real use, because Keynote/PowerPoint is what's frontmost while
  presenting.
- **Fullscreen presentation windows aren't enumerable** via `desktopCapturer`'s window-level
  sources on macOS — they sit above the window level that query reads. Hence capture is
  per-display with an optional crop, matching the Program Out display picker.
- **PowerPoint for Mac's bulk image export is a silent no-op.** `save … as PNG/PDF` is declared
  in the AppleScript dictionary and does nothing in the tested version, so frames go one at a
  time via `copy object` and the system clipboard. Windows' `Slide.Export` genuinely works, so
  that path is a plain bulk loop. Don't unify them.
- **PowerPoint has no direct media play/pause over COM.** Both public VSTO reference add-ins were
  read to confirm it: neither ever calls a `Play()`/`Pause()` on a media shape — they only detect
  and count them. Hence the Alt+P `SendKeys` toggle, which is why all four media addresses map to
  one toggle.
- **The MV3 service worker calls `connect()` defensively on every incoming message**, rather than
  relying on its `setTimeout` reconnect loop. Chrome discards pending timers when it suspends an
  idle service worker, so a reconnect scheduled just before suspension would never fire.
- **The Master Server link has no reconnect at all.** `connect()` opens one socket and a close
  leaves it disconnected. If you add reconnection, note that the server keys clients by *name*,
  so a reconnect reuses the same client id by design.
- **Sections are captured once at open**, not polled — a deliberate gap, documented in
  `powerpointSource.ts`.
- **`clampPage` rounds and clamps rather than rejecting.** Out-of-range `goto/slide` is not an
  error anywhere in this app.

---

## 5. The notes sidecar

`src/main/index.ts` reads **two shapes** and writes one — see
[API.md §4](API.md#4-notes-sidecar-format). The important invariant:

> **Saving must preserve a generated sidecar's envelope.** Writing the bare note map over a
> `presentation-converter` sidecar would discard the source deck, engine record and hidden-slide
> page mapping. `notes:save` merges instead, and also updates `slides[].notes` for entries with a
> non-null `page`.

If you change the sidecar shape, `presentation-converter` writes it — change both.

---

## 6. Provenance

The OSC design, the PowerPoint media research and the wallpaper feature were shaped by reading
existing tools. The README's "Inspiration & prior art" section is specific about what was and
wasn't reused, and that specificity is deliberate — **keep it accurate if you extend any of those
areas.** In short: nothing was copied from OSCPoint (closed source; its public docs informed the
address space and the two-port architecture, which has since been renamed away from it), and no
VSTO code was ported from the two open-source add-ins — only the factual understanding of what
PowerPoint's COM model does and doesn't expose.

---

## See also

- [API.md](API.md) — the OSC address space, protocols and sidecar format
- [USER-GUIDE.md](USER-GUIDE.md) — the operator view
- [README](../README.md) — features, architecture, prior art, signing
- [`extension/OAUTH_SETUP.md`](../extension/OAUTH_SETUP.md) — Google Slides OAuth walkthrough
