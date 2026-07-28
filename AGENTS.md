# AGENTS.md — bringing an LLM up to speed on Presentation Commander (Client)

Orientation for an AI assistant (or a new human) picking this project up cold. `CLAUDE.md`
holds the short command reference; this file explains the model and the traps.

---

## 1. Check which working tree you are in — first, every time

**A second working copy of this repo exists at `~/presentation-commander-client`, outside
`~/Projects`.**

Before editing anything, confirm which tree you're in. Edits made in the wrong copy look like
they worked, commit cleanly, and then don't appear in the build anyone runs. This has already
been flagged as a real hazard in `CLAUDE.md`.

```bash
pwd && git -C . remote -v && git -C . log -1 --oneline
```

## 2. What this is

The **presentation laptop companion app** for `presentation-commander-server` — a **bespoke
PDF presentation engine**, built as an Electron + React + TypeScript app.

It runs on the machine actually driving the screen in front of an audience.

## 3. The three repos, and the shared protocol

| Repo | Role |
|---|---|
| **presentation-commander-client** (this) | Presentation laptop; PDF presentation engine |
| **presentation-commander-server** | Master control: NDI matrix routing, scenes, notes |
| **companion-module-presentationcommander-server** | Companion/Stream Deck module for the server |

**The protocol must stay in sync.** A mismatch here means the presentation laptop stops
responding to the control room, live.

## 4. Build traps

**Packaging depends on `scripts/clean-native-sdk-links.js` — don't skip it.** Each
`build:mac` / `:win` / `:linux` runs it first because of native SDK symlinks. All packaging
runs `--publish never`.

```bash
npm run dev          # electron-vite dev
npm run typecheck    # node + web - covers both tsconfigs
npm run lint         # / npm run format
npm run build
npm run build:mac    # / :win / :linux
```

## 5. Why "bespoke PDF engine" matters

Presenting from PDF is the job, and the engine is custom rather than an embedded viewer. That
means rendering, page transitions and timing are all this codebase's responsibility.

Consequences worth keeping in mind: a slow or blocking render is visible to an audience; page
navigation must stay responsive under remote control from the server; and failure should hold
the current slide rather than showing an error surface to a room.

## 6. Conventions

- "Commit" means commit **and** push. (Confirm the tree first — see §1.)
