/** Anrufsperren: unerwünschte Anrufer und Anrufe ohne Rufnummer abweisen */

import BlockIcon from '@mui/icons-material/Block'
import { TextField } from '@mui/material'
import type { BlockedNumber, BlockingSettings } from '../../../server/model'
import { ChangesBar, CollectionPage, FormGrid, Section, Select, useDraft } from '../components/common'
import { usePbx } from '../state'

function BlockedForm({ value, onChange }: { value: BlockedNumber; onChange: (v: BlockedNumber) => void }) {
  const set = <K extends keyof BlockedNumber>(k: K, v: BlockedNumber[K]): void => onChange({ ...value, [k]: v })
  return (
    <FormGrid>
      <TextField
        label="Rufnummer"
        value={value.number}
        onChange={(e) => set('number', e.target.value)}
        required
        autoFocus
        helperText="z. B. 030123456 oder +4930123456. Mit * am Ende alle Nummern mit diesem Anfang, z. B. +44*"
      />
      <TextField label="Notiz" value={value.note} onChange={(e) => set('note', e.target.value)} helperText="z. B. „Werbung Energieanbieter“" />
    </FormGrid>
  )
}

function Settings() {
  const { config, saveSection } = usePbx()
  const d = useDraft<BlockingSettings>(config.blocking)
  return (
    <>
      <Section title="Anrufe ohne Rufnummer" description="Anrufer, die ihre Nummer unterdrücken, sind oft Werbung. Abgewiesene Anrufe werden sofort beendet, kein Telefon klingelt.">
        <Select
          label="Anrufe mit unterdrückter Nummer"
          value={d.draft.anonymous}
          onChange={(v) => d.set({ anonymous: v })}
          options={[
            ['allow', 'Annehmen wie andere Anrufe'],
            ['reject', 'Abweisen'],
          ]}
        />
      </Section>
      <ChangesBar dirty={d.dirty} onApply={() => saveSection('blocking', d.draft)} onDiscard={d.reset} />
    </>
  )
}

export default function Blocking() {
  const { config } = usePbx()
  const ext = (n: string): string => config.extensions.find((e) => e.number === n)?.name ?? n
  return (
    <CollectionPage<BlockedNumber>
      kind="blocklist"
      overline="Eingehende Anrufe"
      title="Anrufsperren"
      singular="Sperre"
      description="Gesperrte Rufnummern kommen nicht mehr durch, für alle Nebenstellen. Sperren lässt sich auch direkt aus der Anrufliste und – mit dem Recht „Rufnummern sperren“ – aus den Apps."
      emptyText="Noch keine Nummer gesperrt. Lästige Anrufer am einfachsten in der Anrufliste sperren."
      emptyIcon={<BlockIcon />}
      columns={[
        { label: 'Rufnummer', render: (b) => <b>{b.number}</b> },
        { label: 'Notiz', render: (b) => b.note },
        {
          label: 'Gesperrt',
          hideOnMobile: true,
          render: (b) => [b.created && new Date(b.created).toLocaleDateString('de-DE'), b.by && `von ${ext(b.by)}`].filter(Boolean).join(' '),
        },
      ]}
      Form={BlockedForm}
      before={<Settings />}
    />
  )
}
