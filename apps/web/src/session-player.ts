import type { CompiledSession, Segment } from '@sustain/core';
import { PlayingClock, TimerSource, type AudioFrame, type PracticeSource } from '@sustain/audio';
import { saveRecording } from './recordings.js';

export interface PlayerTick {
  elapsed: number;
  segmentIndex: number;
  segment: Segment;
  segmentRemaining: number;
  totalRemaining: number;
  rms: number;
  playing: boolean;
  verifiedPlayMs: number;
  currentRunMs: number;
}

export interface SessionResult {
  completedSeconds: number;
  playSeconds: number;
  verified: boolean;
  /** Longest run per metric id, seconds — only present in verified mode. */
  metricRuns: Record<string, number>;
  completedDrillIds: string[];
  aborted: boolean;
}

export interface PlayerOptions {
  onTick(tick: PlayerTick): void;
  onSegmentChange(segment: Segment, index: number): void;
  onFinish(result: SessionResult): void;
  recordingKeyPrefix: string;
  speak?: boolean;
}

/**
 * Walks a compiled session on a wall clock, feeding cues out and audio
 * frames in. The practice source is swappable mid-session: timer by
 * default, mic verification when granted.
 */
export class SessionPlayer {
  private source: PracticeSource = new TimerSource();
  private verified = false;
  private sessionClock = new PlayingClock();
  private segmentClock = new PlayingClock();
  private lastFrame: AudioFrame = { timeMs: 0, playing: false, rms: 0, pitchHz: null, clarity: null };

  private raf = 0;
  private startedAtMs = 0;
  private pausedAtMs: number | null = null;
  private pausedTotalMs = 0;
  private segmentIndex = -1;
  private metricRuns: Record<string, number> = {};
  private completedDrills = new Set<string>();
  private recorder: MediaRecorder | null = null;
  private finished = false;
  private speechCtx: AudioContext | null = null;

  constructor(
    private session: CompiledSession,
    private opts: PlayerOptions,
  ) {}

  async start(): Promise<void> {
    await this.source.start((f) => this.onFrame(f));
    this.startedAtMs = performance.now();
    this.loop();
  }

  /** Swap in a mic source mid-session. Must be called from a user gesture. */
  async useSource(source: PracticeSource, verified: boolean): Promise<void> {
    this.source.stop();
    this.source = source;
    this.verified = verified;
    await source.start((f) => this.onFrame(f));
  }

  get micStream(): MediaStream | null {
    return this.source.getStream();
  }

  pause(): void {
    if (this.pausedAtMs !== null) return;
    this.pausedAtMs = performance.now();
    speechSynthesis.cancel();
  }

  resume(): void {
    if (this.pausedAtMs === null) return;
    this.pausedTotalMs += performance.now() - this.pausedAtMs;
    this.pausedAtMs = null;
  }

  get paused(): boolean {
    return this.pausedAtMs !== null;
  }

  skipSegment(): void {
    const elapsed = this.elapsedSeconds();
    const seg = this.session.segments[this.segmentIndex];
    if (!seg) return;
    const segStart = this.segmentStart(this.segmentIndex);
    const remaining = seg.seconds - (elapsed - segStart);
    if (remaining > 0) this.pausedTotalMs -= remaining * 1000;
  }

  abort(): void {
    this.finish(true);
  }

  private segmentStart(index: number): number {
    let s = 0;
    for (let i = 0; i < index; i++) s += this.session.segments[i]!.seconds;
    return s;
  }

  private elapsedSeconds(): number {
    const now = this.pausedAtMs ?? performance.now();
    return (now - this.startedAtMs - this.pausedTotalMs) / 1000;
  }

  private onFrame(frame: AudioFrame): void {
    if (this.pausedAtMs !== null) return;
    this.lastFrame = frame;
    this.sessionClock.update(frame);
    const state = this.segmentClock.update(frame);
    const seg = this.session.segments[this.segmentIndex];
    if (seg?.metric && this.verified && seg.kind === 'play') {
      const runSec = state.longestRunMs / 1000;
      if (runSec > (this.metricRuns[seg.metric] ?? 0)) this.metricRuns[seg.metric] = runSec;
    }
  }

  private loop = (): void => {
    if (this.finished) return;
    const elapsed = this.elapsedSeconds();
    const segments = this.session.segments;

    let idx = 0;
    let acc = 0;
    while (idx < segments.length && acc + segments[idx]!.seconds <= elapsed) {
      acc += segments[idx]!.seconds;
      idx += 1;
    }

    if (idx >= segments.length) {
      this.finish(false);
      return;
    }

    if (idx !== this.segmentIndex) {
      this.enterSegment(idx);
    }

    const seg = segments[idx]!;
    const clock = this.sessionClock.update(this.lastFrame);
    this.opts.onTick({
      elapsed,
      segmentIndex: idx,
      segment: seg,
      segmentRemaining: Math.max(0, this.segmentStart(idx) + seg.seconds - elapsed),
      totalRemaining: Math.max(0, this.session.totalSeconds - elapsed),
      rms: this.lastFrame.rms,
      playing: this.verified || this.source.kind !== 'timer' ? clock.playing : true,
      verifiedPlayMs: clock.playMs,
      currentRunMs: clock.currentRunMs,
    });

    this.raf = requestAnimationFrame(this.loop);
  };

  private enterSegment(index: number): void {
    const prev = this.session.segments[this.segmentIndex];
    if (prev && !prev.drillId.startsWith('boss-')) this.completedDrills.add(prev.drillId);
    this.stopRecorder();

    this.segmentIndex = index;
    const seg = this.session.segments[index]!;
    this.segmentClock.reset();
    this.opts.onSegmentChange(seg, index);

    if (this.opts.speak !== false) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(seg.cue);
      u.rate = 1.05;
      speechSynthesis.speak(u);
    }
    this.chime(seg.kind === 'play' || seg.kind === 'record' ? 660 : 440);

    if (seg.kind === 'record') this.startRecorder(seg);
  }

  private startRecorder(seg: Segment): void {
    const stream = this.micStream;
    if (!stream) return;
    try {
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: rec.mimeType });
        void saveRecording(`${this.opts.recordingKeyPrefix}:${seg.drillId}`, blob);
      };
      rec.start();
      this.recorder = rec;
    } catch {
      this.recorder = null;
    }
  }

  private stopRecorder(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.recorder = null;
  }

  private chime(freq: number): void {
    try {
      this.speechCtx ??= new AudioContext();
      const ctx = this.speechCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch {
      /* audio cues are best-effort */
    }
  }

  private finish(aborted: boolean): void {
    if (this.finished) return;
    this.finished = true;
    cancelAnimationFrame(this.raf);
    this.stopRecorder();
    const seg = this.session.segments[this.segmentIndex];
    if (!aborted && seg && !seg.drillId.startsWith('boss-')) this.completedDrills.add(seg.drillId);
    const clock = this.sessionClock.update(this.lastFrame);
    this.source.stop();
    speechSynthesis.cancel();
    void this.speechCtx?.close();

    const elapsed = Math.min(this.elapsedSeconds(), this.session.totalSeconds);
    this.opts.onFinish({
      completedSeconds: Math.round(elapsed),
      playSeconds: this.verified
        ? Math.round(clock.playMs / 1000)
        : Math.round(
            this.session.segments
              .slice(0, aborted ? this.segmentIndex : undefined)
              .filter((s) => s.kind === 'play')
              .reduce((a, s) => a + s.seconds, 0),
          ),
      verified: this.verified,
      metricRuns: Object.fromEntries(
        Object.entries(this.metricRuns).map(([k, v]) => [k, Math.round(v)]),
      ),
      completedDrillIds: [...this.completedDrills],
      aborted,
    });
  }
}
