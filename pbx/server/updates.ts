/**
 * Online-Updates: neue Versionen kommen als GitHub-Release (Tag „pbx-v…“) und als
 * Container-Image auf ghcr.io. Zum Aktualisieren startet die Anlage über den
 * Docker-Socket einen kurzlebigen Hilfscontainer, der „docker compose pull/up“
 * ausführt – der eigene Container kann sich nicht selbst ersetzen.
 */

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import { SETTINGS } from './paths'

const SOCKET = '/var/run/docker.sock'
/** Hilfscontainer mit fester Version und Prüfsumme (docker:29.9.2-cli), damit kein fremdes Image den Socket bekommt */
const HELPER_IMAGE = 'docker@sha256:5e6baf67325a79f64ed3bed6863954d5e05d0f3d4e57cbdb14809346814bbfdb'

export interface ReleaseInfo {
  version: string
  tag: string
  date: string
  notes: string
  url: string
  prerelease: boolean
}

export interface UpdateInfo {
  current: string
  latest: ReleaseInfo | null
  available: boolean
  canApply: boolean
  reason: string
  /** Compose-Projekt, über das aktualisiert wird (TrueNAS: „ix-<App-Name>“) */
  project: string
  checked: number
  error: string
  /** Ergebnis des letzten Updates über den Hilfscontainer (null = keins bekannt) */
  last: { ok: boolean; time: number; text: string } | null
  /** Hinweis zur Installation (z. B. TrueNAS: Kanal nur über das Image-Tag der App) */
  note: string
}

/** Ein Update gilt nach so langer Zeit ohne Neustart als gescheitert */
const APPLY_TIMEOUT = 15 * 60000
const HELPER_LABEL = 'phone4all.updater'

/**
 * Docker-Logs ohne Terminal sind gemultiplext: je Block 8 Byte Kopf (Strom, Länge).
 * Gibt den reinen Text zurück.
 */
export function demuxLogs(buf: Buffer): string {
  const parts: Buffer[] = []
  let i = 0
  while (i + 8 <= buf.length && buf[i] <= 2 && buf[i + 1] === 0 && buf[i + 2] === 0 && buf[i + 3] === 0) {
    const len = buf.readUInt32BE(i + 4)
    parts.push(buf.subarray(i + 8, i + 8 + len))
    i += 8 + len
  }
  return (i === 0 ? buf : Buffer.concat(parts)).toString('utf8')
}

/** „pbx-v1.2.3“ / „1.2.3-beta.1“ vergleichen; dev ist immer älter. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): [number[], string] => {
    const [main, pre = ''] = v.replace(/^pbx-v|^v/, '').split('-', 2)
    return [main.split('.').map((n) => Number(n) || 0), pre]
  }
  const [am, ap] = parse(a)
  const [bm, bp] = parse(b)
  for (let i = 0; i < 3; i++) {
    if ((am[i] ?? 0) !== (bm[i] ?? 0)) return (am[i] ?? 0) - (bm[i] ?? 0)
  }
  if (ap === bp) return 0
  if (!ap) return 1
  if (!bp) return -1
  return ap.localeCompare(bp, 'en', { numeric: true })
}

function docker<T>(method: string, path: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: SOCKET, method, path, headers: body ? { 'Content-Type': 'application/json' } : {} },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          if ((res.statusCode ?? 500) >= 400) reject(new Error(`Docker: ${res.statusCode} ${data.slice(0, 300)}`))
          else {
            try {
              resolve((data ? JSON.parse(data.trim().split('\n').pop()!) : {}) as T)
            } catch {
              resolve({} as T)
            }
          }
        })
      },
    )
    req.on('error', reject)
    req.end(body ? JSON.stringify(body) : undefined)
  })
}

function dockerRaw(path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: SOCKET, method: 'GET', path }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => ((res.statusCode ?? 500) >= 400 ? reject(new Error(`Docker: ${res.statusCode}`)) : resolve(Buffer.concat(chunks))))
    })
    req.on('error', reject)
    req.end()
  })
}

type ContainerInfo = { Config?: { Labels?: Record<string, string> } }

/** Container-ID aus den Einhängepunkten (/etc/hostname usw. liegen unter …/containers/<id>/). */
export function containerIdFromMountinfo(text: string): string {
  return /\/containers\/([0-9a-f]{64})\//.exec(text)?.[1] ?? ''
}

/**
 * Den eigenen Container finden. Der Hostname taugt nur ohne „network_mode: host“ –
 * mit Host-Netz (TrueNAS, unsere Compose) heißt er wie der Rechner.
 */
async function findSelf(): Promise<ContainerInfo> {
  const candidates: string[] = []
  for (const file of ['/proc/self/mountinfo', '/proc/self/cgroup']) {
    try {
      const id = containerIdFromMountinfo(fs.readFileSync(file, 'utf8')) || /[0-9a-f]{64}/.exec(fs.readFileSync(file, 'utf8'))?.[0]
      if (id) candidates.push(id)
    } catch {
      // nicht lesbar
    }
  }
  candidates.push(os.hostname(), 'phone4all-pbx')
  for (const c of candidates) {
    try {
      return await docker<ContainerInfo>('GET', `/containers/${encodeURIComponent(c)}/json`)
    } catch {
      // nächster Versuch
    }
  }
  // Notfalls über das Image suchen
  const list = await docker<{ Id: string; Image: string }[]>('GET', '/containers/json')
  const mine = (Array.isArray(list) ? list : []).filter((c) => c.Image.includes('phone4all-pbx'))
  if (mine.length === 1) return docker<ContainerInfo>('GET', `/containers/${mine[0].Id}/json`)
  throw new Error('Den eigenen Container nicht gefunden – bitte „container_name: phone4all-pbx“ in der Compose setzen.')
}

interface ComposeInfo {
  project: string
  workdir: string
  files: string[]
}

async function composeInfo(): Promise<ComposeInfo> {
  if (!fs.existsSync(SOCKET)) {
    throw new Error(
      'Updates per Knopf sind aus (Docker-Socket nicht eingebunden). Mit „docker compose pull && docker compose up -d“ oder über „Update“ in TrueNAS aktualisieren.',
    )
  }
  const self = await findSelf()
  const labels = self.Config?.Labels ?? {}
  const project = labels['com.docker.compose.project']
  const workdir = labels['com.docker.compose.project.working_dir']
  if (!project || !workdir) throw new Error('Die Anlage wurde nicht mit docker compose gestartet.')
  // Die Werte landen in einem Shell-Befehl: nur übliche Namen und Pfade zulassen
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project) || !/^\/[\w./ -]*$/.test(workdir)) {
    throw new Error('Ungewöhnlicher Name oder Pfad des Compose-Projekts; bitte manuell aktualisieren.')
  }
  const files = (labels['com.docker.compose.project.config_files'] ?? '').split(',').filter((f) => /^\/[\w./ -]*$/.test(f))
  return { project, workdir, files }
}

export class Updater {
  info: UpdateInfo = {
    current: SETTINGS.version,
    latest: null,
    available: false,
    canApply: false,
    reason: '',
    project: '',
    checked: 0,
    error: '',
    last: null,
    note: '',
  }
  running = false
  private started = 0

  /**
   * Beendete Hilfscontainer auswerten (Exit-Code und Ausgabe) und entfernen. Läuft beim
   * Start der neuen Version – so erfährt die Oberfläche, ob das Update geklappt hat.
   */
  async collect(): Promise<void> {
    if (!fs.existsSync(SOCKET)) return
    const filters = encodeURIComponent(JSON.stringify({ label: [HELPER_LABEL] }))
    const list = await docker<{ Id: string; State: string; Created: number }[]>('GET', `/containers/json?all=1&filters=${filters}`).catch(() => [])
    for (const c of (Array.isArray(list) ? list : []).sort((a, b) => a.Created - b.Created)) {
      if (c.State === 'running' || c.State === 'created') continue
      try {
        const info = await docker<{ State?: { ExitCode?: number; FinishedAt?: string } }>('GET', `/containers/${c.Id}/json`)
        const log = demuxLogs(await dockerRaw(`/containers/${c.Id}/logs?stdout=1&stderr=1&tail=20`)).trim()
        const ok = info.State?.ExitCode === 0
        this.info.last = {
          ok,
          time: Date.parse(info.State?.FinishedAt ?? '') || c.Created * 1000,
          text: ok ? 'Update eingespielt.' : `Update fehlgeschlagen (Code ${info.State?.ExitCode ?? '?'}): ${log.split('\n').slice(-5).join(' · ') || 'keine Ausgabe'}`,
        }
        await docker('DELETE', `/containers/${c.Id}`)
      } catch {
        // nächster Versuch beim nächsten Start
      }
    }
  }

  async check(channel: 'stable' | 'beta'): Promise<UpdateInfo> {
    const info: UpdateInfo = { ...this.info, checked: Date.now(), error: '' }
    try {
      const r = await fetch(`https://api.github.com/repos/${SETTINGS.repo}/releases?per_page=50`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'phone4all-pbx' },
        signal: AbortSignal.timeout(15000),
      })
      if (!r.ok) throw new Error(`GitHub antwortet mit ${r.status}`)
      const releases = (await r.json()) as {
        tag_name: string
        name: string
        body: string
        html_url: string
        published_at: string
        prerelease: boolean
        draft: boolean
      }[]
      const candidates = releases
        .filter((x) => x.tag_name.startsWith('pbx-v') && !x.draft && (channel === 'beta' || !x.prerelease))
        .sort((a, b) => compareVersions(b.tag_name, a.tag_name))
      const latest = candidates[0]
      info.latest = latest
        ? {
            version: latest.tag_name.replace(/^pbx-v/, ''),
            tag: latest.tag_name,
            date: latest.published_at,
            notes: latest.body ?? '',
            url: latest.html_url,
            prerelease: latest.prerelease,
          }
        : null
      info.available = Boolean(info.latest && compareVersions(info.latest.version, info.current) > 0)
    } catch (e) {
      info.error = (e as Error).message
    }
    try {
      info.project = (await composeInfo()).project
      // Beim Start lief der Hilfscontainer evtl. noch: jetzt auswerten
      await this.collect().catch(() => undefined)
      info.last = this.info.last
      info.canApply = true
      info.reason = ''
      // TrueNAS-Apps (Projekt „ix-…“) lesen keine .env: Der Kanal folgt dem Image-Tag der App
      info.note = info.project.startsWith('ix-') ? 'TrueNAS: Der Kanal (Stabil/Beta) richtet sich nach dem Image-Tag in der App-Konfiguration, nicht nach dieser Einstellung.' : ''
    } catch (e) {
      info.canApply = false
      info.project = ''
      info.reason = (e as Error).message
    }
    this.info = info
    return info
  }

  /** Startet den Hilfscontainer; danach wird dieser Container ersetzt. */
  async apply(channel: 'stable' | 'beta'): Promise<void> {
    // Ohne Neustart nach 15 Minuten: Das Update ist gescheitert (siehe collect)
    if (this.running && Date.now() - this.started < APPLY_TIMEOUT) throw new Error('Das Update läuft bereits.')
    if (this.running) await this.collect()
    const compose = await composeInfo()
    this.running = true
    this.started = Date.now()
    try {
      const [repo, digest] = HELPER_IMAGE.split('@')
      await docker('POST', `/images/create?fromImage=${encodeURIComponent(repo)}&tag=${encodeURIComponent(digest)}`)
      const fileArgs = compose.files.map((f) => `-f '${f.replace(/'/g, '')}'`).join(' ')
      const pbxTag = channel === 'beta' ? 'beta' : 'latest'
      const script = [
        'sleep 2',
        `cd '${compose.workdir.replace(/'/g, '')}'`,
        // Kanal dauerhaft in .env merken, damit ein späteres „docker compose up“ dabei bleibt
        `touch .env && (grep -q '^PBX_TAG=' .env && sed -i 's/^PBX_TAG=.*/PBX_TAG=${pbxTag}/' .env || echo 'PBX_TAG=${pbxTag}' >> .env)`,
        `docker compose -p '${compose.project}' ${fileArgs} pull`,
        `docker compose -p '${compose.project}' ${fileArgs} up -d --remove-orphans`,
      ].join(' && ')
      const created = await docker<{ Id: string }>('POST', '/containers/create?name=phone4all-updater-' + Date.now(), {
        Image: HELPER_IMAGE,
        Cmd: ['sh', '-c', script],
        WorkingDir: compose.workdir,
        Env: [`PBX_TAG=${pbxTag}`],
        // Nicht selbst löschen: Die neue Version liest Exit-Code und Ausgabe (collect)
        Labels: { [HELPER_LABEL]: '1' },
        HostConfig: {
          Binds: [`${SOCKET}:${SOCKET}`, `${compose.workdir}:${compose.workdir}`],
        },
      })
      await docker('POST', `/containers/${created.Id}/start`)
    } catch (e) {
      this.running = false
      throw e
    }
  }
}
