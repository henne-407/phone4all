import fs from 'node:fs'
import path from 'node:path'

export function loadJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Atomar schreiben; private Dateien nur für den Benutzer lesbar (0600). */
export function saveJson(file: string, data: unknown, priv = false): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: priv ? 0o600 : 0o644 })
  if (priv) fs.chmodSync(tmp, 0o600)
  fs.renameSync(tmp, file)
}
