/** Kontakte: zentrales Telefonbuch der Anlage und auf Wunsch die Kontakte des Geräts. */

import { Contact, ContactField, requestPermissionsAsync } from 'expo-contacts'
import type { NamedNumber } from './numbers'
import type { PhonebookEntry } from './provisioning'

export interface Person {
  id: string
  name: string
  company: string
  phones: { label: string; number: string }[]
  source: 'pbx' | 'device'
}

export function fromPhonebook(list: PhonebookEntry[]): Person[] {
  return list.map((p, i) => ({
    id: `pbx-${i}`,
    name: p.name || p.company || p.phone,
    company: p.company,
    phones: [
      ...(p.phone ? [{ label: 'Telefon', number: p.phone }] : []),
      ...(p.mobile ? [{ label: 'Mobil', number: p.mobile }] : []),
    ],
    source: 'pbx' as const,
  }))
}

/** Kontakte des Geräts (fragt beim ersten Mal nach der Berechtigung) */
export async function deviceContacts(): Promise<Person[]> {
  const perm = await requestPermissionsAsync()
  if (!perm.granted) throw new Error('Kein Zugriff auf die Kontakte. In den Einstellungen des Geräts erlauben.')
  const fields = [ContactField.FULL_NAME, ContactField.COMPANY, ContactField.PHONES] as const
  const list = await Contact.getAllDetails(fields)
  return list
    .filter((c) => c.phones?.length)
    .map((c) => ({
      id: `dev-${c.id}`,
      name: c.fullName || c.company || c.phones[0].number || '',
      company: c.company ?? '',
      phones: c.phones.filter((p) => p.number).map((p) => ({ label: p.label || 'Telefon', number: p.number ?? '' })),
      source: 'device' as const,
    }))
}

export function toNamed(people: Person[]): NamedNumber[] {
  return people.map((p) => ({ name: p.name, numbers: p.phones.map((x) => x.number) }))
}

export function sortPeople(list: Person[]): Person[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

export function searchPeople(list: Person[], q: string): Person[] {
  const s = q.trim().toLowerCase()
  if (!s) return list
  const digits = s.replace(/\D/g, '')
  return list.filter(
    (p) =>
      p.name.toLowerCase().includes(s) ||
      p.company.toLowerCase().includes(s) ||
      (digits.length >= 2 && p.phones.some((x) => x.number.replace(/\D/g, '').includes(digits))),
  )
}
