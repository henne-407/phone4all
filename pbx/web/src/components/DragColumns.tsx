/**
 * Zwei Spalten zum Ziehen: links die gewählten Einträge in Reihenfolge, rechts die
 * übrigen. Ziehen ordnet um bzw. nimmt auf oder heraus; die Knöpfe tun dasselbe per
 * Klick (Tastatur, Touch).
 */

import AddIcon from '@mui/icons-material/Add'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import CloseIcon from '@mui/icons-material/Close'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import { Box, IconButton, Stack, Tooltip, Typography, useTheme } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { type ReactNode, useState } from 'react'

const DRAG_TYPE = 'application/x-p4a-item'

export function DragColumns<T extends string>({
  options,
  value,
  onChange,
  icons,
  chosenTitle,
  restTitle,
  emptyText,
}: {
  options: [T, string][]
  value: T[]
  onChange: (v: T[]) => void
  icons?: Partial<Record<T, ReactNode>>
  chosenTitle: string
  restTitle: string
  emptyText: string
}) {
  const theme = useTheme()
  // Zielposition während des Ziehens: Index in „gewählt“ oder -1 für „übrig“
  const [target, setTarget] = useState<number | null>(null)
  const label = (k: T): string => options.find(([o]) => o === k)?.[1] ?? k
  const rest = options.map(([k]) => k).filter((k) => !value.includes(k))

  const drop = (key: T, index: number): void => {
    setTarget(null)
    const without = value.filter((k) => k !== key)
    if (index < 0) return onChange(without)
    // Beim Verschieben nach unten rückt der Index um den entfernten Eintrag nach
    const from = value.indexOf(key)
    const at = from >= 0 && from < index ? index - 1 : index
    onChange([...without.slice(0, at), key, ...without.slice(at)])
  }
  const onDragOver = (index: number) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (target !== index) setTarget(index)
  }
  const onDrop = (index: number) => (e: React.DragEvent) => {
    const key = e.dataTransfer.getData(DRAG_TYPE) as T
    if (!key) return
    e.preventDefault()
    e.stopPropagation()
    drop(key, index)
  }

  const item = (k: T, i: number | null) => {
    const chosen = i !== null
    return (
      <Box key={k} onDragOver={chosen ? onDragOver(i) : undefined} onDrop={chosen ? onDrop(i) : undefined} sx={{ position: 'relative' }}>
        {chosen && target === i && <Box sx={{ position: 'absolute', top: -4, left: 0, right: 0, height: 3, borderRadius: 2, bgcolor: 'primary.main' }} />}
        <Stack
          direction="row"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_TYPE, k)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => setTarget(null)}
          sx={{
            alignItems: 'center',
            gap: 1,
            pl: 0.5,
            pr: 0.25,
            minHeight: 40,
            borderRadius: 2,
            border: `1px solid ${theme.m3.outlineVariant}`,
            bgcolor: chosen ? 'background.paper' : 'transparent',
            cursor: 'grab',
            userSelect: 'none',
            transition: 'box-shadow .15s, border-color .15s',
            '&:hover': { borderColor: theme.m3.outline, boxShadow: chosen ? `0 1px 4px ${alpha(theme.m3.outline, 0.5)}` : 'none' },
            '&:active': { cursor: 'grabbing' },
          }}
        >
          <DragIndicatorIcon fontSize="small" sx={{ color: 'text.disabled' }} />
          {icons?.[k] && <Box sx={{ display: 'flex', color: chosen ? 'primary.main' : 'text.secondary', '& svg': { fontSize: 20 } }}>{icons[k]}</Box>}
          <Typography variant="body2" sx={{ flex: 1, fontWeight: chosen ? 600 : 400, color: chosen ? 'text.primary' : 'text.secondary' }}>
            {label(k)}
          </Typography>
          {chosen ? (
            <>
              <IconButton size="small" aria-label="Nach oben" disabled={i === 0} onClick={() => drop(k, i - 1)}>
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" aria-label="Nach unten" disabled={i === value.length - 1} onClick={() => drop(k, i + 2)}>
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
              <Tooltip title="Ausblenden">
                <IconButton size="small" onClick={() => drop(k, -1)}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          ) : (
            <Tooltip title="Hinzufügen">
              <IconButton size="small" onClick={() => drop(k, value.length)}>
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      </Box>
    )
  }

  const column = (title: string, children: ReactNode, index: number, highlight: boolean) => (
    <Box
      onDragOver={onDragOver(index)}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setTarget(null)
      }}
      onDrop={onDrop(index)}
      sx={{
        p: 1.25,
        borderRadius: 3,
        border: '1px dashed',
        borderColor: highlight ? 'primary.main' : theme.m3.outlineVariant,
        bgcolor: highlight ? alpha(theme.palette.primary.main, 0.05) : theme.m3.surfaceVariant,
        transition: 'background-color .15s, border-color .15s',
        minHeight: 80,
      }}
    >
      <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 2, display: 'block', mb: 0.5 }}>
        {title}
      </Typography>
      <Stack sx={{ gap: 0.75 }}>{children}</Stack>
    </Box>
  )

  return (
    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
      {column(
        chosenTitle,
        value.length ? (
          value.map((k, i) => item(k, i))
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary', py: 1 }}>
            {emptyText}
          </Typography>
        ),
        value.length,
        target !== null && target >= 0 && target === value.length,
      )}
      {column(restTitle, rest.length ? rest.map((k) => item(k, null)) : <Typography variant="body2" sx={{ color: 'text.secondary', py: 1 }}>Alles ausgewählt</Typography>, -1, target === -1)}
    </Box>
  )
}
