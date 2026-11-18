import { boothError, type BoothError } from '@booth/contracts';

/**
 * Web Audio playback. The AudioContext clock is the authoritative song
 * timeline (see SongTimeline). Buffers are decoded fully up front so seeking
 * and resume are sample-accurate and independent of disk I/O.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;

  get context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  get state(): string {
    return this.ctx?.state ?? 'none';
  }

  async ensureRunning(): Promise<void> {
    const ctx = this.context;
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch (e) {
        throw boothError('AUDIO_CONTEXT_FAILED', `AudioContext resume failed: ${(e as Error).message}`, true);
      }
    }
    if (ctx.state !== 'running') {
      throw boothError('AUDIO_CONTEXT_FAILED', `AudioContext state is ${ctx.state}`, true);
    }
  }

  async load(url: string): Promise<AudioBuffer> {
    const cached = this.buffers.get(url);
    if (cached) return cached;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (e) {
      throw boothError('AUDIO_LOAD_FAILED', `fetch failed for ${url}: ${(e as Error).message}`, false);
    }
    if (!res.ok) throw boothError('AUDIO_LOAD_FAILED', `HTTP ${res.status} for ${url}`, false);
    try {
      const buf = await this.context.decodeAudioData(await res.arrayBuffer());
      this.buffers.set(url, buf);
      return buf;
    } catch (e) {
      throw boothError('AUDIO_LOAD_FAILED', `decode failed for ${url}: ${(e as Error).message}`, false);
    }
  }

  /** Starts `buffer` at audio time `when` from `offset` seconds. Stops anything playing. */
  play(buffer: AudioBuffer, when: number, offset: number): void {
    this.stop();
    const ctx = this.context;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gain!);
    src.start(Math.max(when, ctx.currentTime), Math.max(0, offset));
    this.source = src;
  }

  /** Idempotent. */
  stop(): void {
    if (!this.source) return;
    try {
      this.source.stop();
    } catch {
      // already stopped
    }
    this.source.disconnect();
    this.source = null;
  }

  /** Short note sequence for UI cues; volume 0 is a no-op. */
  notes(notes: readonly [number, number][], volume: number): void {
    if (volume <= 0 || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    let t = ctx.currentTime;
    for (const [f, d] of notes) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25 * volume, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      osc.connect(g).connect(this.gain!);
      osc.start(t);
      osc.stop(t + d + 0.01);
      osc.onended = () => {
        osc.disconnect();
        g.disconnect();
      };
      t += d * 0.9;
    }
  }

  /**
   * A short synthesised crowd cheer (band-passed noise swelling and fading,
   * with scattered claps) for the moment the stage powers up. No audio files.
   */
  cheer(volume: number, durationSec = 2.6): void {
    if (volume <= 0 || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * durationSec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Noise with a slow random "voices" flutter and short clap transients.
    let flutter = 0.6;
    for (let i = 0; i < len; i++) {
      if (i % 512 === 0) flutter = 0.45 + Math.random() * 0.55;
      d[i] = (Math.random() * 2 - 1) * flutter;
    }
    for (let k = 0; k < 40; k++) {
      const at = Math.floor(Math.random() * len * 0.85);
      const n = Math.floor(ctx.sampleRate * 0.012);
      for (let i = 0; i < n && at + i < len; i++) d[at + i]! += (Math.random() * 2 - 1) * 1.6 * (1 - i / n);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1400;
    band.Q.value = 0.7;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    const peak = 0.22 * volume;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.35);
    g.gain.setValueAtTime(peak, t + durationSec * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + durationSec);
    src.connect(band).connect(g).connect(this.gain!);
    src.start(t);
    src.stop(t + durationSec + 0.05);
    src.onended = () => {
      src.disconnect();
      band.disconnect();
      g.disconnect();
    };
  }

  /** Short tone sequence for the operator's audio test. */
  testTone(): void {
    const ctx = this.context;
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.value = f;
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(g).connect(this.gain!);
      osc.start(t);
      osc.stop(t + 0.17);
      osc.onended = () => {
        osc.disconnect();
        g.disconnect();
      };
    });
  }

  /** Paired (audio, performance) timestamps for mapping camera capture times. */
  outputTimestamp(): AudioTimestamp | null {
    if (!this.ctx || this.ctx.state !== 'running') return null;
    return this.ctx.getOutputTimestamp();
  }

  async close(): Promise<void> {
    this.stop();
    this.buffers.clear();
    if (this.ctx) await this.ctx.close().catch(() => undefined);
    this.ctx = null;
  }
}

export function isBoothError(e: unknown): e is BoothError {
  return typeof e === 'object' && e !== null && 'code' in e && 'recoverable' in e;
}
