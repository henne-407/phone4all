/** Ersatz für „node:path“ (nur die Teile, die der geteilte Code braucht). */

function join(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/')
}

function basename(p: string): string {
  return p.replace(/\/+$/, '').split('/').pop() ?? ''
}

function dirname(p: string): string {
  const i = p.replace(/\/+$/, '').lastIndexOf('/')
  return i > 0 ? p.slice(0, i) : '.'
}

function extname(p: string): string {
  const base = basename(p)
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i) : ''
}

const path = { join, basename, dirname, extname, sep: '/' }

export default path
export { basename, dirname, extname, join }
