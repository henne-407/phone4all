/**
 * Adressbücher synchronisieren: CardDAV, Microsoft SQL Server und (unter Linux)
 * GNOME Online-Konten/Evolution. Die Kontakte werden nur gelesen; sie erscheinen
 * in der Kontaktliste, dienen der Anrufererkennung und werden lokal zwischengespeichert.
 */

import { EventEmitter } from 'node:events'
import type { AddressBookInfo, Contact, DavAccount } from '../shared/types'
import { parseVcards } from './contactImport'
import { DavClient, DavError, errorText, hasChild, parseXml, textOf } from './dav'
import { eds, edsAvailable } from './eds'
import { MsSqlSource } from './sqlSource'
import type { Store } from './store'

const SYNC_INTERVAL = 30 * 60 * 1000

const PROPFIND_HOME = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop><d:current-user-principal/><card:addressbook-home-set/><d:resourcetype/></d:prop>
</d:propfind>`
const PROPFIND_BOOKS = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:displayname/></d:prop></d:propfind>`
const REPORT_CARDS = `<?xml version="1.0" encoding="utf-8"?>
<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop><d:getetag/><card:address-data/></d:prop>
</card:addressbook-query>`

export interface AddressBook {
  id: string
  name: string
  group: string
  href: string
  contacts(): Promise<Omit<Contact, 'id'>[]>
}

function tag(contacts: Omit<Contact, 'id'>[], book: AddressBook): Contact[] {
  return contacts.map((c, i) => ({
    ...c,
    id: `${book.id}#${i}`,
    source: book.group ? `${book.group} · ${book.name}` : book.name,
    // Einträge der Telefonanlage mit Bearbeitungsrecht ändert die App über die Anlage
    readonly: !c.pbx,
  }))
}

export class CardDavBackend {
  readonly client: DavClient

  constructor(readonly conf: DavAccount, password: string) {
    this.client = new DavClient(conf, password)
  }

  async listBooks(): Promise<AddressBook[]> {
    const { home, collection } = await this.client.discover(
      'carddav',
      PROPFIND_HOME,
      'addressbook-home-set',
      'addressbook',
    )
    if (collection) return this.books(collection, 0)
    if (!home) throw new DavError('Keine Adressbücher gefunden – bitte die URL prüfen')
    const books = await this.books(home, 1)
    if (!books.length) throw new DavError('Das Konto enthält keine Adressbücher')
    return books
  }

  private async books(url: string, depth: number): Promise<AddressBook[]> {
    const result: AddressBook[] = []
    for (const { href, props } of await this.client.propfind(url, PROPFIND_BOOKS, depth)) {
      if (!hasChild(props.resourcetype, 'addressbook')) continue
      const name = textOf(props.displayname) || decodeURIComponent(href.replace(/\/$/, '').split('/').pop() ?? href)
      const bookHref = href.endsWith('/') ? href : href + '/'
      result.push({
        id: `carddav:${this.conf.id}:${href}`,
        name,
        group: this.conf.name || new URL(href).host,
        href: bookHref,
        contacts: () => this.cards(bookHref),
      })
    }
    return result
  }

  private async cards(href: string): Promise<Omit<Contact, 'id'>[]> {
    const r = await this.client.request('REPORT', href, REPORT_CARDS, 1)
    const root = parseXml(await r.text())
    const cards: string[] = []
    for (const resp of root?.multistatus?.response ?? []) {
      for (const ps of resp.propstat ?? []) {
        const data = textOf(ps.prop?.['address-data'])
        if (data.trim()) cards.push(data)
      }
    }
    return parseVcards(cards.join('\n'))
  }
}

/** Liest alle aktiven Adressbücher und aktualisiert den Kontakt-Cache. Ereignis: 'synced'. */
export class ContactSync extends EventEmitter {
  books: AddressBook[] = []
  errors: string[] = []
  syncing = false
  readonly edsAvailable = edsAvailable()
  /** Weitere Quellen, z. B. das Telefonbuch der Telefonanlage */
  readonly sources: (() => AddressBook | null)[] = []

  constructor(private store: Store) {
    super()
    setInterval(() => void this.sync(), SYNC_INTERVAL).unref()
  }

  get settings(): Store['settings']['addressbooks'] {
    return this.store.settings.addressbooks
  }

  isEnabled(id: string): boolean {
    return !this.settings.disabled.includes(id)
  }

  setEnabled(id: string, enabled: boolean): void {
    const disabled = new Set(this.settings.disabled)
    if (enabled) disabled.delete(id)
    else disabled.add(id)
    this.settings.disabled = [...disabled].sort()
    this.store.saveSettings()
    void this.sync()
  }

  info(): AddressBookInfo[] {
    const counts = new Map<string, number>()
    for (const c of this.store.external) {
      const id = c.id.split('#')[0]
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return this.books.map((b) => ({
      id: b.id,
      name: b.name,
      group: b.group,
      enabled: this.isEnabled(b.id),
      count: counts.get(b.id) ?? 0,
    }))
  }

  async sync(): Promise<void> {
    if (this.syncing) return
    this.syncing = true
    this.emit('synced')
    const books: AddressBook[] = []
    const errors: string[] = []
    const keep: string[] = [] // ID-Präfixe, deren alter Zwischenstand bei Fehlern erhalten bleibt

    if (this.edsAvailable && this.settings.use_eds) {
      try {
        const list = await eds.call<{ id: string; name: string; group: string }[]>('books')
        for (const b of list) {
          books.push({
            ...b,
            href: '',
            contacts: async () => parseVcards(await eds.call<string>('vcards', { book: b.id })),
          })
        }
      } catch (e) {
        errors.push(`Evolution-Adressbücher: ${errorText(e)}`)
        keep.push('eds:')
      }
    }
    for (const conf of this.settings.carddav) {
      try {
        books.push(...(await new CardDavBackend(conf, this.store.getSecret(`carddav:${conf.id}`)).listBooks()))
      } catch (e) {
        errors.push(`${conf.name || conf.url}: ${errorText(e)}`)
        keep.push(`carddav:${conf.id}:`)
      }
    }
    for (const conf of this.settings.sql) {
      const source = new MsSqlSource(conf, this.store.getSecret(`mssql:${conf.id}`))
      books.push({
        id: `sql:${conf.id}`,
        name: conf.name || `${conf.database} (${conf.host})`,
        group: 'SQL Server',
        href: '',
        contacts: async () => (await source.fetch())[0],
      })
    }

    for (const source of this.sources) {
      const book = source()
      if (book) books.push(book)
    }

    const contacts: Contact[] = []
    await Promise.all(
      books
        .filter((b) => this.isEnabled(b.id))
        .map(async (book) => {
          try {
            contacts.push(...tag(await book.contacts(), book))
          } catch (e) {
            errors.push(`${book.name}: ${errorText(e)}`)
            keep.push(book.id + '#')
          }
        }),
    )
    if (keep.length) contacts.push(...this.store.external.filter((c) => keep.some((k) => c.id.startsWith(k))))
    this.books = books
    this.errors = errors
    this.store.setExternal(contacts)
    this.syncing = false
    this.emit('synced')
  }
}
