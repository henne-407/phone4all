import { describe, expect, it } from 'vitest'
import { compareVersions, pickAsset } from '../src/shared/updates'

const asset = (name: string) => ({ name, browser_download_url: `https://example.org/${name}`, size: 1 })
const ASSETS = [
  'SIP-Telefon-0.6.2-linux-amd64.deb',
  'SIP-Telefon-0.6.2-linux-x86_64.AppImage',
  'SIP-Telefon-0.6.2-linux-x86_64.rpm',
  'SIP-Telefon-0.6.2-linux-x64.tar.gz',
  'SIP-Telefon-0.6.2-mac-arm64.dmg',
  'SIP-Telefon-0.6.2-mac-arm64.zip',
  'SIP-Telefon-0.6.2-mac-x64.zip',
  'SIP-Telefon-0.6.2-win-x64.exe',
].map(asset)

describe('App-Updates', () => {
  it('vergleicht Versionen', () => {
    expect(compareVersions('v0.6.2', '0.6.1')).toBeGreaterThan(0)
    expect(compareVersions('v0.6.1', '0.6.1')).toBe(0)
    expect(compareVersions('v0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('v0.7.0-beta.1', '0.7.0')).toBeLessThan(0)
  })

  it('wählt die Datei passend zur Installation', () => {
    const pick = (kind: Parameters<typeof pickAsset>[1], arch: string) => pickAsset(ASSETS, kind, arch)?.name
    expect(pick('appimage', 'x64')).toBe('SIP-Telefon-0.6.2-linux-x86_64.AppImage')
    expect(pick('dir', 'x64')).toBe('SIP-Telefon-0.6.2-linux-x64.tar.gz')
    expect(pick('rpm', 'x64')).toBe('SIP-Telefon-0.6.2-linux-x86_64.rpm')
    expect(pick('deb', 'x64')).toBe('SIP-Telefon-0.6.2-linux-amd64.deb')
    expect(pick('mac', 'arm64')).toBe('SIP-Telefon-0.6.2-mac-arm64.zip')
    expect(pick('win', 'x64')).toBe('SIP-Telefon-0.6.2-win-x64.exe')
    expect(pick('manual', 'x64')).toBeUndefined()
    expect(pick('dir', 'arm64')).toBeUndefined()
  })
})
