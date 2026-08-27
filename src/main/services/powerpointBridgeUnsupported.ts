import { EventEmitter } from 'events'
import type { PowerPointOpenResult } from './powerpointBridgeTypes'

/**
 * Stand-in for platforms with no PowerPoint to automate — in practice Linux,
 * which the app is packaged for. Previously the selector was a two-way
 * `darwin ? Mac : Windows` test, so a Linux build got the Windows bridge and
 * every call died on a `powershell.exe` ENOENT deep inside execFile, which
 * surfaces as an unrecognisable spawn error rather than "there is no
 * PowerPoint here". Same public shape as the two real bridges.
 */
export class PowerPointBridgeUnsupported extends EventEmitter {
  private unsupported(action: string): Error {
    return new Error(
      `PowerPoint automation is only available on Windows and macOS (tried to ${action}).`
    )
  }

  async open(filePath: string): Promise<PowerPointOpenResult> {
    throw this.unsupported(`open ${filePath}`)
  }

  async goTo(page: number): Promise<void> {
    throw this.unsupported(`go to slide ${page}`)
  }

  /** Teardown paths call this unconditionally, so it must not throw. */
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- nothing was ever opened
  async close(): Promise<void> {}

  /** Null is the "unknown duration" the callers already handle. */
  async getMediaDuration(): Promise<number | null> {
    return null
  }

  async mediaToggle(): Promise<void> {
    throw this.unsupported('toggle media playback')
  }
}
