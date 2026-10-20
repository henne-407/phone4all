/** E-Mails über msmtp (dieselbe Konfiguration wie für Voicemail-Nachrichten). */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { MailSettings } from './model'
import { PATHS, SETTINGS } from './paths'

function header(value: string): string {
  // Umlaute im Betreff als RFC-2047-Wort
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`
}

export function sendMail(mail: MailSettings, to: string, subject: string, text: string): Promise<void> {
  const rc = path.join(PATHS.etc, 'msmtprc')
  if (!mail.host || !mail.from || !fs.existsSync(rc)) {
    return Promise.reject(new Error('Bitte zuerst unter System → E-Mail einen Mailserver eintragen.'))
  }
  if (!/^[^\s@<>]+@[^\s@<>]+$/.test(to)) return Promise.reject(new Error(`Ungültige E-Mail-Adresse: ${to}`))
  const message = [
    `From: ${mail.from}`,
    `To: ${to}`,
    `Subject: ${header(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
  ].join('\r\n')
  return new Promise((resolve, reject) => {
    const proc = spawn(SETTINGS.mailer, ['-C', rc, '-t'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let err = ''
    proc.stderr.on('data', (d) => (err += d))
    proc.on('error', reject)
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `msmtp beendet mit ${code}`))))
    proc.stdin.end(message)
  })
}
