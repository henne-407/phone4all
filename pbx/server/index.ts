/** Verwaltungsdienst der Telefonanlage: Weboberfläche, API, Anruflogik für Asterisk. */

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { Asterisk } from './asterisk'
import { CalendarStore } from './calendars'
import { Auth, SESSION_COOKIE, SESSION_MAX_AGE } from './auth'
import { readCalls, tailLog } from './cdr'
import { loadJson, saveJson } from './files'
import { HttpError, type Request, Router, makeRequest, sendFile, sendJson, sendText, serveStatic } from './http'
import { sendMail } from './mail'
import { BUNDESLAENDER, COLLECTIONS, type CollectionName, type Extension, SECTIONS, type SectionName } from './model'
import { PATHS, SETTINGS } from './paths'
import { PROVIDERS } from './providers'
import { appLink, baseUrl, landingPage, profile, startDiscovery, visibleCalendars } from './provisioning'
import {
  extensionPlan,
  feature,
  groupPlan,
  isAvailable,
  routeInbound,
  routeOutbound,
  timeConditionTarget,
} from './routing'
import { Guard } from './security'
import { listSounds, saveSound, soundDir, soundFile, type SoundKind } from './sounds'
import { ConfigStore, type ExportFile, ValidationError, fillSecrets, newPin, newSecret } from './store'
import { Updater } from './updates'
import { type WatchEvent, Watchdog } from './watchdog'

const store = new ConfigStore()
const auth = new Auth()
const asterisk = new Asterisk()
const guard = new Guard(() => store.config.security)
const updater = new Updater()
const calendars = new CalendarStore(() => store.config)
auth.init()

// -- Watchdog: Überwachung und Selbstheilung ------------------------------------------

const watchdog = new Watchdog(
  {
    state: () => asterisk.state,
    processRunning: () => asterisk.processRunning,
    amiConnected: () => asterisk.ami.connected,
    ping: () => asterisk.ping(),
    reconnectAmi: () => asterisk.reconnectAmi(),
    restart: (reason) => asterisk.kill(`Vom Watchdog neu gestartet: ${reason}`),
    trunks: () => store.config.trunks.filter((t) => t.enabled && t.register && !t.ip_auth && t.username.trim()),
    registrations: () => asterisk.registrations(),
    register: (id) => asterisk.register(id),
    reloadPjsip: () => asterisk.reloadPjsip(),
    freeBytes: () => {
      try {
        const st = fs.statfsSync(PATHS.data)
        return st.bavail * st.bsize
      } catch {
        return null
      }
    },
  },
  () => store.config.watchdog,
)
watchdog.events = loadJson<WatchEvent[]>(PATHS.watchdog, [])

let saveEventsTimer: NodeJS.Timeout | null = null
const mailed = new Map<string, number>() // Prüfung → Zeit der letzten Störungsmeldung
watchdog.on('event', (e: WatchEvent) => {
  saveEventsTimer ??= setTimeout(() => {
    saveEventsTimer = null
    saveJson(PATHS.watchdog, watchdog.events, 0o644)
  }, 2000)
  // Störungen per E-Mail: höchstens alle 30 Minuten je Prüfung, Entwarnung nach einer Meldung
  const to = store.config.watchdog.notify_email
  if (!to || (e.level !== 'error' && e.level !== 'ok')) return
  const last = mailed.get(e.check)
  if (e.level === 'ok' && last === undefined) return
  if (e.level === 'error' && last !== undefined && e.time - last < 30 * 60000) return
  if (e.level === 'ok') mailed.delete(e.check)
  else mailed.set(e.check, e.time)
  const subject = `${store.config.system.name}: ${e.level === 'ok' ? 'Störung behoben' : 'Störung'}`
  sendMail(store.config.mail, to, subject, `${new Date(e.time).toLocaleString('de-DE')}\n\n${e.text}\n\nDetails in der Weboberfläche unter System → Diagnose.`).catch(
    (err: Error) => console.error('Störungsmeldung per E-Mail:', err.message),
  )
})

// -- Konfiguration übernehmen (gebündelt, damit viele Änderungen nur ein Reload sind)

let applyTimer: NodeJS.Timeout | null = null
function applySoon(): void {
  if (applyTimer) clearTimeout(applyTimer)
  applyTimer = setTimeout(() => {
    applyTimer = null
    asterisk.apply(store.config, guard.banned()).catch((e) => console.error('Konfiguration:', e))
  }, 300)
}

guard.on('changed', applySoon)
asterisk.on('ami', (e) => guard.onAmiEvent(e))

// -- Interne Schnittstelle für den Wählplan (nur von localhost) ------------------

const internal = new Router()
internal.get('/internal/in', (r) =>
  routeInbound(store.config, {
    trunk: r.query.get('trunk') ?? '',
    did: r.query.get('did') ?? '',
    to: r.query.get('to') ?? '',
    cid: r.query.get('cid') ?? '',
    name: r.query.get('name') ?? '',
  }),
)
internal.get('/internal/out', (r) =>
  routeOutbound(store.config, {
    ext: r.query.get('ext') ?? '',
    fwd: r.query.get('fwd') ?? '',
    num: r.query.get('num') ?? '',
    cid: r.query.get('cid') ?? '',
  }),
)
internal.get('/internal/ext', (r) => extensionPlan(store.config, store.state, r.query.get('num') ?? ''))
internal.get('/internal/group', (r) =>
  groupPlan(store.config, store.state, r.query.get('id') ?? '', r.query.get('name') ?? '', PATHS.sounds),
)
internal.get('/internal/tc', (r) => timeConditionTarget(store.config, r.query.get('id') ?? ''))
internal.get('/internal/available', (r) => (isAvailable(store.state, r.query.get('num') ?? '') ? '1' : '0'))
internal.get('/internal/feature', (r) => {
  const result = feature(store.config, store.state, r.query.get('ext') ?? '', r.query.get('code') ?? '', r.query.get('arg') ?? '')
  if (result.stateChanged) store.saveState()
  if (result.configChanged) store.save()
  return result.reply
})

// -- Öffentlich: Anmeldung und Einrichtung der App ---------------------------------

const api = new Router()
const pub = new Router()

function requestBase(r: Request): string {
  const host = (r.raw.headers['x-forwarded-host'] as string | undefined) ?? r.raw.headers.host
  return baseUrl(host, store.config, (r.raw.headers['x-forwarded-proto'] as string | undefined) ?? 'http')
}

pub.get('/api/session', (r) => ({
  authenticated: auth.valid(r.cookies[SESSION_COOKIE]),
  name: store.config.system.name,
  version: SETTINGS.version,
}))

pub.post('/api/login', async (r) => {
  if (auth.blocked(r.ip)) throw new HttpError(429, 'Zu viele Fehlversuche. Bitte 15 Minuten warten.')
  const { password } = await r.json<{ password: string }>()
  if (!auth.check(String(password ?? ''))) {
    auth.failed(r.ip)
    throw new HttpError(401, 'Das Passwort ist falsch.')
  }
  const token = auth.login()
  r.res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}`)
  return { ok: true }
})

pub.post('/api/logout', (r) => {
  auth.logout(r.cookies[SESSION_COOKIE] ?? '')
  r.res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`)
  return { ok: true }
})

/** Zustand für Docker-Healthcheck, Home Assistant und Überwachung von außen (ohne Details) */
pub.get('/health', (r) => {
  const status = watchdog.status()
  const asteriskDown = status.checks.find((c) => c.id === 'asterisk')?.level === 'error'
  sendJson(r.res, asteriskDown ? 503 : 200, {
    status: watchdog.overall(),
    checks: Object.fromEntries(status.checks.map((c) => [c.id, c.level])),
    checked: status.checked,
    version: SETTINGS.version,
  })
})

/** Die App ruft ihr Profil mit dem geheimen Token ab (auch zum Auffrischen). */
pub.get('/provision/:token', (r) => {
  const ext = store.config.extensions.find((e) => e.provision_token && e.provision_token === r.params.token)
  if (!ext) throw new HttpError(404, 'Unbekannter Einrichtungslink.')
  return profile(store.config, ext, requestBase(r))
})

function tokenExtension(token: string): Extension {
  const ext = store.config.extensions.find((e) => e.provision_token && e.provision_token === token)
  if (!ext) throw new HttpError(404, 'Unbekannter Einrichtungslink.')
  return ext
}

function range(r: Request): [number, number] {
  const start = Date.parse(r.query.get('start') ?? '')
  const end = Date.parse(r.query.get('end') ?? '')
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start || end - start > 400 * 86400000) {
    throw new HttpError(400, 'Zeitraum fehlt oder ist zu groß (start/end als ISO-Datum, höchstens 400 Tage).')
  }
  return [start, end]
}

/** Die App fragt regelmäßig, ob sich Profil oder Termine geändert haben. */
pub.get('/provision/:token/revision', (r) => {
  const ext = tokenExtension(r.params.token)
  return { profile: profile(store.config, ext, requestBase(r)).revision, events: String(calendars.revision) }
})

/** Termine der zentralen Kalender, die diese Nebenstelle sieht */
pub.get('/provision/:token/events', (r) => {
  const ext = tokenExtension(r.params.token)
  const [start, end] = range(r)
  const only = r.query.get('calendar')
  return visibleCalendars(store.config, ext)
    .filter((c) => !only || c.id === only)
    .flatMap((c) => calendars.events(c.id, start, end).map((e) => ({ ...e, calendar: c.id })))
})

function writableFor(token: string, id: string): void {
  const cal = visibleCalendars(store.config, tokenExtension(token)).find((c) => c.id === id)
  if (!cal) throw new HttpError(404, 'Kalender nicht gefunden.')
  if (!cal.writable || cal.kind !== 'events') throw new HttpError(403, 'Dieser Kalender ist schreibgeschützt.')
}

pub.put('/provision/:token/events/:calendar/:uid', async (r) => {
  writableFor(r.params.token, r.params.calendar)
  return calendars.upsert(r.params.calendar, await r.json(), r.params.uid)
})

pub.delete('/provision/:token/events/:calendar/:uid', (r) => {
  writableFor(r.params.token, r.params.calendar)
  calendars.remove(r.params.calendar, r.params.uid)
  return { ok: true }
})

/** Einrichtung mit Nebenstelle und Einrichtungs-PIN */
pub.post('/provision', async (r) => {
  if (auth.blocked(r.ip)) throw new HttpError(429, 'Zu viele Fehlversuche. Bitte 15 Minuten warten.')
  const { extension, pin } = await r.json<{ extension: string; pin: string }>()
  const ext = store.config.extensions.find((e) => e.number === String(extension ?? '').trim())
  if (!ext || !pin || ext.provision_pin !== String(pin).trim()) {
    auth.failed(r.ip)
    throw new HttpError(403, 'Nebenstelle oder Einrichtungs-PIN stimmen nicht.')
  }
  return profile(store.config, ext, requestBase(r))
})

/** Seite für den Link aus der Einladungs-E-Mail */
pub.get('/setup/:token', (r) => {
  const ext = store.config.extensions.find((e) => e.provision_token && e.provision_token === r.params.token)
  if (!ext) throw new HttpError(404, 'Unbekannter Einrichtungslink.')
  sendText(r.res, 200, landingPage(store.config, ext, requestBase(r)), 'text/html; charset=utf-8')
})

// -- Verwaltung (angemeldet) ----------------------------------------------------------

api.get('/api/config', () => ({
  config: store.config,
  providers: PROVIDERS,
  states: BUNDESLAENDER,
  version: SETTINGS.version,
}))

api.put('/api/config/:section', async (r) => {
  const section = r.params.section as SectionName
  if (!SECTIONS.includes(section)) throw new HttpError(404, 'Unbekannter Bereich.')
  const values = await r.json<Record<string, unknown>>()
  store.update((draft) => {
    const merged = { ...draft[section], ...values } as Record<string, unknown>
    if (section === 'mail' && !values.password) merged.password = draft.mail.password
    ;(draft as unknown as Record<string, unknown>)[section] = merged
  })
  applySoon()
  return store.config[section]
})

for (const kind of COLLECTIONS) {
  api.post(`/api/${kind}`, async (r) => {
    const item = await r.json<Record<string, unknown>>()
    const saved = store.upsert(kind as CollectionName, item)
    applySoon()
    return saved
  })
  api.delete(`/api/${kind}/:id`, (r) => {
    store.remove(kind as CollectionName, r.params.id)
    if (kind === 'calendars') calendars.cleanup()
    applySoon()
    return { ok: true }
  })
}

api.post('/api/extensions/:id/renew', (r) => {
  const what = r.query.get('what')
  store.update((draft) => {
    const ext = draft.extensions.find((e) => e.id === r.params.id)
    if (!ext) throw new HttpError(404, 'Nebenstelle nicht gefunden.')
    if (what === 'secret') ext.secret = newSecret()
    else if (what === 'pin') ext.provision_pin = newPin()
    else {
      ext.provision_token = newSecret(32)
      ext.provision_pin = newPin()
    }
    fillSecrets(ext)
  })
  applySoon()
  return store.config.extensions.find((e) => e.id === r.params.id)
})

api.get('/api/extensions/:id/provisioning', (r) => {
  const ext = store.config.extensions.find((e) => e.id === r.params.id)
  if (!ext) throw new HttpError(404, 'Nebenstelle nicht gefunden.')
  const base = requestBase(r)
  return { base, setup: `${base}/setup/${ext.provision_token}`, app: appLink(base, ext), pin: ext.provision_pin }
})

api.post('/api/extensions/:id/invite', async (r) => {
  const ext = store.config.extensions.find((e) => e.id === r.params.id)
  if (!ext) throw new HttpError(404, 'Nebenstelle nicht gefunden.')
  if (!ext.email) throw new HttpError(400, 'Für diese Nebenstelle ist keine E-Mail-Adresse eingetragen.')
  const base = requestBase(r)
  await sendMail(
    store.config.mail,
    ext.email,
    `Ihr Telefon an der Anlage ${store.config.system.name}`,
    [
      `Hallo ${ext.name},`,
      '',
      `Ihre Nebenstelle ${ext.number} an der Telefonanlage ${store.config.system.name} ist eingerichtet.`,
      '',
      'Mit der App SIP-Telefon öffnen Sie einfach diesen Link – die App richtet sich selbst ein:',
      `${base}/setup/${ext.provision_token}`,
      '',
      'Oder in der App unter Einstellungen → Konto → „Von Telefonanlage einrichten“:',
      `  Anlage:          ${base}`,
      `  Nebenstelle:     ${ext.number}`,
      `  Einrichtungs-PIN: ${ext.provision_pin}`,
      '',
      'Funktionen am Telefon: *97 Voicemail, *76 Nicht stören, *21<Nummer> Weiterleitung (*21 aus), *8 Heranholen.',
    ].join('\n'),
  )
  return { ok: true }
})

// Zentrale Kalender

api.get('/api/calendars/:id/events', (r) => {
  const [start, end] = range(r)
  return calendars.events(r.params.id, start, end)
})
api.post('/api/calendars/:id/events', async (r) => {
  const ev = await r.json<{ uid?: string }>()
  return calendars.upsert(r.params.id, ev, ev.uid)
})
api.delete('/api/calendars/:id/events/:uid', (r) => {
  calendars.remove(r.params.id, r.params.uid)
  return { ok: true }
})

api.get('/api/status', async () => ({
  ...(await asterisk.status()),
  dnd: store.state.dnd,
  cfu: store.state.cfu,
  bans: guard.bans,
  update: updater.info,
  version: SETTINGS.version,
  watchdog: watchdog.status(),
}))

api.get('/api/watchdog', () => ({ ...watchdog.status(), events: [...watchdog.events].reverse() }))
api.post('/api/watchdog/check', async () => {
  await watchdog.tick()
  return { ...watchdog.status(), events: [...watchdog.events].reverse() }
})
api.delete('/api/watchdog/events', () => {
  watchdog.events = []
  saveJson(PATHS.watchdog, [], 0o644)
  return { ok: true }
})

api.put('/api/state/:ext', async (r) => {
  const { dnd, cfu } = await r.json<{ dnd?: boolean; cfu?: string }>()
  const n = r.params.ext
  if (!store.config.extensions.some((e) => e.number === n)) throw new HttpError(404, 'Nebenstelle nicht gefunden.')
  if (dnd !== undefined) {
    if (dnd) store.state.dnd[n] = true
    else delete store.state.dnd[n]
  }
  if (cfu !== undefined) {
    if (cfu.trim()) store.state.cfu[n] = cfu.trim()
    else delete store.state.cfu[n]
  }
  store.saveState()
  return { dnd: store.state.dnd, cfu: store.state.cfu }
})

api.post('/api/unban', async (r) => {
  const { ip } = await r.json<{ ip: string }>()
  guard.unban(ip)
  return { ok: true }
})

api.get('/api/calls', (r) => readCalls(Number(r.query.get('limit')) || 200))

api.get('/api/recordings/:name', (r) => {
  const name = r.params.name
  if (!/^[\w.-]+\.wav$/.test(name)) throw new HttpError(400, 'Ungültiger Name.')
  const file = path.join(PATHS.recordings, name)
  if (!fs.existsSync(file)) throw new HttpError(404, 'Aufnahme nicht gefunden.')
  sendFile(r.res, file, r.query.has('download') ? name : undefined)
})

api.get('/api/log', () => tailLog())

api.post('/api/asterisk/restart', async () => {
  await asterisk.restart()
  return { ok: true }
})

api.post('/api/password', async (r) => {
  const { old, password } = await r.json<{ old: string; password: string }>()
  if (!auth.check(old ?? '')) throw new HttpError(403, 'Das bisherige Passwort stimmt nicht.')
  if (!password || password.length < 10) throw new HttpError(400, 'Das neue Passwort braucht mindestens 10 Zeichen.')
  auth.setPassword(password)
  const token = auth.login()
  r.res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}`)
  return { ok: true }
})

api.post('/api/mail/test', async (r) => {
  const { to } = await r.json<{ to: string }>()
  await sendMail(store.config.mail, to, `Test von ${store.config.system.name}`, 'Der E-Mail-Versand der Telefonanlage funktioniert.')
  return { ok: true }
})

// Sicherung, Export, Import

api.get('/api/export', (r) => {
  const data = store.exportData(r.query.get('secrets') === '1', r.query.get('files') === '1', SETTINGS.version)
  const date = new Date().toISOString().slice(0, 10)
  r.res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="phone4all-pbx-${date}.json"`,
  })
  r.res.end(JSON.stringify(data, null, 2))
})

api.post('/api/import', async (r) => {
  const data = await r.json<ExportFile>()
  store.importData(data)
  calendars.revision++
  applySoon()
  return { ok: true }
})

api.get('/api/backups', () => store.backups())
api.post('/api/backups', () => ({ name: store.backup('manuell') }))
api.post('/api/backups/:name/restore', (r) => {
  store.restoreBackup(r.params.name)
  calendars.revision++
  applySoon()
  return { ok: true }
})
api.get('/api/backups/:name', (r) => {
  const name = r.params.name
  if (!/^[\w.-]+\.json$/.test(name)) throw new HttpError(400, 'Ungültiger Name.')
  sendFile(r.res, path.join(PATHS.backups, name), name)
})

// Ansagen und Wartemusik

api.get('/api/sounds', () => ({ custom: listSounds('custom'), moh: listSounds('moh') }))
api.post('/api/sounds/:kind', async (r) => {
  const kind = r.params.kind as SoundKind
  soundDir(kind)
  const name = saveSound(kind, r.query.get('name') ?? 'ansage', await r.body())
  if (kind === 'moh') applySoon()
  return { name }
})
api.get('/api/sounds/:kind/:name', (r) => sendFile(r.res, soundFile(r.params.kind, r.params.name)))
api.delete('/api/sounds/:kind/:name', (r) => {
  const file = soundFile(r.params.kind, r.params.name)
  const base = r.params.name.replace(/\.\w+$/, '')
  if (r.params.kind === 'custom' && store.config.announcements.some((a) => a.file === base)) {
    throw new HttpError(409, 'Die Datei wird noch von einer Ansage verwendet.')
  }
  fs.rmSync(file)
  return { ok: true }
})

// Aktualisierung

api.get('/api/updates', async (r) => (r.query.has('check') ? updater.check(store.config.updates.channel) : updater.info))
api.post('/api/updates/apply', async () => {
  store.backup('vor-update')
  await updater.apply(store.config.updates.channel)
  return { ok: true }
})

// -- Server ---------------------------------------------------------------------------

function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1'
}

async function handle(raw: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const isUpload = raw.url?.startsWith('/api/sounds') || raw.url?.startsWith('/api/import')
  const req = makeRequest(raw, res, isUpload ? 64 * 1024 * 1024 : 1024 * 1024)
  try {
    if (req.path.startsWith('/internal/')) {
      const m = internal.match(req.method, req.path)
      if (!isLoopback(req.ip) || !m) throw new HttpError(404, '')
      req.params = m.params
      sendText(res, 200, String(await m.handler(req)))
      return
    }
    const p = pub.match(req.method, req.path)
    if (p) {
      req.params = p.params
      const result = await p.handler(req)
      if (!res.headersSent) sendJson(res, 200, result)
      return
    }
    if (req.path.startsWith('/api/')) {
      if (!auth.valid(req.cookies[SESSION_COOKIE])) throw new HttpError(401, 'Bitte anmelden.')
      // Schutz vor fremden Formularen: Änderungen nur mit eigenem Kopfeintrag
      if (req.method !== 'GET' && raw.headers['x-phone4all'] !== '1') throw new HttpError(403, 'Anfrage abgelehnt.')
      const m = api.match(req.method, req.path)
      if (!m) throw new HttpError(404, 'Nicht gefunden.')
      req.params = m.params
      const result = await m.handler(req)
      if (!res.headersSent) {
        if (typeof result === 'string') sendText(res, 200, result)
        else sendJson(res, 200, result ?? { ok: true })
      }
      return
    }
    if (req.method !== 'GET') throw new HttpError(405, 'Nicht erlaubt.')
    serveStatic(PATHS.web, req.path, res)
  } catch (e) {
    const status = e instanceof HttpError ? e.status : e instanceof ValidationError ? 400 : 500
    if (status === 500) console.error(e)
    if (!res.headersSent) sendJson(res, status, { error: (e as Error).message || 'Fehler' })
    else res.end()
  }
}

async function main(): Promise<void> {
  console.log(`Phone4all PBX ${SETTINGS.version}`)
  asterisk.prepareDirs()
  await asterisk.apply(store.config, guard.banned())
  const server = http.createServer((req, res) => void handle(req, res))
  server.listen(SETTINGS.httpPort, () => console.log(`Weboberfläche auf Port ${SETTINGS.httpPort}`))
  startDiscovery(() => store.config)
  asterisk.start()
  watchdog.log('info', 'asterisk', `Verwaltungsdienst gestartet (Version ${SETTINGS.version})`)
  watchdog.start()
  setTimeout(() => void watchdog.tick(), 15000).unref()

  // Tägliche Sicherung, stündliche Update-Prüfung, automatisches Update im Zeitfenster
  let lastBackup = ''
  let lastAutoUpdate = ''
  const tick = async (): Promise<void> => {
    const today = new Date().toISOString().slice(0, 10)
    if (lastBackup !== today) {
      lastBackup = today
      store.backup('taeglich')
    }
    const u = store.config.updates
    const info = await updater.check(u.channel)
    if (u.auto && info.available && info.canApply && new Date().getHours() === u.hour && lastAutoUpdate !== today) {
      if ((await asterisk.activeCalls()) === 0) {
        lastAutoUpdate = today
        store.backup('vor-update')
        await updater.apply(u.channel).catch((e) => console.error('Automatisches Update:', e))
      }
    }
  }
  setTimeout(() => void tick().catch(() => undefined), 10000)
  setInterval(() => void tick().catch(() => undefined), 3600000)

  const shutdown = async (): Promise<void> => {
    watchdog.stop()
    saveJson(PATHS.watchdog, watchdog.events, 0o644)
    server.close()
    await asterisk.stop()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}

void main()
