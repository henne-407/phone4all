/** Ersatz für „node:fs“: Der Browser hat kein Dateisystem, Lesen schlägt fehl. */

function missing(): never {
  throw new Error('Kein Dateisystem im Browser')
}

const fs = {
  existsSync: (): boolean => false,
  readFileSync: missing,
  writeFileSync: missing,
  mkdirSync: (): void => undefined,
  renameSync: missing,
  rmSync: (): void => undefined,
  copyFileSync: missing,
  readdirSync: (): string[] => [],
  statSync: missing,
  chmodSync: (): void => undefined,
}

export default fs
