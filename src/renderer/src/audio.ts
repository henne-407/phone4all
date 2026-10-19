/**
 * Audio in der Oberfläche: Testton, Mikrofonpegel, Klingelton-Vorschau und
 * Umwandlung eigener Klingeltöne. Geräte werden über ihren Namen den
 * Browser-Geräten zugeordnet (best effort; sonst Systemstandard).
 */

import type { AudioDevice } from '../../shared/types'

const clean = (label: string): string =>
  label
    .replace(/^(Default|Standard|Communications|Kommunikation)\s*-\s*/i, '')
    .trim()
    .toLowerCase()

async function browserDeviceId(kind: 'audioinput' | 'audiooutput', device: AudioDevice | undefined): Promise<string> {
  if (!device) return 'default'
  const name = device.name.toLowerCase()
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === kind)
  const match =
    devices.find((d) => clean(d.label) === name) ??
    devices.find((d) => clean(d.label).includes(name) || (clean(d.label) && name.includes(clean(d.label))))
  return match?.deviceId ?? 'default'
}

let toneCtx: AudioContext | null = null

/** Kurzer Testton (660 Hz) auf dem gewählten Lautsprecher. */
export async function playTestTone(device: AudioDevice | undefined): Promise<void> {
  await toneCtx?.close().catch(() => undefined)
  const ctx = new AudioContext()
  toneCtx = ctx
  const sinkId = await browserDeviceId('audiooutput', device)
  if (sinkId !== 'default') await (ctx as AudioContext & { setSinkId(id: string): Promise<void> }).setSinkId(sinkId).catch(() => undefined)
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.frequency.value = 660
  gain.gain.setValueAtTime(0, ctx.currentTime)
  gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.02)
  gain.gain.setValueAtTime(0.25, ctx.currentTime + 1.2)
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.28)
  osc.connect(gain).connect(ctx.destination)
  osc.start()
  osc.stop(ctx.currentTime + 1.3)
  osc.onended = () => void ctx.close().catch(() => undefined)
}

let preview: HTMLAudioElement | null = null

/** Klingelton (WAV-Bytes) einmal abspielen. */
export async function playWav(data: Uint8Array, device: AudioDevice | undefined): Promise<void> {
  stopPreview()
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'audio/wav' }))
  const audio = new Audio(url)
  preview = audio
  const sinkId = await browserDeviceId('audiooutput', device)
  if (sinkId !== 'default') await audio.setSinkId(sinkId).catch(() => undefined)
  audio.onended = () => URL.revokeObjectURL(url)
  await audio.play().catch(() => undefined)
}

export function stopPreview(): void {
  preview?.pause()
  preview = null
}

/** Misst den Eingangspegel eines Mikrofons; callback(0 … 1). Gibt eine Stopp-Funktion zurück. */
export async function startLevelMeter(device: AudioDevice | undefined, callback: (level: number) => void): Promise<() => void> {
  const deviceId = await browserDeviceId('audioinput', device)
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId === 'default' ? true : { deviceId: { exact: deviceId } },
    })
  } catch {
    return () => undefined
  }
  const ctx = new AudioContext()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  ctx.createMediaStreamSource(stream).connect(analyser)
  const buf = new Float32Array(analyser.fftSize)
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf)
    let peak = 0
    for (const v of buf) peak = Math.max(peak, Math.abs(v))
    const db = 20 * Math.log10(peak || 1e-8)
    // -80 dB … 0 dB auf 0 … 1 abbilden (leises Sprechen liegt um -40 dB)
    callback(Math.min(1, Math.max(0, (db + 80) / 80)))
  }, 80)
  return () => {
    clearInterval(timer)
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close()
    callback(0)
  }
}

const RATE = 32000

/** Beliebige Audiodatei in ein Mono-WAV (32 kHz, max. 30 s) für baresip umwandeln. */
export async function convertToWav(data: Uint8Array): Promise<Uint8Array> {
  const ctx = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await ctx.decodeAudioData(data.slice().buffer as ArrayBuffer)
  } catch {
    throw new Error('Datei kann nicht gelesen werden – bitte ein gängiges Audioformat wählen')
  } finally {
    void ctx.close()
  }
  const seconds = Math.min(decoded.duration, 30)
  const offline = new OfflineAudioContext(1, Math.ceil(seconds * RATE), RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()
  const samples = rendered.getChannelData(0)
  let peak = 0
  for (const v of samples) peak = Math.max(peak, Math.abs(v))
  const scale = peak > 0.98 ? 0.98 / peak : 1
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const text = (offset: number, s: string): void => [...s].forEach((ch, i) => out.setUint8(offset + i, ch.charCodeAt(0)))
  text(0, 'RIFF')
  out.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVEfmt ')
  out.setUint32(16, 16, true)
  out.setUint16(20, 1, true)
  out.setUint16(22, 1, true)
  out.setUint32(24, RATE, true)
  out.setUint32(28, RATE * 2, true)
  out.setUint16(32, 2, true)
  out.setUint16(34, 16, true)
  text(36, 'data')
  out.setUint32(40, samples.length * 2, true)
  samples.forEach((v, i) => out.setInt16(44 + i * 2, Math.max(-32767, Math.min(32767, Math.round(v * scale * 32767))), true))
  return new Uint8Array(out.buffer)
}
