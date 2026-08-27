import type { ClientPlatform } from './protocol'

/**
 * The one place `process.platform` is mapped to what this app calls a
 * platform. It used to be spelled out as a two-way `darwin ? 'macos' :
 * 'windows'` test in main, which is how every Linux client came to register
 * itself as Windows. Main and preload both go through here now.
 *
 * Kept out of protocol.ts on purpose: that file is a hand-mirrored copy of the
 * server's and must stay a pure type declaration.
 */
export function toClientPlatform(nodePlatform: NodeJS.Platform): ClientPlatform {
  if (nodePlatform === 'darwin') return 'macos'
  if (nodePlatform === 'win32') return 'windows'
  return 'linux'
}

/** Keynote is macOS-only, and is driven through AppleScript/JXA. */
export function supportsKeynote(platform: ClientPlatform): boolean {
  return platform === 'macos'
}

/**
 * PowerPoint is driven through AppleScript on macOS and PowerShell COM on
 * Windows. Linux has neither, and no PowerPoint to drive either way.
 */
export function supportsPowerPoint(platform: ClientPlatform): boolean {
  return platform === 'macos' || platform === 'windows'
}
