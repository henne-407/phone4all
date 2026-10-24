/**
 * Aktualisierung der App über GitHub-Releases (Tag „v…“). Je nach Installation wird die
 * passende Datei geladen und eingespielt: AppImage ersetzen, entpackten Ordner
 * austauschen (install-linux.sh), rpm/deb per pkexec, macOS-Bundle tauschen oder den
 * Windows-Installer still ausführen. Danach startet die App neu.
 */

import { app as electronApp, net } from 'electron'
import { execFile, execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { UpdateState } from '../shared/types'
import { type InstallKind, type ReleaseAsset, compareVersions, pickAsset } from '../shared/updates'

const run = promisify(execFile)
const REPO = 'henne-407/phone4all'
const CHECK_EVERY = 6 * 3600 * 1000

export interface UpdaterHost {
  changed: () => void
  /** Laufen gerade Gespräche? Dann wird nicht neu gestartet. */
  busy: () => boolean
  /** Hauptfenster sichtbar? Sonst startet die App unsichtbar neu. */
  visible: () => boolean
  quit: () => void
}

function ownedBy(cmd: string, args: string[]): boolean {
  try {
    execFileSync(cmd, args, { stdio: 'ignore', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

function writable(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** „/Applications/SIP-Telefon.app“ aus dem Pfad der laufenden App */
function macBundle(): string | null {
  const i = process.execPath.indexOf('.app/')
  return i < 0 ? null : process.execPath.slice(0, i + 4)
}

export function installKind(): InstallKind {
  if (!electronApp.isPackaged) return 'manual'
  if (process.platform === 'win32') return 'win'
  if (process.platform === 'darwin') {
    const bundle = macBundle()
    return bundle && writable(path.dirname(bundle)) ? 'mac' : 'manual'
  }
  if (process.env.APPIMAGE) return 'appimage'
  if (ownedBy('rpm', ['-qf', process.execPath])) return 'rpm'
  if (ownedBy('dpkg', ['-S', process.execPath])) return 'deb'
  const dir = path.dirname(process.execPath)
  return writable(dir) && writable(path.dirname(dir)) ? 'dir' : 'manual'
}

/** Reste eines früheren Updates entfernen (alter Ordner bzw. altes Bundle). */
function cleanup(): void {
  const targets: string[] = []
  const bundle = macBundle()
  if (process.platform === 'darwin' && bundle) targets.push(bundle + '.old', path.join(path.dirname(bundle), '.sip-telefon-update'))
  if (process.platform === 'linux') {
    const dir = path.dirname(process.execPath)
    targets.push(dir + '.old', dir + '.update')
    if (process.env.APPIMAGE) targets.push(process.env.APPIMAGE + '.update')
  }
  for (const t of targets) fs.rmSync(t, { recursive: true, force: true })
}

/** Ordner im Archiv, in dem die Programmdatei liegt (mit oder ohne Oberordner). */
function appRoot(dir: string, exe: string): string {
  if (fs.existsSync(path.join(dir, exe))) return dir
  for (const d of fs.readdirSync(dir)) {
    if (fs.existsSync(path.join(dir, d, exe))) return path.join(dir, d)
  }
  throw new Error('Das Update-Archiv enthält die App nicht.')
}

export class Updater {
  readonly kind = installKind()
  state: UpdateState = {
    status: 'idle',
    current: electronApp.getVersion(),
    latest: null,
    canInstall: false,
    progress: 0,
    error: '',
    checked: 0,
  }
  private asset: ReleaseAsset | null = null
  private file = ''
  private timer: NodeJS.Timeout | null = null
  private waiting: NodeJS.Timeout | null = null

  constructor(
    private host: UpdaterHost,
    private auto: () => boolean,
  ) {}

  start(): void {
    try {
      cleanup()
    } catch {
      // Reste stören nicht
    }
    setTimeout(() => void this.tick(), 60000).unref()
    this.timer = setInterval(() => void this.tick(), CHECK_EVERY)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.waiting) clearInterval(this.waiting)
  }

  private set(values: Partial<UpdateState>): void {
    this.state = { ...this.state, ...values }
    this.host.changed()
  }

  private async tick(): Promise<void> {
    await this.check()
    if (this.auto() && this.state.status === 'available' && this.state.canInstall) await this.install(false)
  }

  async check(): Promise<UpdateState> {
    if (['downloading', 'ready', 'installing'].includes(this.state.status)) return this.state
    this.set({ status: 'checking', error: '' })
    try {
      const r = await net.fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'sip-telefon' },
      })
      if (!r.ok) throw new Error(`GitHub antwortet mit ${r.status}`)
      const releases = (await r.json()) as {
        tag_name: string
        body: string
        html_url: string
        draft: boolean
        prerelease: boolean
        assets: ReleaseAsset[]
      }[]
      const latest = releases
        .filter((x) => /^v\d/.test(x.tag_name) && !x.draft && !x.prerelease)
        .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0]
      const newer = Boolean(latest && compareVersions(latest.tag_name, this.state.current) > 0)
      this.asset = latest ? pickAsset(latest.assets, this.kind, process.arch) : null
      this.set({
        status: newer ? 'available' : 'none',
        latest: latest ? { version: latest.tag_name.replace(/^v/, ''), notes: latest.body ?? '', url: latest.html_url } : null,
        canInstall: Boolean(this.asset),
        checked: Date.now(),
      })
    } catch (e) {
      this.set({ status: 'error', error: (e as Error).message, checked: Date.now() })
    }
    return this.state
  }

  /** Laden und einspielen; bei laufendem Gespräch erst danach. `now`: vom Knopf ausgelöst. */
  async install(now: boolean): Promise<void> {
    if (this.state.status === 'available') {
      if (!this.asset) throw new Error('Für diese Installation gibt es kein automatisches Update.')
      await this.download(this.asset)
    }
    if (this.state.status !== 'ready') return
    if (this.waiting) clearInterval(this.waiting)
    // Nie während eines Gesprächs; automatisch nur, wenn das Fenster nicht offen ist
    const apply = (): boolean => {
      if (this.host.busy() || (!now && this.host.visible())) return false
      if (this.waiting) clearInterval(this.waiting)
      this.waiting = null
      void this.apply().catch((e: Error) => this.set({ status: 'error', error: e.message }))
      return true
    }
    if (!apply()) this.waiting = setInterval(apply, 30000)
  }

  private async download(asset: ReleaseAsset): Promise<void> {
    this.set({ status: 'downloading', progress: 0, error: '' })
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sip-telefon-update-'))
      const file = path.join(dir, asset.name)
      const r = await net.fetch(asset.browser_download_url)
      if (!r.ok || !r.body) throw new Error(`Download fehlgeschlagen (${r.status})`)
      const out = fs.createWriteStream(file)
      const reader = r.body.getReader()
      let done = 0
      let shown = 0
      for (;;) {
        const { value, done: end } = await reader.read()
        if (end) break
        if (!out.write(value)) await new Promise((res) => out.once('drain', res))
        done += value.length
        const progress = asset.size ? done / asset.size : 0
        if (progress - shown >= 0.02) {
          shown = progress
          this.set({ progress })
        }
      }
      await new Promise<void>((res, rej) => out.end((e?: Error) => (e ? rej(e) : res())))
      if (asset.size && fs.statSync(file).size !== asset.size) throw new Error('Download unvollständig')
      this.file = file
      this.set({ status: 'ready', progress: 1 })
    } catch (e) {
      this.set({ status: 'error', error: (e as Error).message })
      throw e
    }
  }

  private async apply(): Promise<void> {
    this.set({ status: 'installing' })
    const args = this.host.visible() ? [] : ['--background']
    const file = this.file
    switch (this.kind) {
      case 'appimage': {
        const target = process.env.APPIMAGE!
        fs.copyFileSync(file, target + '.update')
        fs.chmodSync(target + '.update', 0o755)
        fs.renameSync(target + '.update', target)
        electronApp.relaunch({ execPath: target, args })
        break
      }
      case 'dir': {
        const dir = path.dirname(process.execPath)
        const staging = dir + '.update'
        fs.rmSync(staging, { recursive: true, force: true })
        fs.mkdirSync(staging)
        await run('tar', ['-xzf', file, '-C', staging])
        const root = appRoot(staging, path.basename(process.execPath))
        fs.rmSync(dir + '.old', { recursive: true, force: true })
        fs.renameSync(dir, dir + '.old')
        fs.renameSync(root, dir)
        electronApp.relaunch({ execPath: process.execPath, args })
        break
      }
      case 'rpm':
      case 'deb': {
        // pkexec fragt grafisch nach dem Passwort
        const cmd = this.kind === 'rpm' ? ['dnf', 'install', '-y', file] : ['apt-get', 'install', '-y', file]
        await run('pkexec', cmd, { timeout: 15 * 60000 })
        electronApp.relaunch({ args })
        break
      }
      case 'mac': {
        const bundle = macBundle()!
        const staging = path.join(path.dirname(bundle), '.sip-telefon-update')
        fs.rmSync(staging, { recursive: true, force: true })
        await run('ditto', ['-x', '-k', file, staging])
        const app = fs.readdirSync(staging).find((d) => d.endsWith('.app'))
        if (!app) throw new Error('Das Update-Archiv enthält die App nicht.')
        fs.rmSync(bundle + '.old', { recursive: true, force: true })
        fs.renameSync(bundle, bundle + '.old')
        fs.renameSync(path.join(staging, app), bundle)
        electronApp.relaunch({ args })
        break
      }
      case 'win':
        // Stiller Installer ins bisherige Verzeichnis, startet die App danach selbst
        spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
        break
      default:
        throw new Error('Für diese Installation gibt es kein automatisches Update.')
    }
    this.host.quit()
  }
}
