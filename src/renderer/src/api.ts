/** Typisierter Zugriff auf den Hauptprozess (siehe src/main/api.ts). */

import type { Api, RendererEvents } from '../../main/api'

interface Bridge {
  invoke(method: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (...args: unknown[]) => void): () => void
  pathForFile(file: File): string
  platform: string
}

declare global {
  interface Window {
    bridge: Bridge
  }
}

type Promisified<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never
}

export const api = new Proxy({} as Promisified<Api>, {
  get: (_target, method: string) => (...args: unknown[]) => window.bridge.invoke(method, ...args),
})

export function onMain<K extends keyof RendererEvents>(
  channel: K,
  listener: (...args: RendererEvents[K]) => void,
): () => void {
  return window.bridge.on(channel, listener as (...args: unknown[]) => void)
}

export const platform = window.bridge.platform
