/** Updates der App: Versionsvergleich und passende Datei aus einem GitHub-Release. */

/** Wie die App installiert ist – bestimmt, welche Datei geladen und wie sie eingespielt wird. */
export type InstallKind = 'appimage' | 'dir' | 'rpm' | 'deb' | 'mac' | 'win' | 'manual'

export interface ReleaseAsset {
  name: string
  browser_download_url: string
  size: number
  /** Prüfsumme, die GitHub zu jeder Datei angibt („sha256:…“) */
  digest?: string | null
}

/** „v1.2.3“ / „1.2.3-beta.1“ vergleichen (> 0: a ist neuer). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): [number[], string] => {
    const [main, pre = ''] = v.replace(/^v/, '').split('-', 2)
    return [main.split('.').map((n) => Number(n) || 0), pre]
  }
  const [am, ap] = parse(a)
  const [bm, bp] = parse(b)
  for (let i = 0; i < 3; i++) {
    if ((am[i] ?? 0) !== (bm[i] ?? 0)) return (am[i] ?? 0) - (bm[i] ?? 0)
  }
  if (ap === bp) return 0
  if (!ap) return 1
  if (!bp) return -1
  return ap.localeCompare(bp, 'en', { numeric: true })
}

// Dateinamen aus electron-builder.yml: Phone4All-<version>-<os>-<arch>.<ext>
const PATTERNS: Record<Exclude<InstallKind, 'manual'>, (arch: string) => RegExp> = {
  appimage: (arch) => new RegExp(`-linux-${arch === 'arm64' ? 'arm64' : 'x86_64'}\\.AppImage$`),
  dir: (arch) => new RegExp(`-linux-${arch === 'arm64' ? 'arm64' : 'x64'}\\.tar\\.gz$`),
  rpm: (arch) => new RegExp(`-linux-${arch === 'arm64' ? 'aarch64' : 'x86_64'}\\.rpm$`),
  deb: (arch) => new RegExp(`-linux-${arch === 'arm64' ? 'arm64' : 'amd64'}\\.deb$`),
  mac: (arch) => new RegExp(`-mac-${arch}\\.zip$`),
  win: (arch) => new RegExp(`-win-${arch}\\.exe$`),
}

export function pickAsset(assets: ReleaseAsset[], kind: InstallKind, arch: string): ReleaseAsset | null {
  if (kind === 'manual') return null
  const re = PATTERNS[kind](arch)
  return assets.find((a) => re.test(a.name)) ?? null
}
