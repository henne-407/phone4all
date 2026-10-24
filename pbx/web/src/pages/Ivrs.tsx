/** Sprachmenüs als Tastenfeld mit Zielen. */

import DialpadIcon from '@mui/icons-material/Dialpad'
import { Box, Stack, Typography, useTheme } from '@mui/material'
import type { Ivr } from '../../../server/model'
import { CollectionPage, describeDestination } from '../components/common'
import { usePbx } from '../state'
import { IvrForm } from './FlowForms'

export default function Ivrs() {
  const { config } = usePbx()
  const theme = useTheme()
  return (
    <CollectionPage<Ivr>
      kind="ivrs"
      overline="Eingehende Anrufe"
      title="Sprachmenüs"
      singular="Sprachmenü"
      description="„Für den Vertrieb drücken Sie die 1 …“ – Anrufer wählen per Taste ihr Ziel. Die Ansage legst du unter „Ansagen“ an."
      emptyText="Ein Sprachmenü verteilt Anrufer per Tastendruck an Abteilungen."
      emptyIcon={<DialpadIcon />}
      columns={[
        { label: 'Name', render: (i) => <b>{i.name}</b> },
        { label: 'Intern', render: (i) => i.number || '–', hideOnMobile: true },
        { label: 'Ansage', render: (i) => config.announcements.find((a) => a.id === i.announcement)?.name ?? 'Ohne Ansage', hideOnMobile: true },
        {
          label: 'Tasten',
          render: (i) =>
            i.options.length ? (
              <Stack sx={{ gap: 0.25 }}>
                {i.options.map((o) => (
                  <Typography key={o.digit} variant="body2">
                    <b>{o.digit}</b> {describeDestination(o.destination, config)}
                  </Typography>
                ))}
              </Stack>
            ) : (
              '–'
            ),
        },
      ]}
      card={(i) => (
        <Box>
          <Typography variant="h6">{i.name}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
            {config.announcements.find((a) => a.id === i.announcement)?.name ?? 'Ohne Ansage'}
            {i.number && ` · intern ${i.number}`}
          </Typography>
          {i.options.map((o) => (
            <Stack key={o.digit} direction="row" sx={{ alignItems: 'center', gap: 1.5, mb: 0.75 }}>
              <Box
                sx={{
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 700,
                  bgcolor: theme.m3.primaryContainer,
                  color: theme.m3.onPrimaryContainer,
                  flexShrink: 0,
                }}
              >
                {o.digit}
              </Box>
              <Typography variant="body2">{describeDestination(o.destination, config)}</Typography>
            </Stack>
          ))}
          {!i.options.length && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Noch keine Tasten belegt
            </Typography>
          )}
        </Box>
      )}
      Form={IvrForm}
    />
  )
}
