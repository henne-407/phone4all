import BlockIcon from '@mui/icons-material/Block'
import CallMadeIcon from '@mui/icons-material/CallMade'
import CallMissedIcon from '@mui/icons-material/CallMissed'
import CallReceivedIcon from '@mui/icons-material/CallReceived'
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk'
import CheckIcon from '@mui/icons-material/Check'
import DeleteIcon from '@mui/icons-material/Delete'
import UndoIcon from '@mui/icons-material/Undo'
import { Box, Button, Card, Chip, IconButton, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, Tooltip, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { type CallRecord, type GroupMissed, api } from '../api'
import { ConfirmDialog, PageHeader, formatDuration } from '../components/common'
import { usePbx } from '../state'

const STATUS: Record<CallRecord['status'], [string, 'success' | 'error' | 'warning' | 'default']> = {
  answered: ['Angenommen', 'success'],
  missed: ['Verpasst', 'error'],
  busy: ['Besetzt', 'warning'],
  failed: ['Fehlgeschlagen', 'error'],
  blocked: ['Gesperrt', 'default'],
}

/** Nach außen ist „verpasst“ falsch: dort hat niemand abgenommen, verpasst hat es keiner von uns */
function status(c: CallRecord): [string, 'success' | 'error' | 'warning' | 'default'] {
  if (c.direction === 'out' && c.status === 'missed') return ['Nicht erreicht', 'default']
  return STATUS[c.status]
}

function icon(c: CallRecord) {
  if (c.status === 'blocked') return <BlockIcon color="disabled" fontSize="small" />
  if (c.direction === 'out' && c.status !== 'answered') return <CallMadeIcon color="disabled" fontSize="small" />
  if (c.status !== 'answered') return <CallMissedIcon color="error" fontSize="small" />
  if (c.direction === 'in') return <CallReceivedIcon color="primary" fontSize="small" />
  if (c.direction === 'out') return <CallMadeIcon color="primary" fontSize="small" />
  return <PhoneInTalkIcon fontSize="small" />
}

/** Gleiche Nummer? (Sperrliste speichert die Nummer so, wie sie gewählt bzw. angezeigt wurde) */
const digits = (n: string): string => n.replace(/[^\d+]/g, '')

const HOW: Record<GroupMissed['done_how'], string> = { '': '', callback: 'zurückgerufen', answered: 'wieder angerufen', manual: 'abgehakt' }

/** Verpasste Gruppenanrufe: wer kümmert sich, was ist erledigt */
function GroupMissedList() {
  const { config, toast } = usePbx()
  const [list, setList] = useState<GroupMissed[] | null>(null)
  const name = (n: string): string => config.extensions.find((e) => e.number === n)?.name ?? n
  useEffect(() => {
    const load = (): void => void api.get<GroupMissed[]>('/api/missed').then(setList)
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])
  const act = (m: GroupMissed, action: 'done' | 'reopen'): void =>
    void api
      .put<GroupMissed[]>(`/api/missed/${m.group}/${encodeURIComponent(m.id)}`, { action })
      .then(setList)
      .catch((e: Error) => toast(e.message, 'error'))
  return (
    <Card>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Zeit</TableCell>
              <TableCell>Gruppe</TableCell>
              <TableCell>Anrufer</TableCell>
              <TableCell>Kümmert sich</TableCell>
              <TableCell>Stand</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {list?.map((m) => (
              <TableRow key={`${m.group}-${m.id}`} sx={{ opacity: m.done_by ? 0.6 : 1 }}>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{new Date(m.time).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</TableCell>
                <TableCell>{m.group_name}</TableCell>
                <TableCell>
                  {m.name || m.number || 'unbekannt'}
                  {m.name && (
                    <Box component="span" sx={{ color: 'text.secondary', ml: 1 }}>
                      {m.number}
                    </Box>
                  )}
                </TableCell>
                <TableCell>{m.claimed_by ? `${m.claimed_by} ${name(m.claimed_by)}` : '–'}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  {m.done_by ? (
                    <>
                      <Chip size="small" color="success" variant="outlined" label={`${HOW[m.done_how]} (${m.done_by === 'Verwaltung' ? 'Verwaltung' : name(m.done_by)})`} />
                      <Tooltip title="Wieder öffnen">
                        <IconButton size="small" sx={{ ml: 0.5 }} onClick={() => act(m, 'reopen')}>
                          <UndoIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </>
                  ) : (
                    <Button size="small" startIcon={<CheckIcon />} onClick={() => act(m, 'done')}>
                      Erledigt
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {list && !list.length && <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>Keine verpassten Gruppenanrufe in den letzten Tagen.</Box>}
    </Card>
  )
}

interface CallSummary {
  id: string
  time: number
  extension: string
  direction: 'in' | 'out' | 'internal'
  other: string
  other_name: string
  duration: number
  transcript: string
  summary: string
  error: string
}

/** KI-Zusammenfassungen aufgezeichneter Gespräche */
function SummaryList() {
  const { config, toast } = usePbx()
  const [list, setList] = useState<CallSummary[] | null>(null)
  const [open, setOpen] = useState('')
  const [remove, setRemove] = useState<CallSummary | null>(null)
  const name = (n: string): string => config.extensions.find((e) => e.number === n)?.name ?? n
  const load = (): void => void api.get<CallSummary[]>('/api/summaries').then(setList)
  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [])
  return (
    <Stack sx={{ gap: 1.5 }}>
      {list?.map((s) => (
        <Card key={s.id} sx={{ p: 2 }}>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="subtitle2" sx={{ flex: 1 }}>
              {new Date(s.time).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} · {s.extension} {name(s.extension)} {s.direction === 'out' ? '→' : '←'} {s.other_name || s.other || 'unbekannt'}
              <Box component="span" sx={{ color: 'text.secondary', ml: 1 }}>
                {formatDuration(s.duration)}
              </Box>
            </Typography>
            {s.transcript && (
              <Button size="small" onClick={() => setOpen(open === s.id ? '' : s.id)}>
                {open === s.id ? 'Mitschrift ausblenden' : 'Mitschrift'}
              </Button>
            )}
            <Tooltip title="Löschen">
              <IconButton size="small" onClick={() => setRemove(s)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
          {s.error ? (
            <Typography variant="body2" sx={{ color: 'error.main', mt: 1 }}>
              {s.error}
            </Typography>
          ) : (
            <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>
              {s.summary}
            </Typography>
          )}
          {open === s.id && (
            <Typography variant="body2" sx={{ mt: 1.5, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, whiteSpace: 'pre-wrap', color: 'text.secondary' }}>
              {s.transcript}
            </Typography>
          )}
        </Card>
      ))}
      {list && !list.length && (
        <Card sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>Noch keine Zusammenfassungen. Sie entstehen nach aufgezeichneten Gesprächen von Nebenstellen mit „Gespräche zusammenfassen“.</Card>
      )}
      <ConfirmDialog
        open={Boolean(remove)}
        title="Zusammenfassung löschen?"
        text="Zusammenfassung und Mitschrift werden gelöscht. Die Aufnahme bleibt in der Anrufliste."
        confirm="Löschen"
        onClose={() => setRemove(null)}
        onConfirm={() => {
          const id = remove?.id ?? ''
          setRemove(null)
          void api
            .del(`/api/summaries/${encodeURIComponent(id)}`)
            .then(load)
            .catch((e: Error) => toast(e.message, 'error'))
        }}
      />
    </Stack>
  )
}

interface CallbackRequest {
  id: string
  kind: 'ccbs' | 'queue'
  from: string
  to: string
  name: string
  created: number
  expires: number
  attempts: number
}

/** Offene Rückrufe (bei besetzt und aus Warteschlangen) */
function CallbackList() {
  const { config, toast } = usePbx()
  const [list, setList] = useState<CallbackRequest[] | null>(null)
  const name = (n: string): string => config.extensions.find((e) => e.number === n)?.name ?? n
  const group = (id: string): string => config.groups.find((g) => g.id === id)?.name ?? '?'
  const load = (): void => void api.get<CallbackRequest[]>('/api/callbacks').then(setList)
  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [])
  const time = (t: number): string => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  return (
    <Card>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Seit</TableCell>
              <TableCell>Art</TableCell>
              <TableCell>Wer wird zurückgerufen</TableCell>
              <TableCell>Mit</TableCell>
              <TableCell>Versuche</TableCell>
              <TableCell>Gilt bis</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {list?.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{time(r.created)}</TableCell>
                <TableCell>{r.kind === 'ccbs' ? 'Bei besetzt' : 'Warteschlange'}</TableCell>
                <TableCell>{r.kind === 'ccbs' ? `${r.from} ${name(r.from)}` : `${r.name && r.name !== r.from ? `${r.name} ` : ''}${r.from}`}</TableCell>
                <TableCell>{r.kind === 'ccbs' ? `${r.to} ${name(r.to)}` : group(r.to)}</TableCell>
                <TableCell>{r.attempts} / 3</TableCell>
                <TableCell>{time(r.expires)}</TableCell>
                <TableCell sx={{ textAlign: 'right' }}>
                  <Tooltip title="Rückruf löschen">
                    <IconButton
                      size="small"
                      onClick={() =>
                        void api
                          .del(`/api/callbacks/${r.id}`)
                          .then(load)
                          .catch((e: Error) => toast(e.message, 'error'))
                      }
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {list && !list.length && <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>Keine offenen Rückrufe.</Box>}
    </Card>
  )
}

type CallsTab = 'all' | 'groups' | 'summaries' | 'callbacks'

export default function Calls() {
  const [tab, setTab] = useState<CallsTab>('all')
  const { config } = usePbx()
  const tabs: [CallsTab, string][] = [
    ['all', 'Alle Anrufe'],
    ...(config.groups.some((g) => g.missed_list && g.members.length) ? [['groups', 'Verpasst in Gruppen'] as [CallsTab, string]] : []),
    ...(config.extensions.some((e) => e.summary) ? [['summaries', 'Zusammenfassungen'] as [CallsTab, string]] : []),
    ...(config.callback.enabled ? [['callbacks', 'Offene Rückrufe'] as [CallsTab, string]] : []),
  ]
  const current = tabs.some(([t]) => t === tab) ? tab : 'all'
  return (
    <Box>
      <PageHeader overline="Auswertung und System" title="Anrufliste" description="Alle Gespräche der Anlage, neueste zuerst. Aufnahmen lassen sich hier anhören." />
      {tabs.length > 1 && (
        <Tabs value={current} onChange={(_e, v: CallsTab) => setTab(v)} variant="scrollable" sx={{ mb: 2 }}>
          {tabs.map(([t, label]) => (
            <Tab key={t} value={t} label={label} />
          ))}
        </Tabs>
      )}
      {current === 'groups' ? <GroupMissedList /> : current === 'summaries' ? <SummaryList /> : current === 'callbacks' ? <CallbackList /> : <AllCalls />}
    </Box>
  )
}

function AllCalls() {
  const { config, saveItem, toast } = usePbx()
  const [calls, setCalls] = useState<CallRecord[] | null>(null)
  const [block, setBlock] = useState<CallRecord | null>(null)
  const blocked = new Set(config.blocklist.map((b) => digits(b.number)))
  const canBlock = (c: CallRecord): boolean => c.direction === 'in' && /^\+?\d{3,}$/.test(digits(c.from)) && !config.extensions.some((e) => e.number === c.from)
  useEffect(() => {
    const load = (): void => void api.get<CallRecord[]>('/api/calls?limit=300').then(setCalls)
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])
  return (
    <Box>
      <Card>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell />
                <TableCell>Zeit</TableCell>
                <TableCell>Von</TableCell>
                <TableCell>An</TableCell>
                <TableCell>Angenommen</TableCell>
                <TableCell>Dauer</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {calls?.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Tooltip title={{ in: 'Eingehend', out: 'Ausgehend', internal: 'Intern' }[c.direction]}>{icon(c)}</Tooltip>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{new Date(c.start.replace(' ', 'T')).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</TableCell>
                  <TableCell>
                    {c.fromName ? (
                      <>
                        {c.fromName}
                        <Box component="span" sx={{ color: 'text.secondary', ml: 1 }}>
                          {c.from}
                        </Box>
                      </>
                    ) : (
                      c.from
                    )}
                  </TableCell>
                  <TableCell>{c.to || '–'}</TableCell>
                  <TableCell>{c.answeredBy}</TableCell>
                  <TableCell>{c.status === 'answered' ? formatDuration(c.duration) : ''}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Chip size="small" color={status(c)[1]} variant="outlined" label={status(c)[0]} />
                    {canBlock(c) && !blocked.has(digits(c.from)) && (
                      <Tooltip title="Nummer sperren">
                        <IconButton size="small" sx={{ ml: 0.5, my: -0.5 }} onClick={() => setBlock(c)}>
                          <BlockIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {c.recordings.map((r) => (
                      <audio key={r} controls preload="none" src={`/api/recordings/${r}`} style={{ height: 28, verticalAlign: 'middle', marginLeft: 8 }} />
                    ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {calls && !calls.length && <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>Noch keine Anrufe.</Box>}
      </Card>
      <ConfirmDialog
        open={Boolean(block)}
        title={`${block?.fromName || block?.from} sperren?`}
        text="Anrufe von dieser Nummer kommen danach nicht mehr durch. Die Sperre lässt sich unter Anrufsperren wieder aufheben."
        confirm="Sperren"
        onClose={() => setBlock(null)}
        onConfirm={() => {
          const c = block
          setBlock(null)
          if (!c) return
          void saveItem('blocklist', { id: '', number: digits(c.from), note: c.fromName, created: '', by: '' })
            .then(() => toast('Gesperrt'))
            .catch((e: Error) => toast(e.message, 'error'))
        }}
      />
    </Box>
  )
}
