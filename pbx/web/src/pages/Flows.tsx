/** Rufabfolgen: Für jede angerufene Nummer der Weg des Anrufs als Ablaufdiagramm. */

import AddIcon from '@mui/icons-material/Add'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { Box, Button, Card, CardContent, Chip, IconButton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material'
import { useEffect } from 'react'
import type { InboundRoute } from '../../../server/model'
import { EmptyState, PageHeader, ViewToggle, describeDestination, useEditor, useViewMode } from '../components/common'
import { FlowDiagram, FlowPalette, NODE_ICONS } from '../components/FlowDiagram'
import { go, takeEditRequest } from '../router'
import { usePbx } from '../state'
import { InboundForm } from './FlowForms'

export default function Flows() {
  const { config } = usePbx()
  const editor = useEditor<InboundRoute>('inbound', 'Rufnummern-Regel', InboundForm)
  const [mode, setMode] = useViewMode('flows')
  const mobile = useMediaQuery(useTheme().breakpoints.down('sm'))
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
        description="So läuft ein Anruf von außen durch die Anlage: von der angerufenen Nummer über Zeitsteuerung und Sprachmenü bis zur Person oder Voicemail. Ein Klick auf einen Schritt öffnet ihn; Zweige hängst du mit dem Stift oder per Drag & Drop aus den Bausteinen um."
        action={
          <>
            <ViewToggle value={mode} onChange={setMode} />
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => editor.openNew()}>
              Rufnummer zuordnen
            </Button>
          </>
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
      {mode === 'list' && (config.inbound.length > 0 || config.trunks.length > 0) && (
        <Card>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Rufnummer</TableCell>
                  {!mobile && <TableCell>Regel</TableCell>}
                  {!mobile && <TableCell>SIP-Konto</TableCell>}
                  <TableCell>Erstes Ziel</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {config.inbound.map((r) => (
                  <TableRow key={r.id} hover sx={{ cursor: 'pointer' }} onClick={() => editor.openItem(r.id)}>
                    <TableCell>
                      <b>{r.number || 'alle Nummern'}</b>
                      {r.caller && <Chip size="small" label={`nur Anrufer ${r.caller}…`} sx={{ ml: 1 }} />}
                    </TableCell>
                    {!mobile && <TableCell>{r.name || '–'}</TableCell>}
                    {!mobile && <TableCell>{trunkName(r.trunk)}</TableCell>}
                    <TableCell>{describeDestination(r.destination, config)}</TableCell>
                  </TableRow>
                ))}
                {config.trunks.map((t) => {
                  const covered = config.inbound.filter((r) => !r.trunk || r.trunk === t.id).map((r) => r.number)
                  const rest = t.numbers.filter((n) => !covered.includes(n))
                  return (
                    <TableRow key={t.id} hover sx={{ cursor: 'pointer', bgcolor: 'background.default', '&:last-child td': { border: 0 } }} onClick={() => go('trunks', t.id)}>
                      <TableCell>{rest.length ? rest.join(', ') : 'alle anderen Nummern'}</TableCell>
                      {!mobile && <TableCell sx={{ color: 'text.secondary' }}>Alle übrigen Anrufe</TableCell>}
                      {!mobile && <TableCell>{t.name}</TableCell>}
                      <TableCell>{describeDestination(t.inbound_default, config)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}
      {mode === 'cards' && (
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 260px' }, alignItems: 'start' }}>
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
                onChange={(d) => ['inbound', { ...r, destination: d }]}
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
                  {/* Zwei Konten können gleich heißen – die Nummern machen die Karte eindeutig */}
                  Alle übrigen Anrufe über {t.name}
                  {t.numbers.length > 0 && ` (${t.numbers.join(', ')})`}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
                  Gilt für Nummern ohne eigene Regel. Ändern in den Einstellungen des SIP-Kontos.
                </Typography>
                <FlowDiagram
                  entry={{ title: rest.length ? rest.join(', ') : 'alle anderen Nummern', subtitle: t.name, onOpen: () => go('trunks', t.id) }}
                  dest={t.inbound_default}
                  onChange={(d) => ['trunks', { ...t, inbound_default: d }]}
                />
              </CardContent>
            </Card>
          )
        })}
      </Stack>
      {(config.inbound.length > 0 || config.trunks.length > 0) && (
        <Card sx={{ display: { xs: 'none', lg: 'block' }, position: 'sticky', top: 24, maxHeight: 'calc(100vh - 48px)', overflowY: 'auto' }}>
          <CardContent>
            <FlowPalette />
          </CardContent>
        </Card>
      )}
      </Box>
      )}
      {editor.dialog}
    </Box>
  )
}
