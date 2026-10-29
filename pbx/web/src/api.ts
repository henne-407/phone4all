/** Zugriff auf die Verwaltungs-API. */

import type { PbxConfig } from '../../server/model'
import type { ProviderTemplate } from '../../server/providers'
import type { WatchEvent, WatchdogStatus } from '../../server/model'

export type { WatchEvent, WatchdogStatus }

export interface WatchdogResponse extends WatchdogStatus {
  events: WatchEvent[]
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function request<T>(method: string, url: string, body?: unknown, raw = false): Promise<T> {
  const headers: Record<string, string> = { 'x-phone4all': '1' }
  let data: BodyInit | undefined
  if (body instanceof Blob || body instanceof ArrayBuffer) data = body
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    data = JSON.stringify(body)
  }
  const r = await fetch(url, { method, headers, body: data, credentials: 'same-origin' })
  if (!r.ok) {
    let message = r.statusText
    try {
      message = ((await r.json()) as { error: string }).error || message
    } catch {
      // keine JSON-Antwort
    }
    if (r.status === 401 && url !== '/api/login') window.dispatchEvent(new Event('p4a-logout'))
    throw new ApiError(r.status, message)
  }
  if (raw) return (await r.text()) as T
  return (await r.json()) as T
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  text: (url: string) => request<string>('GET', url, undefined, true),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
}

export interface ConfigResponse {
  config: PbxConfig
  providers: ProviderTemplate[]
  states: Record<string, string>
  version: string
}

export interface StatusResponse {
  asterisk: 'stopped' | 'starting' | 'running' | 'error'
  message: string
  uptime: string
  endpoints: { number: string; contacts: { uri: string; agent: string; status: string; rtt: number }[] }[]
  registrations: { trunk: string; status: string }[]
  calls: {
    id: string
    from: string
    fromName: string
    to: string
    toName: string
    channels: { channel: string; from: string; fromName: string; to: string; toName: string; state: string; duration: number }[]
  }[]
  dnd: Record<string, boolean>
  cfu: Record<string, string>
  bans: { ip: string; until: number; reason: string }[]
  update: UpdateInfo
  version: string
  remote: { enabled: boolean; turn: 'off' | 'running' | 'missing' | 'error'; connections: number }
  /** Absender mit X-Forwarded-For, die nicht als Proxy eingetragen sind */
  proxy_hints: { ip: string; time: number }[]
  watchdog: WatchdogStatus
}

export interface UpdateInfo {
  current: string
  latest: { version: string; tag: string; date: string; notes: string; url: string; prerelease: boolean } | null
  available: boolean
  canApply: boolean
  reason: string
  project: string
  checked: number
  error: string
}

export interface CallRecord {
  id: string
  start: string
  direction: 'in' | 'out' | 'internal'
  from: string
  fromName: string
  to: string
  answeredBy: string
  status: 'answered' | 'missed' | 'busy' | 'failed'
  duration: number
  recordings: string[]
}
