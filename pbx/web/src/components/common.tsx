/** Bausteine der Oberfläche: Seitenkopf, Karten, Listen-Seiten mit Bearbeiten-Dialog. */

import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Fab,
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
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { type ReactNode, useState } from 'react'
import { type CollectionName, DESTINATION_LABELS, type Destination, type DestinationType, blankItem } from '../../../server/model'
import { usePbx } from '../state'

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'flex-start', mb: 3, gap: 2 }}>
      <Box sx={{ flex: 1 }}>
        <Typography variant="h5" component="h1">
          {title}
        </Typography>
        {description && (
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, maxWidth: 760 }}>
            {description}
          </Typography>
        )}
      </Box>
      {action}
    </Stack>
  )
}

export function Section({ title, description, children, action }: { title?: string; description?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card sx={{ mb: 2 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 }, '&:last-child': { pb: { xs: 2, sm: 3 } } }}>
        {(title || action) && (
          <Stack direction="row" sx={{ alignItems: 'center', mb: description ? 0.5 : 2 }}>
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

export interface Column<T> {
  label: string
  render: (item: T) => ReactNode
  hideOnMobile?: boolean
}

/**
 * Liste mit Tabelle, „Neu“-Knopf und Bearbeiten-Dialog. Das Formular bekommt eine
 * Arbeitskopie und meldet Änderungen per onChange.
 */
export function CollectionPage<T extends { id: string }>({
  kind,
  title,
  description,
  singular,
  columns,
  Form,
  newItem,
  emptyText,
  extraActions,
}: {
  kind: CollectionName
  title: string
  description?: string
  singular: string
  columns: Column<T>[]
  Form: (props: { value: T; onChange: (v: T) => void; isNew: boolean }) => ReactNode
  newItem?: () => Partial<T>
  emptyText?: string
  extraActions?: (item: T) => ReactNode
}) {
  const pbx = usePbx()
  const items = pbx.config[kind] as unknown as T[]
  const [editing, setEditing] = useState<T | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const theme = useTheme()
  const mobile = useMediaQuery(theme.breakpoints.down('sm'))
  const isNew = Boolean(editing && !editing.id)

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

  const visible = columns.filter((c) => !(mobile && c.hideOnMobile))
  return (
    <Box>
      <PageHeader
        title={title}
        description={description}
        action={
          !mobile && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({ ...blankItem(kind), ...newItem?.(), id: '' } as unknown as T)}>
              {singular} anlegen
            </Button>
          )
        }
      />
      <Card>
        {items.length ? (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  {visible.map((c) => (
                    <TableCell key={c.label} sx={{ color: 'text.secondary', fontWeight: 500 }}>
                      {c.label}
                    </TableCell>
                  ))}
                  {extraActions && <TableCell />}
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id} hover sx={{ cursor: 'pointer', '&:last-child td': { border: 0 } }} onClick={() => setEditing(structuredClone(item))}>
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
        ) : (
          <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>{emptyText ?? `Noch keine Einträge.`}</Box>
        )}
      </Card>
      {mobile && (
        <Fab
          color="primary"
          variant="extended"
          sx={{ position: 'fixed', right: 16, bottom: 16 }}
          onClick={() => setEditing({ ...blankItem(kind), ...newItem?.(), id: '' } as unknown as T)}
        >
          <AddIcon sx={{ mr: 1 }} />
          {singular}
        </Fab>
      )}
      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} fullWidth maxWidth="md" fullScreen={mobile}>
        <DialogTitle>{isNew ? `${singular} anlegen` : `${singular} bearbeiten`}</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          {editing && <Form value={editing} onChange={setEditing} isNew={isNew} />}
        </DialogContent>
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
