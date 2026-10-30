/**
 * Rufumleitung der Telefonanlage: in der Titelleiste schalten (Nebenstelle, Gruppe oder
 * Nummer) und Regeln bearbeiten. Was erlaubt ist, gibt die Anlage über die Rechte vor.
 */

import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  ListItemText,
  MenuItem,
  MenuList,
  Popover,
  Radio,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import type { PbxForward, PbxForwardChange, PbxForwardRule } from '../../../shared/types'
import { api } from '../api'
import { useApp } from '../state'

const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

/** „11 Anna“ statt nur „11“, externe Nummern unverändert */
export function forwardLabel(f: PbxForward, number: string): string {
  const t = f.targets.find((x) => x.number === number)
  return t ? `${t.number} ${t.name}` : number
}

function useForwardSave(): [(change: PbxForwardChange) => Promise<boolean>, string, boolean] {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (change: PbxForwardChange): Promise<boolean> => {
    setBusy(true)
    setError('')
    const r = await api.pbxSetForward(change)
    setBusy(false)
    if (!r.ok) setError(r.error)
    return r.ok
  }
  return [save, error, busy]
}

/** Auswahl aus den Zielen der Anlage, mit freier Eingabe, wenn nach außen erlaubt */
function TargetField({ f, label, value, onChange, helperText }: { f: PbxForward; label: string; value: string; onChange: (v: string) => void; helperText?: string }) {
  const external = f.permissions.includes('forward_external')
  const options = f.targets.map((t) => t.number)
  return (
    <Autocomplete
      freeSolo={external}
      autoSelect={external}
      options={options}
      value={value || null}
      onChange={(_e, v) => onChange((v ?? '').replace(/[^\d+*#]/g, ''))}
      getOptionLabel={(n) => forwardLabel(f, n)}
      renderInput={(p) => <TextField {...p} label={label} helperText={helperText ?? (external ? 'Auswählen oder Nummer eintippen' : 'Nur Nebenstellen und Gruppen')} />}
    />
  )
}

export function ForwardPopover({ anchor, onClose, onRules }: { anchor: HTMLElement | null; onClose: () => void; onRules: () => void }) {
  const { state, toast } = useApp()
  const f = state.forward
  const [number, setNumber] = useState('')
  const [save, error, busy] = useForwardSave()
  useEffect(() => {
    if (anchor) void api.pbxLoadForward()
  }, [anchor])
  if (!f) return null
  const may = f.permissions.includes('forward')
  const external = f.permissions.includes('forward_external')
  const set = async (cfu: string): Promise<void> => {
    if (await save({ cfu })) {
      toast(cfu ? `Anrufe werden an ${forwardLabel(f, cfu)} umgeleitet` : 'Umleitung aus')
      setNumber('')
      onClose()
    }
  }
  const ruleActive = !f.cfu && f.active
  return (
    <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={onClose} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
      <Box sx={{ p: 1.5, width: 340, maxHeight: '80vh' }}>
        <Typography variant="subtitle1" sx={{ px: 1 }}>
          Rufumleitung
        </Typography>
        <Typography variant="body2" sx={{ px: 1, pb: 1, color: 'text.secondary' }}>
          {f.active ? `Alle Anrufe gehen an ${forwardLabel(f, f.active)}${ruleActive ? ' (Regel)' : ''}.` : 'Anrufe klingeln hier.'}
        </Typography>
        {may ? (
          <>
            <MenuList dense disablePadding sx={{ maxHeight: 260, overflow: 'auto' }}>
              {[{ number: '', name: 'Keine Umleitung' }, ...f.targets].map((t) => (
                <MenuItem key={t.number || 'off'} dense disabled={busy} onClick={() => void set(t.number)}>
                  <Radio checked={f.cfu === t.number} size="small" sx={{ p: 0.5, mr: 1 }} />
                  <ListItemText primary={t.number ? `${t.number} ${t.name}` : t.name} slotProps={{ primary: { noWrap: true } }} />
                </MenuItem>
              ))}
              {f.cfu && !f.targets.some((t) => t.number === f.cfu) && (
                <MenuItem dense selected>
                  <Radio checked size="small" sx={{ p: 0.5, mr: 1 }} />
                  <ListItemText primary={f.cfu} />
                </MenuItem>
              )}
            </MenuList>
            {external && (
              <Stack
                component="form"
                direction="row"
                sx={{ gap: 1, px: 1, pt: 1 }}
                onSubmit={(e) => {
                  e.preventDefault()
                  if (number.trim()) void set(number.trim())
                }}
              >
                <TextField size="small" label="Andere Nummer" value={number} onChange={(e) => setNumber(e.target.value)} sx={{ flex: 1 }} />
                <Button type="submit" disabled={busy || !number.trim()}>
                  Umleiten
                </Button>
              </Stack>
            )}
          </>
        ) : (
          <Typography variant="body2" sx={{ px: 1 }}>
            Die Telefonanlage erlaubt das Umleiten aus der App nicht.
          </Typography>
        )}
        {error && (
          <Alert severity="error" sx={{ mx: 1, mt: 1 }}>
            {error}
          </Alert>
        )}
        {f.mobile && may && (
          <>
            <Divider sx={{ my: 1 }} />
            <Stack direction="row" sx={{ alignItems: 'center', px: 1, gap: 1 }}>
              <ListItemText primary="Handy klingelt mit" secondary={f.mobile.number} />
              <Switch
                checked={f.mobile.enabled}
                disabled={busy}
                onChange={(e) => {
                  const mobile = e.target.checked
                  void save({ mobile }).then((ok) => ok && toast(mobile ? 'Das Handy klingelt mit' : 'Das Handy klingelt nicht mehr mit'))
                }}
                slotProps={{ input: { 'aria-label': 'Handy klingelt mit' } }}
              />
            </Stack>
          </>
        )}
        {f.permissions.includes('forward_rules') && (
          <>
            <Divider sx={{ my: 1 }} />
            <Button
              size="small"
              onClick={() => {
                onClose()
                onRules()
              }}
            >
              Regeln und Weiterleitungen …
            </Button>
          </>
        )}
      </Box>
    </Popover>
  )
}

function newRule(): PbxForwardRule {
  return { id: '', enabled: true, when: 'schedule', days: [1, 2, 3, 4, 5], from: '18:00', to: '08:00', timecondition: '', tc_state: 'closed', target: '' }
}

function RuleCard({ f, rule, index, onChange, onRemove }: { f: PbxForward; rule: PbxForwardRule; index: number; onChange: (r: PbxForwardRule) => void; onRemove: () => void }) {
  const set = (patch: Partial<PbxForwardRule>): void => onChange({ ...rule, ...patch })
  return (
    <Card variant="outlined" sx={{ p: 2, opacity: rule.enabled ? 1 : 0.7 }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Switch checked={rule.enabled} onChange={(e) => set({ enabled: e.target.checked })} slotProps={{ input: { 'aria-label': 'Regel aktiv' } }} />
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          Regel {index + 1}
        </Typography>
        <Tooltip title="Regel löschen">
          <IconButton size="small" onClick={onRemove}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <TextField select label="Wann" value={rule.when} onChange={(e) => set({ when: e.target.value as PbxForwardRule['when'] })}>
          <MenuItem value="schedule">Zu bestimmten Zeiten</MenuItem>
          <MenuItem value="timecondition" disabled={!f.timeconditions.length}>
            Nach Zeitsteuerung der Anlage
          </MenuItem>
          <MenuItem value="calendar" disabled={!f.calendars?.length}>
            Bei einem Termin im Kalender
          </MenuItem>
          <MenuItem value="dnd">Bei „Nicht stören“ (*76)</MenuItem>
        </TextField>
        {rule.when !== 'dnd' && (
          <TextField select label="Dann" value={rule.action ?? 'forward'} onChange={(e) => set({ action: e.target.value as 'forward' | 'dnd' })}>
            <MenuItem value="forward">Umleiten</MenuItem>
            <MenuItem value="dnd">Nicht stören</MenuItem>
          </TextField>
        )}
        {(rule.when === 'dnd' || rule.action !== 'dnd') && (
          <TargetField f={f} label="Umleiten an" value={rule.target} onChange={(target) => set({ target })} helperText="" />
        )}
        {rule.when === 'schedule' && (
          <>
            <Box sx={{ gridColumn: '1 / -1' }}>
              <ToggleButtonGroup size="small" value={rule.days} onChange={(_e, days: number[]) => set({ days: [...days].sort() })} aria-label="Wochentage">
                {DAYS.map((d, i) => (
                  <ToggleButton key={d} value={i + 1} sx={{ px: 1.5 }}>
                    {d}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>
            <TextField type="time" label="Von" value={rule.from} onChange={(e) => set({ from: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField
              type="time"
              label="Bis"
              value={rule.to}
              onChange={(e) => set({ to: e.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
              helperText={rule.to <= rule.from ? 'Bis zum Folgetag' : undefined}
            />
          </>
        )}
        {rule.when === 'calendar' && (
          <>
            <TextField select label="Kalender" value={rule.calendar ?? ''} onChange={(e) => set({ calendar: e.target.value })}>
              {(f.calendars ?? []).map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Nur Termine mit"
              value={rule.keyword ?? ''}
              onChange={(e) => set({ keyword: e.target.value })}
              helperText="z. B. „Urlaub Anna“, leer = jeder Termin"
            />
          </>
        )}
        {rule.when === 'timecondition' && (
          <>
            <TextField select label="Zeitsteuerung" value={rule.timecondition} onChange={(e) => set({ timecondition: e.target.value })}>
              {f.timeconditions.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField select label="Umleiten, wenn" value={rule.tc_state} onChange={(e) => set({ tc_state: e.target.value as PbxForwardRule['tc_state'] })}>
              <MenuItem value="closed">geschlossen</MenuItem>
              <MenuItem value="open">geöffnet</MenuItem>
            </TextField>
          </>
        )}
      </Box>
    </Card>
  )
}

export function ForwardRulesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, toast } = useApp()
  const f = state.forward
  const [draft, setDraft] = useState<Pick<PbxForward, 'busy' | 'noanswer' | 'rules'>>({ busy: '', noanswer: '', rules: [] })
  const [save, error, busy] = useForwardSave()
  useEffect(() => {
    if (open && f) setDraft({ busy: f.busy, noanswer: f.noanswer, rules: structuredClone(f.rules) })
    // Nur beim Öffnen übernehmen, sonst überschreibt die Abfrage im Hintergrund die Eingaben
  }, [open])
  if (!f) return null
  const setRules = (rules: PbxForwardRule[]): void => setDraft({ ...draft, rules })
  const apply = async (): Promise<void> => {
    if (await save(draft)) {
      toast('Umleitungen gespeichert')
      onClose()
    }
  }
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Regeln und Weiterleitungen</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          <TargetField f={f} label="Bei besetzt an" value={draft.busy} onChange={(busy) => setDraft({ ...draft, busy })} helperText="Leer = Voicemail" />
          <TargetField f={f} label="Ohne Antwort an" value={draft.noanswer} onChange={(noanswer) => setDraft({ ...draft, noanswer })} helperText="Leer = Voicemail" />
          <Box>
            <Typography variant="subtitle1">Automatisch umleiten</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Die erste greifende Regel leitet alle Anrufe um. Eine Umleitung aus der Titelleiste geht vor.
            </Typography>
          </Box>
          {draft.rules.map((r, i) => (
            <RuleCard
              key={r.id || `neu-${i}`}
              f={f}
              rule={r}
              index={i}
              onChange={(next) => setRules(draft.rules.map((x, j) => (j === i ? next : x)))}
              onRemove={() => setRules(draft.rules.filter((_x, j) => j !== i))}
            />
          ))}
          <Box>
            <Button startIcon={<AddIcon />} onClick={() => setRules([...draft.rules, newRule()])}>
              Regel hinzufügen
            </Button>
          </Box>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button variant="contained" onClick={() => void apply()} disabled={busy}>
          Speichern
        </Button>
      </DialogActions>
    </Dialog>
  )
}
