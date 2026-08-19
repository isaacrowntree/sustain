import type { AudioFrame } from './types.js';

export interface ClockState {
  playing: boolean;
  /** Total credited playing milliseconds. */
  playMs: number;
  /** Length of the current unbroken run (continues through grace gaps). */
  currentRunMs: number;
  /** Longest unbroken run seen — the circular-breathing metric. */
  longestRunMs: number;
}

export interface PlayingClockOptions {
  /** Qualifying sound must persist this long before credit starts. */
  onsetMs?: number;
  /** Dropouts shorter than this do not break an unbroken run. */
  graceMs?: number;
}

/**
 * Turns a stream of per-frame playing verdicts into credited time with
 * hysteresis: brief wobbles (a vocalization, a detector flicker) don't stop
 * the clock, and a run only breaks after a real gap. Pure logic — testable
 * without a browser.
 */
export class PlayingClock {
  private onsetMs: number;
  private graceMs: number;

  private candidateSinceMs: number | null = null;
  private lastPlayingMs: number | null = null;
  private lastFrameMs: number | null = null;
  private state: ClockState = { playing: false, playMs: 0, currentRunMs: 0, longestRunMs: 0 };
  private runStartMs: number | null = null;

  constructor(options: PlayingClockOptions = {}) {
    this.onsetMs = options.onsetMs ?? 400;
    this.graceMs = options.graceMs ?? 250;
  }

  update(frame: AudioFrame): ClockState {
    const now = frame.timeMs;
    const rawDt = this.lastFrameMs === null ? 0 : Math.max(0, now - this.lastFrameMs);
    this.lastFrameMs = now;

    // A long gap between frames means we weren't observing (pause, tab in
    // the background, source swap). Nothing in that span is credible: end
    // any run and require a fresh onset rather than crediting wall time.
    if (rawDt > 2000) {
      this.candidateSinceMs = null;
      this.lastPlayingMs = null;
      this.runStartMs = null;
      this.state.playing = false;
      this.state.currentRunMs = 0;
    }
    // Credited time per frame is capped so a single late frame can't
    // inflate playMs beyond what was plausibly observed.
    const dt = Math.min(500, rawDt);

    if (frame.playing) {
      this.candidateSinceMs ??= now;
      const qualified = now - this.candidateSinceMs >= this.onsetMs;
      if (qualified && !this.state.playing) {
        this.state.playing = true;
        // Credit the whole qualifying window retroactively — the player was
        // playing during it, we were just waiting to be sure.
        this.state.playMs += now - this.candidateSinceMs;
        this.runStartMs = this.candidateSinceMs;
      } else if (this.state.playing) {
        this.state.playMs += dt;
      }
      this.lastPlayingMs = now;
    } else {
      this.candidateSinceMs = null;
      if (this.state.playing && this.lastPlayingMs !== null) {
        if (now - this.lastPlayingMs > this.graceMs) {
          this.state.playing = false;
          this.runStartMs = null;
        } else {
          // Within grace: keep crediting through the wobble.
          this.state.playMs += dt;
        }
      }
    }

    if (this.state.playing && this.runStartMs !== null) {
      this.state.currentRunMs = now - this.runStartMs;
      this.state.longestRunMs = Math.max(this.state.longestRunMs, this.state.currentRunMs);
    } else {
      this.state.currentRunMs = 0;
    }

    return { ...this.state };
  }

  reset(): void {
    this.candidateSinceMs = null;
    this.lastPlayingMs = null;
    this.lastFrameMs = null;
    this.runStartMs = null;
    this.state = { playing: false, playMs: 0, currentRunMs: 0, longestRunMs: 0 };
  }
}
