/** Anrufabläufe: eingehende Rufnummern, Zeitsteuerungen, Sprachmenüs, Ansagen. */

import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import MicIcon from '@mui/icons-material/Mic'
import StopIcon from '@mui/icons-material/Stop'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import {
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { type Announcement, HANGUP, type InboundRoute, type Ivr, type TimeCondition } from '../../../server/model'
import { api } from '../api'
import { startRecording, toTelephoneWav } from '../components/audio'
import { ChipsInput, CollectionPage, DestinationPicker, FormGrid, Full, NumberField, Select, describeDestination } from '../components/common'
import { usePbx } from '../state'

const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

function InboundForm({ value, onChange }: { value: InboundRoute; onChange: (v: InboundRoute) => void }) {
  const { config } = usePbx()
  const set = <K extends keyof InboundRoute>(k: K, v: InboundRoute[K]): void => onChange({ ...value, [k]: v })
  const numbers = config.trunks.flatMap((t) => t.numbers)
  return (
    <FormGrid>
      <TextField label="Name" value={value.name} onChange={(e) => set('name', e.target.value)} required autoFocus />
      <TextField
        label="Angerufene Rufnummer"
        value={value.number}
        onChange={(e) => set('number', e.target.value)}
        helperText={numbers.length ? `Leer = alle. Eigene: ${numbers.join(', ')}` : 'Leer = alle Nummern'}
      />
      <Select
        label="Über SIP-Konto"
        value={value.trunk}
        onChange={(v) => set('trunk', v)}
        options={[['', 'Alle Konten'], ...config.trunks.map((t): [string, string] => [t.id, t.name])]}
      />
      <TextField label="Nur für Anrufer, deren Nummer beginnt mit" value={value.caller} onChange={(e) => set('caller', e.target.value)} helperText="Optional, z. B. für VIP-Kunden oder Sperren" />
      <TextField label="Vor den Anrufernamen setzen" value={value.name_prefix} onChange={(e) => set('name_prefix', e.target.value)} helperText="z. B. „Service: “" />
      <Full>
        <DestinationPicker label="Anruf geht zu" value={value.destination} onChange={(d) => set('destination', d)} />
      </Full>
    </FormGrid>
  )
}

function TimeForm({ value, onChange }: { value: TimeCondition; onChange: (v: TimeCondition) => void }) {
  const { config, states } = usePbx()
  const set = <K extends keyof TimeCondition>(k: K, v: TimeCondition[K]): void => onChange({ ...value, [k]: v })
  const setRule = (i: number, rule: TimeCondition['rules'][number]): void =>
    set('rules', value.rules.map((r, j) => (j === i ? rule : r)))
  return (
    <Box>
      <FormGrid>
        <TextField label="Name" value={value.name} onChange={(e) => set('name', e.target.value)} required autoFocus />
        <Select
          label="Schaltung"
          value={value.override}
          onChange={(v) => set('override', v)}
          options={[
            ['auto', 'Automatisch nach Zeitplan'],
            ['open', 'Immer geöffnet'],
            ['closed', 'Immer geschlossen'],
          ]}
          helperText={`Am Telefon umschalten: *28${config.timeconditions.findIndex((t) => t.id === value.id) + 1 || ''}`}
        />
      </FormGrid>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Öffnungszeiten
      </Typography>
      {value.rules.map((r, i) => (
        <Stack key={i} direction={{ xs: 'column', md: 'row' }} sx={{ gap: 1.5, mb: 1.5, alignItems: { md: 'center' } }}>
          <ToggleButtonGroup
            size="small"
            value={r.days}
            onChange={(_e, days: number[]) => setRule(i, { ...r, days: days.sort() })}
          >
            {DAYS.map((d, j) => (
              <ToggleButton key={d} value={j + 1} sx={{ px: 1.25 }}>
                {d}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <TextField type="time" size="small" label="von" value={r.from} onChange={(e) => setRule(i, { ...r, from: e.target.value })} sx={{ width: 130 }} />
          <TextField type="time" size="small" label="bis" value={r.to} onChange={(e) => setRule(i, { ...r, to: e.target.value })} sx={{ width: 130 }} />
          <IconButton aria-label="Zeile entfernen" onClick={() => set('rules', value.rules.filter((_x, j) => j !== i))}>
            <DeleteOutlineIcon />
          </IconButton>
        </Stack>
      ))}
      <Button startIcon={<AddIcon />} onClick={() => set('rules', [...value.rules, { days: [1, 2, 3, 4, 5], from: '13:00', to: '17:00' }])} sx={{ mb: 2 }}>
        Zeitraum hinzufügen
      </Button>
      <FormGrid>
        <Full>
          <FormControlLabel
            control={<Checkbox checked={value.holidays} onChange={(e) => set('holidays', e.target.checked)} />}
            label={`An gesetzlichen Feiertagen geschlossen (${states[config.system.state] ?? config.system.state})`}
          />
        </Full>
        <Full>
          <ChipsInput label="Zusätzlich geschlossen" value={value.closed_dates} onChange={(v) => set('closed_dates', v)} helperText="Datum JJJJ-MM-TT oder Zeitraum 2026-12-24..2026-12-31" />
        </Full>
        <Full>
          <DestinationPicker label="Geöffnet: weiter zu" value={value.open} onChange={(d) => set('open', d)} exclude={['timecondition']} />
        </Full>
        <Full>
          <DestinationPicker label="Geschlossen: weiter zu" value={value.closed} onChange={(d) => set('closed', d)} exclude={['timecondition']} />
        </Full>
      </FormGrid>
    </Box>
  )
}

function IvrForm({ value, onChange }: { value: Ivr; onChange: (v: Ivr) => void }) {
  const { config } = usePbx()
  const set = <K extends keyof Ivr>(k: K, v: Ivr[K]): void => onChange({ ...value, [k]: v })
  const used = new Set(value.options.map((o) => o.digit))
  const free = '1234567890*#'.split('').find((d) => !used.has(d))
  return (
    <Box>
      <FormGrid>
        <TextField label="Name" value={value.name} onChange={(e) => set('name', e.target.value)} required autoFocus />
        <TextField label="Interne Rufnummer zum Testen" value={value.number} onChange={(e) => set('number', e.target.value.replace(/\D/g, ''))} helperText="Optional" />
        <Full>
          <Select
            label="Ansage"
            value={value.announcement}
            onChange={(v) => set('announcement', v)}
            options={[['', 'Keine'], ...config.announcements.map((a): [string, string] => [a.id, a.name])]}
            helperText="Z. B. „Für den Vertrieb drücken Sie die 1, für den Service die 2.“ – unter „Ansagen“ hochladen oder aufnehmen"
          />
        </Full>
      </FormGrid>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Tasten
      </Typography>
      {value.options.map((o, i) => (
        <Stack key={i} direction="row" sx={{ gap: 1.5, mb: 1.5, alignItems: 'center' }}>
          <TextField
            label="Taste"
            value={o.digit}
            onChange={(e) => set('options', value.options.map((x, j) => (j === i ? { ...x, digit: e.target.value.slice(-1) } : x)))}
            sx={{ width: 80, flexShrink: 0 }}
          />
          <DestinationPicker
            label="Ziel"
            value={o.destination}
            onChange={(d) => set('options', value.options.map((x, j) => (j === i ? { ...x, destination: d } : x)))}
          />
          <IconButton aria-label="Taste entfernen" onClick={() => set('options', value.options.filter((_x, j) => j !== i))}>
            <DeleteOutlineIcon />
          </IconButton>
        </Stack>
      ))}
      <Button startIcon={<AddIcon />} disabled={!free} onClick={() => set('options', [...value.options, { digit: free!, destination: HANGUP }])} sx={{ mb: 2 }}>
        Taste hinzufügen
      </Button>
      <FormGrid>
        <NumberField label="Warten auf Eingabe (Sekunden)" value={value.timeout} onChange={(v) => set('timeout', v)} min={1} />
        <NumberField label="Ansage höchstens abspielen (mal)" value={value.repeats} onChange={(v) => set('repeats', v)} min={1} />
        <Full>
          <DestinationPicker label="Keine Eingabe: weiter zu" value={value.timeout_destination} onChange={(d) => set('timeout_destination', d)} />
        </Full>
        <Full>
          <DestinationPicker label="Falsche Taste: weiter zu" value={value.invalid_destination} onChange={(d) => set('invalid_destination', d)} />
        </Full>
        <Full>
          <FormControlLabel control={<Switch checked={value.direct_dial} onChange={(e) => set('direct_dial', e.target.checked)} />} label="Anrufer dürfen Nebenstellen direkt wählen" />
        </Full>
      </FormGrid>
    </Box>
  )
}

function AnnouncementForm({ value, onChange }: { value: Announcement; onChange: (v: Announcement) => void }) {
  const { toast } = usePbx()
  const set = <K extends keyof Announcement>(k: K, v: Announcement[K]): void => onChange({ ...value, [k]: v })
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState<{ stop: () => Promise<ArrayBuffer> } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [version, setVersion] = useState(0)

  const upload = async (data: ArrayBuffer, name: string): Promise<void> => {
    setBusy(true)
    try {
      const wav = await toTelephoneWav(data)
      const r = await api.post<{ name: string }>(`/api/sounds/custom?name=${encodeURIComponent(value.name || name)}`, wav)
      onChange({ ...value, file: r.name, name: value.name || name.replace(/\.[^.]+$/, '') })
      setVersion((v) => v + 1)
    } catch (e) {
      toast(`Die Datei ließ sich nicht umwandeln: ${(e as Error).message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box>
      <FormGrid>
        <TextField label="Name" value={value.name} onChange={(e) => set('name', e.target.value)} required autoFocus />
        <Box />
        <Full>
          <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void f.arrayBuffer().then((b) => upload(b, f.name))
                e.target.value = ''
              }}
            />
            <Button variant="outlined" startIcon={<UploadFileIcon />} disabled={busy || Boolean(recording)} onClick={() => fileRef.current?.click()}>
              Audiodatei wählen
            </Button>
            {recording ? (
              <Button
                variant="contained"
                color="error"
                startIcon={<StopIcon />}
                onClick={() => {
                  const r = recording
                  setRecording(null)
                  void r.stop().then((b) => upload(b, 'aufnahme'))
                }}
              >
                Aufnahme beenden
              </Button>
            ) : (
              <Button
                variant="outlined"
                startIcon={<MicIcon />}
                disabled={busy}
                onClick={() => {
                  startRecording()
                    .then(setRecording)
                    .catch((e: Error) => toast(`Kein Mikrofon: ${e.message}`, 'error'))
                }}
              >
                Mit Mikrofon aufnehmen
              </Button>
            )}
            {value.file && <audio key={version} controls src={`/api/sounds/custom/${value.file}.wav?v=${version}`} style={{ height: 36 }} />}
          </Stack>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
            MP3, WAV, OGG, M4A … werden im Browser in Telefonqualität umgewandelt.
          </Typography>
        </Full>
        <Full>
          <DestinationPicker label="Danach (wenn direkt als Ziel genutzt)" value={value.next} onChange={(d) => set('next', d)} />
        </Full>
      </FormGrid>
    </Box>
  )
}

function MohCard() {
  const { toast } = usePbx()
  const [files, setFiles] = useState<{ name: string; size: number }[]>([])
  const ref = useRef<HTMLInputElement>(null)
  const load = (): void => void api.get<{ moh: { name: string; size: number }[] }>('/api/sounds').then((s) => setFiles(s.moh))
  useEffect(load, [])
  return (
    <Box sx={{ mt: 3 }}>
      <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>
          Wartemusik
        </Typography>
        <input
          ref={ref}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            void f
              .arrayBuffer()
              .then(toTelephoneWav)
              .then((wav) => api.post(`/api/sounds/moh?name=${encodeURIComponent(f.name)}`, wav))
              .then(() => {
                toast('Wartemusik hinzugefügt')
                load()
              })
              .catch((err: Error) => toast(err.message, 'error'))
          }}
        />
        <Button startIcon={<AddIcon />} onClick={() => ref.current?.click()}>
          Musik hinzufügen
        </Button>
      </Stack>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
        Läuft beim Halten und in Warteschlangen. Nur GEMA-freie oder lizenzierte Musik verwenden.
      </Typography>
      <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
        {files.map((f) => (
          <Chip
            key={f.name}
            label={f.name}
            onDelete={() => void api.del(`/api/sounds/moh/${f.name}`).then(load)}
          />
        ))}
      </Stack>
    </Box>
  )
}

export default function Flows() {
  const { config } = usePbx()
  const [tab, setTab] = useState(0)
  return (
    <Box>
      <Tabs value={tab} onChange={(_e, v: number) => setTab(v)} variant="scrollable" sx={{ mb: 2 }}>
        <Tab label="Rufnummern" />
        <Tab label="Zeitsteuerung" />
        <Tab label="Sprachmenüs" />
        <Tab label="Ansagen" />
      </Tabs>
      {tab === 0 && (
        <CollectionPage<InboundRoute>
          kind="inbound"
          title="Eingehende Rufnummern"
          singular="Regel"
          description="Wohin Anrufe auf die eigenen Rufnummern gehen – direkt zu einer Person, in eine Gruppe, ein Sprachmenü oder erst durch die Zeitsteuerung. Bekannte Anrufer aus dem Telefonbuch werden mit Namen angezeigt."
          emptyText="Noch keine Regeln – Anrufe gehen zum Standardziel des SIP-Kontos."
          columns={[
            { label: 'Name', render: (r) => <b>{r.name}</b> },
            { label: 'Rufnummer', render: (r) => r.number || 'alle' },
            { label: 'Konto', hideOnMobile: true, render: (r) => config.trunks.find((t) => t.id === r.trunk)?.name ?? 'alle' },
            { label: 'Ziel', render: (r) => describeDestination(r.destination, config) },
          ]}
          Form={InboundForm}
        />
      )}
      {tab === 1 && (
        <CollectionPage<TimeCondition>
          kind="timeconditions"
          title="Zeitsteuerung"
          singular="Zeitsteuerung"
          description="Öffnungszeiten mit gesetzlichen Feiertagen des Bundeslandes und Betriebsferien. Mit *28 und der Nummer der Zeitsteuerung schaltet man am Telefon manuell um (z. B. Nachtschaltung)."
          columns={[
            { label: 'Nr.', render: (t) => `*28${config.timeconditions.indexOf(t) + 1}` },
            { label: 'Name', render: (t) => <b>{t.name}</b> },
            { label: 'Zeiten', hideOnMobile: true, render: (t) => t.rules.map((r) => `${r.days.map((d) => DAYS[d - 1]).join(',')} ${r.from}–${r.to}`).join('; ') },
            { label: 'Schaltung', render: (t) => (t.override === 'auto' ? 'Automatisch' : t.override === 'open' ? <Chip size="small" color="success" label="Geöffnet" /> : <Chip size="small" color="warning" label="Geschlossen" />) },
          ]}
          Form={TimeForm}
        />
      )}
      {tab === 2 && (
        <CollectionPage<Ivr>
          kind="ivrs"
          title="Sprachmenüs"
          singular="Sprachmenü"
          description="„Für den Vertrieb drücken Sie die 1 …“ – Anrufer wählen per Taste ihr Ziel."
          columns={[
            { label: 'Name', render: (i) => <b>{i.name}</b> },
            { label: 'Nr.', hideOnMobile: true, render: (i) => i.number || '–' },
            { label: 'Tasten', render: (i) => i.options.map((o) => `${o.digit}: ${describeDestination(o.destination, config)}`).join(' · ') },
          ]}
          Form={IvrForm}
        />
      )}
      {tab === 3 && (
        <>
          <CollectionPage<Announcement>
            kind="announcements"
            title="Ansagen"
            singular="Ansage"
            description="Begrüßungen, Menüansagen und Hinweise (z. B. Betriebsferien). Hochladen oder direkt im Browser aufnehmen."
            columns={[
              { label: 'Name', render: (a) => <b>{a.name}</b> },
              { label: 'Datei', render: (a) => (a.file ? <audio controls preload="none" src={`/api/sounds/custom/${a.file}.wav`} style={{ height: 32 }} onClick={(e) => e.stopPropagation()} /> : 'fehlt') },
              { label: 'Danach', hideOnMobile: true, render: (a) => describeDestination(a.next, config) },
            ]}
            Form={AnnouncementForm}
          />
          <MohCard />
        </>
      )}
    </Box>
  )
}
