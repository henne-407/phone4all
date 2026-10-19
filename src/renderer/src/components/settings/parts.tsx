/** Bausteine für Einstellungsseiten: Gruppe mit Titel, Zeilen mit Schalter. */

import { Box, Card, Divider, List, ListItem, ListItemText, Stack, Switch, Typography } from '@mui/material'
import { Children, type ReactNode } from 'react'

export function Group({
  title,
  description,
  action,
  children,
}: {
  title?: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  const items = Children.toArray(children).filter(Boolean)
  return (
    <Box sx={{ mb: 3 }}>
      {(title || action) && (
        <Stack direction="row" sx={{ alignItems: 'center', mb: description ? 0.25 : 1, minHeight: 36 }}>
          <Typography variant="subtitle1" sx={{ flex: 1 }}>
            {title}
          </Typography>
          {action}
        </Stack>
      )}
      {description && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.25, whiteSpace: 'pre-line' }}>
          {description}
        </Typography>
      )}
      <Card variant="outlined">
        <List disablePadding>
          {items.map((child, i) => (
            <Box key={i}>
              {i > 0 && <Divider component="li" />}
              {child}
            </Box>
          ))}
        </List>
      </Card>
    </Box>
  )
}

export function SwitchRow({
  title,
  subtitle,
  checked,
  disabled,
  onChange,
  prefix,
}: {
  title: string
  subtitle?: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
  prefix?: ReactNode
}) {
  return (
    <ListItem
      secondaryAction={<Switch edge="end" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />}
      sx={{ pr: 10 }}
    >
      {prefix}
      <ListItemText primary={title} secondary={subtitle} />
    </ListItem>
  )
}

export function Row({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <ListItem secondaryAction={action} sx={{ pr: action ? 10 : 2 }}>
      {children}
    </ListItem>
  )
}

/** Kurze, zufällige ID für neue Konten */
export const newId = (): string => Math.random().toString(16).slice(2, 10)
