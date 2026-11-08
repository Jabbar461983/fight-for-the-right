/**
 * Ton: alle Effekte und die Musik werden zur Laufzeit mit WebAudio erzeugt (Synthese).
 * Es gibt keine Audiodateien – also auch keine Lizenzfragen. Stil: comichaft und freundlich,
 * keine realistischen Kampfgeräusche (Kinder spielen mit).
 *
 * Browser erlauben Ton erst nach einer Berührung/einem Klick: `unlockAudio()` wird beim
 * ersten Pointer- oder Tastenereignis aufgerufen.
 */

export type Sfx =
  | 'click'
  | 'bullet'
  | 'cannon'
  | 'rocket'
  | 'flak'
  | 'bomb'
  | 'zap'
  | 'boomSmall'
  | 'boomBig'
  | 'puff'
  | 'build'
  | 'ready'
  | 'place'
  | 'sell'
  | 'error'
  | 'alert'
  | 'radio'
  | 'objective'
  | 'victory'
  | 'defeat';

let ctx: AudioContext | null = null;
let sfxGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let volumes = { music: 0.6, sfx: 0.8 };
/** Zuletzt gespielt je Effekt (gegen Lärmteppiche bei grossen Schlachten). */
const lastPlayed = new Map<Sfx, number[]>();
const LIMIT: Partial<Record<Sfx, [number, number]>> = {
  // [max. Anzahl, je Millisekunden]
  bullet: [4, 120],
  cannon: [3, 150],
  rocket: [3, 150],
  flak: [3, 150],
  bomb: [2, 200],
  zap: [4, 150],
  boomSmall: [3, 150],
  boomBig: [2, 200],
  puff: [3, 150],
};

function ensure(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  const master = ctx.createDynamicsCompressor();
  master.connect(ctx.destination);
  sfxGain = ctx.createGain();
  musicGain = ctx.createGain();
  sfxGain.connect(master);
  musicGain.connect(master);
  applyVolumes();
  // Weisses Rauschen (1 s) für Schüsse und Explosionen
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

function applyVolumes(): void {
  if (!ctx || !sfxGain || !musicGain) return;
  // Quadratisch: leise Einstellungen sind wirklich leise
  sfxGain.gain.setTargetAtTime(volumes.sfx * volumes.sfx * 0.9, ctx.currentTime, 0.05);
  musicGain.gain.setTargetAtTime(volumes.music * volumes.music * 0.35, ctx.currentTime, 0.1);
}

export function setVolumes(music: number, sfx: number): void {
  volumes = { music, sfx };
  applyVolumes();
  if (music <= 0) stopMusic();
  else if (wantedTrack && !musicTimer) startMusic(wantedTrack);
}

/** Beim ersten Klick/Tippen aufrufen (Browser-Regel). */
export function unlockAudio(): void {
  const c = ensure();
  if (c && c.state === 'suspended') void c.resume();
  if (wantedTrack && !musicTimer && volumes.music > 0) startMusic(wantedTrack);
}

// ───────────── Bausteine ─────────────

function tone(
  type: OscillatorType,
  f0: number,
  f1: number,
  t: number,
  dur: number,
  vol: number,
  out: AudioNode,
  attack = 0.005,
): void {
  const c = ctx!;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(t: number, dur: number, vol: number, filter: BiquadFilterType, freq: number, out: AudioNode, freqEnd?: number, q = 0.7): void {
  const c = ctx!;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * Math.max(0, 0.95 - dur));
  src.stop(t + dur + 0.02);
}

// ───────────── Effekte ─────────────

/**
 * Spielt einen Effekt. `vol` 0…1 (z.B. nach Entfernung zur Kamera), `pan` −1…1 (links/rechts).
 */
export function play(name: Sfx, vol = 1, pan = 0): void {
  const c = ensure();
  if (!c || c.state !== 'running' || volumes.sfx <= 0 || vol <= 0.02) return;
  const lim = LIMIT[name];
  const now = performance.now();
  if (lim) {
    const list = (lastPlayed.get(name) ?? []).filter((x) => now - x < lim[1]);
    if (list.length >= lim[0]) return;
    list.push(now);
    lastPlayed.set(name, list);
  }
  const t = c.currentTime + 0.005;
  const g = c.createGain();
  g.gain.value = vol;
  let out: AudioNode = g;
  if (pan !== 0 && c.createStereoPanner) {
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p);
    p.connect(sfxGain!);
  } else g.connect(sfxGain!);
  // Leichte Zufallsvariation, damit Wiederholungen nicht monoton klingen
  const v = 0.92 + Math.random() * 0.16;
  switch (name) {
    case 'click':
      tone('square', 880, 660, t, 0.05, 0.12, out);
      break;
    case 'bullet':
      noise(t, 0.06, 0.25, 'highpass', 2200 * v, out);
      tone('square', 420 * v, 180, t, 0.04, 0.08, out);
      break;
    case 'cannon':
      tone('sine', 150 * v, 45, t, 0.25, 0.55, out);
      noise(t, 0.18, 0.35, 'lowpass', 1400, out, 200);
      break;
    case 'rocket':
      noise(t, 0.35, 0.3, 'bandpass', 600 * v, out, 2400, 2);
      tone('sawtooth', 220 * v, 520, t, 0.25, 0.06, out);
      break;
    case 'flak':
      noise(t, 0.08, 0.3, 'bandpass', 1800 * v, out, undefined, 1.5);
      noise(t + 0.07, 0.08, 0.25, 'bandpass', 1500 * v, out, undefined, 1.5);
      break;
    case 'bomb':
      tone('sine', 1300 * v, 500, t, 0.45, 0.08, out, 0.05);
      break;
    case 'zap':
      // Blitz: schnelles Sägezahn-Zirpen mit Knistern
      tone('sawtooth', 1800 * v, 300, t, 0.12, 0.1, out);
      noise(t, 0.1, 0.2, 'highpass', 4000 * v, out);
      break;
    case 'boomSmall':
      tone('sine', 110 * v, 40, t, 0.3, 0.5, out);
      noise(t, 0.35, 0.4, 'lowpass', 900 * v, out, 120);
      break;
    case 'boomBig':
      tone('sine', 80 * v, 28, t, 0.8, 0.8, out);
      noise(t, 0.9, 0.55, 'lowpass', 1200 * v, out, 80);
      tone('triangle', 60, 30, t + 0.05, 0.6, 0.3, out);
      break;
    case 'puff':
      // Comic-«Plopp»: Infanterie verschwindet in der Wolke
      tone('sine', 300 * v, 900, t, 0.12, 0.3, out);
      noise(t + 0.03, 0.15, 0.12, 'bandpass', 1200, out, 3000, 1);
      break;
    case 'build':
      tone('triangle', 523, 523, t, 0.12, 0.25, out);
      tone('triangle', 784, 784, t + 0.1, 0.22, 0.25, out);
      break;
    case 'ready':
      tone('square', 660, 660, t, 0.07, 0.1, out);
      tone('square', 990, 990, t + 0.07, 0.1, 0.1, out);
      break;
    case 'place':
      tone('sine', 140, 70, t, 0.2, 0.5, out);
      noise(t, 0.12, 0.2, 'lowpass', 600, out);
      break;
    case 'sell':
      tone('square', 1200, 1200, t, 0.06, 0.08, out);
      tone('square', 1600, 1600, t + 0.06, 0.12, 0.08, out);
      break;
    case 'error':
      tone('square', 180, 150, t, 0.18, 0.12, out);
      break;
    case 'alert':
      for (let i = 0; i < 2; i++) {
        tone('square', 740, 740, t + i * 0.3, 0.13, 0.1, out);
        tone('square', 554, 554, t + i * 0.3 + 0.15, 0.13, 0.1, out);
      }
      break;
    case 'radio':
      noise(t, 0.12, 0.08, 'bandpass', 2500, out, undefined, 3);
      tone('sine', 1400, 1400, t + 0.1, 0.08, 0.12, out);
      tone('sine', 1900, 1900, t + 0.18, 0.08, 0.12, out);
      break;
    case 'objective':
      [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, t + i * 0.08, 0.2, 0.2, out));
      break;
    case 'victory':
      [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone('square', f, f, t + i * 0.14, i === 5 ? 0.6 : 0.16, 0.12, out));
      [262, 330, 392].forEach((f) => tone('triangle', f, f, t + 0.7, 0.8, 0.15, out));
      break;
    case 'defeat':
      [392, 349, 311, 262].forEach((f, i) => tone('triangle', f, f, t + i * 0.22, i === 3 ? 0.7 : 0.22, 0.2, out));
      break;
  }
}

// ───────────── Sprachausgabe ─────────────

/**
 * Spricht einen kurzen Satz mit der Sprachausgabe des Geräts (z.B. «Wir werden angegriffen!»).
 * Lautstärke = Effekt-Lautstärke. Ohne Sprachausgabe: ersatzweise der Alarmton.
 */
export function speak(text: string, lang: 'de' | 'en'): void {
  if (volumes.sfx <= 0) return;
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
    play('alert', 0.8);
    return;
  }
  try {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === 'de' ? 'de-DE' : 'en-US';
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
    if (voice) u.voice = voice;
    u.volume = Math.min(1, volumes.sfx * 1.1);
    u.rate = 1.05;
    u.pitch = 1.05;
    synth.speak(u);
  } catch {
    play('alert', 0.8);
  }
}

// ───────────── Musik (selbst erzeugte Retro-Schleifen) ─────────────

export type Track = 'menu' | 'battle';

let wantedTrack: Track | null = null;
let musicTimer = 0;
let step = 0;
let nextTime = 0;

/** Akkordfolgen (MIDI-Grundtöne) und Tempo je Stück. */
const TRACKS: Record<Track, { bpm: number; chords: number[][]; lead: number[]; drums: boolean }> = {
  // Ruhig und neugierig: Am – F – C – G
  menu: {
    bpm: 92,
    chords: [
      [57, 60, 64],
      [53, 57, 60],
      [48, 52, 55],
      [55, 59, 62],
    ],
    lead: [76, -1, 74, 72, -1, 71, 72, -1, 69, -1, 67, 69, 72, -1, 71, -1],
    drums: false,
  },
  // Vorwärts: Dm – Bb – F – C, mit Schlagzeug
  battle: {
    bpm: 124,
    chords: [
      [50, 53, 57],
      [46, 50, 53],
      [53, 57, 60],
      [48, 52, 55],
    ],
    lead: [74, -1, 77, 74, 72, -1, 69, -1, 70, -1, 72, 74, 77, -1, 76, -1],
    drums: true,
  },
};

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** Wechselt das Musikstück (läuft erst nach unlockAudio). */
export function music(track: Track | null): void {
  if (track === wantedTrack) return;
  wantedTrack = track;
  stopMusic();
  if (track && ctx && ctx.state === 'running' && volumes.music > 0) startMusic(track);
}

function stopMusic(): void {
  if (musicTimer) window.clearInterval(musicTimer);
  musicTimer = 0;
}

function startMusic(track: Track): void {
  const c = ensure();
  if (!c || !musicGain) return;
  stopMusic();
  step = 0;
  nextTime = c.currentTime + 0.1;
  const tr = TRACKS[track];
  const sixteenth = 60 / tr.bpm / 4;
  // Vorausplanung: alle 50 ms die nächsten Noten einplanen (läuft auch bei ruckelnder Grafik sauber)
  musicTimer = window.setInterval(() => {
    if (!ctx || ctx.state !== 'running') return;
    while (nextTime < ctx.currentTime + 0.2) {
      scheduleStep(tr, step, nextTime, sixteenth);
      nextTime += sixteenth;
      step++;
    }
  }, 50);
}

function scheduleStep(tr: (typeof TRACKS)[Track], s: number, t: number, len: number): void {
  const out = musicGain!;
  const bar = Math.floor(s / 16) % tr.chords.length;
  const pos = s % 16;
  const chord = tr.chords[bar];
  // Bass auf den Zählzeiten
  if (pos % 4 === 0) tone('triangle', midi(chord[0] - 12), midi(chord[0] - 12), t, len * 3.5, 0.35, out, 0.01);
  // Arpeggio
  const arp = chord[[0, 1, 2, 1][pos % 4]] + 12;
  tone('square', midi(arp), midi(arp), t, len * 0.9, 0.05, out, 0.005);
  // Melodie jede zweite Runde
  const note = tr.lead[pos];
  if (Math.floor(s / 64) % 2 === 1 && note > 0) tone('triangle', midi(note), midi(note), t, len * 1.8, 0.12, out, 0.01);
  if (tr.drums) {
    if (pos % 8 === 0) tone('sine', 120, 45, t, 0.18, 0.5, out);
    if (pos % 8 === 4) noise(t, 0.12, 0.18, 'bandpass', 1800, out, undefined, 0.8);
    if (pos % 2 === 1) noise(t, 0.03, 0.06, 'highpass', 7000, out);
  }
}
