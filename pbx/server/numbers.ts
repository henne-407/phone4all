/** Rufnummern: Normalisierung nach E.164 und Format für die Anbieter. */

import type { NumberFormat } from './model'

/** Notruf- und Sonderrufnummern, die unverändert gewählt werden. */
export const SPECIAL_NUMBER = /^(110|112|115|116\d{3}|118\d{2,3}|19222)$/

export function cleanNumber(raw: string): string {
  const s = raw.trim().replace(/[\s\-/().]/g, '')
  return s.startsWith('+') ? '+' + s.slice(1).replace(/\D/g, '') : s.replace(/[^\d*#]/g, '')
}

/** Gewählte oder gespeicherte Nummer → +49…; Sonderrufnummern bleiben unverändert. */
export function toE164(raw: string, country: string, area = ''): string {
  const n = cleanNumber(raw)
  if (!n || n.startsWith('+') || SPECIAL_NUMBER.test(n) || /[*#]/.test(n)) return n
  if (n.startsWith('00')) return '+' + n.slice(2)
  if (n.startsWith('0')) return `+${country}${n.slice(1)}`
  if (area && n.length >= 5) return `+${country}${area}${n}`
  return n
}

/** Präfix einer Wahlregel („015“, „00“, „+49“, „0“) → E.164-Präfix. */
export function prefixToE164(raw: string, country: string): string {
  const p = cleanNumber(raw)
  if (!p || p.startsWith('+')) return p
  if (p.startsWith('00')) return '+' + p.slice(2)
  if (p.startsWith('0')) return `+${country}${p.slice(1)}`
  return p
}

/** E.164 → Format, das der Anbieter erwartet. */
export function formatFor(e164: string, format: NumberFormat, country: string): string {
  if (!e164.startsWith('+')) return e164
  const digits = e164.slice(1)
  switch (format) {
    case 'e164':
      return e164
    case 'e164_no_plus':
      return digits
    case 'intl00':
      return '00' + digits
    case 'national':
      return digits.startsWith(country) ? '0' + digits.slice(country.length) : '00' + digits
  }
}

/** Interne Nummern: nur Ziffern, 2–6 Stellen, keine führende 0. */
export function isInternalNumber(n: string): boolean {
  return /^[1-9]\d{1,5}$/.test(n)
}
