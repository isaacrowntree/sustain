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
  /** Detected fundamental, when an analyzer is running. */
  pitchHz: number | null;
  clarity: number | null;
  /** True once a microphone source is live (as opposed to the timer). */
  micActive: boolean;
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

/** Everything needed to put a reloaded page back where the player was. */
export interface SessionProgressSnapshot {
  elapsed: number;
  verified: boolean;
  verifiedPlayMs: number;
  metricRuns: Record<string, number>;
}

export interface PlayerOptions {
  onTick(tick: PlayerTick): void;
  onSegmentChange(segment: Segment, index: number): void;
  onFinish(result: SessionResult): void;
  /** Called every couple of seconds so the session survives a reload. */
  onSnapshot?(snapshot: SessionProgressSnapshot): void;
  recordingKeyPrefix: string;
  speak?: boolean;
  /** Resume an interrupted session instead of starting from zero. */
  resumeFrom?: SessionProgressSnapshot;
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
  private recorder: MediaRecorder | null = null;
  private precuedIndex = -1;
  private finished = false;
  private speechCtx: AudioContext | null = null;
  /**
   * Verified milliseconds banked before an interruption. The live clock
   * starts from zero on resume, so this is added back at the end.
   */
  private carriedVerifiedMs = 0;
  private lastSnapshotMs = 0;
  /** Record segments that produced no audio — usually the mic was off. */
  private unrecordedDrills = new Set<string>();

  constructor(
    private session: CompiledSession,
    private opts: PlayerOptions,
  ) {
    const resume = opts.resumeFrom;
    if (resume) {
      this.metricRuns = { ...resume.metricRuns };
      if (resume.verified) this.carriedVerifiedMs = resume.verifiedPlayMs;
    }
  }

  async start(): Promise<void> {
    await this.source.start((f) => this.onFrame(f));
    // Rewind the clock's origin so elapsed picks up where it left off. The
    // time the tab was closed is not credited — you weren't playing.
    this.startedAtMs = performance.now() - (this.opts.resumeFrom?.elapsed ?? 0) * 1000;
    this.loop();
  }

  /** Swap in a mic source mid-session. Must be called from a user gesture. */
  async useSource(source: PracticeSource, verified: boolean): Promise<void> {
    if (this.finished) return;
    // Start the new source BEFORE touching state: if the mic prompt is
    // denied this throws, the timer source keeps running, nothing changes.
    await source.start((f) => this.onFrame(f));
    if (this.finished) {
      source.stop();
      return;
    }
    this.source.stop();
    this.source = source;
    this.verified = verified;
    // Timer-fabricated credit must not masquerade as mic-verified time:
    // verified counting starts from zero at the moment the mic goes live.
    this.sessionClock.reset();
    this.segmentClock.reset();
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

  /**
   * Move the session clock to an absolute position. Used to skip a drill,
   * repeat one, or put yourself back where you were after an interruption.
   */
  seekTo(seconds: number): void {
    const target = Math.min(Math.max(0, seconds), Math.max(0, this.session.totalSeconds - 0.5));
    const reference = this.pausedAtMs ?? performance.now();
    this.startedAtMs = reference - this.pausedTotalMs - target * 1000;
    // The clocks describe a stretch of time we're no longer in.
    this.sessionClock.reset();
    this.segmentClock.reset();
    this.precuedIndex = -1;
    this.stopRecorder();
  }

  seekBy(deltaSeconds: number): void {
    this.seekTo(this.elapsedSeconds() + deltaSeconds);
  }

  /** Jump to the start of a neighbouring segment. */
  seekSegment(direction: -1 | 1): void {
    const elapsed = this.elapsedSeconds();
    const start = this.segmentStart(this.segmentIndex);
    if (direction === -1) {
      // Back within a segment restarts it; near its start goes to the previous.
      const target = elapsed - start > 2 ? this.segmentIndex : this.segmentIndex - 1;
      this.seekTo(this.segmentStart(Math.max(0, target)));
    } else {
      this.seekTo(start + (this.session.segments[this.segmentIndex]?.seconds ?? 0));
    }
  }

  get elapsed(): number {
    return this.elapsedSeconds();
  }

  get totalSeconds(): number {
    return this.session.totalSeconds;
  }

  abort(): void {
    this.finish(true);
  }

  private snapshot(elapsed: number, clockPlayMs: number): SessionProgressSnapshot {
    return {
      elapsed,
      verified: this.verified,
      verifiedPlayMs: this.carriedVerifiedMs + (this.verified ? clockPlayMs : 0),
      metricRuns: { ...this.metricRuns },
    };
  }

  /** Snapshot right now — for pagehide, where there's no time to wait. */
  snapshotNow(): SessionProgressSnapshot {
    return this.snapshot(this.elapsedSeconds(), this.sessionClock.update(this.lastFrame).playMs);
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
    // Telegraph the coming boundary one breath early — a soft low chime,
    // only for segments long enough that the transition isn't already near.
    const segRemaining = this.segmentStart(idx) + seg.seconds - elapsed;
    if (segRemaining < 3.2 && seg.seconds >= 10 && this.precuedIndex !== idx) {
      this.precuedIndex = idx;
      this.chime(392);
    }
    const clock = this.sessionClock.update(this.lastFrame);

    if (this.opts.onSnapshot && performance.now() - this.lastSnapshotMs > 2000) {
      this.lastSnapshotMs = performance.now();
      this.opts.onSnapshot(this.snapshot(elapsed, clock.playMs));
    }

    this.opts.onTick({
      elapsed,
      segmentIndex: idx,
      segment: seg,
      segmentRemaining: Math.max(0, this.segmentStart(idx) + seg.seconds - elapsed),
      totalRemaining: Math.max(0, this.session.totalSeconds - elapsed),
      rms: this.lastFrame.rms,
      pitchHz: this.lastFrame.pitchHz,
      clarity: this.lastFrame.clarity,
      micActive: this.source.kind !== 'timer',
      playing: this.verified || this.source.kind !== 'timer' ? clock.playing : true,
      verifiedPlayMs: clock.playMs,
      currentRunMs: clock.currentRunMs,
    });

    this.raf = requestAnimationFrame(this.loop);
  };

  private enterSegment(index: number): void {
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
    if (!stream) {
      // Nothing was captured, so the drill hasn't really been done — it
      // stays outstanding and gets offered again next session.
      this.unrecordedDrills.add(seg.drillId);
      return;
    }
    try {
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: rec.mimeType });
        if (blob.size > 0) {
          void saveRecording(`${this.opts.recordingKeyPrefix}:${seg.drillId}`, blob);
        } else {
          this.unrecordedDrills.add(seg.drillId);
        }
      };
      rec.start();
      this.recorder = rec;
      this.unrecordedDrills.delete(seg.drillId);
    } catch {
      this.unrecordedDrills.add(seg.drillId);
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

  /**
   * A drill counts as completed only when every one of its segments was
   * traversed — an abort mid-drill must not satisfy unlock gates.
   */
  private completedDrillIds(aborted: boolean): string[] {
    const lastIndexExclusive = aborted ? this.segmentIndex : this.session.segments.length;
    const lastIndexOfDrill = new Map<string, number>();
    this.session.segments.forEach((s, i) => lastIndexOfDrill.set(s.drillId, i));
    const ids: string[] = [];
    for (const [id, last] of lastIndexOfDrill) {
      if (last < lastIndexExclusive && !id.startsWith('boss-') && !this.unrecordedDrills.has(id)) {
        ids.push(id);
      }
    }
    return ids;
  }

  private finish(aborted: boolean): void {
    if (this.finished) return;
    this.finished = true;
    cancelAnimationFrame(this.raf);
    this.stopRecorder();
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
      completedDrillIds: this.completedDrillIds(aborted),
      aborted,
    });
  }
}
