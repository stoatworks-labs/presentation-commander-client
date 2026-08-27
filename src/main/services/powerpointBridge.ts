import { PowerPointBridgeMac } from './powerpointBridgeMac'
import { PowerPointBridgeWindows } from './powerpointBridgeWin'
import { PowerPointBridgeUnsupported } from './powerpointBridgeUnsupported'

/** All three share the public shape (open/goTo/close/on('current-slide-changed'))
 *  — see powerpointBridgeMac.ts and powerpointBridgeWin.ts for what differs
 *  underneath (AppleScript vs. PowerShell COM automation), and
 *  powerpointBridgeUnsupported.ts for the platforms that have neither. */
function selectBridge():
  PowerPointBridgeMac | PowerPointBridgeWindows | PowerPointBridgeUnsupported {
  if (process.platform === 'darwin') return new PowerPointBridgeMac()
  if (process.platform === 'win32') return new PowerPointBridgeWindows()
  // Linux is packaged and shipped, and has neither AppleScript nor COM.
  return new PowerPointBridgeUnsupported()
}

export const powerpointBridge = selectBridge()
