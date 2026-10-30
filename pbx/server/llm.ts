/**
 * Sprachmodell über die OpenAI-kompatible Schnittstelle (/chat/completions): lokal z. B. mit
 * Ollama oder LocalAI, oder bei einem Anbieter. Für Gesprächszusammenfassungen und den
 * KI-Telefonassistenten.
 */

import type { AiSettings } from './model'

export class LlmError extends Error {}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ChatFn = (messages: ChatTurn[], opts?: { json?: boolean; maxTokens?: number; timeoutMs?: number }) => Promise<string>

export function aiReady(ai: AiSettings): boolean {
  return Boolean(ai.url.trim() && ai.model.trim())
}

export function llmChat(ai: AiSettings): ChatFn {
  return async (messages, opts = {}) => {
    if (!aiReady(ai)) throw new LlmError('Kein Sprachmodell eingerichtet (System → KI).')
    const body: Record<string, unknown> = { model: ai.model, messages, temperature: 0.2, max_tokens: opts.maxTokens ?? 800 }
    if (opts.json) body.response_format = { type: 'json_object' }
    let r: Response
    try {
      r = await fetch(`${ai.url.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(ai.key ? { Authorization: `Bearer ${ai.key}` } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 120000),
      })
    } catch (e) {
      throw new LlmError(`Sprachmodell nicht erreichbar: ${(e as Error).message}`)
    }
    const text = await r.text()
    if (!r.ok) {
      let msg = text.slice(0, 200)
      try {
        msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message || msg
      } catch {
        // kein JSON
      }
      throw new LlmError(`Sprachmodell: HTTP ${r.status} ${msg}`.trim())
    }
    try {
      return String((JSON.parse(text) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? '').trim()
    } catch {
      throw new LlmError('Sprachmodell: unerwartete Antwort')
    }
  }
}

/** Erstes JSON-Objekt aus einer Antwort lesen (Modelle schreiben gern Text oder ```json drumherum) */
export function parseJsonReply<T>(text: string): T | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as T
  } catch {
    return null
  }
}
