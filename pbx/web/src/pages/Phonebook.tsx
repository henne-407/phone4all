import UploadFileIcon from '@mui/icons-material/UploadFile'
import { Box, Button, TextField } from '@mui/material'
import { useRef } from 'react'
import type { PhonebookEntry } from '../../../server/model'
import { api } from '../api'
import { CollectionPage, FormGrid } from '../components/common'
import { usePbx } from '../state'

function EntryForm({ value, onChange }: { value: PhonebookEntry; onChange: (v: PhonebookEntry) => void }) {
  const set = <K extends keyof PhonebookEntry>(k: K, v: PhonebookEntry[K]): void => onChange({ ...value, [k]: v })
  return (
    <FormGrid>
      <TextField label="Name" value={value.name} onChange={(e) => set('name', e.target.value)} autoFocus />
      <TextField label="Firma" value={value.company} onChange={(e) => set('company', e.target.value)} />
      <TextField label="Telefon" value={value.phone} onChange={(e) => set('phone', e.target.value)} />
      <TextField label="Mobil" value={value.mobile} onChange={(e) => set('mobile', e.target.value)} />
    </FormGrid>
  )
}

/** CSV mit Spalten wie Name, Firma, Telefon, Mobil (Trennzeichen ; oder ,) */
function parseCsv(text: string): Omit<PhonebookEntry, 'id'>[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return []
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const split = (l: string): string[] => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''))
  const head = split(lines[0]).map((h) => h.toLowerCase())
  const col = (...names: string[]): number => head.findIndex((h) => names.some((n) => h.includes(n)))
  const iName = col('name')
  const iCompany = col('firma', 'company', 'organi')
  const iPhone = col('telefon', 'phone', 'festnetz', 'business')
  const iMobile = col('mobil', 'mobile', 'handy', 'cell')
  return lines.slice(1).map((l) => {
    const c = split(l)
    return { name: c[iName] ?? '', company: iCompany >= 0 ? c[iCompany] : '', phone: iPhone >= 0 ? c[iPhone] : '', mobile: iMobile >= 0 ? c[iMobile] : '' }
  }).filter((e) => e.name && (e.phone || e.mobile))
}

export default function Phonebook() {
  const { toast, reload } = usePbx()
  const ref = useRef<HTMLInputElement>(null)
  return (
    <Box>
      <CollectionPage<PhonebookEntry>
        kind="phonebook"
        overline="Zusammenarbeit"
        title="Zentrale Kontakte"
        singular="Kontakt"
        description="Das gemeinsame Telefonbuch: Die Anlage zeigt bei Anrufen den Namen, und alle SIP-Telefon-Apps übernehmen die Kontakte automatisch – Änderungen hier kommen innerhalb von zwei Minuten an."
        columns={[
          { label: 'Name', render: (e) => <b>{e.name}</b> },
          { label: 'Firma', hideOnMobile: true, render: (e) => e.company },
          { label: 'Telefon', render: (e) => e.phone },
          { label: 'Mobil', hideOnMobile: true, render: (e) => e.mobile },
        ]}
        Form={EntryForm}
      />
      <input
        ref={ref}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          void f.text().then(async (text) => {
            const entries = parseCsv(text)
            for (const entry of entries) await api.post('/api/phonebook', entry)
            await reload()
            toast(`${entries.length} Kontakte importiert`)
          })
        }}
      />
      <Button startIcon={<UploadFileIcon />} sx={{ mt: 2 }} onClick={() => ref.current?.click()}>
        CSV importieren
      </Button>
    </Box>
  )
}
