import { PowerPointBridgeMac } from './powerpointBridgeMac'
import { PowerPointBridgeWindows } from './powerpointBridgeWin'

/** Same public shape (open/goTo/close/on('current-slide-changed')) either way —
 *  see powerpointBridgeMac.ts and powerpointBridgeWin.ts for what differs
 *  underneath (AppleScript vs. PowerShell COM automation). */
export const powerpointBridge =
  process.platform === 'darwin' ? new PowerPointBridgeMac() : new PowerPointBridgeWindows()
