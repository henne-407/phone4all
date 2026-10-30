/**
 * Einstellungen unter System: Klingelton je Herkunft, Mithören, Rückruf bei besetzt und KI
 * (Tab Funktionen) sowie Messwerte/Syslog, Wallboard und SMS (Tab Schnittstellen).
 */

import { Alert, Button, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import type { AiSettings, CallbackSettings, MonitoringSettings, RingSettings, SmsSettings, SpySettings, WallboardSettings } from '../../../server/model'
import { api } from '../api'
import { ChangesBar, ConfirmDialog, FormGrid, Full, NumberField, Section, Select, useDraft } from '../components/common'
import { usePbx } from '../state'

function useCopy(): (text: string) => void {
  const { toast } = usePbx()
  return (text) =>
    void navigator.clipboard
      .writeText(text)
      .then(() => toast('Kopiert'))
      .catch(() => toast('Kopieren nicht möglich', 'error'))
}

/** Feld mit geheimer Adresse oder Schlüssel: kopieren und neu erzeugen */
function SecretField({ label, value, section, helperText, warning }: { label: string; value: string; section: 'monitoring' | 'wallboard' | 'sms'; helperText?: string; warning: string }) {
  const { reload, toast } = usePbx()
  const copy = useCopy()
  const [confirm, setConfirm] = useState(false)
  const renew = (): void =>
    void api
      .post(`/api/${section}/token`)
      .then(reload)
      .then(() => toast('Neuer Schlüssel erzeugt'))
      .catch((e: Error) => toast(e.message, 'error'))
  return (
    <Stack sx={{ gap: 1 }}>
      <TextField
        label={label}
        value={value || 'Wird beim Speichern erzeugt'}
        helperText={helperText}
        slotProps={{ input: { readOnly: true, sx: { fontFamily: 'monospace' } } }}
        onFocus={(e) => e.target.select()}
        fullWidth
      />
      {value && (
        <Stack direction="row" sx={{ gap: 1 }}>
          <Button variant="outlined" onClick={() => copy(value)}>
            Kopieren
          </Button>
          <Button onClick={() => setConfirm(true)}>Neu erzeugen</Button>
        </Stack>
      )}
      <ConfirmDialog
        open={confirm}
        title="Neuen Schlüssel erzeugen?"
        text={warning}
        confirm="Erzeugen"
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false)
          renew()
        }}
      />
    </Stack>
  )
}

// -- Tab Funktionen ---------------------------------------------------------------------

export function CallFeatures() {
  const { config, saveSection } = usePbx()
  const ring = useDraft<RingSettings>(config.ring)
  const spy = useDraft<SpySettings>(config.spy)
  const cb = useDraft<CallbackSettings>(config.callback)
  return (
    <>
      <Section
        title="Rückruf bei besetzt und statt Warteschleife"
        description="Ist ein Kollege besetzt, nach dem Besetztzeichen *37 wählen (oder in der App „Rückruf, wenn frei“): Sobald beide frei sind, klingelt zuerst das eigene Telefon, dann wird verbunden. In Warteschlangen können Anrufer mit der Taste 1 einen Rückruf wählen, statt zu warten (pro Gruppe einschalten)."
      >
        <FormGrid>
          <FormControlLabel control={<Switch checked={cb.draft.enabled} onChange={(e) => cb.set({ enabled: e.target.checked })} />} label="Rückrufe einschalten" />
          {cb.draft.enabled && (
            <NumberField label="Rückruf gilt (Minuten)" value={cb.draft.minutes} onChange={(v) => cb.set({ minutes: v })} min={1} helperText="Danach verfällt der Wunsch; *37 0 löscht alle eigenen" />
          )}
        </FormGrid>
      </Section>
      <ChangesBar dirty={cb.dirty} onApply={() => saveSection('callback', cb.draft)} onDiscard={cb.reset} text="Rückrufe: ungespeicherte Änderungen" />
      <Section
        title="Klingelton je Herkunft"
        description="Die Anlage kennzeichnet Anrufe als intern, extern oder Gruppe. Tischtelefone und die Apps spielen dann unterschiedliche Klingeltöne – so hört man, ob ein Kollege oder ein Kunde anruft."
      >
        <FormControlLabel control={<Switch checked={ring.draft.enabled} onChange={(e) => ring.set({ enabled: e.target.checked })} />} label="Anrufe nach Herkunft kennzeichnen" />
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
          Die Anlage sendet den SIP-Kopf Alert-Info mit info=alert-internal, alert-external oder alert-group. Bei Yealink, Snom und Grandstream dafür im Telefon unter „Distinctive Ring“ bzw. „Alert-Info“ einen Klingelton zuordnen.
        </Typography>
      </Section>
      <ChangesBar dirty={ring.dirty} onApply={() => saveSection('ring', ring.draft)} onDiscard={ring.reset} text="Klingelton: ungespeicherte Änderungen" />
      <Section
        title="Mithören, Einflüstern, Aufschalten"
        description="Für Schulung und Unterstützung im Kundendienst: *90 und die Nebenstelle hört mit, *91 flüstert nur dem Kollegen etwas zu, *92 schaltet sich ins Gespräch. Nur Nebenstellen mit dem Recht „Mithören und Aufschalten“."
      >
        <FormGrid>
          <Full>
            <FormControlLabel control={<Switch checked={spy.draft.enabled} onChange={(e) => spy.set({ enabled: e.target.checked })} />} label="Mithören erlauben" />
          </Full>
          {spy.draft.enabled && (
            <Full>
              <FormControlLabel
                control={<Switch checked={spy.draft.notify} onChange={(e) => spy.set({ notify: e.target.checked })} />}
                label="Mitarbeiter im Messenger informieren, wenn jemand mithört"
              />
            </Full>
          )}
        </FormGrid>
        {spy.draft.enabled && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Heimliches Mithören ist in Deutschland verboten. Mitarbeiter und Anrufer müssen vorher informiert sein (z. B. Betriebsvereinbarung und Hinweis in der Ansage).
          </Alert>
        )}
      </Section>
      <ChangesBar dirty={spy.dirty} onApply={() => saveSection('spy', spy.draft)} onDiscard={spy.reset} text="Mithören: ungespeicherte Änderungen" />
      <Ai />
    </>
  )
}

/** Sprachmodell für Zusammenfassungen und den Telefonassistenten */
function Ai() {
  const { config, saveSection, toast } = usePbx()
  const d = useDraft<AiSettings>(config.ai)
  const a = d.draft
  const [test, setTest] = useState<{ busy: boolean; text?: string }>({ busy: false })
  const ready = Boolean(config.ai.url && config.ai.model)
  const runTest = (): void => {
    setTest({ busy: true })
    void api
      .post<{ reply: string; tts: boolean; stt: boolean }>('/api/ai/test')
      .then((r) =>
        setTest({
          busy: false,
          text: `Antwort: „${r.reply.trim()}“ · Sprachausgabe ${r.tts ? 'bereit' : 'fehlt'} · Spracherkennung ${r.stt ? 'bereit' : 'fehlt (Voicemail als Text einrichten)'}`,
        }),
      )
      .catch((e: Error) => {
        setTest({ busy: false })
        toast(e.message, 'error')
      })
  }
  return (
    <>
      <Section
        title="KI: Zusammenfassungen und Telefonassistent"
        description="Ein Sprachmodell mit OpenAI-kompatibler Schnittstelle fasst aufgezeichnete Gespräche zusammen und führt Gespräche als KI-Telefonassistent. Am datensparsamsten mit einem eigenen Server (z. B. Ollama)."
      >
        <FormGrid>
          <TextField label="Adresse" value={a.url} onChange={(e) => d.set({ url: e.target.value })} helperText="Bis einschließlich /v1, z. B. http://ollama:11434/v1" />
          <TextField label="Modell" value={a.model} onChange={(e) => d.set({ model: e.target.value })} helperText="z. B. llama3.1:8b, qwen2.5:7b oder gpt-4o-mini" />
          <TextField label="API-Schlüssel" type="password" value={a.key} onChange={(e) => d.set({ key: e.target.value })} helperText="Leer lassen, wenn der Dienst keinen braucht (gespeicherter bleibt erhalten)" />
          <Full>
            <FormControlLabel
              control={<Switch checked={a.summaries} onChange={(e) => d.set({ summaries: e.target.checked })} />}
              label="Aufgezeichnete Gespräche zusammenfassen"
            />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Nur für Nebenstellen mit „Gespräche zusammenfassen“. Die Zusammenfassung erscheint in der Anrufliste, im Messenger der Nebenstelle und als Webhook „Gespräch zusammengefasst“.
            </Typography>
          </Full>
          <Select
            label="Hinweisansage vor Aufzeichnungen"
            value={a.record_notice}
            onChange={(v) => d.set({ record_notice: v })}
            options={[['', 'Keine'], ...config.announcements.map((x) => [x.id, x.name] as [string, string])]}
            helperText="Anrufer hören sie, bevor ein aufgezeichnetes Gespräch beginnt"
          />
        </FormGrid>
        {(a.summaries || config.extensions.some((e) => e.summary)) && !a.record_notice && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Gespräche ohne Wissen der Beteiligten aufzuzeichnen ist strafbar (§ 201 StGB). Eine Hinweisansage wählen, z. B. „Dieses Gespräch wird zur Qualitätssicherung aufgezeichnet und zusammengefasst“, und intern die Einwilligung der Mitarbeiter einholen.
          </Alert>
        )}
        {/api\.openai\.com/i.test(a.url) && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Gesprächsinhalte werden dabei an OpenAI übertragen. Für Kundendaten besser ein eigenes Modell nutzen und einen Auftragsverarbeitungsvertrag prüfen.
          </Alert>
        )}
        <Stack direction="row" spacing={2} sx={{ mt: 2, alignItems: 'center' }}>
          <Button variant="outlined" onClick={runTest} disabled={test.busy || !ready || d.dirty}>
            {test.busy ? 'Wird gefragt …' : 'Probe'}
          </Button>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {test.text ?? (ready ? 'Stellt dem Modell eine kurze Frage und prüft Sprachausgabe und -erkennung.' : 'Adresse und Modell eintragen und speichern.')}
          </Typography>
        </Stack>
      </Section>
      <ChangesBar dirty={d.dirty} onApply={() => saveSection('ai', a)} onDiscard={d.reset} text="KI: ungespeicherte Änderungen" />
    </>
  )
}

// -- Tab Schnittstellen -----------------------------------------------------------------

export function Monitoring() {
  const { config, saveSection } = usePbx()
  const d = useDraft<MonitoringSettings>(config.monitoring)
  const m = d.draft
  const [error, setError] = useState('')
  useEffect(() => {
    if (!config.monitoring.syslog) return
    void api
      .get<{ syslog_error: string }>('/api/monitoring/status')
      .then((r) => setError(r.syslog_error))
      .catch(() => undefined)
  }, [config.monitoring])
  return (
    <>
      <Section
        title="Überwachung: Prometheus und Syslog"
        description="Messwerte (Gespräche, Warteschlangen, SIP-Konten, Speicher) für Prometheus/Grafana und Meldungen der Anlage an einen Syslog-Server."
      >
        <FormGrid>
          <Full>
            <FormControlLabel control={<Switch checked={m.metrics} onChange={(e) => d.set({ metrics: e.target.checked })} />} label="Messwerte unter /metrics anbieten" />
          </Full>
          {config.monitoring.metrics && (
            <Full>
              <SecretField
                label="Zugriffsschlüssel (Bearer)"
                value={config.monitoring.token}
                section="monitoring"
                helperText={`In Prometheus: metrics_path /metrics, authorization: credentials: <Schlüssel>, Ziel ${location.host}`}
                warning="Der bisherige Schlüssel wird ungültig. Prometheus muss danach den neuen bekommen."
              />
            </Full>
          )}
          <Full>
            <FormControlLabel control={<Switch checked={m.syslog} onChange={(e) => d.set({ syslog: e.target.checked })} />} label="Meldungen an Syslog senden" />
          </Full>
          {m.syslog && (
            <>
              <TextField label="Syslog-Server" value={m.syslog_host} onChange={(e) => d.set({ syslog_host: e.target.value })} helperText="Name oder IP-Adresse" />
              <NumberField label="Port" value={m.syslog_port} onChange={(v) => d.set({ syslog_port: v })} min={1} />
              <Select
                label="Protokoll"
                value={m.syslog_proto}
                onChange={(v) => d.set({ syslog_proto: v })}
                options={[
                  ['udp', 'UDP'],
                  ['tcp', 'TCP'],
                ]}
              />
            </>
          )}
        </FormGrid>
        {m.syslog && error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </Section>
      <ChangesBar dirty={d.dirty} onApply={() => saveSection('monitoring', m)} onDiscard={d.reset} text="Überwachung: ungespeicherte Änderungen" />
    </>
  )
}

export function Wallboard() {
  const { config, saveSection, toast } = usePbx()
  const w = config.wallboard
  const queues = config.groups.filter((g) => g.mode === 'queue').length
  const link = w.token ? `${location.origin}/wallboard/${w.token}` : ''
  return (
    <Section
      title="Wallboard"
      description="Vollbildanzeige für Warteschlangen auf einem Bildschirm im Büro: wartende Anrufer, Wartezeit, wer frei ist, offene Rückrufe und die Zahlen des Tages."
    >
      <FormControlLabel
        control={
          <Switch
            checked={w.enabled}
            onChange={(e) =>
              void saveSection('wallboard', { ...w, enabled: e.target.checked } as WallboardSettings)
                .then(() => toast('Gespeichert'))
                .catch((err: Error) => toast(err.message, 'error'))
            }
          />
        }
        label="Wallboard einschalten"
      />
      {w.enabled && (
        <Stack sx={{ gap: 2, mt: 2 }}>
          <SecretField
            label="Adresse"
            value={link}
            section="wallboard"
            helperText="Ohne Anmeldung erreichbar – nur an Bildschirme im Haus geben. Rufnummern erscheinen teilweise verdeckt."
            warning="Die bisherige Adresse funktioniert dann nicht mehr; Bildschirme müssen die neue bekommen."
          />
          {link && (
            <Button href={link} target="_blank" sx={{ alignSelf: 'flex-start' }}>
              Wallboard öffnen
            </Button>
          )}
          {!queues && <Alert severity="info">Das Wallboard zeigt Gruppen mit dem Modus „Warteschlange“. Noch ist keine eingerichtet.</Alert>}
        </Stack>
      )}
    </Section>
  )
}

export function Sms() {
  const { config, saveSection, toast } = usePbx()
  const d = useDraft<SmsSettings>(config.sms)
  const s = d.draft
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const inbound = config.sms.inbound_token ? `${location.origin}/sms/${config.sms.inbound_token}` : ''
  const sendTest = (): void => {
    setBusy(true)
    void api
      .post<{ to: string }>('/api/sms/test', { to })
      .then((r) => toast(`Test-SMS an ${r.to} gesendet`))
      .catch((e: Error) => toast(e.message, 'error'))
      .finally(() => setBusy(false))
  }
  return (
    <>
      <Section
        title="SMS"
        description="SMS aus den Apps senden und empfangen. Eingehende SMS erscheinen im Messenger als Unterhaltung „SMS <Absender>“ bei allen Nebenstellen mit dem Recht „SMS“; Antworten dort gehen als SMS zurück."
      >
        <FormGrid>
          <Full>
            <FormControlLabel control={<Switch checked={s.enabled} onChange={(e) => d.set({ enabled: e.target.checked })} />} label="SMS einschalten" />
          </Full>
          {s.enabled && (
            <>
              <Full>
                <Select
                  label="Anbieter"
                  value={s.provider}
                  onChange={(v) => d.set({ provider: v })}
                  options={[
                    ['sipgate', 'sipgate'],
                    ['http', 'Andere (HTTP-Schnittstelle)'],
                  ]}
                />
              </Full>
              {s.provider === 'sipgate' ? (
                <>
                  <TextField label="Token-ID" value={s.user} onChange={(e) => d.set({ user: e.target.value })} helperText="sipgate → Einstellungen → Personal Access Token (Bereich sessions:sms:write)" />
                  <TextField label="Token" type="password" value={s.password} onChange={(e) => d.set({ password: e.target.value })} helperText="Leer lassen = gespeicherten behalten" />
                  <TextField label="SMS-ID" value={s.sender} onChange={(e) => d.set({ sender: e.target.value })} helperText="z. B. s0 (unter sipgate → SMS)" />
                </>
              ) : (
                <>
                  <Full>
                    <TextField label="Adresse" value={s.url} onChange={(e) => d.set({ url: e.target.value })} fullWidth helperText="Die Anlage schickt jede SMS als POST dorthin" />
                  </Full>
                  <Full>
                    <TextField
                      label="Inhalt"
                      value={s.body}
                      onChange={(e) => d.set({ body: e.target.value })}
                      fullWidth
                      multiline
                      minRows={2}
                      helperText="Mit {to}, {text} und {from}; beginnt der Inhalt mit {, wird er als JSON gesendet, sonst als Formular"
                    />
                  </Full>
                  <TextField label="Absender" value={s.sender} onChange={(e) => d.set({ sender: e.target.value })} helperText="Für {from}" />
                  <TextField label="Benutzer (optional)" value={s.user} onChange={(e) => d.set({ user: e.target.value })} />
                  <TextField label="Passwort (optional)" type="password" value={s.password} onChange={(e) => d.set({ password: e.target.value })} helperText="Leer lassen = gespeichertes behalten" />
                </>
              )}
              {inbound && (
                <Full>
                  <SecretField
                    label="Adresse für eingehende SMS"
                    value={inbound}
                    section="sms"
                    helperText="Beim Anbieter als Webhook eintragen (POST mit from/text als JSON oder Formular)"
                    warning="Die bisherige Adresse funktioniert dann nicht mehr; beim Anbieter muss die neue eingetragen werden."
                  />
                </Full>
              )}
            </>
          )}
        </FormGrid>
        {config.sms.enabled && !d.dirty && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2, alignItems: { sm: 'center' } }}>
            <TextField label="Test an" value={to} onChange={(e) => setTo(e.target.value)} size="small" placeholder="0171 1234567" />
            <Button variant="outlined" onClick={sendTest} disabled={busy || !to.trim()} sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
              Test-SMS senden
            </Button>
          </Stack>
        )}
      </Section>
      <ChangesBar dirty={d.dirty} onApply={() => saveSection('sms', s)} onDiscard={d.reset} text="SMS: ungespeicherte Änderungen" />
    </>
  )
}
