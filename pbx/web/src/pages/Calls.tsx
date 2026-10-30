import BlockIcon from '@mui/icons-material/Block'
import CallMadeIcon from '@mui/icons-material/CallMade'
import CallMissedIcon from '@mui/icons-material/CallMissed'
import CallReceivedIcon from '@mui/icons-material/CallReceived'
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk'
import CheckIcon from '@mui/icons-material/Check'
import UndoIcon from '@mui/icons-material/Undo'
import { Box, Button, Card, Chip, IconButton, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, Tooltip } from '@mui/material'
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

function icon(c: CallRecord) {
  if (c.status === 'blocked') return <BlockIcon color="disabled" fontSize="small" />
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

export default function Calls() {
  const [tab, setTab] = useState<'all' | 'groups'>('all')
  const { config } = usePbx()
  const lists = config.groups.some((g) => g.missed_list && g.members.length)
  return (
    <Box>
      <PageHeader overline="Auswertung" title="Anrufliste" description="Alle Gespräche der Anlage, neueste zuerst. Aufnahmen lassen sich hier anhören." />
      {lists && (
        <Tabs value={tab} onChange={(_e, v: 'all' | 'groups') => setTab(v)} sx={{ mb: 2 }}>
          <Tab value="all" label="Alle Anrufe" />
          <Tab value="groups" label="Verpasst in Gruppen" />
        </Tabs>
      )}
      {tab === 'groups' && lists ? <GroupMissedList /> : <AllCalls />}
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
                  <TableCell>{c.to}</TableCell>
                  <TableCell>{c.answeredBy}</TableCell>
                  <TableCell>{c.status === 'answered' ? formatDuration(c.duration) : ''}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Chip size="small" color={STATUS[c.status][1]} variant="outlined" label={STATUS[c.status][0]} />
                    {canBlock(c) && !blocked.has(digits(c.from)) && (
                      <Tooltip title="Nummer sperren">
                        <IconButton size="small" sx={{ ml: 0.5 }} onClick={() => setBlock(c)}>
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
