import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import { Alert, Box, Button, IconButton, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import type { AiAgent } from '../../../server/model'
import { api } from '../api'
import { ChipsInput, CollectionPage, DestinationPicker, FormGrid, FormHeading, Full, NumberField, NumberPicker, Select, describeDestination, internalNumberOptions } from '../components/common'
import { go } from '../router'
import { usePbx } from '../state'

interface TtsInfo {
  voices: string[]
  all: { id: string; name: string }[]
}

function AgentForm({ value, onChange }: { value: AiAgent; onChange: (v: AiAgent) => void }) {
  const { config } = usePbx()
  const set = <K extends keyof AiAgent>(k: K, v: AiAgent[K]): void => onChange({ ...value, [k]: v })
  const [tts, setTts] = useState<TtsInfo | null>(null)
  useEffect(() => void api.get<TtsInfo>('/api/tts').then(setTts).catch(() => undefined), [])
  const voices = (tts?.all ?? []).filter((v) => tts?.voices.includes(v.id))
  const setTarget = (i: number, t: AiAgent['targets'][number]): void => set('targets', value.targets.map((x, j) => (j === i ? t : x)))
  return (
    <FormGrid>
      <TextField label="Name" value={value.name} onChange={(e) => set('name', e.target.value)} required autoFocus helperText="z. B. Empfang" />
      <TextField label="Interne Nummer (optional)" value={value.number} onChange={(e) => set('number', e.target.value.replace(/\D/g, ''))} helperText="Zum Ausprobieren von einem Telefon aus" />
      <Full>
        <TextField label="Begrüßung" value={value.greeting} onChange={(e) => set('greeting', e.target.value)} fullWidth multiline minRows={2} />
      </Full>
      <Full>
        <TextField
          label="Wissen und Anweisungen"
          value={value.instructions}
          onChange={(e) => set('instructions', e.target.value)}
          fullWidth
          multiline
          minRows={5}
          helperText="Was der Assistent wissen und tun soll: Öffnungszeiten, Leistungen, häufige Fragen, wann er verbindet und wann er einen Rückruf notiert."
        />
      </Full>
      <Select
        label="Stimme"
        value={value.voice}
        onChange={(v) => set('voice', v)}
        options={[['', 'Erste geladene Stimme'], ...voices.map((v) => [v.id, v.name] as [string, string])]}
        helperText={voices.length ? undefined : 'Noch keine Stimme geladen (Ansagen und Musik → Sprachausgabe)'}
      />
      <NumberField label="Höchstdauer (Sekunden)" value={value.max_seconds} onChange={(v) => set('max_seconds', v)} min={30} helperText="Danach geht der Anruf an das Ausweichziel" />
      <Full>
        <FormHeading hint="Der Assistent nennt diese Ziele dem Anrufer und verbindet auf Wunsch. Andere Nummern wählt er nie.">Darf verbinden mit</FormHeading>
        <Stack spacing={1.5}>
          {value.targets.map((t, i) => (
            <Stack key={i} direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1.5, alignItems: { sm: 'center' } }}>
              <TextField label="Bezeichnung" value={t.name} onChange={(e) => setTarget(i, { ...t, name: e.target.value })} sx={{ flex: 1 }} placeholder="z. B. Buchhaltung, Herr Müller" />
              <Box sx={{ flex: 1 }}>
                <NumberPicker label="Nummer" value={t.number} onChange={(n) => setTarget(i, { ...t, number: n })} options={internalNumberOptions(config)} />
              </Box>
              <IconButton onClick={() => set('targets', value.targets.filter((_x, j) => j !== i))} aria-label="Entfernen">
                <DeleteIcon />
              </IconButton>
            </Stack>
          ))}
          <Button startIcon={<AddIcon />} onClick={() => set('targets', [...value.targets, { name: '', number: '' }])} sx={{ alignSelf: 'flex-start' }}>
            Ziel hinzufügen
          </Button>
        </Stack>
      </Full>
      <Full>
        <FormHeading hint="Möchte der Anrufer einen Rückruf oder eine Nachricht hinterlassen, schickt der Assistent eine Notiz mit Name, Nummer und Anliegen.">Rückrufnotizen</FormHeading>
      </Full>
      <ChipsInput
        label="Messenger-Nachricht an"
        value={value.notify_exts}
        onChange={(v) => set('notify_exts', v.map((x) => x.replace(/\s.*$/, '')))}
        options={config.extensions.map((e) => e.number)}
        helperText="Nebenstellen mit Messenger"
      />
      <TextField label="E-Mail an" value={value.notify_email} onChange={(e) => set('notify_email', e.target.value)} helperText="Mehrere Adressen mit Komma trennen" />
      <Full>
        <DestinationPicker label="Wenn der Assistent nicht weiterkommt" value={value.fallback} onChange={(d) => set('fallback', d)} exclude={['ai']} />
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
          Auch wenn das Sprachmodell, die Spracherkennung oder die Sprachausgabe nicht verfügbar sind, geht der Anruf sofort dorthin.
        </Typography>
      </Full>
    </FormGrid>
  )
}

export default function AiAgents() {
  const { config } = usePbx()
  const ready = Boolean(config.ai.url && config.ai.model)
  return (
    <CollectionPage<AiAgent>
      kind="aiagents"
      overline="Eingehende Anrufe"
      title="KI-Telefonassistent"
      singular="Assistent"
      description="Ein Sprachassistent nimmt Anrufe an, versteht das Anliegen, beantwortet einfache Fragen, verbindet mit der richtigen Person oder notiert einen Rückruf. In einer Rufabfolge als Ziel „KI-Telefonassistent“ wählen."
      emptyIcon={<SmartToyIcon />}
      emptyText="Noch kein Assistent eingerichtet."
      before={
        !ready ? (
          <Alert severity="info" sx={{ mb: 2 }} action={<Button onClick={() => go('system', 'funktionen')}>Einrichten</Button>}>
            Zuerst unter System → Funktionen ein Sprachmodell eintragen (z. B. Ollama auf einem eigenen Rechner oder ein Anbieter mit OpenAI-kompatibler Schnittstelle). Außerdem braucht es die Sprachausgabe und die Spracherkennung (Voicemail als Text).
          </Alert>
        ) : undefined
      }
      columns={[
        { label: 'Name', render: (a) => <b>{a.name}</b> },
        { label: 'Intern', render: (a) => a.number || '–', hideOnMobile: true },
        { label: 'Verbindet mit', render: (a) => a.targets.map((t) => t.name || t.number).join(', ') || '–' },
        { label: 'Ausweichziel', render: (a) => describeDestination(a.fallback, config), hideOnMobile: true },
      ]}
      Form={AgentForm}
    />
  )
}
