/** Ersatz für „node:os“: Der Gerätename für die Geräteliste der Anlage kommt vom Browser. */

/** z. B. „Browser (Firefox, Linux)“ */
export function hostname(): string {
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ''
  const system = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  const detail = [browser, system].filter(Boolean).join(', ')
  return detail ? `Browser (${detail})` : 'Browser'
}

export function networkInterfaces(): Record<string, never[]> {
  return {}
}

export function homedir(): string {
  return ''
}

export function tmpdir(): string {
  return ''
}

const os = { hostname, networkInterfaces, homedir, tmpdir }

export default os
