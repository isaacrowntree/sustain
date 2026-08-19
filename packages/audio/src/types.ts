/** One analysis frame, emitted ~every animation tick while a source runs. */
export interface AudioFrame {
  timeMs: number;
  /** The source's verdict: is the instrument being played right now? */
  playing: boolean;
  /** 0-1 loudness, for reactive visuals. Timer sources emit 0. */
  rms: number;
  pitchHz: number | null;
  clarity: number | null;
}

/**
 * A pluggable "is playing" signal. The session engine consumes frames and
 * does not care which tier produced them:
 *  - 'timer'  — always playing while running (honor system, no mic)
 *  - 'energy' — mic loudness gate (reactive visuals, coarse credit)
 *  - 'pitch'  — pitch-verified playing (auto-measured metrics)
 */
export interface PracticeSource {
  readonly kind: 'timer' | 'energy' | 'pitch';
  start(onFrame: (frame: AudioFrame) => void): Promise<void>;
  stop(): void;
  /** The live mic stream, when this source has one (for recordings). */
  getStream(): MediaStream | null;
}
