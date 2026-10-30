/** Ansagen und Wartemusik */

import CampaignIcon from '@mui/icons-material/Campaign'
import type { Announcement } from '../../../server/model'
import { CollectionPage, describeDestination } from '../components/common'
import { usePbx } from '../state'
import { AnnouncementForm, MohCard } from './FlowForms'

export default function Announcements() {
  const { config } = usePbx()
  return (
    <CollectionPage<Announcement>
      kind="announcements"
      overline="Eingehende Anrufe"
      title="Ansagen und Musik"
      singular="Ansage"
      description="Begrüßungen, Menüansagen und Hinweise (z. B. Betriebsferien). Hochladen oder direkt im Browser aufnehmen."
      emptyText="Ansagen begrüßen Anrufer oder erklären ein Sprachmenü."
      emptyIcon={<CampaignIcon />}
      columns={[
        { label: 'Name', render: (a) => <b>{a.name}</b> },
        {
          label: 'Anhören',
          render: (a) => (a.file ? <audio controls preload="none" src={`/api/sounds/custom/${a.file}.wav`} style={{ height: 32 }} onClick={(e) => e.stopPropagation()} /> : 'Datei fehlt'),
        },
        { label: 'Danach', hideOnMobile: true, render: (a) => describeDestination(a.next, config) },
      ]}
      Form={AnnouncementForm}
      after={<MohCard />}
    />
  )
}
