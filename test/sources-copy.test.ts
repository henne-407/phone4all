import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Die Anlage enthält Kopien der Quell-Module der App (eigenes Docker-Image ohne src/).
// Jede Funktion der Kopie muss wörtlich auch in der App stehen, sonst laufen Fehlerbehebungen
// nur auf einer Seite.
const COPIES = ['contactImport', 'dav', 'ical', 'sqlSource']
const root = path.join(__dirname, '..')

/** Oberste Bausteine der Datei ohne Kopfkommentar und Importe */
function blocks(text: string): string[] {
  const body = text.replace(/^\/\*\*[\s\S]*?\*\/\n/, '').replace(/^import .*\n/gm, '')
  return body
    .split(/\n(?=(?:export |function |const |let |type |interface |class |\/\*\*|\/\/ --))/)
    .map((b) => b.trim())
    .filter(Boolean)
}

describe('Kopien der Quell-Module in der Anlage', () => {
  for (const name of COPIES) {
    it(`pbx/server/sources/${name}.ts stimmt mit der App überein`, () => {
      const copy = fs.readFileSync(path.join(root, 'pbx/server/sources', `${name}.ts`), 'utf8')
      const app = fs.readFileSync(path.join(root, 'src/main', `${name}.ts`), 'utf8')
      const differ = blocks(copy)
        .filter((b) => !app.includes(b))
        .map((b) => b.split('\n')[0])
      expect(differ).toEqual([])
    })
  }
})
