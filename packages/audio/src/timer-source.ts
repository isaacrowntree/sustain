import type { AudioFrame, PracticeSource } from './types.js';

/** Honor-system source: playing whenever running. Works with no mic at all. */
export class TimerSource implements PracticeSource {
  readonly kind = 'timer' as const;
  private interval: ReturnType<typeof setInterval> | null = null;

  async start(onFrame: (frame: AudioFrame) => void): Promise<void> {
    this.stop();
    this.interval = setInterval(() => {
      onFrame({ timeMs: performance.now(), playing: true, rms: 0, pitchHz: null, clarity: null });
    }, 100);
  }

  stop(): void {
    if (this.interval !== null) clearInterval(this.interval);
    this.interval = null;
  }

  getStream(): MediaStream | null {
    return null;
  }
}
