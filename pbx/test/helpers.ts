import type { Destination, Extension, Group, PbxConfig, PhonebookEntry, Trunk } from '../server/model'
import { blankItem, withDefaults } from '../server/model'

export function ext(id: string, number: string, extra: Partial<Extension> = {}): Extension {
  return { ...(blankItem('extensions') as unknown as Extension), id, number, name: `Person ${number}`, secret: 's', ...extra }
}

export const to = (type: Destination['type'], target = ''): Destination => ({ type, target })

/** Kleine Beispielanlage: drei Nebenstellen, eine Gruppe, ein Telekom-Konto. */
export function sampleConfig(): PbxConfig {
  const cfg = withDefaults({})
  cfg.system.area_code = '30'
  cfg.extensions = [ext('e10', '10'), ext('e11', '11', { permission: 'international' }), ext('e12', '12', { permission: 'internal' })]
  cfg.groups = [
    {
      ...(blankItem('groups') as unknown as Group),
      id: 'g1',
      number: '20',
      name: 'Zentrale',
      members: ['10', '11'],
      mode: 'all',
      timeout: 30,
      name_prefix: 'Zentrale: ',
      fallback: to('voicemail', 'e10'),
    },
  ]
  cfg.trunks = [
    {
      ...(blankItem('trunks') as unknown as Trunk),
      id: 't1',
      name: 'Telekom',
      registrar: 'tel.t-online.de',
      username: '+49301234567',
      password: 'geheim',
      numbers: ['030 1234567', '030 1234568'],
      number_format: 'e164',
      inbound_default: to('group', 'g1'),
    },
  ]
  cfg.phonebook = [{ ...(blankItem('phonebook') as unknown as PhonebookEntry), id: 'p1', name: 'Max Kunde', company: 'Kunde GmbH', phone: '0301111111', mobile: '' }]
  return cfg
}
