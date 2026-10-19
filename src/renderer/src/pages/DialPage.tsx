/** Wählen: Nummernfeld mit Tastatureingabe, Kontaktvorschlägen und Wahlwiederholung. */

import BackspaceIcon from '@mui/icons-material/BackspaceOutlined'
import CallIcon from '@mui/icons-material/Call'
import {
  Box,
  Button,
  Card,
  Collapse,
  IconButton,
  InputBase,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { formatTime } from '../../../shared/format'
import { contactNumbers, hasDigit, normalizeNumber } from '../../../shared/numbers'
import type { Contact } from '../../../shared/types'
import { api } from '../api'
import { ContactAvatar, DialPad, RoundAction } from '../components/common'
import { useApp } from '../state'

interface Row {
  name: string
  number: string
  extra: string
}

function Suggestions({ text, onPick }: { text: string; onPick: (n: string) => void }) {
  const { history, state } = useApp()
  const [matches, setMatches] = useState<Contact[]>([])
  useEffect(() => {
    let current = true
    if (text) void api.searchContacts(text, 50).then((r) => current && setMatches(r.items))
    return () => {
      current = false
    }
  }, [text, state.contactsVersion])

  let rows: Row[]
  if (text) {
    rows = matches.flatMap((c) => contactNumbers(c).map((n) => ({ name: c.name, number: n, extra: c.company || c.source || '' })))
  } else {
    const seen = new Set<string>()
    rows = []
    for (const e of history) {
      if (seen.has(e.number)) continue
      seen.add(e.number)
      rows.push({ name: e.contactName || e.name || e.number, number: e.number, extra: formatTime(e.time) })
      if (rows.length >= 50) break
    }
  }
  return (
    <Card sx={{ width: 380, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0, p: 2, mb: 2 }}>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        {text ? `Treffer für „${text}“` : 'Zuletzt gewählt und angerufen'}
      </Typography>
      {rows.length ? (
        <List dense disablePadding sx={{ overflowY: 'auto' }}>
          {rows.map((r) => (
            <ListItem
              key={r.name + r.number}
              disablePadding
              secondaryAction={
                <IconButton edge="end" aria-label={`${r.number} anrufen`} sx={{ color: 'success.main' }} onClick={() => void api.dial(r.number)}>
                  <CallIcon />
                </IconButton>
              }
            >
              <Tooltip title="Nummer übernehmen" placement="top-start">
                <ListItemButton onClick={() => onPick(r.number)}>
                  <ListItemAvatar sx={{ minWidth: 48 }}>
                    <ContactAvatar name={r.name !== r.number ? r.name : ''} size={36} />
                  </ListItemAvatar>
                  <ListItemText
                    primary={r.name}
                    secondary={r.name !== r.number ? [r.number, r.extra].filter(Boolean).join(' · ') : r.extra}
                    slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
                  />
                </ListItemButton>
              </Tooltip>
            </ListItem>
          ))}
        </List>
      ) : (
        <Typography sx={{ color: 'text.secondary' }}>{text ? 'Keine passenden Kontakte.' : 'Noch keine Anrufe.'}</Typography>
      )}
    </Card>
  )
}

export function DialPage({ wide }: { wide: boolean }) {
  const { history } = useApp()
  const [number, setNumber] = useState('')
  const [match, setMatch] = useState<{ label: string; number: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.focus(), [])

  // Kontaktvorschlag beim Tippen
  useEffect(() => {
    let current = true
    const text = number.trim()
    if (text.length < 2) {
      setMatch(null)
      return
    }
    void api.searchContacts(text, 2).then(({ items, total }) => {
      if (!current) return
      const c = items[0]
      const n = c ? c.phone || c.mobile || contactNumbers(c)[0] : ''
      setMatch(c && n ? { label: `${c.name} · ${n}${total > 1 ? `  (+${total - 1})` : ''}`, number: n } : null)
    })
    return () => {
      current = false
    }
  }, [number])

  // Ziffern landen immer im Eingabefeld, auch ohne Fokus
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || document.activeElement === input.current) return
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return
      if (/^[0-9*#+]$/.test(e.key)) {
        e.preventDefault()
        insert(e.key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const insert = (digit: string): void => {
    const el = input.current
    if (!el) return setNumber((n) => n + digit)
    const start = el.selectionStart ?? number.length
    const end = el.selectionEnd ?? number.length
    const next = number.slice(0, start) + digit + number.slice(end)
    setNumber(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + digit.length, start + digit.length)
    })
  }

  const backspace = (): void => {
    const el = input.current
    const start = el?.selectionStart ?? number.length
    const end = el?.selectionEnd ?? number.length
    if (start !== end) setNumber(number.slice(0, start) + number.slice(end))
    else if (start > 0) setNumber(number.slice(0, start - 1) + number.slice(start))
  }

  const dial = async (): Promise<void> => {
    let n = number.trim()
    if (!n) {
      // Wahlwiederholung: letzte gewählte Nummer eintragen
      const last = history.find((e) => e.direction === 'out')
      if (last) setNumber(last.number)
      return
    }
    if (match && !hasDigit(n)) n = match.number
    if (await api.dial(n)) setNumber('')
  }

  return (
    <Stack direction="row" sx={{ flex: 1, minHeight: 0, gap: 2, px: wide ? 2 : 0 }}>
      <Stack sx={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 1.5, overflowY: 'auto', py: 2 }}>
        <Stack direction="row" sx={{ alignItems: 'center', width: 320, gap: 0.5 }}>
          <Box sx={{ width: 40 }} />
          <InputBase
            inputRef={input}
            value={number}
            placeholder="Nummer"
            onChange={(e) => setNumber(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void dial()}
            slotProps={{ input: { inputMode: 'tel', style: { textAlign: 'center' }, 'aria-label': 'Nummer' } }}
            sx={{ flex: 1, fontSize: 32, '& input::placeholder': { fontSize: 24 } }}
          />
          <Tooltip title="Löschen (gedrückt halten: alles)">
            <IconButton
              aria-label="Löschen"
              onClick={backspace}
              onContextMenu={(e) => {
                e.preventDefault()
                setNumber('')
              }}
              sx={{ visibility: number ? 'visible' : 'hidden' }}
            >
              <BackspaceIcon />
            </IconButton>
          </Tooltip>
        </Stack>
        <Box sx={{ minHeight: 36 }}>
          <Collapse in={Boolean(match)}>
            <Button size="small" onClick={() => match && setNumber(normalizeNumber(match.number))}>
              {match?.label}
            </Button>
          </Collapse>
        </Box>
        <DialPad onDigit={insert} />
        <Box sx={{ mt: 1.5 }}>
          <RoundAction kind="call" icon={<CallIcon />} label="Anrufen" size={72} onClick={() => void dial()} />
        </Box>
      </Stack>
      {wide && <Suggestions text={number.trim()} onPick={(n) => setNumber(n)} />}
    </Stack>
  )
}
