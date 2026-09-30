/**
 * Chiptune background music, synthesized with WebAudio: no samples, no files. One short looping theme per
 * family floor (lead + bass + noise drums), a calm lobby theme, a tenser boss variant, a victory jingle and a
 * death sting. Notes are scheduled ahead on the AudioContext clock by a light timer (lookahead scheduler).
 *
 * Presentation only: it runs from the UI layer on wall-clock time and never reads or touches the simulation
 * (its only randomness is Math.random for drum-noise offsets, never the sim RNG).
 */
import type { FamilyId } from "./themes";

type Song = Readonly<{
  bpm: number;
  /** 16th-note steps per bar (16 = 4/4, 12 = 3/4, 14 = 7/8). */
  steps: number;
  /** MIDI note of the key, in the lead's register. */
  root: number;
  scale: readonly number[];
  /** Chord root, as a scale degree, for each bar. */
  prog: readonly number[];
  /**
   * Per-bar templates, one character per step. Lead and bass: a digit is a scale step above the bar's chord
   * root (0 root, 2 third, 4 fifth, 7 octave), "-" holds the previous note, "." rests. Drums: k kick,
   * s snare, h hat. `alt` replaces the lead on odd bars for a little variation.
   */
  lead: string; alt: string; bass: string; drums: string;
  leadWave: OscillatorType; bassWave: OscillatorType;
}>;

const MAJOR = [0, 2, 4, 5, 7, 9, 11], MINOR = [0, 2, 3, 5, 7, 8, 10], HARMONIC = [0, 2, 3, 5, 7, 8, 11];
const DORIAN = [0, 2, 3, 5, 7, 9, 10], LYDIAN = [0, 2, 4, 6, 7, 9, 11], PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const PENTA = [0, 2, 4, 7, 9], WHOLE = [0, 2, 4, 6, 8, 10];

export const SONGS: Readonly<Record<FamilyId, Song>> = {
  // The Ossuary: spooky harmonic minor, slow walk.
  0: { bpm: 92, steps: 16, root: 62, scale: HARMONIC, prog: [0, 5, 3, 4, 0, 5, 3, 4],
    lead: "0--2--4-.3-2-1-.", alt: "4--2--0-.1-2-6--", bass: "0.......4.......", drums: "k.......s.....h.", leadWave: "square", bassWave: "triangle" },
  // Masquerade Hall: a minor waltz (3/4).
  1: { bpm: 150, steps: 12, root: 64, scale: MINOR, prog: [0, 3, 4, 0, 5, 3, 4, 4],
    lead: "4---2-3-4---", alt: "7---6-4-2---", bass: "0...4...4...", drums: "k...h...h...", leadWave: "square", bassWave: "triangle" },
  // The Old House: warm major, easy swing.
  2: { bpm: 100, steps: 16, root: 65, scale: MAJOR, prog: [0, 5, 3, 4, 0, 5, 1, 4],
    lead: "0-2-4---2-1-0---", alt: "4-5-4-2-1---0---", bass: "0...4...0...4...", drums: "k...s...k.k.s...", leadWave: "triangle", bassWave: "square" },
  // Culture Vats: bubbly pentatonic staccato.
  3: { bpm: 126, steps: 16, root: 67, scale: PENTA, prog: [0, 3, 1, 4, 0, 3, 1, 2],
    lead: "0.2.4.2.7.4.2.4.", alt: "0.4.2.7.4.9.7.4.", bass: "0.0.4.0.0.0.4.0.", drums: "k.h.s.h.k.h.s.hh", leadWave: "square", bassWave: "triangle" },
  // The Crooked Wing: dorian in 7/8 (2+2+3).
  4: { bpm: 138, steps: 14, root: 62, scale: DORIAN, prog: [0, 1, 0, 6, 0, 1, 3, 4],
    lead: "0-2-4---3-2-1-", alt: "4-3-2-0---1-2-", bass: "0...4...0.4.4.", drums: "k.h.k.h.k.h.s.", leadWave: "square", bassWave: "square" },
  // Cloud Cellar: airy lydian, long notes.
  5: { bpm: 80, steps: 16, root: 69, scale: LYDIAN, prog: [0, 1, 0, 4, 0, 1, 5, 4],
    lead: "7-------4---6---", alt: "9-------7---4---", bass: "0-------4-------", drums: "....h.......h...", leadWave: "triangle", bassWave: "triangle" },
  // Colossus Quarry: heavy, slow phrygian.
  6: { bpm: 70, steps: 16, root: 57, scale: PHRYGIAN, prog: [0, 1, 0, 6, 0, 1, 0, 1],
    lead: "0-------1---0---", alt: "4-------5---4-1-", bass: "0-0-....0-7-....", drums: "k.......s...k.k.", leadWave: "square", bassWave: "square" },
  // Glimmer Mines: sparkly major arpeggios.
  7: { bpm: 144, steps: 16, root: 72, scale: MAJOR, prog: [0, 5, 3, 4, 0, 5, 3, 4],
    lead: "0247420702474207", alt: "4797424747974247", bass: "0.......4.......", drums: "k.h.s.h.k.h.s.h.", leadWave: "square", bassWave: "triangle" },
  // The Hollow: sparse, eerie whole tone.
  8: { bpm: 64, steps: 16, root: 60, scale: WHOLE, prog: [0, 0, 3, 1, 0, 0, 2, 4],
    lead: "0-------........", alt: "........3---2---", bass: "0---------------", drums: "k...............", leadWave: "triangle", bassWave: "triangle" },
};

/** The lobby: calm and a little ominous, a slow harmonic-minor walk over a held bass. */
const LOBBY: Song = { bpm: 72, steps: 16, root: 57, scale: HARMONIC, prog: [0, 5, 0, 4, 0, 5, 3, 4],
  lead: "0---.---2-1-0---", alt: "4---.---3-2-6---", bass: "0-------0-------", drums: "k...........h...", leadWave: "triangle", bassWave: "triangle" };

/** What can play: a family's theme or the lobby's. */
export type Theme = FamilyId | "lobby";

/** The boss variant: faster, a semitone up, driving eighth-note bass and busier drums. */
function bossVariant(song: Song): Song {
  const bass = Array.from({ length: song.steps }, (_, i) => (i % 2 ? "." : i % 8 === 6 ? "7" : "0")).join("");
  const drums = Array.from({ length: song.steps }, (_, i) => (i % 4 === 0 ? "k" : i % 8 === 4 ? "s" : "h")).join("");
  return { ...song, bpm: Math.round(song.bpm * 1.22), root: song.root + 1, bass, drums, bassWave: "square" };
}

const LEVEL = 0.11, LOOKAHEAD = 0.16, TICK_MS = 60, FADE = 0.8;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

type Track = { key: string; song: Song; gain: GainNode; step: number; bar: number; next: number };

export class Music {
  private bus: GainNode;
  private jingleBus: GainNode;
  private track: Track | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private enabled = true;
  private active = false;

  constructor(private ctx: AudioContext, private noise: AudioBuffer) {
    this.bus = ctx.createGain(); this.bus.gain.value = 0; this.bus.connect(ctx.destination);
    this.jingleBus = ctx.createGain(); this.jingleBus.gain.value = LEVEL * 1.4; this.jingleBus.connect(ctx.destination);
  }

  /** Music on/off and mute: both must allow sound. */
  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.jingleBus.gain.setTargetAtTime(enabled ? LEVEL * 1.4 : 0, this.ctx.currentTime, 0.03);
    this.refresh();
  }

  /** True while a run is on screen and running (not paused, hidden or in a menu). */
  setActive(active: boolean) {
    if (active === this.active) return;
    this.active = active;
    this.refresh();
  }

  private refresh() {
    const on = this.enabled && this.active;
    const now = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setTargetAtTime(on ? LEVEL : 0, now, on ? 0.12 : 0.04);
    if (on && !this.timer) {
      if (this.track) this.track.next = Math.max(this.track.next, now + 0.05);
      this.timer = setInterval(() => this.schedule(), TICK_MS);
      this.schedule();
    } else if (!on && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** Switch to a floor's theme (or its boss variant), crossfading from the current one. */
  play(family: Theme, boss: boolean) {
    const key = `${family}${boss ? "b" : ""}`;
    if (this.track?.key === key) return;
    const now = this.ctx.currentTime;
    this.fadeOut(this.track, now);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(1, now + FADE);
    gain.connect(this.bus);
    const base = family === "lobby" ? LOBBY : SONGS[family];
    const song = boss ? bossVariant(base) : base;
    this.track = { key, song, gain, step: 0, bar: 0, next: now + 0.05 };
  }

  stop() { this.fadeOut(this.track, this.ctx.currentTime); this.track = null; }

  private fadeOut(track: Track | null, now: number) {
    if (!track) return;
    track.gain.gain.cancelScheduledValues(now);
    track.gain.gain.setValueAtTime(track.gain.gain.value, now);
    track.gain.gain.linearRampToValueAtTime(0, now + FADE * 0.75);
    const gain = track.gain;
    setTimeout(() => { try { gain.disconnect(); } catch { /* already gone */ } }, (FADE + LOOKAHEAD) * 1000 + 200);
  }

  private schedule() {
    const track = this.track;
    if (!track || this.ctx.state !== "running") return;
    const { song } = track, stepDur = 60 / song.bpm / 4;
    // After a long stall (throttled timer), skip ahead instead of bursting a backlog of notes.
    if (track.next < this.ctx.currentTime - 0.25) track.next = this.ctx.currentTime + 0.03;
    while (track.next < this.ctx.currentTime + LOOKAHEAD) {
      this.step(track, track.next, stepDur);
      track.next += stepDur;
      if (++track.step >= song.steps) { track.step = 0; track.bar = (track.bar + 1) % song.prog.length; }
    }
  }

  private step(track: Track, t: number, stepDur: number) {
    const { song, step, bar } = track, chord = song.prog[bar];
    const lead = bar % 2 ? song.alt : song.lead;
    const holds = (pattern: string) => { let n = 1; while (pattern[step + n] === "-") n++; return n; };
    const note = (c: string, octave: number) => {
      const degree = chord + Number(c), len = song.scale.length;
      return song.root + song.scale[degree % len] + 12 * (Math.floor(degree / len) + octave);
    };
    const l = lead[step];
    if (l >= "0" && l <= "9") this.voice(track.gain, song.leadWave, hz(note(l, 0)), t, holds(lead) * stepDur * 0.92, song.leadWave === "square" ? 0.16 : 0.3);
    const b = song.bass[step];
    if (b >= "0" && b <= "9") this.voice(track.gain, song.bassWave, hz(note(b, -2)), t, holds(song.bass) * stepDur * 0.9, song.bassWave === "square" ? 0.14 : 0.36);
    const d = song.drums[step];
    if (d === "k") this.kick(track.gain, t);
    else if (d === "s") this.hiss(track.gain, t, 0.12, 0.3, 1800);
    else if (d === "h") this.hiss(track.gain, t, 0.03, 0.14, 7000);
  }

  private voice(out: AudioNode, type: OscillatorType, freq: number, t: number, duration: number, volume: number) {
    const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
    gain.gain.setValueAtTime(volume, t + Math.max(0.012, duration - 0.04));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(out);
    osc.onended = () => gain.disconnect();
    osc.start(t); osc.stop(t + duration + 0.02);
  }

  private kick(out: AudioNode, t: number) {
    const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
    osc.type = "sine"; osc.frequency.setValueAtTime(150, t); osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    gain.gain.setValueAtTime(0.5, t); gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(gain).connect(out);
    osc.onended = () => gain.disconnect();
    osc.start(t); osc.stop(t + 0.16);
  }

  private hiss(out: AudioNode, t: number, duration: number, volume: number, cutoff: number) {
    const source = this.ctx.createBufferSource(), filter = this.ctx.createBiquadFilter(), gain = this.ctx.createGain();
    source.buffer = this.noise; filter.type = "highpass"; filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(volume, t); gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(filter).connect(gain).connect(out);
    source.onended = () => gain.disconnect();
    source.start(t, Math.random() * 0.5, duration + 0.01);
  }

  /** Victory jingle or death sting; plays through its own bus so it survives the run ending. */
  jingle(kind: "win" | "lose") {
    if (!this.enabled || this.ctx.state !== "running") return;
    this.stop();
    const t = this.ctx.currentTime + 0.05;
    const notes = kind === "win" ? [[72, 0.09], [76, 0.09], [79, 0.09], [84, 0.09], [79, 0.09], [84, 0.09], [88, 0.5]] as const
      : [[67, 0.3], [66, 0.3], [65, 0.3], [64, 0.8]] as const;
    let at = t;
    for (const [midi, duration] of notes) {
      this.voice(this.jingleBus, kind === "win" ? "square" : "triangle", hz(midi), at, duration * 0.95, kind === "win" ? 0.22 : 0.4);
      if (kind === "lose") this.voice(this.jingleBus, "triangle", hz(midi - 12), at, duration * 0.95, 0.3);
      at += duration;
    }
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null; this.track = null;
    try { this.bus.disconnect(); this.jingleBus.disconnect(); } catch { /* context already closed */ }
  }
}
