/** Zeitsteuerung mit Wochenplan als Balkengrafik. */

import ScheduleIcon from '@mui/icons-material/Schedule'
import { Box, Chip, Stack, Tooltip, Typography, useTheme } from '@mui/material'
import { closedReason } from '../../../server/holidays'
import type { TimeCondition } from '../../../server/model'
import { CollectionPage, describeDestination } from '../components/common'
import { usePbx } from '../state'
import { DAYS, TimeForm } from './FlowForms'

const minutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Wochenplan: je Tag ein Balken über 24 Stunden, geöffnete Zeiten farbig */
export function WeekChart({ tc }: { tc: TimeCondition }) {
  const theme = useTheme()
  return (
    <Box>
      {DAYS.map((d, i) => {
        const spans = tc.rules
          .filter((r) => r.days.includes(i + 1))
          .flatMap((r) => {
            const from = minutes(r.from)
            const to = minutes(r.to)
            return from <= to ? [[from, to]] : [[from, 1440], [0, to]]
          })
        return (
          <Stack key={d} direction="row" sx={{ alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography variant="caption" sx={{ width: 22, fontWeight: 600, color: 'text.secondary' }}>
              {d}
            </Typography>
            <Box sx={{ position: 'relative', flex: 1, height: 12, borderRadius: 6, bgcolor: theme.m3.outlineVariant, overflow: 'hidden' }}>
              {spans.map(([from, to], j) => (
                <Tooltip key={j} title={`${String(Math.floor(from / 60)).padStart(2, '0')}:${String(from % 60).padStart(2, '0')}–${String(Math.floor(to / 60)).padStart(2, '0')}:${String(to % 60).padStart(2, '0')}`}>
                  <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: `${(from / 1440) * 100}%`, width: `${((to - from) / 1440) * 100}%`, bgcolor: theme.m3.node.timecondition }} />
                </Tooltip>
              ))}
            </Box>
          </Stack>
        )
      })}
      <Stack direction="row" sx={{ justifyContent: 'space-between', ml: 3.75, mt: 0.25 }}>
        {['0', '6', '12', '18', '24'].map((h) => (
          <Typography key={h} variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>
            {h}
          </Typography>
        ))}
      </Stack>
    </Box>
  )
}

export default function TimeConditions() {
  const { config } = usePbx()
  return (
    <CollectionPage<TimeCondition>
      kind="timeconditions"
      overline="Eingehende Anrufe"
      title="Zeitsteuerung"
      singular="Zeitsteuerung"
      description="Öffnungszeiten mit den Feiertagen des Bundeslandes und Betriebsferien. Am Telefon schaltet *28 mit der Nummer der Zeitsteuerung manuell um (Nachtschaltung)."
      emptyText="Mit einer Zeitsteuerung gehen Anrufe außerhalb der Öffnungszeiten z. B. auf eine Ansage oder die Voicemail."
      emptyIcon={<ScheduleIcon />}
      card={(t) => {
        const closed = closedReason(t, new Date(), config.system.state, config.system.timezone)
        return (
          <Box>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1.5 }}>
              <Typography variant="h6" sx={{ flex: 1 }}>
                {t.name}
              </Typography>
              <Chip size="small" variant="outlined" label={`*28${config.timeconditions.indexOf(t) + 1}`} sx={{ fontFamily: 'monospace' }} />
            </Stack>
            <Stack direction="row" sx={{ gap: 1, mb: 2, flexWrap: 'wrap' }}>
              <Chip size="small" color={closed ? 'warning' : 'success'} label={closed ? `Jetzt geschlossen: ${closed}` : 'Jetzt geöffnet'} />
              {t.override !== 'auto' && <Chip size="small" color="info" label="Manuell geschaltet" />}
            </Stack>
            <WeekChart tc={t} />
            <Typography variant="body2" sx={{ mt: 1.5 }}>
              <b>Geöffnet:</b> {describeDestination(t.open, config)}
              <br />
              <b>Geschlossen:</b> {describeDestination(t.closed, config)}
            </Typography>
          </Box>
        )
      }}
      Form={TimeForm}
    />
  )
}
