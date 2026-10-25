/** Erzeugt alle Asterisk-Konfigurationsdateien aus der Konfiguration der Anlage. */

import type { PbxConfig } from '../model'
import { webrtcEnabled } from '../remote'
import type { GenContext } from './context'
import { extensionsConf } from './dialplan'
import { pjsipConf, val } from './pjsip'

export type { GenContext } from './context'

/** Geladene Module (autoload=no): nur, was die Anlage braucht – schneller Start, kein Lärm im Log. */
const MODULES = [
  // Grundlagen
  'res_timing_timerfd', 'res_sorcery_config', 'res_sorcery_memory', 'res_sorcery_astdb', 'res_crypto',
  'res_rtp_asterisk', 'res_srtp', 'res_musiconhold', 'res_curl', 'res_clioriginate', 'res_limit',
  'res_format_attr_opus', 'res_format_attr_vp8', 'res_manager_devicestate', 'res_security_log', 'pbx_config', 'cdr_custom',
  // PJSIP
  'res_pjproject', 'res_pjsip', 'res_pjsip_session', 'res_pjsip_authenticator_digest',
  'res_pjsip_outbound_authenticator_digest', 'res_pjsip_endpoint_identifier_ip',
  'res_pjsip_endpoint_identifier_user', 'res_pjsip_endpoint_identifier_anonymous', 'res_pjsip_registrar',
  'res_pjsip_outbound_registration', 'res_pjsip_nat', 'res_pjsip_sdp_rtp', 'res_pjsip_caller_id',
  'res_pjsip_diversion', 'res_pjsip_dtmf_info', 'res_pjsip_header_funcs', 'res_pjsip_acl', 'res_pjsip_refer',
  'res_pjsip_rfc3326', 'res_pjsip_pubsub', 'res_pjsip_outbound_publish', 'res_pjsip_exten_state', 'res_pjsip_mwi',
  'res_pjsip_mwi_body_generator', 'res_pjsip_pidf_body_generator', 'res_pjsip_dialog_info_body_generator',
  'res_pjsip_xpidf_body_generator', 'res_pjsip_logger', 'res_pjsip_path', 'res_pjsip_dlg_options',
  'res_pjsip_empty_info', 'res_pjsip_messaging', 'res_pjsip_history', 'res_pjsip_sips_contact', 'chan_pjsip',
  // SIP über WebSocket (Mobil-App)
  'res_http_websocket', 'res_pjsip_transport_websocket',
  'chan_bridge_media',
  // Brücken
  'bridge_simple', 'bridge_native_rtp', 'bridge_softmix', 'bridge_holding', 'bridge_builtin_features',
  'bridge_builtin_interval_features',
  // Codecs und Dateiformate
  'codec_alaw', 'codec_ulaw', 'codec_a_mu', 'codec_g722', 'codec_gsm', 'codec_opus_open_source',
  'codec_resample', 'format_wav', 'format_wav_gsm', 'format_gsm', 'format_pcm', 'format_sln', 'format_g719',
  // Anwendungen
  'app_dial', 'app_playback', 'app_stack', 'app_voicemail', 'app_queue', 'app_confbridge',
  'app_directed_pickup', 'app_echo', 'app_mixmonitor', 'app_read', 'app_exec', 'app_verbose',
  'app_senddtmf', 'app_playtones', 'app_transfer', 'app_blind_transfer', 'app_sayunixtime',
  'app_softhangup', 'app_chanspy',
  // Funktionen
  'func_curl', 'func_cut', 'func_strings', 'func_logic', 'func_uri', 'func_callerid', 'func_cdr',
  'func_timeout', 'func_channel', 'func_global', 'func_db', 'func_devstate', 'func_hangupcause',
  'func_sprintf', 'func_rand', 'func_env', 'func_pjsip_endpoint', 'func_pjsip_aor', 'func_pjsip_contact',
  'func_vmcount', 'func_volume', 'func_math',
]

function asteriskConf(gen: GenContext): string {
  const d = gen.dirs
  return `[directories]
astetcdir => ${d.etc}
astmoddir => ${d.modules}
astvarlibdir => ${d.lib}
astdbdir => ${d.db}
astkeydir => ${d.lib}
astdatadir => ${d.asteriskData}
astagidir => ${d.asteriskData}/agi-bin
astspooldir => ${d.spool}
astrundir => ${d.run}
astlogdir => ${d.log}
astsbindir => /usr/sbin

[options]
verbose = 0
debug = 0
timestamp = yes
documentation_language = en_US
defaultlanguage = de
transmit_silence = yes
hideconnect = yes
${gen.runUser ? `runuser = ${gen.runUser}\nrungroup = ${gen.runUser}\n` : ''}`
}

function modulesConf(): string {
  return ['[modules]', 'autoload=no', ...MODULES.map((m) => `load => ${m}.so`)].join('\n') + '\n'
}

function loggerConf(): string {
  return `[general]
dateformat=%F %T

[logfiles]
console => notice,warning,error
messages.log => notice,warning,error
`
}

function managerConf(gen: GenContext): string {
  return `[general]
enabled = yes
port = ${gen.ami.port}
bindaddr = 127.0.0.1
displayconnects = no

[phone4all]
secret = ${gen.ami.secret}
deny = 0.0.0.0/0.0.0.0
permit = 127.0.0.1/255.255.255.255
read = system,call,security,agent,user,reporting,dialplan
write = system,call,command,agent,reporting,originate
writetimeout = 5000
`
}

function rtpConf(cfg: PbxConfig): string {
  // ICE nur für WebRTC (Mobil-App, Videoanrufe); andere Endpunkte haben ice_support=no
  return `[general]
rtpstart=${cfg.system.rtp_start}
rtpend=${cfg.system.rtp_end}
strictrtp=yes
icesupport=${webrtcEnabled(cfg) ? 'yes' : 'no'}
`
}

/** HTTP-Server von Asterisk nur lokal: die Anlage reicht /ws von außen weiter */
function httpConf(cfg: PbxConfig, gen: GenContext): string {
  if (!webrtcEnabled(cfg)) return '[general]\nenabled=no\n'
  return `[general]
enabled=yes
bindaddr=127.0.0.1
bindport=${gen.httpPort}
servername=Phone4all
`
}

function voicemailConf(cfg: PbxConfig, gen: GenContext): string {
  const mail = cfg.mail
  const canMail = Boolean(gen.mailer && mail.host && mail.from)
  const lines = [
    '[general]',
    'format=wav49|wav',
    'maxmsg=200',
    'maxsecs=300',
    'minsecs=2',
    'maxlogins=3',
    'review=yes',
    'operator=no',
    'sendvoicemail=yes',
    'charset=UTF-8',
    `fromstring=${val(cfg.system.name)}`,
    `serveremail=${val(mail.from || 'voicemail@phone4all.local')}`,
    canMail ? `mailcmd=${gen.mailer} -C ${gen.dirs.etc}/msmtprc -t` : 'mailcmd=/bin/true',
    'emaildateformat=%d.%m.%Y %H:%M',
    'emailsubject=Neue Sprachnachricht von ${VM_CALLERID}',
    'emailbody=Hallo ${VM_NAME},\\n\\n${VM_CALLERID} hat am ${VM_DATE} eine Nachricht hinterlassen (Länge ${VM_DUR}).\\nAbhören: *97 am Telefon.\\n\\n${VM_MAILBOX} – Phone4all\\n',
    'tz=de',
    '',
    '[zonemessages]',
    `de=${cfg.system.timezone}|'vm-received' Q 'digits/at' kM`,
    '',
    '[default]',
  ]
  for (const ext of cfg.extensions.filter((e) => e.voicemail.enabled)) {
    const pin = ext.voicemail.pin.replace(/\D/g, '') || ext.number
    const email = canMail ? val(ext.email).replace(/,/g, '') : ''
    const opts = [`attach=${ext.voicemail.attach ? 'yes' : 'no'}`, 'saycid=yes', 'envelope=no', 'tz=de']
    lines.push(`${ext.number} => ${pin},${val(ext.name).replace(/,/g, ' ')},${email},,${opts.join('|')}`)
  }
  return lines.join('\n') + '\n'
}

function msmtprc(cfg: PbxConfig): string {
  const m = cfg.mail
  if (!m.host) return ''
  return [
    'defaults',
    'logfile -',
    'account default',
    `host ${m.host}`,
    `port ${m.port || 587}`,
    `from ${m.from}`,
    m.tls === 'none' ? 'tls off' : 'tls on',
    m.tls === 'tls' ? 'tls_starttls off' : '',
    'tls_trust_file /etc/ssl/certs/ca-certificates.crt',
    m.user ? 'auth on' : 'auth off',
    m.user ? `user ${m.user}` : '',
    m.user ? `password ${m.password}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .concat('\n')
}

function queuesConf(cfg: PbxConfig): string {
  const lines = ['[general]', 'persistentmembers=no', 'autofill=yes', 'shared_lastcall=yes', '']
  for (const g of cfg.groups.filter((g) => g.mode === 'queue')) {
    lines.push(
      `[p4a-${g.id}]`,
      `strategy=${g.strategy}`,
      `timeout=${Math.max(5, g.member_seconds || 15)}`,
      'retry=3',
      'wrapuptime=5',
      'musicclass=default',
      'joinempty=yes',
      'leavewhenempty=no',
      'ringinuse=no',
      'announce-frequency=0',
      'periodic-announce-frequency=0',
      'setinterfacevar=yes',
    )
    for (const num of g.members) {
      const ext = cfg.extensions.find((e) => e.number === num)
      // Zustand über den Hinweis, der auch die Mobil-App umfasst
      if (ext) lines.push(`member => Local/${num}@p4a-qmember/n,0,${val(ext.name).replace(/,/g, ' ')},${cfg.remote.enabled ? `hint:${num}@p4a-local` : `PJSIP/${num}`}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function confbridgeConf(): string {
  return `[general]

[default_bridge]
type=bridge
max_members=50

[default_user]
type=user
music_on_hold_when_empty=yes
announce_user_count=yes
announce_join_leave=no
dsp_drop_silence=yes

; Videoanrufe aus dem Messenger: jedes Bild wird einzeln weitergeleitet (SFU)
[p4a-video]
type=bridge
video_mode=sfu
max_members=25
remb_send_interval=1000
remb_behavior=lowest_all

[p4a-video-user]
type=user
quiet=yes
announce_user_count=no
music_on_hold_when_empty=no
dsp_drop_silence=yes
`
}

function mohConf(gen: GenContext): string {
  return `[general]

[default]
mode=files
directory=${gen.dirs.moh}
sort=random
`
}

function cdrConf(): string {
  return `[general]
enable=yes
unanswered=yes
congestion=yes
endbeforehexten=yes
`
}

function cdrCustomConf(): string {
  const fields = [
    'start',
    'answer',
    'end',
    'duration',
    'billsec',
    'disposition',
    'src',
    'clid',
    'dst',
    'dcontext',
    'channel',
    'dstchannel',
    'uniqueid',
    'linkedid',
    'userfield',
    'recordingfile',
    'lastapp',
    'p4a_to',
  ]
  return `[mappings]
cdr.csv => ${fields.map((f) => `\${CSV_QUOTE(\${CDR(${f})})}`).join(',')}
`
}

function indicationsConf(): string {
  // Deutsche Töne (aus der Asterisk-Beispielkonfiguration)
  return `[general]
country=de

[de]
description = Germany
ringcadence = 1000,4000
dial = 425
busy = 425/480,0/480
ring = 425/1000,0/4000
congestion = 425/240,0/240
callwaiting = !425/200,!0/200,!425/200,!0/5000,!425/200,!0/200,!425/200,!0/5000,!425/200,!0/200,!425/200,!0/5000,!425/200,!0/200,!425/200,!0/5000,!425/200,!0/200,!425/200,0
dialrecall = !425/100,!0/100,!425/100,!0/100,!425/100,!0/100,425
record = 1400/80,0/15000
info = 950/330,1400/330,1800/330,0/1000
stutter = 425+400
`
}

function featuresConf(): string {
  return `[general]
transferdigittimeout => 3

[featuremap]
blindxfer => #1
atxfer => *2
`
}

export function generate(cfg: PbxConfig, gen: GenContext): Record<string, string> {
  const files: Record<string, string> = {
    'asterisk.conf': asteriskConf(gen),
    'modules.conf': modulesConf(),
    'logger.conf': loggerConf(),
    'manager.conf': managerConf(gen),
    'pjsip.conf': pjsipConf(cfg, gen),
    'extensions.conf': extensionsConf(cfg, gen),
    'rtp.conf': rtpConf(cfg),
    'voicemail.conf': voicemailConf(cfg, gen),
    'queues.conf': queuesConf(cfg),
    'confbridge.conf': confbridgeConf(),
    'musiconhold.conf': mohConf(gen),
    'cdr.conf': cdrConf(),
    'cdr_custom.conf': cdrCustomConf(),
    'indications.conf': indicationsConf(),
    'features.conf': featuresConf(),
    'ccss.conf': '[general]\n',
    'udptl.conf': '[general]\n',
    'acl.conf': '',
    'http.conf': httpConf(cfg, gen),
    'pjproject.conf': '',
    'stasis.conf': '',
    'cel.conf': '[general]\nenable=no\n',
    'pjsip_notify.conf': '',
    'res_stun_monitor.conf': '',
  }
  const rc = msmtprc(cfg)
  if (rc) files.msmtprc = rc
  return files
}
