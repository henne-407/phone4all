/** Rufabfolgen: Für jede angerufene Nummer der Weg des Anrufs als Ablaufdiagramm. */

import AddIcon from '@mui/icons-material/Add'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { Box, Button, Card, CardContent, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { useEffect } from 'react'
import type { InboundRoute } from '../../../server/model'
import { EmptyState, PageHeader, useEditor } from '../components/common'
import { FlowDiagram, NODE_ICONS } from '../components/FlowDiagram'
import { go, takeEditRequest } from '../router'
import { usePbx } from '../state'
import { InboundForm } from './FlowForms'

export default function Flows() {
  const { config } = usePbx()
  const editor = useEditor<InboundRoute>('inbound', 'Rufnummern-Regel', InboundForm)
  useEffect(() => {
    const id = takeEditRequest('flows')
    if (id === 'new') editor.openNew()
    else if (id) editor.openItem(id)
  }, [])

  const trunkName = (id: string): string => config.trunks.find((t) => t.id === id)?.name ?? 'alle SIP-Konten'
  return (
    <Box>
      <PageHeader
        overline="Eingehende Anrufe"
        title="Rufabfolgen"
        description="So läuft ein Anruf von außen durch die Anlage: von der angerufenen Nummer über Zeitsteuerung und Sprachmenü bis zur Person oder Voicemail. Ein Klick auf einen Schritt öffnet ihn zum Bearbeiten."
        action={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => editor.openNew()}>
            Rufnummer zuordnen
          </Button>
        }
      />
      {!config.trunks.length && !config.inbound.length && (
        <EmptyState
          icon={NODE_ICONS.number}
          title="Noch keine Rufnummern"
          text="Lege zuerst ein SIP-Konto mit deinen Rufnummern an. Danach legst du hier fest, wohin Anrufe auf jede Nummer gehen."
          action={
            <Button variant="contained" onClick={() => go('trunks', 'new')}>
              SIP-Konto anlegen
            </Button>
          }
        />
      )}
      <Stack sx={{ gap: 2 }}>
        {config.inbound.map((r) => (
          <Card key={r.id}>
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <Stack direction="row" sx={{ alignItems: 'center', mb: 2, gap: 1 }}>
                <Typography variant="h6" sx={{ flex: 1 }}>
                  {r.name || r.number || 'Regel'}
                </Typography>
                {r.caller && <Chip size="small" label={`nur Anrufer ${r.caller}…`} />}
                <Tooltip title="Regel bearbeiten">
                  <IconButton onClick={() => editor.openItem(r.id)}>
                    <EditOutlinedIcon />
                  </IconButton>
                </Tooltip>
              </Stack>
              <FlowDiagram
                entry={{
                  title: r.number || 'alle Nummern',
                  subtitle: `über ${trunkName(r.trunk)}${r.name_prefix ? ` · Anzeige „${r.name_prefix}…“` : ''}`,
                  onOpen: () => editor.openItem(r.id),
                }}
                dest={r.destination}
              />
            </CardContent>
          </Card>
        ))}
        {config.trunks.map((t) => {
          const covered = config.inbound.filter((r) => !r.trunk || r.trunk === t.id).map((r) => r.number)
          const rest = t.numbers.filter((n) => !covered.includes(n))
          return (
            <Card key={t.id} sx={{ bgcolor: 'background.default' }}>
              <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
                <Typography variant="h6" sx={{ mb: 0.5 }}>
                  Alle übrigen Anrufe über {t.name}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
                  Gilt für Nummern ohne eigene Regel. Ändern in den Einstellungen des SIP-Kontos.
                </Typography>
                <FlowDiagram
                  entry={{ title: rest.length ? rest.join(', ') : 'alle anderen Nummern', subtitle: t.name, onOpen: () => go('trunks', t.id) }}
                  dest={t.inbound_default}
                />
              </CardContent>
            </Card>
          )
        })}
      </Stack>
      {editor.dialog}
    </Box>
  )
}
