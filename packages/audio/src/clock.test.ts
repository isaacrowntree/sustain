import { describe, expect, it } from 'vitest';
import { PlayingClock } from './clock.js';
import type { AudioFrame } from './types.js';

function frame(timeMs: number, playing: boolean): AudioFrame {
  return { timeMs, playing, rms: playing ? 0.1 : 0, pitchHz: playing ? 72 : null, clarity: playing ? 0.95 : null };
}

describe('PlayingClock', () => {
  it('requires the onset window before crediting', () => {
    const clock = new PlayingClock({ onsetMs: 400, graceMs: 250 });
    let s = clock.update(frame(0, true));
    expect(s.playing).toBe(false);
    s = clock.update(frame(200, true));
    expect(s.playing).toBe(false);
    s = clock.update(frame(450, true));
    expect(s.playing).toBe(true);
    // Onset window credited retroactively.
    expect(s.playMs).toBeGreaterThanOrEqual(400);
  });

  it('rides through dropouts shorter than the grace window', () => {
    const clock = new PlayingClock({ onsetMs: 100, graceMs: 250 });
    clock.update(frame(0, true));
    clock.update(frame(150, true));
    let s = clock.update(frame(300, false)); // wobble starts
    expect(s.playing).toBe(true);
    s = clock.update(frame(450, true)); // back within grace
    expect(s.playing).toBe(true);
    expect(s.currentRunMs).toBeGreaterThan(0);
  });

  it('breaks the run after a real gap and tracks the longest run', () => {
    const clock = new PlayingClock({ onsetMs: 100, graceMs: 250 });
    clock.update(frame(0, true));
    clock.update(frame(200, true));
    let s = clock.update(frame(2000, true));
    const firstRun = s.currentRunMs;
    expect(firstRun).toBeGreaterThan(1500);
    s = clock.update(frame(2400, false));
    s = clock.update(frame(2800, false)); // past grace → run broken
    expect(s.playing).toBe(false);
    expect(s.currentRunMs).toBe(0);
    expect(s.longestRunMs).toBeGreaterThanOrEqual(firstRun);
  });

  it('treats a long frame gap as a discontinuity, not credited play', () => {
    const clock = new PlayingClock({ onsetMs: 100, graceMs: 250 });
    clock.update(frame(0, true));
    clock.update(frame(200, true));
    // Tab backgrounded / paused for 30s, then frames resume.
    let s = clock.update(frame(30_200, true));
    expect(s.playMs).toBeLessThan(1000);
    expect(s.currentRunMs).toBe(0);
    // Fresh onset required before credit resumes.
    s = clock.update(frame(30_350, true));
    expect(s.playing).toBe(true);
    expect(s.currentRunMs).toBeLessThan(400);
  });

  it('accumulates playMs across runs', () => {
    const clock = new PlayingClock({ onsetMs: 100, graceMs: 100 });
    clock.update(frame(0, true));
    clock.update(frame(500, true));
    clock.update(frame(1000, false));
    clock.update(frame(1500, false));
    clock.update(frame(1600, true));
    const s = clock.update(frame(2100, true));
    expect(s.playMs).toBeGreaterThan(900);
    expect(s.playMs).toBeLessThan(2100);
  });
});
