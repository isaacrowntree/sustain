import { PitchDetector } from 'pitchy';
import type { AnalyzerSpec } from '@sustain/pack-sdk';
import type { AudioFrame, PracticeSource } from './types.js';

const WINDOW = 4096; // ~85 ms at 48 kHz — 5-7 periods of a 60-90 Hz drone

interface MicPipeline {
  ctx: AudioContext;
  stream: MediaStream;
  analyser: AnalyserNode;
  buffer: Float32Array<ArrayBuffer>;
}

/**
 * Open the mic with browser audio processing disabled. WebRTC noise
 * suppression classifies sustained tones as background noise and attenuates
 * them, and auto-gain pumps a continuous drone — both must be off.
 */
async function openMic(): Promise<MicPipeline> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  const ctx = new AudioContext();
  await ctx.resume(); // must happen inside the user gesture that started us
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 8192;
  source.connect(analyser);
  return { ctx, stream, analyser, buffer: new Float32Array(WINDOW) };
}

function rmsOf(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
  return Math.sqrt(sum / buf.length);
}

abstract class MicSource implements PracticeSource {
  abstract readonly kind: 'energy' | 'pitch';
  protected pipeline: MicPipeline | null = null;
  private raf = 0;
  /** Bumped by every start()/stop(); stale async starts see it and bail. */
  private generation = 0;
  /** Slow-tracking noise floor, learned only from genuinely quiet frames. */
  protected noiseFloor = 0.005;

  protected abstract analyze(buf: Float32Array, sampleRate: number, rms: number): Omit<AudioFrame, 'timeMs' | 'rms'>;

  async start(onFrame: (frame: AudioFrame) => void): Promise<void> {
    this.stop();
    const gen = ++this.generation;
    const pipeline = await openMic();
    if (gen !== this.generation) {
      // stop() (or another start) happened while getUserMedia was pending.
      pipeline.stream.getTracks().forEach((t) => t.stop());
      void pipeline.ctx.close();
      return;
    }
    this.pipeline = pipeline;
    const tick = () => {
      const p = this.pipeline;
      if (!p || gen !== this.generation) return;
      p.analyser.getFloatTimeDomainData(p.buffer);
      const rms = rmsOf(p.buffer);
      const partial = this.analyze(p.buffer, p.ctx.sampleRate, rms);
      // Learn the floor only from frames quieter than the current gate —
      // loud-but-rejected sound (a drone failing the clarity check) must
      // not ratchet the floor up and lock legitimate playing out.
      if (!partial.playing && rms < this.gate()) {
        this.noiseFloor = this.noiseFloor * 0.98 + rms * 0.02;
      }
      onFrame({ timeMs: performance.now(), rms, ...partial });
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.generation++;
    cancelAnimationFrame(this.raf);
    if (this.pipeline) {
      this.pipeline.stream.getTracks().forEach((t) => t.stop());
      void this.pipeline.ctx.close();
      this.pipeline = null;
    }
  }

  private gate(): number {
    return Math.max(0.01, this.noiseFloor * 3);
  }

  protected aboveFloor(rms: number): boolean {
    return rms > this.gate();
  }

  getStream(): MediaStream | null {
    return this.pipeline?.stream ?? null;
  }
}

/** Tier 2: loudness only. Drives reactive visuals; credits any sound. */
export class EnergySource extends MicSource {
  override readonly kind = 'energy' as const;

  protected analyze(_buf: Float32Array, _sampleRate: number, rms: number) {
    return { playing: this.aboveFloor(rms), pitchHz: null, clarity: null };
  }
}

export interface PitchSourceConfig {
  minHz: number;
  maxHz: number;
  minClarity: number;
  stabilitySemitones?: number;
  rejectMainsHum?: boolean;
}

/**
 * Tier 3: pitch-verified playing via the McLeod Pitch Method (pitchy).
 * A frame counts as playing when loudness clears the noise floor, the
 * detector is confident, the pitch sits in the instrument's band, and —
 * for drone instruments — the pitch has been stable over the last second.
 */
export class PitchSource extends MicSource {
  override readonly kind = 'pitch' as const;
  private detector = PitchDetector.forFloat32Array(WINDOW);
  private recentPitches: { timeMs: number; hz: number }[] = [];

  constructor(private config: PitchSourceConfig) {
    super();
  }

  static fromAnalyzerSpec(spec: AnalyzerSpec): PitchSource {
    if (spec.kind !== 'pitch' || !spec.pitch) {
      throw new Error('PitchSource requires an analyzer spec of kind "pitch"');
    }
    return new PitchSource(spec.pitch);
  }

  protected analyze(buf: Float32Array, sampleRate: number, rms: number) {
    if (!this.aboveFloor(rms)) return { playing: false, pitchHz: null, clarity: null };

    const [pitchHz, clarity] = this.detector.findPitch(buf, sampleRate);
    const { minHz, maxHz, minClarity, stabilitySemitones, rejectMainsHum } = this.config;

    let playing = clarity >= minClarity && pitchHz >= minHz && pitchHz <= maxHz;

    // Mains hum sits at exactly 50/60 Hz with drone-like steadiness but very
    // low energy; require real level before crediting those frequencies.
    if (playing && rejectMainsHum) {
      const nearMains = Math.abs(pitchHz - 50) < 1 || Math.abs(pitchHz - 60) < 1;
      if (nearMains && rms < 0.02) playing = false;
    }

    if (playing && stabilitySemitones !== undefined) {
      const now = performance.now();
      this.recentPitches.push({ timeMs: now, hz: pitchHz });
      this.recentPitches = this.recentPitches.filter((p) => now - p.timeMs < 1000);
      if (this.recentPitches.length >= 5) {
        const semis = this.recentPitches.map((p) => 12 * Math.log2(p.hz));
        const spread = Math.max(...semis) - Math.min(...semis);
        if (spread > stabilitySemitones) playing = false;
      }
    } else if (!playing) {
      this.recentPitches = [];
    }

    return { playing, pitchHz, clarity };
  }
}
