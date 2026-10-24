import { describe, expect, it } from 'vitest'
import { compareVersions, containerIdFromMountinfo } from '../server/updates'

describe('Online-Updates', () => {
  it('findet die eigene Container-ID auch mit Host-Netz (TrueNAS)', () => {
    const id = 'a'.repeat(12) + '0123456789abcdef'.repeat(3) + 'b'.repeat(4)
    const mountinfo = [
      '612 590 0:52 / / rw,relatime master:278 - overlay overlay rw,lowerdir=/mnt/.ix-apps/docker/overlay2/l/ABC',
      `640 612 259:3 /mnt/.ix-apps/docker/containers/${id}/hostname /etc/hostname rw,relatime - zfs boot-pool/.ix-apps rw`,
    ].join('\n')
    expect(containerIdFromMountinfo(mountinfo)).toBe(id)
    expect(containerIdFromMountinfo('0::/')).toBe('')
  })

  it('vergleicht Versionen', () => {
    expect(compareVersions('pbx-v0.6.1', '0.6.0')).toBeGreaterThan(0)
    expect(compareVersions('0.6.0', '0.6.0-beta.1')).toBeGreaterThan(0)
  })
})
