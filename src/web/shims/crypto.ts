/** Ersatz für „node:crypto“ (nur randomUUID). */

export function randomUUID(): string {
  return crypto.randomUUID()
}
