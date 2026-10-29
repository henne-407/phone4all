/**
 * Selbstbedienung unter /me: Anmeldung mit Nebenstelle und Voicemail-PIN, danach
 * Umleitung, Nicht stören, Handy klingelt mit, Gruppen, Voicemail und PIN selbst einstellen.
 * Eine kleine Seite ohne Framework (HTML + /me/app.js), damit sie auch auf alten Geräten läuft.
 */

import { randomBytes } from 'node:crypto'
import type { PbxConfig } from './model'

const SESSION_HOURS = 8
const MAX_FAILURES = 5
const LOCK_MS = 15 * 60000

export const PORTAL_COOKIE = 'p4a_me'
export const PORTAL_MAX_AGE = SESSION_HOURS * 3600

export class PortalSessions {
  private sessions = new Map<string, { ext: string; until: number }>()
  private failures = new Map<string, { count: number; until: number }>()

  login(ext: string): string {
    const token = randomBytes(32).toString('hex')
    this.sessions.set(token, { ext, until: Date.now() + SESSION_HOURS * 3600000 })
    return token
  }

  logout(token: string): void {
    this.sessions.delete(token)
  }

  /** Nebenstelle zur Sitzung oder '' */
  ext(token: string | undefined): string {
    if (!token) return ''
    const s = this.sessions.get(token)
    if (!s || s.until < Date.now()) {
      this.sessions.delete(token)
      return ''
    }
    return s.ext
  }

  /** Alle Sitzungen einer Nebenstelle beenden (PIN geändert, Nebenstelle gelöscht) */
  logoutExt(ext: string, except = ''): void {
    for (const [token, s] of this.sessions) if (s.ext === ext && token !== except) this.sessions.delete(token)
  }

  /** Nebenstelle nach zu vielen falschen PINs gesperrt? */
  locked(ext: string, now = Date.now()): boolean {
    const f = this.failures.get(ext)
    return Boolean(f && f.count >= MAX_FAILURES && f.until > now)
  }

  failed(ext: string, now = Date.now()): void {
    const f = this.failures.get(ext)
    const count = f && f.until > now ? f.count + 1 : 1
    this.failures.set(ext, { count, until: now + LOCK_MS })
  }

  succeeded(ext: string): void {
    this.failures.delete(ext)
  }

  prune(now = Date.now()): void {
    for (const [t, s] of this.sessions) if (s.until < now) this.sessions.delete(t)
    for (const [e, f] of this.failures) if (f.until < now) this.failures.delete(e)
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

export function portalPage(cfg: PbxConfig): string {
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(cfg.system.name)} – Mein Telefon</title>
<link rel="icon" href="/icon.svg">
<style>
:root{color-scheme:light dark;--bg:#fef7ff;--fg:#1d1b20;--muted:#49454f;--card:#f3edf7;--line:#cac4d0;--pri:#6750a4;--on:#fff;--err:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#141218;--fg:#e6e0e9;--muted:#cac4d0;--card:#211f26;--line:#49454f;--pri:#d0bcff;--on:#381e72;--err:#f2b8b5}}
*{box-sizing:border-box}
body{margin:0;font:16px/1.5 Roboto,system-ui,sans-serif;background:var(--bg);color:var(--fg);display:flex;justify-content:center;padding:24px 16px}
main{max-width:560px;width:100%}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:0 0 12px}
.muted{color:var(--muted);font-size:14px}
.card{background:var(--card);border-radius:16px;padding:20px;margin-top:16px}
label{display:block;font-size:14px;color:var(--muted);margin:12px 0 4px}
input[type=text],input[type=password],input[type=tel]{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit}
button{font:inherit;font-weight:500;border:0;border-radius:20px;padding:10px 20px;background:var(--pri);color:var(--on);cursor:pointer;margin-top:12px}
button.text{background:transparent;color:var(--pri);padding:6px 10px;margin:0}
button:disabled{opacity:.5}
.row{display:flex;align-items:center;gap:12px;padding:8px 0;border-top:1px solid var(--line)}
.row:first-of-type{border-top:0}.grow{flex:1;min-width:0}
.switch{appearance:none;width:44px;height:26px;border-radius:13px;background:var(--line);position:relative;cursor:pointer;flex-shrink:0;margin:0}
.switch:checked{background:var(--pri)}
.switch::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .15s}
.switch:checked::after{left:21px}
.err{color:var(--err);font-size:14px;min-height:20px;margin-top:8px}
audio{width:100%;margin-top:6px;height:36px}
.text{font-style:italic}
.hidden{display:none}
.top{display:flex;align-items:flex-start;gap:12px}
</style></head><body><main>
<div id="login" class="hidden">
  <h1>${esc(cfg.system.name)}</h1>
  <p class="muted">Eigene Nebenstelle einstellen: Umleitung, Nicht stören, Gruppen und Voicemail.</p>
  <form class="card" id="loginForm">
    <label for="number">Nebenstelle</label><input id="number" type="tel" inputmode="numeric" autocomplete="username" required>
    <label for="pin">Voicemail-PIN</label><input id="pin" type="password" inputmode="numeric" autocomplete="current-password" required>
    <button type="submit">Anmelden</button>
    <div class="err" id="loginErr"></div>
    <p class="muted">Keine PIN? Die Verwaltung der Telefonanlage vergibt sie.</p>
  </form>
</div>
<div id="app" class="hidden">
  <div class="top"><div class="grow"><h1 id="title"></h1><div class="muted" id="subtitle"></div></div><button class="text" id="logout">Abmelden</button></div>
  <section class="card"><h2>Erreichbarkeit</h2>
    <div class="row"><div class="grow">Nicht stören<div class="muted">Anrufe gehen sofort zur Voicemail bzw. Umleitung</div></div><input type="checkbox" class="switch" id="dnd"></div>
    <div class="row hidden" id="mobileRow"><div class="grow">Handy klingelt mit<div class="muted" id="mobileNumber"></div></div><input type="checkbox" class="switch" id="mobile"></div>
    <label for="cfu">Sofort umleiten an</label>
    <input id="cfu" type="tel" placeholder="Nebenstelle oder Rufnummer, leer = aus" list="targets">
    <datalist id="targets"></datalist>
    <button id="saveCfu">Umleitung speichern</button>
    <div class="muted" id="active"></div>
  </section>
  <section class="card hidden" id="groupsCard"><h2>Gruppen</h2><div id="groups"></div>
    <p class="muted">Abgemeldet klingelt Ihr Telefon bei Anrufen an die Gruppe nicht mit.</p></section>
  <section class="card hidden" id="vmCard"><h2>Voicemail</h2><div id="voicemail"></div></section>
  <section class="card"><h2>Voicemail-PIN ändern</h2>
    <label for="oldPin">Bisherige PIN</label><input id="oldPin" type="password" inputmode="numeric" autocomplete="current-password">
    <label for="newPin">Neue PIN (4 bis 8 Ziffern)</label><input id="newPin" type="password" inputmode="numeric" autocomplete="new-password">
    <button id="savePin">PIN ändern</button>
  </section>
  <div class="err" id="err"></div>
</div>
<script src="/me/app.js"></script>
</main></body></html>`
}

/** Skript der Seite (eigene Datei, damit die Inhaltsrichtlinie kein Inline-Skript erlauben muss) */
export const PORTAL_JS = `'use strict'
const $ = (id) => document.getElementById(id)
let state = null
async function call(method, path, body) {
  const r = await fetch('/me/api' + path, { method, headers: { 'Content-Type': 'application/json', 'x-phone4all': '1' }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' })
  const data = await r.json().catch(() => ({}))
  if (r.status === 401 && path !== '/login') { show(false); throw new Error('Bitte neu anmelden.') }
  if (!r.ok) throw new Error(data.error || ('Fehler ' + r.status))
  return data
}
function show(loggedIn) { $('login').classList.toggle('hidden', loggedIn); $('app').classList.toggle('hidden', !loggedIn) }
function err(e) { $('err').textContent = e ? e.message || String(e) : '' }
function fmtTime(ms) { return new Date(ms).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) }
function fmtDur(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') }
function el(tag, props, children) { const e = document.createElement(tag); Object.assign(e, props || {}); for (const c of children || []) e.append(c); return e }
function render() {
  const s = state
  $('title').textContent = s.ext.name
  $('subtitle').textContent = 'Nebenstelle ' + s.ext.number
  $('dnd').checked = s.dnd
  $('cfu').value = s.forward.cfu
  $('active').textContent = s.forward.active && s.forward.active !== s.forward.cfu ? 'Gerade aktiv: Umleitung an ' + s.forward.active + ' (Regel)' : ''
  $('targets').replaceChildren(...s.forward.targets.map((t) => el('option', { value: t.number, label: t.number + ' ' + t.name })))
  $('mobileRow').classList.toggle('hidden', !s.forward.mobile)
  if (s.forward.mobile) { $('mobile').checked = s.forward.mobile.enabled; $('mobileNumber').textContent = s.forward.mobile.number }
  $('groupsCard').classList.toggle('hidden', !s.groups.length)
  $('groups').replaceChildren(...s.groups.map((g) => {
    const box = el('input', { type: 'checkbox', className: 'switch', checked: g.active })
    box.onchange = () => call('PUT', '/groups/' + encodeURIComponent(g.id), { active: box.checked }).then((groups) => { state.groups = groups; render() }).catch(err)
    return el('div', { className: 'row' }, [el('div', { className: 'grow', textContent: (g.number ? g.number + ' ' : '') + g.name }), box])
  }))
  $('vmCard').classList.toggle('hidden', !s.voicemail)
  if (s.voicemail) {
    $('voicemail').replaceChildren(...(s.voicemail.length ? s.voicemail.map((m) => {
      const head = el('div', { className: 'grow' }, [el('b', { textContent: (m.unread ? '● ' : '') + (m.name || m.number || 'Unbekannt') }), el('div', { className: 'muted', textContent: fmtTime(m.time) + ' · ' + fmtDur(m.duration) + (m.name && m.number ? ' · ' + m.number : '') })])
      const del = el('button', { className: 'text', textContent: 'Löschen' })
      del.onclick = () => call('DELETE', '/voicemail/' + encodeURIComponent(m.id)).then((list) => { state.voicemail = list; render() }).catch(err)
      const audio = el('audio', { controls: true, preload: 'none', src: '/me/api/voicemail/' + encodeURIComponent(m.id) })
      audio.onplay = () => { if (m.unread) call('PUT', '/voicemail/' + encodeURIComponent(m.id)).then((list) => { state.voicemail = list }).catch(() => undefined) }
      const parts = [el('div', { className: 'top' }, [head, del])]
      if (m.text) parts.push(el('div', { className: 'text', textContent: '„' + m.text + '“' }))
      else if (m.transcribing) parts.push(el('div', { className: 'muted', textContent: 'Text wird erstellt …' }))
      parts.push(audio)
      return el('div', { className: 'row', style: 'display:block' }, parts)
    }) : [el('p', { className: 'muted', textContent: 'Keine Nachrichten.' })]))
  }
}
async function load() { state = await call('GET', '/state'); show(true); render() }
$('loginForm').onsubmit = (e) => {
  e.preventDefault()
  $('loginErr').textContent = ''
  call('POST', '/login', { number: $('number').value.trim(), pin: $('pin').value }).then(() => { $('pin').value = ''; return load() }).catch((e) => { $('loginErr').textContent = e.message })
}
$('logout').onclick = () => call('POST', '/logout').finally(() => show(false))
$('dnd').onchange = () => call('PUT', '/dnd', { enabled: $('dnd').checked }).then(load).catch(err)
$('mobile').onchange = () => call('PUT', '/forward', { mobile: $('mobile').checked }).then((f) => { state.forward = f; render() }).catch((e) => { err(e); load() })
$('saveCfu').onclick = () => call('PUT', '/forward', { cfu: $('cfu').value.trim() }).then((f) => { state.forward = f; err(); render() }).catch(err)
$('savePin').onclick = () => call('PUT', '/pin', { old: $('oldPin').value, pin: $('newPin').value }).then(() => { $('oldPin').value = ''; $('newPin').value = ''; err(); alert('PIN geändert') }).catch(err)
load().catch(() => show(false))
`
