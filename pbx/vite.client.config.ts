/**
 * Web-Client unter /web: die Oberfläche der Desktop-App (../src/renderer) mit einem
 * Unterbau für den Browser (../src/web). Geteilter Code aus ../src/main läuft mit kleinen
 * Ersatzmodulen für Node und Electron (../src/web/shims). Pakete kommen immer aus
 * node_modules der Anlage, damit der Bau ohne die Pakete der Desktop-App auskommt
 * (Docker-Bau, CI der Anlage).
 */

import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Plugin, defineConfig } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const app = path.join(here, '..', 'src')
const web = path.join(app, 'web')
const shim = (name: string): string => path.join(web, 'shims', `${name}.ts`)

const NODE: Record<string, string> = {
  electron: shim('electron'),
  'node:fs': shim('fs'),
  'node:path': shim('path'),
  'node:os': shim('os'),
  'node:dgram': shim('dgram'),
  'node:events': shim('events'),
  'node:crypto': shim('crypto'),
  'node:child_process': shim('child_process'),
}

/** Module aus src/main, die im Browser durch eigene ersetzt werden */
const LOCAL: Record<string, string> = {
  [path.join(app, 'main', 'files')]: shim('files'),
  [path.join(app, 'main', 'paths')]: shim('paths'),
}

function browserShims(): Plugin {
  return {
    name: 'phone4all-browser-shims',
    enforce: 'pre',
    async resolveId(id, importer, options) {
      if (NODE[id]) return NODE[id]
      if (!importer || !importer.startsWith(app)) return null
      if (id.startsWith('.')) return LOCAL[path.join(path.dirname(importer), id).replace(/\.tsx?$/, '')] ?? null
      if (path.isAbsolute(id) || id.startsWith('\0') || id.includes(':')) return null
      // Pakete wie aus pbx/ importiert
      return this.resolve(id, path.join(here, 'vite.client.config.ts'), { ...options, skipSelf: true })
    },
  }
}

/** Version der Oberfläche wie die Desktop-App (package.json im Hauptordner fehlt im Docker-Bau) */
function version(): string {
  for (const file of [path.join(here, '..', 'package.json'), path.join(here, 'package.json')]) {
    try {
      return (JSON.parse(fs.readFileSync(file, 'utf8')) as { version: string }).version
    } catch {
      // nächste Datei
    }
  }
  return 'dev'
}

export default defineConfig({
  root: web,
  base: './',
  publicDir: path.join(app, 'renderer', 'public'),
  plugins: [browserShims(), react()],
  define: {
    // Geteilter Code fragt mitunter nach der Plattform
    'process.platform': JSON.stringify('web'),
    'process.env': '{}',
    __APP_VERSION__: JSON.stringify(version()),
  },
  build: {
    outDir: path.join(here, 'dist', 'client'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 3000,
  },
  server: {
    // Entwicklung: npm run dev:client gegen eine laufende Anlage (PBX_URL, Standard 127.0.0.1:8080)
    proxy: {
      '/provision': { target: process.env.PBX_URL || 'http://127.0.0.1:8080', ws: true },
      '/ws': { target: process.env.PBX_URL || 'http://127.0.0.1:8080', ws: true },
      '/api/session': process.env.PBX_URL || 'http://127.0.0.1:8080',
    },
  },
})
