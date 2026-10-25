/** Bausteine der Oberfläche: Seitenkopf, Karten, Listen-Seiten mit Bearbeiten-Dialog. */

import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import GridViewIcon from '@mui/icons-material/GridView'
import ViewListIcon from '@mui/icons-material/ViewList'
import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Checkbox,
  Fab,
  FormControlLabel,
  FormGroup,
  Paper,
  Slide,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { APP_PERMISSIONS, type AppPermission, type CollectionName, DESTINATION_LABELS, type Destination, type DestinationType, blankItem } from '../../../server/model'
import { takeEditRequest } from '../router'
import { usePbx } from '../state'

export function PageHeader({ title, description, action, overline }: { title: string; description?: string; action?: ReactNode; overline?: string }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ alignItems: { sm: 'flex-end' }, mb: 3, gap: 2 }}>
      <Box sx={{ flex: 1 }}>
        {overline && (
          <Typography variant="overline" sx={{ color: 'primary.main', display: 'block', lineHeight: 1.6 }}>
            {overline}
          </Typography>
        )}
        <Typography variant="h4" component="h1">
          {title}
        </Typography>
        {description && (
          <Typography variant="body1" sx={{ color: 'text.secondary', mt: 0.75, maxWidth: 780 }}>
            {description}
          </Typography>
        )}
      </Box>
      {action && <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>{action}</Stack>}
    </Stack>
  )
}

export function Section({ title, description, children, action, icon }: { title?: string; description?: string; children: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <Card sx={{ mb: 2 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 }, '&:last-child': { pb: { xs: 2, sm: 3 } } }}>
        {(title || action) && (
          <Stack direction="row" sx={{ alignItems: 'center', mb: description ? 0.5 : 2, gap: 1.5 }}>
            {icon && <Box sx={{ color: 'primary.main', display: 'flex' }}>{icon}</Box>}
            <Typography variant="h6" sx={{ flex: 1 }}>
              {title}
            </Typography>
            {action}
          </Stack>
        )}
        {description && (
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {description}
          </Typography>
        )}
        {children}
      </CardContent>
    </Card>
  )
}

/** Überschrift innerhalb eines Formulars */
export function FormHeading({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <Box sx={{ mt: 1, mb: 1.5 }}>
      <Typography variant="subtitle1">{children}</Typography>
      {hint && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {hint}
        </Typography>
      )}
    </Box>
  )
}

/** Formularfelder in zwei Spalten (schmal: eine Spalte) */
export function FormGrid({ children, columns = 2 }: { children: ReactNode; columns?: number }) {
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: `repeat(${columns}, minmax(0, 1fr))` }, mb: 2 }}>
      {children}
    </Box>
  )
}

export function Full({ children }: { children: ReactNode }) {
  return <Box sx={{ gridColumn: '1 / -1' }}>{children}</Box>
}

/** Kartenraster für Übersichten */
export function CardGrid({ children, min = 300 }: { children: ReactNode; min?: number }) {
  return <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))` }}>{children}</Box>
}

/** Rundes Kürzel (Initialen) in einer festen Farbe je Name */
export function Initials({ name, color, size = 40 }: { name: string; color?: string; size?: number }) {
  const theme = useTheme()
  const letters = name
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
  const palette = Object.values(theme.m3.node)
  const hash = [...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7)
  const bg = color ?? palette[hash % palette.length]
  return (
    <Avatar sx={{ width: size, height: size, bgcolor: bg, color: theme.palette.getContrastText(bg), fontSize: size * 0.4, fontWeight: 600 }}>
      {letters || '?'}
    </Avatar>
  )
}

/** Statuspunkt mit Text, z. B. „● Angemeldet“ */
export function StatusDot({ color, label }: { color: 'success' | 'error' | 'warning' | 'default'; label: string }) {
  const theme = useTheme()
  const c = color === 'default' ? theme.palette.text.disabled : theme.palette[color].main
  return (
    <Stack direction="row" component="span" sx={{ alignItems: 'center', gap: 0.75, color: color === 'default' ? 'text.secondary' : c, fontWeight: 600, fontSize: 13 }}>
      <Box component="span" sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: c, flexShrink: 0 }} />
      {label}
    </Stack>
  )
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <Card sx={{ borderStyle: 'dashed' }}>
      <Stack sx={{ alignItems: 'center', textAlign: 'center', p: { xs: 3, sm: 5 }, gap: 1 }}>
        {icon && <Box sx={{ color: 'text.secondary', '& svg': { fontSize: 44 } }}>{icon}</Box>}
        <Typography variant="h6">{title}</Typography>
        {text && (
          <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 480 }}>
            {text}
          </Typography>
        )}
        {action && <Box sx={{ mt: 1 }}>{action}</Box>}
      </Stack>
    </Card>
  )
}

/** Liste freier Texte als Chips (Rufnummern, Präfixe, Netze …) */
export function ChipsInput({
  label,
  value,
  onChange,
  helperText,
  options = [],
}: {
  label: string
  value: string[]
  onChange: (v: string[]) => void
  helperText?: string
  options?: string[]
}) {
  return (
    <Autocomplete
      multiple
      freeSolo
      options={options}
      value={value}
      onChange={(_e, v) => onChange(v.map((s) => s.trim()).filter(Boolean))}
      renderValue={(items, getItemProps) =>
        items.map((option, index) => {
          const { key, ...rest } = getItemProps({ index })
          return <Chip key={key} label={option} size="small" {...rest} />
        })
      }
      renderInput={(params) => <TextField {...params} label={label} helperText={helperText ?? 'Eingabe mit Enter übernehmen'} />}
    />
  )
}

export function Select<T extends string>({
  label,
  value,
  onChange,
  options,
  helperText,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: [T, string][]
  helperText?: string
}) {
  return (
    <TextField select label={label} value={value} onChange={(e) => onChange(e.target.value as T)} helperText={helperText}>
      {options.map(([v, l]) => (
        <MenuItem key={v} value={v}>
          {l}
        </MenuItem>
      ))}
    </TextField>
  )
}

export function NumberField({ label, value, onChange, helperText, min = 0 }: { label: string; value: number; onChange: (v: number) => void; helperText?: string; min?: number }) {
  return (
    <TextField
      label={label}
      type="number"
      value={value}
      onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))}
      helperText={helperText}
      slotProps={{ htmlInput: { min } }}
    />
  )
}

export interface NumberOption {
  value: string
  label: string
  group: string
}

/** Eigene Rufnummern aller SIP-Konten */
export function trunkNumberOptions(config: ReturnType<typeof usePbx>['config']): NumberOption[] {
  return config.trunks.flatMap((t) => t.numbers.map((n) => ({ value: n, label: n, group: t.name })))
}

/** Interne Ziele zum Weiterleiten: Nebenstellen, Gruppen, Konferenzen */
export function internalNumberOptions(config: ReturnType<typeof usePbx>['config']): NumberOption[] {
  return [
    ...config.extensions.map((e) => ({ value: e.number, label: `${e.number} – ${e.name}`, group: 'Nebenstellen' })),
    ...config.groups.filter((g) => g.number).map((g) => ({ value: g.number, label: `${g.number} – ${g.name}`, group: 'Gruppen' })),
    ...config.conferences.map((c) => ({ value: c.number, label: `${c.number} – ${c.name || 'Konferenz'}`, group: 'Konferenzräume' })),
  ]
}

/** Rufnummer aus einer Liste wählen oder frei eintippen (z. B. externe Nummer). */
export function NumberPicker({
  label,
  value,
  onChange,
  options,
  helperText,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: NumberOption[]
  helperText?: string
  placeholder?: string
}) {
  return (
    <Autocomplete
      freeSolo
      autoSelect
      options={options}
      groupBy={(o) => (typeof o === 'string' ? '' : o.group)}
      getOptionLabel={(o) => (typeof o === 'string' ? o : o.label)}
      isOptionEqualToValue={(o, v) => o.value === (typeof v === 'string' ? v : v.value)}
      value={options.find((o) => o.value === value) ?? value}
      onChange={(_e, v) => onChange(v == null ? '' : typeof v === 'string' ? v.trim() : v.value)}
      renderInput={(p) => <TextField {...p} label={label} helperText={helperText} placeholder={placeholder} />}
    />
  )
}

/** Auswahl eines Ziels (Nebenstelle, Gruppe, Sprachmenü …) */
export function DestinationPicker({ label, value, onChange, exclude }: { label: string; value: Destination; onChange: (d: Destination) => void; exclude?: DestinationType[] }) {
  const { config } = usePbx()
  const targets: Record<DestinationType, [string, string][]> = {
    extension: config.extensions.map((e) => [e.id, `${e.number} – ${e.name}`]),
    voicemail: config.extensions.filter((e) => e.voicemail.enabled).map((e) => [e.id, `${e.number} – ${e.name}`]),
    group: config.groups.map((g) => [g.id, `${g.number ? g.number + ' – ' : ''}${g.name}`]),
    ivr: config.ivrs.map((i) => [i.id, i.name]),
    timecondition: config.timeconditions.map((t) => [t.id, t.name]),
    conference: config.conferences.map((c) => [c.id, `${c.number} – ${c.name}`]),
    announcement: config.announcements.map((a) => [a.id, a.name]),
    external: [],
    hangup: [],
  }
  const types = (Object.keys(DESTINATION_LABELS) as DestinationType[]).filter((t) => !exclude?.includes(t))
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2, width: '100%' }}>
      <TextField
        select
        label={label}
        value={value.type}
        onChange={(e) => {
          const type = e.target.value as DestinationType
          onChange({ type, target: targets[type][0]?.[0] ?? '' })
        }}
        sx={{ flex: 1 }}
      >
        {types.map((t) => (
          <MenuItem key={t} value={t}>
            {DESTINATION_LABELS[t]}
          </MenuItem>
        ))}
      </TextField>
      {value.type === 'external' ? (
        <TextField label="Rufnummer" value={value.target} onChange={(e) => onChange({ ...value, target: e.target.value })} sx={{ flex: 1 }} />
      ) : value.type !== 'hangup' ? (
        <TextField
          select
          label={DESTINATION_LABELS[value.type]}
          value={targets[value.type].some(([id]) => id === value.target) ? value.target : ''}
          onChange={(e) => onChange({ ...value, target: e.target.value })}
          sx={{ flex: 1 }}
          error={!targets[value.type].some(([id]) => id === value.target)}
          helperText={targets[value.type].length ? undefined : 'Noch keine angelegt'}
        >
          {targets[value.type].map(([id, name]) => (
            <MenuItem key={id} value={id}>
              {name}
            </MenuItem>
          ))}
        </TextField>
      ) : (
        <Box sx={{ flex: 1 }} />
      )}
    </Stack>
  )
}

export function describeDestination(d: Destination, config: ReturnType<typeof usePbx>['config']): string {
  const label = DESTINATION_LABELS[d.type]
  const find = <T extends { id: string }>(list: T[]) => list.find((x) => x.id === d.target)
  switch (d.type) {
    case 'extension':
    case 'voicemail': {
      const e = find(config.extensions)
      return e ? `${label} ${e.number} (${e.name})` : `${label} ?`
    }
    case 'group':
      return `${label} ${find(config.groups)?.name ?? '?'}`
    case 'ivr':
      return `${label} ${find(config.ivrs)?.name ?? '?'}`
    case 'timecondition':
      return `${label} ${find(config.timeconditions)?.name ?? '?'}`
    case 'conference':
      return `${label} ${find(config.conferences)?.number ?? '?'}`
    case 'announcement':
      return `${label} ${find(config.announcements)?.name ?? '?'}`
    case 'external':
      return `→ ${d.target}`
    default:
      return label
  }
}

export type FormComponent<T> = (props: { value: T; onChange: (v: T) => void; isNew: boolean }) => ReactNode

/**
 * Bearbeiten-Dialog für einen Eintrag einer Liste. Liefert Funktionen zum Öffnen und
 * das Dialog-Element, damit auch Diagramme und Karten Einträge bearbeiten können.
 */
export function useEditor<T extends { id: string }>(kind: CollectionName, singular: string, Form: FormComponent<T>, newItem?: () => Partial<T>) {
  const pbx = usePbx()
  const theme = useTheme()
  const mobile = useMediaQuery(theme.breakpoints.down('sm'))
  const [editing, setEditing] = useState<T | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const isNew = Boolean(editing && !editing.id)
  const items = pbx.config[kind] as unknown as T[]

  const openNew = (preset?: Partial<T>): void => setEditing({ ...blankItem(kind), ...newItem?.(), ...preset, id: '' } as unknown as T)
  const openItem = (id: string): void => {
    const item = items.find((x) => x.id === id)
    if (item) setEditing(structuredClone(item))
  }

  const save = async (): Promise<void> => {
    if (!editing) return
    setSaving(true)
    try {
      await pbx.saveItem(kind, editing)
      pbx.toast(`${singular} gespeichert`)
      setEditing(null)
    } catch (e) {
      pbx.toast((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!editing) return
    try {
      await pbx.removeItem(kind, editing.id)
      pbx.toast(`${singular} gelöscht`)
      setEditing(null)
    } catch (e) {
      pbx.toast((e as Error).message, 'error')
    }
    setConfirm(false)
  }

  const dialog = (
    <>
      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} fullWidth maxWidth="md" fullScreen={mobile}>
        <DialogTitle>{isNew ? `${singular} anlegen` : `${singular} bearbeiten`}</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>{editing && <Form value={editing} onChange={setEditing} isNew={isNew} />}</DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {!isNew && (
            <IconButton aria-label="Löschen" color="error" onClick={() => setConfirm(true)} sx={{ mr: 'auto' }}>
              <DeleteOutlineIcon />
            </IconButton>
          )}
          <Button onClick={() => setEditing(null)}>Abbrechen</Button>
          <Button variant="contained" onClick={() => void save()} disabled={saving}>
            Speichern
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={confirm}
        title={`${singular} löschen?`}
        text="Das lässt sich nicht rückgängig machen. Verweise darauf führen danach zum Auflegen."
        confirm="Löschen"
        onClose={() => setConfirm(false)}
        onConfirm={() => void remove()}
      />
    </>
  )
  return { openNew, openItem, dialog }
}

export type ViewMode = 'cards' | 'list'

/** Gewählte Ansicht (Karten oder Liste) einer Seite, im Browser gemerkt */
export function useViewMode(page: string, initial: ViewMode = 'cards'): [ViewMode, (v: ViewMode) => void] {
  const key = `pbx.view.${page}`
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      const v = localStorage.getItem(key)
      return v === 'cards' || v === 'list' ? v : initial
    } catch {
      return initial
    }
  })
  const change = (v: ViewMode): void => {
    setMode(v)
    try {
      localStorage.setItem(key, v)
    } catch {
      // ohne Speicher gilt die Wahl nur bis zum Neuladen
    }
  }
  return [mode, change]
}

/** Umschalter zwischen Karten- und Listenansicht */
export function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <ToggleButtonGroup size="small" exclusive value={value} onChange={(_e, v: ViewMode | null) => v && onChange(v)} aria-label="Ansicht">
      <ToggleButton value="cards" aria-label="Karten">
        <Tooltip title="Karten">
          <GridViewIcon fontSize="small" />
        </Tooltip>
      </ToggleButton>
      <ToggleButton value="list" aria-label="Liste">
        <Tooltip title="Liste">
          <ViewListIcon fontSize="small" />
        </Tooltip>
      </ToggleButton>
    </ToggleButtonGroup>
  )
}

export interface Column<T> {
  label: string
  render: (item: T) => ReactNode
  hideOnMobile?: boolean
}

/**
 * Seite mit allen Einträgen einer Liste: als Tabelle (columns) oder als Karten (card),
 * „Anlegen“-Knopf und Bearbeiten-Dialog. Gibt es beides, lässt sich die Ansicht umschalten.
 * #/seite?edit=<id> öffnet einen Eintrag direkt.
 */
export function CollectionPage<T extends { id: string }>({
  kind,
  page,
  overline,
  title,
  description,
  singular,
  columns,
  card,
  Form,
  newItem,
  emptyText,
  emptyIcon,
  extraActions,
  before,
  after,
}: {
  kind: CollectionName
  /** Name der Seite in der Adresse (für #/seite?edit=…) */
  page?: string
  overline?: string
  title: string
  description?: string
  singular: string
  columns?: Column<T>[]
  card?: (item: T) => ReactNode
  Form: FormComponent<T>
  newItem?: () => Partial<T>
  emptyText?: string
  emptyIcon?: ReactNode
  extraActions?: (item: T) => ReactNode
  before?: ReactNode
  after?: ReactNode
}) {
  const pbx = usePbx()
  const items = pbx.config[kind] as unknown as T[]
  const editor = useEditor<T>(kind, singular, Form, newItem)
  const theme = useTheme()
  const mobile = useMediaQuery(theme.breakpoints.down('sm'))
  const [mode, setMode] = useViewMode(page ?? kind, card ? 'cards' : 'list')
  const switchable = Boolean(card && columns)
  const showCards = card && (!columns || mode === 'cards')

  useEffect(() => {
    const id = takeEditRequest(page ?? kind)
    if (id === 'new') editor.openNew()
    else if (id) editor.openItem(id)
  }, [])

  const visible = (columns ?? []).filter((c) => !(mobile && c.hideOnMobile))
  let list: ReactNode
  if (!items.length) {
    list = (
      <EmptyState
        icon={emptyIcon}
        title={`Noch keine Einträge`}
        text={emptyText}
        action={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => editor.openNew()}>
            {singular} anlegen
          </Button>
        }
      />
    )
  } else if (card && showCards) {
    list = (
      <CardGrid>
        {items.map((item) => (
          <Card key={item.id} sx={{ display: 'flex', flexDirection: 'column' }}>
            <CardActionArea onClick={() => editor.openItem(item.id)} sx={{ flex: 1, alignItems: 'stretch', display: 'flex', flexDirection: 'column' }}>
              <CardContent sx={{ flex: 1, width: '100%' }}>{card(item)}</CardContent>
            </CardActionArea>
            {(() => {
              const actions = extraActions?.(item)
              return actions ? (
                <Box sx={{ px: 1.5, pb: 1.5 }} onClick={(e) => e.stopPropagation()}>
                  {actions}
                </Box>
              ) : null
            })()}
          </Card>
        ))}
      </CardGrid>
    )
  } else {
    list = (
      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                {visible.map((c) => (
                  <TableCell key={c.label}>{c.label}</TableCell>
                ))}
                {extraActions && <TableCell />}
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id} hover sx={{ cursor: 'pointer', '&:last-child td': { border: 0 } }} onClick={() => editor.openItem(item.id)}>
                  {visible.map((c) => (
                    <TableCell key={c.label}>{c.render(item)}</TableCell>
                  ))}
                  {extraActions && (
                    <TableCell align="right" onClick={(e) => e.stopPropagation()} sx={{ whiteSpace: 'nowrap' }}>
                      {extraActions(item)}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    )
  }

  return (
    <Box>
      <PageHeader
        overline={overline}
        title={title}
        description={description}
        action={
          (switchable || !mobile) && (
            <>
              {switchable && <ViewToggle value={mode} onChange={setMode} />}
              {!mobile && (
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => editor.openNew()}>
                  {singular} anlegen
                </Button>
              )}
            </>
          )
        }
      />
      {before}
      {list}
      {after}
      {mobile && (
        <Fab color="primary" variant="extended" sx={{ position: 'fixed', right: 16, bottom: 16 }} onClick={() => editor.openNew()}>
          <AddIcon sx={{ mr: 1 }} />
          {singular}
        </Fab>
      )}
      {editor.dialog}
    </Box>
  )
}

export function ConfirmDialog({
  open,
  title,
  text,
  confirm,
  onClose,
  onConfirm,
}: {
  open: boolean
  title: string
  text: string
  confirm: string
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {text}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button onClick={onConfirm} color="error">
          {confirm}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${m}:${String(rest).padStart(2, '0')}`
}

/** Entwurf einer Einstellung: folgt der gespeicherten Fassung, solange nichts geändert ist. */
export function useDraft<T>(initial: T): {
  draft: T
  set: (patch: Partial<T>) => void
  replace: (v: T) => void
  dirty: boolean
  reset: () => void
} {
  const [draft, setDraft] = useState(initial)
  useEffect(() => setDraft(initial), [initial])
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initial), [draft, initial])
  return { draft, set: (patch) => setDraft((d) => ({ ...d, ...patch })), replace: setDraft, dirty, reset: () => setDraft(initial) }
}

let unsaved = 0

/** Gibt es irgendwo ungespeicherte Änderungen? (z. B. vor dem Wechsel des Tabs) */
export function confirmDiscard(): boolean {
  return unsaved === 0 || window.confirm('Ungespeicherte Änderungen verwerfen?')
}

/**
 * Leiste am unteren Rand, sobald etwas geändert ist: „Anwenden“ speichert,
 * „Verwerfen“ stellt die gespeicherte Fassung wieder her.
 */
export function ChangesBar({ dirty, onApply, onDiscard, text = 'Ungespeicherte Änderungen' }: { dirty: boolean; onApply: () => Promise<unknown>; onDiscard: () => void; text?: string }) {
  const { toast } = usePbx()
  const [busy, setBusy] = useState(false)
  // Beim Schließen oder Neuladen der Seite nachfragen
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent): void => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    unsaved++
    return () => {
      unsaved--
      window.removeEventListener('beforeunload', warn)
    }
  }, [dirty])
  const apply = (): void => {
    setBusy(true)
    void onApply()
      .then(() => toast('Übernommen'))
      .catch((e: Error) => toast(e.message, 'error'))
      .finally(() => setBusy(false))
  }
  return (
    <Slide direction="up" in={dirty} mountOnEnter unmountOnExit>
      <Paper
        elevation={6}
        role="region"
        aria-label="Änderungen"
        sx={{
          position: 'sticky',
          bottom: 16,
          zIndex: (t) => t.zIndex.appBar - 1,
          mt: 2,
          px: 2,
          py: 1.25,
          borderRadius: 4,
          bgcolor: 'background.paper',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        <Typography variant="body2" sx={{ flex: 1, minWidth: 160, fontWeight: 500 }}>
          {text}
        </Typography>
        <Button onClick={onDiscard} disabled={busy}>
          Verwerfen
        </Button>
        <Button variant="contained" onClick={apply} disabled={busy}>
          Anwenden
        </Button>
      </Paper>
    </Slide>
  )
}

/** Rechte in der App zum Ankreuzen (Grundrechte und Gruppen) */
export function PermissionChecks({ value, onChange, inherited = [] }: { value: AppPermission[]; onChange: (v: AppPermission[]) => void; inherited?: AppPermission[] }) {
  return (
    <FormGroup>
      {APP_PERMISSIONS.map(([key, label, hint]) => {
        const base = inherited.includes(key)
        return (
          <FormControlLabel
            key={key}
            sx={{ alignItems: 'flex-start', mb: 1 }}
            control={
              <Checkbox
                sx={{ mt: -0.75 }}
                checked={base || value.includes(key)}
                disabled={base}
                onChange={(e) => onChange(e.target.checked ? [...value, key] : value.filter((x) => x !== key))}
              />
            }
            label={
              <Box>
                <Typography variant="body1">{label}</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {base ? `${hint} – haben ohnehin alle Nebenstellen` : hint}
                </Typography>
              </Box>
            }
          />
        )
      })}
    </FormGroup>
  )
}
