/**
 * Auswertungen: Kennzahlen, Anrufe je Stunde und Wochentag (angenommen/nicht angenommen
 * gestapelt), Annahmequote je Rufnummer, Nebenstellen und Warteschlangen, CSV-Export.
 */

import DownloadIcon from '@mui/icons-material/Download'
import { Box, Button, Card, CardContent, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useTheme } from '@mui/material'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { PageHeader, Section, formatDuration } from '../components/common'

interface Counter {
  total: number
  answered: number
}

interface StatsReport {
  totals: { inbound: number; answered: number; missed: number; voicemail: number; outbound: number; internal: number; avg_talk: number }
  by_hour: Counter[]
  by_weekday: Counter[]
  by_number: (Counter & { number: string })[]
  by_extension: { number: string; name: string; answered: number; outbound: number; talk: number }[]
  queues: { id: string; name: string; calls: number; answered: number; abandoned: number; avg_wait: number; max_wait: number }[]
}

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const WEEKDAY_NAMES = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']

/** Kategoriefarben (geprüfte Reihenfolge, je Modus eigene Stufen): angenommen, nicht angenommen */
const SERIES = { light: ['#2a78d6', '#eb6834'], dark: ['#3987e5', '#d95926'] }

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function percent(part: number, total: number): string {
  return total ? `${Math.round((part / total) * 100)} %` : '–'
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card variant="outlined" sx={{ flex: '1 1 160px', minWidth: 0 }}>
      <CardContent>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {label}
        </Typography>
        <Typography variant="h4" sx={{ fontWeight: 600, my: 0.5 }}>
          {value}
        </Typography>
        {hint && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {hint}
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}

/** Gestapelte Säulen: unten angenommen, oben nicht angenommen; Hinweis beim Darüberfahren */
function Columns({ data, labels, names = labels, title }: { data: Counter[]; labels: string[]; names?: string[]; title: string }) {
  const theme = useTheme()
  const [answered, missed] = SERIES[theme.palette.mode]
  const surface = theme.palette.background.paper
  const max = Math.max(1, ...data.map((d) => d.total))
  const height = 160
  return (
    <Box>
      <Stack direction="row" sx={{ gap: 2, mb: 1.5, flexWrap: 'wrap' }} aria-hidden>
        {[
          [answered, 'angenommen'],
          [missed, 'nicht angenommen'],
        ].map(([color, text]) => (
          <Stack key={text} direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: color }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {text}
            </Typography>
          </Stack>
        ))}
      </Stack>
      <Box role="img" aria-label={`${title}: ${data.map((d, i) => `${names[i]} ${d.total} Anrufe, ${d.answered} angenommen`).join('; ')}`}>
        <Stack direction="row" sx={{ alignItems: 'flex-end', height, borderBottom: 1, borderColor: 'divider', gap: '2px' }}>
          {data.map((d, i) => {
            const h = (d.total / max) * height
            const a = d.total ? (d.answered / d.total) * h : 0
            return (
              <Tooltip
                key={labels[i]}
                arrow
                title={`${names[i]}: ${d.total} ${d.total === 1 ? 'Anruf' : 'Anrufe'}, ${d.answered} angenommen (${percent(d.answered, d.total)})`}
              >
                {/* Trefferfläche über die ganze Höhe, damit auch kleine Säulen leicht zu treffen sind */}
                <Box sx={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', cursor: 'default', '&:hover > div': { opacity: 0.85 } }}>
                  <Box sx={{ width: '100%', maxWidth: 24, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: h }}>
                    {h - a > 0 && <Box sx={{ height: h - a, bgcolor: missed, borderRadius: '4px 4px 0 0', borderBottom: a > 0 ? `2px solid ${surface}` : 'none' }} />}
                    {a > 0 && <Box sx={{ height: a, bgcolor: answered, borderRadius: h - a > 0 ? 0 : '4px 4px 0 0' }} />}
                  </Box>
                </Box>
              </Tooltip>
            )
          })}
        </Stack>
        <Stack direction="row" sx={{ gap: '2px', mt: 0.5 }}>
          {labels.map((l, i) => (
            <Typography key={l} variant="caption" sx={{ flex: 1, textAlign: 'center', color: 'text.secondary', visibility: data.length > 12 && i % 3 ? 'hidden' : 'visible' }}>
              {l}
            </Typography>
          ))}
        </Stack>
      </Box>
    </Box>
  )
}

/** Dieselben Zahlen als Tabelle (für Bildschirmleser und zum Nachlesen) */
function CounterTable({ data, labels, head }: { data: Counter[]; labels: string[]; head: string }) {
  return (
    <TableContainer sx={{ maxHeight: 260 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>{head}</TableCell>
            <TableCell align="right">Anrufe</TableCell>
            <TableCell align="right">angenommen</TableCell>
            <TableCell align="right">Quote</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {data.map((d, i) => (
            <TableRow key={labels[i]}>
              <TableCell>{labels[i]}</TableCell>
              <TableCell align="right">{d.total}</TableCell>
              <TableCell align="right">{d.answered}</TableCell>
              <TableCell align="right">{percent(d.answered, d.total)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

function Distribution({ title, data, labels, names = labels, head }: { title: string; data: Counter[]; labels: string[]; names?: string[]; head: string }) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  return (
    <Section
      title={title}
      action={
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_e, v: 'chart' | 'table' | null) => v && setView(v)}>
          <ToggleButton value="chart">Diagramm</ToggleButton>
          <ToggleButton value="table">Tabelle</ToggleButton>
        </ToggleButtonGroup>
      }
    >
      {view === 'chart' ? <Columns data={data} labels={labels} names={names} title={title} /> : <CounterTable data={data} labels={names} head={head} />}
    </Section>
  )
}

export default function Stats() {
  const today = new Date()
  const [from, setFrom] = useState(isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29)))
  const [to, setTo] = useState(isoDay(today))
  const [report, setReport] = useState<StatsReport | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    setError('')
    api
      .get<StatsReport>(`/api/stats?from=${from}&to=${to}`)
      .then(setReport)
      .catch((e: Error) => setError(e.message))
  }, [from, to])
  const preset = (days: number): void => {
    const d = new Date()
    setFrom(isoDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - days + 1)))
    setTo(isoDay(d))
  }
  const t = report?.totals
  return (
    <Box>
      <PageHeader
        overline="Auswertung und System"
        title="Auswertungen"
        description="Wann die meisten anrufen, wie viele Anrufe niemand annimmt und wer wie viel telefoniert. Grundlage ist die Anrufliste der Anlage."
        action={
          <Button startIcon={<DownloadIcon />} href={`/api/stats/csv?from=${from}&to=${to}`} variant="outlined">
            Als CSV
          </Button>
        }
      />
      <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 3 }}>
        <TextField type="date" size="small" label="Von" sx={{ width: 180 }} value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField type="date" size="small" label="Bis" sx={{ width: 180 }} value={to} onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <Stack direction="row" sx={{ gap: 1 }}>
          <Button size="small" onClick={() => preset(7)}>
            7 Tage
          </Button>
          <Button size="small" onClick={() => preset(30)}>
            30 Tage
          </Button>
          <Button size="small" onClick={() => preset(365)}>
            1 Jahr
          </Button>
        </Stack>
      </Stack>
      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}
      {report && t && (
        <Stack sx={{ gap: 3 }}>
          <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap' }}>
            <Tile label="Anrufe von außen" value={String(t.inbound)} hint={`${t.outbound} nach außen, ${t.internal} intern`} />
            <Tile label="Angenommen" value={percent(t.answered, t.inbound)} hint={`${t.answered} von ${t.inbound}`} />
            <Tile label="Nicht angenommen" value={String(t.missed)} hint={t.voicemail ? `davon ${t.voicemail} auf der Voicemail` : 'keiner auf der Voicemail'} />
            <Tile label="Ø Gesprächsdauer" value={t.answered ? formatDuration(t.avg_talk) : '–'} hint="angenommene Anrufe von außen" />
          </Stack>
          <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', lg: '3fr 2fr' } }}>
            <Distribution
              title="Anrufe von außen je Uhrzeit"
              data={report.by_hour}
              labels={report.by_hour.map((_d, i) => String(i))}
              names={report.by_hour.map((_d, i) => `${i}–${i + 1} Uhr`)}
              head="Stunde"
            />
            <Distribution title="Je Wochentag" data={report.by_weekday} labels={WEEKDAYS} names={WEEKDAY_NAMES} head="Wochentag" />
          </Box>
          <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' } }}>
            <Section title="Je angerufener Nummer">
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Nummer</TableCell>
                      <TableCell align="right">Anrufe</TableCell>
                      <TableCell align="right">angenommen</TableCell>
                      <TableCell align="right">Quote</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.by_number.map((n) => (
                      <TableRow key={n.number}>
                        <TableCell>{n.number || '–'}</TableCell>
                        <TableCell align="right">{n.total}</TableCell>
                        <TableCell align="right">{n.answered}</TableCell>
                        <TableCell align="right">{percent(n.answered, n.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {!report.by_number.length && <Typography sx={{ color: 'text.secondary', p: 2 }}>Keine Anrufe im Zeitraum.</Typography>}
            </Section>
            <Section title="Je Nebenstelle">
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Nebenstelle</TableCell>
                      <TableCell align="right">angenommen</TableCell>
                      <TableCell align="right">nach außen</TableCell>
                      <TableCell align="right">Gesprächszeit</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.by_extension.map((e) => (
                      <TableRow key={e.number}>
                        <TableCell>
                          {e.number} {e.name}
                        </TableCell>
                        <TableCell align="right">{e.answered}</TableCell>
                        <TableCell align="right">{e.outbound}</TableCell>
                        <TableCell align="right">{formatDuration(e.talk)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {!report.by_extension.length && <Typography sx={{ color: 'text.secondary', p: 2 }}>Keine Gespräche im Zeitraum.</Typography>}
            </Section>
          </Box>
          {report.queues.length > 0 && (
            <Section title="Warteschlangen" description="Wartezeit bis zum Annehmen oder Auflegen">
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Gruppe</TableCell>
                      <TableCell align="right">Anrufe</TableCell>
                      <TableCell align="right">angenommen</TableCell>
                      <TableCell align="right">aufgelegt</TableCell>
                      <TableCell align="right">Ø Wartezeit</TableCell>
                      <TableCell align="right">längste</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.queues.map((q) => (
                      <TableRow key={q.id}>
                        <TableCell>{q.name}</TableCell>
                        <TableCell align="right">{q.calls}</TableCell>
                        <TableCell align="right">{q.answered}</TableCell>
                        <TableCell align="right">{q.abandoned}</TableCell>
                        <TableCell align="right">{formatDuration(q.avg_wait)}</TableCell>
                        <TableCell align="right">{formatDuration(q.max_wait)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Section>
          )}
        </Stack>
      )}
    </Box>
  )
}
