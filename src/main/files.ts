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

/** Dateitypen, die beim Öffnen Code ausführen (Windows, macOS, Linux) */
const EXECUTABLE =
  /\.(exe|com|bat|cmd|scr|pif|msi|msp|msix|appx|cpl|msc|jar|js|jse|vbs|vbe|wsf|wsh|ws|hta|ps1|psm1|psd1|lnk|url|scf|reg|inf|chm|iso|img|vhd|vhdx|app|command|tool|pkg|dmg|sh|bash|zsh|desktop|appimage|deb|rpm|run|py|pyw|pl|rb|docm|dotm|xlsm|xltm|xlam|pptm|potm|ppam|sldm)$/i

export function isExecutable(name: string): boolean {
  return EXECUTABLE.test(name.replace(/[.\s]+$/, ''))
}

/** Dateiname aus dem Chat ohne Pfad und ohne Zeichen, die das System nicht mag */
export function safeFileName(name: string): string {
  const base = path.basename(String(name).replace(/\\/g, '/'))
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+/, '').slice(0, 120)
  return clean || 'Datei'
}

/** Heruntergeladene Datei schreiben; unter Windows als „aus dem Internet“ markieren (SmartScreen, Office-Schutz) */
export function writeDownload(target: string, data: Buffer): void {
  fs.writeFileSync(target, data)
  if (process.platform !== 'win32') return
  try {
    fs.writeFileSync(`${target}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\n')
  } catch {
    // Laufwerk ohne NTFS-Datenströme
  }
}
