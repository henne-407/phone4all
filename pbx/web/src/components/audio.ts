/**
 * Ansagen im Browser in das Format der Anlage umwandeln (WAV, 8 kHz, 16 Bit, mono).
 * So braucht der Server keine Umwandlungsprogramme; jedes Format, das der Browser
 * abspielen kann (MP3, OGG, M4A, WAV …), lässt sich hochladen.
 */

const RATE = 8000

function encodeWav(samples: Float32Array): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buffer)
  const text = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i))
  }
  text(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, RATE, true)
  v.setUint32(28, RATE * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  text(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

/** Beliebige Audiodatei → WAV 8 kHz mono (lauter normalisiert, Stille am Rand gekürzt). */
export async function toTelephoneWav(data: ArrayBuffer): Promise<Blob> {
  const ctx = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await ctx.decodeAudioData(data)
  } finally {
    void ctx.close()
  }
  const length = Math.ceil(decoded.duration * RATE)
  const offline = new OfflineAudioContext(1, Math.max(1, length), RATE)
  const src = offline.createBufferSource()
  src.buffer = decoded
  src.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()
  let samples = rendered.getChannelData(0)
  // Stille am Anfang/Ende entfernen, damit Ansagen sofort beginnen
  const threshold = 0.01
  let start = 0
  let end = samples.length
  while (start < end && Math.abs(samples[start]) < threshold) start++
  while (end > start && Math.abs(samples[end - 1]) < threshold) end--
  samples = samples.slice(Math.max(0, start - RATE / 10), Math.min(samples.length, end + RATE / 5))
  const peak = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0)
  if (peak > 0 && peak < 0.9) {
    const gain = 0.9 / peak
    samples = samples.map((s) => s * gain)
  }
  return encodeWav(samples)
}

/** Aufnahme über das Mikrofon; stop() liefert die Rohdaten. */
export async function startRecording(): Promise<{ stop: () => Promise<ArrayBuffer> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => chunks.push(e.data)
  recorder.start()
  return {
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop())
          void new Blob(chunks, { type: recorder.mimeType }).arrayBuffer().then(resolve)
        }
        recorder.stop()
      }),
  }
}
