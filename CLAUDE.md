# presentation-commander-client

Electron client app for the Presentation Commander system (pairs with presentation-commander-server). TypeScript, electron-vite. Uses native SDK links (see `clean:native-sdk-links`).

## Commands (npm)
- Dev: `npm run dev` (electron-vite dev)
- Typecheck: `npm run typecheck` (node + web)
- Lint / format: `npm run lint` · `npm run format`
- Build: `npm run build`
- Package: `npm run build:mac` · `:win` · `:linux` (each runs `clean:native-sdk-links` first, `--publish never`)

## Notes
- Packaging depends on `scripts/clean-native-sdk-links.js` — don't skip it (native SDK symlinks).
- Pairs with `presentation-commander-server`; keep their shared protocol in sync.
- Two checkouts exist. **`~/presentation-commander-client` is the canonical one**; the copy in `~/Projects` is stale (17 commits behind as of 2026-07-29). Confirm which tree you're editing before committing.
- "Commit" = commit **and** push.
