/**
 * Ablaufdiagramm einer Rufabfolge: Von der angerufenen Nummer über Zeitsteuerung,
 * Sprachmenü und Gruppe bis zur Voicemail – als Baum mit beschrifteten Zweigen.
 * Ein Klick auf einen Knoten öffnet ihn zum Bearbeiten.
 */

import CallEndIcon from '@mui/icons-material/CallEnd'
import CallMadeIcon from '@mui/icons-material/CallMade'
import CampaignIcon from '@mui/icons-material/Campaign'
import DialpadIcon from '@mui/icons-material/Dialpad'
import GroupsIcon from '@mui/icons-material/Groups'
import LoopIcon from '@mui/icons-material/Loop'
import PersonIcon from '@mui/icons-material/Person'
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk'
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver'
import ScheduleIcon from '@mui/icons-material/Schedule'
import VoicemailIcon from '@mui/icons-material/Voicemail'
import { Box, ButtonBase, Chip, Stack, Typography, useTheme } from '@mui/material'
import type { ReactNode } from 'react'
import { closedReason } from '../../../server/holidays'
import { DESTINATION_LABELS, type Destination, type DestinationType, type PbxConfig } from '../../../server/model'
import { go } from '../router'
import { usePbx } from '../state'

const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const MAX_DEPTH = 8

export const NODE_ICONS: Record<DestinationType | 'number', ReactNode> = {
  number: <PhoneInTalkIcon />,
  extension: <PersonIcon />,
  group: <GroupsIcon />,
  ivr: <DialpadIcon />,
  timecondition: <ScheduleIcon />,
  voicemail: <VoicemailIcon />,
  conference: <RecordVoiceOverIcon />,
  announcement: <CampaignIcon />,
  external: <CallMadeIcon />,
  hangup: <CallEndIcon />,
}

/** Kurzform der Öffnungszeiten, z. B. „Mo–Fr 08:00–17:00“ */
export function scheduleText(rules: { days: number[]; from: string; to: string }[]): string {
  return rules
    .map((r) => {
      const d = [...r.days].sort()
      const consecutive = d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1] + 1)
      const days = consecutive ? `${DAYS[d[0] - 1]}–${DAYS[d[d.length - 1] - 1]}` : d.map((x) => DAYS[x - 1]).join(', ')
      return `${days} ${r.from}–${r.to}`
    })
    .join(' · ')
}

/** Nummer aus einer Weiterleitung → Ziel (Nebenstelle, Gruppe oder extern) */
function numberTarget(cfg: PbxConfig, number: string): Destination {
  const ext = cfg.extensions.find((e) => e.number === number)
  if (ext) return { type: 'extension', target: ext.id }
  const group = cfg.groups.find((g) => g.number === number)
  if (group) return { type: 'group', target: group.id }
  return { type: 'external', target: number }
}

interface NodeInfo {
  type: DestinationType | 'number'
  title: string
  subtitle?: string
  badge?: ReactNode
  children: { label: string; dest: Destination }[]
  onOpen?: () => void
  missing?: boolean
}

function describe(cfg: PbxConfig, d: Destination): NodeInfo {
  const open = (page?: string) => (page && d.target ? () => go(page, d.target) : undefined)
  const missing = (what: string): NodeInfo => ({ type: d.type, title: `${what} fehlt`, subtitle: 'Ziel wurde gelöscht – Anrufer werden aufgelegt', children: [], missing: true })
  switch (d.type) {
    case 'extension': {
      const e = cfg.extensions.find((x) => x.id === d.target)
      if (!e) return missing('Nebenstelle')
      const children: NodeInfo['children'] = []
      const vm: Destination = { type: 'voicemail', target: e.id }
      if (e.forward.noanswer) children.push({ label: `keine Antwort nach ${e.ring_seconds} s`, dest: numberTarget(cfg, e.forward.noanswer) })
      else if (e.voicemail.enabled) children.push({ label: `keine Antwort nach ${e.ring_seconds} s`, dest: vm })
      if (e.forward.busy) children.push({ label: 'besetzt', dest: numberTarget(cfg, e.forward.busy) })
      else if (e.voicemail.enabled && !e.forward.noanswer) children.push({ label: 'besetzt', dest: vm })
      return { type: 'extension', title: `${e.number} · ${e.name}`, subtitle: 'Klingelt auf allen Geräten der Person', children, onOpen: open('extensions') }
    }
    case 'voicemail': {
      const e = cfg.extensions.find((x) => x.id === d.target)
      if (!e) return missing('Voicemail')
      return { type: 'voicemail', title: `Voicemail ${e.number}`, subtitle: e.email && e.voicemail.attach ? `Nachricht per E-Mail an ${e.email}` : `Abhören mit *97 an ${e.number}`, children: [], onOpen: open('extensions') }
    }
    case 'group': {
      const g = cfg.groups.find((x) => x.id === d.target)
      if (!g) return missing('Gruppe')
      const names = g.members.map((n) => cfg.extensions.find((e) => e.number === n)?.name ?? n)
      const mode = g.mode === 'all' ? 'alle gleichzeitig' : g.mode === 'sequential' ? 'nacheinander' : 'Warteschlange'
      return {
        type: 'group',
        title: g.name + (g.number ? ` (${g.number})` : ''),
        subtitle: `${mode}: ${names.join(', ') || 'keine Mitglieder'}`,
        children: [{ label: `niemand nimmt ab (${g.timeout} s)`, dest: g.fallback }],
        onOpen: open('groups'),
      }
    }
    case 'timecondition': {
      const t = cfg.timeconditions.find((x) => x.id === d.target)
      if (!t) return missing('Zeitsteuerung')
      const closed = closedReason(t, new Date(), cfg.system.state, cfg.system.timezone)
      return {
        type: 'timecondition',
        title: t.name,
        subtitle: (scheduleText(t.rules) || 'keine Zeiten') + (t.holidays ? ' · Feiertage geschlossen' : ''),
        badge: <Chip size="small" color={closed ? 'warning' : 'success'} label={closed ? `jetzt zu: ${closed}` : 'jetzt geöffnet'} />,
        children: [
          { label: 'geöffnet', dest: t.open },
          { label: 'geschlossen', dest: t.closed },
        ],
        onOpen: open('timeconditions'),
      }
    }
    case 'ivr': {
      const i = cfg.ivrs.find((x) => x.id === d.target)
      if (!i) return missing('Sprachmenü')
      const ann = cfg.announcements.find((a) => a.id === i.announcement)
      return {
        type: 'ivr',
        title: i.name,
        subtitle: ann ? `Ansage „${ann.name}“` : 'ohne Ansage',
        children: [
          ...i.options.map((o) => ({ label: `Taste ${o.digit}`, dest: o.destination })),
          { label: `keine Eingabe (${i.timeout} s)`, dest: i.timeout_destination },
          { label: 'falsche Taste', dest: i.invalid_destination },
        ],
        onOpen: open('ivrs'),
      }
    }
    case 'announcement': {
      const a = cfg.announcements.find((x) => x.id === d.target)
      if (!a) return missing('Ansage')
      return { type: 'announcement', title: a.name, subtitle: a.file ? 'Ansage wird abgespielt' : 'Audiodatei fehlt', children: [{ label: 'danach', dest: a.next }], onOpen: open('announcements') }
    }
    case 'conference': {
      const c = cfg.conferences.find((x) => x.id === d.target)
      if (!c) return missing('Konferenz')
      return { type: 'conference', title: `Konferenz ${c.number}`, subtitle: c.name + (c.pin ? ' · mit PIN' : ''), children: [], onOpen: open('conferences') }
    }
    case 'external':
      return { type: 'external', title: d.target || 'Nummer fehlt', subtitle: 'Weiterleitung nach außen', children: [], missing: !d.target }
    default:
      return { type: 'hangup', title: 'Auflegen', children: [] }
  }
}

export function FlowNode({ info, compact }: { info: NodeInfo; compact?: boolean }) {
  const theme = useTheme()
  const color = info.missing ? theme.palette.error.main : theme.m3.node[info.type]
  const body = (
    <Stack
      direction="row"
      sx={{
        alignItems: 'center',
        gap: 1.5,
        px: 1.5,
        py: compact ? 0.75 : 1.25,
        border: `1px solid ${theme.m3.outlineVariant}`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 2,
        bgcolor: 'background.paper',
        textAlign: 'left',
        width: '100%',
        maxWidth: 520,
        transition: 'border-color .15s, box-shadow .15s',
        '&:hover': info.onOpen ? { boxShadow: `0 1px 6px ${theme.m3.outline}` } : undefined,
      }}
    >
      <Box sx={{ color, display: 'flex', flexShrink: 0 }}>{NODE_ICONS[info.type]}</Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="caption" sx={{ color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', lineHeight: 1.3 }}>
          {info.type === 'number' ? 'Anruf auf' : DESTINATION_LABELS[info.type]}
        </Typography>
        <Typography sx={{ fontWeight: 600, lineHeight: 1.35 }}>{info.title}</Typography>
        {info.subtitle && (
          <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.35 }}>
            {info.subtitle}
          </Typography>
        )}
      </Box>
      {info.badge}
    </Stack>
  )
  return info.onOpen ? (
    <ButtonBase onClick={info.onOpen} sx={{ borderRadius: 2, width: '100%', maxWidth: 520, justifyContent: 'flex-start' }}>
      {body}
    </ButtonBase>
  ) : (
    body
  )
}

function Branch({ cfg, dest, seen, depth }: { cfg: PbxConfig; dest: Destination; seen: string[]; depth: number }) {
  const theme = useTheme()
  const key = `${dest.type}:${dest.target}`
  if (seen.includes(key) || depth > MAX_DEPTH) {
    const info = describe(cfg, dest)
    return (
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, color: 'text.secondary', py: 0.5 }}>
        <LoopIcon fontSize="small" />
        <Typography variant="body2">zurück zu {info.title}</Typography>
      </Stack>
    )
  }
  const info = describe(cfg, dest)
  return (
    <Box>
      <FlowNode info={info} />
      {info.children.length > 0 && <Children cfg={cfg} items={info.children} seen={[...seen, key]} depth={depth + 1} line={theme.m3.outline} />}
    </Box>
  )
}

function Children({ cfg, items, seen, depth, line }: { cfg: PbxConfig; items: NodeInfo['children']; seen: string[]; depth: number; line: string }) {
  return (
    <Box sx={{ ml: { xs: 1.5, sm: 2.5 }, pl: { xs: 1.5, sm: 2.5 }, borderLeft: `2px solid ${line}`, pt: 1 }}>
      {items.map((c, i) => (
        <Box key={i} sx={{ position: 'relative', pb: i === items.length - 1 ? 0 : 1.5 }}>
          <Box sx={{ position: 'absolute', left: { xs: -12, sm: -20 }, top: 11, width: { xs: 10, sm: 16 }, borderTop: `2px solid ${line}` }} />
          <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary', mb: 0.5 }}>
            {c.label} →
          </Typography>
          <Branch cfg={cfg} dest={c.dest} seen={seen} depth={depth} />
        </Box>
      ))}
    </Box>
  )
}

/** Ganzer Ablauf ab einem Einstieg (angerufene Nummer o. Ä.) */
export function FlowDiagram({ entry, dest }: { entry: Omit<NodeInfo, 'children' | 'type'> & { type?: NodeInfo['type'] }; dest: Destination }) {
  const { config } = usePbx()
  const theme = useTheme()
  return (
    <Box>
      <FlowNode info={{ type: 'number', ...entry, children: [] }} />
      <Children cfg={config} items={[{ label: 'geht zu', dest }]} seen={[]} depth={0} line={theme.m3.outline} />
    </Box>
  )
}
