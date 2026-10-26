// Sound effects and background music, synthesized with Web Audio – no audio files to ship or license.
// Effects are short note figures voiced per theme (a PC speaker for DOS, coins for Bitcoin …); the music
// is an endless generated dark-synth loop whose tempo and timbre follow the theme as well.

import type { ThemeId } from '@shared/types'

export type SoundEvent = 'navigate' | 'open' | 'create' | 'rename' | 'trash' | 'transfer' | 'copy' | 'error' | 'tab'

let ctx: AudioContext | null = null
let sfxGain: GainNode | null = null
let musicGain: GainNode | null = null
let config = { sounds: false, soundVolume: 0.5, music: false, musicVolume: 0.35, theme: 'xp' as ThemeId }

/** Chromium starts audio suspended until the user interacts; resume on the first click or key. */
function audio(): AudioContext {
  if (ctx) return ctx
  ctx = new AudioContext()
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -14
  comp.ratio.value = 4
  comp.connect(ctx.destination)
  sfxGain = ctx.createGain()
  sfxGain.connect(comp)
  musicGain = ctx.createGain()
  musicGain.connect(comp)
  applyVolumes()
  const resume = (): void => void ctx?.resume()
  window.addEventListener('pointerdown', resume, true)
  window.addEventListener('keydown', resume, true)
  return ctx
}

function applyVolumes(): void {
  if (!ctx) return
  sfxGain?.gain.setTargetAtTime(config.soundVolume * 0.6, ctx.currentTime, 0.02)
  musicGain?.gain.setTargetAtTime(config.musicVolume * 0.5, ctx.currentTime, 0.2)
}

/** Called whenever the settings or the theme change. playsMusic: only one window plays it. */
export function configureSound(next: typeof config, playsMusic: boolean): void {
  const restart = next.theme !== config.theme
  config = next
  if (next.sounds || (next.music && playsMusic)) audio()
  applyVolumes()
  if (next.music && playsMusic) {
    if (!music || restart) startMusic(next.theme)
  } else stopMusic()
}

// ---- effects --------------------------------------------------------------------------------------

interface Voice {
  wave: OscillatorType
  /** Frequency of semitone 0. */
  base: number
  /** Lowpass cutoff, Hz. */
  cutoff: number
  /** Note length multiplier. */
  length: number
  gain: number
  /** Second oscillator detuned by this many cents (0 = none). */
  detune: number
  /** Each note slides in from this many semitones away (0 = none). */
  glide: number
}

const VOICES: Record<ThemeId, Voice> = {
  xp: { wave: 'triangle', base: 660, cutoff: 5000, length: 1, gain: 0.5, detune: 0, glide: 0 },
  apple: { wave: 'sine', base: 880, cutoff: 4000, length: 0.6, gain: 0.55, detune: 0, glide: 0 },
  classic: { wave: 'square', base: 523, cutoff: 2200, length: 1, gain: 0.25, detune: 0, glide: 0 },
  cyberpunk: { wave: 'sawtooth', base: 440, cutoff: 2600, length: 1.1, gain: 0.3, detune: 14, glide: -5 },
  fbi: { wave: 'triangle', base: 1046, cutoff: 6000, length: 0.5, gain: 0.45, detune: 0, glide: 0 },
  jarvis: { wave: 'sine', base: 1175, cutoff: 8000, length: 1.3, gain: 0.4, detune: 7, glide: -3 },
  barbie: { wave: 'triangle', base: 1046, cutoff: 7000, length: 0.9, gain: 0.45, detune: 0, glide: 2 },
  batman: { wave: 'sawtooth', base: 147, cutoff: 900, length: 1.4, gain: 0.45, detune: 9, glide: 0 },
  bitcoin: { wave: 'square', base: 988, cutoff: 5000, length: 0.9, gain: 0.22, detune: 0, glide: 0 },
  matrix: { wave: 'square', base: 1318, cutoff: 3500, length: 0.45, gain: 0.2, detune: 0, glide: 7 },
  dos: { wave: 'square', base: 880, cutoff: 20000, length: 0.8, gain: 0.16, detune: 0, glide: 0 }
}

/** [semitones from the base, start ms, length ms] */
type Figure = [number, number, number][]

const FIGURES: Record<SoundEvent, Figure> = {
  navigate: [[0, 0, 45], [7, 40, 60]],
  open: [[0, 0, 50], [5, 45, 50], [12, 90, 90]],
  create: [[0, 0, 60], [4, 60, 60], [7, 120, 60], [12, 180, 140]],
  rename: [[7, 0, 50], [12, 50, 80]],
  trash: [[12, 0, 70], [7, 70, 70], [0, 140, 70], [-12, 210, 200]],
  transfer: [[0, 0, 80], [7, 80, 80], [12, 160, 220]],
  copy: [[12, 0, 40]],
  error: [[-12, 0, 160], [-13, 180, 260]],
  tab: [[5, 0, 35]]
}

/** Bitcoin's coins and the Matrix's data chirps replace some figures outright. */
const THEME_FIGURES: Partial<Record<ThemeId, Partial<Record<SoundEvent, Figure>>>> = {
  bitcoin: { create: [[0, 0, 70], [5, 70, 260]], transfer: [[0, 0, 70], [5, 70, 120], [0, 200, 70], [5, 270, 260]] },
  matrix: { navigate: [[0, 0, 25], [10, 25, 25], [3, 50, 25], [15, 75, 40]], open: [[12, 0, 25], [3, 25, 25], [17, 50, 25], [8, 75, 25], [24, 100, 60]] },
  dos: { error: [[-5, 0, 300]] }
}

let lastPlayed = 0

export function playSound(event: SoundEvent): void {
  if (!config.sounds) return
  const ac = audio()
  if (ac.state !== 'running' || !sfxGain) return
  // A burst of events (selection storm, many tabs restored) plays once.
  const now = performance.now()
  if (now - lastPlayed < 40) return
  lastPlayed = now
  const voice = VOICES[config.theme] ?? VOICES.xp
  const figure = THEME_FIGURES[config.theme]?.[event] ?? FIGURES[event]
  const filter = ac.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = voice.cutoff
  filter.connect(sfxGain)
  for (const [semi, startMs, lenMs] of figure) {
    const t0 = ac.currentTime + startMs / 1000
    const len = (lenMs * voice.length) / 1000
    const freq = voice.base * 2 ** (semi / 12)
    const env = ac.createGain()
    env.gain.setValueAtTime(0.0001, t0)
    env.gain.exponentialRampToValueAtTime(voice.gain, t0 + 0.005)
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + len)
    env.connect(filter)
    for (const cents of voice.detune ? [-voice.detune, voice.detune] : [0]) {
      const osc = ac.createOscillator()
      osc.type = voice.wave
      osc.detune.value = cents
      osc.frequency.setValueAtTime(freq * 2 ** (voice.glide / 12), t0)
      if (voice.glide) osc.frequency.exponentialRampToValueAtTime(freq, t0 + Math.min(0.04, len / 2))
      osc.connect(env)
      osc.start(t0)
      osc.stop(t0 + len + 0.02)
    }
  }
}

// ---- music ----------------------------------------------------------------------------------------

interface Flavour {
  bpm: number
  arp: OscillatorType
  bass: OscillatorType
  /** Sixteenth steps with a kick. */
  kick: number[]
  /** 0–1: how much of the arpeggio goes through the echo. */
  echo: number
  /** Arp an octave higher, brighter. */
  bright: boolean
}

const FLAVOURS: Partial<Record<ThemeId, Flavour>> = {
  matrix: { bpm: 96, arp: 'triangle', bass: 'sawtooth', kick: [0, 7, 10], echo: 0.5, bright: false },
  dos: { bpm: 132, arp: 'square', bass: 'square', kick: [0, 4, 8, 12], echo: 0.15, bright: true },
  cyberpunk: { bpm: 122, arp: 'sawtooth', bass: 'sawtooth', kick: [0, 4, 8, 12], echo: 0.4, bright: false },
  batman: { bpm: 88, arp: 'sawtooth', bass: 'sawtooth', kick: [0, 8, 11], echo: 0.45, bright: false },
  jarvis: { bpm: 104, arp: 'sine', bass: 'triangle', kick: [0, 8], echo: 0.55, bright: true },
  bitcoin: { bpm: 116, arp: 'square', bass: 'sawtooth', kick: [0, 4, 8, 12], echo: 0.3, bright: true }
}
const DEFAULT_FLAVOUR: Flavour = { bpm: 110, arp: 'triangle', bass: 'sawtooth', kick: [0, 4, 8, 12], echo: 0.35, bright: false }

/** A minor, the Phrygian-flavoured progression of every hacker movie: Am – F – Dm – E. */
const PROGRESSION: { root: number; third: number }[] = [
  { root: 0, third: 3 },
  { root: -4, third: 4 },
  { root: 5, third: 3 },
  { root: 7, third: 4 }
]
const A2 = 110

let music: { stop(): void } | null = null

function stopMusic(): void {
  music?.stop()
  music = null
}

function startMusic(theme: ThemeId): void {
  stopMusic()
  const ac = audio()
  const out = musicGain!
  const f = FLAVOURS[theme] ?? DEFAULT_FLAVOUR
  const step = 60 / f.bpm / 4

  // Echo for the arpeggio: dotted eighth, filtered feedback.
  const echoIn = ac.createGain()
  echoIn.gain.value = f.echo
  const delay = ac.createDelay(2)
  delay.delayTime.value = step * 3
  const feedback = ac.createGain()
  feedback.gain.value = 0.38
  const echoTone = ac.createBiquadFilter()
  echoTone.type = 'lowpass'
  echoTone.frequency.value = 2400
  echoIn.connect(delay).connect(echoTone).connect(feedback).connect(delay)
  echoTone.connect(out)

  // Shared filters per part: a slowly breathing one for bass and pad, a fixed one for the arpeggio.
  const lowpass = (cutoff: number): BiquadFilterNode => {
    const lp = ac.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = cutoff
    return lp
  }
  const bassBus = lowpass(700)
  const padBus = lowpass(900)
  const arpBus = f.arp === 'sine' ? ac.createGain() : lowpass(3200)
  bassBus.connect(out)
  padBus.connect(out)
  arpBus.connect(out)
  arpBus.connect(echoIn)
  const lfo = ac.createOscillator()
  lfo.frequency.value = 0.07
  const lfoDepth = ac.createGain()
  lfoDepth.gain.value = 500
  lfo.connect(lfoDepth)
  lfoDepth.connect(bassBus.frequency)
  lfoDepth.connect(padBus.frequency)
  lfo.start()

  const noise = ac.createBuffer(1, ac.sampleRate * 0.2, ac.sampleRate)
  const data = noise.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

  const note = (freq: number, t: number, len: number, wave: OscillatorType, gain: number, dest: AudioNode): void => {
    const osc = ac.createOscillator()
    osc.type = wave
    osc.frequency.value = freq
    const env = ac.createGain()
    env.gain.setValueAtTime(0.0001, t)
    env.gain.exponentialRampToValueAtTime(gain, t + 0.008)
    env.gain.exponentialRampToValueAtTime(0.0001, t + len)
    osc.connect(env).connect(dest)
    osc.start(t)
    osc.stop(t + len + 0.05)
  }

  const kick = (t: number): void => {
    const osc = ac.createOscillator()
    const env = ac.createGain()
    osc.frequency.setValueAtTime(140, t)
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.14)
    env.gain.setValueAtTime(0.9, t)
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.28)
    osc.connect(env).connect(out)
    osc.start(t)
    osc.stop(t + 0.3)
  }

  const hat = (t: number, gain: number): void => {
    const src = ac.createBufferSource()
    src.buffer = noise
    const hp = ac.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 7000
    const env = ac.createGain()
    env.gain.setValueAtTime(gain, t)
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
    src.connect(hp).connect(env).connect(out)
    src.start(t)
    src.stop(t + 0.06)
  }

  // Each bar gets its own arpeggio shape; the same shape returns every 8 bars so it reads as a tune.
  const shapes = Array.from({ length: 8 }, () => Array.from({ length: 16 }, () => (Math.random() < 0.82 ? Math.floor(Math.random() * 6) : -1)))

  let stepIndex = 0
  let nextTime = ac.currentTime + 0.1
  const schedule = (): void => {
    while (nextTime < ac.currentTime + 0.15) {
      const bar = Math.floor(stepIndex / 16)
      const s = stepIndex % 16
      const chord = PROGRESSION[Math.floor(bar / 2) % PROGRESSION.length]
      const root = A2 * 2 ** (chord.root / 12)
      const tones = [0, chord.third, 7, 12, 12 + chord.third, 19].map((x) => root * 2 ** (x / 12) * (f.bright ? 4 : 2))
      const t = nextTime

      if (f.kick.includes(s)) kick(t)
      hat(t, s % 4 === 2 ? 0.12 : s % 2 ? 0.03 : 0)
      if (s % 2 === 0) note(s % 8 === 4 ? root : root / 2, t, step * 1.8, f.bass, 0.32, bassBus)
      const pick = shapes[bar % shapes.length][s]
      // The arpeggio joins after two bars of beat.
      if (pick >= 0 && bar >= 2) note(tones[pick], t, step * 0.9, f.arp, f.arp === 'square' || f.arp === 'sawtooth' ? 0.07 : 0.12, arpBus)
      if (s === 0 && bar % 2 === 0) for (const x of [0, chord.third, 7]) note(root * 2 ** (x / 12) * 2, t, step * 30, 'sawtooth', 0.025, padBus)

      nextTime += step
      stepIndex++
    }
  }
  schedule()
  const timer = setInterval(schedule, 25)
  music = {
    stop: () => {
      clearInterval(timer)
      lfo.stop()
      // Let the tails (pad, echo) ring out, then take the graph apart.
      setTimeout(() => {
        for (const node of [bassBus, padBus, arpBus, echoIn, delay, echoTone, feedback, lfoDepth]) node.disconnect()
      }, 5000)
    }
  }
}
