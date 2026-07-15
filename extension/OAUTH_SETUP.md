# Google Slides OAuth setup

The extension fetches speaker notes via the official Slides API
(`presentations.pages.get`), not by scraping the presenter-notes popup.
That needs a real OAuth client registered in Google Cloud Console — this
is a one-time setup only you can do (it needs your own Google account).

The extension's `manifest.json` already has a **fixed extension ID**
baked in via its `key` field, so it won't change no matter where you load
it from or which machine you're on:

```
kibkdbmpbeoapaagoiffjlmgnhambklk
```

Keep that — it's what you'll register the OAuth client against below.

## Steps

1. **Open Google Cloud Console** — https://console.cloud.google.com/
2. **Create a project** (top-left project picker → New Project). Name it
   whatever you like, e.g. "Presentation Commander".
3. **Enable the Slides API** — left sidebar → *APIs & Services* →
   *Library* → search "Google Slides API" → **Enable**.
4. **Configure the OAuth consent screen** — *APIs & Services* →
   *OAuth consent screen*:
   - User type: **External** (unless this is a Google Workspace account,
     in which case **Internal** is simpler and skips the next point)
   - App name: "Presentation Commander" (or anything)
   - User support email / developer contact: your email
   - Scopes: add `https://www.googleapis.com/auth/presentations.readonly`
   - Test users: add your own Google account email. While the app stays
     in "Testing" status (the default, no Google review needed), only
     accounts listed here can authorize it.
5. **Create the OAuth client** — *APIs & Services* → *Credentials* →
   **Create Credentials** → **OAuth client ID**:
   - Application type: **Chrome Extension**
   - Application ID: `kibkdbmpbeoapaagoiffjlmgnhambklk` (the fixed ID
     from above)
   - Create it, then copy the generated client ID
     (`something.apps.googleusercontent.com`)
6. **Paste it into the manifest** — open `extension/manifest.json` and
   replace the placeholder:
   ```json
   "oauth2": {
     "client_id": "PASTE_YOUR_CLIENT_ID_HERE.apps.googleusercontent.com",
     "scopes": ["https://www.googleapis.com/auth/presentations.readonly"]
   }
   ```
7. **Reload the extension** — `chrome://extensions` → the refresh icon on
   the Presentation Commander card (needed for both the manifest change
   here and the `key` field, if you haven't reloaded since either landed).
8. **First use**: the first time the extension tries to fetch notes,
   Chrome will show a normal Google sign-in/consent popup. Since the app
   isn't Google-verified (it's just for your own use), you may see an
   "unverified app" warning — click **Advanced** → **Go to Presentation
   Commander (unsafe)** to proceed. This is expected and safe for an app
   you created yourself; it's the same warning any unverified/personal
   OAuth app shows during development.

Once approved, `chrome.identity.getAuthToken` caches the token and
refreshes it silently — you shouldn't see the consent screen again unless
you revoke access (Google Account → Security → Third-party access) or the
scope changes.
