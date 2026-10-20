import fs from 'node:fs'
import path from 'node:path'

export function loadJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Atomar schreiben; private Dateien nur für den Eigentümer lesbar. */
export function saveJson(file: string, data: unknown, mode = 0o600): void {
  writeAtomic(file, JSON.stringify(data, null, 2) + '\n', mode)
}

export function writeAtomic(file: string, content: string | Buffer, mode = 0o644): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, content, { mode })
  fs.chmodSync(tmp, mode)
  fs.renameSync(tmp, file)
}
