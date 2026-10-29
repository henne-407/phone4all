/**
 * extensions.conf: Der Wählplan ist bewusst schlank. Entscheidungen (Rufnummern
 * zuordnen, Berechtigungen, Weiterleitungen, Öffnungszeiten) trifft der
 * Verwaltungsdienst; Asterisk fragt ihn über CURL (siehe routing.ts).
 */

import type { PbxConfig } from '../model'
import { videoEnabled } from '../remote'
import { destTarget, gotoArgs } from '../targets'
import type { GenContext } from './context'

/** Wählplan-Zeilen einer Extension: erste Zeile mit Priorität 1, weitere mit „same => n“. */
function exten(name: string, steps: string[]): string[] {
  return steps.map((s, i) => {
    const [label, app] = s.startsWith('(') ? [s.slice(0, s.indexOf(')') + 1), s.slice(s.indexOf(')') + 1)] : ['', s]
    return i === 0 ? `exten => ${name},1${label},${app}` : ` same => n${label},${app}`
  })
}

function ctx(name: string, ...blocks: string[][]): string {
  return [`[${name}]`, ...blocks.flat()].join('\n') + '\n'
}

/** Ansage: eigene Dateien liegen ohne Endung im Ansagen-Ordner. */
function soundPath(cfg: PbxConfig, gen: GenContext, announcementId: string): string {
  const a = cfg.announcements.find((x) => x.id === announcementId)
  return a?.file ? `${gen.dirs.sounds}/${a.file}` : ''
}

const CURL_TIMEOUT = 'Set(CURLOPT(httptimeout)=3)'

/** Gewähltes Ziel für die Anrufliste merken (nur das erste, nicht Zwischenschritte) */
const MARK_TO = 'ExecIf($["${CDR(p4a_to)}" = ""]?Set(CDR(p4a_to)=${EXTEN}))'

function goTo(variable: string): string {
  return `Goto(\${CUT(${variable},^,1)},\${CUT(${variable},^,2)},1)`
}

/**
 * Erreichbare Geräte einer Nebenstelle nach C: Telefone und – mit Zugriff von unterwegs –
 * die Mobil-App (<nummer>-app). Doppelpunkte in den Kontakten verbieten IF(), daher Sprünge.
 */
function contacts(variable: string, app: boolean): string {
  return app ? `Gosub(p4a-contacts,s,1(\${${variable}}))` : `Set(C=\${PJSIP_DIAL_CONTACTS(\${${variable}})})`
}

function contactsContext(): string {
  return ctx(
    'p4a-contacts',
    exten('s', [
      'Set(C=${PJSIP_DIAL_CONTACTS(${ARG1})})',
      'Set(A=${PJSIP_DIAL_CONTACTS(${ARG1}-app)})',
      'GotoIf($["${A}" = ""]?done)',
      'GotoIf($["${C}" = ""]?only)',
      'Set(C=${C}&${A})',
      'Goto(done)',
      '(only)Set(C=${A})',
      '(done)Return()',
    ]),
  )
}

/**
 * Grenzen für gleichzeitige Gespräche nach außen (Schutz vor Gebührenbetrug): je
 * Nebenstelle (bei Umleitungen die umleitende) und für die ganze Anlage. Notrufe zählen
 * mit, werden aber nie abgewiesen.
 */
function limitSteps(maxExt: number, maxTotal: number): string[] {
  if (maxExt <= 0 && maxTotal <= 0) return []
  return [
    'Set(P4A_ACTOR=x${IF($["${P4A_FWDBY}" = ""]?${P4A_EXT}:${P4A_FWDBY})})',
    'Set(GROUP(p4a-out)=all)',
    'Set(GROUP(p4a-actor)=${P4A_ACTOR})',
    'GotoIf($["${P4A_NUM}" = "110" | "${P4A_NUM}" = "112"]?go)',
    ...(maxTotal > 0 ? [`GotoIf($[\${GROUP_COUNT(all@p4a-out)} > ${maxTotal}]?limit)`] : []),
    ...(maxExt > 0 ? [`GotoIf($[\${GROUP_COUNT(\${P4A_ACTOR}@p4a-actor)} > ${maxExt}]?limit)`] : []),
  ]
}

function genericContexts(app: boolean, parking: boolean, maxExt: number, maxTotal: number): string[] {
  const limits = limitSteps(maxExt, maxTotal)
  return [
    ...(app ? [contactsContext()] : []),
    ctx(
      'p4a-from-ext',
      // Parkplätze (res_parking legt p4a-park selbst an) vor den Wahlregeln, sonst ginge 701 nach außen
      ['include => p4a-features', 'include => p4a-local', ...(parking ? ['include => p4a-park'] : []), 'include => p4a-outbound'],
    ),
    // Anruf über die Schnittstelle (/api/integration/call): erst klingeln die Geräte der
    // Nebenstelle (ohne Umleitungen), nach dem Abheben wählt die Anlage die Nummer
    ctx(
      'p4a-originate',
      exten('_X.', [
        'Set(P4A_TARGET=${EXTEN})',
        contacts('P4A_TARGET', app),
        'GotoIf($["${C}" = ""]?end)',
        'Set(CALLERID(num)=${P4A_DIAL})',
        'Set(CALLERID(name)=Anruf an ${P4A_DIAL})',
        'Dial(${C},30)',
        '(end)Hangup()',
      ]),
    ),
    ctx(
      'p4a-from-trunk',
      exten('_[+0-9a-zA-Z].', ['Set(P4A_RAW=${EXTEN})', 'Goto(p4a-trunk-in,s,1)']),
      exten('s', ['Set(P4A_RAW=)', 'Goto(p4a-trunk-in,s,1)']),
    ),
    ctx(
      'p4a-trunk-in',
      exten('s', [
        'NoOp(Eingehend über ${P4A_TRUNK}: ${P4A_RAW} von ${CALLERID(num)})',
        CURL_TIMEOUT,
        'Set(R=${CURL(${P4A_API}/in?trunk=${P4A_TRUNK}&did=${URIENCODE(${P4A_RAW})}&to=${URIENCODE(${PJSIP_HEADER(read,To)})}&cid=${URIENCODE(${CALLERID(num)})}&name=${URIENCODE(${CALLERID(name)})})})',
        'Set(T=${CUT(R,|,1)})',
        'GotoIf($["${T}" = ""]?fail)',
        'Set(CALLERID(name)=${CUT(R,|,2)})',
        'Set(CALLERID(num)=${CUT(R,|,3)})',
        'Set(CDR(p4a_to)=${CUT(R,|,4)})',
        'Set(CDR(userfield)=in)',
        goTo('T'),
        // Verwaltungsdienst antwortet nicht: Standardziel des SIP-Kontos (fest im Wählplan)
        '(fail)Goto(p4a-trunk-fallback,${P4A_TRUNK},1)',
      ]),
    ),
    ctx(
      'p4a-features',
      exten('*97', ['Answer()', 'Wait(0.5)', 'VoiceMailMain(${P4A_EXT}@default,s)', 'Hangup()']),
      // Fremde Mailboxen nur mit dem Recht voicemail_other
      exten('*98', [
        'Answer()',
        'Wait(0.5)',
        CURL_TIMEOUT,
        'Set(R=${CURL(${P4A_API}/feature?ext=${P4A_EXT}&code=vmother)})',
        'GotoIf($["${R}" != "on"]?deny)',
        'VoiceMailMain(@default)',
        'Hangup()',
        '(deny)Playback(pbx-invalid)',
        'Hangup()',
      ]),
      exten('*8', ['Pickup()', 'Hangup()']),
      exten('_**X.', ['Pickup(${EXTEN:2}@PICKUPMARK)', 'Hangup()']),
      exten('*76', ['Gosub(p4a-feature,s,1(dnd,))', 'Hangup()']),
      exten('*21', ['Gosub(p4a-feature,s,1(cfu,))', 'Hangup()']),
      exten('_*21X.', ['Gosub(p4a-feature,s,1(cfu,${EXTEN:3}))', 'Hangup()']),
      exten('_*28X', ['Gosub(p4a-feature,s,1(tc,${EXTEN:3}))', 'Hangup()']),
      // Aus Gruppen ab- und wieder anmelden: *45 alle, *45<Gruppe> eine
      exten('*45', ['Gosub(p4a-feature,s,1(away,))', 'Hangup()']),
      exten('_*45X.', ['Gosub(p4a-feature,s,1(away,${EXTEN:3}))', 'Hangup()']),
      // Gegensprechen (*80<Nebenstelle>) und Durchsage (*81<Gruppe>, *81 an alle)
      exten('_*80X.', ['Set(PT=${EXTEN:3})', 'Set(PM=intercom)', 'Goto(p4a-page-run,s,1)']),
      exten('_*81X.', ['Set(PT=${EXTEN:3})', 'Set(PM=page)', 'Goto(p4a-page-run,s,1)']),
      exten('*81', ['Set(PT=)', 'Set(PM=page)', 'Goto(p4a-page-run,s,1)']),
      exten('_*31X.', ['Set(CALLERID(pres)=prohib)', 'Set(P4A_NUM=${EXTEN:3})', 'Goto(p4a-out,s,1)']),
      exten('*43', ['Answer()', 'Playback(demo-echotest)', 'Echo()', 'Hangup()']),
    ),
    ctx(
      'p4a-feature',
      exten('s', [
        'Answer()',
        'Wait(0.5)',
        CURL_TIMEOUT,
        'Set(R=${CURL(${P4A_API}/feature?ext=${P4A_EXT}&code=${ARG1}&arg=${URIENCODE(${ARG2})})})',
        'GotoIf($["${R}" = "on"]?on)',
        'GotoIf($["${R}" = "off"]?off)',
        'Playback(pbx-invalid)',
        'Return()',
        '(on)Playback(beep)',
        'Return()',
        '(off)Playback(beep)',
        'Playback(beep)',
        'Return()',
      ]),
    ),
    // Handy der Nebenstelle (EXTEN) klingelt mit: nach der Verzögerung über das SIP-Konto,
    // als Umleitung der Nebenstelle (Rechte, Grenzen, angezeigte Nummer wie bei Umleitungen)
    ctx(
      'p4a-mobile',
      exten('_X.', [
        CURL_TIMEOUT,
        'Set(R=${CURL(${P4A_API}/mobile?num=${EXTEN})})',
        'Set(N=${CUT(R,|,2)})',
        'GotoIf($["${N}" = ""]?end)',
        'Set(D=${CUT(R,|,1)})',
        'GotoIf($["${D}" = "0"]?dial)',
        'Wait(${D})',
        '(dial)Set(P4A_FWDBY=${EXTEN})',
        'Set(P4A_NUM=${N})',
        'Set(P4A_DIALOPTS=${IF($["${CUT(R,|,3)}" = "1"]?U(p4a-confirm^s^1):)})',
        'Goto(p4a-out,s,1)',
        '(end)Hangup()',
      ]),
    ),
    // Am Handy erst mit Taste 1 annehmen – sonst nähme die Mailbox des Handys den Anruf an
    ctx(
      'p4a-confirm',
      exten('s', [
        'Set(TRIES=0)',
        '(ask)Read(KEY,beep&vm-press&digits/1,1,,1,4)',
        'GotoIf($["${KEY}" = "1"]?ok)',
        'Set(TRIES=$[${TRIES} + 1])',
        'GotoIf($[${TRIES} < 3]?ask)',
        'Set(GOSUB_RESULT=ABORT)',
        '(ok)Return()',
      ]),
    ),
    // Durchsage und Gegensprechen: Telefone nehmen von selbst an (Call-Info/Alert-Info)
    ctx(
      'p4a-page-run',
      exten('s', [
        CURL_TIMEOUT,
        'Set(R=${CURL(${P4A_API}/page?ext=${P4A_EXT}&target=${URIENCODE(${PT})}&mode=${PM})})',
        'GotoIf($["${R}" = ""]?deny)',
        'Set(D=)',
        'Set(I=1)',
        '(next)Set(M=${CUT(R,&,${I})})',
        'GotoIf($["${M}" = ""]?page)',
        contacts('M', app),
        'Set(I=$[${I} + 1])',
        'GotoIf($["${C}" = ""]?next)',
        'Set(D=${D}&${C})',
        'Goto(next)',
        '(page)GotoIf($["${D}" = ""]?deny)',
        'Page(${D:1},${IF($["${PM}" = "intercom"]?d:)}isb(p4a-autoanswer^s^1),20)',
        'Hangup()',
        '(deny)Answer()',
        'Playback(pbx-invalid)',
        'Hangup()',
      ]),
    ),
    ctx(
      'p4a-autoanswer',
      exten('s', [
        'Set(PJSIP_HEADER(add,Call-Info)=<sip:phone4all>\\;answer-after=0)',
        'Set(PJSIP_HEADER(add,Alert-Info)=<http://phone4all/autoanswer>\\;info=alert-autoanswer\\;delay=0)',
        'Return()',
      ]),
    ),
    // Rückfrage zur Dreierkonferenz zusammenführen (/provision/<token>/calls/join)
    ctx('p4a-join', exten('_X.', ['Answer()', 'ConfBridge(p4a-3way-${EXTEN})', 'Hangup()'])),
    // Telefone einer Nebenstelle oder Gruppe klingeln lassen (Ansagen über die Schnittstelle)
    ctx(
      'p4a-ring',
      exten('_X.', [
        CURL_TIMEOUT,
        'Set(R=${CURL(${P4A_API}/ring?target=${EXTEN})})',
        'Set(D=)',
        'Set(I=1)',
        '(next)Set(M=${CUT(R,&,${I})})',
        'GotoIf($["${M}" = ""]?dial)',
        contacts('M', app),
        'Set(I=$[${I} + 1])',
        'GotoIf($["${C}" = ""]?next)',
        'Set(D=${D}&${C})',
        'Goto(next)',
        '(dial)GotoIf($["${D}" = ""]?end)',
        'Dial(${D:1},30)',
        '(end)Hangup()',
      ]),
    ),
    ctx(
      'p4a-outbound',
      exten('_+X.', ['Set(P4A_NUM=${EXTEN})', 'Goto(p4a-out,s,1)']),
      exten('_X.', ['Set(P4A_NUM=${EXTEN})', 'Goto(p4a-out,s,1)']),
    ),
    ctx(
      'p4a-fwd',
      exten('_[+0-9].', [
        'Set(P4A_FWDBY=${IF($["${P4A_FWDBY}" = ""]?flow:${P4A_FWDBY})})',
        'Set(P4A_NUM=${EXTEN})',
        'Goto(p4a-out,s,1)',
      ]),
    ),
    ctx(
      'p4a-out',
      exten('s', [
        CURL_TIMEOUT,
        'Set(R=${CURL(${P4A_API}/out?ext=${P4A_EXT}&fwd=${P4A_FWDBY}&num=${URIENCODE(${P4A_NUM})}&cid=${URIENCODE(${CALLERID(num)})})})',
        'Set(ST=${CUT(R,|,1)})',
        'GotoIf($["${ST}" = "ok"]?dial)',
        'GotoIf($["${ST}" = "local"]?local)',
        'Answer()',
        'Wait(0.5)',
        'Playback(ss-noservice)',
        'Hangup()',
        '(dial)Set(CDR(userfield)=out)',
        'Set(CDR(p4a_to)=${P4A_NUM})',
        ...limits,
        '(go)Set(I=2)',
        '(next)Set(EP=${CUT(R,|,${I})})',
        'GotoIf($["${EP}" = ""]?fail)',
        'Set(NUM=${CUT(R,|,$[${I} + 1])})',
        'Set(OCID=${CUT(R,|,$[${I} + 2])})',
        'GotoIf($["${OCID}" = ""]?nocid)',
        'Set(CALLERID(num)=${OCID})',
        '(nocid)Dial(PJSIP/${NUM}@${EP},,${P4A_DIALOPTS})',
        'GotoIf($["${DIALSTATUS}" = "CHANUNAVAIL" | "${DIALSTATUS}" = "CONGESTION"]?retry)',
        'Hangup()',
        '(retry)Set(I=$[${I} + 3])',
        'Goto(next)',
        '(fail)Congestion(5)',
        'Hangup()',
        ...(limits.length
          ? [
              '(limit)Set(R=${CURL(${P4A_API}/alert?kind=limit&ext=${URIENCODE(${P4A_ACTOR:1})})})',
              'Congestion(5)',
              'Hangup()',
            ]
          : []),
        // Eigene Nummer eines SIP-Kontos: wie ein Anruf von außen weiterleiten
        '(local)Set(T=${CUT(R,|,2)})',
        'Set(CALLERID(name)=${CUT(R,|,3)})',
        'Set(CALLERID(num)=${CUT(R,|,4)})',
        'Set(CDR(p4a_to)=${CUT(R,|,5)})',
        'Set(CDR(userfield)=local)',
        goTo('T'),
      ]),
    ),
    ctx(
      'p4a-ext-run',
      exten('s', [
        'Set(P4A_HOPS=$[0${P4A_HOPS} + 1])',
        'GotoIf($[${P4A_HOPS} > 6]?loop)',
        CURL_TIMEOUT,
        'Set(R=${CURL(${P4A_API}/ext?num=${P4A_TARGET}&from=${URIENCODE(${CALLERID(num)})})})',
        'Set(ACT=${CUT(R,|,1)})',
        'GotoIf($["${ACT}" = "goto"]?go)',
        'Set(RT=${CUT(R,|,2)})',
        'Set(REC=${CUT(R,|,3)})',
        'Set(BUSY=${CUT(R,|,4)})',
        'Set(NOANS=${CUT(R,|,5)})',
        'Set(MOB=${CUT(R,|,6)})',
        'Set(RT=${IF($["${RT}" = ""]?30:${RT})})',
        contacts('P4A_TARGET', app),
        // Handy klingelt mit (über das SIP-Konto, siehe p4a-mobile)
        'GotoIf($["${MOB}" != "1"]?nomob)',
        'GotoIf($["${C}" = ""]?mobonly)',
        'Set(C=${C}&Local/${P4A_TARGET}@p4a-mobile)',
        'Goto(nomob)',
        '(mobonly)Set(C=Local/${P4A_TARGET}@p4a-mobile)',
        '(nomob)GotoIf($["${C}" = ""]?noans)',
        'Set(__PICKUPMARK=${P4A_TARGET})',
        'GotoIf($["${REC}" != "1"]?dial)',
        'Set(CDR(recordingfile)=${LINKEDID}-${UNIQUEID}.wav)',
        'MixMonitor(${P4A_REC}/${LINKEDID}-${UNIQUEID}.wav,b)',
        '(dial)Dial(${C},${RT},${P4A_DIALOPTS})',
        'GotoIf($["${DIALSTATUS}" = "BUSY"]?busy)',
        'GotoIf($["${DIALSTATUS}" = "ANSWER" | "${DIALSTATUS}" = "CANCEL"]?done)',
        '(noans)Set(T=${NOANS})',
        'Goto(target)',
        '(busy)Set(T=${BUSY})',
        'Goto(target)',
        '(go)Set(T=${CUT(R,|,2)})',
        '(target)GotoIf($["${T}" = ""]?busytone)',
        'Set(P4A_FWDBY=${P4A_TARGET})',
        goTo('T'),
        '(busytone)Busy(10)',
        'Hangup()',
        '(loop)Congestion(5)',
        '(done)Hangup()',
      ]),
    ),
    ctx(
      'p4a-group-run',
      exten('s', [
        CURL_TIMEOUT,
        'Set(R=${CURL(${P4A_API}/group?id=${P4A_GID}&name=${URIENCODE(${CALLERID(name)})})})',
        'Set(MODE=${CUT(R,|,1)})',
        'GotoIf($["${MODE}" = ""]?done)',
        'UserEvent(P4AGroup,Group: ${P4A_GID})',
        'Set(TO=${CUT(R,|,2)})',
        'Set(MEMBERS=${CUT(R,|,3)})',
        'Set(FB=${CUT(R,|,4)})',
        'Set(NAME=${CUT(R,|,5)})',
        'Set(ANN=${CUT(R,|,6)})',
        'Set(MS=${CUT(R,|,7)})',
        'Set(CALLERID(name)=${NAME})',
        'GotoIf($["${ANN}" = ""]?mode)',
        'Answer()',
        'Playback(${ANN})',
        '(mode)GotoIf($["${MODE}" = "queue"]?queue)',
        'GotoIf($["${MODE}" = "sequential"]?seq)',
        'Set(D=)',
        'Set(I=1)',
        '(allnext)Set(M=${CUT(MEMBERS,&,${I})})',
        'GotoIf($["${M}" = ""]?alldial)',
        contacts('M', app),
        'Set(I=$[${I} + 1])',
        'GotoIf($["${C}" = ""]?allnext)',
        'Set(D=${D}&${C})',
        'Goto(allnext)',
        '(alldial)GotoIf($["${D}" = ""]?fallback)',
        'Dial(${D:1},${TO},${P4A_DIALOPTS})',
        'GotoIf($["${DIALSTATUS}" = "ANSWER" | "${DIALSTATUS}" = "CANCEL"]?done)',
        'Goto(fallback)',
        '(seq)Set(I=1)',
        '(seqnext)Set(M=${CUT(MEMBERS,&,${I})})',
        'GotoIf($["${M}" = ""]?fallback)',
        contacts('M', app),
        'Set(I=$[${I} + 1])',
        'GotoIf($["${C}" = ""]?seqnext)',
        'Dial(${C},${MS},${P4A_DIALOPTS})',
        'GotoIf($["${DIALSTATUS}" = "ANSWER" | "${DIALSTATUS}" = "CANCEL"]?done)',
        'Goto(seqnext)',
        '(queue)Set(__P4A_QGID=${P4A_GID})',
        'Queue(p4a-${P4A_GID},t,,,${TO})',
        'GotoIf($["${QUEUESTATUS}" = ""]?done)',
        '(fallback)' + goTo('FB'),
        '(done)Hangup()',
      ]),
    ),
    ctx(
      'p4a-qmember',
      exten('_X.', [
        CURL_TIMEOUT,
        'GotoIf($["${CURL(${P4A_API}/available?num=${EXTEN}&gid=${P4A_QGID})}" = "0"]?off)',
        contacts('EXTEN', app),
        'GotoIf($["${C}" = ""]?off)',
        'Dial(${C})',
        '(off)Hangup()',
      ]),
    ),
    ctx(
      'p4a-tc-run',
      exten('s', [
        CURL_TIMEOUT,
        'Set(T=${CURL(${P4A_API}/tc?id=${P4A_TC})})',
        'GotoIf($["${T}" = ""]?fail)',
        goTo('T'),
        '(fail)Hangup()',
      ]),
    ),
    ctx(
      'p4a-vmu',
      exten('_X.', ['Answer()', 'Wait(0.5)', 'VoiceMail(${EXTEN}@default,u)', 'Hangup()']),
    ),
    ctx(
      'p4a-vmb',
      exten('_X.', ['Answer()', 'Wait(0.5)', 'VoiceMail(${EXTEN}@default,b)', 'Hangup()']),
    ),
    ctx('p4a-hangup', exten('s', ['Hangup()'])),
    // Gesperrter Anrufer (Sperrliste): abweisen, in der Anrufliste als gesperrt vermerken
    ctx('p4a-blocked', exten('s', ['Set(CDR(userfield)=blocked)', 'Hangup(21)'])),
  ]
}

export function extensionsConf(cfg: PbxConfig, gen: GenContext): string {
  const parts: string[] = [
    '; Erzeugt von Phone4all – Änderungen in der Weboberfläche vornehmen',
    ctx('general', ['static=yes', 'writeprotect=yes', 'clearglobalvars=yes']),
    ctx('globals', [`P4A_API=${gen.apiUrl}`, `P4A_REC=${gen.dirs.recordings}`, 'P4A_DIALOPTS=']),
    ...genericContexts(cfg.remote.enabled, cfg.parking.enabled, cfg.security.max_calls_ext, cfg.security.max_calls_total),
  ]

  // Interne Rufnummern
  const local: string[][] = []
  for (const ext of cfg.extensions) {
    const hint = cfg.remote.enabled ? `PJSIP/${ext.number}&PJSIP/${ext.number}-app` : `PJSIP/${ext.number}`
    local.push([`exten => ${ext.number},hint,${hint}`])
    local.push(exten(ext.number, [MARK_TO, 'Set(P4A_TARGET=${EXTEN})', 'Goto(p4a-ext-run,s,1)']))
  }
  for (const g of cfg.groups) {
    if (g.number) local.push(exten(g.number, [MARK_TO, `Goto(p4a-group,${g.id},1)`]))
  }
  for (const c of cfg.conferences) local.push(exten(c.number, [MARK_TO, `Goto(p4a-conf,${c.number},1)`]))
  for (const f of cfg.faxes) if (f.number) local.push(exten(f.number, [MARK_TO, `Goto(p4a-fax,${f.id},1)`]))
  for (const ivr of cfg.ivrs) {
    if (ivr.number) local.push(exten(ivr.number, [MARK_TO, `Goto(p4a-ivr-${ivr.id},s,1)`]))
  }
  parts.push(ctx('p4a-local', ...local))

  parts.push(
    ctx(
      'p4a-trunk-fallback',
      ...cfg.trunks.map((t) => exten(t.id, ['NoOp(Verwaltungsdienst antwortet nicht)', `Goto(${gotoArgs(destTarget(cfg, t.inbound_default))})`])),
      exten('i', ['Hangup(34)']),
    ),
    ctx('p4a-group', ...cfg.groups.map((g) => exten(g.id, [`Set(P4A_GID=${g.id})`, 'Goto(p4a-group-run,s,1)']))),
    ctx(
      'p4a-tc',
      ...cfg.timeconditions.map((tc) => exten(tc.id, [`Set(P4A_TC=${tc.id})`, 'Goto(p4a-tc-run,s,1)'])),
    ),
  )

  // Konferenzen
  const conf: string[][] = []
  for (const c of cfg.conferences) {
    const steps = ['Answer()', 'Wait(0.5)']
    if (c.max_members > 0) steps.push(`Set(CONFBRIDGE(bridge,max_members)=${c.max_members})`)
    if (c.record) {
      steps.push(
        'Set(CONFBRIDGE(bridge,record_conference)=yes)',
        `Set(CONFBRIDGE(bridge,record_file)=${gen.dirs.recordings}/konferenz-${c.number}-\${EPOCH}.wav)`,
      )
    }
    const pin = c.pin.replace(/\D/g, '')
    const admin = c.admin_pin.replace(/\D/g, '')
    if (pin || admin) {
      steps.push(
        'Set(TRIES=0)',
        '(pin)Read(PIN,conf-getpin,8,,1,10)',
        ...(admin ? [`GotoIf($["\${PIN}" = "${admin}"]?admin)`] : []),
        // Ohne Teilnehmer-PIN kommt jeder hinein; die PIN-Abfrage gilt nur der Moderation
        pin ? `GotoIf($["\${PIN}" = "${pin}"]?join)` : 'Goto(join)',
        'Set(TRIES=$[${TRIES} + 1])',
        'GotoIf($[${TRIES} < 3]?pin)',
        'Playback(conf-invalidpin)',
        'Hangup()',
        '(admin)Set(CONFBRIDGE(user,admin)=yes)',
        'Set(CONFBRIDGE(user,marked)=yes)',
      )
    }
    steps.push(`(join)ConfBridge(p4a-${c.number})`, 'Hangup()')
    conf.push(exten(c.number, steps))
  }
  parts.push(ctx('p4a-conf', ...conf))

  // Fax empfangen (als Ton über G.711 oder T.38) und senden; die Anlage macht daraus PDF und E-Mail
  if (cfg.faxes.length) {
    const faxDir = `${gen.dirs.spool}/fax`
    parts.push(
      ctx(
        'p4a-fax',
        ...cfg.faxes.map((f) =>
          exten(f.id, [
            'Set(P4A_FAXBOX=${EXTEN})',
            'Set(CDR(userfield)=fax)',
            `Set(FAXOPT(localstationid)=${f.station || 'Phone4all'})`,
            ...(f.header ? [`Set(FAXOPT(headerinfo)=${f.header})`] : []),
            'Answer()',
            `Set(P4A_FAXFILE=${faxDir}/in-\${UNIQUEID}.tif)`,
            'ReceiveFAX(${P4A_FAXFILE},f)',
            'Hangup()',
          ]),
        ),
        exten('h', [
          CURL_TIMEOUT,
          'Set(R=${CURL(${P4A_API}/fax?box=${P4A_FAXBOX}&file=${URIENCODE(${P4A_FAXFILE})}&status=${FAXSTATUS}&error=${URIENCODE(${FAXERROR})}&pages=${FAXPAGES}&remote=${URIENCODE(${REMOTESTATIONID})}&from=${URIENCODE(${CALLERID(num)})})})',
        ]),
      ),
      ctx(
        'p4a-fax-send',
        exten('s', [
          CURL_TIMEOUT,
          'Set(R=${CURL(${P4A_API}/fax-job?job=${P4A_FAXJOB})})',
          'Set(P4A_FAXFILE=${CUT(R,|,1)})',
          'GotoIf($["${P4A_FAXFILE}" = ""]?end)',
          'Set(FAXOPT(localstationid)=${CUT(R,|,2)})',
          'Set(FAXOPT(headerinfo)=${CUT(R,|,3)})',
          'Set(CDR(userfield)=fax)',
          'SendFAX(${P4A_FAXFILE},f)',
          '(end)Hangup()',
        ]),
        exten('h', [
          CURL_TIMEOUT,
          'Set(R=${CURL(${P4A_API}/fax-sent?job=${P4A_FAXJOB}&status=${FAXSTATUS}&error=${URIENCODE(${FAXERROR})}&pages=${FAXPAGES}&remote=${URIENCODE(${REMOTESTATIONID})})})',
        ]),
      ),
    )
  }

  // Videoanrufe aus dem Messenger: Raum-ID wählen, die Anlage prüft die Mitgliedschaft
  if (videoEnabled(cfg)) {
    parts.push(
      ctx(
        'p4a-video',
        exten('_[dg].', [
          CURL_TIMEOUT,
          'GotoIf($["${CURL(${P4A_API}/video?ext=${P4A_EXT}&room=${URIENCODE(${EXTEN})})}" = "1"]?join)',
          'Hangup(21)',
          '(join)Answer()',
          'ConfBridge(p4a-chat-${EXTEN},p4a-video,p4a-video-user)',
          'Hangup()',
        ]),
      ),
    )
  }

  // Ansagen
  for (const a of cfg.announcements) {
    const file = soundPath(cfg, gen, a.id)
    parts.push(
      ctx(
        `p4a-ann-${a.id}`,
        exten('s', [
          'Answer()',
          'Wait(0.5)',
          file ? `Playback(${file})` : 'NoOp(Keine Datei)',
          `Goto(${gotoArgs(destTarget(cfg, a.next))})`,
        ]),
      ),
    )
  }

  // Sprachmenüs
  for (const ivr of cfg.ivrs) {
    const file = soundPath(cfg, gen, ivr.announcement)
    const timeout = Math.max(1, ivr.timeout || 5)
    const repeats = Math.max(1, ivr.repeats || 1)
    const blocks: string[][] = [
      exten('s', [
        'Answer()',
        'Wait(0.5)',
        'Set(P4A_TRIES=0)',
        '(start)Set(TIMEOUT(digit)=3)',
        `Set(TIMEOUT(response)=${timeout})`,
        file ? `Background(${file})` : 'NoOp(Keine Ansage)',
        `WaitExten(${timeout})`,
      ]),
    ]
    for (const opt of ivr.options) {
      if (/^[0-9*#]$/.test(opt.digit)) blocks.push(exten(opt.digit, [`Goto(${gotoArgs(destTarget(cfg, opt.destination))})`]))
    }
    for (const [ext, dest] of [
      ['t', ivr.timeout_destination],
      ['i', ivr.invalid_destination],
    ] as const) {
      blocks.push(
        exten(ext, [
          ext === 'i' ? 'Playback(invalid)' : 'NoOp(Zeitüberschreitung)',
          'Set(P4A_TRIES=$[${P4A_TRIES} + 1])',
          `GotoIf($[\${P4A_TRIES} < ${repeats}]?s,start)`,
          `Goto(${gotoArgs(destTarget(cfg, dest))})`,
        ]),
      )
    }
    if (ivr.direct_dial) blocks.push(['include => p4a-local'])
    parts.push(ctx(`p4a-ivr-${ivr.id}`, ...blocks))
  }

  return parts.join('\n')
}
