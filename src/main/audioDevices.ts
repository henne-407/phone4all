/**
 * Audiogeräte so auflisten, wie baresip sie erwartet.
 *
 * Linux: `pw-dump` liefert node.name (für baresip) und Beschreibung; ohne PipeWire `pactl`
 * (dessen JSON-Ausgabe Umlaute verliert, daher nur als Rückfall).
 * macOS/Windows: das mitgelieferte Hilfsprogramm `pa-devices` listet die PortAudio-Geräte;
 * baresips portaudio-Modul erwartet Namen der Form "<Host-API>: <Gerät>".
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import type { AudioDevice } from '../shared/types'
import { resourcePath } from './paths'

export interface DeviceList {
  sources: AudioDevice[]
  sinks: AudioDevice[]
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)))
  })
}

const sortDevices = (list: AudioDevice[]): AudioDevice[] =>
  list.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name, 'de'))

interface PactlDevice {
  name: string
  description?: string
  properties?: Record<string, string>
}

interface PwObject {
  type: string
  info?: { props?: Record<string, string> }
  props?: Record<string, string>
  metadata?: { key: string; value: { name?: string } | null }[]
}

async function pipewireDevices(): Promise<DeviceList> {
  const objects = JSON.parse(await run('pw-dump', [])) as PwObject[]
  const meta = objects.find((o) => o.type === 'PipeWire:Interface:Metadata' && o.props?.['metadata.name'] === 'default')
  const def = (key: string): string => meta?.metadata?.find((m) => m.key === key)?.value?.name ?? ''
  const nodes = objects.map((o) => o.info?.props ?? {}).filter((p) => p['node.name'])
  const convert = (cls: string, defName: string): AudioDevice[] =>
    nodes
      .filter((p) => p['media.class'] === cls)
      .map((p) => ({
        id: p['node.name'],
        name: p['node.description'] || p['node.nick'] || p['node.name'],
        isDefault: p['node.name'] === defName,
      }))
  return {
    sinks: sortDevices(convert('Audio/Sink', def('default.audio.sink'))),
    sources: sortDevices(convert('Audio/Source', def('default.audio.source'))),
  }
}

async function pulseDevices(): Promise<DeviceList> {
  const [sinksJson, sourcesJson, defSink, defSource] = await Promise.all([
    run('pactl', ['--format=json', 'list', 'sinks']),
    run('pactl', ['--format=json', 'list', 'sources']),
    run('pactl', ['get-default-sink']).catch(() => ''),
    run('pactl', ['get-default-source']).catch(() => ''),
  ])
  const convert = (json: string, def: string): AudioDevice[] =>
    (JSON.parse(json) as PactlDevice[])
      .filter((d) => !d.name.endsWith('.monitor'))
      .map((d) => ({
        id: d.properties?.['node.name'] || d.name,
        name: d.description || d.name,
        isDefault: d.name === def.trim(),
      }))
  return { sinks: sortDevices(convert(sinksJson, defSink)), sources: sortDevices(convert(sourcesJson, defSource)) }
}

interface PaDevice {
  name: string
  hostapi: string
  inputs: number
  outputs: number
  defaultInput: boolean
  defaultOutput: boolean
}

// Bevorzugte Host-API: Namen und Standardgeräte entsprechen denen des Systems
const HOST_API: Record<string, string> = { darwin: 'Core Audio', win32: 'Windows WASAPI' }

async function portaudioDevices(): Promise<DeviceList> {
  const exe = resourcePath('baresip', process.platform === 'win32' ? 'pa-devices.exe' : 'pa-devices')
  if (!fs.existsSync(exe)) return { sources: [], sinks: [] }
  const all = JSON.parse(await run(exe, [])) as PaDevice[]
  const api = HOST_API[process.platform]
  const devices = all.some((d) => d.hostapi === api) ? all.filter((d) => d.hostapi === api) : all
  const make = (d: PaDevice, isDefault: boolean): AudioDevice => ({ id: `${d.hostapi}: ${d.name}`, name: d.name, isDefault })
  return {
    sources: sortDevices(devices.filter((d) => d.inputs > 0).map((d) => make(d, d.defaultInput))),
    sinks: sortDevices(devices.filter((d) => d.outputs > 0).map((d) => make(d, d.defaultOutput))),
  }
}

export async function listDevices(): Promise<DeviceList> {
  try {
    if (process.platform !== 'linux') return await portaudioDevices()
    return await pipewireDevices().catch(() => pulseDevices())
  } catch {
    return { sources: [], sinks: [] }
  }
}
