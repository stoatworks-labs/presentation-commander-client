import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

const PLACEHOLDER_CLIENT_ID = 'REPLACE_WITH_GOOGLE_CLOUD_OAUTH_CLIENT_ID.apps.googleusercontent.com'
const CLIENT_ID_PATTERN = /^[\w-]+\.apps\.googleusercontent\.com$/

export interface OAuthStatus {
  configured: boolean
  clientId: string | null
  extensionId: string
}

/** The extension's key-derived id is fixed (see extension/OAUTH_SETUP.md) — shown in
 *  the setup UI since it's needed to register the OAuth client in Google Cloud Console. */
const FIXED_EXTENSION_ID = 'kibkdbmpbeoapaagoiffjlmgnhambklk'

/** extension/ ships alongside the app but needs write access at runtime, so it's
 *  excluded from the asar archive (see electron-builder.yml's asarUnpack) and lives
 *  as a real directory next to app.asar in a packaged build. */
function getManifestPath(): string {
  const base = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked') : app.getAppPath()
  return join(base, 'extension', 'manifest.json')
}

async function readManifest(): Promise<Record<string, unknown>> {
  const raw = await readFile(getManifestPath(), 'utf-8')
  return JSON.parse(raw)
}

export async function getOAuthStatus(): Promise<OAuthStatus> {
  const manifest = await readManifest()
  const oauth2 = manifest.oauth2 as { client_id?: string } | undefined
  const clientId = oauth2?.client_id ?? null
  return {
    configured: !!clientId && clientId !== PLACEHOLDER_CLIENT_ID,
    clientId: clientId === PLACEHOLDER_CLIENT_ID ? null : clientId,
    extensionId: FIXED_EXTENSION_ID
  }
}

export async function setOAuthClientId(clientId: string): Promise<void> {
  const trimmed = clientId.trim()
  if (!CLIENT_ID_PATTERN.test(trimmed)) {
    throw new Error(
      "That doesn't look like a Google OAuth client ID — it should end in .apps.googleusercontent.com"
    )
  }
  const path = getManifestPath()
  const manifest = await readManifest()
  manifest.oauth2 = { ...(manifest.oauth2 as object), client_id: trimmed }
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
}
