# Presentation Commander — Client

> **AI-assisted project.** This codebase was built with the help of
> [Claude](https://claude.ai), Anthropic's AI assistant — including
> architecture, implementation, and documentation. Review it accordingly
> before relying on it in production.

The presentation laptop companion app for
[presentation-commander-server](https://github.com/allansargeant/presentation-commander-server).
A bespoke PDF presentation engine built as an Electron + React + TypeScript
desktop app — no PowerPoint or Keynote dependency.

![Presentation Commander Client main window: connection panel, Program Out display picker, and Open PDF control](docs/screenshot.png)

## What it does

- **Bespoke PDF engine** — open a PDF, get Now/Next slide previews rendered
  locally with pdf.js
- **Presenter notes** — per-slide notes, auto-saved to a `.notes.json`
  sidecar file next to the PDF
- **Transport** — Previous/Next buttons and arrow-key navigation
- **Program Out** — a second, fullscreen, chrome-free window showing just
  the current slide, for a projector or confidence monitor. Pick which
  connected display it opens on from a dropdown next to the button
- **NDI Output** — broadcasts the current slide as a real NDI video source
  on the network, discoverable by any NDI-compatible receiver, built
  directly against the official
  [Vizrt NDI SDK](https://ndi.video/for-developers/ndi-sdk/) via a small
  native N-API addon (`native/ndi-send`) — no third-party NDI wrapper.
  Independent of whether the Program Out window is open, since NDI is a
  network output rather than a local display
- **Server link** — connects to the Master Server's client hub over
  WebSocket (`ws://<host>:9800`), registers itself by name, pushes live
  slide/notes state, and accepts remote next/previous-slide commands
  triggered from the server's Control Surface

### Building from source

The native send addon links against the NDI SDK at build time. Install
the [NDI SDK](https://ndi.video/for-developers/ndi-sdk/) first (macOS
default: `/Library/NDI SDK for Apple`; override the location with
`NDI_SDK_DIR` if yours lives elsewhere). `npm install` rebuilds the addon
automatically via `@electron/rebuild`.

### Google Slides bridge (optional)

`extension/` is an unpacked Chrome extension that lets the Client connect
to a live Google Slides Presenter View instead of a local PDF/Keynote
file — load it via `chrome://extensions` → Developer mode → Load
unpacked. Fetching speaker notes needs a one-time OAuth client
registration in Google Cloud Console; see
[`extension/OAUTH_SETUP.md`](extension/OAUTH_SETUP.md).

## Project Setup

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
