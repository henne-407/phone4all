/** Ablageorte und Einstellungen aus Umgebungsvariablen (Docker setzt die Standardwerte). */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const env = process.env
const here = path.dirname(fileURLToPath(import.meta.url))

export const DATA = path.resolve(env.PBX_DATA || '/data')

export const PATHS = {
  data: DATA,
  config: path.join(DATA, 'config.json'),
  state: path.join(DATA, 'state.json'),
  admin: path.join(DATA, 'admin.json'),
  watchdog: path.join(DATA, 'watchdog.json'),
  backups: path.join(DATA, 'backups'),
  calendars: path.join(DATA, 'calendars'),
  messenger: path.join(DATA, 'messenger'),
  tts: path.join(DATA, 'tts'),
  missed: path.join(DATA, 'missed.json'),
  transcripts: path.join(DATA, 'transcripts'),
  whisper: path.join(DATA, 'whisper'),
  fax: path.join(DATA, 'fax'),
  users: path.join(DATA, 'users.json'),
  sounds: path.join(DATA, 'sounds', 'custom'),
  prompts: path.join(DATA, 'sounds', 'prompts'),
  moh: path.join(DATA, 'sounds', 'moh'),
  recordings: path.join(DATA, 'recordings'),
  spool: path.join(DATA, 'spool'),
  log: path.join(DATA, 'log'),
  audit: path.join(DATA, 'log', 'audit.jsonl'),
  db: path.join(DATA, 'db'),
  keys: path.join(DATA, 'keys'),
  etc: path.resolve(env.PBX_ASTERISK_ETC || '/etc/asterisk'),
  lib: env.PBX_ASTERISK_LIB || '/var/lib/asterisk',
  run: env.PBX_ASTERISK_RUN || '/var/run/asterisk',
  modules:
    env.PBX_ASTERISK_MODULES ||
    ['/usr/lib/x86_64-linux-gnu/asterisk/modules', '/usr/lib/aarch64-linux-gnu/asterisk/modules', '/usr/lib/asterisk/modules'].find((d) =>
      fs.existsSync(d),
    ) ||
    '/usr/lib/asterisk/modules',
  asteriskData: env.PBX_ASTERISK_DATA || '/usr/share/asterisk',
  systemMoh: env.PBX_SYSTEM_MOH || '/usr/share/asterisk/moh',
  web: path.resolve(env.PBX_WEB || path.join(here, 'web')),
  /** Web-Client (Oberfläche der App im Browser) unter /web */
  client: path.resolve(env.PBX_CLIENT || path.join(here, 'client')),
}

export const SETTINGS = {
  httpPort: Number(env.PBX_HTTP_PORT) || 8080,
  /** HTTPS für die Weboberfläche im LAN (eigenes oder selbst signiertes Zertifikat); 0 = aus */
  httpsPort: env.PBX_HTTPS_PORT === undefined ? 8443 : Number(env.PBX_HTTPS_PORT) || 0,
  amiPort: Number(env.PBX_AMI_PORT) || 5038,
  /** HTTP-Server von Asterisk (nur 127.0.0.1) für SIP über WebSocket */
  asteriskHttpPort: Number(env.PBX_ASTERISK_HTTP_PORT) || 8088,
  /** AudioSocket für den KI-Telefonassistenten (nur 127.0.0.1) */
  audioSocketPort: Number(env.PBX_AUDIOSOCKET_PORT) || 9093,
  turnserver: env.PBX_TURNSERVER || '/usr/bin/turnserver',
  asterisk: env.PBX_ASTERISK_BIN || 'asterisk',
  /** Benutzer für Asterisk (im Container „asterisk“, lokal leer) */
  runUser: env.PBX_ASTERISK_USER ?? '',
  mailer: env.PBX_MAILER ?? '/usr/bin/msmtp',
  /** whisper.cpp (Voicemail als Text): whisper-cli und whisper-cli-avx2 */
  whisper: env.PBX_WHISPER_DIR || '/opt/whisper',
  version: env.PBX_VERSION || 'dev',
  image: env.PBX_IMAGE || 'ghcr.io/henne-407/phone4all-pbx',
  repo: env.PBX_REPO || 'henne-407/phone4all',
  /** Asterisk nicht starten (Entwicklung der Oberfläche) */
  noAsterisk: env.PBX_NO_ASTERISK === '1',
  adminPassword: env.PBX_ADMIN_PASSWORD || '',
}
