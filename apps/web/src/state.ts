import type { InstrumentPack } from '@sustain/pack-sdk';
import {
  emptyProgress,
  isoDate,
  mondayOf,
  nextMonday,
  parseISO,
  type ISODate,
  type ProgressState,
  type ProgressStore,
} from '@sustain/core';
import type { CompiledSession } from '@sustain/core';
import { idbDelete, idbGet, idbPut, PROGRESS_STORE } from './idb.js';

/**
 * Progress lives in IndexedDB — the browser's on-disk database — not
 * localStorage: no 5MB string ceiling, structured storage, and it
 * participates in persistent-storage protection.
 */
export class IndexedDBProgressStore implements ProgressStore {
  constructor(private packId: string) {}

  load(): Promise<ProgressState | null> {
    return idbGet<ProgressState>(PROGRESS_STORE, this.packId);
  }

  save(state: ProgressState): Promise<void> {
    return idbPut(PROGRESS_STORE, this.packId, state);
  }
}

export function today(): ISODate {
  return isoDate(new Date());
}

/**
 * Programs anchor to Mondays. Starting on a practice day joins this week
 * (the first week's adherence target is prorated to the days remaining);
 * starting on a scheduled rest day begins next Monday.
 */
export function startDateFor(pack: InstrumentPack, todayIso: ISODate): ISODate {
  const dow = parseISO(todayIso).getDay(); // 0 = Sunday
  const weekday = dow === 0 ? 7 : dow;
  return weekday <= pack.schedule.daysPerWeek ? mondayOf(todayIso) : nextMonday(todayIso);
}

export async function beginProgram(pack: InstrumentPack, store: ProgressStore): Promise<ProgressState> {
  const now = today();
  const state = emptyProgress(pack.id, startDateFor(pack, now), now);
  await store.save(state);
  // Ask the browser to shield this origin's data from storage eviction —
  // sixteen weeks of practice history should not vanish under disk pressure.
  void navigator.storage?.persist?.();
  return state;
}

/**
 * A session in flight. Written every couple of seconds so closing the tab,
 * reloading, or a browser crash costs you your place and nothing else.
 */
export interface ActiveSession {
  version: 1;
  packId: string;
  date: ISODate;
  dayIndex: number;
  isBossSession: boolean;
  isRestDayMakeup: boolean;
  session: CompiledSession;
  recordingKeyPrefix: string;
  /** Seconds into the session when this snapshot was taken. */
  elapsed: number;
  /** Whether the microphone was verifying at snapshot time. */
  verified: boolean;
  /** Verified playing milliseconds accumulated so far. */
  verifiedPlayMs: number;
  metricRuns: Record<string, number>;
  savedAtMs: number;
}

function activeKey(packId: string): string {
  return `${packId}:active`;
}

export function saveActiveSession(active: ActiveSession): Promise<void> {
  return idbPut(PROGRESS_STORE, activeKey(active.packId), active);
}

export function clearActiveSession(packId: string): Promise<void> {
  return idbDelete(PROGRESS_STORE, activeKey(packId));
}

/**
 * The session to resume, if there is one worth resuming: same pack, same
 * calendar day, and not already finished. Anything else is discarded — a
 * session you abandoned yesterday isn't one you're still in.
 */
export async function loadActiveSession(packId: string): Promise<ActiveSession | null> {
  const active = await idbGet<ActiveSession>(PROGRESS_STORE, activeKey(packId));
  if (!active) return null;
  const stale =
    active.version !== 1 ||
    active.packId !== packId ||
    active.date !== today() ||
    active.elapsed >= active.session.totalSeconds - 1;
  if (stale) {
    await clearActiveSession(packId);
    return null;
  }
  return active;
}

/** Export progress as a downloadable JSON blob URL (data ownership). */
export function exportProgress(state: ProgressState): string {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  return URL.createObjectURL(blob);
}
