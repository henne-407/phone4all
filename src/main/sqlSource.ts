/**
 * Microsoft SQL Server als (nur lesende) Kontaktquelle, z. B. CRM oder Warenwirtschaft.
 *
 * Die Kontakte werden wie Adressbücher regelmäßig komplett gelesen und lokal
 * zwischengespeichert, damit die Anrufererkennung ohne Datenbankabfrage auskommt.
 * Treiber: mssql/tedious (reines JavaScript, kein ODBC/FreeTDS nötig).
 */

import sql from 'mssql'
import type { SqlSourceConf } from '../shared/types'
import { MOBILE_HINT, guessColumns, rowsToContacts } from './contactImport'
import { DavError } from './dav'

export const MAX_ROWS = 50000

export class SqlError extends DavError {}

/** dbo.Kunden -> [dbo].[Kunden] (gegen SQL-Injection über Tabellen-/Spaltennamen). */
export function quoteIdent(name: string): string {
  const parts = name
    .split('.')
    .map((p) => p.trim().replace(/^\[|\]$/g, ''))
    .filter(Boolean)
  if (!parts.length) throw new SqlError('Leerer Tabellen- oder Spaltenname')
  return parts.map((p) => '[' + p.replace(/]/g, ']]') + ']').join('.')
}

export function splitList(text: string): string[] {
  return (text || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
}

function errorMessage(e: unknown): string {
  const err = e as { code?: string; number?: number; message?: string; originalError?: { message?: string } }
  const text = `${err.message ?? ''} ${err.originalError?.message ?? ''}`
  if (/Cannot open database/i.test(text)) return 'Datenbank nicht gefunden oder keine Berechtigung'
  if (err.code === 'ELOGIN' || /Login failed/i.test(text)) {
    // SQL Server meldet auch eine unzugängliche Datenbank als Anmeldefehler
    return 'Anmeldung fehlgeschlagen – Benutzer, Passwort oder Datenbankname falsch'
  }
  if (['ESOCKET', 'ETIMEOUT', 'EINSTLOOKUP'].includes(err.code ?? '') || /getaddrinfo|ECONNREFUSED|timeout/i.test(text)) {
    return 'Server nicht erreichbar – Adresse, Port und Firewall prüfen'
  }
  if (err.number === 229 || /permission was denied/i.test(text)) return 'Keine Leseberechtigung für diese Tabelle'
  if (err.number === 208 || /Invalid object name/i.test(text)) return 'Tabelle oder Sicht nicht gefunden'
  if (err.number === 207 || /Invalid column name/i.test(text)) {
    const m = /Invalid column name '([^']+)'/.exec(text)
    return 'Spalte nicht gefunden: ' + (m ? m[1] : '?')
  }
  const first = (err.message ?? '').split('\n')[0].trim()
  return first ? `SQL-Fehler: ${first}` : 'SQL-Fehler'
}

export class MsSqlSource {
  constructor(
    readonly conf: SqlSourceConf,
    private password: string,
  ) {}

  private config(encrypt: boolean): sql.config {
    const [server, instanceName] = this.conf.host.trim().split('\\')
    const user = this.conf.user.trim()
    const base: sql.config = {
      server,
      database: this.conf.database.trim(),
      connectionTimeout: 10000,
      requestTimeout: 60000,
      options: {
        encrypt,
        trustServerCertificate: true,
        appName: 'Phone4All',
        ...(instanceName ? { instanceName } : {}),
      },
      pool: { max: 1, min: 0 },
    }
    if (!instanceName) base.port = Number(this.conf.port) || 1433
    if (user.includes('\\')) {
      // Windows-Anmeldung: DOMÄNE\benutzer
      const [domain, userName] = user.split('\\')
      base.authentication = { type: 'ntlm', options: { domain, userName, password: this.password } }
    } else {
      base.user = user
      base.password = this.password
    }
    return base
  }

  private async connect(): Promise<sql.ConnectionPool> {
    try {
      return await new sql.ConnectionPool(this.config(true)).connect()
    } catch (e) {
      // Ältere Server ohne aktuelles TLS: unverschlüsselt erneut versuchen
      if ((e as { code?: string }).code === 'ESOCKET') {
        try {
          return await new sql.ConnectionPool(this.config(false)).connect()
        } catch (e2) {
          throw new SqlError(errorMessage(e2))
        }
      }
      throw new SqlError(errorMessage(e))
    }
  }

  private async query(text: string, params: Record<string, string> = {}): Promise<[string[], unknown[][]]> {
    const pool = await this.connect()
    try {
      const request = pool.request()
      request.arrayRowMode = true
      for (const [k, v] of Object.entries(params)) request.input(k, sql.NVarChar, v)
      const result = await request.query(text)
      const columns = (result as unknown as { columns?: { name: string }[][] }).columns?.[0]
      if (!columns) throw new SqlError('Die Abfrage liefert keine Zeilen (nur SELECT-Abfragen verwenden)')
      const headers = columns.map((c, i) => c.name || `spalte${i}`)
      return [headers, (result.recordset as unknown as unknown[][]).slice(0, MAX_ROWS)]
    } catch (e) {
      if (e instanceof SqlError) throw e
      throw new SqlError(errorMessage(e))
    } finally {
      await pool.close()
    }
  }

  // -- Einrichtung -----------------------------------------------------------

  async tables(): Promise<[string, boolean][]> {
    const [, rows] = await this.query(
      'SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_SCHEMA, TABLE_NAME',
    )
    return rows.map(([schema, name, kind]) => [`${schema}.${name}`, kind === 'VIEW'])
  }

  async columns(table: string): Promise<string[]> {
    const parts = table.split('.').map((p) => p.replace(/^\[|\]$/g, ''))
    const [schema, name] = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : ['dbo', parts[0]]
    const [, rows] = await this.query(
      'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @name ORDER BY ORDINAL_POSITION',
      { schema, name },
    )
    return rows.map((r) => String(r[0]))
  }

  /** Schlägt Name-, Firma- und Telefonspalten anhand der Spaltennamen vor. */
  static suggest(columns: string[]): Pick<SqlSourceConf, 'name_cols' | 'company_col' | 'phone_cols'> {
    const g = guessColumns(columns)
    const name = g.name.length ? [columns[g.name[0]]] : [...g.first.slice(0, 1), ...g.last.slice(0, 1)].map((i) => columns[i])
    return {
      name_cols: name.join(', '),
      company_col: g.company.length ? columns[g.company[0]] : '',
      phone_cols: g.phone.map((i) => columns[i]).join(', '),
    }
  }

  buildQuery(): string {
    const conf = this.conf
    if (conf.mode === 'query') return (conf.query ?? '').trim()
    if (!(conf.table ?? '').trim()) throw new SqlError('Bitte eine Tabelle oder Sicht auswählen')
    const select: string[] = []
    const nameCols = splitList(conf.name_cols)
    if (nameCols.length) {
      const expr =
        nameCols.length > 1
          ? `CONCAT(${nameCols.map(quoteIdent).join(", ' ', ")}, '')`
          : `CAST(${quoteIdent(nameCols[0])} AS nvarchar(400))`
      select.push(`LTRIM(RTRIM(${expr})) AS [name]`)
    }
    if ((conf.company_col ?? '').trim()) select.push(`${quoteIdent(conf.company_col)} AS [company]`)
    const phones = splitList(conf.phone_cols)
    if (!phones.length) throw new SqlError('Bitte mindestens eine Spalte mit Telefonnummern angeben')
    phones.forEach((col, i) => {
      const alias = MOBILE_HINT.test(col.toLowerCase()) ? 'mobile' : 'phone'
      select.push(`${quoteIdent(col)} AS [${alias} ${i + 1}]`)
    })
    return `SELECT TOP ${MAX_ROWS} ${select.join(', ')} FROM ${quoteIdent(conf.table)}`
  }

  // -- Abgleich --------------------------------------------------------------

  async fetch(): Promise<[ReturnType<typeof rowsToContacts>, number]> {
    const query = this.buildQuery()
    if (!query) throw new SqlError('Keine SQL-Abfrage angegeben')
    const [headers, rows] = await this.query(query)
    return [rowsToContacts(headers, rows), rows.length]
  }
}
