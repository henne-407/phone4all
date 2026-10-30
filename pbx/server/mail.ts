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

export interface MailAttachment {
  name: string
  type: string
  data: Buffer
}

export function sendMail(mail: MailSettings, to: string, subject: string, text: string, attachments: MailAttachment[] = []): Promise<void> {
  const rc = path.join(PATHS.etc, 'msmtprc')
  if (!mail.host || !mail.from || !fs.existsSync(rc)) {
    return Promise.reject(new Error('Bitte zuerst unter System → E-Mail einen Mailserver eintragen.'))
  }
  if (!/^[^\s@<>]+@[^\s@<>]+$/.test(to)) return Promise.reject(new Error(`Ungültige E-Mail-Adresse: ${to}`))
  const head = [`From: ${mail.from}`, `To: ${to}`, `Subject: ${header(subject)}`, 'MIME-Version: 1.0']
  const plain = ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', '', text]
  let message: string
  if (!attachments.length) message = [...head, ...plain].join('\r\n')
  else {
    const boundary = `p4a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    const parts = attachments.map((a) =>
      [
        `--${boundary}`,
        `Content-Type: ${a.type}; name="${a.name}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${a.name}"`,
        '',
        ...(a.data.toString('base64').match(/.{1,76}/g) ?? []),
      ].join('\r\n'),
    )
    message = [...head, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`, ...plain, ...parts, `--${boundary}--`, ''].join('\r\n')
  }
  return new Promise((resolve, reject) => {
    const proc = spawn(SETTINGS.mailer, ['-C', rc, '-t'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let err = ''
    proc.stderr.on('data', (d) => (err += d))
    proc.on('error', reject)
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `msmtp beendet mit ${code}`))))
    proc.stdin.end(message)
  })
}
