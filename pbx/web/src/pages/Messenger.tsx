/** Messenger: Einstellungen und Überblick über die Chats der Apps (ohne Inhalte). */

import ChatIcon from '@mui/icons-material/Chat'
import DeleteIcon from '@mui/icons-material/Delete'
import ForumIcon from '@mui/icons-material/Forum'
import GroupsIcon from '@mui/icons-material/Groups'
import PersonIcon from '@mui/icons-material/Person'
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import type { MessengerSettings } from '../../../server/model'
import { api } from '../api'
import { bytes, ConfirmDialog, EmptyState, FormGrid, NumberField, PageHeader, Section } from '../components/common'
import { usePbx } from '../state'

interface Overview {
  online: string[]
  connections: number
  calls: number
  usage: number
  free: number | null
  users: number
  rooms: { id: string; kind: 'direct' | 'group'; name: string; members: string[]; messages: number; last: number }[]
}

function Settings() {
  const { config, saveSection, toast } = usePbx()
  const [draft, setDraft] = useState<MessengerSettings>(config.messenger)
  useEffect(() => setDraft(config.messenger), [config.messenger])
  const save = (values: Partial<MessengerSettings>): void =>
    void saveSection('messenger', values)
      .then(() => toast('Gespeichert'))
      .catch((e: Error) => toast(e.message, 'error'))
  return (
    <Section
      title="Einstellungen"
      icon={<ChatIcon />}
      description="Die Apps zeigen den Messenger als eigenen Bereich. Über App-Profile lässt er sich für einzelne Nebenstellen ausblenden."
    >
      <FormControlLabel
        control={<Switch checked={config.messenger.enabled} onChange={(e) => save({ enabled: e.target.checked })} />}
        label="Messenger einschalten"
        sx={{ mb: 2 }}
      />
      {config.messenger.enabled && (
        <>
          <FormControlLabel
            control={<Switch checked={config.messenger.video} onChange={(e) => save({ video: e.target.checked })} />}
            label="Videoanrufe in den Chats"
            sx={{ mb: 2, display: 'flex' }}
          />
          <FormGrid>
            <NumberField
              label="Größte Datei (MB)"
              value={draft.max_file_mb}
              min={1}
              onChange={(v) => setDraft({ ...draft, max_file_mb: v })}
              helperText="Bilder, Dokumente und andere Anhänge"
            />
            <NumberField
              label="Speicher für den Messenger (MB)"
              value={draft.max_storage_mb}
              min={100}
              onChange={(v) => setDraft({ ...draft, max_storage_mb: v })}
              helperText="Belegen Nachrichten und Anhänge mehr, werden die ältesten gelöscht"
            />
            <NumberField
              label="Notbremse: frei halten (MB)"
              value={draft.min_free_mb}
              min={100}
              onChange={(v) => setDraft({ ...draft, min_free_mb: v })}
              helperText="Ist die Platte voller, wird höchstens die Hälfte der Chats gelöscht"
            />
            <NumberField
              label="Speicher je Nebenstelle (MB)"
              value={draft.quota_mb}
              min={0}
              onChange={(v) => setDraft({ ...draft, quota_mb: v })}
              helperText="Für verschickte Anhänge, 0 = unbegrenzt"
            />
          </FormGrid>
          <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
            <Button variant="contained" onClick={() => save({ max_file_mb: draft.max_file_mb, max_storage_mb: draft.max_storage_mb, min_free_mb: draft.min_free_mb, quota_mb: draft.quota_mb })}>
              Speichern
            </Button>
          </Stack>
        </>
      )}
    </Section>
  )
}

export default function Messenger() {
  const { config, toast } = usePbx()
  const [data, setData] = useState<Overview | null>(null)
  const [remove, setRemove] = useState<Overview['rooms'][number] | null>(null)
  const load = useCallback(
    () =>
      void api
        .get<Overview>('/api/messenger')
        .then(setData)
        .catch((e: Error) => toast(e.message, 'error')),
    [toast],
  )
  useEffect(() => {
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [load])
  const name = (n: string): string => config.extensions.find((e) => e.number === n)?.name || n
  const rooms = [...(data?.rooms ?? [])].sort((a, b) => b.last - a.last)

  return (
    <>
      <PageHeader
        overline="Zusammenarbeit"
        title="Messenger"
        description="Einzel- und Gruppenchats mit Videoanrufen zwischen den Nebenstellen in der Desktop-App. Nachrichten bleiben auf der Anlage gespeichert, bis das eingestellte Kontingent voll ist."
      />
      <Settings />
      {data && (
        <Section title="Überblick">
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(5, 1fr)' } }}>
            {[
              ['Nebenstellen mit Messenger', String(data.users)],
              ['Gerade verbunden', `${data.online.length} (${data.connections} ${data.connections === 1 ? 'Gerät' : 'Geräte'})`],
              ['Laufende Videoanrufe', String(data.calls)],
              ['Belegt', bytes(data.usage)],
              ['Frei auf der Anlage', data.free === null ? '–' : bytes(data.free)],
            ].map(([l, v]) => (
              <Box key={l}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {l}
                </Typography>
                <Typography variant="h6">{v}</Typography>
              </Box>
            ))}
          </Box>
          {data.online.length > 0 && (
            <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', mt: 2 }}>
              {data.online.map((n) => (
                <Chip key={n} size="small" color="success" variant="outlined" label={`${n} · ${name(n)}`} />
              ))}
            </Stack>
          )}
          {data.usage > config.messenger.max_storage_mb * 1024 * 1024 * 0.9 && (
            <Alert severity="info" sx={{ mt: 2 }}>
              Der Messenger hat sein Kontingent fast ausgeschöpft. Darüber löscht die Anlage die ältesten Nachrichten und Anhänge.
            </Alert>
          )}
          {data.free !== null && data.free < config.messenger.min_free_mb * 1024 * 1024 && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              Die Platte ist fast voll. Die Anlage löscht höchstens die Hälfte der Chats – bitte unter System → Speicher aufräumen.
            </Alert>
          )}
        </Section>
      )}
      {data && !rooms.length && (
        <EmptyState icon={<ForumIcon />} title="Noch keine Unterhaltungen" text="Sobald jemand in der App einen Chat beginnt, erscheint er hier." />
      )}
      {rooms.length > 0 && (
        <Section title="Unterhaltungen" description="Inhalte der Chats sind hier nicht einsehbar. Löschen entfernt die Unterhaltung mit allen Nachrichten und Anhängen.">
          <List disablePadding>
            {rooms.map((r) => (
              <ListItem
                key={r.id}
                divider
                secondaryAction={
                  <Tooltip title="Unterhaltung löschen">
                    <IconButton edge="end" onClick={() => setRemove(r)}>
                      <DeleteIcon />
                    </IconButton>
                  </Tooltip>
                }
              >
                <ListItemIcon>{r.kind === 'group' ? <GroupsIcon /> : <PersonIcon />}</ListItemIcon>
                <ListItemText
                  primary={r.name}
                  secondary={`${r.kind === 'group' ? `${r.members.length} Mitglieder · ` : ''}${r.messages} Nachrichten · zuletzt ${new Date(r.last).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`}
                />
              </ListItem>
            ))}
          </List>
        </Section>
      )}
      <ConfirmDialog
        open={Boolean(remove)}
        title="Unterhaltung löschen?"
        text={`„${remove?.name ?? ''}“ wird mit allen Nachrichten und Anhängen gelöscht. Das lässt sich nicht rückgängig machen.`}
        confirm="Löschen"
        onClose={() => setRemove(null)}
        onConfirm={() => {
          const r = remove
          setRemove(null)
          if (r)
            void api
              .del(`/api/messenger/rooms/${r.id}`)
              .then(() => {
                toast('Gelöscht')
                load()
              })
              .catch((e: Error) => toast(e.message, 'error'))
        }}
      />
    </>
  )
}
