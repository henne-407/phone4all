/**
 * GNOME Online-Konten / Evolution Data Server (nur Linux).
 *
 * Node hat keine GObject-Anbindung, deshalb läuft ein kleiner Python-Helfer
 * (resources/linux/eds_helper.py, nutzt das System-PyGObject) als Hintergrundprozess.
 */

import { type ChildProcessWithoutNullStreams, execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import readline from 'node:readline'
import { resourcePath } from './paths'

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

let available: boolean | null = null

/** Sind python3, PyGObject und die EDS-Bibliotheken vorhanden? */
export function edsAvailable(): boolean {
  if (available === null) {
    available = false
    if (process.platform === 'linux' && fs.existsSync(resourcePath('linux', 'eds_helper.py'))) {
      try {
        execFileSync(
          'python3',
          ['-c', "import gi; gi.require_version('ECal', '2.0'); gi.require_version('EDataServer', '1.2')"],
          { timeout: 5000, stdio: 'ignore' },
        )
        available = true
      } catch {
        available = false
      }
    }
  }
  return available
}

class EdsHelper {
  private proc: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<number, Pending>()
  private nextId = 0

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc
    const proc = spawn('python3', ['-I', resourcePath('linux', 'eds_helper.py')], { stdio: 'pipe' })
    proc.stderr.resume()
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      let msg: { id: number; result?: unknown; error?: string }
      try {
        msg = JSON.parse(line)
      } catch {
        return
      }
      const p = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      if (!p) return
      if (msg.error !== undefined) p.reject(new Error(msg.error))
      else p.resolve(msg.result)
    })
    proc.on('exit', () => {
      this.proc = null
      for (const p of this.pending.values()) p.reject(new Error('Evolution-Helfer beendet'))
      this.pending.clear()
    })
    this.proc = proc
    return proc
  }

  call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
    const proc = this.ensure()
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      proc.stdin.write(JSON.stringify({ id, cmd, ...args }) + '\n')
    })
  }

  stop(): void {
    this.proc?.kill()
  }
}

export const eds = new EdsHelper()
