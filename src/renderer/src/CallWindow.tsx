/** Kleines Anruffenster: klingelnder Anruf und – ohne Hauptfenster – das ganze Gespräch. */

import OpenInFullIcon from '@mui/icons-material/OpenInFull'
import { Box, IconButton, Stack, Tooltip } from '@mui/material'
import { api, platform } from './api'
import { CallPanel } from './components/CallPanel'
import { useApp } from './state'

export function CallWindow({ callId }: { callId: string }) {
  const { state } = useApp()
  const call = state.calls.find((c) => c.id === callId)
  return (
    <Stack sx={{ height: '100vh', bgcolor: 'background.default', color: 'text.primary' }}>
      <Box
        sx={{
          WebkitAppRegion: 'drag',
          height: 48,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          pl: platform === 'darwin' ? '78px' : 1,
        }}
      >
        <Tooltip title="Im Hauptfenster öffnen">
          <IconButton sx={{ WebkitAppRegion: 'no-drag' }} onClick={() => void api.openInWindow(callId)}>
            <OpenInFullIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      {call && <CallPanel call={call} popup />}
    </Stack>
  )
}
