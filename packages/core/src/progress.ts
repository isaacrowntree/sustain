import type { InstrumentPack } from '@sustain/pack-sdk';
import type { ISODate } from './dates.js';

export interface SessionRecord {
  date: ISODate;
  dayIndex: number;
  /** Seconds of the compiled session actually completed. */
  completedSeconds: number;
  /** Seconds credited as playing (timer- or mic-accrued). */
  playSeconds: number;
  /** True when a mic analyzer verified the play time. */
  verified: boolean;
  isBoss: boolean;
}

export interface MetricEntry {
  value: number;
  date: ISODate;
  verified: boolean;
}

export interface ProgressState {
  version: 1;
  packId: string;
  /** Program start date — always a Monday. */
  startDate: ISODate;
  /**
   * The day the player actually began. When it falls mid-week, the first
   * week's adherence target is prorated to the practice days that remained.
   */
  joinDate?: ISODate;
  sessions: SessionRecord[];
  bests: Record<string, MetricEntry>;
  history: Record<string, MetricEntry[]>;
  drillCompletions: Record<string, number>;
  selfReports: Record<string, boolean>;
}

export function emptyProgress(packId: string, startDate: ISODate, joinDate?: ISODate): ProgressState {
  return {
    version: 1,
    packId,
    startDate,
    joinDate: joinDate ?? startDate,
    sessions: [],
    bests: {},
    history: {},
    drillCompletions: {},
    selfReports: {},
  };
}

export interface RecordMetricResult {
  isPersonalRecord: boolean;
  previousBest: number | null;
}

/** Record a measured or self-reported metric value; returns PR status. */
export function recordMetric(
  state: ProgressState,
  pack: InstrumentPack,
  metricId: string,
  value: number,
  date: ISODate,
  verified: boolean,
): RecordMetricResult {
  const def = pack.metrics.find((m) => m.id === metricId);
  if (!def) return { isPersonalRecord: false, previousBest: null };
  const entry: MetricEntry = { value, date, verified };
  (state.history[metricId] ??= []).push(entry);
  const best = state.bests[metricId];
  const beats =
    !best || (def.direction === 'higher' ? value > best.value : value < best.value);
  if (beats) {
    state.bests[metricId] = entry;
    return { isPersonalRecord: true, previousBest: best?.value ?? null };
  }
  return { isPersonalRecord: false, previousBest: best.value };
}

export function recordSession(state: ProgressState, record: SessionRecord): void {
  const existing = state.sessions.findIndex((s) => s.date === record.date);
  if (existing >= 0) {
    // One session per calendar day; a repeat replaces if it did more.
    const prev = state.sessions[existing]!;
    if (record.completedSeconds > prev.completedSeconds) state.sessions[existing] = record;
    return;
  }
  state.sessions.push(record);
  state.sessions.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function recordDrillCompletion(state: ProgressState, drillId: string): void {
  state.drillCompletions[drillId] = (state.drillCompletions[drillId] ?? 0) + 1;
}

/** Drills completed at least once — what unlock and one-off logic reads. */
export function completedDrillSet(state: ProgressState): Set<string> {
  return new Set(
    Object.entries(state.drillCompletions)
      .filter(([, count]) => count > 0)
      .map(([id]) => id),
  );
}

/**
 * A phase's one-off drills that are still outstanding. They survive until
 * they're genuinely done, so an interrupted or unrecorded first session
 * doesn't cost you the day-one recording.
 */
export function pendingFirstSessionDrills(
  state: ProgressState,
  phase: { firstSessionDrills?: string[] },
): string[] {
  return (phase.firstSessionDrills ?? []).filter((id) => (state.drillCompletions[id] ?? 0) === 0);
}

/** True when the player has already logged a session in this phase's weeks. */
export function hasSessionInPhase(
  state: ProgressState,
  phase: { weeks: [number, number] },
): boolean {
  return state.sessions.some((s) => {
    const week = Math.floor(Math.max(0, s.dayIndex) / 7) + 1;
    return week >= phase.weeks[0] && week <= phase.weeks[1];
  });
}

/** Persistence boundary. The web app backs this with IndexedDB. */
export interface ProgressStore {
  load(): Promise<ProgressState | null>;
  save(state: ProgressState): Promise<void>;
}

export class MemoryStore implements ProgressStore {
  private state: ProgressState | null = null;
  load(): Promise<ProgressState | null> {
    return Promise.resolve(
      this.state ? (JSON.parse(JSON.stringify(this.state)) as ProgressState) : null,
    );
  }
  save(state: ProgressState): Promise<void> {
    this.state = JSON.parse(JSON.stringify(state)) as ProgressState;
    return Promise.resolve();
  }
}
