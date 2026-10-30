/** Ersatz für „node:child_process“: Im Browser startet nichts. */

export function execFileSync(): never {
  throw new Error('Keine Programme im Browser')
}

export function execFile(): void {}

export function spawn(): never {
  throw new Error('Keine Programme im Browser')
}
