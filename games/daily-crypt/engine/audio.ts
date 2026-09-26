/** Tiny synthesized sound effects (no samples), plus the SDK sound kit for rewards. */
import { createFriendSoundKit, type FriendSoundKit } from "@rarefriends/friendsdk/sounds";

export type Sfx = "shoot" | "hit" | "kill" | "hurt" | "door" | "pickup" | "relic" | "boss" | "stairs" | "enemyShot" | "win" | "lose";

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private kit: FriendSoundKit = createFriendSoundKit({ volume: 0.6 });
  private last = new Map<Sfx, number>();
  muted = false;

  async unlock() {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return false;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.35;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") await this.ctx.resume();
      await this.kit.unlock();
      return true;
    } catch { return false; }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.kit.setMuted(muted);
    if (this.master && this.ctx) this.master.gain.setValueAtTime(muted ? 0 : 0.35, this.ctx.currentTime);
  }

  private tone(type: OscillatorType, from: number, to: number, duration: number, volume: number, delay = 0) {
    const ctx = this.ctx, master = this.master;
    if (!ctx || !master) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(master);
    osc.start(t); osc.stop(t + duration + 0.02);
  }

  private noise(duration: number, volume: number, cutoff: number) {
    const ctx = this.ctx, master = this.master;
    if (!ctx || !master) return;
    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = buffer; filter.type = "lowpass"; filter.frequency.value = cutoff; gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(master);
    source.start();
  }

  play(sfx: Sfx) {
    if (this.muted || !this.ctx || this.ctx.state !== "running" || document.hidden) return;
    const now = performance.now(), gap = sfx === "shoot" || sfx === "enemyShot" ? 60 : sfx === "hit" ? 45 : 30;
    if (now - (this.last.get(sfx) ?? 0) < gap) return;
    this.last.set(sfx, now);
    switch (sfx) {
      case "shoot": this.tone("triangle", 720, 420, 0.08, 0.18); break;
      case "enemyShot": this.tone("sine", 300, 180, 0.12, 0.12); break;
      case "hit": this.noise(0.06, 0.25, 2400); this.tone("square", 220, 140, 0.05, 0.05); break;
      case "kill": this.noise(0.18, 0.3, 1400); this.tone("square", 330, 80, 0.2, 0.08); break;
      case "hurt": this.tone("sawtooth", 200, 70, 0.3, 0.18); this.noise(0.15, 0.2, 900); break;
      case "door": this.tone("triangle", 140, 90, 0.25, 0.2); break;
      case "pickup": this.tone("sine", 660, 990, 0.08, 0.2); this.tone("sine", 990, 1320, 0.08, 0.16, 0.07); break;
      case "relic": this.kit.play("reveal-rare"); break;
      case "boss": this.kit.play("impact"); this.tone("sawtooth", 90, 45, 0.9, 0.2); break;
      case "stairs": this.kit.play("action-start"); break;
      case "win": this.kit.play("reveal-legendary"); break;
      case "lose": this.tone("triangle", 330, 110, 0.9, 0.22); break;
    }
  }

  dispose() {
    this.kit.dispose();
    void this.ctx?.close().catch(() => {});
    this.ctx = null; this.master = null;
  }
}
