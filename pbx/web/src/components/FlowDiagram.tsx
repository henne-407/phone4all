/**
 * Ablaufdiagramm einer Rufabfolge: Von der angerufenen Nummer über Zeitsteuerung,
 * Sprachmenü und Gruppe bis zur Voicemail – als Baum mit beschrifteten Zweigen.
 * Ein Klick auf einen Knoten öffnet ihn zum Bearbeiten. Zweige lassen sich direkt
 * umhängen: über das Stift-Symbol (Auswahlmenü) oder per Drag & Drop aus der
 * Bausteinleiste (FlowPalette).
 */

import AddIcon from '@mui/icons-material/Add'
import CallEndIcon from '@mui/icons-material/CallEnd'
import CallMadeIcon from '@mui/icons-material/CallMade'
import CampaignIcon from '@mui/icons-material/Campaign'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import DialpadIcon from '@mui/icons-material/Dialpad'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import FaxIcon from '@mui/icons-material/Fax'
import SmartToyIcon from '@mui/icons-material/SmartToyOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import GroupsIcon from '@mui/icons-material/Groups'
import LoopIcon from '@mui/icons-material/Loop'
import PersonIcon from '@mui/icons-material/Person'
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk'
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver'
import ScheduleIcon from '@mui/icons-material/Schedule'
import VoicemailIcon from '@mui/icons-material/Voicemail'
import { Box, Button, ButtonBase, Chip, IconButton, Popover, Stack, Tooltip, Typography, useTheme } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { type ReactNode, useState } from 'react'
import { closedReason } from '../../../server/holidays'
import { type CollectionName, DESTINATION_LABELS, type Destination, type DestinationType, type PbxConfig } from '../../../server/model'
import { go } from '../router'
import { DestinationPicker } from './common'
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
  fax: <FaxIcon />,
  ai: <SmartToyIcon />,
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

/** Gespeichert wird immer ein ganzer Eintrag: [Liste, geänderter Eintrag] */
export type FlowChange = [CollectionName, { id: string; [key: string]: unknown }]

interface Slot {
  label: string
  dest: Destination
  /** Zweig auf ein anderes Ziel setzen (fehlt = nur im Formular änderbar) */
  save?: (d: Destination) => FlowChange
  /** Zweig entfernen (z. B. Taste im Sprachmenü) */
  remove?: () => FlowChange
}

interface NodeInfo {
  type: DestinationType | 'number'
  title: string
  subtitle?: string
  badge?: ReactNode
  children: Slot[]
  /** Neuen Zweig anlegen (z. B. nächste freie Taste) */
  add?: { label: string; save: (d: Destination) => FlowChange }
  onOpen?: () => void
  missing?: boolean
}

/** Datentyp beim Ziehen eines Bausteins */
export const DRAG_TYPE = 'application/x-p4a-destination'

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
        children: [{ label: `niemand nimmt ab (${g.timeout} s)`, dest: g.fallback, save: (x) => ['groups', { ...g, fallback: x }] }],
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
          { label: 'geöffnet', dest: t.open, save: (x) => ['timeconditions', { ...t, open: x }] },
          { label: 'geschlossen', dest: t.closed, save: (x) => ['timeconditions', { ...t, closed: x }] },
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
          ...i.options.map(
            (o, k): Slot => ({
              label: `Taste ${o.digit}`,
              dest: o.destination,
              save: (x) => ['ivrs', { ...i, options: i.options.map((y, j) => (j === k ? { ...y, destination: x } : y)) }],
              remove: () => ['ivrs', { ...i, options: i.options.filter((_y, j) => j !== k) }],
            }),
          ),
          { label: `keine Eingabe (${i.timeout} s)`, dest: i.timeout_destination, save: (x) => ['ivrs', { ...i, timeout_destination: x }] },
          { label: 'falsche Taste', dest: i.invalid_destination, save: (x) => ['ivrs', { ...i, invalid_destination: x }] },
        ],
        add: (() => {
          const digit = [...'1234567890*#'].find((k) => !i.options.some((o) => o.digit === k))
          return digit ? { label: `Taste ${digit} belegen`, save: (x: Destination): FlowChange => ['ivrs', { ...i, options: [...i.options, { digit, destination: x }] }] } : undefined
        })(),
        onOpen: open('ivrs'),
      }
    }
    case 'announcement': {
      const a = cfg.announcements.find((x) => x.id === d.target)
      if (!a) return missing('Ansage')
      return { type: 'announcement', title: a.name, subtitle: a.file ? 'Ansage wird abgespielt' : 'Audiodatei fehlt', children: [{ label: 'danach', dest: a.next, save: (x) => ['announcements', { ...a, next: x }] }], onOpen: open('announcements') }
    }
    case 'conference': {
      const c = cfg.conferences.find((x) => x.id === d.target)
      if (!c) return missing('Konferenz')
      return { type: 'conference', title: `Konferenz ${c.number}`, subtitle: c.name + (c.pin ? ' · mit PIN' : ''), children: [], onOpen: open('conferences') }
    }
    case 'external':
      return { type: 'external', title: d.target || 'Nummer fehlt', subtitle: 'Weiterleitung nach außen', children: [], missing: !d.target }
    case 'ai': {
      const a = cfg.aiagents.find((x) => x.id === d.target)
      if (!a) return missing('KI-Telefonassistent')
      return {
        type: 'ai',
        title: a.name,
        subtitle: a.targets.length ? `KI-Telefonassistent · verbindet mit ${a.targets.map((t) => t.name).join(', ')}` : 'KI-Telefonassistent · nimmt Rückrufnotizen auf',
        children: [{ label: 'wenn nicht weiter', dest: a.fallback, save: (x) => ['aiagents', { ...a, fallback: x }] }],
        onOpen: open('aiagents'),
      }
    }
    case 'fax': {
      const f = cfg.faxes.find((x) => x.id === d.target)
      if (!f) return missing('Fax')
      return { type: 'fax', title: f.name, subtitle: `Fax als PDF an ${f.email}`, children: [], onOpen: open('faxes') }
    }
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
  const items = info.add ? [...info.children, { label: info.add.label, dest: null, save: info.add.save }] : info.children
  return (
    <Box>
      <FlowNode info={info} />
      {items.length > 0 && <Children cfg={cfg} items={items} seen={[...seen, key]} depth={depth + 1} line={theme.m3.outline} />}
    </Box>
  )
}

type ChildSlot = Omit<Slot, 'dest'> & { dest: Destination | null }

/** Speichert eine Änderung aus dem Diagramm */
function useFlowSave(): (change: FlowChange) => Promise<void> {
  const { saveItem, toast } = usePbx()
  return async ([kind, item]) => {
    try {
      await saveItem(kind, item)
      toast('Rufabfolge geändert')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
}

/** Beschriftung eines Zweigs; nimmt gezogene Bausteine an und öffnet das Auswahlmenü. */
function SlotLabel({ slot }: { slot: ChildSlot }) {
  const theme = useTheme()
  const save = useFlowSave()
  const [over, setOver] = useState(false)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [draft, setDraft] = useState<Destination>(slot.dest ?? { type: 'hangup', target: '' })
  const editable = Boolean(slot.save)
  const isNew = slot.dest === null
  return (
    <Stack
      direction="row"
      onDragOver={(e) => {
        if (!editable || !e.dataTransfer.types.includes(DRAG_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'link'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const raw = e.dataTransfer.getData(DRAG_TYPE)
        if (!raw || !slot.save) return
        e.preventDefault()
        void save(slot.save(JSON.parse(raw) as Destination))
      }}
      sx={{
        alignItems: 'center',
        gap: 0.5,
        mb: 0.5,
        minHeight: 30,
        width: 'fit-content',
        maxWidth: '100%',
        pl: 1,
        pr: 0.5,
        ml: -1,
        borderRadius: 2,
        border: '1px dashed',
        borderColor: over ? 'primary.main' : isNew ? theme.m3.outline : 'transparent',
        bgcolor: over ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
        transition: 'background-color .15s, border-color .15s',
        '&:hover .slot-actions': { opacity: 1 },
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 600, color: isNew ? 'primary.main' : 'text.secondary' }}>
        {isNew ? slot.label : `${slot.label} →`}
      </Typography>
      {editable && (
        <Stack direction="row" className="slot-actions" sx={{ opacity: isNew || anchor ? 1 : { xs: 1, md: 0.35 }, transition: 'opacity .15s' }}>
          <Tooltip title={isNew ? 'Ziel wählen' : 'Anderes Ziel wählen'}>
            <IconButton
              size="small"
              onClick={(e) => {
                setDraft(slot.dest ?? { type: 'extension', target: '' })
                setAnchor(e.currentTarget)
              }}
            >
              {isNew ? <AddIcon fontSize="small" /> : <EditOutlinedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          {slot.remove && (
            <Tooltip title="Zweig entfernen">
              <IconButton size="small" onClick={() => void save(slot.remove!())}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      )}
      {isNew && (
        <Typography variant="caption" sx={{ color: 'text.secondary', display: { xs: 'none', md: 'block' }, pr: 1 }}>
          oder Baustein hierher ziehen
        </Typography>
      )}
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 2, width: 420, maxWidth: 'calc(100vw - 32px)' } } }}
      >
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
          {isNew ? slot.label : `${slot.label}: weiter zu`}
        </Typography>
        <DestinationPicker label="Ziel" value={draft} onChange={setDraft} />
        <Stack direction="row" sx={{ justifyContent: 'flex-end', gap: 1, mt: 2 }}>
          <Button onClick={() => setAnchor(null)}>Abbrechen</Button>
          <Button
            variant="contained"
            onClick={() => {
              setAnchor(null)
              void save(slot.save!(draft))
            }}
          >
            Übernehmen
          </Button>
        </Stack>
      </Popover>
    </Stack>
  )
}

function Children({ cfg, items, seen, depth, line }: { cfg: PbxConfig; items: ChildSlot[]; seen: string[]; depth: number; line: string }) {
  return (
    <Box sx={{ ml: { xs: 1.5, sm: 2.5 }, pl: { xs: 1.5, sm: 2.5 }, borderLeft: `2px solid ${line}`, pt: 1 }}>
      {items.map((c, i) => (
        <Box key={i} sx={{ position: 'relative', pb: i === items.length - 1 ? 0 : 1.5 }}>
          <Box sx={{ position: 'absolute', left: { xs: -12, sm: -20 }, top: 14, width: { xs: 10, sm: 16 }, borderTop: `2px solid ${line}` }} />
          <SlotLabel slot={c} />
          {c.dest && <Branch cfg={cfg} dest={c.dest} seen={seen} depth={depth} />}
        </Box>
      ))}
    </Box>
  )
}

/** Ganzer Ablauf ab einem Einstieg (angerufene Nummer o. Ä.) */
export function FlowDiagram({
  entry,
  dest,
  onChange,
}: {
  entry: Omit<NodeInfo, 'children' | 'type'> & { type?: NodeInfo['type'] }
  dest: Destination
  /** Ersten Schritt umhängen */
  onChange?: (d: Destination) => FlowChange
}) {
  const { config } = usePbx()
  const theme = useTheme()
  return (
    <Box>
      <FlowNode info={{ type: 'number', ...entry, children: [] }} />
      <Children cfg={config} items={[{ label: 'geht zu', dest, save: onChange }]} seen={[]} depth={0} line={theme.m3.outline} />
    </Box>
  )
}

/** Bausteine zum Ziehen: alle möglichen Ziele der Anlage */
export function FlowPalette() {
  const { config } = usePbx()
  const theme = useTheme()
  const groups: [string, DestinationType, { target: string; label: string }[]][] = [
    ['Nebenstellen', 'extension', config.extensions.map((e) => ({ target: e.id, label: `${e.number} ${e.name}` }))],
    ['Gruppen', 'group', config.groups.map((g) => ({ target: g.id, label: g.name }))],
    ['Zeitsteuerungen', 'timecondition', config.timeconditions.map((t) => ({ target: t.id, label: t.name }))],
    ['Sprachmenüs', 'ivr', config.ivrs.map((i) => ({ target: i.id, label: i.name }))],
    ['Ansagen', 'announcement', config.announcements.map((a) => ({ target: a.id, label: a.name }))],
    ['Voicemail', 'voicemail', config.extensions.filter((e) => e.voicemail.enabled).map((e) => ({ target: e.id, label: `Voicemail ${e.number}` }))],
    ['Konferenzräume', 'conference', config.conferences.map((c) => ({ target: c.id, label: c.name || `Konferenz ${c.number}` }))],
    ['Fax', 'fax', config.faxes.map((f) => ({ target: f.id, label: f.name }))],
    ['KI-Telefonassistent', 'ai', config.aiagents.map((a) => ({ target: a.id, label: a.name }))],
    ['Sonstiges', 'hangup', [{ target: '', label: 'Auflegen' }]],
  ]
  return (
    <Box>
      <Typography variant="subtitle2">Bausteine</Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
        Auf einen Zweig im Ablauf ziehen, um ihn umzuhängen.
      </Typography>
      {groups
        .filter(([, , items]) => items.length)
        .map(([title, type, items]) => (
          <Box key={title} sx={{ mb: 1.5 }}>
            <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 2 }}>
              {title}
            </Typography>
            <Stack sx={{ gap: 0.75 }}>
              {items.map((it) => (
                <Stack
                  key={it.target || it.label}
                  direction="row"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ type, target: it.target }))
                    e.dataTransfer.effectAllowed = 'link'
                  }}
                  sx={{
                    alignItems: 'center',
                    gap: 1,
                    px: 1,
                    py: 0.5,
                    borderRadius: 2,
                    // Farbe nur am Symbol: ein dicker linker Rand wirkt an runden Bausteinen wie eine Klammer
                    border: `1px solid ${theme.m3.outlineVariant}`,
                    bgcolor: 'background.paper',
                    cursor: 'grab',
                    userSelect: 'none',
                    transition: 'box-shadow .15s, border-color .15s',
                    '&:hover': { boxShadow: `0 1px 6px ${alpha(theme.m3.outline, 0.6)}`, borderColor: theme.m3.node[type] },
                    '&:active': { cursor: 'grabbing' },
                  }}
                >
                  <DragIndicatorIcon fontSize="small" sx={{ color: 'text.disabled' }} />
                  <Box sx={{ color: theme.m3.node[type], display: 'flex', '& svg': { fontSize: 18 } }}>{NODE_ICONS[type]}</Box>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                    {it.label}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Box>
        ))}
    </Box>
  )
}
