// A small Web Audio keyboard: triangle voices, a short envelope, one gain per track, and a
// lookahead scheduler over score time (seconds), so the tempo factor only stretches the clock.

export function newAudioContext(): AudioContext {
  const Ctx =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return new Ctx();
}

export type SynthNote = { time: number; duration: number; midi: number; velocity: number; track: number };

const LOOKAHEAD = 0.15;
const TICK_MS = 25;
const MAX_VOICES = 32;

export class Synth {
  private master: GainNode;
  private trackGains: GainNode[];
  private voices: { osc: OscillatorNode; gain: GainNode; end: number }[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private index = 0;
  private startCtx = 0;
  private startPos = 0;
  private pos = 0;
  rate = 1;

  constructor(
    private ctx: AudioContext,
    private notes: SynthNote[],
    tracks: number,
    readonly duration: number,
  ) {
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.25;
    this.master.connect(comp);
    this.trackGains = Array.from({ length: tracks }, () => {
      const g = ctx.createGain();
      g.connect(this.master);
      return g;
    });
  }

  get playing() {
    return this.timer !== null;
  }

  /** Score position in seconds. */
  position() {
    if (!this.timer) return this.pos;
    return Math.min(this.duration, this.startPos + (this.ctx.currentTime - this.startCtx) * this.rate);
  }

  play(onEnd: () => void) {
    if (this.timer) return;
    if (this.pos >= this.duration) this.pos = 0;
    this.startCtx = this.ctx.currentTime + 0.05;
    this.startPos = this.pos;
    this.index = this.firstAt(this.pos);
    this.timer = setInterval(() => {
      const until = this.startPos + (this.ctx.currentTime + LOOKAHEAD - this.startCtx) * this.rate;
      while (this.index < this.notes.length && this.notes[this.index].time < until) {
        this.voice(this.notes[this.index++]);
      }
      if (this.position() >= this.duration) {
        this.pause();
        this.pos = this.duration;
        onEnd();
      }
    }, TICK_MS);
  }

  pause() {
    this.pos = this.position();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const t = this.ctx.currentTime;
    for (const v of this.voices) {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0, t, 0.02);
      v.osc.stop(t + 0.1);
    }
    this.voices = [];
  }

  seek(sec: number, onEnd: () => void) {
    const was = this.playing;
    this.pause();
    this.pos = Math.max(0, Math.min(this.duration, sec));
    if (was) this.play(onEnd);
  }

  setRate(rate: number, onEnd: () => void) {
    const was = this.playing;
    this.pause();
    this.rate = rate;
    if (was) this.play(onEnd);
  }

  mute(track: number, muted: boolean) {
    const g = this.trackGains[track]?.gain;
    g?.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
  }

  dispose() {
    this.pause();
    this.master.disconnect();
  }

  private firstAt(sec: number) {
    let lo = 0;
    let hi = this.notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.notes[mid].time < sec) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private voice(n: SynthNote) {
    const at = Math.max(this.ctx.currentTime, this.startCtx + (n.time - this.startPos) / this.rate);
    const len = Math.max(0.05, n.duration / this.rate);
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter((v) => v.end > now);
    if (this.voices.length >= MAX_VOICES) {
      const old = this.voices.shift()!;
      old.osc.stop(now + 0.02);
    }
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = 440 * 2 ** ((n.midi - 69) / 12);
    const gain = this.ctx.createGain();
    const peak = 0.2 + 0.8 * n.velocity;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.01);
    gain.gain.linearRampToValueAtTime(peak * 0.7, at + 0.11);
    gain.gain.setValueAtTime(peak * 0.7, at + len);
    gain.gain.linearRampToValueAtTime(0, at + len + 0.08);
    osc.connect(gain).connect(this.trackGains[n.track] ?? this.master);
    osc.start(at);
    osc.stop(at + len + 0.1);
    this.voices.push({ osc, gain, end: at + len + 0.1 });
  }
}
