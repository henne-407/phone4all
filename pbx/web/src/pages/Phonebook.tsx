import MenuBookIcon from '@mui/icons-material/MenuBook'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import { Alert, Box, Button, FormControlLabel, Stack, Switch, TextField } from '@mui/material'
import { useRef } from 'react'
import type { LdapSettings, PhonebookEntry } from '../../../server/model'
import { api } from '../api'
import { ChangesBar, CollectionPage, FormGrid, NumberField, Section, StatusDot, useDraft } from '../components/common'
import { ContactSources } from '../components/Sources'
import { usePbx } from '../state'
import { CopyField, LDAP_NAME_FILTER, LDAP_NUMBER_FILTER, useDectInfo } from './Dect'

function EntryForm({ value, onChange }: { value: PhonebookEntry; onChange: (v: PhonebookEntry) => void }) {
  const set = <K extends keyof PhonebookEntry>(k: K, v: PhonebookEntry[K]): void => onChange({ ...value, [k]: v })
  return (
    <FormGrid>
      <TextField label="Name" value={value.name} onChange={(e) => set('name', e.target.value)} required autoFocus />
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

/** Telefonbuch per LDAP für DECT-Basen und Tischtelefone */
function Ldap() {
  const { config, saveSection } = usePbx()
  const d = useDraft<LdapSettings>(config.ldap)
  const { draft, replace: setDraft } = d
  const info = useDectInfo([config.ldap])
  const running = info?.ldap.listening
  return (
    <>
      <Section
        icon={<MenuBookIcon />}
        title="Telefonbuch für DECT- und Tischtelefone (LDAP)"
        description="Gigaset-Basen, Yealink, Snom und andere Telefone durchsuchen diese Kontakte und alle Nebenstellen über LDAP. Nur lesen, nur aus dem lokalen Netz (oder den erlaubten Netzen unter System → Sicherheit)."
        action={
          config.ldap.enabled && info ? (
            <StatusDot color={running ? 'success' : 'error'} label={running ? `läuft auf Port ${info.ldap.port}` : info.ldap.error || 'startet nicht'} />
          ) : undefined
        }
      >
        <FormControlLabel control={<Switch checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />} label="LDAP-Telefonbuch einschalten" />
        {draft.enabled && (
          <Stack sx={{ gap: 2, mt: 2 }}>
            <FormGrid>
              <NumberField label="Port" value={draft.port} min={1} onChange={(port) => setDraft({ ...draft, port })} helperText="Standard 389" />
              <TextField
                label="Kennwort (optional)"
                value={draft.password}
                onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                helperText="Leer = Suche ohne Anmeldung"
                autoComplete="off"
              />
            </FormGrid>
            {info && (
              <FormGrid>
                <CopyField label="Server" value={info.host} />
                <CopyField label="Suchbasis (BaseDN)" value="dc=phone4all" />
                {config.ldap.password && <CopyField label="Benutzer (Bind-DN)" value="cn=telefonbuch,dc=phone4all" helperText="Telefone können sich auch mit Nebenstelle und SIP-Passwort anmelden" />}
                <CopyField label="Namensfilter" value={LDAP_NAME_FILTER} />
                <CopyField label="Nummernfilter" value={LDAP_NUMBER_FILTER} />
              </FormGrid>
            )}
            <Alert severity="info" variant="outlined">
              Attribute: Name <code>cn</code>, Vorname <code>givenName</code>, Nachname <code>sn</code>, Firma <code>o</code>, Telefon <code>telephoneNumber</code>, Mobil{' '}
              <code>mobile</code>. Im Filter steht <code>%</code> für die Eingabe am Telefon.
            </Alert>
          </Stack>
        )}
      </Section>
      <ChangesBar dirty={d.dirty} onApply={() => saveSection('ldap', draft)} onDiscard={d.reset} />
    </>
  )
}

export default function Phonebook() {
  const { toast, reload } = usePbx()
  const ref = useRef<HTMLInputElement>(null)
  return (
    <Box>
      <CollectionPage<PhonebookEntry>
        kind="phonebook"
        overline="Zusammenarbeit"
        title="Kontakte"
        singular="Kontakt"
        description="Das gemeinsame Telefonbuch: Die Anlage zeigt bei Anrufen den Namen, und alle Phone4All-Apps übernehmen die Kontakte automatisch – Änderungen hier kommen innerhalb von zwei Minuten an."
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
      <Button startIcon={<UploadFileIcon />} sx={{ mt: 2, mb: 3 }} onClick={() => ref.current?.click()}>
        CSV importieren
      </Button>
      <ContactSources />
      <Ldap />
    </Box>
  )
}
