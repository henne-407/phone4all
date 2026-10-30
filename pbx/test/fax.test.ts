import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FaxStore, faxErrorText, faxRoute, pdfToTiff, tiffPages, tiffToPdf } from '../server/fax'
import { generate } from '../server/generate'
import { type FaxBox, blankItem } from '../server/model'
import { destTarget } from '../server/targets'
import { gen, sampleConfig } from './helpers'

const dirs: string[] = []
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'p4a-fax-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const has = (cmd: string): boolean => {
  try {
    execFileSync('sh', ['-c', `command -v ${cmd}`])
    return true
  } catch {
    return false
  }
}

function withFax() {
  const cfg = sampleConfig()
  const box: FaxBox = { ...(blankItem('faxes') as unknown as FaxBox), id: 'xfax1', name: 'Fax Büro', email: 'fax@example.de', station: '+49 30 1234569', header: 'Muster GmbH', number: '890' }
  cfg.faxes = [box]
  return { cfg, box }
}

describe('Fax', () => {
  it('erzeugt Empfang, Versand und interne Nummer im Wählplan', () => {
    const { cfg, box } = withFax()
    cfg.trunks[0].inbound_default = { type: 'fax', target: box.id }
    const files = generate(cfg, gen)
    const ext = files['extensions.conf']
    expect(destTarget(cfg, cfg.trunks[0].inbound_default)).toBe('p4a-fax^xfax1')
    expect(ext).toContain('[p4a-fax]')
    expect(ext).toContain('exten => xfax1,1,Set(P4A_FAXBOX=${EXTEN})')
    expect(ext).toContain('Set(FAXOPT(localstationid)=+49 30 1234569)')
    expect(ext).toContain('ReceiveFAX(${P4A_FAXFILE},f)')
    expect(ext).toContain('[p4a-fax-send]')
    expect(ext).toContain('SendFAX(${P4A_FAXFILE},f)')
    expect(ext).toContain('exten => 890,')
    expect(files['modules.conf']).toContain('load => res_fax_spandsp.so')
    expect(files['pjsip.conf']).not.toContain('t38_udptl=yes')
    cfg.trunks[0].t38 = true
    expect(generate(cfg, gen)['pjsip.conf']).toContain('t38_udptl=yes')
  })

  it('ohne Fax kein Fax-Wählplan', () => {
    expect(generate(sampleConfig(), gen)['extensions.conf']).not.toContain('[p4a-fax]')
  })

  it('wählt über die Wahlregeln, mit eigener Absendernummer', () => {
    const { cfg, box } = withFax()
    expect(faxRoute(cfg, box, '0301111111')).toEqual([{ endpoint: 'trunk-t1', number: '+49301111111', cid: '+49301234567' }])
    box.cid = '0301234568'
    expect(faxRoute(cfg, box, '0301111111')[0].cid).toBe('0301234568')
    cfg.security.outbound_stop = true
    expect(faxRoute(cfg, box, '0301111111')).toEqual([])
  })

  it('übersetzt Fehler', () => {
    expect(faxErrorText('SUCCESS', '')).toBe('')
    expect(faxErrorText('FAILED', 'NO_ANSWER')).toBe('Keine Antwort')
    expect(faxErrorText('FAILED', 'T30_ERR_RX_NOCARRIER')).toMatch(/Faxgerät/)
  })

  it('führt die Liste und räumt nach 30 Tagen auf', () => {
    const dir = tmp()
    const store = new FaxStore(dir)
    const old = store.add({ box: 'b', direction: 'in', time: Date.now() - 40 * 86400000, number: '1', station: '', pages: 1, status: 'ok', error: '', by: '', attempts: 1 })
    const sending = store.add({ box: 'b', direction: 'out', time: Date.now(), number: '2', station: '', pages: 1, status: 'sending', error: '', by: '10', attempts: 1 })
    fs.writeFileSync(store.pdf(old.id), '%PDF-')
    fs.writeFileSync(path.join(dir, 'xdeadbeef00.pdf'), '%PDF-')
    store.prune()
    expect(store.list().map((r) => r.id)).toEqual([sending.id])
    expect(fs.existsSync(store.pdf(old.id))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'xdeadbeef00.pdf'))).toBe(false)
    // Neustart: was gerade gesendet wurde, gilt als fehlgeschlagen
    expect(new FaxStore(dir).get(sending.id)).toMatchObject({ status: 'failed' })
  })

  it.skipIf(!has('gs') || !has('tiff2pdf'))('wandelt PDF in Fax-TIFF und zurück', async () => {
    const dir = tmp()
    const ps = path.join(dir, 'a.ps')
    fs.writeFileSync(ps, '%!PS\n/Helvetica findfont 30 scalefont setfont 72 700 moveto (Seite 1) show showpage 72 700 moveto (Seite 2) show showpage\n')
    const pdf = path.join(dir, 'a.pdf')
    execFileSync('gs', ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=pdfwrite', `-sOutputFile=${pdf}`, ps])
    const tif = path.join(dir, 'a.tif')
    await pdfToTiff(pdf, tif)
    expect(tiffPages(tif)).toBe(2)
    const back = path.join(dir, 'b.pdf')
    await tiffToPdf(tif, back)
    expect(fs.readFileSync(back).subarray(0, 5).toString()).toBe('%PDF-')
  })
})
