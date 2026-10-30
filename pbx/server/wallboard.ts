/**
 * Wallboard: Vollbildanzeige für Warteschlangen (Bildschirm im Büro). Geheime Adresse
 * /wallboard/<schlüssel>, ohne Anmeldung; die Seite fragt alle drei Sekunden ./data ab.
 */

import type { AmiMessage } from './ami'
import type { PbxConfig } from './model'
import type { LineState } from './presence'

export interface WallboardQueue {
  id: string
  name: string
  number: string
  waiting: { position: number; caller: string; wait: number }[]
  members: { number: string; name: string; state: LineState | 'away' }[]
  callbacks: number
  today: { calls: number; answered: number; abandoned: number; avg_wait: number; max_wait: number }
}

export interface WallboardData {
  name: string
  time: number
  queues: WallboardQueue[]
}

/** Rufnummer teilweise verdecken (Bildschirm ist für alle im Raum sichtbar) */
export function maskNumber(n: string): string {
  const d = n.replace(/\s/g, '')
  if (d.length <= 6) return d
  return `${d.slice(0, 4)} ••• ${d.slice(-2)}`
}

export function wallboardData(
  cfg: PbxConfig,
  status: AmiMessage[],
  input: {
    lineState: (num: string) => LineState
    available: (num: string, gid: string) => boolean
    callbacks: (gid: string) => number
    today: { id: string; calls: number; answered: number; abandoned: number; avg_wait: number; max_wait: number }[]
    knownName: (num: string) => string
    now: number
  },
): WallboardData {
  const queues = cfg.groups
    .filter((g) => g.mode === 'queue')
    .map((g): WallboardQueue => {
      const entries = status
        .filter((e) => e.Event === 'QueueEntry' && e.Queue === `p4a-${g.id}`)
        .map((e) => {
          const num = (e.CallerIDNum ?? '').replace(/^<unknown>$/i, '')
          const name = (e.CallerIDName ?? '').replace(/^<unknown>$/i, '') || input.knownName(num)
          return { position: Number(e.Position) || 0, caller: name || maskNumber(num) || 'Unbekannt', wait: Number(e.Wait) || 0 }
        })
        .sort((a, b) => a.position - b.position)
      const t = input.today.find((x) => x.id === g.id)
      return {
        id: g.id,
        name: g.name,
        number: g.number,
        waiting: entries,
        members: g.members.map((m) => ({
          number: m,
          name: cfg.extensions.find((e) => e.number === m)?.name || m,
          state: input.available(m, g.id) ? input.lineState(m) : 'away',
        })),
        callbacks: input.callbacks(g.id),
        today: t ? { calls: t.calls, answered: t.answered, abandoned: t.abandoned, avg_wait: t.avg_wait, max_wait: t.max_wait } : { calls: 0, answered: 0, abandoned: 0, avg_wait: 0, max_wait: 0 },
      }
    })
  return { name: cfg.system.name, time: input.now, queues }
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** base: Adresse der Seite ohne Schrägstrich am Ende, z. B. /wallboard/<schlüssel> */
export function wallboardPage(name: string, base: string): string {
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} – Wallboard</title>
<link rel="icon" href="/icon.svg">
<style>
:root{color-scheme:dark;--bg:#141218;--fg:#e6e0e9;--muted:#a59fae;--card:#211f26;--line:#3a3640;--ok:#7dd38a;--warn:#f2c46d;--bad:#f2b8b5;--busy:#d0bcff}
*{box-sizing:border-box}
body{margin:0;font:18px/1.4 Roboto,system-ui,sans-serif;background:var(--bg);color:var(--fg);padding:24px}
header{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px}
h1{font-size:28px;margin:0}#clock{font-size:28px;font-variant-numeric:tabular-nums;color:var(--muted)}
#grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:16px}
.q{background:var(--card);border-radius:16px;padding:20px}
.q h2{margin:0 0 12px;font-size:24px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px}
.kpi{background:var(--bg);border-radius:12px;padding:10px 12px}
.kpi b{display:block;font-size:40px;line-height:1.1;font-variant-numeric:tabular-nums}
.kpi span{font-size:14px;color:var(--muted)}
.warn b{color:var(--warn)}.bad b{color:var(--bad)}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
td{padding:6px 4px;border-top:1px solid var(--line)}td.r{text-align:right}
.members{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.m{border-radius:16px;padding:4px 12px;font-size:15px;background:var(--bg);border:1px solid var(--line)}
.m::before{content:"●";margin-right:6px}
.idle::before{color:var(--ok)}.busy::before,.ringing::before{color:var(--busy)}.offline::before,.away::before{color:var(--muted)}
.muted{color:var(--muted);font-size:15px}
#err{color:var(--bad);margin-top:12px}
</style></head><body>
<header><h1>${esc(name)}</h1><div id="clock"></div></header>
<div id="grid"></div><div id="err"></div>
<script src="${esc(base)}/app.js"></script>
</body></html>`
}

export const WALLBOARD_JS = `'use strict'
const $ = (id) => document.getElementById(id)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';')
const mmss = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0')
const STATE = { idle: 'frei', busy: 'spricht', ringing: 'klingelt', offline: 'nicht erreichbar', away: 'abgemeldet' }
async function load() {
  try {
    const r = await fetch(location.pathname.replace(/\\/+$/, '') + '/data', { cache: 'no-store' })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const d = await r.json()
    $('err').textContent = ''
    $('clock').textContent = new Date(d.time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    $('grid').innerHTML = d.queues.length ? d.queues.map((q) => {
      const longest = q.waiting.reduce((m, w) => Math.max(m, w.wait), 0)
      const free = q.members.filter((m) => m.state === 'idle').length
      return '<section class="q"><h2>' + esc(q.name) + (q.number ? ' <span class="muted">' + esc(q.number) + '</span>' : '') + '</h2>' +
        '<div class="kpis">' +
        '<div class="kpi ' + (q.waiting.length ? 'warn' : '') + '"><b>' + q.waiting.length + '</b><span>warten</span></div>' +
        '<div class="kpi ' + (longest > 120 ? 'bad' : longest > 45 ? 'warn' : '') + '"><b>' + mmss(longest) + '</b><span>längste Wartezeit</span></div>' +
        '<div class="kpi ' + (free ? '' : 'warn') + '"><b>' + free + '</b><span>frei</span></div>' +
        '<div class="kpi ' + (q.callbacks ? 'warn' : '') + '"><b>' + q.callbacks + '</b><span>Rückrufe offen</span></div>' +
        '</div>' +
        (q.waiting.length ? '<table>' + q.waiting.map((w) => '<tr><td>' + w.position + '.</td><td>' + esc(w.caller) + '</td><td class="r">' + mmss(w.wait) + '</td></tr>').join('') + '</table>' : '<div class="muted">Niemand wartet.</div>') +
        '<div class="members">' + q.members.map((m) => '<span class="m ' + m.state + '" title="' + STATE[m.state] + '">' + esc(m.name) + '</span>').join('') + '</div>' +
        '<p class="muted">Heute: ' + q.today.calls + ' Anrufe · ' + q.today.answered + ' angenommen · ' + q.today.abandoned + ' aufgelegt · Ø Wartezeit ' + mmss(q.today.avg_wait) + '</p>' +
        '</section>'
    }).join('') : '<p class="muted">Keine Warteschlangen eingerichtet (Gruppe mit Modus „Warteschlange“).</p>'
  } catch (e) {
    $('err').textContent = 'Keine Verbindung zur Anlage (' + e.message + ')'
  }
}
load()
setInterval(load, 3000)
`
